/**
 * Pure decisions of the "Perícias somente treinadas" rule (#62): who is checked, and whether a roll, a dialog submit
 * or a card is blocked, warned or noted.
 */
import { appliedGrant } from "../../lib/skill-training.mjs";

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
