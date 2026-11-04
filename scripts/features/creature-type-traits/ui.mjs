/** Dialog of the creature type traits rule (#50): how a healing roll hits an undead. */

/**
 * Asks how a healing roll hits an undead: 1 (light), 0.5 (Will save), "heal" (not light) or null (closed).
 * @param {{platform: object, t: Function}} state
 */
export async function askLight(state, actor, amount) {
  const { platform, t } = state;
  const action = await platform.dice.DialogV2.wait({
    window: { title: t("Dialog.Title", { actor: actor.name }) },
    content: `<p>${t("Dialog.Content", { actor: platform.utils.escapeHTML?.(actor.name) ?? actor.name, amount })}</p>`,
    buttons: [
      { action: "full", label: t("Dialog.Full"), default: true },
      { action: "half", label: t("Dialog.Half") },
      { action: "heal", label: t("Dialog.Heal") }
    ],
    rejectClose: false
  });
  if (action === "full") return 1;
  if (action === "half") return 0.5;
  if (action === "heal") return "heal";
  return null;
}
