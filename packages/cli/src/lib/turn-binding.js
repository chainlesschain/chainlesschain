/**
 * Turn binding table — explicit `turn → checkpoint` binding + restore planning
 * (P1 "显式绑定 Turn、Checkpoint 和恢复").
 *
 * Today the rewind path binds a turn to its file checkpoint IMPLICITLY: a flat
 * `{atMessageCount, id, tool}` marks array plus the heuristic
 * `pickCheckpointForTurn` in [[repl-rewind.js]]. This module upgrades that to
 * the EXPLICIT table the gap analysis calls for — one record per turn:
 *
 *   turnId
 *     -> conversationOffset       (message index to truncate back to)
 *     -> fileCheckpointId         (checkpoint-store cp id; see checkpoint-store.js)
 *     -> toolCallIds[]            (tool_use_ids this turn issued)
 *     -> permissionDecisionIds[]  (approval decisions made this turn)
 *     -> childAgentIds[]          (sub-agents spawned this turn)
 *     -> worktreeId               (isolation worktree, if any)
 *     -> coverage: full | partial | none
 *
 * Everything here is PURE (no timers, no I/O, no git): a caller feeds it events
 * from the agent loop (checkpoint, tool-executing, permission decision,
 * spawn_sub_agent, worktree create) and reads back a table + a restore plan.
 *
 * `coverage` is computed HONESTLY — a turn that ran a shell command, spawned an
 * external process, or saw a user edit can never be `full`, because those
 * effects live outside the file tree a checkpoint captures and cannot be
 * promised back. This is the "不能承诺完全恢复" invariant from the gap doc.
 */

export const TURN_COVERAGE = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  NONE: "none",
});

export const RESTORE_SCOPE = Object.freeze({
  CONVERSATION: "conversation", // conversation only
  FILES: "files", // files only
  BOTH: "both", // conversation and files
});

/**
 * Classify a tool by how restorable its effects are:
 *   - "shell"  external side-effects (shell / run_code / spawn) — irreversible.
 *   - "edit"   in-tree file mutation — reversible via a file checkpoint.
 *   - "other"  read-only / inert.
 * Substring heuristics keep this robust across tool-name spellings.
 */
export function classifyToolKind(name) {
  const n = String(name || "").toLowerCase();
  if (/shell|bash|(^|_)exec|run_code|spawn|process|subprocess/.test(n)) {
    return "shell";
  }
  if (
    /write|edit|patch|replace|create_file|delete_file|apply|mkdir|move_file/.test(
      n,
    )
  ) {
    return "edit";
  }
  return "other";
}

/**
 * Deterministic coverage from a turn's side-effect flags.
 *   side-effects (shell / external process / user edit) → PARTIAL (can't promise)
 *   no file mutation                                     → FULL (nothing to undo)
 *   mutation WITH a checkpoint                           → FULL (fully restorable)
 *   mutation WITHOUT a checkpoint                        → NONE (files unrecoverable)
 */
export function computeCoverage(flags = {}) {
  const sideEffects = Boolean(
    flags.ranShell ||
    flags.spawnedExternalProcess ||
    flags.userEditedDuringTurn,
  );
  if (sideEffects) return TURN_COVERAGE.PARTIAL;
  if (!flags.mutatedFiles) return TURN_COVERAGE.FULL;
  if (flags.hasFileCheckpoint) return TURN_COVERAGE.FULL;
  return TURN_COVERAGE.NONE;
}

function emptyRecord(turnId, conversationOffset) {
  return {
    turnId,
    conversationOffset:
      Number.isFinite(Number(conversationOffset)) && conversationOffset != null
        ? Number(conversationOffset)
        : null,
    fileCheckpointId: null,
    toolCallIds: [],
    permissionDecisionIds: [],
    childAgentIds: [],
    worktreeId: null,
    // side-effect flags → coverage (kept internal; surfaced via `coverage`)
    _flags: {
      ranShell: false,
      spawnedExternalProcess: false,
      userEditedDuringTurn: false,
      mutatedFiles: false,
      hasFileCheckpoint: false,
    },
  };
}

function pushUnique(list, value) {
  const v = value == null ? null : String(value);
  if (v == null || list.includes(v)) return;
  list.push(v);
}

/**
 * The explicit turn-binding table. In-memory + serializable (toJSON/fromJSON)
 * so a caller can persist it alongside the session record — no I/O here.
 */
export class TurnBindingLog {
  constructor() {
    this._turns = new Map();
    this._order = [];
  }

  /** Begin (or re-open) a turn record. Idempotent on turnId. */
  startTurn(turnId, { conversationOffset } = {}) {
    const id = String(turnId);
    if (!this._turns.has(id)) {
      this._turns.set(id, emptyRecord(id, conversationOffset));
      this._order.push(id);
    } else if (conversationOffset != null) {
      const rec = this._turns.get(id);
      if (rec.conversationOffset == null) {
        rec.conversationOffset = Number(conversationOffset);
      }
    }
    return this;
  }

