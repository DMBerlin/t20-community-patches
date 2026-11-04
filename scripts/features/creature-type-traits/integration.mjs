/** Foundry integration of the creature type traits rule (#50): the immunity getter, the notice and the damage wrapper. */
import { markWrapper } from "../../lib/source.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";
import { allActors } from "../../lib/actors.mjs";
import {
  CREATURE_TYPE_TRAITS_SETTING,
  PV_HEAL,
  damageView,
  derivedRoll,
  immuneCategory,
  isTypeImmune,
  kindOf,
  needsLightChoice,
  planDamage,
  resolveTerms,
  statusData,
  sum
} from "./domain.mjs";
import { askLight } from "./ui.mjs";

/**
 * What the handlers of one installation read: the rule's setting, translations, notices and the dialog.
 * @param {object} ctx  feature context
 */
export function createState(ctx) {
  const { platform, log } = ctx;
  const t = (key, data) => {
    const path = `T20CP.CreatureTypeTraits.${key}`;
    return data ? platform.i18n.format(path, data) : platform.i18n.localize(path);
  };
  const state = {
    platform,
    log,
    t,
    /** Whether the optional rule is on. Safe before the setting is registered (returns false). */
    enabled() {
      try {
        return ctx.setting(CREATURE_TYPE_TRAITS_SETTING) === "on";
      } catch {
        return false;
      }
    },
    notify: (message) => platform.notify.info(message),
    ask: (actor, amount) => askLight(state, actor, amount)
  };
  return state;
}

/** Wrapped getter body: the system's test first, then the type immunities while the rule is on. */
export function typeImmunityGetter(original, enabled) {
  return function () {
    if (original.call(this)) return true;
    if (!enabled()) return false;
    try {
      return isTypeImmune(kindOf(this.parent?.actor), {
        statusId: this.parent?.statuses?.first?.(),
        category: this.status?.category,
        ignoreImunity: this.status?.ignoreImunity
      });
    } catch {
      return false;
    }
  };
}

/** createActiveEffect: tells the user who applied an immune condition, when they can see the actor. */
export function onCreateActiveEffect(state, effect, options, userId) {
  const { platform, t } = state;
  try {
    if (userId !== platform.user.id() || !state.enabled()) return;
    const actor = effect?.parent;
    if (actor?.documentName !== "Actor" || !effect.statuses?.size) return;
    const kind = kindOf(actor);
    const data = statusData(effect);
    if (!isTypeImmune(kind, data)) return;
    if (!platform.user.isGM() && !actor.testUserPermission?.(platform.users.current(), "OBSERVER")) return;
    const category = immuneCategory(kind, data.category);
    const base = { actor: actor.name, condition: effect.name, kind: t(`Kind.${kind}`), reference: t("Reference") };
    const message = category ? t("Immune", { ...base, category: t(`Category.${category}`) }) : t("ImmuneCondition", base);
    platform.notify.info(message);
  } catch (err) {
    state.log.warn("failed to notify the immunity", err);
  }
}

/** What the wrapper needs to plan, or null to pass the call through unchanged. */
function prepareDamage(actor, roll, multiplier, type, enabled) {
  if (!enabled()) return null;
  const kind = kindOf(actor);
  const m = Number(multiplier);
  if (!kind || !actor.isOwner || !Array.isArray(roll?.terms) || !Number.isFinite(m)) return null;
  return { kind, entries: resolveTerms(roll.terms, type), m };
}

/**
 * The applyDamageV2 wrapper.
 * @param {Function} original
 * @param {{ask: Function, notify: Function, enabled: Function, t: Function, log: object}} deps  from createState
 */
export function wrapApplyDamage(original, { ask, notify, enabled, t, log }) {
  return async function (...args) {
    const [roll, multiplier = 1, type = "dano"] = args;
    let context = null;
    try {
      context = prepareDamage(this, roll, multiplier, type, enabled);
    } catch (err) {
      log.warn("could not read the damage", err);
    }
    if (!context) return await original.apply(this, args);
    const { kind, entries, m } = context;

    let choice;
    if (needsLightChoice(kind, entries, m)) {
      const amount = Math.max(sum(entries.filter((e) => e.flavor === PV_HEAL)), 0) * Math.abs(m);
      choice = await ask(this, amount);
      if (choice === null || choice === undefined) return;
      if (choice === "heal") return await original.apply(this, args);
    }

    let plan;
    try {
      plan = planDamage(kind, entries, m, choice);
    } catch (err) {
      log.warn("could not plan the damage", err);
      plan = null;
    }
    if (!plan) return await original.apply(this, args);

    if (plan.dropped > 0) {
      try {
        notify(t("ConstructNoHeal", { actor: this.name, reference: t("Reference") }));
      } catch {
        // A notification never blocks the damage.
      }
    }
    if (!plan.entries.length) return;
    return await original.call(damageView(this, m), derivedRoll(roll, plan.entries), plan.multiplier, type, ...args.slice(3));
  };
}

function refreshActors(ctx) {
  for (const actor of allActors(ctx.platform.documents)) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      ctx.log.error(`failed to refresh ${actor?.name}`, err);
    }
  }
}

function findDescriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/** The getter is a property, not a method, so it is replaced by defineProperty (marked) and not by ctx.wrap. */
function installImmunityGetter(ctx, state) {
  const effectProto = ctx.platform.config.document("ActiveEffect")?.dataModels?.base?.prototype;
  const descriptor = effectProto && findDescriptor(effectProto, "isSuppressedByImunity");
  if (typeof descriptor?.get !== "function") {
    ctx.log.warn("BaseEffect#isSuppressedByImunity not found; type immunities are disabled");
    return;
  }
  Object.defineProperty(effectProto, "isSuppressedByImunity", {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get: markWrapper(typeImmunityGetter(descriptor.get, state.enabled), descriptor.get)
  });
}

/**
 * Installs the rule. Runs after the patches and the other damage wrappers, so this one sits outside them.
 * @returns the state of this installation (read by the tests)
 */
export function install(ctx) {
  const state = createState(ctx);
  installImmunityGetter(ctx, state);

  const actorProto = ctx.platform.classes.actor?.prototype;
  if (typeof actorProto?.applyDamageV2 === "function") {
    ctx.wrap(actorProto, "applyDamageV2", fromFactory((original) => wrapApplyDamage(original, state)));
  } else {
    ctx.log.warn("ActorT20#applyDamageV2 not found; damage and healing are unchanged");
  }

  ctx.hooks.on("createActiveEffect", (...args) => onCreateActiveEffect(state, ...args));
  ctx.onSettingChange(CREATURE_TYPE_TRAITS_SETTING, () => refreshActors(ctx));
  return state;
}
