/**
 * Optional rule "Perícias somente treinadas" (#62).
 *
 * Book (Tormenta20 Jogo do Ano, chapter 2, "Treinamento e testes", p. 114): a skill marked "treinada" can only be used
 * by characters trained in it. The system knows these skills (CONFIG.T20.pericias[key].trainedOnly, the actor's `st`)
 * but ActorT20#rollPericia (T20:7589) never checks them. Warn lets the roll happen, warns whoever rolled once and adds a
 * note to the card; Block stops the test, unless a usage effect that grants training for the test (Eclético, Cultura
 * Exótica) is checked in the use dialog or set to "Aplicar Sempre". Only characters are checked: the training data of
 * menaces is not reliable.
 *
 * Three points: a synchronous check before rollPericia, a validator of the use dialog (use-dialog-guard) and the
 * card note in ActorT20#displayCard. Nothing is kept between calls.
 */
import { MODULE_ID, markWrapper } from "../utils.mjs";
import { installUseDialogGuard, registerUseValidator } from "./use-dialog-guard.mjs";
import { automaticApplied } from "./mana-limit.mjs";
import { skipsDialog } from "./usage-effect-max.mjs";
import { appliedGrant, isTrainedFor, plainUseEffect, skillUseEffects, trainingGrants } from "./skill-training.mjs";

export const TRAINED_ONLY_SETTING = "trainedOnlySkillsRule";
export const TRAINED_ONLY_MODES = ["off", "warn", "block"];

/** Only player characters: menace training data is unreliable. */
export function appliesToActor(actor) {
  return actor?.type === "character";
}

/**
 * Pre-roll decision, before the original rollPericia runs.
 * @returns {{action: "roll", notify: boolean} | {action: "block", reason: "untrained"|"needsDialog"}}
 *   notify: whether the wrapper itself must emit the single Warn notification (paths without the dialog).
 */
export function decideRoll({ mode, required, trained, grants = [], opensDialog }) {
  if (mode === "off" || !required || trained) return { action: "roll", notify: false };
  const automatic = grants.some((g) => g.automatic);
  if (mode === "warn") return { action: "roll", notify: !opensDialog && !automatic };
  if (!grants.length) return { action: "block", reason: "untrained" };
  if (opensDialog || automatic) return { action: "roll", notify: false };
  return { action: "block", reason: "needsDialog" };
}

/** Dialog submit decision: "block" | "warn" | null. */
export function decideDialog({ mode, required, trained, grants = [], applied = {} }) {
  if (mode === "off" || !required || trained || appliedGrant(grants, applied)) return null;
  return mode === "block" ? "block" : "warn";
}

/** Whether the card must carry the note (it never notifies; the notification is emitted elsewhere). */
export function needsCardNote({ mode, required, trained, grants = [], applied = {} }) {
  return mode !== "off" && !!required && !trained && !appliedGrant(grants, applied);
}

/* -------------------------------------------- */
/*  Foundry integration                         */
/* -------------------------------------------- */

const LOG = `${MODULE_ID} | trained-only-skills:`;

function getMode() {
  try {
    const mode = game.settings.get(MODULE_ID, TRAINED_ONLY_SETTING);
    return TRAINED_ONLY_MODES.includes(mode) ? mode : "off";
  } catch {
    return "off";
  }
}

function usageDefault() {
  try {
    return game.settings.get("tormenta20", "UsageConfig") === "default";
  } catch {
    return true;
  }
}

const reference = () => game.i18n.localize("T20CP.TrainedOnly.Reference");

function grantList(grants) {
  const names = [...new Set(grants.map((g) => g.name).filter(Boolean))].map((n) => foundry.utils.escapeHTML(n));
  try {
    return new Intl.ListFormat(game.i18n.lang, { type: "disjunction" }).format(names);
  } catch {
    return names.join(" / ");
  }
}

/**
 * Notification text. ui.notifications renders HTML, so the user-defined names are escaped.
 * @param {object} actor
 * @param {object} skill
 * @param {object[]} grants
 * @param {"blocked"|"openDialog"|"mark"|"warn"} kind
 */
function message(actor, skill, grants, kind) {
  const i18n = game.i18n;
  const escape = foundry.utils.escapeHTML;
  const parts = [
    i18n.format("T20CP.TrainedOnly.Untrained", { actor: escape(actor?.name ?? ""), skill: escape(skill?.label ?? "") })
  ];
  if (kind === "warn") parts.push(i18n.format("T20CP.TrainedOnly.Warned", { reference: reference() }));
  else if (kind === "mark") parts.push(i18n.format("T20CP.TrainedOnly.MarkGrant", { grants: grantList(grants) }));
  else {
    parts.push(i18n.format("T20CP.TrainedOnly.Blocked", { reference: reference() }));
    if (kind === "openDialog") parts.push(i18n.format("T20CP.TrainedOnly.OpenDialog", { grants: grantList(grants) }));
  }
  return parts.join(" ");
}

/**
 * Pre-roll check of rollPericia(key, options).
 * @returns {{action: "roll"|"block", notify?: boolean, message?: string}}
 */
