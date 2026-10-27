/**
 * Usage buff templates (tormenta20 1.6.5).
 *
 * Bug: spells, powers, items and partners model the buff they grant (Arma Mágica, Óleo de Arma Mágica, Duelo…) as a
 * temporary usage effect stored disabled in the item. applyOnUseEffects only sends enabled effects to the chat card
 * (a disabled one only goes when an "efeito" change names it, and none does), the weapon choice (`?.items.arma`)
 * never opens in v14, the applied buff is never automatic, and `system.*` changes of a usage effect never reach the
 * prepared data.
 *
 * Fix: on the rolled item's clone only, each eligible template is enabled in memory: attack buffs become automatic,
 * buffs made only of `system.*` changes become plain temporary effects, several templates of one item are labeled by
 * their description, and an official all-zero placeholder with the same name is hidden. A weapon buff asks for the
 * weapon when it is applied (a single wielded weapon is chosen silently) and is offered only on that weapon.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { plainText } from "./linked-usage-effects.mjs";

export const WEAPON_FLAG = "buffWeapon";
export const PENDING = "pending";
const WEAPON_CHOICE = /^\?\.items\.arma$/;
const CHOICE_KEY = /^\?/;
const PASSIVE_KEY = /^system\./;
const ATTACK_KEY = /^(ataque|dano)(&\w+)?$/;
const SKILL_ATTRIBUTE_KEY = /^system\.modificadores\.pericias\.(for|des|con|int|sab|car)$/;

/**
 * Values of the "efeito" changes of an item's effects: templates named by one are reached through that change.
 * @param {Iterable<{system?: {changes?: {key?: string, value?: unknown}[]}}>} effects
 * @returns {Set<string>}
 */
export function linkedTemplateValues(effects) {
  const values = new Set();
  for (const effect of effects ?? []) {
    for (const change of effect?.system?.changes ?? []) {
      if (change?.key === "efeito" && change.value != null) values.add(String(change.value).trim());
    }
  }
  return values;
}

/**
 * Whether an item effect is a buff template the card must offer.
 * @param {{onuse?: boolean, temporary?: boolean, disabled?: boolean, name?: string, description?: string,
 *   names?: Iterable<string>}} effect
 * @param {{itemName?: string, linked?: Set<string>}} context
 * @returns {boolean}
 */
export function isBuffTemplate(effect, { itemName, linked = new Set() } = {}) {
  if (!effect?.onuse || !effect.temporary || !effect.disabled) return false;
  if (linked.has(String(effect.name ?? "").trim()) || linked.has(plainText(effect.description))) return false;
  // A template offered on its own item's later uses (Arma Espiritual2) is not a buff for the card.
  return ![...(effect.names ?? [])].includes(itemName);
}

/**
 * How the applied buff works: "weapon" (one chosen weapon), "passive" (only `system.*` changes, applied to the
 * prepared data) or "usage" (attack, damage and other roll changes).
 * @param {{key?: string}[]} changes
 * @returns {"weapon"|"passive"|"usage"}
 */
export function buffFamily(changes) {
  const list = [...(changes ?? [])];
  if (list.some((c) => WEAPON_CHOICE.test(c?.key ?? ""))) return "weapon";
  const keys = list.map((c) => String(c?.key ?? "")).filter((key) => !CHOICE_KEY.test(key));
  if (keys.length && keys.every((key) => PASSIVE_KEY.test(key))) return "passive";
  return "usage";
}

/**
 * An attack or damage template that names neither a roll type nor an item is never offered by the system
 * (Comandar); it is meant for attacks.
 * @param {{types?: Iterable<string>, names?: Iterable<string>, changes?: {key?: string}[]}} template
 * @returns {boolean}
 */
export function needsAttackType({ types, names, changes } = {}) {
  if ([...(types ?? [])].length || [...(names ?? [])].length) return false;
  return [...(changes ?? [])].some((c) => ATTACK_KEY.test(String(c?.key ?? "")));
}

/**
 * The skill bonus by attribute lives in `system.modificadores.pericias.atr.<attribute>`; Folião's template writes to
 * `system.modificadores.pericias.<attribute>`, which nothing reads.
 * @param {string} key
 * @returns {string}
 */
export function skillAttributeKey(key) {
  return String(key ?? "").replace(SKILL_ATTRIBUTE_KEY, "system.modificadores.pericias.atr.$1");
}

/**
 * The card sums changes with the same key as numbers (T20:6592), so a dice bonus appended to a template by an
 * enhancement (Arma Mágica +1d6, then +2d6) becomes NaN. Merges an "add" change into an existing "add" of the same
 * key as one formula when either value is not a number.
 * @param {{key?: string, type?: string, value?: unknown}[]} changes
 * @param {{key?: string, type?: string, value?: unknown}} change
 * @returns {boolean} Whether the change was merged
 */
