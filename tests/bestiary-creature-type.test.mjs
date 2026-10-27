import { test } from "node:test";
import assert from "node:assert/strict";
import patch, {
  ENTRIES,
  THREATS,
  classifyToken,
  fixParsedType,
  fixThreat,
  parserFailures,
  classificationTokens,
  parserRecognized,
  typeTokens
} from "../scripts/patches/bestiary-creature-type.mjs";
import { classify, summarize } from "../scripts/compendium-copy.mjs";
import { unwrap } from "../scripts/utils.mjs";
import { LABELS_EN, LABELS_PT, PARSE_DATA_1_6_5 } from "./fixtures/bestiary-parser-1.6.5.mjs";

// Foundry's String#capitalize (common/primitives/string.mjs).
if (!String.prototype.capitalize) {
  Object.defineProperty(String.prototype, "capitalize", {
    value() {
      if (!this.length) return this;
      return this.charAt(0).toUpperCase() + this.slice(1);
    },
    configurable: true,
    writable: true
  });
}

const useLabels = (labels) => {
  globalThis.CONFIG = { T20: { creatureTypes: labels.types, creatureRoles: labels.roles, actorSizes: labels.sizes } };
};

/** Faithful copy of the type block of StatblockParser#parseData in Tormenta20 1.6.5 (T20:11457-11500). */
class OriginalParser {
  parseData(statblock, schema, itemsList, log) {
    // Extrai Tipos
    try {
      const cType = Object.fromEntries(Object.entries(CONFIG.T20.creatureTypes).map(([key, value]) => [value, key]));
      const cRole = Object.fromEntries(Object.entries(CONFIG.T20.creatureRoles).map(([key, value]) => [value, key]));
      const cSize = Object.fromEntries(Object.entries(CONFIG.T20.actorSizes).map(([key, value]) => [value, key]));

      let types = statblock
        .capitalize()
        .match(/.*\s(especial|solo|lacaio|Iniciativa)/i)[0]
        .replace(/Iniciativa|\(|\)/gi, "")
        .trim()
        .split(" ")
        .map((m) => cType[m] || cRole[m.capitalize()] || cSize[m] || m);
      for (let t of types) {
        if (CONFIG.T20.creatureTypes[t]) {
          schema.detalhes.tipo = t;
          log.push({
            success: true,
            message: `Tipo de Criatura: ${CONFIG.T20.creatureTypes[t]}`
          });
        } else if (CONFIG.T20.creatureRoles[t]) {
          schema.detalhes.role = t;
          log.push({
            success: true,
            message: `Papel em Combate: ${CONFIG.T20.creatureRoles[t]}`
          });
        } else if (CONFIG.T20.actorSizes[t]) {
          schema.tracos.tamanho = t;
          log.push({
            success: true,
            message: `Tamanho: ${CONFIG.T20.actorSizes[t]}`
          });
        } else {
          schema.detalhes.raca = t.capitalize();
          log.push({
            success: true,
            message: `Subtipo de Criatura: ${schema.detalhes.raca}`
          });
        }
      }
      if (!schema.detalhes.role) log.push({ success: false, message: "Papel em Combate: Solo" });
    } catch (error) {
      log.push({
        success: false,
        message: "Tipo de Criatura, Papel em Combate, Tamanho, Subtipo de Criatura"
      });
    }
    return "result";
  }
}

const freshSchema = () => ({ detalhes: { tipo: "hum", role: "", raca: "" }, tracos: { tamanho: "med" } });

/** Runs the original type block, then the correction, as the wrapper does. */
function parse(statblock, labels, { fix = true } = {}) {
  useLabels(labels);
  const schema = freshSchema();
  const log = [];
  const before = { tipo: schema.detalhes.tipo, role: schema.detalhes.role, raca: schema.detalhes.raca, tamanho: schema.tracos.tamanho };
  new OriginalParser().parseData(statblock, schema, [], log);
  const changed = fix ? fixParsedType(statblock, schema, log, before, labels) : false;
  return { schema, log, changed, before };
}

