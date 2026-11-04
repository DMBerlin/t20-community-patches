export const SKIPPED_TYPES = new Set(["downgrade", "upgrade"]);

/**
 * Same result as the system's getter, filtering by change type instead of value.
 * @param {Iterable<{modifiesActor?: boolean, name?: string, changes?: Iterable<object>}>} effects  appliedEffects
 * @returns {Record<string, {label: string, value: unknown, type: string}[]>}
 */
export function collectModifiedFields(effects) {
  const acc = {};
  for (const ef of effects ?? []) {
    if (!ef?.modifiesActor) continue;
    for (const ch of ef.changes ?? []) {
      if (SKIPPED_TYPES.has(ch?.type)) continue;
      (acc[ch.key] ??= []).push({ label: ef.name, value: ch.value, type: ch.type });
    }
  }
  return acc;
}

/** Probe effect: additions of the numbers 3 and 4 (the bug hides them), a downgrade and an upgrade (the bug lists them). */
export const PROBE_EFFECTS = [
  {
    modifiesActor: true,
    name: "probe",
    changes: [
      { key: "add3", value: 3, type: "add" },
      { key: "add4", value: 4, type: "add" },
      { key: "add2", value: "2", type: "add" },
      { key: "down", value: -5, type: "downgrade" },
      { key: "up", value: 2, type: "upgrade" }
    ]
  }
];

/**
 * Interprets the system's original getter on PROBE_EFFECTS. Fixed only when every probe change is handled.
 * @param {Record<string, unknown[]>|undefined} fields
 * @returns {import("../../registry.mjs").Diagnosis}
 */
export function diagnoseFields(fields) {
  if (!fields || typeof fields !== "object" || fields.add2?.length !== 1) {
    return { bug: "unknown", confidence: "low", evidence: "modifiedFields result not recognized" };
  }
  const listed = (key) => Boolean(fields[key]?.length);
  const wrong = [
    !listed("add3") && "add 3 hidden",
    !listed("add4") && "add 4 hidden",
    listed("down") && "downgrade listed",
    listed("up") && "upgrade listed"
  ].filter(Boolean);
  if (wrong.length) return { bug: "present", confidence: "high", evidence: wrong.join(", ") };
  return { bug: "fixed", confidence: "high", evidence: "add 3 and 4 listed, downgrade and upgrade skipped" };
}
