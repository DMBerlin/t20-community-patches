/**
 * Helpers for patches that correct, in _preCreate, the world copy of a system compendium entry whose data diverges
 * from the rulebook. A copy is corrected only when it comes from the known entry and still holds the exact wrong
 * mechanical data, so manual edits, other modules' data and a future system fix are left alone.
 */
import { MODULE_ID, markWrapper } from "./utils.mjs";

const SYSTEM_UUID = /^Compendium\.tormenta20\.([\w-]+)\.(Item|Actor)\.([A-Za-z0-9]{16})$/;

/**
 * Compendium origin of a document source, from _stats.compendiumSource and the legacy flags.core.sourceId.
 *  - { status: "absent" }: no origin recorded (keepId copies: race grants, "Import all");
 *  - { status: "system", pack, documentName, id }: every recorded origin is the same system compendium entry;
 *  - { status: "foreign", uuid }: some recorded origin is anything else; it blocks the _id + name fallback.
 */
export function sourceRef(src) {
  const uuids = [src?._stats?.compendiumSource, src?.flags?.core?.sourceId].filter((u) => u != null && u !== "");
  if (!uuids.length) return { status: "absent" };
  const matches = uuids.map((uuid) => (typeof uuid === "string" ? uuid.match(SYSTEM_UUID) : null));
  const [first] = matches;
  if (!first || matches.some((m) => m?.[0] !== first[0])) return { status: "foreign", uuid: uuids.join(", ") };
  return { status: "system", pack: first[1], documentName: first[2], id: first[3] };
}

/** Table entry for a document source: by system compendium UUID, or by _id and name when no origin is recorded. */
export function findEntry(src, entries, documentName) {
  const ref = sourceRef(src);
  if (ref.status === "foreign") return null;
  if (ref.status === "system") {
    if (ref.documentName !== documentName) return null;
    return entries.find((e) => e.pack === ref.pack && e.id === ref.id) ?? null;
  }
  return entries.find((e) => e.id === src?._id && e.name === src?.name) ?? null;
}

