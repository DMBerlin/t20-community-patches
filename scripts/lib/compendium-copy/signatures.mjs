/**
 * Origin and signatures of system compendium entries, used by the patches that correct world copies (see index.mjs).
 */

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
