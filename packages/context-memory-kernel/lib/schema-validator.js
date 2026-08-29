"use strict";

const schema = require("../schema/context-memory-kernel.schema.json");
const { cloneCanonical } = require("./canonical.js");
const { normalizeContextItem, normalizeMemoryRecord } = require("./contracts.js");

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function resolveReference(root, reference) {
  if (!reference.startsWith("#/")) return null;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, part) => current?.[part], root);
}

function validateNode(value, node, path, errors, root) {
  const start = errors.length;
  if (node.$ref) {
    const target = resolveReference(root, node.$ref);
    if (!target) errors.push({ path, message: `unresolved schema reference ${node.$ref}` });
    else validateNode(value, target, path, errors, root);
    return errors.length === start;
  }
  if (Object.hasOwn(node, "const") && JSON.stringify(value) !== JSON.stringify(node.const)) {
    errors.push({ path, message: `must equal ${JSON.stringify(node.const)}` });
  }
  if (node.enum && !node.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push({ path, message: "must be an allowed enum value" });
  }
  for (const child of node.allOf || []) validateNode(value, child, path, errors, root);
  for (const keyword of ["oneOf", "anyOf"]) {
    if (!node[keyword]) continue;
    const matches = node[keyword].filter((child) => {
      const branchErrors = [];
      validateNode(value, child, path, branchErrors, root);
      return branchErrors.length === 0;
    }).length;
    if ((keyword === "oneOf" && matches !== 1) || (keyword === "anyOf" && matches < 1)) {
      errors.push({ path, message: `must match ${keyword}` });
    }
  }
  if (node.not) {
    const branchErrors = [];
    validateNode(value, node.not, path, branchErrors, root);
    if (branchErrors.length === 0) errors.push({ path, message: "must not match forbidden schema" });
  }
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push({ path, message: `must be ${types.join(" or ")}` });
    return false;
  }
  if (typeof value === "string") {
    if (node.minLength != null && value.length < node.minLength) errors.push({ path, message: `must have length >= ${node.minLength}` });
    if (node.maxLength != null && value.length > node.maxLength) errors.push({ path, message: `must have length <= ${node.maxLength}` });
    if (node.pattern && !new RegExp(node.pattern, "u").test(value)) errors.push({ path, message: "must match pattern" });
    if (node.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push({ path, message: "must be an ISO date-time" });
  }
  if (typeof value === "number") {
    if (node.minimum != null && value < node.minimum) errors.push({ path, message: `must be >= ${node.minimum}` });
    if (node.maximum != null && value > node.maximum) errors.push({ path, message: `must be <= ${node.maximum}` });
  }
  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) errors.push({ path, message: `must contain >= ${node.minItems} items` });
    if (node.maxItems != null && value.length > node.maxItems) errors.push({ path, message: `must contain <= ${node.maxItems} items` });
    if (node.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push({ path, message: "must contain unique items" });
    }
    value.forEach((item, index) => validateNode(item, node.items || {}, `${path}/${index}`, errors, root));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const name of node.required || []) {
      if (!Object.hasOwn(value, name)) errors.push({ path: `${path}/${name}`, message: "is required" });
    }
    for (const [name, child] of Object.entries(node.properties || {})) {
      if (Object.hasOwn(value, name)) validateNode(value[name], child, `${path}/${name}`, errors, root);
    }
    const known = new Set(Object.keys(node.properties || {}));
    for (const [name, childValue] of Object.entries(value)) {
      if (known.has(name)) continue;
      if (node.additionalProperties === false) errors.push({ path: `${path}/${name}`, message: "additional property is not allowed" });
      else if (node.additionalProperties && typeof node.additionalProperties === "object") {
        validateNode(childValue, node.additionalProperties, `${path}/${name}`, errors, root);
      }
    }
  }
  return errors.length === start;
}

function validationResult(errors) {
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function validateRuntimeInvariants(name, value, errors) {
  const normalizer = name === "ContextItem" ? normalizeContextItem : name === "MemoryRecord" ? normalizeMemoryRecord : null;
  if (!normalizer) return;
  try {
    normalizer(value);
  } catch (error) {
    errors.push({ path: "#", message: `runtime invariant failed: ${error?.code || error?.message || "invalid"}` });
  }
}

function validateContextMemorySchema(value) {
  const errors = [];
  validateNode(value, schema, "#", errors, schema);
  return validationResult(errors);
}

function validateContextMemoryDefinition(name, value) {
  const definition = schema.$defs[name];
  if (!definition) {
    return validationResult([{ path: "#", message: `unknown context/memory definition ${String(name)}` }]);
  }
  const errors = [];
  validateNode(value, definition, "#", errors, schema);
  if (errors.length === 0) validateRuntimeInvariants(name, value, errors);
  return validationResult(errors);
}

function assertContextMemoryDefinition(name, value) {
  const result = validateContextMemoryDefinition(name, value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid ${String(name)}: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
    );
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const CONTEXT_MEMORY_SCHEMA = deepFreeze(cloneCanonical(schema));

module.exports = {
  CONTEXT_MEMORY_SCHEMA,
  validateContextMemorySchema,
  validateContextMemoryDefinition,
  assertContextMemoryDefinition,
};
