/**
 * Optional rule "Dano não letal" (#55).
 *
 * Book p. 236: nonlethal damage counts to fall unconscious, but not to start bleeding or to die, and healing recovers
 * the HP lost to nonlethal damage first. The system has no nonlethal damage at all.
 *
 * Storage: pv.value keeps the current HP, already including the nonlethal loss, so the token bar and every other
 * automation keep reading "unconscious at 0 HP or less". The nonlethal HP (N) live in an actor flag, written in the
 * same update as the HP. Lethal HP = pv.value + effective N.
 *
 * - Chat: a "Não letal" toggle next to the system's apply buttons of each damage roll. While pressed, 1x, 2x and ½
 *   call the system's own applyDamageV2/applyDamage with a per-call Proxy as `this`: the update carries the intent in
 *   its options and pv.min reads -Infinity, so the nonlethal loss is never cut by the floor.
 * - preUpdateActor: on every HP change (card, token bar, rest, sheet, unlinked tokens), healing consumes N first and
 *   a nonlethal loss is added to N. Healing consumes N even while the rule is off, so the counter never goes stale.
 * - prepareDerivedData: the floor applies to lethal HP only (min base − N).
 * - Sheet: a "Não letal" field under the HP.
 * - The toggle starts pressed when the damage roll recorded a nonlethal choice (#74, nonlethal-attack.mjs).
 *
 * The functions of the lethal HP contract (#51) are exported from here: lethalSnapshot, rebaseSnapshot,
 * hpSnapshotOf, nonlethalOf and touchesLethalHp.
 */
import { MODULE_ID, markWrapper, stripComments, unwrap } from "../utils.mjs";
import { allActors } from "./source-stacking.mjs";

export const NONLETHAL_SETTING = "nonlethalDamageRule";
export const NONLETHAL_FLAG = "nonlethal";
/** roll.options[MODULE_ID][ROLL_DATA_KEY] = {v, nonlethal}: the choice made when attacking (#74). */
export const ROLL_DATA_KEY = "nonlethal";
export const ACTOR_TYPES = Object.freeze(["character", "npc", "simple"]);
export const TOGGLE_CLASS = "t20cp-nonlethal";
export const FIELD_CLASS = "t20cp-nonlethal-field";
const FOOTER_CLASS = "t20cp-nonlethal-footer";

const FLAG_PATH = `flags.${MODULE_ID}.${NONLETHAL_FLAG}`;
const HP_PATH = "system.attributes.pv.value";
const MAX_PATH = "system.attributes.pv.max";
const LOG = `${MODULE_ID} | nonlethal-damage:`;

/* -------------------------------------------- */
/*  Lethal HP contract (shared with #51)        */
/* -------------------------------------------- */

/** Whether the optional rule is on. Safe before the setting is registered (returns false). */
export function ruleEnabled() {
  try {
    return game.settings.get(MODULE_ID, NONLETHAL_SETTING) === "on";
  } catch {
    return false;
  }
}

/**
 * Nonlethal HP that still counts: an integer between 0 and the HP actually missing (max − value).
 * Non-finite inputs count as no nonlethal damage.
 */
export function effectiveNonlethal(nonlethal, value, max) {
  const n = Math.trunc(Number(nonlethal));
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(n) || !Number.isFinite(v) || !Number.isFinite(m)) return 0;
  return Math.min(Math.max(n, 0), Math.max(0, m - v));
}

/** Lethal HP under the rule: current HP plus the nonlethal HP that still counts. */
export function lethalHp(value, nonlethal, max) {
  return Number(value) + effectiveNonlethal(nonlethal, value, max);
}

/** Stored flag, as an integer >= 0. */
export function nonlethalOf(actor) {
  return Math.max(0, Math.trunc(Number(actor?.getFlag?.(MODULE_ID, NONLETHAL_FLAG))) || 0);
}

/**
 * Immutable HP snapshot used by the conditions rule. Keeps the raw flag and the mode, so a snapshot taken under
 * one mode can be recomputed under the other.
 */
export function lethalSnapshot({ value, nonlethal, max, nonlethalOn }) {
  const raw = Math.max(0, Math.trunc(Number(nonlethal)) || 0);
  const n = nonlethalOn ? effectiveNonlethal(raw, value, max) : 0;
  return Object.freeze({ value, rawNonlethal: raw, nonlethal: n, lethal: value + n, max, nonlethalOn: !!nonlethalOn });
}

