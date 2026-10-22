import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  diagnoseHelperSource,
  fieldTerms,
  helperBugs,
  missingDefenseCondition,
  rootForHelper
} from "../scripts/patches/field-bonuses-tooltip.mjs";

const tooltip = (lines) => {
  const total = lines.reduce((sum, [, v]) => sum + v, 0);
  const items = lines.map(([l, v]) => `<li class="flexrow"><label>${l}:</label><span>${v >= 0 ? "+" : ""}${v}</span></li>`).join("");
  return `\n\t\t<ul class="fieldBonuses">\n\t\t\t${items}\n\t\t\t<hr>\n\t\t\t<li class="flexrow"><label>Total:</label><span>${total >= 0 ? "+" : ""}${total}</span></li>\n\t\t</ul>\n\t\t`;
};
const lines = (html) => [...html.matchAll(/<label>([^<]*):<\/label><span>([^<]*)/g)].map((m) => `${m[1]} ${m[2]}`);

/** Excerpt of the 1.6.5 helper (T20:4254-4420) with the parts the probe reads. */
const HELPER_165 = `function (path, options) {
		const { root: sheet } = options.data;
		const actor = game.actors.get(sheet.actor._id) || fromUuidSync(sheet.uuid);
		switch (type) {
			case "defesa": {
				if (key == "pda") ; else {
					// ['base', 'atributo', 'outros', 'condi', 'armadura', 'escudo', 'acessorio' ...efeitos]
					listEffects = [{ label: "Base", value: defesa.base }, defesa.outros ? { label: "Outros", value: defesa.outros } : false];
				}
				break;
			}
			case "rd":
				break;
		}
	}`;

test("fieldTerms and missingDefenseCondition follow the helper's path parsing", () => {
  assert.deepEqual(fieldTerms("system.attributes.defesa.bonus"), ["defesa", "bonus"]);
  assert.deepEqual(fieldTerms({ string: "system.pericias.luta.bonus" }), ["pericias", "luta", "bonus"]);
  assert.equal(missingDefenseCondition("system.attributes.defesa.bonus", { condi: -5 }), -5);
  assert.equal(missingDefenseCondition("system.attributes.defesa.pda", { condi: -5 }), 0);
  assert.equal(missingDefenseCondition("system.pericias.luta.bonus", { condi: -5 }), 0);
  assert.equal(missingDefenseCondition("system.attributes.defesa.bonus", { condi: 0 }), 0);
  assert.equal(missingDefenseCondition("system.attributes.defesa.bonus", undefined), 0);
});

test("rootForHelper hides the _id of token actors only", () => {
  const linked = { actor: { _id: "a1", isToken: false, uuid: "Actor.a1" }, uuid: "Actor.a1", other: 1 };
  assert.equal(rootForHelper(linked), linked);
  const token = { actor: { _id: "a1", isToken: true, uuid: "Scene.s.Token.t.Actor.a1" }, uuid: "Actor.a1", other: 1 };
  const root = rootForHelper(token);
  assert.equal(root.actor._id, null);
  assert.equal(root.uuid, "Scene.s.Token.t.Actor.a1");
  assert.equal(root.other, 1);
  assert.equal(token.actor._id, "a1");
  assert.equal(rootForHelper(undefined), undefined);
});

test("diagnoseHelperSource: 1.6.5 is present/high; a comment mentioning condi does not count as a fix", () => {
  assert.deepEqual([diagnoseHelperSource(HELPER_165).bug, diagnoseHelperSource(HELPER_165).confidence], ["present", "high"]);
  const lookupFixed = HELPER_165.replace("game.actors.get(sheet.actor._id) || fromUuidSync(sheet.uuid)", "sheet.actor");
  assert.deepEqual([diagnoseHelperSource(lookupFixed).bug, diagnoseHelperSource(lookupFixed).confidence], ["present", "low"]);
  const bothFixed = lookupFixed.replace("defesa.outros ? {", "defesa.condi ? { label: 'C', value: defesa.condi } : false, defesa.outros ? {");
  assert.equal(diagnoseHelperSource(bothFixed).bug, "unknown");
  assert.equal(diagnoseHelperSource(undefined).bug, "unknown");
  assert.deepEqual(helperBugs(lookupFixed), { lookup: false, noCondition: true });
  assert.deepEqual(helperBugs(HELPER_165.replace("defesa.outros ? {", "defesa.condi, defesa.outros ? {")), { lookup: true, noCondition: false });
});

