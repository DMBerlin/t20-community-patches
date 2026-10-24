/**
 * Optional rule "Bônus de itens e magias" (#28).
 *
 * By the book (chapter 5, "Acumulando Efeitos", p. 232), effects of items and spells stack with other sources, but
 * not among themselves: two spells, or two items, giving +1 Fortitude give +1. The armor exception lets the armor,
 * the shield and one other item add to Defense. The system adds everything.
 *
 * When the rule is on, for every statistic (change key) and inside each source (spells, items), only the greatest
 * bonus and the greatest penalty apply; the others are suppressed while the actor is prepared, never deleted.
 * Armor and shield Defense (and their upgrades) always add; among the other equipped items, only the one with the
 * greatest Defense counts. The user who caused a suppression is notified, and the sheet marks what is suppressed.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";

export const SOURCE_STACKING_SETTING = "sourceStackingRule";
export const SOURCE_FLAG = "source";
export const SOURCE_STACKING_MODES = ["off", "on"];
export const DEFENSE_KEY = "system.attributes.defesa.bonus";
export const PENALTY_KEY = "system.attributes.defesa.pda";

const ITEM_CATEGORIES = { magia: "magia", arma: "item", equipamento: "item", consumivel: "item", tesouro: "item" };
const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
const CATEGORIES = new Set(["magia", "item"]);

/**
 * Source of an item type: spells, items, or null for everything else (abilities, classes, races, base rooms).
 * @param {unknown} itemType
 * @returns {"magia"|"item"|null}
 */
export function itemCategory(itemType) {
  return Object.hasOwn(ITEM_CATEGORIES, String(itemType)) ? ITEM_CATEGORIES[itemType] : null;
}

/**
 * Source of an effect.
 * @param {{parent: "Item"|"Actor"|string, itemType?: string, transfer?: boolean, flag?: unknown, originItemType?: string}} p
 *   `itemType`: type of the item holding a transferred effect. `flag`: the source stamped by the chat card.
 *   `originItemType`: type of the owned item a legacy actor effect points to through its origin.
 * @returns {"magia"|"item"|null}  null = not part of the rule (stacks as the system does).
 */
export function sourceCategory({ parent, itemType, transfer, flag, originItemType }) {
  if (parent === "Item") return transfer ? itemCategory(itemType) : null;
  if (parent !== "Actor") return null;
  if (CATEGORIES.has(flag)) return flag;
  return originItemType ? itemCategory(originItemType) : null;
}

/**
 * Armor exception: the Defense and armor penalty of the equipped armor and shield, upgrades included, always add.
 * @param {{itemType?: string, tipo?: string, key: string}} p
 * @returns {boolean}
 */
export function isArmorExempt({ itemType, tipo, key }) {
  return itemType === "equipamento" && ARMOR_TIPOS.has(tipo) && (key === DEFENSE_KEY || key === PENALTY_KEY);
}

/**
 * Signed amount of a change, or NaN when it does not take part (other types, dice, invalid formulas, other fields).
 * Follows the core semantics of the target field: on a number field "subtract" is a negative "add"; on an array
 * of formula parts "add" appends a part and "subtract" removes a matching one, so only "add" takes part. The armor
 * penalty field casts every value and every result to −|v|: "add" makes the penalty worse by |v|, and "subtract",
 * whose result depends on what came before, does not take part.
 * @param {{key: string, type: string, value: unknown}} change
 * @param {(formula: string) => number} [resolve]  Evaluates a formula without dice; NaN when it cannot.
 * @param {"number"|"array"} [target]  Kind of the target field; anything else does not take part.
 * @returns {number}
 */
export function changeAmount(change, resolve = () => NaN, target) {
  if (!change) return NaN;
  const ok = change.type === "add" ? target === "number" || target === "array" : change.type === "subtract" && target === "number";
  if (!ok) return NaN;
  let amount = NaN;
  const value = change.value;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string" && value.trim()) {
    amount = Number(value);
    if (!Number.isFinite(amount)) {
      try {
        amount = Number(resolve(value.trim()));
      } catch {
        amount = NaN;
      }
    }
  }
  if (!Number.isFinite(amount)) return NaN;
  if (change.key === PENALTY_KEY) {
    // The field cleans the result back to −|v| after the operation, so a "subtract" depends on the order.
    if (change.type === "subtract") return NaN;
    return -Math.abs(amount);
  }
  if (change.type === "subtract") amount = -amount;
  return amount;
}