/** The same confirmed data, seen under another mode. Returns the snapshot itself when the mode matches. */
export function rebaseSnapshot(snapshot, nonlethalOn) {
  if (!snapshot || snapshot.nonlethalOn === !!nonlethalOn) return snapshot;
  return lethalSnapshot({ value: snapshot.value, nonlethal: snapshot.rawNonlethal, max: snapshot.max, nonlethalOn });
}

/** Confirmed snapshot of an actor under the current mode. */
export function hpSnapshotOf(actor) {
  const pv = actor.system?.attributes?.pv ?? {};
  return lethalSnapshot({ value: Number(pv.value), nonlethal: nonlethalOf(actor), max: Number(pv.max), nonlethalOn: ruleEnabled() });
}

/** Whether an update changed anything the snapshot depends on (nested or dotted keys). */
export function touchesLethalHp(changed) {
  return [HP_PATH, MAX_PATH, FLAG_PATH].some((path) => readChange(changed, path).found);
}

/* -------------------------------------------- */
/*  Pure logic                                  */
/* -------------------------------------------- */

/** Floor of the lethal HP: the system's minimum lowered by the nonlethal HP. */
export function widenedMin(baseMin, nonlethal) {
  const min = Number(baseMin);
  if (!Number.isFinite(min)) return baseMin;
  return min - Math.max(0, Math.trunc(Number(nonlethal)) || 0);
}

/**
 * @param {object} p
 * @param {number} p.before         PV stored before the update.
 * @param {number} p.after          PV requested by the update.
 * @param {number} p.nonlethal      Flag stored before the update.
 * @param {number} p.max
 * @param {boolean} p.isNonlethal   The update applies nonlethal damage.
 * @param {number} [p.explicit]     Flag value in the changes, only when it is an explicit edit.
 * @returns {{value: number, nonlethal: number}}
 */
export function resolveHpUpdate({ before, after, nonlethal, max, isNonlethal, explicit }) {
  if (Number.isFinite(explicit)) return { value: after, nonlethal: Math.max(0, Math.trunc(explicit)) };
  const n0 = effectiveNonlethal(nonlethal, before, max);
  if (after > before) return { value: after, nonlethal: Math.max(0, n0 - (after - before)) };
  if (after < before && isNonlethal) return { value: after, nonlethal: n0 + (before - after) };
  return { value: after, nonlethal: n0 };
}

/**
 * Whether the flag value in an update is an edit, and not the unchanged field of a full sheet submission (appv1
 * sends every input). The sheet shows the effective value, so a value equal to the stored or the shown one is not
 * an edit. An empty field counts as 0.
 */
export function isExplicitNonlethalEdit(sent, stored, shown = stored) {
  if (sent === undefined) return false;
  const value = sent === null || sent === "" ? 0 : Math.trunc(Number(sent));
  if (!Number.isFinite(value)) return false;
  const raw = Math.max(0, Math.trunc(Number(stored)) || 0);
  return value !== raw && value !== shown;
}

/**
 * Flag to write in an update, or null to leave the update alone.
 * @param {object} p
 * @param {number} p.before          Stored HP.
 * @param {number} p.stored          Stored flag (integer >= 0).
 * @param {number} p.max            Prepared maximum before the update.
 * @param {number} [p.maxAfter]      Maximum sent in the same update; limits an explicit edit.
 * @param {{found: boolean, value?: unknown}} p.hp     pv.value in the changes.
 * @param {{found: boolean, value?: unknown}} p.flag   The flag in the changes.
 * @param {boolean} p.isNonlethal    Intent carried by the update options.
 * @param {boolean} p.enabled        The rule is on (the intent only counts then).
 */
export function nonlethalForUpdate({ before, stored, max, maxAfter, hp, flag, isNonlethal, enabled }) {
  const shown = effectiveNonlethal(stored, before, max);
  const sent = flag?.found ? flag.value : undefined;
  const explicit = isExplicitNonlethalEdit(sent, stored, shown) ? (sent === null || sent === "" ? 0 : Number(sent)) : undefined;
  const after = Number(hp?.value);
  const hpChanged = hp?.found && Number.isFinite(after) && Number.isFinite(Number(before));
  let next;
  if (hpChanged) {
    next = resolveHpUpdate({ before: Number(before), after, nonlethal: stored, max, isNonlethal: !!(enabled && isNonlethal), explicit }).nonlethal;
  } else if (explicit !== undefined) {
    next = Math.max(0, Math.trunc(explicit));
  } else {
    next = stored;
  }
  // An explicit edit cannot exceed the HP actually missing, so the stored flag never holds HP that do not count.
  if (explicit !== undefined) {
    const limit = Number.isFinite(Number(maxAfter)) ? Number(maxAfter) : max;
    next = effectiveNonlethal(next, hpChanged ? after : before, limit);
  }
  if (!flag?.found && next === stored) return null;
  return next;
}

