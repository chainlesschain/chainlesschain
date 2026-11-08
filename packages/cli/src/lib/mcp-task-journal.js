import {
  appendAuthorityEventWithVerifiedProjection,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import { createMcpLedgerEventReducer } from "./mcp-call-ledger-store.js";
import { admitMcpToolResult } from "./mcp-tool-result.js";
import { admitMcpTaskResponse } from "./mcp-tasks.js";

export const MCP_TASK_JOURNAL_EVENT = "mcp_task_ledger";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTITY = /^hmac-sha256:[a-f0-9]{64}$/u;
const BASE = [
  "schemaVersion",
  "phase",
  "localId",
  "revision",
  "sessionId",
  "at",
];
const PREPARED = [
  "serverName",
  "toolName",
  "ledgerId",
  "inputDigest",
  "identityDigest",
  "secretRef",
];
const TASK_FIELDS = [
  "taskId",
  "status",
  "createdAt",
  "lastUpdatedAt",
  "ttl",
  "pollInterval",
  "statusMessage",
];
const ACTIVE = new Set([
  "accepted",
  "observed",
  "cancel_requested",
  "cancel_unknown",
]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function fail(reason) {
  const error = new Error(
    "MCP task journal rejected invalid authority: " + reason,
  );
  error.code = "CC_MCP_TASK_JOURNAL_INVALID";
  throw error;
}

function text(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 1024 &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

function timestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function snapshotEvent(sessionId, value) {
  const data = admitMcpToolResult("task-journal", value, {}).result;
  const extra =
    data.phase === "prepared"
      ? PREPARED
      : data.phase === "accepted" || data.phase === "observed"
        ? ["task"]
        : data.phase === "result_saved"
          ? ["result"]
          : [];
  const allowed = [...BASE, ...extra];
  if (
    !["prepared", ...ACTIVE, "result_saved"].includes(data.phase) ||
    Object.keys(data).length !== allowed.length ||
    Object.keys(data).some((key) => !allowed.includes(key)) ||
    data.schemaVersion !== 1 ||
    !UUID.test(data.localId) ||
    data.sessionId !== sessionId ||
    !text(data.sessionId) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !timestamp(data.at)
  )
    fail("event schema");
  if (
    data.phase === "prepared" &&
    (data.revision !== 0 ||
      !text(data.serverName) ||
      !text(data.toolName) ||
      !text(data.ledgerId) ||
      !DIGEST.test(data.inputDigest) ||
      !IDENTITY.test(data.identityDigest) ||
      data.secretRef !== "mcp-task/" + data.localId)
  )
    fail("prepared schema");
  if (data.phase === "accepted" || data.phase === "observed") {
    if (
      !data.task ||
      typeof data.task !== "object" ||
      Array.isArray(data.task) ||
      Object.keys(data.task).some((key) => !TASK_FIELDS.includes(key))
    )
      fail("task fields");
  }
  return data;
}

function assertRecovery(callRecovery) {
  if (!callRecovery.verified || callRecovery.incidents.length > 0)
    fail("call ledger recovery");
}

function transition(records, data, callRecovery) {
  const previous = records.get(data.localId);
  if (data.phase === "prepared") {
    if (previous || records.size >= 1024) fail("duplicate or excess task");
    if ([...records.values()].some((item) => item.ledgerId === data.ledgerId))
      fail("call ledger already bound");
    assertRecovery(callRecovery);
    const call = callRecovery.records.find(
      (item) => item.ledgerId === data.ledgerId,
    );
    if (
      !call ||
      call.status !== "started" ||
      ["sessionId", "serverName", "toolName", "inputDigest"].some(
        (key) => call[key] !== data[key],
      ) ||
      callRecovery.adjudications.some((item) => item.ledgerId === data.ledgerId)
    )
      fail("started call binding");
    return freeze({
      ...data,
      task: null,
      result: null,
      cancelRequested: false,
      cancelUnknown: false,
    });
  }
  if (
    !previous ||
    data.revision !== previous.revision + 1 ||
    previous.phase === "result_saved"
  )
    fail("revision or phase");
  let task = previous.task;
  let result = previous.result;
  let cancelRequested = previous.cancelRequested;
  let cancelUnknown = previous.cancelUnknown;
  if (data.phase === "accepted") {
    if (previous.phase !== "prepared") fail("acceptance phase");
    task = admitMcpTaskResponse(
      previous.serverName,
      { task: data.task },
      {},
      {
        kind: "create",
      },
    ).task;
  } else if (data.phase === "observed") {
    if (!ACTIVE.has(previous.phase) || !task) fail("observation phase");
    const next = admitMcpTaskResponse(
      previous.serverName,
      data.task,
      {},
      {
        kind: "get",
        taskId: task.taskId,
      },
    );
    if (TERMINAL.has(task.status) && task.status !== next.status)
      fail("terminal status regression");
    if (next.createdAt !== task.createdAt)
      fail("task creation identity changed");
    task = next;
  } else if (data.phase === "cancel_requested") {
    if (!ACTIVE.has(previous.phase) || !task) fail("cancellation phase");
    cancelRequested = true;
  } else if (data.phase === "cancel_unknown") {
    if (previous.phase !== "cancel_requested")
      fail("unknown cancellation phase");
    cancelUnknown = true;
  } else if (data.phase === "result_saved") {
    if (!ACTIVE.has(previous.phase) || !task) fail("result phase");
    result = admitMcpTaskResponse(
      previous.serverName,
      data.result,
      {},
      {
        kind: "result",
        taskId: task.taskId,
      },
    );
  } else fail("phase");
  return freeze({
    ...previous,
    revision: data.revision,
    phase: data.phase,
    updatedAt: data.at,
    task,
    result,
    cancelRequested,
    cancelUnknown,
  });
}

function projection(sessionId) {
  const records = new Map();
  const calls = createMcpLedgerEventReducer({ sessionId, verified: true });
  let count = 0;
  return {
    accept(event) {
      calls.accept(event);
      count += 1;
      if (event.type !== MCP_TASK_JOURNAL_EVENT) return;
      const data = snapshotEvent(sessionId, event.data);
      records.set(data.localId, transition(records, data, calls.finish()));
    },
    finish(authority) {
      const callRecovery = calls.finish();
      assertRecovery(callRecovery);
      if (
        !authority ||
        count < 1 ||
        authority.eventCount !== count ||
        !authority.headHash ||
        authority.headHash !== callRecovery.headHash
      )
        fail("verified session authority");
      return freeze({
        sessionId,
        records: [...records.values()],
        callRecovery,
        headHash: authority.headHash,
      });
    },
  };
}

export function readMcpTaskJournal(sessionId) {
  if (!text(sessionId)) fail("session id");
  return readVerifiedProjection(sessionId, () => projection(sessionId));
}

/** Validate and append under the canonical writer lock, then verify readback. */
export function appendMcpTaskJournalEvent(sessionId, value) {
  if (!text(sessionId)) fail("session id");
  const data = snapshotEvent(sessionId, value);
  const receipt = appendAuthorityEventWithVerifiedProjection(
    sessionId,
    MCP_TASK_JOURNAL_EVENT,
    data,
    {
      createProjection: () => projection(sessionId),
      validateProjection(current) {
        transition(
          new Map(current.records.map((record) => [record.localId, record])),
          data,
          current.callRecovery,
        );
      },
    },
  );
  if (!/^[a-f0-9]{64}$/u.test(receipt?.hash || ""))
    fail("append not committed");
  const record = readMcpTaskJournal(sessionId).records.find(
    (item) => item.localId === data.localId,
  );
  if (!record || record.revision < data.revision)
    fail("committed record missing");
  return record;
}
