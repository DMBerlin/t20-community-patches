/** Actors of the world, read through the platform's documents port. */

/**
 * Actors to prepare again when a setting changes: world actors and the synthetic actors of unlinked tokens.
 * @param {{actors: () => Iterable<object>|undefined, scenes: () => Iterable<object>|undefined}} documents
 */
export function* allActors(documents) {
  yield* documents.actors() ?? [];
  for (const scene of documents.scenes() ?? []) {
    for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) yield token.actor;
  }
}
