import { isProxy } from "node:util/types";

/**
 * Declarative sandbox boundaries an external MCP source may require.
 *
 * Internal broker guarantees (for example process-tree and code-snapshot) are
 * deliberately not part of this source-controlled contract. A trusted host
 * may add its own non-removable requirements after this value is normalized.
 */
export const MCP_SANDBOX_BOUNDARIES = Object.freeze(["filesystem", "network"]);

export const MCP_SANDBOX_POLICY_INVALID_CODE = "CC_MCP_SANDBOX_POLICY_INVALID";
export const MCP_STDIO_CWD_INVALID_CODE = "CC_MCP_STDIO_SANDBOX_CWD_INVALID";

const SUPPORTED_BOUNDARIES = new Set(MCP_SANDBOX_BOUNDARIES);
const MAX_BOUNDARY_DECLARATIONS = 32;

function invalidPolicy(message) {
  const error = new TypeError(message);
  error.code = MCP_SANDBOX_POLICY_INVALID_CODE;
  return error;
}

function invalidCwd(message) {
  const error = new TypeError(message);
  error.code = MCP_STDIO_CWD_INVALID_CODE;
  return error;
}

/**
 * Read an optional stdio working directory without invoking accessors or Proxy
 * traps. Absence means "retain/default" while null and the empty string are an
 * explicit clear. Every other value must be a NUL-free string.
 */
export function readMcpStdioCwd(owner, options = {}) {
  const label =
    typeof options.label === "string" && options.label.length > 0
      ? options.label
      : "MCP stdio config";
  if (!owner || typeof owner !== "object" || isProxy(owner)) {
    throw invalidCwd(`${label} must be a non-Proxy object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, "cwd");
  if (!descriptor) return { present: false, cwd: null };
  if (!("value" in descriptor)) {
    throw invalidCwd(`${label}.cwd must be an own data property`);
  }
  const value = descriptor.value;
  if (value == null || value === "") return { present: true, cwd: null };
  if (typeof value !== "string" || value.includes("\0")) {
    throw invalidCwd(`${label}.cwd must be a NUL-free path string`);
  }
  return { present: true, cwd: value };
}

function ownDataDescriptor(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw invalidPolicy(`${label} must be an own data property`);
  }
  return descriptor;
}

function normalizeRequiredBoundaries(value, label) {
  if (!Array.isArray(value) || isProxy(value)) {
    throw invalidPolicy(`${label} must be a non-Proxy array`);
  }

  const lengthDescriptor = ownDataDescriptor(
    value,
    "length",
    `${label}.length`,
  );
  const length = lengthDescriptor.value;
  if (length > MAX_BOUNDARY_DECLARATIONS) {
    throw invalidPolicy(
      `${label} exceeds ${MAX_BOUNDARY_DECLARATIONS} boundary declarations`,
    );
  }
  const allowedKeys = new Set(["length"]);
  const requiredBoundaries = new Set();

  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = ownDataDescriptor(value, key, `${label}[${index}]`);
    const boundary = descriptor.value;
    if (typeof boundary !== "string" || !SUPPORTED_BOUNDARIES.has(boundary)) {
      throw invalidPolicy(`${label} contains an unsupported boundary`);
    }
    requiredBoundaries.add(boundary);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw invalidPolicy(
        `${label} contains unsupported property: ${String(key)}`,
      );
    }
  }

  return Object.freeze([...requiredBoundaries].sort());
}

/**
 * Normalize an MCP source's small declarative sandbox contract.
 *
 * The input is treated as untrusted data: Proxy objects, inherited/accessor
 * fields, non-plain objects, and unknown fields are rejected without invoking
 * user-controlled code. `null` and an empty policy retain the legacy meaning
 * of "no source-declared requirements".
 *
 * @param {unknown} value
 * @param {{label?: string}} [options]
 * @returns {{requiredBoundaries: readonly string[]}|null}
 */
export function normalizeMcpSandboxPolicy(value, options = {}) {
  const label =
    typeof options.label === "string" && options.label.length > 0
      ? options.label
      : "sandboxPolicy";

  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    throw invalidPolicy(`${label} must be a non-Proxy plain object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidPolicy(`${label} must be a plain object`);
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (key !== "requiredBoundaries") {
      throw invalidPolicy(
        `${label} contains unsupported field: ${String(key)}`,
      );
    }
  }

  if (!keys.includes("requiredBoundaries")) return null;
  const descriptor = ownDataDescriptor(
    value,
    "requiredBoundaries",
    `${label}.requiredBoundaries`,
  );
  const requiredBoundaries = normalizeRequiredBoundaries(
    descriptor.value,
    `${label}.requiredBoundaries`,
  );
  if (requiredBoundaries.length === 0) return null;

  return Object.freeze({ requiredBoundaries });
}

/**
 * Add the host-owned isolation floor for an exact-package stdio capsule.
 *
 * Source configuration is normalized as untrusted data first and can only add
 * requirements to this floor. The returned policy is a new deeply-frozen
 * runtime value, so neither the source object nor later launch preparation can
 * remove a host requirement. Callers must only attach this policy after the
 * trusted executable-identity preparer has issued a capsule execution
 * contract; legacy stdio sources intentionally retain their existing policy.
 * There is deliberately no source-configured escape hatch: future workspace
 * or egress access must be a separate host-issued, authority-bound capability.
 *
 * @param {unknown} value
 * @param {{label?: string}} [options]
 * @returns {{requiredBoundaries: readonly string[]}}
 */
export function enforceMcpStdioCapsuleHostSandboxPolicy(value, options = {}) {
  const sourcePolicy = normalizeMcpSandboxPolicy(value, options);
  const requiredBoundaries = Object.freeze(
    [
      ...new Set([
        ...MCP_SANDBOX_BOUNDARIES,
        ...(sourcePolicy?.requiredBoundaries || []),
      ]),
    ].sort(),
  );
  return Object.freeze({ requiredBoundaries });
}
