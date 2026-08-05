/**
 * Host-issued authority for MCP stdio local-code execution.
 *
 * A stdio MCP configuration is an instruction to execute a local process, not
 * passive protocol metadata. Source labels carried in JSON are forgeable, so
 * the canonical MCP client accepts only a one-shot object capability issued by
 * a trusted config loader after its source-specific approval gate succeeds.
 * The capability is bound to the complete invocation and security provenance;
 * copying fields, mutating the config, or replaying a consumed token fails
 * before spawn.
 */

import crypto from "node:crypto";
import { isProxy } from "node:util/types";

export const MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE =
  "CC_MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED";
export const MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE =
  "CC_MCP_STDIO_EXECUTION_AUTHORITY_STALE";
export const MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED_CODE =
  "CC_MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED";

const APPROVAL_KINDS = new Set([
  "explicit-config",
  "managed-settings",
  "project-config",
  "registered-config",
  "trusted-plugin",
]);
const issuedAuthorities = new WeakMap();
const renewableApprovals = new WeakMap();

function authorityError(code, message) {
  const error = new Error(message);
  error.name = "McpStdioExecutionAuthorityError";
  error.code = code;
  return error;
}

function dataProperty(object, key, fallback) {
  if (!object || typeof object !== "object" || isProxy(object)) {
    if (fallback !== undefined) return fallback;
    throw new TypeError("MCP stdio config must be a non-Proxy object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return fallback;
  if (!("value" in descriptor)) {
    throw new TypeError(`MCP stdio config.${key} must be an own data property`);
  }
  return descriptor.value;
}

function scalar(value, label, { nullable = true } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (value.includes("\0")) throw new TypeError(`${label} contains a NUL byte`);
  return value;
}

function stringArray(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || isProxy(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}[${index}] must be a dense data property`);
    }
    result.push(
      scalar(descriptor.value, `${label}[${index}]`, { nullable: false }),
    );
  }
  return result;
}

function stringMap(value, label) {
  if (value == null) return [];
  if (typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property`);
    }
    entries.push([
      scalar(key, `${label} key`, { nullable: false }),
      scalar(descriptor.value, `${label}.${key}`, { nullable: false }),
    ]);
  }
  return entries;
}

function plainGraph(value, label, state = { depth: 0, counter: { nodes: 0 } }) {
  state.counter.nodes += 1;
  if (state.counter.nodes > 256 || state.depth > 12) {
    throw new TypeError(`${label} exceeds the authority graph budget`);
  }
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) {
    throw new TypeError(`${label} must contain plain JSON data`);
  }
  const next = { depth: state.depth + 1, counter: state.counter };
  if (Array.isArray(value)) {
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(`${label}[${index}] must be a dense data property`);
      }
      output.push(plainGraph(descriptor.value, `${label}[${index}]`, next));
    }
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must contain plain objects`);
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property`);
    }
    output[key] = plainGraph(descriptor.value, `${label}.${key}`, next);
  }
  return output;
}

function invocationSnapshot(serverName, config) {
  const command = scalar(dataProperty(config, "command"), "command", {
    nullable: false,
  });
  if (!command.trim()) throw new TypeError("command must not be empty");
  const args = stringArray(dataProperty(config, "args", []), "args");
  const env = stringMap(dataProperty(config, "env", {}), "env");
  const sandboxPolicy = dataProperty(config, "sandboxPolicy", null);
  return Object.freeze({
    serverName: scalar(serverName, "serverName", { nullable: false }),
    command,
    args: Object.freeze(args),
    env: Object.freeze(env.map((entry) => Object.freeze(entry))),
    transport: scalar(dataProperty(config, "transport", null), "transport"),
    origin: scalar(dataProperty(config, "origin", null), "origin"),
    policy: scalar(dataProperty(config, "policy", null), "policy"),
    scope: scalar(dataProperty(config, "scope", null), "scope"),
    configScope: scalar(
      dataProperty(config, "configScope", null),
      "configScope",
    ),
    configSource: scalar(
      dataProperty(config, "configSource", null),
      "configSource",
    ),
    projectPath: scalar(
      dataProperty(config, "projectPath", null),
      "projectPath",
    ),
    pluginId: scalar(dataProperty(config, "pluginId", null), "pluginId"),
    pluginVersion: scalar(
      dataProperty(config, "pluginVersion", null),
      "pluginVersion",
    ),
    pluginSource: scalar(
      dataProperty(config, "pluginSource", null),
      "pluginSource",
    ),
    sandboxPolicy:
      sandboxPolicy == null ? null : plainGraph(sandboxPolicy, "sandboxPolicy"),
    pluginWorkspaceAuthority: dataProperty(
      config,
      "pluginWorkspaceAuthority",
      null,
    ),
    projectMcpWorkspaceAuthority: dataProperty(
      config,
      "projectMcpWorkspaceAuthority",
      null,
    ),
  });
}

