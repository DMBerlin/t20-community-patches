/**
 * Pure logic of the sustained spell limit (#37): spells and casts, the cast stamp of the card effects, the cast
 * history of the chat, the sustained spells a caster keeps, warning dedup and the application snapshots.
 */
import { MODULE_ID } from "../../../lib/module.mjs";

export const SUSTAINED_SPELL_SETTING = "sustainedSpellRule";
export const SUSTAINED_SPELL_MODES = ["off", "warn"];

export const SUSTAIN_EXPIRY = "sustainEnd";
export const SUSTAIN_STATUS = "sustentando";
export const CAST_FLAG = "sustainedCast";
export const MANA_FLOW_SOURCE = "Compendium.tormenta20.poderes.Item.TXja4zA1sQRnE65j";
export const MANA_FLOW_NAME = "Fluxo de Mana";
export const WARNING_WINDOW_MS = 3000;
export const MAX_TRACKED_ENTRIES = 100;

/** @param {{type?: string}} item */
export function isSpell(item) {
  return item?.type === "magia";
}

/** Spells and scrolls: using a scroll casts its spell. */
export function isSpellCast(item) {
  return isSpell(item) || (item?.type === "consumivel" && item.system?.tipo === "scroll");
}

export function isSustainedSpell(item) {
  return isSpell(item) && item.system?.duracao?.units === "sust";
}

/** How many sustained spells a caster keeps at once: one, two with Fluxo de Mana. */
export function sustainedSpellCapacity({ manaFlow = false } = {}) {
  return manaFlow ? 2 : 1;
}

/**
 * Splits a sustained origin (`<caster uuid>.ActiveEffect.<marker id>`, T20:6634-6637).
 * @returns {{casterUuid: string, markerId: string}|null}
 */
export function parseSustainOrigin(origin) {
  if (typeof origin !== "string") return null;
  const [casterUuid, markerId, ...rest] = origin.split(".ActiveEffect.");
  if (!casterUuid || !markerId || rest.length) return null;
  return { casterUuid, markerId };
}

/** @returns {{castId: string, casterUuid: string, spell: string}|null} */
export function readCast(value) {
  if (!value || typeof value !== "object") return null;
  const { castId, casterUuid, spell } = value;
  if (typeof castId !== "string" || !castId || typeof casterUuid !== "string" || !casterUuid) return null;
  return { castId, casterUuid, spell: typeof spell === "string" ? spell : "" };
}

/**
 * Stamps every sustained effect of one chat card with the cast. Replaces `flags` with a new object.
 * @param {unknown} entries  `options.effects`: one `[effect, ...children]` array per card button.
 * @returns {number} How many effects were stamped.
 */
export function stampSustainedCast(entries, cast) {
  const valid = readCast(cast);
  if (!valid) return 0;
  let count = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const effect of Array.isArray(entry) ? entry : []) {
      if (effect?.duration?.expiry !== SUSTAIN_EXPIRY || !parseSustainOrigin(effect.origin)) continue;
      const flags = effect.flags && typeof effect.flags === "object" ? effect.flags : {};
      effect.flags = { ...flags, [MODULE_ID]: { ...flags[MODULE_ID], [CAST_FLAG]: { ...valid } } };
      count++;
    }
  }
  return count;
}

/** The cast stamped in a chat card, with the server-managed creation time of the message. */
export function castFromMessage(message) {
  const groups = message?.flags?.tormenta20?.effects;
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    for (const effect of Array.isArray(group) ? group : []) {
      const cast = readCast(effect?.flags?.[MODULE_ID]?.[CAST_FLAG]);
      if (cast) return { ...cast, messageId: String(message.id ?? message._id ?? ""), createdTime: Number(message._stats?.createdTime) || 0 };
    }
  }
  return null;
}

const byPublication = (a, b) => a.createdTime - b.createdTime || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0);

/** One caster's published sustained spell casts, oldest first; a cast posted twice keeps its first message. */
export function castHistory(casts, casterUuid) {
  const first = new Map();
  for (const cast of [...(casts ?? [])].filter((c) => c?.casterUuid === casterUuid).sort(byPublication)) {
    if (!first.has(cast.castId)) first.set(cast.castId, cast);
  }
  return [...first.values()];
}

/** Whether the caster published at least `capacity` sustained spell cards after this cast. */
export function isSupersededCast(castId, history, capacity) {
  const index = (history ?? []).findIndex((c) => c.castId === castId);
  if (index < 0) return false;
  return history.length - index - 1 >= capacity;
}

/** The casts published after one, for the warning text. */
export function castsAfter(castId, history) {
  const index = (history ?? []).findIndex((c) => c.castId === castId);
  return index < 0 ? [] : history.slice(index + 1);
}

/** "Sustentando (Velocidade)" → "Velocidade" (the system appends ` (<effect name>)`, T20:17903). */
export function markerSubject(name) {
  if (typeof name !== "string") return "";
  const start = name.indexOf(" (");
  if (start < 0 || !name.endsWith(")")) return "";
  return name.slice(start + 2, -1).trim();
}

