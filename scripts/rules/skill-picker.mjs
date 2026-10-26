/**
 * Optional rule "Escolha de perícias" (#60).
 *
 * Book: Treinamento em Perícia, Versátil and other powers make the character trained in skills of their choice.
 * The compendium items have no effects, and the system's picker (PericiaSelection) only runs for items tagged
 * "pericia", which no item has, and never for powers granted by a race. When on, this rule asks for the skills
 * while one of these powers is created on a character (any path) and stores the training as transfer effects on
 * the power, in the same shape as the system's _applyTreinado, so removing the power removes the training.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";

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
  for (const data of sources ?? []) {
    for (const effect of data?.effects ?? []) {
      if (effect?.transfer === false || effect?.disabled || effect?.system?.onuse) continue;
      for (const change of [...(effect?.system?.changes ?? []), ...(effect?.changes ?? [])]) {
        const key = String(change?.key ?? "");
        if (TRAINED_KEY.test(key) && String(change?.value) === "true") keys.add(key.split(".")[2]);
      }
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

const queue = new ActorQueue();
/** @type {Map<string, () => void>} operation id → release of its actor queue */
const releases = new Map();

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

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, SKILL_PICKER_SETTING) === "on";
  } catch {
    return false;
  }
}

/**
 * Asks for the skills. Returns the picked keys, or null when the dialog was closed.
 * @returns {Promise<string[]|null>}
 */
async function promptSkills({ itemName, actorName, options, limits }) {
  const escape = foundry.utils.escapeHTML;
  const i18n = game.i18n;
  const prompt =
    limits.min === limits.max
      ? i18n.format("T20CP.SkillPicker.Prompt", { count: limits.max, actor: escape(actorName) })
      : i18n.format("T20CP.SkillPicker.PromptRange", { min: limits.min, max: limits.max, actor: escape(actorName) });
  const boxes = options
    .map(
      (option) =>
        `<label class="checkbox"><input type="checkbox" name="skills" value="${escape(option.key)}"> ${escape(option.label)}</label>`
    )
    .join("");
  const content = `<p>${prompt}</p><div class="t20cp-skill-picker" style="display:grid;grid-template-columns:1fr 1fr;gap:0.25em 1em">${boxes}</div>`;

  while (true) {
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n.format("T20CP.SkillPicker.Title", { item: itemName }) },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "T20CP.SkillPicker.Confirm",
          icon: "fa-solid fa-check",
          default: true,
          callback: (event, button) =>
            [...button.form.querySelectorAll('input[name="skills"]:checked')].map((input) => input.value)
        }
      ],
      render: (event, dialog) => {
        const root = dialog.element;
        const inputs = [...root.querySelectorAll('input[name="skills"]')];
        const confirm = root.querySelector('button[data-action="ok"]');
        const sync = () => {
          const count = inputs.filter((input) => input.checked).length;
          for (const input of inputs) input.disabled = !input.checked && count >= limits.max;
          if (confirm) confirm.disabled = !isValidSelection(count, limits);
        };
        for (const input of inputs) input.addEventListener("change", sync);
        sync();
      }
    });
    if (!Array.isArray(picked)) return null;
    if (isValidSelection(picked.length, limits)) return picked;
  }
}

async function pickForOperation(documents, operation, user) {
  if (!isEnabled()) return;
  if (user && user.id !== game.user?.id) return;
  const actor = operation?.parent;
  if (actor?.documentName !== "Actor" || actor.type !== "character" || actor.pack) return;
  const work = documents
    .map((item) => [item, findPickerSpec(item._source)])
    .filter(([item, spec]) => spec && !isPickerDone(item._source));
  if (!work.length) return;

  if (queue.isBusy(actor.uuid)) ui.notifications.info(game.i18n.format("T20CP.SkillPicker.Waiting", { actor: actor.name }));
  const release = await queue.acquire(actor.uuid);
  const token = operation[PICKER_OPERATION];
  if (token) releases.set(token, release);
  try {
    // Trainings already configured in this operation are not on the actor yet; reserve them so no pick is wasted.
    const chosen = new Set(pendingTrainedSkills(documents.map((item) => item._source)));
    for (const [item, spec] of work) await askAndStore(item, actor, spec, chosen);
  } finally {
    // Without an operation id nothing else releases it; with one, createDocuments does after the server answers.
    if (!token) release();
  }
}

