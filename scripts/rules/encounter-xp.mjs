import { MODULE_ID } from "../utils.mjs";

/**
 * Optional GM tool: awards encounter XP (Tormenta20 Jogo do Ano, cap. 7, "Pontos de Experiência", p. 326).
 * Each defeated challenge is worth ND × 1,000 XP, split evenly among the characters; a draw is worth half and a
 * defeat a quarter; a challenge 5 or more points below the group level is worth nothing. Treasure is not generated:
 * the GM summary only points to the creature's treasure text and to the book table.
 */

export const XP_AWARDS_SETTING = "encounterXp";
export const OUTCOME_FACTOR = Object.freeze({ victory: 1, draw: 0.5, defeat: 0.25 });
export const MAX_LEVEL = 20;

const CHALLENGE_TYPES = new Set(["npc", "hazard"]);
const FRACTIONS = { "1/4": 0.25, "¼": 0.25, "1/2": 0.5, "½": 0.5 };

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

/**
 * Challenge rating text → number. S and S+ count as 20 (Ameaças de Arton, p. 376) and are flagged.
 * @param {unknown} raw
 * @returns {{value: number, label: string, special: boolean}|null}
 */
export function parseNd(raw) {
  const text = String(raw ?? "").trim().toUpperCase();
  if (text in FRACTIONS) return { value: FRACTIONS[text], label: ndLabel(FRACTIONS[text]), special: false };
  if (text === "S" || text === "S+") return { value: 20, label: text, special: true };
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (value >= 1 && value <= MAX_LEVEL) return { value, label: String(value), special: false };
  }
  return null;
}

/** Number → label used in the summary ("1/4", "1/2", "7"). */
export function ndLabel(value) {
  if (value === 0.25) return "1/4";
  if (value === 0.5) return "1/2";
  return String(value);
}

/** Equal challenge ratings (Tormenta20 p. 282; Ameaças de Arton p. 9). */
function groupNd(value, count) {
  if (count === 1) return value;
  if (value < 1) return value * count;
  return value + 2 * Math.floor(Math.log2(count));
}

/**
 * Encounter challenge rating (Ameaças de Arton, p. 9): group equal ratings, repeat while groups tie, then add +1,
 * +½ or +¼ to the highest for each other group up to 1, 2 or less than 4 points below it; round down.
 * @param {number[]} values
 */
export function encounterNd(values) {
  let groups = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!groups.length) return 0;
  for (;;) {
    const counts = new Map();
    for (const v of groups) counts.set(v, (counts.get(v) ?? 0) + 1);
    if (counts.size === groups.length) break;
    groups = [...counts].map(([v, c]) => groupNd(v, c));
  }
  groups.sort((a, b) => b - a);
  const [base, ...rest] = groups;
  let total = base;
  for (const v of rest) {
    const gap = base - v;
    total += gap <= 1 ? 1 : gap <= 2 ? 0.5 : gap < 4 ? 0.25 : 0;
  }
  return total >= 1 ? Math.floor(total) : total;
}

/** Group level: average character level, rounded down, at least 1. */
export function groupLevel(levels) {
  const valid = levels.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return 1;
  return Math.max(1, Math.floor(valid.reduce((a, b) => a + b, 0) / valid.length));
}

/** "Desafios Irrelevantes" (p. 326): 5 or more points below the group level. */
export function isIrrelevant(nd, level) {
  return level - nd >= 5;
}

/**
 * @param {object} input
 * @param {{key: string, nd: number|null, won: boolean}[]} input.challenges
 * @param {number} input.recipientCount
 * @param {"creature"|"encounter"} [input.mode]
 * @param {number|null} [input.encounter]      encounter rating typed by the GM; null → computed
 * @param {"victory"|"draw"|"defeat"} [input.outcome]
 * @param {boolean} [input.skipIrrelevant]
 * @param {number} [input.level]
 * @returns {{error?: string, total?: number, share?: number, encounter?: number|null, irrelevant?: boolean,
 *   rows?: {key: string, xp: number|null, irrelevant: boolean}[]}}  error: outcome | recipients | challenges | nd | zero
 */
