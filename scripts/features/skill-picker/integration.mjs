/** Foundry integration of the skill picker: the item creation wrappers and the per-actor queue, one per install. */
import { MODULE_ID } from "../../lib/module.mjs";
import {
  ActorQueue,
  PICKER_OPERATION,
  SKILL_PICKER_SETTING,
  buildTrainingEffects,
  eligibleSkills,
  findPickerSpec,
  isPickerDone,
  pendingTrainedSkills,
  selectionLimits,
  stalePicks
} from "./domain.mjs";
import { promptSkills } from "./ui.mjs";

function createState(ctx) {
  return {
    platform: ctx.platform,
    queue: new ActorQueue(),
    /** @type {Map<string, () => void>} operation id → release of its actor queue */
    releases: new Map(),
    isEnabled: () => {
      try {
        return ctx.setting(SKILL_PICKER_SETTING) === "on";
      } catch {
        return false;
      }
    }
  };
}

async function pickForOperation(state, documents, operation, user) {
  const { platform } = state;
  if (!state.isEnabled()) return;
  if (user && user.id !== platform.user.id()) return;
  const actor = operation?.parent;
  if (actor?.documentName !== "Actor" || actor.type !== "character" || actor.pack) return;
  const work = documents
    .map((item) => [item, findPickerSpec(item._source)])
    .filter(([item, spec]) => spec && !isPickerDone(item._source));
  if (!work.length) return;

  if (state.queue.isBusy(actor.uuid)) platform.notify.info(platform.i18n.format("T20CP.SkillPicker.Waiting", { actor: actor.name }));
  const release = await state.queue.acquire(actor.uuid);
  const token = operation[PICKER_OPERATION];
  if (token) state.releases.set(token, release);
  try {
    // Trainings already configured in this operation are not on the actor yet; reserve them so no pick is wasted.
    const chosen = new Set(pendingTrainedSkills(documents.map((item) => item._source)));
    for (const [item, spec] of work) await askAndStore(platform, { item, actor, spec, chosen });
  } finally {
    // Without an operation id nothing else releases it; with one, createDocuments does after the server answers.
    if (!token) release();
  }
}

/** Asks until the picks are still available; null when the dialog was closed or nothing can be picked. */
async function askPicks(platform, { item, actor, current }) {
  const { i18n, notify } = platform;
  let options = current();
  while (true) {
    const limits = selectionLimits(item.spec, options.length);
    if (!limits.max) {
      notify.warn(i18n.format("T20CP.SkillPicker.NoSkills", { item: item.name, actor: actor.name }));
      return null;
    }
    const picked = await promptSkills(platform, { itemName: item.name, actorName: actor.name, options, limits });
    if (picked === null) {
      notify.warn(i18n.format("T20CP.SkillPicker.Cancelled", { item: item.name }));
      return null;
    }
    // Revalidate: another client may have trained the actor while the dialog was open.
    options = current();
    if (!stalePicks(picked, options).length) return { picked, options };
    notify.warn(i18n.format("T20CP.SkillPicker.Stale", { item: item.name }));
  }
}

async function askAndStore(platform, { item, actor, spec, chosen }) {
  const { i18n } = platform;
  const current = () =>
    eligibleSkills(actor.system?.pericias, spec, platform.t20Config()?.pericias, (text) => i18n.localize(text), chosen);
  const result = await askPicks(platform, { item: { name: item.name, spec }, actor, current });
  if (!result) return;
  const { picked, options } = result;

  for (const key of picked) chosen.add(key);
  if (spec.alternative && picked.length < spec.max) {
    platform.notify.info(i18n.format("T20CP.SkillPicker.Alternative", { item: item.name, count: picked.length, max: spec.max }));
  }

  const labels = new Map(options.map((option) => [option.key, option.label]));
  const effects = buildTrainingEffects(picked, {
    img: item.img,
    labelOf: (key) => labels.get(key) ?? key,
    randomID: () => platform.utils.randomID()
  });
  item.updateSource({
    effects: [...(item._source.effects ?? []), ...effects],
    [`flags.${MODULE_ID}.skillPicker`]: { done: true, skills: picked }
  });
}

/**
 * Installs the rule.
 * - _preCreateOperation on the system's Item class (ItemT20): the backend calls it on the configured class, once per
 *   operation, after every per-document veto (_preCreate and preCreateItem), with the documents that will really be
 *   sent, and they may be changed with updateSource. The current value (own, e.g. the level-up-multiclass patch, or
 *   inherited from the core) is captured at install time and an own property is set, so any install order chains
 *   both wrappers.
 * - createDocuments on the core base class Item, inherited by ItemT20: each call gets its own operation id, on a copy
 *   of the operation, and releases the actor queue when the call settles.
 * @param {import("../../kernel/feature.mjs").FeatureContext} ctx
 */
export function install(ctx) {
  const cls = ctx.platform.classes.item;
  const base = ctx.platform.core.Item;
  const originalPre = cls?._preCreateOperation;
  const originalCreate = base?.createDocuments;
  if (typeof originalPre !== "function") throw new Error("Item._preCreateOperation not found");
  if (typeof originalCreate !== "function") throw new Error("Item.createDocuments not found");
  for (let c = cls; c && c !== base; c = Object.getPrototypeOf(c)) {
    if (Object.hasOwn(c, "createDocuments")) ctx.log.warn(`${c.name}.createDocuments overrides the wrapped base`);
  }
  const state = createState(ctx);

  ctx.wrap(cls, "_preCreateOperation", async function (originalPre, documents, operation, user) {
    const allowed = await originalPre.call(this, documents, operation, user);
    if (allowed === false) return allowed;
    try {
      await pickForOperation(state, documents, operation, user);
    } catch (err) {
      ctx.log.error("failed", err);
    }
    return allowed;
  });

  ctx.wrap(base, "createDocuments", async function (originalCreate, data = [], operation = {}) {
    if (!state.isEnabled()) return originalCreate.call(this, data, operation);
    const token = ctx.platform.utils.randomID();
    try {
      return await originalCreate.call(this, data, { ...operation, [PICKER_OPERATION]: token });
    } finally {
      state.releases.get(token)?.();
      state.releases.delete(token);
    }
  });
}
