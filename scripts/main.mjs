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
import { registerFeatureSetting } from "./kernel/settings.mjs";
import { getPatchMode, registerPatchSettings } from "./kernel/patch-settings.mjs";
import { runReady } from "./kernel/ready.mjs";
import { listDivergences, listPending, openRewards, resumeRewards } from "./rules/encounter-xp.mjs";

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

/** One context per feature, shared by isNeeded, install and lateProbe. */
const contexts = new Map();
const contextFor = (feature) => {
  if (!contexts.has(feature.id)) {
    contexts.set(feature.id, createFeatureContext(platform, feature, { wraps, services, features }));
  }
  return contexts.get(feature.id);
};

platform.hooks.once("init", () => {
  registerPatchSettings(platform.settings, PATCH_FEATURES);
  registerManagerMenu(platform);
  validateFeatures(FEATURES, GROUPS, services.ids());

  // Features are installed during "init": the system has already registered its classes in CONFIG, and world
  // documents are only prepared after this hook.
  status.push(
    ...bootFeatures({
      features: FEATURES,
      modeOf: (feature) => getPatchMode(platform.settings, feature.id),
      system: platform.system,
      contextFor,
      registerSetting: (spec) => registerFeatureSetting(platform.settings.register, spec),
      services,
      log: platform.log
    })
  );

  platform.module.setApi({
    status,
    groups: GROUPS,
    // Wrapper chains, owners from the innermost to the outermost: game.modules.get(MODULE_ID).api.wraps()
    wraps: wraps.list,
    // Services and declared dependencies of each feature: game.modules.get(MODULE_ID).api.graph()
    graph: features.graph,
    rewards: { open: openRewards, pending: listPending, resume: resumeRewards, divergences: listDivergences }
  });
});

platform.hooks.once("ready", () => runReady({ platform, status, features: PATCH_FEATURES, contextFor }));
