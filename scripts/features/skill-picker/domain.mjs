/** Pure logic of the skill picker: which powers ask, which skills are offered and the training effects stored. */
import { MODULE_ID } from "../../lib/module.mjs";

export const SKILL_PICKER_SETTING = "skillPickerRule";
/** Operation option that links _preCreateOperation to the createDocuments call that releases the actor queue. */
export const PICKER_OPERATION = "t20cpSkillPickerOperation";

const PACK_PREFIX = "Compendium.tormenta20.poderes.Item.";
const TRAINED_KEY = /^system\.pericias\.[^.]+\.treinado$/;
const CUSTOM_CRAFT = /^ofi[1-9]$/;

/** Class skills of the Nobre (livro básico, p. 79), without Ofício, which is matched by crafting. */
export const NOBRE_SKILLS = new Set([
  "ades", "atua", "cava", "conh", "dipl", "enga", "fort", "guer", "inic",
  "inti", "intu", "inve", "joga", "luta", "nobr", "perc", "pont", "vont"
]);

/**
 * @typedef {object} PickerSpec
 * @property {string} id            Item id in tormenta20.poderes.
 * @property {string} name          Item name, used as a fallback for world copies.
 * @property {number} min
 * @property {number} max
 * @property {"int"|"nobre"} [filter]
 * @property {boolean} [alternative] Fewer picks are allowed because the book offers something else instead.
 */

/** @type {PickerSpec[]} */
export const PICKER_SPECS = [
  { id: "Vt6W9YWlxtGrZlUH", name: "Treinamento em Perícia", min: 1, max: 1 },
  { id: "9QQnUgUh5ThF96Cd", name: "Versátil", min: 1, max: 2, alternative: true },
  { id: "9LjWgSEYKGmd0ix9", name: "Híbrido", min: 1, max: 1 },
  { id: "Wj1J9EBK9tOe2hkz", name: "Memória Póstuma", min: 0, max: 1, alternative: true },
  { id: "jjQgutXSxMtBrMWA", name: "Conhecimento Enciclopédico", min: 2, max: 2, filter: "int" },
  { id: "QXK4T9fN4SGYyRph", name: "Educação Privilegiada", min: 2, max: 2, filter: "nobre" }
];

const normalizeName = (name) =>
  String(name ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/**
 * Which picker applies to an item source: compendium source, then id (race grants keep the compendium id), then name.
 * @param {object} data  Item source data.
 * @param {PickerSpec[]} [specs]
 * @returns {PickerSpec|null}
 */
export function findPickerSpec(data, specs = PICKER_SPECS) {
  if (data?.type !== "poder") return null;
  const source = String(data._stats?.compendiumSource ?? data.flags?.core?.sourceId ?? "");
  if (source.startsWith(PACK_PREFIX)) {
    const bySource = specs.find((spec) => spec.id === source.slice(PACK_PREFIX.length));
    if (bySource) return bySource;
  }
  const byId = specs.find((spec) => spec.id === data._id);
  if (byId) return byId;
  const name = normalizeName(data.name);
  return specs.find((spec) => normalizeName(spec.name) === name) ?? null;
}

/**
 * Whether the item already carries a skill training effect (a copy, or the system's own picker ran).
 * @param {object} data  Item source data.
 */
export function hasTrainingEffect(data) {
  return (data?.effects ?? []).some((effect) =>
    [...(effect?.system?.changes ?? []), ...(effect?.changes ?? [])].some((change) => TRAINED_KEY.test(change?.key ?? ""))
  );
}

/**
 * Skills trained by the passive transfer effects (not usage effects) of items that are still being created (not on the actor yet).
 * @param {object[]} sources  Item source data of the operation.
 * @returns {string[]}
 */
export function pendingTrainedSkills(sources) {
  const keys = new Set();
  const passive = (effect) => !(effect?.transfer === false || effect?.disabled || effect?.system?.onuse);
  const effects = (sources ?? []).flatMap((data) => (data?.effects ?? []).filter(passive));
  for (const effect of effects) {
    for (const change of [...(effect?.system?.changes ?? []), ...(effect?.changes ?? [])]) {
      const key = String(change?.key ?? "");
      if (TRAINED_KEY.test(key) && String(change?.value) === "true") keys.add(key.split(".")[2]);
    }
  }
  return [...keys];
}

/**
 * Whether the choice was already made for this item: our marker (also written for zero picks) or a training effect.
 * @param {object} data  Item source data.
 */
export function isPickerDone(data) {
  return data?.flags?.[MODULE_ID]?.skillPicker?.done === true || hasTrainingEffect(data);
}

/**
 * FIFO queue per actor. An operation that asks for skills holds its actor until the operation settles, so the next
 * one reads the actor after the previous powers were created.
 */
export class ActorQueue {
  #tails = new Map();

  /** @param {string} key */
  isBusy(key) {
    return this.#tails.has(key);
  }

  /**
   * Waits for the earlier holders of the key and returns an idempotent release function.
   * @param {string} key
   * @returns {Promise<() => void>}
   */
  async acquire(key) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let open;
    const gate = new Promise((resolve) => (open = resolve));
    const tail = previous.then(() => gate);
    this.#tails.set(key, tail);
    await previous;
    return () => {
      open();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    };
  }
}

