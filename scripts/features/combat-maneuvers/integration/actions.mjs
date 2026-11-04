/** Actions of "Manobras de combate" (#48): the declared card B, "Resistir" and "Dar passagem" (the result C). */
import { MODULE_ID } from "../../../lib/module.mjs";
import { USE_PURPOSES } from "../../../lib/targets.mjs";
import {
  DATA_VERSION,
  LUTA,
  MANEUVER_FLAG,
  RESULT_FLAG,
  attackFromRolls,
  attackerTokenUuid,
  inheritedVisibility,
  maneuverOutcome,
  maneuverSizeModifier,
  maneuverTest,
  maneuverWeapons,
  pickTestRoll,
  resolveOpposed,
  rollData
} from "../domain/index.mjs";
import { buildManeuverContent, buildResultContent, t } from "../ui/cards.mjs";
import { promptResist } from "../ui/dialogs.mjs";
import { canResist, concealmentOf, fromUuid, isEnabled, visibleResults, warn } from "./runtime.mjs";

/** The declared card carries its attack roll, whose miss chance block (#49) shows the d10. */
const withInCard = (concealment) => (concealment ? { ...concealment, inCard: true } : null);

const sizeModOf = (rt, size) => maneuverSizeModifier(size, rt.ctx.platform.t20Config()?.sizeModifiers);

/** Flag data of a maneuver card B. */
function maneuverData(rt, { kind, versatile, other = 0, source, actor, speaker, alias, record, attack, concealment = null }) {
  const size = actor.system?.tracos?.tamanho ?? null;
  const sizeMod = sizeModOf(rt, size);
  const test = maneuverTest(attack, { sizeMod, versatile, other });
  return {
    v: DATA_VERSION,
    kind,
    source,
    attacker: { actorUuid: actor.uuid ?? null, tokenUuid: attackerTokenUuid(speaker, actor), size, name: alias ?? actor.name },
    target: { uuid: record.uuid, name: String(record.name ?? ""), displayName: Number(record.displayName ?? 0) },
    attack: { d20: attack.d20, roll: attack.roll, sizeMod, versatile, other, ...test },
    concealment
  };
}

/** B carries a copy of the use's attack roll (`rolls`), the maneuver test. */
function maneuverChatData(rt, data, { speaker, whisper, blind, rolls = [] }) {
  return {
    user: rt.ctx.platform.user.id(),
    speaker: { ...(speaker ?? {}) },
    whisper: [...(whisper ?? [])],
    blind: !!blind,
    content: buildManeuverContent(rt.ctx, data),
    rolls: rollData(rolls),
    flags: { "core.canPopout": true, [MODULE_ID]: { [MANEUVER_FLAG]: data } }
  };
}

const messageMode = (rt) => rt.ctx.platform.settingsOf("core").get("messageMode");

/** The maneuver card B that replaces the attack card of a use with a declared maneuver; null without an attack. */
export function declaredCard(rt, item, declaration, rollMode) {
  const { chat } = rt.ctx.platform;
  const rolls = Object.values(item.system?.rolled ?? {});
  const roll = pickTestRoll(rolls);
  const attack = attackFromRolls(rolls);
  if (!roll || !attack) return null;
  const speaker = chat.speaker({ actor: item.actor });
  const data = maneuverData(rt, {
    kind: declaration.kind,
    versatile: declaration.versatile,
    source: null,
    actor: item.actor,
    speaker,
    alias: speaker?.alias,
    record: declaration.record,
    attack,
    concealment: withInCard(concealmentOf(rt, roll, declaration.record?.uuid))
  });
  const chatData = maneuverChatData(rt, data, { speaker, rolls: [roll] });
  chat.applyMode(chatData, rollMode || messageMode(rt));
  return chatData;
}

/** Checks shared by Resistir and Dar passagem; returns the target actor or null (after a warning). */
function checkResistance(rt, card, data) {
  if (data.concealment) return warn(rt, "Concealed");
  if (visibleResults(rt, card.id).length) return warn(rt, "Resolved");
  const actor = fromUuid(rt, data.target?.uuid)?.actor ?? null;
  if (!actor || (data.attacker?.actorUuid && !fromUuid(rt, data.attacker.actorUuid))) return warn(rt, "Missing");
  if (!canResist(rt, actor)) return warn(rt, "NotOwner");
  return actor;
}

