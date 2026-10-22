/** Shared contract between the module's ItemT20#displayCard wrappers (arcane-armor-casting, casting-restrictions). */
export const CAST_OUTCOME_KEY = "t20-community-patches";

/** Marks the cast as failed on the options object every displayCard wrapper receives (born per use in ItemT20#roll). */
export function markCastFailed(options, { rule, reason, messageId = null } = {}) {
  if (!options || typeof options !== "object") return;
  options[CAST_OUTCOME_KEY] = { ...options[CAST_OUTCOME_KEY], castOutcome: { status: "failed", rule, reason, messageId } };
}

export function castFailed(options) {
  return options?.[CAST_OUTCOME_KEY]?.castOutcome?.status === "failed";
}

/**
 * Whether this displayCard call is a real use (ItemT20#roll): applyOnUseEffects always creates `options.effects`
 * (T20:6355-6356), and the sheet's "Mostrar no Chat" passes only `{ itemId }` (T20:13281). Read it before the original.
 */
export function isCastUse(options) {
  return Array.isArray(options?.effects);
}

/**
 * The only success predicate: the cast happened (the card ChatMessage, or the card data with createMessage: false)
 * and no rule marked it as failed. Spells without effects (options.effects = []) count.
 */
export function castCompleted(result, options) {
  return !castFailed(options) && result !== null && typeof result === "object";
}
