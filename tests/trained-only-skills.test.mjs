import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliesToActor,
  decideDialog,
  decideRoll,
  installTrainedOnlyRule,
  needsCardNote
} from "../scripts/rules/trained-only-skills.mjs";

const auto = [{ id: "e", automatic: true }];
const manual = [{ id: "e", automatic: false }];

test("appliesToActor: only characters", () => {
  assert.equal(appliesToActor({ type: "character" }), true);
  for (const type of ["npc", "simple", "bases", "hazard", undefined]) assert.equal(appliesToActor({ type }), false);
  assert.equal(appliesToActor(undefined), false);
});

test("decideRoll", () => {
  const base = { required: true, trained: false };
  assert.deepEqual(decideRoll({ ...base, mode: "off", opensDialog: false }), { action: "roll", notify: false });

  assert.deepEqual(decideRoll({ ...base, mode: "warn", opensDialog: false }), { action: "roll", notify: true });
  assert.deepEqual(decideRoll({ ...base, mode: "warn", opensDialog: true }), { action: "roll", notify: false });
  assert.deepEqual(decideRoll({ ...base, mode: "warn", opensDialog: false, grants: auto }), { action: "roll", notify: false });
  assert.deepEqual(decideRoll({ ...base, mode: "warn", opensDialog: false, grants: manual }), { action: "roll", notify: true });

  assert.deepEqual(decideRoll({ mode: "block", required: true, trained: true, opensDialog: false }), { action: "roll", notify: false });
  assert.deepEqual(decideRoll({ mode: "block", required: false, trained: true, opensDialog: false }), { action: "roll", notify: false });
  assert.deepEqual(decideRoll({ ...base, mode: "block", opensDialog: true }), { action: "block", reason: "untrained" });
  assert.deepEqual(decideRoll({ ...base, mode: "block", opensDialog: true, grants: manual }), { action: "roll", notify: false });
  assert.deepEqual(decideRoll({ ...base, mode: "block", opensDialog: false, grants: manual }), { action: "block", reason: "needsDialog" });
  assert.deepEqual(decideRoll({ ...base, mode: "block", opensDialog: false, grants: auto }), { action: "roll", notify: false });
});

test("decideDialog and needsCardNote", () => {
  const base = { required: true, trained: false, grants: manual };
  assert.equal(decideDialog({ ...base, mode: "block" }), "block");
  assert.equal(decideDialog({ ...base, mode: "warn" }), "warn");
  assert.equal(decideDialog({ ...base, mode: "block", applied: { e: { aplica: 1 } } }), null);
  assert.equal(decideDialog({ ...base, mode: "off" }), null);
  assert.equal(decideDialog({ ...base, mode: "block", trained: true }), null);

  assert.equal(needsCardNote({ ...base, mode: "warn" }), true);
  assert.equal(needsCardNote({ ...base, mode: "warn", applied: { e: { aplica: 1 } } }), false);
  assert.equal(needsCardNote({ ...base, mode: "warn", trained: true }), false);
  assert.equal(needsCardNote({ ...base, mode: "off" }), false);
});

/* -------------------------------------------- */
/*  Integration with Foundry mocks              */
/* -------------------------------------------- */

const ECLETICO = { key: "roll", type: "add", value: "@treino" };

function useEffect({ id, name = id, automatic = false, custo = 1, changes = [] }) {
  return {
    documentName: "ActiveEffect",
    id,
    name,
    parent: null,
    isTemporary: false,
    system: { onuse: true, abilityUse: { automatic, custo, types: new Set(["skill"]), names: new Set() }, changes }
  };
}

const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let fakes = null;