const ZUMBI = "Zumbi ND 1/4\nMorto-vivo Médio\nIniciativa -1, Percepção -1, visão no escuro\nDefesa 11, Fort +3, Ref -1, Von -1";
const TURBA = "Turba Zumbi ND 3\nMorto-vivo (bando) Grande\nIniciativa -1, Percepção -1";
const KOBOLD = "Enxame Kobold ND 1\nMonstro (kobold, enxame) Médio\nIniciativa +4, Percepção +1";
const ORC = "Orc Combatente ND 1/2\nHumanoide (orc) Médio, Lacaio\nIniciativa +2, Percepção +0";
const types = ({ schema: s }) => `${s.detalhes.tipo}/${s.tracos.tamanho}/${s.detalhes.role}/raca="${s.detalhes.raca}"`;
const messages = (log) => log.map((l) => `${l.success ? "+" : "-"}${l.message}`);
const pack = (id) => {
  const [_id, name, raca] = THREATS.find((t) => t[0] === id);
  return {
    _id,
    name,
    type: "npc",
    system: { detalhes: { tipo: "hum", raca } },
    _stats: { compendiumSource: `Compendium.tormenta20.ameacas.Actor.${_id}` }
  };
};

test("patch metadata", () => {
  assert.equal(patch.id, "bestiary-creature-type");
  assert.equal(patch.issue, 47);
  assert.equal(patch.group, "actor");
  assert.equal(patch.guarded, true);
  assert.deepEqual(patch.system.affected, { minimum: "1.6.5", maximum: "1.6.6" });
  assert.equal(patch.isNeeded().bug, "unknown");
});

test("fixThreat: rulebook type, subtype cleared only when it repeats the type", () => {
  assert.deepEqual(fixThreat(pack("aDJoJf7PgQ33UvNA"), THREATS[0]), { system: { detalhes: { tipo: "mor", raca: "" } } });
  const turba = THREATS.find((t) => t[1] === "Turba Zumbi");
  assert.deepEqual(fixThreat(pack(turba[0]), turba), { system: { detalhes: { tipo: "mor" } } });
  const finn = THREATS.find((t) => t[1] === "Finntroll Caçador");
  assert.deepEqual(fixThreat(pack(finn[0]), finn), { system: { detalhes: { tipo: "mon" } } });
  const edit = (mutate) => {
    const src = pack(THREATS[0][0]);
    mutate(src);
    return fixThreat(src, THREATS[0]);
  };
  assert.equal(edit((s) => (s.system.detalhes.tipo = "mor")), null);
  assert.equal(edit((s) => (s.system.detalhes.raca = "Zumbi")), null);
  assert.equal(edit((s) => (s.name = "Zumbi Chefe")), null);
  assert.equal(edit((s) => (s.type = "character")), null);
});

test("entries: every 1.6.5 threat is present, the rulebook type is fixed, others are left alone", () => {
  assert.equal(ENTRIES.length, 11);
  for (const entry of ENTRIES) {
    const src = pack(entry.id);
    assert.equal(classify(entry, src), "present", entry.name);
    const tipo = THREATS.find((t) => t[0] === entry.id)[3];
    assert.equal(classify(entry, { ...src, system: { detalhes: { tipo, raca: "x" } } }), "fixed", entry.name);
    assert.equal(classify(entry, null), "missing");
  }
});

