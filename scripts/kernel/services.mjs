/**
 * Shared stateful contracts (#87): installed by the kernel on demand, once, right before the first feature that
 * declares them in `services`. Pure: the definitions and the context factory come in through parameters.
 *
 * @typedef {object} Service
 * @property {string} id
 * @property {(ctx: ServiceContext) => object} install   Returns the public API; called ONCE.
 *
 * @typedef {object} ServiceContext
 * @property {string} id
 * @property {import("../platform/foundry.mjs").Platform} platform
 * @property {import("./context.mjs").FeatureLog} log
 * @property {import("../platform/foundry.mjs").Platform["hooks"]} hooks
 * @property {(target: object, method: string, wrapper: Function, options?: object) => Function} wrap  Owner = id.
 */

/**
 * @param {Service[]} services
 * @param {(service: Service) => ServiceContext} contextFor
 */
export function createServiceRegistry(services, contextFor) {
  const definitions = new Map(services.map((service) => [service.id, service]));
  /** @type {Map<string, {api?: object, error?: unknown}>} */
  const installed = new Map();

  /** Installs the service if needed and returns its API. A failed install throws again, without retrying. */
  function ensure(id) {
    const done = installed.get(id);
    if (done?.error) throw done.error;
    if (done) return done.api;
    const service = definitions.get(id);
    if (!service) throw new Error(`Unknown service "${id}"`);
    try {
      const api = Object.freeze(service.install(contextFor(service)) ?? {});
      installed.set(id, { api });
      return api;
    } catch (err) {
      const error = new Error(`Service "${id}" failed to install: ${err?.message ?? err}`, { cause: err });
      installed.set(id, { error });
      throw error;
    }
  }

  return Object.freeze({
    ensure,
    has: (id) => definitions.has(id),
    ids: () => [...definitions.keys()],
    /** Ids of the services installed so far, in install order. */
    installed: () => [...installed].filter(([, entry]) => !entry.error).map(([id]) => id)
  });
}

/**
 * `ctx.services` of a feature: only the declared ids resolve; any other id throws.
 * @param {{id: string, services?: string[]}} feature
 * @param {{ensure: (id: string) => object}|undefined} registry
 */
export function servicesView(feature, registry) {
  const declared = new Set(feature.services ?? []);
  return new Proxy(Object.freeze({}), {
    get(_target, key) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (!declared.has(key)) throw new Error(`${feature.id}: service "${key}" is not declared in services`);
      if (!registry) throw new Error(`${feature.id}: no service registry`);
      return registry.ensure(key);
    },
    has: (_target, key) => declared.has(key),
    ownKeys: () => [],
    set: () => false
  });
}
