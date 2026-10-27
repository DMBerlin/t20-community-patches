/**
 * Segmented Scene setting (tormenta20 1.6.5).
 *
 * Bug: "tormenta20.segmentedScene" is registered with config:true and a SchemaField type. SettingsConfig cannot render
 * a field without form support (SchemaField has no _toInput); the formGroup helper logs the error and drops the row,
 * so the GM gets a console error every time the settings window opens and the optional rule cannot be configured.
 *
 * Fix: hide the broken row (config=false) and add a menu button in the system tab opening a small ApplicationV2 form
 * that edits `max` and `value`, saving the same {value, max} object through game.settings.set.
 *
 * The system draws one circle per segment in the players list on every client, so `max` is capped by a module
 * setting (default 10). Values above the cap are rejected; a stored value above it only warns the GMs.
 */

import { MODULE_ID } from "../utils.mjs";

export const SETTING_NAMESPACE = "tormenta20";
export const SETTING_KEY = "segmentedScene";
export const MENU_KEY = "t20cpSegmentedScene";
export const LIMIT_KEY = "segmentedSceneMaxSegments";
export const DEFAULT_LIMIT = 10;

/**
 * Normalizes the submitted Segmented Scene values.
 * max <= 0, empty or invalid → rule disabled ({value: null, max: null}, the system default).
 * value is an integer clamped to [0, max].
 * @param {{max?: unknown, value?: unknown}} [data]
 * @returns {{value: number|null, max: number|null}}
 */
export function normalizeSegmentedScene({ max, value } = {}) {
  const m = toInteger(max);
  if (m === null || m <= 0) return { value: null, max: null };
  const v = toInteger(value);
  return { value: v === null ? 0 : Math.min(Math.max(v, 0), m), max: m };
}

/**
 * Resolves the configured cap. Invalid or < 1 falls back to DEFAULT_LIMIT.
 * @param {unknown} raw
 * @returns {number}
 */
export function resolveLimit(raw) {
  const n = toInteger(raw);
  return n !== null && n >= 1 ? n : DEFAULT_LIMIT;
}

/**
 * Whether a (normalized or stored) Segmented Scene value has more segments than the cap.
 * @param {{max?: unknown}|null|undefined} scene
 * @param {number} limit
 * @returns {boolean}
 */
export function exceedsLimit(scene, limit) {
  const max = Number(scene?.max);
  return Number.isFinite(max) && max > limit;
}

