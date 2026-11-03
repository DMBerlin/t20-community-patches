import { FEATURES, GROUPS, PATCH_FEATURES } from "./features/index.mjs";
import { MODULE_ID } from "./utils.mjs";
import { wraps } from "./kernel/wrap.mjs";
import { validateFeatures } from "./kernel/feature.mjs";
import { bootFeatures, describeDiagnosis as describe } from "./kernel/lifecycle.mjs";
import { registerFeatureSetting } from "./kernel/settings.mjs";
import {
  APPLY_STATES,
  applyLateDiagnosis,
  createLateSummary,
  pickLateNotification,
  pickNotification,
  statusRecord,
  summarizeNotifications,
  summaryMessage
} from "./registry.mjs";
import { SETTINGS, getPatchMode, migrateLegacySettings, registerSettings } from "./settings.mjs";
import { listDivergences, listPending, openRewards, resumeRewards } from "./rules/encounter-xp.mjs";

/**
 * Patches and rules, in install order (scripts/kernel/lifecycle.mjs). Notifications and the Center only use patches.
 * @type {import("./kernel/lifecycle.mjs").StatusEntry[]}
 */
const status = [];

/** Status entries of the patches. */
const patchStatus = () => status.filter((s) => s.kind === "patch");

Hooks.once("init", () => {
  registerSettings(PATCH_FEATURES);
  validateFeatures(FEATURES, GROUPS);

  // Features are installed during "init": the system has already registered its classes in CONFIG, and world
  // documents are only prepared after this hook.
  status.push(
    ...bootFeatures({
      features: FEATURES,
      modeOf: (feature) => getPatchMode(feature.id),
      system: { id: game.system.id, version: game.system.version },
      contextFor: (feature) => ({
        id: feature.id,
        wrap: (target, method, wrapper, options) => wraps.wrap(target, method, feature.id, wrapper, options)
      }),
      registerSetting: (spec) => registerFeatureSetting((key, config) => game.settings.register(MODULE_ID, key, config), spec),
      log: {
        info: (message) => console.log(`${MODULE_ID} | ${message}`),
        error: (message, err) => console.error(`${MODULE_ID} | ${message}`, err)
      }
    })
  );

  game.modules.get(MODULE_ID).api = {
    status,
    groups: GROUPS,
    // Wrapper chains, owners from the innermost to the outermost: game.modules.get(MODULE_ID).api.wraps()
    wraps: wraps.list,
    rewards: { open: openRewards, pending: listPending, resume: resumeRewards, divergences: listDivergences }
  };
});

/** Waits this long after "ready" for the late diagnoses before summarizing them. */
const LATE_SUMMARY_DELAY = 10000;

/**
 * A notification entry for the summary, or null.
 * @param {import("./kernel/lifecycle.mjs").StatusEntry} entry
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
    const entry = patchStatus().find((s) => s.id === id);
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
      await migrateLegacySettings(PATCH_FEATURES);
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
  for (const entry of patchStatus()) {
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
  const probed = PATCH_FEATURES.filter(hasLateProbe);
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
 * @param {import("./kernel/feature.mjs").Feature} patch
 */
function hasLateProbe(patch) {
  const entry = status.find((s) => s.id === patch.id);
  return typeof patch.lateProbe === "function" && !!entry && APPLY_STATES.has(entry.state);
}

/**
 * Runs an applied patch's lateProbe without blocking "ready", then updates its status and hands any news to the late
 * summary. The summary is always settled, even when the probe fails or learns nothing.
 * @param {import("./kernel/feature.mjs").Feature} patch
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
