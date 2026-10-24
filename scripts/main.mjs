import { GROUPS, PATCHES } from "./patches/index.mjs";
import { MODULE_ID } from "./utils.mjs";
import {
  APPLY_STATES,
  applyLateDiagnosis,
  createLateSummary,
  pickLateNotification,
  pickNotification,
  resolvePatchState,
  statusRecord,
  summarizeNotifications,
  summaryMessage
} from "./registry.mjs";
import { SETTINGS, getPatchMode, migrateLegacySettings, registerSettings } from "./settings.mjs";
import { installManaLimitRule, registerManaLimitSetting } from "./rules/mana-limit.mjs";
import { installUsageEffectMaxRule, registerUsageEffectMaxSetting } from "./rules/usage-effect-max.mjs";
import { installSameAbilityRule, registerSameAbilitySetting } from "./rules/same-ability-stacking.mjs";
import { installSourceStackingRule, registerSourceStackingSetting } from "./rules/source-stacking.mjs";
import { installItemEffectiveStatsRule, registerItemEffectiveStatsSetting } from "./rules/item-effective-stats.mjs";
import { installCastingRestrictionsRule, registerCastingRestrictionsSettings } from "./rules/casting-restrictions.mjs";
import { installNonProficiencyRule, registerNonProficiencySetting } from "./rules/non-proficiency-penalties.mjs";
import { installSaveButtonRule, registerSaveButtonSetting } from "./rules/save-button.mjs";
import { installAttackVsDefenseRule, registerAttackVsDefenseSetting } from "./rules/attack-vs-defense.mjs";
import { installTrainedOnlyRule, registerTrainedOnlySetting } from "./rules/trained-only-skills.mjs";
import { installManaQueue } from "./rules/mana-queue.mjs";

/**
 * @type {{id: string, group: string, mode: import("./registry.mjs").PatchMode, state: import("./registry.mjs").PatchState,
 *   diagnosis?: import("./registry.mjs").Diagnosis, reason?: string, changed?: boolean}[]}
 * `changed` marks the patches cited in a notification on this load.
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
  registerSourceStackingSetting();
  registerItemEffectiveStatsSetting();
  registerCastingRestrictionsSettings();
  registerNonProficiencySetting();
  registerSaveButtonSetting();
  registerAttackVsDefenseSetting();
  registerTrainedOnlySetting();
  if (game.system.id === "tormenta20") {
    // Transparent (only orders each actor's spendMana calls) and installed with every rule off.
    try {
      installManaQueue();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the mana queue`, err);
    }
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
    try {
      installSourceStackingRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the item and spell stacking rule`, err);
    }
    try {
      installNonProficiencyRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the non-proficiency penalties rule`, err);
    }
    // Before casting-restrictions: its ItemT20#roll wrapper clones the item before calling the next one, so the shared
    // use-target wrappers (scripts/rules/shared/targets.mjs) must sit inside it to bind the system's clone.
    try {
      installSaveButtonRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the save button rule`, err);
    }
    // Also before casting-restrictions, for the same reason (it may be the first to call installUseTargets).
    try {
      installAttackVsDefenseRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the attack versus Defense rule`, err);
    }
    // After the other ItemT20#roll/displayCard wrappers (usage-effect-max): a blocked use never reaches them.
    try {
      installCastingRestrictionsRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the casting restrictions rule`, err);
    }
    // After usage-effect-max and the patches that wrap rollPericia: a blocked test never reaches them.
    try {
      installTrainedOnlyRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the trained-only skills rule`, err);
    }
    // Last on purpose: its wrappers must sit outside those of the patches and the other rules.
    try {
      installItemEffectiveStatsRule();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to install the effective item values rule`, err);
    }
  }

  game.modules.get(MODULE_ID).api = { status, groups: GROUPS };
});

/** Waits this long after "ready" for the late diagnoses before summarizing them. */
const LATE_SUMMARY_DELAY = 10000;

/**
 * A notification entry for the summary, or null.
 * @param {(typeof status)[number]} entry
 * @param {{key: string, level: "info"|"warn"|"error"} | null} notification
 */
function noteFor(entry, notification) {
  if (!notification) return null;
  return { id: entry.id, name: game.i18n.localize(`T20CP.Patches.${entry.id}.Name`), ...notification };
}

/**
 * Shows one notification that summarizes several patches and marks them as changed in the Center.
 * @param {ReturnType<typeof noteFor>[]} notes
 */
function notify(notes) {
  const summary = summarizeNotifications(notes);
  if (!summary) return;
  for (const id of summary.ids) {
    const entry = status.find((s) => s.id === id);
    if (entry) entry.changed = true;
  }
  const message = summaryMessage(summary, `${game.system.title} ${game.system.version}`, (key, data) =>
    game.i18n.format(key, data)
  );
  ui.notifications[summary.level](message, { permanent: summary.permanent });
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
  const notes = [];
  for (const entry of status) {
    const record = statusRecord(entry, game.system.version);
    records[entry.id] = record;
    try {
      notes.push(noteFor(entry, pickNotification(record, previous[entry.id])));
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to pick the notification for ${entry.id}`, err);
    }
  }
  try {
    notify(notes);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to notify about the patches`, err);
  }
  await saveRecords(records);
  const probed = PATCHES.filter(hasLateProbe);
  const late = createLateSummary({
    pending: probed.length,
    emit: (batch) => {
      try {
        notify(batch);
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to notify about the late diagnoses`, err);
      }
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    delay: LATE_SUMMARY_DELAY
  });
  for (const patch of probed) runLateProbe(patch, records[patch.id], previous[patch.id], late);
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
 * Whether a patch has a lateProbe to run on this load (only applied patches run it).
 * @param {import("./patches/index.mjs").Patch} patch
 */
function hasLateProbe(patch) {
  const entry = status.find((s) => s.id === patch.id);
  return typeof patch.lateProbe === "function" && !!entry && APPLY_STATES.has(entry.state);
}

/**
 * Runs an applied patch's lateProbe without blocking "ready", then updates its status and hands any news to the late
 * summary. The summary is always settled, even when the probe fails or learns nothing.
 * @param {import("./patches/index.mjs").Patch} patch
 * @param {import("./registry.mjs").StatusRecord} [initial]  Record saved on "ready" for this load.
 * @param {unknown} [previous]                                 Record saved by the previous load.
 * @param {{settle: (entry?: object|null) => void}} summary
 */
function runLateProbe(patch, initial, previous, summary) {
  const entry = status.find((s) => s.id === patch.id);
  let note = null;
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
      note = noteFor(entry, pickLateNotification(record, initial, previous));
      await saveRecords({ [patch.id]: record });
    })
    .catch((err) => console.error(`${MODULE_ID} | Late diagnosis failed: ${patch.id}`, err))
    .finally(() => summary.settle(note));
}
