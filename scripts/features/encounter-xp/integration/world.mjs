/** World reads and actor writes of the encounter rewards, all through ctx.platform. */
import { MODULE_ID } from "../../../lib/module.mjs";
import { AWARDS_FLAG, PLAN_FLAG, auditAwards, collectAwards, createQueue, executorBlock, planMap } from "../domain/index.mjs";

export const XP_AWARDS_SETTING = "encounterXp";

export function xpOf(actor) {
  return Number(actor._source.system?.attributes?.nivel?.xp?.value) || 0;
}

export function recordedAwards(actor) {
  return actor._source.flags?.[MODULE_ID]?.[AWARDS_FLAG] ?? {};
}

/** One snapshot row per token (or actor without token). Unlinked tokens are flagged: their XP lives on the token. */
export function describeToken(dispositions, tokenDoc, actor, combatant = null) {
  if (!actor) return null;
  return {
    key: tokenDoc?.uuid ?? actor.uuid,
    actorUuid: actor.uuid,
    type: actor.type,
    name: tokenDoc?.name ?? actor.name,
    ndText: actor.system?.attributes?.nd ?? "",
    treasure: actor.system?.detalhes?.tesouro ?? "",
    hostile: (tokenDoc?.disposition ?? dispositions.HOSTILE) !== dispositions.FRIENDLY,
    defeated: !!combatant?.isDefeated,
    playerOwned: !!actor.hasPlayerOwner,
    unlinked: !!tokenDoc && !tokenDoc.actorLink,
    level: Number(actor.system?.attributes?.nivel?.value) || 0,
    xp: Number(actor._source?.system?.attributes?.nivel?.xp?.value) || 0
  };
}

/**
 * The world as the rewards see it: mode, guard, actor I/O (with this install's queue), award holders and snapshots.
 * @param {import("../../../kernel/feature.mjs").FeatureContext} ctx
 */
export function createWorld(ctx) {
  const { platform } = ctx;
  const mode = () => ctx.setting(XP_AWARDS_SETTING);

  const currentBlock = () =>
    executorBlock({
      isGm: platform.user.isGM(),
      isActiveGm: platform.user.isActiveGM(),
      mode: mode(),
      disabled: !!platform.settingsOf("tormenta20").get("disableExperience")
    });

  /** Synchronous lookup (core helpers.mjs:189): no await between the guard and actor.update. */
  const actorOf = (uuid) => {
    const actor = platform.documents.fromUuidSync(uuid);
    if (!actor) throw new Error(`Actor not found: ${uuid}`);
    return actor;
  };

  /** Actor I/O used by runAward. XP and the award record go in one update, so they never separate. */
  const deps = {
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
  const awardHolders = () => {
    const actors = platform.documents.actors().filter((a) => a.type === "character");
    const scenes = new Set([platform.canvas.scene(), ...platform.documents.combats().map((c) => c.scene)].filter(Boolean));
    for (const scene of scenes) {
      for (const token of scene.tokens) if (!token.actorLink && token.actor?.type === "character") actors.push(token.actor);
    }
    return actors.map((a) => ({ uuid: a.uuid, name: a.name, xp: xpOf(a), awards: recordedAwards(a) }));
  };

  const awardPlans = () =>
    planMap(platform.documents.messages().contents.map((m) => ({ gm: !!m.author?.isGM, plan: m.flags?.[MODULE_ID]?.[PLAN_FLAG] })));

  const describe = (tokenDoc, actor, combatant) => describeToken(platform.constants().TOKEN_DISPOSITIONS, tokenDoc, actor, combatant);

  return {
    mode,
    currentBlock,
    deps,
    /** API and dialog: sheets whose XP disagrees with their records ({uuid, name, xp, status, expected}). */
    listDivergences: () =>
      awardHolders().map((h) => ({ uuid: h.uuid, name: h.name, xp: h.xp, ...auditAwards(h.xp, h.awards) })).filter((d) => d.status === "lost"),
    /** Awards derived from the actor flags, verified against the GM plans: the dialog history and the interrupted ones. */
    knownAwards: () => collectAwards(awardHolders(), awardPlans()),
    snapshotCombat: (combat) => combat.combatants.contents.map((c) => describe(c.token, c.actor, c)).filter(Boolean),
    snapshotTokens: (tokens) => tokens.map((t) => describe(t.document, t.actor, t.combatant)).filter(Boolean),
    snapshotPlayers: () => platform.users.players().map((u) => u.character).filter(Boolean).map((a) => describe(null, a))
  };
}
