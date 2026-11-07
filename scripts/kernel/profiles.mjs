/**
 * Profiles of the optional rules (#96): which ready-made profile the saved values match, what applying one changes and
 * the "custom first" write protocol. Pure: the profiles and the settings come in by parameter.
 *
 * Invariant: when `rulesProfile` is not "custom", every key of that profile holds exactly its value. The protocol keeps
 * it while writing, and the guard (rule-profile.mjs) restores it after changes made elsewhere.
 */

export const PROFILE_SETTING = "rulesProfile";
export const CUSTOM = "custom";

/**
 * @typedef {Record<string, Record<string, unknown>>} ProfileValues  Profile id → setting key → value.
 * @typedef {{values: ProfileValues, neutral: string, recommended: string,
 *   exclusive?: <T>(task: () => Promise<T>|T) => Promise<T>}} RuleProfiles
 *   exclusive: the guard's queue (rule-profile.mjs), so a save never interleaves with a check of this client.
 * @typedef {{key: string, value: unknown}} SettingWrite
 */

/**
 * The ids of the selector: the ready-made profiles, then "custom".
 * @param {ProfileValues} profiles
 */
export function profileIds(profiles) {
  return [...Object.keys(profiles), CUSTOM];
}

/**
 * Every setting key some profile sets.
 * @param {ProfileValues} profiles
 */
export function profileKeys(profiles) {
  return [...new Set(Object.values(profiles).flatMap((values) => Object.keys(values)))];
}

/**
 * Values of a profile, or null for "custom" and unknown ids.
 * @param {ProfileValues} profiles
 * @param {string} id
 */
export function profileValues(profiles, id) {
  return Object.hasOwn(profiles, id) ? profiles[id] : null;
}

/** Whether every key of a profile holds its value. */
function matches(profile, values) {
  return Object.entries(profile).every(([key, value]) => values[key] === value);
}

/**
 * The ready-made profile whose values all match, or null.
 * @param {ProfileValues} profiles
 * @param {Record<string, unknown>} values  Setting key → current value.
 */
export function matchingProfile(profiles, values) {
  return Object.keys(profiles).find((id) => matches(profiles[id], values)) ?? null;
}

/**
 * The profile to keep: `stored` while its values still match, "custom" otherwise. "custom" never becomes a ready-made
 * profile on its own.
 * @param {{stored: string, values: Record<string, unknown>, profiles: ProfileValues}} args
 */
export function resolveProfile({ stored, values, profiles }) {
  const profile = profileValues(profiles, stored);
  return profile && matches(profile, values) ? stored : CUSTOM;
}

/**
 * The keys a profile changes, from the given values.
 * @param {ProfileValues} profiles
 * @param {string} id
 * @param {Record<string, unknown>} values
 * @returns {{key: string, from: unknown, to: unknown}[]}
 */
export function profileDiff(profiles, id, values) {
  return Object.entries(profileValues(profiles, id) ?? {})
    .filter(([key, to]) => values[key] !== to)
    .map(([key, to]) => ({ key, from: values[key], to }));
}

/**
 * Current values of every profile key.
 * @param {(key: string) => unknown} get
 * @param {ProfileValues} profiles
 */
export function readProfileValues(get, profiles) {
  return Object.fromEntries(profileKeys(profiles).map((key) => [key, get(key)]));
}

/**
 * What saving a profile writes: for a ready-made profile, every key whose saved value differs from it (never only
 * what the form changed, so values written by someone else since the Center opened are restored too) plus the other
 * changes of the form; for "custom", the changes of the form.
 * @template {SettingWrite} T
 * @param {{profiles: ProfileValues, target: string, values: Record<string, unknown>, changes: T[]}} args
 *   values: the saved values; changes: what the form changed.
 * @returns {SettingWrite[]}
 */
export function profileWrites({ profiles, target, values, changes }) {
  const profile = profileValues(profiles, target);
  if (!profile) return changes;
  const own = new Set(Object.keys(profile));
  return [...changes.filter((c) => !own.has(c.key)), ...profileDiff(profiles, target, values).map(({ key, to }) => ({ key, value: to }))];
}

/**
 * The "custom first" protocol: (1) "custom", while some rule is written; (2) the rules; (3) the target profile, once
 * the values read back match it. A failure in (2) leaves "custom", which never claims anything.
 * @param {{settings: {get: (key: string) => unknown, set: (key: string, value: unknown) => Promise<unknown>},
 *   profiles: ProfileValues, target: string, writes: SettingWrite[], canWrite?: () => boolean}} args
 *   canWrite: checked right before each write; once false, nothing else is written.
 * @returns {Promise<string|null>} The saved profile, or null when canWrite stopped it.
 */
export async function saveProfile({ settings, profiles, target, writes, canWrite = () => true }) {
  const write = async (key, value) => {
    if (!canWrite()) return false;
    await settings.set(key, value);
    return true;
  };
  let current = settings.get(PROFILE_SETTING);
  if (writes.length && current !== CUSTOM) {
    if (!(await write(PROFILE_SETTING, CUSTOM))) return null;
    current = CUSTOM;
  }
  for (const { key, value } of writes) if (!(await write(key, value))) return null;
  const next = resolveProfile({ stored: target, values: readProfileValues(settings.get, profiles), profiles });
  if (next !== current && !(await write(PROFILE_SETTING, next))) return null;
  return next;
}

/**
 * The world setting that holds the profile. Hidden: the Center shows it as its own selector, not as a rule row.
 * @param {ProfileValues} profiles
 * @returns {import("./feature.mjs").SettingSpec}
 */
export function profileSettingSpec(profiles) {
  return {
    key: PROFILE_SETTING,
    name: "T20CP.Profiles.Label",
    hint: "T20CP.Profiles.Hint",
    scope: "world",
    type: String,
    choices: Object.fromEntries(profileIds(profiles).map((id) => [id, `T20CP.Profiles.${id}.Name`])),
    // "custom" claims nothing: an existing world keeps its values, and the Foundry returns this while nothing is saved.
    default: CUSTOM,
    center: false
  };
}
