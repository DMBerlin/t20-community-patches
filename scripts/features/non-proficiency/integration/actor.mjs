/** Reads a character's proficiencies, weapons and armor through the platform (`env` is the install's state). */
import { isArmorPenaltyReducer, parseReduction } from "../../../lib/armor-penalty.mjs";
import { resolveDataRefs } from "../../../lib/data-refs.mjs";
import { PDA_KEY, armorStatus, itemArmorPenalty, resolveProficiencies, sourceId, weaponStatus } from "../domain/index.mjs";

const TWO_HANDED_SLOT = 12;

function slotsEnabled(platform) {
  return platform.settingsOf("tormenta20").get("equipmentSlots");
}

/** Same condition as ItemT20#roll for adaptable damage (T20:8553-8556). */
function isTwoHanded(platform, system) {
  return slotsEnabled(platform) ? parseInt(system.equipado2?.slot) === TWO_HANDED_SLOT : system.equipado === 2;
}

export function actorProficiencies(actor) {
  const types = actor.itemTypes ?? {};
  return resolveProficiencies({
    classes: (types.classe ?? []).map((c) => ({ id: sourceId(c), name: c.name, inicial: Boolean(c.system?.inicial) })),
    powers: (types.poder ?? []).map((p) => ({ id: sourceId(p), name: p.name })),
    race: types.race?.[0]?.name ?? "",
    traits: actor.system?.tracos ?? {}
  });
}

export function weaponStatusOf(env, item, profs) {
  if (item?.type !== "arma" || item.actor?.type !== "character") return "ok";
  const s = item.system ?? {};
  return weaponStatus(
    {
      name: item.name,
      proficiencia: s.proficiencia,
      proposito: s.proposito,
      adaptable: Boolean(s.propriedades?.ada),
      twoHanded: isTwoHanded(env.platform, s)
    },
    profs ?? actorProficiencies(item.actor)
  );
}

/** The armor and shield prepareDefense counts (T20:19887-19893), armor first. */
function defenseItems(platform, actor) {
  const slots = slotsEnabled(platform);
  const items = (actor.itemTypes?.equipamento ?? []).filter((i) => (slots ? i.system.equipado2?.slot : i.system.equipado));
  return [items.find((i) => ["leve", "pesada"].includes(i.system.tipo)), items.find((i) => i.system.tipo === "escudo")]
    .filter(Boolean);
}

/** Same rule as #19's resolveItemId: the owning item, or the item of the effect's origin. */
function effectItemId(platform, actor, effect) {
  const Item = platform.core.Item;
  if (effect.parent instanceof Item && effect.parent.parent === actor) return effect.parent.id;
  if (effect.origin) {
    try {
      const origin = platform.documents.fromUuidSync(effect.origin, { strict: false });
      if (origin instanceof Item && origin.parent === actor) return origin.id;
    } catch {
      /* not resolvable synchronously */
    }
  }
  return null;
}

/** Increases and reductions of the armor penalty, by item id, from the actor's active effects. */
function penaltyChanges(env, actor, items) {
  const { platform } = env;
  const ids = new Set(items.map((i) => i.id));
  const reductionsOn = env.reductionApplied();
  const increase = new Map();
  const reduction = new Map();
  let rollData;
  const Roll = platform.dice.Roll;
  const evaluate = (formula) =>
    Roll.create(resolveDataRefs(formula, (rollData ??= actor.getRollData()), Roll.defaultImplementation)).evaluateSync().total;
  const add = (map, id, amount) => map.set(id, (map.get(id) ?? 0) + amount);
  for (const effect of actor.allApplicableEffects()) {
    if (!effect.active) continue;
    const reducer = isArmorPenaltyReducer(effect);
    // #19 sends reductions without an item to the armor (or the shield); increases without an item (Sobrecarregado) never count.
    const target = effectItemId(platform, actor, effect) ?? (reducer ? items[0]?.id : null);
    if (!ids.has(target)) continue;
    for (const change of effect.system?.changes ?? []) {
      if (change.key !== PDA_KEY || change.type !== "add") continue;
      if (!effect.shouldApplyChange(change, { phase: "initial" })) continue;
      const amount = parseReduction(change.value, evaluate);
      if (!reducer) add(increase, target, amount);
      else if (reductionsOn) add(reduction, target, amount);
    }
  }
  return { increase, reduction };
}

/**
 * Penalty of each equipped armor and shield, read from the stored item data and the active effects, so it does not
 * depend on #19's temporary change of the item during preparation: the sheet icon and the skills read the same value.
 */
export function armorEntries(env, actor) {
  const items = defenseItems(env.platform, actor);
  const { increase, reduction } = penaltyChanges(env, actor, items);
  const profs = actorProficiencies(actor);
  const entries = items.map((item) => ({
    item,
    status: armorStatus({ name: item.name, tipo: item.system.tipo }, profs),
    penalty: itemArmorPenalty({
      base: item._source?.system?.armadura?.penalidade,
      increase: increase.get(item.id) ?? 0,
      reduction: reduction.get(item.id) ?? 0
    })
  }));
  return { profs, entries, penalty: entries.reduce((sum, e) => sum + (e.status === "penalty" ? e.penalty : 0), 0) };
}
