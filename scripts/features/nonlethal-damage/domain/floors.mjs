/** Prepared pv.min widened by the nonlethal HP. Pure: the record of the widened floors lives in the returned closure. */
import { effectiveNonlethal, nonlethalOf } from "../../../lib/nonlethal.mjs";
import { widenedMin } from "./hp.mjs";

/**
 * One record per installation: pv object → {base, widened}, the floor before and after widening, so a repeated
 * preparation starts from the base.
 */
export function createPreparedFloors() {
  const widenedFloors = new WeakMap();

  /**
   * Puts back the system's floor when the last preparation widened it and nothing changed it since. Some models
   * (SimpleData) never reset pv.min, and prepareData may run more than once without a reset.
   */
  function restorePreparedMin(model) {
    const pv = model?.attributes?.pv;
    const record = pv && widenedFloors.get(pv);
    if (record && pv.min === record.widened) pv.min = record.base;
  }

  /** Lowers the prepared pv.min by the nonlethal HP, so the system's clamps apply to the lethal HP. */
  function widenPreparedMin(model) {
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

  return { restorePreparedMin, widenPreparedMin };
}
