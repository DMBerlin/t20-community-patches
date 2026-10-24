/**
 * Lethal or nonlethal attack choice (#74), part of the optional rule "Dano não letal" (#55).
 *
 * Book p. 236: using a weapon to deal nonlethal damage gives -5 on the attack test; unarmed attacks and certain
 * weapons deal nonlethal damage, and using them to deal lethal damage gives the same -5. Ataque Piedoso (p. 132),
 * Estilo Desarmado (p. 128) and Pão e Circo (p. 91) waive the penalty within their own limits.
 *
 * - Use dialog of weapons with attack and damage: a "Dano" line (Letal / Não letal), the weapon's natural type
 *   selected. The choice goes in the dialog options (FormDataExtended, T20:6806).
 * - ItemT20#rollAttack: the penalty goes in the formula of the per-use clone, with a label, like #59.
 * - ItemT20#rollDamage: the damage rolls record the choice; the chat toggle of #55 starts pressed from it.
 * - Shortcut without dialog: the natural type, no penalty.
 * - Only the per-use clone of ItemT20#roll (shared/targets.mjs): direct calls of rollAttack/rollDamage on a document
 *   keep the official behavior.
 * - Weapon sheet: the "Dano natural" field (Automático / Letal / Não letal).
 * Everything is gated by the "Dano não letal" setting, read on every use.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { matchesSource } from "../patches/spell-dc-bonus.mjs";
import { ROLL_DATA_KEY, ruleEnabled } from "./nonlethal-damage.mjs";
import { sanitizeFlavor } from "./situational-modifiers.mjs";
import { USE_PURPOSES, inItemUse, installUseTargets, registerTargetConsumer, usePurposeOf } from "./shared/targets.mjs";

export const NATURAL_FLAG = "naturalDamage";
export const NATURAL_MODES = Object.freeze(["auto", "lethal", "nonlethal"]);
export const FORM_FIELD = "t20cpNonlethal";
export const CHOICES = Object.freeze(["lethal", "nonlethal"]);
export const PENALTY = -5;
export const DATA_VERSION = 1;
export const UNARMED_REF = Object.freeze({ id: "NFepeG0ojjq3Xggs", names: new Set(["ataque desarmado"]) });
export const MERCIFUL_ID = "merciful";
export const MELEE_PURPOSES = Object.freeze(["corpo-a-corpo", "corpo-a-corpo-arremesso"]);
export const WAIVERS = Object.freeze([
  Object.freeze({ id: "piedoso", ref: { id: "whJFemzRCrz6gvtp", names: new Set(["ataque piedoso"]) }, to: ["nonlethal"], melee: true }),
  Object.freeze({ id: "estilo", ref: { id: "DNLooQ6SGKf2hqEc", names: new Set(["estilo desarmado"]) }, to: ["lethal", "nonlethal"], unarmed: true }),
  Object.freeze({ id: "paoCirco", ref: { id: "k4kKX4hcWhrum67F", names: new Set(["pão e circo"]) }, to: ["nonlethal"] })
]);
const NOT_DAMAGE_TYPES = new Set(["curapv", "curatpv", "curapm", "curatpm", "perda"]);
const LINE_CLASS = "t20cp-nonlethal-attack";
const FIELD_CLASS = "t20cp-natural-damage";
const LOG = `${MODULE_ID} | nonlethal-attack:`;

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

/** "lethal" | "nonlethal": the field's mode, or, in "auto" (or an unknown value), unarmed or active Piedosa. */
export function naturalType({ mode, unarmed, merciful }) {
  if (mode === "lethal" || mode === "nonlethal") return mode;
  return unarmed || merciful ? "nonlethal" : "lethal";
}

/** Ids of WAIVERS that waive the -5 of this choice with this weapon. Empty when there is no penalty to waive. */
export function waiversFor({ choice, natural, unarmed, melee, powers }) {
  if (!CHOICES.includes(choice) || choice === natural) return [];
  const owned = powers instanceof Set ? powers : new Set(powers ?? []);
  return WAIVERS.filter(
    (w) => owned.has(w.id) && w.to.includes(choice) && (!w.melee || melee) && (!w.unarmed || unarmed)
  ).map((w) => w.id);
}

/** 0 when the choice is the natural type or a power waives it; otherwise PENALTY. */
export function penaltyFor({ choice, natural, waived }) {
  if (choice === natural || (Array.isArray(waived) ? waived.length : waived)) return 0;
  return PENALTY;
}

/** "lethal" | "nonlethal" | null from the raw form value (string, array with nulls, undefined). */
export function parseChoice(raw) {
  const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => CHOICES.includes(v));
  return values.length === 1 || (values.length > 1 && values.every((v) => v === values[0])) ? values[0] : null;
}

