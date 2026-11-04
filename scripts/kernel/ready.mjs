/**
 * The "ready" flow (#86, formerly in scripts/main.mjs): migration of the patch modes, the notifications of this load
 * and the late diagnoses. Pure: the platform, the status and the timers come in through parameters.
 */
import { describeDiagnosis } from "./lifecycle.mjs";
import { SETTINGS, migrateLegacySettings } from "./patch-settings.mjs";
import { APPLY_STATES, applyLateDiagnosis } from "./diagnosis.mjs";
import {
  createLateSummary,
  pickLateNotification,
  pickNotification,
  statusRecord,
  summarizeNotifications,
  summaryMessage
} from "./notifications.mjs";

/** Waits this long after "ready" for the late diagnoses before summarizing them. */
export const LATE_SUMMARY_DELAY = 10000;

/**
 * @typedef {object} ReadyDeps
 * @property {import("../platform/foundry.mjs").Platform} platform
 * @property {import("./lifecycle.mjs").StatusEntry[]} status     Entries of every feature; only patches are used.
 * @property {import("./feature.mjs").Feature[]} features          The patches.
 * @property {(feature: import("./feature.mjs").Feature) => import("./feature.mjs").FeatureContext} contextFor
 * @property {number} [delay]
 * @property {{set: (fn: () => void, ms: number) => unknown, clear: (handle: unknown) => void}} [timers]
 */

const defaultTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle) };

/** Runs a step on its own: a broken migration or setting must never hide the notifications. */
async function step(log, message, fn) {
  try {
    return await fn();
  } catch (err) {
    log.error(message, err);
    return undefined;
  }
}

/**
 * Notification helpers bound to one load.
 * @param {ReadyDeps} deps
 */
function createNotifier({ platform, status }) {
  const { i18n, system } = platform;
  const patchStatus = () => status.filter((s) => s.kind === "patch");

  /** A notification entry for the summary, or null. */
  const noteFor = (entry, notification) => {
    if (!notification) return null;
    return { id: entry.id, name: i18n.localize(`T20CP.Patches.${entry.id}.Name`), ...notification };
  };

  /** Shows one notification that summarizes several patches and marks them as changed in the Center. */
  const notify = (notes) => {
    const summary = summarizeNotifications(notes);
    if (!summary) return;
    for (const id of summary.ids) {
      const entry = patchStatus().find((s) => s.id === id);
      if (entry) entry.changed = true;
    }
    const message = summaryMessage(summary, `${system.title} ${system.version}`, (key, data) => i18n.format(key, data));
    platform.notify[summary.level](message, { permanent: summary.permanent });
  };

  const saveRecords = (records) =>
    step(platform.log, "Failed to save the patch status", async () => {
      const current = platform.settings.get(SETTINGS.lastStatus) ?? {};
      await platform.settings.set(SETTINGS.lastStatus, { ...current, ...records });
    });

  return { patchStatus, noteFor, notify, saveRecords };
}

/** Records and notifications of this load, against the records saved by the previous one. */
function initialNotes(deps, notifier, previous) {
  const { platform } = deps;
  const records = {};
  const notes = [];
  for (const entry of notifier.patchStatus()) {
    const record = statusRecord(entry, platform.system.version);
    records[entry.id] = record;
    try {
      notes.push(notifier.noteFor(entry, pickNotification(record, previous[entry.id])));
    } catch (err) {
      platform.log.error(`Failed to pick the notification for ${entry.id}`, err);
    }
  }
  return { records, notes };
}

/**
 * Runs an applied patch's lateProbe without blocking "ready", then updates its status and hands any news to the late
 * summary. The summary is always settled, even when the probe fails or learns nothing.
 */
function runLateProbe({ deps, notifier, patch, initial, previous, summary }) {
  const { platform, status, contextFor } = deps;
  const entry = status.find((s) => s.id === patch.id);
  let note = null;
  Promise.resolve()
    .then(() => patch.lateProbe(contextFor(patch)))
    .then(async (late) => {
      if (late === undefined || late === null) return;
      const { system } = platform;
      const next = applyLateDiagnosis(
        { patch, mode: entry.mode, state: entry.state, systemId: system.id, systemVersion: system.version },
        late
      );
      Object.assign(entry, next);
      platform.log.info(`Late diagnosis: ${patch.id} (${entry.state}${describeDiagnosis(entry.diagnosis)})`);
      const record = statusRecord(entry, system.version);
      note = notifier.noteFor(entry, pickLateNotification(record, initial, previous));
      await notifier.saveRecords({ [patch.id]: record });
    })
    .catch((err) => platform.log.error(`Late diagnosis failed: ${patch.id}`, err))
    .finally(() => summary.settle(note));
}

/** Whether a patch has a lateProbe to run on this load (only applied patches run it). */
function hasLateProbe(status, patch) {
  const entry = status.find((s) => s.id === patch.id);
  return typeof patch.lateProbe === "function" && !!entry && APPLY_STATES.has(entry.state);
}

/**
 * The "ready" flow. Only GMs see notifications; only the active GM migrates the patch modes.
 * @param {ReadyDeps} deps
 */
export async function runReady(deps) {
  const { platform, status, features, delay = LATE_SUMMARY_DELAY, timers = defaultTimers } = deps;
  const { user, log, settings } = platform;
  if (!user.isGM()) return;
  if (user.isActiveGM()) {
    await step(log, "Failed to migrate patch preferences", () => migrateLegacySettings(settings, features, log));
  }
  const previous =
    (await step(log, "Failed to read the last patch status", () => settings.get(SETTINGS.lastStatus))) ?? {};
  const notifier = createNotifier(deps);
  const { records, notes } = initialNotes(deps, notifier, previous);
  await step(log, "Failed to notify about the patches", () => notifier.notify(notes));
  await notifier.saveRecords(records);
  const probed = features.filter((patch) => hasLateProbe(status, patch));
  const summary = createLateSummary({
    pending: probed.length,
    emit: (batch) => {
      try {
        notifier.notify(batch);
      } catch (err) {
        log.error("Failed to notify about the late diagnoses", err);
      }
    },
    setTimer: timers.set,
    clearTimer: timers.clear,
    delay
  });
  for (const patch of probed) {
    runLateProbe({ deps, notifier, patch, initial: records[patch.id], previous: previous[patch.id], summary });
  }
}