export function mergeDiceChange(changes, change) {
  if (change?.type !== "add" || !change.key) return false;
  const text = String(change.value ?? "").trim();
  if (!text) return false;
  const target = [...(changes ?? [])].find((c) => c?.key === change.key && c.type === "add" && String(c.value ?? "").trim());
  if (!target) return false;
  const current = String(target.value).trim();
  if (Number.isFinite(Number(current)) && Number.isFinite(Number(text))) return false;
  target.value = `${current} + ${text}`;
  return true;
}

/**
 * Card labels: a template whose name repeats among the item's templates is labeled by its description (or by its
 * position when the description does not tell them apart).
 * @param {{id: string, name?: string, description?: string}[]} templates
 * @returns {Map<string, string>}
 */
export function templateLabels(templates) {
  const byName = new Map();
  for (const t of templates ?? []) {
    const name = String(t?.name ?? "");
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(t);
  }
  const labels = new Map();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0].id, name);
      continue;
    }
    const texts = group.map((t) => plainText(t.description));
    group.forEach((t, i) => {
      const text = texts[i];
      const unique = text && text !== name && texts.indexOf(text) === texts.lastIndexOf(text);
      labels.set(t.id, `${name} (${unique ? text : i + 1})`);
    });
  }
  return labels;
}

/**
 * An enabled, non-usage effect with a template's name whose changes are all zero: the official "+0" button of
 * Botas Aladas and Poção de Escudo da Fé, hidden when the real buff is offered.
 * @param {{onuse?: boolean, disabled?: boolean, name?: string, changes?: {value?: unknown}[]}} effect
 * @param {Set<string>} templateNames
 * @returns {boolean}
 */
export function isZeroPlaceholder(effect, templateNames) {
  if (!effect || effect.onuse || effect.disabled || !templateNames?.has(effect.name)) return false;
  const changes = [...(effect.changes ?? [])];
  return changes.length > 0 && changes.every((c) => String(c?.value ?? "").trim() !== "" && Number(c.value) === 0);
}

/**
 * Which weapon receives the buff: the only wielded weapon is chosen without asking; otherwise every weapon is
 * offered, wielded ones first.
 * @param {{id: string, name: string, wielded?: boolean}[]} weapons
 * @returns {{auto: string}|{choices: {id: string, name: string, wielded: boolean}[]}|{none: true}}
 */
export function planWeaponChoice(weapons) {
  const list = [...(weapons ?? [])].filter((w) => w?.id).map((w) => ({ id: w.id, name: String(w.name ?? ""), wielded: !!w.wielded }));
  if (!list.length) return { none: true };
  const wielded = list.filter((w) => w.wielded);
  if (wielded.length === 1) return { auto: wielded[0].id };
  return { choices: [...wielded, ...list.filter((w) => !w.wielded)] };
}

/**
 * Source update that binds a weapon buff to one weapon: offered by name (works without the module) and tagged with
 * the weapon id (so a same-named weapon is skipped); the inert `?` choice change is removed.
 * @param {{name?: string, changes?: object[]}} effect
 * @param {{id: string, name: string}} weapon
 * @returns {object}
 */
export function weaponBinding(effect, weapon) {
  return {
    name: `${effect?.name ?? ""} (${weapon.name})`,
    "system.abilityUse.names": [weapon.name],
    "system.abilityUse.types": [],
    "system.abilityUse.automatic": true,
    "system.changes": [...(effect?.changes ?? [])].filter((c) => !CHOICE_KEY.test(String(c?.key ?? ""))),
    [`flags.${MODULE_ID}.${WEAPON_FLAG}`]: weapon.id
  };
}

/**
 * Whether a usage effect bound to a weapon must not be offered on the rolled item: it belongs to another weapon, even
 * one that is gone (a same-named weapon never inherits the buff).
 * @param {string|undefined} boundId
 * @param {string} rolledId
 * @returns {boolean}
 */
export function isForOtherWeapon(boundId, rolledId) {
  if (typeof boundId !== "string" || !boundId || boundId === PENDING) return false;
  return boundId !== rolledId;
}

const INCREASE_KEY = /^efeito\.(\w+)$/;
const isNumber = (value) => String(value ?? "").trim() !== "" && Number.isFinite(Number(value));

/**
 * An enhancement that increases a buff (abilityUse.aumenta) only reaches the template when the template already has
 * its key (T20:6475), but Duelo's enhancement writes `efeito.ataque` to raise the template's `ataque`, which the card
 * sums back into `ataque` (T20:6560). Returns the "+0" `efeito.<key>` markers the template needs for that comparison.
 * @param {{key?: string, type?: string, value?: unknown}[]} templateChanges
 * @param {{key?: string, type?: string, value?: unknown}[]} increaseChanges  Changes of the item's aumenta effects
 * @returns {{key: string, type: "add", value: 0, priority: 0}[]}
 */
