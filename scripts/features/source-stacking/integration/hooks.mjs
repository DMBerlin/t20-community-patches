/**
 * Notifications and sheet markers of the source-stacking rule, and the per-install state they share with the actor
 * wrappers. Reads the platform only through `ctx`.
 */
import { allActors } from "../../../lib/actors.mjs";
import { DEFENSE_KEY, PENALTY_KEY, SOURCE_STACKING_SETTING, keyLabel, newSuppressions, reportSignature, signed } from "../domain.mjs";
import { targetActor } from "./plan.mjs";

const SUPPRESSED_KEY = "T20CP.SourceStacking.Suppressed";

/** State of one installation: nothing is shared between installs. */
export function createState() {
  return {
    /** Plan of the actor being prepared: {actor, suppressed, amounts}. Set only while Actor#applyActiveEffects runs. */
    active: null,
    /** @type {WeakMap<object, object[]>} Report of each actor's last preparation. */
    actorReports: new WeakMap(),
    /** Accessories whose Defense or penalty lost, by actor: [{item, value, penalty}]. */
    accessoryLosers: new WeakMap(),
    /** Signatures already seen by this user, by actor, so only new suppressions are notified. */
    knownByActor: new WeakMap(),
    preparing: new WeakSet(),
    /** Documents changed by this user in the current operation, by actor, waiting for the notification flush. */
    pending: new Map()
  };
}

/** Whether the rule is on; false when the setting cannot be read. */
export function isOn(ctx) {
  try {
    return ctx.setting(SOURCE_STACKING_SETTING) === "on";
  } catch {
    return false;
  }
}

function labels(platform) {
  const T20 = platform.t20Config() ?? {};
  const localize = (s) => (typeof s === "string" ? platform.i18n.localize(s) : undefined);
  const map = (obj, pick) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, localize(pick(v))]));
  return {
    defense: platform.i18n.localize("T20CP.SourceStacking.Stat.defense"),
    penalty: platform.i18n.localize("T20CP.SourceStacking.Stat.penalty"),
    pericias: map(T20.pericias, (v) => (typeof v === "string" ? v : v?.label)),
    atributos: map(T20.atributos, (v) => (typeof v === "string" ? v : v?.label))
  };
}

/** Format data of the message for one suppression (plain text: callers escape it before using it as HTML). */
function messageData(platform, r, actor, cachedLabels = labels(platform)) {
  const accessory = r.category === "item" && (r.key === DEFENSE_KEY || r.key === PENALTY_KEY);
  return {
    loser: r.loser.name,
    stat: keyLabel(r.key, cachedLabels),
    value: signed(r.loser.total),
    actor: actor?.name,
    winner: r.winner.name,
    winnerValue: signed(r.winner.total),
    reason: platform.i18n.localize(accessory ? "T20CP.SourceStacking.Accessory" : `T20CP.SourceStacking.Category.${r.category}`),
    reference: platform.i18n.localize("T20CP.SourceStacking.Reference")
  };
}

/** Notifies the user who changed `docs` about the new suppressions they cause or suffer. */
function notifyChange(ctx, state, actor, docs) {
  if (!actor || actor.documentName !== "Actor") return;
  const report = isOn(ctx) ? (state.actorReports.get(actor) ?? []) : [];
  const known = state.knownByActor.get(actor) ?? new Set();
  if (docs.length) {
    const fresh = newSuppressions(report, known, docs);
    if (fresh.length) {
      const cached = labels(ctx.platform);
      // `format` makes the core escape every value, including names typed by users.
      for (const r of fresh) ctx.platform.notify.info(SUPPRESSED_KEY, { format: messageData(ctx.platform, r, actor, cached) });
    }
  }
  state.knownByActor.set(actor, new Set(report.map(reportSignature)));
}

/**
 * Runs after the current database operation dispatches its descendant events. Changes to an effect owned by an
 * item fire their hook after `item.reset()` and before the owner actor prepares again (Actor#_on*DescendantDocuments),
 * so the actor's report is only up to date once the synchronous part of the operation is over.
 */
function afterOperation(ctx, state, actor, doc, notify) {
  if (!actor) return;
  let docs = state.pending.get(actor);
  if (!docs) {
    // One flush per actor: a batch prepares the actor once, then fires one hook per document.
    state.pending.set(actor, (docs = []));
    queueMicrotask(() => {
      state.pending.delete(actor);
      try {
        notifyChange(ctx, state, actor, docs);
      } catch (err) {
        ctx.log.error("failed to notify", err);
      }
    });
  }
  if (notify) docs.push(doc);
}

/** Every client keeps its known suppressions up to date; only the user who made the change is notified. */
export function onEffectHook(ctx, state, effect, userId, notify = true) {
  afterOperation(ctx, state, targetActor(effect), { effect: effect?.uuid }, notify && userId === ctx.platform.user.id());
}

export function onItemHook(ctx, state, item, userId, notify = true) {
  afterOperation(ctx, state, item?.parent, { item: item?.id }, notify && userId === ctx.platform.user.id());
}

/** Lines of the explanation of each suppressed effect (by uuid) and item (by id). */
function suppressedLines(platform, actor, report) {
  const byEffect = new Map();
  const byItem = new Map();
  const cached = labels(platform);
  const add = (map, key, line) => map.set(key, [...(map.get(key) ?? []), line]);
  for (const r of report) {
    const line = platform.i18n.format(SUPPRESSED_KEY, messageData(platform, r, actor, cached));
    for (const uuid of r.loser.effects) add(byEffect, uuid, line);
    for (const id of r.loser.items) add(byItem, id, line);
  }
  return { byEffect, byItem };
}

/** Adds the marker with the explanation to the rows of suppressed effects and items. */
export function markSheet(ctx, state, app, html) {
  const actor = app?.actor;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!actor || !root || !isOn(ctx)) return;
  const report = state.actorReports.get(actor);
  if (!report?.length) return;
  const { platform } = ctx;
  const { byEffect, byItem } = suppressedLines(platform, actor, report);
  const header = platform.i18n.localize("T20CP.SourceStacking.Tooltip");
  const decorate = (li, lines) => {
    if (!lines?.length || li.querySelector(".t20cp-source-suppressed")) return;
    const icon = li.ownerDocument.createElement("i");
    icon.className = "fa-solid fa-layer-group t20cp-source-suppressed";
    icon.dataset.tooltipHtml = [header, ...new Set(lines)].map((l) => platform.utils.escapeHTML(l)).join("<br>");
    (li.querySelector(".item-name h4, .item-name label") ?? li.querySelector(".item-name") ?? li).append(" ", icon);
  };
  for (const li of root.querySelectorAll("li[data-effect-id]")) {
    const uuid = li.dataset.effectUuid ?? actor.effects?.get(li.dataset.effectId)?.uuid;
    decorate(li, uuid && byEffect.get(uuid));
  }
  for (const li of root.querySelectorAll("li[data-item-id]")) decorate(li, byItem.get(li.dataset.itemId));
}

/** Prepares every actor again (and renders its open sheet) when the rule is turned on or off. */
export function refreshActors(ctx) {
  for (const actor of allActors(ctx.platform.documents)) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      ctx.log.error(`failed to refresh ${actor?.name}`, err);
    }
  }
}
