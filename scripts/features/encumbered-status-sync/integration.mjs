import { fromFactory } from "../../kernel/wrap.mjs";
import { ENCUMBERED, createSerializer, diagnoseEncumbranceHooks, encumbranceAction, shouldCheckAfterItems, wrapDescendantCallback } from "./domain.mjs";

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
async function syncOnce(ctx, actor) {
  const effectIds = actor.effects.filter((ef) => ef.statuses?.has(ENCUMBERED)).map((ef) => ef.id);
  const { create, deleteIds } = encumbranceAction({
    isCharacter: actor.type === "character",
    isEncumbered: Boolean(actor.system?.attributes?.carga?.encumbered),
    effectIds
  });
  if (create) {
    const effect = await ctx.platform.core.ActiveEffect.fromStatusEffect(ENCUMBERED);
    await actor.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
  }
  if (deleteIds.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", deleteIds);
  }
}

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function install(ctx) {
  const proto = ctx.platform.classes.actor.prototype;
  const sync = createSerializer(async (actor) => {
    try {
      await syncOnce(ctx, actor);
    } catch (err) {
      ctx.log.error(`could not update "${ENCUMBERED}" on ${actor.name}`, err);
    }
  });
  const checkAfterItems = (actor, [parent, collection, , , , userId]) => {
    if (!shouldCheckAfterItems({ collection, parentIsActor: parent === actor, userId, currentUserId: ctx.platform.user.id() })) return;
    actor._checkEncumbered();
  };
  // Replaces the system's check: the original is not called.
  ctx.wrap(proto, "_checkEncumbered", function () {
    return sync(this);
  });
  for (const name of ["_onCreateDescendantDocuments", "_onDeleteDescendantDocuments"]) {
    ctx.wrap(proto, name, fromFactory((original) => wrapDescendantCallback(original, checkAfterItems)));
  }
}

// A hook the system does not override is inherited from core, which never calls _checkEncumbered: it is left out.
export const SOURCES = {
  check: "ActorT20#_checkEncumbered",
  create: ["ActorT20#_onCreateDescendantDocuments", "ItemT20#_onCreate"],
  delete: ["ActorT20#_onDeleteDescendantDocuments", "ItemT20#_onDelete"]
};

/** @param {import("../../kernel/feature.mjs").FeatureContext} ctx */
export function isNeeded(ctx) {
  const read = (labels) => labels.map((label) => ctx.platform.sourceOfMethod(label)).filter((source) => source != null);
  if (ctx.platform.sourceOfMethod(SOURCES.check) == null) return undefined;
  return diagnoseEncumbranceHooks({ create: read(SOURCES.create), delete: read(SOURCES.delete) });
}
