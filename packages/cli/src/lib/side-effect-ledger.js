/**
 * Side-effect ledger — crash-safe accounting of irreversible actions so a
 * recovered worker never repeats a side-effect it already issued (P0
 * state-machine slice: CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12
 * §"后台 Agent 状态机" — "副作用台账（prepared→started→committed|failed|unknown）
 * 与崩溃恢复重放").
 *
 * The gap's acceptance is concrete: kill the worker/supervisor mid `file-write`,
 * `git push`, or `package-install`, and after recovery the effect must not be
 * applied twice. The classic bug is a blind retry — the process died AFTER
 * `git push` reached the remote but BEFORE it recorded success, so a naive
 * "resume the turn" pushes again.
 *
 * The fix is a two-phase record around every side-effect:
 *
 *   prepare(opId)  →  start(opId)  →  commit(opId) | fail(opId) | unknown(opId)
 *
 * and an HONEST recovery planner. The invariant: a `started`-but-not-settled op
 * is INDETERMINATE — we cannot know if the effect landed — so unless the op is
 * explicitly idempotent it must be INSPECTED by a human/verifier, never blindly
 * redone. `prepared`-but-never-`started` ops are safe to redo (no effect issued
 * yet); `committed` ops are skipped; cleanly `failed` ops redo only when the
 * caller vouched they roll back atomically.
 *
 * Everything here is PURE (no timers, no I/O): the ledger is in-memory +
 * serializable so a caller persists it alongside the session record. I/O lives
 * in [[side-effect-ledger-store.js]].
 */

/** Lifecycle states of one side-effecting operation. */
export const SIDE_EFFECT_STATE = Object.freeze({
  PREPARED: "prepared", // intent recorded; nothing issued yet
  STARTED: "started", // effect issued; outcome not yet known
  COMMITTED: "committed", // effect confirmed applied
  FAILED: "failed", // effect confirmed NOT applied (clean failure)
  UNKNOWN: "unknown", // outcome indeterminate (e.g. crash mid-flight)
});

/** Recovery actions the reconciler emits for each unsettled op. */
export const RECOVERY_ACTION = Object.freeze({
  SKIP: "skip", // already committed — do nothing
  REDO: "redo", // safe to run again (no effect issued, or idempotent)
  INSPECT: "inspect", // indeterminate — verify before any repeat
});

/**
 * Default idempotency for well-known side-effect kinds. Only actions that are
 * naturally safe to re-run without duplicating an external effect are `true`.
 * `file-write` is idempotent ONLY when a pre-write checkpoint exists (the write
 * can be re-applied from the same source over a restored tree); a raw append
 * has no such guarantee, so the default is conservative `false`.
 */
const KIND_IDEMPOTENT = new Map([
  ["git-push", false],
  ["package-install", false],
  ["network-mutation", false],
  ["payment", false],
  ["file-write", false],
  ["file-write-checkpointed", true],
  ["read", true],
  ["compute", true],
]);

/** Whether a kind is idempotent by default (unknown kinds → conservative false). */
export function kindIsIdempotent(kind) {
  return KIND_IDEMPOTENT.get(String(kind || "")) === true;
}

/** Trim a free-text descriptor to a short, log-safe key. */
function shortKey(v) {
  if (v == null) return null;
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

/**
 * Classify one agent tool call into a side-effect kind for the ledger, or null
 * when the tool issues no irreversible external effect (reads, searches, plain
 * git status, etc.). PURE. Conservative by design — an opaque shell command is
 * NON-idempotent so a mid-flight crash forces INSPECT rather than a blind
 * replay (the P0-2 "started_unknown 风险操作默认 needs_input" invariant).
 *
 * Only the tools that can leave a durable external mark are recorded; read-only
 * and purely-local-recoverable tools return null so a resumed session is not
 * spammed with false "verify before replay" warnings.
 *
 * @param {string} toolName
 * @param {object} [args]
 * @returns {{kind:string, key:string|null}|null}
 */
export function classifyToolSideEffect(toolName, args = {}) {
  const name = String(toolName || "");
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "write_file":
    case "notebook_edit":
    case "edit_file":
      return {
        kind: "file-write",
        key: shortKey(a.path || a.file || a.notebook_path),
      };
    case "edit_file_hashed":
      // Hash-guarded: re-applying over an already-changed tree fails safely, so
      // a replay cannot silently double-apply — idempotent-by-construction.
      return {
        kind: "file-write-checkpointed",
        key: shortKey(a.path || a.file),
      };
    case "run_shell":
    case "run_code":
      // Opaque command: could be `npm publish`, `rm -rf`, or just `npm test`.
      // We cannot tell, so fail-closed to a non-idempotent effect.
      return { kind: "shell", key: shortKey(a.command || a.code) };
    case "git": {
      const cmd = String(a.command || "").trim();
      const verb = cmd.split(/\s+/)[0] || "";
      if (verb === "push") return { kind: "git-push", key: shortKey(cmd) };
      // Every other git op (status/diff/commit/branch/fetch/pull/…) is either
      // read-only or locally recoverable via git — not an irreversible effect.
      return null;
    }
    case "publish_artifact":
      return {
        kind: "network-mutation",
        key: shortKey(a.title || a.path || a.name),
      };
    case "schedule":
      return {
        kind: "network-mutation",
        key: shortKey(a.name || a.cron || a.when),
      };
    case "notify":
      return { kind: "network-mutation", key: shortKey(a.title || a.message) };
    case "browser_act":
      // A CDP action (click/type/submit) can mutate remote state.
      return {
        kind: "network-mutation",
        key: shortKey(a.action || a.selector),
      };
    default:
      return null;
  }
}

