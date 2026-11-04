import { addTooltipLine } from "../../lib/tooltip.mjs";
import {
  CONDI_KEY,
  DEFENSE_BONUS_KEY,
  OUTROS_KEY,
  appendLines,
  defenseItemLines,
  muteItemLines,
  residual,
  skillModifierKeys,
  suppressedLines,
  tooltipTotal
} from "../../lib/applied-breakdown.mjs";
import {
  HEAVY_ARMOR_KEY,
  MANUAL_OTHER_KEY,
  MINIMUM_PV_KEY,
  NOT_STACKING_KEY,
  ROUNDING_KEY,
  UNIDENTIFIED_KEY,
  appendTooltipLine,
  applyDefenseSources,
  defenseAbilityDelta,
  defenseSourceLines,
  evaluateValue,
  pvMinimumCompensation,
  removeTooltipLine,
  manualOverrideValue,
  roundingDelta
} from "./domain/index.mjs";

const LOG = "t20-community-patches | field-bonuses-breakdown:";

/**
 * What the HTML builders read from the platform and the applied-changes service; built once by install().
 * @typedef {object} BreakdownEnv
 * @property {(key: string) => string} localize
 * @property {(id: string) => boolean} isActive  Another feature is applied (ctx.features).
 * @property {(message: string, err?: unknown) => void} warnOnce
 * @property {(actor: object) => object[]|null} recordedChanges  Changes of the last published preparation, or null.
 * @property {(actor: object) => object[]} recordedSuppressed
 * @property {(actor: object, path: string) => object[]|undefined} contributions
 * @property {() => boolean} equipmentSlots  The system's "equipmentSlots" setting.
 * @property {(key: string) => string} attributeLabel  Localized name of an attribute (CONFIG.T20.atributos).
 * @property {(formula: string, data: object) => number} evaluate  Roll-based evaluator; never eval.
 * @property {(reason: string) => string} noteOf  Text of a muted line, by reason.
 * @property {WeakMap<object, Set<string>>} reported  Fields already reported as unidentified, per actor.
 */

/** @param {BreakdownEnv} env */
export function heavyArmorLine(env, actor, rollData) {
  const attribute = actor.system?.attributes?.defesa?.atributo;
  if (!attribute) return null;
  const delta = defenseAbilityDelta(abilityData(env, actor, attribute, rollData));
  if (!delta) return null;
  const label = `${env.attributeLabel(attribute)} (${env.localize(HEAVY_ARMOR_KEY)})`;
  return { label, value: delta };
}

