import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd });
const RULES = new Set(["t20/layer-boundaries", "t20/no-foundry-globals", "no-restricted-globals"]);

async function problems(file, code) {
  const [result] = await eslint.lintText(code, { filePath: `${cwd}/scripts/${file}` });
  return result.messages.filter((m) => RULES.has(m.ruleId) || m.fatal).map((m) => m.messageId ?? m.ruleId);
}

const FAIL = [
  ["features/a/domain.mjs", 'import "../b/domain.mjs";', "crossFeature"],
  ["features/a/domain/x.mjs", 'import "../../b/domain.mjs";', "crossFeature"],
  ["features/a/integration.mjs", 'export * from "../b/integration.mjs";', "crossFeature"],
  ["features/a/ui/x.mjs", 'export { y } from "../../b/ui.mjs";', "crossFeature"],
  ["features/a/ui/x.mjs", 'import "../../../platform/x.mjs";', "featurePlatform"],
  ["features/a/integration.mjs", 'import "../../platform/x.mjs";', "featurePlatform"],
  ["features/a/domain.mjs", 'import "./integration.mjs";', "impureDomain"],
  ["features/a/domain/x.mjs", 'import "../ui/y.mjs";', "impureDomain"],
  ["features/a/domain/x.mjs", 'import "../../../services/s.mjs";', "impureDomain"],
  ["features/a/domain.mjs", 'export const f = () => import("./integration.mjs");', "impureDomain"],
  ["features/a/domain.mjs", "export const f = (name) => import(name);", "dynamicImport"],
  ["features/a/integration.mjs", "export const f = (name) => import(`./${name}.mjs`);", "dynamicImport"],
  ["features/a/integration.mjs", 'import "/modules/t20-community-patches/scripts/platform/x.mjs";', "relativeOnly"],
  ["features/a/integration.mjs", 'export * from "https://example.com/x.mjs";', "relativeOnly"],
  ["features/a/integration.mjs", 'export const f = () => import("/scripts/platform/x.mjs");', "relativeOnly"],
  ["platform/x.mjs", 'import "some-package";', "relativeOnly"],
  ["features/a/domain.mjs", 'import "./integration.mjs?version=1";', "impureDomain"],
  ["features/a/domain.mjs", 'export * from "./integration.mjs#cache";', "impureDomain"],
  ["features/a/domain.mjs", 'export const f = () => import("./%69ntegration.mjs");', "impureDomain"],
  ["features/a/domain.mjs", 'import "./%E0%A4%A.mjs";', "badSpecifier"],
  ["features/a/domain.mjs", 'import { getPatchMode } from "../../settings.mjs";', "legacyImport"],
  ["features/a/domain/x.mjs", 'export const f = () => import("../../../settings.mjs");', "legacyImport"],
  ["lib/x.mjs", 'export * from "../settings.mjs";', "legacyImport"],
  ["lib/x.mjs", 'import "../rules/shared/y.mjs";', "legacyImport"],
  ["lib/x.mjs", 'import "../services/s.mjs";', "impureDomain"],
  ["lib/x.mjs", 'import "../platform/p.mjs";', "impureDomain"],
  ["lib/x.mjs", 'import "../features/a/domain.mjs";', "libFeature"],
  ["lib/x.mjs", "export const x = () => game.user;", "defaultMessage"],
  ["lib/x.mjs", "export const x = () => window.game;", "defaultMessage"],
  ["lib/x.mjs", "export const x = () => globalThis.Hooks;", "defaultMessage"],
  ["lib/x.mjs", "export const x = () => self.CONFIG;", "defaultMessage"],
  ["features/a/domain/x.mjs", "export const x = () => foundry.utils;", "defaultMessage"],
  ["lib/x.mjs", "const { game } = window; export { game };", "foundryGlobal"],
  ["lib/x.mjs", "const { Hooks: hooks } = globalThis; export { hooks };", "foundryGlobal"],
  ["lib/x.mjs", 'let ui; ({ ["ui"]: ui } = self); export { ui };', "foundryGlobal"],
  ["lib/x.mjs", "export const x = () => globalThis.window.game;", "foundryGlobal"],
  ["lib/x.mjs", "export function currentUser({ game } = globalThis) { return game.user; }", "foundryGlobal"],
  ["features/a/domain.mjs", "export const f = ({ Hooks: hooks } = window) => hooks;", "foundryGlobal"],
  ["lib/x.mjs", "export function f([first] = [], { ui } = self) { return [first, ui]; }", "foundryGlobal"],
  ["features/a/domain.mjs", 'export const x = () => window.self["CONFIG"];', "foundryGlobal"],
  // Globais só em scripts/platform/ (#86): também na integração e na UI das features, no main e nos pilotos.
  ["features/a/integration.mjs", "export const x = () => game.user;", "defaultMessage"],
  ["features/a/ui/x.mjs", "export const x = () => ui.notifications;", "defaultMessage"],
  ["kernel/k.mjs", "export const x = () => CONFIG.Item;", "defaultMessage"],
  ["main.mjs", "export const x = () => game.settings;", "defaultMessage"],
  ["patches/suppressed-usage-effects.mjs", "export const x = () => CONFIG.Actor;", "defaultMessage"],
  ["rules/mana-limit.mjs", "export const x = () => Hooks;", "defaultMessage"]
];

const PASS = [
  ["features/a/domain/x.mjs", 'import "../domain/y.mjs"; import "./z.mjs"; import "../domain.mjs";'],
  ["features/a/domain.mjs", 'import "./domain/y.mjs"; import "../../lib/x.mjs"; import "../../kernel/k.mjs";'],
  ["features/a/domain.mjs", 'export const f = () => import("./domain/y.mjs");'],
  ["features/a/integration.mjs", 'import "./domain.mjs"; import "../../lib/x.mjs"; import "../../services/s.mjs"; export const x = (ctx) => ctx.platform.user;'],
  ["patches/legacy.mjs", "export const x = () => game.user;"],
  ["features/a/ui/x.mjs", 'import "../integration.mjs"; import "../domain/y.mjs";'],
  ["lib/x.mjs", 'import "./y.mjs"; import "../kernel/k.mjs"; export const x = () => import("./z.mjs");'],
  ["platform/x.mjs", 'import "../services/s.mjs"; export const x = () => game.user;'],
  ["lib/x.mjs", "export const x = (game) => game.user; export const y = (window) => window.game.user;"],
  ["lib/x.mjs", "export const x = (globalThis) => { const { game } = globalThis; return game; };"],
  ["lib/x.mjs", "export function currentUser(window, { game } = window) { return game.user; }"],
  ["kernel/wrap.mjs", 'import { markWrapper } from "../utils.mjs"; export { markWrapper };'],
  ["features/a/integration.mjs", 'import "../../settings.mjs";'],
  ["rules/x.mjs", 'import "../features/a/integration.mjs"; export const f = (name) => import(name);']
];

for (const [file, code, expected] of FAIL) {
  test(`fails: scripts/${file}: ${code}`, async () => {
    assert.deepEqual(await problems(file, code), [expected]);
  });
}

for (const [file, code] of PASS) {
  test(`passes: scripts/${file}: ${code}`, async () => {
    assert.deepEqual(await problems(file, code), []);
  });
}
