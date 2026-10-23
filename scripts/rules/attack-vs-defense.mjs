/**
 * Optional rule "Ataque contra Defesa" (#42).
 *
 * Book rule (Tormenta20 Jogo do Ano, p. 230-231): an attack hits when the result is equal to or higher than the
 * target's Defense, and a critical hit needs a hit. Natural 20 always succeeds and natural 1 always fails (p. 221).
 * Prone gives +5 Defense against ranged attacks (p. 394). The system never compares the attack with a Defense and
 * multiplies the weapon damage on a threat even when the attack misses (T20:9093, T20:9116). This rule records, in
 * the attack roll, the result against each target the user marked when the use started, cancels the critical when
 * every target was missed, and shows the result on the chat card.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import {
  canSeeTokenName,
  defenseAdjustmentsFor,
  installUseTargets,
  registerTargetConsumer,
  USE_PURPOSES,
  usePurposeOf,
  useTargetRecords,
  useTargets
} from "./shared/targets.mjs";
import { finalOutcome, getConcealmentChecks, keepCritical, missedByConcealment } from "./shared/attack-outcome.mjs";

export const ATTACK_VS_DEFENSE_SETTING = "attackVsDefenseRule";
export const DATA_KEY = "attackVsDefense";
const DATA_VERSION = 1;
const PRONE = "caido";

/**
 * Melee or ranged, with the same split the system uses for attack bonuses (T20:8205-8210).
 * @param {unknown} skill  The attack roll's skill (rolls[].parts[1][0]).
 * @returns {"melee"|"ranged"}
 */
export function attackKind(skill) {
  return skill === "pont" ? "ranged" : "melee";
}

/**
 * Defense against this attack.
 * Prone is the only change on defesa.outros in the compendiums, so outros - _source.outros is what Prone applied
 * (with or without the prone-defense patch). A ranged attack undoes it and adds +5. Then the per-target adjustments
 * from other rules (shared defenseAdjustmentsFor) are added, in order.
 * @param {{value: unknown, kind: "melee"|"ranged", prone?: boolean, outros?: unknown, sourceOutros?: unknown,
 *   extra?: {id: string, delta: number}[]}} params
 * @returns {{defense: number|null, adjustments: string[]}}
 */
export function effectiveDefense({ value, kind, prone = false, outros = 0, sourceOutros = 0, extra = [] }) {
  if (value === null || value === undefined || value === "") return { defense: null, adjustments: [] };
  let defense = Number(value);
  if (!Number.isFinite(defense)) return { defense: null, adjustments: [] };
  const adjustments = [];
  if (prone && kind === "ranged") {
    defense += 5 - Math.min(0, (Number(outros) || 0) - (Number(sourceOutros) || 0));
    adjustments.push("prone-ranged");
  }
  for (const adj of Array.isArray(extra) ? extra : []) {
    const delta = Number(adj?.delta);
    if (!adj?.id || !Number.isFinite(delta)) continue;
    defense += delta;
    adjustments.push(String(adj.id));
  }
  return { defense, adjustments };
}

/**
 * Result of one attack against one Defense.
 * @param {{total: number, natural: number, threat: boolean, defense: number|null}} params
 * @returns {{outcome: "hit"|"miss"|"unknown", critical: boolean, automatic: "nat20"|"nat1"|null}}
 */
export function resolveAttack({ total, natural, threat, defense }) {
  if (natural === 20) return { outcome: "hit", critical: !!threat, automatic: "nat20" };
  if (natural === 1) return { outcome: "miss", critical: false, automatic: "nat1" };
  if (!Number.isFinite(defense) || !Number.isFinite(total)) return { outcome: "unknown", critical: false, automatic: null };
  const hit = total >= defense;
  return { outcome: hit ? "hit" : "miss", critical: hit && !!threat, automatic: null };
}

/**
 * Policy of this rule for the TARGET's Defense. It only reuses the system setting "Exibir CD de Ameaças ao jogadores"
 * (showFoeDc); ChatMessageT20#_hideDC (T20:10535-10544) looks at the speaker and hides only the card's DC.
 * GMs, observers of the target actor (they already see the full sheet) and character targets always see the number.
 * @param {{isGM: boolean, isObserver: boolean, actorType: string|null, showFoeDc: boolean}} params
 */
export function canSeeDefense({ isGM, isObserver, actorType, showFoeDc }) {
  return !!(isGM || isObserver || actorType === "character" || showFoeDc);
}

/**
 * Combines the Defense result of one target with the concealment check of #49 (shared finalOutcome: concealment
 * wins, p. 238). A target missed by concealment never shows a hit or a critical.
 * @param {{outcome: string, critical: boolean}} result  From buildTargetResult.
 * @param {boolean} concealmentMiss
 */
export function combineWithConcealment(result, concealmentMiss) {
  const outcome = finalOutcome(result.outcome, concealmentMiss);
  if (!concealmentMiss) return { ...result, outcome };
  return { ...result, defenseOutcome: result.outcome, outcome, critical: false, concealment: true };
}

/**
 * Result of the attack against one target.
 * @param {object} snapshot  The frozen record ({uuid, name, displayName}) plus live Defense data (see readDefense).
 * @param {{kind: "melee"|"ranged", total: number, natural: number, threat: boolean}} attack
 */
