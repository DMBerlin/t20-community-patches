/**
 * Platform of the static audit (#90): answers method labels from a bundle index and the system version from
 * system.json. Every other port needs a running Foundry and throws, so a probe that reads runtime state without
 * declaring `probeKind: "behavior"` shows up as an error instead of a wrong diagnosis.
 */

/** Error of a port the audit cannot answer. */
export class RequiresFoundry extends Error {
  constructor(port) {
    super(`platform.${port} requires Foundry`);
    this.name = "RequiresFoundry";
  }
}

const quiet = Object.freeze({ info: () => {}, warn: () => {}, error: () => {} });

function throwing(port) {
  return new Proxy(
    {},
    {
      get: (_, key) => {
        if (typeof key === "symbol") return undefined;
        throw new RequiresFoundry(`${port}.${key}`);
      }
    }
  );
}

/**
 * @param {object} args
 * @param {import("./bundle-index.mjs").BundleIndex} args.index
 * @param {{id?: string, version: string, title?: string}} args.system
 * @param {(label: string) => void} [args.onLabel]  Called with every label a probe asks for.
 * @returns {object} A Platform whose unsupported ports throw RequiresFoundry.
 */
export function createAuditPlatform({ index, system, onLabel = () => {} }) {
  const ports = {
    system: Object.freeze({ id: system.id ?? "tormenta20", version: system.version, title: system.title ?? "Tormenta20" }),
    log: quiet,
    hooks: throwing("hooks"),
    sourceOfMethod: (label) => {
      onLabel(label);
      return index.source(label);
    }
  };
  return new Proxy(Object.freeze(ports), {
    get: (target, key) => {
      if (typeof key === "symbol" || key in target) return target[key];
      throw new RequiresFoundry(String(key));
    }
  });
}
