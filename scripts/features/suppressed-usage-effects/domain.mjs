/**
 * Whether a system function collects usage effects without looking at suppression.
 * @param {string} source
 * @returns {boolean}
 */
export function collectsIgnoringSuppression(source) {
  return source.includes("onuse") && !/suppress/i.test(source);
}

export const ROLL_METHODS = ["rollPericia", "rollAtributo"];
export const SOURCES = ["ItemT20#_allApplicableOnUseEffects", ...ROLL_METHODS.map((method) => `ActorT20#${method}`)];