/** Total order of sources: creation time, then id. */
export function compareOrder(a, b) {
  const ta = Number(a?.[0]) || 0;
  const tb = Number(b?.[0]) || 0;
  if (ta !== tb) return ta - tb;
  const ia = String(a?.[1] ?? "");
  const ib = String(b?.[1] ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * @typedef {object} StackEntry
 * @property {unknown} ref           What gets suppressed (a change object, or an accessory field).
 * @property {string} source         Source id: one owned item (all its effects and data) or one actor effect.
 * @property {[number, string]} order Tie-break order of the source.
 * @property {string} name           Display name of the source.
 * @property {"magia"|"item"|null} category
 * @property {string} key            Change key.
 * @property {number} amount         Signed amount (NaN = not comparable, always applies).
 * @property {boolean} [exempt]      Armor exception.
 * @property {string[]} [effects]    Effect uuids of the source.
 * @property {string[]} [items]      Item ids of the source.
 */

/**
 * Plans the suppressions. Inside each category and key, each source sums its bonuses and its penalties separately;
 * the source with the greatest bonus keeps its bonuses and the one with the greatest penalty keeps its penalties.
 * Ties go to the first source in order. Every other source loses its bonuses (or penalties) on that key.
 * @param {StackEntry[]} entries
 * @returns {{suppressed: Set<unknown>, report: {category: string, key: string, sign: 1|-1,
 *   loser: {source: string, name: string, total: number, effects: string[], items: string[]},
 *   winner: {source: string, name: string, total: number, effects: string[], items: string[]}}[]}}
 */
export function planSuppression(entries) {
  const groups = new Map();
  for (const entry of entries ?? []) {
    if (!entry || !CATEGORIES.has(entry.category) || entry.exempt) continue;
    if (!Number.isFinite(entry.amount) || entry.amount === 0 || typeof entry.key !== "string" || !entry.key) continue;
    const groupKey = `${entry.category}\u0000${entry.key}`;
    let group = groups.get(groupKey);
    if (!group) groups.set(groupKey, (group = { category: entry.category, key: entry.key, sources: new Map() }));
    let source = group.sources.get(entry.source);
    if (!source) {
      source = { source: entry.source, name: entry.name, order: entry.order, pos: 0, neg: 0, posRefs: [], negRefs: [], effects: new Set(), items: new Set() };
      group.sources.set(entry.source, source);
    }
    if (compareOrder(entry.order, source.order) < 0) source.order = entry.order;
    for (const uuid of entry.effects ?? []) source.effects.add(uuid);
    for (const id of entry.items ?? []) source.items.add(id);
    if (entry.amount > 0) {
      source.pos += entry.amount;
      source.posRefs.push(entry.ref);
    } else {
      source.neg += entry.amount;
      source.negRefs.push(entry.ref);
    }
  }

  const suppressed = new Set();
  const report = [];
  const describe = (s, total) => ({ source: s.source, name: s.name, total, effects: [...s.effects], items: [...s.items] });
  for (const group of groups.values()) {
    const sources = [...group.sources.values()].sort((a, b) => compareOrder(a.order, b.order));
    for (const sign of [1, -1]) {
      const field = sign > 0 ? "pos" : "neg";
      const contenders = sources.filter((s) => s[field] !== 0);
      if (contenders.length < 2) continue;
      let winner = contenders[0];
      for (const s of contenders) if (s[field] * sign > winner[field] * sign) winner = s;
      for (const s of contenders) {
        if (s === winner) continue;
        for (const ref of s[sign > 0 ? "posRefs" : "negRefs"]) suppressed.add(ref);
        report.push({ category: group.category, key: group.key, sign, loser: describe(s, s[field]), winner: describe(winner, winner[field]) });
      }
    }
  }
  return { suppressed, report };
}

/**
 * Label of a statistic for messages.
 * @param {string} key
 * @param {{defense?: string, penalty?: string, pericias?: Record<string, string>, atributos?: Record<string, string>}} labels
 * @returns {string}
 */
export function keyLabel(key, labels = {}) {
  if (key === DEFENSE_KEY && labels.defense) return labels.defense;
  if (key === PENALTY_KEY && labels.penalty) return labels.penalty;
  const skill = /^system\.pericias\.([^.]+)\.(?:bonus|value)$/.exec(key);
  if (skill && labels.pericias?.[skill[1]]) return labels.pericias[skill[1]];
  const ability = /^system\.atributos\.([^.]+)\.(?:bonus|value)$/.exec(key);
  if (ability && labels.atributos?.[ability[1]]) return labels.atributos[ability[1]];
  return key;
}

/** Signed number for messages: +2, −1. */
export function signed(value) {
  const n = Number(value) || 0;
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/**
 * Suppressions that are new and involve a changed document, as the loser or the winner.
 * @param {ReturnType<typeof planSuppression>["report"]} report
 * @param {Set<string>} known  Signatures already notified.
 * @param {{effect?: string, item?: string}} doc  Uuid of the changed effect or id of the changed item.
 */
export function newSuppressions(report, known, doc) {
  const docs = [doc].flat().filter(Boolean);
  const involves = (side) => docs.some((d) => (d.effect && side.effects.includes(d.effect)) || (d.item && side.items.includes(d.item)));
  return (report ?? []).filter((r) => !known.has(reportSignature(r)) && (involves(r.loser) || involves(r.winner)));
}

/** @param {ReturnType<typeof planSuppression>["report"][number]} r */
export function reportSignature(r) {
  return [r.category, r.key, r.sign, r.loser.source, r.winner.source].join("\u0000");
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const FLAG_PATH = `flags.${MODULE_ID}.${SOURCE_FLAG}`;

/** Plan of the actor being prepared: {actor, suppressed}. Set only while Actor#applyActiveEffects runs. */
let active = null;
/** @type {WeakMap<object, ReturnType<typeof planSuppression>["report"]>} */
const actorReports = new WeakMap();
/** Accessories whose Defense or penalty lost, by actor: [{item, value, penalty}]. */
const accessoryLosers = new WeakMap();
/** Signatures already seen by this user, by actor, so only new suppressions are notified. */
const knownByActor = new WeakMap();
const preparing = new WeakSet();
/** Documents changed by this user in the current operation, by actor, waiting for the notification flush. */
const pending = new Map();

function isOn() {
  try {
    return game.settings.get(MODULE_ID, SOURCE_STACKING_SETTING) === "on";
  } catch {
    return false;
  }
}

function setFlag(effect, category) {
  for (const target of [effect, effect._source]) {
    if (!target) continue;
    if (category) {
      target.flags ??= {};
      target.flags[MODULE_ID] ??= {};
      target.flags[MODULE_ID][SOURCE_FLAG] = category;
    } else if (target.flags?.[MODULE_ID] && SOURCE_FLAG in target.flags[MODULE_ID]) {
      delete target.flags[MODULE_ID][SOURCE_FLAG];
    }
  }
}

/** Stamps the rolled clone's own effects with the source; the system copies `ef.flags` into the card effect. */
function stampClone(item) {
  if (!item?.effects || !item.isEmbedded || item.actor?.items?.get(item.id) === item) return;
  const category = itemCategory(item.type);
  for (const effect of item.effects) setFlag(effect, category);
}

/** The owned item a legacy actor effect points to (`Actor.<a>.Item.<i>` or `Scene.<s>.Token.<t>.Item.<i>`). */
function originItem(actor, origin) {
  if (typeof origin !== "string") return null;
  const parts = origin.split(".");
  if (parts.length === 4 && parts[0] === "Actor" && parts[1] === actor.id && parts[2] === "Item") return actor.items?.get(parts[3]) ?? null;
  if (parts.length === 6 && parts[0] === "Scene" && parts[2] === "Token" && parts[3] === actor.token?.id && parts[4] === "Item") {
    return actor.items?.get(parts[5]) ?? null;
  }
  return null;
}

const time = (doc) => Number(doc?._stats?.createdTime) || 0;

function itemSource(item, category, effect) {
  return {
    category,
    source: `Item.${item.id}`,
    order: [time(item), item.id],
    name: item.name,
    itemType: item.type,
    tipo: item.system?.tipo,
    effects: effect ? [effect.uuid] : [],
    items: [item.id]
  };
}

/** Source of an applicable effect on this actor, or null when it does not take part. */
function effectSource(actor, effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Item") {
    if (parent.parent !== actor) return null;
    const category = sourceCategory({ parent: "Item", itemType: parent.type, transfer: !!effect.transfer });
    return category ? itemSource(parent, category, effect) : null;
  }
  if (parent !== actor) return null;
  const flag = foundry.utils.getProperty(effect, FLAG_PATH);
  if (CATEGORIES.has(flag)) {
    return { category: flag, source: `ActiveEffect.${effect.id}`, order: [time(effect), effect.id], name: effect.name, effects: [effect.uuid], items: [] };
  }
  const item = originItem(actor, effect.origin);
  const category = item ? sourceCategory({ parent: "Actor", originItemType: item.type }) : null;
  return category ? itemSource(item, category, effect) : null;
}

/** Evaluates a formula without dice like core's NumberField (Roll parser), never as JavaScript. */
function evaluate(formula, data) {
  const Roll = foundry.dice.Roll;
  const resolved = Roll.defaultImplementation.replaceFormulaData(formula, data ?? {}, { recursive: true });
  if (resolved.replace(/@\w+\[[^#\]]+]/g, "").includes("@")) return NaN;
  const roll = Roll.create(resolved);
  if (!roll.isDeterministic) return NaN;
  return Number(roll.evaluateSync().total);
}

function equippedAccessories(actor) {
  let slots = false;
  try {
    slots = game.settings.get("tormenta20", "equipmentSlots");
  } catch {
    /* setting not registered */
  }
  return (actor.itemTypes?.equipamento ?? []).filter(
    (i) => (slots ? i.system?.equipado2?.slot : i.system?.equipado) && !ARMOR_TIPOS.has(i.system?.tipo) && i.system?.armadura
  );
}

/**
 * Kind of the field a change key targets, as the core resolves it in ActiveEffect.applyChange. Proxy keys
 * (`system.path.*.key`, expanded by ActiveEffectT20._prepareProxyChange) take the kind of their first concrete key.
 */
function fieldKind(actor, key, type) {
  const fields = foundry.data?.fields;
  if (!fields) return undefined;
  let field;
  try {
    let path = key;
    // Same as ActiveEffectT20.applyChange: short movement keys target "bonus" on "add" and "base" otherwise.
    if (path.startsWith("system.attributes.movement") && /(walk|fly|burrow|climb|swim)$/.test(path)) {
      path += type === "add" ? ".bonus" : ".base";
    }
    if (path.search(/\.\*\./) > 0) {
      const [base, rest = ""] = path.split(".*");
      // Same filter as the system: movement also holds keys that are not movement types (hover, flags).
      const keep = base === "system.attributes.movement" ? (k) => CONFIG.T20?.movementTypes?.[k] : () => true;
      const first = Object.keys(foundry.utils.getProperty(actor, base) ?? {}).find(keep);
      if (first === undefined) return undefined;
      path = `${base}.${first}${rest}`;
    }
    field = path.startsWith("system.") ? actor.system?.getFieldForProperty?.(path.slice(7)) : actor.getFieldForProperty?.(path);
  } catch {
    return undefined;
  }
  if (field instanceof fields.NumberField) return "number";
  if (field instanceof fields.ArrayField) return "array";
  return undefined;
}

function buildPlan(actor, phase) {
  const rollData = actor.getRollData();
  const entries = [];
  const kinds = new Map();
  const kindOf = (key, type) => {
    const id = `${type}\u0000${key}`;
    if (!kinds.has(id)) kinds.set(id, fieldKind(actor, key, type));
    return kinds.get(id);
  };
  for (const effect of actor.allApplicableEffects()) {
    if (!effect.active) continue;
    const info = effectSource(actor, effect);
    if (!info) continue;
    const replacementData = effect.getReplacementData(rollData);
    const cache = new Map();
    const resolve = (formula) => {
      if (!cache.has(formula)) cache.set(formula, evaluate(formula, replacementData));
      return cache.get(formula);
    };
    for (const change of effect.system?.changes ?? []) {
      if (!change?.key || (change.type !== "add" && change.type !== "subtract")) continue;
      if (isArmorExempt({ itemType: info.itemType, tipo: info.tipo, key: change.key })) continue;
      if (!effect.shouldApplyChange(change, { phase, replacementData })) continue;
      entries.push({ ...info, ref: change, key: change.key, amount: changeAmount(change, resolve, kindOf(change.key, change.type)) });
    }
  }
  if (phase === "initial") {
    for (const item of equippedAccessories(actor)) {
      const info = itemSource(item, "item");
      const value = Number(item.system.armadura.value) || 0;
      const penalty = Number(item.system.armadura.penalidade) || 0;
      if (value) entries.push({ ...info, ref: { item, field: "value" }, key: DEFENSE_KEY, amount: value });
      if (penalty) entries.push({ ...info, ref: { item, field: "penalty" }, key: PENALTY_KEY, amount: -Math.abs(penalty) });
    }
  }
  return planSuppression(entries);
}

function targetActor(effect) {
  const parent = effect?.parent;
  return parent?.documentName === "Item" ? parent.parent : parent;
}

function labels() {
  const T20 = CONFIG.T20 ?? {};
  const localize = (s) => (typeof s === "string" ? game.i18n.localize(s) : undefined);
  const map = (obj, pick) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, localize(pick(v))]));
  return {
    defense: game.i18n.localize("T20CP.SourceStacking.Stat.defense"),
    penalty: game.i18n.localize("T20CP.SourceStacking.Stat.penalty"),
    pericias: map(T20.pericias, (v) => (typeof v === "string" ? v : v?.label)),
    atributos: map(T20.atributos, (v) => (typeof v === "string" ? v : v?.label))
  };
}

const SUPPRESSED_KEY = "T20CP.SourceStacking.Suppressed";

/** Format data of the message for one suppression (plain text: callers escape it before using it as HTML). */
function messageData(r, actor, cachedLabels = labels()) {
  const accessory = r.category === "item" && (r.key === DEFENSE_KEY || r.key === PENALTY_KEY);
  return {
    loser: r.loser.name,
    stat: keyLabel(r.key, cachedLabels),
    value: signed(r.loser.total),
    actor: actor?.name,
    winner: r.winner.name,
    winnerValue: signed(r.winner.total),
    reason: game.i18n.localize(accessory ? "T20CP.SourceStacking.Accessory" : `T20CP.SourceStacking.Category.${r.category}`),
    reference: game.i18n.localize("T20CP.SourceStacking.Reference")
  };
}

/** Notifies the user who changed `docs` about the new suppressions they cause or suffer. */
function notifyChange(actor, docs) {
  if (!actor || actor.documentName !== "Actor") return;
  const report = isOn() ? (actorReports.get(actor) ?? []) : [];
  const known = knownByActor.get(actor) ?? new Set();
  if (docs.length) {
    const fresh = newSuppressions(report, known, docs);
    if (fresh.length) {
      const cached = labels();
      // `format` makes the core escape every value, including names typed by users.
      for (const r of fresh) ui.notifications?.info(SUPPRESSED_KEY, { format: messageData(r, actor, cached) });
    }
  }
  knownByActor.set(actor, new Set(report.map(reportSignature)));
}

/**
 * Runs after the current database operation dispatches its descendant events. Changes to an effect owned by an
 * item fire their hook after `item.reset()` and before the owner actor prepares again (Actor#_on*DescendantDocuments),
 * so the actor's report is only up to date once the synchronous part of the operation is over.
 */
function afterOperation(actor, doc, notify) {
  if (!actor) return;
  let docs = pending.get(actor);
  if (!docs) {
    // One flush per actor: a batch prepares the actor once, then fires one hook per document.
    pending.set(actor, (docs = []));
    queueMicrotask(() => {
      pending.delete(actor);
      try {
        notifyChange(actor, docs);
      } catch (err) {
        console.error(`${MODULE_ID} | source-stacking: failed to notify`, err);
      }
    });
  }
  if (notify) docs.push(doc);
}

/** Every client keeps its known suppressions up to date; only the user who made the change is notified. */
function onEffectHook(effect, userId, notify = true) {
  afterOperation(targetActor(effect), { effect: effect?.uuid }, notify && userId === game.user?.id);
}

function onItemHook(item, userId, notify = true) {
  afterOperation(item?.parent, { item: item?.id }, notify && userId === game.user?.id);
}

/** Adds the marker with the explanation to the rows of suppressed effects and items. */
function markSheet(app, html) {
  const actor = app?.actor;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!actor || !root || !isOn()) return;
  const report = actorReports.get(actor);
  if (!report?.length) return;
  const byEffect = new Map();
  const byItem = new Map();
  const cached = labels();
  const add = (map, key, line) => map.set(key, [...(map.get(key) ?? []), line]);
  for (const r of report) {
    const line = game.i18n.format(SUPPRESSED_KEY, messageData(r, actor, cached));
    for (const uuid of r.loser.effects) add(byEffect, uuid, line);
    for (const id of r.loser.items) add(byItem, id, line);
  }
  const header = game.i18n.localize("T20CP.SourceStacking.Tooltip");
  const decorate = (li, lines) => {
    if (!lines?.length || li.querySelector(".t20cp-source-suppressed")) return;
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-layer-group t20cp-source-suppressed";
    icon.dataset.tooltipHtml = [header, ...new Set(lines)].map((l) => foundry.utils.escapeHTML(l)).join("<br>");
    (li.querySelector(".item-name h4, .item-name label") ?? li.querySelector(".item-name") ?? li).append(" ", icon);
  };
  for (const li of root.querySelectorAll("li[data-effect-id]")) {
    const uuid = li.dataset.effectUuid ?? actor.effects?.get(li.dataset.effectId)?.uuid;
    decorate(li, uuid && byEffect.get(uuid));
  }
  for (const li of root.querySelectorAll("li[data-item-id]")) decorate(li, byItem.get(li.dataset.itemId));
}

/** Actors to prepare again when the setting changes: world actors and the synthetic actors of unlinked tokens. */
export function* allActors() {
  yield* game.actors ?? [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) yield token.actor;
  }
}

function refreshActors() {
  for (const actor of allActors()) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      console.error(`${MODULE_ID} | source-stacking: failed to refresh ${actor?.name}`, err);
    }
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerSourceStackingSetting() {
  game.settings.register(MODULE_ID, SOURCE_STACKING_SETTING, {
    name: "T20CP.SourceStacking.Setting.Name",
    hint: "T20CP.SourceStacking.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.SourceStacking.Setting.off", on: "T20CP.SourceStacking.Setting.on" },
    default: "off",
    onChange: () => refreshActors()
  });
}

/**
 * Installs the rule. Must run after the patches: the stamp sees the effects linked-usage-effects injects, and the
 * actor wrappers sit outside armor-penalty-reduction's (the phase is passed through untouched).
 * The stamp is always applied (it is inert), so effects applied while the rule is off are recognized later.
 */
export function installSourceStackingRule() {
  const itemProto = CONFIG.Item?.documentClass?.prototype;
  const onUse = itemProto?._allApplicableOnUseEffects;
  const effectProto = CONFIG.ActiveEffect?.documentClass?.prototype;
  const shouldApply = effectProto?.shouldApplyChange;
  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  const applyEffects = actorProto?.applyActiveEffects;
  if (typeof onUse !== "function") throw new Error("Tormenta20 usage effect API not found");
  if (typeof shouldApply !== "function") throw new Error("ActiveEffect#shouldApplyChange not found");
  if (typeof applyEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  itemProto._allApplicableOnUseEffects = markWrapper(function (...args) {
    const effects = onUse.apply(this, args);
    try {
      stampClone(this);
    } catch (err) {
      console.error(`${MODULE_ID} | source-stacking: failed to stamp the effect source`, err);
    }
    return effects;
  }, onUse);

  effectProto.shouldApplyChange = markWrapper(function (change, ...args) {
    const result = shouldApply.call(this, change, ...args);
    if (!result || !active || !active.suppressed.has(change)) return result;
    try {
      return targetActor(this) === active.actor ? false : result;
    } catch {
      return result;
    }
  }, shouldApply);

  actorProto.applyActiveEffects = markWrapper(function (phase, ...args) {
    let plan = null;
    try {
      if (phase === "initial") {
        actorReports.delete(this);
        accessoryLosers.delete(this);
      }
      if (typeof phase === "string" && isOn()) {
        plan = buildPlan(this, phase);
        actorReports.set(this, [...(actorReports.get(this) ?? []), ...plan.report]);
        if (phase === "initial") {
          const losers = new Map();
          for (const ref of plan.suppressed) {
            if (!ref?.item) continue;
            const entry = losers.get(ref.item) ?? { item: ref.item, value: false, penalty: false };
            entry[ref.field] = true;
            losers.set(ref.item, entry);
          }
          if (losers.size) accessoryLosers.set(this, [...losers.values()]);
        }
      }
    } catch (err) {
      plan = null;
      console.error(`${MODULE_ID} | source-stacking: failed to plan the effects of ${this?.name}`, err);
    }
    const previous = active;
    active = plan?.suppressed.size ? { actor: this, suppressed: plan.suppressed } : null;
    try {
      return applyEffects.call(this, phase, ...args);
    } finally {
      active = previous;
    }
  }, applyEffects);

  // prepareDefense runs inside each actor type's TypeDataModel#prepareDerivedData, before the skills read the
  // armor penalty, so losing accessories are left out for the duration of the call only.
  const prototypes = new Set(
    Object.values(CONFIG.Actor.dataModels ?? {})
      .map((cls) => cls?.prototype)
      .filter((proto) => proto && Object.hasOwn(proto, "prepareDerivedData"))
  );
  for (const proto of prototypes) {
    const prepareDerivedData = proto.prepareDerivedData;
    proto.prepareDerivedData = markWrapper(function (...args) {
      const actor = this.parent;
      const losers = actor && accessoryLosers.get(actor);
      if (!losers?.length || preparing.has(actor)) return prepareDerivedData.apply(this, args);
      preparing.add(actor);
      const restore = [];
      try {
        for (const { item, value, penalty } of losers) {
          const armadura = item.system.armadura;
          restore.push([armadura, armadura.value, armadura.penalidade]);
          if (value) armadura.value = 0;
          if (penalty) armadura.penalidade = 0;
        }
        return prepareDerivedData.apply(this, args);
      } finally {
        for (const [armadura, value, penalty] of restore) {
          armadura.value = value;
          armadura.penalidade = penalty;
        }
        preparing.delete(actor);
      }
    }, prepareDerivedData);
  }

  Hooks.on("createActiveEffect", (effect, options, userId) => onEffectHook(effect, userId));
  Hooks.on("updateActiveEffect", (effect, changes, options, userId) => onEffectHook(effect, userId));
  Hooks.on("deleteActiveEffect", (effect, options, userId) => onEffectHook(effect, userId, false));
  Hooks.on("createItem", (item, options, userId) => onItemHook(item, userId));
  Hooks.on("updateItem", (item, changes, options, userId) => onItemHook(item, userId));
  Hooks.on("deleteItem", (item, options, userId) => onItemHook(item, userId, false));
  Hooks.on("renderActorSheetT20", (app, html) => {
    try {
      markSheet(app, html);
    } catch (err) {
      console.error(`${MODULE_ID} | source-stacking: failed to mark the sheet`, err);
    }
  });
}
