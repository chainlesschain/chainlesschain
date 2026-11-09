import {
  appendAuthorityEventWithVerifiedProjection,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import { assertSessionHostWriteAuthority } from "./session-host-lease.js";
import { readMcpTaskJournal } from "./mcp-task-journal.js";
import { createMcpTaskJournalProjection } from "./mcp-task-journal-projection.js";
import {
  MCP_TASK_CONTINUATION_STARTED,
  MCP_TASK_CONTINUATION_FIELD,
  createMcpTaskContinuationStart,
  assertMcpTaskContinuationStart,
  createMcpTaskContinuationMessage,
  assertMcpTaskContinuationMessage,
} from "./mcp-task-continuation-contract.js";

function error(code, message) {
  return Object.assign(new Error(message), { code });
}
function requireLease(sessionId) {
  if (!assertSessionHostWriteAuthority(sessionId))
    throw error(
      "CC_MCP_TASK_CONTINUATION_LEASE_REQUIRED",
      "MCP continuation requires the owning session lease",
    );
}

/** A started continuation is never automatically repeated, even if dispatch or
 * result persistence was interrupted. Text mentioning an ID is not authority. */
export function beginMcpTaskContinuation(sessionId, localId) {
  requireLease(sessionId);
  const before = readMcpTaskJournal(sessionId);
  const delivery = before.deliveries.find((item) => item.localId === localId);
  if (!delivery)
    throw error(
      "CC_MCP_TASK_CONTINUATION_DELIVERY_REQUIRED",
      "Deliver the verified result before continuing",
    );
  if (before.continuations.some((item) => item.localId === localId))
    throw error(
      "CC_MCP_TASK_CONTINUATION_ALREADY_STARTED",
      "A prior continuation exists; inspect its outcome instead of replaying it",
    );
  const messages = readVerifiedProjection(sessionId, () => ({
    accept() {},
    finish(authority) {
      return authority.readMessages();
    },
  }));
  if (!messages.some((item) => item.role === "user"))
    throw error(
      "CC_MCP_TASK_CONTINUATION_USER_TASK_REQUIRED",
      "Submit a real user request before automatic continuation",
    );
  const legacy = `Continue from the verified background MCP task result (deliveryId: ${delivery.deliveryId}).`;
  if (messages.some((item) => item.role === "user" && item.content === legacy))
    throw error(
      "CC_MCP_TASK_CONTINUATION_LEGACY_REVIEW_REQUIRED",
      "A legacy continuation may have run; use an explicit user prompt after inspection",
    );
  const data = createMcpTaskContinuationStart(delivery);
  const options = {
    createProjection: () => createMcpTaskJournalProjection(sessionId),
    validateProjection(current) {
      assertMcpTaskContinuationStart(
        data,
        current.deliveries.find((item) => item.localId === localId),
        sessionId,
        current.continuations.find((item) => item.localId === localId),
      );
    },
  };
  try {
    appendAuthorityEventWithVerifiedProjection(
      sessionId,
      MCP_TASK_CONTINUATION_STARTED,
      data,
      options,
    );
  } catch (cause) {
    if (!["unknown", "committed"].includes(cause?.commitState)) throw cause;
    const confirmed = readMcpTaskJournal(sessionId).continuations.find(
      (item) => item.localId === localId,
    );
    if (
      !confirmed ||
      confirmed.at !== data.at ||
      confirmed.deliveryEventHash !== data.deliveryEventHash
    )
      throw cause;
  }
  const started = readMcpTaskJournal(sessionId).continuations.find(
    (item) => item.localId === localId,
  );
  if (!started || started.phase !== "started")
    throw error(
      "CC_MCP_TASK_CONTINUATION_UNVERIFIED",
      "Continuation start was not confirmed",
    );
  return Object.freeze({ ...started, delivery });
}

/** One existing assistant_message event atomically publishes both the model
 * answer and its exact consumption binding. No synthetic user message. */
export function settleMcpTaskContinuation(sessionId, started, content) {
  requireLease(sessionId);
  const message = createMcpTaskContinuationMessage(started, content);
  const localId = started.localId;
  try {
    appendAuthorityEventWithVerifiedProjection(
      sessionId,
      "assistant_message",
      message,
      {
        createProjection: () => createMcpTaskJournalProjection(sessionId),
        validateProjection(current) {
          assertMcpTaskContinuationMessage(
            message,
            current.deliveries.find((item) => item.localId === localId),
            sessionId,
            current.continuations.find((item) => item.localId === localId),
          );
        },
      },
    );
  } catch (cause) {
    if (!["unknown", "committed"].includes(cause?.commitState)) throw cause;
    const confirmed = readMcpTaskJournal(sessionId).continuations.find(
      (item) => item.localId === localId,
    );
    if (
      confirmed?.phase !== "settled" ||
      confirmed.outputDigest !==
        message[MCP_TASK_CONTINUATION_FIELD].outputDigest
    )
      throw cause;
  }
  const settled = readMcpTaskJournal(sessionId).continuations.find(
    (item) => item.localId === localId,
  );
  if (settled?.phase !== "settled")
    throw error(
      "CC_MCP_TASK_CONTINUATION_UNVERIFIED",
      "Continuation result was not confirmed",
    );
  return settled;
}
