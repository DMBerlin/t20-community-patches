/** Reads shared by the casting restrictions (#37): the modes and the powers of an actor. */

/**
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 * @param {string} key
 * @param {string[]} modes
 */
export function getMode(ctx, key, modes) {
  try {
    const mode = ctx.setting(key);
    return modes.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

/** Whether the actor has a power, by compendium source or by name. */
export function hasPower(ctx, actor, { source, name }) {
  for (const item of actor?.items ?? []) {
    if (item.type !== "poder") continue;
    const from = item._stats?.compendiumSource ?? ctx.platform.utils.getProperty(item, "flags.core.sourceId");
    if (from === source || item.name === name) return true;
  }
  return false;
}
