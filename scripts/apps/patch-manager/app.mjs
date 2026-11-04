/**
 * "Central do T20CP" (#86, #89): one window with the patches (one compact row each, details on demand) and the
 * module's optional rules, which are registered with `config: false` and only shown here. The class is built by
 * createPatchManagerClass during "init", when the platform's application classes exist; it reads nothing else global.
 */
import { MODULE_ID } from "../../lib/module.mjs";
import { getPatchMode } from "../../kernel/patch-settings.mjs";
import { centerSettings } from "../../kernel/settings.mjs";
import { needsReload } from "../../kernel/center.mjs";
import { PATCH_FILTERS, RULE_FILTERS } from "./view.mjs";
import {
  SETTING_INPUT,
  collectChanges,
  filterButtons,
  groupRows,
  patchRow,
  patchSummary,
  pendingReload,
  ruleRow,
  settingField
} from "./rows.mjs";
import { applyFilter, markTabs, openDetail, readMode, syncPatchControls, toggleDetail } from "./dom.mjs";
import { rovingIndex } from "./focus.mjs";
import { createSubmitFlow } from "./submit.mjs";

const SCROLLABLE = [".t20cp-sidebar", ".t20cp-list"];

/**
 * @param {{platform: import("../../platform/foundry.mjs").Platform, features: object[], patches: object[],
 *   groups: string[], status: () => import("../../kernel/lifecycle.mjs").StatusEntry[]}} deps
 *   features: FEATURES (rules tab); patches: PATCH_FEATURES; status: api.status, read on every render.
 */
