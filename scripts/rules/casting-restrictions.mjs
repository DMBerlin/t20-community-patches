/**
 * Optional rules "Restrições ao lançar magias" (#37). Each one has its own world setting, off by default.
 *
 * - One sustained spell at a time (Tormenta20 JdA, p. 227), two with Fluxo de Mana (p. 38): warns when casting and when
 *   applying. Card effects are stamped with the cast; cast order comes from the server-managed creation time of the
 *   card messages. Nothing is ended or refused.
 * - Conditions that prevent casting (p. 394-395, p. 170; reactions follow p. 233): checked before the use dialog.
 * - Concentration in a bad condition (p. 170): casting while Caído or Surdo posts the Vontade DC (15 + PM spent).
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { castCompleted, isCastUse } from "./cast-outcome.mjs";
import { installUseDialogGuard, registerUseValidator } from "./use-dialog-guard.mjs";

export const SUSTAINED_SPELL_SETTING = "sustainedSpellRule";
export const SUSTAINED_SPELL_MODES = ["off", "warn"];
export const CASTING_CONDITION_SETTING = "castingConditionRule";
export const CASTING_CONDITION_MODES = ["off", "warn", "block"];
export const CONCENTRATION_SETTING = "concentrationRule";
export const CONCENTRATION_MODES = ["off", "warn"];

export const SUSTAIN_EXPIRY = "sustainEnd";
export const SUSTAIN_STATUS = "sustentando";
export const CAST_FLAG = "sustainedCast";
export const MANA_FLOW_SOURCE = "Compendium.tormenta20.poderes.Item.TXja4zA1sQRnE65j";
export const MANA_FLOW_NAME = "Fluxo de Mana";
export const WARNING_WINDOW_MS = 3000;
export const MAX_TRACKED_ENTRIES = 100;

/** No actions, reactions included (Inconsciente; Petrificado makes the character Inconsciente). */
export const NO_REACTION_STATUSES = ["inconsciente", "petrificado"];
/** No actions; reactions are still allowed (p. 233: "você pode reagir mesmo se não puder realizar ações"). */
export const NO_ACTION_STATUSES = ["atordoado", "pasmo", "surpreendido", "fascinado"];
/** Only purely mental actions: casting needs gestures and words, unless Magia Discreta. */
export const MENTAL_ONLY_STATUSES = ["paralisado"];
/** Bad conditions for casting: Caído (example on p. 170) and Surdo (p. 395). */
export const BAD_CONDITION_STATUSES = ["caido", "surdo"];
export const BAD_CONDITION_BASE_DC = 15;
export const SUBTLE_SPELL_SOURCE = "Compendium.tormenta20.poderes.Item.a7FEhf1T8KVwr0iA";
export const SUBTLE_SPELL_NAME = "Magia Discreta";

/** @param {{type?: string}} item */
export function isSpell(item) {
  return item?.type === "magia";
}

/** Spells and scrolls: using a scroll casts its spell. */
export function isSpellCast(item) {
  return isSpell(item) || (item?.type === "consumivel" && item.system?.tipo === "scroll");
}

export function isSustainedSpell(item) {
  return isSpell(item) && item.system?.duracao?.units === "sust";
}

/** How many sustained spells a caster keeps at once: one, two with Fluxo de Mana. */
export function sustainedSpellCapacity({ manaFlow = false } = {}) {
  return manaFlow ? 2 : 1;
}

/**
 * Splits a sustained origin (`<caster uuid>.ActiveEffect.<marker id>`, T20:6634-6637).
 * @returns {{casterUuid: string, markerId: string}|null}
 */
export function parseSustainOrigin(origin) {
  if (typeof origin !== "string") return null;
  const [casterUuid, markerId, ...rest] = origin.split(".ActiveEffect.");
  if (!casterUuid || !markerId || rest.length) return null;
  return { casterUuid, markerId };
}

