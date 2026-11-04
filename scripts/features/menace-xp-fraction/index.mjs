/**
 * Threat XP for fractional challenge ratings (ND 1/4, 1/2).
 *
 * Bug (tormenta20 1.6.5): MenaceData#prepareBaseData turns the ND into the creature level with
 * `Number(nd) || 1`, so "1/4" and "1/2" become level 1, and then computes the XP from that level instead of
 * the ND. Every ND 1/4 or 1/2 threat shows 1000 XP on its sheet. The book gives ND × 1000: 250 and 500.
 *
 * Fix: after the system's prepareBaseData, ND "1/4" and "1/2" (the only fractional NDs in the books and in the
 * system's ND table) get 250 and 500 XP. The creature level (1, the book minimum) and everything derived from
 * it stay as the system computes them. Any other ND is untouched.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "menace-xp-fraction",
  group: "actor",
  issue: 36,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["MenaceData#prepareBaseData"],
  guarded: true,
  isNeeded,
  install
};