export function computeAward({ challenges, recipientCount, mode = "creature", encounter = null, outcome = "victory", skipIrrelevant = true, level = 1 }) {
  const factor = OUTCOME_FACTOR[outcome];
  if (factor === undefined) return { error: "outcome" };
  if (!Number.isInteger(recipientCount) || recipientCount < 1) return { error: "recipients" };
  const won = challenges.filter((c) => c.won);
  if (!won.length) return { error: "challenges" };
  if (won.some((c) => !Number.isFinite(c.nd) || c.nd <= 0)) return { error: "nd" };

  if (mode === "encounter") {
    const nd = encounter ?? encounterNd(won.map((c) => c.nd));
    if (!Number.isFinite(nd) || nd <= 0) return { error: "nd" };
    const irrelevant = skipIrrelevant && isIrrelevant(nd, level);
    const total = irrelevant ? 0 : Math.round(nd * 1000);
    const rows = won.map((c) => ({ key: c.key, xp: null, irrelevant: false }));
    return withShare({ total, encounter: nd, irrelevant, rows }, factor, recipientCount);
  }

  const rows = won.map((c) => {
    const irrelevant = skipIrrelevant && isIrrelevant(c.nd, level);
    return { key: c.key, xp: irrelevant ? 0 : Math.round(c.nd * 1000), irrelevant };
  });
  const total = rows.reduce((sum, r) => sum + r.xp, 0);
  return withShare({ total, encounter: null, irrelevant: false, rows }, factor, recipientCount);
}

/** Nothing to award (only irrelevant challenges, or a share rounded to 0) is reported, never recorded. */
function withShare(award, factor, recipientCount) {
  const share = Math.floor((award.total * factor) / recipientCount);
  return share > 0 ? { ...award, share } : { ...award, share: 0, error: "zero" };
}

/** Level up available: xp reaches the next level threshold (the system's xpPorNivel) below level 20. */
export function canLevelUp(level, xp, table) {
  return Number.isInteger(level) && level >= 1 && level < MAX_LEVEL && xp >= table[level];
}

/**
 * Splits snapshot rows into challenges (npc, hazard; one per token) and recipients (character; one per actor
 * document, so two tokens of the same linked character are one recipient).
 */
export function partitionSnapshot(rows) {
  const challenges = new Map();
  const recipients = new Map();
  for (const row of rows) {
    if (CHALLENGE_TYPES.has(row.type)) {
      if (challenges.has(row.key)) continue;
      const parsed = parseNd(row.ndText);
      challenges.set(row.key, { ...row, nd: parsed?.value ?? null, ndLabel: parsed?.label ?? "", special: !!parsed?.special, won: !!row.hostile });
    } else if (row.type === "character") {
      if (recipients.has(row.actorUuid)) continue;
      // An unlinked token holds its own synthetic actor: XP written there dies with the token. Opt-in only.
      recipients.set(row.actorUuid, { ...row, selected: !!row.playerOwned && !row.unlinked });
    }
  }
  return { challenges: [...challenges.values()], recipients: [...recipients.values()] };
}

/** Selected recipients on unlinked tokens need an explicit confirmation. */
export function recipientsError(selected, confirmUnlinked) {
  return selected.some((r) => r.unlinked) && !confirmUnlinked ? "unlinked" : null;
}

/**
 * Encounter rating field: empty uses the suggestion, anything else must be a valid rating.
 * @returns {{value: number|null}|{error: "encounterNd"}}
 */
export function resolveEncounterNd(text, suggested) {
  if (!String(text ?? "").trim()) return { value: suggested || null };
  const parsed = parseNd(text);
  return parsed ? { value: parsed.value } : { error: "encounterNd" };
}

/**
 * Why this client may not distribute now (null: it may). Checked when the dialog opens, inside the queue and before
 * each write, so a GM that stops being the active GM, a tool switched off or XP disabled stops the distribution.
 */
export function executorBlock({ isGm, isActiveGm, mode, disabled }) {
  if (!isGm) return "notGm";
  if (mode === "off") return "off";
  if (disabled) return "disabled";
  if (!isActiveGm) return "notActiveGm";
  return null;
}

