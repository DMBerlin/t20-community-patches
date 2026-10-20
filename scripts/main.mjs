import { GROUPS, PATCHES } from "./patches/index.mjs";
import { MODULE_ID } from "./utils.mjs";
import {
  APPLY_STATES,
  applyLateDiagnosis,
  pickLateNotification,
  pickNotification,
  resolvePatchState,
  statusRecord
} from "./registry.mjs";
import { SETTINGS, getPatchMode, migrateLegacySettings, registerSettings } from "./settings.mjs";
import { installManaLimitRule, registerManaLimitSetting } from "./rules/mana-limit.mjs";
import { installUsageEffectMaxRule, registerUsageEffectMaxSetting } from "./rules/usage-effect-max.mjs";
import { installSameAbilityRule, registerSameAbilitySetting } from "./rules/same-ability-stacking.mjs";

/**
 * @type {{id: string, group: string, mode: import("./registry.mjs").PatchMode, state: import("./registry.mjs").PatchState,
 *   diagnosis?: import("./registry.mjs").Diagnosis, reason?: string}[]}
 */
const status = [];

/** @param {import("./registry.mjs").Diagnosis|undefined} diagnosis */
function describe(diagnosis) {
  if (!diagnosis) return "";
  return `; bug ${diagnosis.bug}/${diagnosis.confidence}${diagnosis.evidence ? `: ${diagnosis.evidence}` : ""}`;
}

Hooks.once("init", () => {
  registerSettings(PATCHES);

  // Patches are installed during "init": the system has already registered its classes in CONFIG,
  // and world documents are only prepared after this hook.
  for (const patch of PATCHES) {
    const mode = getPatchMode(patch.id);
    let { state, diagnosis, reason } = resolvePatchState({
      patch,
      mode,
      systemId: game.system.id,
      systemVersion: game.system.version,
      probe: patch.isNeeded
    });

    if (APPLY_STATES.has(state)) {
      try {
        patch.apply();
        console.log(`${MODULE_ID} | Patch applied: ${patch.id} (${state}${describe(diagnosis)})`);
      } catch (err) {
        state = "error";
        reason = err.message;
        console.error(`${MODULE_ID} | Failed to apply patch: ${patch.id}`, err);
      }
    } else {
      console.log(`${MODULE_ID} | Patch not applied: ${patch.id} (${state}${reason ? `: ${reason}` : ""}${describe(diagnosis)})`);
    }
    status.push({ id: patch.id, group: patch.group, mode, state, diagnosis, reason });
  }

  // Optional rules are not bug fixes: they stay installed and read their own setting on every use.
  registerManaLimitSetting();
  registerUsageEffectMaxSetting();
  registerSameAbilitySetting();
  if (game.system.id === "tormenta20") {
    try {
      installManaLimitRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the mana limit rule`, err);
    }
    try {
      installUsageEffectMaxRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the usage effect maximum rule`, err);
    }
    try {
      installSameAbilityRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the same ability stacking rule`, err);
    }
  }

  game.modules.get(MODULE_ID).api = { status, groups: GROUPS };
});

/**
 * Shows the notification picked for a patch, if any.
 * @param {(typeof status)[number]} entry
 * @param {{key: string, level: "info"|"warn"|"error"} | null} notification
 */
function notify(entry, notification) {
  if (!notification) return;
  const name = game.i18n.localize(`T20CP.Patches.${entry.id}.Name`);
  const message = game.i18n.format(`T20CP.Notifications.${notification.key}`, { name, reason: entry.reason ?? "" });
  ui.notifications[notification.level](message, { permanent: true });
}

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  // Each step fails on its own: a broken migration or setting must never hide the notifications.
  if (game.user.isActiveGM) {
    try {
      await migrateLegacySettings(PATCHES);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to migrate patch preferences`, err);
    }
  }
  let previous = {};
  try {
    previous = game.settings.get(MODULE_ID, SETTINGS.lastStatus) ?? {};
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to read the last patch status`, err);
  }
  const records = {};
  for (const entry of status) {
    const record = statusRecord(entry, game.system.version);
    records[entry.id] = record;
    try {
      notify(entry, pickNotification(record, previous[entry.id]));
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to notify about ${entry.id}`, err);
    }
  }
  await saveRecords(records);
  for (const patch of PATCHES) runLateProbe(patch, records[patch.id], previous[patch.id]);
});

/** @param {Record<string, import("./registry.mjs").StatusRecord>} records */
async function saveRecords(records) {
  try {
    const current = game.settings.get(MODULE_ID, SETTINGS.lastStatus) ?? {};
    await game.settings.set(MODULE_ID, SETTINGS.lastStatus, { ...current, ...records });
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to save the patch status`, err);
  }
}

/**
 * Runs an applied patch's lateProbe without blocking "ready", then updates its status and notifies about news.
 * @param {import("./patches/index.mjs").Patch} patch
 * @param {import("./registry.mjs").StatusRecord} [initial]  Record saved on "ready" for this load.
 * @param {unknown} [previous]                                 Record saved by the previous load.
 */
function runLateProbe(patch, initial, previous) {
  const entry = status.find((s) => s.id === patch.id);
  if (typeof patch.lateProbe !== "function" || !entry || !APPLY_STATES.has(entry.state)) return;
  Promise.resolve()
    .then(() => patch.lateProbe())
    .then(async (late) => {
      if (late === undefined || late === null) return;
      const next = applyLateDiagnosis(
        { patch, mode: entry.mode, state: entry.state, systemId: game.system.id, systemVersion: game.system.version },
        late
      );
      Object.assign(entry, next);
      console.log(`${MODULE_ID} | Late diagnosis: ${patch.id} (${entry.state}${describe(entry.diagnosis)})`);
      const record = statusRecord(entry, game.system.version);
      notify(entry, pickLateNotification(record, initial, previous));
      await saveRecords({ [patch.id]: record });
    })
    .catch((err) => console.error(`${MODULE_ID} | Late diagnosis failed: ${patch.id}`, err));
}
