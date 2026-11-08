import { admitMcpToolResult } from "./mcp-tool-result.js";

const STATES = new Set([
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
]);
const RELATED_TASK = "io.modelcontextprotocol/related-task";

export function mcpTaskError(code, message, dispatched = false) {
  return Object.assign(new Error(message), {
    code,
    dispatched,
    outcomeUnknown: dispatched,
    retryable: false,
  });
}

function invalid() {
  return mcpTaskError(
    "CC_MCP_TASK_RESULT_INVALID",
    "MCP server returned an invalid task response",
    true,
  );
}

function record(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function requireMcpTaskCapability(entry, operation) {
  const tasks = entry?.capabilities?.tasks;
  const capability =
    operation === "call"
      ? tasks?.requests?.tools?.call
      : operation === "list" || operation === "cancel"
        ? tasks?.[operation]
        : tasks;
  if (entry?.protocolVersion !== "2025-11-25" || !record(capability)) {
    throw mcpTaskError(
      "CC_MCP_TASK_UNSUPPORTED",
      "MCP task operation was not negotiated",
    );
  }
}

export function requireMcpToolTaskMode(entry, toolName, augmented) {
  const mode = entry.tools?.find((tool) => tool.name === toolName)?.execution
    ?.taskSupport;
  if (
    mode !== undefined &&
    !["required", "optional", "forbidden"].includes(mode)
  ) {
    throw mcpTaskError(
      "CC_MCP_TASK_SUPPORT_INVALID",
      "MCP tool has invalid task support metadata",
    );
  }
  if (augmented) {
    requireMcpTaskCapability(entry, "call");
    if (mode !== "required" && mode !== "optional") {
      throw mcpTaskError(
        "CC_MCP_TASK_FORBIDDEN",
        "MCP tool does not support task augmentation",
      );
    }
  } else if (mode === "required") {
    throw mcpTaskError(
      "CC_MCP_TASK_REQUIRED",
      "MCP tool requires the explicit task API",
    );
  }
}

export function mcpTaskId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw mcpTaskError(
      "CC_MCP_TASK_ID_INVALID",
      "MCP task ID must be a bounded non-empty string",
    );
  }
  return value;
}

export function mcpTaskParameters(ttl) {
  if (ttl === undefined) return Object.freeze({});
  if (!Number.isSafeInteger(ttl) || ttl < 0) {
    throw mcpTaskError(
      "CC_MCP_TASK_TTL_INVALID",
      "MCP task TTL must be a non-negative integer",
    );
  }
  return Object.freeze({ ttl });
}

function timestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function taskSnapshot(value, expectedId) {
  if (!record(value)) throw invalid();
  let taskId;
  try {
    taskId = mcpTaskId(value.taskId);
  } catch {
    throw invalid();
  }
  if (
    (expectedId !== undefined && taskId !== expectedId) ||
    !STATES.has(value.status) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.lastUpdatedAt) ||
    (value.ttl !== null &&
      (!Number.isSafeInteger(value.ttl) || value.ttl < 0)) ||
    (value.pollInterval !== undefined &&
      (!Number.isSafeInteger(value.pollInterval) || value.pollInterval < 0)) ||
    (value.statusMessage !== undefined &&
      typeof value.statusMessage !== "string")
  ) {
    throw invalid();
  }
  return Object.freeze({
    taskId,
    status: value.status,
    createdAt: value.createdAt,
    lastUpdatedAt: value.lastUpdatedAt,
    ttl: value.ttl,
    ...(value.pollInterval === undefined
      ? {}
      : { pollInterval: value.pollInterval }),
    ...(value.statusMessage === undefined
      ? {}
      : { statusMessage: value.statusMessage }),
  });
}

export function admitMcpTaskResponse(
  serverName,
  value,
  config,
  { kind, taskId } = {},
) {
  const snapshot = admitMcpToolResult(serverName, value, config).result;
  if (kind === "create") {
    // A task acceptance is not a successful operation result.
    if (
      Object.hasOwn(snapshot, "content") ||
      Object.hasOwn(snapshot, "isError")
    )
      throw invalid();
    return Object.freeze({ task: taskSnapshot(snapshot.task) });
  }
  if (kind === "list") {
    if (
      !Array.isArray(snapshot.tasks) ||
      snapshot.tasks.length > 256 ||
      (snapshot.nextCursor !== undefined &&
        (typeof snapshot.nextCursor !== "string" ||
          snapshot.nextCursor.length > 65536))
    )
      throw invalid();
    const tasks = snapshot.tasks.map((task) => taskSnapshot(task));
    if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length)
      throw invalid();
    return Object.freeze({
      tasks: Object.freeze(tasks),
      ...(snapshot.nextCursor === undefined
        ? {}
        : { nextCursor: snapshot.nextCursor }),
    });
  }
  if (kind === "result") {
    if (
      !Array.isArray(snapshot.content) ||
      snapshot._meta?.[RELATED_TASK]?.taskId !== taskId ||
      Object.hasOwn(snapshot, "task") ||
      (snapshot.isError !== undefined && typeof snapshot.isError !== "boolean")
    )
      throw invalid();
    return snapshot;
  }
  const task = taskSnapshot(snapshot, taskId);
  if (kind === "cancel" && task.status !== "cancelled") throw invalid();
  return task;
}
