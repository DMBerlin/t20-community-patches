/** Result block of the "Ataque contra Defesa" rule (#42) on the attack rolls of a chat card. */
import { MODULE_ID } from "../../lib/module.mjs";
import { canSeeTokenName } from "../../lib/targets.mjs";
import { ATTACK_VS_DEFENSE_VISIBILITY_SETTING, DATA_KEY, DATA_VERSION, resultVisibility } from "./domain.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

function targetLabel(label, target) {
  if (target.outcome === "unknown") return label("Unknown");
  if (target.concealment) return label("MissConcealment");
  if (target.critical) return label("HitCritical");
  return label(target.outcome === "hit" ? "Hit" : "Miss");
}

/**
 * The text of the result lines for the current user, read on every call.
 * @param {FeatureContext} ctx
 */
export function createAttackView(ctx) {
  const { platform } = ctx;
  const { i18n } = platform;

  const label = (key, data) => {
    const path = `T20CP.AttackVsDefense.${key}`;
    return data ? i18n.format(path, data) : i18n.localize(path);
  };

  const visibilityMode = () => {
    try {
      return ctx.setting(ATTACK_VS_DEFENSE_VISIBILITY_SETTING);
    } catch {
      return "show";
    }
  };

  const showFoeDc = () => {
    try {
      return !!platform.settingsOf("tormenta20").get("showFoeDc");
    } catch {
      return true;
    }
  };

  /**
   * Text of one target line for the current user.
   * @returns {{name: string, text: string, visible: boolean}}
   */
  function describeTarget(target, index) {
    let live = null;
    try {
      live = target.uuid ? platform.documents.fromUuidSync(target.uuid) : null;
    } catch {
      // A broken document reads as a deleted token.
    }
    const actor = live?.actor ?? null;
    const isGM = !!platform.user.isGM();
    const isObserver = !!actor?.testUserPermission?.(platform.users.current(), "OBSERVER");
    const visibleName = canSeeTokenName({
      isGM,
      isOwner: !!live?.isOwner,
      displayName: live ? live.displayName : target.displayName
    });
    const name = visibleName ? target.name : label("Target", { n: index + 1 });
    const parts = [targetLabel(label, target)];
    if (target.automatic === "nat20") parts.push(label("Natural20"));
    if (target.automatic === "nat1") parts.push(label("Natural1"));
    for (const id of target.adjustments ?? []) {
      // Shared namespace: each producer ships its own keys (this rule: prone-ranged).
      const key = `T20CP.DefenseAdjustment.${id}`;
      parts.push(i18n.has(key) ? i18n.localize(key) : String(id));
    }
    const view = resultVisibility({ mode: visibilityMode(), isGM, isObserver, actorType: target.actorType, showFoeDc: showFoeDc() });
    if (Number.isFinite(target.defense) && view.defense) parts.push(label("Defense", { value: target.defense }));
    return { name, text: parts.join(" · "), visible: view.verdict };
  }

  function resultBox(data, lines, cancelled) {
    const box = document.createElement("div");
    box.className = "t20cp-attack-vs-defense";
    box.dataset.tooltip = label("Reference");
    if (cancelled) {
      const note = document.createElement("p");
      note.className = "t20cp-avd-note";
      note.textContent = label("CriticalCancelled");
      box.append(note);
    }
    const list = document.createElement("ul");
    data.targets.forEach((target, index) => {
      const { name, text } = lines[index];
      const li = document.createElement("li");
      li.classList.add(`t20cp-avd-${["hit", "miss"].includes(target.outcome) ? target.outcome : "unknown"}`);
      if (target.critical) li.classList.add("t20cp-avd-critical");
      const strong = document.createElement("strong");
      strong.textContent = `${name}: `;
      li.append(strong, document.createTextNode(text));
      list.append(li);
    });
    box.append(list);
    return box;
  }

  /** Adds the result block under each annotated attack roll of the card. Idempotent. */
  function decorate(message, html) {
    if (!message?.isContentVisible || !html?.querySelectorAll) return;
    const containers = [...html.querySelectorAll(".roll[data-roll-title]")];
    for (const roll of message.rolls ?? []) {
      const data = roll?.options?.[MODULE_ID]?.[DATA_KEY];
      if (data?.v !== DATA_VERSION || !Array.isArray(data.targets) || !data.targets.length) continue;
      const container = containers.find((el) => el.dataset.rollTitle === roll.options.title);
      if (!container || container.querySelector(".t20cp-attack-vs-defense")) continue;
      const cancelled = data.threat && !data.critical;
      if (cancelled) {
        const total = container.querySelector(".dice-total");
        total?.classList.remove("success", "critical");
        total?.classList.add("failure");
      }
      const lines = data.targets.map((target, index) => describeTarget(target, index));
      // Hide mode, for players: the cancelled critical keeps losing its highlight, but nothing of the rule is shown.
      if (!lines.some((line) => line.visible)) continue;
      container.append(resultBox(data, lines, cancelled));
    }
  }

  return { describeTarget, decorate };
}
