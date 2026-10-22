/**
 * Breakdown of the attribute values on the actor sheet (tormenta20 1.6.5).
 *
 * Bug: every other value of the sheet (PV, PM, Defesa, perícias) shows its composition on hover, through the
 * `fieldBonuses` helper. The attributes do not: in templates/actor/parts/abilities.hbs the tooltip is wrapped in
 * `{{#if wip}}`, a flag the system never defines, and sits in the content of the `<span>` instead of being an attribute
 * of it. The helper's `atributos` branch (T20:4267-4276) would not help either: it shows a single "Bônus Temporário"
 * with the prepared bonus (manual bonus and every effect summed, no source named) and lists effects on `.value`.
 *
 * Fix: while the actor is prepared, every change the core actually applies to `system.atributos.<key>.(value|bonus)`
 * is recorded in memory with its value before and after (Actor#applyActiveEffects and ActiveEffect.applyChangeField),
 * together with the phase and a snapshot of base, racial and manual bonus taken before the "initial" phase. So the
 * breakdown shows what each effect really added: after `@` references were resolved with the data of that moment,
 * after the field was cleaned (minimum −5), in the core's order and phases, and without the changes the core skipped
 * (auras that do not target the bearer, stacking rules). When an actor sheet renders, each attribute value without a
 * tooltip gets one: Base, Racial, each effect on the value, the manual temporary bonus, each effect on the bonus
 * (summed into the value by prepareAtributos, between the phases), each final-phase effect on the value, and
 * "Outros" for any difference, so the total is always the sheet's value. Nothing is persisted. When the system ships
 * its own tooltip, the element already has one and is left alone.
 */

import { markWrapper } from "../utils.mjs";

const LOG = "t20-community-patches | attribute-breakdown:";
const KEY = /^system\.atributos\.([^.*]+)\.(value|bonus)$/;
const I18N = "T20CP.AttributeBreakdown";
const TEMPLATE = "systems/tormenta20/templates/actor/parts/abilities.hbs";

/**
 * The attribute and field a concrete change key targets (wildcards are expanded by the system before applying).
 * @param {unknown} key
 * @returns {{attribute: string, target: "value"|"bonus"}|null}
 */
export function attributeTarget(key) {
  const match = KEY.exec(typeof key === "string" ? key : "");
  return match ? { attribute: match[1], target: match[2] } : null;
}

/**
 * Records an applied change in an attribute log; changes that did not move the value are left out.
 * @param {{entries: Record<string, object[]>}} log
 * @param {object} entry
 * @param {string} entry.key       Concrete change key.
 * @param {string} entry.phase     Application phase.
 * @param {string} [entry.label]   Effect name.
 * @param {string} [entry.type]    Change type.
 * @param {unknown} entry.before
 * @param {unknown} entry.after
 * @returns {boolean} Whether it was recorded.
 */
export function recordChange(log, { key, phase, label, type, before, after }) {
  const target = attributeTarget(key);
  const delta = Number(after) - Number(before);
  if (!target || typeof before !== "number" || typeof after !== "number" || !Number.isFinite(delta) || !delta) return false;
  (log.entries[target.attribute] ??= []).push({ phase, target: target.target, label: String(label ?? ""), type, delta });
  return true;
}

/**
 * Lines of the breakdown of one attribute. Value and bonus changes of the "initial" phase add up independently
 * (prepareAtributos sums the bonus into the value afterwards); later phases only count on the value. "Outros"
 * closes any gap with the prepared value, so the lines always add up to the sheet.
 * @param {object} input
 * @param {{base?: number, racial?: number, value?: number}} input.prepared  Prepared system.atributos.<key>.
 * @param {{base?: number, racial?: number, bonus?: number}} [input.start]   Snapshot before the "initial" phase.
 * @param {number} [input.sourceBonus]   Persisted manual bonus, used without a snapshot.
 * @param {{phase: string, target: "value"|"bonus", label: string, type?: string, delta: number}[]} [input.entries]
 * @returns {{lines: {key?: string, label?: string, value: number, type?: string}[], total: number}}
 */
export function attributeBreakdown({ prepared, start, sourceBonus = 0, entries = [] }) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const total = num(prepared?.value);
  const base = num(start ? start.base : prepared?.base);
  const racial = num(start ? start.racial : prepared?.racial);
  const manual = num(start ? start.bonus : sourceBonus);
  const lines = [{ key: "Base", value: base }];
  if (racial) lines.push({ key: "Racial", value: racial });
  const effects = (filter) => {
    for (const e of entries) if (filter(e)) lines.push({ label: e.label, value: e.delta, type: e.type });
  };
  effects((e) => e.phase === "initial" && e.target === "value");
  if (manual) lines.push({ key: "Temporary", value: manual });
  effects((e) => e.phase === "initial" && e.target === "bonus");
  effects((e) => e.phase !== "initial" && e.target === "value");
  const gap = total - lines.reduce((sum, line) => sum + line.value, 0);
  if (gap) lines.push({ key: "Other", value: gap });
  return { lines, total };
}

const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The tooltip HTML, in the markup of the system's breakdowns (`ul.fieldBonuses`, T20:4455-4461).
 * @param {ReturnType<typeof attributeBreakdown>} breakdown
 * @param {(key: string) => string} localize  Localizes a key (Base, Racial, Temporary, Other, Total, Type.<type>).
 * @returns {string}
 */
