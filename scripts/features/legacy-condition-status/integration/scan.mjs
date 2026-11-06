import { candidatesOf, undoPlan } from "../domain.mjs";

const localEffects = (doc) => doc?._source?.effects ?? [];
const itemEffects = (items, itemId) => (items ?? []).find((item) => item?._id === itemId)?.effects ?? [];
const found = (doc, sources) => (doc ? { doc, sources } : null);

/** The token of the preview, if it is still unlinked and still built on the same base actor. */
function sameToken(platform, { sceneId, tokenId, actorId }) {
  const token = platform.documents.scenes()?.get(sceneId)?.tokens?.get(tokenId);
  if (!token || token._source.actorLink || token._source.actorId !== actorId) return null;
  return token;
}

function* actorParents(platform) {
  const actors = () => platform.documents.actors();
  for (const actor of actors() ?? []) {
    const id = actor.id;
    const current = () => actors()?.get(id);
    yield {
      key: `Actor.${id}`,
      label: actor.name,
      sources: localEffects(actor),
      locate: () => found(current(), localEffects(current()))
    };
    for (const item of actor._source.items ?? []) {
      const itemId = item._id;
      const currentItem = () => current()?.items?.get(itemId);
      yield {
        key: `Actor.${id}.Item.${itemId}`,
        label: `${actor.name} → ${item.name}`,
        sources: item.effects ?? [],
        locate: () => found(currentItem(), localEffects(currentItem()))
      };
    }
  }
}

/** Unlinked tokens, read from their own delta only: the effects a token inherits from its base actor never count. */
function* tokenParents(platform) {
  for (const scene of platform.documents.scenes() ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token._source.actorLink) continue;
      const ref = { sceneId: scene.id, tokenId: token.id, actorId: token._source.actorId };
      const delta = token._source.delta ?? {};
      const key = `Scene.${ref.sceneId}.Token.${ref.tokenId}`;
      const label = `${scene.name} → ${token.name}`;
      yield {
        key,
        label,
        sources: delta.effects ?? [],
        locate: () => {
          const current = sameToken(platform, ref);
          return found(current?.actor, current?._source.delta?.effects ?? []);
        }
      };
      for (const item of delta.items ?? []) {
        const itemId = item._id;
        yield {
          key: `${key}.Item.${itemId}`,
          label: `${label} → ${item.name}`,
          sources: item.effects ?? [],
          locate: () => {
            const current = sameToken(platform, ref);
            return found(current?.actor?.items?.get(itemId), itemEffects(current?._source.delta?.items, itemId));
          }
        };
      }
    }
  }
}

function* itemParents(platform) {
  const items = () => platform.documents.items();
  for (const item of items() ?? []) {
    const id = item.id;
    const current = () => items()?.get(id);
    yield { key: `Item.${id}`, label: item.name, sources: localEffects(item), locate: () => found(current(), localEffects(current())) };
  }
}

/**
 * Parents with effects, from local sources: world actors and their items, unlinked tokens and their items, world items.
 * `locate()` re-reads the parent when writing and returns `{ doc, sources }`, or null when it is gone or is no longer
 * the one previewed (token deleted, relinked or rebuilt on another actor).
 */
export function* parentsOf(platform) {
  yield* actorParents(platform);
  yield* tokenParents(platform);
  yield* itemParents(platform);
}

/** Read-only scan for the preview and the late diagnosis. */
export function scan(platform) {
  const repair = [];
  const repaired = [];
  for (const parent of parentsOf(platform)) {
    const candidates = candidatesOf(parent.sources);
    if (candidates.length) repair.push({ ...parent, candidates });
    const marks = (parent.sources ?? [])
      .map((source) => ({ id: source._id, name: source.name, plan: undoPlan(source) }))
      .filter((mark) => mark.plan);
    if (marks.length) repaired.push({ ...parent, marks });
  }
  return { repair, repaired };
}
