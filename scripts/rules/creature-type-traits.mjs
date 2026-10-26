/**
 * Optional rule "Traços de tipo de criatura" (#50).
 *
 * Book (Tormenta20 Jogo do Ano, cap. 7, "Tipos de Criaturas", p. 284): constructs and undead are immune to fatigue,
 * metabolic and poison effects (undead also to darkness), undead are harmed by magical light healing (Will halves) and
 * healed by darkness damage, and constructs do not recover HP from healing effects. The system stores the creature
 * type (system.detalhes.tipo) but no mechanic reads it.
 *
 * - Immunity: wraps the BaseEffect getter isSuppressedByImunity (T20:17817), reading the type from source data, so a
 *   condition is suppressed already in the "initial" phase; its children follow by inheritance (T20:17780).
 * - Notice: createActiveEffect tells the user who applied an immune condition (if they can see the actor).
 * - Damage: wraps ActorT20#applyDamageV2 (T20:7360) and makes ONE call to the inner chain with rewritten terms, so the
 *   HP change stays a single update; a view of the actor splits the chat card per operation.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { allActors } from "./source-stacking.mjs";

export const CREATURE_TYPE_TRAITS_SETTING = "creatureTypeTraitsRule";
export const UNDEAD = "mor";
export const CONSTRUCT = "con";
export const SKELETAL_NATURE_ID = "GYlYSYLGcK89eelM";

const IMMUNITIES = Object.freeze({
  mor: Object.freeze(["cansaco", "fatigado", "exausto", "metabolismo", "doente", "enjoado", "sangrando", "veneno", "envenenado", "trevas"]),
  con: Object.freeze(["cansaco", "fatigado", "exausto", "metabolismo", "doente", "enjoado", "sangrando", "veneno", "envenenado"])
});
const IMMUNE_CATEGORIES = Object.freeze(["cansaco", "metabolismo", "veneno", "trevas"]);
const PV_HEAL = "curapv";
const RECOVERY = Object.freeze(["curatpv", "curapm", "curatpm"]);
const DARKNESS = "trevas";
const LIGHT = "luz";
const SKELETAL_NAME = "natureza esqueletica";
const LOG = `${MODULE_ID} | creature-type-traits:`;
/** Absorbs floating point noise before rounding down (e.g. 3 × (1/3)). */
const EPSILON = 1e-9;

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

