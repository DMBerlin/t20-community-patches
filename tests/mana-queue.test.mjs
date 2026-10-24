import { test } from "node:test";
import assert from "node:assert/strict";
import { installManaQueue, withManaTurn } from "../scripts/rules/mana-queue.mjs";

/**
 * Actor whose spendMana copies the system's (T20:7553-7579): reads pm before the first await and writes absolute
 * values. The update stays pending until the test resolves it, and only then writes to the local `system`, as the
 * core does.
 */
class FakeActor {
  constructor(value, temp = 0) {
    this.system = { attributes: { pm: { value, temp, max: 20 } } };
    this.pending = [];
  }
  update(changes) {
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.system.attributes.pm.temp = changes["system.attributes.pm.temp"];
        this.system.attributes.pm.value = changes["system.attributes.pm.value"];
        resolve(this);
      });
    });
  }
  async displayDamageCard() {}
  async applyDamage(amount) {
    return `damage ${amount}`;
  }
  // T20:7340-7349: the absolute PM value becomes a debit read before spendMana.
  async modifyTokenAttribute(attribute, value, isDelta, isBar) {
    if (attribute === "attributes.pv" || attribute === "attributes.pm") {
      const hp = this.system.attributes[attribute.split(".")[1]];
      const delta = isDelta ? -1 * value : hp.value + hp.temp - value;
      if (attribute === "attributes.pm") return this.spendMana(delta);
      return this.applyDamage(delta);
    }
    return `super ${attribute}`;
  }
  async spendMana(amount = 0, adjust = 0, recover) {
    const pm = this.system.attributes.pm;
    const tmpPM = parseInt(pm.temp) || 0;
    let value;
    let tmpSpend = 0;
    if (recover) value = Math.min(Math.max(pm.value + amount, 0), pm.max);
    else {
      amount = Math.floor(parseInt(amount) + adjust);
      tmpSpend = amount > 0 ? Math.min(tmpPM, amount) : 0;
      value = Math.min(Math.max(pm.value - (amount - tmpSpend), 0), pm.max);
    }
    await this.update({ "system.attributes.pm.temp": tmpPM - tmpSpend, "system.attributes.pm.value": value });
    await this.displayDamageCard({}, { mana: amount }, -1);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Resolves every pending update, including the ones queued meanwhile, until the queue is idle. */
async function settle(actor, done) {
  for (let i = 0; i < 50; i++) {
    await tick();
    while (actor.pending.length) actor.pending.shift()();
    if (await Promise.race([done.then(() => true), tick().then(() => false)])) return;
  }
  throw new Error("queue did not settle");
}

/** The arcane armor charge of #46: the grant is paid only when the confirmed balance covers it. */
const chargeGrant = (actor, cost) =>
  withManaTurn(actor, async ({ spend }) => {
    const pm = actor.system.attributes.pm;
    if (pm.value + pm.temp < cost) return false;
    await spend(cost, 0, false);
    return true;
  });

test("without the queue, two overlapping calls lose a debit (control)", async () => {
  const actor = new FakeActor(5);
  const spell = actor.spendMana(3, 0, false);
  const grant = actor.spendMana(1, 0, false);
  await settle(actor, Promise.all([spell, grant]));
  assert.equal(actor.system.attributes.pm.value, 4);
});

test("without the queue, the last of two overlapping absolute PM edits wins (control)", async () => {
  const actor = new FakeActor(10);
  const first = actor.modifyTokenAttribute("attributes.pm", 8, false, true);
  const second = actor.modifyTokenAttribute("attributes.pm", 6, false, true);
  await settle(actor, Promise.all([first, second]));
  assert.equal(actor.system.attributes.pm.value, 6);
});

test("queued: absolute PM edits read the confirmed balance; other attributes pass through", async () => {
  installManaQueue(FakeActor.prototype);
  const actor = new FakeActor(10);
  actor.spendMana(3, 0, false);
  const first = actor.modifyTokenAttribute("attributes.pm", 8, false, true);
  const second = actor.modifyTokenAttribute("attributes.pm", 6, false, true);
  await settle(actor, Promise.all([first, second]));
  assert.equal(actor.system.attributes.pm.value, 6);
  const delta = actor.modifyTokenAttribute("attributes.pm", 2, true, true);
  await settle(actor, delta);
  assert.equal(actor.system.attributes.pm.value, 8);
  actor.system.attributes.pv = { value: 10, temp: 0 };
  assert.equal(await actor.modifyTokenAttribute("attributes.pv", 7, false, true), "damage 3");
  assert.equal(await actor.modifyTokenAttribute("attributes.xp", 1, false, false), "super attributes.xp");
});

test("queued: spell 3 fired without await, then Eclético 1 in withManaTurn -> 1", async () => {
  installManaQueue(FakeActor.prototype);
  const actor = new FakeActor(5);
  actor.spendMana(3, 0, false); // T20:8669, no await
  const paid = chargeGrant(actor, 1);
  await settle(actor, paid);
  assert.equal(await paid, true);
  assert.equal(actor.system.attributes.pm.value, 1);
});

test("queued: no balance for the grant after the spell -> not granted, only the spell is spent", async () => {
  installManaQueue(FakeActor.prototype);
  const actor = new FakeActor(3);
  actor.spendMana(3, 0, false);
  const paid = chargeGrant(actor, 1);
  await settle(actor, paid);
  assert.equal(await paid, false);
  assert.equal(actor.system.attributes.pm.value, 0);

  const withTemp = new FakeActor(3, 1);
  withTemp.spendMana(3, 0, false);
  const paidTemp = chargeGrant(withTemp, 1);
  await settle(withTemp, paidTemp);
  assert.equal(await paidTemp, true);
  assert.deepEqual([withTemp.system.attributes.pm.value, withTemp.system.attributes.pm.temp], [0, 0]);
});

test("withManaTurn: a spendMana fired during the turn waits for it; an error does not block the queue", async () => {
  installManaQueue(FakeActor.prototype);
  const actor = new FakeActor(10);
  const order = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const turn = withManaTurn(actor, async ({ spend }) => {
    order.push("turn start");
    const spent = spend(2, 0, false);
    await gate;
    await spent;
    order.push("turn end");
  });
  await tick();
  const later = actor.spendMana(1, 0, false).then(() => order.push("later"));
  await tick();
  while (actor.pending.length) actor.pending.shift()();
  await tick();
  assert.deepEqual(order, ["turn start"]);
  release();
  await settle(actor, later);
  await turn;
  assert.deepEqual(order, ["turn start", "turn end", "later"]);
  assert.equal(actor.system.attributes.pm.value, 7);

  const failing = withManaTurn(actor, () => {
    throw new Error("boom");
  });
  await assert.rejects(failing, /boom/);
  const next = actor.spendMana(2, 0, false);
  await settle(actor, next);
  assert.equal(actor.system.attributes.pm.value, 5);
});

test("the queue is per actor and installs once", async () => {
  installManaQueue(FakeActor.prototype);
  const wrapped = FakeActor.prototype.spendMana;
  installManaQueue(FakeActor.prototype);
  assert.equal(FakeActor.prototype.spendMana, wrapped);

  const a = new FakeActor(5);
  const b = new FakeActor(5);
  const holdA = withManaTurn(a, () => new Promise(() => {})); // never ends
  const spentB = b.spendMana(2, 0, false);
  await settle(b, spentB);
  assert.equal(b.system.attributes.pm.value, 3);
  void holdA;
});