export function buildTargetResult(snapshot, { kind, total, natural, threat }) {
  const { defense, adjustments } = effectiveDefense({ ...snapshot, kind });
  return {
    uuid: snapshot.uuid ?? null,
    name: String(snapshot.name ?? ""),
    actorType: snapshot.actorType ?? null,
    displayName: Number(snapshot.displayName) || 0,
    defense,
    adjustments,
    ...resolveAttack({ total, natural, threat, defense })
  };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function isOn() {
  try {
    return game.settings.get(MODULE_ID, ATTACK_VS_DEFENSE_SETTING) === "on";
  } catch {
    return false;
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
 * Compares every attack roll of the clone with the targets and records the result in the roll.
 * Exported for tests.
 */
export function annotate(item, records, tokens) {
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
      extra: defenseAdjustmentsFor(item, record.uuid)
    }));
  if (!snapshots.length) return;
  const checks = getConcealmentChecks(item);
  for (const r of item.system.rolls ?? []) {
    if (r?.type !== "ataque") continue;
    const roll = rolled[r.name];
    const die = roll?.terms?.[0];
    if (!roll?.options || roll.options.type !== "attack" || die?.faces !== 20) continue;
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
}

function label(key, data) {
  const path = `T20CP.AttackVsDefense.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

/**
 * Text of one target line for the current user. Exported for tests.
 * @returns {{name: string, text: string}}
 */
export function describeTarget(target, index) {
  let live = null;
  try {
    live = target.uuid ? foundry.utils.fromUuidSync(target.uuid) : null;
  } catch {}
  const actor = live?.actor ?? null;
  const isGM = !!game.user.isGM;
  const isObserver = !!actor?.testUserPermission?.(game.user, "OBSERVER");
  let showFoeDc = true;
  try {
    showFoeDc = !!game.settings.get("tormenta20", "showFoeDc");
  } catch {}
  const visibleName = canSeeTokenName({
    isGM,
    isOwner: !!live?.isOwner,
    displayName: live ? live.displayName : target.displayName
  });
  const name = visibleName ? target.name : label("Target", { n: index + 1 });
  const parts = [];
  if (target.outcome === "unknown") parts.push(label("Unknown"));
  else if (target.concealment) parts.push(label("MissConcealment"));
  else parts.push(label(target.critical ? "HitCritical" : target.outcome === "hit" ? "Hit" : "Miss"));
  if (target.automatic === "nat20") parts.push(label("Natural20"));
  if (target.automatic === "nat1") parts.push(label("Natural1"));
  for (const id of target.adjustments ?? []) {
    // Shared namespace: each producer ships its own keys (this rule: prone-ranged).
    const key = `T20CP.DefenseAdjustment.${id}`;
    parts.push(game.i18n.has(key) ? game.i18n.localize(key) : String(id));
  }
  if (Number.isFinite(target.defense) && canSeeDefense({ isGM, isObserver, actorType: target.actorType, showFoeDc })) {
    parts.push(label("Defense", { value: target.defense }));
  }
  return { name, text: parts.join(" · ") };
}

/** Adds the result block under each annotated attack roll of the card. Idempotent. Exported for tests. */
export function decorate(message, html) {
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
      const { name, text } = describeTarget(target, index);
      const li = document.createElement("li");
      li.classList.add(`t20cp-avd-${["hit", "miss"].includes(target.outcome) ? target.outcome : "unknown"}`);
      if (target.critical) li.classList.add("t20cp-avd-critical");
      const strong = document.createElement("strong");
      strong.textContent = `${name}: `;
      li.append(strong, document.createTextNode(text));
      list.append(li);
    });
    box.append(list);
    container.append(box);
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerAttackVsDefenseSetting() {
  game.settings.register(MODULE_ID, ATTACK_VS_DEFENSE_SETTING, {
    name: "T20CP.AttackVsDefense.Setting.Name",
    hint: "T20CP.AttackVsDefense.Setting.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: { off: "T20CP.AttackVsDefense.Setting.off", on: "T20CP.AttackVsDefense.Setting.on" },
    default: "off"
  });
}

/** Installs the rule. The setting is read on every attack, so a change applies without reloading. */
export function installAttackVsDefenseRule() {
  registerTargetConsumer(isOn);
  installUseTargets();
  const itemProto = CONFIG.Item.documentClass?.prototype;
  const rollAttack = itemProto?.rollAttack;
  if (typeof rollAttack !== "function") throw new Error("ItemT20#rollAttack not found");
  itemProto.rollAttack = markWrapper(async function (...args) {
    let records = [];
    let tokens = [];
    try {
      // Read synchronously, before the first await: records (persisted) and tokens (live Defense).
      // The defender's test of a maneuver is not an attack against the defender's own targets.
      if (isOn() && usePurposeOf(this) !== USE_PURPOSES.MANEUVER_RESISTANCE) {
        records = useTargetRecords(this);
        tokens = useTargets(this);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | attack-vs-defense: failed to read the targets`, err);
    }
    const result = await rollAttack.apply(this, args);
    if (records.length) {
      try {
        annotate(this, records, tokens);
      } catch (err) {
        console.error(`${MODULE_ID} | attack-vs-defense: failed to compare the attack`, err);
      }
    }
    return result;
  }, rollAttack);

  const messageProto = CONFIG.ChatMessage.documentClass?.prototype;
  const renderHTML = messageProto?.renderHTML;
  if (typeof renderHTML !== "function") throw new Error("ChatMessage#renderHTML not found");
  messageProto.renderHTML = markWrapper(async function (...args) {
    const html = await renderHTML.apply(this, args);
    try {
      decorate(this, html);
    } catch (err) {
      console.error(`${MODULE_ID} | attack-vs-defense: failed to show the result`, err);
    }
    return html;
  }, renderHTML);
}