function comparableSnapshot(snapshot) {
  const {
    pluginWorkspaceAuthority: _pluginAuthority,
    projectMcpWorkspaceAuthority: _projectAuthority,
    ...plain
  } = snapshot;
  return plain;
}

function snapshotDigest(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(comparableSnapshot(snapshot)))
    .digest("hex");
}

function sameSnapshot(expected, actual) {
  return (
    expected.pluginWorkspaceAuthority === actual.pluginWorkspaceAuthority &&
    expected.projectMcpWorkspaceAuthority ===
      actual.projectMcpWorkspaceAuthority &&
    snapshotDigest(expected) === snapshotDigest(actual)
  );
}

function materializeSnapshot(snapshot) {
  return {
    command: snapshot.command,
    args: [...snapshot.args],
    env: Object.fromEntries(snapshot.env),
    transport: snapshot.transport,
    origin: snapshot.origin,
    policy: snapshot.policy,
    scope: snapshot.scope,
    configScope: snapshot.configScope,
    configSource: snapshot.configSource,
    projectPath: snapshot.projectPath,
    pluginId: snapshot.pluginId,
    pluginVersion: snapshot.pluginVersion,
    pluginSource: snapshot.pluginSource,
    sandboxPolicy:
      snapshot.sandboxPolicy == null
        ? null
        : plainGraph(snapshot.sandboxPolicy, "sandboxPolicy"),
    pluginWorkspaceAuthority: snapshot.pluginWorkspaceAuthority,
    projectMcpWorkspaceAuthority: snapshot.projectMcpWorkspaceAuthority,
  };
}

export function issueMcpStdioExecutionAuthority({
  serverName,
  config,
  approvalKind,
  approvalSource,
}) {
  if (!APPROVAL_KINDS.has(approvalKind)) {
    throw new TypeError("MCP stdio approval kind is not recognized");
  }
  const source = scalar(approvalSource, "approvalSource", { nullable: false });
  if (!source.trim()) throw new TypeError("approvalSource must not be empty");
  const snapshot = invocationSnapshot(serverName, config);
  const token = Object.freeze({});
  issuedAuthorities.set(
    token,
    Object.freeze({
      approvalKind,
      approvalSource: source,
      fingerprint: snapshotDigest(snapshot),
      snapshot,
    }),
  );
  return token;
}

export function consumeMcpStdioExecutionAuthority(
  token,
  { serverName, config },
) {
  if (!token || typeof token !== "object") {
    throw authorityError(
      MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE,
      `MCP stdio server "${String(serverName)}" can execute local code and requires a loader-issued execution authority`,
    );
  }
  const issued = issuedAuthorities.get(token);
  if (!issued) {
    throw authorityError(
      MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED_CODE,
      `MCP stdio execution authority for "${String(serverName)}" is invalid or already consumed`,
    );
  }
  issuedAuthorities.delete(token);
  let current;
  try {
    current = invocationSnapshot(serverName, config);
  } catch (cause) {
    const error = authorityError(
      MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      `MCP stdio invocation for "${String(serverName)}" changed after approval`,
    );
    error.cause = cause;
    throw error;
  }
  if (!sameSnapshot(issued.snapshot, current)) {
    throw authorityError(
      MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      `MCP stdio invocation for "${String(serverName)}" changed after approval`,
    );
  }
  const approval = Object.freeze({
    approvalKind: issued.approvalKind,
    approvalSource: issued.approvalSource,
    fingerprint: issued.fingerprint,
  });
  renewableApprovals.set(approval, issued);
  return approval;
}

export function renewMcpStdioExecutionAuthority(
  approval,
  { serverName, config },
) {
  const issued = renewableApprovals.get(approval);
  if (!issued) {
    throw authorityError(
      MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE,
      `MCP stdio reconnect for "${String(serverName)}" requires its original execution approval`,
    );
  }
  const current = invocationSnapshot(serverName, config);
  if (!sameSnapshot(issued.snapshot, current)) {
    throw authorityError(
      MCP_STDIO_EXECUTION_AUTHORITY_STALE_CODE,
      `MCP stdio reconnect invocation for "${String(serverName)}" changed after approval`,
    );
  }
  const token = Object.freeze({});
  issuedAuthorities.set(token, issued);
  return token;
}

export function materializeApprovedMcpStdioInvocation(approval) {
  const issued = renewableApprovals.get(approval);
  if (!issued) {
    throw authorityError(
      MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED_CODE,
      "MCP stdio invocation requires a consumed execution approval",
    );
  }
  return materializeSnapshot(issued.snapshot);
}
