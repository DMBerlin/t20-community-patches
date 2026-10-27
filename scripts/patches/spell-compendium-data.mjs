/**
 * Spell usage effects whose compendium data diverges from the core rulebook (tormenta20 1.6.5).
 *
 * Bug: in `tormenta20.magias`, 18 usage effects carry wrong data: the Curar Ferimentos cantrip keeps the 2d8+2
 * healing roll, Sono moves the target change to the wrong enhancement, the Raio do Enfraquecimento cantrip offers
 * Exausto while its +5 PM enhancement does nothing, Arma Mágica's "+2d6" costs 5 PM, and 12 enhancements have
 * the "multiple applications" flag (`abilityUse.aumenta`) swapped.
 *
 * Fix: in memory only, while each effect is prepared. An effect is corrected only when its id and its whole
 * source (description, usage settings and changes, field by field) still match the buggy data. Nothing is saved;
 * edited or upstream-fixed effects are left untouched.
 */
import { markWrapper } from "../utils.mjs";

const PACK_ID = "tormenta20.magias";

/** A complete ActiveEffect change; also used as fingerprint (every field is compared). */
const change = (key, type, value, priority = null) => ({ key, type, value, phase: "initial", priority });

/**
 * Spell usage effects whose source data diverges from the core rulebook (cap. 4).
 * `description` is the exact source description; `match` is the rest of the buggy source fingerprint;
 * `fix` holds the corrected values.
 */
