import { randomUUID } from "node:crypto";
import {
  OCCURRENCE_STATUS,
  RUNTIME_CONTROL_SCHEMA_VERSION,
  RUNTIME_CONTROL_SAFE_POINTS,
  RUNTIME_PAUSE_RESUME,
  SchedulerKernelError,
  canonicalJson,
  normalizeEpochMs,
  normalizeIdentifier,
  normalizeJson,
  normalizeRuntimeControlCapability,
} from "./contract.js";
import {
  SchedulerOccurrenceGraphAuthority,
  schedulerGraphAuthorityMode,
} from "./graph-authority-adapter.js";

export const DEFAULT_RUNTIME_LEASE_MS = 60_000;
export const MIN_RUNTIME_LEASE_MS = 1_000;
export const DEFAULT_RUN_LIMIT = 100;
export const MAX_RUN_LIMIT = 10_000;

const TERMINAL_OCCURRENCE_STATUSES = new Set([
  OCCURRENCE_STATUS.SUCCEEDED,
  OCCURRENCE_STATUS.DEAD_LETTER,
]);

class SchedulerPauseSignal extends Error {
  constructor(control, checkpoint) {
    super("Scheduler adapter reached a requested pause checkpoint");
    this.name = "SchedulerPauseSignal";
    this.control = control;
    this.checkpoint = checkpoint;
  }
}

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
  const runtimeControl = normalizeRuntimeControlCapability(
    adapter.runtimeControl,
  );
  if (
    runtimeControl.safePoints.includes(
      RUNTIME_CONTROL_SAFE_POINTS.ADAPTER_CHECKPOINT,
    ) &&
    typeof adapter.resume !== "function"
  ) {
    throw runtimeError(
      "SCHEDULER_RUNTIME_INVALID_ADAPTER",
      `Scheduler adapter must implement resume() for adapter checkpoints: ${kind}`,
    );
  }
  return { kind, adapter, runtimeControl };
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
    graphAuthority = undefined,
    graphAuthorityMode = undefined,
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
    const resolvedGraphMode =
      graphAuthorityMode || schedulerGraphAuthorityMode();
    this.graphAuthority =
      graphAuthority === undefined
        ? resolvedGraphMode === "legacy"
          ? null
          : new SchedulerOccurrenceGraphAuthority({
              mode: resolvedGraphMode,
            })
        : graphAuthority;
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

  runtimeControlFor(jobKind) {
    const kind = normalizeIdentifier(jobKind, "jobKind", { maxLength: 128 });
    const adapter = this.adapters.get(kind);
    return adapter
      ? normalizeRuntimeControlCapability(adapter.runtimeControl)
      : normalizeRuntimeControlCapability();
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
    const runtimeControl = normalizeRuntimeControlCapability(
      adapter.runtimeControl,
    );

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
    const readBoundControl = (state) => {
      if (typeof this.store.getOccurrenceControl !== "function") return null;
      const control = this.store.getOccurrenceControl(occurrence.id);
      if (control?.state !== state) return null;
      if (
        runtimeControl.pauseResume !== RUNTIME_PAUSE_RESUME.CHECKPOINT_V1 ||
        canonicalJson(control.capability, "runtimeControl.persisted") !==
          canonicalJson(runtimeControl, "runtimeControl.adapter")
      ) {
        throw runtimeError(
          "SCHEDULER_RUNTIME_CONTROL_CAPABILITY_MISMATCH",
          `Scheduler runtime-control evidence no longer matches adapter capability: ${occurrence.id}`,
          {
            capabilityDigest: control.capabilityDigest,
            adapterPauseResume: runtimeControl.pauseResume,
          },
        );
      }
      if (control.expectedFence !== occurrence.fence) {
        throw runtimeError(
          "SCHEDULER_RUNTIME_CONTROL_FENCE_MISMATCH",
          `Scheduler runtime control is not bound to this claim: ${occurrence.id}`,
          {
            expectedFence: control.expectedFence,
            actualFence: occurrence.fence,
          },
        );
      }
      return control;
    };
    const readPendingPause = () => readBoundControl("pause_requested");
    const readResumingControl = () => {
      const control = readBoundControl("resumed");
      if (!control) return null;
      const checkpoint = control.checkpoint;
      if (
        !checkpoint ||
        checkpoint.schemaVersion !== RUNTIME_CONTROL_SCHEMA_VERSION ||
        !Object.values(RUNTIME_CONTROL_SAFE_POINTS).includes(
          checkpoint.safePoint,
        ) ||
        !Object.hasOwn(checkpoint, "data") ||
        !runtimeControl.safePoints.includes(checkpoint.safePoint)
      ) {
        throw runtimeError(
          "SCHEDULER_RUNTIME_RESUME_CHECKPOINT_INVALID",
          `Scheduler resume checkpoint is invalid for adapter: ${occurrence.id}`,
        );
      }
      return control;
    };
    const acknowledgePause = (control, safePoint, checkpoint) => {
      if (typeof this.store.ackOccurrencePause !== "function") {
        throw runtimeError(
          "SCHEDULER_RUNTIME_CONTROL_STORE_UNSUPPORTED",
          "Scheduler store cannot acknowledge durable runtime controls",
        );
      }
      const acknowledged = this.store.ackOccurrencePause({
        occurrenceId: occurrence.id,
        ownerId: this.ownerId,
        fence: occurrence.fence,
        requestId: control.pauseRequestId,
        expectedRevision: control.revision,
        safePoint,
        checkpoint,
      });
      return {
        status: "paused",
        occurrence: acknowledged.occurrence,
        control: acknowledged.control,
        result: null,
        error: null,
      };
    };
    let pendingPause;
    let resumingControl;
    try {
      pendingPause = readPendingPause();
      resumingControl = readResumingControl();
    } catch (error) {
      linked.dispose();
      return this._settleRejected(occurrence, error, false);
    }
    if (
      pendingPause &&
      runtimeControl.safePoints.includes(
        RUNTIME_CONTROL_SAFE_POINTS.BEFORE_EXECUTE,
      )
    ) {
      linked.dispose();
      return acknowledgePause(
        pendingPause,
        RUNTIME_CONTROL_SAFE_POINTS.BEFORE_EXECUTE,
        { adapterStarted: false },
      );
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
      runtimeControl,
      resumeCheckpoint: resumingControl?.checkpoint ?? null,
      checkpoint: (data = null) => {
        if (
          !runtimeControl.safePoints.includes(
            RUNTIME_CONTROL_SAFE_POINTS.ADAPTER_CHECKPOINT,
          )
        ) {
          return { pauseRequested: false };
        }
        const control = readPendingPause();
        if (!control) return { pauseRequested: false };
        throw new SchedulerPauseSignal(control, data);
      },
    };
    const invokeAdapter = () =>
      resumingControl?.checkpoint.safePoint ===
      RUNTIME_CONTROL_SAFE_POINTS.ADAPTER_CHECKPOINT
        ? adapter.resume(context, resumingControl.checkpoint)
        : adapter.execute(context);
    let graphClaim = null;
    try {
      let result;
      graphClaim = this.graphAuthority?.begin(context) || null;
      if (graphClaim?.alreadySettled) {
        result = graphClaim.result;
      } else if (context.adjudication?.status === "pending") {
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
            : await invokeAdapter();
      } else {
        result = await invokeAdapter();
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
      if (this.graphAuthority && !graphClaim?.alreadySettled) {
        try {
          const graphProjection = this.graphAuthority.settleSuccess(
            context,
            result,
          );
          if (this.graphAuthority.mode === "canonical") {
            result =
              result && typeof result === "object" && !Array.isArray(result)
                ? { ...result, graphAuthority: graphProjection }
                : { value: result ?? null, graphAuthority: graphProjection };
          }
        } catch (graphError) {
          if (this.graphAuthority.mode === "canonical") throw graphError;
        }
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
      if (error instanceof SchedulerPauseSignal) {
        if (this.graphAuthority && !graphClaim?.alreadySettled) {
          const knownPause = new Error("scheduler paused at a safe point");
          knownPause.outcomeKnown = true;
          try {
            this.graphAuthority.settleFailure(context, knownPause);
          } catch (graphError) {
            if (this.graphAuthority.mode === "canonical") throw graphError;
          }
        }
        return acknowledgePause(
          error.control,
          RUNTIME_CONTROL_SAFE_POINTS.ADAPTER_CHECKPOINT,
          error.checkpoint,
        );
      }
      let policy;
      let settlementError = error;
      if (this.graphAuthority && !graphClaim?.alreadySettled) {
        try {
          const graphProjection = this.graphAuthority.settleFailure(
            context,
            error,
          );
          if (
            this.graphAuthority.mode === "canonical" &&
            graphProjection?.status === "reconciliation_required"
          ) {
            settlementError = runtimeError(
              "CC_GRAPH_RECONCILIATION_REQUIRED",
              "Scheduler adapter effect outcome is unknown and requires Graph reconciliation",
              { graphRunId: graphProjection.id },
              error,
            );
            settlementError.retryable = false;
          }
        } catch (graphError) {
          if (this.graphAuthority.mode === "canonical") {
            settlementError = graphError;
          }
        }
      }
      try {
        policy =
          settlementError?.code === "CC_GRAPH_RECONCILIATION_REQUIRED"
            ? { retryable: false }
            : executionPolicy(settlementError, adapter, context);
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
      const control =
        typeof this.store.getOccurrenceControl === "function"
          ? this.store.getOccurrenceControl(id)
          : null;
      if (control?.state === "paused") {
        return {
          status: "paused",
          occurrence: this.store.getOccurrence(id),
          control,
        };
      }
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
