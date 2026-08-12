import { randomUUID } from "node:crypto";
import {
  OCCURRENCE_STATUS,
  SchedulerKernelError,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
} from "./contract.js";

export const DEFAULT_RUNTIME_LEASE_MS = 60_000;
export const MIN_RUNTIME_LEASE_MS = 1_000;
export const DEFAULT_RUN_LIMIT = 100;
export const MAX_RUN_LIMIT = 10_000;

const TERMINAL_OCCURRENCE_STATUSES = new Set([
  OCCURRENCE_STATUS.SUCCEEDED,
  OCCURRENCE_STATUS.DEAD_LETTER,
]);

function runtimeError(code, message, details = undefined, cause = undefined) {
  return new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
}

function assertStore(store) {
  const required = [
    "claimNext",
    "claimOccurrence",
    "getJob",
    "getOccurrence",
    "renew",
    "settle",
  ];
  if (
    !store ||
    required.some((method) => typeof store[method] !== "function")
  ) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_STORE",
      "Scheduler runtime requires a compatible scheduler store",
    );
  }
  return store;
}

function normalizeLeaseMs(value = DEFAULT_RUNTIME_LEASE_MS) {
  if (!Number.isSafeInteger(value) || value < MIN_RUNTIME_LEASE_MS) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_LEASE",
      `leaseMs must be an integer >= ${MIN_RUNTIME_LEASE_MS}`,
    );
  }
  return value;
}

function normalizeRenewInterval(value, leaseMs) {
  const interval =
    value === undefined ? Math.max(250, Math.floor(leaseMs / 3)) : value;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval >= leaseMs) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_RENEW_INTERVAL",
      "renewIntervalMs must be a positive integer smaller than leaseMs",
    );
  }
  return interval;
}

function normalizeRunLimit(value = DEFAULT_RUN_LIMIT) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RUN_LIMIT) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_LIMIT",
      `limit must be an integer between 1 and ${MAX_RUN_LIMIT}`,
    );
  }
  return value;
}

function normalizeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_ADAPTER",
      "Scheduler adapter must be an object",
    );
  }
  const kind = normalizeIdentifier(adapter.kind, "adapter.kind", {
    maxLength: 128,
  });
  if (typeof adapter.execute !== "function") {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_ADAPTER",
      `Scheduler adapter must implement execute(): ${kind}`,
    );
  }
  return { kind, adapter };
}

function normalizeAdapters(adapters = []) {
  const map = new Map();
  const values = adapters instanceof Map ? adapters.values() : adapters;
  if (!values || typeof values[Symbol.iterator] !== "function") {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_ADAPTER",
      "adapters must be iterable",
    );
  }
  for (const value of values) {
    const { kind, adapter } = normalizeAdapter(value);
    if (map.has(kind)) {
      throw runtimeError(
        "SCHEDULER_RUNTIME_DUPLICATE_ADAPTER",
        `Scheduler adapter is registered more than once: ${kind}`,
      );
    }
    map.set(kind, adapter);
  }
  return map;
}

function safeError(error, fallbackCode = "execution_failed") {
  const code =
    typeof error?.code === "string" && error.code.trim()
      ? error.code.trim().slice(0, 128)
      : fallbackCode;
  const message =
    typeof error?.message === "string" && error.message
      ? error.message.slice(0, 2_000)
      : String(error ?? "Execution failed").slice(0, 2_000);
  let details;
  try {
    if (error?.details !== undefined) {
      details = normalizeJson(error.details, "runtime.error.details");
    }
  } catch {
    details = { omitted: "invalid_error_details" };
  }
  const base = {
    code,
    message,
    ...(typeof error?.name === "string"
      ? { name: error.name.slice(0, 128) }
      : {}),
  };
  try {
    return normalizeJson(
      { ...base, ...(details === undefined ? {} : { details }) },
      "runtime.error",
    );
  } catch {
    return normalizeJson(
      { ...base, details: { omitted: "error_details_too_large" } },
      "runtime.error",
    );
  }
}

