import { readEntries, summarize, wrapPreCreate } from "../../lib/compendium-copy/index.mjs";
import { markWrapper, unwrap } from "../../lib/source.mjs";
import { fromFactory } from "../../kernel/wrap.mjs";
import { ENTRIES, fixParsedType, parserFailures, parserRecognized, PATCH_ID } from "./domain/index.mjs";

const labelsNow = (ctx) => {
  const T20 = ctx.platform.t20Config();
  return {
    types: T20?.creatureTypes ?? {},
    roles: T20?.creatureRoles ?? {},
    sizes: T20?.actorSizes ?? {}
  };
};

const parserPrototype = (ctx) => ctx.platform.t20()?.applications?.StatblockParser?.prototype;

function wrapParseData(ctx, original) {
  return markWrapper(function (...args) {
    const [statblock, schema, , log] = args;
    const before = {
      tipo: schema?.detalhes?.tipo,
      role: schema?.detalhes?.role,
      raca: schema?.detalhes?.raca,
      tamanho: schema?.tracos?.tamanho
    };
    const result = original.apply(this, args);
    try {
      fixParsedType(statblock, schema, log, { before, labels: labelsNow(ctx) });
    } catch (error) {
      ctx.log.warn("parser correction skipped", error);
    }
    return result;
  }, original);
}

export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "compendium data and localized labels are read after ready" };
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export async function lateProbe(ctx) {
  try {
    const results = await readEntries(ENTRIES, ctx.platform.documents.packs());
    const parse = unwrap(parserPrototype(ctx)?.parseData);
    const recognized = parserRecognized(String(parse ?? ""));
    const failures = recognized ? parserFailures(labelsNow(ctx)) : [];
    results.push({
      name: `StatblockParser${failures.length ? ` (${failures.join(", ")})` : ""}`,
      state: parserState(recognized, failures)
    });
    // The parser is judged from its source: never fixed/high.
    return summarize(results, "low");
  } catch (error) {
    ctx.log.warn("probe failed", error);
    return undefined;
  }
}

function parserState(recognized, failures) {
  if (!recognized) return "unknown";
  return failures.length ? "present" : "fixed";
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const actor = ctx.platform.classes.actor?.prototype;
  if (typeof actor?._preCreate === "function") {
    ctx.wrap(actor, "_preCreate", fromFactory((original) => wrapPreCreate(original, "Actor", ENTRIES, PATCH_ID)));
  }
  const parser = parserPrototype(ctx);
  if (typeof parser?.parseData !== "function") return;
  if (!parserRecognized(String(unwrap(parser.parseData)))) {
    ctx.log.warn("StatblockParser#parseData not recognized; parser correction inactive");
    return;
  }
  ctx.wrap(parser, "parseData", fromFactory((original) => wrapParseData(ctx, original)));
}
