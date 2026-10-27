import { MODULE_ID } from "../utils.mjs";
import { RULE_SETTINGS, getPatchMode } from "../settings.mjs";
import {
  STATE_CATEGORIES,
  controlsFromMode,
  countCategories,
  displayState,
  modeFromControls,
  needsReload,
  reportIssueUrl,
  stateCategory,
  nextFocusIndex
} from "../registry.mjs";
import { GROUPS, PATCHES } from "../patches/index.mjs";
import { PATCH_FILTERS, RULE_FILTERS, facetCounts, matchesView, patchBucket, ruleBucket } from "./center-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ICONS = {
  active: "fa-solid fa-circle-check",
  unneeded: "fa-solid fa-circle-check",
  attention: "fa-solid fa-triangle-exclamation",
  error: "fa-solid fa-circle-xmark",
  off: "fa-regular fa-circle"
};

/** Input names. Patch ids and setting keys never contain ":". */
const PATCH_INPUT = "patch:";
const ALWAYS_INPUT = "always:";
const SETTING_INPUT = "setting:";

/**
 * "Central do T20CP": one window with the patches (one compact row each, details on demand) and the module's optional
 * rules, which are registered with `config: false` and only shown here.
 */
export class PatchManager extends HandlebarsApplicationMixin(ApplicationV2) {
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
    patches: { template: `modules/${MODULE_ID}/templates/patch-manager.hbs`, scrollable: [".t20cp-sidebar", ".t20cp-list"] },
    rules: { template: `modules/${MODULE_ID}/templates/patch-manager-rules.hbs`, scrollable: [".t20cp-sidebar", ".t20cp-list"] },
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
   * @type {Record<"patches"|"rules", import("./center-view.mjs").View>}
   */
  #views = { patches: { query: "", group: null, filter: null }, rules: { query: "", group: null, filter: "all" } };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const status = new Map((game.modules.get(MODULE_ID).api?.status ?? []).map((s) => [s.id, s]));
    const bugs = game.modules.get(MODULE_ID).bugs;
    const versions = { system: game.system.version, foundry: game.version, module: game.modules.get(MODULE_ID).version };

    const rows = PATCHES.map((patch) => {
      const { state = "disabled", diagnosis, reason, changed } = status.get(patch.id) ?? {};
      const shown = displayState(state, diagnosis);
      const category = stateCategory(shown);
      const mode = getPatchMode(patch.id);
      const name = game.i18n.localize(`T20CP.Patches.${patch.id}.Name`);
      const link =
        category === "attention"
          ? { url: reportIssueUrl({ bugs, patch, name, state: shown, mode, diagnosis, versions }), label: "T20CP.Manager.Report" }
          : { url: patch.issue && bugs ? `${bugs}/${patch.issue}` : null, label: "T20CP.Manager.Details" };
      return {
        id: patch.id,
        group: patch.group,
        name,
        search: searchText(name, patch.id),
        bucket: patchBucket(category),
        hint: game.i18n.localize(`T20CP.Patches.${patch.id}.Hint`),
        mode,
        ...controlsFromMode(mode),
        category,
        icon: ICONS[shown === "error" ? "error" : category],
        iconClass: shown === "error" ? "error" : category,
        changed: !!changed,
        stateLabel: game.i18n.localize(`T20CP.States.${shown}.Label`),
        stateHint: [game.i18n.format(`T20CP.States.${shown}.Hint`, { reason: foundry.utils.escapeHTML(reason ?? "") }), describeDiagnosis(diagnosis)]
          .filter(Boolean)
          .join(" "),
        link: link.url ? link : null
      };
    });

    this.#snapshot = Object.fromEntries(rows.map((r) => [r.id, r.mode]));
    // Saved modes that differ from what was used at load time only take effect after a reload.
    context.pendingReload = rows.some((r) => status.has(r.id) && status.get(r.id).mode !== r.mode);

