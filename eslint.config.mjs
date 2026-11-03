import js from "@eslint/js";
import globals from "globals";
import layerBoundaries from "./tools/eslint/layer-boundaries.mjs";
import noFoundryGlobals from "./tools/eslint/no-foundry-globals.mjs";

// Globais do Foundry (e do Handlebars que ele expõe): permitidas na plataforma e no legado, proibidas nas camadas puras.
const FOUNDRY = ["game", "CONFIG", "ui", "foundry", "canvas", "Hooks", "CONST", "Roll", "ChatMessage", "Actor", "Item", "Handlebars"];
const LAYERED = ["scripts/kernel/**", "scripts/platform/**", "scripts/services/**", "scripts/lib/**", "scripts/features/**"];
const PURE = ["scripts/kernel/**", "scripts/services/**", "scripts/lib/**", "scripts/features/*/domain.mjs", "scripts/features/*/domain/**"];
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
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  { files: LAYERED, rules: { "max-lines": ["error", { max: 300 }] } },
  {
    files: PURE,
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
  // Pastas legadas: só avisos até as fases 6 e 7 (#88, #89). A fase 7 leva scripts/apps para LAYERED.
  {
    files: ["scripts/patches/**", "scripts/rules/**", "scripts/apps/**", "scripts/*.mjs"],
    rules: {
      "max-lines": ["warn", { max: 300 }],
      "max-depth": "warn",
      "no-else-return": "warn",
      "no-unused-vars": "warn",
      eqeqeq: "warn",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["tests/**", "tools/**", ".github/**", "eslint.config.mjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: { complexity: "off", "max-params": "off" }
  },
  // Testes existentes: avisos até as fases de migração, para não editar arquivos tocados por outras worktrees.
  { files: ["tests/**"], rules: { "max-depth": "warn", "no-unused-vars": "warn", eqeqeq: "warn", "prefer-const": "warn" } }
];