export function breakdownHTML({ lines, total }, localize) {
  const items = lines.map((line) => {
    const label = line.label ?? localize(line.key);
    const mark = ["override", "upgrade", "downgrade", "multiply"].includes(line.type) ? ` (${localize(`Type.${line.type}`)})` : "";
    return `<li class="flexrow"><label>${escapeHTML(label + mark)}:</label><span>${signed(line.value)}</span></li>`;
  });
  return `<ul class="fieldBonuses">${items.join("")}<hr><li class="flexrow"><label>${escapeHTML(localize("Total"))}:</label><span>${signed(total)}</span></li></ul>`;
}

/**
 * Reads the abilities template: the value has a tooltip only inside `{{#if wip}}`.
 * @param {string|undefined} source
 * @returns {import("../registry.mjs").Diagnosis|undefined}
 */
export function diagnoseTemplate(source) {
  if (typeof source !== "string" || !source.includes("atributo-value")) return undefined;
  const live = source.replace(/{{#if\s+wip}}[\s\S]*?{{\/if}}/g, "");
  if (/data-tooltip/.test(live)) return { bug: "fixed", confidence: "low", evidence: `${TEMPLATE}: attribute tooltip outside {{#if wip}}` };
  if (/{{#if\s+wip}}[^{]*data-tooltip/.test(source)) return { bug: "present", confidence: "high", evidence: `${TEMPLATE}: attribute tooltip only under {{#if wip}}` };
  return { bug: "present", confidence: "low", evidence: `${TEMPLATE}: no attribute tooltip` };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let warned = false;
const warn = (...args) => {
  if (!warned) console.warn(LOG, ...args);
  warned = true;
};

/** Actor → {phase, start, entries}; rebuilt on every "initial" phase, in memory only. */
const logs = new WeakMap();

function snapshot(actor) {
  const start = {};
  for (const [key, abl] of Object.entries(actor.system?.atributos ?? {})) {
    start[key] = { base: abl?.base, racial: abl?.racial, bonus: abl?.bonus };
  }
  return start;
}

function decorate(app, html) {
  const actor = app?.actor;
  const root = typeof html?.querySelectorAll === "function" ? html : html?.[0];
  if (!actor?.system?.atributos || !root?.querySelectorAll) return;
  const localize = (key) => game.i18n.localize(`${I18N}.${key}`);
  const log = logs.get(actor);
  for (const li of root.querySelectorAll("li.ability[data-item-id]")) {
    const key = li.dataset.itemId;
    const value = li.querySelector(".atributo-value");
    const target = value?.closest("span") ?? value;
    const prepared = actor.system.atributos[key];
    if (!target || !prepared || target.dataset.tooltip !== undefined || target.dataset.tooltipHtml !== undefined) continue;
    try {
      const breakdown = attributeBreakdown({
        prepared,
        start: log?.start?.[key],
        sourceBonus: actor._source?.system?.atributos?.[key]?.bonus ?? 0,
        entries: log?.entries?.[key] ?? []
      });
      target.dataset.tooltipHtml = breakdownHTML(breakdown, localize);
      target.dataset.tooltipDirection ??= "LEFT";
    } catch (err) {
      warn("could not build the breakdown", actor.uuid, key, err);
    }
  }
}

function apply() {
  const EffectClass = CONFIG.ActiveEffect?.documentClass;
  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  const applyChangeField = EffectClass?.applyChangeField;
  const applyActiveEffects = actorProto?.applyActiveEffects;
  if (typeof applyChangeField !== "function") throw new Error("ActiveEffect.applyChangeField not found");
  if (typeof applyActiveEffects !== "function") throw new Error("Actor#applyActiveEffects not found");

  actorProto.applyActiveEffects = markWrapper(function (phase, ...args) {
    let log;
    try {
      if (phase === "initial") logs.set(this, { phase: null, start: snapshot(this), entries: {} });
      log = logs.get(this);
    } catch (err) {
      warn("could not start the log", err);
    }
    const previous = log?.phase;
    if (log) log.phase = phase;
    try {
      return applyActiveEffects.call(this, phase, ...args);
    } finally {
      if (log) log.phase = previous;
    }
  }, applyActiveEffects);

  EffectClass.applyChangeField = markWrapper(function (targetDoc, change, options) {
    const log = targetDoc ? logs.get(targetDoc) : undefined;
    if (!log?.phase || !attributeTarget(change?.key)) return applyChangeField.apply(this, arguments);
    let before;
    try {
      before = foundry.utils.getProperty(targetDoc, change.key);
    } catch (err) {
      warn("could not read the attribute", err);
    }
    const result = applyChangeField.apply(this, arguments);
    try {
      const after = options?.modifyTarget === false ? result : foundry.utils.getProperty(targetDoc, change.key);
      recordChange(log, { key: change.key, phase: log.phase, label: change.effect?.name, type: change.type, before, after });
    } catch (err) {
      warn("could not record the change", err);
    }
    return result;
  }, applyChangeField);

  Hooks.on("renderActorSheet", decorate);
}

function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "the sheet template is only readable after ready" };
}

/** @returns {Promise<import("../registry.mjs").Diagnosis|undefined>} */
async function lateProbe() {
  try {
    const response = await fetch(foundry.utils.getRoute(TEMPLATE));
    return response.ok ? diagnoseTemplate(await response.text()) : undefined;
  } catch (err) {
    return undefined;
  }
}

export default {
  id: "attribute-breakdown",
  group: "sheet-effects",
  issue: 72,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  lateProbe,
  apply
};