/** Flag kept on each actor that received XP: one record per award id, written in the same update as the XP. */
export const AWARDS_FLAG = "xpAwards";

/**
 * How a recipient relates to an award, read from the awards recorded on its own actor:
 * "already" when it holds this award id (a resume or a second click), "duplicate" when another award shares a
 * challenge token (the button, then the end of the combat) and the GM did not ask to award again; null to write.
 */
export function recipientStatus(awards, award) {
  if (awards?.[award.id]) return "already";
  if (award.repeat) return null;
  const keys = new Set(award.challenges);
  const clash = Object.entries(awards ?? {}).some(([id, a]) => id !== award.id && a?.challenges?.some((k) => keys.has(k)));
  return clash ? "duplicate" : null;
}

/**
 * Record stored on the actor. `recipients` is the planned list, so an interrupted award can be resumed from it.
 * `before`/`after` and `seq` (one more than the highest seq read on the actor) let auditAwards find XP lost by a
 * stale write; `toPlayers` keeps the summary audience for a resume.
 */
export function awardRecord(award, before, seq) {
  return {
    xp: award.share,
    before,
    after: before + award.share,
    seq,
    at: award.at,
    by: award.by,
    outcome: award.outcome,
    repeat: !!award.repeat,
    toPlayers: award.toPlayers !== false,
    challenges: [...award.challenges],
    recipients: award.recipients.map(({ uuid, name, level }) => ({ uuid, name, level }))
  };
}

/** Next record sequence on one actor. */
export function nextSeq(awards) {
  return Math.max(0, ...Object.values(awards ?? {}).map((r) => (Number.isFinite(r?.seq) ? r.seq : 0))) + 1;
}

/**
 * Checks the confirmed XP against the records on the actor. XP is written as an absolute value computed from a read,
 * and the database has no increment operator (core common/data/operators.mjs), so a write that left with an old read
 * and arrives late overwrites the XP of the awards written meanwhile, while their records stay. The records written
 * last (highest seq; several when they came from the same read) give the expected XP: their common `before` plus
 * their XP. Result:
 * - "ok": the XP is the expected one (or there is nothing to check);
 * - "lost": the XP is a value an earlier write left (a `before` or an `after` recorded), so XP was probably lost;
 * - "edited": any other value, i.e. an edit outside the module; it is reported, not blocked.
 * @returns {{status: "ok"|"lost"|"edited", expected: number|null}}
 */
export function auditAwards(xp, awards) {
  const recs = Object.values(awards ?? {}).filter((r) => [r?.seq, r?.before, r?.after, r?.xp].every(Number.isFinite));
  if (!recs.length) return { status: "ok", expected: null };
  const top = Math.max(...recs.map((r) => r.seq));
  const last = recs.filter((r) => r.seq === top);
  const bases = new Set(last.map((r) => r.before));
  const expected = bases.size === 1 ? last[0].before + last.reduce((sum, r) => sum + r.xp, 0) : null;
  if (xp === expected) return { status: "ok", expected };
  const seen = new Set(recs.flatMap((r) => [r.before, r.after]));
  return { status: seen.has(xp) ? "lost" : "edited", expected };
}

/** Summary audience of a resume: the explicit choice, else the one recorded with the award (public by default). */
export function resumeAudience(collected, toPlayers) {
  return typeof toPlayers === "boolean" ? toPlayers : collected?.toPlayers !== false;
}

export const PLAN_FLAG = "xpPlan";

/**
 * Plan of an award, stored in the flags of the GM summary message, created before the first write. Players cannot
 * forge it: a message is created only in its author's name and updated only by its author or a GM (core
 * common/documents/chat-message.mjs:74-98). The actor records are editable by the owning player, so a resume takes
 * value, recipients and audience from this plan, never from the records.
 */
export function planRecord(award) {
  return {
    id: award.id,
    at: award.at,
    share: award.share,
    outcome: award.outcome,
    repeat: !!award.repeat,
    toPlayers: award.toPlayers !== false,
    challenges: [...award.challenges],
    recipients: award.recipients.map(({ uuid, name, level }) => ({ uuid, name, level }))
  };
}

