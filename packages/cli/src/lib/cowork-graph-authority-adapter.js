import { randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
} from "./graph-kernel/compiler.js";
import { createGraphAuthorityBinding } from "./graph-kernel/authority.js";
import { GraphEventStore } from "./graph-kernel/event-store.js";
import { GraphKernel } from "./graph-kernel/runtime.js";

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "CoworkGraphAuthorityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function coworkGraphAuthorityMode(env = process.env) {
  const value = String(env.CHAINLESSCHAIN_GRAPH_COWORK || "legacy")
    .trim()
    .toLowerCase();
  if (!["legacy", "shadow", "canonical"].includes(value)) {
    throw adapterError(
      "CC_GRAPH_AUTHORITY_MODE_INVALID",
      "CHAINLESSCHAIN_GRAPH_COWORK must be legacy, shadow, or canonical",
    );
  }
  return value;
}

function graphDefinition(workflow, admission) {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: `cowork:${String(workflow.id || workflow.name || "workflow").replace(
      /[^A-Za-z0-9._:/-]/gu,
      "-",
    )}`,
    revision: 1,
    nodes: [
      {
        id: "dynamic-workflow",
        kind: "task",
        dependsOn: [],
        inputs: [],
        outputs: [],
        effectClass: "external",
        idempotencyKey: `cowork:${admission.admissionDigest}`,
        retryLimit: 0,
      },
    ],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: 1 },
    allowedCapabilities: [],
    metadata: {
      originSurface: "cowork",
      definitionDigest: admission.definitionDigest,
      admissionDigest: admission.admissionDigest,
      delegatedRuntime: "dynamic_workflow_runtime",
    },
  });
}

export class CoworkGraphAuthorityAdapter {
  constructor({
    mode = coworkGraphAuthorityMode(),
    eventStore = new GraphEventStore(),
    now = Date.now,
    createId = randomUUID,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
  } = {}) {
    this.mode = mode;
    this.eventStore = eventStore;
    this.resultStore = eventStore.rolloutStore;
    this.now = now;
    this.createId = createId;
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.active = new Map();
  }

  runtimeClaims() {
    return Object.freeze({
      originSurface: "cowork",
      surface: "cowork",
      execution: "real",
      persistence: "durable",
      isolated: true,
      terminalEvidence: true,
      authorityModes: Object.freeze(["shadow", "canonical"]),
      featureGated: true,
    });
  }

  _resultThread(runId) {
    return `cowork-result:${runId}`;
  }

  _resultReceipt(runId, { allowMissing = false } = {}) {
    let events;
    try {
      events = this.resultStore.read(this._resultThread(runId));
    } catch (error) {
      if (allowMissing && error?.code === "CC_ROLLOUT_THREAD_NOT_FOUND") {
        return null;
      }
      throw adapterError(
        "CC_COWORK_GRAPH_RECEIPT_MISSING",
        "canonical Cowork result receipt is missing",
        { cause: error },
      );
    }
    const receipt = [...events]
      .reverse()
      .find((event) => event.event_type === "cowork.result.committed");
    if (
      !receipt ||
      graphDigest(receipt.payload?.record, "cc.cowork.workflow-result/v1") !==
        receipt.payload?.outputDigest
    ) {
      throw adapterError(
        "CC_COWORK_GRAPH_RECEIPT_FORGED",
        "canonical Cowork result receipt does not match terminal evidence",
      );
    }
    return Object.freeze({
      outputDigest: receipt.payload.outputDigest,
      receiptDigest: receipt.hash,
      record: receipt.payload.record,
    });
  }

  _readResult(runId, expectedDigest) {
    const receipt = this._resultReceipt(runId);
    if (receipt.outputDigest !== expectedDigest) {
      throw adapterError(
        "CC_COWORK_GRAPH_RECEIPT_FORGED",
        "canonical Cowork result receipt does not match terminal evidence",
      );
    }
    return receipt.record;
  }

