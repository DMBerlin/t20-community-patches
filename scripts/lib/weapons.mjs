/** Weapon properties shared by finesse-agile-weapons and default-damage-attribute. */

/**
 * Mirrors the system's `usarAcuidade` (T20:8172-8173 and T20:9136-9137).
 * @param {{optionalRule?: boolean, acuidade?: unknown, atributos?: object}} args
 * @returns {boolean}
 */
export function prefersDexterity({ optionalRule, acuidade, atributos }) {
  const des = atributos?.des?.value;
  const str = atributos?.for?.value;
  return !!(optionalRule || acuidade) && des > str;
}
