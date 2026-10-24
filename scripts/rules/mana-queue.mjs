/**
 * Per-actor queue of ActorT20#spendMana (shared by #46 arcane armor and #62 trained-only skills).
 *
 * spendMana (T20:7553-7579) reads pm.value/pm.temp before its first await and writes absolute values, and the
 * system fires some calls without await (the spell cost, T20:8669). Two overlapping calls would let the second one
 * overwrite the first. The wrapper serializes the calls of each actor: a call only starts once the previous one is
 * done, i.e. once the update promise resolved, which the core only does after applying the change to the local
 * document and preparing its data. The queue only changes the order, never the values. Updates of PM made outside
 * spendMana (manual edits, other modules) are not queued.
 *
 * ActorT20#modifyTokenAttribute (T20:7340-7349, token HUD/bars) turns an absolute PM value into a debit read before
 * calling spendMana. Queuing only spendMana would apply a stale debit, so absolute PM edits compute it in the turn.
 */
import { markWrapper } from "../utils.mjs";

/** @type {WeakMap<object, Promise<unknown>>} */
const queues = new WeakMap();
/** The system's spendMana, as found when the queue was installed. */
let originalSpend = null;

function enqueue(actor, task) {
  const previous = queues.get(actor) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  queues.set(actor, run);
  // Drop the entry once idle, so a settled chain does not keep growing.
  run.then(
    () => queues.get(actor) === run && queues.delete(actor),
    () => queues.get(actor) === run && queues.delete(actor)
  );
  return run;
}

/**
 * Runs `fn` in the actor's turn of the mana queue: no other spendMana of the actor starts while it runs; calls made
 * meanwhile wait for it. `fn` receives `{ spend }`, which calls the original spendMana without entering the queue
 * (calling actor.spendMana and awaiting it inside `fn` would wait for itself). An error in `fn` rejects the returned
 * promise and does not block the queue.
 * @template T
 * @param {object} actor
 * @param {(turn: {spend: (...args: unknown[]) => Promise<unknown>}) => T|Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withManaTurn(actor, fn) {
  const spendFn = originalSpend ?? actor?.spendMana;
  const spend = (...args) => spendFn.apply(actor, args);
  return enqueue(actor, () => fn({ spend }));
}

/**
 * Wraps CONFIG.Actor.documentClass.prototype.spendMana once, and the absolute PM path of modifyTokenAttribute when the
 * prototype has it. Throws when spendMana is missing.
 */
export function installManaQueue(proto = globalThis.CONFIG?.Actor?.documentClass?.prototype) {
  if (originalSpend) return;
  const original = proto?.spendMana;
  if (typeof original !== "function") throw new Error("ActorT20#spendMana not found");
  originalSpend = original;
  proto.spendMana = markWrapper(function (...args) {
    return withManaTurn(this, ({ spend }) => spend(...args));
  }, original);

  const modify = proto.modifyTokenAttribute;
  if (typeof modify !== "function") return;
  proto.modifyTokenAttribute = markWrapper(function (attribute, value, isDelta, isBar) {
    if (attribute !== "attributes.pm" || isDelta || !this.system?.attributes?.pm) {
      return modify.call(this, attribute, value, isDelta, isBar);
    }
    // Same debit as T20:7343, read from the balance confirmed by the previous calls.
    return withManaTurn(this, ({ spend }) => {
      const pm = this.system.attributes.pm;
      return spend(pm.value + pm.temp - value);
    });
  }, modify);
}