/** Whether a damage roll's parts are damage (not healing, mana recovery or HP loss). */
export function isDamageParts(parts) {
  return Array.isArray(parts) && !parts.some((p) => NOT_DAMAGE_TYPES.has(p?.[1]));
}

/** The whole decision for a choice: penalty and waivers. */
export function decide({ choice, natural, unarmed, melee, powers }) {
  const waivers = waiversFor({ choice, natural, unarmed, melee, powers });
  return { choice, natural, waivers, penalty: penaltyFor({ choice, natural, waived: waivers }) };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const t = (key, data) =>
  data ? game.i18n.format(`T20CP.NonlethalAttack.${key}`, data) : game.i18n.localize(`T20CP.NonlethalAttack.${key}`);

function hasRoll(item, type) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === type && r.parts?.[0]?.[0]);
}

/** A weapon with attack and damage, outside a maneuver resistance test, while the rule is on. */
export function applies(item) {
  return (
    ruleEnabled()
    && item?.type === "arma"
    && hasRoll(item, "ataque")
    && hasRoll(item, "dano")
    && usePurposeOf(item) !== USE_PURPOSES.MANEUVER_RESISTANCE
  );
}

/** What the decision needs from the weapon and its actor. Exported for tests. */
export function weaponContext(item) {
  const mode = item?.flags?.[MODULE_ID]?.[NATURAL_FLAG] ?? item?.getFlag?.(MODULE_ID, NATURAL_FLAG);
  const unarmed = matchesSource(item, UNARMED_REF);
  const merciful = [...(item?.effects ?? [])].some((e) => e?.system?.identifier === MERCIFUL_ID && !e.disabled);
  const melee = MELEE_PURPOSES.includes(item?.system?.proposito);
  const powers = new Set();
  for (const owned of item?.actor?.items ?? []) {
    if (owned?.type !== "poder") continue;
    for (const w of WAIVERS) if (matchesSource(owned, w.ref)) powers.add(w.id);
  }
  return { natural: naturalType({ mode, unarmed, merciful }), unarmed, melee, powers };
}

function waiverNames(ids) {
  return ids.map((id) => t(`Waiver.${id}`)).join(", ");
}

/** Text next to the choice: the penalty, the waiver or nothing. */
export function penaltyText(decision) {
  if (decision.penalty) return t("Penalty", { value: String(decision.penalty).replace("-", "\u2212") });
  if (decision.waivers.length) return t("Waived", { powers: waiverNames(decision.waivers) });
  return "";
}

/** The dialog line. Exported for tests. */
export function buildLine(item) {
  const context = weaponContext(item);
  const decisions = Object.fromEntries(CHOICES.map((choice) => [choice, decide({ choice, ...context })]));
  const row = document.createElement("div");
  row.className = `form-group ${LINE_CLASS}`;
  row.dataset.tooltip = t("Reference");
  const label = document.createElement("label");
  label.textContent = t("Label");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.style.cssText = "justify-content:flex-start; gap:8px;";
  const note = document.createElement("span");
  note.className = "hint";
  const update = (choice) => {
    note.textContent = penaltyText(decisions[choice]);
  };
  for (const choice of CHOICES) {
    const option = document.createElement("label");
    option.className = "checkbox";
    option.style.cssText = "display:flex; align-items:center; gap:4px; flex:none;";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = FORM_FIELD;
    input.value = choice;
    input.checked = choice === context.natural;
    input.addEventListener?.("change", () => update(choice));
    option.append(input, document.createTextNode(t(`Choice.${choice}`)));
    fields.append(option);
  }
  update(context.natural);
  fields.append(note);
  row.append(label, fields);
  return row;
}

/**
 * renderAbilityUseDialog: one line right after "Melhor/Pior de 2d20", before the situational section (#59) when it is
 * already there (its hook is registered first, main.mjs). Exported for tests.
 */