export const SPELL_FIXES = [
  {
    item: "soVAGPRWQmKxOrPm", effect: "E5Ynb8D45IFPkqGc", spell: "Curar Ferimentos",
    description: "<p>muda o alvo para 1 morto-vivo. Em vez do normal, causa 1d8 pontos de dano de luz (Vontade reduz à metade).</p>",
    match: { aumenta: false, custo: null, changes: [change("alvo", "override", "1 morto-vivo")] },
    fix: { changes: [
      change("alvo", "override", "1 morto-vivo"),
      change("dano", "override", "1d8"),
      change("tipoDano", "override", "luz"),
      change("resistencia", "override", "Vontade reduz à metade")
    ] }
  },
  {
    item: "vTVcrCjSdnOmcIyi", effect: "2RSritpp09rILvcN", spell: "Sono",
    description: "<p>alvos que falhem na resistência ficam exaustos por 1d4+1 rodadas, em vez de apenas 1.</p>",
    match: { aumenta: false, custo: 2, changes: [change("alvo", "override", "área de quadrado com 3m de lado", 0)] },
    fix: { changes: [] }
  },
  {
    item: "vTVcrCjSdnOmcIyi", effect: "NiU1L1ieGobYHI7J", spell: "Sono",
    description: "<p>muda o alvo para criatura.</p>",
    match: { aumenta: false, custo: 2, changes: [] },
    fix: { changes: [change("alvo", "override", "1 criatura")] }
  },
  {
    item: "hikpz9g3jwJoTcRZ", effect: "h9YSgDixO3JIQakZ", spell: "Raio do Enfraquecimento",
    description: "<p>muda o alcance para toque e a resistência para Fortitude anula. Em vez do normal, sua mão emana um brilho púrpura e, ao tocar o alvo, ele fica fatigado.</p>",
    match: { aumenta: false, custo: null, changes: [
      change("alcance", "override", "Toque", 0),
      change("resistencia", "override", "Fortitude anula", 0),
      change("condicao", "custom", "fatigado", 0),
      change("condicao", "custom", "exausto", 0)
    ] },
    fix: { changes: [
      change("alcance", "override", "Toque", 0),
      change("resistencia", "override", "Fortitude anula", 0),
      change("condicao", "custom", "fatigado", 0)
    ] }
  },
  {
    item: "hikpz9g3jwJoTcRZ", effect: "k2YDfSRA8tF21vZB", spell: "Raio do Enfraquecimento",
    description: "<p>como acima, mas muda o alvo para criaturas escolhidas. Requer 3º círculo.</p>",
    match: { aumenta: false, custo: 5, changes: [] },
    fix: { changes: [
      change("alvo", "override", "criaturas escolhidas"),
      change("condicao", "custom", "exausto"),
      change("condicao", "custom", "fatigado")
    ] }
  },
  {
    item: "YDxLaaDhfXOkSfnF", effect: "RZOdJ2cuNeEPfdQ7", spell: "Arma Mágica",
    description: "<p>muda o bônus de dano do aprimoramento acima para +2d6.</p>",
    match: { aumenta: false, custo: 5, changes: [change("dano", "add", "2d6", 0)] },
    fix: { custo: 3, changes: [change("dano", "add", "1d6", 0)] }
  },
  ...[
    ["1vuNzDBJlqRDs5CC", "pVG32GDV7m40z4aG", "Condição", "<p>muda a duração para um dia.</p>", 1,
      [change("duracao", "override", "1 dia")]],
    ["61DlFBtjlb6uFRhj", "8fIIee8yUTGkBZwd", "Ilusão Lacerante", "<p>muda a área para um cubo de 90m. Requer 4º círculo.</p>", 4, []],
    ["9Dw4t70KSmIOWiDg", "s8a46dyo05cIfakD", "Missão Divina", "<p>muda a duração para 1 ano ou até ser descarregada.</p>", 4,
      [change("duracao", "override", "1 ano ou até ser descarregada")]],
    ["ZzibqJnR2Cd0efWX", "v9QZtJ7jjE7Vl6ik", "Convocação Instantânea",
      "<p>muda o alvo para 1 objeto de até 10 espaços. Um objeto muito grande ou pesado para aparecer em suas mãos surge em um espaço adjacente a sua escolha.</p>", 2, []],
    ["g48EeeYhek5Wh5Ll", "uePHR4uObPuqI2va", "Leque Cromático", "<p>além do normal, as criaturas afetadas ficam vulneráveis pela cena.</p>", 2, []],
    ["cgJPXzVbOQLjyXfe", "TXbZz91XvGCAtmTP", "Físico Divino", "<p>+2 em Força</p>", 0, [change("system.atributos.for.bonus", "add", 2, 0)]],
    ["cgJPXzVbOQLjyXfe", "bBshs5Hf8uEhDIAv", "Físico Divino", "<p>+2 em Destreza</p>", 0, [change("system.atributos.des.bonus", "add", 2, 0)]],
    ["cgJPXzVbOQLjyXfe", "wqOXTqAQYZRk92CG", "Físico Divino", "<p>+2 em Constituição</p>", 0, [change("system.atributos.con.bonus", "add", 2, 0)]],
    ["L14jqsUhL7vvpmDM", "gvGWIMqoEX8nca8r", "Mente Divina", "<p>+2 Inteligência</p>", 0, [change("system.atributos.int.bonus", "add", 2, 0)]],
    ["L14jqsUhL7vvpmDM", "4Ovv73nGbtKp4TnX", "Mente Divina", "<p>+2 Sabedoria</p>", 0, [change("system.atributos.sab.bonus", "add", 2, 0)]],
    ["L14jqsUhL7vvpmDM", "EYuxCHv7zn3CVSNg", "Mente Divina", "<p>+2 Carisma</p>", 0, [change("system.atributos.car.bonus", "add", 2, 0)]]
  ].map(([item, effect, spell, description, custo, changes]) => ({
    item, effect, spell, description,
    match: { aumenta: true, custo, changes },
    fix: { aumenta: false }
  })),
  {
    item: "9A5LyhPsCrdowfcL", effect: "8eo5YfHSFivsjjan", spell: "Queda Suave",
    description: "<p>aumenta a categoria de tamanho do alvo em uma.</p>",
    match: { aumenta: false, custo: 2, changes: [] },
    fix: { aumenta: true }
  }
];

