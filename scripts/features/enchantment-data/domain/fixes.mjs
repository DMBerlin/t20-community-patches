const DEFENSE = "system.attributes.defesa.bonus";
const PENALTY = "system.attributes.defesa.pda";
const SAVES = "system.modificadores.pericias.resistencia";
const DR = "system.tracos.resistencias.dano.bonus";
const FIRE = "system.tracos.resistencias.fogo.bonus";
const COLD = "system.tracos.resistencias.frio.bonus";
const ELECTRICITY = "system.tracos.resistencias.eletricidade.bonus";
const STEALTH = "system.pericias.furt.bonus";
const ARMOR_TIPOS = new Set(["leve", "pesada", "escudo"]);
const ARMOR_SHIELD = ["armor", "shield"];

/** Change as stored by the compendium (phase "initial", no priority). */
const add = (key, value) => ({ key, type: "add", value, phase: "initial", priority: null });
const passive = { onuse: false, abilityUse: { automatic: false, aumenta: false, types: [] } };
const byArmor = (key, lightOrShield, heavy) => ({ tipo }) =>
  ARMOR_TIPOS.has(tipo) ? [add(key, tipo === "pesada" ? heavy : lightOrShield)] : null;
const invulnerable = ({ tipo }) => (ARMOR_TIPOS.has(tipo) ? [add(DR, tipo === "escudo" ? 2 : 5)] : null);

/**
 * FNV-1a (32 bits) of a string, used to recognize the exact compendium description without embedding it.
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Known defects, by id in "tormenta20.efeitos" (kept by "world.item-upgrades").
 * `defect`: every relevant field of the exact source data. `transfer`: corrected transfer. `changes(context)`:
 * corrected changes (null keeps the source changes; a function returning null leaves the effect untouched).
 * `item`: book rules for the upgraded item itself (see correctItem). `itemOnly`: the effect itself is left as is.
 */
