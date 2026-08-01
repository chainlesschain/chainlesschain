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
  appendEvent as storeAppendEvent,
  readEvents as storeReadEvents,
  findLatestEvent as storeFindLatestEvent,
} from "../harness/jsonl-session-store.js";
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
  appendEvent: storeAppendEvent,
  readEvents: storeReadEvents,
  findLatestEvent: storeFindLatestEvent,
};

function findLatestJournalEvent(sessionId, backgroundAgentId) {
  const valid = (event) => event?.data?.backgroundAgentId === backgroundAgentId;
  if (
    typeof _deps.findLatestEvent === "function" &&
    _deps.findLatestEvent !== storeFindLatestEvent
  ) {
    return _deps.findLatestEvent(
      sessionId,
      BACKGROUND_INTERACTION_JOURNAL_EVENT,
      valid,
    );
  }
  if (_deps.readEvents !== storeReadEvents) {
    const events = _deps.readEvents(sessionId) || [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (
        event?.type === BACKGROUND_INTERACTION_JOURNAL_EVENT &&
        valid(event)
      ) {
        return event;
      }
    }
    return null;
  }
  return storeFindLatestEvent(
    sessionId,
    BACKGROUND_INTERACTION_JOURNAL_EVENT,
    valid,
  );
}

function journalError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
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
    });
    journal.records = snapshot.records.map((record) => ({
      requestId: String(record.requestId || ""),
      binding: normalizeInteractionBinding(record.binding),
      payload: cloneJson(record.payload || {}),
      payloadFingerprint: String(record.payloadFingerprint || ""),
      status: String(record.status || "pending"),
      createdAt: Number(record.createdAt) || 0,
      settledAt: record.settledAt == null ? null : Number(record.settledAt),
      settlement: record.settlement ? cloneJson(record.settlement) : null,
      settlementFingerprint: record.settlementFingerprint
        ? String(record.settlementFingerprint)
        : null,
    }));
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
    if (!id || normalizedBinding.sequence === null) {
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
    _deps.appendEvent(
      sessionId,
      BACKGROUND_INTERACTION_JOURNAL_EVENT,
      journal.toJSON(),
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
    const event = findLatestJournalEvent(sessionId, backgroundAgentId);
    if (event) {
      return BackgroundInteractionJournal.fromJSON(event.data, options);
    }
    return new BackgroundInteractionJournal({
      backgroundAgentId,
      now: options.now,
    });
  } catch (error) {
    if (!failIfUnavailable) {
      return new BackgroundInteractionJournal({
        backgroundAgentId,
        now: options.now,
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
  const draft = BackgroundInteractionJournal.fromJSON(journal.toJSON(), {
    now: options.now || journal._now,
  });
  const result = mutate(draft);
  if (!options.persistIf || options.persistIf(result) !== false) {
    persistBackgroundInteractionJournal(sessionId, draft, options);
  }
  return { journal: draft, result };
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
  let journal = loadBackgroundInteractionJournal(
    sessionId,
    backgroundAgentId,
    options,
  );
  const fallback = options.fallbackRequest;
  const hasFallback =
    fallback?.requestId &&
    normalizeInteractionBinding(fallback.binding).sequence !== null &&
    !journal.get(fallback.requestId);
  if (!journal.pending().length && !hasFallback) {
    return { journal, rejected: [], changed: false };
  }
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