    const counts = countCategories(rows.map((r) => (status.has(r.id) ? displayState(status.get(r.id).state, status.get(r.id).diagnosis) : "disabled")));
    const plural = new Intl.PluralRules(game.i18n.lang);
    context.summary = [
      ...STATE_CATEGORIES.filter((c) => counts[c]).map((c) =>
        game.i18n.format(`T20CP.Manager.Count.${c}.${plural.select(counts[c]) === "one" ? "one" : "other"}`, { count: counts[c] })
      )
    ].join(" · ");
    this.#views.patches.filter ??= counts.attention ? "attention" : "all";
    context.hasAttention = counts.attention > 0;

    context.groups = groupRows(rows).map((g) => ({ ...g, patches: g.rows }));
    context.patchGroups = context.groups.map(({ id, label }) => ({ id, label }));
    context.patchFilters = filterButtons(PATCH_FILTERS, { attention: !context.hasAttention });

    const rules = this.#prepareRules();
    context.rules = rules;
    context.ruleGroups = groupRows(rules).map((g) => ({ ...g, rules: g.rows }));
    context.ruleNav = context.ruleGroups.map(({ id, label }) => ({ id, label }));
    context.ruleFilters = filterButtons(RULE_FILTERS);
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
  #prepareRules() {
    this.#ruleSnapshot = {};
    const rules = [];
    for (const { id, group, keys } of RULE_SETTINGS) {
      const entries = keys.map((key) => this.#prepareSetting(key)).filter(Boolean);
      if (!entries.length) continue;
      const view = { id, group, bucket: ruleBucket(entries.map((e) => e.value)) };
      if (keys.length === 1) rules.push({ ...view, single: true, ...entries[0], search: searchText(entries[0].label, id) });
      else {
        const label = game.i18n.localize(`T20CP.Manager.Rules.${id}`);
        rules.push({ ...view, single: false, label, entries, search: searchText(label, id) });
      }
    }
    return rules;
  }

  /**
   * One setting of the "Optional rules" tab, or null when it is not registered on this load.
   * @param {string} key
   */
  #prepareSetting(key) {
    const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
    if (!setting) return null;
    const value = game.settings.get(MODULE_ID, key);
    this.#ruleSnapshot[key] = value;
    const field = settingField(setting);
    const name = `${SETTING_INPUT}${key}`;
    const input = field.toInput({ name, value, localize: true });
    input.setAttribute?.("aria-label", game.i18n.localize(setting.name ?? ""));
    return {
      key,
      value,
      label: game.i18n.localize(setting.name ?? ""),
      hint: game.i18n.localize(setting.hint ?? ""),
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
    for (const button of this.element.querySelectorAll(`[role="tab"][data-group="${group}"]`)) {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  /** Arrow keys, Home and End move between the tabs, like a WAI-ARIA tablist. */
  #onTabKey(event) {
    const current = event.target.closest?.('[role="tab"]');
    if (!current) return;
    const tabs = [...this.element.querySelectorAll(`[role="tab"][data-group="${current.dataset.group}"]`)];
    const index = tabs.indexOf(current);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    this.changeTab(target.dataset.tab, target.dataset.group);
    target.focus();
  }

  /**
   * The browser blocks the submit when a control is invalid, but cannot point at a control in a hidden tab or a closed
   * detail. Shows it, then lets the browser report the problem on it.
   * @param {EventTarget} control
   */
  #revealInvalid(control) {
    if (!(control instanceof HTMLElement) || control.checkVisibility()) return;
    const tab = control.closest(".tab[data-tab]");
    if (tab) this.changeTab(tab.dataset.tab, tab.dataset.group);
    const row = control.closest(".t20cp-row");
    const view = this.#views[tab?.dataset.tab];
    if (row?.hidden && view) {
      Object.assign(view, { query: "", group: null, filter: "all" });
      const search = tab.querySelector(".t20cp-search");
      if (search) search.value = "";
      this.#applyFilter(tab.dataset.tab);
    }
    const detail = control.closest(".t20cp-detail");
    if (detail?.hidden) {
      detail.hidden = false;
      detail.closest(".t20cp-row")?.classList.add("expanded");
      detail.closest(".t20cp-row")?.querySelector(".t20cp-expand")?.setAttribute("aria-expanded", "true");
    }
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
    const target = event.target;
    if (target?.name?.startsWith(PATCH_INPUT)) {
      const id = target.name.slice(PATCH_INPUT.length);
      const always = this.element.querySelector(`[name="${ALWAYS_INPUT}${id}"]`);
      if (always && !target.checked) always.checked = false;
      always?.closest(".t20cp-always")?.toggleAttribute("hidden", !target.checked);
    }
    if (target?.name?.startsWith(PATCH_INPUT) || target?.name?.startsWith(ALWAYS_INPUT)) {
      const row = target.closest(".t20cp-row");
      const id = row?.dataset.id;
      if (id) row.querySelector(".t20cp-tag")?.toggleAttribute("hidden", this.#readMode(id) !== "force");
    }
    this.#refreshFooter();
  }

  /** @param {string} id */
  #readMode(id) {
    const enabled = this.element.querySelector(`[name="${PATCH_INPUT}${id}"]`);
    const always = this.element.querySelector(`[name="${ALWAYS_INPUT}${id}"]`);
    if (!enabled) return this.#snapshot[id];
    return modeFromControls({ enabled: enabled.checked, always: !!always?.checked });
  }