function setupFoundry() {
  if (fakes) {
    fakes.settings.mode = "block";
    fakes.settings.usage = "default";
    fakes.warnings.length = 0;
    return fakes;
  }
  const settings = { mode: "block", usage: "default" };
  const warnings = [];

  /** Copies the parts of ActorT20#rollPericia (T20:7589-7700) and #displayCard the rule depends on. */
  class Actor {
    constructor({ type = "character", name = "Guerreiro", pericias = {}, effects = [] } = {}) {
      Object.assign(this, { type, name, effects });
      this.system = { pericias };
      this.calls = [];
      this.cards = [];
    }
    *traverseEmbeddedDocuments() {
      for (const ef of this.effects) yield ["effects", ef];
    }
    async rollPericia(key, options = {}) {
      this.calls.push({ key, options, self: this });
      options.message ??= true;
      const pericia = this.system.pericias[key];
      const itemData = { name: pericia.label, type: "pericia", id: key, actor: this, ...pericia };
      itemData.applicableOnUseEffects = this.effects.filter((ef) => ef.system.onuse);
      const rConfig = options.aprs ? { aprs: options.aprs } : {};
      rConfig.itemData = itemData;
      if (!options.message) return "roll";
      return this.displayCard({ options: rConfig });
    }
    async displayCard({ options }) {
      this.cards.push(options.chatFlavor ?? "");
      return "card";
    }
  }

  class Element {
    querySelector(selector) {
      return selector === "form" ? this.form : null;
    }
  }
  class AbilityUseDialog {
    constructor(item, formData) {
      this.item = item;
      this.element = Object.assign(new Element(), { form: { formData } });
      this.submitted = 0;
    }
    submit() {
      this.submitted++;
      return "submitted";
    }
  }

  Object.assign(globalThis, {
    HTMLElement: Element,
    CONFIG: {
      Actor: { documentClass: Actor },
      T20: { pericias: { mist: { trainedOnly: true }, ladi: { trainedOnly: true }, atle: {} } }
    },
    tormenta20: { applications: { AbilityUseDialog } },
    game: {
      settings: {
        get: (scope, key) => (scope === "tormenta20" && key === "UsageConfig" ? settings.usage : settings.mode)
      },
      i18n: { lang: "pt-BR", localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}` },
      modules: { get: () => ({ api: { status: [] } }) }
    },
    ui: { notifications: { warn: (msg) => warnings.push(msg) } },
    foundry: {
      applications: {
        ux: {
          FormDataExtended: class {
            constructor(form) {
              this.object = form.formData;
            }
          }
        }
      },
      utils: {
        escapeHTML,
        expandObject: (flat) => {
          const out = {};
          for (const [path, value] of Object.entries(flat)) {
            const keys = path.split(".");
            const last = keys.pop();
            keys.reduce((o, k) => (o[k] ??= {}), out)[last] = value;
          }
          return out;
        }
      }
    }
  });
  installTrainedOnlyRule();

  const guerreiro = (extra = {}) =>
    new Actor({
      pericias: {
        mist: { label: "Misticismo", treinado: 0, st: false },
        atle: { label: "Atletismo", treinado: 0, st: false },
        ofi1: { label: "Ferreiro", treinado: 0, st: true }
      },
      ...extra
    });
  const bardo = (automatic = false) =>
    new Actor({
      name: "Bardo",
      pericias: { ladi: { label: "Ladinagem", treinado: 0, st: true } },
      effects: [useEffect({ id: "ecl", name: "Eclético", automatic, changes: [ECLETICO] })]
    });
  const dialogFor = (actor, key, formData = {}) => {
    const p = actor.system.pericias[key];
    const item = { name: p.label, type: "pericia", id: key, actor, ...p, applicableOnUseEffects: actor.effects };
    return new AbilityUseDialog(item, formData);
  };
  fakes = { settings, warnings, Actor, guerreiro, bardo, dialogFor };
  return fakes;
}

const SHIFT = { event: { shiftKey: true } };

test("block: an untrained character is stopped before the system runs, with one warning", async () => {
  const { warnings, guerreiro } = setupFoundry();
  const actor = guerreiro();
  assert.equal(await actor.rollPericia("mist"), undefined);
  assert.equal(actor.calls.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Untrained.*"actor":"Guerreiro".*"skill":"Misticismo".*Blocked/);

  assert.equal(await actor.rollPericia("atle"), "card");
  assert.equal(await actor.rollPericia("ofi1", SHIFT), undefined); // custom craft marked st
  actor.system.pericias.mist.treinado = 1; // trained by a passive effect, as #60
  assert.equal(await actor.rollPericia("mist"), "card");
  assert.equal(warnings.length, 2);
});

test("block: menaces are never checked", async () => {
  const { warnings, guerreiro } = setupFoundry();
  const npc = guerreiro({ type: "npc", name: "Esqueleto de Elite" });
  assert.equal(await npc.rollPericia("mist"), "card");
  assert.deepEqual(npc.cards, [""]);
  assert.equal(warnings.length, 0);
});

test("block: Eclético opens the dialog; without the dialog it needs Aplicar Sempre", async () => {
  const { warnings, bardo } = setupFoundry();
  const actor = bardo(false);
  assert.equal(await actor.rollPericia("ladi"), "card"); // dialog path: the dialog decides
  assert.equal(warnings.length, 0);

  assert.equal(await actor.rollPericia("ladi", SHIFT), undefined);
  assert.equal(actor.calls.length, 1);
  assert.match(warnings[0], /Blocked.*OpenDialog.*Eclético/);
  actor.effects[0].name = "<u>E</u>";
  await actor.rollPericia("ladi", SHIFT);
  assert.match(warnings[1], /&lt;u&gt;E&lt;\/u&gt;/);
  assert.doesNotMatch(warnings[1], /<u>/);

  const always = bardo(true);
  assert.equal(await always.rollPericia("ladi", SHIFT), "card");
  assert.deepEqual(always.cards, [""]); // automatic grant counts as applied: no note
});

test("block: the dialog stays open until the grant is checked", () => {
  const { warnings, bardo, dialogFor } = setupFoundry();
  const actor = bardo(false);
  const unchecked = dialogFor(actor, "ladi", { "aprs.ecl.aplica": false, "aprs.ecl.custo": 1 });
  assert.equal(unchecked.submit(), undefined);
  assert.equal(unchecked.submitted, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MarkGrant.*Eclético/);

  const checked = dialogFor(actor, "ladi", { "aprs.ecl.aplica": true, "aprs.ecl.custo": 1 });
  assert.equal(checked.submit(), "submitted");
  assert.equal(warnings.length, 1);
});

test("warn: the dialog warns once and lets the use go on; off does nothing", () => {
  const { settings, warnings, bardo, dialogFor } = setupFoundry();
  settings.mode = "warn";
  const dialog = dialogFor(bardo(false), "ladi", { "aprs.ecl.aplica": false });
  assert.equal(dialog.submit(), "submitted");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Warned/);

  settings.mode = "off";
  assert.equal(dialogFor(bardo(false), "ladi", {}).submit(), "submitted");
  assert.equal(warnings.length, 1);
});

test("warn without the dialog: one warning and the escaped note on the card, keeping the flavor", async () => {
  const { settings, warnings, guerreiro } = setupFoundry();
  settings.mode = "warn";
  const actor = guerreiro({ name: "<i>G</i>" });
  actor.system.pericias.mist.label = "<b>x</b>";
  assert.equal(await actor.rollPericia("mist", SHIFT), "card");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /&lt;i&gt;G&lt;\/i&gt;.*&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(warnings[0], /<b>x<\/b>|<i>G<\/i>/);
  assert.equal(actor.cards.length, 1);
  assert.match(actor.cards[0], /^<span class="t20cp-trained-only"/);
  assert.match(actor.cards[0], /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(actor.cards[0], /<b>x<\/b>|<i>G<\/i>/);

  // An existing flavor is kept.
  const proto = globalThis.CONFIG.Actor.documentClass.prototype;
  const cards = [];
  const flavored = guerreiro();
  flavored.cards = cards;
  await proto.displayCard.call(flavored, {
    options: { chatFlavor: "Antes", itemData: { type: "pericia", id: "mist", applicableOnUseEffects: [] } }
  });
  assert.match(cards[0], /^Antes <span class="t20cp-trained-only"/);
});

test("warn with message: false: exactly one warning and no card", async () => {
  const { settings, warnings, guerreiro } = setupFoundry();
  settings.mode = "warn";
  settings.usage = "shift"; // a plain click skips the dialog
  const actor = guerreiro();
  assert.equal(await actor.rollPericia("mist", { message: false }), "roll");
  assert.equal(warnings.length, 1);
  assert.equal(actor.cards.length, 0);
});

test("warn: the card note follows the grants of the call (dialog aprs or Aplicar Sempre)", async () => {
  const { settings, bardo } = setupFoundry();
  settings.mode = "warn";
  const actor = bardo(false);
  await actor.rollPericia("ladi", { aprs: { ecl: { aplica: 1 } } });
  await actor.rollPericia("ladi", { aprs: { ecl: { aplica: 0 } } });
  assert.equal(actor.cards[0], "");
  assert.match(actor.cards[1], /t20cp-trained-only/);
  const always = bardo(true);
  await always.rollPericia("ladi", SHIFT);
  assert.equal(always.cards[0], "");
});

test("off: the original runs with the same this and arguments, and the card is untouched", async () => {
  const { settings, warnings, guerreiro } = setupFoundry();
  settings.mode = "off";
  const actor = guerreiro();
  const options = { event: { shiftKey: false } };
  assert.equal(await actor.rollPericia("mist", options), "card");
  assert.equal(actor.calls[0].self, actor);
  assert.equal(actor.calls[0].options, options);
  assert.deepEqual(actor.cards, [""]);
  assert.equal(warnings.length, 0);
});

test("overlapping calls do not interfere, and a failing check lets the roll go on", async () => {
  const { warnings, guerreiro } = setupFoundry();
  const blocked = guerreiro();
  const allowed = guerreiro();
  allowed.system.pericias.mist.treinado = 1;
  const results = await Promise.all([blocked.rollPericia("mist"), allowed.rollPericia("mist")]);
  assert.deepEqual(results, [undefined, "card"]);
  assert.equal(warnings.length, 1);

  const broken = guerreiro();
  broken.traverseEmbeddedDocuments = () => {
    throw new Error("boom");
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(await broken.rollPericia("mist"), "card");
  } finally {
    console.error = error;
  }
});