const fromUuidSync = (uuid) => foundry.utils.fromUuidSync(uuid);

/* Helpers in the 1.6.5 shape, as real code so the patch can read their source. */
const HELPERS = {
  v165: function (path, options) {
    const sheet = options.data.root;
    const actor = game.actors.get(sheet.actor._id) || fromUuidSync(sheet.uuid);
    let list = [];
    switch (path.split(".")[2]) {
      case "defesa": {
        list = [["Base", actor.system.attributes.defesa.base]];
        break;
      }
      case "rd":
        break;
    }
    return tooltip(list);
  },
  conditionFixed: function (path, options) {
    const sheet = options.data.root;
    const actor = game.actors.get(sheet.actor._id) || fromUuidSync(sheet.uuid);
    let list = [];
    switch (path.split(".")[2]) {
      case "defesa": {
        const defesa = actor.system.attributes.defesa;
        list = [["Base", defesa.base], ...(defesa.condi && !path.endsWith("pda") ? [["Cond", defesa.condi]] : [])];
        break;
      }
      case "rd":
        break;
    }
    return tooltip(list);
  },
  lookupFixed: function (path, options) {
    const sheet = options.data.root;
    const actor = fromUuidSync(sheet.uuid);
    let list = [];
    switch (path.split(".")[2]) {
      case "defesa": {
        list = [["Base", actor.system.attributes.defesa.base]];
        break;
      }
      case "rd":
        break;
    }
    return tooltip(list);
  }
};

function setup(variant = "v165") {
  const base = { _id: "a1", isToken: false, uuid: "Actor.a1", system: { attributes: { defesa: { base: 10, condi: 0 } } } };
  const synthetic = { _id: "a1", isToken: true, uuid: "Scene.s.Token.t.Actor.a1", system: { attributes: { defesa: { base: 12, condi: -5 } } } };
  const byUuid = { "Actor.a1": base, [synthetic.uuid]: synthetic };
  globalThis.game = { actors: { get: (id) => (id === "a1" ? base : undefined) }, i18n: { localize: (key) => key } };
  globalThis.foundry = { utils: { fromUuidSync: (uuid) => byUuid[uuid] ?? null } };
  const helpers = { fieldBonuses: HELPERS[variant] };
  globalThis.Handlebars = { helpers, registerHelper: (name, fn) => (helpers[name] = fn) };
  return { base, synthetic, helpers };
}

function teardown() {
  delete globalThis.game;
  delete globalThis.foundry;
  delete globalThis.Handlebars;
}

const PATH = "system.attributes.defesa.bonus";
const render = (helpers, actor, path = PATH) => lines(helpers.fieldBonuses.call({}, path, { data: { root: { actor, uuid: actor.uuid } } }));

test("apply on 1.6.5: token sheets use the token actor and the Defesa lists the condition", () => {
  const { base, synthetic, helpers } = setup();
  try {
    assert.equal(patch.isNeeded().bug, "present");
    patch.apply();
    assert.deepEqual(render(helpers, base), ["Base +10", "Total +10"]);
    assert.deepEqual(render(helpers, synthetic), ["Base +12", "T20CP.FieldBonuses.Condition -5", "Total +7"]);
    assert.deepEqual(render(helpers, synthetic, "system.attributes.defesa.pda"), ["Base +12", "Total +12"]);
  } finally {
    teardown();
  }
});

test("apply after a partial upstream fix leaves the fixed part alone", () => {
  try {
    let { synthetic, helpers } = setup("conditionFixed");
    patch.apply();
    assert.deepEqual(render(helpers, synthetic), ["Base +12", "Cond -5", "Total +7"]);
    ({ synthetic, helpers } = setup("lookupFixed"));
    patch.apply();
    assert.deepEqual(render(helpers, synthetic), ["Base +12", "T20CP.FieldBonuses.Condition -5", "Total +7"]);
  } finally {
    teardown();
  }
});