function nowFrom(clock) {
  return typeof clock === "function" ? Number(clock()) || 0 : 0;
}

/**
 * The in-memory, serializable ledger. A caller records the two-phase lifecycle
 * around each side-effect and, after a crash, hands the rebuilt ledger to
 * `reconcileSideEffects` for a recovery plan.
 *
 * Timestamps are optional and only stamped when a `clock` is injected — keeping
 * the ledger deterministic in tests (no `Date.now()`).
 */
export class SideEffectLedger {
  constructor({ clock } = {}) {
    this._ops = new Map();
    this._order = [];
    this._clock = clock || null;
  }

  _rec(opId) {
    return this._ops.get(String(opId)) || null;
  }

  /**
   * Record intent to perform a side-effect. Idempotent on opId (re-preparing an
   * existing op is a no-op, so a retry loop can't reset a committed op).
   *
   * @param {string} opId  stable id (survives restart — e.g. `${turnId}:${seq}`)
   * @param {{kind?:string, key?:string, idempotent?:boolean, meta?:object}} [info]
   */
  prepare(opId, info = {}) {
    const id = String(opId);
    if (this._ops.has(id)) return this;
    const kind = info.kind == null ? null : String(info.kind);
    this._ops.set(id, {
      opId: id,
      kind,
      key: info.key == null ? null : String(info.key),
      idempotent:
        typeof info.idempotent === "boolean"
          ? info.idempotent
          : kindIsIdempotent(kind),
      state: SIDE_EFFECT_STATE.PREPARED,
      reason: null,
      meta: info.meta && typeof info.meta === "object" ? { ...info.meta } : {},
      preparedAt: nowFrom(this._clock),
      settledAt: null,
    });
    this._order.push(id);
    return this;
  }

  /** Mark the effect as ISSUED (outcome not yet known). Only from `prepared`. */
  start(opId) {
    return this._advance(opId, SIDE_EFFECT_STATE.STARTED, [
      SIDE_EFFECT_STATE.PREPARED,
    ]);
  }

  /** Confirm the effect applied. Only from `started`. */
  commit(opId) {
    return this._advance(
      opId,
      SIDE_EFFECT_STATE.COMMITTED,
      [SIDE_EFFECT_STATE.STARTED],
      { settle: true },
    );
  }

  /** Confirm the effect did NOT apply (clean failure). Only from `started`. */
  fail(opId, reason) {
    return this._advance(
      opId,
      SIDE_EFFECT_STATE.FAILED,
      [SIDE_EFFECT_STATE.STARTED],
      { settle: true, reason },
    );
  }

  /**
   * Explicitly mark an op's outcome indeterminate. Accepts `prepared`/`started`
   * (a recovery pass sweeping unsettled ops), never overrides a settled op.
   */
  unknown(opId, reason) {
    return this._advance(
      opId,
      SIDE_EFFECT_STATE.UNKNOWN,
      [SIDE_EFFECT_STATE.PREPARED, SIDE_EFFECT_STATE.STARTED],
      { settle: true, reason },
    );
  }