  _rec(turnId) {
    const id = String(turnId);
    if (!this._turns.has(id)) this.startTurn(id);
    return this._turns.get(id);
  }

  /** Record a tool call; `kind` (or the tool `name`) drives coverage. */
  recordToolCall(turnId, toolCallId, { kind, name } = {}) {
    const rec = this._rec(turnId);
    pushUnique(rec.toolCallIds, toolCallId);
    const k = kind || classifyToolKind(name);
    if (k === "shell") rec._flags.ranShell = true;
    else if (k === "external-process") rec._flags.spawnedExternalProcess = true;
    else if (k === "edit") rec._flags.mutatedFiles = true;
    return this;
  }

  recordPermissionDecision(turnId, decisionId) {
    pushUnique(this._rec(turnId).permissionDecisionIds, decisionId);
    return this;
  }

  recordChildAgent(turnId, childAgentId) {
    pushUnique(this._rec(turnId).childAgentIds, childAgentId);
    return this;
  }

  /** Bind (or re-bind to the earliest) file checkpoint for this turn. */
  bindCheckpoint(turnId, checkpointId) {
    const rec = this._rec(turnId);
    if (checkpointId != null) {
      if (rec.fileCheckpointId == null)
        rec.fileCheckpointId = String(checkpointId);
      rec._flags.hasFileCheckpoint = true;
    }
    return this;
  }

  setWorktree(turnId, worktreeId) {
    this._rec(turnId).worktreeId =
      worktreeId == null ? null : String(worktreeId);
    return this;
  }

  /** Flag an out-of-band user edit during this turn → forces PARTIAL coverage. */
  markUserEdit(turnId) {
    this._rec(turnId)._flags.userEditedDuringTurn = true;
    return this;
  }

  /** One turn record with its computed coverage (or null). */
  get(turnId) {
    const rec = this._turns.get(String(turnId));
    return rec ? this._view(rec) : null;
  }

  /** All turns in insertion order, each with computed coverage. */
  list() {
    return this._order.map((id) => this._view(this._turns.get(id)));
  }

  _view(rec) {
    return {
      turnId: rec.turnId,
      conversationOffset: rec.conversationOffset,
      fileCheckpointId: rec.fileCheckpointId,
      toolCallIds: [...rec.toolCallIds],
      permissionDecisionIds: [...rec.permissionDecisionIds],
      childAgentIds: [...rec.childAgentIds],
      worktreeId: rec.worktreeId,
      coverage: computeCoverage(rec._flags),
    };
  }

  toJSON() {
    return {
      turns: this._order.map((id) => {
        const r = this._turns.get(id);
        return { ...r, _flags: { ...r._flags } };
      }),
    };
  }

  static fromJSON(json) {
    const log = new TurnBindingLog();
    for (const r of json?.turns || []) {
      if (!r || r.turnId == null) continue;
      const id = String(r.turnId);
      log._turns.set(id, {
        ...emptyRecord(id, r.conversationOffset),
        fileCheckpointId: r.fileCheckpointId ?? null,
        toolCallIds: Array.isArray(r.toolCallIds) ? [...r.toolCallIds] : [],
        permissionDecisionIds: Array.isArray(r.permissionDecisionIds)
          ? [...r.permissionDecisionIds]
          : [],
        childAgentIds: Array.isArray(r.childAgentIds)
          ? [...r.childAgentIds]
          : [],
        worktreeId: r.worktreeId ?? null,
        _flags: { ...emptyRecord(id)._flags, ...(r._flags || {}) },
      });
      log._order.push(id);
    }
    return log;
  }
}

/**
 * Plan a restore of one turn under a chosen scope, with HONEST warnings — the
 * restore UI ("Conversation only / Files only / Both") consumes this. It never
 * over-promises: a `partial`/`none` coverage turn, or a scope that would leave
 * files and conversation out of sync, surfaces a warning instead of silently
 * doing a lossy restore.
 *
 * @param {object} turn   a record from TurnBindingLog.get()/list()
 * @param {string} scope  one of RESTORE_SCOPE
 * @returns {{scope, coverage, conversation:{truncateTo:number}|null,
 *            files:{rewindTo:string}|null, warnings:string[]}}
 */
