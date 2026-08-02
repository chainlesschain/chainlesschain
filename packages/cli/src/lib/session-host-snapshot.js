/**
 * Canonical cross-host view of one JSONL agent session.
 *
 * The snapshot is deliberately content-free: hosts can compare continuity,
 * replay authority and MCP terminal state without putting prompts, responses,
 * tool payloads, titles or filesystem paths on control-plane event streams.
 * Raw replay messages are returned only in the private resume state beside the
 * public snapshot and must never be attached to runtime events as part of the
 * snapshot itself.
 */

import { createHash } from "node:crypto";
import {
  projectWsTurnMessages,
  readVerifiedEvents as storeReadVerifiedEvents,
  readVerifiedProjection as storeReadVerifiedProjection,
  sessionExists as storeSessionExists,
} from "../harness/jsonl-session-store.js";
import {
  createMcpLedgerEventReducer,
  reduceMcpLedgerEvents,
} from "./mcp-call-ledger-store.js";
import { publicMcpRecoveryAuthority } from "./mcp-recovery-adjudication.js";
import { projectCanonicalResumeMessages } from "./session-message-provenance.js";

export const SESSION_HOST_SNAPSHOT_SCHEMA =
  "chainlesschain.session-host-snapshot/v1";
export const SESSION_HOST_SNAPSHOT_VERSION = 1;

const FAILURE_CODE = "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function payloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

function isReplayableMessage(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.role === "string"
  );
}

function replayMessagesFromVerifiedEvents(events) {
  const suffix = [];
  let checkpoint = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      (event?.type === "compact" ||
        event?.type === "checkpoint_timeline_commit") &&
      Array.isArray(event.data?.messages)
    ) {
      checkpoint = event.data.messages.filter(isReplayableMessage);
      break;
    }
    if (
      ["user_message", "assistant_message", "system"].includes(event?.type) &&
      isReplayableMessage(event.data)
    ) {
      suffix.push(event.data);
    } else if (event?.type === "ws_turn") {
      const turn = projectWsTurnMessages(event);
      if (turn) suffix.push(turn.assistant, turn.user);
    }
  }
  suffix.reverse();
  return Object.freeze(
    projectCanonicalResumeMessages([...checkpoint, ...suffix]),
  );
}

function messageProjection(messages) {
  return Object.freeze(
    messages.map((message, index) =>
      Object.freeze({
        index,
        role: message.role,
        bytes: payloadBytes(message.content),
        digest: digest(message.content),
      }),
    ),
  );
}

function titleProjectionFromValue(title) {
  return Object.freeze({ bytes: payloadBytes(title), digest: digest(title) });
}

function titleFromEvents(events) {
  let title = "Untitled";
  for (const event of events) {
    if (event?.type === "session_start" && event.data?.title) {
      title = String(event.data.title);
    } else if (event?.type === "session_rename" && event.data?.title) {
      title = String(event.data.title);
    }
  }
  return title;
}

function terminalProjection(recovery, authority, lastEvent) {
  const counts = {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const record of recovery.records) {
    if (Object.prototype.hasOwnProperty.call(counts, record.status)) {
      counts[record.status] += 1;
    }
  }
  return Object.freeze({
    lastEventType: typeof lastEvent?.type === "string" ? lastEvent.type : null,
    mcpCalls: Object.freeze({
      ...counts,
      outcomeUnknown: authority.unsettled.length,
      adjudicated: authority.adjudications.length,
      total: recovery.records.length,
    }),
  });
}

export function projectFailedSessionHostSnapshot(
  sessionId,
  reasonCode = FAILURE_CODE,
) {
  const content = {
    schema: SESSION_HOST_SNAPSHOT_SCHEMA,
    schemaVersion: SESSION_HOST_SNAPSHOT_VERSION,
    sessionId,
    verified: false,
    title: Object.freeze({ bytes: 0, digest: null }),
    head: Object.freeze({ hash: null, eventCount: 0 }),
    messages: Object.freeze([]),
    recoveryAuthority: Object.freeze({
      verified: false,
      headHash: null,
      recoveryDigest: null,
      blockMode: "all",
      reasonCode,
      unsettled: Object.freeze([]),
      incidents: Object.freeze([
        Object.freeze({ code: reasonCode, ledgerId: null }),
      ]),
      adjudications: Object.freeze([]),
      replayDenied: Object.freeze([]),
      remediation: "inspect_transcript",
    }),
    terminalState: Object.freeze({
      lastEventType: null,
      mcpCalls: Object.freeze({
        started: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        outcomeUnknown: 0,
        adjudicated: 0,
        total: 0,
      }),
    }),
  };
  return Object.freeze({ ...content, revision: digest(content) });
}

/**
 * Project one host's independently recovered inputs against a verified head.
 * This is the comparison seam used by the cross-host gate: messages/recovery
 * come from that host adapter, while events contribute only canonical title,
 * head and event-count metadata.
 */
