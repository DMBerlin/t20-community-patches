/**
 * Static index of a Tormenta20 bundle (#90): parses the text with acorn and maps method labels
 * (scripts/lib/method-label.mjs) to the exact source text Function.prototype.toString returns in Foundry. The bundle
 * is never imported nor evaluated.
 */
import { parse } from "acorn";

const FUNCTION_TYPES = new Set(["FunctionExpression", "ArrowFunctionExpression"]);

function isNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

function children(node) {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(isNode);
}

/** Every node of the tree, depth first, with its parent. */
function* walk(node, parent = null) {
  yield { node, parent };
  for (const child of children(node)) yield* walk(child, node);
}

function lineStarts(code) {
  const starts = [0];
  for (let i = code.indexOf("\n"); i >= 0; i = code.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function keyName(node) {
  if (node.computed) return node.key?.type === "Literal" && typeof node.key.value === "string" ? node.key.value : null;
  if (node.key?.type === "Identifier") return node.key.name;
  if (node.key?.type === "Literal" && typeof node.key.value === "string") return node.key.value;
  return null;
}

/** Name the class is reachable by: the declaration, or the binding a class expression is assigned to. */
function classBinding(node, parent) {
  if (node.type === "ClassDeclaration") return { name: node.id?.name, bound: true };
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return { name: parent.id.name, bound: true };
  if (parent?.type === "AssignmentExpression" && parent.left.type === "Identifier") return { name: parent.left.name, bound: true };
  return { name: node.id?.name, bound: false };
}

/** Text Function.prototype.toString gives for a class member: without the `static` keyword. */
function memberSource(code, member) {
  const text = code.slice(member.start, member.end);
  return member.static ? text.replace(/^static\s+/, "") : text;
}

/**
 * Methods of a class body as {label, node, source}. A field or a static block that may write a member yields
 * {label, node: null}: the label is invalidated, since the method under it is not what runs.
 */
function* classMembers(code, node, className) {
  for (const member of node.body.body) {
    if (member.type === "StaticBlock") {
      yield* staticWrites(member, className);
      continue;
    }
    const name = keyName(member);
    const label = name && `${className}${member.static ? "." : "#"}${name}`;
    if (member.type === "PropertyDefinition" && label) yield { label, node: null };
    if (member.type !== "MethodDefinition" || member.kind === "constructor" || member.kind === "set" || !label) continue;
    yield { label, node: member, source: memberSource(code, member) };
  }
}

/** Labels a `static { this.x = …; this.prototype.y = …; }` block writes to. */
function* staticWrites(block, className) {
  for (const { node } of walk(block)) {
    const target = node.type === "AssignmentExpression" ? node.left : null;
    if (target?.type !== "MemberExpression") continue;
    const name = propertyName(target);
    if (!name) continue;
    if (target.object.type === "ThisExpression") yield { label: `${className}.${name}`, node: null };
    else if (target.object.type === "MemberExpression" && target.object.object.type === "ThisExpression" && propertyName(target.object) === "prototype") {
      yield { label: `${className}#${name}`, node: null };
    }
  }
}

/** Name of `a.b` or `a["b"]`; null for any other computed property. */
function propertyName(member) {
  if (!member.computed) return member.property.type === "Identifier" ? member.property.name : null;
  return member.property.type === "Literal" && typeof member.property.value === "string" ? member.property.value : null;
}

/**
 * Label an assignment rebinds, whatever the assigned value: `X.prototype.y = …` → X#y, `X.y = …` → X.y (dot or
 * string key) and `name = …` → #local:name. The caller only keeps the code of an inline function and invalidates the
 * label otherwise.
 */
function assignedLabel(left) {
  if (left.type === "Identifier") return `#local:${left.name}`;
  if (left.type !== "MemberExpression") return null;
  const name = propertyName(left);
  if (!name) return null;
  const object = left.object;
  if (object.type === "Identifier") return `${object.name}.${name}`;
  const proto = object.type === "MemberExpression" && propertyName(object) === "prototype";
  if (proto && object.object.type === "Identifier") return `${object.object.name}#${name}`;
  return null;
}

/**
 * `Handlebars.registerHelper("name", fn)` and the object form `registerHelper({name: fn})`, as {name, fn}; `fn` is
 * any expression, and only an inline function is indexed.
 */
function* helpers(node) {
  const callee = node.callee;
  const method = callee.type === "MemberExpression" ? propertyName(callee) : null;
  if (method !== "registerHelper" && method !== "unregisterHelper") return;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Handlebars") return;
  const [first, second] = node.arguments;
  if (first?.type === "Literal" && typeof first.value === "string") {
    yield { name: first.value, fn: method === "registerHelper" ? second : null };
    return;
  }
  if (first?.type !== "ObjectExpression") {
    yield { name: null };
    return;
  }
  for (const prop of first.properties) {
    const name = prop.type === "Property" ? keyName(prop) : null;
    yield name ? { name, fn: prop.value } : { name: null };
  }
}

const DEFINERS = new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf", "deleteProperty", "set"]);

/**
 * Class a call may redefine members of: `Object.assign(X.prototype, …)`, `Object.defineProperty(X, …)`,
 * `Reflect.set(…)` and the bundler helpers (`__publicField(X, …)`, `__decorateClass(…, X.prototype, …)`), as
 * {name, prototype}; prototype is null when any member may change.
 */
function* redefinedClasses(node) {
  const callee = node.callee;
  const definer =
    (callee.type === "MemberExpression" && callee.object.type === "Identifier" && ["Object", "Reflect"].includes(callee.object.name) && DEFINERS.has(propertyName(callee))) ||
    (callee.type === "Identifier" && callee.name.startsWith("__"));
  if (!definer) return;
  for (const arg of node.arguments) {
    if (arg.type === "Identifier") yield { name: arg.name, prototype: false };
    const proto = arg.type === "MemberExpression" && arg.object.type === "Identifier" && propertyName(arg) === "prototype";
    if (proto) yield { name: arg.object.name, prototype: true };
  }
}

/** `function name…` and `const name = function…`/`(…) => …` at the top level, as [name, function node]. */
function* topLevelFunctions(program) {
  for (const entry of program.body) {
    const statement = entry.type === "ExportNamedDeclaration" ? entry.declaration : entry;
    if (statement?.type === "FunctionDeclaration" && statement.id) yield [statement.id.name, statement];
    if (statement?.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations) {
      if (declarator.id.type === "Identifier" && FUNCTION_TYPES.has(declarator.init?.type)) yield [declarator.id.name, declarator.init];
    }
  }
}

function createTable(starts) {
  const map = new Map();
  return {
    map,
    /** A label found twice with different code is ambiguous: null, for good. */
    add(label, node, source) {
      if (map.has(label)) {
        const previous = map.get(label);
        if (previous?.source !== source) map.set(label, null);
        return;
      }
      map.set(label, { source, line: lineAt(starts, node.start) });
    },
    /** The label's function is replaced by code the index cannot read: null, for good. */
    invalidate(label) {
      map.set(label, null);
    },
    /** Every member of a class whose binding is reassigned: the index cannot tell which class runs. */
    invalidateClass(name, prefixes = ["#", "."]) {
      for (const label of map.keys()) if (prefixes.some((p) => label.startsWith(`${name}${p}`))) map.set(label, null);
    },
    /** Every label starting with `prefix`, such as every helper when one is registered under an unknown name. */
    invalidatePrefix(prefix) {
      for (const label of map.keys()) if (label.startsWith(prefix)) map.set(label, null);
    }
  };
}

/** Indexes an inline function under the label; anything else bound to it (or nothing known) invalidates it. */
function indexFunction(code, table, label, fn) {
  if (FUNCTION_TYPES.has(fn?.type)) table.add(label, fn, code.slice(fn.start, fn.end));
  else table.invalidate(label);
}

function addMembers(table, members) {
  for (const member of members) {
    if (member.node) table.add(member.label, member.node, member.source);
    else table.invalidate(member.label);
  }
}

function indexClass(code, node, parent, state) {
  const { name, bound } = classBinding(node, parent);
  if (!name) return;
  addMembers(bound ? state.tables.primary : state.tables.secondary, classMembers(code, node, name));
  if (bound) state.primaryClasses.add(name);
  if (!bound || !node.id?.name || node.id.name === name) return;
  addMembers(state.tables.secondary, classMembers(code, node, node.id.name));
  state.aliases.set(name, [...(state.aliases.get(name) ?? []), node.id.name]);
}

function indexCall(code, node, state) {
  for (const { name, fn } of helpers(node)) {
    if (name === null) state.unknownHelper = true;
    else indexFunction(code, state.tables.primary, `#helper:${name}`, fn);
  }
  for (const { name, prototype } of redefinedClasses(node)) state.redefined.push([name, prototype ? ["#"] : ["#", "."]]);
}

function indexNode(code, node, parent, state) {
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    indexClass(code, node, parent, state);
  } else if (node.type === "AssignmentExpression") {
    const label = assignedLabel(node.left);
    if (node.left.type === "Identifier") state.reassigned.add(node.left.name);
    if (label) indexFunction(code, state.tables.primary, label, node.operator === "=" ? node.right : null);
  } else if (node.type === "UnaryExpression" && node.operator === "delete" && node.argument.type === "MemberExpression") {
    const label = assignedLabel(node.argument);
    if (label) state.tables.primary.invalidate(label);
  } else if (node.type === "CallExpression") {
    indexCall(code, node, state);
  }
}

/** Names declared more than once at the top level (`var x = …; var x = …;`), as if reassigned. */
function redeclared(program) {
  const seen = new Set();
  const twice = new Set();
  for (const entry of program.body) {
    const statement = entry.type === "ExportNamedDeclaration" ? entry.declaration : entry;
    const names =
      statement?.type === "VariableDeclaration"
        ? statement.declarations.filter((d) => d.id.type === "Identifier").map((d) => d.id.name)
        : statement?.type === "FunctionDeclaration" || statement?.type === "ClassDeclaration"
          ? [statement.id?.name]
          : [];
    for (const name of names) (seen.has(name) ? twice : seen).add(name);
  }
  return twice;
}

/**
 * @typedef {object} BundleIndex
 * @property {(label: string) => string|null} source  Source of a labeled function; null when absent or ambiguous.
 * @property {(label: string) => number|null} line    1-based line where it starts.
 * @property {() => string[]} labels                  Every label with a single definition, sorted.
 * @property {string[]} lines                          The bundle split in lines.
 */

/**
 * Indexes the labeled functions of a bundle. A class declaration (or a class expression bound to a variable) wins
 * over the inner name of a class expression, so `let ActiveEffectT20$1 = class ActiveEffectT20 {…}` never hides
 * `class ActiveEffectT20 {…}`.
 * @param {string} code  Text of the bundle.
 * @returns {BundleIndex}
 */
export function indexBundle(code) {
  const program = parse(code, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  const starts = lineStarts(code);
  const tables = { primary: createTable(starts), secondary: createTable(starts) };
  const state = { tables, reassigned: new Set(), primaryClasses: new Set(), aliases: new Map(), redefined: [], unknownHelper: false };
  for (const { node, parent } of walk(program)) indexNode(code, node, parent, state);
  for (const [name, fn] of topLevelFunctions(program)) tables.primary.add(`#local:${name}`, fn, code.slice(fn.start, fn.end));
  for (const name of redeclared(program)) {
    state.reassigned.add(name);
    tables.primary.invalidate(`#local:${name}`);
  }
  const invalidate = (name, prefixes) => {
    for (const table of [tables.primary, tables.secondary]) table.invalidateClass(name, prefixes);
    for (const alias of state.aliases.get(name) ?? []) tables.secondary.invalidateClass(alias, prefixes);
  };
  for (const name of state.reassigned) invalidate(name);
  for (const [name, prefixes] of state.redefined) invalidate(name, prefixes);
  if (state.unknownHelper) tables.primary.invalidatePrefix("#helper:");
  const className = (label) => /^[^#.]+/.exec(label)?.[0];
  const entry = (label) => {
    if (tables.primary.map.has(label)) return tables.primary.map.get(label);
    return state.primaryClasses.has(className(label)) ? null : (tables.secondary.map.get(label) ?? null);
  };
  return {
    source: (label) => entry(label)?.source ?? null,
    line: (label) => entry(label)?.line ?? null,
    labels: () => [...new Set([...tables.primary.map.keys(), ...tables.secondary.map.keys()])].filter(entry).sort(),
    lines: code.split("\n")
  };
}
