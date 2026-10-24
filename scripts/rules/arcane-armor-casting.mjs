/**
 * Optional rule "Magia arcana de armadura" (#46).
 *
 * Book (Tormenta20 Jogo do Ano, chapter 4, "Armaduras e Magia Arcana", p. 171; Misticismo, p. 121): casting an arcane
 * spell while wearing armor requires a Misticismo test (DC 20 + the spell's PM cost) with the armor penalty. On a
 * failure the spell does not work, but the PM are spent. The system never checks it: ItemT20#roll (T20:8543) spends the
 * PM (T20:8669, without await) and always calls displayCard (T20:8724).
 *
 * This rule wraps ItemT20#displayCard: on a real cast (isCastUse) of an arcane spell by a character in armor, it rolls
 * the test after the system started spending the PM and before the card. A failure posts only the test message, marks
 * the cast as failed on the use's options (cast-outcome.mjs) and returns null, like the system when a use does not
 * happen. Skill training follows the shared contract of #62 (skill-training.mjs); the cost of a training grant
 * (Eclético) is charged in the actor's turn of the mana queue, after the spell's own spend.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { markCastFailed, isCastUse } from "./cast-outcome.mjs";
import { automaticApplied } from "./mana-limit.mjs";
import { withManaTurn } from "./mana-queue.mjs";
import { isTrainedFor, plainUseEffect, skillUseEffects, trainingGrants } from "./skill-training.mjs";

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
const SKILL_KEY = "mist";

const defaultSlugify = (text) => String(text).slugify();

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

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const LOG = `${MODULE_ID} | arcane-armor-casting:`;
const i18n = (key, data) => (data ? game.i18n.format(`T20CP.ArcaneArmor.${key}`, data) : game.i18n.localize(`T20CP.ArcaneArmor.${key}`));

function getMode() {
  try {
    const mode = game.settings.get(MODULE_ID, ARCANE_ARMOR_SETTING);
    return ARCANE_ARMOR_MODES.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

function systemSetting(key, fallback) {
  try {
    return game.settings.get("tormenta20", key);
  } catch {
    return fallback;
  }
}

function toElement(html) {
  if (html instanceof HTMLElement) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

const flagOf = (doc, key) => foundry.utils.getProperty(doc ?? {}, `flags.${MODULE_ID}.${key}`);

/**
 * Requirement for this item and actor, read without changing anything.
 * @param {object} item     The rolled clone (or the dialog's item).
 * @param {{discreet?: boolean}} [extra]
 */
function requirementFor(item, { discreet = false } = {}) {
  const actor = item?.actor;
  if (!actor || item.type !== "magia") return null;
  const items = [...(actor.items ?? [])];
  const classSlugs = items.filter((i) => i.type === "classe").map((i) => defaultSlugify(i.name));
  const armor = wornArmor(items, { equipmentSlots: !!systemSetting("equipmentSlots", false) });
  const requirement = armorTestRequirement({
    actorType: actor.type,
    spellType: item.system?.tipo,
    classSlugs,
    armor,
    waiver: strongestWaiver(items.map((i) => flagOf(i, WAIVER_FLAG))),
    spellFlag: flagOf(item, SPELL_FLAG),
    discreet
  });
  return { actor, armor, requirement };
}

/** The test to roll for this cast, or null. Warns when the source is ambiguous. */
function describeCheck(item, options) {
  const effects = item.applicableOnUseEffects ?? [];
  const discreet = usesDiscreetCasting(effects, appliedEffectIds(options, effects));
  const info = requirementFor(item, { discreet });
  if (!info) return null;
  const { actor, armor, requirement } = info;
  if (requirement.ambiguous) {
    ui.notifications.warn(i18n("Ambiguous", { spell: foundry.utils.escapeHTML(item.name ?? "") }));
    return null;
  }
  if (!requirement.required) return null;
  const cost = Math.max(0, Number(options?.manaCost) || 0);
  return {
    actor,
    armor,
    cost,
    dc: armorTestDC(options?.manaCost),
    penalty: Number(actor.system?.attributes?.defesa?.pda) || 0,
    skill: actor.system?.pericias?.[SKILL_KEY] ?? {}
  };
}

/** Training for the test, through the shared contract of #62 (independent of that rule's mode). */
function trainingFor(actor) {
  const grants = trainingGrants(skillUseEffects(actor, SKILL_KEY).map(plainUseEffect));
  const training = isTrainedFor({
    key: SKILL_KEY,
    skill: actor.system?.pericias?.[SKILL_KEY],
    config: CONFIG.T20?.pericias,
    grants,
    applied: automaticApplied(grants)
  });
  return armorTestTraining(training, {
    treino: actor.system?.attributes?.treino,
    autoSpend: autoSpendOn(),
    pendingGrants: grants.filter((g) => !g.automatic)
  });
}

