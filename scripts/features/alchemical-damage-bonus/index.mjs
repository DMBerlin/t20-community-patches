/**
 * Alchemical damage bonus (tormenta20 1.6.5).
 *
 * Bug: ItemT20#rollDamage (T20:7936-8019) adds "@danoALQ" to the damage of an alchemical item only when the actor
 * has a spell damage bonus (`modificadores.dano.mag`), instead of an alchemical damage bonus
 * (`modificadores.dano.alq`). The value of @danoALQ comes from `modificadores.dano.alq` (T20:5994), so an
 * "alq" bonus alone is never rolled. The healing branch checks `cura.alq` correctly (T20:7992).
 *
 * Fix: while the system rolls the damage of an alchemical item whose actor has "alq" bonuses and no "mag" bonus,
 * each plain damage roll receives the "@danoALQ" part the system would have added. The part is removed afterwards.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "alchemical-damage-bonus",
  group: "items",
  issue: 69,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.7" } },
  probeKind: "behavior",
  sources: ["ItemT20#rollDamage", "ActorT20#getRollData"],
  isNeeded,
  install
};
