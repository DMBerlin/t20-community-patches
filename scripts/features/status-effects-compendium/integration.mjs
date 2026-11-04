import { SOURCE_PACK, STATUS_PACK, selectConditionSources, shouldRebuild, shouldSubstitute } from "./domain.mjs";

let substituted = false;
/** Resolved once the system's empty copy was replaced and written on this load: the bug did show up. */
let markTriggered;
const triggered = new Promise((resolve) => (markTriggered = resolve));
/** How long the late probe waits for the system's routine, which runs without await on "ready". */
const LATE_PROBE_TIMEOUT = 60_000;
let rebuilding = false;
let rebuildPending = false;

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function isSystemEmptyCopy(ctx, data, operation) {
  const { platform } = ctx;
  const indexSize = platform.documents.packs()?.get(STATUS_PACK)?.index?.size ?? -1;
  return shouldSubstitute(data, operation, { indexSize, isActiveGM: platform.user.isActiveGM() });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
async function conditionSources(ctx) {
  const docs = (await ctx.platform.documents.packs()?.get(SOURCE_PACK)?.getDocuments()) ?? [];
  const sources = selectConditionSources(docs.map((d) => d.toObject()));
  ctx.log.info(`filling ${STATUS_PACK} with ${sources.length} conditions`);
  return sources;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function wrapCreateDocuments(ctx, Base) {
  ctx.wrap(Base, "createDocuments", async function (original, data = [], operation = {}) {
    let substitutedNow = false;
    if (!substituted) {
      try {
        if (isSystemEmptyCopy(ctx, data, operation)) {
          substituted = true;
          substitutedNow = true;
          data = await conditionSources(ctx);
        }
      } catch (err) {
        ctx.log.error(`could not read ${SOURCE_PACK}; keeping the system's data`, err);
      }
    }
    const result = original.call(this, data, operation);
    if (substitutedNow) Promise.resolve(result).then(() => markTriggered(), () => {});
    return result;
  });
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
async function statusEntries(ctx, docs) {
  const entries = [];
  for (const effect of docs) {
    const id = effect.statuses.first();
    if (!id) continue;
    entries.push({
      id,
      uuid: effect.uuid,
      name: effect.name,
      img: effect.img,
      link: effect.toAnchor().outerHTML,
      category: effect.system.status?.category,
      description: await ctx.platform.utils.enrichHTML(effect.description),
      _source: effect.clone({}, { keepId: false }).toObject()
    });
  }
  return entries;
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
function publishStatusEffects(ctx, entries) {
  const { platform } = ctx;
  platform.config.setStatusEffects(entries);
  platform.config.setControlIcon("defeated", platform.statusEffects().inconsciente.img);
  platform.config.setSpecialStatus("BLIND", "cego");
  platform.config.setSpecialStatus("DEFEATED", "morto");
  platform.config.setSpecialStatus("INVISIBLE", "invisivel");
  const hud = platform.canvas.tokenHud();
  if (hud?.rendered) hud.render();
  ctx.log.info(`rebuilt CONFIG.statusEffects with ${entries.length} conditions`);
}

/**
 * Mirrors the system's CONFIG preparation (prepareStatusesCompendium) without writing to or locking the pack.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
async function rebuildStatusEffects(ctx) {
  if (rebuilding) {
    rebuildPending = true;
    return;
  }
  rebuilding = true;
  try {
    do {
      rebuildPending = false;
      if (ctx.platform.statusEffects()?.inconsciente) return;
      const pack = ctx.platform.documents.packs()?.get(STATUS_PACK);
      if (!pack) return;
      const docs = await pack.getDocuments();
      if (!docs.some((d) => d.statuses?.has("inconsciente"))) continue;
      publishStatusEffects(ctx, await statusEntries(ctx, docs));
    } while (rebuildPending);
  } catch (err) {
    ctx.log.error("could not rebuild CONFIG.statusEffects", err);
  } finally {
    rebuilding = false;
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const Base = ctx.platform.core.ActiveEffect;
  if (typeof Base?.createDocuments !== "function") throw new Error("status-effects-compendium: ActiveEffect.createDocuments not found");
  wrapCreateDocuments(ctx, Base);
  const debouncedRebuild = ctx.platform.utils.debounce(() => rebuildStatusEffects(ctx), 250);
  ctx.hooks.on("updateCompendium", (pack, _documents, _operation, userId) => {
    if (
      shouldRebuild({
        collection: pack?.collection,
        userId,
        currentUserId: ctx.platform.user.id(),
        hasUnconscious: Boolean(ctx.platform.statusEffects()?.inconsciente)
      })
    ) {
      debouncedRebuild();
    }
  });
}

/**
 * The broken copy lives in a local function of the system and the packs only load after "init", so the bug
 * cannot be probed here. Both interceptions only act when the bug shows up (an empty copy into an empty
 * `world.statuses`, or a client left without conditions after the pack is filled), hence `guarded`.
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "only verifiable after the compendiums load" };
}

/**
 * After "ready": the bug is confirmed when this load replaced the system's empty copy. If that did not happen
 * (pack already filled, another GM, timeout), nothing is learned: a filled pack may have been filled by this
 * patch on an earlier load, so it never proves an official fix.
 * @returns {Promise<import("../../registry.mjs").Diagnosis|undefined>}
 */
export function lateProbe() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), LATE_PROBE_TIMEOUT));
  return Promise.race([
    triggered.then(() => ({
      bug: "present",
      confidence: "high",
      evidence: "the system copied an empty condition list into world.statuses"
    })),
    timeout
  ]);
}