/** Charges the grant in the actor's turn of the mana queue, after the spell's own spend (T20:8669). */
async function payGrant(actor, cost) {
  return withManaTurn(actor, async ({ spend }) => {
    const pm = actor.system?.attributes?.pm ?? {};
    if (!canPayGrant({ value: pm.value, temp: pm.temp, cost })) return false;
    await spend(cost, 0, false);
    return true;
  });
}

function header(item, check) {
  const escape = foundry.utils.escapeHTML;
  return i18n("Flavor", {
    spell: escape(item.name ?? ""),
    armor: escape(check.armor?.name ?? ""),
    dc: check.dc
  });
}

function reference() {
  return `<p class="t20cp-arcane-armor-ref"><em>${foundry.utils.escapeHTML(i18n("Reference"))}</em></p>`;
}

function grantList(names) {
  const escaped = [...new Set(names.filter(Boolean))].map((n) => foundry.utils.escapeHTML(n));
  try {
    return new Intl.ListFormat(game.i18n.lang, { type: "disjunction" }).format(escaped);
  } catch {
    return escaped.join(" / ");
  }
}

const autoSpendOn = () => !!systemSetting("automaticManaSpend", true);

function failureLine(item, check) {
  return i18n(failureKey({ cost: check.cost, autoSpend: autoSpendOn() }), { spell: foundry.utils.escapeHTML(item.name ?? ""), cost: check.cost });
}

/** Untrained (or unpaid grant): a message without a roll. */
async function postUntrained(item, check, t, messageMode) {
  const escape = foundry.utils.escapeHTML;
  const parts = [`<p><strong>${header(item, check)}</strong></p>`];
  parts.push(`<p>${i18n("Untrained", { actor: escape(check.actor.name ?? "") })}</p>`);
  if (t.unpaid) parts.push(`<p>${i18n("GrantNoMana", { grant: escape(t.grantName ?? "") })}</p>`);
  else if (t.hint?.length) parts.push(`<p>${i18n("UntrainedHint", { grants: grantList(t.hint) })}</p>`);
  parts.push(`<p>${failureLine(item, check)}</p>`, reference());
  const data = {
    content: `<div class="t20cp-arcane-armor">${parts.join("")}</div>`,
    speaker: ChatMessage.getSpeaker({ actor: check.actor }),
    flags: { [MODULE_ID]: { arcaneArmor: { itemId: item.id, dc: check.dc, passed: false, reason: "untrained" } } }
  };
  ChatMessage.applyMode(data, messageMode);
  return ChatMessage.create(data);
}

/**
 * Rolls the test and posts its message.
 * @returns {Promise<{passed: boolean, reason: null|"failed"|"untrained", messageId: string|null}>}
 */
async function rollArmorTest(item, check, rollMode) {
  const messageMode = rollMode || game.settings.get("core", "messageMode");
  let t = trainingFor(check.actor);
  if (t.canRoll && t.grantCost > 0) t = withGrantPayment(t, await payGrant(check.actor, t.grantCost));
  if (!t.canRoll) {
    const message = await postUntrained(item, check, t, messageMode);
    return { passed: false, reason: "untrained", messageId: message?.id ?? null };
  }

  const formula = armorTestFormula({
    skillValue: check.skill.value,
    armorPenalty: check.penalty,
    trainingBonus: t.trainingBonus
  });
  const roll = new foundry.dice.Roll(formula);
  // Evaluated before the message (an unevaluated total is 0), with the same interactive policy as toMessage.
  await roll.evaluate({ allowInteractive: messageMode !== "blind" });
  const natural = roll.dice?.[0]?.total;
  const passed = resolveArmorTest({ natural, total: roll.total, dc: check.dc });

  const escape = foundry.utils.escapeHTML;
  const lines = [`<strong>${header(item, check)}</strong>`];
  if (t.grantName) lines.push(i18n(grantUsedKey({ autoSpend: autoSpendOn(), grantPrice: t.grantPrice }), { grant: escape(t.grantName), cost: t.grantPrice }));
  lines.push(
    passed ? i18n("Success") : failureLine(item, check),
    `<em>${escape(i18n("Reference"))}</em>`
  );
  // The verdict goes in the flavor: an HTML content would replace the rendered dice (ChatMessage#renderRollContent).
  const message = await roll.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor: check.actor }),
      flavor: `<div class="t20cp-arcane-armor ${passed ? "success" : "failure"}">${lines.join("<br>")}</div>`,
      flags: { [MODULE_ID]: { arcaneArmor: { itemId: item.id, dc: check.dc, passed } } }
    },
    { messageMode }
  );
  return { passed, reason: passed ? null : "failed", messageId: message?.id ?? null };
}