test("summarize: confidence of mixed results (11 threats + importer)", () => {
  const rows = (threats, importer, extra = []) => [
    ...Array.from({ length: threats.count }, (_, i) => ({ name: `t${i}`, state: threats.state })),
    ...extra,
    { name: "StatblockParser", state: importer }
  ];
  const s = (r) => {
    const d = summarize(r, "low");
    return `${d.bug}/${d.confidence}`;
  };
  assert.equal(s(rows({ count: 11, state: "present" }, "present")), "present/high");
  assert.equal(s(rows({ count: 11, state: "present" }, "unknown")), "present/low");
  assert.equal(s(rows({ count: 11, state: "present" }, "fixed")), "present/high");
  assert.equal(s(rows({ count: 10, state: "present" }, "present", [{ name: "x", state: "missing" }])), "present/low");
  assert.equal(s(rows({ count: 11, state: "fixed" }, "present")), "present/high");
  assert.equal(s(rows({ count: 11, state: "fixed" }, "unknown")), "unknown/low");
  assert.equal(s(rows({ count: 11, state: "fixed" }, "fixed")), "fixed/low");
});

test("importer: Zumbi block becomes Undead, Medium, no subtype (pt-BR labels)", () => {
  const bug = parse(ZUMBI, LABELS_PT, { fix: false });
  assert.deepEqual([bug.schema.detalhes.tipo, bug.schema.detalhes.raca], ["hum", "Morto-vivo"]);
  const { schema, log, changed } = parse(ZUMBI, LABELS_PT);
  assert.equal(changed, true);
  assert.deepEqual(schema, { detalhes: { tipo: "mor", role: "", raca: "" }, tracos: { tamanho: "med" } });
  assert.deepEqual(messages(log), ["+Tamanho: Médio", "-Papel em Combate: Solo", "+Tipo de Criatura: Morto-Vivo"]);
});

test("importer: English labels read the rulebook words too", () => {
  const bug = parse(ZUMBI, LABELS_EN, { fix: false });
  assert.deepEqual([bug.schema.detalhes.tipo, bug.schema.detalhes.raca], ["hum", "Médio"]);
  const zumbi = parse(ZUMBI, LABELS_EN);
  assert.deepEqual(zumbi.schema, { detalhes: { tipo: "mor", role: "", raca: "" }, tracos: { tamanho: "med" } });
  assert.ok(!messages(zumbi.log).some((m) => m.includes("Subtipo")));
  assert.ok(messages(zumbi.log).includes("+Tipo de Criatura: Undead"));
  assert.ok(messages(zumbi.log).includes("+Tamanho: Medium"));

  const turba = parse(TURBA, LABELS_EN);
  assert.deepEqual(turba.schema, { detalhes: { tipo: "mor", role: "", raca: "Bando" }, tracos: { tamanho: "gra" } });

  const orc = parse(ORC, LABELS_EN);
  assert.deepEqual(orc.schema, { detalhes: { tipo: "hum", role: "lackey", raca: "Orc" }, tracos: { tamanho: "med" } });
  assert.ok(!messages(orc.log).includes("-Papel em Combate: Solo"));
  assert.ok(messages(orc.log).includes("+Papel em Combate: Minion"));
});

test("importer: size with a trailing comma is not taken as the subtype (pt-BR)", () => {
  const bug = parse(ORC, LABELS_PT, { fix: false });
  assert.equal(bug.schema.detalhes.raca, "Médio,");
  const { schema, log } = parse(ORC, LABELS_PT);
  assert.deepEqual(schema, { detalhes: { tipo: "hum", role: "lackey", raca: "Orc" }, tracos: { tamanho: "med" } });
  assert.ok(!messages(log).some((m) => m.startsWith("+Subtipo de Criatura: Médio")));
});

test("importer: a double space does not cost the subtype", () => {
  const turba = "Turba Zumbi ND 3\nMorto-vivo (bando)  Grande\nIniciativa -1";
  assert.equal(parse(turba, LABELS_PT, { fix: false }).schema.detalhes.raca, "");
  const fixedTurba = parse(turba, LABELS_PT);
  assert.deepEqual(fixedTurba.schema, { detalhes: { tipo: "mor", role: "", raca: "Bando" }, tracos: { tamanho: "gra" } });
  assert.ok(!messages(fixedTurba.log).includes("+Subtipo de Criatura: "));

  const orc = "Orc Combatente ND 1/2\nHumanoide (orc) Médio,  Lacaio\nIniciativa +2";
  assert.equal(parse(orc, LABELS_PT, { fix: false }).schema.detalhes.raca, "");
  assert.deepEqual(parse(orc, LABELS_PT).schema, {
    detalhes: { tipo: "hum", role: "lackey", raca: "Orc" },
    tracos: { tamanho: "med" }
  });
});

