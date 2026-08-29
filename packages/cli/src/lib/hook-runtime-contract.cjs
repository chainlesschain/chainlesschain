"use strict";

/**
 * Canonical Hook runtime contract.
 *
 * Every Hook surface (Hooks v2, settings adapters, the SQLite registry, the
 * replay bus and product producers) projects from this file.  Keep this module
 * CommonJS so both the legacy CJS settings loader and ESM runtime can consume
 * the exact same frozen objects without maintaining parallel registries.
 */

const HOOK_EVENT_SCHEMA_VERSION = 1;
const MAX_HOOK_CONTEXT_BYTES = 1024 * 1024;
const MIN_HOOK_TIMEOUT_MS = 1;
const MAX_HOOK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HOOK_TIMEOUT_MS = 30 * 1000;

const HOOK_PRIORITY = Object.freeze({
  SYSTEM: 0,
  HIGH: 100,
  NORMAL: 500,
  LOW: 900,
  MONITOR: 1000,
});

const HOOK_EXECUTION_MODE = Object.freeze({
  BLOCKING: "blocking",
  ASYNC: "async",
});

const EVENT_GROUPS = Object.freeze({
  system: ["Setup", "Notification", "TimelineEntry"],
  tool: [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "ToolError",
  ],
  session: [
    "UserPromptSubmit",
    "UserPromptExpansion",
    "AssistantResponse",
    "SessionStart",
    "SessionResume",
    "SessionPause",
    "SessionEnd",
    "Stop",
    "StopFailure",
    "PreCompact",
    "PostCompact",
    "ModelSelection",
  ],
  permission: [
    "PermissionRequest",
    "PermissionAllow",
    "PermissionDeny",
    "PermissionDenied",
    "ComplianceCheck",
  ],
  agent: [
    "AgentStart",
    "AgentStop",
    "SubagentStart",
    "SubagentStop",
    "TaskAssigned",
    "TaskCreated",
    "TaskCompleted",
    "TeammateIdle",
  ],
  plan: [
    "PlanModeEnter",
    "PlanRevised",
    "PlanApproved",
    "PlanItemExecute",
    "PlanRejected",
  ],
  workspace: [
    "InstructionsLoaded",
    "CwdChanged",
    "WorktreeCreate",
    "WorktreeRemove",
    "FileChanged",
    "FileModified",
    "PreFileAccess",
    "PostFileAccess",
  ],
  git: [
    "PreCommit",
    "PostCommit",
    "PreGitCommit",
    "PostGitCommit",
    "PreGitPush",
    "CIFailure",
  ],
  mcp: [
    "McpRequest",
    "McpResponse",
    "MCPElicitation",
    "Elicitation",
    "ElicitationResult",
  ],
  ipc: ["PreIPCCall", "PostIPCCall", "IPCError"],
  memory: ["MemorySave", "MemoryLoad"],
  governance: [
    "ConfigChange",
    "AuditLog",
    "DataSubjectRequest",
    "IterationWarning",
    "IterationBudgetExhausted",
  ],
});

const DECISION_EVENT_NAMES = new Set([
  "Setup",
  "PreToolUse",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "Stop",
  "PermissionRequest",
  "ModelSelection",
  "PreCompact",
  "ComplianceCheck",
  "SubagentStart",
  "SubagentStop",
]);

const CONTEXT_EVENT_NAMES = new Set([
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "SessionStart",
  "PostCompact",
  "InstructionsLoaded",
]);

const eventEntries = [];
for (const [group, names] of Object.entries(EVENT_GROUPS)) {
  for (const event of names) eventEntries.push([event, group]);
}

const HOOK_EVENT_TYPES = Object.freeze(
  Object.fromEntries(eventEntries.map(([event]) => [event, event])),
);

const DEFAULT_ALLOWED_EXECUTORS = Object.freeze([
  "command",
  "http",
  "mcp_tool",
  "prompt",
  "agent",
  "js",
]);

const HOOK_EVENT_CONTRACTS = Object.freeze(
  Object.fromEntries(
    eventEntries.map(([event, group]) => {
      const decisionCapable = DECISION_EVENT_NAMES.has(event);
      return [
        event,
        Object.freeze({
          schemaVersion: HOOK_EVENT_SCHEMA_VERSION,
          event,
          group,
          allowedExecutors: DEFAULT_ALLOWED_EXECUTORS,
          decisionCapable,
          contextCapable: CONTEXT_EVENT_NAMES.has(event),
          blockingSemantics: decisionCapable
            ? "strictest:block>ask>allow>continue"
            : "observe-only",
          asyncDecisionSemantics: "observe-only",
        }),
      ];
    }),
  ),
);

const DECISION_EVENTS = Object.freeze(new Set(DECISION_EVENT_NAMES));

function stableStringify(value, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Hook event context contains a non-JSON value");
    }
    return encoded;
  }
  if (seen.has(value)) {
    throw new TypeError("Hook event context must not contain cycles");
  }
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(value);
      throw new TypeError("Hook event context must contain only plain objects");
    }
    const keys = Object.keys(value).sort();
    encoded = `{${keys
      .map(
        (key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`,
      )
      .join(",")}}`;
  }
  seen.delete(value);
  return encoded;
}

function validateHookEvent(event, context = {}) {
  const contract = HOOK_EVENT_CONTRACTS[event];
  if (!contract) {
    const error = new Error(`Invalid hook event: ${event}`);
    error.code = "CC_HOOK_EVENT_UNKNOWN";
    throw error;
  }
  if (
    context === null ||
    typeof context !== "object" ||
    Array.isArray(context)
  ) {
    const error = new TypeError("Hook event context must be a plain object");
    error.code = "CC_HOOK_EVENT_CONTEXT_INVALID";
    throw error;
  }
  let serialized;
  try {
    serialized = stableStringify(context);
  } catch (cause) {
    const error = new TypeError(
      `Invalid hook event context: ${cause.message}`,
      {
        cause,
      },
    );
    error.code = "CC_HOOK_EVENT_CONTEXT_INVALID";
    throw error;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_HOOK_CONTEXT_BYTES) {
    const error = new RangeError(
      `Hook event context exceeds ${MAX_HOOK_CONTEXT_BYTES} bytes`,
    );
    error.code = "CC_HOOK_EVENT_CONTEXT_TOO_LARGE";
    throw error;
  }
  return contract;
}

function normalizeHookPriority(value, fallback = HOOK_PRIORITY.NORMAL) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(
    HOOK_PRIORITY.SYSTEM,
    Math.min(HOOK_PRIORITY.MONITOR, parsed),
  );
}

function normalizeHookTimeoutMs(value, fallback = DEFAULT_HOOK_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(
    MIN_HOOK_TIMEOUT_MS,
    Math.min(MAX_HOOK_TIMEOUT_MS, Math.floor(parsed)),
  );
}

function normalizeHookExecutionMode(value) {
  return value === HOOK_EXECUTION_MODE.ASYNC || value === true
    ? HOOK_EXECUTION_MODE.ASYNC
    : HOOK_EXECUTION_MODE.BLOCKING;
}

module.exports = {
  HOOK_EVENT_SCHEMA_VERSION,
  HOOK_EVENT_TYPES,
  HOOK_EVENT_CONTRACTS,
  DECISION_EVENTS,
  HOOK_PRIORITY,
  HOOK_EXECUTION_MODE,
  DEFAULT_HOOK_TIMEOUT_MS,
  MIN_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  MAX_HOOK_CONTEXT_BYTES,
  stableStringify,
  validateHookEvent,
  normalizeHookPriority,
  normalizeHookTimeoutMs,
  normalizeHookExecutionMode,
};
