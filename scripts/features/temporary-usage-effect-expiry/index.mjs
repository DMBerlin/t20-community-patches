/**
 * Temporary usage effects never expire (tormenta20 1.6.5).
 *
 * Bug: temporary usage effects (system.onuse) on actors - e.g. buffs applied from a chat card - are never
 * registered in ActiveEffect.registry, because ActiveEffectT20#active excludes usage effects and core v14
 * only tracks active effects (isExpiryTrackable). They never expire, not even on "Encerrar Cena".
 *
 * Fix: isExpiryTrackable also accepts enabled, non-suppressed temporary usage effects embedded in actors.
 * `active` is not changed (usage effects are applied at roll time, not by core change application).
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "temporary-usage-effect-expiry",
  group: "usage-effects",
  issue: 6,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["ActiveEffectT20#active", "ActiveEffectT20#isUsage", "ActiveEffectT20#isExpiryTrackable"],
  isNeeded,
  install
};