/**
 * Sustained spells a caster keeps.
 * @param {{casterUuid: string, effects: {origin?: string, cast?: unknown}[], markers: {id: string, name?: string}[],
 *   spellNames?: string[]}} params  `effects`: stamped sustained effects found anywhere; `markers`: the caster's
 *   "Sustentando" markers.
 * @returns {{casts: {castId: string, spell: string, markerIds: string[]}[], uncertain: {id: string, name: string}[]}}
 */
export function activeSustainedCasts({ casterUuid, effects = [], markers = [], spellNames = [] }) {
  const casts = new Map();
  const ownedMarkers = new Set();
  for (const effect of effects) {
    const cast = readCast(effect?.cast);
    const origin = parseSustainOrigin(effect?.origin);
    if (!cast || cast.casterUuid !== casterUuid || origin?.casterUuid !== casterUuid) continue;
    let entry = casts.get(cast.castId);
    if (!entry) casts.set(cast.castId, (entry = { castId: cast.castId, spell: cast.spell, markerIds: [] }));
    if (!entry.markerIds.includes(origin.markerId)) entry.markerIds.push(origin.markerId);
    ownedMarkers.add(origin.markerId);
  }
  const names = spellNames.filter((n) => typeof n === "string" && n);
  const uncertain = [];
  for (const marker of markers) {
    if (!marker?.id || ownedMarkers.has(marker.id)) continue;
    const subject = markerSubject(marker.name);
    if (subject && names.some((n) => subject === n || subject.startsWith(`${n} (`))) uncertain.push({ id: marker.id, name: marker.name });
  }
  return { casts: [...casts.values()], uncertain };
}

/** The other casts when keeping `castId` (or a new cast, when null) would exceed the limit; otherwise null. */
export function exceedsLimit({ casts, uncertain }, capacity, castId = null) {
  const others = casts.filter((c) => c.castId !== castId);
  return others.length + uncertain.length >= capacity ? others : null;
}

/** Drops entries older than `ttl` and keeps at most `max` (a Map iterates oldest first). Entries are times or `{time}`. */
export function pruneTimedMap(map, { now, ttl, max = MAX_TRACKED_ENTRIES }) {
  for (const [key, entry] of map) if (now - (typeof entry === "number" ? entry : entry.time) >= ttl) map.delete(key);
  while (map.size > max) map.delete(map.keys().next().value);
}

/** Notification dedup: true (and recorded) when `key` was not warned in the last `ttl` ms. */
export function shouldWarn(map, key, { now, ttl = WARNING_WINDOW_MS, max = MAX_TRACKED_ENTRIES }) {
  pruneTimedMap(map, { now, ttl, max });
  if (map.has(key)) return false;
  map.set(key, now);
  pruneTimedMap(map, { now, ttl, max });
  return true;
}

/**
 * Snapshots of one cast's application, shared by its targets and child effects. A snapshot is reused only while the
 * world generation is unchanged and for at most `ttl` ms; the creation of the cast's own effect updates it in place.
 */
export function createScanCache({ ttl = WARNING_WINDOW_MS, max = MAX_TRACKED_ENTRIES } = {}) {
  const entries = new Map();
  let generation = 0;
  return {
    get size() {
      return entries.size;
    },
    get(castId, build, now) {
      pruneTimedMap(entries, { now, ttl, max });
      let entry = entries.get(castId);
      if (!entry || entry.generation !== generation) {
        entries.delete(castId);
        entries.set(castId, (entry = { ...build(), time: now, generation }));
        pruneTimedMap(entries, { now, ttl, max });
      }
      return entry;
    },
    invalidate() {
      generation++;
    },
    /** A stamped effect of `castId` was created: other snapshots become stale; this cast's, if current, gets it. */
    noteCreated(castId, effect) {
      const entry = entries.get(castId);
      const current = entry?.generation === generation;
      generation++;
      if (!current) return;
      entry.generation = generation;
      entry.effects?.push(effect);
    }
  };
}

/**
 * Effects of world actors plus the raw delta effects of unlinked tokens. Never reads `token.actor` or `token.delta`,
 * which would materialize lazy deltas (core client/documents/token.mjs:249-253, 284-321).
 */
export function* effectSources({ actors = [], scenes = [] } = {}) {
  for (const actor of actors) yield* actor?.effects ?? [];
  for (const scene of scenes) {
    for (const token of scene?.tokens ?? []) yield* tokenDeltaEffects(token);
  }
}

/** The live raw delta effects of an unlinked token, read from its source only. */
function* tokenDeltaEffects(token) {
  const source = token?._source;
  if (!source || source.actorLink) return;
  for (const effect of source.delta?.effects ?? []) if (effect && !effect._tombstone) yield effect;
}

/** Stamped sustained effects of one caster, from documents or raw sources. */
export function collectStampedEffects(effects, casterUuid) {
  const found = [];
  for (const effect of effects ?? []) {
    if (effect?.duration?.expiry !== SUSTAIN_EXPIRY) continue;
    const cast = readCast(effect.flags?.[MODULE_ID]?.[CAST_FLAG]);
    if (cast?.casterUuid === casterUuid) found.push({ origin: effect.origin, cast });
  }
  return found;
}
