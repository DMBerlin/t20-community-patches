import { CONDI_KEY, OUTROS_KEY, isArrayKey } from "../../../lib/applied-breakdown.mjs";

export const MANUAL_KEYS = {
  nivel: "T20CP.FieldBonuses.ManualPerLevel",
  nivelPar: "T20CP.FieldBonuses.ManualEven",
  nivelImpar: "T20CP.FieldBonuses.ManualOdd",
  total: "T20CP.FieldBonuses.ManualTotal"
};
export const HEAVY_ARMOR_KEY = "T20CP.FieldBonuses.HeavyArmorLimit";
export const MANUAL_OTHER_KEY = "T20CP.FieldBonuses.ManualOther";
export const NOT_STACKING_KEY = "T20CP.FieldBonuses.NotStacking";
export const MINIMUM_PV_KEY = "T20CP.FieldBonuses.MinimumPV";
export const ROUNDING_KEY = "T20CP.FieldBonuses.Rounding";
export const UNIDENTIFIED_KEY = "T20CP.FieldBonuses.Unidentified";
/** Text of a muted line, by reason. */
export const REASON_KEYS = {
  "not-stacking": NOT_STACKING_KEY,
  folded: "T20CP.FieldBonuses.Folded",
  "not-counted": "T20CP.FieldBonuses.NotCounted"
};
export { OUTROS_KEY, CONDI_KEY, isArrayKey };
/** Default priorities of Foundry 14 change types (common/constants.mjs). */
export const DEFAULT_PRIORITY = { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 };
/** Wildcard keys ActorT20._prepareProxyChange expands (T20:17036-17044); other wildcards are not applied at all. */
export const PROXY_KEYS = [
  "system.atributos.*.value",
  "system.atributos.*.bonus",
  "system.pericias.*.bonus",
  "system.pericias.*.condi",
  "system.attributes.movement.*.value",
  "system.attributes.movement.*.base",
  "system.attributes.movement.*.bonus"
];
const PHASES = ["initial", "final"];
export const TOTAL = /(<label>Total:<\/label><span>)([+-]?\d+(?:\.\d+)?)(<\/span>)/;
export const EPSILON = 1e-9;
export const signed = (n) => (n >= 0 ? `+${n}` : String(n));
export const tidy = (n) => Math.round(n * 1e9) / 1e9;
export const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const phaseIndex = (phase) => (PHASES.includes(phase ?? "initial") ? PHASES.indexOf(phase ?? "initial") : PHASES.length);
