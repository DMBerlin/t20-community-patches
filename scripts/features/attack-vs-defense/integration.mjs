/** Foundry integration of the "Ataque contra Defesa" rule (#42), only through ctx. */
import { MODULE_ID } from "../../lib/module.mjs";
import { USE_PURPOSES } from "../../lib/targets.mjs";
import { keepCritical, missedByConcealment } from "../../lib/attack-outcome.mjs";
import {
  ATTACK_VS_DEFENSE_SETTING,
  ATTACK_VS_DEFENSE_VISIBILITY_SETTING,
  DATA_KEY,
  DATA_VERSION,
  PRONE,
  attackKind,
  buildTargetResult,
  combineWithConcealment
} from "./domain.mjs";
import { createAttackView } from "./ui.mjs";

/** @typedef {import("../../kernel/feature.mjs").FeatureContext} FeatureContext */

/**
 * The visibility setting changed: rebuilds the result block in place on every displayed copy of the cards that carry
 * a result of this rule (log, notifications, popout tab, single-message popouts). Cards not rendered yet read the mode
 * when they are. ChatLog#updateMessage is not used: it posts a card missing from a log's batch out of order.
 */
function redrawDecorated(ctx, view) {
  try {
    for (const message of ctx.platform.documents.messages()?.contents ?? []) {
      if (!(message.rolls ?? []).some((r) => r?.options?.[MODULE_ID]?.[DATA_KEY])) continue;
      redrawCopies(message, view);
    }
  } catch (err) {
    ctx.log.error("failed to redraw the chat", err);
  }
}

function redrawCopies(message, view) {
  for (const el of document.querySelectorAll(`.message[data-message-id="${message.id}"]`)) {
    for (const box of el.querySelectorAll(".t20cp-attack-vs-defense")) box.remove();
    view.decorate(message, el);
  }
}

// Live data of a target, only for Defense and conditions. Name, uuid and name mode come from the frozen record.
function readDefense(token) {
  const actor = token?.actor ?? null;
  const defesa = actor?.system?.attributes?.defesa;
  return {
    actorType: actor?.type ?? null,
    value: defesa?.value,
    outros: defesa?.outros,
    sourceOutros: actor?._source?.system?.attributes?.defesa?.outros,
    prone: !!actor?.statuses?.has?.(PRONE)
  };
}

/**
 * Compares every attack roll written by this call (not the ones in before) with the targets and records the result.
 * @param {{uses: object, outcome: object}} services  The use-targets and attack-outcome services.
 */
function annotate({ uses, outcome }, item, { records, tokens, before = {} }) {
  const rolled = item.system?.rolled;
  if (!rolled) return;
  // getAttackToHit always reads the FIRST attack roll (find, T20:8151) and rollAttack does not pass r: every attack
  // of the item uses that skill, so the melee/ranged split follows it.
  const first = (item.system.rolls ?? []).find((r) => r?.type === "ataque");
  const kind = attackKind(first?.parts?.[1]?.[0]);
  const byUuid = new Map(tokens.map((token) => [(token?.document ?? token)?.uuid, token]));
  const snapshots = records
    .filter((record) => record?.uuid)
    .map((record) => ({
      ...readDefense(byUuid.get(record.uuid)),
      ...record,
      extra: uses.defenseAdjustmentsFor(item, record.uuid)
    }));
  if (!snapshots.length) return;
  const checks = outcome.getConcealmentChecks(item);
  for (const r of item.system.rolls ?? []) {
    if (r?.type === "ataque") annotateRoll(item, { r, before, kind, snapshots, checks });
  }
}

/** Records the result of one attack roll of the item, unless this call did not write it. */
function annotateRoll(item, { r, before, kind, snapshots, checks }) {
  const roll = item.system.rolled[r.name];
  // Not written by this call (a cancelled attack leaves the previous roll): never touch it.
  if (roll === before[r.name]) return;
  const die = roll?.terms?.[0];
  if (!roll?.options || roll.options.type !== "attack" || die?.faces !== 20) return;
  // The original threat, as the system computes it (T20:9093), whatever another wrapper already did to _critical.
  const natural = Number(die.total);
  const threat = natural >= Number(item.system.criticoM);
  const attack = { kind, total: Number(roll.total), natural, threat };
  const results = snapshots.map((snapshot) =>
    combineWithConcealment(buildTargetResult(snapshot, attack), missedByConcealment(checks, r.name, snapshot.uuid))
  );
  const critical = threat && keepCritical(results.map((t) => t.outcome));
  // Only cancels, never restores: another rule may have cancelled it already.
  if (threat && !critical) roll._critical = false;
  (roll.options[MODULE_ID] ??= {})[DATA_KEY] = { v: DATA_VERSION, kind, threat, critical, targets: results };
}

/**
 * Installs the rule. The setting is read on every attack, so a change applies without reloading.
 * @param {FeatureContext} ctx
 */
export function install(ctx) {
  const services = { uses: ctx.services["use-targets"], outcome: ctx.services["attack-outcome"] };
  const { uses } = services;
  const view = createAttackView(ctx);
  const isOn = () => {
    try {
      return ctx.setting(ATTACK_VS_DEFENSE_SETTING) === "on";
    } catch {
      return false;
    }
  };
  uses.registerTargetConsumer(isOn);
  const itemProto = ctx.platform.classes.item?.prototype;
  if (typeof itemProto?.rollAttack !== "function") throw new Error("ItemT20#rollAttack not found");
  ctx.wrap(itemProto, "rollAttack", async function (rollAttack, ...args) {
    let records = [];
    let tokens = [];
    try {
      // Read synchronously, before the first await: records (persisted) and tokens (live Defense).
      // The defender's test of a maneuver is not an attack against the defender's own targets.
      if (isOn() && uses.usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE) {
        records = uses.useTargetRecords(this);
        tokens = uses.useTargets(this);
      }
    } catch (err) {
      ctx.log.error("failed to read the targets", err);
    }
    const before = { ...(this.system?.rolled ?? {}) };
    const result = await rollAttack.apply(this, args);
    if (records.length) {
      try {
        annotate(services, this, { records, tokens, before });
      } catch (err) {
        ctx.log.error("failed to compare the attack", err);
      }
    }
    return result;
  });

  const messageProto = ctx.platform.classes.chatMessage?.prototype;
  if (typeof messageProto?.renderHTML !== "function") throw new Error("ChatMessage#renderHTML not found");
  ctx.wrap(messageProto, "renderHTML", async function (renderHTML, ...args) {
    const html = await renderHTML.apply(this, args);
    try {
      view.decorate(this, html);
    } catch (err) {
      ctx.log.error("failed to show the result", err);
    }
    return html;
  });

  ctx.onSettingChange(ATTACK_VS_DEFENSE_VISIBILITY_SETTING, () => redrawDecorated(ctx, view));
}
