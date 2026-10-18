export const MODULE_ID = "t20-community-patches";

/**
 * Compare dotted numeric versions ("1.6.5"). Returns <0, 0 or >0.
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Whether the installed system version is inside the range known to contain the bug.
 * A patch is only applied inside this range, so an official fix in a newer release is never doubled.
 * @param {string} version
 * @param {{minimum?: string, maximum?: string}} affected
 */
export function isSystemVersionAffected(version, { minimum, maximum } = {}) {
  if (minimum && compareVersions(version, minimum) < 0) return false;
  if (maximum && compareVersions(version, maximum) > 0) return false;
  return true;
}
