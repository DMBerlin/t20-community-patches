/** Pure logic of the same-ability-stacking rule: ability identity, magnitude, the stacking decision and reconciliation. */

export const SAME_ABILITY_SETTING = "sameAbilityStackingRule";
export const SAME_ABILITY_FLAG = "ability";
export const SAME_ABILITY_MODES = ["off", "replace", "highest"];

/**
 * Identity of an ability effect: the same for every actor that has the ability.
 * @param {{compendiumSource?: string|null, itemName?: string, effectName?: string, slugify?: (s: string) => string}} p
 * @returns {string}  Empty when there is not enough data.
 */
export function abilityIdentity({ compendiumSource, itemName, effectName, slugify = (s) => s }) {
  const effect = String(effectName ?? "").trim();
  if (!effect) return "";
  if (compendiumSource) return `${compendiumSource}#${effect}`;
  const name = String(itemName ?? "").trim();
  if (!name) return "";
  return `Item:${slugify(name)}#${effect}`;
}

/**
 * @template T
 * @param {T[]} existing
 * @param {string} identity
 * @param {(entry: T) => unknown} identityOf
 * @returns {T[]}
 */
export function findSameAbility(existing, identity, identityOf = (e) => e?.identity) {
  if (!identity) return [];
  return (existing ?? []).filter((entry) => identityOf(entry) === identity);
}

/** Numeric value of a change, or NaN. Blank values are not numbers. */
function numeric(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Number(value);
}

/**
 * Magnitude of an effect: the sum of the numeric values of its changes (keys starting with "@" are roll data, not
 * bonuses). Any other non-numeric value (a die, a formula, a flag) makes the effect incomparable (NaN). A single
 * number per effect keeps the comparison transitive, so concurrent reconciliations agree on the greatest effect.
 * @param {{key: string, value: unknown}[]} changes
 * @returns {number}
 */
export function magnitudeScore(changes) {
  let total = 0;
  for (const change of changes ?? []) {
    const key = change?.key;
    if (typeof key !== "string" || !key || key.startsWith("@")) continue;
    total += numeric(change.value);
  }
  return total;
}

/**
 * Compares two effects by magnitude (see magnitudeScore). An incomparable effect, or equal magnitudes, is a tie.
 * @param {{key: string, value: unknown}[]} changesA
 * @param {{key: string, value: unknown}[]} changesB
 * @returns {-1|0|1}
 */
export function compareMagnitude(changesA, changesB) {
  const a = magnitudeScore(changesA);
  const b = magnitudeScore(changesB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * @param {string} policy  One of SAME_ABILITY_MODES.
 * @param {{previous: boolean, comparison?: number|null}} state  Whether the target has an effect of the same ability
 *   and, for "highest", the comparison of the new effect against the greatest active one (null = none active).
 * @returns {"allow"|"replace"|"refuse"}
 */
export function decideStacking(policy, { previous, comparison = null } = {}) {
  if (!previous || !SAME_ABILITY_MODES.includes(policy) || policy === "off") return "allow";
  if (policy === "highest" && comparison !== null && comparison <= 0) return "refuse";
  return "replace";
}

/**
 * Reconciles the effects of one ability on one actor after an effect was created, so concurrent applications
 * (double clicks, several users) converge to one survivor whatever each client saw. Every reconciliation uses the
 * same total order (server creation time, then id) and a survivor rule that never changes when more effects are
 * seen: the last one ("replace") or the first of the greatest active ones by magnitudeScore ("highest"). The creator of the new
 * effect deletes everything but the survivor of its own view; the global survivor is never deleted, because no
 * view can contain a greater one, and every other effect is deleted by its own creator or by a later one.
 * @param {string} policy
 * @param {string} selfId  The effect just created by this user.
 * @param {{id: string, createdTime?: number, disabled?: boolean, changes?: object[]}[]} entries  Every effect of the
 *   ability on the actor, including the new one.
 * @returns {{remove: string[], selfRemoved: boolean}}
 */
export function planReconcile(policy, selfId, entries) {
  const none = { remove: [], selfRemoved: false };
  const time = (e) => Number(e.createdTime) || 0;
  const sorted = [...(entries ?? [])].sort((a, b) => {
    if (time(a) !== time(b)) return time(a) - time(b);
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  const self = sorted.find((e) => e.id === selfId);
  if (!self || sorted.length < 2 || policy === "off" || !SAME_ABILITY_MODES.includes(policy)) return none;
  let survivor = sorted.at(-1);
  if (policy === "highest") {
    // Rank: active before disabled, then magnitude (incomparable lowest), then the total order. A strict total order,
    // so the survivor of any view is the greatest effect it contains.
    const rank = (e) => (e.disabled ? -Infinity : Number.isFinite(magnitudeScore(e.changes)) ? magnitudeScore(e.changes) : -Number.MAX_VALUE);
    survivor = sorted[0];
    for (const entry of sorted) if (rank(entry) > rank(survivor)) survivor = entry;
  }
  return { remove: sorted.filter((e) => e !== survivor).map((e) => e.id), selfRemoved: survivor !== self };
}

/**
 * Id of the "Sustentando" marker a sustained card effect points to (`<actor uuid>.ActiveEffect.<id>`, T20:6635).
 * @param {unknown} origin
 * @returns {{casterUuid: string, markerId: string}|null}
 */
export function sustainMarker(origin) {
  if (typeof origin !== "string") return null;
  const [casterUuid, markerId, ...rest] = origin.split(".ActiveEffect.");
  if (!casterUuid || !markerId || rest.length) return null;
  return { casterUuid, markerId };
}
