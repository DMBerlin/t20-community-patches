/**
 * The mana queue as an entry of FEATURES (#87): the queue itself is the mana-queue service
 * (scripts/services/mana-queue.mjs). Declaring it here installs it in this position, before the rules that spend PM,
 * so it stays the innermost wrapper of spendMana and keeps its line in api.status.
 */

/** @type {import("../kernel/feature.mjs").Feature} */
export default {
  id: "mana-queue",
  kind: "rule",
  group: "usage-effects",
  system: { id: "tormenta20" },
  services: ["mana-queue"],
  install: () => {}
};