/** The damage roll the system's button applies (same rule as _onChatApplyDamage). */
export function pickDamageRoll(rolls, title) {
  return (rolls ?? []).find((r) => r?.options?.title === title && (!r.options.type || r.options.type === "damage"));
}

/**
 * Whether a damage method can be called with the per-call Proxy: it reads the HP through `this.system.attributes`,
 * clamps with pv.min, writes pv.value in a single `this.update(` and uses no private fields.
 */
export function recognizesDamageMethod(source) {
  if (typeof source !== "string") return false;
  const code = stripComments(source);
  const updates = code.match(/\bthis\.update\(/g)?.length ?? 0;
  return (
    updates === 1
    && code.includes(`"${HP_PATH}"`)
    && /this\.system\.attributes\b/.test(code)
    && /Math\.clamp\([^;]*\bpv\.min\b/.test(code)
    && !/this\.#/.test(code)
  );
}

function overridePvMin(system, min) {
  const pv = new Proxy(system.attributes.pv, {
    get: (t, k) => (k === "min" ? min : Reflect.get(t, k, t))
  });
  const attributes = new Proxy(system.attributes, {
    get: (t, k) => (k === "pv" ? pv : Reflect.get(t, k, t))
  });
  return new Proxy(system, { get: (t, k) => (k === "attributes" ? attributes : Reflect.get(t, k, t)) });
}

/**
 * `this` for one call of the system's damage methods: its update carries the nonlethal intent and pv.min reads
 * -Infinity. Nothing is shared between calls, and the actor itself is never changed.
 */
export function withNonlethalCall(actor) {
  return new Proxy(actor, {
    get(target, prop) {
      if (prop === "update") {
        return (data, options = {}) => target.update(data, {
          ...options,
          [MODULE_ID]: { ...options?.[MODULE_ID], nonlethal: true }
        });
      }
      if (prop === "system") return overridePvMin(target.system, -Infinity);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target)
  });
}

/* -------------------------------------------- */
/*  Changes (nested or dotted keys)             */
/* -------------------------------------------- */

/**
 * Reads a path from update changes that may mix nested objects and dotted keys.
 * @returns {{found: boolean, value?: unknown}}
 */
export function readChange(obj, path) {
  const parts = Array.isArray(path) ? path : path.split(".");
  if (!obj || typeof obj !== "object") return { found: false };
  for (let i = parts.length; i >= 1; i--) {
    const key = parts.slice(0, i).join(".");
    if (!Object.hasOwn(obj, key)) continue;
    if (i === parts.length) return { found: true, value: obj[key] };
    const inner = readChange(obj[key], parts.slice(i));
    if (inner.found) return inner;
  }
  return { found: false };
}

/** Removes every nested or dotted variant of a path from update changes. */
export function deleteChange(obj, path) {
  const parts = Array.isArray(path) ? path : path.split(".");
  if (!obj || typeof obj !== "object") return;
  for (let i = parts.length; i >= 1; i--) {
    const key = parts.slice(0, i).join(".");
    if (!Object.hasOwn(obj, key)) continue;
    if (i === parts.length) delete obj[key];
    else deleteChange(obj[key], parts.slice(i));
  }
}

/** Writes a path as nested objects. */
export function writeChange(obj, path, value) {
  const parts = Array.isArray(path) ? path : path.split(".");
  let node = obj;
  for (const key of parts.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  node[parts.at(-1)] = value;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const t = (key, data) => (data ? game.i18n.format(`T20CP.NonlethalDamage.${key}`, data) : game.i18n.localize(`T20CP.NonlethalDamage.${key}`));

/** The damage methods were recognized on install; without them the chat toggle is not added. */
let toggleReady = false;
const listened = new WeakSet();

/**
 * preUpdateActor handler. Runs on the client that updates, after the system's _preUpdate, for world actors and the
 * synthetic actors of unlinked tokens (their update is turned into an ActorDelta update after this hook).
 */
export function onPreUpdateActor(actor, changes, options) {
  try {
    if (!ACTOR_TYPES.includes(actor?.type)) return;
    const pv = actor.system?.attributes?.pv;
    if (!pv) return;
    const hp = readChange(changes, HP_PATH);
    const flag = readChange(changes, FLAG_PATH);
    if (!hp.found && !flag.found) return;
    const before = actor._source?.system?.attributes?.pv?.value ?? pv.value;
    const maxChange = readChange(changes, MAX_PATH);
    const next = nonlethalForUpdate({
      before,
      stored: nonlethalOf(actor),
      max: pv.max,
      maxAfter: maxChange.found ? maxChange.value : undefined,
      hp,
      flag,
      isNonlethal: options?.[MODULE_ID]?.nonlethal === true,
      enabled: ruleEnabled()
    });
    if (next === null) return;
    deleteChange(changes, FLAG_PATH);
    writeChange(changes, FLAG_PATH, next);
  } catch (err) {
    console.error(`${LOG} failed to resolve the nonlethal HP of ${actor?.name}`, err);
  }
}

/** pv object → {base, widened}: the floor before and after widening, so a repeated preparation starts from the base. */
const widenedFloors = new WeakMap();

/**
 * Puts back the system's floor when the last preparation widened it and nothing changed it since. Some models
 * (SimpleData) never reset pv.min, and prepareData may run more than once without a reset.
 */
export function restorePreparedMin(model) {
  const pv = model?.attributes?.pv;
  const record = pv && widenedFloors.get(pv);
  if (record && pv.min === record.widened) pv.min = record.base;
}

/** Lowers the prepared pv.min by the nonlethal HP, so the system's clamps apply to the lethal HP. */
export function widenPreparedMin(model) {
  const pv = model?.attributes?.pv;
  if (!pv || typeof pv !== "object") return;
  widenedFloors.delete(pv);
  if (!Number.isFinite(Number(pv.min))) return;
  const n = effectiveNonlethal(nonlethalOf(model.parent), pv.value, pv.max);
  if (n <= 0) return;
  const base = pv.min;
  pv.min = widenedMin(base, n);
  widenedFloors.set(pv, { base, widened: pv.min });
}

function rootOf(html) {
  if (globalThis.HTMLElement && html instanceof HTMLElement) return html;
  return html?.[0] ?? html ?? null;
}

/** Whether the damage roll recorded a nonlethal choice when attacking (#74). */
export function recordedNonlethal(roll) {
  return roll?.options?.[MODULE_ID]?.[ROLL_DATA_KEY]?.nonlethal === true;
}

function createToggle(pressed = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(TOGGLE_CLASS);
  button.setAttribute("aria-pressed", String(!!pressed && ruleEnabled()));
  button.title = t("Toggle");
  button.dataset.tooltip = `${t("Tooltip")} (${t("Reference")})`;
  button.innerHTML = '<i class="fa-solid fa-hand-fist" inert></i>';
  button.hidden = !ruleEnabled();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pressed = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!pressed));
  });
  return button;
}

