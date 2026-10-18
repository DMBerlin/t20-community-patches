import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnedEffectUuid, resolveEffectFromRow } from "../scripts/effect-rows.mjs";

test("parses effect uuids relative to the owner", () => {
  assert.deepEqual(parseOwnedEffectUuid("Actor.A.ActiveEffect.E", "Actor.A"), { effectId: "E" });
  assert.deepEqual(parseOwnedEffectUuid("Actor.A.Item.I.ActiveEffect.E", "Actor.A"), { itemId: "I", effectId: "E" });
  assert.deepEqual(parseOwnedEffectUuid("Actor.A.Item.I.ActiveEffect.E", "Actor.A.Item.I"), { effectId: "E" });
  assert.deepEqual(
    parseOwnedEffectUuid("Scene.S.Token.T.Actor.A.Item.I.ActiveEffect.E", "Scene.S.Token.T.Actor.A"),
    { itemId: "I", effectId: "E" }
  );
});

test("rejects uuids of other owners and unexpected shapes", () => {
  assert.equal(parseOwnedEffectUuid("Actor.B.ActiveEffect.E", "Actor.A"), null);
  assert.equal(parseOwnedEffectUuid("Actor.AB.ActiveEffect.E", "Actor.A"), null);
  assert.equal(parseOwnedEffectUuid("Actor.A.Item.I", "Actor.A"), null);
  assert.equal(parseOwnedEffectUuid("Actor.A.Item.I.ActiveEffect.E.X", "Actor.A"), null);
  assert.equal(parseOwnedEffectUuid("", "Actor.A"), null);
  assert.equal(parseOwnedEffectUuid("Actor.A.ActiveEffect.E", undefined), null);
});

const row = (dataset) => ({ dataset });

function makeActor() {
  const actorEffect = { id: "E", name: "actor" };
  const itemEffect = { id: "E", name: "item" };
  const item = { effects: new Map([["E", itemEffect]]) };
  const actor = { uuid: "Actor.A", effects: new Map([["E", actorEffect]]), items: new Map([["I", item]]) };
  return { actor, actorEffect, itemEffect };
}

test("resolves item effects by uuid even when the actor has an effect with the same id", () => {
  const { actor, actorEffect, itemEffect } = makeActor();
  assert.equal(resolveEffectFromRow(row({ effectId: "E", effectUuid: "Actor.A.Item.I.ActiveEffect.E" }), actor), itemEffect);
  assert.equal(resolveEffectFromRow(row({ effectId: "E", effectUuid: "Actor.A.ActiveEffect.E" }), actor), actorEffect);
  assert.equal(resolveEffectFromRow(row({ effectId: "E", effectUuid: "Actor.A.Item.X.ActiveEffect.E" }), actor), null);
});

test("falls back to owner.effects without uuid and returns null without data", () => {
  const { actor, actorEffect } = makeActor();
  assert.equal(resolveEffectFromRow(row({ effectId: "E" }), actor), actorEffect);
  assert.equal(resolveEffectFromRow(row({}), actor), null);
  assert.equal(resolveEffectFromRow(undefined, actor), null);
});