/**
 * Plans by award id, only from messages written by a GM.
 * @param {{gm: boolean, plan: object}[]} entries
 * @returns {Map<string, object>}
 */
export function planMap(entries) {
  const plans = new Map();
  for (const { gm, plan } of entries) if (gm && typeof plan?.id === "string" && !plans.has(plan.id)) plans.set(plan.id, plan);
  return plans;
}

/**
 * Awards recorded on the actors, grouped by id, with the planned recipients still without XP. A recipient skipped
 * because another award already paid the same challenge is not pending. With `plans`, an award takes value,
 * recipients, challenges and audience from its GM plan (`verified`); one without a plan is history only (no pending).
 * @param {{uuid: string, awards: object}[]} actors  every actor that may hold the flag
 * @param {Map<string, object>|null} [plans]  planMap of the GM summary messages
 */
export function collectAwards(actors, plans = null) {
  const byUuid = new Map(actors.map((a) => [a.uuid, a.awards ?? {}]));
  const awards = new Map();
  for (const { uuid, awards: records } of actors) {
    for (const [id, rec] of Object.entries(records ?? {})) {
      if (!awards.has(id)) awards.set(id, { id, at: rec.at, share: rec.xp, outcome: rec.outcome, repeat: !!rec.repeat, toPlayers: rec.toPlayers !== false, challenges: rec.challenges ?? [], recipients: rec.recipients ?? [], paid: [] });
      awards.get(id).paid.push(uuid);
    }
  }
  // A plan whose writes all failed left no record on any actor: it is found through the plan alone.
  for (const [id, plan] of plans ?? []) if (!awards.has(id)) awards.set(id, { id, at: plan.at, paid: [] });
  for (const a of awards.values()) {
    if (plans) {
      const plan = plans.get(a.id);
      a.verified = !!plan;
      if (plan) Object.assign(a, { share: plan.share, outcome: plan.outcome, repeat: !!plan.repeat, toPlayers: plan.toPlayers !== false, challenges: plan.challenges ?? [], recipients: plan.recipients ?? [] });
    }
    a.pending = a.verified === false ? [] : a.recipients.filter((r) => !a.paid.includes(r.uuid) && recipientStatus(byUuid.get(r.uuid), a) === null);
  }
  return [...awards.values()].sort((a, b) => b.at - a.at);
}

/** Other awards that share a challenge with this one. */
export function findOverlap(awards, challengeKeys, ownId = null) {
  const keys = new Set(challengeKeys);
  return awards.filter((a) => a.id !== ownId && a.challenges.some((k) => keys.has(k)));
}

/** Rebuilds an interrupted award from its records, to resume it without the dialog, tokens or combat. */
export function awardFromRecords(collected, by, at) {
  return { id: collected.id, at, by, outcome: collected.outcome, repeat: collected.repeat, toPlayers: collected.toPlayers, share: collected.share, challenges: collected.challenges, recipients: collected.recipients };
}

/**
 * Runs distributions one at a time inside one client. Two clients are not coordinated: see the issue (limitation).
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function createQueue() {
  let queue = Promise.resolve();
  return (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
}

/**
 * Writes the award to each recipient. Per recipient: read the actor (XP and recorded awards), skip it when it already
 * holds this award or a duplicate, refuse it ("diverged", left pending) when auditAwards finds XP probably lost, unless
 * `acceptDivergence`; check the guard with no await before the update, then write XP and record in a single
 * actor.update (atomic per document), and read back. When the guard blocks, it stops: the rest stays pending.
 * @param {object} award {id, at, by, outcome, repeat, toPlayers, acceptDivergence, share, challenges: string[],
 *   recipients: {uuid, name, level}[]}
 * @param {{queue, guard: () => string|null, readActor: (uuid) => Promise<{xp: number, awards: object}>,
 *   writeAward: (uuid, xp: number, id: string, record: object) => Promise<void>}} deps
 * @returns {Promise<{refused?: string, stopped?: string, results?: object[], pending?: string[]}>}
 */
