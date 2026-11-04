/** Foundry integration of the "Chance de falha por camuflagem" rule (#49), only through ctx. */
import { USE_PURPOSES } from "../../lib/targets.mjs";
import { CONCEALMENT_SETTING } from "../../lib/concealment.mjs";
import { CONCEALMENT_CHOICES, CONCEALMENT_FIELD, FIELD_CLASS, annotate, isMiss, planChecks } from "./domain.mjs";
import { buildField, decorate, displayLabel, reasonsText, t } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/** @param {FeatureContext} ctx */
function isEnabled(ctx) {
  try {
    return ctx.setting(CONCEALMENT_SETTING) === "on";
  } catch {
    return false;
  }
}

function attackNames(item) {
  return (item?.system?.rolls ?? []).filter((r) => r?.type === "ataque" && r.parts?.[0]?.[0]).map((r) => r.name);
}

function hasAttackRoll(item) {
  return !!item?.system?.rolls?.some?.((r) => r?.type === "ataque");
}

const statusesOf = (actor) => [...(actor?.statuses ?? [])];

/**
 * The use's frozen records, without the attacker's own token, plus the live statuses of the matching token.
 * Name, uuid and name mode always come from the record.
 * @param {object} uses  The use-targets service.
 */
export function useTargetsWithStatuses(uses, item) {
  const tokens = uses.useTargets(item);
  const byUuid = new Map(tokens.map((token) => [(token?.document ?? token)?.uuid, token]));
  const attacker = item?.actor ?? null;
  const targets = [];
  for (const record of uses.useTargetRecords(item)) {
    if (!record?.uuid) continue;
    const token = byUuid.get(record.uuid);
    const actor = token?.actor ?? null;
    if (attacker && actor === attacker) continue;
    targets.push({ ...record, statuses: statusesOf(actor), document: token?.document ?? null });
  }
  return targets;
}

/** Plans and rolls every d10 of this call. Throws on any failure (the caller then records nothing). */
async function rollChecks(ctx, item, targets, options) {
  const choice = CONCEALMENT_CHOICES.includes(options?.[CONCEALMENT_FIELD]) ? options[CONCEALMENT_FIELD] : "auto";
  const checks = planChecks({
    attackNames: attackNames(item),
    attackerStatuses: statusesOf(item?.actor),
    targets: targets.map(({ uuid, name, displayName, statuses }) => ({ uuid, name, displayName, statuses })),
    choice
  });
  for (const check of checks) {
    const roll = await new ctx.platform.dice.Roll(check.formula).evaluate();
    check.total = Number(roll.total);
    check.missed = isMiss(check.total, check.threshold);
  }
  return checks;
}

/**
 * Lines of the dialog preview: what Automatic detects for the use's targets, with names for the local user.
 * @param {FeatureContext} ctx
 * @returns {string[]}
 */
export function previewLines(ctx, item) {
  const targets = useTargetsWithStatuses(ctx.services["use-targets"], item);
  const checks = planChecks({ attackNames: ["preview"], attackerStatuses: statusesOf(item?.actor), targets, choice: "auto" });
  return checks.map((check) =>
    t(ctx, "Dialog.Preview", {
      target: displayLabel(ctx, check, targets[check.index - 1]?.document ?? null),
      chance: check.chance,
      reasons: reasonsText(ctx, check.reasons)
    })
  );
}

/**
 * renderAbilityUseDialog: adds the field once, after "Melhor/Pior de 2d20".
 * @param {FeatureContext} ctx
 */
export function onRenderDialog(ctx, app, html) {
  if (!isEnabled(ctx)) return;
  const item = app?.item;
  if (!hasAttackRoll(item) || ctx.services["use-targets"].usePurposeOf(item) === USE_PURPOSES.MANEUVER_RESISTANCE) return;
  const root = html?.[0] ?? html;
  const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
  if (!form || form.querySelector(`.${FIELD_CLASS}`)) return;
  const field = buildField(ctx, previewLines(ctx, item));
  const anchor = form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
  if (anchor) {
    anchor.after(field);
    // Other rules' hooks (nonlethal-attack, situational-modifiers) also insert right after "Melhor/Pior", and may run
    // after this one: once every render hook ran, put the field back right after it.
    queueMicrotask(() => {
      if (anchor.parentNode && field.parentNode === anchor.parentNode) anchor.after(field);
    });
  } else {
    const situational = form.querySelector(".t20cp-situational");
    if (situational?.before) situational.before(field);
    else form.append(field);
  }
  app.setPosition?.({ height: "auto" });
}

/**
 * Installs the rule. The setting is read on every use, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const uses = ctx.services["use-targets"];
  const outcome = ctx.services["attack-outcome"];
  uses.registerTargetConsumer(() => isEnabled(ctx));
  const itemProto = ctx.platform.classes.item?.prototype;
  // The current method, not unwrap(): unwrap() follows the wrapper tags down to the system method
  // and would drop any wrapper installed before this one (attack-vs-defense, etc.).
  if (typeof itemProto?.rollAttack !== "function") throw new Error("ItemT20#rollAttack not found");
  ctx.wrap(itemProto, "rollAttack", async function (rollAttack, ...args) {
    outcome.invalidateConcealmentChecks(this); // on entry, before any await, even when the rule is off
    // Maneuver resistance test (combat-maneuvers): no d10, no checks, nothing recorded.
    if (uses.usePurposeOf(this) === USE_PURPOSES.MANEUVER_RESISTANCE) return rollAttack.apply(this, args);
    let targets = [];
    let checks = [];
    let before = {};
    if (isEnabled(ctx)) {
      try {
        targets = useTargetsWithStatuses(uses, this);
        checks = await rollChecks(ctx, this, targets, args[0]?.options);
        before = { ...(this.system?.rolled ?? {}) };
        outcome.setConcealmentChecks(this, checks); // published only after success; never cleared on the way out
      } catch (err) {
        ctx.log.error("failed to roll", err);
        checks = [];
      }
    }
    const result = await rollAttack.apply(this, args);
    if (checks.length) {
      try {
        annotate(this, targets, checks, before);
      } catch (err) {
        ctx.log.error("failed to record the result", err);
      }
    }
    return result;
  });

  const messageProto = ctx.platform.classes.chatMessage?.prototype;
  if (typeof messageProto?.renderHTML !== "function") throw new Error("ChatMessage#renderHTML not found");
  ctx.wrap(messageProto, "renderHTML", async function (renderHTML, ...args) {
    const html = await renderHTML.apply(this, args);
    try {
      decorate(ctx, this, html);
    } catch (err) {
      ctx.log.error("failed to show the result", err);
    }
    return html;
  });

  ctx.hooks.on("renderAbilityUseDialog", (app, html) => {
    try {
      onRenderDialog(ctx, app, html);
    } catch (err) {
      ctx.log.error("failed to render the dialog field", err);
    }
  });
}