/** Text cleanup of _parseStatblock before parseData (T20:11306-11313). */
const preprocess = (text) =>
  text
    .replace(/-\n/g, "")
    .replace(/([a-zA-Z0-9áâãàäéêèëíìïóôõòöúùüçñ,])(\n)([a-z0-9áâãàäéêèëíìïóôõòöúùüçñ\-+()])/g, "$1 $3")
    .replace(/\n(Magias\s*.*\.)\s*(\d[ºo][\s\S]*?\.)/, (_, magias, spells) => `\n${magias} ${spells.replace(/\n/g, " ")}`)
    .replaceAll(/–/g, "-");

test("importer: words on the name line are not a classification", () => {
  assert.deepEqual(classificationTokens(ZUMBI).own, ["Morto-vivo", "Médio"]);
  const especial = "Morto-vivo Especial ND 2\nConstruto Grande\nIniciativa +2";
  assert.equal(classificationTokens(especial), null);
  const bug = parse(especial, LABELS_PT, { fix: false });
  const fixed = parse(especial, LABELS_PT);
  assert.equal(fixed.changed, false);
  assert.deepEqual(fixed.schema, bug.schema);
  assert.deepEqual(fixed.log, bug.log);
});

test("importer: a type line joined to the name line is read after the ND (lower case, one-line paste)", () => {
  const lower = preprocess("Zumbi ND 1/4\nmorto-vivo (bando) grande\nIniciativa -1");
  assert.equal(lower, "Zumbi ND 1/4 morto-vivo (bando) grande\nIniciativa -1");
  assert.equal(parse(lower, LABELS_PT, { fix: false }).schema.detalhes.raca, "Grande");
  const { schema, log } = parse(lower, LABELS_PT);
  assert.deepEqual(schema, { detalhes: { tipo: "mor", role: "", raca: "Bando" }, tracos: { tamanho: "gra" } });
  assert.deepEqual(
    messages(log).filter((m) => m.includes("Subtipo")),
    ["+Subtipo de Criatura: Bando"]
  );

  const oneLine = parse(preprocess("Zumbi ND 1/4 Morto-vivo Médio, Lacaio Iniciativa -1"), LABELS_PT);
  assert.deepEqual(oneLine.schema, { detalhes: { tipo: "mor", role: "lackey", raca: "" }, tracos: { tamanho: "med" } });
});

test("importer: name words joined to the type line neither block the type nor become the subtype", () => {
  const swamp = parse(preprocess("Monstro do Pântano ND 2\nmorto-vivo grande\nIniciativa -1"), LABELS_PT);
  assert.deepEqual(swamp.schema, { detalhes: { tipo: "mor", role: "", raca: "" }, tracos: { tamanho: "gra" } });
  assert.ok(messages(swamp.log).includes("+Tipo de Criatura: Morto-Vivo"));

  const block = preprocess("Zumbi ND 1/4 Morto-Vivo Médio Iniciativa -1");
  assert.equal(parse(block, LABELS_PT, { fix: false }).schema.detalhes.raca, "1/4");
  const zumbi = parse(block, LABELS_PT);
  assert.deepEqual(zumbi.schema, { detalhes: { tipo: "mor", role: "", raca: "" }, tracos: { tamanho: "med" } });
  assert.ok(!messages(zumbi.log).some((m) => m.includes("Subtipo")));

  // Nothing misread: the official result and log stay as they are.
  const orcBlock = preprocess("Orc Combatente ND 1/2 Humanoide (orc) Médio Iniciativa +2");
  const orc = parse(orcBlock, LABELS_PT);
  assert.equal(orc.changed, false);
  assert.deepEqual(orc.log, parse(orcBlock, LABELS_PT, { fix: false }).log);

  const again = structuredClone(swamp);
  for (let i = 0; i < 3; i++) {
    fixParsedType(preprocess("Monstro do Pântano ND 2\nmorto-vivo grande\nIniciativa -1"), again.schema, again.log, swamp.before, LABELS_PT);
  }
  assert.deepEqual(again, swamp);
});

