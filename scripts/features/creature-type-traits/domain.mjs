/** Pure logic of the creature type traits rule (#50): type immunities and the planned damage of one call. */

export const CREATURE_TYPE_TRAITS_SETTING = "creatureTypeTraitsRule";
export const UNDEAD = "mor";
export const CONSTRUCT = "con";
export const SKELETAL_NATURE_ID = "GYlYSYLGcK89eelM";

const IMMUNITIES = Object.freeze({
  mor: Object.freeze(["cansaco", "fatigado", "exausto", "metabolismo", "doente", "enjoado", "sangrando", "veneno", "envenenado", "trevas"]),
  con: Object.freeze(["cansaco", "fatigado", "exausto", "metabolismo", "doente", "enjoado", "sangrando", "veneno", "envenenado"])
});
const IMMUNE_CATEGORIES = Object.freeze(["cansaco", "metabolismo", "veneno", "trevas"]);
export const PV_HEAL = "curapv";
const RECOVERY = Object.freeze(["curatpv", "curapm", "curatpm"]);
const DARKNESS = "trevas";
const LIGHT = "luz";
const SKELETAL_NAME = "natureza esqueletica";
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

export const sum = (entries) => entries.reduce((acc, e) => acc + e.total, 0);
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
/*  Actor data                                  */
/* -------------------------------------------- */

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

/** The condition data the system's immunity test reads. */
export function statusData(effect) {
  return {
    statusId: effect?.statuses?.first?.(),
    category: effect?.system?.status?.category,
    ignoreImunity: effect?.system?.status?.ignoreImunity
  };
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
