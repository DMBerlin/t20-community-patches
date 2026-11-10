/**
 * Bug: creature types diverge from the core rulebook (Tormenta20 JdA, pp. 297-310):
 *  - tormenta20.ameacas: 7 undead and 4 monsters are stored as Humanoide;
 *  - StatblockParser#parseData matches type, size and role words exactly against the localized labels, so the book
 *    spelling "Morto-vivo" (label "Morto-Vivo") and every Portuguese word under another UI language become the
 *    creature subtype and the type stays Humanoide.
 * Fix: correct the world copy of the 11 threats in ActorT20#_preCreate, only when it comes from the known entry and
 * still holds the exact 1.6.5 type data; after the original parseData, fix each field the original failed to read.
 */
import { PATCH_ID } from "./domain/index.mjs";
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: PATCH_ID,
  group: "actor",
  issue: 47,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["StatblockParser#parseData", "StatblockParser#_parseStatblock"],
  isNeeded,
  lateProbe,
  install
};
