/**
 * Wrappers, markers and diagnosis of the patches that correct world copies (see index.mjs).
 */
import { MODULE_ID } from "../module.mjs";
import { markWrapper } from "../source.mjs";
import { findEntry } from "./signatures.mjs";

/**
 * Whether the document being created goes into a compendium pack (the operation's pack, the document's own pack or
 * its parent's pack). Pack contents are the source others copy from, so they are never corrected.
 */
export const isPackDestination = (doc, options) => Boolean(options?.pack || doc?.pack || doc?.parent?.pack);

/**
 * Wraps Document#_preCreate(data, options, user): corrects this._source before the system code, then calls the
 * original. Documents created inside a compendium pack are left alone.
 */
export function wrapPreCreate(original, documentName, entries, patchId) {
  return markWrapper(async function (...args) {
    try {
      if (!isPackDestination(this, args[1])) {
        const update = fixFor(this._source, entries, documentName);
        if (update) this.updateSource(update);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | ${patchId}: correction skipped`, error);
    }
    return original.apply(this, args);
  }, original);
}

/** Correction of a source that `entries` recognize, or null (unknown origin, edited data or already corrected). */
export function fixFor(src, entries, documentName) {
  return findEntry(src, entries, documentName)?.fix(src) ?? null;
}

/**
 * Corrections of the embedded items of a new actor, as [{ id, update }]. The core creates the items given in
 * Actor.create({ items }) without calling their own _preCreate, so the actor's wrapper corrects them. An entry may
 * declare `embedded(actorSource)`: when it returns false the item is left as is, for data the system copied from the
 * item to the actor (a duplicated actor keeps the old copy, which the sheet marks, instead of diverging from it).
 */
export function embeddedItemFixes(items, entries, actor) {
  const fixes = [];
  for (const item of items ?? []) {
    const entry = findEntry(item, entries, "Item");
    if (!entry || !item?._id || (entry.embedded && !entry.embedded(actor))) continue;
    const update = entry.fix(item);
    if (update) fixes.push({ id: item._id, update });
  }
  return fixes;
}

/**
 * Wraps Actor#_preCreate(data, options, user): corrects the embedded items before the system code, then calls the
 * original. Each embedded item shares its _source with the actor's, so updating the item updates the actor data.
 */
export function wrapActorPreCreate(original, entries, patchId) {
  return markWrapper(async function (...args) {
    try {
      if (!isPackDestination(this, args[1])) {
        for (const { id, update } of embeddedItemFixes(this._source?.items, entries, this._source)) this.items?.get(id)?.updateSource(update);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | ${patchId}: correction of embedded items skipped`, error);
    }
    return original.apply(this, args);
  }, original);
}

/** Ids of owned items still holding the wrong data of a known entry (created before the correction was on). */
export function outdatedItemIds(items, entries) {
  const ids = [];
  for (const item of items ?? []) {
    const src = item?._source ?? item;
    if (src?._id && fixFor(src, entries, "Item")) ids.push(src._id);
  }
  return ids;
}

/** Adds the outdated icon to an item row, once. */
function markOutdated(row, text) {
  if (row.querySelector(".t20cp-outdated")) return;
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-triangle-exclamation t20cp-outdated";
  icon.dataset.tooltip = text;
  icon.setAttribute("aria-label", text);
  const anchor = row.querySelector(".item-name label, a.item-control");
  if (anchor) anchor.after(icon);
  else row.append(icon);
}

/**
 * Render hook for actor sheets: marks the rows of the owned items that `entries` would still correct with the text
 * `tooltip()` returns (read on each render, after the translations load), so they can be removed and added again.
 * Fails safe.
 */
export function outdatedMarker(entries, tooltip, patchId) {
  return function (app, html) {
    try {
      const actor = app?.actor ?? app?.document;
      const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
      if (!actor?.items || !root?.querySelectorAll) return;
      const ids = outdatedItemIds(actor.items, entries);
      if (!ids.length) return;
      const text = tooltip();
      for (const id of ids) {
        for (const row of root.querySelectorAll(`[data-item-id="${id}"]`)) markOutdated(row, text);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | ${patchId}: outdated marker skipped`, error);
    }
  };
}

/** State of a source: "present" (exact wrong data), "fixed" (book data, fully checked), "unknown" or "missing". */
export function classify(entry, src) {
  if (!src) return "missing";
  if (entry.fix(src)) return "present";
  return entry.isCorrect(src) ? "fixed" : "unknown";
}

/**
 * Results of one entry source: one per part when the entry declares `parts` (each with name, fix and isCorrect,
 * judged on its own), otherwise one for the entry.
 */
export const classifyEntry = (entry, src) =>
  (entry.parts ?? [entry]).map((part) => ({ name: part.name, state: classify(part, src) }));

/**
 * Reads every entry from its system compendium (after ready).
 * @param {object[]} entries
 * @param {{get(id: string): {getDocument(id: string): Promise<object>}|undefined}} packs  game.packs.
 */
export async function readEntries(entries, packs) {
  const results = [];
  for (const entry of entries) {
    const doc = await packs.get(`tormenta20.${entry.pack}`)?.getDocument(entry.id);
    results.push(...classifyEntry(entry, doc?.toObject()));
  }
  return results;
}

/**
 * Diagnosis from result states ("present", "fixed", "unknown", "missing"):
 *  - some present: present; high only when every result was verified (none unknown or missing), otherwise low;
 *  - every result fixed: fixed with `fixedConfidence` ("high" only when isCorrect checks the full mechanical data);
 *  - otherwise unknown/low. Missing results never count as verified.
 */
export function summarize(results, fixedConfidence = "high") {
  const names = (...states) => results.filter((r) => states.includes(r.state)).map((r) => r.name);
  const present = names("present");
  const unclear = names("unknown", "missing");
  const tail = unclear.length ? `; unverified: ${unclear.join(", ")}` : "";
  if (present.length) {
    const confidence = unclear.length ? "low" : "high";
    return { bug: "present", confidence, evidence: `wrong data: ${present.join(", ")}${tail}` };
  }
  if (results.length && !unclear.length) {
    return { bug: "fixed", confidence: fixedConfidence, evidence: "every known entry holds the rulebook data" };
  }
  if (unclear.length) return { bug: "unknown", confidence: "low", evidence: `unverified: ${unclear.join(", ")}` };
  return undefined;
}
