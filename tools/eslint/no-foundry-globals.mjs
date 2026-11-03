// Local ESLint rule: complements no-restricted-globals in the pure layers. It catches what the core rule misses:
// destructuring from a global object (const { game } = window) and chains through them (globalThis.window.game).
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

function staticName(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Globais do Foundry vindos de window, globalThis ou self nas camadas puras" },
    schema: [{ type: "object", properties: { globals: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
    messages: { foundryGlobal: "Global do Foundry '{{name}}' numa camada pura: receba-o da plataforma por ctx." }
  },
  create(context) {
    const restricted = new Set(context.options[0]?.globals ?? []);

    function isGlobal(identifier) {
      for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable.defs.length === 0;
      }
      return true;
    }

    /** window, globalThis, self (unshadowed) or a chain of them, such as globalThis.window. */
    function isGlobalObject(node) {
      if (node.type === "Identifier") return GLOBAL_OBJECTS.has(node.name) && isGlobal(node);
      if (node.type !== "MemberExpression") return false;
      return GLOBAL_OBJECTS.has(staticName(node.property, node.computed)) && isGlobalObject(node.object);
    }

    function checkPattern(pattern, init) {
      if (pattern?.type !== "ObjectPattern" || !init || !isGlobalObject(init)) return;
      for (const property of pattern.properties) {
        const name = property.type === "Property" ? staticName(property.key, property.computed) : undefined;
        if (restricted.has(name)) context.report({ node: property, messageId: "foundryGlobal", data: { name } });
      }
    }

    return {
      // Direct access (window.game) is already reported by no-restricted-globals with checkGlobalObject.
      MemberExpression(node) {
        const name = staticName(node.property, node.computed);
        if (restricted.has(name) && node.object.type === "MemberExpression" && isGlobalObject(node.object)) {
          context.report({ node, messageId: "foundryGlobal", data: { name } });
        }
      },
      VariableDeclarator: (node) => checkPattern(node.id, node.init),
      AssignmentExpression: (node) => checkPattern(node.left, node.right),
      AssignmentPattern: (node) => checkPattern(node.left, node.right)
    };
  }
};