  /** "Save and reload" when the pending changes need a reload, "Save" otherwise. */
  #refreshFooter() {
    const button = this.element.querySelector('footer button[type="submit"]');
    if (!button) return;
    const { patches, settings } = this.#collectChanges(new foundry.applications.ux.FormDataExtended(this.element).object);
    const reload = needsReload(patches.map((p) => p.id), settings);
    const label = button.querySelector("span") ?? button;
    label.textContent = game.i18n.localize(reload ? "T20CP.Manager.SaveReload" : "T20CP.Manager.Save");
    button.querySelector("i")?.classList.toggle("fa-rotate", reload);
    button.querySelector("i")?.classList.toggle("fa-floppy-disk", !reload);
  }

  /**
   * Shows the rows of a tab that match its search, group and status filter, hides empty groups, marks the active
   * buttons and writes the facet counts.
   * @param {"patches"|"rules"} tab
   */
  #applyFilter(tab) {
    const panel = this.element.querySelector(`.tab[data-tab="${tab}"]`);
    const view = this.#views[tab];
    if (!panel || !view) return;
    const normalized = { ...view, query: normalizeSearch(view.query) };
    const rows = [...panel.querySelectorAll(".t20cp-list .t20cp-row[data-bucket]")];
    const data = rows.map((row) => ({ group: row.dataset.group, bucket: row.dataset.bucket, search: row.dataset.search ?? "" }));
    rows.forEach((row, i) => (row.hidden = !matchesView(data[i], normalized)));
    for (const group of panel.querySelectorAll(".t20cp-group")) {
      group.hidden = !group.querySelector(".t20cp-row:not([hidden])");
    }
    // With one group selected, its title would only repeat the sidebar.
    panel.classList.toggle("t20cp-single-group", !!view.group);

    const counts = facetCounts(data, normalized, tab === "patches" ? PATCH_FILTERS : RULE_FILTERS);
    for (const button of panel.querySelectorAll('[data-action="group"]')) {
      const id = button.dataset.groupId || null;
      const active = id === view.group;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      const count = button.querySelector(".t20cp-count");
      if (count) count.textContent = String(id ? (counts.groups[id] ?? 0) : counts.allGroups);
    }
    for (const button of panel.querySelectorAll('[data-action="filter"]')) {
      const active = button.dataset.filter === view.filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      const count = button.querySelector(".t20cp-count");
      if (count) count.textContent = String(counts.filters[button.dataset.filter] ?? 0);
    }
    const empty = panel.querySelector(".t20cp-empty");
    if (empty) empty.hidden = rows.some((row) => !row.hidden);
  }

  /** Arrow keys, Home and End move between the sidebar's group buttons. */
  #onGroupKey(event) {
    const current = event.target.closest?.('[data-action="group"]');
    if (!current) return;
    const buttons = [...event.currentTarget.querySelectorAll('[data-action="group"]')];
    const index = buttons.indexOf(current);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[(next + buttons.length) % buttons.length].focus();
  }

  /**
   * What the submitted form changes, compared with what was rendered.
   * @param {Record<string, unknown>} submitted  FormDataExtended#object
   */
  #collectChanges(submitted) {
    const patches = [];
    for (const patch of PATCHES) {
      const key = `${PATCH_INPUT}${patch.id}`;
      if (!(key in submitted)) continue;
      const mode = modeFromControls({ enabled: !!submitted[key], always: !!submitted[`${ALWAYS_INPUT}${patch.id}`] });
      if (mode !== this.#snapshot[patch.id]) patches.push({ id: patch.id, mode });
    }
    const settings = [];
    for (const [key, before] of Object.entries(this.#ruleSnapshot)) {
      const name = `${SETTING_INPUT}${key}`;
      if (!(name in submitted)) continue;
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if (!setting) continue;
      const field = settingField(setting);
      const value = field.clean(submitted[name]);
      if (value === before) continue;
      settings.push({ key, value, field, label: setting.name, requiresReload: !!setting.requiresReload });
    }
    return { patches, settings };
  }

  /**
   * @this {PatchManager}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onExpand(event, target) {
    const row = target.closest(".t20cp-row");
    const detail = row?.querySelector(".t20cp-detail");
    if (!detail) return;
    const open = detail.hidden;
    detail.hidden = !open;
    target.setAttribute("aria-expanded", String(open));
    row.classList.toggle("expanded", open);
  }

  /**
   * @this {PatchManager}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onFilter(event, target) {
    const tab = target.closest(".tab[data-tab]")?.dataset.tab;
    const view = this.#views[tab];
    if (!view) return;
    const filters = tab === "patches" ? PATCH_FILTERS : RULE_FILTERS;
    view.filter = filters.includes(target.dataset.filter) ? target.dataset.filter : "all";
    this.#applyFilter(tab);
  }

  /**
   * @this {PatchManager}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onGroup(event, target) {
    const tab = target.closest(".tab[data-tab]")?.dataset.tab;
    const view = this.#views[tab];
    if (!view) return;
    view.group = target.dataset.groupId || null;
    this.#applyFilter(tab);
  }

  /**
   * @this {PatchManager}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const { patches, settings } = this.#collectChanges(formData.object);
    if (!patches.length && !settings.length) return this.close();

    for (const { field, value, label } of settings) {
      const failure = field.validate(value);
      if (failure) throw new Error(`${game.i18n.localize(label ?? "")}: ${failure.asError?.().message ?? failure.message ?? failure}`);
    }

    const forced = patches.filter((p) => p.mode === "force");
    if (forced.length) {
      const names = forced.map((p) => `<li>${foundry.utils.escapeHTML(game.i18n.localize(`T20CP.Patches.${p.id}.Name`))}</li>`);
      let shown = null;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("T20CP.Manager.ForceTitle") },
        content: `<p>${game.i18n.localize("T20CP.Manager.ForceContent")}</p><ul>${names.join("")}</ul>`,
        rejectClose: false,
        modal: true,
        render: (_event, dialog) => {
          shown = dialog;
          trapFocus(dialog.element);
        }
      });
      if (!confirmed) {
        // The answer comes before the dialog closes, and closing it moves the focus: wait, then go back to Save.
        if (shown && shown.state !== shown.constructor.RENDER_STATES.CLOSED) {
          await new Promise((resolve) => shown.addEventListener("close", resolve, { once: true }));
        }
        this.element?.querySelector('footer button[type="submit"]')?.focus();
        return;
      }
    }

    for (const { key, value } of settings) await game.settings.set(MODULE_ID, key, value);
    if (patches.length) {
      const next = { ...(game.settings.get(MODULE_ID, "patches") ?? {}) };
      for (const { id, mode } of patches) next[id] = mode;
      await game.settings.set(MODULE_ID, "patches", next);
    }
    await this.close();
    if (needsReload(patches.map((p) => p.id), settings)) {
      const hook = Hooks.on("renderDialogV2", (dialog) => {
        if (dialog.id === "reload-world-confirm") trapFocus(dialog.element);
      });
      try {
        await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
      } finally {
        Hooks.off("renderDialogV2", hook);
      }
    }
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a modal dialog. The core KeyboardManager swallows Tab when the focus is on the
 * dialog's header buttons (outside its form) or has left the page past the last button, so the dialog moves the focus
 * itself and the keybindings never see the key.
 * @param {HTMLElement} root
 */
function trapFocus(root) {
  if (!root || root.dataset.t20cpFocusTrap) return;
  root.dataset.t20cpFocusTrap = "true";
  const onKey = (event) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    // A newer modal (from another module, say) owns its own Tab.
    if ([...root.ownerDocument.querySelectorAll("dialog:modal")].at(-1) !== root) return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.checkVisibility());
    const next = nextFocusIndex(items.length, items.indexOf(root.ownerDocument.activeElement), event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  };
  // On the window, so a focus that already escaped to the body is brought back too; removed when the dialog closes.
  const view = root.ownerDocument.defaultView;
  view.addEventListener("keydown", onKey, true);
  const stop = new MutationObserver(() => {
    if (root.isConnected) return;
    view.removeEventListener("keydown", onKey, true);
    stop.disconnect();
  });
  stop.observe(root.ownerDocument.body, { childList: true, subtree: true });
}