/** Applies the row's damage as nonlethal to the controlled tokens, like the system's _onChatApplyDamage. */
function applyNonlethal(message, button, row, multiplier) {
  const amount = Number(row.querySelector(".dice-total")?.innerText ?? row.querySelector(".dice-total")?.textContent);
  if (!amount || !multiplier) return;
  const tokens = globalThis.canvas?.tokens?.controlled ?? [];
  if (!tokens.length) return ui.notifications.warn(t("NoTokens"));
  const roll = pickDamageRoll(message?.rolls, row.dataset?.rollTitle);
  return Promise.all(tokens.map(async (token) => {
    const actor = token.actor;
    if (!actor) return;
    const self = withNonlethalCall(actor);
    try {
      if (roll) return await actor.applyDamageV2.call(self, roll, multiplier);
      return await actor.applyDamage.call(self, amount, multiplier, true);
    } catch (err) {
      console.error(`${LOG} failed to apply nonlethal damage to ${actor.name}`, err);
    }
  }));
}

/**
 * Capture listener on the message element: runs before the system's listener on the button. Only acts when the
 * rule is on, the button applies damage (data-mod > 0) and the toggle of the same row is pressed.
 */
export function onCaptureClick(event, message) {
  const button = event.target?.closest?.(".apply-dmg");
  if (!button || !ruleEnabled()) return;
  const multiplier = Number(button.dataset?.mod);
  if (!(multiplier > 0)) return;
  const row = button.closest(".roll");
  const toggle = row?.querySelector(`button.${TOGGLE_CLASS}`);
  if (!toggle || toggle.hidden || toggle.getAttribute("aria-pressed") !== "true") return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return applyNonlethal(message, button, row, multiplier);
}

