const RANGED = new Set(["arremesso", "disparo"]);

/**
 * An agile melee weapon that the system does not treat as light. Light weapons and thrown or fired weapons
 * already follow the system's rule, so they are left alone.
 * @param {{type?: string, system?: object}} item
 * @returns {boolean}
 */
export function isAgileMeleeWeapon(item) {
  const system = item?.system;
  if (item?.type !== "arma" || !system) return false;
  if (system.empunhadura === "leve" || RANGED.has(system.proposito)) return false;
  return !!system.propriedades?.agi;
}

/**
 * The attack attribute slot (`parts[1]` = [skill, attribute, ...]) with Dexterity, or null when the system would
 * not choose the attribute itself (no skill, or an explicit attribute).
 * @param {Array<Array<string>>} parts
 * @returns {Array<string>|null}
 */
export function attackPartWithDexterity(parts) {
  const slot = Array.isArray(parts) ? parts[1] : null;
  if (!Array.isArray(slot) || !slot[0] || slot[1]) return null;
  const next = [...slot];
  next[1] = "des";
  return next;
}

/**
 * Damage parts with the "Padrão" attribute (`padrao`) replaced by Dexterity, or null when there is none.
 * @param {Array<Array<string>>} parts
 * @returns {Array<Array<string>>|null}
 */
export function damagePartsWithDexterity(parts) {
  if (!Array.isArray(parts)) return null;
  let changed = false;
  const next = parts.map((part) => {
    if (!Array.isArray(part) || part[0] !== "padrao") return part;
    changed = true;
    return ["@des", ...part.slice(1)];
  });
  return changed ? next : null;
}

/**
 * A new `rolls` array where each damage roll with `padrao` is replaced by a view of it with Dexterity parts (the
 * other fields come from the original roll through the prototype). The original rolls are not changed. Null when
 * no roll changes.
 * @param {Array<object>} rolls
 * @returns {Array<object>|null}
 */
export function rollsWithDexterity(rolls) {
  if (!Array.isArray(rolls)) return null;
  let changed = false;
  const next = rolls.map((roll) => {
    if (roll?.type !== "dano") return roll;
    const parts = damagePartsWithDexterity(roll.parts);
    if (!parts) return roll;
    changed = true;
    return Object.create(roll, { parts: { value: parts, writable: true, enumerable: true, configurable: true } });
  });
  return changed ? next : null;
}

/**
 * The rolls a rollDamage call must see. `current` is `system.rolls` when the call starts; `outer` is the frame of
 * an enclosing call on the same item still in its synchronous start (or undefined). When `current` is the array
 * that call installed, the real rolls are `outer.base`. The call gets its Dexterity view of them when eligible,
 * or the real rolls otherwise.
 * @param {Array<object>} current
 * @param {{base: Array<object>, installed: Array<object>}|undefined} outer
 * @param {boolean} eligible
 * @returns {{base: Array<object>, rolls: Array<object>}}
 */
export function rollsForCall(current, outer, eligible) {
  const base = outer && outer.installed === current ? outer.base : current;
  const rolls = (eligible && rollsWithDexterity(base)) || base;
  return { base, rolls };
}
