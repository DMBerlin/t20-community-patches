/**
 * Effect lines of the sheet breakdowns (tormenta20 1.6.5).
 *
 * Bug: ActorT20#modifiedFields (T20:6952-6962), the list of effect changes the sheet breakdowns (`fieldBonuses`) show
 * per field, skips changes whose *value* is 3 or 4. The test was meant for the old Downgrade (3) and Upgrade (4)
 * modes; in Foundry 14 the mode is the change `type` ("downgrade", "upgrade"). So an effect that adds the number 3
 * or 4 (for example Defesa +3) disappears from the breakdown, whose total no longer matches the sheet, while
 * downgrade/upgrade changes are listed as if they were additions.
 *
 * Fix: the getter skips changes of type downgrade or upgrade, whatever their value, and keeps everything else in
 * the same order and shape ({label, value, type}).
 */
import { markWrapper, unwrap } from "../utils.mjs";

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
 * @returns {import("../registry.mjs").Diagnosis}
 */
export function diagnoseFields(fields) {
  if (!fields || typeof fields !== "object" || fields.add2?.length !== 1) {
    return { bug: "unknown", confidence: "low", evidence: "modifiedFields result not recognized" };
  }
  const wrong = [
    !fields.add3?.length && "add 3 hidden",
    !fields.add4?.length && "add 4 hidden",
    !!fields.down?.length && "downgrade listed",
    !!fields.up?.length && "upgrade listed"
  ].filter(Boolean);
  if (wrong.length) return { bug: "present", confidence: "high", evidence: wrong.join(", ") };
  return { bug: "fixed", confidence: "high", evidence: "add 3 and 4 listed, downgrade and upgrade skipped" };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function getterOwner() {
  let proto = CONFIG.Actor.documentClass?.prototype;
  while (proto && !Object.getOwnPropertyDescriptor(proto, "modifiedFields")?.get) proto = Object.getPrototypeOf(proto);
  return proto ?? null;
}

function apply() {
  const owner = getterOwner();
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, "modifiedFields");
  if (typeof descriptor?.get !== "function") throw new Error("ActorT20#modifiedFields not found");
  Object.defineProperty(owner, "modifiedFields", {
    ...descriptor,
    get: markWrapper(function () {
      return collectModifiedFields(this.appliedEffects);
    }, descriptor.get)
  });
}

function isNeeded() {
  const owner = getterOwner();
  const get = unwrap(owner && Object.getOwnPropertyDescriptor(owner, "modifiedFields")?.get);
  if (typeof get !== "function") return { bug: "unknown", confidence: "low", evidence: "modifiedFields not found" };
  try {
    return diagnoseFields(get.call({ appliedEffects: PROBE_EFFECTS }));
  } catch (err) {
    return { bug: "unknown", confidence: "low", evidence: `modifiedFields probe failed: ${err.message}` };
  }
}

export default {
  id: "modified-fields-filter",
  group: "sheet-effects",
  issue: 39,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  apply
};
