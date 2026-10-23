/**
 * Bug: tormenta20.parceiros "Combatente" usage effects give attack +1/+2/+3; the core rulebook (p. 261) and the item
 * description give +2/+3/+4 (Iniciante/Veterano/Mestre).
 * Fix: in ItemT20#_preCreate (and in Actor#_preCreate for the items of a new actor, whose own _preCreate the core does
 * not call), before the system code, correct each of the three effects on its own, only when the copy comes from the
 * known entry and that effect is still exactly the 1.6.5 effect. Copies created before stay as they are and are marked
 * on the actor sheet.
 */
import {
  change,
  effectLike,
  effectSignature,
  effectsOf,
  outdatedMarker,
  readEntries,
  sameSignature,
  summarize,
  wrapActorPreCreate,
  wrapPreCreate
} from "../compendium-copy.mjs";
import { MODULE_ID } from "../utils.mjs";

const PATCH_ID = "partner-combatant";

/** Effect id -> [level, 1.6.5 attack bonus, rulebook attack bonus]. */
export const COMBATANT_ATTACK = {
  "0XdtJE9twft7P06y": ["Iniciante", 1, 2],
  "8HB07xD3YNsKwoVi": ["Veterano", 2, 3],
  kkGIh1gcIfCkUSnZ: ["Mestre", 3, 4]
};

/** Signature of a Combatente attack effect as stored by the system pack (cleaned source). */
export function combatantEffect(id, value) {
  return effectLike(id, "Combatente", {
    disabled: true,
    transfer: false,
    onuse: true,
    abilityUse: { types: ["attack"] },
    duration: { expiry: "sceneEnd" },
    changes: [change("ataque", "add", value, 0)]
  });
}

const isCombatant = (src) => src?.type === "poder" && src?.name === "Combatente";
const isLevelId = (id) => typeof id === "string" && Object.hasOwn(COMBATANT_ATTACK, id);
const matchesLevel = (effect, id, value) =>
  sameSignature({ ...effectSignature(effect), _id: id }, combatantEffect(id, value));

/** Attack bonus (1 to 4) of an effect that is exactly a Combatente attack effect apart from its _id; else null. */
const attackValue = (effect) => [1, 2, 3, 4].find((value) => matchesLevel(effect, effect?._id, value)) ?? null;

/**
 * Attack effects of a copy whose effects all got a new _id: the system gives a new _id to every usage effect whose _id
 * repeats on the actor (T20 ready hook "Fix OnUse Effects with duplicated effect ids"), so a second Combatente on the
 * same actor loses the table ids. A level cannot be told by its value alone (a corrected Iniciante and a wrong Veterano
 * both give +2), so the whole set decides: exactly one effect each with +1/+2/+3 (all wrong) or with +2/+3/+4 (all
 * corrected), mapped by value; anything else leaves every level undetermined. Map value -> effect, or null.
 */
function renumberedSet(src) {
  const effects = effectsOf(src);
  if (effects.some((e) => isLevelId(e?._id))) return null;
  const attacks = effects.map((effect) => [attackValue(effect), effect]).filter(([value]) => value !== null);
  const values = attacks.map(([value]) => value).sort().join(",");
  return values === "1,2,3" || values === "2,3,4" ? new Map(attacks) : null;
}

/**
 * Effect of this level holding exactly the 1.6.5 effect with `value` (the 1.6.5 bonus or the rulebook bonus): the
 * effect with the level _id, or, in a copy whose effects all got a new _id, the one the whole set assigns to it.
 */
export function levelEffect(src, id, value) {
  if (!isCombatant(src)) return undefined;
  const own = effectsOf(src).find((e) => e?._id === id);
  if (own) return matchesLevel(own, id, value) ? own : undefined;
  const set = renumberedSet(src);
  const [, wrong, right] = COMBATANT_ATTACK[id];
  if (!set || (value !== wrong && value !== right)) return undefined;
  const allWrong = set.has(1);
  return (allWrong ? value === wrong : value === right) ? set.get(value) : undefined;
}

/** Whether the effect of this level is still exactly the 1.6.5 effect. */
export const combatantLevelIsWrong = (src, id) => !!levelEffect(src, id, COMBATANT_ATTACK[id][1]);

/** Whether the effect of this level is exactly the 1.6.5 effect with the rulebook bonus. */
export const combatantLevelIsCorrect = (src, id) => !!levelEffect(src, id, COMBATANT_ATTACK[id][2]);

/**
 * Full effects array with each wrong level corrected on its own (the value keeps its type, number or text); null when
 * no level is still the 1.6.5 effect. Every effect keeps its own _id, so updateSource edits each one in place.
 */
export function fixCombatant(src, ids = Object.keys(COMBATANT_ATTACK)) {
  const targets = new Map();
  for (const id of ids) {
    const effect = levelEffect(src, id, COMBATANT_ATTACK[id][1]);
    if (effect) targets.set(effect, COMBATANT_ATTACK[id][2]);
  }
  if (!targets.size) return null;
  const effects = effectsOf(src).map((effect) => {
    const copy = structuredClone(effect);
    if (targets.has(effect)) {
      const target = targets.get(effect);
      const current = copy.system.changes[0];
      current.value = typeof current.value === "string" ? String(target) : target;
    }
    return copy;
  });
  return { effects };
}

export const ENTRIES = [
  {
    pack: "parceiros",
    id: "nNpGA5SWMj7rtUQR",
    name: "Combatente",
    fix: (src) => fixCombatant(src),
    isCorrect: (src) => Object.keys(COMBATANT_ATTACK).every((id) => combatantLevelIsCorrect(src, id)),
    // Each level is diagnosed on its own.
    parts: Object.entries(COMBATANT_ATTACK).map(([id, [level]]) => ({
      name: `Combatente (${level})`,
      fix: (src) => fixCombatant(src, [id]),
      isCorrect: (src) => combatantLevelIsCorrect(src, id)
    }))
  }
];

function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data can only be read after ready" };
}

async function lateProbe() {
  try {
    return summarize(await readEntries(ENTRIES));
  } catch (error) {
    console.warn(`${MODULE_ID} | ${PATCH_ID}: probe failed`, error);
    return undefined;
  }
}

function apply() {
  const item = CONFIG.Item.documentClass?.prototype;
  if (typeof item?._preCreate === "function") item._preCreate = wrapPreCreate(item._preCreate, "Item", ENTRIES, PATCH_ID);
  const actor = CONFIG.Actor.documentClass?.prototype;
  if (typeof actor?._preCreate === "function") actor._preCreate = wrapActorPreCreate(actor._preCreate, ENTRIES, PATCH_ID);
  Hooks.on("renderActorSheetT20", outdatedMarker(ENTRIES, "T20CP.PartnerCombatant.Outdated", PATCH_ID));
}

export default {
  id: PATCH_ID,
  group: "items",
  issue: 56,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  lateProbe,
  apply
};