function toInteger(raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether the registered setting still has the broken shape: shown in the settings window with a DataField type
 * that cannot be rendered as a form input.
 * @param {{config?: boolean, type?: unknown}|undefined} setting
 * @param {Function} DataField  foundry.data.fields.DataField
 * @returns {boolean}
 */
export function needsFix(setting, DataField) {
  return !!setting?.config && setting.type instanceof DataField && !setting.type.constructor.hasFormSupport;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function getSetting() {
  return game.settings.settings.get(`${SETTING_NAMESPACE}.${SETTING_KEY}`);
}

function getLimit() {
  return resolveLimit(game.settings.get(MODULE_ID, LIMIT_KEY));
}

/** Warns the GMs when the stored number of segments is above the cap. */
function warnIfOverLimit() {
  if (!game.user?.isGM) return;
  const scene = game.settings.get(SETTING_NAMESPACE, SETTING_KEY);
  const limit = getLimit();
  if (!exceedsLimit(scene, limit)) return;
  ui.notifications?.warn(game.i18n.format("T20CP.SegmentedScene.StoredOverLimit", { max: scene.max, limit }), { permanent: true });
}

function createConfigClass() {
  const { ApplicationV2 } = foundry.applications.api;
  const { NumberField } = foundry.data.fields;

  return class SegmentedSceneConfig extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "t20cp-segmented-scene",
      tag: "form",
      classes: ["t20cp-segmented-scene"],
      window: { title: "T20CP.SegmentedScene.Title", icon: "fa-solid fa-film", contentClasses: ["standard-form"] },
      position: { width: 420 },
      form: { handler: SegmentedSceneConfig.#onSubmit, closeOnSubmit: true }
    };

    async _renderHTML(_context, _options) {
      const { value, max } = game.settings.get(SETTING_NAMESPACE, SETTING_KEY) ?? {};
      const i18n = game.i18n;
      const field = new NumberField({ integer: true, min: 0, nullable: true });
      const fragment = document.createDocumentFragment();
      fragment.append(
        field.toFormGroup(
          { label: i18n.localize("T20CP.SegmentedScene.Max"), hint: i18n.format("T20CP.SegmentedScene.MaxHint", { limit: getLimit() }) },
          { name: "max", value: max ?? null }
        ),
        field.toFormGroup(
          { label: i18n.localize("T20CP.SegmentedScene.Value"), hint: i18n.localize("T20CP.SegmentedScene.ValueHint") },
          { name: "value", value: value ?? null }
        )
      );
      const footer = document.createElement("footer");
      footer.className = "form-footer";
      const button = document.createElement("button");
      button.type = "submit";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-floppy-disk";
      button.append(icon, ` ${game.i18n.localize("T20CP.SegmentedScene.Save")}`);
      footer.append(button);
      fragment.append(footer);
      return fragment;
    }

    _replaceHTML(result, content, _options) {
      content.replaceChildren(result);
    }

    /** Throwing keeps the window open and shows the error (ApplicationV2#_onSubmitForm); nothing is saved. */
    static async #onSubmit(_event, _form, formData) {
      const data = normalizeSegmentedScene(formData.object);
      const limit = getLimit();
      if (exceedsLimit(data, limit)) {
        throw new Error(game.i18n.format("T20CP.SegmentedScene.OverLimit", { max: data.max, limit }));
      }
      await game.settings.set(SETTING_NAMESPACE, SETTING_KEY, data);
    }
  };
}

function apply() {
  const setting = getSetting();
  if (!setting) throw new Error(`${SETTING_NAMESPACE}.${SETTING_KEY} is not registered`);
  if (!needsFix(setting, foundry.data.fields.DataField)) return;

  setting.config = false;
  game.settings.register(MODULE_ID, LIMIT_KEY, {
    name: "T20CP.SegmentedScene.Limit.Name",
    hint: "T20CP.SegmentedScene.Limit.Hint",
    scope: "world",
    config: false,
    type: new foundry.data.fields.NumberField({ required: true, nullable: false, integer: true, min: 1, initial: DEFAULT_LIMIT }),
    default: DEFAULT_LIMIT,
    onChange: warnIfOverLimit
  });
  game.settings.registerMenu(SETTING_NAMESPACE, MENU_KEY, {
    name: "T20CP.SegmentedScene.Name",
    label: "T20CP.SegmentedScene.Button",
    hint: "T20CP.SegmentedScene.Hint",
    icon: "fa-solid fa-film",
    type: createConfigClass(),
    restricted: true
  });

  Hooks.once("ready", warnIfOverLimit);
  // The first save of a world setting creates its document; later saves update it.
  const onSettingChange = (doc) => {
    if (doc?.key === `${SETTING_NAMESPACE}.${SETTING_KEY}`) warnIfOverLimit();
  };
  Hooks.on("createSetting", onSettingChange);
  Hooks.on("updateSetting", onSettingChange);
}

/**
 * The bug exists while the setting is shown in the settings window with a field type that cannot be rendered.
 * @returns {boolean|undefined}
 */
function isNeeded() {
  const setting = getSetting();
  const DataField = foundry.data?.fields?.DataField;
  if (!setting || !DataField) return undefined;
  return needsFix(setting, DataField);
}

export default {
  id: "segmented-scene-setting",
  group: "settings",
  issue: 9,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
