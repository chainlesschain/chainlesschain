import fs from "node:fs";
import path from "node:path";

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
const PLUGIN_WORKSPACE_AUTHORITY_KIND = "trusted-plugin-workspace";
const pluginWorkspaceAuthorities = new WeakMap();

function invalidPolicy(message) {
  const error = new Error(message);
  error.code = "ERR_PLUGIN_SANDBOX_POLICY_INVALID";
  return error;
}

function normalizedProvenance(value = {}) {
  return Object.freeze({
    origin: typeof value.origin === "string" ? value.origin : "",
    pluginId: typeof value.pluginId === "string" ? value.pluginId : "",
    pluginVersion:
      typeof value.pluginVersion === "string" ? value.pluginVersion : "",
    pluginSource:
      typeof value.pluginSource === "string" ? value.pluginSource : "",
  });
}

function sameProvenance(left, right) {
  return (
    left.origin === right.origin &&
    left.pluginId === right.pluginId &&
    left.pluginVersion === right.pluginVersion &&
    left.pluginSource === right.pluginSource
  );
}

/**
 * Mint an opaque, reusable authority from a plugin root produced by trusted
 * installed-plugin discovery. Manifest/server/monitor data receives only the
 * token: the canonical writable root stays in this module's WeakMap.
 *
 * A token is reusable because MCP reconnects and interval monitors can launch
 * more than once. The process broker still mints a separate one-shot execution
 * contract for every child.
 */
export function issuePluginWorkspaceAuthority(value = {}) {
  if (
    typeof value.root !== "string" ||
    value.root.length === 0 ||
    value.root.includes("\0")
  ) {
    throw invalidPolicy("trusted plugin workspace root must be a path");
  }
  const requestedRoot = path.resolve(value.root);
  let canonicalRoot;
  let stat;
  try {
    const implementation = fs.realpathSync.native || fs.realpathSync;
    canonicalRoot = implementation.call(fs.realpathSync, requestedRoot);
    stat = fs.statSync(canonicalRoot);
  } catch {
    throw invalidPolicy("trusted plugin workspace root is unavailable");
  }
  if (!stat.isDirectory()) {
    throw invalidPolicy("trusted plugin workspace root must be a directory");
  }

  const provenance = normalizedProvenance(value);
  if (
    !provenance.origin.startsWith("plugin:") ||
    !provenance.pluginId ||
    !provenance.pluginVersion
  ) {
    throw invalidPolicy("trusted plugin workspace provenance is incomplete");
  }

  const authority = Object.freeze({
    contractVersion: 1,
    kind: PLUGIN_WORKSPACE_AUTHORITY_KIND,
  });
  pluginWorkspaceAuthorities.set(
    authority,
    Object.freeze({ root: canonicalRoot, provenance }),
  );
  return authority;
}

/**
 * Resolve an authority only for the exact plugin/component provenance to which
 * the loader bound it. Structurally similar manifest objects are not accepted.
 */
export function resolvePluginWorkspaceAuthority(authority, provenance = {}) {
  if (
    !authority ||
    typeof authority !== "object" ||
    authority.contractVersion !== 1 ||
    authority.kind !== PLUGIN_WORKSPACE_AUTHORITY_KIND
  ) {
    return null;
  }
  const binding = pluginWorkspaceAuthorities.get(authority);
  if (
    !binding ||
    !sameProvenance(binding.provenance, normalizedProvenance(provenance))
  ) {
    return null;
  }
  return binding.root;
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
    if (typeof boundary !== "string" || !SUPPORTED_BOUNDARIES.has(boundary)) {
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