/** What defenseAbilityDelta reads: the Defesa attribute and the first equipped light or heavy armor. */
function abilityData(env, actor, attribute, rollData) {
  const slots = env.equipmentSlots();
  const equipped = (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
  const armor = equipped.find((i) => ["leve", "pesada"].includes(i.system.tipo));
  return {
    attribute,
    rollValue: rollData?.[attribute],
    abilityValue: actor.system.atributos?.[attribute]?.value,
    armorType: armor?.system.tipo,
    maxAtr: armor?.system.armadura?.maxAtr,
    helperHeavy: equipped.some((i) => i.system.armadura?.value && i.system.tipo === "pesada")
  };
}

/**
 * The changes applied to defesa.outros and defesa.condi and the ones a feature cut. Without a published cycle, the
 * changes the core would apply (active applicable effects whose shouldApplyChange accepts the change in its phase).
 * @param {BreakdownEnv} env
 */
function defenseChanges(env, actor) {
  const recorded = env.recordedChanges(actor);
  if (recorded) {
    const suppressed = env.recordedSuppressed(actor);
    return {
      outros: recorded.filter((ch) => ch.key === OUTROS_KEY).map(toEntry),
      condi: recorded.filter((ch) => ch.key === CONDI_KEY).map(toEntry),
      skipped: suppressedLines(suppressed, OUTROS_KEY),
      condiSkipped: suppressedLines(suppressed, CONDI_KEY),
      ordered: true
    };
  }
  const outros = [];
  const condi = [];
  for (const effect of [...(actor.allApplicableEffects?.() ?? [])].filter((e) => e?.active)) {
    for (const change of effect.system?.changes ?? []) {
      const entry = appliedEntry(effect, change);
      if (entry) (change.key === OUTROS_KEY ? outros : condi).push(entry);
    }
  }
  return { outros, condi, skipped: [], condiSkipped: [], ordered: false };
}

const toEntry = (ch) => ({ label: ch.label, type: ch.type, value: ch.value, priority: ch.priority, phase: ch.phase ?? "initial" });

/** A defesa.outros or defesa.condi change of the effect the core would apply, as an entry, or null. */
function appliedEntry(effect, change) {
  if (change.key !== OUTROS_KEY && change.key !== CONDI_KEY) return null;
  const phase = change.phase ?? "initial";
  if (typeof effect.shouldApplyChange === "function" && !effect.shouldApplyChange(change, { phase })) return null;
  return toEntry({ ...change, label: effect.name, phase });
}

/** @param {BreakdownEnv} env */
export function defenseSourcesHTML(env, html, actor) {
  const defesa = actor.system?.attributes?.defesa;
  const source = actor._source?.system?.attributes?.defesa;
  if (!defesa || !source) return html;
  const includeCondi = env.isActive("field-bonuses-tooltip");
  const changes = defenseChanges(env, actor);
  const lines = defenseSourceLines({
    sourceOutros: source.outros,
    outrosChanges: changes.outros,
    preparedOutros: defesa.outros,
    // NpcData#prepareBaseData resets `defesa.condi` before the effects (T20:19076).
    condiBase: actor.type === "npc" ? 0 : source.condi,
    condiChanges: changes.condi,
    preparedCondi: defesa.condi,
    skipped: changes.skipped,
    condiSkipped: changes.condiSkipped,
    manualLabel: env.localize(MANUAL_OTHER_KEY),
    condiLabel: env.localize("T20CP.FieldBonuses.Condition"),
    ordered: changes.ordered
  });
  if (!lines) return html;
  return applyDefenseSources(html, {
    preparedOutros: defesa.outros,
    outros: lines.outros,
    condi: includeCondi ? lines.condi : [],
    notStacking: env.localize(NOT_STACKING_KEY),
    noteOf: env.noteOf
  });
}

/** Equipped items as the helper and AttributesFields.prepareDefense (T20:18717) filter them. */
function equippedItems(env, actor) {
  const slots = env.equipmentSlots();
  return (actor.itemTypes?.equipamento ?? [])
    .filter((i) => (slots ? i.system?.equipado2?.slot : i.system?.equipado))
    .map((i) => ({ id: i.id, name: i.name, tipo: i.system?.tipo, value: i.system?.armadura?.value }));
}

/**
 * The Defesa item lines that prepareDefense leaves out, muted, and the Defesa bonuses a feature cut.
 * @param {BreakdownEnv} env
 */
export function defenseItemsHTML(env, html, actor, parts) {
  const suppressed = env.recordedSuppressed(actor);
  if (parts.armorSlots) html = muteItemLines(html, defenseItemLines(equippedItems(env, actor), suppressed), env.noteOf);
  return appendLines(html, suppressedLines(suppressed, DEFENSE_BONUS_KEY), env.noteOf);
}

/**
 * The skill contributions added outside effects and the skill bonuses a feature cut.
 * @param {BreakdownEnv} env
 * @param {{key: string, path: string}} field
 */
export function skillHTML(env, html, actor, { key, path }) {
  if (!env.recordedChanges(actor)) return html;
  const contributions = (env.contributions(actor, path) ?? []).map((c) => ({ label: env.localize(c.label), value: Number(c.value) }));
  const keys = [...skillModifierKeys(key, actor.system?.pericias?.[key]?.atributo), path];
  return appendLines(appendLines(html, contributions), suppressedLines(env.recordedSuppressed(actor), keys), env.noteOf);
}

/**
 * Adds the "Outros (não identificado)" line with what the breakdown still misses to reach the prepared value.
 * @param {BreakdownEnv} env
 * @param {{path: string, prepared: number}} field  prepared: the value on the sheet, minus what an outer wrapper adds
 *   (the tooltip's Condição line).
 */
export function residualHTML(env, html, actor, { path, prepared }) {
  const diff = residual(tooltipTotal(html), prepared);
  if (!diff) return html;
  const fields = env.reported.get(actor) ?? new Set();
  env.reported.set(actor, fields);
  if (!fields.has(path)) {
    fields.add(path);
    console.debug(`${LOG} ${actor.name}: ${path} breakdown misses ${diff} to reach ${prepared}`);
  }
  return appendLines(html, [{ label: env.localize(UNIDENTIFIED_KEY), value: diff }]);
}

/**
 * The prepared value the breakdown of a Defesa or skill path must reach, or NaN.
 * @param {BreakdownEnv} env
 */
export function preparedValue(env, html, actor, { type, key }) {
  if (type === "pericias") return Number(actor.system?.pericias?.[key]?.value);
  const defesa = actor.system?.attributes?.defesa;
  return Number(defesa?.value) - (condiOutside(env, html) ? Number(defesa?.condi) || 0 : 0);
}

/**
 * The helper never lists defesa.condi: field-bonuses-tooltip, when applied, adds it outside, unless this patch
 * listed it. Without that patch the residual line covers it.
 */
const condiOutside = (env, html) =>
  env.isActive("field-bonuses-tooltip") && !(typeof html === "string" && html.includes('data-t20cp="condi"'));

/** The PV minimum preparePVPM applies when the Constituição the helper reads is 0. */
function pvMinimumHTML(env, html, actor, { rollData, context }) {
  const { substituirCon: con = "con" } = actor.flags?.tormenta20 ?? {};
  const ability = context?.system?.atributos?.[con];
  if (!ability || ability.value - ability.bonus) return html;
  const bonus = actor.system.attributes.pv.bonus;
  const sum = (list) =>
    (Array.isArray(list) ? list : []).reduce((total, v) => total + Number(evaluateValue(v, (f) => env.evaluate(f, rollData))), 0);
  const compensation = pvMinimumCompensation({
    classes: (actor.items ?? [])
      .filter((i) => i.type === "classe")
      .map((c) => ({ inicial: c.system.inicial, porNivel: c.system.pvPorNivel, niveis: c.system.niveis })),
    nivel: sum(bonus.nivel),
    nivelPar: sum(bonus.nivelPar),
    nivelImpar: sum(bonus.nivelImpar)
  });
  const label = `${env.attributeLabel(con)} (${env.localize(MINIMUM_PV_KEY)})`;
  return appendTooltipLine(html, label, compensation);
}

/**
 * The PV minimum and the rounding preparePVPM applies, which the helper leaves out.
 * @param {BreakdownEnv} env
 * @param {{type: string, rollData: object, context: object}} field  context: the helper's `this`.
 */
export function resourceHTML(env, html, actor, { type, rollData, context }) {
  if (type === "pv") html = pvMinimumHTML(env, html, actor, { rollData, context });
  return appendTooltipLine(html, env.localize(ROUNDING_KEY), roundingDelta(html));
}

/** The system's "Configuração Manual" line, removed when the manual elements are listed one by one. */
export function manualOverrideHTML(env, html, actor, type) {
  const label = env.localize("T20.ManualOverride");
  return removeTooltipLine(html, label, manualOverrideValue(actor.system.attributes[type].bonus));
}

/** Adds the heavy armor attribute line, if any. */
export function heavyArmorHTML(env, html, actor, rollData) {
  const line = heavyArmorLine(env, actor, rollData);
  return line ? addTooltipLine(html, line.label, line.value) : html;
}