  _advance(opId, next, allowedFrom, { settle = false, reason } = {}) {
    const rec = this._rec(opId);
    if (!rec) return this;
    if (!allowedFrom.includes(rec.state)) return this; // illegal transition → ignore
    rec.state = next;
    if (reason != null) rec.reason = String(reason);
    if (settle) rec.settledAt = nowFrom(this._clock);
    return this;
  }

  get(opId) {
    const rec = this._rec(opId);
    return rec ? { ...rec, meta: { ...rec.meta } } : null;
  }

  list() {
    return this._order.map((id) => this.get(id));
  }

  /** Ops that never reached a terminal state — the recovery surface. */
  unsettled() {
    return this.list().filter(
      (o) =>
        o.state === SIDE_EFFECT_STATE.PREPARED ||
        o.state === SIDE_EFFECT_STATE.STARTED,
    );
  }

  toJSON() {
    return { ops: this._order.map((id) => this.get(id)) };
  }

  static fromJSON(json, { clock } = {}) {
    const ledger = new SideEffectLedger({ clock });
    for (const o of json?.ops || []) {
      if (!o || o.opId == null) continue;
      const id = String(o.opId);
      if (ledger._ops.has(id)) continue;
      ledger._ops.set(id, {
        opId: id,
        kind: o.kind == null ? null : String(o.kind),
        key: o.key == null ? null : String(o.key),
        idempotent: o.idempotent === true,
        state: Object.values(SIDE_EFFECT_STATE).includes(o.state)
          ? o.state
          : SIDE_EFFECT_STATE.UNKNOWN,
        reason: o.reason == null ? null : String(o.reason),
        meta: o.meta && typeof o.meta === "object" ? { ...o.meta } : {},
        preparedAt: Number(o.preparedAt) || 0,
        settledAt: o.settledAt == null ? null : Number(o.settledAt) || 0,
      });
      ledger._order.push(id);
    }
    return ledger;
  }
}

/**
 * Plan recovery for one op record (from SideEffectLedger.get()/list()). HONEST:
 * an indeterminate `started` op is INSPECT unless it is explicitly idempotent.
 *
 * @param {object} op
 * @returns {{opId:string, action:string, reason:string}}
 */
export function planOpRecovery(op) {
  const opId = op?.opId ?? null;
  switch (op?.state) {
    case SIDE_EFFECT_STATE.COMMITTED:
      return {
        opId,
        action: RECOVERY_ACTION.SKIP,
        reason: "already committed",
      };
    case SIDE_EFFECT_STATE.PREPARED:
      // Intent only — no external effect was issued, so a clean re-run is safe.
      return {
        opId,
        action: RECOVERY_ACTION.REDO,
        reason: "prepared but never started — no effect issued",
      };
    case SIDE_EFFECT_STATE.FAILED:
      // A clean failure means the effect did not land; idempotent ops re-run.
      return op.idempotent
        ? {
            opId,
            action: RECOVERY_ACTION.REDO,
            reason: "failed cleanly and idempotent — safe to retry",
          }
        : {
            opId,
            action: RECOVERY_ACTION.INSPECT,
            reason: "failed — verify no partial effect before retrying",
          };
    case SIDE_EFFECT_STATE.STARTED:
    case SIDE_EFFECT_STATE.UNKNOWN:
    default:
      // Crashed mid-flight: the effect MAY have landed. Only idempotent ops are
      // safe to redo; everything else must be inspected, never blindly repeated.
      return op?.idempotent
        ? {
            opId,
            action: RECOVERY_ACTION.REDO,
            reason: "indeterminate but idempotent — safe to re-run",
          }
        : {
            opId,
            action: RECOVERY_ACTION.INSPECT,
            reason:
              "started but not confirmed — effect may have applied; do not repeat blindly",
          };
  }
}

/**
 * Build a recovery plan for every op in a (crash-rebuilt) ledger.
 *
 * @param {SideEffectLedger|{ops:Array}} ledger
 * @returns {{plans:Array, redo:string[], inspect:string[], skip:string[]}}
 */
export function reconcileSideEffects(ledger) {
  const ops =
    ledger instanceof SideEffectLedger
      ? ledger.list()
      : Array.isArray(ledger?.ops)
        ? ledger.ops
        : [];
  const plans = ops.map((o) => planOpRecovery(o));
  const bucket = (action) =>
    plans.filter((p) => p.action === action).map((p) => p.opId);
  return {
    plans,
    redo: bucket(RECOVERY_ACTION.REDO),
    inspect: bucket(RECOVERY_ACTION.INSPECT),
    skip: bucket(RECOVERY_ACTION.SKIP),
  };
}