/**
 * The DataField behind a setting, as in the core SettingsConfig: the setting's own field, or one built from its type
 * and choices.
 * @param {object} setting  Entry of game.settings.settings.
 * @returns {foundry.data.fields.DataField}
 */
function settingField(setting) {
  const fields = foundry.data.fields;
  if (setting.type instanceof fields.DataField) return setting.type;
  if (setting.type === Boolean) return new fields.BooleanField({ initial: setting.default ?? false });
  if (setting.type === Number) {
    const { min, max, step } = setting.range ?? {};
    return new fields.NumberField({ required: true, choices: setting.choices, initial: setting.default, min, max, step });
  }
  return new fields.StringField({ required: true, choices: setting.choices, initial: setting.default });
}

/**
 * One line with the diagnosis behind the state.
 * @param {import("../registry.mjs").Diagnosis|undefined} diagnosis
 */
function describeDiagnosis(diagnosis) {
  if (!diagnosis) return "";
  return game.i18n.format("T20CP.Diagnosis.Line", {
    bug: game.i18n.localize(`T20CP.Diagnosis.Bug.${diagnosis.bug}`),
    confidence: game.i18n.localize(`T20CP.Diagnosis.Confidence.${diagnosis.confidence}`),
    evidence: diagnosis.evidence ? ` (${foundry.utils.escapeHTML(diagnosis.evidence)})` : ""
  });
}

/** @param {string} text */
function normalizeSearch(text) {
  return (text ?? "").toLocaleLowerCase(game.i18n.lang);
}

/** Lowercased text the search looks in: the localized name and the id. */
function searchText(name, id) {
  return normalizeSearch(`${name} ${id}`);
}

/**
 * Rows grouped in GROUPS order (unknown groups last), skipping empty groups.
 * @template {{group: string}} T
 * @param {T[]} rows
 * @returns {{id: string, label: string, rows: T[]}[]}
 */
function groupRows(rows) {
  const ids = [...GROUPS, ...new Set(rows.map((r) => r.group).filter((g) => !GROUPS.includes(g)))];
  return ids
    .map((id) => ({ id, label: game.i18n.localize(`T20CP.Groups.${id}`), rows: rows.filter((r) => r.group === id) }))
    .filter((g) => g.rows.length);
}

/**
 * @param {string[]} filters
 * @param {Record<string, boolean>} [disabled]
 */
function filterButtons(filters, disabled = {}) {
  return filters.map((id) => ({ id, label: game.i18n.localize(`T20CP.Manager.Filter.${id}`), disabled: !!disabled[id] }));
}
