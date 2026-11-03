/** Skill helpers shared by condition-skill-lists and non-proficiency-penalties. */

/**
 * Key attribute of a skill: the system's table (`CONFIG.T20.pericias[id].abl`) for the system's skills, so changing
 * their attribute on the sheet does not matter, and the attribute currently stored in the skill for custom skills,
 * which have no other definition.
 * @param {string} id
 * @param {{atributo?: string}} skill                  The actor's skill data.
 * @param {Record<string, {abl?: string}>} skillConfig
 * @returns {string|undefined}
 */
export function keyAbility(id, skill, skillConfig) {
  return Object.hasOwn(skillConfig ?? {}, id) ? skillConfig[id]?.abl : skill?.atributo;
}