/** Lowercase, trimmed, without diacritics. */
export function normalize(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/**
 * Creature kind that has book traits: the Type field first, then the Osteon power Natureza Esquelética (undead).
 * @param {{tipo?: string, items?: {type: string, name?: string, sourceId?: string}[]}} p
 * @returns {"mor"|"con"|null}
 */
export function creatureKind({ tipo, items = [] } = {}) {
  if (tipo === UNDEAD || tipo === CONSTRUCT) return tipo;
  for (const item of items ?? []) {
    if (item?.type !== "poder") continue;
    if (String(item.sourceId ?? "").endsWith(`.${SKELETAL_NATURE_ID}`) || normalize(item.name) === SKELETAL_NAME) {
      return UNDEAD;
    }
  }
  return null;
}

/** Same test as the system's isSuppressedByImunity (T20:17817-17827), against the type immunities. */
export function isTypeImmune(kind, { statusId, category, ignoreImunity } = {}) {
  const set = IMMUNITIES[kind];
  if (!set || ignoreImunity) return false;
  return (!!statusId && set.includes(statusId)) || (!!category && set.includes(category));
}

/** The immune category a notice should cite: the condition's own category, or null. */
export function immuneCategory(kind, category) {
  const set = IMMUNITIES[kind];
  return set && IMMUNE_CATEGORIES.includes(category) && set.includes(category) ? category : null;
}

/**
 * Mirrors T20:7378-7389: the value terms with the flavor the system resolves and the sign of the last operator.
 * @returns {{flavor: string, total: number, faces?: number, number?: number}[]}
 */
export function resolveTerms(terms, type = "dano") {
  const out = [];
  let op = "+";
  for (const term of terms ?? []) {
    if (term?.operator) {
      op = term.operator;
      continue;
    }
    const flavor = term?.options?.flavor ?? terms[0]?.options?.flavor ?? type;
    const total = Number(term?.total) || 0;
    out.push({ flavor, total: op === "+" ? total : -total, faces: term?.faces, number: term?.number });
  }
  return out;
}

/** Whether "Aplicar Cura" on an undead needs the light dialog (multiplier < 0 and some curapv entry). */
export function needsLightChoice(kind, entries, multiplier) {
  return kind === UNDEAD && multiplier < 0 && (entries ?? []).some((e) => e.flavor === PV_HEAL);
}

const sum = (entries) => entries.reduce((acc, e) => acc + e.total, 0);
const floorDown = (value) => Math.floor(value + EPSILON);

/** Dice of a group, for the system's per-die count (porDado). */
function diceOf(entries) {
  const dice = entries.filter((e) => e.faces);
  if (!dice.length) return {};
  return { faces: dice[0].faces, number: dice.reduce((acc, e) => acc + (Number(e.number) || 0), 0) };
}

/**
 * ONE replacement call for applyDamageV2 on an undead or a construct, so the HP change stays a single operation.
 * @param {"mor"|"con"|null} kind
 * @param {{flavor: string, total: number, faces?: number, number?: number}[]} entries  from resolveTerms
 * @param {number} multiplier
 * @param {1|0.5} [choice]  light dialog answer (only when needsLightChoice): full or half (rounded down)
 * @returns {null | {entries: object[], multiplier: number, dropped: number}}
 *   null = pass through to the system unchanged; entries = [] = nothing to apply.
 */
export function planDamage(kind, entries, multiplier, choice) {
  if (!kind || !Array.isArray(entries) || !Number.isFinite(multiplier) || multiplier === 0) return null;

  if (kind === UNDEAD && multiplier > 0) {
    const dark = entries.filter((e) => e.flavor === DARKNESS);
    if (!dark.length) return null;
    const heal = floorDown(Math.max(sum(dark), 0) * multiplier);
    const rest = entries.filter((e) => e.flavor !== DARKNESS);
    if (heal > 0) rest.push({ flavor: PV_HEAL, total: -heal / multiplier });
    return { entries: rest, multiplier, dropped: 0 };
  }

  if (kind === UNDEAD && multiplier < 0) {
    if (choice !== 1 && choice !== 0.5) return null;
    const cures = entries.filter((e) => e.flavor === PV_HEAL);
    if (!cures.length) return null;
    const light = floorDown(Math.max(sum(cures), 0) * Math.abs(multiplier) * choice);
    const out = [];
    if (light > 0) out.push({ flavor: LIGHT, total: light, ...diceOf(cures) });
    for (const e of entries) {
      if (e.flavor === PV_HEAL) continue;
      if (RECOVERY.includes(e.flavor)) out.push({ ...e, total: e.total * multiplier });
      else out.push({ ...e, flavor: PV_HEAL, total: -e.total });
    }
    return { entries: out, multiplier: 1, dropped: 0 };
  }

  if (kind === CONSTRUCT && multiplier < 0) {
    const cures = entries.filter((e) => e.flavor === PV_HEAL);
    if (!cures.length) return null;
    return {
      entries: entries.filter((e) => e.flavor !== PV_HEAL),
      multiplier,
      dropped: Math.max(sum(cures) * Math.abs(multiplier), 0)
    };
  }

  return null;
}

/**
 * Splits the system's computed `final` into the chat cards the system would show for each operation
 * (displayDamageCard only shows the last non-zero quantity and flips signs by the multiplier, T20:7463-7478).
 * @param {Record<string, number>} final
 * @param {number} clickedMultiplier
 * @returns {{final: Record<string, number>, multiplier: number, withParts?: boolean}[]}
 */
export function presentDamage(final, clickedMultiplier) {
  const n = (key) => Number(final?.[key]) || 0;
  const cards = [];
  if (n("damage") || n("loss")) cards.push({ final: { damage: n("damage"), loss: n("loss") }, multiplier: 1, withParts: true });
  if (n("heal")) cards.push({ final: { heal: n("heal") }, multiplier: -1 });
  const rest = { tempHP: n("tempHP"), mana: n("mana"), manaGain: n("manaGain"), tempMP: n("tempMP") };
  if (Object.values(rest).some(Boolean)) cards.push({ final: rest, multiplier: Math.sign(clickedMultiplier) || 1 });
  return cards;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

/** Whether the optional rule is on. Safe before the setting is registered (returns false). */
export function ruleEnabled() {
  try {
    return game.settings.get(MODULE_ID, CREATURE_TYPE_TRAITS_SETTING) === "on";
  } catch {
    return false;
  }
}

function t(key, data) {
  const path = `T20CP.CreatureTypeTraits.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

/** Creature kind of an actor, from source data that is ready before the embedded documents are prepared. */
export function kindOf(actor) {
  const tipo = actor?.system?.detalhes?.tipo;
  if (tipo === UNDEAD || tipo === CONSTRUCT) return tipo;
  const items = [];
  for (const item of actor?.items ?? []) {
    if (item?.type !== "poder") continue;
    items.push({
      type: item.type,
      name: item.name,
      sourceId: item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? ""
    });
  }
  return creatureKind({ tipo, items });
}

function statusData(effect) {
  return {
    statusId: effect?.statuses?.first?.(),
    category: effect?.system?.status?.category,
    ignoreImunity: effect?.system?.status?.ignoreImunity
  };
}

/** Wrapped getter body: the system's test first, then the type immunities while the rule is on. */
export function typeImmunityGetter(original) {
  return function () {
    if (original.call(this)) return true;
    if (!ruleEnabled()) return false;
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
export function onCreateActiveEffect(effect, options, userId) {
  try {
    if (userId !== game.user?.id || !ruleEnabled()) return;
    const actor = effect?.parent;
    if (actor?.documentName !== "Actor" || !effect.statuses?.size) return;
    const kind = kindOf(actor);
    const data = statusData(effect);
    if (!isTypeImmune(kind, data)) return;
    if (!game.user.isGM && !actor.testUserPermission?.(game.user, "OBSERVER")) return;
    const category = immuneCategory(kind, data.category);
    const base = { actor: actor.name, condition: effect.name, kind: t(`Kind.${kind}`), reference: t("Reference") };
    const message = category ? t("Immune", { ...base, category: t(`Category.${category}`) }) : t("ImmuneCondition", base);
    ui.notifications.info(message);
  } catch (err) {
    console.warn(`${LOG} failed to notify the immunity`, err);
  }
}

/** Asks how a healing roll hits an undead: 1 (light), 0.5 (Will save), "heal" (not light) or null (closed). */
async function askLight(actor, amount) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const action = await DialogV2.wait({
    window: { title: t("Dialog.Title", { actor: actor.name }) },
    content: `<p>${t("Dialog.Content", { actor: foundry.utils.escapeHTML?.(actor.name) ?? actor.name, amount })}</p>`,
    buttons: [
      { action: "full", label: t("Dialog.Full"), default: true },
      { action: "half", label: t("Dialog.Half") },
      { action: "heal", label: t("Dialog.Heal") }
    ],
    rejectClose: false
  });
  if (action === "full") return 1;
  if (action === "half") return 0.5;
  if (action === "heal") return "heal";
  return null;
}

/**
 * A view of the actor for the single inner call: forwards everything to the received `this` (which may already be
 * another rule's Proxy) and only replaces the chat card with one card per operation.
 */
export function damageView(actor, clickedMultiplier) {
  return new Proxy(actor, {
    get(target, prop) {
      if (prop === "displayDamageCard") {
        return async (parts, final, multiplier) => {
          let cards = [];
          try {
            cards = presentDamage(final, clickedMultiplier);
          } catch {
            cards = [];
          }
          if (!cards.length) return target.displayDamageCard(parts, final, multiplier);
          for (const card of cards) await target.displayDamageCard(card.withParts ? parts : {}, card.final, card.multiplier);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target)
  });
}

/** A roll that keeps everything from the original (options.rd, total...) but carries the planned terms. */
export function derivedRoll(roll, entries) {
  const terms = entries.map((e) => ({ total: e.total, faces: e.faces, number: e.number, options: { flavor: e.flavor } }));
  return Object.create(roll, { terms: { value: terms, writable: true, enumerable: true, configurable: true } });
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
 * The applyDamageV2 wrapper. Exported for tests: `ask` replaces the dialog and `notify` the notification.
 * @param {Function} original
 * @param {{ask?: Function, notify?: Function, enabled?: Function}} [deps]
 */
export function wrapApplyDamage(original, { ask = askLight, notify, enabled = ruleEnabled } = {}) {
  const info = notify ?? ((message) => ui.notifications.info(message));
  return async function (...args) {
    const [roll, multiplier = 1, type = "dano"] = args;
    let context = null;
    try {
      context = prepareDamage(this, roll, multiplier, type, enabled);
    } catch (err) {
      console.warn(`${LOG} could not read the damage`, err);
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
      console.warn(`${LOG} could not plan the damage`, err);
      plan = null;
    }
    if (!plan) return await original.apply(this, args);

    if (plan.dropped > 0) {
      try {
        info(t("ConstructNoHeal", { actor: this.name, reference: t("Reference") }));
      } catch {
        // A notification never blocks the damage.
      }
    }
    if (!plan.entries.length) return;
    return await original.call(damageView(this, m), derivedRoll(roll, plan.entries), plan.multiplier, type, ...args.slice(3));
  };
}

function refreshActors() {
  for (const actor of allActors()) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      console.error(`${LOG} failed to refresh ${actor?.name}`, err);
    }
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerCreatureTypeTraitsSetting() {
  game.settings.register(MODULE_ID, CREATURE_TYPE_TRAITS_SETTING, {
    name: "T20CP.CreatureTypeTraits.Setting.Name",
    hint: "T20CP.CreatureTypeTraits.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.CreatureTypeTraits.Setting.off", on: "T20CP.CreatureTypeTraits.Setting.on" },
    default: "off",
    onChange: () => refreshActors()
  });
}

function findDescriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/** Installs the rule. Runs after the patches and the other damage wrappers, so this one sits outside them. */
export function installCreatureTypeTraitsRule() {
  const effectProto = CONFIG.ActiveEffect?.dataModels?.base?.prototype;
  const descriptor = effectProto && findDescriptor(effectProto, "isSuppressedByImunity");
  if (typeof descriptor?.get === "function") {
    Object.defineProperty(effectProto, "isSuppressedByImunity", {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      get: markWrapper(typeImmunityGetter(descriptor.get), descriptor.get)
    });
  } else {
    console.warn(`${LOG} BaseEffect#isSuppressedByImunity not found; type immunities are disabled`);
  }

  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  const original = actorProto?.applyDamageV2;
  if (typeof original === "function") {
    actorProto.applyDamageV2 = markWrapper(wrapApplyDamage(original), original);
  } else {
    console.warn(`${LOG} ActorT20#applyDamageV2 not found; damage and healing are unchanged`);
  }

  Hooks.on("createActiveEffect", onCreateActiveEffect);
}
