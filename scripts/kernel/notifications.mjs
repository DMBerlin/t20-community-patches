/** Notifications of the patch states shown to the GM on "ready" (#89, split from scripts/registry.mjs). Pure. */

import { APPLY_STATES, displayState } from "./diagnosis.mjs";

/** @typedef {import("./diagnosis.mjs").PatchState} PatchState */
/** @typedef {import("./diagnosis.mjs").Diagnosis} Diagnosis */

/**
 * @typedef {object} StatusRecord   What each GM saw on the previous load (`lastStatus[id]`).
 * @property {string} state         Display state (see displayState).
 * @property {"present"|"fixed"|"unknown"} [bug]
 * @property {"high"|"low"} [confidence]
 * @property {string} [systemVersion]
 */

/** Display states that are worth a notification when they appear. */
const ATTENTION = new Set([
  "fixed",
  "disabled-fixed",
  "suspected-fixed",
  "unverified",
  "applied-unverified",
  "applied-guarded",
  "incompatible"
]);
const FIXED_STATES = new Set(["fixed", "disabled-fixed"]);

/**
 * Reads a `lastStatus` entry. Earlier versions stored only the state string.
 * @param {unknown} value
 * @returns {StatusRecord|undefined}
 */
export function readStatusRecord(value) {
  if (typeof value === "string") return { state: value };
  if (value && typeof value === "object" && typeof value.state === "string") return /** @type {StatusRecord} */ (value);
  return undefined;
}

/**
 * Builds the `lastStatus` entry for a patch on this load.
 * @param {{state: PatchState, diagnosis?: Diagnosis}} entry
 * @param {string} systemVersion
 * @returns {StatusRecord}
 */
export function statusRecord({ state, diagnosis }, systemVersion) {
  const record = { state: displayState(state, diagnosis), systemVersion };
  if (diagnosis) Object.assign(record, { bug: diagnosis.bug, confidence: diagnosis.confidence });
  return record;
}

/**
 * Which notification, if any, the GM gets for a patch, given what they saw on the previous load.
 * - errors always;
 * - "regression" when a patch seen as fixed is applied again because the bug was detected;
 * - states that need attention, when they change or reappear on another system version.
 * A system fix (fixed, disabled-fixed) is informative; everything else is a warning.
 * @param {StatusRecord} current
 * @param {unknown} previous  Raw `lastStatus[id]`.
 * @returns {{key: string, level: "info"|"warn"|"error"}|null}
 */
export function pickNotification(current, previous) {
  if (current.state === "error") return { key: "error", level: "error" };
  const last = readStatusRecord(previous);
  if (last && FIXED_STATES.has(last.state) && current.bug === "present" && APPLY_STATES.has(current.state)) {
    return { key: "regression", level: "warn" };
  }
  if (!ATTENTION.has(current.state)) return null;
  const sameVersion = !last?.systemVersion || last.systemVersion === current.systemVersion;
  if (last?.state === current.state && sameVersion) return null;
  // A late probe may have confirmed the bug on an earlier load; going back to "guarded" is not news.
  if (current.state === "applied-guarded" && last?.state === "applied-unverified" && sameVersion) return null;
  return { key: current.state, level: FIXED_STATES.has(current.state) ? "info" : "warn" };
}

/**
 * Notification for a late diagnosis. It is compared with the previous load, so a regression is still reported and
 * a result already known is not repeated, and with this load's initial record, so nothing is shown twice.
 * @param {StatusRecord} late
 * @param {StatusRecord} initial   Record notified on "ready" in this load.
 * @param {unknown} previous       Record saved by the previous load.
 * @returns {{key: string, level: "info"|"warn"|"error"}|null}
 */
export function pickLateNotification(late, initial, previous) {
  const next = pickNotification(late, previous);
  if (!next || next.key === pickNotification(initial, previous)?.key) return null;
  if (next.key === "regression") return next;
  return pickNotification(late, initial) ? next : null;
}

