/**
 * Crash-safe, backward-compatible state journal for IDE/WebSocket sessions.
 *
 * The journal is stored inside the existing session metadata row, so messages
 * and recovery state are committed by the same database UPDATE. A compact
 * checkpoint plus a bounded, revision-ordered event tail makes hydration
 * deterministic without changing any existing WebSocket frame.
 *
 * Plan data is deliberately opaque here. This module only preserves an
 * optional `planSnapshot` field for callers that own Plan persistence.
 */

export const WS_SESSION_STATE_SCHEMA = "chainlesschain.ws-session-state";
export const WS_SESSION_STATE_VERSION = 1;
export const DEFAULT_WS_SESSION_STATE_MAX_EVENTS = 64;

const RUN_STATUSES = new Set(["idle", "running", "interrupted"]);
const APPROVAL_STATUSES = new Set(["pending", "interrupted"]);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function nonNegativeRevision(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function timestamp(value, fallback = null) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeTodoSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const revision = nonNegativeRevision(value.revision, -1);
  if (revision < 0) return null;

  return {
    ...(typeof value.schema === "string" ? { schema: value.schema } : {}),
    ...(Number.isSafeInteger(value.version) && value.version >= 0
      ? { version: value.version }
      : {}),
    ...(typeof value.sessionId === "string" || value.sessionId === null
      ? { sessionId: value.sessionId }
      : {}),
    revision,
    todos: Array.isArray(value.todos) ? cloneJson(value.todos, []) : [],
  };
}

function normalizePendingApproval(value) {
  if (!value || typeof value !== "object") return null;
  const requestId =
    typeof value.requestId === "string" && value.requestId.length > 0
      ? value.requestId
      : null;
  if (!requestId) return null;

  const status = APPROVAL_STATUSES.has(value.status) ? value.status : "pending";
  return {
    requestId,
    status,
    binding:
      typeof value.binding === "string" && value.binding.length > 0
        ? value.binding
        : null,
    tool:
      typeof value.tool === "string" && value.tool.length > 0
        ? value.tool
        : null,
    risk:
      typeof value.risk === "string" && value.risk.length > 0
        ? value.risk
        : null,
    rule:
      typeof value.rule === "string" && value.rule.length > 0
        ? value.rule
        : null,
    requestedAt: timestamp(value.requestedAt),
    interruptedAt: timestamp(value.interruptedAt),
    reason:
      typeof value.reason === "string" && value.reason.length > 0
        ? value.reason
        : null,
  };
}

function normalizeRun(value) {
  const source = value && typeof value === "object" ? value : {};
  const status = RUN_STATUSES.has(source.status) ? source.status : "idle";
  return {
    status,
    requestId:
      typeof source.requestId === "string" && source.requestId.length > 0
        ? source.requestId
        : null,
    startedAt: timestamp(source.startedAt),
    settledAt: timestamp(source.settledAt),
    interruptedAt: timestamp(source.interruptedAt),
    reason:
      typeof source.reason === "string" && source.reason.length > 0
        ? source.reason
        : null,
  };
}

function normalizeSnapshot(value = {}, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const snapshot = {
    revision: nonNegativeRevision(source.revision),
    todo: normalizeTodoSnapshot(source.todo),
    pendingApproval: normalizePendingApproval(source.pendingApproval),
    run: normalizeRun(source.run),
  };

  if (own(source, "planSnapshot")) {
    snapshot.planSnapshot = cloneJson(source.planSnapshot);
  } else if (own(options, "planSnapshot")) {
    // Migration seam for metadata written before the journal existed. The
    // value remains opaque; Plan persistence/hydration belongs elsewhere.
    snapshot.planSnapshot = cloneJson(options.planSnapshot);
  }

  return snapshot;
}

function matchingRequest(currentRequestId, eventRequestId) {
  return (
    !eventRequestId || !currentRequestId || currentRequestId === eventRequestId
  );
}