export function onRenderChatMessage(message, html) {
  try {
    if (!toggleReady) return;
    const root = rootOf(html);
    if (!root?.querySelectorAll) return;
    const containers = root.querySelectorAll(".roll.roll--dano .dice-btn.left");
    if (!containers.length) return;
    for (const container of containers) {
      if (container.querySelector(`button.${TOGGLE_CLASS}`)) continue;
      const row = container.closest?.(".roll");
      container.append(createToggle(recordedNonlethal(pickDamageRoll(message?.rolls, row?.dataset?.rollTitle))));
    }
    if (!listened.has(root)) {
      listened.add(root);
      root.addEventListener("click", (event) => onCaptureClick(event, message), true);
    }
  } catch (err) {
    console.error(`${LOG} failed to add the toggle to the chat card`, err);
  }
}

export function onRenderActorSheet(sheet, html) {
  try {
    if (!ruleEnabled()) return;
    const actor = sheet?.actor;
    if (!ACTOR_TYPES.includes(actor?.type)) return;
    const root = rootOf(html);
    const hpInput = root?.querySelector?.(`input[name="${HP_PATH}"]`);
    const footer = hpInput?.closest("li.attribute.health")?.querySelector("footer.attribute-footer");
    if (!footer || footer.querySelector(`input.${FIELD_CLASS}`)) return;
    const pv = actor.system.attributes.pv;
    const n = effectiveNonlethal(nonlethalOf(actor), pv.value, pv.max);
    const input = document.createElement("input");
    input.type = "number";
    input.name = FLAG_PATH;
    input.classList.add(FIELD_CLASS);
    input.dataset.dtype = "Number";
    input.min = "0";
    input.step = "1";
    input.value = n ? String(n) : "";
    input.placeholder = t("Toggle");
    input.dataset.tooltip = t("Sheet", { nonlethal: n, lethal: Number(pv.value) + n });
    input.disabled = !sheet.isEditable;
    footer.classList.add(FOOTER_CLASS);
    footer.append(input);
  } catch (err) {
    console.error(`${LOG} failed to add the sheet field`, err);
  }
}

/** Shows or hides the chat toggles already drawn (log, notifications and popouts share the document). */
export function syncChatToggles(enabled, doc = globalThis.document) {
  for (const button of doc?.querySelectorAll?.(`button.${TOGGLE_CLASS}`) ?? []) {
    button.hidden = !enabled;
    if (!enabled) button.setAttribute("aria-pressed", "false");
  }
}

function refreshActors() {
  for (const actor of allActors()) {
    try {
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (err) {
      console.error(`${LOG} failed to refresh ${actor?.name}`, err);
    }
  }
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerNonlethalSetting() {
  game.settings.register(MODULE_ID, NONLETHAL_SETTING, {
    name: "T20CP.NonlethalDamage.Setting.Name",
    hint: "T20CP.NonlethalDamage.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: { off: "T20CP.NonlethalDamage.Setting.off", on: "T20CP.NonlethalDamage.Setting.on" },
    default: "off",
    onChange: (value) => {
      syncChatToggles(value === "on");
      refreshActors();
    }
  });
}

/**
 * Installs the rule. Runs after the patches and the other rules, so the prepareDerivedData wrappers sit outside
 * death-threshold's (#29) and widen the floor it sets.
 */
export function installNonlethalRule() {
  const actorProto = CONFIG.Actor?.documentClass?.prototype;
  const sources = ["applyDamageV2", "applyDamage"].map((name) => {
    const fn = actorProto?.[name];
    return typeof fn === "function" ? Function.prototype.toString.call(unwrap(fn)) : undefined;
  });
  toggleReady = sources.every(recognizesDamageMethod);
  if (!toggleReady) console.warn(`${LOG} ActorT20 damage methods not recognized; the chat toggle is disabled`);

  const prototypes = new Set();
  for (const type of ACTOR_TYPES) {
    const proto = CONFIG.Actor?.dataModels?.[type]?.prototype;
    if (proto && Object.hasOwn(proto, "prepareDerivedData")) prototypes.add(proto);
  }
  let warned = false;
  for (const proto of prototypes) {
    const original = proto.prepareDerivedData;
    if (typeof original !== "function") continue;
    proto.prepareDerivedData = markWrapper(function (...args) {
      try {
        restorePreparedMin(this);
      } catch {
        // Never block the system's preparation.
      }
      const result = original.apply(this, args);
      try {
        if (ruleEnabled()) widenPreparedMin(this);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn(`${LOG} could not widen the minimum HP`, err);
        }
      }
      return result;
    }, original);
  }

  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("renderActorSheetT20", onRenderActorSheet);
}
