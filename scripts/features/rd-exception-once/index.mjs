/**
 * Damage reduction with exception, applied once per attack (tormenta20 1.6.5).
 *
 * Bug: ActorT20#applyDamageV2 adds the exception RD (`resistencias.<tipo>.excecao`, "RD 10/luz") to every
 * non-excepted damage type of the roll (`rdsEx`, T20:6246-6248), so an attack with several damage types is reduced
 * several times, and penetration (`roll.options.rd`, e.g. Penetrante) never reduces it.
 *
 * Fix: when the target has an exception RD, the reductions are resolved here and handed to the system through its
 * prepared data, only during the synchronous part of applyDamageV2: the exception RD that is actually absorbed
 * (never more than the non-excepted damage) is added to the general RD, which the system subtracts once from the
 * total. Penetration is spent as the system spends it (general RD, then each type in term order), and what is left
 * reduces the exception RD. The prepared data is restored right after the call; nothing is persisted. The wrapper
 * only acts on the verified applyDamageV2 source (tormenta20 1.6.5).
 */
import { APPLY_DAMAGE, install, isNeeded } from "./integration.mjs";

export default {
  id: "rd-exception-once",
  group: "combat",
  issue: 64,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  sources: [APPLY_DAMAGE],
  isNeeded,
  install
};