/** @returns {{castId: string, casterUuid: string, spell: string}|null} */
export function readCast(value) {
  if (!value || typeof value !== "object") return null;
  const { castId, casterUuid, spell } = value;
  if (typeof castId !== "string" || !castId || typeof casterUuid !== "string" || !casterUuid) return null;
  return { castId, casterUuid, spell: typeof spell === "string" ? spell : "" };
}

/**
 * Stamps every sustained effect of one chat card with the cast. Replaces `flags` with a new object.
 * @param {unknown} entries  `options.effects`: one `[effect, ...children]` array per card button.
 * @returns {number} How many effects were stamped.
 */
export function stampSustainedCast(entries, cast) {
  const valid = readCast(cast);
  if (!valid) return 0;
  let count = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const effect of Array.isArray(entry) ? entry : []) {
      if (effect?.duration?.expiry !== SUSTAIN_EXPIRY || !parseSustainOrigin(effect.origin)) continue;
      const flags = effect.flags && typeof effect.flags === "object" ? effect.flags : {};
      effect.flags = { ...flags, [MODULE_ID]: { ...flags[MODULE_ID], [CAST_FLAG]: { ...valid } } };
      count++;
    }
  }
  return count;
}

/** The cast stamped in a chat card, with the server-managed creation time of the message. */
export function castFromMessage(message) {
  const groups = message?.flags?.tormenta20?.effects;
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    for (const effect of Array.isArray(group) ? group : []) {
      const cast = readCast(effect?.flags?.[MODULE_ID]?.[CAST_FLAG]);
      if (cast) return { ...cast, messageId: String(message.id ?? message._id ?? ""), createdTime: Number(message._stats?.createdTime) || 0 };
    }
  }
  return null;
}

const byPublication = (a, b) => a.createdTime - b.createdTime || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0);

/** One caster's published sustained spell casts, oldest first; a cast posted twice keeps its first message. */
export function castHistory(casts, casterUuid) {
  const first = new Map();
  for (const cast of [...(casts ?? [])].filter((c) => c?.casterUuid === casterUuid).sort(byPublication)) {
    if (!first.has(cast.castId)) first.set(cast.castId, cast);
  }
  return [...first.values()];
}

/** Whether the caster published at least `capacity` sustained spell cards after this cast. */
export function isSupersededCast(castId, history, capacity) {
  const index = (history ?? []).findIndex((c) => c.castId === castId);
  if (index < 0) return false;
  return history.length - index - 1 >= capacity;
}

/** The casts published after one, for the warning text. */
export function castsAfter(castId, history) {
  const index = (history ?? []).findIndex((c) => c.castId === castId);
  return index < 0 ? [] : history.slice(index + 1);
}

/** "Sustentando (Velocidade)" → "Velocidade" (the system appends ` (<effect name>)`, T20:17903). */
export function markerSubject(name) {
  if (typeof name !== "string") return "";
  const start = name.indexOf(" (");
  if (start < 0 || !name.endsWith(")")) return "";
  return name.slice(start + 2, -1).trim();
}

/**
 * Sustained spells a caster keeps.
 * @param {{casterUuid: string, effects: {origin?: string, cast?: unknown}[], markers: {id: string, name?: string}[],
 *   spellNames?: string[]}} params  `effects`: stamped sustained effects found anywhere; `markers`: the caster's
 *   "Sustentando" markers.
 * @returns {{casts: {castId: string, spell: string, markerIds: string[]}[], uncertain: {id: string, name: string}[]}}
 */
