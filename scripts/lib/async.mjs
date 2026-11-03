/** Retry of asynchronous lookups (petrified-damage-reduction, prone-defense, condition-skill-lists). */

/**
 * Calls lookup until it returns a document, for the lists the system and patch #1 build asynchronously after ready.
 * @param {() => Promise<object|null|undefined>} lookup
 * @param {{attempts?: number, delay?: number, sleep?: (ms: number) => Promise<void>}} [options]
 */
export async function findWithRetry(lookup, { attempts = 10, delay = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const found = await lookup();
    if (found) return found;
    if (i < attempts - 1) await sleep(delay);
  }
  return null;
}
