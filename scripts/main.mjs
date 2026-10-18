import { PATCHES } from "./patches/index.mjs";
import { MODULE_ID, isSystemVersionAffected } from "./utils.mjs";

/** @type {{id: string, state: "applied"|"disabled"|"incompatible"|"error", reason?: string}[]} */
const status = [];

Hooks.once("init", () => {
  for (const patch of PATCHES) {
    const settingKey = `patch.${patch.id}`;
    game.settings.register(MODULE_ID, settingKey, {
      name: `T20CP.Patches.${patch.id}.Name`,
      hint: `T20CP.Patches.${patch.id}.Hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true
    });

    if (!game.settings.get(MODULE_ID, settingKey)) {
      status.push({ id: patch.id, state: "disabled" });
      continue;
    }

    const { id: systemId, affected } = patch.system;
    if (game.system.id !== systemId || !isSystemVersionAffected(game.system.version, affected)) {
      status.push({ id: patch.id, state: "incompatible", reason: `${game.system.id} ${game.system.version}` });
      continue;
    }

    // Patches are installed during "init": the system has already registered its classes in CONFIG,
    // and world documents are only prepared after this hook.
    try {
      patch.apply();
      status.push({ id: patch.id, state: "applied" });
      console.log(`${MODULE_ID} | Patch applied: ${patch.id}`);
    } catch (err) {
      status.push({ id: patch.id, state: "error", reason: err.message });
      console.error(`${MODULE_ID} | Failed to apply patch: ${patch.id}`, err);
    }
  }

  game.modules.get(MODULE_ID).api = { status };
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  for (const { id, state, reason } of status) {
    if (!["incompatible", "error"].includes(state)) continue;
    const name = game.i18n.localize(`T20CP.Patches.${id}.Name`);
    ui.notifications.warn(game.i18n.format(`T20CP.Notifications.${state}`, { name, reason }), { permanent: true });
  }
});