/** Summary sections, in display order, and the notification keys of pickNotification each one gathers. */
export const NOTIFICATION_SECTIONS = [
  ["error", ["error"]],
  ["regression", ["regression"]],
  ["fixed", ["fixed", "disabled-fixed"]],
  ["suspected-fixed", ["suspected-fixed"]],
  ["unverified", ["unverified"]],
  ["unverified-applied", ["applied-unverified", "applied-guarded"]],
  ["incompatible", ["incompatible"]]
];
const SECTION_OF = new Map(NOTIFICATION_SECTIONS.flatMap(([section, keys]) => keys.map((k) => [k, section])));
const LEVELS = ["info", "warn", "error"];
const PERMANENT_KEYS = new Set(["error", "regression"]);

/**
 * @typedef {object} NotificationSummary
 * @property {"info"|"warn"|"error"} level   The most severe level among the entries.
 * @property {boolean} permanent              Only errors and regressions stay until dismissed.
 * @property {{section: string, names: string[], more: number}[]} sections
 * @property {string[]} ids                   Patches cited in the summary.
 */

/**
 * Joins the notifications picked for several patches into one summary.
 * @param {{id: string, name: string, key: string, level: "info"|"warn"|"error"}[]} entries
 * @param {number} [maxNames=3]  Names listed per section; the rest is counted.
 * @returns {NotificationSummary|null}  null when there is nothing to notify.
 */
export function summarizeNotifications(entries, maxNames = 3) {
  const valid = (entries ?? []).filter((e) => e && SECTION_OF.has(e.key));
  if (!valid.length) return null;
  const sections = [];
  for (const [section] of NOTIFICATION_SECTIONS) {
    const names = valid.filter((e) => SECTION_OF.get(e.key) === section).map((e) => e.name);
    if (names.length) sections.push({ section, names: names.slice(0, maxNames), more: Math.max(0, names.length - maxNames) });
  }
  const level = LEVELS[Math.max(...valid.map((e) => Math.max(0, LEVELS.indexOf(e.level))))];
  return {
    level: /** @type {"info"|"warn"|"error"} */ (level),
    permanent: valid.some((e) => PERMANENT_KEYS.has(e.key)),
    sections,
    ids: valid.map((e) => e.id)
  };
}

/**
 * Text of a summary. `t(key, data)` is the localization function (game.i18n.format).
 * @param {NotificationSummary} summary
 * @param {string} system  For example "Tormenta20 1.6.5".
 * @param {(key: string, data?: object) => string} t
 * @returns {string}
 */
export function summaryMessage(summary, system, t) {
  const separator = t("T20CP.Notifications.Separator");
  const sections = summary.sections.map(({ section, names, more }) => {
    const list = names.join(", ");
    const shown = more ? t("T20CP.Notifications.More", { names: list, count: more }) : list;
    return t(`T20CP.Notifications.Sections.${section}`, { names: shown });
  });
  return t("T20CP.Notifications.Summary", { system, sections: sections.join(separator) });
}

/**
 * Gathers late diagnoses (lateProbe) into one summary, emitted when every pending probe settles or after `delay`,
 * whichever comes first. A result settled after that is emitted on its own.
 * @param {object} args
 * @param {number} args.pending                                   Probes that will settle.
 * @param {(entries: object[]) => void} args.emit                 Receives a non-empty batch of notification entries.
 * @param {(fn: () => void, ms: number) => unknown} args.setTimer
 * @param {(handle: unknown) => void} [args.clearTimer]
 * @param {number} [args.delay=10000]
 * @returns {{settle: (entry?: object|null) => void}}
 */
export function createLateSummary({ pending, emit, setTimer, clearTimer = () => {}, delay = 10000 }) {
  let open = pending > 0;
  let remaining = pending;
  const batch = [];
  let timer = null;
  const flush = () => {
    if (!open) return;
    open = false;
    if (timer !== null) clearTimer(timer);
    if (batch.length) emit(batch.splice(0));
  };
  if (open) timer = setTimer(flush, delay);
  return {
    settle(entry) {
      if (entry) {
        if (open) batch.push(entry);
        else emit([entry]);
      }
      remaining--;
      if (remaining <= 0) flush();
    }
  };
}