/** Order-independent JSON for plain data; undefined and null are the same. */
export function canonical(value) {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sameSignature = (a, b) => canonical(a) === canonical(b);

/** Change as compared by signatures: value as text, so 2 and "2" match. */
export const change = (key, type, value, priority = null, phase = "initial") => ({
  key,
  type,
  value: value == null ? null : String(value),
  phase,
  priority
});

/** A SetField as stored in _source (an array, or a Set in a prepared document), sorted; anything else as is. */
const setOf = (value) =>
  value && typeof value !== "string" && typeof value[Symbol.iterator] === "function" ? [...value].sort() : value;

/** Fields of the Tormenta20 effect system model (T20:17545-17700) read by effectSignature. */
const EFFECT_SYSTEM_KEYS = new Set(["changes", "targets", "status", "onuse", "abilityUse", "aura", "identifier", "upgrade"]);

/**
 * Everything in an effect source that changes what it does, read from the cleaned source (this._source / toObject()),
 * where the core already dropped fields outside the schema and filled the initial values. The description, the image
 * and display fields are left out. Any system field this code does not know is kept as is under `extra`, so a schema
 * change in a later version makes signatures differ and the correction does nothing.
 */
export function effectSignature(effect) {
  const system = effect?.system ?? {};
  const use = system.abilityUse ?? {};
  const aura = system.aura ?? {};
  const upgrade = system.upgrade ?? {};
  const status = system.status;
  const duration = effect?.duration ?? {};
  const extra = Object.fromEntries(Object.entries(system).filter(([key]) => !EFFECT_SYSTEM_KEYS.has(key)));
  return {
    _id: effect?._id,
    name: effect?.name,
    type: effect?.type,
    disabled: effect?.disabled,
    transfer: effect?.transfer,
    statuses: setOf(effect?.statuses),
    start: effect?.start,
    duration: { value: duration.value, units: duration.units, expiry: duration.expiry },
    changes: Array.isArray(system.changes)
      ? system.changes.map((c) => change(c?.key, c?.type, c?.value, c?.priority ?? null, c?.phase))
      : system.changes,
    targets: setOf(system.targets),
    status:
      status && typeof status === "object"
        ? {
            category: status.category,
            ignoreImunity: status.ignoreImunity,
            upgrade: status.upgrade,
            childEffect: setOf(status.childEffect)
          }
        : status,
    onuse: system.onuse,
    abilityUse: {
      automatic: use.automatic,
      aumenta: use.aumenta,
      custo: use.custo,
      names: setOf(use.names),
      types: setOf(use.types)
    },
    aura: { isAura: aura.isAura, range: aura.range, behaviors: aura.behaviors },
    identifier: system.identifier,
    upgrade: { type: upgrade.type, itemType: setOf(upgrade.itemType) },
    extra
  };
}

/** Signature of a cleaned effect source as the system packs store it in 1.6.5, with the given differences. */
export function effectLike(_id, name, overrides = {}) {
  return {
    _id,
    name,
    type: "base",
    disabled: false,
    transfer: true,
    statuses: [],
    start: null,
    changes: [],
    targets: [],
    status: null,
    onuse: false,
    identifier: "",
    extra: {},
    ...overrides,
    duration: { value: null, units: "seconds", expiry: null, ...overrides.duration },
    abilityUse: { automatic: false, aumenta: false, custo: 0, names: [], types: [], ...overrides.abilityUse },
    aura: { isAura: false, range: 0, behaviors: null, ...overrides.aura },
    upgrade: { type: null, itemType: [], ...overrides.upgrade }
  };
}

export const effectsOf = (src) => (Array.isArray(src?.effects) ? src.effects : []);

/** Item signature: type, name and every effect. */
export const itemSignature = (src) => ({ type: src?.type, name: src?.name, effects: effectsOf(src).map(effectSignature) });

/** Default priority of each change type (core CONST.ACTIVE_EFFECT_CHANGE_TYPES). */
const TYPE_PRIORITY = { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 };

/** An effect that is always on (not disabled, transferred, not a usage effect). */
export const isPassiveEffect = (e) => e?.disabled !== true && e?.transfer !== false && e?.system?.onuse !== true;

const asList = (value) => (value instanceof Set ? [...value] : Array.isArray(value) ? value : []);

/**
 * Whether the actor applies an always-on effect's changes to itself (ActiveEffectT20#shouldApplyChange): an aura with
 * an applyActiveEffect behavior applies to its owner only when its targets include "self". true, false or null (not
 * determined: an aura whose behaviors this code cannot read). The cleaned source stores behaviors as JSON text
 * (JSONField), so a string is parsed first.
 */
export function appliesToSelf(effect) {
  if (!isPassiveEffect(effect)) return false;
  const aura = effect?.system?.aura;
  if (aura?.isAura !== true) return true;
  let behaviors = aura.behaviors;
  if (typeof behaviors === "string") {
    try {
      behaviors = JSON.parse(behaviors);
    } catch {
      return null;
    }
  }
  if (!behaviors || typeof behaviors !== "object") return null;
  const self = asList(effect.system.targets).includes("self");
  for (const behavior of Object.values(behaviors)) {
    if (!behavior || typeof behavior !== "object") return null;
    if (behavior.type === "applyActiveEffect" && !self) return false;
  }
  return true;
}

/** Key a change really writes: ActiveEffectT20.applyChange sends a movement type to ".bonus" (add) or ".base" (T20:18143). */
export function effectiveKey(c) {
  const key = String(c?.key ?? "");
  if (!key.startsWith("system.attributes.movement") || !/(walk|fly|burrow|climb|swim)$/.test(key)) return key;
  return `${key}.${c?.type === "add" ? "bonus" : "base"}`;
}

/** Whether `key` names a strict ancestor of `path`; "*" matches any segment, as in the system proxy keys. */
export function isAncestorKey(key, path) {
  const k = key.split(".");
  const p = path.split(".");
  return k.length < p.length && k.every((segment, i) => segment === "*" || segment === p[i]);
}

/** A change value this code can evaluate: a number, a boolean or plain text (no array, object, JSON text or @ reference). */
const isScalarValue = (v) =>
  typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && !/^\s*[[{]/.test(v) && !v.includes("@"));

/**
 * Changes of the item's always-on effects that match (`match`: list of keys or predicate) and that the actor applies
 * to itself, in the order it applies them (priority, then position; core Actor#applyActiveEffects). `paths` are the
 * fields being examined (by default the keys of `match`).
 * null when not determined:
 *  - a change in any phase other than "initial": the system derives values such as the walking speed between the
 *    phases (core Actor#prepareData; T20 prepareMovement);
 *  - a change to an ancestor of an examined field (for example an override of system.attributes.sentidos), which the
 *    core SchemaField applies to the whole object;
 *  - a value that is not scalar (an array or JSON text, which the core casts to several elements), an unknown type or
 *    an aura not evaluated.
 */
export function passiveChanges(src, match, paths = Array.isArray(match) ? match : []) {
  const test = typeof match === "function" ? match : (c) => match.includes(c?.key);
  const list = [];
  for (const effect of effectsOf(src)) {
    const applies = appliesToSelf(effect);
    if (applies === false) continue;
    for (const c of effect?.system?.changes ?? []) {
      if (/\.\?+\./.test(String(c?.key))) continue;
      const key = effectiveKey(c);
      const ancestor = paths.some((path) => isAncestorKey(key, path));
      if (!ancestor && !test(c)) continue;
      const priority = c?.priority ?? TYPE_PRIORITY[c?.type];
      if (applies === null || ancestor || (c?.phase ?? "initial") !== "initial") return null;
      if (typeof priority !== "number" || !isScalarValue(c?.value)) return null;
      list.push({ type: c.type, value: c.value, priority, position: list.length });
    }
  }
  return list.sort((a, b) => a.priority - b.priority || a.position - b.position);
}

/**
 * Number the item's always-on effects leave in a field whose base value is unknown. null when it is not determined:
 * no override, a later change of a type this code does not evaluate, or a non-numeric value.
 */
export function passiveNumber(src, match, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes) return null;
  let value = null;
  for (const c of changes) {
    const n = Number(c.value);
    if (c.value === "" || typeof c.value === "boolean" || !Number.isFinite(n)) return null;
    if (c.type === "override") value = n;
    else if (c.type === "add") value = value === null ? null : value + n;
    else if (c.type === "subtract") value = value === null ? null : value - n;
    else return null;
  }
  return value;
}

/** Text the item's always-on effects leave in a field; null unless only overrides touch it. */
export function passiveText(src, match, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes?.length || changes.some((c) => c.type !== "override")) return null;
  return String(changes.at(-1).value);
}

