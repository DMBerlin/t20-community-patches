/**
 * Keeps the rule profile honest (#96): the guard turns `rulesProfile` into "custom" when a rule changes outside the
 * Center (a macro, another module), and a new world starts on the recommended profile. Pure: the settings, the user,
 * the listeners and the timers come in by parameter.
 */
import { CUSTOM, PROFILE_SETTING, profileDiff, profileKeys, readProfileValues, resolveProfile, saveProfile } from "./profiles.mjs";

/** Waits this long after the last change before checking, so a batch of writes is checked once. */
export const GUARD_DELAY = 300;

const defaultTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle) };

/**
 * @typedef {object} GuardDeps
 * @property {{get: (key: string) => unknown, set: (key: string, value: unknown) => Promise<unknown>}} settings
 * @property {{isActiveGM: () => boolean}} user
 * @property {import("./profiles.mjs").ProfileValues} profiles
 * @property {{error: Function}} [log]
 * @property {{set: Function, clear: Function}} [timers]
 * @property {number} [delay]
 */

/**
 * World settings change on every client, whoever wrote them (core Setting#_onUpdate), so only the active GM writes,
 * and it checks that right before writing. It only ever writes "custom", never a ready-made profile. Checks run one at
 * a time: a change during a check schedules another.
 * @param {GuardDeps} deps
 */
export function createProfileGuard({ settings, user, profiles, log, timers = defaultTimers, delay = GUARD_DELAY }) {
  let timer = null;
  let queued = null;
  let chain = Promise.resolve();

  /**
   * Runs `task` after every check and save queued before it, so a pending "custom" never lands after a profile saved
   * later in this client. Profile saves (the Center, a new world) go through here too.
   * @template T
   * @param {() => Promise<T>|T} task
   * @returns {Promise<T>}
   */
  function exclusive(task) {
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  }

  async function verify() {
    if (!user.isActiveGM()) return;
    const stored = settings.get(PROFILE_SETTING);
    if (stored === CUSTOM) return;
    const values = readProfileValues(settings.get, profiles);
    if (resolveProfile({ stored, values, profiles }) !== CUSTOM) return;
    if (!user.isActiveGM() || settings.get(PROFILE_SETTING) !== stored) return;
    await settings.set(PROFILE_SETTING, CUSTOM);
  }

  /** Queues a check; a check queued and not started yet already covers this call. */
  function check() {
    if (queued) return queued;
    queued = exclusive(() => {
      queued = null;
      return verify();
    }).catch((err) => log?.error("Failed to check the rule profile", err));
    return queued;
  }

  function schedule() {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      check();
    }, delay);
  }

  /**
   * Checks after any change of a profile key or of the profile itself.
   * @param {{on: (key: string, fn: Function) => () => void}} listeners  createSettingListeners (settings.mjs).
   * @returns {() => void} Stops listening.
   */
  function listen(listeners) {
    const off = [PROFILE_SETTING, ...profileKeys(profiles)].map((key) => listeners.on(key, schedule));
    return () => off.forEach((fn) => fn());
  }

  /**
   * Checks again when the active GM may have changed (a user connects or disconnects, a role changes): the new one
   * may have checked while it had no authority, and nothing else would make it check again.
   * @param {{on: (name: string, fn: Function) => unknown}} hooks
   */
  function watchAuthority(hooks) {
    for (const name of ["userConnected", "updateUser"]) hooks.on(name, () => schedule());
  }

  return Object.freeze({ check, schedule, listen, exclusive, watchAuthority });
}

/**
 * A new world (nothing of this module saved when "init" ran) starts on the recommended profile, saved by the active
 * GM with the "custom first" protocol. Another client saves nothing: the next active GM still finds the world new.
 * @param {object} deps
 * @param {boolean} deps.fresh  Nothing of this module was saved in the world on "init".
 * @param {GuardDeps["settings"]} deps.settings
 * @param {GuardDeps["user"]} deps.user
 * @param {import("./profiles.mjs").RuleProfiles} deps.catalog
 * @param {(key: string) => boolean} deps.requiresReload  Whether a setting is registered with requiresReload.
 * @param {(key: string) => boolean} deps.isStored  Whether a setting is saved in the world, and not just its default.
 * @returns {Promise<{saved: boolean, reload: boolean}>} reload: a written setting needs a world reload.
 */
export async function applyInitialProfile({ fresh, settings, user, catalog, requiresReload, isStored }) {
  if (!fresh || !user.isActiveGM()) return { saved: false, reload: false };
  const { values: profiles, recommended } = catalog;
  const writes = profileDiff(profiles, recommended, readProfileValues(settings.get, profiles)).map(({ key, to }) => ({ key, value: to }));
  // Authority can move to another GM between writes, and another client may have saved a profile since "init" (only
  // this protocol's last write saves the profile here): either stops the writes, leaving "custom".
  const canWrite = () => user.isActiveGM() && !isStored(PROFILE_SETTING);
  const saved = await saveProfile({ settings, profiles, target: recommended, writes, canWrite });
  if (saved === null) return { saved: false, reload: false };
  return { saved: true, reload: writes.some(({ key }) => requiresReload(key)) };
}
