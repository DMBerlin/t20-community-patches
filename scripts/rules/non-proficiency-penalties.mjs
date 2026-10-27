/**
 * Optional rule "Penalidades por não proficiência" (#39).
 *
 * Book rules (Tormenta20 Jogo do Ano, ch. 3): attacking with a weapon without proficiency gives -5 on the attack
 * (p. 142); wearing armor or a shield without proficiency applies its armor penalty to every Strength and Dexterity
 * skill (p. 152). Everyone is proficient with simple weapons, light armor, unarmed attacks and natural weapons
 * (p. 32, 142). The system stores proficiencies (system.tracos.profArmas/profArmaduras) but never reads them, and
 * no class or power fills them, so the proficiencies are derived here (initial class, recognized powers, Traits tab)
 * on every use, without writing anything. Characters only: threats have no proficiencies recorded.
 */
import { MODULE_ID, addTooltipLine, markWrapper, sourceFingerprint, unwrap } from "../utils.mjs";
import { APPLY_STATES } from "../registry.mjs";
import { isArmorPenaltyReducer, parseReduction, resolveDataRefs } from "../patches/armor-penalty-reduction.mjs";
import { keyAbility } from "../patches/condition-skill-lists.mjs";
import { allActors } from "./source-stacking.mjs";

export { sourceFingerprint };

export { keyAbility };

export const NON_PROFICIENCY_SETTING = "nonProficiencyRule";
export const WEAPON_PENALTY = -5;
export const PDA_KEY = "system.attributes.defesa.pda";
const WEAPON_CATEGORIES = new Set(["marcial", "exotica", "fogo"]);
const ARMOR_REQUIREMENTS = { pesada: "pes", escudo: "esc" };
const PHYSICAL_ABILITIES = new Set(["for", "des"]);
const MELEE = new Set(["corpo-a-corpo", "corpo-a-corpo-arremesso"]); // T20:14854
const RANGED = new Set(["arremesso", "corpo-a-corpo-arremesso", "disparo"]); // T20:14855
const TWO_HANDED_SLOT = 12;

export const SCOPED = { melee: "marcial-melee", ranged: "marcial-ranged" };
/** Custom entries (Traits tab, weapons) that record a scoped martial proficiency instead of naming a weapon. */
export const RESERVED_CUSTOM = { "marciais corpo a corpo": SCOPED.melee, "marciais a distancia": SCOPED.ranged };
/** Choice candidate: one weapon chosen by name (custom entry). */
export const NAMED = "named";
const CLASS_CANDIDATES = ["marcial", "pes", "esc"];