function executionPolicy(error, adapter, context) {
  let policy = null;
  if (typeof adapter?.classifyError === "function") {
    policy = adapter.classifyError(error, context);
  }
  if (policy !== null && policy !== undefined) {
    if (typeof policy !== "object" || Array.isArray(policy)) {
      throw runtimeError(
        "SCHEDULER_RUNTIME_INVALID_ERROR_POLICY",
        "adapter.classifyError() must return an object",
      );
    }
    return {
      retryable: policy.retryable !== false,
      ...(policy.retryAt === undefined
        ? {}
        : { retryAt: normalizeEpochMs(policy.retryAt, "retryAt") }),
    };
  }
  return {
    retryable: error?.retryable !== false,
    ...(error?.retryAt === undefined
      ? {}
      : { retryAt: normalizeEpochMs(error.retryAt, "retryAt") }),
  };
}

function createLinkedAbortController(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  return {
    controller,
    dispose() {
      signal?.removeEventListener?.("abort", abort);
    },
  };
}

function settledResult(occurrence, extra = {}) {
  return {
    status: occurrence.status,
    occurrence,
    result: occurrence.result,
    error: occurrence.lastError,
    ...extra,
  };
}

/**
 * Host-owned execution service for scheduler occurrences.
 *
 * The runtime is deliberately stricter than the SQLite store: it resolves the
 * exact job revision, requires an explicit authorization decision, selects a
 * registered adapter, renews the durable lease while the adapter is running,
 * and settles only under the same owner/fence token. Adapters receive the
 * occurrence snapshots, never mutable host-side schedule definitions by
 * implication.
 */
export class SchedulerRuntime {
  constructor({
    store,
    adapters = [],
    authorize,
    ownerId = `scheduler-runtime:${process.pid}:${randomUUID()}`,
    leaseMs = DEFAULT_RUNTIME_LEASE_MS,
    renewIntervalMs,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}) {
    this.store = assertStore(store);
    this.adapters = normalizeAdapters(adapters);
    if (typeof authorize !== "function") {
      throw runtimeError(
        "SCHEDULER_RUNTIME_AUTHORIZER_REQUIRED",
        "Scheduler runtime requires an explicit authorize() callback",
      );
    }
    this.authorize = authorize;
    this.ownerId = normalizeIdentifier(ownerId, "ownerId");
    this.leaseMs = normalizeLeaseMs(leaseMs);
    this.renewIntervalMs = normalizeRenewInterval(
      renewIntervalMs,
      this.leaseMs,
    );
    if (
      typeof setIntervalFn !== "function" ||
      typeof clearIntervalFn !== "function"
    ) {
      throw runtimeError(
        "SCHEDULER_RUNTIME_INVALID_TIMER",
        "Scheduler runtime requires timer functions",
      );
    }
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
  }

  registerAdapter(adapter) {
    const normalized = normalizeAdapter(adapter);
    if (this.adapters.has(normalized.kind)) {
      throw runtimeError(
        "SCHEDULER_RUNTIME_DUPLICATE_ADAPTER",
        `Scheduler adapter is registered more than once: ${normalized.kind}`,
      );
    }
    this.adapters.set(normalized.kind, normalized.adapter);
    return this;
  }

  async _settleRejected(occurrence, error, retryable = false) {
    const settled = this.store.settle({
      occurrenceId: occurrence.id,
      ownerId: this.ownerId,
      fence: occurrence.fence,
      outcome: "failed",
      error: safeError(error, "scheduler_rejected"),
      retryable,
    });
    return settledResult(settled);
  }

