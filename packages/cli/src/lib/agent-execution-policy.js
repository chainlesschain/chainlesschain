import { isProxy } from "node:util/types";
import { snapshotMcpJsonRpcInput } from "./mcp-call-ledger.js";
import { captureUnattendedActionPolicy } from "./unattended-action-policy.js";

function invalidPolicy(field) {
  const error = new TypeError(`Agent execution policy ${field} is invalid`);
  error.code = "CC_AGENT_EXECUTION_POLICY_INVALID";
  return error;
}

function ownValue(options, field) {
  const descriptor = Object.getOwnPropertyDescriptor(options, field);
  if (!descriptor) {
    if (field in options) throw invalidPolicy(field);
    return undefined;
  }
  if (!("value" in descriptor)) throw invalidPolicy(field);
  return descriptor.value;
}

function objectSnapshot(value, field) {
  if (value == null) return null;
  try {
    const snapshot = snapshotMcpJsonRpcInput(value);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      throw invalidPolicy(field);
    return snapshot;
  } catch {
    throw invalidPolicy(field);
  }
}

function stringList(value, field) {
  if (value == null) return null;
  try {
    const snapshot = snapshotMcpJsonRpcInput(value);
    if (
      !Array.isArray(snapshot) ||
      snapshot.some((entry) => typeof entry !== "string" || !entry.trim())
    )
      throw invalidPolicy(field);
    return snapshot;
  } catch {
    throw invalidPolicy(field);
  }
}

function booleanFields(value, fields, label) {
  for (const field of fields) {
    if (value[field] !== undefined && typeof value[field] !== "boolean")
      throw invalidPolicy(`${label}.${field}`);
  }
}

function captureSandbox(value) {
  if (value === false) return null;
  const sandbox = objectSnapshot(value, "sandbox");
  if (!sandbox) return null;
  booleanFields(sandbox, ["network"], "sandbox");
  if (sandbox.policy !== undefined) {
    const policy = objectSnapshot(sandbox.policy, "sandbox.policy");
    if (!policy) throw invalidPolicy("sandbox.policy");
    booleanFields(
      policy,
      ["allowUnsandboxedCommands", "failIfUnavailable"],
      "sandbox.policy",
    );
    for (const field of [
      "allowRead",
      "denyRead",
      "allowWrite",
      "denyWrite",
      "allowedDomains",
      "deniedDomains",
      "excludedCommands",
    ]) {
      if (policy[field] !== undefined)
        stringList(policy[field], `sandbox.policy.${field}`);
    }
  }
  return sandbox;
}

function captureToolAdmission(value) {
  const admission = objectSnapshot(value, "toolAdmission");
  if (!admission) return null;
  const flags = [
    "enforce",
    "capabilityGranted",
    "policyAllowed",
    "permissionGranted",
    "budgetOk",
    "uiSupported",
  ];
  booleanFields(admission, flags, "toolAdmission");
  if (admission.tools !== undefined) {
    const tools = objectSnapshot(admission.tools, "toolAdmission.tools");
    if (!tools) throw invalidPolicy("toolAdmission.tools");
    for (const [name, entry] of Object.entries(tools)) {
      const override = objectSnapshot(entry, `toolAdmission.tools.${name}`);
      if (!override) throw invalidPolicy(`toolAdmission.tools.${name}`);
      booleanFields(override, flags, `toolAdmission.tools.${name}`);
    }
  }
  return admission;
}

/**
 * Copy startup/turn data before the first await. Live permission providers,
 * host policy owners, Plan managers and ApprovalGates remain live capabilities.
 * A later user turn may capture a different tool list; this turn's caller-owned
 * arrays cannot change its model surface or execution ceiling midway through.
 */
export function captureAgentExecutionPolicy(
  options = {},
  { hermetic = false } = {},
) {
  if (!options || typeof options !== "object" || isProxy(options))
    throw invalidPolicy("options");
  const isolated = hermetic && ownValue(options, "hermeticExecution") === true;
  const policy = {
    sandbox: captureSandbox(ownValue(options, "sandbox")),
    toolAdmission: isolated
      ? null
      : captureToolAdmission(ownValue(options, "toolAdmission")),
    unattendedActionPolicy: isolated
      ? null
      : captureUnattendedActionPolicy(
          ownValue(options, "unattendedActionPolicy"),
        ),
    shellPolicyOverrides: stringList(
      ownValue(options, "shellPolicyOverrides"),
      "shellPolicyOverrides",
    ),
  };
  const classifyAllShell = ownValue(options, "classifyAllShell");
  if (classifyAllShell != null) {
    if (typeof classifyAllShell !== "boolean")
      throw invalidPolicy("classifyAllShell");
    policy.classifyAllShell = classifyAllShell;
  }
  for (const field of [
    "additionalDirectories",
    "enabledToolNames",
    "disabledTools",
    "allowedTools",
    "disallowedTools",
    "effectiveAllowedToolNames",
  ]) {
    const value = ownValue(options, field);
    if (value !== undefined) policy[field] = stringList(value, field);
  }
  return Object.freeze(policy);
}

/** Explicit lists intersect; deny lists always accumulate. [] means no tools. */
export function resolveAgentToolSelection(policy = {}, ceiling = null) {
  const lists = [
    ceiling,
    policy.allowedTools,
    policy.enabledToolNames,
    policy.effectiveAllowedToolNames,
  ].filter(Array.isArray);
  const enabledToolNames =
    lists.length === 0
      ? null
      : Object.freeze(
          lists[0].filter((name) => lists.every((list) => list.includes(name))),
        );
  const disabledTools = Object.freeze([
    ...new Set([
      ...(policy.disabledTools || []),
      ...(policy.disallowedTools || []),
    ]),
  ]);
  return Object.freeze({ enabledToolNames, disabledTools });
}