export function activeSustainedCasts({ casterUuid, effects = [], markers = [], spellNames = [] }) {
  const casts = new Map();
  const ownedMarkers = new Set();
  for (const effect of effects) {
    const cast = readCast(effect?.cast);
    const origin = parseSustainOrigin(effect?.origin);
    if (!cast || cast.casterUuid !== casterUuid || origin?.casterUuid !== casterUuid) continue;
    let entry = casts.get(cast.castId);
    if (!entry) casts.set(cast.castId, (entry = { castId: cast.castId, spell: cast.spell, markerIds: [] }));
    if (!entry.markerIds.includes(origin.markerId)) entry.markerIds.push(origin.markerId);
    ownedMarkers.add(origin.markerId);
  }
  const names = spellNames.filter((n) => typeof n === "string" && n);
  const uncertain = [];
  for (const marker of markers) {
    if (!marker?.id || ownedMarkers.has(marker.id)) continue;
    const subject = markerSubject(marker.name);
    if (subject && names.some((n) => subject === n || subject.startsWith(`${n} (`))) uncertain.push({ id: marker.id, name: marker.name });
  }
  return { casts: [...casts.values()], uncertain };
}

/** The other casts when keeping `castId` (or a new cast, when null) would exceed the limit; otherwise null. */
export function exceedsLimit({ casts, uncertain }, capacity, castId = null) {
  const others = casts.filter((c) => c.castId !== castId);
  return others.length + uncertain.length >= capacity ? others : null;
}

/** Drops entries older than `ttl` and keeps at most `max` (a Map iterates oldest first). Entries are times or `{time}`. */
export function pruneTimedMap(map, { now, ttl, max = MAX_TRACKED_ENTRIES }) {
  for (const [key, entry] of map) if (now - (typeof entry === "number" ? entry : entry.time) >= ttl) map.delete(key);
  while (map.size > max) map.delete(map.keys().next().value);
}

/** Notification dedup: true (and recorded) when `key` was not warned in the last `ttl` ms. */
export function shouldWarn(map, key, { now, ttl = WARNING_WINDOW_MS, max = MAX_TRACKED_ENTRIES }) {
  pruneTimedMap(map, { now, ttl, max });
  if (map.has(key)) return false;
  map.set(key, now);
  pruneTimedMap(map, { now, ttl, max });
  return true;
}

/**
 * Snapshots of one cast's application, shared by its targets and child effects. A snapshot is reused only while the
 * world generation is unchanged and for at most `ttl` ms; the creation of the cast's own effect updates it in place.
 */
export function createScanCache({ ttl = WARNING_WINDOW_MS, max = MAX_TRACKED_ENTRIES } = {}) {
  const entries = new Map();
  let generation = 0;
  return {
    get size() {
      return entries.size;
    },
    get(castId, build, now) {
      pruneTimedMap(entries, { now, ttl, max });
      let entry = entries.get(castId);
      if (!entry || entry.generation !== generation) {
        entries.delete(castId);
        entries.set(castId, (entry = { ...build(), time: now, generation }));
        pruneTimedMap(entries, { now, ttl, max });
      }
      return entry;
    },
    invalidate() {
      generation++;
    },
    /** A stamped effect of `castId` was created: other snapshots become stale; this cast's, if current, gets it. */
    noteCreated(castId, effect) {
      const entry = entries.get(castId);
      const current = entry?.generation === generation;
      generation++;
      if (!current) return;
      entry.generation = generation;
      entry.effects?.push(effect);
    }
  };
}

/**
 * Effects of world actors plus the raw delta effects of unlinked tokens. Never reads `token.actor` or `token.delta`,
 * which would materialize lazy deltas (core client/documents/token.mjs:249-253, 284-321).
 */
export function* effectSources({ actors = [], scenes = [] } = {}) {
  for (const actor of actors) yield* actor?.effects ?? [];
  for (const scene of scenes) {
    for (const token of scene?.tokens ?? []) {
      const source = token?._source;
      if (!source || source.actorLink) continue;
      for (const effect of source.delta?.effects ?? []) if (effect && !effect._tombstone) yield effect;
    }
  }
}

/** Stamped sustained effects of one caster, from documents or raw sources. */
export function collectStampedEffects(effects, casterUuid) {
  const found = [];
  for (const effect of effects ?? []) {
    if (effect?.duration?.expiry !== SUSTAIN_EXPIRY) continue;
    const cast = readCast(effect.flags?.[MODULE_ID]?.[CAST_FLAG]);
    if (cast?.casterUuid === casterUuid) found.push({ origin: effect.origin, cast });
  }
  return found;
}

