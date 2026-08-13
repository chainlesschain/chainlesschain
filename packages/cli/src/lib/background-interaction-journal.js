/**
 * Durable pending/settlement journal for background human interactions.
 *
 * Each mutation appends a full snapshot to the session's tamper-evident JSONL
 * transcript. The worker persists a terminal settlement before delivering it
 * to the suspended child, so retries can be classified as the same idempotent
 * answer or a conflicting second settlement even after a process restart.
 */

import { createHash } from "node:crypto";
import {
  appendAuthorityEventWithVerifiedProjection as storeAppendAuthorityEventWithVerifiedProjection,
  getSessionPresence as storeGetSessionPresence,
  readVerifiedEvents as storeReadVerifiedEvents,
  SESSION_PRESENCE,
} from "../harness/jsonl-session-store.js";
import { createSessionTranscriptStructureProjection } from "./session-transcript-structure.js";
import {
  normalizeInteractionBinding,
  sameInteractionBinding,
} from "./interaction-binding.js";

export const BACKGROUND_INTERACTION_JOURNAL_EVENT =
  "background_interaction_journal";
export const BACKGROUND_INTERACTION_JOURNAL_VERSION = 1;
export const MAX_BACKGROUND_INTERACTION_RECORDS = 256;

const TERMINAL_STATUSES = new Set(["resolved", "rejected", "cancelled"]);

export const _deps = {
  appendEventWithVerifiedProjection:
    storeAppendAuthorityEventWithVerifiedProjection,
  getSessionPresence: storeGetSessionPresence,
  readVerifiedEvents: storeReadVerifiedEvents,
};

function absentJournal(backgroundAgentId, options = {}) {
  return new BackgroundInteractionJournal({
    backgroundAgentId,
    now: options.now,
    sessionId: options.sessionId,
  });
}

function findLatestJournalEvent(sessionId, backgroundAgentId) {
  const valid = (event) => event?.data?.backgroundAgentId === backgroundAgentId;
  const events = _deps.readVerifiedEvents(sessionId) || [];
  const structure = createSessionTranscriptStructureProjection(sessionId, {
    failFast: true,
  });
  for (const event of events) structure.accept(event);
  structure.finish({ assertValid: true });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === BACKGROUND_INTERACTION_JOURNAL_EVENT && valid(event)) {
      return event;
    }
  }
  return null;
}

