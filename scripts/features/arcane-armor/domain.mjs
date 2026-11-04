/**
 * Pure logic of the "Magia arcana de armadura" rule (#46): worn armor, spell sources, whether the test is required,
 * its DC, formula and result, training and grant payment, and the applied usage effects.
 */

export const ARCANE_ARMOR_SETTING = "arcaneArmorRule";
export const ARCANE_ARMOR_MODES = ["off", "roll"];
/** Spell items: "" (automatic) | "arcane" | "bard" | "exempt". */
export const SPELL_FLAG = "arcaneArmorSource";
export const SPELL_SOURCES = ["arcane", "bard", "exempt"];
/** Any item of the actor: "" | "light" | "all". */
export const WAIVER_FLAG = "arcaneArmorWaiver";
export const WAIVERS = ["light", "all"];
export const DIVINE_CLASSES = new Set(["clerigo", "druida"]);
export const DISCREET_SLUG = "magia-discreta";
export const SKILL_KEY = "mist";

export const defaultSlugify = (text) => String(text).slugify();

/** Worn armor, as AttributesFields.prepareDefense picks it (T20:19887-19892). Shields alone do not count. */
export function wornArmor(items, { equipmentSlots = false } = {}) {
  for (const item of items ?? []) {
    if (item?.type !== "equipamento") continue;
    const worn = equipmentSlots ? !!Number(item.system?.equipado2?.slot) : !!item.system?.equipado;
    if (worn && ["leve", "pesada"].includes(item.system?.tipo)) return { name: item.name, tipo: item.system.tipo };
  }
  return null;
}

/**
 * Possible sources of the spell (p. 170: the class that taught the spell says what kind of magic is cast). A known
 * item flag wins; otherwise they are inferred from the spell type and the actor's classes.
 * @returns {("arcane"|"bard"|"exempt")[]}
 */
export function spellSources({ spellType, classSlugs, flag }) {
  if (SPELL_SOURCES.includes(flag)) return [flag];
  if (!["arc", "uni"].includes(spellType)) return ["exempt"];
  const slugs = new Set(classSlugs ?? []);
  const sources = new Set();
  if (slugs.has("arcanista")) sources.add("arcane");
  if (slugs.has("bardo")) sources.add("bard");
  if (spellType === "uni" && [...DIVINE_CLASSES].some((c) => slugs.has(c))) sources.add("exempt");
  // A race, power or item granted it.
  if (!sources.size) sources.add("exempt");
  return [...sources];
}

/** @returns {"required"|"not-arcane"|"waiver-all"|"waiver-light"|"bard-light"} */
export function outcomeForSource(source, { armorTipo, waiver }) {
  if (source === "exempt") return "not-arcane";
  if (waiver === "all") return "waiver-all";
  if (armorTipo === "leve" && waiver === "light") return "waiver-light";
  if (armorTipo === "leve" && source === "bard") return "bard-light";
  return "required";
}

/** The broadest waiver among the actor's items: "all" > "light" > "". */
export function strongestWaiver(values) {
  let result = "";
  for (const value of values ?? []) {
    if (value === "all") return "all";
    if (value === "light") result = "light";
  }
  return result;
}

/**
 * Whether the cast requires the test. Sources that disagree (one requires, another does not) are ambiguous: no test,
 * because a wrong failure takes away the spell and the PM for good.
 * @returns {{required: boolean, reason: string, ambiguous?: boolean}}
 */
export function armorTestRequirement({ actorType, spellType, classSlugs, armor, waiver, spellFlag, discreet }) {
  if (actorType !== "character") return { required: false, reason: "not-character" };
  if (!armor) return { required: false, reason: "no-armor" };
  if (discreet) return { required: false, reason: "discreet" };
  const outcomes = new Set(
    spellSources({ spellType, classSlugs, flag: spellFlag }).map((source) =>
      outcomeForSource(source, { armorTipo: armor.tipo, waiver })
    )
  );
  const required = outcomes.has("required");
  if (required && outcomes.size > 1) return { required: false, reason: "ambiguous", ambiguous: true };
  if (required) return { required: true, reason: "required" };
  return { required: false, reason: [...outcomes][0] };
}

/** DC 20 + PM of the cast (options.manaCost; null, NaN or negative count as 0). */
export function armorTestDC(manaCost) {
  const cost = Number(manaCost);
  return 20 + (Number.isFinite(cost) && cost > 0 ? cost : 0);
}

/**
 * Formula of the test, with each term visible: 1d20 + Misticismo + armor penalty (always ≤ 0) + training bonus.
 * Zero terms other than the skill are omitted.
 */