test("importer: the log drops entries of fields a name word set and the patch fixed", () => {
  const swamp = parse(preprocess("Monstro do Pântano ND 2\nmorto-vivo grande\nIniciativa -1"), LABELS_PT);
  assert.ok(!messages(swamp.log).includes("+Tipo de Criatura: Monstro"));
  const guard = parse(preprocess("Grande Guardião ND 3\nconstruto pequeno\nIniciativa +1"), LABELS_PT);
  assert.deepEqual([guard.schema.detalhes.tipo, guard.schema.tracos.tamanho], ["con", "peq"]);
  const sizes = messages(guard.log).filter((m) => m.includes("Tamanho"));
  assert.deepEqual(sizes, ["+Tamanho: Pequeno"]);

  const twice = parse(preprocess("Monstro Construto ND 2\nmorto-vivo grande\nIniciativa -1"), LABELS_PT);
  assert.deepEqual(messages(twice.log).filter((m) => m.includes("Tipo de Criatura")), ["+Tipo de Criatura: Morto-Vivo"]);

  // The type already matches: nothing is fixed, and repeated calls keep the real subtype entry.
  const orcBlock = preprocess("Monstro Orc ND 2 monstro (orc) grande\nIniciativa -1");
  const orc = parse(orcBlock, LABELS_PT);
  const again = structuredClone(orc);
  for (let i = 0; i < 3; i++) fixParsedType(orcBlock, again.schema, again.log, orc.before, LABELS_PT);
  assert.deepEqual(again.log, orc.log);
  assert.ok(messages(orc.log).includes("+Subtipo de Criatura: Orc"));
});

test("importer: a blank line before Iniciativa and a hyphen split at a line break", () => {
  const blank = "Zumbi ND 1/4\nMorto-vivo (bando) Grande\n\nIniciativa -1, Percepção -1";
  assert.deepEqual(types(parse(blank, LABELS_PT, { fix: false })), "hum/med//raca=\"\"");
  const fixed = parse(blank, LABELS_PT);
  assert.deepEqual(types(fixed), "mor/gra//raca=\"Bando\"");
  assert.ok(!messages(fixed.log).includes("+Subtipo de Criatura: "));
  assert.equal(messages(fixed.log).filter((m) => m === "+Subtipo de Criatura: Bando").length, 1);
  assert.equal(classificationTokens("Zumbi ND 1/4\n\nIniciativa -1").own.length, 0);
  assert.equal(classificationTokens("Morto-vivo Especial\n\nIniciativa -1"), null);

  const split = preprocess("Zumbi ND 1/4\nMorto-\nvivo Grande\nIniciativa -1");
  assert.equal(parse(split, LABELS_PT, { fix: false }).schema.detalhes.raca, "Mortovivo");
  assert.equal(types(parse(split, LABELS_PT)), "mor/gra//raca=\"\"");
});

test("importer: a block the original already reads is left exactly as is", () => {
  for (const block of [KOBOLD, TURBA.replace("Morto-vivo", "Morto-Vivo")]) {
    const bug = parse(block, LABELS_PT, { fix: false });
    const fixed = parse(block, LABELS_PT);
    assert.equal(fixed.changed, false);
    assert.deepEqual(fixed.schema, bug.schema);
    assert.deepEqual(fixed.log, bug.log);
  }
  assert.equal(parse(KOBOLD, LABELS_PT).schema.detalhes.raca, "Enxame");
});