function journalError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertVerifiedRecoverySession(sessionId) {
  const events = _deps.readVerifiedEvents(sessionId);
  if (!Array.isArray(events) || events[0]?.type !== "session_start") {
    throw journalError(
      `Background interaction recovery requires an existing verified session: ${sessionId}`,
      "INTERACTION_RECOVERY_SESSION_UNAVAILABLE",
      { sessionId },
    );
  }
  return events;
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function journalSnapshotFingerprint(journal) {
  return fingerprint(journal.toJSON());
}

function createJournalProjection(sessionId, backgroundAgentId) {
  const structure = createSessionTranscriptStructureProjection(sessionId, {
    failFast: true,
  });
  let latest = null;
  return Object.freeze({
    accept(event) {
      structure.accept(event);
      if (
        event?.type === BACKGROUND_INTERACTION_JOURNAL_EVENT &&
        event?.data?.backgroundAgentId === backgroundAgentId
      ) {
        latest = event.data;
      }
    },
    finish() {
      structure.finish({ assertValid: true });
      const journal = latest
        ? BackgroundInteractionJournal.fromJSON(latest, {
            expectedSessionId: sessionId,
          })
        : new BackgroundInteractionJournal({ backgroundAgentId });
      return Object.freeze({
        journal,
        fingerprint: journalSnapshotFingerprint(journal),
      });
    },
  });
}

function assertCompleteRecoveryFallback(
  fallback,
  sessionId,
  backgroundAgentId,
) {
  if (fallback == null) return false;
  if (!fallback?.requestId) {
    throw journalError(
      "Legacy pending interaction recovery evidence has no request id",
      "INTERACTION_RECOVERY_FALLBACK_INVALID",
      { sessionId, backgroundAgentId },
    );
  }
  const normalized = normalizeInteractionBinding(fallback.binding);
  const complete =
    normalized.backgroundAgentId !== null &&
    normalized.sessionId !== null &&
    normalized.turnId !== null &&
    normalized.toolUseId !== null &&
    normalized.sequence !== null;
  if (
    !complete ||
    normalized.backgroundAgentId !== backgroundAgentId ||
    normalized.sessionId !== sessionId
  ) {
    throw journalError(
      "Legacy pending interaction recovery evidence is incomplete or belongs to another session",
      "INTERACTION_RECOVERY_FALLBACK_INVALID",
      {
        sessionId,
        backgroundAgentId,
        requestId: String(fallback.requestId),
      },
    );
  }
  return true;
}

function canonicalize(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function normalizeError(error, fallbackCode = "INTERACTION_REJECTED") {
  if (!error) return null;
  if (typeof error === "string") {
    return { code: fallbackCode, message: error };
  }
  return {
    code: String(error.code || fallbackCode),
    message: String(error.message || error),
  };
}

function normalizeSettlement(outcome = {}) {
  const status = String(outcome.status || "");
  if (!TERMINAL_STATUSES.has(status)) {
    throw journalError(
      `Invalid background interaction settlement status: ${status || "<missing>"}`,
      "INTERACTION_SETTLEMENT_INVALID",
    );
  }
  return {
    status,
    answer: status === "resolved" ? cloneJson(outcome.answer) : null,
    error:
      status === "resolved"
        ? null
        : normalizeError(
            outcome.error,
            status === "cancelled"
              ? "INTERACTION_CANCELLED"
              : "INTERACTION_REJECTED",
          ),
  };
}

export class BackgroundInteractionJournal {
  constructor(options = {}) {
    this.backgroundAgentId = String(options.backgroundAgentId || "");
    if (!this.backgroundAgentId) {
      throw journalError(
        "backgroundAgentId is required for the interaction journal",
        "INTERACTION_JOURNAL_INVALID",
      );
    }
    this.sessionId =
      options.sessionId == null ? null : String(options.sessionId);
    this._now = options.now || Date.now;
    this.records = [];
  }

  static fromJSON(snapshot, options = {}) {
    if (
      !snapshot ||
      snapshot.version !== BACKGROUND_INTERACTION_JOURNAL_VERSION ||
      typeof snapshot.backgroundAgentId !== "string" ||
      !Array.isArray(snapshot.records)
    ) {
      throw journalError(
        "Invalid background interaction journal snapshot",
        "INTERACTION_JOURNAL_CORRUPT",
      );
    }
    const journal = new BackgroundInteractionJournal({
      backgroundAgentId: snapshot.backgroundAgentId,
      now: options.now,
      sessionId: options.expectedSessionId,
    });
    const seen = new Set();
    journal.records = snapshot.records.map((record) => {
      const requestId = String(record?.requestId || "");
      const binding = normalizeInteractionBinding(record?.binding);
      const payload = cloneJson(record?.payload || {});
      const payloadFingerprint = String(record?.payloadFingerprint || "");
      const status = String(record?.status || "");
      const completeBinding =
        binding.backgroundAgentId === snapshot.backgroundAgentId &&
        (options.expectedSessionId == null ||
          binding.sessionId === options.expectedSessionId) &&
        binding.sessionId !== null &&
        binding.turnId !== null &&
        binding.toolUseId !== null &&
        binding.sequence !== null;
      if (
        !requestId ||
        seen.has(requestId) ||
        !completeBinding ||
        payloadFingerprint !== fingerprint(payload) ||
        (status !== "pending" && !TERMINAL_STATUSES.has(status))
      ) {
        throw journalError(
          "Invalid background interaction journal record",
          "INTERACTION_JOURNAL_CORRUPT",
          { requestId: requestId || null },
        );
      }
      seen.add(requestId);
      const createdAt = Number(record.createdAt);
      const settledAt =
        record.settledAt == null ? null : Number(record.settledAt);
      let settlement = null;
      let settlementFingerprint = null;
      if (status === "pending") {
        if (
          settledAt !== null ||
          record.settlement != null ||
          record.settlementFingerprint != null
        ) {
          throw journalError(
            "Pending background interaction has terminal settlement data",
            "INTERACTION_JOURNAL_CORRUPT",
            { requestId },
          );
        }
      } else {
        settlement = normalizeSettlement(record.settlement);
        settlementFingerprint = String(record.settlementFingerprint || "");
        if (
          settlement.status !== status ||
          !Number.isFinite(settledAt) ||
          settlementFingerprint !== fingerprint(settlement)
        ) {
          throw journalError(
            "Terminal background interaction settlement is inconsistent",
            "INTERACTION_JOURNAL_CORRUPT",
            { requestId },
          );
        }
      }
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        throw journalError(
          "Background interaction timestamp is invalid",
          "INTERACTION_JOURNAL_CORRUPT",
          { requestId },
        );
      }
      return {
        requestId,
        binding,
        payload,
        payloadFingerprint,
        status,
        createdAt,
        settledAt,
        settlement,
        settlementFingerprint,
      };
    });
    return journal;
  }

  toJSON() {
    return {
      version: BACKGROUND_INTERACTION_JOURNAL_VERSION,
      backgroundAgentId: this.backgroundAgentId,
      records: cloneJson(this.records),
    };
  }

  get(requestId) {
    return (
      this.records.find((record) => record.requestId === String(requestId)) ||
      null
    );
  }

  pending() {
    return this.records.filter((record) => record.status === "pending");
  }

  recordPending({ requestId, binding, payload = {}, createdAt } = {}) {
    const id = String(requestId || "");
    const normalizedBinding = normalizeInteractionBinding(binding);
    if (
      !id ||
      normalizedBinding.backgroundAgentId !== this.backgroundAgentId ||
      (this.sessionId !== null &&
        normalizedBinding.sessionId !== this.sessionId) ||
      normalizedBinding.sessionId === null ||
      normalizedBinding.turnId === null ||
      normalizedBinding.toolUseId === null ||
      normalizedBinding.sequence === null
    ) {
      throw journalError(
        "A requestId and complete interaction binding are required",
        "INTERACTION_REQUEST_INVALID",
      );
    }
    const safePayload = cloneJson(payload);
    const payloadFingerprint = fingerprint(safePayload);
    const existing = this.get(id);
    if (existing) {
      if (
        sameInteractionBinding(existing.binding, normalizedBinding) &&
        existing.payloadFingerprint === payloadFingerprint
      ) {
        return { applied: false, record: cloneJson(existing) };
      }
      throw journalError(
        `Interaction request ${id} was replayed with different binding or payload`,
        "INTERACTION_REQUEST_CONFLICT",
        { requestId: id },
      );
    }

    const record = {
      requestId: id,
      binding: normalizedBinding,
      payload: safePayload,
      payloadFingerprint,
      status: "pending",
      createdAt: Number(createdAt) || this._now(),
      settledAt: null,
      settlement: null,
      settlementFingerprint: null,
    };
    this.records.push(record);
    this._prune();
    return { applied: true, record: cloneJson(record) };
  }

  settle(requestId, binding, outcome = {}) {
    const id = String(requestId || "");
    const record = this.get(id);
    if (!record) {
      throw journalError(
        `Unknown background interaction request: ${id || "<missing>"}`,
        "INTERACTION_REQUEST_UNKNOWN",
        { requestId: id },
      );
    }
    if (!sameInteractionBinding(record.binding, binding)) {
      throw journalError(
        `Interaction response binding does not match request ${id}`,
        "INTERACTION_BINDING_MISMATCH",
        { requestId: id },
      );
    }
    const settlement = normalizeSettlement(outcome);
    const settlementFingerprint = fingerprint(settlement);
    if (record.status !== "pending") {
      if (record.settlementFingerprint === settlementFingerprint) {
        return { applied: false, record: cloneJson(record) };
      }
      throw journalError(
        `Interaction request ${id} is already settled`,
        "INTERACTION_ALREADY_SETTLED",
        { requestId: id, status: record.status },
      );
    }

    record.status = settlement.status;
    record.settledAt = this._now();
    record.settlement = settlement;
    record.settlementFingerprint = settlementFingerprint;
    return { applied: true, record: cloneJson(record) };
  }

  rejectPending(error = {}) {
    const rejected = [];
    for (const record of this.pending()) {
      const result = this.settle(record.requestId, record.binding, {
        status: "rejected",
        error,
      });
      rejected.push(result.record);
    }
    return rejected;
  }

  _prune() {
    while (this.records.length > MAX_BACKGROUND_INTERACTION_RECORDS) {
      const terminalIndex = this.records.findIndex((record) =>
        TERMINAL_STATUSES.has(record.status),
      );
      if (terminalIndex === -1) {
        throw journalError(
          `Background interaction journal exceeded ${MAX_BACKGROUND_INTERACTION_RECORDS} pending requests`,
          "INTERACTION_PENDING_LIMIT",
        );
      }
      this.records.splice(terminalIndex, 1);
    }
  }
}

export class BackgroundInteractionPersistenceError extends Error {
  constructor(operation, sessionId, cause) {
    const detail =
      cause?.message || String(cause || "unknown persistence error");
    super(
      `Background interaction journal ${operation} failed for ${sessionId}: ${detail}`,
      { cause },
    );
    this.name = "BackgroundInteractionPersistenceError";
    this.code =
      operation === "read"
        ? "INTERACTION_JOURNAL_READ_FAILED"
        : "INTERACTION_JOURNAL_PERSIST_FAILED";
    this.operation = operation;
    this.sessionId = sessionId;
    if (cause?.commitState) this.commitState = cause.commitState;
    if (cause?.code) this.causeCode = cause.code;
  }
}

export function persistBackgroundInteractionJournal(
  sessionId,
  journal,
  options = {},
) {
  const failIfUnavailable = options.failIfUnavailable !== false;
  try {
    if (!sessionId || !(journal instanceof BackgroundInteractionJournal)) {
      throw new TypeError("sessionId and interaction journal are required");
    }
    // Re-parse the complete candidate at the final write boundary. A mutate
    // callback can add records after the source snapshot was validated; those
    // records must still be bound to this exact session and agent.
    BackgroundInteractionJournal.fromJSON(journal.toJSON(), {
      expectedSessionId: sessionId,
    });
    const expectedFingerprint =
      options.expectedFingerprint ??
      journalSnapshotFingerprint(
        new BackgroundInteractionJournal({
          backgroundAgentId: journal.backgroundAgentId,
        }),
      );
    _deps.appendEventWithVerifiedProjection(
      sessionId,
      BACKGROUND_INTERACTION_JOURNAL_EVENT,
      journal.toJSON(),
      {
        createProjection: () =>
          createJournalProjection(sessionId, journal.backgroundAgentId),
        validateProjection(projected) {
          if (
            expectedFingerprint !== undefined &&
            projected.fingerprint !== expectedFingerprint
          ) {
            throw journalError(
              "Background interaction journal changed before the mutation could commit",
              "INTERACTION_JOURNAL_STALE",
              {
                sessionId,
                backgroundAgentId: journal.backgroundAgentId,
                expectedFingerprint,
                actualFingerprint: projected.fingerprint,
              },
            );
          }
        },
      },
    );
    return true;
  } catch (error) {
    if (!failIfUnavailable) return false;
    throw new BackgroundInteractionPersistenceError(
      "write",
      sessionId || "<missing-session>",
      error,
    );
  }
}

export function loadBackgroundInteractionJournal(
  sessionId,
  backgroundAgentId,
  options = {},
) {
  const failIfUnavailable = options.failIfUnavailable !== false;
  try {
    if (!sessionId || !backgroundAgentId) {
      throw new TypeError("sessionId and backgroundAgentId are required");
    }
    const presence = _deps.getSessionPresence(sessionId);
    if (presence === SESSION_PRESENCE.ABSENT && options.allowAbsent === true) {
      return absentJournal(backgroundAgentId, { ...options, sessionId });
    }
    const event = findLatestJournalEvent(sessionId, backgroundAgentId);
    if (event) {
      return BackgroundInteractionJournal.fromJSON(event.data, {
        ...options,
        expectedSessionId: sessionId,
      });
    }
    return new BackgroundInteractionJournal({
      backgroundAgentId,
      now: options.now,
      sessionId,
    });
  } catch (error) {
    if (!failIfUnavailable) {
      return new BackgroundInteractionJournal({
        backgroundAgentId,
        now: options.now,
        sessionId,
      });
    }
    throw new BackgroundInteractionPersistenceError(
      "read",
      sessionId || "<missing-session>",
      error,
    );
  }
}

/**
 * Clone-mutate-persist transaction. The live journal is not changed when the
 * append fails, so a caller may safely retry the same settlement.
 */
export function updateBackgroundInteractionJournal(
  sessionId,
  journal,
  mutate,
  options = {},
) {
  const expectedFingerprint = journalSnapshotFingerprint(journal);
  const draft = BackgroundInteractionJournal.fromJSON(journal.toJSON(), {
    now: options.now || journal._now,
    expectedSessionId: sessionId,
  });
  const result = mutate(draft);
  if (!options.persistIf || options.persistIf(result) !== false) {
    try {
      persistBackgroundInteractionJournal(sessionId, draft, {
        ...options,
        expectedFingerprint,
      });
    } catch (error) {
      // Authority append can durably reach the transcript before its metadata
      // settlement reports an ambiguous result. Only an exact verified
      // readback of the intended full snapshot adjudicates that ambiguity as
      // committed; every other state remains fail closed.
      if (error?.commitState === "unknown") {
        try {
          const readback = options.readbackJournal;
          const verified =
            typeof readback === "function"
              ? readback(sessionId, journal.backgroundAgentId, options)
              : loadBackgroundInteractionJournal(
                  sessionId,
                  journal.backgroundAgentId,
                  options,
                );
          if (
            journalSnapshotFingerprint(verified) ===
            journalSnapshotFingerprint(draft)
          ) {
            return { journal: verified, result, adjudicated: true };
          }
        } catch {
          // Keep the original ambiguous persistence error and its commitState.
        }
      }
      throw error;
    }
  }
  return { journal: draft, result };
}

/**
 * Classify a transport response that arrived after its live child request was
 * removed. A still-pending row belongs to recovery authority and must never be
 * settled by a late client. Only an exact replay of an already-terminal result
 * is acknowledged, without appending another journal snapshot.
 */
export function classifyLateBackgroundInteractionSettlement(
  journal,
  requestId,
  binding,
  outcome,
) {
  if (!(journal instanceof BackgroundInteractionJournal)) {
    throw new TypeError("background interaction journal is required");
  }
  const record = journal.get(requestId);
  if (!record || record.status === "pending") {
    return Object.freeze({
      accepted: false,
      duplicate: false,
      delivered: false,
      reason: record
        ? "interaction_no_live_child"
        : "interaction_request_unknown",
    });
  }
  const duplicate = journal.settle(requestId, binding, outcome);
  return Object.freeze({
    accepted: true,
    duplicate: duplicate.applied === false,
    delivered: false,
  });
}

/**
 * Recovery entry point used when a worker is observed lost or starts again.
 * An optional state-file fallback lets pre-journal pendingQuestion records be
 * imported once and deterministically rejected.
 */
export function rejectPendingBackgroundInteractions(
  sessionId,
  backgroundAgentId,
  options = {},
) {
  const presence = _deps.getSessionPresence(sessionId);
  if (presence === SESSION_PRESENCE.ABSENT && options.fallbackRequest == null) {
    return {
      journal: absentJournal(backgroundAgentId, { ...options, sessionId }),
      rejected: [],
      changed: false,
    };
  }
  // Normalize absent/missing/tombstoned recovery to a stable domain error
  // before loading a canonical journal. Structurally corrupt live transcripts
  // still surface as read failures and therefore block cleanup fail closed.
  if (options.fallbackRequest != null) assertVerifiedRecoverySession(sessionId);
  let journal = loadBackgroundInteractionJournal(
    sessionId,
    backgroundAgentId,
    options,
  );
  const fallback = options.fallbackRequest;
  const hasValidFallback = assertCompleteRecoveryFallback(
    fallback,
    sessionId,
    backgroundAgentId,
  );
  const hasFallback =
    hasValidFallback && !journal.get(String(fallback.requestId));
  if (hasValidFallback && !hasFallback) {
    const existing = journal.get(String(fallback.requestId));
    const normalizedBinding = normalizeInteractionBinding(fallback.binding);
    // The supervisor state intentionally stores a compact display projection
    // of the question, not the complete canonical IPC payload (for example it
    // may omit defaultValue/policyDigest). Once the exact request id and full
    // binding match, the verified journal remains payload authority.
    if (!sameInteractionBinding(existing.binding, normalizedBinding)) {
      throw journalError(
        "Legacy pending interaction recovery evidence conflicts with the canonical journal",
        "INTERACTION_RECOVERY_FALLBACK_INVALID",
        {
          sessionId,
          backgroundAgentId,
          requestId: String(fallback.requestId),
        },
      );
    }
  }
  if (!journal.pending().length && !hasFallback) {
    return { journal, rejected: [], changed: false };
  }
  // Give missing/tombstoned recovery a stable domain error before the atomic
  // verified projection handles the normal append path.
  assertVerifiedRecoverySession(sessionId);
  const mutation = updateBackgroundInteractionJournal(
    sessionId,
    journal,
    (draft) => {
      if (hasFallback) draft.recordPending(fallback);
      return draft.rejectPending({
        code: options.code || "INTERACTION_WORKER_LOST",
        message:
          options.message ||
          "The background worker exited before the interaction settled",
      });
    },
    options,
  );
  journal = mutation.journal;
  return { journal, rejected: mutation.result, changed: true };
}