export function onRenderDialog(app, html) {
  const item = app?.item;
  const ItemClass = CONFIG.Item?.documentClass;
  if (!ItemClass || !(item instanceof ItemClass) || !applies(item)) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${LINE_CLASS}`)) return;
  const line = buildLine(item);
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  const situational = form.querySelector(".t20cp-situational");
  if (situational?.before) situational.before(line);
  else if (anchor) anchor.after(line);
  else form.append(line);
  app.setPosition?.({ height: "auto" });
}

/**
 * The use's choice: the dialog's, or the natural type (shortcut). Only for the per-use clone of ItemT20#roll, whose
 * attack and damage run once and in sequence; a direct call on a document (a macro) keeps the official behavior.
 * Exported for tests.
 * @returns {{choice: string, natural: string, waivers: string[], penalty: number} | null}
 */
export function resolveChoice(item, options) {
  if (!options || typeof options !== "object" || !inItemUse(item) || !applies(item)) return null;
  const context = weaponContext(item);
  return decide({ choice: parseChoice(options[FORM_FIELD]) ?? context.natural, ...context });
}

/**
 * Pushes the penalty into the first attack roll (read by getAttackToHit, T20:8148) and returns the function that
 * removes it, so a direct call on a document (a macro) leaves nothing behind. Exported for tests.
 * @returns {() => void}
 */
export function pushPenalty(item, decision) {
  if (!decision?.penalty) return () => {};
  const first = item?.system?.rolls?.find?.((r) => r?.type === "ataque");
  if (!Array.isArray(first?.parts)) return () => {};
  const label = sanitizeFlavor(t(`FormulaLabel.${decision.choice}`));
  const part = [label ? `${decision.penalty}[${label}]` : String(decision.penalty), ""];
  first.parts.push(part);
  return () => {
    const index = first.parts.indexOf(part);
    if (index >= 0) first.parts.splice(index, 1);
  };
}

/** Records the choice in every damage roll of the clone. Exported for tests. */
export function recordDamage(item, decision) {
  const rolled = item?.system?.rolled;
  if (!rolled || !decision) return;
  for (const r of item.system.rolls ?? []) {
    if (r?.type !== "dano" || !isDamageParts(r.parts)) continue;
    const roll = rolled[r.name];
    if (!roll?.options) continue;
    (roll.options[MODULE_ID] ??= {})[ROLL_DATA_KEY] = { v: DATA_VERSION, nonlethal: decision.choice === "nonlethal" };
  }
}

/** renderItemSheet: the "Dano natural" field of weapons, after "Empunhadura". Exported for tests. */
export function onRenderItemSheet(app, html) {
  if (!ruleEnabled()) return;
  const item = app?.document ?? app?.item;
  if (item?.type !== "arma") return;
  const root = html?.[0] ?? html;
  const name = `flags.${MODULE_ID}.${NATURAL_FLAG}`;
  const wielding = root?.querySelector?.('select[name="system.empunhadura"]');
  if (!wielding || root.querySelector(`select[name="${name}"]`)) return;
  const current = String(item.flags?.[MODULE_ID]?.[NATURAL_FLAG] ?? "auto");
  const row = document.createElement("div");
  row.className = `form-group ${FIELD_CLASS}`;
  const label = document.createElement("label");
  label.textContent = t("Field.Label");
  label.dataset.tooltip = t("Field.Hint");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const select = document.createElement("select");
  select.name = name;
  select.disabled = app.isEditable === false;
  for (const mode of NATURAL_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = t(`Field.${mode}`);
    option.selected = mode === (NATURAL_MODES.includes(current) ? current : "auto");
    select.append(option);
  }
  fields.append(select);
  row.append(label, fields);
  (wielding.closest(".form-group") ?? wielding).after(row);
}

/** Installs the wrappers and hooks. The setting is read on every use, so a change applies without reloading. */
export function installNonlethalAttackRule() {
  const proto = CONFIG.Item?.documentClass?.prototype;
  const rollAttack = proto?.rollAttack;
  const rollDamage = proto?.rollDamage;
  if (typeof rollAttack !== "function" || typeof rollDamage !== "function") {
    throw new Error("ItemT20#rollAttack or #rollDamage not found");
  }
  // The use's clone (inItemUse) is only tracked while some consumer is on.
  registerTargetConsumer(ruleEnabled);
  installUseTargets();

  proto.rollAttack = markWrapper(async function (...args) {
    let undo = () => {};
    try {
      undo = pushPenalty(this, resolveChoice(this, args[0]?.options));
    } catch (err) {
      console.error(`${LOG} failed to apply the choice to the attack`, err);
    }
    try {
      return await rollAttack.apply(this, args);
    } finally {
      try {
        undo();
      } catch (err) {
        console.error(`${LOG} failed to remove the attack penalty`, err);
      }
    }
  }, rollAttack);

  proto.rollDamage = markWrapper(async function (...args) {
    const result = await rollDamage.apply(this, args);
    try {
      // Without dialog fields (shortcut) the choice is the natural type.
      const options = args[0]?.options && typeof args[0].options === "object" ? args[0].options : {};
      recordDamage(this, resolveChoice(this, options));
    } catch (err) {
      console.error(`${LOG} failed to record the choice in the damage`, err);
    }
    return result;
  }, rollDamage);

  Hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      onRenderDialog(app, html);
    } catch (err) {
      console.error(`${LOG} failed to render the dialog line`, err);
    }
  });
  Hooks.on("renderItemSheet", (app, html) => {
    try {
      onRenderItemSheet(app, html);
    } catch (err) {
      console.error(`${LOG} failed to render the weapon field`, err);
    }
  });
}
