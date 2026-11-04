/** Paths in the changes of an update, nested or dotted. Pure. */
export { readChange } from "../../../lib/nonlethal.mjs";

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
