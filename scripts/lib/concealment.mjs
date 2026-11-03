/** Concealment checks recorded on attack rolls (concealment-miss-chance, #65), also read by combat-maneuvers. */
import { MODULE_ID } from "./module.mjs";

export const CONCEALMENT_SETTING = "concealmentMissChance";

export const DATA_KEY = "concealment";

export const DATA_VERSION = 1;

/** The checks recorded in an attack roll by this rule (annotate), or [] when there are none. */
export function concealmentChecksOf(roll) {
  const data = roll?.options?.[MODULE_ID]?.[DATA_KEY];
  return data?.v === DATA_VERSION && Array.isArray(data.checks) ? data.checks : [];
}