export function resolveRestorePlan(turn, scope = RESTORE_SCOPE.BOTH) {
  const warnings = [];
  const s = Object.values(RESTORE_SCOPE).includes(scope)
    ? scope
    : RESTORE_SCOPE.BOTH;
  if (!turn) {
    return {
      scope: s,
      coverage: TURN_COVERAGE.NONE,
      conversation: null,
      files: null,
      warnings: ["unknown turn — nothing to restore"],
    };
  }
  const wantConversation =
    s === RESTORE_SCOPE.CONVERSATION || s === RESTORE_SCOPE.BOTH;
  const wantFiles = s === RESTORE_SCOPE.FILES || s === RESTORE_SCOPE.BOTH;

  let conversation = null;
  if (wantConversation) {
    if (turn.conversationOffset == null) {
      warnings.push(
        "no conversation offset recorded — cannot rewind the conversation",
      );
    } else {
      conversation = { truncateTo: turn.conversationOffset };
    }
  }

  let files = null;
  if (wantFiles) {
    if (!turn.fileCheckpointId) {
      warnings.push(
        "no file checkpoint for this turn — files cannot be restored",
      );
    } else {
      files = { rewindTo: turn.fileCheckpointId };
      if (turn.coverage === TURN_COVERAGE.PARTIAL) {
        warnings.push(
          "irreversible side-effects (shell / external process / user edits) can't be undone — file restore is best-effort",
        );
      }
    }
  }

  // Cross-scope drift: restoring one side but not the other leaves them out of
  // sync when this turn touched files.
  const mutatedFiles =
    turn.coverage !== TURN_COVERAGE.FULL || Boolean(turn.fileCheckpointId);
  if (s === RESTORE_SCOPE.CONVERSATION && turn.fileCheckpointId) {
    warnings.push(
      "conversation-only: files will NOT be reverted — the working tree stays ahead of the conversation",
    );
  } else if (
    s === RESTORE_SCOPE.FILES &&
    turn.conversationOffset != null &&
    mutatedFiles
  ) {
    warnings.push(
      "files-only: the conversation is NOT rewound — it will reference a working tree that no longer matches",
    );
  }

  return { scope: s, coverage: turn.coverage, conversation, files, warnings };
}

/**
 * Select an inclusive turn range for "Summarize from here / up to here". Pure
 * selection over the log's ordered turns; returns the slice plus the
 * conversation offsets that bound it (nulls preserved when a turn lacks one).
 *
 * @returns {{turns:Array, fromOffset:number|null, toOffset:number|null}}
 */
export function selectTurnRange(
  log,
  { fromTurnId = null, toTurnId = null } = {},
) {
  const all =
    log instanceof TurnBindingLog ? log.list() : Array.isArray(log) ? log : [];
  const idxOf = (id) =>
    id == null ? -1 : all.findIndex((t) => t.turnId === String(id));
  let start = fromTurnId == null ? 0 : idxOf(fromTurnId);
  let end = toTurnId == null ? all.length - 1 : idxOf(toTurnId);
  if (start < 0) start = 0;
  if (end < 0) end = all.length - 1;
  if (start > end) [start, end] = [end, start];
  const turns = all.slice(start, end + 1);
  return {
    turns,
    fromOffset: turns.length ? turns[0].conversationOffset : null,
    toOffset: turns.length ? turns[turns.length - 1].conversationOffset : null,
  };
}

/**
 * Bridge: build an explicit TurnBindingLog from the REPL's existing implicit
 * state — `listUserTurns()` output (`{n, index, preview}`, newest-first) and the
 * `{atMessageCount, id, tool}` checkpoint marks. Each mark is attributed to the
 * turn during which it was taken (the turn with the greatest message index still
 * below the mark's `atMessageCount`); the turn's `fileCheckpointId` is its
 * EARLIEST such mark — the pre-mutation snapshot, matching pickCheckpointForTurn.
 *
 * This lets a coverage-aware restore be derived today from what the REPL already
 * tracks, without threading new per-turn events through the agent loop.
 *
 * @param {Array<{n:number,index:number}>} turns
 * @param {Array<{atMessageCount:number,id:string,tool?:string}>} marks
 * @returns {TurnBindingLog}
 */
export function buildTurnBindingFromMarks(turns = [], marks = []) {
  const log = new TurnBindingLog();
  // Ascending by message index so "owning turn" = greatest index below a mark.
  const ordered = [...(turns || [])]
    .filter((t) => t && Number.isFinite(Number(t.index)))
    .sort((a, b) => Number(a.index) - Number(b.index));
  for (const t of ordered) {
    log.startTurn(`turn-${t.index}`, { conversationOffset: Number(t.index) });
  }
  // Group marks by owning turn, then bind earliest-first so bindCheckpoint keeps
  // the pre-mutation snapshot.
  const owned = new Map(); // turnId -> marks[]
  for (const m of marks || []) {
    const c = Number(m?.atMessageCount);
    if (!Number.isFinite(c) || m?.id == null) continue;
    let owner = null;
    for (const t of ordered) {
      if (Number(t.index) < c) owner = t;
      else break;
    }
    if (!owner) continue;
    const key = `turn-${owner.index}`;
    if (!owned.has(key)) owned.set(key, []);
    owned.get(key).push({ ...m, _c: c });
  }
  for (const [turnId, list] of owned) {
    list.sort((a, b) => a._c - b._c);
    for (const m of list) {
      log.recordToolCall(turnId, m.id, { name: m.tool });
      log.bindCheckpoint(turnId, m.id);
    }
  }
  return log;
}
