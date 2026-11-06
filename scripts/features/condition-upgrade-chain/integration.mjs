import { markWrapper } from "../../lib/source.mjs";
import { DUPLICATE_KEY, KEY, diagnose, findDescriptor, hasActiveStatus, hasNewerDuplicate, upgradeOf } from "./domain.mjs";

export const SOURCES = [`BaseEffect#${KEY}`, `BaseEffect#${DUPLICATE_KEY}`];

const effectModel = (ctx) => ctx.platform.config.document("ActiveEffect")?.dataModels?.base;

function getterOf(proto, key) {
  const descriptor = proto && findDescriptor(proto, key);
  if (typeof descriptor?.get !== "function") throw new Error(`BaseEffect#${key} not found`);
  return descriptor;
}

/** Replaces a getter of the prototype, keeping the original reachable for sourceOf and for the fallbacks. */
function replaceGetter(proto, key, original, get) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: original.enumerable ?? false,
    get: markWrapper(get, original.get)
  });
}

/** Runs `fn` with `effect` marked as under evaluation; a reentry gets `onReentry()`. */
function guarded(evaluating, effect, fn, onReentry) {
  if (evaluating.has(effect)) return onReentry();
  evaluating.add(effect);
  try {
    return fn();
  } finally {
    evaluating.delete(effect);
  }
}

function installUpgrade(ctx, proto, evaluating) {
  const original = getterOf(proto, KEY);
  replaceGetter(proto, KEY, original, function () {
    const effect = this.parent;
    try {
      const actor = effect?.actor;
      const upgrade = upgradeOf(this.status, effect?.statuses?.first?.());
      if (!actor || !upgrade || typeof actor.allApplicableEffects !== "function") return original.get.call(this);
      const scan = () => hasActiveStatus(actor.allApplicableEffects(), upgrade, effect);
      return guarded(evaluating, effect, scan, () => false);
    } catch (err) {
      ctx.log.error("failed to evaluate the upgrade chain", err);
      return original.get.call(this);
    }
  });
}

function installDuplicate(ctx, proto, evaluating) {
  const original = getterOf(proto, DUPLICATE_KEY);
  const inherited = (other) => other?.system?.isSuppressedByInheritance === true;
  replaceGetter(proto, DUPLICATE_KEY, original, function () {
    const effect = this.parent;
    try {
      const effects = effect?.actor?.effects;
      if (!effects) return original.get.call(this);
      const scan = () => hasNewerDuplicate(effects, effect, effect.statuses?.first?.(), inherited);
      return guarded(evaluating, effect, scan, () => original.get.call(this));
    } catch (err) {
      ctx.log.error("failed to evaluate duplicated conditions", err);
      return original.get.call(this);
    }
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = effectModel(ctx)?.prototype;
  getterOf(proto, KEY);
  getterOf(proto, DUPLICATE_KEY);
  // Shared: the duplicate rule reads origin.active, which may evaluate the upgrade of the origin, and back.
  const evaluating = new WeakSet();
  installUpgrade(ctx, proto, evaluating);
  installDuplicate(ctx, proto, evaluating);
}

/**
 * Only reads source code: nothing of the system is executed.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function isNeeded(ctx) {
  return diagnose(ctx.platform.sourceOfMethod(SOURCES[0]) ?? undefined);
}
