import { createPlatform } from "./platform/foundry.mjs";
import { registerManagerMenu } from "./platform/manager-menu.mjs";
import { FEATURES, GROUPS, PATCH_FEATURES } from "./features/index.mjs";
import { wraps } from "./kernel/wrap.mjs";
import { validateFeatures } from "./kernel/feature.mjs";
import { createFeatureContext, createServiceContext } from "./kernel/context.mjs";
import { createServiceRegistry } from "./kernel/services.mjs";
import { createFeatureDirectory } from "./kernel/features.mjs";
import { SERVICES } from "./services/index.mjs";
import { bootFeatures } from "./kernel/lifecycle.mjs";
import { createSettingListeners, registerFeatureSetting } from "./kernel/settings.mjs";
import { getPatchMode, registerPatchSettings } from "./kernel/patch-settings.mjs";
import { runReady } from "./kernel/ready.mjs";
import { createPublished } from "./kernel/publish.mjs";
import { RULE_PROFILES } from "./features/profiles.mjs";
import { profileSettingSpec } from "./kernel/profiles.mjs";
import { applyInitialProfile, createProfileGuard } from "./kernel/rule-profile.mjs";

const platform = createPlatform();

/**
 * Patches and rules, in install order (scripts/kernel/lifecycle.mjs). Notifications and the Center only use patches.
 * @type {import("./kernel/lifecycle.mjs").StatusEntry[]}
 */
const status = [];

/** Services, installed on demand before the first feature that declares them. */
const services = createServiceRegistry(SERVICES, (service) => createServiceContext(platform, service, { wraps }));

/** Declared runtime dependencies between features (`interactsWith`), read from the status after the boot. */
const features = createFeatureDirectory({
  features: FEATURES,
  status: () => status,
  getSetting: (key) => platform.settings.get(key)
});

/** What the features publish through ctx.publish, merged into the module API (api.rewards, from encounter-xp). */
const published = createPublished(["status", "groups", "wraps", "graph"]);

/** Listeners added by the installed features (ctx.onSettingChange), called by each setting's onChange. */
const settingListeners = createSettingListeners((err, key) => platform.log.error(`setting ${key}: listener failed`, err));

/** One context per feature, shared by isNeeded, install and lateProbe. */
const contexts = new Map();
const contextFor = (feature) => {
  if (!contexts.has(feature.id)) {
    contexts.set(feature.id, createFeatureContext(platform, feature, {
        wraps,
        services,
        features,
        publish: published.add,
        settingListeners
      }));
  }
  return contexts.get(feature.id);
};

/** Rule profiles (#96): the guard, and whether the world was new on "init". */
const profileGuard = createProfileGuard({ settings: platform.settings, user: platform.user, profiles: RULE_PROFILES.values, log: platform.log });
let freshWorld = false;

platform.hooks.once("init", () => {
  // Before anything is written: "ready" already saves settings of this module (runReady).
  freshWorld = !platform.settings.hasStoredWorldValues();
  registerPatchSettings(platform.settings, PATCH_FEATURES);
  registerFeatureSetting(platform.settings.register, profileSettingSpec(RULE_PROFILES.values), { platform, listeners: settingListeners });
  registerManagerMenu(platform, {
    features: FEATURES,
    patches: PATCH_FEATURES,
    groups: GROUPS,
    status: () => status,
    profiles: { ...RULE_PROFILES, exclusive: profileGuard.exclusive }
  });
  validateFeatures(FEATURES, GROUPS, services.ids());

  // Features are installed during "init": the system has already registered its classes in CONFIG, and world
  // documents are only prepared after this hook.
  status.push(
    ...bootFeatures({
      features: FEATURES,
      modeOf: (feature) => getPatchMode(platform.settings, feature.id),
      system: platform.system,
      contextFor,
      registerSetting: (spec) =>
        registerFeatureSetting(platform.settings.register, spec, { platform, listeners: settingListeners }),
      services,
      log: platform.log
    })
  );

  platform.module.setApi({
    ...published.entries(),
    status,
    groups: GROUPS,
    // Wrapper chains, owners from the innermost to the outermost: game.modules.get(MODULE_ID).api.wraps()
    wraps: wraps.list,
    // Services and declared dependencies of each feature: game.modules.get(MODULE_ID).api.graph()
    graph: features.graph
  });

  profileGuard.listen(settingListeners);
  profileGuard.watchAuthority(platform.hooks);
});

/** Saves the recommended profile in a new world, then checks the saved one once. A failure never stops the rest of "ready". */
async function readyProfiles() {
  try {
    const { reload } = await profileGuard.exclusive(() =>
      applyInitialProfile({
        fresh: freshWorld,
        settings: platform.settings,
        user: platform.user,
        catalog: RULE_PROFILES,
        requiresReload: (key) => FEATURES.some((f) => (f.settings ?? []).some((s) => s.key === key && s.requiresReload)),
        isStored: platform.settings.isStored
      })
    );
    if (reload) platform.ui.reloadConfirm({ world: true }).catch((err) => platform.log.error("Failed to offer the reload", err));
  } catch (err) {
    platform.log.error("Failed to save the initial rule profile", err);
  }
  await profileGuard.check();
}

platform.hooks.once("ready", () => {
  readyProfiles();
  return runReady({ platform, status, features: PATCH_FEATURES, contextFor });
});
