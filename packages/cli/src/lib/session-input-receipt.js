import { createHash } from "node:crypto";
import {
  appendAuthorityEventWithVerifiedProjection,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";

export function validateClientMessageId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value)) {
    throw new TypeError(
      "client_message_id must be 1–80 ASCII letters, digits, _ or -",
    );
  }
  return value;
}

export function inputSubmissionDigest(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function receiptProjection(sessionId, clientMessageId) {
  let receipt = null;
  return {
    accept(event) {
      if (
        event.type !== "user_message" ||
        event.data?.clientMessageId !== clientMessageId
      )
        return;
      const next = {
        sessionId,
        clientMessageId,
        inputDigest: event.data.inputDigest,
        eventHash: event.hash,
      };
      if (
        !/^[a-f0-9]{64}$/u.test(next.inputDigest || "") ||
        !/^[a-f0-9]{64}$/u.test(next.eventHash || "") ||
        receipt
      ) {
        throw new Error("Invalid or repeated durable input receipt");
      }
      receipt = next;
    },
    finish() {
      return receipt;
    },
  };
}

export function readSessionInputReceipt(sessionId, clientMessageId) {
  validateClientMessageId(clientMessageId);
  const receipt = readVerifiedProjection(sessionId, () =>
    receiptProjection(sessionId, clientMessageId),
  );
  return {
    schema: "chainlesschain.input-receipt/v1",
    sessionId,
    clientMessageId,
    accepted: !!receipt,
    receipt,
  };
}

/** Acceptance and deduplication share the existing canonical writer authority. */
export function appendSessionInputWithReceipt(
  sessionId,
  content,
  clientMessageId,
  submission = content,
) {
  validateClientMessageId(clientMessageId);
  const inputDigest = inputSubmissionDigest(submission);
  let duplicate = null;
  try {
    const appended = appendAuthorityEventWithVerifiedProjection(
      sessionId,
      "user_message",
      {
        role: "user",
        content,
        clientMessageId,
        inputDigest,
      },
      {
        createProjection: () => receiptProjection(sessionId, clientMessageId),
        validateProjection: (receipt) => {
          if (!receipt) return;
          if (receipt.inputDigest !== inputDigest)
            throw new Error(
              "client_message_id was already used for different input",
            );
          // The store has verified the full chain and anchor before invoking
          // this callback. Rejecting here means no append can have started.
          duplicate = receipt;
          throw new Error("Input already accepted");
        },
      },
    );
    return {
      sessionId,
      clientMessageId,
      inputDigest,
      eventHash: appended.hash,
      duplicate: false,
    };
  } catch (error) {
    if (duplicate) return { ...duplicate, duplicate: true };
    throw error;
  }
}
