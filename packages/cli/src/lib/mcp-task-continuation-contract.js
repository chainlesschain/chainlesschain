import { summarizeMcpPayload } from "./mcp-call-ledger.js";

export const MCP_TASK_CONTINUATION_STARTED = "mcp_task_continuation_started";
export const MCP_TASK_CONTINUATION_FIELD = "_cc_mcp_task_continuation";
const START_FIELDS = [
  "schemaVersion",
  "sessionId",
  "localId",
  "deliveryId",
  "deliveryEventHash",
  "messageDigest",
  "at",
];
const END_FIELDS = [
  "schemaVersion",
  "sessionId",
  "localId",
  "deliveryId",
  "deliveryEventHash",
  "messageDigest",
  "beginEventHash",
  "outputDigest",
];
const HASH = /^[a-f0-9]{64}$/u;

function invalid(reason) {
  throw Object.assign(new Error("Invalid MCP task continuation: " + reason), {
    code: "CC_MCP_TASK_CONTINUATION_INVALID",
  });
}
function fields(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}
function source(data, delivery, sessionId) {
  if (
    !delivery ||
    data?.schemaVersion !== 1 ||
    data.sessionId !== sessionId ||
    data.sessionId !== delivery.sessionId ||
    data.localId !== delivery.localId ||
    data.deliveryId !== delivery.deliveryId ||
    data.deliveryEventHash !== delivery.eventHash ||
    data.messageDigest !== delivery.messageDigest ||
    !HASH.test(data.deliveryEventHash)
  )
    invalid("delivery binding");
}

export function createMcpTaskContinuationStart(
  delivery,
  at = new Date().toISOString(),
) {
  return Object.freeze({
    schemaVersion: 1,
    sessionId: delivery.sessionId,
    localId: delivery.localId,
    deliveryId: delivery.deliveryId,
    deliveryEventHash: delivery.eventHash,
    messageDigest: delivery.messageDigest,
    at,
  });
}

export function assertMcpTaskContinuationStart(
  data,
  delivery,
  sessionId,
  prior,
) {
  if (
    !fields(data, START_FIELDS) ||
    prior ||
    typeof data.at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(data.at) ||
    !Number.isFinite(Date.parse(data.at))
  )
    invalid("start schema or duplicate");
  source(data, delivery, sessionId);
  return data;
}

export function createMcpTaskContinuationMessage(started, content) {
  if (typeof content !== "string") invalid("assistant response");
  const message = { role: "assistant", content };
  return Object.freeze({
    ...message,
    [MCP_TASK_CONTINUATION_FIELD]: Object.freeze({
      schemaVersion: 1,
      sessionId: started.sessionId,
      localId: started.localId,
      deliveryId: started.deliveryId,
      deliveryEventHash: started.deliveryEventHash,
      messageDigest: started.messageDigest,
      beginEventHash: started.beginEventHash,
      outputDigest: summarizeMcpPayload(message).sha256,
    }),
  });
}

export function assertMcpTaskContinuationMessage(
  message,
  delivery,
  sessionId,
  prior,
) {
  const data = message?.[MCP_TASK_CONTINUATION_FIELD];
  if (
    !fields(message, ["role", "content", MCP_TASK_CONTINUATION_FIELD]) ||
    message.role !== "assistant" ||
    typeof message.content !== "string" ||
    !fields(data, END_FIELDS) ||
    !prior ||
    prior.phase !== "started" ||
    !HASH.test(data.beginEventHash) ||
    data.beginEventHash !== prior.beginEventHash ||
    data.outputDigest !==
      summarizeMcpPayload({ role: "assistant", content: message.content })
        .sha256
  )
    invalid("settlement schema, output or start binding");
  source(data, delivery, sessionId);
  return data;
}
