/**
 * Entries the features publish in the module API (`ctx.publish`, #89): `api.rewards` comes from encounter-xp itself.
 * Pure: main.mjs merges the entries into the object it hands to the platform.
 */

/**
 * @param {string[]} reserved  Names main.mjs sets itself (status, wraps…).
 * @returns {{add(name: string, value: object): void, entries(): Record<string, object>}}
 */
export function createPublished(reserved) {
  const taken = new Set(reserved);
  const entries = {};
  return Object.freeze({
    add(name, value) {
      if (typeof name !== "string" || !name) throw new Error("publish: name missing");
      if (taken.has(name)) throw new Error(`publish: api.${name} is already taken`);
      taken.add(name);
      entries[name] = value;
    },
    entries: () => ({ ...entries })
  });
}