export function armorTestFormula({ skillValue, armorPenalty, trainingBonus = 0 }) {
  const term = (n) => (n < 0 ? ` - ${Math.abs(n)}` : ` + ${n}`);
  const skill = Math.trunc(Number(skillValue) || 0);
  const penalty = -Math.abs(Math.trunc(Number(armorPenalty) || 0));
  const bonus = Math.trunc(Number(trainingBonus) || 0);
  let formula = `1d20${term(skill)}`;
  if (penalty) formula += term(penalty);
  if (bonus) formula += term(bonus);
  return formula;
}

/**
 * Consumes isTrainedFor (#62). autoSpend = setting tormenta20.automaticManaSpend (rollPericia only charges a grant's
 * cost with it on, T20:7680-7683).
 * grantCost is what this module charges; grantPrice is the grant's nominal cost, shown to deduct by hand when off.
 * @returns {{canRoll: boolean, trainingBonus: number, grantCost: number, grantPrice: number, grantName: string|null,
 *   reason: null|"untrained", hint: string[]}}
 */
export function armorTestTraining(training, { treino, autoSpend, pendingGrants = [] }) {
  if (!training?.trained) {
    return { canRoll: false, trainingBonus: 0, grantCost: 0, grantPrice: 0, grantName: null, reason: "untrained", hint: pendingGrants.map((g) => g.name) };
  }
  const grant = training.grant;
  if (!grant) return { canRoll: true, trainingBonus: 0, grantCost: 0, grantPrice: 0, grantName: null, reason: null, hint: [] };
  const grantPrice = Math.max(0, Number(grant.custo) || 0);
  return {
    canRoll: true,
    trainingBonus: grant.kind === "bonus" ? Number(treino) || 0 : 0,
    grantCost: autoSpend ? grantPrice : 0,
    grantPrice,
    grantName: grant.name ?? null,
    reason: null,
    hint: []
  };
}

/** Whether the confirmed balance (PM + temporary PM) covers the grant's cost. */
export function canPayGrant({ value, temp, cost }) {
  return (Number(value) || 0) + (Number(temp) || 0) >= Math.max(0, Number(cost) || 0);
}

/** A grant that could not be paid is not granted: the test becomes an untrained failure. */
export function withGrantPayment(t, paid) {
  if (!t.canRoll || t.grantCost <= 0 || paid) return t;
  return { canRoll: false, trainingBonus: 0, grantCost: 0, grantPrice: t.grantPrice ?? 0, grantName: t.grantName, reason: "untrained", hint: [], unpaid: true };
}

/**
 * i18n key of the failure line. The system only spends the spell's PM with automaticManaSpend on (T20:8760); with it
 * off, the PM are still lost (p. 171), so the player is told to deduct them.
 */
export function failureKey({ cost, autoSpend }) {
  if (!(Number(cost) > 0)) return "FailureFree";
  return autoSpend ? "Failure" : "FailureManual";
}

/** i18n key of the "used grant" line: charged by the module, or to deduct by hand. */
export function grantUsedKey({ autoSpend, grantPrice }) {
  if (!(Number(grantPrice) > 0)) return "GrantUsedFree";
  return autoSpend ? "GrantUsed" : "GrantUsedManual";
}

/** Book p. 221: a natural 20 always succeeds and a natural 1 always fails; otherwise total ≥ DC. */
export function resolveArmorTest({ natural, total, dc }) {
  if (natural === 20) return true;
  if (natural === 1) return false;
  return Number(total) >= Number(dc);
}

const isApplied = (value) => value === true || Number(value) > 0;

/**
 * Ids of the applied usage effects: options.aprs from the dialog (expanded, or flat "aprs.<id>.aplica" keys), or the
 * "Aplicar Sempre" effects when the item was used without the dialog.
 * @returns {Set<string>}
 */
export function appliedEffectIds(options, effects) {
  const aprs = options?.aprs;
  if (aprs && typeof aprs === "object") {
    return new Set(Object.entries(aprs).filter(([, v]) => isApplied(v?.aplica)).map(([id]) => id));
  }
  const flat = Object.entries(options ?? {}).filter(([key]) => /^aprs\.[^.]+\.aplica$/.test(key));
  if (flat.length) return new Set(flat.filter(([, v]) => isApplied(v)).map(([key]) => key.split(".")[1]));
  return new Set((effects ?? []).filter((ef) => ef?.system?.abilityUse?.automatic).map((ef) => ef.id));
}

/** Magia Discreta applied, recognized by the name of the effect or of the item that grants it. */
export function usesDiscreetCasting(effects, appliedIds, slugify = defaultSlugify) {
  return (effects ?? []).some(
    (ef) => appliedIds.has(ef?.id) && [ef?.name, ef?.parent?.name].some((n) => n && slugify(String(n)) === DISCREET_SLUG)
  );
}
