import { normalizeSessionGenerationAuthority } from "./session-generation-authority.js";
import {
  decodeVerifiedPersistedMessage,
  getDurableSystemMessageProvenance,
  DURABLE_SYSTEM_MESSAGE_KINDS,
} from "./session-message-provenance.js";
/** Pure task journal validation and verified-prefix projection; no session IO. */
import { createMcpLedgerEventReducer } from "./mcp-call-ledger-projection.js";
import { summarizeMcpPayload } from "./mcp-call-ledger.js";
import { admitMcpToolResult } from "./mcp-tool-result.js";
import { admitMcpTaskResponse } from "./mcp-tasks.js";
import {
  MCP_TASK_DELIVERY_EVENT,
  assertMcpTaskDeliverySource,
  renderMcpTaskDeliveryMessage,
} from "./mcp-task-delivery-contract.js";

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

export function snapshotMcpTaskJournalEvent(sessionId, value) {
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

export function transitionMcpTaskJournalRecord(
  records,
  data,
  callRecovery,
  { eventHash = null } = {},
) {
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
      resultEventHash: null,
      resultDigest: null,
      eventHash,
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
    eventHash,
    resultEventHash:
      data.phase === "result_saved" ? eventHash : previous.resultEventHash,
    resultDigest:
      data.phase === "result_saved"
        ? summarizeMcpPayload(result).sha256
        : previous.resultDigest,
    task,
    result,
    cancelRequested,
    cancelUnknown,
  });
}

/**
 * A prefix snapshot is diagnostic/intermediate state, never verified authority.
 * finish() requires the canonical reader's complete head/count verification.
 * Verification-only readers may discard raw results after computing the exact
 * delivery commitment. All event validation and call authority remain intact.
 */
export function createMcpTaskJournalProjection(
  sessionId,
  { retainResults = true } = {},
) {
  assertMcpTaskJournalSessionId(sessionId);
  if (typeof retainResults !== "boolean") fail("retention options");
  const records = new Map();
  const deliveries = new Map();
  const requestedCalls = createMcpLedgerEventReducer({
    sessionId,
    verified: true,
  });
  let activeSessionId = null;
  let originUnbound = false;
  let calls = null;
  const scopes = new Set();
  let count = 0;
  const state = (callRecovery) => ({
    sessionId,
    records: [...records.values()],
    deliveries: [...deliveries.values()],
    callRecovery,
    headHash: callRecovery.headHash,
  });
  return {
    accept(event) {
      if (calls === null) {
        const generation = normalizeSessionGenerationAuthority(
          event.data?._sessionGeneration,
        );
        if (
          Object.hasOwn(event.data || {}, "_sessionGeneration") &&
          !generation
        )
          fail("invalid generation source");
        activeSessionId = generation?.sessionId || sessionId;
        originUnbound = generation === null;
        if (!originUnbound) scopes.add(activeSessionId);
        calls =
          activeSessionId === sessionId
            ? requestedCalls
            : createMcpLedgerEventReducer({
                sessionId: activeSessionId,
                verified: true,
              });
      }
      if (originUnbound) {
        // Older canonical transcripts predate generation markers. A source ID
        // is only a candidate here: finish() still requires the actual target,
        // and a foreign candidate needs a validated fork boundary to reach it.
        const hint =
          event.type === "mcp_call_ledger"
            ? event.data?.record?.sessionId
            : event.type === MCP_TASK_JOURNAL_EVENT ||
                event.type === MCP_TASK_DELIVERY_EVENT
              ? event.data?.sessionId
              : event.type === "system"
                ? event.data?._cc_fork_authority?.sourceSessionId
                : null;
        if (typeof hint === "string" && text(hint)) {
          // A candidate origin must not erase incidents already seen in the
          // generation-less prefix before the first usable identity hint.
          assertRecovery(calls.finish());
          originUnbound = false;
          activeSessionId = hint;
          scopes.add(hint);
          calls =
            hint === sessionId
              ? requestedCalls
              : createMcpLedgerEventReducer({
                  sessionId: hint,
                  verified: true,
                  initialHeadHash: event.prevHash ?? null,
                });
        }
      }
      requestedCalls.accept(event);
      if (calls !== requestedCalls) calls.accept(event);
      count += 1;
      const fork = event.data?._cc_fork_authority;
      if (event.type === "system" && fork !== undefined) {
        const provenance = getDurableSystemMessageProvenance(
          decodeVerifiedPersistedMessage(event.data),
        );
        const generation = normalizeSessionGenerationAuthority(
          event.data?._sessionGeneration,
        );
        if (
          provenance?.kind !== DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE ||
          fork?.schema !== "chainlesschain.session-fork-authority/v1" ||
          !/^sha256:[a-f0-9]{64}$/u.test(fork.requestDigest) ||
          fork.sourceSessionId !== activeSessionId ||
          fork.sourceHeadHash !== event.prevHash ||
          fork.sourceEventCount !== count - 1 ||
          !generation ||
          generation.predecessor !== null ||
          generation.sessionId !==
            "session-fork-" + fork.requestDigest.slice(7, 39) ||
          scopes.has(generation.sessionId)
        )
          fail("fork source authority");
        // Validate the complete parent segment before retiring its task control.
        // The original requested-session recovery view remains conservative and
        // still reports foreign call records exactly as before this projection.
        assertRecovery(calls.finish());
        activeSessionId = generation.sessionId;
        scopes.add(activeSessionId);
        records.clear();
        deliveries.clear();
        calls = createMcpLedgerEventReducer({
          sessionId: activeSessionId,
          verified: true,
          initialHeadHash: event.hash,
        });
        return;
      }
      if (event.type === MCP_TASK_DELIVERY_EVENT) {
        const data = assertMcpTaskDeliverySource(
          event.data,
          records.get(event.data?.localId),
          calls.finish(),
        );
        if (data.sessionId !== activeSessionId || deliveries.has(data.localId))
          fail("duplicate or foreign delivery");
        deliveries.set(
          data.localId,
          freeze({
            ...data,
            ...(retainResults ? {} : { message: null }),
            eventHash: event.hash,
          }),
        );
        return;
      }
      if (event.type !== MCP_TASK_JOURNAL_EVENT) return;
      const data = snapshotMcpTaskJournalEvent(activeSessionId, event.data);
      let record = transitionMcpTaskJournalRecord(
        records,
        data,
        calls.finish(),
        { eventHash: event.hash },
      );
      if (!retainResults) {
        const task = record.task ? { ...record.task } : null;
        if (task) delete task.statusMessage;
        record = freeze({
          ...record,
          task,
          ...(record.result === null
            ? {}
            : {
                resultIsError: record.result.isError === true,
                renderedMessageDigest: summarizeMcpPayload(
                  renderMcpTaskDeliveryMessage(record),
                ).sha256,
              }),
          result: null,
        });
      }
      records.set(data.localId, record);
    },
    snapshot() {
      const callRecovery = requestedCalls.finish();
      return freeze({
        ...state({ ...callRecovery, verified: false }),
        verified: false,
      });
    },
    finish(authority) {
      const callRecovery = requestedCalls.finish();
      assertRecovery(calls?.finish() || callRecovery);
      if (activeSessionId !== sessionId)
        fail("missing fork ownership boundary");
      if (
        !authority ||
        count < 1 ||
        authority.eventCount !== count ||
        !authority.headHash ||
        authority.headHash !== callRecovery.headHash
      )
        fail("verified session authority");
      return freeze(state(callRecovery));
    },
  };
}

export function assertMcpTaskJournalSessionId(sessionId) {
  if (!text(sessionId)) fail("session id");
}