test("importer: idempotent, and fields changed after the original are kept", () => {
  const once = parse(ZUMBI, LABELS_EN);
  const again = structuredClone(once);
  for (let i = 0; i < 3; i++) fixParsedType(ZUMBI, again.schema, again.log, once.before, LABELS_EN);
  assert.deepEqual(again.schema, once.schema);
  assert.deepEqual(again.log, once.log);

  useLabels(LABELS_PT);
  const schema = freshSchema();
  const log = [];
  const before = { tipo: "hum", role: "", raca: "", tamanho: "med" };
  new OriginalParser().parseData(ZUMBI, schema, [], log);
  schema.detalhes.tipo = "esp";
  fixParsedType(ZUMBI, schema, log, before, LABELS_PT);
  assert.equal(schema.detalhes.tipo, "esp");
});

test("importer: blocks without a type line are ignored", () => {
  assert.equal(typeTokens("Zumbi ND 1/4\nDefesa 11"), null);
  const schema = freshSchema();
  assert.equal(fixParsedType("Zumbi ND 1/4\nDefesa 11", schema, [], { tipo: "hum", role: "", raca: "", tamanho: "med" }, LABELS_PT), false);
  assert.deepEqual(schema, freshSchema());
});

test("classifyToken: case-insensitive, commas trimmed, rulebook words and labels", () => {
  assert.deepEqual(classifyToken("MORTO-VIVO"), { field: "tipo", key: "mor" });
  assert.deepEqual(classifyToken("Médio,"), { field: "size", key: "med" });
  assert.deepEqual(classifyToken("Minion", LABELS_EN), { field: "role", key: "lackey" });
  assert.equal(classifyToken("Kobold,"), null);
  assert.equal(classifyToken(","), null);
});

test("parserRecognized: the 1.6.5 code only, not a changed or commented copy", () => {
  assert.equal(parserRecognized(PARSE_DATA_1_6_5), true);
  assert.equal(parserRecognized(String(OriginalParser.prototype.parseData)), true);
  assert.equal(parserRecognized(PARSE_DATA_1_6_5.replace("cType[m] ||", "cType[m.toLowerCase()] ||")), false);
  const commented = PARSE_DATA_1_6_5.split("\n").map((line) => `// ${line}`).join("\n");
  assert.equal(parserRecognized(`function parseData() {}\n${commented}`), false);
  assert.equal(parserRecognized(undefined), false);
});

test("parserFailures: whole blocks; the size comma fails under any label, English misses the Portuguese words", () => {
  const sorted = (list) => [...list].sort();
  const commas = ["Minúsculo,", "Pequeno,", "Médio,", "Grande,", "Enorme,", "Colossal,"];
  assert.deepEqual(sorted(parserFailures(LABELS_PT)), sorted(["Morto-vivo", ...commas]));
  assert.deepEqual(sorted(parserFailures(LABELS_EN)), sorted([
    "Construto", "Espírito", "Humanoide", "Monstro", "Morto-vivo",
    "Minúsculo", "Pequeno", "Médio", "Grande", "Enorme",
    "Lacaio", "Especial", ...commas
  ]));
  // Labels in the rulebook spelling still fail on the comma: the parser is never reported fixed by the words alone.
  const book = { types: { ...LABELS_PT.types, mor: "Morto-vivo" }, roles: LABELS_PT.roles, sizes: LABELS_PT.sizes };
  assert.deepEqual(sorted(parserFailures(book)), sorted(commas));
});

function withFoundry(parserClass, fn) {
  const saved = { CONFIG: globalThis.CONFIG, tormenta20: globalThis.tormenta20 };
  const calls = [];
  class Actor {
    async _preCreate(...args) {
      calls.push({ self: this, args });
      return "original";
    }
  }
  globalThis.CONFIG = { ...globalThis.CONFIG, Actor: { documentClass: Actor } };
  globalThis.tormenta20 = { applications: { StatblockParser: parserClass } };
  try {
    return fn({ Actor, calls });
  } finally {
    globalThis.CONFIG = saved.CONFIG;
    globalThis.tormenta20 = saved.tormenta20;
  }
}

