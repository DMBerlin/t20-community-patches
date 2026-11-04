/**
 * Prolonged care (Cuidados Prolongados) during rest.
 *
 * Bug (tormenta20 1.6.5): ActorT20#descanso multiplies the whole HP recovery by 2 when "Cuidados Prolongados" is
 * checked (`cp = curaCP ? 2 : 1`). The rule (Cura, p. 117) adds +1 HP per level. Both only match on a Normal rest
 * without extra HP.
 *
 * Fix: when curaCP is set, the original method runs with curaCP off and one more extra HP per level, so the system
 * computes floor(level × (condition + extra HP)) + level. MP, chat cards and the other options stay the same.
 */
import { install, isNeeded } from "./integration.mjs";

export default {
  id: "rest-recovery",
  group: "actor",
  issue: 31,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  probeKind: "behavior",
  sources: ["ActorT20#descanso"],
  isNeeded,
  install
};