  async _executeClaim(occurrence, { signal } = {}) {
    const job = this.store.getJob(occurrence.jobId);
    if (!job) {
      return this._settleRejected(
        occurrence,
        runtimeError(
          "SCHEDULER_RUNTIME_JOB_MISSING",
          `Scheduler job disappeared before execution: ${occurrence.jobId}`,
        ),
      );
    }
    if (job.revision !== occurrence.jobRevision) {
      return this._settleRejected(
        occurrence,
        runtimeError(
          "SCHEDULER_RUNTIME_STALE_REVISION",
          `Occurrence references stale job revision: ${occurrence.id}`,
          {
            occurrenceRevision: occurrence.jobRevision,
            currentRevision: job.revision,
          },
        ),
      );
    }
    const adapter = this.adapters.get(job.kind);
    if (!adapter) {
      return this._settleRejected(
        occurrence,
        runtimeError(
          "SCHEDULER_RUNTIME_ADAPTER_MISSING",
          `No scheduler adapter is registered for job kind: ${job.kind}`,
        ),
      );
    }

    let decision;
    let allowed = false;
    let deniedReason = "not_allowed";
    try {
      decision = await this.authorize({ job, occurrence, signal });
      allowed =
        decision !== null &&
        typeof decision === "object" &&
        decision.allowed === true;
      if (typeof decision?.reason === "string") {
        deniedReason = decision.reason.slice(0, 256);
      }
    } catch (error) {
      const authError = runtimeError(
        "SCHEDULER_RUNTIME_AUTHORIZATION_UNAVAILABLE",
        "Scheduler authorization could not be completed",
        undefined,
        error,
      );
      authError.retryable = true;
      return this._settleRejected(occurrence, authError, true);
    }
    if (!allowed) {
      return this._settleRejected(
        occurrence,
        runtimeError(
          "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED",
          "Scheduler occurrence was denied by the authority resolver",
          { reason: deniedReason },
        ),
      );
    }

    // Authorization may involve remote policy evaluation. Revalidate ownership
    // immediately before any adapter side effect so an expired/reclaimed claim
    // cannot execute under a stale fence.
    occurrence = this.store.renew({
      occurrenceId: occurrence.id,
      ownerId: this.ownerId,
      fence: occurrence.fence,
      leaseMs: this.leaseMs,
    });

    const linked = createLinkedAbortController(signal);
    if (linked.controller.signal.aborted) {
      linked.dispose();
      const aborted = runtimeError(
        "SCHEDULER_RUNTIME_ABORTED",
        "Scheduler occurrence was aborted before adapter execution",
      );
      aborted.retryable = true;
      return this._settleRejected(occurrence, aborted, true);
    }
    let leaseError = null;
    let renewing = false;
    const renew = () => {
      if (renewing || leaseError || linked.controller.signal.aborted) return;
      renewing = true;
      try {
        this.store.renew({
          occurrenceId: occurrence.id,
          ownerId: this.ownerId,
          fence: occurrence.fence,
          leaseMs: this.leaseMs,
        });
      } catch (error) {
        leaseError = error;
        linked.controller.abort(error);
      } finally {
        renewing = false;
      }
    };
    let timer;
    try {
      timer = this.setIntervalFn(renew, this.renewIntervalMs);
    } catch (error) {
      linked.dispose();
      return this._settleRejected(
        occurrence,
        runtimeError(
          "SCHEDULER_RUNTIME_TIMER_FAILED",
          "Scheduler lease-renewal timer could not be started",
          undefined,
          error,
        ),
        true,
      );
    }
    timer?.unref?.();
    const context = {
      job,
      occurrence,
      authority: occurrence.authority,
      decision,
      adjudication:
        typeof this.store.getOccurrenceAdjudication === "function"
          ? this.store.getOccurrenceAdjudication(occurrence.id)
          : null,
      signal: linked.controller.signal,
      renewLease: renew,
    };
    try {
      let result;
      if (context.adjudication?.status === "pending") {
        const allowedAttempts =
          context.adjudication.decision === "confirmed_applied"
            ? [
                context.adjudication.expectedAttempt + 1,
                context.adjudication.expectedAttempt + 2,
              ]
            : [context.adjudication.expectedAttempt + 1];
        if (
          !allowedAttempts.includes(occurrence.attempt) ||
          context.adjudication.expectedFence >= occurrence.fence
        ) {
          throw runtimeError(
            "SCHEDULER_RUNTIME_ADJUDICATION_BINDING_MISMATCH",
            `Scheduler adjudication is not bound to this claim: ${occurrence.id}`,
          );
        }
        if (typeof adapter.adjudicate !== "function") {
          throw runtimeError(
            "SCHEDULER_RUNTIME_ADJUDICATION_UNSUPPORTED",
            `Scheduler adapter cannot apply an outcome-unknown adjudication: ${job.kind}`,
          );
        }
        const resolution = await adapter.adjudicate(context);
        if (
          context.adjudication.decision === "confirmed_applied" &&
          resolution?.settled !== true
        ) {
          throw runtimeError(
            "SCHEDULER_RUNTIME_ADJUDICATION_INVALID",
            "confirmed_applied adjudication must settle without replay",
          );
        }
        if (
          context.adjudication.decision === "confirmed_not_applied" &&
          resolution?.continue !== true
        ) {
          throw runtimeError(
            "SCHEDULER_RUNTIME_ADJUDICATION_INVALID",
            "confirmed_not_applied adjudication must explicitly authorize one execution",
          );
        }
        result =
          resolution?.settled === true
            ? (resolution.result ?? {
                adjudicationRequestId: context.adjudication.requestId,
                decision: context.adjudication.decision,
              })
            : await adapter.execute(context);
      } else {
        result = await adapter.execute(context);
      }
      if (leaseError) throw leaseError;
      if (linked.controller.signal.aborted) {
        const aborted = runtimeError(
          "SCHEDULER_RUNTIME_ABORTED",
          "Scheduler occurrence was aborted before settlement",
        );
        aborted.retryable = true;
        throw aborted;
      }
      const settled = this.store.settle({
        occurrenceId: occurrence.id,
        ownerId: this.ownerId,
        fence: occurrence.fence,
        outcome: "succeeded",
        result: result ?? null,
        ...(context.adjudication?.status === "pending"
          ? { adjudicationRequestId: context.adjudication.requestId }
          : {}),
      });
      return settledResult(settled);
    } catch (error) {
      if (leaseError) throw leaseError;
      let policy;
      let settlementError = error;
      try {
        policy = executionPolicy(error, adapter, context);
      } catch (classificationError) {
        settlementError = runtimeError(
          "SCHEDULER_RUNTIME_ERROR_POLICY_FAILED",
          "Scheduler adapter error policy failed",
          undefined,
          classificationError,
        );
        policy = { retryable: false };
      }
      const settled = this.store.settle({
        occurrenceId: occurrence.id,
        ownerId: this.ownerId,
        fence: occurrence.fence,
        outcome: "failed",
        error: safeError(settlementError),
        retryable: policy.retryable,
        ...(context.adjudication?.status === "pending"
          ? { adjudicationRequestId: context.adjudication.requestId }
          : {}),
        ...(policy.retryAt === undefined ? {} : { retryAt: policy.retryAt }),
      });
      return settledResult(settled);
    } finally {
      this.clearIntervalFn(timer);
      linked.dispose();
    }
  }