function projectSessionHostProjection({
  sessionId,
  title,
  headHash,
  eventCount,
  lastEventType,
  messages,
  recovery,
}) {
  if (!Array.isArray(messages) || !recovery) {
    throw new TypeError("Host observation is missing messages or recovery");
  }
  const canonicalMessages = projectCanonicalResumeMessages(messages);
  if (
    typeof headHash !== "string" ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 1
  ) {
    throw new TypeError("Verified session head hash is missing");
  }
  const authority = publicMcpRecoveryAuthority(sessionId, recovery);
  if (authority.headHash !== headHash) {
    throw new TypeError("Host recovery authority does not match the head");
  }
  const content = {
    schema: SESSION_HOST_SNAPSHOT_SCHEMA,
    schemaVersion: SESSION_HOST_SNAPSHOT_VERSION,
    sessionId,
    verified: true,
    title: titleProjectionFromValue(title),
    head: Object.freeze({ hash: headHash, eventCount }),
    messages: messageProjection(canonicalMessages),
    recoveryAuthority: authority,
    terminalState: terminalProjection(recovery, authority, {
      type: lastEventType,
    }),
  };
  return Object.freeze({ ...content, revision: digest(content) });
}

export function projectSessionHostObservation({
  sessionId,
  events,
  messages,
  recovery,
}) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError("Verified session events must be a non-empty array");
  }
  const lastEvent = events.at(-1);
  if (typeof lastEvent?.hash !== "string") {
    throw new TypeError("Verified session head hash is missing");
  }
  return projectSessionHostProjection({
    sessionId,
    title: titleFromEvents(events),
    headHash: lastEvent.hash,
    eventCount: events.length,
    lastEventType: lastEvent.type,
    messages,
    recovery,
  });
}

/** Build a content-free snapshot from one already-verified, stable event set. */
export function projectVerifiedSessionHostSnapshot(sessionId, events) {
  const messages = replayMessagesFromVerifiedEvents(events);
  const recovery = reduceMcpLedgerEvents(events, {
    sessionId,
    verified: true,
  });
  return Object.freeze({
    snapshot: projectSessionHostObservation({
      sessionId,
      events,
      messages,
      recovery,
    }),
    messages,
    recovery,
  });
}

function createStreamingSessionHostProjection(sessionId) {
  let title = "Untitled";
  let lastEventType = null;
  const mcpReducer = createMcpLedgerEventReducer({
    sessionId,
    verified: true,
  });

  return {
    accept(event) {
      if (event?.type === "session_start" && event.data?.title) {
        title = String(event.data.title);
      } else if (event?.type === "session_rename" && event.data?.title) {
        title = String(event.data.title);
      }
      lastEventType = typeof event?.type === "string" ? event.type : null;
      mcpReducer.accept(event);
    },
    finish({ headHash, eventCount, readMessages }) {
      if (typeof readMessages !== "function") {
        throw new TypeError("Verified resume message reader is missing");
      }
      const recoveredMessages = readMessages();
      if (!Array.isArray(recoveredMessages)) {
        throw new TypeError("Verified resume messages must be an array");
      }
      const messages = Object.freeze(
        projectCanonicalResumeMessages(
          recoveredMessages.filter(isReplayableMessage),
        ),
      );
      const recovery = mcpReducer.finish();
      return Object.freeze({
        snapshot: projectSessionHostProjection({
          sessionId,
          title,
          headHash,
          eventCount,
          lastEventType,
          messages,
          recovery,
        }),
        messages,
        recovery,
      });
    },
  };
}

/**
 * Read one real JSONL session for a host resume/attach boundary.
 *
 * `null` means no JSONL session exists and callers may use their legacy store.
 * A present but damaged/unanchored transcript returns a fail-closed snapshot
 * and no raw messages, so a host cannot silently fall back to stale history.
 */
export function readSessionHostResumeState(sessionId, dependencies = {}) {
  const exists = dependencies.sessionExists || storeSessionExists;
  const hasCustomLegacyReader =
    typeof dependencies.readVerifiedEvents === "function" &&
    dependencies.readVerifiedEvents !== storeReadVerifiedEvents;
  const readVerifiedProjection =
    dependencies.readVerifiedProjection ||
    (hasCustomLegacyReader ? null : storeReadVerifiedProjection);
  const readVerifiedEvents =
    dependencies.readVerifiedEvents || storeReadVerifiedEvents;
  try {
    if (!exists(sessionId)) return null;
    if (typeof readVerifiedProjection === "function") {
      return readVerifiedProjection(sessionId, () =>
        createStreamingSessionHostProjection(sessionId),
      );
    }
    return projectVerifiedSessionHostSnapshot(
      sessionId,
      readVerifiedEvents(sessionId),
    );
  } catch {
    return Object.freeze({
      snapshot: projectFailedSessionHostSnapshot(sessionId),
      messages: null,
      recovery: null,
    });
  }
}

export function isVerifiedSessionHostSnapshot(value) {
  return (
    value?.schema === SESSION_HOST_SNAPSHOT_SCHEMA &&
    value?.schemaVersion === SESSION_HOST_SNAPSHOT_VERSION &&
    value?.verified === true &&
    typeof value?.revision === "string"
  );
}
