/**
 * Breakdown of the attribute values on the actor sheet (tormenta20 1.6.5).
 *
 * Bug: every other value of the sheet (PV, PM, Defesa, perícias) shows its composition on hover, through the
 * `fieldBonuses` helper. The attributes do not: in templates/actor/parts/abilities.hbs the tooltip is wrapped in
 * `{{#if wip}}`, a flag the system never defines, and sits in the content of the `<span>` instead of being an attribute
 * of it. The helper's `atributos` branch (T20:3094-3103) would not help either: it shows a single "Bônus Temporário"
 * with the prepared bonus (manual bonus and every effect summed, no source named) and lists effects on `.value`.
 *
 * Fix: while the actor is prepared, every change the core actually applies to `system.atributos.<key>.(value|bonus)`
 * is recorded in memory with its value before and after (Actor#applyActiveEffects and ActiveEffect.applyChangeField),
 * together with the phase and a snapshot of base, racial and manual bonus taken before the "initial" phase. So the
 * breakdown shows what each effect really added: after `@` references were resolved with the data of that moment,
 * after the field was cleaned (minimum −5), in the core's order and phases, and without the changes the core skipped
 * (auras that do not target the bearer, stacking rules). When an actor sheet renders, each attribute value without a
 * tooltip gets one: Base, Racial, each effect on the value, the manual temporary bonus, each effect on the bonus
 * (summed into the value by prepareAtributos, between the phases), each final-phase effect on the value, and
 * "Outros" for any difference, so the total is always the sheet's value. Nothing is persisted. When the system ships
 * its own tooltip, the element already has one and is left alone.
 */
import { install, isNeeded, lateProbe } from "./integration.mjs";

export default {
  id: "attribute-breakdown",
  group: "sheet-effects",
  issue: 72,
  guarded: true,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["#helper:fieldBonuses", "CreatureData#prepareAtributos"],
  isNeeded,
  lateProbe,
  install
};