/**
 * Conditions that prevent casting.
 * @param {{statuses: Iterable<string>, activation?: string, subtleSpell?: boolean}} params
 * @returns {{block: string[], warn: string[]}} Status ids that block and that only warn.
 */
export function castingConditionVerdict({ statuses, activation, subtleSpell = false }) {
  const set = new Set(statuses ?? []);
  const block = [];
  const warn = [];
  for (const id of NO_REACTION_STATUSES) if (set.has(id)) block.push(id);
  if (activation !== "reaction") for (const id of NO_ACTION_STATUSES) if (set.has(id)) block.push(id);
  for (const id of MENTAL_ONLY_STATUSES) if (set.has(id)) (subtleSpell ? warn : block).push(id);
  return { block, warn };
}

const normalizeText = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/**
 * Whether an execution value is a reaction: the system key ("reaction") or an enhancement override as written in the
 * compendium ("reação", "reacao"), or the localized label.
 * @param {unknown} value
 * @param {string[]} [labels]
 */
export function isReactionExecution(value, labels = []) {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = normalizeText(value);
  return text === "reaction" || text === "reacao" || labels.some((l) => typeof l === "string" && l.trim() && normalizeText(l) === text);
}

/** The last `execucao` override of a usage effect (the system only applies overrides to it), or undefined. */
export function executionOverride(changes) {
  let value;
  for (const ch of changes ?? []) if (ch?.key === "execucao" && ch.type === "override") value = ch.value;
  return value;
}

/**
 * Whether the use ends up as a reaction, as applyOnUseEffects computes it: applied effects with an override change
 * first (stable), the last `execucao` override wins over the item's base execution.
 * @param {{base?: string, effects?: {id: string, changes?: object[]}[], applied?: Record<string, {aplica?: unknown}>,
 *   labels?: string[]}} params  `applied`: the expanded `aprs` of the dialog, or the automatic ones without it.
 */
export function finalReaction({ base, effects = [], applied = {}, labels = [] }) {
  const hasOverride = (e) => (e.changes ?? []).some((ch) => ch?.type === "override");
  const used = effects.filter((e) => applied?.[e.id]?.aplica);
  const ordered = [...used.filter(hasOverride), ...used.filter((e) => !hasOverride(e))];
  let value = base;
  for (const effect of ordered) {
    const override = executionOverride(effect.changes);
    if (override !== undefined) value = override;
  }
  return isReactionExecution(value, labels);
}

/** Whether the execution depends on the enhancements chosen: some reachable executions are reactions, others not. */
export function executionDependsOnChoice({ base, effects = [], labels = [] }) {
  const outcomes = new Set([isReactionExecution(base, labels)]);
  for (const effect of effects) {
    const override = executionOverride(effect.changes);
    if (override !== undefined) outcomes.add(isReactionExecution(override, labels));
  }
  return outcomes.size > 1;
}

/**
 * The condition check before ItemT20#roll. When the dialog opens and an enhancement can turn the spell into a reaction
 * (or a reaction into an action), only the conditions that stop every execution are checked here; the others are
 * checked when the dialog is submitted (`deferred`). Without the dialog, the automatic enhancements decide.
 * @param {{statuses: Iterable<string>, subtleSpell?: boolean, base?: string, effects?: object[], labels?: string[],
 *   dialog: boolean}} params
 * @returns {{block: string[], warn: string[], deferred: boolean}}
 */
export function preUseConditionVerdict({ statuses, subtleSpell = false, base, effects = [], labels = [], dialog }) {
  if (dialog && executionDependsOnChoice({ base, effects, labels })) {
    return { ...castingConditionVerdict({ statuses, activation: "reaction", subtleSpell }), deferred: true };
  }
  const applied = {};
  for (const effect of effects) if (effect.automatic) applied[effect.id] = { aplica: 1 };
  const reaction = finalReaction({ base, effects, applied, labels });
  return { ...castingConditionVerdict({ statuses, activation: reaction ? "reaction" : "action", subtleSpell }), deferred: false };
}