  begin({ workflow, admission }) {
    if (this.mode === "legacy") return null;
    const runId = `cowork:${admission.admissionDigest.slice(7, 55)}`;
    const compiled = graphDefinition(workflow, admission);
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
    const authoritySource =
      this.mode === "shadow" ? "graph_kernel_shadow" : "graph_kernel";
    const writerId = `cowork-writer:${process.pid}:${generation}`;
    const writerLeaseId = `cowork-lease:${this.createId()}`;
    const kernel = new GraphKernel({
      eventStore: this.eventStore,
      now: this.now,
      writerId,
      writerLeaseId,
      authoritySource,
      authorityGeneration: generation,
      writerLeaseTtlMs: this.writerLeaseTtlMs,
    });
    let projection;
    if (!events.length) {
      projection = kernel.startRun(compiled, {
        runId,
        originSurface: "cowork",
      });
    } else {
      if (previous.authorityMode !== this.mode) {
        throw adapterError(
          "CC_GRAPH_MIGRATION_REQUIRED",
          "Cowork authority mode changed without a migration saga",
        );
      }
      const latest = events.at(-1);
      projection = kernel.recoverRun(runId, {
        authority: createGraphAuthorityBinding({
          ...previous,
          authorityGeneration: generation,
          writerId,
          writerLeaseId,
          writerLeaseExpiresAt: new Date(
            this.now() + this.writerLeaseTtlMs,
          ).toISOString(),
          eventHead: latest.hash,
        }),
      });
      if (projection.revisionDigest !== compiled.revisionDigest) {
        throw adapterError(
          "CC_COWORK_GRAPH_REVISION_CONFLICT",
          "Cowork Graph revision changed during recovery",
        );
      }
    }
    if (projection.status === "succeeded") {
      const accepted = projection.attempts.find(
        (attempt) => attempt.status === "accepted",
      );
      const outputDigest = accepted?.terminalEvidence?.outputDigest;
      if (!outputDigest) {
        throw adapterError(
          "CC_COWORK_GRAPH_RECEIPT_MISSING",
          "successful Cowork Graph has no output digest",
        );
      }
      const record = this._readResult(runId, outputDigest);
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        compareOnly: this.mode === "shadow",
        outputDigest,
        projection,
        record,
      });
    }
    if (projection.status === "reconciliation_required") {
      const durableResult = this._resultReceipt(runId, { allowMissing: true });
      if (!durableResult || projection.reconciliationEffectIds.length !== 1) {
        throw adapterError(
          "CC_GRAPH_RECONCILIATION_REQUIRED",
          "Cowork workflow effect outcome requires reconciliation",
          { graphRunId: runId },
        );
      }
      kernel.reconcileEffect(runId, {
        effectId: projection.reconciliationEffectIds[0],
        decision: "committed",
        receipt: { receiptDigest: durableResult.receiptDigest },
        auditDecisionId: `cowork-result-receipt:${durableResult.outputDigest.slice(
          7,
          39,
        )}`,
      });
      projection = kernel.getRun(runId);
    }
    const durableResult = this._resultReceipt(runId, { allowMissing: true });
    const recoverableAttempt = projection.attempts.find(
      (attempt) =>
        attempt.nodeId === "dynamic-workflow" && attempt.status === "active",
    );
    if (durableResult && recoverableAttempt) {
      const settlementAttempt =
        recoverableAttempt.authorityGeneration ===
          projection.authorityGeneration &&
        recoverableAttempt.writerId === projection.writerId
          ? recoverableAttempt
          : kernel.resumeAttempt(runId, recoverableAttempt.id, {
              resumedAttemptId: `cowork-recovery-attempt:${this.createId()}`,
              leaseId: `cowork-recovery-lease:${this.createId()}`,
              ttlMs: this.writerLeaseTtlMs,
              reason: "durable Cowork result recovered after writer takeover",
            });
      kernel.settleAttempt(runId, {
        attemptId: settlementAttempt.id,
        leaseId: settlementAttempt.leaseId,
        fence: settlementAttempt.fence,
        outcome: "succeeded",
        evidence: { outputDigest: durableResult.outputDigest },
        usage: { turns: 1 },
      });
      projection = kernel.getRun(runId);
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        compareOnly: this.mode === "shadow",
        outputDigest: durableResult.outputDigest,
        projection,
        record: durableResult.record,
      });
    }
    if (projection.phase === "open") {
      kernel.registerAgent(runId, {
        agentId: "cowork-runtime",
        capacity: 1,
        resident: true,
      });
      kernel.sealRun(runId);
    }
    const attempt = kernel.assignNode(
      runId,
      "dynamic-workflow",
      "cowork-runtime",
      {
        ttlMs: this.writerLeaseTtlMs,
        leaseId: `cowork-attempt:${this.createId()}`,
        grant: {
          definitionDigest: admission.definitionDigest,
          admissionDigest: admission.admissionDigest,
        },
      },
    );
    const effect = kernel.beginEffect(runId, {
      effectId: `cowork-effect:${attempt.id}`,
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      idempotencyKey: attempt.effectIdempotencyKey,
      operationDigest: graphDigest(
        {
          definitionDigest: admission.definitionDigest,
          admissionDigest: admission.admissionDigest,
        },
        "cc.cowork.workflow-operation/v1",
      ),
    });
    this.active.set(runId, { runId, kernel, attempt, effect });
    if (durableResult) {
      const settled = this.settleSuccess(
        { runId, alreadySettled: false, projection },
        durableResult.record,
      );
      return Object.freeze({
        runId,
        alreadySettled: this.mode === "canonical",
        compareOnly: this.mode === "shadow",
        outputDigest: durableResult.outputDigest,
        projection: settled,
        record: durableResult.record,
      });
    }
    return Object.freeze({ runId, alreadySettled: false, projection });
  }

  settleSuccess(claim, record) {
    if (this.mode === "legacy") return null;
    const outputDigest = graphDigest(record, "cc.cowork.workflow-result/v1");
    if (claim.compareOnly === true) {
      if (outputDigest !== claim.outputDigest) {
        throw adapterError(
          "CC_COWORK_GRAPH_SHADOW_DIVERGENCE",
          "Cowork shadow result diverged from persisted Graph evidence",
          { expectedDigest: claim.outputDigest, actualDigest: outputDigest },
        );
      }
      return claim.projection;
    }
    const active = this.active.get(claim.runId);
    if (!active) {
      throw adapterError(
        "CC_COWORK_GRAPH_ATTEMPT_MISSING",
        "Cowork Graph attempt is not active",
      );
    }
    const threadId = this._resultThread(claim.runId);
    this.resultStore.start({
      threadId,
      title: `Cowork Graph result ${claim.runId}`,
      metadata: { kind: "cowork_graph_result", graphRunId: claim.runId },
    });
    const events = this.resultStore.read(threadId);
    const receipt = this.resultStore.append({
      threadId,
      eventType: "cowork.result.committed",
      idempotencyKey: `cowork-result:${claim.runId}`,
      payload: { outputDigest, record },
      expectedRevision: events.at(-1)?.event_seq,
      expectedHeadHash: events.at(-1)?.hash,
    });
    active.kernel.settleEffect(claim.runId, {
      effectId: active.effect.id,
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: "committed",
      receipt: { receiptDigest: receipt.hash },
    });
    active.kernel.settleAttempt(claim.runId, {
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: "succeeded",
      evidence: { outputDigest },
      usage: { turns: 1 },
    });
    this.active.delete(claim.runId);
    return active.kernel.getRun(claim.runId);
  }

  settleFailure(claim, error) {
    if (this.mode === "legacy" || !claim) return null;
    const active = this.active.get(claim.runId);
    if (!active) return null;
    const outcomeKnown = error?.outcomeKnown === true;
    active.kernel.settleEffect(claim.runId, {
      effectId: active.effect.id,
      attemptId: active.attempt.id,
      leaseId: active.attempt.leaseId,
      fence: active.attempt.fence,
      outcome: outcomeKnown ? "failed" : "unknown",
    });
    if (outcomeKnown) {
      active.kernel.settleAttempt(claim.runId, {
        attemptId: active.attempt.id,
        leaseId: active.attempt.leaseId,
        fence: active.attempt.fence,
        outcome: "failed",
        error: error?.message || String(error),
        usage: { turns: 1 },
      });
    }
    this.active.delete(claim.runId);
    return active.kernel.getRun(claim.runId);
  }
}
