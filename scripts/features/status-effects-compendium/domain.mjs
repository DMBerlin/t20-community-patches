export const STATUS_PACK = "world.statuses";
export const SOURCE_PACK = "tormenta20.efeitos";
export const CONDITION_FOLDER = "STATUSEFFECTS000";

/**
 * Picks the condition sources from the system pack data (results of `toObject()`).
 * Conditions are the effects with statuses inside the "Condições" folder; if that folder is not found,
 * every effect with statuses is used. Copies go to the pack root.
 * @param {object[]} sources
 * @returns {object[]}
 */
export function selectConditionSources(sources) {
  const withStatuses = sources.filter((s) => (s?.statuses?.length ?? 0) > 0);
  const inFolder = withStatuses.filter((s) => s.folder === CONDITION_FOLDER);
  return (inFolder.length ? inFolder : withStatuses).map((s) => ({ ...s, folder: null }));
}

/**
 * Only the system's empty copy into an empty `world.statuses`, made by the active GM, is replaced.
 * @param {unknown} data
 * @param {object} operation
 * @param {{indexSize: number, isActiveGM: boolean}} state
 * @returns {boolean}
 */
export function shouldSubstitute(data, operation, { indexSize, isActiveGM }) {
  return (
    isActiveGM === true &&
    operation?.pack === STATUS_PACK &&
    Array.isArray(data) &&
    data.length === 0 &&
    indexSize === 0
  );
}

/**
 * Whether a client should rebuild CONFIG.statusEffects after a compendium update.
 * The client that wrote the documents runs the system's routine itself.
 * @param {{collection: string, userId: string, currentUserId: string, hasUnconscious: boolean}} state
 * @returns {boolean}
 */
export function shouldRebuild({ collection, userId, currentUserId, hasUnconscious }) {
  return collection === STATUS_PACK && userId !== currentUserId && !hasUnconscious;
}