export const UPGRADE_FIXES = {
  "87bEYYpPzWdzX3zT": {
    defect: { name: "Guardião", description: ["ea00da39", 150], transfer: false, ...passive,
      identifier: "guardian", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 2)] },
    transfer: true
  },
  "S4FlovY4Qj03y6KB": {
    defect: { name: "Protetor", description: ["fab5c054", 74], transfer: false, ...passive,
      identifier: "protector", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(SAVES, 2)] },
    transfer: true
  },
  "n39Gxf7O7DPC0R5V": {
    defect: { name: "Relampejante", description: ["b8f1ef9d", 323], transfer: false, ...passive,
      identifier: "lightning", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(ELECTRICITY, 10)] },
    transfer: true
  },
  "nG4DzcxM7auuQKxw": {
    defect: { name: "Sombrio", description: ["7d893b42", 207], transfer: false, ...passive,
      identifier: "shadow", upgrade: ["enchantment", ARMOR_SHIELD],
      changes: [add(STEALTH, 5), add(STEALTH, "@item.pda")] },
    transfer: true,
    // "@item.pda" cannot be resolved by the actor (the core drops it with a warning); the +5 is kept.
    changes: ({ source }) => [source[0]]
  },
  "K9RtA8a5aPdqyRUR": {
    defect: { name: "Mitral", description: ["eba917f1", 348], transfer: false, ...passive,
      identifier: "mithril", upgrade: ["material", ARMOR_SHIELD], changes: [add(PENALTY, -2)] },
    transfer: true,
    requiresPenaltyFix: true,
    item: { heavyAbility: 2, slots: -1 }
  },
  "7apVrQDXAOmTvcQW": {
    defect: { name: "Mitral", description: ["0ee4d3fc", 294], transfer: false, onuse: true,
      abilityUse: { automatic: true, aumenta: false, types: ["self"] },
      identifier: "mithril", upgrade: ["material", ["weapon"]], changes: [add("criticoM", -1)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "QL2A7Lhlh9tVDqcB": {
    defect: { name: "Mitral", description: ["469d0f56", 276], transfer: false, onuse: true,
      abilityUse: { automatic: false, aumenta: false, types: ["spell"] },
      identifier: "mithril", upgrade: ["material", ["esoteric"]], changes: [add("cd", 2)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "0oBNqjSt3Ax3aO3a": {
    defect: { name: "Delicada", description: ["71bf297b", 399], transfer: true, ...passive,
      identifier: "delicate", upgrade: ["improvement", ["armor"]], changes: [add(DEFENSE, 1)] },
    // The flat +1 Defense becomes "apply up to 1 point of the Defense attribute" (correctItem).
    changes: () => [],
    item: { heavyAbility: 1 }
  },
  "SXtfjuLdQwXZUU1t": {
    defect: { name: "Discreto", description: ["f6b617ae", 301], transfer: false, onuse: true,
      abilityUse: { automatic: false, aumenta: false, types: ["skill"] }, identifier: "discreet",
      upgrade: ["improvement", ["weapon", "armor", "shield", "esoteric", "tool", "clothing", "accessory"]],
      changes: [add("roll", 5)] },
    itemOnly: true,
    item: { slots: -1 }
  },
  "UWWimfZsadIwa18F": {
    defect: { name: "Incandescente", description: ["4772333e", 339], transfer: false, ...passive,
      identifier: "incandescent", upgrade: ["enchantment", ARMOR_SHIELD], changes: [] },
    transfer: true,
    changes: () => [add(FIRE, 10)]
  },
  "RKOYBmM5NVeVkAC5": {
    defect: { name: "Gelo Eterno", description: ["440ec913", 268], transfer: false, onuse: true,
      abilityUse: { automatic: true, aumenta: false, types: ["self"] },
      identifier: "everlasting-ice", upgrade: ["material", ["weapon"]], changes: [add("daon", "2[frio]")] },
    // The system appends the weapon damage type to non-dice values (T20 applyRollChanges), so "2[frio]" would roll as "2[frio][corte]".
    changes: ({ source }) => [{ ...source[0], key: "dano", value: "2" }]
  },
  "tdrbB9k7sDcQbhPr": {
    defect: { name: "Gelo Eterno", description: ["089226ba", 318], transfer: true, ...passive,
      identifier: "everlasting-ice", upgrade: ["material", ARMOR_SHIELD], changes: [add(COLD, 5), add(COLD, 10)] },
    changes: byArmor(FIRE, 5, 10)
  },
  "LdQuKLoY9UexlLFJ": {
    defect: { name: "Adamante", description: ["bd3ef4f2", 291], transfer: true, ...passive,
      identifier: "adamant", upgrade: ["material", ARMOR_SHIELD], changes: [add(DR, 2), add(DR, 5)] },
    changes: byArmor(DR, 2, 5)
  },
  "9qtyaxELLc4xqkMk": {
    defect: { name: "Invulnerável (Armadura)", description: ["28fe07b6", 101], transfer: true, ...passive,
      identifier: "invulnerable", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 5)] },
    changes: invulnerable
  },
  "hlCxCLAj9zaurVbw": {
    defect: { name: "Invulnerável (Escudo)", description: ["28fe07b6", 101], transfer: true, ...passive,
      identifier: "invulnerable", upgrade: ["enchantment", ARMOR_SHIELD], changes: [add(DEFENSE, 2)] },
    changes: invulnerable
  }
};

/** Manto da Resistência as shipped by "tormenta20.equipamentos-magicos" in 1.6.5. */
export const CLOAK = {
  pack: "tormenta20.equipamentos-magicos",
  itemId: "zPxlM4MNoKihGsDn",
  effectId: "p3l6lvXx7HMjVtS0",
  source: "Compendium.tormenta20.equipamentos-magicos.Item.zPxlM4MNoKihGsDn",
  name: "Manto da Resistência",
  description: ["4df0d1d4", 132],
  stats: { createdTime: 1788042454304, modifiedTime: 1788042454304, lastModifiedBy: "4fJviA1Q4qcjwsna" },
  effect: {
    name: "Manto da Resistência", description: ["811c9dc5", 0], transfer: true, disabled: true, ...passive,
    stats: { createdTime: 1788042454305, modifiedTime: 1788042454305, lastModifiedBy: "4fJviA1Q4qcjwsna" },
    changes: [add(SAVES, 2)]
  }
};
