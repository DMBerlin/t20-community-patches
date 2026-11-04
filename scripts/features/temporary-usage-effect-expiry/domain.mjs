export const KEY = "isExpiryTrackable";

/**
 * @param {object} effect  ActiveEffect
 * @returns {boolean}
 */
export function isTrackableUsageEffect(effect) {
  return (
    Boolean(effect?.system?.onuse) &&
    effect.parent?.documentName === "Actor" && // never item templates
    Boolean(effect.persisted) &&
    !effect.inCompendium &&
    !effect.disabled && // manually disabled usage effects do not expire (core semantics)
    !effect.isSuppressed &&
    Boolean(effect.start) &&
    Boolean(effect.isTemporary)
  );
}

/**
 * Finds a property descriptor along the prototype chain.
 * @param {object} proto
 * @param {string} key
 * @returns {PropertyDescriptor|undefined}
 */
export function findDescriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/**
 * Asks the effect class whether an enabled temporary usage effect on an actor is expiry-trackable.
 * Only the eligibility inputs are stubbed; `active`, `isUsage` and the tracking getter run the real code.
 * @param {object} proto                 ActiveEffect document class prototype.
 * @param {() => boolean} trackableGet   The isExpiryTrackable getter to evaluate.
 * @returns {boolean|undefined}          true = bug present (not tracked), false = tracked, undefined = unknown.
 */
export function diagnose(proto, trackableGet) {
  if (!proto || typeof trackableGet !== "function") return undefined;
  const stub = Object.create(proto);
  const values = {
    system: { onuse: true },
    parent: { documentName: "Actor" },
    persisted: true,
    inCompendium: false,
    isEmbedded: true,
    disabled: false,
    isSuppressed: false,
    start: { time: 0 },
    isTemporary: true
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(stub, key, { value });
  try {
    return !trackableGet.call(stub);
  } catch {
    return undefined;
  }
}
