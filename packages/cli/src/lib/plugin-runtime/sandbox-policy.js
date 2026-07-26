/**
 * Normalize the small, declarative sandbox contract exposed to plugins.
 *
 * Plugins may require filesystem and/or network isolation for processes they
 * cause the CLI to spawn. They may not select a sandbox profile or claim other
 * broker guarantees. Keeping this layer narrower than ProcessExecutionBroker's
 * internal contract prevents plugin-controlled policy from weakening managed
 * defaults while still allowing an explicit requirement to fail closed.
 */

export const PLUGIN_SANDBOX_BOUNDARIES = Object.freeze([
  "filesystem",
  "network",
]);

const SUPPORTED_BOUNDARIES = new Set(PLUGIN_SANDBOX_BOUNDARIES);

function invalidPolicy(message) {
  const error = new Error(message);
  error.code = "ERR_PLUGIN_SANDBOX_POLICY_INVALID";
  return error;
}

/**
 * @param {unknown} raw
 * @param {{ label?: string }} [opts]
 * @returns {{requiredBoundaries: string[]}|null}
 */
export function normalizePluginSandboxPolicy(raw, opts = {}) {
  const label = opts.label || "sandboxPolicy";
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidPolicy(`${label} must be an object`);
  }
  const unsupportedKeys = Object.keys(raw).filter(
    (key) => key !== "requiredBoundaries",
  );
  if (unsupportedKeys.length > 0) {
    throw invalidPolicy(
      `${label} contains unsupported field: ${unsupportedKeys[0]}`,
    );
  }

  const boundaries = raw.requiredBoundaries;
  if (boundaries === undefined) return null;
  if (!Array.isArray(boundaries)) {
    throw invalidPolicy(`${label}.requiredBoundaries must be an array`);
  }

  const requiredBoundaries = [];
  for (const boundary of boundaries) {
    if (
      typeof boundary !== "string" ||
      !SUPPORTED_BOUNDARIES.has(boundary)
    ) {
      throw invalidPolicy(
        `${label}.requiredBoundaries contains unsupported boundary: ${String(boundary)}`,
      );
    }
    if (!requiredBoundaries.includes(boundary)) {
      requiredBoundaries.push(boundary);
    }
  }

  return requiredBoundaries.length > 0 ? { requiredBoundaries } : null;
}

/**
 * Merge manifest/component/descriptor requirements additively. A child
 * descriptor can require more isolation, but cannot remove a manifest-level
 * requirement.
 */
export function mergePluginSandboxPolicies(...policies) {
  const requiredBoundaries = [];
  for (const raw of policies) {
    const policy = normalizePluginSandboxPolicy(raw);
    for (const boundary of policy?.requiredBoundaries || []) {
      if (!requiredBoundaries.includes(boundary)) {
        requiredBoundaries.push(boundary);
      }
    }
  }
  return requiredBoundaries.length > 0 ? { requiredBoundaries } : null;
}