export function increaseMarkers(templateChanges, increaseChanges) {
  const own = [...(templateChanges ?? [])];
  const markers = [];
  for (const change of increaseChanges ?? []) {
    const match = INCREASE_KEY.exec(String(change?.key ?? ""));
    if (!match || change.type !== "add" || !isNumber(change.value)) continue;
    const key = change.key;
    if (own.some((c) => c?.key === key) || markers.some((m) => m.key === key)) continue;
    if (!own.some((c) => c?.key === match[1] && c.type === "add" && isNumber(c.value))) continue;
    markers.push({ key, type: "add", value: 0, priority: 0 });
  }
  return markers;
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const prepared = new WeakSet();

const sourceChanges = (effect) => effect?._source?.system?.changes ?? effect?.system?.changes ?? [];

/** Enables the eligible templates of the rolled clone; the live item is never touched. */
function prepareClone(item) {
  if (prepared.has(item)) return;
  prepared.add(item);
  const live = item.actor.items.get(item.id);
  const effects = [...item.effects].filter((e) => live.effects.has(e.id));
  const linked = linkedTemplateValues(effects);
  const templates = effects.filter((e) =>
    isBuffTemplate(
      {
        onuse: e.system?.onuse,
        temporary: e.isTemporary,
        disabled: e.disabled,
        name: e.name,
        description: e.description,
        names: e.system?.abilityUse?.names
      },
      { itemName: item.name, linked }
    )
  );
  if (!templates.length) return;
  const names = new Set(templates.map((t) => t.name));
  for (const effect of effects) {
    const data = { onuse: effect.system?.onuse, disabled: effect.disabled, name: effect.name, changes: sourceChanges(effect) };
    if (isZeroPlaceholder(data, names)) effect.updateSource({ disabled: true });
  }
  const increases = effects
    .filter((e) => e.system?.onuse && e.system?.abilityUse?.aumenta && !templates.includes(e))
    .flatMap((e) => sourceChanges(e));
  const labels = templateLabels(templates.map((t) => ({ id: t.id, name: t.name, description: t.description })));
  for (const template of templates) {
    const family = buffFamily(sourceChanges(template));
    const update = { disabled: false, name: labels.get(template.id) ?? template.name };
    if (family === "passive") update["system.onuse"] = false;
    else update["system.abilityUse.automatic"] = true;
    if (family === "weapon") update[`flags.${MODULE_ID}.${WEAPON_FLAG}`] = PENDING;
    const changes = sourceChanges(template);
    if (family === "passive" && changes.some((c) => skillAttributeKey(c?.key) !== c?.key)) {
      update["system.changes"] = changes.map((c) => ({ ...c, key: skillAttributeKey(c?.key) }));
    }
    const markers = family === "passive" ? [] : increaseMarkers(changes, increases);
    if (markers.length) update["system.changes"] = [...changes.map((c) => ({ ...c })), ...markers];
    if (family === "usage" && needsAttackType({ types: template.system?.abilityUse?.types, names: template.system?.abilityUse?.names, changes })) {
      update["system.abilityUse.types"] = ["attack"];
    }
    template.updateSource(update);
    mergeAppendedDice(template.system?.changes);
  }
}

/** Enhancements append to the template's changes array (addToChange); dice are merged instead of summed to NaN. */
function mergeAppendedDice(changes) {
  if (!Array.isArray(changes)) return;
  Object.defineProperty(changes, "push", {
    configurable: true,
    writable: true,
    value(...items) {
      for (const item of items) if (!mergeDiceChange(this, item)) Array.prototype.push.call(this, item);
      return this.length;
    }
  });
}

const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function askWeapon(effectName, actor, choices) {
  const options = choices
    .map((w) => `<option value="${escapeHTML(w.id)}">${escapeHTML(w.name)}${w.wielded ? ` (${escapeHTML(game.i18n.localize("T20CP.UsageBuffTemplates.Wielded"))})` : ""}</option>`)
    .join("");
  const label = escapeHTML(game.i18n.localize("T20CP.UsageBuffTemplates.Weapon"));
  const content = `<p>${escapeHTML(game.i18n.format("T20CP.UsageBuffTemplates.Prompt", { effect: effectName, actor: actor.name }))}</p>
    <div class="form-group"><label>${label}</label><select name="weapon">${options}</select></div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: effectName },
    content,
    buttons: [
      {
        action: "apply",
        label: game.i18n.localize("T20CP.UsageBuffTemplates.Apply"),
        default: true,
        callback: (event, button) => button.form.elements.weapon.value
      },
      { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
}

/** Binds a pending weapon buff before creation. Returns false when nothing can or should be created. */
async function bindWeapon(effect, data) {
  if (foundry.utils.getProperty(data ?? {}, `flags.${MODULE_ID}.${WEAPON_FLAG}`) !== PENDING) return;
  const actor = effect.parent;
  if (actor?.documentName !== "Actor") return;
  const weapons = (actor.itemTypes?.arma ?? actor.items.filter((i) => i.type === "arma")).map((w) => ({
    id: w.id,
    name: w.name,
    wielded: !w.areEffectsSuppressed
  }));
  const plan = planWeaponChoice(weapons);
  if (plan.none) {
    ui.notifications?.warn(game.i18n.format("T20CP.UsageBuffTemplates.NoWeapon", { effect: effect.name, actor: actor.name }));
    return false;
  }
  const id = plan.auto ?? (await askWeapon(effect.name, actor, plan.choices));
  const weapon = id ? actor.items.get(id) : null;
  if (!weapon) return false;
  effect.updateSource(weaponBinding({ name: effect.name, changes: effect._source?.system?.changes ?? [] }, weapon));
}

function apply() {
  const ItemClass = CONFIG.Item.documentClass;
  const original = ItemClass.prototype._allApplicableOnUseEffects;
  if (typeof original !== "function") throw new Error("Tormenta20 usage effect API not found");
  const effectProto = CONFIG.ActiveEffect?.documentClass?.prototype;
  const preCreate = effectProto?._preCreate;
  if (typeof preCreate !== "function") throw new Error("ActiveEffect#_preCreate not found");

  // `this` is the rolled item's clone (ItemT20#roll) when the actor's item with the same id is another object.
  ItemClass.prototype._allApplicableOnUseEffects = markWrapper(function (...args) {
    const live = this.isEmbedded ? this.actor?.items?.get(this.id) : null;
    if (live && live !== this && this.effects) {
      try {
        prepareClone(this);
      } catch (err) {
        console.warn(`${MODULE_ID} | usage-buff-templates: failed to prepare the buff templates`, err);
      }
    }
    const effects = original.apply(this, args);
    if (!Array.isArray(effects) || !this.actor?.items) return effects;
    try {
      const kept = effects.filter((e) => !isForOtherWeapon(e?.flags?.[MODULE_ID]?.[WEAPON_FLAG], this.id));
      // The name binding is lost when the weapon is renamed; the id binding still reaches it.
      for (const effect of this.actor.effects ?? []) {
        if (!effect?.system?.onuse || effect.flags?.[MODULE_ID]?.[WEAPON_FLAG] !== this.id) continue;
        if (kept.some((e) => e?.id === effect.id && e.parent?.id === effect.parent?.id)) continue;
        // A copy, as the system mutates the changes of the effects it applies.
        kept.push(effect.clone({}, { keepId: true }));
      }
      return kept;
    } catch (err) {
      console.warn(`${MODULE_ID} | usage-buff-templates: failed to filter weapon buffs`, err);
      return effects;
    }
  }, original);

  effectProto._preCreate = markWrapper(async function (...args) {
    const [data, , user] = args;
    if (!user || user.id === game.user?.id) {
      let allowed;
      try {
        allowed = await bindWeapon(this, data);
      } catch (err) {
        console.warn(`${MODULE_ID} | usage-buff-templates: failed to bind the weapon`, err);
      }
      if (allowed === false) return false;
    }
    return preCreate.apply(this, args);
  }, preCreate);
}

/** applyOnUseEffects is module-local in the system bundle, so the card filter cannot be probed during init. */
function isNeeded() {
  return { bug: "unknown", confidence: "low", evidence: "applyOnUseEffects is module-local" };
}

/** Arma Mágica's template in the spell compendium: still disabled means the data side of the bug is present. */
async function lateProbe() {
  const pack = game.packs.get("tormenta20.magias");
  const item = await pack?.getDocument("YDxLaaDhfXOkSfnF");
  const template = item?.effects?.get("Mz54PvtVdDzg7kl3");
  if (!template?.system?.onuse || !template.isTemporary) return undefined;
  if (template.disabled) {
    return { bug: "present", confidence: "low", evidence: "tormenta20.magias: Arma Mágica template is disabled" };
  }
  return { bug: "fixed", confidence: "low", evidence: "tormenta20.magias: Arma Mágica template is enabled" };
}

export default {
  id: "usage-buff-templates",
  group: "usage-effects",
  issue: 66,
  system: { id: "tormenta20", affected: { minimum: "1.6.5", maximum: "1.6.6" } },
  isNeeded,
  lateProbe,
  apply
};
