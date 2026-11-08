import { withSessionAuthorityTransaction } from "../harness/jsonl-session-store.js";
import { assertSessionHostWriteAuthority } from "./session-host-lease.js";
import { readMcpTaskJournal } from "./mcp-task-journal.js";
import { createMcpTaskJournalProjection } from "./mcp-task-journal-projection.js";
import {
  MCP_TASK_DELIVERY_EVENT,
  assertMcpTaskDeliverySource,
  createMcpTaskDeliveryData,
} from "./mcp-task-delivery-contract.js";

function error(code, message) {
  return Object.assign(new Error(message), { code });
}
function receipt(delivery, duplicate) {
  return Object.freeze({
    sessionId: delivery.sessionId,
    localId: delivery.localId,
    deliveryId: delivery.deliveryId,
    eventHash: delivery.eventHash,
    messageDigest: delivery.messageDigest,
    delivered: true,
    duplicate,
  });
}
function requireLease(sessionId) {
  if (!assertSessionHostWriteAuthority(sessionId)) {
    throw error(
      "CC_MCP_TASK_DELIVERY_LEASE_REQUIRED",
      "MCP task delivery requires its active session lease",
    );
  }
}

/**
 * One canonical event both consumes the saved result and defines its replay
 * message. Never append a separate consumed marker and conversation message.
 */
export function deliverMcpTaskResult(sessionId, localId) {
  requireLease(sessionId);
  let intended = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = readMcpTaskJournal(sessionId);
    try {
      const outcome = withSessionAuthorityTransaction(
        sessionId,
        before.headHash,
        (writer) => {
          // The canonical writer already holds the lease authority lock.
          const current = writer.readProjection(() =>
            createMcpTaskJournalProjection(sessionId),
          );
          const existing = current.deliveries.find(
            (item) => item.localId === localId,
          );
          if (existing) return receipt(existing, true);
          const record = current.records.find(
            (item) => item.localId === localId,
          );
          if (!record)
            throw error(
              "CC_MCP_TASK_NOT_FOUND",
              "No task exists in this verified session",
            );
          intended = createMcpTaskDeliveryData(record);
          assertMcpTaskDeliverySource(intended, record, current.callRecovery);
          const appended = writer.appendAuthorityEvent(
            MCP_TASK_DELIVERY_EVENT,
            intended,
          );
          if (!/^[a-f0-9]{64}$/u.test(appended?.hash || "")) {
            throw error(
              "CC_MCP_TASK_DELIVERY_UNVERIFIED",
              "MCP task delivery append was not confirmed",
            );
          }
          return receipt({ ...intended, eventHash: appended.hash }, false);
        },
      );
      // Verify the committed event under a fresh canonical lock before returning.
      const delivery = readMcpTaskJournal(sessionId).deliveries.find(
        (item) =>
          item.localId === localId && item.eventHash === outcome.eventHash,
      );
      if (!delivery)
        throw error(
          "CC_MCP_TASK_DELIVERY_UNVERIFIED",
          "MCP task delivery was not verified",
        );
      return receipt(delivery, outcome.duplicate);
    } catch (cause) {
      if (cause?.code === "SESSION_REVISION_STALE" && !intended) continue;
      // A lost acknowledgement may follow the durable anchor publication.
      // Confirm the same deterministic delivery; never append again to guess.
      if (intended && ["unknown", "committed"].includes(cause?.commitState)) {
        const after = readMcpTaskJournal(sessionId);
        const delivery = after.deliveries.find(
          (item) => item.localId === localId,
        );
        if (
          delivery?.messageDigest === intended.messageDigest &&
          delivery?.sourceEventHash === intended.sourceEventHash &&
          delivery?.resultDigest === intended.resultDigest
        )
          return receipt(delivery, true);
      }
      throw cause;
    }
  }
  throw error(
    "SESSION_REVISION_STALE",
    "Session changed while delivering the task; refresh before retrying",
  );
}