function applyEvent(snapshot, event) {
  const next = normalizeSnapshot(snapshot);
  const payload =
    event.payload && typeof event.payload === "object" ? event.payload : {};

  switch (event.type) {
    case "todo.snapshot": {
      const todo = normalizeTodoSnapshot(payload.todo || payload);
      if (!next.todo || (todo && todo.revision >= next.todo.revision)) {
        next.todo = todo;
      }
      break;
    }

    case "approval.requested":
      next.pendingApproval = normalizePendingApproval({
        ...payload,
        status: "pending",
        requestedAt: payload.requestedAt || event.at,
      });
      break;

    case "approval.settled":
      if (
        next.pendingApproval &&
        matchingRequest(next.pendingApproval.requestId, payload.requestId)
      ) {
        next.pendingApproval = null;
      }
      break;

    case "approval.interrupted":
      if (
        next.pendingApproval &&
        matchingRequest(next.pendingApproval.requestId, payload.requestId)
      ) {
        next.pendingApproval = normalizePendingApproval({
          ...next.pendingApproval,
          status: "interrupted",
          interruptedAt: payload.interruptedAt || event.at,
          reason: payload.reason || "session_recovered",
        });
      }
      break;

    case "run.started":
      next.run = normalizeRun({
        status: "running",
        requestId: payload.requestId || null,
        startedAt: payload.startedAt || event.at,
      });
      break;

    case "run.settled":
      // A late completion from an explicitly interrupted turn must not erase
      // the interruption marker. The next run.started event supersedes it.
      if (
        next.run.status === "running" &&
        matchingRequest(next.run.requestId, payload.requestId)
      ) {
        next.run = normalizeRun({
          status: "idle",
          settledAt: payload.settledAt || event.at,
        });
      }
      break;

    case "run.interrupted":
      if (matchingRequest(next.run.requestId, payload.requestId)) {
        next.run = normalizeRun({
          ...next.run,
          status: "interrupted",
          requestId: payload.requestId || next.run.requestId,
          interruptedAt: payload.interruptedAt || event.at,
          reason: payload.reason || "interrupted",
        });
      }
      break;

    case "plan.snapshot":
      if (own(payload, "planSnapshot")) {
        next.planSnapshot = cloneJson(payload.planSnapshot);
      }
      break;

    default:
      // Unknown additive events consume their revision but cannot widen state.
      break;
  }

  next.revision = event.revision;
  return next;
}

function normalizeEvent(value, expectedRevision) {
  if (!value || typeof value !== "object") return null;
  if (value.revision !== expectedRevision) return null;
  if (typeof value.type !== "string" || value.type.length === 0) return null;
  return {
    revision: expectedRevision,
    type: value.type,
    at: timestamp(value.at),
    payload: cloneJson(value.payload, {}),
  };
}

/** Hydrate a journal and replay only its contiguous event prefix. */
export function hydrateWsSessionState(value, options = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  const schemaSupported =
    (!own(candidate, "schema") ||
      candidate.schema === WS_SESSION_STATE_SCHEMA) &&
    (!own(candidate, "version") ||
      candidate.version === WS_SESSION_STATE_VERSION);
  const source = schemaSupported ? candidate : {};
  const maxEvents =
    Number.isSafeInteger(options.maxEvents) && options.maxEvents > 0
      ? options.maxEvents
      : DEFAULT_WS_SESSION_STATE_MAX_EVENTS;
  const checkpointSource =
    source.snapshot && typeof source.snapshot === "object"
      ? source.snapshot
      : source.checkpoint && typeof source.checkpoint === "object"
        ? source.checkpoint
        : {};
  const checkpoint = normalizeSnapshot(checkpointSource, options);
  let current = normalizeSnapshot(checkpoint);
  const events = [];
  const persistedEvents = Array.isArray(source.events)
    ? source.events.slice(0, maxEvents)
    : [];

  for (const rawEvent of persistedEvents) {
    const event = normalizeEvent(rawEvent, current.revision + 1);
    // A revision gap/corrupt event terminates replay. Applying a later event
    // could skip an interrupt/deny transition and accidentally widen state.
    if (!event) break;
    current = applyEvent(current, event);
    events.push(event);
  }

  const journal = {
    schema: WS_SESSION_STATE_SCHEMA,
    version: WS_SESSION_STATE_VERSION,
    snapshot: checkpoint,
    events,
    current,
    maxEvents,
  };

  compactJournal(journal);
  return journal;
}

