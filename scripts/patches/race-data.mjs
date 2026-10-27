/**
 * Bug: tormenta20.racas and tormenta20.poderes diverge from the core rulebook (Tormenta20 JdA):
 *  - Minotauro gives Des +1 instead of Con +1 (p. 25);
 *  - Hynne "Pequeno e Rechonchudo" lacks size Small and the 6m speed (p. 28);
 *  - Anão "Conhecimento das Rochas" lacks darkvision (p. 20);
 *  - Elfo "Sentidos Élficos" lacks low-light vision (p. 22).
 * Fix: in ItemT20#_preCreate (and in Actor#_preCreate for the items of a new actor, whose own _preCreate the core does
 * not call), before the system code, correct the copy when it comes from the known entry and its mechanical data is
 * still exactly the 1.6.5 data. Copies created before stay as they are and are marked on the actor sheet.
 */
import {
  change,
  editEffects,
  effectLike,
  effectSignature,
  effectsOf,
  fixFor,
  itemSignature,
  passiveChanges,
  passiveNumber,
  passiveSetHas,
  passiveText,
  readEntries,
  sameSignature,
  summarize,
  wrapActorPreCreate,
  wrapPreCreate
} from "../compendium-copy.mjs";
import { MODULE_ID } from "../utils.mjs";

const PATCH_ID = "race-data";
const SENSES = "system.attributes.sentidos.value";
const WALK = "system.attributes.movement.walk.base";
const SIZE = "system.tracos.tamanho";

const raw = (key, type, value, priority = null) => ({ key, type, value, phase: "initial", priority });

/** Minotauro as stored in 1.6.5. */
export const MINOTAUR_WRONG = {
  type: "race",
  name: "Minotauro",
  atributos: { for: 2, des: 1, con: 0, int: 0, sab: -1, car: 0 },
  dinamicos: [],
  effects: []
};

export function raceSignature(src) {
  const a = src?.system?.atributos ?? {};
  return {
    type: src?.type,
    name: src?.name,
    atributos: { for: a.for, des: a.des, con: a.con, int: a.int, sab: a.sab, car: a.car },
    dinamicos: src?.system?.atributosDinamicos?.value,
    effects: effectsOf(src).map(effectSignature)
  };
}

export const HYNNE_WRONG = {
  type: "poder",
  name: "Pequeno e Rechonchudo",
  effects: [
    effectLike("HI65tXsIJK8edUPr", "Pequeno e Rechonchudo", { changes: [change("system.pericias.enga.bonus", "add", 2)] })
  ]
};

export const DWARF_WRONG = {
  type: "poder",
  name: "Conhecimento das Rochas",
  effects: [
    effectLike("iEaedpKQzm09vOEX", "Conhecimento das Rochas", {
      disabled: true,
      onuse: true,
      abilityUse: { custo: null, names: ["Percepção", "Sobrevivência"], types: ["skill"] },
      changes: [change("roll", "add", 2, 0)]
    })
  ]
};

export const ELF_WRONG = {
  type: "poder",
  name: "Sentidos Élficos",
  effects: [
    effectLike("WoYZYSubI5fTCYrg", "Sentidos Élficos", {
      changes: [change("system.pericias.mist.bonus", "add", 2), change("system.pericias.perc.bonus", "add", 2)]
    })
  ]
};

/** Minotauro: For +2, Con +1, Sab -1 (p. 25). */
export function fixMinotaur(src) {
  if (!sameSignature(raceSignature(src), MINOTAUR_WRONG)) return null;
  return { system: { atributos: { des: 0, con: 1 } } };
}

/** Pequeno e Rechonchudo: size Small and 6m (p. 28), as the Goblin "Peste Esguia" models size and speed. */
export function fixHynne(src) {
  if (!sameSignature(itemSignature(src), HYNNE_WRONG)) return null;
  return editEffects(src, "HI65tXsIJK8edUPr", (copy) => {
    copy.system.changes.push(raw(WALK, "override", 6), raw(SIZE, "override", "peq"));
  });
}

/** Conhecimento das Rochas: darkvision (p. 20). Its only effect is a usage effect, so an always-on one is added. */
export function fixDwarf(src, newId = () => foundry.utils.randomID()) {
  if (!sameSignature(itemSignature(src), DWARF_WRONG)) return null;
  const passive = {
    _id: newId(),
    name: src.name,
    img: src.img,
    type: "base",
    transfer: true,
    disabled: false,
    flags: { [MODULE_ID]: { addedBy: PATCH_ID } },
    system: { changes: [raw(SENSES, "add", "escuro")] }
  };
  return editEffects(src, null, () => {}, [passive]);
}

/** Sentidos Élficos: low-light vision (p. 22). */
export function fixElf(src) {
  if (!sameSignature(itemSignature(src), ELF_WRONG)) return null;
  return editEffects(src, "WoYZYSubI5fTCYrg", (copy) => copy.system.changes.push(raw(SENSES, "add", "penumbra")));
}

const MOVEMENT = "system.attributes.movement";
/** Changes that set the walking base; ActiveEffectT20.applyChange turns a non-add ".walk" change into ".walk.base" (T20:18143). */
const walkBase = (c) =>
  c?.key === WALK || c?.key === `${MOVEMENT}.*.base` || (c?.key === `${MOVEMENT}.walk` && c?.type !== "add");
