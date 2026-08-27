import { createHash, randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
} from "../graph-kernel/compiler.js";
import { createGraphAuthorityBinding } from "../graph-kernel/authority.js";
import { GraphEventStore } from "../graph-kernel/event-store.js";
import { GraphKernel } from "../graph-kernel/runtime.js";

function graphError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SchedulerGraphAuthorityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function id(value, prefix) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(text)) return text;
  return `${prefix}-${createHash("sha256")
    .update(text, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function definitionFor(context) {
  const { occurrence, job } = context;
  const maxAttempts = Math.max(
    1,
    Number(job.retryPolicy?.maxAttempts ?? job.maxAttempts) || 3,
  );
  return compileGraphDefinition({
    schemaVersion: 1,
    id: id(`scheduler:${job.kind}:${job.id}`, "scheduler-graph"),
    revision: Math.max(1, Number(job.revision) || 1),
    nodes: [
      {
        id: "dispatch",
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "external",
        idempotencyKey: `scheduler:${occurrence.id}:${occurrence.jobRevision}`,
        retryLimit: Math.max(0, maxAttempts - 1),
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: maxAttempts },
    allowedCapabilities: [],
    metadata: {
      originSurface: "scheduler",
      occurrenceId: occurrence.id,
      jobRevision: occurrence.jobRevision,
      jobKind: job.kind,
    },
  });
}

export function schedulerGraphAuthorityMode(env = process.env) {
  const value = String(env.CHAINLESSCHAIN_GRAPH_SCHEDULER || "legacy")
    .trim()
    .toLowerCase();
  if (!["legacy", "shadow", "canonical"].includes(value)) {
    throw graphError(
      "CC_GRAPH_AUTHORITY_MODE_INVALID",
      "CHAINLESSCHAIN_GRAPH_SCHEDULER must be legacy, shadow, or canonical",
    );
  }
  return value;
}

export class SchedulerOccurrenceGraphAuthority {
  constructor({
    mode = schedulerGraphAuthorityMode(),
    eventStore = new GraphEventStore(),
    now = Date.now,
    createId = randomUUID,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
  } = {}) {
    if (!["legacy", "shadow", "canonical"].includes(mode)) {
      throw graphError(
        "CC_GRAPH_AUTHORITY_MODE_INVALID",
        "scheduler Graph authority mode is invalid",
      );
    }
    this.mode = mode;
    this.eventStore = eventStore;
    this.resultStore = eventStore.rolloutStore;
    this.now = now;
    this.createId = createId;
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.active = new Map();
    this.comparisons = new Map();
  }

  runtimeClaims() {
    return Object.freeze({
      originSurface: "scheduler",
      surface: "scheduler",
      execution: "real",
      persistence: "durable",
      isolated: true,
      terminalEvidence: true,
      authorityModes: Object.freeze(["shadow", "canonical"]),
      featureGated: true,
    });
  }

  _resultThread(runId) {
    return `scheduler-result:${createHash("sha256")
      .update(runId, "utf8")
      .digest("hex")}`;
  }

  _resultReceipt(runId, { allowMissing = false } = {}) {
    let events;
    try {
      events = this.resultStore.read(this._resultThread(runId));
    } catch (error) {
      if (allowMissing && error?.code === "CC_ROLLOUT_THREAD_NOT_FOUND") {
        return null;
      }
      throw graphError(
        "CC_SCHEDULER_GRAPH_RECEIPT_MISSING",
        "scheduler Graph result receipt is missing",
        { cause: error },
      );
    }
    const receipt = [...events]
      .reverse()
      .find((event) => event.event_type === "scheduler.result.committed");
    if (
      !receipt ||
      graphDigest(receipt.payload?.record, "cc.scheduler.adapter-result/v1") !==
        receipt.payload?.outputDigest
    ) {
      throw graphError(
        "CC_SCHEDULER_GRAPH_RECEIPT_FORGED",
        "scheduler Graph result receipt is corrupt or forged",
      );
    }
    return Object.freeze({
      record: receipt.payload.record,
      outputDigest: receipt.payload.outputDigest,
      receiptDigest: receipt.hash,
    });
  }

  _kernel(runId, generation, authoritySource) {
    const writerId = id(
      `scheduler:${runId}:writer:${process.pid}:${generation}`,
      "scheduler-writer",
    );
    const writerLeaseId = id(
      `scheduler:${runId}:lease:${this.createId()}`,
      "scheduler-lease",
    );
    return {
      kernel: new GraphKernel({
        eventStore: this.eventStore,
        now: this.now,
        writerId,
        writerLeaseId,
        authoritySource,
        authorityGeneration: generation,
        writerLeaseTtlMs: this.writerLeaseTtlMs,
      }),
      writerId,
      writerLeaseId,
    };
  }

  begin(context) {
    if (this.mode === "legacy") return null;
    const runId = id(`scheduler:${context.occurrence.id}`, "scheduler-run");
    const compiled = definitionFor(context);
    let events = [];
    try {
      events = this.eventStore.read(runId);
    } catch (error) {
      if (error?.code !== "CC_ROLLOUT_THREAD_NOT_FOUND") throw error;
    }
    const previous = [...events]
      .reverse()
      .find((event) => event.payload?.state?.authority)?.payload
      .state.authority;
    const generation = previous ? Number(previous.authorityGeneration) + 1 : 1;
    const source =
      this.mode === "shadow" ? "graph_kernel_shadow" : "graph_kernel";
    const holder = this._kernel(runId, generation, source);
    let projection;
    if (!events.length) {
      projection = holder.kernel.startRun(compiled, {
        runId,
        originSurface: "scheduler",
        occurrenceRef: {
          jobRevision: String(context.occurrence.jobRevision),
          occurrenceId: String(context.occurrence.id),
          idempotencyKey: String(
            context.occurrence.idempotencyKey || context.occurrence.id,
          ),
        },
      });
    } else {
      if (previous.authorityMode !== this.mode) {
        throw graphError(
          "CC_GRAPH_MIGRATION_REQUIRED",
          "scheduler occurrence authority changed without a migration saga",
        );
      }
      const latest = events.at(-1);
      projection = holder.kernel.recoverRun(runId, {
        authority: createGraphAuthorityBinding({
          ...previous,
          logicalRunId: runId,
          originSurface: "scheduler",
          authorityMode: this.mode,
          authoritySource: source,
          authorityGeneration: generation,
          writerId: holder.writerId,
          writerLeaseId: holder.writerLeaseId,
          writerLeaseExpiresAt: new Date(
            this.now() + this.writerLeaseTtlMs,
          ).toISOString(),
          eventHead: latest.hash,
        }),
      });
      if (projection.revisionDigest !== compiled.revisionDigest) {
        throw graphError(
          "CC_GRAPH_OCCURRENCE_CONFLICT",
          "scheduler occurrence Graph revision changed during recovery",
        );
      }
    }
    if (projection.status === "succeeded") {
      const accepted = projection.attempts.find(
        (attempt) => attempt.status === "accepted",
      );
      const outputDigest = accepted?.terminalEvidence?.outputDigest;
      const receipt = this._resultReceipt(runId);
      if (!outputDigest || receipt.outputDigest !== outputDigest) {
        throw graphError(
          "CC_SCHEDULER_GRAPH_RECEIPT_FORGED",
          "scheduler Graph terminal evidence does not match its result receipt",
        );
      }
      if (this.mode === "shadow") {
        this.comparisons.set(context.occurrence.id, {
          outputDigest,
          projection,
        });
      }
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        projection,
        result: receipt.record,
      });
    }
    if (projection.status === "reconciliation_required") {
      const receipt = this._resultReceipt(runId, { allowMissing: true });
      if (!receipt || projection.reconciliationEffectIds.length !== 1) {
        throw graphError(
          "CC_GRAPH_RECONCILIATION_REQUIRED",
          "scheduler occurrence has an unknown effect requiring adjudication",
          { graphRunId: runId },
        );
      }
      holder.kernel.reconcileEffect(runId, {
        effectId: projection.reconciliationEffectIds[0],
        decision: "committed",
        receipt: { receiptDigest: receipt.receiptDigest },
        auditDecisionId: `scheduler-result-receipt:${receipt.outputDigest.slice(
          7,
          39,
        )}`,
      });
      projection = holder.kernel.getRun(runId);
    }
    const durableResult = this._resultReceipt(runId, { allowMissing: true });
    const recoverableAttempt = projection.attempts.find(
      (attempt) => attempt.nodeId === "dispatch" && attempt.status === "active",
    );
    if (durableResult && recoverableAttempt) {
      const settlementAttempt =
        recoverableAttempt.authorityGeneration ===
          projection.authorityGeneration &&
        recoverableAttempt.writerId === projection.writerId
          ? recoverableAttempt
          : holder.kernel.resumeAttempt(runId, recoverableAttempt.id, {
              resumedAttemptId: `scheduler-recovery-attempt:${this.createId()}`,
              leaseId: `scheduler-recovery-lease:${this.createId()}`,
              ttlMs: this.writerLeaseTtlMs,
              reason:
                "durable Scheduler result recovered after writer takeover",
            });
      holder.kernel.settleAttempt(runId, {
        attemptId: settlementAttempt.id,
        leaseId: settlementAttempt.leaseId,
        fence: settlementAttempt.fence,
        outcome: "succeeded",
        evidence: { outputDigest: durableResult.outputDigest },
        usage: { turns: 1 },
      });
      projection = holder.kernel.getRun(runId);
      if (this.mode === "shadow") {
        this.comparisons.set(context.occurrence.id, {
          outputDigest: durableResult.outputDigest,
          projection,
        });
      }
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        projection,
        result: durableResult.record,
      });
    }
    if (
      ["failed", "cancelled", "blocked", "deadlocked"].includes(
        projection.status,
      )
    ) {
      throw graphError(
        "CC_GRAPH_RUN_TERMINAL",
        `scheduler occurrence Graph is terminal: ${projection.status}`,
      );
    }
    if (projection.phase === "open") {
      holder.kernel.registerAgent(runId, {
        agentId: "scheduler-adapter",
        capacity: 1,
        resident: true,
      });
      holder.kernel.sealRun(runId);
    }
    const attempt = holder.kernel.assignNode(
      runId,
      "dispatch",
      "scheduler-adapter",
      {
        ttlMs: this.writerLeaseTtlMs,
        leaseId: id(
          `scheduler-attempt:${context.occurrence.id}:${context.occurrence.fence}`,
          "scheduler-attempt-lease",
        ),
        grant: {
          schedulerOwnerId: context.occurrence.ownerId || null,
          schedulerFence: context.occurrence.fence,
          schedulerAttempt: context.occurrence.attempt,
        },
      },
    );
    const effect = holder.kernel.beginEffect(runId, {
      effectId: id(`scheduler-effect:${attempt.id}`, "scheduler-effect"),
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      idempotencyKey: attempt.effectIdempotencyKey,
      operationDigest: graphDigest(
        {
          occurrenceId: context.occurrence.id,
          jobRevision: context.occurrence.jobRevision,
          authority: context.authority,
        },
        "cc.scheduler.graph-operation/v1",
      ),
    });
    this.active.set(context.occurrence.id, {
      runId,
      ...holder,
      attempt,
      effect,
    });
    if (durableResult) {
      const settled = this.settleSuccess(context, durableResult.record);
      if (this.mode === "shadow") {
        this.comparisons.set(context.occurrence.id, {
          outputDigest: durableResult.outputDigest,
          projection: settled,
        });
      }
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        projection: settled,
        result: durableResult.record,
      });
    }
    return Object.freeze({ runId, alreadySettled: false, projection });
  }

  settleSuccess(context, result) {
    if (this.mode === "legacy") return null;
    const outputDigest = graphDigest(
      result ?? null,
      "cc.scheduler.adapter-result/v1",
    );
    const comparison = this.comparisons.get(context.occurrence.id);
    if (comparison) {
      this.comparisons.delete(context.occurrence.id);
      if (comparison.outputDigest !== outputDigest) {
        throw graphError(
          "CC_SCHEDULER_GRAPH_SHADOW_DIVERGENCE",
          "scheduler shadow result diverged from persisted Graph evidence",
        );
      }
      return comparison.projection;
    }
    const active = this.active.get(context.occurrence.id);
    if (!active) {
      throw graphError(
        "CC_GRAPH_ATTEMPT_MISSING",
        "scheduler Graph attempt is not active",
      );
    }
    const threadId = this._resultThread(active.runId);
    this.resultStore.start({
      threadId,
      title: `Scheduler Graph result ${active.runId}`,
      metadata: { kind: "scheduler_graph_result", graphRunId: active.runId },
    });
    const resultEvents = this.resultStore.read(threadId);
    const receipt = this.resultStore.append({
      threadId,
      eventType: "scheduler.result.committed",
      idempotencyKey: `scheduler-result:${active.runId}`,
      payload: { outputDigest, record: result ?? null },
      expectedRevision: resultEvents.at(-1)?.event_seq,
      expectedHeadHash: resultEvents.at(-1)?.hash,
    });
    active.kernel.settleEffect(active.runId, {
      effectId: active.effect.id,
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: "committed",
      receipt: { receiptDigest: receipt.hash },
    });
    active.kernel.settleAttempt(active.runId, {
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: "succeeded",
      evidence: { outputDigest },
      usage: { turns: 1 },
    });
    this.active.delete(context.occurrence.id);
    return active.kernel.getRun(active.runId);
  }

  settleFailure(context, error) {
    if (this.mode === "legacy") return null;
    const active = this.active.get(context.occurrence.id);
    if (!active) return null;
    const known = error?.outcomeKnown === true;
    active.kernel.settleEffect(active.runId, {
      effectId: active.effect.id,
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: known ? "failed" : "unknown",
    });
    if (known) {
      active.kernel.settleAttempt(active.runId, {
        attemptId: active.attempt.id,
        leaseId: active.attempt.leaseId,
        fence: active.attempt.fence,
        outcome: "failed",
        error: error?.message || String(error),
        usage: { turns: 1 },
      });
    }
    this.active.delete(context.occurrence.id);
    return active.kernel.getRun(active.runId);
  }
}