/**
 * Whether the item's always-on effects leave `member` in a SetField (such as sentidos.value): true, false or null
 * (not determined: nothing adds it, or a change of a type or value this code does not evaluate). Each value is a
 * single element, as the core SetField casts a scalar delta.
 */
export function passiveSetHas(src, match, member, paths) {
  const changes = passiveChanges(src, match, paths);
  if (!changes) return null;
  let has = null;
  for (const c of changes) {
    if (c.type !== "add" && c.type !== "subtract") return null;
    if (String(c.value) === member) has = c.type === "add";
  }
  return has;
}

/**
 * Full effects array with the effect `id` edited and `extra` appended. Every existing effect is passed back with its
 * _id, so updateSource diffs each one in place; elements without a matching _id are created.
 */
export function editEffects(src, id, mutate, extra = []) {
  return {
    effects: [
      ...effectsOf(src).map((effect) => {
        const copy = structuredClone(effect);
        if (id && effect?._id === id) mutate(copy);
        return copy;
      }),
      ...extra
    ]
  };
}

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

/**
 * Render hook for actor sheets: marks the rows of the owned items that `entries` would still correct with the text of
 * `tooltipKey`, so they can be removed and added again. Fails safe.
 */
export function outdatedMarker(entries, tooltipKey, patchId) {
  return function (app, html) {
    try {
      const actor = app?.actor ?? app?.document;
      const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0];
      if (!actor?.items || !root?.querySelectorAll) return;
      const ids = outdatedItemIds(actor.items, entries);
      if (!ids.length) return;
      const tooltip = game.i18n.localize(tooltipKey);
      for (const id of ids) {
        for (const row of root.querySelectorAll(`[data-item-id="${id}"]`)) {
          if (row.querySelector(".t20cp-outdated")) continue;
          const icon = document.createElement("i");
          icon.className = "fa-solid fa-triangle-exclamation t20cp-outdated";
          icon.dataset.tooltip = tooltip;
          icon.setAttribute("aria-label", tooltip);
          const anchor = row.querySelector(".item-name label, a.item-control");
          if (anchor) anchor.after(icon);
          else row.append(icon);
        }
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

/** Reads every entry from its system compendium (after ready). */
export async function readEntries(entries) {
  const results = [];
  for (const entry of entries) {
    const doc = await game.packs.get(`tormenta20.${entry.pack}`)?.getDocument(entry.id);
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
