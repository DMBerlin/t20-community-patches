/**
 * Labels that name a function of the Tormenta20 system by where it is declared in the bundle, so a probe can read
 * its source both in Foundry and in the static audit (tools/audit.mjs, #90):
 *
 * - `Class#member`: method or getter declared in the body of `class Class` (prototype);
 * - `Class.member`: static method of `class Class`;
 * - `#helper:name`: Handlebars helper registered by the system;
 * - `#local:name`: function declared at the top level of the bundle (never reachable in Foundry).
 */

/**
 * @typedef {{kind: "instance"|"static", className: string, member: string}
 *   | {kind: "helper"|"local", name: string}} MethodLabel
 */

const CLASS_LABEL = /^([A-Za-z_$][\w$]*)([#.])([A-Za-z_$][\w$]*)$/;
const NAMED_LABEL = /^#(helper|local):([A-Za-z_$][\w$-]*)$/;

/**
 * @param {string} label
 * @returns {MethodLabel|null}
 */
export function parseMethodLabel(label) {
  if (typeof label !== "string") return null;
  const named = NAMED_LABEL.exec(label);
  if (named) return { kind: named[1], name: named[2] };
  const match = CLASS_LABEL.exec(label);
  if (!match) return null;
  return { kind: match[2] === "#" ? "instance" : "static", className: match[1], member: match[3] };
}

/** The function behind a property descriptor: the getter of an accessor, otherwise the value. */
function described(descriptor) {
  const fn = descriptor?.get ?? descriptor?.value;
  return typeof fn === "function" ? fn : null;
}

/** The function `holder` inherits under `member`, from the nearest ancestor that declares it. */
function inheritedFunction(holder, member) {
  for (let proto = Object.getPrototypeOf(holder); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, member);
    if (descriptor) return described(descriptor);
  }
  return null;
}

/**
 * The function behind an own property. A wrapper whose original (`original`) is the inherited function is not a
 * declaration: wrapping a member the class only inherits puts the wrapper on the class itself.
 */
function ownFunction(holder, member, original) {
  const fn = holder ? described(Object.getOwnPropertyDescriptor(holder, member)) : null;
  if (!fn) return null;
  const inner = original(fn);
  const inherited = inheritedFunction(holder, member);
  return inner !== fn && inherited && inner === original(inherited) ? null : fn;
}

/** The class itself and its ancestors, up to (and excluding) Function.prototype. */
function* lineage(cls) {
  const seen = new Set();
  for (let c = cls; typeof c === "function" && c !== Function.prototype && !seen.has(c); c = Object.getPrototypeOf(c)) {
    seen.add(c);
    yield c;
  }
}

/**
 * Finds the function a class label names among runtime classes. Each root is searched with its ancestors until the
 * class with the label's name that declares the member; the order of `roots` decides between two classes with the
 * same name. An override declared between the root and that class by a class outside the system (another module's
 * document class, for example) wins, because it is what the root runs; an override by a system class (a sheet or
 * data model subclass that delegates to `super`) does not, so the label always names the system's declaration. A
 * foreign override also wins when that class only inherits the member (a core hook the system does not override).
 * @param {MethodLabel} parsed  An "instance" or "static" label.
 * @param {Iterable<Function>} roots
 * @param {(cls: Function) => boolean} [isSystemClass]  Without it, every override wins.
 * @param {(fn: Function) => Function} [original]  The function a wrapper replaced (unwrap), to ignore wrappers of
 *   inherited members.
 * @returns {Function|null}
 */
export function findClassMember(parsed, roots, isSystemClass = () => false, original = (fn) => fn) {
  const holder = (cls) => (parsed.kind === "static" ? cls : cls.prototype);
  for (const root of roots) {
    let foreign = null;
    for (const cls of lineage(root)) {
      const fn = ownFunction(holder(cls), parsed.member, original);
      if (cls.name === parsed.className && (foreign ?? fn)) return foreign ?? fn;
      if (fn && !isSystemClass(cls)) foreign ??= fn;
    }
  }
  return null;
}