async function askAndStore(item, actor, spec, chosen) {
  const i18n = game.i18n;
  const current = () =>
    eligibleSkills(actor.system?.pericias, spec, CONFIG.T20?.pericias, (text) => i18n.localize(text), chosen);

  let options = current();
  let picked;
  while (true) {
    const limits = selectionLimits(spec, options.length);
    if (!limits.max) {
      ui.notifications.warn(i18n.format("T20CP.SkillPicker.NoSkills", { item: item.name, actor: actor.name }));
      return;
    }
    picked = await promptSkills({ itemName: item.name, actorName: actor.name, options, limits });
    if (picked === null) {
      ui.notifications.warn(i18n.format("T20CP.SkillPicker.Cancelled", { item: item.name }));
      return;
    }
    // Revalidate: another client may have trained the actor while the dialog was open.
    options = current();
    if (!stalePicks(picked, options).length) break;
    ui.notifications.warn(i18n.format("T20CP.SkillPicker.Stale", { item: item.name }));
  }

  for (const key of picked) chosen.add(key);
  if (spec.alternative && picked.length < spec.max) {
    ui.notifications.info(i18n.format("T20CP.SkillPicker.Alternative", { item: item.name, count: picked.length, max: spec.max }));
  }

  const labels = new Map(options.map((option) => [option.key, option.label]));
  const effects = buildTrainingEffects(picked, {
    img: item.img,
    labelOf: (key) => labels.get(key) ?? key,
    randomID: () => foundry.utils.randomID()
  });
  item.updateSource({
    effects: [...(item._source.effects ?? []), ...effects],
    [`flags.${MODULE_ID}.skillPicker`]: { done: true, skills: picked }
  });
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerSkillPickerSetting() {
  game.settings.register(MODULE_ID, SKILL_PICKER_SETTING, {
    name: "T20CP.SkillPicker.Setting.Name",
    hint: "T20CP.SkillPicker.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.SkillPicker.Setting.off", on: "T20CP.SkillPicker.Setting.on" },
    default: "off"
  });
}

/**
 * Installs the rule.
 * - _preCreateOperation on CONFIG.Item.documentClass (the system class, ItemT20): the backend calls it on the configured
 *   class, once per operation, after every per-document veto (_preCreate and preCreateItem), with the documents that
 *   will really be sent, and they may be changed with updateSource. The current value (own, e.g. the
 *   level-up-multiclass patch, or inherited from the core) is captured at install time and an own property is set, so
 *   any install order chains both wrappers.
 * - createDocuments on the core base class foundry.documents.Item, inherited by ItemT20: each call gets its own
 *   operation id, on a copy of the operation, and releases the actor queue when the call settles.
 */
export function installSkillPickerRule() {
  const cls = CONFIG.Item?.documentClass;
  const base = foundry.documents?.Item;
  const originalPre = cls?._preCreateOperation;
  const originalCreate = base?.createDocuments;
  if (typeof originalPre !== "function") throw new Error("Item._preCreateOperation not found");
  if (typeof originalCreate !== "function") throw new Error("Item.createDocuments not found");
  for (let c = cls; c && c !== base; c = Object.getPrototypeOf(c)) {
    if (Object.hasOwn(c, "createDocuments")) console.warn(`${MODULE_ID} | skill-picker: ${c.name}.createDocuments overrides the wrapped base`);
  }

  cls._preCreateOperation = markWrapper(async function (documents, operation, user) {
    const allowed = await originalPre.call(this, documents, operation, user);
    if (allowed === false) return allowed;
    try {
      await pickForOperation(documents, operation, user);
    } catch (err) {
      console.error(`${MODULE_ID} | skill-picker: failed`, err);
    }
    return allowed;
  }, originalPre);

  base.createDocuments = markWrapper(async function (data = [], operation = {}) {
    if (!isEnabled()) return originalCreate.call(this, data, operation);
    const token = foundry.utils.randomID();
    try {
      return await originalCreate.call(this, data, { ...operation, [PICKER_OPERATION]: token });
    } finally {
      releases.get(token)?.();
      releases.delete(token);
    }
  }, originalCreate);
}
