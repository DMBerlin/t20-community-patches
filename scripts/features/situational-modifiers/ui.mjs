/** Dialog section and card note of the "Modificadores situacionais" rule (#59). */
import { MODULE_ID } from "../../lib/module.mjs";
import { canSeeTokenName } from "../../lib/targets.mjs";
import {
  ANY_TARGET,
  ATTACK_MODIFIERS,
  DATA_KEY,
  DATA_VERSION,
  DEFENSE_ADJUSTMENTS,
  FORM_ATTACK,
  FORM_DEFENSE,
  INVISIBLE_STATUS,
  NOTE_CLASS,
  SECTION_CLASS
} from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
export const label = (ctx, key) => ctx.platform.i18n.localize(`T20CP.SituationalModifiers.${key}`);

function adjustmentLabel(ctx, id) {
  const key = `T20CP.DefenseAdjustment.${id}`;
  return ctx.platform.i18n.has(key) ? ctx.platform.i18n.localize(key) : String(id);
}

/**
 * Name of a target for the current user: the recorded name, or "Alvo N" (same policy as attack-vs-defense).
 * @param {FeatureContext} ctx
 */
export function targetLabel(ctx, record, index) {
  const { platform } = ctx;
  if (!record?.uuid) return label(ctx, "AnyTarget");
  let live = null;
  try {
    live = platform.documents.fromUuidSync(record.uuid);
  } catch {
    // A broken document reads as a deleted token.
  }
  const visible = canSeeTokenName({
    isGM: !!platform.user.isGM(),
    isOwner: !!live?.isOwner,
    displayName: live ? live.displayName : record.displayName
  });
  return visible ? String(record.name ?? "") : platform.i18n.format("T20CP.SituationalModifiers.TargetN", { n: index + 1 });
}

function checkbox({ name, value, text, tooltip, checked = false }) {
  const node = document.createElement("label");
  node.className = "checkbox";
  node.style.cssText = "display:flex; align-items:center; gap:4px; flex:none; margin-right:8px;";
  if (tooltip) node.dataset.tooltip = tooltip;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = !!checked;
  node.append(input, document.createTextNode(text));
  return node;
}

function row(title, boxes) {
  const div = document.createElement("div");
  div.className = "form-group";
  const node = document.createElement("label");
  node.textContent = title;
  const fields = document.createElement("div");
  fields.className = "form-fields";
  fields.style.cssText = "flex-wrap:wrap; justify-content:flex-start;";
  fields.append(...boxes);
  div.append(node, fields);
  return div;
}

function defenseRows(ctx, section, item, records) {
  const t = (key) => label(ctx, key);
  const invisible = !!item?.actor?.statuses?.has?.(INVISIBLE_STATUS);
  const targets = records.length ? records : [{ uuid: null }];
  const subtitle = document.createElement("p");
  subtitle.className = "hint";
  subtitle.style.margin = "4px 0 0";
  subtitle.textContent = t("DefenseLegend");
  section.append(subtitle);
  targets.forEach((record, index) => {
    const key = record.uuid ?? ANY_TARGET;
    const boxes = DEFENSE_ADJUSTMENTS.map((a) =>
      checkbox({
        name: FORM_DEFENSE,
        value: `${key}|${a.id}`,
        text: t(`Defense.${a.id}`),
        tooltip: t(`Tooltip.${a.id}`),
        checked: a.id === "invisible" && invisible
      })
    );
    section.append(row(targetLabel(ctx, record, index), boxes));
  });
}

/**
 * The dialog section.
 * @param {FeatureContext} ctx
 */
export function buildSection(ctx, item, records, allowed) {
  const t = (key) => label(ctx, key);
  const section = document.createElement("fieldset");
  section.className = SECTION_CLASS;
  section.dataset.tooltip = t("Reference");
  const legend = document.createElement("legend");
  legend.textContent = t("Section");
  section.append(legend);

  const attack = ATTACK_MODIFIERS.filter((m) => allowed.attack.includes(m.id)).map((m) =>
    checkbox({ name: FORM_ATTACK, value: m.id, text: t(`Attack.${m.id}`), tooltip: t(`Tooltip.${m.id}`) })
  );
  section.append(row(t("AttackLegend"), attack));

  if (allowed.defense) defenseRows(ctx, section, item, records);
  return section;
}

function noteBox(ctx, data) {
  const box = document.createElement("div");
  box.className = NOTE_CLASS;
  box.style.cssText = "margin:2px 0 4px; font-size:var(--font-size-12, 12px);";
  box.dataset.tooltip = label(ctx, "Reference");
  const title = document.createElement("p");
  title.style.margin = "0";
  title.textContent = `${label(ctx, "NoteTitle")}:`;
  const list = document.createElement("ul");
  list.style.cssText = "margin:0; padding-left:1em;";
  data.defense.forEach((target, index) => {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${targetLabel(ctx, target, Number.isInteger(target.index) ? target.index : index)}: `;
    const text = (target.adjustments ?? []).map((a) => adjustmentLabel(ctx, a.id)).join(" · ");
    li.append(strong, document.createTextNode(text));
    list.append(li);
  });
  box.append(title, list);
  return box;
}

/**
 * Adds the "Defesa do alvo" note under each attack roll that has adjustments and no attack-vs-defense result.
 * @param {FeatureContext} ctx
 */
export function decorate(ctx, message, html) {
  if (!message?.isContentVisible || !html?.querySelectorAll) return;
  const containers = [...html.querySelectorAll(".roll[data-roll-title]")];
  for (const roll of message.rolls ?? []) {
    const own = roll?.options?.[MODULE_ID];
    const data = own?.[DATA_KEY];
    if (data?.v !== DATA_VERSION || !Array.isArray(data.defense) || !data.defense.length) continue;
    // attack-vs-defense already lists the adjustments of every compared target.
    if (own.attackVsDefense?.targets?.length) continue;
    const container = containers.find((el) => el.dataset.rollTitle === roll.options.title);
    if (!container || container.querySelector(`.${NOTE_CLASS}`)) continue;
    container.append(noteBox(ctx, data));
  }
}
