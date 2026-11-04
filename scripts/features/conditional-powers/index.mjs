/**
 * Conditional powers (tormenta20 1.6.5).
 *
 * Bug: combat powers whose bonus depends on the equipment in use (Estilo de Duas Mãos, Estilo de Uma Arma, Estilo
 * de Arma e Escudo, Encouraçado and the Encouraçado increments of Fanático and Inexpugnável) ship as passive
 * transferred effects with no condition. The system only suppresses an item's effects when the item itself is an
 * unequipped weapon/equipment, so a power's bonus is always applied. Fanático also never removes the -3m of heavy
 * armor ("ignora-armadura" is missing).
 *
 * Fix: those passive effects are suppressed while the actor's equipment proves the condition is not met, using the
 * system's own notion of equipped items. An actor that owns Fanático gets "ignora-armadura" in its movement tags.
 */
import { SOURCES, install, isNeeded } from "./integration.mjs";

export default {
  id: "conditional-powers",
  group: "sheet-effects",
  issue: 33,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  sources: [...SOURCES, "BaseEffect#isSuppressedByEquipment", "ItemT20#areEffectsSuppressed", "AttributesFields.prepareDefense", "AttributesFields.prepareMovement"],
  guarded: true,
  isNeeded,
  install
};