function checkRoll(actor, key, options) {
  const mode = getMode();
  if (mode === "off" || !appliesToActor(actor)) return { action: "roll", notify: false };
  const skill = actor.system?.pericias?.[key];
  if (!skill) return { action: "roll", notify: false };
  const grants = trainingGrants(skillUseEffects(actor, key).map(plainUseEffect));
  const { required, trained } = isTrainedFor({ key, skill, config: CONFIG.T20?.pericias, grants, applied: {} });
  const opensDialog = !skipsDialog({
    usageDefault: usageDefault(),
    shiftKey: !!options?.event?.shiftKey,
    hasEffectsOrRolls: true
  });
  const verdict = decideRoll({ mode, required, trained, grants, opensDialog });
  if (verdict.action === "block") {
    return { ...verdict, message: message(actor, skill, grants, verdict.reason === "needsDialog" ? "openDialog" : "blocked") };
  }
  return verdict.notify ? { ...verdict, message: message(actor, skill, grants, "warn") } : verdict;
}

/** Validator of the use dialog of a skill roll (the item is rollPericia's itemData, T20:7597-7606). */
function validate({ item, formData }) {
  const mode = getMode();
  if (mode === "off" || item?.type !== "pericia" || !appliesToActor(item.actor)) return null;
  const skill = item.actor.system?.pericias?.[item.id];
  if (!skill) return null;
  const grants = trainingGrants((item.applicableOnUseEffects ?? []).map(plainUseEffect));
  const applied = foundry.utils.expandObject(formData ?? {}).aprs ?? {};
  const { required, trained } = isTrainedFor({ key: item.id, skill, config: CONFIG.T20?.pericias });
  const verdict = decideDialog({ mode, required, trained, grants, applied });
  if (!verdict) return null;
  return { message: message(item.actor, skill, grants, verdict === "block" ? "mark" : "warn"), block: verdict === "block" };
}

/** Adds the note to the card's flavor of an untrained test. Only changes the options of its own call. */
function noteCard(actor, options) {
  const itemData = options?.itemData;
  if (itemData?.type !== "pericia") return;
  const mode = getMode();
  if (mode === "off" || !appliesToActor(actor)) return;
  const skill = actor.system?.pericias?.[itemData.id];
  if (!skill) return;
  const grants = trainingGrants((itemData.applicableOnUseEffects ?? []).map(plainUseEffect));
  const applied = options.aprs ?? automaticApplied(grants);
  const { required, trained } = isTrainedFor({ key: itemData.id, skill, config: CONFIG.T20?.pericias });
  if (!needsCardNote({ mode, required, trained, grants, applied })) return;
  const escape = foundry.utils.escapeHTML;
  const note = game.i18n.format("T20CP.TrainedOnly.CardNote", { reference: escape(reference()) });
  const title = escape(game.i18n.format("T20CP.TrainedOnly.Untrained", { actor: actor.name ?? "", skill: skill.label ?? "" }));
  const span = `<span class="t20cp-trained-only" data-tooltip="${title}">${note}</span>`;
  options.chatFlavor = options.chatFlavor ? `${options.chatFlavor} ${span}` : span;
}

/** Registers the world setting. Runs on "init" for every system, so the setting always exists. */
export function registerTrainedOnlySetting() {
  game.settings.register(MODULE_ID, TRAINED_ONLY_SETTING, {
    name: "T20CP.TrainedOnly.Setting.Name",
    hint: "T20CP.TrainedOnly.Setting.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: {
      off: "T20CP.TrainedOnly.Setting.off",
      warn: "T20CP.TrainedOnly.Setting.warn",
      block: "T20CP.TrainedOnly.Setting.block"
    },
    default: "off"
  });
}

/** Installs the rule. The mode is read on every use, so a change applies without reloading. */
export function installTrainedOnlyRule() {
  const proto = CONFIG.Actor?.documentClass?.prototype;
  const roll = proto?.rollPericia;
  const display = proto?.displayCard;
  if (typeof roll !== "function" || typeof display !== "function") throw new Error("ActorT20#rollPericia/displayCard not found");

  installUseDialogGuard();
  registerUseValidator(validate);

  proto.rollPericia = markWrapper(function (...args) {
    let verdict = { action: "roll", notify: false };
    try {
      verdict = checkRoll(this, args[0], args[1]);
    } catch (err) {
      console.error(`${LOG} check failed, the roll goes on`, err);
    }
    if (verdict.action === "block") {
      ui.notifications.warn(verdict.message);
      return Promise.resolve(undefined); // same as the system when the dialog is closed (T20:7627)
    }
    if (verdict.notify) ui.notifications.warn(verdict.message);
    return roll.apply(this, args);
  }, roll);

  proto.displayCard = markWrapper(function (params, ...rest) {
    try {
      noteCard(this, params?.options);
    } catch (err) {
      console.error(`${LOG} failed to add the card note`, err);
    }
    return display.call(this, params, ...rest);
  }, display);
}
