/** Skills: the armor penalty on Str/Dex skills (p. 152), its tooltip line and the sheet markers. */
import { addTooltipLine } from "../../../lib/tooltip.mjs";
import { WEAPON_PENALTY, keyAbility, skillExtraPenalty } from "../domain/index.mjs";
import { armorEntries, weaponStatusOf } from "./actor.mjs";
import { checkSource } from "./attack.mjs";

const TOOLTIP_KEY = "T20CP.NonProficiency.TooltipLabel";
const SKILL_TOOLTIP_PATH = /^system\.pericias\.([^.]+)\.bonus$/;

/** Armor entries of one preparation: prepareSkills passes the same rollData to every skill (T20:19829-19833). */
function preparationState(env, actor, key) {
  const shared = key && typeof key === "object";
  let state = shared ? env.stateByRollData.get(key) : undefined;
  if (!state) {
    state = armorEntries(env, actor);
    if (shared) env.stateByRollData.set(key, state);
  }
  return state;
}

function applySkillPenalty(env, system, { skillId, skill, rollData }) {
  const actor = system.parent;
  if (!skill || actor?.type !== "character" || !env.isOn()) return;
  const state = preparationState(env, actor, rollData);
  const extra = skillExtraPenalty({
    ability: keyAbility(skillId, system.pericias?.[skillId], env.platform.t20Config()?.pericias),
    appliesArmorPenalty: Boolean(skill.pda),
    penalty: state.penalty
  });
  if (extra) skill.value = (Number(skill.value) || 0) + extra;
  let extras = env.extraBySystem.get(system);
  if (!extras) env.extraBySystem.set(system, (extras = new Map()));
  extras.set(skillId, extra);
  env.appliedChanges?.contribute(actor, `system.pericias.${skillId}.bonus`, { label: TOOLTIP_KEY, value: extra, owner: "non-proficiency" });
}

export function installSkills(env) {
  let proto = env.platform.config.document("Actor")?.dataModels?.character?.prototype;
  while (proto && !Object.hasOwn(proto, "prepareSkill")) proto = Object.getPrototypeOf(proto);
  const original = proto?.prepareSkill;
  if (typeof original !== "function") throw new Error("prepareSkill not found");
  checkSource(env, "prepareSkill", original);
  env.wrap(proto, "prepareSkill", function (original, skillId, options = {}, ...rest) {
    const skill = original.call(this, skillId, options, ...rest);
    try {
      applySkillPenalty(env, this, { skillId, skill, rollData: options?.rollData });
    } catch (err) {
      env.warnOnce(err);
    }
    return skill;
  });
}

/** The sheet's own document (the synthetic actor of an unlinked token); the system's helper looks up game.actors by _id first. */
function sheetActor(platform, sheet) {
  if (sheet?.actor?.system) return sheet.actor;
  return platform.documents.fromUuidSync(sheet?.uuid) || platform.documents.actors()?.get(sheet?.actor?._id);
}

export function installSkillTooltip(env) {
  const { platform } = env;
  const helpers = platform.handlebars.helpers();
  if (typeof helpers?.fieldBonuses !== "function") {
    env.log.warn("Handlebars helper fieldBonuses not found; the skill breakdown will not show the penalty");
    return;
  }
  env.wrap(
    helpers,
    "fieldBonuses",
    function (original, path, options) {
      const html = original.call(this, path, options);
      try {
        if (!env.isOn()) return html;
        const key = SKILL_TOOLTIP_PATH.exec(typeof path === "object" ? path?.string : path)?.[1];
        if (!key) return html;
        const actor = sheetActor(platform, options?.data?.root);
        if (actor?.type !== "character") return html;
        // field-bonuses-breakdown lists the penalty from applied-changes; a second line would count it twice.
        if (env.breakdownOwnsLine(actor)) return html;
        const extra = env.extraBySystem.get(actor.system)?.get(key) ?? 0;
        return addTooltipLine(html, platform.i18n.localize(TOOLTIP_KEY), extra);
      } catch (err) {
        env.warnOnce(err);
        return html;
      }
    },
    { label: "Handlebars.helpers.fieldBonuses" }
  );
}

export function tooltipFor(i18n, item, weaponState, armor) {
  const pendingSources = () =>
    armor.profs.pending.map((p) => p.source ?? i18n.localize("T20CP.NonProficiency.InitialClass")).join(", ");
  if (weaponState === "penalty") return i18n.format("T20CP.NonProficiency.Weapon", { penalty: WEAPON_PENALTY });
  if (weaponState === "indeterminate") return i18n.format("T20CP.NonProficiency.Pending", { sources: pendingSources() });
  const entry = armor.entries.find((e) => e.item.id === item.id);
  if (entry?.status === "penalty" && entry.penalty) return i18n.format("T20CP.NonProficiency.Armor", { penalty: entry.penalty });
  if (entry?.status === "indeterminate" && entry.penalty) {
    return i18n.format("T20CP.NonProficiency.Pending", { sources: pendingSources() });
  }
  return "";
}

export function markRows(env, actor, html) {
  if (actor?.type !== "character" || !env.isOn()) return;
  const root = typeof html?.querySelectorAll === "function" ? html : html?.[0];
  if (!root) return;
  const { i18n } = env.platform;
  const armor = armorEntries(env, actor);
  for (const li of root.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item) continue;
    const weaponState = weaponStatusOf(env, item, armor.profs);
    const text = tooltipFor(i18n, item, weaponState, armor);
    const label = li.querySelector(".item-name label, .item-name");
    if (!text || !label || label.querySelector(".t20cp-nonprof")) continue;
    const pending = weaponState === "indeterminate" || armor.entries.some((e) => e.item.id === item.id && e.status === "indeterminate");
    const icon = label.ownerDocument.createElement("i");
    icon.className = `fa-solid ${pending ? "fa-circle-question" : "fa-triangle-exclamation"} t20cp-nonprof`;
    icon.dataset.tooltipText = `${text} (${i18n.localize("T20CP.NonProficiency.Reference")})`;
    label.append(" ", icon);
  }
}