const FIXES_BY_EFFECT = new Map(SPELL_FIXES.map((entry) => [entry.effect, entry]));
const CHANGE_FIELDS = ["key", "type", "value", "phase", "priority"];

/**
 * Whether an effect source (`ActiveEffect#_source`) still has exactly the buggy compendium data: same type,
 * description, usage settings (onuse, automatic, names, types "self", aumenta, custo) and changes, field by
 * field. No equivalence is assumed: any edit makes it fail.
 * @param {object} source
 * @param {(typeof SPELL_FIXES)[number]} entry
 */
export function matchesFingerprint(source, { description, match }) {
  if (source?.type !== "base" || source.description !== description) return false;
  const system = source.system ?? {};
  const use = system.abilityUse ?? {};
  if (system.onuse !== true || use.automatic !== false || use.aumenta !== match.aumenta || use.custo !== match.custo) return false;
  if (use.description !== "" || use.names?.length !== 0 || use.types?.length !== 1 || use.types[0] !== "self") return false;
  const changes = system.changes ?? [];
  return changes.length === match.changes.length
    && match.changes.every((expected, i) => CHANGE_FIELDS.every((field) => changes[i]?.[field] === expected[field]));
}

/**
 * Finds the fix for a spell usage effect, or null. The item id is not compared: world and actor copies keep the
 * embedded effect ids (`keepEmbeddedIds`) but get new item ids.
 * @param {{itemType?: string, effectId?: string, source?: object}} data
 */
export function findSpellFix({ itemType, effectId, source }) {
  if (itemType !== "magia") return null;
  const entry = FIXES_BY_EFFECT.get(effectId);
  return entry && matchesFingerprint(source, entry) ? entry : null;
}

/**
 * Applies a fix, in memory, to a prepared effect system. Changes are fresh copies (the system mutates them).
 * @param {{abilityUse: object, changes: object[]}} system
 * @param {(typeof SPELL_FIXES)[number]} entry
 */
export function applySpellFix(system, { fix }) {
  if ("aumenta" in fix) system.abilityUse.aumenta = fix.aumenta;
  if ("custo" in fix) system.abilityUse.custo = fix.custo;
  if (fix.changes) system.changes = fix.changes.map((c) => ({ ...c }));
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function apply() {
  const Model = CONFIG.ActiveEffect?.dataModels?.base;
  const original = Model?.prototype?.prepareBaseData;
  if (typeof original !== "function") throw new Error("Tormenta20 effect data model not found");

  Model.prototype.prepareBaseData = markWrapper(function (...args) {
    let effect;
    try {
      effect = this.parent;
      const entry = findSpellFix({ itemType: effect?.parent?.type, effectId: effect?.id, source: effect?._source });
      if (entry) applySpellFix(this, entry);
    } catch (err) {
      console.warn("t20-community-patches | spell-compendium-data: could not fix", effect?.id, err);
    }
    return original.apply(this, args);
  }, original);
}

/** The bug lives in compendium data, which is only readable after "ready". */
function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data is only readable after ready" };
}

/** @returns {Promise<import("../registry.mjs").Diagnosis|undefined>} */
async function lateProbe() {
  const pack = game.packs.get(PACK_ID);
  if (!pack) return undefined;
  const found = [];
  for (const itemId of new Set(SPELL_FIXES.map((entry) => entry.item))) {
    const item = await pack.getDocument(itemId);
    for (const effect of item?.effects ?? []) {
      const entry = findSpellFix({ itemType: item.type, effectId: effect.id, source: effect._source });
      if (entry) found.push(`${entry.spell}/${entry.effect}`);
    }
  }
  if (found.length) return { bug: "present", confidence: "high", evidence: `${PACK_ID}: ${found.join(", ")}` };
  return { bug: "fixed", confidence: "low", evidence: `${PACK_ID}: no buggy effect found; world copies may still be buggy` };
}

export default {
  id: "spell-compendium-data",
  group: "items",
  issue: 32,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
