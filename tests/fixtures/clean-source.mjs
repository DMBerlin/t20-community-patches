// Mimics, for tests, how Foundry 14 + Tormenta20 1.6.5 clean an Item source with embedded ActiveEffects (checked
// against toObject() in Foundry 14.369): fields outside the effect schema are dropped, initial values are filled,
// a change without priority has no priority key and aura.behaviors (a JSONField) becomes JSON text.

const effectDefaults = () => ({
  img: "icons/svg/aura.svg",
  type: "base",
  disabled: false,
  start: null,
  duration: { value: null, units: "seconds", expiry: null, expired: false },
  description: "",
  origin: null,
  tint: "#ffffff",
  transfer: true,
  statuses: [],
  showIcon: 1,
  folder: null,
  sort: 0,
  flags: {}
});

const asArray = (value) => (value instanceof Set ? [...value] : Array.isArray(value) ? [...value] : []);

function cleanChange(c) {
  const out = { key: c.key, type: c.type, value: c.value, phase: c.phase ?? "initial" };
  if (c.priority !== undefined) out.priority = c.priority;
  return out;
}

export function cleanEffect(effect) {
  const base = effectDefaults();
  const system = effect.system ?? {};
  const use = system.abilityUse ?? {};
  const aura = system.aura ?? {};
  const cleanAura = { isAura: aura.isAura ?? false, range: aura.range ?? 0 };
  if (aura.behaviors !== undefined && aura.behaviors !== null) {
    cleanAura.behaviors = typeof aura.behaviors === "string" ? aura.behaviors : JSON.stringify(aura.behaviors);
  }
  return {
    ...base,
    ...effect,
    duration: { ...base.duration, ...effect.duration },
    statuses: asArray(effect.statuses),
    system: {
      changes: (system.changes ?? []).map(cleanChange),
      identifier: system.identifier ?? "",
      targets: asArray(system.targets),
      status: system.status ?? null,
      onuse: system.onuse ?? false,
      abilityUse: {
        description: use.description ?? "",
        automatic: use.automatic ?? false,
        aumenta: use.aumenta ?? false,
        custo: use.custo === undefined ? null : use.custo,
        names: asArray(use.names),
        types: asArray(use.types)
      },
      aura: cleanAura,
      upgrade: { type: system.upgrade?.type ?? null, itemType: asArray(system.upgrade?.itemType) }
    }
  };
}

export const cleanItem = (src) => ({
  ...structuredClone(src),
  effects: (src.effects ?? []).map((e) => cleanEffect(structuredClone(e)))
});

function merge(target, update) {
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object") {
      merge(target[key], value);
    } else target[key] = structuredClone(value);
  }
  return target;
}

/** What updateSource leaves in a cleaned source: the effects array is replaced and new effects get initial values. */
export function applyUpdate(src, update) {
  const { effects, ...rest } = update;
  const out = merge(structuredClone(src), rest);
  if (effects) out.effects = effects;
  return cleanItem(out);
}

/** A cleaned copy of `src` after `mutate(effect, item)` on effect `index`. */
export function withEffect(src, mutate, index = 0) {
  const copy = structuredClone(src);
  mutate(copy.effects[index], copy);
  return cleanItem(copy);
}

/** A cleaned copy of `src` with an extra effect. */
export const withExtraEffect = (src, effect) => cleanItem({ ...structuredClone(src), effects: [...src.effects, effect] });
