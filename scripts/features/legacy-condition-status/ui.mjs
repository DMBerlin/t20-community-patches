const PREFIX = "T20CP.LegacyConditionStatus";

function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function table(headers, rows) {
  const head = el("thead", {}, [el("tr", {}, headers.map((text) => el("th", { text })))]);
  const body = el("tbody", {}, rows.map((cells) => el("tr", {}, cells.map((text) => el("td", { text })))));
  return el("table", { className: "t20cp-legacy-table" }, [head, body]);
}

function button(action, icon, text, disabled) {
  const node = el("button", { attrs: { type: "button", "data-action": action } }, [el("i", { className: icon }), ` ${text}`]);
  node.disabled = disabled;
  return node;
}

/** Groups and marks that undo would touch: only marks whose status is still the one the tool wrote. */
export function undoableGroups(repaired) {
  return repaired
    .map((group) => ({ ...group, marks: group.marks.filter((mark) => mark.plan.kind === "undo") }))
    .filter((group) => group.marks.length);
}

const count = (groups, key) => groups.reduce((n, group) => n + group[key].length, 0);

/**
 * "Repair 1.5 conditions" (ApplicationV2). Text goes through textContent, never HTML. The buttons act on the groups
 * of the last render, which is what the GM saw; the writer re-checks every effect against it before writing.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 * @param {{scan: Function, canWrite: () => boolean, isBusy: () => boolean, repair: Function, undo: Function}} tool
 */
export function createRepairClass(ctx, tool) {
  const { platform } = ctx;
  const { ApplicationV2 } = platform.core;
  const t = (key, data) => (data ? platform.i18n.format(`${PREFIX}.${key}`, data) : platform.i18n.localize(`${PREFIX}.${key}`));
  const yesNo = (value) => t(value ? "Yes" : "No");

  const repairTable = (groups) =>
    table(
      ["Document", "Condition", "Category", "Upgrade", "Children", "IgnoreImmunity"].map((c) => t(`Columns.${c}`)),
      groups.flatMap((g) =>
        g.candidates.map((c) => [g.label, c.name, c.status.category, c.status.upgrade, c.status.childEffect.join(", "), yesNo(c.status.ignoreImunity)])
      )
    );

  const repairedTable = (groups) =>
    table(
      ["Document", "Condition", "State"].map((c) => t(`Columns.${c}`)),
      groups.flatMap((g) => g.marks.map((m) => [g.label, m.name, t(m.plan.kind === "undo" ? "CanUndo" : "ChangedAfterRepair")]))
    );

  return class LegacyConditionRepair extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "t20cp-legacy-condition-status",
      classes: ["t20cp-legacy-condition-status"],
      window: { title: `${PREFIX}.Title`, icon: "fa-solid fa-screwdriver-wrench", resizable: true },
      position: { width: 760, height: "auto" },
      actions: { repair: LegacyConditionRepair.#onRepair, undo: LegacyConditionRepair.#onUndo }
    };

    #preview = { repair: [], repaired: [] };

    async _renderHTML(_context, _options) {
      this.#preview = tool.scan();
      const { repair, repaired } = this.#preview;
      const undoable = undoableGroups(repaired);
      const locked = !tool.canWrite() || tool.isBusy();
      const root = el("div", { className: "standard-form" });
      root.append(el("h3", { text: t("ToRepair") }), repair.length ? repairTable(repair) : el("p", { text: t("Empty") }));
      if (repaired.length) root.append(el("h3", { text: t("Repaired") }), repairedTable(repaired));
      if (!tool.canWrite()) root.append(el("p", { className: "notification warning", text: t("OnlyActiveGM") }));
      const acknowledge = el("input", { attrs: { type: "checkbox", name: "acknowledge" } });
      acknowledge.disabled = locked;
      root.append(
        el("label", { className: "checkbox" }, [acknowledge, ` ${t("Acknowledge")}`]),
        el("footer", { className: "form-footer" }, [
          button("repair", "fa-solid fa-screwdriver-wrench", t("Repair", { count: count(repair, "candidates") }), locked || !repair.length),
          button("undo", "fa-solid fa-rotate-left", t("Undo", { count: count(undoable, "marks") }), locked || !undoable.length)
        ])
      );
      return root;
    }

    _replaceHTML(result, content, _options) {
      content.replaceChildren(result);
    }

    static async #onRepair() {
      await this.#run(tool.repair, this.#preview.repair);
    }

    static async #onUndo() {
      await this.#run(tool.undo, undoableGroups(this.#preview.repaired));
    }

    async #run(write, groups) {
      if (!this.element.querySelector("input[name=acknowledge]")?.checked) {
        platform.notify.warn(t("NeedAcknowledge"));
        return;
      }
      for (const node of this.element.querySelectorAll("button[data-action], input[name=acknowledge]")) node.disabled = true;
      const result = await write(groups);
      if (!result) platform.notify.warn(t(tool.canWrite() ? "Busy" : "OnlyActiveGM"));
      else this.#report(result);
      await this.render();
    }

    #report({ done, skipped, failed, stopped }) {
      const summary = t("Done", { done, skipped, failed: failed.length });
      if (failed.length) platform.notify.error(`${summary} ${t("Failed", { list: platform.i18n.listFormat(failed) })}`);
      else platform.notify.info(summary);
      if (stopped) platform.notify.warn(t("Stopped"));
    }
  };
}
