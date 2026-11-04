import { SETTING_KEY, exceedsLimit, normalizeSegmentedScene } from "./domain.mjs";

/**
 * The Segmented Scene form, an ApplicationV2 that edits `max` and `value` of the system setting.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @param {() => number} getLimit  The configured cap.
 * @returns {Function}
 */
export function createConfigClass(ctx, getLimit) {
  const { platform } = ctx;
  const { ApplicationV2, fields } = platform.core;
  const { NumberField } = fields;
  const system = platform.settingsOf("tormenta20");

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
      const { value, max } = system.get(SETTING_KEY) ?? {};
      const i18n = platform.i18n;
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
      button.append(icon, ` ${i18n.localize("T20CP.SegmentedScene.Save")}`);
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
        throw new Error(platform.i18n.format("T20CP.SegmentedScene.OverLimit", { max: data.max, limit }));
      }
      await system.set(SETTING_KEY, data);
    }
  };
}
