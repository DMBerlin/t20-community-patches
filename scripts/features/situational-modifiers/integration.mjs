/** Foundry integration of the "Modificadores situacionais" rule (#59), only through ctx. */
import { MODULE_ID } from "../../lib/module.mjs";
import { USE_PURPOSES } from "../../lib/targets.mjs";
import { castCompleted } from "../../lib/cast-outcome.mjs";
import {
  DATA_KEY,
  DATA_VERSION,
  FORM_ATTACK,
  FORM_DEFENSE,
  SECTION_CLASS,
  SITUATIONAL_SETTING,
  allowedModifiers,
  attackParts,
  attackSelection,
  chargeEffectData,
  defenseAdjustmentsByTarget,
  defenseRecord,
  parseDefenseSelection,
  shouldCreateCharge
} from "./domain.mjs";
import { buildSection, decorate, label } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
function ruleOn(ctx) {
  try {
    return ctx.setting(SITUATIONAL_SETTING) === "on";
  } catch {
    return false;
  }
}

function hasAttackRoll(item) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === "ataque" && r.parts?.[0]?.[0]);
}

/**
 * renderAbilityUseDialog: adds the section once, after "Melhor/Pior de 2d20".
 * @param {FeatureContext} ctx
 */
export function onRenderDialog(ctx, app, html) {
  if (!ruleOn(ctx)) return;
  const uses = ctx.services["use-targets"];
  const item = app?.item;
  const ItemClass = ctx.platform.classes.item;
  if (!ItemClass || !(item instanceof ItemClass) || !hasAttackRoll(item)) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${SECTION_CLASS}`)) return;
  const allowed = allowedModifiers(uses.usePurposeOf(item));
  // The records frozen when ItemT20#roll started; changing targets with the dialog open changes nothing.
  const section = buildSection(ctx, item, allowed.defense ? uses.useTargetRecords(item) : [], allowed);
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  if (anchor) anchor.after(section);
  else form.append(section);
  app.setPosition?.({ height: "auto" });
}

/**
 * Filters the dialog choices by the use's purpose, adds the attack parts to the first attack roll of the clone (the
 * one getAttackToHit reads, T20:8151) and registers the Defense adjustments.
 * @param {{ctx: FeatureContext, uses: object, prepared: WeakSet<object>}} rt
 * @returns {{attack: string[], defense: object[]} | null}  What to record in the rolls.
 */
function prepareUse(rt, item, options) {
  const { ctx, uses, prepared } = rt;
  if (!options || typeof options !== "object" || prepared.has(options) || !ruleOn(ctx)) return null;
  if (!(FORM_ATTACK in options) && !(FORM_DEFENSE in options)) return null;
  prepared.add(options);
  const allowed = allowedModifiers(uses.usePurposeOf(item));
  const attack = attackSelection(options[FORM_ATTACK]).filter((id) => allowed.attack.includes(id));
  const entries = allowed.defense ? parseDefenseSelection(options[FORM_DEFENSE]) : [];
  options[FORM_ATTACK] = attack;
  options[FORM_DEFENSE] = entries.map((e) => `${e.target}|${e.id}`);

  if (attack.length) {
    const first = item?.system?.rolls?.find?.((r) => r?.type === "ataque");
    const labels = Object.fromEntries(attack.map((id) => [id, label(ctx, `Label.${id}`)]));
    if (Array.isArray(first?.parts)) first.parts.push(...attackParts(attack, labels));
  }

  const records = allowed.defense ? uses.useTargetRecords(item) : [];
  const byTarget = defenseAdjustmentsByTarget(entries, records.map((r) => r.uuid));
  if (byTarget.size) uses.addDefenseAdjustments(item, byTarget);
  const defense = defenseRecord(records, entries);
  return attack.length || defense.length ? { attack, defense } : null;
}

/** Records the choices in every attack roll of the clone, next to the other rules' keys. */
function writeRecord(item, record) {
  const rolled = item?.system?.rolled;
  if (!rolled) return;
  for (const r of item.system.rolls ?? []) {
    const roll = r?.type === "ataque" ? rolled[r.name] : null;
    if (!roll?.options) continue;
    (roll.options[MODULE_ID] ??= {})[DATA_KEY] = { v: DATA_VERSION, attack: [...record.attack], defense: record.defense };
  }
}

/**
 * Creates the charge effect unless the actor already has one.
 * @param {{ctx: FeatureContext, pendingCharges: Set<unknown>}} rt
 */
async function applyCharge(rt, actor) {
  const { ctx, pendingCharges } = rt;
  if (!actor?.isOwner) return;
  const key = actor.uuid ?? actor;
  if (pendingCharges.has(key) || !shouldCreateCharge(actor.effects)) return;
  pendingCharges.add(key);
  try {
    await actor.createEmbeddedDocuments("ActiveEffect", [
      chargeEffectData({ name: label(ctx, "ChargeEffect.Name"), description: label(ctx, "ChargeEffect.Description") })
    ]);
  } finally {
    pendingCharges.delete(key);
  }
}

/** Whether this displayCard call ends a use whose prepared options chose a charge. */
function chargeChosen(rt, item, options) {
  // prepareUse ran on this options object (an attack was rolled) and already filtered it by the use's purpose.
  return (
    ruleOn(rt.ctx) &&
    rt.prepared.has(options) &&
    rt.uses.usePurposeOf(item) !== USE_PURPOSES.MANEUVER_RESISTANCE &&
    Array.isArray(options[FORM_ATTACK]) &&
    options[FORM_ATTACK].includes("charge")
  );
}

/**
 * Installs the rule. The setting is read on every use, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const rt = {
    ctx,
    uses: ctx.services["use-targets"],
    /** options objects already handled; there is one per use (ItemT20#roll). */
    prepared: new WeakSet(),
    /** Actors whose charge effect is being created by this client: two quick uses do not create two. */
    pendingCharges: new Set()
  };
  const proto = ctx.platform.classes.item?.prototype;
  if (typeof proto?.rollAttack !== "function" || typeof proto?.displayCard !== "function") {
    throw new Error("ItemT20#rollAttack or #displayCard not found");
  }
  rt.uses.registerTargetConsumer(() => ruleOn(ctx));

  ctx.wrap(proto, "rollAttack", async function (rollAttack, ...args) {
    let record = null;
    try {
      record = prepareUse(rt, this, args[0]?.options);
    } catch (err) {
      ctx.log.error("failed to apply the modifiers", err);
    }
    const result = await rollAttack.apply(this, args);
    if (record) {
      try {
        writeRecord(this, record);
      } catch (err) {
        ctx.log.error("failed to record the modifiers", err);
      }
    }
    return result;
  });

  ctx.wrap(proto, "displayCard", async function (displayCard, ...args) {
    let charge = false;
    const options = args[0]?.options;
    try {
      charge = chargeChosen(rt, this, options);
    } catch (err) {
      ctx.log.error("failed to read the charge", err);
    }
    const result = await displayCard.apply(this, args);
    if (charge && castCompleted(result, options)) {
      try {
        await applyCharge(rt, this.actor);
      } catch (err) {
        ctx.log.error("failed to create the charge effect", err);
      }
    }
    return result;
  });

  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      onRenderDialog(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to render the dialog section", err);
    }
  });
  ctx.hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      decorate(ctx, message, html);
    } catch (err) {
      ctx.log.error("failed to show the Defense note", err);
    }
  });
}