/** Walking fields the system reads; a change to any of their ancestors makes the result unknown. */
const WALK_PATHS = [`${MOVEMENT}.walk.base`, `${MOVEMENT}.walk.bonus`, `${MOVEMENT}.walk.value`];
/** Actor attributes; a change to an ancestor (system.atributos) makes the result unknown. */
const ATTRIBUTE_PATHS = ["for", "des", "con", "int", "sab", "car"].map((key) => `system.atributos.${key}`);

/** Changes that alter the walking speed in any other way (bonus or value). */
const walkOther = (c) =>
  [`${MOVEMENT}.walk.bonus`, `${MOVEMENT}.walk.value`, `${MOVEMENT}.*.bonus`, `${MOVEMENT}.*.value`].includes(c?.key) ||
  (c?.key === `${MOVEMENT}.walk` && c?.type === "add");

/** Minotauro with the book attributes, no attribute choice and no always-on change to attributes. */
export function minotaurIsCorrect(src) {
  const a = src?.system?.atributos ?? {};
  const book = { for: 2, des: 0, con: 1, int: 0, sab: -1, car: 0 };
  return (
    src?.type === "race" &&
    Object.entries(book).every(([key, value]) => a[key] === value) &&
    (src?.system?.atributosDinamicos?.value ?? []).length === 0 &&
    passiveChanges(src, (c) => String(c?.key).startsWith("system.atributos."), ATTRIBUTE_PATHS)?.length === 0
  );
}

/** Pequeno e Rechonchudo whose always-on effects end with size Small and a 6m walking speed. */
export const hynneIsCorrect = (src) =>
  src?.type === "poder" &&
  passiveText(src, [SIZE]) === "peq" &&
  passiveNumber(src, walkBase, WALK_PATHS) === 6 &&
  passiveChanges(src, walkOther, WALK_PATHS)?.length === 0;

/** Power whose always-on effects end with the sense in sentidos.value. */
export const senseIsCorrect = (sense) => (src) => src?.type === "poder" && passiveSetHas(src, [SENSES], sense) === true;

/**
 * Whether no race attributes were applied to the actor yet. _onCreateOwnedRace copies the race attributes to
 * system.atributos.<x>.racial (T20:8463), so a duplicated actor already holds the old values: its race is left as is.
 */
export const racialUnset = (actor) =>
  Object.values(actor?.system?.atributos ?? {}).every((a) => !a?.racial);

export const ENTRIES = [
  {
    pack: "racas",
    id: "UknA6Hsp6YvqPuuA",
    name: "Minotauro",
    fix: fixMinotaur,
    isCorrect: minotaurIsCorrect,
    embedded: racialUnset
  },
  {
    pack: "poderes",
    id: "fLezjAZcNHYRx7rV",
    name: "Pequeno e Rechonchudo",
    fix: fixHynne,
    isCorrect: hynneIsCorrect
  },
  {
    pack: "poderes",
    id: "726XcodKEzHaBYI7",
    name: "Conhecimento das Rochas",
    fix: fixDwarf,
    isCorrect: senseIsCorrect("escuro")
  },
  {
    pack: "poderes",
    id: "PEn3CaxnaMEIAXUR",
    name: "Sentidos Élficos",
    fix: fixElf,
    isCorrect: senseIsCorrect("penumbra")
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

/** Ids of owned items still holding the wrong data of a known entry (created before the correction was on). */
export function outdatedItemIds(items, entries = ENTRIES) {
  const ids = [];
  for (const item of items ?? []) {
    const src = item?._source ?? item;
    if (src?._id && fixFor(src, entries, "Item")) ids.push(src._id);
  }
  return ids;
}

/** Marks, on the actor sheet, the items to remove and add again to receive the corrected data. */
function markOutdated(app, html) {
  try {
    const actor = app?.actor ?? app?.document;
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
    if (!actor?.items || !root?.querySelectorAll) return;
    const tooltip = game.i18n.localize("T20CP.RaceData.Outdated");
    for (const id of outdatedItemIds(actor.items)) {
      for (const row of root.querySelectorAll(`[data-item-id="${id}"]`)) {
        if (row.querySelector(".t20cp-outdated")) continue;
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-triangle-exclamation t20cp-outdated";
        icon.dataset.tooltip = tooltip;
        icon.setAttribute("aria-label", tooltip);
        const anchor = row.querySelector(".item-name label, a.item-control");
        if (anchor) anchor.after(icon);
        else row.append(icon);
      }
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | ${PATCH_ID}: outdated marker skipped`, error);
  }
}

function apply() {
  const item = CONFIG.Item.documentClass?.prototype;
  if (typeof item?._preCreate === "function") item._preCreate = wrapPreCreate(item._preCreate, "Item", ENTRIES, PATCH_ID);
  const actor = CONFIG.Actor.documentClass?.prototype;
  if (typeof actor?._preCreate === "function") actor._preCreate = wrapActorPreCreate(actor._preCreate, ENTRIES, PATCH_ID);
  Hooks.on("renderActorSheetT20", markOutdated);
}

export default {
  id: PATCH_ID,
  group: "items",
  issue: 57,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
