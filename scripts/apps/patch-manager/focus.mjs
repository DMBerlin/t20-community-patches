/**
 * Keyboard focus of the Center (#89): the Tab trap of its modal dialogs and the arrow keys of its tablist and sidebar.
 */
import { nextFocusIndex } from "../../kernel/center.mjs";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Index an arrow key, Home or End moves to in a list, wrapping around at the ends; undefined for any other key.
 * @param {string} key          KeyboardEvent#key
 * @param {number} index        Index of the focused item.
 * @param {number} count        Items in the list.
 * @param {{next: string, previous: string}} arrows  Keys that move forward and back (ArrowRight/ArrowLeft…).
 * @returns {number|undefined}
 */
export function rovingIndex(key, index, count, { next, previous }) {
  const target = { [next]: index + 1, [previous]: index - 1, Home: 0, End: count - 1 }[key];
  if (target === undefined) return undefined;
  return (target + count) % count;
}

/**
 * Keeps Tab and Shift+Tab inside a modal dialog. The core KeyboardManager swallows Tab when the focus is on the
 * dialog's header buttons (outside its form) or has left the page past the last button, so the dialog moves the focus
 * itself and the keybindings never see the key.
 * @param {HTMLElement} root
 */
export function trapFocus(root) {
  if (!root || root.dataset.t20cpFocusTrap) return;
  root.dataset.t20cpFocusTrap = "true";
  const onKey = (event) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    // A newer modal (from another module, say) owns its own Tab.
    if ([...root.ownerDocument.querySelectorAll("dialog:modal")].at(-1) !== root) return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.checkVisibility());
    const next = nextFocusIndex(items.length, items.indexOf(root.ownerDocument.activeElement), event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  };
  // On the window, so a focus that already escaped to the body is brought back too; removed when the dialog closes.
  const view = root.ownerDocument.defaultView;
  view.addEventListener("keydown", onKey, true);
  const stop = new MutationObserver(() => {
    if (root.isConnected) return;
    view.removeEventListener("keydown", onKey, true);
    stop.disconnect();
  });
  stop.observe(root.ownerDocument.body, { childList: true, subtree: true });
}
