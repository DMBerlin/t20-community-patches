/** Use dialog of "Manobras de combate" (#48): the declared maneuver of a melee attack and its "Manobra" field. */
import { NONLETHAL_FIELD } from "../../../lib/nonlethal.mjs";
import { USE_PURPOSES } from "../../../lib/targets.mjs";
import { isMeleeAttackCard, isVersatile, parseDeclaration, targetProblem, versatileDefault } from "../domain/index.mjs";
import { FIELD_CLASS } from "../ui/classes.mjs";
import { t } from "../ui/cards.mjs";
import { buildUseField } from "../ui/dialogs.mjs";
import { fromUuid, isEnabled } from "./runtime.mjs";

/** Whether a frozen target record is the attacker itself. */
function isSelfTarget(rt, record, actor, speakerToken) {
  const token = fromUuid(rt, record?.uuid);
  if (!token?.actor) return false;
  return token.actor === actor || token.actor.uuid === actor?.uuid || (!!speakerToken && speakerToken === token.id);
}

/** The use of a melee attack may declare a maneuver (not the defender's own test). */
function eligibleUse(rt, item) {
  return (
    isEnabled(rt) &&
    !!item?.actor &&
    rt.uses.usePurposeOf(item) !== USE_PURPOSES.MANEUVER_RESISTANCE &&
    isMeleeAttackCard(item.system)
  );
}

/** Frozen targets of the use and why they cannot take a maneuver (null when valid). */
function useTargetCheck(rt, item) {
  const records = rt.uses.useTargetRecords(item);
  const speakerToken = item.actor?.token?.id ?? null;
  const problem = targetProblem(records, (record) => isSelfTarget(rt, record, item.actor, speakerToken));
  if (problem) return { records, problem };
  return { records, problem: fromUuid(rt, records[0].uuid)?.actor ? null : "Missing" };
}

/**
 * The maneuver declared for this use, after the target checks; a declaration that cannot stand is reported and the
 * use goes on as a normal attack. Only for the per-use clone of ItemT20#roll.
 * @returns {{kind: string, versatile: boolean, record: object} | null}
 */
export function resolveDeclaration(rt, item, options) {
  if (!options || typeof options !== "object" || !rt.uses.inItemUse(item) || !eligibleUse(rt, item)) return null;
  const declared = parseDeclaration(options, { versatileAllowed: isVersatile(item) });
  if (!declared) return null;
  const { records, problem } = useTargetCheck(rt, item);
  if (problem) {
    rt.ctx.platform.notify.warn(t(rt.ctx, "Warn.Fallback", { reason: t(rt.ctx, `Warn.${problem}`) }));
    return null;
  }
  return { ...declared, record: records[0] };
}

/**
 * renderAbilityUseDialog: "Manobra" (and "Arma versátil") after the other attack fields of the module (situational
 * modifiers, nonlethal choice), on eligible melee attacks only.
 */
export function onRenderDialog(rt, app, html) {
  try {
    const item = app?.item;
    const ItemClass = rt.ctx.platform.classes.item;
    if (!ItemClass || !(item instanceof ItemClass) || !eligibleUse(rt, item)) return;
    const root = html?.[0] ?? html;
    const form = root?.querySelector?.("form#ability-use-form") ?? root?.querySelector?.("form");
    if (!form || form.querySelector(`.${FIELD_CLASS}`)) return;
    const { box, select, versatile } = buildUseField(rt.ctx, item, useTargetCheck(rt, item).problem);
    const anchor = form.querySelector(".t20cp-situational") ?? form.querySelector("[name=rollKeep]")?.closest?.(".form-group");
    if (anchor?.after) anchor.after(box);
    else form.append(box);
    select.addEventListener("change", () => {
      if (versatile) versatile.checked = versatileDefault(select.value, item.system?.propriedades);
      // A maneuver deals no damage: the lethal/nonlethal choice (and its -5) does not apply.
      for (const input of form.querySelectorAll(`[name="${NONLETHAL_FIELD}"]`)) input.disabled = !!select.value;
    });
    app.setPosition?.({ height: "auto" });
  } catch (err) {
    rt.ctx.log.error("failed to add the maneuver to the use dialog", err);
  }
}