export function runAward(award, deps) {
  return deps.queue(async () => {
    const first = deps.guard();
    if (first) return { refused: first };
    const results = award.recipients.map((r) => ({ ...r, delta: award.share, status: "pending" }));
    let stopped;
    for (const r of results) {
      try {
        const { xp, awards } = await deps.readActor(r.uuid);
        const skip = recipientStatus(awards, award);
        if (skip) {
          Object.assign(r, { status: skip, before: xp, after: xp });
          continue;
        }
        const audit = auditAwards(xp, awards);
        if (audit.status === "lost" && !award.acceptDivergence) {
          Object.assign(r, { status: "diverged", before: xp, after: xp, expected: audit.expected });
          continue;
        }
        // No await between this check and the update call.
        stopped = deps.guard() ?? undefined;
        if (stopped) break;
        Object.assign(r, { before: xp, target: xp + award.share });
        await deps.writeAward(r.uuid, r.target, award.id, awardRecord(award, xp, nextSeq(awards)));
        const after = (await deps.readActor(r.uuid)).xp;
        Object.assign(r, { after, status: after === r.target ? "done" : "conflict" });
      } catch (err) {
        Object.assign(r, { status: "error", error: String(err?.message ?? err) });
      }
    }
    const pending = results.filter((r) => ["pending", "error", "diverged"].includes(r.status)).map((r) => r.name);
    return { results, stopped, pending };
  });
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const SKIPPED = new Set(["already", "duplicate"]);

/**
 * Public summary: only characters and XP, nothing about the threats. Recipients skipped (already paid) are left out;
 * null when nothing is left to report.
 * @param {string} outcome
 * @param {object[]} results  runAward results
 * @param {(key: string, data?: object) => string} t  localizer (game.i18n.format)
 * @param {number[]} table  xpPorNivel
 */
export function publicSummaryHtml(outcome, results, t, table) {
  const shown = results.filter((r) => !SKIPPED.has(r.status));
  if (!shown.length) return null;
  const items = shown.map((r) => {
    const name = escapeHtml(r.name);
    if (["error", "pending", "diverged"].includes(r.status)) return `<li>${name}: ${t("T20CP.EncounterXp.Chat.Failed")}</li>`;
    const line = t("T20CP.EncounterXp.Chat.Line", { name, delta: r.delta, before: r.before, after: r.after });
    const flags = [];
    if (r.status === "conflict") flags.push(t("T20CP.EncounterXp.Chat.Conflict", { target: r.target }));
    if (canLevelUp(r.level, r.after, table)) flags.push(t("T20CP.EncounterXp.Chat.LevelUp"));
    return `<li>${line}${flags.length ? ` <em>(${flags.join("; ")})</em>` : ""}</li>`;
  });
  return `<h3>${t("T20CP.EncounterXp.Chat.Title")}</h3><p>${t(`T20CP.EncounterXp.Chat.Outcome.${outcome}`)}</p><ul>${items.join("")}</ul>`;
}

/**
 * GM summary: the threats, their rating and XP, where to roll their treasure (not generated by the module) and the
 * characters skipped because they already had this XP.
 * @param {{repeat: boolean}} awardData
 * @param {object[]} results  runAward results
 * @param {{key, name, ndLabel, treasure, type}[]} challenges  the won challenges
 * @param {object} award  result of computeAward
 * @param {(key: string, data?: object) => string} t
 */
export function gmSummaryHtml(awardData, results, challenges, award, t) {
  const rows = new Map(award.rows.map((r) => [r.key, r]));
  const items = challenges.map((c) => {
    const row = rows.get(c.key);
    const xp = row?.irrelevant ? t("T20CP.EncounterXp.Chat.Irrelevant") : row?.xp === null ? "" : `${row?.xp ?? 0} XP`;
    const treasure = c.type === "hazard" ? "" : t("T20CP.EncounterXp.Chat.Treasure", { text: escapeHtml(c.treasure || t("T20CP.EncounterXp.Chat.TreasureEmpty")), nd: c.ndLabel });
    return `<li><strong>${escapeHtml(c.name)}</strong> (ND ${escapeHtml(c.ndLabel)})${xp ? `: ${xp}` : ""}${treasure ? `<br>${treasure}` : ""}</li>`;
  });
  const head = award.encounter === null
    ? t("T20CP.EncounterXp.Chat.TotalCreature", { total: award.total })
    : t(award.irrelevant ? "T20CP.EncounterXp.Chat.EncounterIrrelevant" : "T20CP.EncounterXp.Chat.TotalEncounter", { nd: ndLabel(award.encounter), total: award.total });
  const repeat = awardData.repeat ? `<p><em>${t("T20CP.EncounterXp.Chat.Repeat")}</em></p>` : "";
  const skipped = results.filter((r) => SKIPPED.has(r.status)).map((r) => escapeHtml(r.name));
  const skip = skipped.length ? `<p>${t("T20CP.EncounterXp.Chat.Skipped", { names: skipped.join(", ") })}</p>` : "";
  const diverged = results.filter((r) => r.status === "diverged")
    .map((r) => `<li>${t("T20CP.EncounterXp.Chat.Diverged", { name: escapeHtml(r.name), xp: r.before, expected: r.expected ?? "?" })}</li>`);
  const lost = diverged.length ? `<ul>${diverged.join("")}</ul>` : "";
  return `<h3>${t("T20CP.EncounterXp.Chat.GmTitle")}</h3><p>${head}</p>${repeat}<ul>${items.join("")}</ul>${skip}${lost}`;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

function mode() {
  return game.settings.get(MODULE_ID, XP_AWARDS_SETTING);
}

export function registerEncounterXpSetting() {
  game.settings.register(MODULE_ID, XP_AWARDS_SETTING, {
    name: "T20CP.EncounterXp.Setting.Name",
    hint: "T20CP.EncounterXp.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: {
      off: "T20CP.EncounterXp.Setting.off",
      button: "T20CP.EncounterXp.Setting.button",
      combat: "T20CP.EncounterXp.Setting.combat"
    },
    default: "off",
    onChange: (value) => {
      ui.controls?.render({ reset: true });
      if (value === "off") closeRewardsDialog();
    }
  });
}

/** Synchronous lookup (core helpers.mjs:189): no await between the guard and actor.update. */
function actorOf(uuid) {
  const actor = foundry.utils.fromUuidSync(uuid);
  if (!actor) throw new Error(`Actor not found: ${uuid}`);
  return actor;
}

function recordedAwards(actor) {
  return actor._source.flags?.[MODULE_ID]?.[AWARDS_FLAG] ?? {};
}

/** Actor I/O used by runAward. XP and the award record go in one update, so they never separate. */
export const foundryDeps = {
  queue: createQueue(),
  guard: () => currentBlock(),
  readActor: async (uuid) => {
    const actor = actorOf(uuid);
    return { xp: xpOf(actor), awards: recordedAwards(actor) };
  },
  writeAward: (uuid, xp, id, record) =>
    actorOf(uuid).update({ "system.attributes.nivel.xp.value": xp, [`flags.${MODULE_ID}.${AWARDS_FLAG}.${id}`]: record })
};

/**
 * Character sheets that may hold an award: the world characters and the synthetic actors of unlinked tokens in the
 * viewed scene and in the scenes of existing combats. Cost: one pass over those collections, already in memory (no
 * database query), when the dialog opens or renders. Unlinked tokens of other scenes are not scanned (see the issue).
 */
function awardHolders() {
  const actors = game.actors.filter((a) => a.type === "character");
  const scenes = new Set([canvas.scene, ...game.combats.map((c) => c.scene)].filter(Boolean));
  for (const scene of scenes) {
    for (const token of scene.tokens) if (!token.actorLink && token.actor?.type === "character") actors.push(token.actor);
  }
  return actors.map((a) => ({ uuid: a.uuid, name: a.name, xp: xpOf(a), awards: recordedAwards(a) }));
}

function xpOf(actor) {
  return Number(actor._source.system?.attributes?.nivel?.xp?.value) || 0;
}

/** API and dialog: sheets whose XP disagrees with their records ({uuid, name, xp, status, expected}). */
export function listDivergences() {
  return awardHolders().map((h) => ({ uuid: h.uuid, name: h.name, xp: h.xp, ...auditAwards(h.xp, h.awards) })).filter((d) => d.status === "lost");
}

/** Awards derived from the actor flags, verified against the GM plans: the dialog history and the interrupted ones. */
export function knownAwards() {
  return collectAwards(awardHolders(), awardPlans());
}

function awardPlans() {
  return planMap(game.messages.contents.map((m) => ({ gm: !!m.author?.isGM, plan: m.flags?.[MODULE_ID]?.[PLAN_FLAG] })));
}

/**
 * GM summary message, created before the first write with the plan in its flags; reportRun fills in the results.
 * @returns {Promise<ChatMessage>}
 */
export function createPlanMessage(award, challenges, computed) {
  const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
  return ChatMessage.create({
    content: gmSummaryHtml(award, [], challenges, computed, t),
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    flags: { [MODULE_ID]: { [PLAN_FLAG]: planRecord(award) } }
  });
}

/** One snapshot row per token (or actor without token). Unlinked tokens are flagged: their XP lives on the token. */
export function describeToken(tokenDoc, actor, combatant = null) {
  if (!actor) return null;
  return {
    key: tokenDoc?.uuid ?? actor.uuid,
    actorUuid: actor.uuid,
    type: actor.type,
    name: tokenDoc?.name ?? actor.name,
    ndText: actor.system?.attributes?.nd ?? "",
    treasure: actor.system?.detalhes?.tesouro ?? "",
    hostile: (tokenDoc?.disposition ?? CONST.TOKEN_DISPOSITIONS.HOSTILE) !== CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    defeated: !!combatant?.isDefeated,
    playerOwned: !!actor.hasPlayerOwner,
    unlinked: !!tokenDoc && !tokenDoc.actorLink,
    level: Number(actor.system?.attributes?.nivel?.value) || 0,
    xp: Number(actor._source?.system?.attributes?.nivel?.xp?.value) || 0
  };
}

function snapshotCombat(combat) {
  return combat.combatants.contents.map((c) => describeToken(c.token, c.actor, c)).filter(Boolean);
}

function snapshotTokens(tokens) {
  return tokens.map((t) => describeToken(t.document, t.actor, t.combatant)).filter(Boolean);
}

function snapshotPlayers() {
  return game.users.players.map((u) => u.character).filter(Boolean).map((a) => describeToken(null, a));
}

function currentBlock() {
  return executorBlock({
    isGm: game.user.isGM,
    isActiveGm: game.user.isActiveGM,
    mode: mode(),
    disabled: !!game.settings.get("tormenta20", "disableExperience")
  });
}

function warnBlock(block) {
  const key = `T20CP.EncounterXp.Warn.Block.${block}`;
  return ui.notifications.warn(game.i18n.format(key, { name: game.users.activeGM?.name ?? "?" }));
}

/** Closes the open dialog: it belongs to a GM that may no longer distribute. */
export function closeRewardsDialog() {
  return foundry.applications.instances.get("t20cp-rewards")?.close();
}

/**
 * Opens the dialog with a new award id. Only the active GM (core: game.users.activeGM) distributes. With nothing to
 * award, the dialog still opens when an interrupted award exists, so it can be resumed after its challenges are gone.
 * @param {{combat?: Combat, tokens?: Token[], rows?: object[], source?: string}} [options]
 */
export async function openRewards({ combat, tokens, rows, source } = {}) {
  const block = currentBlock();
  if (block) return warnBlock(block);
  if (!rows) {
    // An explicit source wins; the selection and the active combat are only the defaults.
    if (!tokens && !combat) {
      tokens = canvas.tokens?.controlled ?? [];
      if (!tokens.length) combat = game.combat;
    }
    if (tokens?.length) {
      rows = snapshotTokens(tokens);
      source = "tokens";
    } else if (combat) {
      rows = snapshotCombat(combat);
      source = `combat:${combat.id}`;
    } else rows = [];
  }
  let { challenges, recipients } = partitionSnapshot(rows);
  if (!challenges.length) {
    if (!listPending().length) {
      return ui.notifications.warn(rows.length ? "T20CP.EncounterXp.Warn.NoChallenges" : "T20CP.EncounterXp.Warn.NoSource", { localize: true });
    }
    recipients = [];
  } else if (!recipients.length) recipients = partitionSnapshot(snapshotPlayers()).recipients;
  const { RewardsDialog } = await import("../apps/rewards-dialog.mjs");
  return new RewardsDialog({ awardId: foundry.utils.randomID(), challenges, recipients, source }).render({ force: true });
}

/** API: interrupted awards ({id, at, share, pending: [{uuid, name}]}), read from the actor flags. */
export function listPending() {
  return knownAwards().filter((a) => a.pending.length);
}

/**
 * Reports a run: warnings for refusal or stop, then the chat summaries. With `plan` (the GM message created before the
 * run), the GM summary is that message, updated with the results; a refused run deletes it, since nothing was written.
 */
export async function reportRun(run, { outcome, repeat, challenges = [], computed = null, toPlayers = true, plan = null }) {
  if (run.refused) {
    warnBlock(run.refused);
    await plan?.delete();
    return run;
  }
  if (run.stopped) warnBlock(run.stopped);
  if (run.pending.length) ui.notifications.warn(game.i18n.format("T20CP.EncounterXp.Warn.Pending", { names: run.pending.join(", ") }));
  const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
  const gm = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  const content = publicSummaryHtml(outcome, run.results, t, CONFIG.T20?.xpPorNivel ?? []);
  if (content) await ChatMessage.create({ content, whisper: toPlayers ? [] : gm });
  if (computed) {
    const details = gmSummaryHtml({ repeat }, run.results, challenges, computed, t);
    if (plan) await plan.update({ content: details });
    else await ChatMessage.create({ content: details, whisper: gm });
  }
  return run;
}

/**
 * API and dialog: resumes an interrupted award by id. Value, recipients and audience come from its GM plan (the actor
 * records are editable by players); only recipients without the award are written. The summary keeps the audience of
 * the plan unless `toPlayers` is given explicitly.
 */
export async function resumeRewards(id, { toPlayers, acceptDivergence = false } = {}) {
  const found = knownAwards().find((a) => a.id === id && a.verified);
  if (!found) {
    ui.notifications.warn("T20CP.EncounterXp.Warn.Missing", { localize: true });
    return { refused: "missing" };
  }
  const audience = resumeAudience(found, toPlayers);
  const run = await runAward({ ...awardFromRecords(found, game.user.id, Date.now()), toPlayers: audience, acceptDivergence }, foundryDeps);
  return reportRun(run, { outcome: found.outcome, repeat: found.repeat, toPlayers: audience });
}

function addControl(controls) {
  if (!game.user.isGM || mode() === "off") return;
  controls.tokens.tools.t20cpRewards = {
    name: "t20cpRewards",
    title: "T20CP.EncounterXp.Control",
    icon: "fa-solid fa-trophy",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => openRewards()
  };
}

function onDeleteCombat(combat) {
  // The hook runs on every client; only the active GM opens the dialog, whoever ended the combat.
  if (currentBlock() || mode() !== "combat" || !combat.started) return;
  const rows = snapshotCombat(combat);
  if (!partitionSnapshot(rows).challenges.length) return;
  openRewards({ rows, source: `combat:${combat.id}` });
}

export function installEncounterXpRule() {
  Hooks.on("getSceneControlButtons", addControl);
  Hooks.on("deleteCombat", onDeleteCombat);
  // Another GM connecting (or this one losing the role) changes game.users.activeGM: drop a stale dialog.
  Hooks.on("userConnected", () => {
    if (!game.user.isActiveGM) closeRewardsDialog();
  });
  // Every client receives the update (core client-backend.mjs:596, :337); the active GM audits the sheet when an award
  // record arrives, so a late write that overwrote newer XP is reported instead of passing in silence.
  Hooks.on("updateActor", (actor, change) => {
    if (mode() === "off" || !game.user.isActiveGM || !foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${AWARDS_FLAG}`)) return;
    const audit = auditAwards(xpOf(actor), recordedAwards(actor));
    if (audit.status !== "lost") return;
    ui.notifications.error(game.i18n.format("T20CP.EncounterXp.Warn.Diverged", { name: actor.name, xp: xpOf(actor), expected: audit.expected ?? "?" }), { permanent: true });
  });
}