/**
 * Skills the character can pick: not trained yet, not chosen by an earlier power of the operation, allowed by the power.
 * @param {Record<string, {treinado?: boolean, atributo?: string, label?: string}>} pericias  actor.system.pericias
 * @param {PickerSpec} spec
 * @param {Record<string, {abl?: string, crafting?: boolean, label?: string}>} [config]       CONFIG.T20.pericias
 * @param {(key: string) => string} [localize]
 * @param {Set<string>} [reserved]  Skills already chosen by earlier powers of the same operation.
 * @returns {{key: string, label: string}[]}
 */
export function eligibleSkills(pericias, spec, config = {}, localize = (text) => text, reserved = new Set()) {
  const result = [];
  for (const [key, skill] of Object.entries(pericias ?? {})) {
    if (key === "ofic" || !skill || skill.treinado || reserved.has(key)) continue;
    const base = config[key];
    const crafting = !!base?.crafting || CUSTOM_CRAFT.test(key);
    if (spec.filter === "int" && (base?.abl ?? skill.atributo) !== "int") continue;
    if (spec.filter === "nobre" && !NOBRE_SKILLS.has(key) && !crafting) continue;
    result.push({ key, label: skill.label || localize(base?.label ?? key) });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Selection limits for the available skills.
 * @param {PickerSpec} spec
 * @param {number} available
 * @returns {{min: number, max: number}}
 */
export function selectionLimits(spec, available) {
  const max = Math.min(spec.max, Math.max(0, available));
  return { min: Math.min(spec.min, max), max };
}

/** @param {number} count @param {{min: number, max: number}} limits */
export function isValidSelection(count, { min, max }) {
  return Number.isInteger(count) && count >= min && count <= max;
}

/**
 * Picks that are no longer available after the dialog (another client trained the actor meanwhile).
 * @param {string[]} picked
 * @param {{key: string}[]} options  Eligible skills recomputed after the dialog.
 */
export function stalePicks(picked, options) {
  const available = new Set(options.map((option) => option.key));
  return picked.filter((key) => !available.has(key));
}

/**
 * Transfer effects that set each skill as trained, in the shape of the system's _applyTreinado.
 * @param {string[]} keys
 * @param {{img?: string, labelOf?: (key: string) => string, randomID: () => string}} options
 */
export function buildTrainingEffects(keys, { img, labelOf = (key) => key, randomID }) {
  return keys.map((key) => ({
    _id: randomID(),
    name: labelOf(key),
    img: img ?? null,
    disabled: false,
    transfer: true,
    system: { changes: [{ key: `system.pericias.${key}.treinado`, type: "override", value: true, priority: 20 }] },
    flags: { tormenta20: { autoTrainedPericia: true }, [MODULE_ID]: { skillPicker: true } }
  }));
}
