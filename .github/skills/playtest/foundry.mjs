/**
 * Helpers for playtest scripts (skill "playtest"): drive a real Foundry VTT world through Playwright.
 *
 * This file does not import Playwright. The script receives `chromium` from its own install
 * (`<wt>/.work/playtest/node_modules`) and passes it to openFoundry().
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MODULE_ID = "t20-community-patches";

/** Flag that marks every document created by a playtest; cleanup() deletes only documents carrying it. */
export const PLAYTEST_FLAGS = { [MODULE_ID]: { playtest: true } };
export const DEFAULT_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";

/**
 * Launches the installed Chrome headless (Foundry 14 refuses Chromium < 146 and the headless shell has no WebGL),
 * joins the active world and waits for game.ready.
 * @param {import("playwright").BrowserType} chromium
 * @param {{url?: string, user?: string, password?: string, headless?: boolean}} [options]
 */
export async function openFoundry(chromium, options = {}) {
  const {
    url = DEFAULT_URL,
    user = process.env.FOUNDRY_GM_USER ?? "Gamemaster",
    password = process.env.FOUNDRY_GM_PASSWORD ?? "",
    headless = true
  } = options;
  const browser = await chromium.launch({
    headless,
    channel: "chrome",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${url}/join`);
    await page.selectOption('select[name="userId"]', { label: user });
    if (password) await page.fill('input[name="password"]', password);
    await page.click('button[name="join"]');
    await waitReady(page);
    return { browser, page, errors };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/** Waits for the world to finish loading (after join or reload). */
export async function waitReady(page) {
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 120000 });
}

/** Reloads the page: needed after changing a patch mode, because apply() only runs on "init". */
export async function reload(page) {
  await page.reload();
  await waitReady(page);
}

/**
 * Status entry of a patch in this load: {id, group, mode, state, diagnosis, reason}.
 * @returns {Promise<object|undefined>}
 */
export function patchStatus(page, id) {
  return page.evaluate(
    ({ MODULE_ID, id }) => {
      const entry = game.modules.get(MODULE_ID)?.api?.status?.find((s) => s.id === id);
      return entry ? JSON.parse(JSON.stringify(entry)) : undefined;
    },
    { MODULE_ID, id }
  );
}

/**
 * Sets a patch mode ("auto" | "off" | "force", or null to remove the key) in the world setting and returns the
 * previous raw value (null when absent). Reload afterwards for it to take effect.
 */
export function setPatchMode(page, id, mode) {
  return page.evaluate(
    async ({ MODULE_ID, id, mode }) => {
      const current = foundry.utils.deepClone(game.settings.get(MODULE_ID, "patches") ?? {});
      const previous = id in current ? current[id] : null;
      if (mode === null) delete current[id];
      else current[id] = mode;
      await game.settings.set(MODULE_ID, "patches", current);
      return previous;
    },
    { MODULE_ID, id, mode }
  );
}

/** Raw mode stored for a patch in the world setting ("auto" | "off" | "force"), or null when absent (default). */
export function getPatchMode(page, id) {
  return page.evaluate(({ MODULE_ID, id }) => game.settings.get(MODULE_ID, "patches")?.[id] ?? null, { MODULE_ID, id });
}

/**
 * Restores the world: dice, the patch mode, and every chat message, actor and world item created by the playtest.
 * Messages are matched by speaker.actor of a flagged actor; actors and items by PLAYTEST_FLAGS. Each step runs on its
 * own, so one failure does not skip the others, except that actors are kept when deleting their messages failed.
 * @param {{patchId: string, prevMode: string|null}} args
 * @returns {Promise<string[]>} Errors of the failed steps (empty when everything was restored).
 */
export function cleanup(page, { patchId, prevMode }) {
  return page.evaluate(
    async ({ MODULE_ID, patchId, prevMode }) => {
      const errors = [];
      const step = async (name, fn) => {
        try {
          await fn();
        } catch (err) {
          errors.push(`${name}: ${err?.message ?? err}`);
        }
      };
      const ours = (doc) => doc.getFlag?.(MODULE_ID, "playtest") === true;
      await step("dados", () => {
        if (window.__r0) CONFIG.Dice.randomUniform = window.__r0;
      });
      await step("modo do patch", async () => {
        const cur = foundry.utils.deepClone(game.settings.get(MODULE_ID, "patches") ?? {});
        if (prevMode === null) delete cur[patchId];
        else cur[patchId] = prevMode;
        await game.settings.set(MODULE_ID, "patches", cur);
      });
      const actorIds = new Set(game.actors.filter(ours).map((a) => a.id));
      const before = errors.length;
      await step("mensagens", async () => {
        const ids = game.messages.filter((m) => actorIds.has(m.speaker?.actor)).map((m) => m.id);
        if (ids.length) await ChatMessage.deleteDocuments(ids);
      });
      // Messages are found through their actor: keep the actors while any message is left.
      if (errors.length === before) {
        await step("atores", async () => {
          if (actorIds.size) await Actor.deleteDocuments([...actorIds]);
        });
      } else if (actorIds.size) errors.push("atores: mantidos para não perder o vínculo com as mensagens");
      await step("itens", async () => {
        const ids = game.items.filter(ours).map((i) => i.id);
        if (ids.length) await Item.deleteDocuments(ids);
      });
      return errors;
    },
    { MODULE_ID, patchId, prevMode }
  );
}

/**
 * Leftovers of the playtest in the world, for the final verification.
 * @returns {Promise<{actors: number, items: number, messages: number, mode: string|null}>}
 */
export function leftovers(page, patchId) {
  return page.evaluate(
    ({ MODULE_ID, patchId }) => {
      const ours = (doc) => doc.getFlag?.(MODULE_ID, "playtest") === true;
      const actorIds = new Set(game.actors.filter(ours).map((a) => a.id));
      return {
        actors: actorIds.size,
        items: game.items.filter(ours).length,
        messages: game.messages.filter((m) => actorIds.has(m.speaker?.actor)).length,
        mode: game.settings.get(MODULE_ID, "patches")?.[patchId] ?? null
      };
    },
    { MODULE_ID, patchId }
  );
}

/**
 * Commit, dirty flag and hash of .work/manual-tests.md of a worktree: ties the report to what was tested.
 * @param {string} wt  Worktree path.
 */
export function provenance(wt) {
  const git = (...args) => execFileSync("git", ["-C", wt, ...args], { encoding: "utf8" }).trim();
  const plan = join(wt, ".work", "manual-tests.md");
  return {
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
    plan: existsSync(plan) ? createHash("sha256").update(readFileSync(plan)).digest("hex") : null
  };
}

/**
 * Value u for CONFIG.Dice.randomUniform that makes a die with `faces` sides show `face`.
 * The core maps u to Math.ceil((1 - u) * faces). The same u applies to every die of the roll.
 */
export function uniformFor(face, faces = 20) {
  if (!Number.isInteger(face) || face < 1 || face > faces) throw new RangeError(`face ${face} outside 1-${faces}`);
  return (faces - face + 0.5) / faces;
}

/** Foundry and system versions, active world and user, for the report header. */
export function environment(page) {
  return page.evaluate(() => ({ foundry: game.version, system: game.system.version, world: game.world.id, user: game.user.name }));
}

/**
 * Collects the checks of a playtest and writes the markdown report.
 * @param {string} title
 */
export function createReport(title) {
  const rows = [];
  const log = (status, step, name, detail) => {
    rows.push({ status, step, name, detail });
    console.log(`${status} [${step}] ${name}${detail ? ` — ${detail}` : ""}`);
  };
  return {
    rows,
    check: (step, name, ok, detail = "") => log(ok ? "PASS" : "FAIL", step, name, detail),
    skip: (step, name, reason) => log("SKIP", step, name, reason),
    error: (err) => log("FAIL", "!", "erro no script", String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")),
    get failed() {
      return rows.filter((r) => r.status === "FAIL").length;
    },
    get skipped() {
      return rows.filter((r) => r.status === "SKIP").length;
    },
    summary() {
      const passed = rows.filter((r) => r.status === "PASS").length;
      return `${passed}/${rows.length} PASS · ${this.failed} FAIL · ${this.skipped} SKIP`;
    },
    /**
     * @param {string} path   Usually <wt>/.work/playtest.md
     * @param {{foundry?: string, system?: string, world?: string, user?: string, script?: string, notes?: string,
     *   commit?: string, dirty?: boolean, plan?: string|null}} meta  Spread provenance(wt) into it.
     */
    write(path, meta = {}) {
      if (!rows.length) log("FAIL", "!", "nenhuma verificação executada", "");
      const result = this.failed ? "FALHOU" : this.skipped ? "PARCIAL" : "PASSOU";
      const lines = [
        `# Playtest — ${title}`,
        "",
        `- Data: ${new Date().toISOString()}`,
        `- Ambiente: Foundry ${meta.foundry ?? "?"} · Tormenta20 ${meta.system ?? "?"} · mundo \`${meta.world ?? "?"}\` · usuário ${meta.user ?? "?"}`,
        `- Script: \`${meta.script ?? "?"}\``,
        `- Commit: ${meta.commit ?? "?"}${meta.dirty ? " (com alterações não commitadas)" : ""}`,
        `- Plano (sha256 de .work/manual-tests.md): ${meta.plan ?? "?"}`,
        ...(meta.notes ? [`- Notas: ${meta.notes}`] : []),
        "",
        "| Status | Passo | Verificação | Detalhe |",
        "|---|---|---|---|",
        ...rows.map((r) => `| ${r.status} | ${r.step} | ${r.name} | ${String(r.detail ?? "").replace(/\|/g, "\\|")} |`),
        "",
        `Resultado: ${result} (${this.summary()})`
      ];
      writeFileSync(path, `${lines.join("\n")}\n`);
    }
  };
}
