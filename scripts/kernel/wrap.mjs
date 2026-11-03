/**
 * Central wrapper registry. Every method the module replaces on a system or core class goes through wrap(), so
 * the composition order is known at runtime (api.wraps) and in tests. The kernel never reads Foundry globals.
 */
import { markWrapper } from "../utils.mjs";

/**
 * @typedef {object} WrapEntry
 * @property {string} label    "ItemT20#_allApplicableOnUseEffects" or "ActiveEffectT20.applyChange" (static).
 * @property {string[]} owners Owner ids, from the innermost (closest to the original) to the outermost.
 */

/**
 * Creates a wrapper registry. Registration order is composition order: whoever registers first sits closest to
 * the original, the same semantics as the direct prototype assignments it replaces.
 */
export function createWrapRegistry() {
  /** @type {Map<object, Map<string, WrapEntry>>} */
  const chains = new Map();

  /**
   * Replaces target[method] with a wrapper that receives the previous function as its first argument.
   * @param {object} target      Prototype or object that owns the method.
   * @param {string} method
   * @param {string} owner       Feature or service id.
   * @param {(original: Function, ...args: unknown[]) => unknown} wrapper  Called with the caller's `this`.
   * @param {{label?: string}} [options]
   * @returns {Function} The function that was replaced.
   */
  function wrap(target, method, owner, wrapper, { label } = {}) {
    if (!target) throw new TypeError(`${owner}: wrap target missing for ${method}`);
    const original = target[method];
    if (typeof original !== "function") throw new TypeError(`${owner}: ${method} is not a function`);
    if (typeof wrapper !== "function") throw new TypeError(`${owner}: wrapper for ${method} is not a function`);
    const wrapped = markWrapper(function (...args) {
      return wrapper.call(this, original, ...args);
    }, original);
    target[method] = wrapped;
    record(target, method, owner, label);
    return original;
  }

  function record(target, method, owner, label) {
    let byMethod = chains.get(target);
    if (!byMethod) chains.set(target, (byMethod = new Map()));
    const entry = byMethod.get(method) ?? { label: label ?? defaultLabel(target, method), owners: [] };
    entry.owners.push(owner);
    byMethod.set(method, entry);
  }

  /** Owners of a method, from the innermost to the outermost. */
  const chain = (target, method) => [...(chains.get(target)?.get(method)?.owners ?? [])];

  /** Serializable list for api.wraps and the snapshot tests. */
  const list = () =>
    [...chains.values()].flatMap((m) => [...m.values()]).map((e) => ({ label: e.label, owners: [...e.owners] }));

  return { wrap, chain, list };
}

/**
 * Adapts a wrapper factory `(original) => replacement` to wrap(). The factory runs once, on the first call, with the
 * original that wrap() captured; every call then goes to the replacement with the caller's `this` and arguments.
 * Keeps factories pure and testable on their own without building a closure per call.
 * @param {(original: Function) => Function} factory
 * @returns {(original: Function, ...args: unknown[]) => unknown}
 */
export function fromFactory(factory) {
  let built = null;
  return function (original, ...args) {
    built ??= factory(original);
    return built.apply(this, args);
  };
}

/** "Foo#method" for a prototype or an instance, "Foo.method" for a static method of class Foo. */
function defaultLabel(target, method) {
  if (typeof target === "function") return `${target.name || "?"}.${method}`;
  return `${target.constructor?.name || "?"}#${method}`;
}

/** Module-wide registry. Features also reach it through ctx.wrap (scripts/kernel/lifecycle.mjs), with their id as owner. */
export const wraps = createWrapRegistry();