export function createWsSessionState(options = {}) {
  const hasPlanSnapshot = own(options, "planSnapshot");
  return hydrateWsSessionState(
    {
      schema: WS_SESSION_STATE_SCHEMA,
      version: WS_SESSION_STATE_VERSION,
      snapshot: {
        revision: 0,
        todo: normalizeTodoSnapshot(options.todo),
        pendingApproval: null,
        run: normalizeRun(),
        ...(hasPlanSnapshot
          ? { planSnapshot: cloneJson(options.planSnapshot) }
          : {}),
      },
      events: [],
    },
    options,
  );
}

function compactJournal(journal) {
  while (journal.events.length > journal.maxEvents) {
    const event = journal.events.shift();
    journal.snapshot = applyEvent(journal.snapshot, event);
  }
}

/** Append and apply one monotonic state event. Mutates the in-memory journal. */
export function appendWsSessionStateEvent(
  journal,
  type,
  payload = {},
  options = {},
) {
  if (!journal || typeof journal !== "object") return null;
  const event = {
    revision: journal.current.revision + 1,
    type: String(type || "unknown"),
    at: timestamp(options.at, new Date().toISOString()),
    payload: cloneJson(payload, {}),
  };
  journal.current = applyEvent(journal.current, event);
  journal.events.push(event);
  compactJournal(journal);
  return cloneJson(event);
}

/** Update the journal from the separately persisted TODO snapshot. */
export function syncWsSessionTodo(journal, todoSnapshot, options = {}) {
  const todo = normalizeTodoSnapshot(todoSnapshot);
  if (!journal || !todo) return false;
  const current = journal.current?.todo || null;
  if (current && current.revision >= todo.revision) return false;
  appendWsSessionStateEvent(journal, "todo.snapshot", { todo }, options);
  return true;
}

/**
 * Convert state that depended on the dead process into an explicit,
 * fail-closed interruption marker. Pending approvals are retained for UI
 * explanation but can no longer be resolved by a stale session-answer.
 */
export function recoverWsSessionState(journal, options = {}) {
  if (!journal || typeof journal !== "object") {
    return {
      changed: false,
      runInterrupted: false,
      approvalInterrupted: false,
    };
  }
  const at = timestamp(options.at, new Date().toISOString());
  const reason = options.reason || "process_restart";
  let runInterrupted = false;
  let approvalInterrupted = false;

  if (journal.current.run?.status === "running") {
    appendWsSessionStateEvent(
      journal,
      "run.interrupted",
      {
        requestId: journal.current.run.requestId,
        interruptedAt: at,
        reason,
      },
      { at },
    );
    runInterrupted = true;
  }

  if (journal.current.pendingApproval?.status === "pending") {
    appendWsSessionStateEvent(
      journal,
      "approval.interrupted",
      {
        requestId: journal.current.pendingApproval.requestId,
        interruptedAt: at,
        reason,
      },
      { at },
    );
    approvalInterrupted = true;
  }

  return {
    changed: runInterrupted || approvalInterrupted,
    runInterrupted,
    approvalInterrupted,
  };
}

/** Current replayed state for IDE consumers (detached JSON-safe copy). */
export function getWsSessionStateSnapshot(journal) {
  if (!journal || typeof journal !== "object") {
    return {
      schema: WS_SESSION_STATE_SCHEMA,
      version: WS_SESSION_STATE_VERSION,
      ...normalizeSnapshot(),
    };
  }
  return {
    schema: WS_SESSION_STATE_SCHEMA,
    version: WS_SESSION_STATE_VERSION,
    ...cloneJson(journal.current, normalizeSnapshot()),
  };
}

/** Persistable journal shape; internal `current` and limits stay in memory. */
export function serializeWsSessionState(journal) {
  const safe = journal || createWsSessionState();
  return {
    schema: WS_SESSION_STATE_SCHEMA,
    version: WS_SESSION_STATE_VERSION,
    snapshot: cloneJson(safe.snapshot, normalizeSnapshot()),
    events: cloneJson(safe.events, []),
  };
}
