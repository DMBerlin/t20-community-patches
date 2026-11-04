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
  sameSignature
} from "../../lib/compendium-copy/index.mjs";
import { MODULE_ID } from "../../lib/module.mjs";

export const PATCH_ID = "race-data";
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
export function fixDwarf(src, newId = randomId) {
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

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A 16-character document id, used when no generator is given; the integration passes foundry.utils.randomID. */
function randomId() {
  return Array.from({ length: 16 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join("");
}

/** Sentidos Élficos: low-light vision (p. 22). */
export function fixElf(src) {
  if (!sameSignature(itemSignature(src), ELF_WRONG)) return null;
  return editEffects(src, "WoYZYSubI5fTCYrg", (copy) => copy.system.changes.push(raw(SENSES, "add", "penumbra")));
}

const MOVEMENT = "system.attributes.movement";
/** Changes that set the walking base; ActiveEffectT20.applyChange turns a non-add ".walk" change into ".walk.base" (T20:16985). */
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

/** Whether the race gives exactly the Minotauro attributes of the book. */
function hasBookAttributes(src) {
  const a = src?.system?.atributos ?? {};
  const book = { for: 2, des: 0, con: 1, int: 0, sab: -1, car: 0 };
  return Object.entries(book).every(([key, value]) => a[key] === value);
}

/** Minotauro with the book attributes, no attribute choice and no always-on change to attributes. */
export function minotaurIsCorrect(src) {
  return (
    src?.type === "race" &&
    hasBookAttributes(src) &&
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
 * system.atributos.<x>.racial (T20:7294), so a duplicated actor already holds the old values: its race is left as is.
 */
export const racialUnset = (actor) =>
  Object.values(actor?.system?.atributos ?? {}).every((a) => !a?.racial);

/**
 * The known entries; `newId` generates the _id of the effect added by fixDwarf.
 * @param {() => string} [newId]
 */
export function createEntries(newId) {
  return [
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
      fix: (src) => fixDwarf(src, newId),
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
}

export const ENTRIES = createEntries();

/** Ids of owned items still holding the wrong data of a known entry (created before the correction was on). */
export function outdatedItemIds(items, entries = ENTRIES) {
  const ids = [];
  for (const item of items ?? []) {
    const src = item?._source ?? item;
    if (src?._id && fixFor(src, entries, "Item")) ids.push(src._id);
  }
  return ids;
}
