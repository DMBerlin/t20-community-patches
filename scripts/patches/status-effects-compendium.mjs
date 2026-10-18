/**
 * Empty condition list (tormenta20 1.6.5).
 *
 * Bug: prepareStatusesCompendium copies conditions from `tormenta20.efeitos` filtering by folder
 * "69zW3EVSgASXTmsp", which does not exist in the 1.6.5 pack (conditions live in "STATUSEFFECTS000").
 * `world.statuses` stays empty, CONFIG.statusEffects ends up empty and the routine throws before setting
 * specialStatusEffects and locking the pack.
 *
 * Fix: when the system copies an empty list into an empty `world.statuses`, the copy is replaced by the
 * conditions of the system pack, so the system's own routine builds CONFIG and locks the pack. Clients that
 * were connected during the repair rebuild CONFIG.statusEffects when the pack is filled.
 */

export const STATUS_PACK = "world.statuses";
export const SOURCE_PACK = "tormenta20.efeitos";
export const CONDITION_FOLDER = "STATUSEFFECTS000";
const LOG = "t20-community-patches | status-effects-compendium:";

/**
 * Picks the condition sources from the system pack data (results of `toObject()`).
 * Conditions are the effects with statuses inside the "Condições" folder; if that folder is not found,
 * every effect with statuses is used. Copies go to the pack root.
 * @param {object[]} sources
 * @returns {object[]}
 */
export function selectConditionSources(sources) {
  const withStatuses = sources.filter((s) => (s?.statuses?.length ?? 0) > 0);
  const inFolder = withStatuses.filter((s) => s.folder === CONDITION_FOLDER);
  return (inFolder.length ? inFolder : withStatuses).map((s) => ({ ...s, folder: null }));
}

/**
 * Only the system's empty copy into an empty `world.statuses`, made by the active GM, is replaced.
 * @param {unknown} data
 * @param {object} operation
 * @param {{indexSize: number, isActiveGM: boolean}} state
 * @returns {boolean}
 */
export function shouldSubstitute(data, operation, { indexSize, isActiveGM }) {
  return (
    isActiveGM === true &&
    operation?.pack === STATUS_PACK &&
    Array.isArray(data) &&
    data.length === 0 &&
    indexSize === 0
  );
}

/**
 * Whether a client should rebuild CONFIG.statusEffects after a compendium update.
 * The client that wrote the documents runs the system's routine itself.
 * @param {{collection: string, userId: string, currentUserId: string, hasUnconscious: boolean}} state
 * @returns {boolean}
 */
export function shouldRebuild({ collection, userId, currentUserId, hasUnconscious }) {
  return collection === STATUS_PACK && userId !== currentUserId && !hasUnconscious;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

let substituted = false;
let rebuilding = false;
let rebuildPending = false;

function wrapCreateDocuments() {
  const Base = foundry.documents.ActiveEffect;
  const original = Base.createDocuments;
  Base.createDocuments = async function (data = [], operation = {}) {
    if (!substituted) {
      try {
        if (
          shouldSubstitute(data, operation, {
            indexSize: game.packs.get(STATUS_PACK)?.index?.size ?? -1,
            isActiveGM: game.user?.isActiveGM
          })
        ) {
          substituted = true;
          const docs = (await game.packs.get(SOURCE_PACK)?.getDocuments()) ?? [];
          data = selectConditionSources(docs.map((d) => d.toObject()));
          console.log(`${LOG} filling ${STATUS_PACK} with ${data.length} conditions`);
        }
      } catch (err) {
        console.error(`${LOG} could not read ${SOURCE_PACK}; keeping the system's data`, err);
      }
    }
    return original.call(this, data, operation);
  };
}

/** Mirrors the system's CONFIG preparation (prepareStatusesCompendium) without writing to or locking the pack. */
async function rebuildStatusEffects() {
  if (rebuilding) {
    rebuildPending = true;
    return;
  }
  rebuilding = true;
  try {
    do {
      rebuildPending = false;
      if (CONFIG.statusEffects?.inconsciente) return;
      const pack = game.packs.get(STATUS_PACK);
      if (!pack) return;
      const docs = await pack.getDocuments();
      if (!docs.some((d) => d.statuses?.has("inconsciente"))) continue;
      const TextEditor = foundry.applications.ux.TextEditor.implementation;
      const entries = [];
      for (const effect of docs) {
        const id = effect.statuses.first();
        if (!id) continue;
        entries.push({
          id,
          uuid: effect.uuid,
          name: effect.name,
          img: effect.img,
          link: effect.toAnchor().outerHTML,
          category: effect.system.status?.category,
          description: await TextEditor.enrichHTML(effect.description),
          _source: effect.clone({}, { keepId: false }).toObject()
        });
      }
      // Swapped in one synchronous step: the core setter (client/client.mjs) empties the list and pushes every entry.
      CONFIG.statusEffects = entries;
      CONFIG.controlIcons.defeated = CONFIG.statusEffects.inconsciente.img;
      CONFIG.specialStatusEffects.BLIND = "cego";
      CONFIG.specialStatusEffects.DEFEATED = "morto";
      CONFIG.specialStatusEffects.INVISIBLE = "invisivel";
      const hud = canvas?.hud?.token;
      if (hud?.rendered) hud.render();
      console.log(`${LOG} rebuilt CONFIG.statusEffects with ${entries.length} conditions`);
    } while (rebuildPending);
  } catch (err) {
    console.error(`${LOG} could not rebuild CONFIG.statusEffects`, err);
  } finally {
    rebuilding = false;
  }
}

function apply() {
  wrapCreateDocuments();
  const debouncedRebuild = foundry.utils.debounce(rebuildStatusEffects, 250);
  Hooks.on("updateCompendium", (pack, _documents, _operation, userId) => {
    if (
      shouldRebuild({
        collection: pack?.collection,
        userId,
        currentUserId: game.user?.id,
        hasUnconscious: Boolean(CONFIG.statusEffects?.inconsciente)
      })
    ) {
      debouncedRebuild();
    }
  });
}

/**
 * The broken copy lives in a local function of the system and the packs only load after "init", so the bug
 * cannot be probed here. Both interceptions only act when the bug shows up (an empty copy into an empty
 * `world.statuses`, or a client left without conditions after the pack is filled).
 * @returns {boolean}
 */
function isNeeded() {
  return true;
}

export default {
  id: "status-effects-compendium",
  group: "conditions",
  issue: 1,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.5" } },
  isNeeded,
  apply
};
