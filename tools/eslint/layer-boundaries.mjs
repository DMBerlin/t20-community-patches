// Local ESLint rule: import boundaries between the layers of scripts/ (see AGENTS.md, "Camadas e fronteiras").
// Each relative import is resolved against the importing file, so the rule holds at any folder depth.
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const LAYERS = new Set(["kernel", "platform", "services", "lib", "features"]);
const IMPURE = new Set(["integration", "ui"]);

/**
 * Classifies a file by its path relative to the repository root.
 * @returns {{ layer: string, feature?: string, part?: string } | null} layer "legacy" for the rest of scripts/; null outside it.
 */
export function classify(relative) {
  const parts = relative.split(path.sep).join("/").split("/");
  if (parts[0] !== "scripts" || parts.length < 2) return null;
  if (parts.length < 3 || !LAYERS.has(parts[1])) return { layer: "legacy" };
  if (parts[1] !== "features" || parts.length < 4) return { layer: parts[1] };
  return { layer: "features", feature: parts[2], part: parts[3].replace(/\.mjs$/, "") };
}

const isDomain = (where) => where.layer === "features" && where.part === "domain";
const isRestricted = (where) => where?.layer === "features" || where?.layer === "lib";

/** The messageId violated by an import from `source` to `target`, or null when it is allowed. */
export function violation(source, target) {
  if (!source || !target) return null;
  if (source.layer === "features") {
    if (target.layer === "features" && target.feature && target.feature !== source.feature) return "crossFeature";
    if (target.layer === "platform") return "featurePlatform";
  }
  if (source.layer === "lib" && target.layer === "features") return "libFeature";
  if (!isDomain(source) && source.layer !== "lib") return null;
  if (target.layer === "platform" || target.layer === "services") return "impureDomain";
  if (target.layer === "legacy") return "legacyImport";
  if (target.layer !== "features") return null;
  return IMPURE.has(target.part) ? "impureDomain" : null;
}

function literalSource(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Fronteiras de importação entre as camadas de scripts/" },
    schema: [],
    messages: {
      crossFeature: "Uma feature não importa outra: mova o código para scripts/lib ou scripts/services.",
      featurePlatform: "Features recebem a plataforma por ctx.",
      impureDomain: "A camada de domínio é pura: não importa integration, ui, platform nem services.",
      legacyImport: "O domínio e scripts/lib não importam o código legado de scripts/: mova o código puro para scripts/lib.",
      libFeature: "scripts/lib não importa features.",
      dynamicImport: "Importação dinâmica só com caminho literal, para que as fronteiras possam ser verificadas.",
      badSpecifier: "Caminho de importação com codificação inválida.",
      relativeOnly: "Nas camadas, use caminhos relativos (./ ou ../): caminhos absolutos, URLs e pacotes escapam das fronteiras."
    }
  },
  create(context) {
    const file = context.filename;
    const source = classify(path.relative(ROOT, file));
    if (!source || source.layer === "legacy") return {};

    function check(node) {
      const specifier = literalSource(node.source);
      if (specifier === undefined) {
        if (isRestricted(source)) context.report({ node, messageId: "dynamicImport" });
        return;
      }
      if (!/^\.\.?\//.test(specifier)) {
        context.report({ node, messageId: "relativeOnly" });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(specifier.replace(/[?#].*$/s, ""));
      } catch {
        context.report({ node, messageId: "badSpecifier" });
        return;
      }
      const target = classify(path.relative(ROOT, path.resolve(path.dirname(file), pathname)));
      const messageId = violation(source, target);
      if (messageId) context.report({ node, messageId });
    }

    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      ExportNamedDeclaration: (node) => node.source && check(node)
    };
  }
};