function renderDialogLine(app, html) {
  if (getMode() === "off") return;
  const root = toElement(html);
  const total = root?.querySelector(".total-cost");
  if (!total || root.querySelector(".t20cp-arcane-armor-line")) return;
  const info = requirementFor(app.item);
  if (!info) return;
  const { armor, requirement } = info;
  if (!requirement.required && !requirement.ambiguous) return;
  const row = document.createElement("div");
  row.className = "form-group t20cp-arcane-armor-line";
  const label = document.createElement("label");
  label.textContent = i18n("Dialog.Label");
  const value = document.createElement("span");
  value.textContent = requirement.ambiguous
    ? i18n("Dialog.Ambiguous")
    : i18n("Dialog.Value", {
        armor: armor.name ?? "",
        penalty: -Math.abs(Number(info.actor.system?.attributes?.defesa?.pda) || 0)
      });
  row.append(label, value);
  total.after(row);
  app.setPosition?.({ height: "auto" });
}

function renderItemField(app, html) {
  if (getMode() === "off") return;
  const item = app.document ?? app.item;
  const field = item?.type === "magia" ? "Spell" : item?.type === "poder" ? "Waiver" : null;
  if (!field) return;
  const root = toElement(html);
  const costInput = root?.querySelector('input[name="system.ativacao.custo"]');
  const key = field === "Spell" ? SPELL_FLAG : WAIVER_FLAG;
  const name = `flags.${MODULE_ID}.${key}`;
  if (!costInput || root.querySelector(`select[name="${name}"]`)) return;
  const choices = field === "Spell" ? [["", "auto"], ...SPELL_SOURCES.map((s) => [s, s])] : [["", "none"], ...WAIVERS.map((w) => [w, w])];
  const current = String(flagOf(item, key) ?? "");
  const anchor = costInput.closest(".form-group") ?? costInput;
  const row = document.createElement("div");
  row.className = "form-group t20cp-arcane-armor-field";
  const label = document.createElement("label");
  label.textContent = i18n(`${field}Field.Label`);
  label.dataset.tooltip = i18n(`${field}Field.Hint`);
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = name;
  select.disabled = app.isEditable === false;
  for (const [value, labelKey] of choices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = i18n(`${field}Field.${labelKey}`);
    option.selected = value === current;
    select.append(option);
  }
  fields.append(select);
  row.append(label, fields);
  anchor.after(row);
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerArcaneArmorSetting() {
  game.settings.register(MODULE_ID, ARCANE_ARMOR_SETTING, {
    name: "T20CP.ArcaneArmor.Setting.Name",
    hint: "T20CP.ArcaneArmor.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.ArcaneArmor.Setting.off", roll: "T20CP.ArcaneArmor.Setting.roll" },
    default: "off"
  });
}

/**
 * Installs the rule. Must run before installCastingRestrictionsRule, so this displayCard wrapper sits inside that one
 * (which only counts a cast through castCompleted). The mode is read on every use.
 */
export function installArcaneArmorRule() {
  const itemProto = CONFIG.Item?.documentClass?.prototype;
  const original = itemProto?.displayCard;
  if (typeof original !== "function") throw new Error("ItemT20#displayCard not found");

  itemProto.displayCard = markWrapper(async function (...args) {
    const [{ options, rollMode, createMessage = true } = {}] = args;
    let check = null;
    try {
      if (getMode() === "roll" && createMessage && this.type === "magia" && isCastUse(options)) {
        check = describeCheck(this, options);
      }
    } catch (err) {
      console.error(`${LOG} failed to evaluate the armor test`, err);
    }
    if (!check) return original.apply(this, args);
    let outcome;
    try {
      outcome = await rollArmorTest(this, check, rollMode);
    } catch (err) {
      console.error(`${LOG} failed to roll the armor test, the card goes on`, err);
      return original.apply(this, args);
    }
    if (outcome.passed) return original.apply(this, args);
    markCastFailed(options, { rule: "arcane-armor-casting", reason: outcome.reason, messageId: outcome.messageId });
    return null;
  }, original);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      renderDialogLine(app, html);
    } catch (err) {
      console.error(`${LOG} failed to show the dialog line`, err);
    }
  });
  Hooks.on("renderItemSheet", (app, html) => {
    try {
      renderItemField(app, html);
    } catch (err) {
      console.error(`${LOG} failed to add the item field`, err);
    }
  });
}
