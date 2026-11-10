import { admitMcpToolResult } from "./mcp-tool-result.js";
import { VERSION } from "../constants.js";
import {
  admitMcpTaskResponse,
  mcpTaskError,
  MCP_TASKS_EXTENSION,
  MCP_STATELESS_PROTOCOL_VERSION,
} from "./mcp-tasks.js";

const NAME_FIELDS = Object.freeze({
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
  "tasks/get": "taskId",
  "tasks/update": "taskId",
  "tasks/cancel": "taskId",
});
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () =>
  mcpTaskError(
    "CC_MCP_STATELESS_RESULT_INVALID",
    "MCP stateless response is invalid",
    true,
  );

/** Only the explicit task API advertises Tasks. Ordinary calls cannot silently
 * create an untracked background operation, and no input/sampling authority is
 * advertised by this polling transport. */
export function statelessMcpRequest(
  method,
  params = {},
  { tasks = false } = {},
) {
  const field = Object.hasOwn(NAME_FIELDS, method) ? NAME_FIELDS[method] : null;
  const name = field ? params[field] : null;
  const encodedName =
    typeof name === "string"
      ? /^[\x21-\x7e]+$/.test(name) && !name.startsWith("=?base64?")
        ? name
        : `=?base64?${Buffer.from(name, "utf8").toString("base64")}?=`
      : null;
  return {
    params: {
      ...params,
      _meta: {
        ...params._meta,
        "io.modelcontextprotocol/protocolVersion":
          MCP_STATELESS_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
          name: "chainlesschain-cli",
          version: VERSION,
        },
        "io.modelcontextprotocol/clientCapabilities": tasks
          ? { extensions: { [MCP_TASKS_EXTENSION]: {} } }
          : {},
      },
    },
    headers: {
      "MCP-Protocol-Version": MCP_STATELESS_PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(encodedName === null ? {} : { "Mcp-Name": encodedName }),
    },
  };
}

/** Map the new wire vocabulary into the existing verified journal shape.
 * Result association comes from the validated tasks/get identity, never from
 * peer-controlled metadata or a synthetic tool/user message. */
export function admitStatelessMcpTask(
  serverName,
  value,
  config,
  { create = false, taskId } = {},
) {
  const wire = admitMcpToolResult(serverName, value, config).result;
  if (
    wire.resultType !== (create ? "task" : "complete") ||
    ["task", "ttl", "pollInterval"].some((key) => Object.hasOwn(wire, key)) ||
    (create &&
      (Object.hasOwn(wire, "isError") ||
        (wire.content !== undefined &&
          (!Array.isArray(wire.content) || wire.content.length !== 0))))
  )
    throw invalid();
  const task = admitMcpTaskResponse(
    serverName,
    {
      taskId: wire.taskId,
      status: wire.status,
      createdAt: wire.createdAt,
      lastUpdatedAt: wire.lastUpdatedAt,
      ttl: wire.ttlMs,
      ...(wire.pollIntervalMs === undefined
        ? {}
        : { pollInterval: wire.pollIntervalMs }),
      ...(wire.statusMessage === undefined
        ? {}
        : { statusMessage: wire.statusMessage }),
    },
    config,
    { kind: "get", taskId },
  );
  if (
    (wire.status !== "completed" && Object.hasOwn(wire, "result")) ||
    (wire.status !== "failed" && Object.hasOwn(wire, "error")) ||
    (wire.status !== "input_required" && Object.hasOwn(wire, "inputRequests"))
  )
    throw invalid();
  if (
    wire.status === "input_required" &&
    (!object(wire.inputRequests) ||
      Object.keys(wire.inputRequests).length === 0)
  )
    throw invalid();
  if (
    wire.status === "failed" &&
    (!object(wire.error) ||
      !Number.isInteger(wire.error.code) ||
      typeof wire.error.message !== "string")
  )
    throw invalid();
  let result;
  if (wire.status === "completed" && Object.hasOwn(wire, "result")) {
    if (
      !object(wire.result) ||
      (wire.result._meta !== undefined && !object(wire.result._meta)) ||
      (wire.result.resultType !== undefined &&
        wire.result.resultType !== "complete")
    )
      throw invalid();
    const related = wire.result._meta?.["io.modelcontextprotocol/related-task"];
    if (related !== undefined && related?.taskId !== task.taskId)
      throw invalid();
    result = admitMcpTaskResponse(
      serverName,
      {
        ...wire.result,
        _meta: {
          ...wire.result._meta,
          "io.modelcontextprotocol/related-task": { taskId: task.taskId },
        },
      },
      config,
      { kind: "result", taskId: task.taskId },
    );
  } else if (!create && wire.status === "completed") throw invalid();
  return Object.freeze({ task, ...(result ? { result } : {}) });
}

export function assertStatelessMcpAck(serverName, value, config) {
  const wire = admitMcpToolResult(serverName, value, config).result;
  if (
    wire.resultType !== "complete" ||
    Object.keys(wire).some((key) => !["resultType", "_meta"].includes(key))
  )
    throw invalid();
}