export function createPatchManagerClass({ platform, features, patches, groups, status }) {
  const { ApplicationV2, HandlebarsApplicationMixin } = platform.apps;
  const { localize } = platform.i18n;
  const moduleSettings = platform.settingsOf(MODULE_ID);
  const text = () => ({ ...platform.i18n, escapeHTML: platform.utils.escapeHTML, lang: platform.i18n.lang() });
  const flow = createSubmitFlow(platform);

  class PatchManager extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "t20cp-patch-manager",
      tag: "form",
      classes: ["t20cp-patch-manager"],
      window: { title: "T20CP.Manager.Title", icon: "fa-solid fa-screwdriver-wrench", contentClasses: ["standard-form"], resizable: true },
      position: { width: 900, height: 640 },
      form: { handler: PatchManager.#onSubmit, closeOnSubmit: false },
      actions: {
        expand: PatchManager.#onExpand,
        filter: PatchManager.#onFilter,
        group: PatchManager.#onGroup
      }
    };

    static PARTS = {
      tabs: { template: `modules/${MODULE_ID}/templates/patch-manager-tabs.hbs` },
      patches: { template: `modules/${MODULE_ID}/templates/patch-manager.hbs`, scrollable: SCROLLABLE },
      rules: { template: `modules/${MODULE_ID}/templates/patch-manager-rules.hbs`, scrollable: SCROLLABLE },
      footer: { template: "templates/generic/form-footer.hbs" }
    };

    static TABS = {
      main: {
        tabs: [
          { id: "patches", icon: "fa-solid fa-screwdriver-wrench", label: "T20CP.Manager.Tabs.patches" },
          { id: "rules", icon: "fa-solid fa-dice-d20", label: "T20CP.Manager.Tabs.rules" }
        ],
        initial: "patches"
      }
    };

    /** Modes shown when the form was rendered, so a submit only writes what this user changed. */
    #snapshot = {};

    /** Rule setting values shown when the form was rendered, keyed by setting key. */
    #ruleSnapshot = {};

    /**
     * Search, group and status filter of each tab. The patches filter is chosen on the first render.
     * @type {Record<"patches"|"rules", import("./view.mjs").View>}
     */
    #views = { patches: { query: "", group: null, filter: null }, rules: { query: "", group: null, filter: "all" } };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const t = text();
      const byId = new Map((status() ?? []).map((s) => [s.id, s]));
      const bugs = platform.module.bugs();
      const versions = { system: platform.system.version, foundry: platform.module.coreVersion(), module: platform.module.version() };

      const rows = patches.map((patch) =>
        patchRow({ patch, entry: byId.get(patch.id), mode: getPatchMode(platform.settings, patch.id), bugs, versions }, t)
      );
      this.#snapshot = Object.fromEntries(rows.map((r) => [r.id, r.mode]));
      // Saved modes that differ from what was used at load time only take effect after a reload.
      context.pendingReload = pendingReload(rows, byId);

      const { counts, summary } = patchSummary(rows, byId, t);
      context.summary = summary;
      this.#views.patches.filter ??= counts.attention ? "attention" : "all";
      context.hasAttention = counts.attention > 0;

      context.groups = groupRows(rows, groups, localize).map((g) => ({ ...g, patches: g.rows }));
      context.patchGroups = context.groups.map(({ id, label }) => ({ id, label }));
      context.patchFilters = filterButtons(PATCH_FILTERS, localize, { attention: !context.hasAttention });

      const rules = this.#prepareRules(t);
      context.rules = rules;
      context.ruleGroups = groupRows(rules, groups, localize).map((g) => ({ ...g, rules: g.rows }));
      context.ruleNav = context.ruleGroups.map(({ id, label }) => ({ id, label }));
      context.ruleFilters = filterButtons(RULE_FILTERS, localize);
      context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "T20CP.Manager.Save" }];
      return context;
    }

    /** @override */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (context.tabs?.[partId]) context.tab = context.tabs[partId];
      return context;
    }

    /** Rows of the "Optional rules" tab, built from the registered settings like the core SettingsConfig does. */
    #prepareRules(t) {
      this.#ruleSnapshot = {};
      return centerSettings(features)
        .map((center) => ruleRow(center, center.keys.map((key) => this.#prepareSetting(key)).filter(Boolean), t))
        .filter(Boolean);
    }

    /**
     * One setting of the "Optional rules" tab, or null when it is not registered on this load.
     * @param {string} key
     */
    #prepareSetting(key) {
      const setting = moduleSettings.entry(key);
      if (!setting) return null;
      const value = platform.settings.get(key);
      this.#ruleSnapshot[key] = value;
      const input = settingField(setting, platform.core.fields).toInput({ name: `${SETTING_INPUT}${key}`, value, localize: true });
      input.setAttribute?.("aria-label", localize(setting.name ?? ""));
      return {
        key,
        value,
        label: localize(setting.name ?? ""),
        hint: localize(setting.hint ?? ""),
        input: input.outerHTML,
        requiresReload: !!setting.requiresReload
      };
    }

    /** @override */
    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      // The form element outlives re-renders of its parts, so it is listened to once.
      this.element.addEventListener("change", (event) => this.#onControlChange(event));
      this.element.addEventListener("invalid", (event) => this.#revealInvalid(event.target), true);
      this.element.addEventListener("keydown", (event) => this.#onTabKey(event));
    }

    /** @override */
    changeTab(tab, group, options) {
      super.changeTab(tab, group, options);
      markTabs(this.element, tab, group);
    }

    /** Arrow keys, Home and End move between the tabs, like a WAI-ARIA tablist. */
    #onTabKey(event) {
      const current = event.target.closest?.('[role="tab"]');
      if (!current) return;
      const tabs = [...this.element.querySelectorAll(`[role="tab"][data-group="${current.dataset.group}"]`)];
      const next = rovingIndex(event.key, tabs.indexOf(current), tabs.length, { next: "ArrowRight", previous: "ArrowLeft" });
      if (next === undefined) return;
      event.preventDefault();
      this.changeTab(tabs[next].dataset.tab, tabs[next].dataset.group);
      tabs[next].focus();
    }

    /**
     * The browser blocks the submit when a control is invalid, but cannot point at a control in a hidden tab or a
     * closed detail. Shows it, then lets the browser report the problem on it.
     * @param {EventTarget} control
     */
    #revealInvalid(control) {
      if (!(control instanceof HTMLElement) || control.checkVisibility()) return;
      const tab = control.closest(".tab[data-tab]");
      if (tab) this.changeTab(tab.dataset.tab, tab.dataset.group);
      const view = this.#views[tab?.dataset.tab];
      if (control.closest(".t20cp-row")?.hidden && view) {
        Object.assign(view, { query: "", group: null, filter: "all" });
        const search = tab.querySelector(".t20cp-search");
        if (search) search.value = "";
        this.#applyFilter(tab.dataset.tab);
      }
      openDetail(control);
      requestAnimationFrame(() => {
        control.focus();
        control.reportValidity();
      });
    }

    /** @override */
    async _onRender(context, options) {
      await super._onRender(context, options);
      for (const search of this.element.querySelectorAll(".t20cp-search")) {
        const tab = search.closest(".tab[data-tab]")?.dataset.tab;
        if (!tab || !this.#views[tab]) continue;
        search.value = this.#views[tab].query;
        search.addEventListener("input", () => {
          this.#views[tab].query = search.value;
          this.#applyFilter(tab);
        });
      }
      for (const nav of this.element.querySelectorAll(".t20cp-nav")) nav.addEventListener("keydown", (event) => this.#onGroupKey(event));
      for (const tab of Object.keys(this.#views)) this.#applyFilter(tab);
      this.#refreshFooter();
    }

    /** Keeps the "Apply always" box and the "always" tag in sync with the switch, and the footer label current. */
    #onControlChange(event) {
      syncPatchControls(this.element, event.target, (id) => readMode(this.element, id, this.#snapshot[id]));
      this.#refreshFooter();
    }

    /** "Save and reload" when the pending changes need a reload, "Save" otherwise. */
    #refreshFooter() {
      const button = this.element.querySelector('footer button[type="submit"]');
      if (!button) return;
      const { patches: changed, settings } = this.#collectChanges(platform.forms.data(this.element));
      const reload = needsReload(changed.map((p) => p.id), settings);
      const label = button.querySelector("span") ?? button;
      label.textContent = localize(reload ? "T20CP.Manager.SaveReload" : "T20CP.Manager.Save");
      button.querySelector("i")?.classList.toggle("fa-rotate", reload);
      button.querySelector("i")?.classList.toggle("fa-floppy-disk", !reload);
    }

    /** @param {"patches"|"rules"} tab */
    #applyFilter(tab) {
      const panel = this.element.querySelector(`.tab[data-tab="${tab}"]`);
      const view = this.#views[tab];
      if (!panel || !view) return;
      applyFilter(panel, view, tab === "patches" ? PATCH_FILTERS : RULE_FILTERS, platform.i18n.lang());
    }

    /** Arrow keys, Home and End move between the sidebar's group buttons. */
    #onGroupKey(event) {
      const current = event.target.closest?.('[data-action="group"]');
      if (!current) return;
      const buttons = [...event.currentTarget.querySelectorAll('[data-action="group"]')];
      const next = rovingIndex(event.key, buttons.indexOf(current), buttons.length, { next: "ArrowDown", previous: "ArrowUp" });
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      buttons[next].focus();
    }

    /** @param {Record<string, unknown>} submitted  FormDataExtended#object */
    #collectChanges(submitted) {
      return collectChanges(submitted, {
        patches,
        snapshot: this.#snapshot,
        ruleSnapshot: this.#ruleSnapshot,
        entry: moduleSettings.entry,
        fields: platform.core.fields
      });
    }

    /** @this {PatchManager} */
    static #onExpand(event, target) {
      toggleDetail(target);
    }

    /** @this {PatchManager} */
    static #onFilter(event, target) {
      const tab = target.closest(".tab[data-tab]")?.dataset.tab;
      const view = this.#views[tab];
      if (!view) return;
      const filters = tab === "patches" ? PATCH_FILTERS : RULE_FILTERS;
      view.filter = filters.includes(target.dataset.filter) ? target.dataset.filter : "all";
      this.#applyFilter(tab);
    }

    /** @this {PatchManager} */
    static #onGroup(event, target) {
      const tab = target.closest(".tab[data-tab]")?.dataset.tab;
      const view = this.#views[tab];
      if (!view) return;
      view.group = target.dataset.groupId || null;
      this.#applyFilter(tab);
    }

    /** @this {PatchManager} */
    static async #onSubmit(event, form, formData) {
      return flow.submit(this, this.#collectChanges(formData.object));
    }
  }

  return PatchManager;
}
