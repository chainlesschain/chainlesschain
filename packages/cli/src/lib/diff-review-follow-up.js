/**
 * Correlate an IDE Diff "Request changes" decision with the next review of the
 * same file. The tracker writes only bounded review metadata into the existing
 * side-effect ledger; model text and file content are never copied.
 */

const MAX_ID = 256;
const MAX_PATH = 2048;
const MAX_REASON = 256;
const VALID_OUTCOMES = new Set(["accepted", "rejected", "changes-requested"]);

function bounded(value, max) {
  if (value == null) return null;
  const text = String(value).slice(0, max);
  return text || null;
}

function reviewKey(audit) {
  const path = bounded(audit?.path, MAX_PATH);
  if (!path) return null;
  return `${bounded(audit?.sessionId, MAX_ID) || ""}\0${path}`;
}

function pendingFollowUp(audit) {
  return {
    status: "pending",
    requestedAt: bounded(audit?.createdAt, 64),
  };
}

function reviewedFollowUp(audit) {
  const outcome = VALID_OUTCOMES.has(audit?.outcome)
    ? audit.outcome
    : "rejected";
  return {
    status: outcome,
    reviewId: bounded(audit?.reviewId, 64),
    turnId: bounded(audit?.turnId, MAX_ID),
    toolUseId: bounded(audit?.toolUseId, MAX_ID),
    operation: bounded(audit?.operation, 16) || "modify",
    targetPath:
      audit?.operation === "rename"
        ? bounded(audit?.targetPath, MAX_PATH)
        : null,
    written: audit?.written === true,
    completedAt: bounded(audit?.createdAt, 64),
  };
}

function terminalFollowUp(status, { turnId = null, reason = null } = {}) {
  return {
    status,
    turnId: bounded(turnId, MAX_ID),
    reason: bounded(reason, MAX_REASON),
  };
}

/**
 * Ledger-facing tracker. `ledger` only needs `list()` and `annotate()` methods,
 * which keeps the correlation logic independently testable.
 */
export class DiffReviewFollowUpTracker {
  constructor(ledger = null) {
    this._pending = new Map();
    if (ledger) this.hydrate(ledger);
  }

  /** Restore only explicitly-pending v1 records after a process/session resume. */
  hydrate(ledger) {
    this._pending.clear();
    for (const op of ledger?.list?.() || []) {
      const audit = op?.meta?.diffReview;
      if (
        audit?.schema !== "cc-diff-review/v1" ||
        audit?.outcome !== "changes-requested" ||
        audit?.followUp?.status !== "pending"
      ) {
        continue;
      }
      const key = reviewKey(audit);
      if (key) this._pending.set(key, { opId: op.opId, audit });
    }
    return this;
  }

  /**
   * Attach the current audit and, when applicable, resolve the preceding
   * Request Changes record for the same trusted session/path.
   */
  observe(ledger, opId, audit) {
    if (!ledger?.annotate || !opId || audit?.schema !== "cc-diff-review/v1") {
      return [];
    }
    const updates = [];
    const key = reviewKey(audit);
    const prior = key ? this._pending.get(key) : null;
    let currentAudit = audit;
    if (prior && prior.opId !== opId) {
      const followUp = reviewedFollowUp(audit);
      ledger.annotate(prior.opId, {
        diffReview: { ...prior.audit, followUp },
      });
      this._pending.delete(key);
      currentAudit = {
        ...audit,
        followUpOfReviewId: bounded(prior.audit.reviewId, 64),
      };
      updates.push({
        reviewId: prior.audit.reviewId || null,
        followUp,
      });
    }

    if (audit.outcome === "changes-requested" && key) {
      currentAudit = { ...currentAudit, followUp: pendingFollowUp(audit) };
      this._pending.set(key, { opId, audit: currentAudit });
    }
    ledger.annotate(opId, { diffReview: currentAudit });
    return updates;
  }

  /**
   * Settle every still-pending request when the agent run ends without another
   * Diff proposal. Returns updates so callers can decide whether persistence is
   * necessary.
   */
  complete(
    ledger,
    {
      status = "completed-without-reproposal",
      turnId = null,
      reason = null,
    } = {},
  ) {
    if (!ledger?.annotate || this._pending.size === 0) return [];
    const updates = [];
    for (const pending of this._pending.values()) {
      const followUp = terminalFollowUp(status, { turnId, reason });
      ledger.annotate(pending.opId, {
        diffReview: { ...pending.audit, followUp },
      });
      updates.push({
        reviewId: pending.audit.reviewId || null,
        followUp,
      });
    }
    this._pending.clear();
    return updates;
  }

  get pendingCount() {
    return this._pending.size;
  }
}
