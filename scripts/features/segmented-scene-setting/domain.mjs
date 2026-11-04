export const SETTING_NAMESPACE = "tormenta20";
export const SETTING_KEY = "segmentedScene";
export const MENU_KEY = "t20cpSegmentedScene";
export const LIMIT_KEY = "segmentedSceneMaxSegments";
export const DEFAULT_LIMIT = 10;

/**
 * Normalizes the submitted Segmented Scene values.
 * max <= 0, empty or invalid → rule disabled ({value: null, max: null}, the system default).
 * value is an integer clamped to [0, max].
 * @param {{max?: unknown, value?: unknown}} [data]
 * @returns {{value: number|null, max: number|null}}
 */
export function normalizeSegmentedScene({ max, value } = {}) {
  const m = toInteger(max);
  if (m === null || m <= 0) return { value: null, max: null };
  const v = toInteger(value);
  return { value: v === null ? 0 : Math.min(Math.max(v, 0), m), max: m };
}

/**
 * Resolves the configured cap. Invalid or < 1 falls back to DEFAULT_LIMIT.
 * @param {unknown} raw
 * @returns {number}
 */
export function resolveLimit(raw) {
  const n = toInteger(raw);
  return n !== null && n >= 1 ? n : DEFAULT_LIMIT;
}

/**
 * Whether a (normalized or stored) Segmented Scene value has more segments than the cap.
 * @param {{max?: unknown}|null|undefined} scene
 * @param {number} limit
 * @returns {boolean}
 */
export function exceedsLimit(scene, limit) {
  const max = Number(scene?.max);
  return Number.isFinite(max) && max > limit;
}

function toInteger(raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether the registered setting still has the broken shape: shown in the settings window with a DataField type
 * that cannot be rendered as a form input.
 * @param {{config?: boolean, type?: unknown}|undefined} setting
 * @param {Function} DataField  DataField of the core data fields
 * @returns {boolean}
 */
export function needsFix(setting, DataField) {
  return !!setting?.config && setting.type instanceof DataField && !setting.type.constructor.hasFormSupport;
}