async function createResult(rt, card, data, { passage, defender, rolls }) {
  const { chat } = rt.ctx.platform;
  const outcome = passage
    ? { winner: "passage", margin: 0, tieBreak: false, condition: null, pushMeters: 0, noteKey: "passage" }
    : maneuverOutcome(data.kind, resolveOpposed(data.attack, defender));
  const result = {
    v: DATA_VERSION,
    of: card.id,
    kind: data.kind,
    passage,
    attacker: data.attacker,
    target: data.target,
    attack: data.attack,
    defender: passage ? null : defender,
    outcome
  };
  const chatData = {
    user: rt.ctx.platform.user.id(),
    speaker: { scene: null, actor: null, token: null, alias: t(rt.ctx, "Card.Speaker") },
    content: buildResultContent(rt.ctx, result),
    rolls: rollData(rolls),
    flags: { [MODULE_ID]: { [RESULT_FLAG]: result } }
  };
  const inherited = inheritedVisibility(card);
  if (inherited) Object.assign(chatData, inherited);
  else chat.applyMode(chatData, messageMode(rt));
  return chat.create(chatData);
}

/** The defender's roll: the chosen weapon's attack (as a maneuver resistance) or a Luta test. */
async function defenderRoll(rt, actor, choice, event) {
  if (choice.weapon) {
    const weapon = choice.weapon;
    const chatData = await rt.uses.withUsePurpose(USE_PURPOSES.MANEUVER_RESISTANCE, () => weapon.roll({ createMessage: false, event }));
    return pickTestRoll(chatData?.rolls);
  }
  const skillRoll = await actor.rollPericia(LUTA, { message: false, event });
  return pickTestRoll(skillRoll ? [skillRoll] : []);
}

async function resist(rt, card, data, event) {
  const actor = checkResistance(rt, card, data);
  if (!actor) return null;
  const weapons = maneuverWeapons(actor.items);
  if (!weapons.length && !actor.system?.pericias?.[LUTA]) return warn(rt, "NoTest");
  const choice = await promptResist(rt.ctx, actor, data.kind, weapons);
  if (!choice) return null;

  const roll = await defenderRoll(rt, actor, choice, event);
  const test = attackFromRolls(roll ? [roll] : []);
  if (!test) return null;
  // A result may have arrived while the dialogs were open.
  if (visibleResults(rt, card.id).length) return warn(rt, "Resolved");
  if (!isEnabled(rt)) return null;

  const sizeMod = sizeModOf(rt, actor.system?.tracos?.tamanho ?? null);
  const totals = maneuverTest(test, { sizeMod, versatile: choice.versatile, other: choice.other });
  const defender = {
    weaponId: choice.weapon?.id ?? null,
    weaponName: choice.weapon?.name ?? null,
    d20: test.d20,
    roll: test.roll,
    sizeMod,
    versatile: choice.versatile,
    other: choice.other,
    ...totals
  };
  return createResult(rt, card, data, { passage: false, defender, rolls: [roll] });
}

/** "Resistir" on the maneuver card B: the defender's maneuver test, then the result C. Exported for tests. */
export async function onResistClick(rt, card, event) {
  if (!isEnabled(rt)) return null;
  const data = card.getFlag?.(MODULE_ID, MANEUVER_FLAG);
  if (!data || rt.locks.has(card.id)) return null;
  rt.locks.add(card.id);
  try {
    return await resist(rt, card, data, event);
  } finally {
    rt.locks.delete(card.id);
  }
}

/** "Dar passagem" on an Atropelar card: the advance goes on without a test. Exported for tests. */
export async function onPassageClick(rt, card) {
  if (!isEnabled(rt)) return null;
  const data = card.getFlag?.(MODULE_ID, MANEUVER_FLAG);
  if (!data || data.kind !== "atropelar" || rt.locks.has(card.id)) return null;
  rt.locks.add(card.id);
  try {
    if (!checkResistance(rt, card, data)) return null;
    return await createResult(rt, card, data, { passage: true, defender: null, rolls: [] });
  } finally {
    rt.locks.delete(card.id);
  }
}
