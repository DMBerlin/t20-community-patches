import { GROUPS, PATCHES } from "./patches/index.mjs";
import { MODULE_ID } from "./utils.mjs";
import { APPLY_STATES, resolvePatchState, shouldNotify } from "./registry.mjs";
import { SETTINGS, isPatchEnabled, registerSettings } from "./settings.mjs";

/** @type {{id: string, group: string, state: import("./registry.mjs").PatchState, reason?: string}[]} */
const status = [];

Hooks.once("init", () => {
  registerSettings();

  // Patches are installed during "init": the system has already registered its classes in CONFIG,
  // and world documents are only prepared after this hook.
  for (const patch of PATCHES) {
    let { state, reason } = resolvePatchState({
      patch,
      enabled: isPatchEnabled(patch.id),
      systemId: game.system.id,
      systemVersion: game.system.version,
      probe: patch.isNeeded
    });

    if (APPLY_STATES.has(state)) {
      try {
        patch.apply();
        console.log(`${MODULE_ID} | Patch applied: ${patch.id}${state === "applied-unverified" ? " (unverified system version)" : ""}`);
      } catch (err) {
        state = "error";
        reason = err.message;
        console.error(`${MODULE_ID} | Failed to apply patch: ${patch.id}`, err);
      }
    } else {
      console.log(`${MODULE_ID} | Patch not applied: ${patch.id} (${state}${reason ? `: ${reason}` : ""})`);
    }
    status.push({ id: patch.id, group: patch.group, state, reason });
  }

  game.modules.get(MODULE_ID).api = { status, groups: GROUPS };
});

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const previous = game.settings.get(MODULE_ID, SETTINGS.lastStatus) ?? {};
  for (const { id, state, reason } of status) {
    if (!shouldNotify(state, previous[id])) continue;
    const name = game.i18n.localize(`T20CP.Patches.${id}.Name`);
    const message = game.i18n.format(`T20CP.Notifications.${state}`, { name, reason: reason ?? "" });
    if (state === "error") ui.notifications.error(message, { permanent: true });
    else ui.notifications.warn(message, { permanent: true });
  }
  if (game.user.isActiveGM) {
    await game.settings.set(MODULE_ID, SETTINGS.lastStatus, Object.fromEntries(status.map((s) => [s.id, s.state])));
  }
});
