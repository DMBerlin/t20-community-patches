/**
 * Pure logic of the casting conditions (#37): conditions that prevent casting, the final execution of a use
 * (reaction or not) and the concentration test in a bad condition.
 */

export const CASTING_CONDITION_SETTING = "castingConditionRule";
export const CASTING_CONDITION_MODES = ["off", "warn", "block"];
export const CONCENTRATION_SETTING = "concentrationRule";
export const CONCENTRATION_MODES = ["off", "warn"];

/** No actions, reactions included (Inconsciente; Petrificado makes the character Inconsciente). */
export const NO_REACTION_STATUSES = ["inconsciente", "petrificado"];
/** No actions; reactions are still allowed (p. 233: "você pode reagir mesmo se não puder realizar ações"). */
export const NO_ACTION_STATUSES = ["atordoado", "pasmo", "surpreendido", "fascinado"];
/** Only purely mental actions: casting needs gestures and words, unless Magia Discreta. */
export const MENTAL_ONLY_STATUSES = ["paralisado"];
/** Bad conditions for casting: Caído (example on p. 170) and Surdo (p. 395). */
export const BAD_CONDITION_STATUSES = ["caido", "surdo"];
export const BAD_CONDITION_BASE_DC = 15;
export const SUBTLE_SPELL_SOURCE = "Compendium.tormenta20.poderes.Item.a7FEhf1T8KVwr0iA";
export const SUBTLE_SPELL_NAME = "Magia Discreta";

/**
 * Conditions that prevent casting.
 * @param {{statuses: Iterable<string>, activation?: string, subtleSpell?: boolean}} params
 * @returns {{block: string[], warn: string[]}} Status ids that block and that only warn.
 */
export function castingConditionVerdict({ statuses, activation, subtleSpell = false }) {
  const set = new Set(statuses ?? []);
  const block = [];
  const warn = [];
  for (const id of NO_REACTION_STATUSES) if (set.has(id)) block.push(id);
  if (activation !== "reaction") for (const id of NO_ACTION_STATUSES) if (set.has(id)) block.push(id);
  for (const id of MENTAL_ONLY_STATUSES) if (set.has(id)) (subtleSpell ? warn : block).push(id);
  return { block, warn };
}

const normalizeText = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/**
 * Whether an execution value is a reaction: the system key ("reaction") or an enhancement override as written in the
 * compendium ("reação", "reacao"), or the localized label.
 * @param {unknown} value
 * @param {string[]} [labels]
 */
export function isReactionExecution(value, labels = []) {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = normalizeText(value);
  return text === "reaction" || text === "reacao" || labels.some((l) => typeof l === "string" && l.trim() && normalizeText(l) === text);
}

/** The last `execucao` override of a usage effect (the system only applies overrides to it), or undefined. */
export function executionOverride(changes) {
  let value;
  for (const ch of changes ?? []) if (ch?.key === "execucao" && ch.type === "override") value = ch.value;
  return value;
}

/**
 * Whether the use ends up as a reaction, as applyOnUseEffects computes it: applied effects with an override change
 * first (stable), the last `execucao` override wins over the item's base execution.
 * @param {{base?: string, effects?: {id: string, changes?: object[]}[], applied?: Record<string, {aplica?: unknown}>,
 *   labels?: string[]}} params  `applied`: the expanded `aprs` of the dialog, or the automatic ones without it.
 */
export function finalReaction({ base, effects = [], applied = {}, labels = [] }) {
  const hasOverride = (e) => (e.changes ?? []).some((ch) => ch?.type === "override");
  const used = effects.filter((e) => applied?.[e.id]?.aplica);
  const ordered = [...used.filter(hasOverride), ...used.filter((e) => !hasOverride(e))];
  let value = base;
  for (const effect of ordered) {
    const override = executionOverride(effect.changes);
    if (override !== undefined) value = override;
  }
  return isReactionExecution(value, labels);
}

/** Whether the execution depends on the enhancements chosen: some reachable executions are reactions, others not. */
export function executionDependsOnChoice({ base, effects = [], labels = [] }) {
  const outcomes = new Set([isReactionExecution(base, labels)]);
  for (const effect of effects) {
    const override = executionOverride(effect.changes);
    if (override !== undefined) outcomes.add(isReactionExecution(override, labels));
  }
  return outcomes.size > 1;
}

/**
 * The condition check before ItemT20#roll. When the dialog opens and an enhancement can turn the spell into a reaction
 * (or a reaction into an action), only the conditions that stop every execution are checked here; the others are
 * checked when the dialog is submitted (`deferred`). Without the dialog, the automatic enhancements decide.
 * @param {{statuses: Iterable<string>, subtleSpell?: boolean, base?: string, effects?: object[], labels?: string[],
 *   dialog: boolean}} params
 * @returns {{block: string[], warn: string[], deferred: boolean}}
 */
export function preUseConditionVerdict({ statuses, subtleSpell = false, base, effects = [], labels = [], dialog }) {
  if (dialog && executionDependsOnChoice({ base, effects, labels })) {
    return { ...castingConditionVerdict({ statuses, activation: "reaction", subtleSpell }), deferred: true };
  }
  const applied = {};
  for (const effect of effects) if (effect.automatic) applied[effect.id] = { aplica: 1 };
  const reaction = finalReaction({ base, effects, applied, labels });
  return { ...castingConditionVerdict({ statuses, activation: reaction ? "reaction" : "action", subtleSpell }), deferred: false };
}

/**
 * The condition check when the dialog is submitted, only for uses whose execution depends on the enhancements: the
 * no-action conditions that the chosen execution does not allow (the others were reported before the dialog).
 * @returns {string[]} Status ids that stop this use.
 */
export function dialogConditionBlock({ statuses, base, effects = [], applied = {}, labels = [] }) {
  if (!executionDependsOnChoice({ base, effects, labels })) return [];
  if (finalReaction({ base, effects, applied, labels })) return [];
  const set = new Set(statuses ?? []);
  return NO_ACTION_STATUSES.filter((id) => set.has(id));
}

/**
 * Concentration test for a bad condition: Vontade DC 15 + PM spent.
 * @returns {{dc: number, reasons: string[]}|null}
 */
export function concentrationCheck({ statuses, manaCost }) {
  const set = new Set(statuses ?? []);
  const reasons = BAD_CONDITION_STATUSES.filter((id) => set.has(id));
  if (!reasons.length) return null;
  return { dc: BAD_CONDITION_BASE_DC + Math.max(Number(manaCost) || 0, 0), reasons };
}