const fakeActor = (Actor, src, extra = {}) =>
  Object.assign(Object.create(Actor.prototype), {
    _source: structuredClone(src),
    updates: [],
    updateSource(u) {
      this.updates.push(u);
    },
    ...extra
  });

test("apply: wraps the importer and the actor copy, preserving this and the result", async () => {
  useLabels(LABELS_PT);
  class Parser extends OriginalParser {}
  Parser.prototype.parseData = OriginalParser.prototype.parseData;
  await withFoundry(Parser, async ({ Actor, calls }) => {
    useLabels(LABELS_PT);
    globalThis.CONFIG.Actor = { documentClass: Actor };
    patch.apply();
    assert.notEqual(Parser.prototype.parseData, OriginalParser.prototype.parseData);
    assert.equal(unwrap(Parser.prototype.parseData), OriginalParser.prototype.parseData);
    const schema = freshSchema();
    const log = [];
    assert.equal(new Parser().parseData(ZUMBI, schema, [], log), "result");
    assert.equal(schema.detalhes.tipo, "mor");
    assert.equal(schema.detalhes.raca, "");

    const zumbi = pack("aDJoJf7PgQ33UvNA");
    const actor = fakeActor(Actor, zumbi);
    assert.equal(await actor._preCreate({}, {}, "u"), "original");
    assert.deepEqual(actor.updates, [{ system: { detalhes: { tipo: "mor", raca: "" } } }]);
    assert.equal(calls.at(-1).self, actor);

    for (const [extra, options] of [[{}, { pack: "world.monstros" }], [{ pack: "world.monstros" }, {}], [{ parent: { pack: "world.x" } }, {}]]) {
      const inPack = fakeActor(Actor, zumbi, extra);
      await inPack._preCreate({}, options, "u");
      assert.deepEqual(inPack.updates, []);
    }
    const foreign = fakeActor(Actor, { ...zumbi, _stats: { compendiumSource: "Compendium.world.monstros.Actor.aDJoJf7PgQ33UvNA" } });
    await foreign._preCreate({}, {}, "u");
    assert.deepEqual(foreign.updates, []);
    const keepId = fakeActor(Actor, { ...zumbi, _stats: {} });
    await keepId._preCreate({}, {}, "u");
    assert.equal(keepId.updates.length, 1);
  });
});

test("apply: an unrecognized importer is left untouched", () => {
  class Parser {
    parseData(statblock, schema) {
      schema.detalhes.tipo = "hum";
    }
  }
  const original = Parser.prototype.parseData;
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    withFoundry(Parser, () => patch.apply());
  } finally {
    console.warn = warn;
  }
  assert.equal(Parser.prototype.parseData, original);
  assert.ok(warnings.some((w) => w.includes("not recognized")));
});

test("wrapper: a failing correction keeps the official result", () => {
  class Parser extends OriginalParser {}
  Parser.prototype.parseData = OriginalParser.prototype.parseData;
  withFoundry(Parser, () => {
    useLabels(LABELS_PT);
    globalThis.CONFIG.Actor = { documentClass: class {} };
    patch.apply();
    const schema = freshSchema();
    const tracos = schema.tracos;
    let reads = 0;
    // 1st read: the wrapper's snapshot; 2nd: the original (size); 3rd: the correction, which fails.
    Object.defineProperty(schema, "tracos", {
      get() {
        if (++reads > 2) throw new Error("boom");
        return tracos;
      }
    });
    const warn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const log = [];
      assert.equal(new Parser().parseData(ZUMBI, schema, [], log), "result");
      assert.equal(schema.detalhes.tipo, "hum");
      assert.equal(schema.detalhes.raca, "Morto-vivo");
      assert.equal(reads, 3);
      assert.ok(warnings.some((w) => w.includes("parser correction skipped")));
    } finally {
      console.warn = warn;
    }
  });
});
