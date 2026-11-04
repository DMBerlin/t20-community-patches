import js from "@eslint/js";
import globals from "globals";
import layerBoundaries from "./tools/eslint/layer-boundaries.mjs";
import noFoundryGlobals from "./tools/eslint/no-foundry-globals.mjs";

// Globais do Foundry (e do Handlebars que ele expõe): permitidas só na plataforma.
const FOUNDRY = ["game", "CONFIG", "ui", "foundry", "canvas", "Hooks", "CONST", "Roll", "ChatMessage", "Actor", "Item", "Handlebars"];
const LAYERED = [
  "scripts/kernel/**",
  "scripts/platform/**",
  "scripts/services/**",
  "scripts/lib/**",
  "scripts/features/**",
  "scripts/apps/**",
  "scripts/*.mjs"
];
// Globais do Foundry só em scripts/platform/ (#86, #89): o resto de scripts/ recebe tudo pela plataforma.
const NO_GLOBALS = ["scripts/kernel/**", "scripts/services/**", "scripts/lib/**", "scripts/features/**", "scripts/apps/**", "scripts/*.mjs"];
const t20 = { rules: { "layer-boundaries": layerBoundaries, "no-foundry-globals": noFoundryGlobals } };

export default [
  { ignores: ["node_modules/**", "dist/**", ".work/**", ".work-archive/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...Object.fromEntries(FOUNDRY.map((g) => [g, "readonly"])) }
    },
    rules: {
      "no-else-return": ["error", { allowElseIf: false }],
      "max-depth": ["error", 3],
      complexity: ["warn", 12],
      "max-params": ["warn", 4],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }]
    }
  },
  { files: LAYERED, rules: { "max-lines": ["error", { max: 300 }] } },
  {
    files: NO_GLOBALS,
    plugins: { t20 },
    rules: {
      // checkGlobalObject também pega globalThis.game, window.game e self.game.
      "no-restricted-globals": ["error", { globals: FOUNDRY, checkGlobalObject: true }],
      // Desestruturação (const { game } = window) e cadeias (globalThis.window.game).
      "t20/no-foundry-globals": ["error", { globals: FOUNDRY }]
    }
  },
  // Importações entre camadas: resolvidas a partir do arquivo, em qualquer profundidade (tools/eslint/layer-boundaries.mjs).
  {
    files: ["scripts/**/*.mjs"],
    plugins: { t20 },
    rules: { "t20/layer-boundaries": "error" }
  },
  {
    files: ["tests/**", "tools/**", ".github/**", "eslint.config.mjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: { complexity: "off", "max-params": "off" }
  }
];