/** Proficiencies of each class (Tormenta20 Jogo do Ano, ch. 1, "Proficiências"). Ids: tormenta20.classes (1.6.5). */
export const CLASS_PROFICIENCIES = [
  { key: "arcanista", id: "TH7OIKaDqtLLQUrs", weapons: [], armor: [] }, // p. 37
  { key: "barbaro", id: "FiMbJLurhpstUxu1", weapons: ["marcial"], armor: ["esc"] }, // p. 41
  { key: "bardo", id: "u3fr3IOtTXmsk2BT", weapons: ["marcial"], armor: [] }, // p. 44
  { key: "bucaneiro", id: "uvMolF7vcMs0KbQl", weapons: ["marcial"], armor: [] }, // p. 47
  { key: "cacador", id: "xwI9ItqovNe5RMdF", weapons: ["marcial"], armor: ["esc"] }, // p. 50
  { key: "cavaleiro", id: "fzTv6gS1qu4lpstx", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 53
  { key: "clerigo", id: "EnHy1teosvZmcp4D", weapons: [], armor: ["pes", "esc"] }, // p. 57
  { key: "druida", id: "ROLLbOHDe9gWNazQ", weapons: [], armor: ["esc"] }, // p. 61
  { key: "guerreiro", id: "DPhWNP689FygcOSZ", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 65
  { key: "inventor", id: "WAyBowpFRVKRr0mq", weapons: [], armor: [] }, // p. 68
  { key: "ladino", id: "hBx9rVg3XGQ5wsd1", weapons: [], armor: [] }, // p. 73
  { key: "lutador", id: "pBABExUf8ATkRnHM", weapons: [], armor: [] }, // p. 76
  { key: "nobre", id: "kg8tLXlPNJSlwWcc", weapons: ["marcial"], armor: ["pes", "esc"] }, // p. 79
  { key: "paladino", id: "VnjstNLqk1lgxsEn", weapons: ["marcial"], armor: ["pes", "esc"] } // p. 82
];

/** Powers whose text grants proficiencies. Ids: tormenta20.poderes (1.6.5). */
export const POWER_GRANTS = [
  { key: "pistoleiro", id: "EMramxpu1YogEN9u", weapons: ["fogo"] },
  { key: "vanguardista", id: "kV4orwvtjHg0Ao2M", weapons: ["fogo"] },
  { key: "couraceiro", id: "XbndSZpX3PC0tiWv", armor: ["pes", "esc"] },
  { key: "armeiro", id: "hLBSifFJA7jAu7zg", scoped: [SCOPED.melee] },
  { key: "escavador", id: "p4KZ2EwgXEdrLKGp", weaponNames: ["picareta"] },
  { key: "tradicao de samurai", id: "MQVfA5kgyBGEqz3D", weaponNames: ["katana"] },
  { key: "mestre do tridente", id: "FHVUcdvlv8Omr6qv", weaponNames: ["tridente"] },
  { key: "tradicao", id: "ZfvrgyuDZB7CAptc", race: "anao", weaponNames: ["machado", "machadinha", "martelo", "marreta", "picareta"] },
  { key: "proficiencia", id: "AD22Tx3t0ur2lL2e", choice: ["marcial", "exotica", "fogo", "pes", "esc"] },
  { key: "balistica", id: "i5EbR8SrD8UcA7Gz", choice: [SCOPED.ranged, "fogo"] },
  { key: "abencoar arma", id: "GOlzi3jTSSbwVWy4", choice: [NAMED] }
];

/** Normalized source fingerprints of the original methods this rule extends, by system version. */
export const KNOWN_SOURCES = {
  getAttackToHit: { "1.6.5": "a81d1734:2142", "1.6.6": "2497aedc:2281" },
  prepareSkill: { "1.6.5": "3f09d08e:1504", "1.6.6": "3f09d08e:1504" }
};

/** Lowercase, without accents and repeated spaces. */
export function normalizeName(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Entries of a trait's custom field, split by ";" like the system's sheet (T20:13541). */
export function parseCustom(custom) {
  return String(custom ?? "").split(";").map(normalizeName).filter(Boolean);
}

/** An entry covers the item whose name equals it or starts with it followed by a space. */
export function matchesName(name, entries = []) {
  const n = normalizeName(name);
  return Boolean(n) && entries.some((e) => n === e || n.startsWith(`${e} `));
}

/** Last segment of the compendium source (v12+ `_stats.compendiumSource`, legacy `flags.core.sourceId`). */
export function sourceId(doc) {
  return String(doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? "").split(".").pop();
}

/** A table entry matches by compendium id or by name (equal, or followed by " ("); the race, when required, always. */
export function matchesEntry(entry, { id, name, race } = {}) {
  if (entry.race && entry.race !== normalizeName(race)) return false;
  if (id && id === entry.id) return true;
  const n = normalizeName(name);
  return n === entry.key || n.startsWith(`${entry.key} (`);
}

/**
 * Size of a maximum bipartite matching (augmenting paths, Kuhn) between choice copies and Traits entries; each
 * entry resolves at most one copy. Sizes are tiny.
 * @param {string[][]} candidates  Accepted entries of each choice copy.
 * @param {string[]} pool          Entries that no fixed source explains.
 */
export function maxMatching(candidates, pool) {
  const owner = pool.map(() => -1);
  const augment = (i, seen) => {
    for (let j = 0; j < pool.length; j++) {
      if (seen[j] || !candidates[i].includes(pool[j])) continue;
      seen[j] = true;
      if (owner[j] < 0 || augment(owner[j], seen)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  return candidates.filter((_, i) => augment(i, pool.map(() => false))).length;
}

/**
 * Indexes of the choice copies that stay unresolved in at least one maximum matching. Empty when the entries resolve
 * every copy; otherwise any copy that might be the unresolved one is reported, so the result never depends on the
 * order of powers or entries and nothing is penalized by an arbitrary assignment.
 */
export function unresolvedChoices(candidates, pool) {
  const best = maxMatching(candidates, pool);
  if (best === candidates.length) return [];
  return candidates.flatMap((_, i) => (maxMatching(candidates.filter((_, k) => k !== i), pool) === best ? [i] : []));
}

/**
 * Derives the character's proficiencies. Only the initial class counts (p. 35). Powers that let the player choose
 * (Proficiência, Balística, Abençoar Arma) consume one compatible entry of the Traits tab that no other source
 * explains; without one, the choice stays pending and items it could cover are "indeterminate", never penalized.
 * @param {{classes?: {id?: string, name?: string, inicial?: boolean}[], powers?: {id?: string, name?: string}[],
 *          race?: string, traits?: object}} data
 */
export function resolveProficiencies({ classes = [], powers = [], race = "", traits = {} } = {}) {
  const weapons = new Set();
  const armor = new Set();
  const scoped = new Set();
  const weaponNames = [];
  const armorNames = parseCustom(traits.profArmaduras?.custom);
  const pending = [];
  const warnings = [];
  const grant = (def) => {
    def.weapons?.forEach((w) => weapons.add(w));
    def.armor?.forEach((a) => armor.add(a));
    def.scoped?.forEach((s) => scoped.add(s));
    if (def.weaponNames) weaponNames.push(...def.weaponNames);
  };

  const initial = classes.filter((c) => c.inicial);
  const cls = initial.length === 1 ? initial[0] : !initial.length && classes.length === 1 ? classes[0] : null;
  if (cls) {
    const def = CLASS_PROFICIENCIES.find((d) => matchesEntry(d, cls));
    if (def) grant(def);
    else {
      warnings.push({ code: "unknown-class", name: cls.name });
      pending.push({ source: cls.name, candidates: CLASS_CANDIDATES });
    }
  } else if (classes.length) {
    warnings.push({ code: "no-initial-class" });
    pending.push({ source: null, candidates: CLASS_CANDIDATES });
  }

  const choices = [];
  for (const power of powers) {
    const def = POWER_GRANTS.find((d) => matchesEntry(d, { ...power, race }));
    if (def?.choice) choices.push({ def, name: power.name });
    else if (def) grant(def);
  }

  // Entries of the Traits tab are always honored; only the ones that no fixed source (class, powers) already
  // explains can resolve a choice. Unrestricted martial explains both scoped entries; a granted name explains the
  // entries it covers (Tradição de Samurai explains "katana").
  const fixedNames = [...weaponNames];
  const explainedScope = (s) => scoped.has(s) || weapons.has("marcial");
  const pool = [];
  for (const w of traits.profArmas?.value ?? []) if (!weapons.has(w)) pool.push(w);
  for (const a of traits.profArmaduras?.value ?? []) if (!armor.has(a)) pool.push(a);
  const scopedEntries = [];
  for (const entry of parseCustom(traits.profArmas?.custom)) {
    const s = RESERVED_CUSTOM[entry];
    if (s) {
      if (!explainedScope(s)) pool.push(s);
      scopedEntries.push(s);
    } else {
      if (!matchesName(entry, fixedNames)) pool.push(NAMED);
      weaponNames.push(entry);
    }
  }
  scopedEntries.forEach((s) => scoped.add(s));
  (traits.profArmas?.value ?? []).forEach((w) => weapons.add(w));
  (traits.profArmaduras?.value ?? []).forEach((a) => armor.add(a));

  const allowed = (c) => c !== "exotica" || weapons.has("marcial");
  const candidates = choices.map(({ def }) => def.choice.filter(allowed));
  for (const i of unresolvedChoices(candidates, pool)) pending.push({ source: choices[i].name, candidates: candidates[i] });
  return { weapons, armor, scoped, weaponNames, armorNames, pending, warnings };
}

/**
 * @param {{proficiencia?: string, adaptable?: boolean, twoHanded?: boolean}} weapon
 * @returns {string[]}  Accepted proficiencies; empty when none is needed (or the category is unknown).
 */
export function weaponRequirements({ proficiencia, adaptable = false, twoHanded = false }) {
  if (!WEAPON_CATEGORIES.has(proficiencia)) return [];
  if (proficiencia === "exotica" && adaptable && twoHanded) return ["exotica", "marcial"];
  return [proficiencia];
}

/**
 * @param {{name?: string, proficiencia?: string, proposito?: string, adaptable?: boolean, twoHanded?: boolean}} weapon
 * @param {ReturnType<typeof resolveProficiencies>} profs
 * @returns {"ok"|"penalty"|"indeterminate"}
 */
export function weaponStatus(weapon, profs) {
  const accepted = weaponRequirements(weapon);
  if (!accepted.length || matchesName(weapon.name, profs.weaponNames)) return "ok";
  if (accepted.some((c) => profs.weapons.has(c))) return "ok";
  const martial = accepted.includes("marcial");
  const scopes = [MELEE.has(weapon.proposito) && SCOPED.melee, RANGED.has(weapon.proposito) && SCOPED.ranged].filter(Boolean);
  if (martial && scopes.some((s) => profs.scoped.has(s))) return "ok";
  const covers = (c) => c === NAMED || accepted.includes(c) || (martial && scopes.includes(c));
  return profs.pending.some((p) => p.candidates.some(covers)) ? "indeterminate" : "penalty";
}

/**
 * @param {{name?: string, tipo?: string}} item
 * @param {ReturnType<typeof resolveProficiencies>} profs
 * @returns {"ok"|"penalty"|"indeterminate"}
 */
export function armorStatus({ name, tipo }, profs) {
  const required = ARMOR_REQUIREMENTS[tipo];
  if (!required || profs.armor.has(required) || matchesName(name, profs.armorNames)) return "ok";
  return profs.pending.some((p) => p.candidates.includes(required)) ? "indeterminate" : "penalty";
}

/**
 * Armor penalty of one item (<= 0): its base penalty, made worse by its own upgrades (Reforçada, p. 166) and lowered
 * by its reductions (Ajustada, Sob Medida, Mitral) when #19 is applied, never above 0. Equals the item's share of
 * #19's computePenaltyAdjustments (new base plus the increases it does not cancel).
 */
export function itemArmorPenalty({ base = 0, increase = 0, reduction = 0 } = {}) {
  return Math.min(0, -Math.abs(Number(base) || 0) - Math.abs(increase) + Math.abs(reduction)) || 0;
}

/** Extra penalty of one skill. Skills that already apply the armor penalty (pda, T20:19850) never get it again. */
export function skillExtraPenalty({ ability, appliesArmorPenalty = false, penalty = 0 }) {
  if (!penalty || appliesArmorPenalty || !PHYSICAL_ABILITIES.has(ability)) return 0;
  return penalty;
}

/** Recognizes the exact original code; anything else (official change, helper, other module's wrapper) is unknown. */
export function diagnoseSource(name, source, version, known = KNOWN_SOURCES) {
  const fingerprint = sourceFingerprint(source);
  if (fingerprint && known[name]?.[version] === fingerprint) {
    return { bug: "present", confidence: "high", evidence: `${name} is the Tormenta20 ${version} code` };
  }
  return { bug: "unknown", confidence: "low", evidence: `${name} not recognized (${fingerprint ?? "no source"})` };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const LOG = `${MODULE_ID} | non-proficiency-penalties:`;
const UNKNOWN_KEY = "T20CP.NonProficiency.UnknownSource";
const stateByRollData = new WeakMap();
/** Extra penalty added to each skill in the last preparation, by the actor's system data (read by the tooltip). */
const extraBySystem = new WeakMap();
const TOOLTIP_KEY = "T20CP.NonProficiency.TooltipLabel";
const SKILL_TOOLTIP_PATH = /^system\.pericias\.([^.]+)\.bonus$/;
const unrecognized = new Set();
let warned = false;

function isOn() {
  return game.settings.get(MODULE_ID, NON_PROFICIENCY_SETTING) === "on";
}

function warnOnce(err) {
  if (warned) return;
  warned = true;
  console.error(`${LOG} failed, the system's value was kept`, err);
}

function isPatchApplied(id) {
  const entry = game.modules.get(MODULE_ID)?.api?.status?.find((s) => s.id === id);
  return Boolean(entry && APPLY_STATES.has(entry.state));
}

function slotsEnabled() {
  return game.settings.get("tormenta20", "equipmentSlots");
}

/** Same condition as ItemT20#roll for adaptable damage (T20:8553-8556). */
function isTwoHanded(system) {
  return slotsEnabled() ? parseInt(system.equipado2?.slot) === TWO_HANDED_SLOT : system.equipado === 2;
}

function actorProficiencies(actor) {
  const types = actor.itemTypes ?? {};
  return resolveProficiencies({
    classes: (types.classe ?? []).map((c) => ({ id: sourceId(c), name: c.name, inicial: Boolean(c.system?.inicial) })),
    powers: (types.poder ?? []).map((p) => ({ id: sourceId(p), name: p.name })),
    race: types.race?.[0]?.name ?? "",
    traits: actor.system?.tracos ?? {}
  });
}

function weaponStatusOf(item, profs) {
  if (item?.type !== "arma" || item.actor?.type !== "character") return "ok";
  const s = item.system ?? {};
  return weaponStatus(
    {
      name: item.name,
      proficiencia: s.proficiencia,
      proposito: s.proposito,
      adaptable: Boolean(s.propriedades?.ada),
      twoHanded: isTwoHanded(s)
    },
    profs ?? actorProficiencies(item.actor)
  );
}

/** The armor and shield prepareDefense counts (T20:19887-19893), armor first. */
function defenseItems(actor) {
  const slots = slotsEnabled();
  const items = (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
  return [items.find((i) => ["leve", "pesada"].includes(i.system.tipo)), items.find((i) => i.system.tipo === "escudo")]
    .filter(Boolean);
}

/** Same rule as #19's resolveItemId: the owning item, or the item of the effect's origin. */
function effectItemId(actor, effect) {
  const Item = foundry.documents.Item;
  if (effect.parent instanceof Item && effect.parent.parent === actor) return effect.parent.id;
  if (effect.origin) {
    try {
      const origin = foundry.utils.fromUuidSync(effect.origin, { strict: false });
      if (origin instanceof Item && origin.parent === actor) return origin.id;
    } catch {
      /* not resolvable synchronously */
    }
  }
  return null;
}

/**
 * Penalty of each equipped armor and shield, read from the stored item data and the active effects, so it does not
 * depend on #19's temporary change of the item during preparation: the sheet icon and the skills read the same value.
 */
function armorEntries(actor) {
  const items = defenseItems(actor);
  const ids = new Set(items.map((i) => i.id));
  const reductionsOn = isPatchApplied("armor-penalty-reduction");
  const increase = new Map();
  const reduction = new Map();
  let rollData;
  const evaluate = (formula) =>
    foundry.dice.Roll.create(resolveDataRefs(formula, (rollData ??= actor.getRollData()))).evaluateSync().total;
  const add = (map, id, amount) => map.set(id, (map.get(id) ?? 0) + amount);
  for (const effect of actor.allApplicableEffects()) {
    if (!effect.active) continue;
    const reducer = isArmorPenaltyReducer(effect);
    // #19 sends reductions without an item to the armor (or the shield); increases without an item (Sobrecarregado) never count.
    const target = effectItemId(actor, effect) ?? (reducer ? items[0]?.id : null);
    if (!ids.has(target)) continue;
    for (const change of effect.system?.changes ?? []) {
      if (change.key !== PDA_KEY || change.type !== "add") continue;
      if (!effect.shouldApplyChange(change, { phase: "initial" })) continue;
      const amount = parseReduction(change.value, evaluate);
      if (!reducer) add(increase, target, amount);
      else if (reductionsOn) add(reduction, target, amount);
    }
  }
  const profs = actorProficiencies(actor);
  const entries = items.map((item) => ({
    item,
    status: armorStatus({ name: item.name, tipo: item.system.tipo }, profs),
    penalty: itemArmorPenalty({
      base: item._source?.system?.armadura?.penalidade,
      increase: increase.get(item.id) ?? 0,
      reduction: reduction.get(item.id) ?? 0
    })
  }));
  return { profs, entries, penalty: entries.reduce((sum, e) => sum + (e.status === "penalty" ? e.penalty : 0), 0) };
}

function originalSource(fn) {
  return typeof fn === "function" ? Function.prototype.toString.call(unwrap(fn)) : "";
}

function checkSource(name, fn) {
  const diagnosis = diagnoseSource(name, originalSource(fn), game.system.version);
  if (diagnosis.bug === "unknown") {
    unrecognized.add(name);
    console.warn(`${LOG} ${diagnosis.evidence}; installed anyway, check that the system does not apply the penalty too`);
  }
}

function notifyUnrecognized() {
  if (unrecognized.size && game.user?.isGM && isOn()) {
    ui.notifications.warn(game.i18n.format(UNKNOWN_KEY, { methods: [...unrecognized].join(", ") }));
  }
}

function installAttack() {
  const proto = CONFIG.Item?.documentClass?.prototype;
  const original = proto?.getAttackToHit;
  if (typeof original !== "function") throw new Error("ItemT20#getAttackToHit not found");
  checkSource("getAttackToHit", original);
  proto.getAttackToHit = markWrapper(function (...args) {
    const result = original.apply(this, args);
    try {
      if (result?.parts && this.isOwned && isOn() && weaponStatusOf(this) === "penalty") {
        result.parts.push(String(WEAPON_PENALTY));
      }
    } catch (err) {
      warnOnce(err);
    }
    return result;
  }, original);
}

function installSkills() {
  let proto = CONFIG.Actor?.dataModels?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareSkill")) proto = Object.getPrototypeOf(proto);
  const original = proto?.prepareSkill;
  if (typeof original !== "function") throw new Error("prepareSkill not found");
  checkSource("prepareSkill", original);
  proto.prepareSkill = markWrapper(function (skillId, options = {}, ...rest) {
    const skill = original.call(this, skillId, options, ...rest);
    try {
      const actor = this.parent;
      if (skill && actor?.type === "character" && isOn()) {
        // prepareSkills passes the same rollData to every skill (T20:19829-19833): one computation per preparation.
        const key = options?.rollData;
        let state = key && typeof key === "object" ? stateByRollData.get(key) : undefined;
        if (!state) {
          state = armorEntries(actor);
          if (key && typeof key === "object") stateByRollData.set(key, state);
        }
        const extra = skillExtraPenalty({
          ability: keyAbility(skillId, this.pericias?.[skillId], CONFIG.T20?.pericias),
          appliesArmorPenalty: Boolean(skill.pda),
          penalty: state.penalty
        });
        if (extra) skill.value = (Number(skill.value) || 0) + extra;
        let extras = extraBySystem.get(this);
        if (!extras) extraBySystem.set(this, (extras = new Map()));
        extras.set(skillId, extra);
      }
    } catch (err) {
      warnOnce(err);
    }
    return skill;
  }, original);
}

function installSkillTooltip() {
  const original = globalThis.Handlebars?.helpers?.fieldBonuses;
  if (typeof original !== "function") {
    console.warn(`${LOG} Handlebars helper fieldBonuses not found; the skill breakdown will not show the penalty`);
    return;
  }
  Handlebars.registerHelper(
    "fieldBonuses",
    markWrapper(function (path, options) {
      const html = original.call(this, path, options);
      try {
        if (!isOn()) return html;
        const key = SKILL_TOOLTIP_PATH.exec(typeof path === "object" ? path?.string : path)?.[1];
        if (!key) return html;
        // The sheet's own document (the synthetic actor of an unlinked token); the system's helper looks up
        // game.actors by _id first, which returns the base actor for unlinked tokens.
        const sheet = options?.data?.root;
        const actor = sheet?.actor?.system ? sheet.actor : foundry.utils.fromUuidSync(sheet?.uuid) || game.actors?.get(sheet?.actor?._id);
        if (actor?.type !== "character") return html;
        const extra = extraBySystem.get(actor.system)?.get(key) ?? 0;
        return addTooltipLine(html, game.i18n.localize(TOOLTIP_KEY), extra);
      } catch (err) {
        warnOnce(err);
        return html;
      }
    }, original)
  );
}

function tooltipFor(item, weaponState, armor) {
  const pendingSources = () =>
    armor.profs.pending.map((p) => p.source ?? game.i18n.localize("T20CP.NonProficiency.InitialClass")).join(", ");
  if (weaponState === "penalty") return game.i18n.format("T20CP.NonProficiency.Weapon", { penalty: WEAPON_PENALTY });
  if (weaponState === "indeterminate") return game.i18n.format("T20CP.NonProficiency.Pending", { sources: pendingSources() });
  const entry = armor.entries.find((e) => e.item.id === item.id);
  if (entry?.status === "penalty" && entry.penalty) return game.i18n.format("T20CP.NonProficiency.Armor", { penalty: entry.penalty });
  if (entry?.status === "indeterminate" && entry.penalty) {
    return game.i18n.format("T20CP.NonProficiency.Pending", { sources: pendingSources() });
  }
  return "";
}

function markRows(actor, html) {
  if (actor?.type !== "character" || !isOn()) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const armor = armorEntries(actor);
  for (const li of root.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item) continue;
    const weaponState = weaponStatusOf(item, armor.profs);
    const text = tooltipFor(item, weaponState, armor);
    const label = li.querySelector(".item-name label, .item-name");
    if (!text || !label || label.querySelector(".t20cp-nonprof")) continue;
    const pending = weaponState === "indeterminate" || armor.entries.some((e) => e.item.id === item.id && e.status === "indeterminate");
    const icon = document.createElement("i");
    icon.className = `fa-solid ${pending ? "fa-circle-question" : "fa-triangle-exclamation"} t20cp-nonprof`;
    icon.dataset.tooltipText = `${text} (${game.i18n.localize("T20CP.NonProficiency.Reference")})`;
    label.append(" ", icon);
  }
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
export function registerNonProficiencySetting() {
  game.settings.register(MODULE_ID, NON_PROFICIENCY_SETTING, {
    name: "T20CP.NonProficiency.Setting.Name",
    hint: "T20CP.NonProficiency.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.NonProficiency.Setting.off", on: "T20CP.NonProficiency.Setting.on" },
    default: "off",
    onChange: () => {
      refreshActors();
      notifyUnrecognized();
    }
  });
}

/** Installs both wrappers and the sheet marker. The wrappers are inert while the setting is off. */
export function installNonProficiencyRule() {
  installAttack();
  installSkills();
  installSkillTooltip();
  Hooks.once("ready", notifyUnrecognized);
  Hooks.on("renderActorSheetT20", (app, html) => {
    try {
      markRows(app.actor, html);
    } catch (err) {
      warnOnce(err);
    }
  });
}