/**
 * The condition check when the dialog is submitted, only for uses whose execution depends on the enhancements: the
 * no-action conditions that the chosen execution does not allow (the others were reported before the dialog).
 * @returns {string[]} Status ids that stop this use.
 */
export function dialogConditionBlock({ statuses, base, effects = [], applied = {}, labels = [] }) {
  if (!executionDependsOnChoice({ base, effects, labels })) return [];
  if (finalReaction({ base, effects, applied, labels })) return [];
  const set = new Set(statuses ?? []);
  return NO_ACTION_STATUSES.filter((id) => set.has(id));
}

/**
 * Concentration test for a bad condition: Vontade DC 15 + PM spent.
 * @returns {{dc: number, reasons: string[]}|null}
 */
export function concentrationCheck({ statuses, manaCost }) {
  const set = new Set(statuses ?? []);
  const reasons = BAD_CONDITION_STATUSES.filter((id) => set.has(id));
  if (!reasons.length) return null;
  return { dc: BAD_CONDITION_BASE_DC + Math.max(Number(manaCost) || 0, 0), reasons };
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const CAST_PATH = `flags.${MODULE_ID}.${CAST_FLAG}`;
/** `${kind}:${castId}:${text}` → time of the last identical warning on this client. */
const recentWarnings = new Map();
const applicationScans = createScanCache();

function getMode(key, modes) {
  try {
    const mode = game.settings.get(MODULE_ID, key);
    return modes.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

const i18n = (key, data) => game.i18n.format(`T20CP.CastingRestrictions.${key}`, data);
const list = (items) => game.i18n.getListFormatter().format(items);
const sustainedReference = () => game.i18n.localize("T20CP.CastingRestrictions.Sustained.Reference");

function statusName(id) {
  const status = CONFIG.statusEffects?.find?.((s) => s.id === id);
  return status ? game.i18n.localize(status.name) : id;
}

function hasPower(actor, source, name) {
  for (const item of actor?.items ?? []) {
    if (item.type !== "poder") continue;
    const from = item._stats?.compendiumSource ?? foundry.utils.getProperty(item, "flags.core.sourceId");
    if (from === source || item.name === name) return true;
  }
  return false;
}

const capacityOf = (actor) => sustainedSpellCapacity({ manaFlow: hasPower(actor, MANA_FLOW_SOURCE, MANA_FLOW_NAME) });

function scanStampedEffects(casterUuid) {
  return collectStampedEffects(effectSources({ actors: game.actors ?? [], scenes: game.scenes ?? [] }), casterUuid);
}

function activeOf(actor, effects = scanStampedEffects(actor.uuid)) {
  return activeSustainedCasts({
    casterUuid: actor.uuid,
    effects,
    markers: [...(actor.effects ?? [])].filter((e) => e.statuses?.has?.(SUSTAIN_STATUS)).map((e) => ({ id: e.id, name: e.name })),
    spellNames: [...(actor.items ?? [])].filter(isSustainedSpell).map((i) => i.name)
  });
}

function historyOf(casterUuid) {
  return castHistory([...(game.messages ?? [])].map(castFromMessage).filter(Boolean), casterUuid);
}

/** The snapshot of one application; effects are only read when needed. */
function applicationScan(casterUuid, castId) {
  return applicationScans.get(castId, () => ({ history: historyOf(casterUuid), effects: null }), Date.now());
}

function warnOnce(kind, castId, message) {
  if (shouldWarn(recentWarnings, `${kind}:${castId}:${message}`, { now: Date.now() })) ui.notifications.warn(message);
}

const stampOf = (effect) => (effect?.duration?.expiry === SUSTAIN_EXPIRY ? readCast(effect.flags?.[MODULE_ID]?.[CAST_FLAG]) : null);

/** Keeps the application snapshots honest: any change to casts or stamped effects seen by this client. */
function registerInvalidation() {
  const invalidate = () => applicationScans.invalidate();
  for (const hook of ["createChatMessage", "updateChatMessage", "deleteChatMessage", "createActor", "deleteActor", "createToken", "deleteToken", "createScene", "deleteScene", "updateActiveEffect"]) {
    Hooks.on(hook, invalidate);
  }
  Hooks.on("updateToken", (token, changes) => {
    if (changes && ("delta" in changes || "actorLink" in changes)) invalidate();
  });
  Hooks.on("createActiveEffect", (effect) => {
    const cast = stampOf(effect);
    if (cast) applicationScans.noteCreated(cast.castId, { origin: effect.origin, cast });
  });
  // An update may have just removed the stamp or the sustainEnd expiry (the hook sees the updated document), so any
  // update invalidates; a deleted effect still carries its stamp.
  Hooks.on("deleteActiveEffect", (effect) => {
    if (stampOf(effect)) invalidate();
  });
}

/** "sustenta Velocidade e tem marcadores que podem ser de uma magia (conferir na ficha): Sustentando (Oração)". */
function heldText(casts, uncertain) {
  const parts = [];
  if (casts.length) parts.push(i18n("Sustained.Held", { spells: list(casts.map((c) => c.spell)) }));
  if (uncertain.length) parts.push(i18n("Sustained.Uncertain", { markers: list(uncertain.map((u) => u.name)) }));
  return list(parts);
}

const reactionLabels = () => {
  const label = CONFIG.T20?.abilityActivationTypes?.reaction;
  return typeof label === "string" ? [label, game.i18n.localize(label)] : [];
};

function readUseEffects(effects) {
  return [...(effects ?? [])].map((ef) => ({ id: ef.id, automatic: !!ef.system?.abilityUse?.automatic, changes: ef.system?.changes ?? [] }));
}

/**
 * The usage effects the roll will offer, through the current wrapper chain (patches filter or adjust them), read on a
 * prepared clone as ItemT20#roll does, so the wrappers never run on the live item.
 */
function rollUseEffects(item) {
  if (typeof item?.clone !== "function") return [];
  const clone = item.clone({}, { keepId: true });
  if (clone.parent) clone.prepareFinalAttributes?.();
  return typeof clone._allApplicableOnUseEffects === "function" ? readUseEffects(clone._allApplicableOnUseEffects()) : [];
}

/** Whether ItemT20#roll opens the use dialog (T20 "UsageConfig": Shift inverts it). Only asked when there are effects. */
function opensDialog(rollArgs) {
  let usageDefault = true;
  try {
    usageDefault = game.settings.get("tormenta20", "UsageConfig") === "default";
  } catch {}
  const shift = !!rollArgs?.[0]?.event?.shiftKey;
  return usageDefault ? !shift : shift;
}

function conditionsText(actor, item, ids) {
  const reference = game.i18n.localize("T20CP.CastingRestrictions.Conditions.Reference");
  return i18n("Conditions.Warning", { actor: actor.name, item: item.name, conditions: list(ids.map(statusName)), reference });
}

/** Before ItemT20#roll. Returns false to stop the use. */
function beforeRoll(item, rollArgs) {
  const actor = item?.actor;
  if (!actor) return true;

  const conditionMode = getMode(CASTING_CONDITION_SETTING, CASTING_CONDITION_MODES);
  if (conditionMode !== "off" && isSpellCast(item)) {
    const any = castingConditionVerdict({ statuses: actor.statuses, activation: "action" });
    const verdict = any.block.length + any.warn.length === 0 ? { block: [], warn: [] } : preUseConditionVerdict({
      statuses: actor.statuses,
      subtleSpell: hasPower(actor, SUBTLE_SPELL_SOURCE, SUBTLE_SPELL_NAME),
      base: item.system?.ativacao?.execucao,
      effects: rollUseEffects(item),
      labels: reactionLabels(),
      dialog: opensDialog(rollArgs)
    });
    const ids = [...verdict.block, ...verdict.warn];
    if (ids.length) {
      const block = conditionMode === "block" && verdict.block.length > 0;
      const parts = [conditionsText(actor, item, ids)];
      if (verdict.warn.length) parts.push(i18n("Conditions.Subtle", { actor: actor.name }));
      if (block) parts.push(game.i18n.localize("T20CP.CastingRestrictions.Conditions.Blocked"));
      ui.notifications[block ? "error" : "warn"](parts.join(" "));
      if (block) return false;
    }
  }

  if (getMode(SUSTAINED_SPELL_SETTING, SUSTAINED_SPELL_MODES) === "warn" && isSustainedSpell(item)) {
    const capacity = capacityOf(actor);
    const active = activeOf(actor);
    if (exceedsLimit(active, capacity)) {
      ui.notifications.warn(i18n("Sustained.Warning", { actor: actor.name, item: item.name, held: heldText(active.casts, active.uncertain), capacity, reference: sustainedReference() }));
    }
  }
  return true;
}

/** Use dialog submit: conditions that depend on the execution chosen through the enhancements. */
export function validateCastingDialog({ item, formData }) {
  const mode = getMode(CASTING_CONDITION_SETTING, CASTING_CONDITION_MODES);
  const actor = item?.actor;
  if (mode === "off" || !actor || !isSpellCast(item)) return null;
  const ids = dialogConditionBlock({
    statuses: actor.statuses,
    base: item.system?.ativacao?.execucao,
    effects: readUseEffects(item.applicableOnUseEffects),
    applied: foundry.utils.expandObject(formData ?? {}).aprs ?? {},
    labels: reactionLabels()
  });
  if (!ids.length) return null;
  const block = mode === "block";
  const parts = [conditionsText(actor, item, ids), game.i18n.localize("T20CP.CastingRestrictions.Conditions.Reaction")];
  if (block) parts.push(game.i18n.localize("T20CP.CastingRestrictions.Conditions.Blocked"));
  return { message: parts.join(" "), block };
}

/** preCreateActiveEffect, on the client that applies the effect. Only warns; never refuses. */
function onPreCreateEffect(effect, data) {
  if (getMode(SUSTAINED_SPELL_SETTING, SUSTAINED_SPELL_MODES) !== "warn") return;
  const source = data ?? effect;
  if (source?.duration?.expiry !== SUSTAIN_EXPIRY) return;
  const cast = readCast(foundry.utils.getProperty(source, CAST_PATH));
  const origin = parseSustainOrigin(source.origin);
  if (!cast || origin?.casterUuid !== cast.casterUuid) return;
  const caster = foundry.utils.fromUuidSync(cast.casterUuid);
  if (!caster?.effects) return;
  const capacity = capacityOf(caster);
  const reference = sustainedReference();

  const scan = applicationScan(cast.casterUuid, cast.castId);
  const history = scan.history;
  if (isSupersededCast(cast.castId, history, capacity)) {
    warnOnce("stale", cast.castId, i18n("Sustained.Stale", {
      spell: cast.spell, actor: caster.name, current: list(castsAfter(cast.castId, history).map((c) => c.spell)), capacity, reference
    }));
    return;
  }
  scan.effects ??= scanStampedEffects(cast.casterUuid);
  scan.effects.push({ origin: source.origin, cast });
  const active = activeOf(caster, scan.effects);
  const others = exceedsLimit(active, capacity, cast.castId);
  if (others) {
    warnOnce("limit", cast.castId, i18n("Sustained.Apply", {
      spell: cast.spell, actor: caster.name, held: heldText(others, active.uncertain), capacity, reference
    }));
  }
}

async function postConcentration(item, options, rollMode) {
  if (getMode(CONCENTRATION_SETTING, CONCENTRATION_MODES) !== "warn" || !isSpell(item)) return;
  const actor = item.actor;
  const check = concentrationCheck({ statuses: actor?.statuses, manaCost: options?.manaCost });
  if (!check) return;
  const escape = foundry.utils.escapeHTML;
  const content = `<p>${i18n("Concentration.Message", {
    actor: escape(actor.name),
    item: escape(item.name),
    conditions: escape(list(check.reasons.map(statusName))),
    dc: check.dc,
    reference: escape(game.i18n.localize("T20CP.CastingRestrictions.Concentration.Reference"))
  })}</p>`;
  const data = { content, speaker: ChatMessage.getSpeaker({ actor }) };
  ChatMessage.applyMode(data, rollMode || undefined);
  await ChatMessage.create(data);
}

/** Registers the world settings. Runs on "init" for every system, so the settings always exist. */
export function registerCastingRestrictionsSettings() {
  const register = (key, prefix, modes) =>
    game.settings.register(MODULE_ID, key, {
      name: `T20CP.CastingRestrictions.${prefix}.Setting.Name`,
      hint: `T20CP.CastingRestrictions.${prefix}.Setting.Hint`,
      scope: "world",
      config: false,
      type: String,
      choices: Object.fromEntries(modes.map((m) => [m, `T20CP.CastingRestrictions.${prefix}.Setting.${m}`])),
      default: "off"
    });
  register(SUSTAINED_SPELL_SETTING, "Sustained", SUSTAINED_SPELL_MODES);
  register(CASTING_CONDITION_SETTING, "Conditions", CASTING_CONDITION_MODES);
  register(CONCENTRATION_SETTING, "Concentration", CONCENTRATION_MODES);
}

/**
 * Installs the rules. Must run after the patches and the other rules, arcane-armor-casting included (it stays inside
 * this displayCard wrapper). The cast stamp is always applied (it is inert).
 */
export function installCastingRestrictionsRule() {
  const itemProto = CONFIG.Item?.documentClass?.prototype;
  const roll = itemProto?.roll;
  const displayCard = itemProto?.displayCard;
  if (typeof roll !== "function" || typeof displayCard !== "function") throw new Error("ItemT20 roll/displayCard not found");

  itemProto.roll = markWrapper(function (...args) {
    let allowed = true;
    try {
      allowed = beforeRoll(this, args);
    } catch (err) {
      console.error(`${MODULE_ID} | casting-restrictions: failed to check the use`, err);
    }
    if (allowed === false) return Promise.resolve();
    return roll.apply(this, args);
  }, roll);

  itemProto.displayCard = markWrapper(async function (config, ...rest) {
    const options = config?.options;
    const casting = isCastUse(options);
    try {
      if (casting && isSustainedSpell(this) && this.actor) {
        stampSustainedCast(options.effects, { castId: foundry.utils.randomID(), casterUuid: this.actor.uuid, spell: this.name });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | casting-restrictions: failed to stamp the sustained cast`, err);
    }
    const result = await displayCard.call(this, config, ...rest);
    if (casting && castCompleted(result, options) && result?.documentName === "ChatMessage") {
      try {
        await postConcentration(this, options, config?.rollMode);
      } catch (err) {
        console.error(`${MODULE_ID} | casting-restrictions: failed to post the concentration test`, err);
      }
    }
    return result;
  }, displayCard);

  try {
    installUseDialogGuard();
    registerUseValidator(validateCastingDialog);
  } catch (err) {
    console.error(`${MODULE_ID} | casting-restrictions: failed to install the use dialog check`, err);
  }
  registerInvalidation();
  Hooks.on("preCreateActiveEffect", (effect, data) => {
    try {
      onPreCreateEffect(effect, data);
    } catch (err) {
      console.error(`${MODULE_ID} | casting-restrictions: failed to check the sustained spell limit`, err);
    }
  });
}