  async runOccurrence(occurrenceId, options = {}) {
    const id = normalizeIdentifier(occurrenceId, "occurrenceId");
    const current = this.store.getOccurrence(id);
    if (!current) {
      throw runtimeError(
        "SCHEDULER_NOT_FOUND",
        `Scheduler occurrence does not exist: ${id}`,
      );
    }
    if (TERMINAL_OCCURRENCE_STATUSES.has(current.status)) {
      return settledResult(current, { alreadySettled: true });
    }
    if (options.signal?.aborted) {
      return { status: "aborted", occurrence: current };
    }
    const claimed = this.store.claimOccurrence({
      occurrenceId: id,
      ownerId: this.ownerId,
      leaseMs: this.leaseMs,
    });
    if (!claimed) {
      return {
        status: "busy",
        occurrence: this.store.getOccurrence(id),
      };
    }
    return this._executeClaim(claimed, options);
  }

  async runNext(options = {}) {
    if (options.signal?.aborted) return { status: "aborted" };
    const claimed = this.store.claimNext({
      ownerId: this.ownerId,
      leaseMs: this.leaseMs,
      ...(options.jobKind === undefined ? {} : { jobKind: options.jobKind }),
      ...(options.workspaceId === undefined
        ? {}
        : { workspaceId: options.workspaceId }),
    });
    if (!claimed) return { status: "idle" };
    return this._executeClaim(claimed, options);
  }

  async runUntilIdle({ limit, signal, jobKind, workspaceId } = {}) {
    const bounded = normalizeRunLimit(limit);
    const results = [];
    while (results.length < bounded && !signal?.aborted) {
      const result = await this.runNext({ signal, jobKind, workspaceId });
      if (result.status === "idle" || result.status === "aborted") {
        return { status: result.status, results };
      }
      results.push(result);
    }
    return {
      status: signal?.aborted ? "aborted" : "limit_reached",
      results,
    };
  }
}

export function createSchedulerRuntime(options) {
  return new SchedulerRuntime(options);
}
