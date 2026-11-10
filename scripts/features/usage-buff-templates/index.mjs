/**
 * Usage buff templates (tormenta20 1.6.5).
 *
 * Bug: spells, powers, items and partners model the buff they grant (Arma Mágica, Óleo de Arma Mágica, Duelo…) as a
 * temporary usage effect stored disabled in the item. applyOnUseEffects only sends enabled effects to the chat card
 * (a disabled one only goes when an "efeito" change names it, and none does), the weapon choice (`?.items.arma`)
 * never opens in v14, the applied buff is never automatic, and `system.*` changes of a usage effect never reach the
 * prepared data.
 *
 * Fix: on the rolled item's clone only, each eligible template is enabled in memory: attack buffs become automatic,
 * buffs made only of `system.*` changes become plain temporary effects, several templates of one item are labeled by
 * their description, and an official all-zero placeholder with the same name is hidden. A weapon buff asks for the
 * weapon when it is applied (a single wielded weapon is chosen silently) and is offered only on that weapon.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "usage-buff-templates",
  group: "usage-effects",
  issue: 66,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: [
    "#local:applyOnUseEffects",
    "ActorT20#_onCreateDescendantDocuments",
    "ItemT20#_allApplicableOnUseEffects",
    "ActiveEffectT20#active",
    "ActiveEffectT20#isUsage"
  ],
  isNeeded,
  lateProbe,
  install
};
