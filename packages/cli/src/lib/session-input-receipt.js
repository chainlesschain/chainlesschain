import { createHash } from "node:crypto";
import {
  appendAuthorityEventWithVerifiedProjection,
  appendAuthorityEvent,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import {
  SESSION_INPUT_ACCEPTED,
  SESSION_INPUT_SETTLED,
  createSessionInputAccepted,
  createSessionInputSettled,
  createSessionInputLifecycleProjection,
} from "./session-input-lifecycle.js";

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

export function readSessionInputAcceptance(sessionId, inputId) {
  const projection = createSessionInputLifecycleProjection();
  const state = readVerifiedProjection(sessionId, () => projection);
  const pending = state?.pendingInputs?.find(
    (item) => item.inputId === inputId,
  );
  return pending || null;
}

/** Persist the accepted prompt in a non-replay event before provider dispatch. */
export function appendSessionInputAcceptance(
  sessionId,
  { inputId, turnId, prompt },
) {
  const existing = readSessionInputAcceptance(sessionId, inputId);
  const accepted = createSessionInputAccepted({ inputId, turnId, prompt });
  if (existing) {
    if (
      existing.turnId !== accepted.turnId ||
      existing.inputDigest !== accepted.inputDigest
    )
      throw new Error("inputId was already accepted for different input");
    return { ...existing, duplicate: true };
  }
  const appended = appendAuthorityEvent(
    sessionId,
    SESSION_INPUT_ACCEPTED,
    accepted,
  );
  return {
    ...accepted,
    acceptanceHash: appended.hash,
    duplicate: false,
  };
}

/** Publish the complete user/assistant pair as one replayable event. */
export function appendSessionInputSettlement(sessionId, accepted, response) {
  const pending = readSessionInputAcceptance(sessionId, accepted?.inputId);
  if (
    !pending ||
    pending.turnId !== accepted?.turnId ||
    pending.inputDigest !== accepted?.inputDigest ||
    pending.acceptanceHash !== accepted?.acceptanceHash
  ) {
    throw new Error("Settlement does not match the pending accepted input");
  }
  const data = createSessionInputSettled(
    accepted,
    accepted.acceptanceHash,
    response,
  );
  const appended = appendAuthorityEvent(sessionId, SESSION_INPUT_SETTLED, data);
  return { ...data, eventHash: appended.hash };
}
