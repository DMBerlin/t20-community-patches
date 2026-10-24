/**
 * Skill training helpers shared by the optional rules (#62 trained-only skills, #46 arcane armor).
 *
 * A skill is "trained only" when the system's config marks it (CONFIG.T20.pericias[key].trainedOnly) or the actor
 * marks it with `st` (custom crafts). Two usage effects of tormenta20.poderes lift the requirement for one test:
 * Eclético (Bard, p. 45: the benefits of being trained) and Cultura Exótica (Forasteiro, p. 90: only ignores the
 * requirement). They are recognized by the exact shape of their changes, never by name.
 *
 * Everything here is pure, except skillUseEffects, which reads the actor's embedded documents.
 */
import { MODULE_ID } from "../utils.mjs";
import { APPLY_STATES } from "../registry.mjs";
import { pseudoItemEffects } from "./usage-effect-max.mjs";
import { isSuppressedUsageEffect } from "../patches/suppressed-usage-effects.mjs";

/** CONFIG first: the compendium menaces store st=false for every skill (migration_1_5_012 only fixed characters). */
export function isTrainedOnlySkill(key, skill, config = {}) {
  return config?.[key]?.trainedOnly === true || skill?.st === true;
}

/**
 * Normalizes a usage effect (an ActiveEffect from traverseEmbeddedDocuments or item.applicableOnUseEffects) to the
 * plain shape the pure helpers and mana-limit's automaticApplied read.
 * @returns {{id: string, name: string, automatic: boolean, custo: number, changes: object[]}}
 */
export function plainUseEffect(ef) {
  return {
    id: ef?.id,
    name: ef?.name,
    automatic: !!ef?.system?.abilityUse?.automatic,
    custo: Number(ef?.system?.abilityUse?.custo) || 0,
    changes: ef?.system?.changes ?? []
  };
}

/**
 * Exact shapes proven in tormenta20.poderes (no other effect in the packs touches treino/treinado):
 *   Cultura Exótica: {key: "treinado", type: "override", value: true}  -> "ignore" (only lifts the requirement, p. 90)
 *   Eclético:        {key: "roll", type: "add", value: "@treino"}       -> "bonus"  (benefits of being trained, p. 45)
 * @returns {"ignore"|"bonus"|null}
 */
export function trainingGrantKind(changes = []) {
  for (const ch of changes ?? []) {
    if (ch?.key === "treinado" && ch.type === "override" && (ch.value === true || String(ch.value).trim().toLowerCase() === "true")) {
      return "ignore";
    }
    if (ch?.key === "roll" && ch.type === "add" && /^\+?\s*@treino$/.test(String(ch.value ?? "").trim())) return "bonus";
  }
  return null;
}

/** @param {ReturnType<typeof plainUseEffect>[]} effects */
export function trainingGrants(effects = []) {
  return effects
    .map((ef) => ({ ...ef, kind: trainingGrantKind(ef.changes) }))
    .filter((ef) => ef.kind)
    .map(({ id, name, automatic, custo, kind }) => ({ id, name, automatic, custo, kind }));
}

/** Same truthiness as applyOnUseEffects (T20:6383: applied[ef.id]?.aplica). Returns the first applied grant. */
export function appliedGrant(grants = [], applied = {}) {
  return grants.find((g) => !!applied?.[g.id]?.aplica) ?? null;
}

/**
 * Single answer to "can this skill be used for this test?".
 * @param {{key: string, skill: object, config?: object, grants?: object[], applied?: object}} input
 * @returns {{required: boolean, trained: boolean, grant: object|null}}
 *   trained = !required || skill.treinado || an applied grant; grant = the applied grant that made it pass, or null.
 */
export function isTrainedFor({ key, skill, config = {}, grants = [], applied = {} }) {
  const required = isTrainedOnlySkill(key, skill, config);
  if (!required) return { required, trained: true, grant: null };
  if (skill?.treinado) return { required, trained: true, grant: null };
  const grant = appliedGrant(grants, applied);
  return { required, trained: !!grant, grant };
}

/** Whether suppressed-usage-effects (#4) is applied on this load. */
function suppressionPatchApplied() {
  const status = globalThis.game?.modules?.get?.(MODULE_ID)?.api?.status;
  const entry = Array.isArray(status) ? status.find((s) => s.id === "suppressed-usage-effects") : null;
  return Boolean(entry && APPLY_STATES.has(entry.state));
}

/**
 * The usage effects ActorT20#rollPericia collects for a skill (T20:7607-7616), as the ActiveEffect documents.
 * suppressed-usage-effects only filters inside the system's own call, so its filter is applied here explicitly.
 * @param {object} actor
 * @param {string} key
 * @returns {object[]}
 */
export function skillUseEffects(actor, key) {
  const skill = actor?.system?.pericias?.[key];
  if (!skill || typeof actor.traverseEmbeddedDocuments !== "function") return [];
  const effects = pseudoItemEffects(actor.traverseEmbeddedDocuments(), { type: "skill", name: skill.label });
  return suppressionPatchApplied() ? effects.filter((ef) => !isSuppressedUsageEffect(ef, null)) : effects;
}
