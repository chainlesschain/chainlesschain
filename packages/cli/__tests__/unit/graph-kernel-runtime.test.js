import { describe, expect, it, vi } from "vitest";
import { compileGraphDefinition } from "../../src/lib/graph-kernel/compiler.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";
import {
  GraphKernel,
  deriveDataPolicy,
} from "../../src/lib/graph-kernel/runtime.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function node(id, overrides = {}) {
  return {
    id,
    kind: "task",
    dependsOn: [],
    inputs: [],
    outputs: [],
    effectClass: "none",
    ...overrides,
  };
}

function graph(nodes, overrides = {}) {
  return compileGraphDefinition({
    schemaVersion: 1,
    id: overrides.id || "graph-runtime",
    revision: overrides.revision || 1,
    nodes,
    edges: overrides.edges || [],
    loops: overrides.loops || [],
    subgraphCalls: overrides.subgraphCalls || [],
    budget: overrides.budget || { turns: 100, tokens: 100000 },
    allowedCapabilities: overrides.allowedCapabilities || [],
    metadata: overrides.metadata || {},
  });
}

function createKernel(options = {}) {
  let current = options.startTime || 1_700_000_000_000;
  const now = () => current;
  const eventStore =
    options.eventStore ||
    new GraphEventStore({ rolloutStore: new MemoryRolloutStore({ now }) });
  let id = 0;
  const kernel = new GraphKernel({
    eventStore,
    now,
    createId: () => `generated-${++id}`,
    agingWindowMs: 1000,
    maxPendingMessagesPerAgent: options.maxPendingMessagesPerAgent || 100,
    maxLivelockRepeats: options.maxLivelockRepeats || 3,
  });
  return {
    kernel,
    eventStore,
    advance(ms) {
      current += ms;
    },
  };
}

function startSealed(kernel, compiled, runId = "run-1", options = {}) {
  kernel.startRun(compiled, { runId, ...options });
  return kernel.sealRun(runId);
}

function assign(kernel, runId, nodeId, agentId = "agent-1", suffix = "1") {
  return kernel.assignNode(runId, nodeId, agentId, {
    attemptId: `attempt-${nodeId}-${suffix}`,
    leaseId: `lease-${nodeId}-${suffix}`,
    ttlMs: 60_000,
  });
}

function succeed(kernel, runId, attempt, overrides = {}) {
  return kernel.settleAttempt(runId, {
    attemptId: attempt.id,
    leaseId: attempt.leaseId,
    fence: attempt.fence,
    outcome: "succeeded",
    evidence: { outputDigest: DIGEST_A, ...overrides.evidence },
    usage: overrides.usage || { turns: 1, tokens: 10 },
  });
}

const trustedPolicy = {
  origin: "host:test",
  trust: "trusted_host",
  sensitivity: "internal",
  allowedSinks: ["agent:*", "artifact:local"],
};

describe("canonical Graph Kernel", () => {
  it("keeps occurrence admission distinct from GraphRun terminal state", () => {
    const { kernel } = createKernel();
    const compiled = graph([node("only")]);
    const occurrenceRef = {
      jobRevision: "job-r1",
      occurrenceId: "occurrence-1",
      idempotencyKey: "occurrence-key-1",
    };
    const first = kernel.startRun(compiled, {
      runId: "run-occurrence",
      occurrenceRef,
    });
    const replay = kernel.startRun(compiled, {
      runId: "different-requested-id",
      occurrenceRef,
    });
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ phase: "open", status: "running" });
    expect(kernel.events(first.id).map((event) => event.type)).toContain(
      "run.started",
    );
  });

  it("uses producer lease + revision CAS + request idempotency for dynamic expansion", () => {
    const { kernel } = createKernel();
    const compiled = graph([node("root")], {
      budget: { turns: 10, tokens: 1000 },
    });
    kernel.startRun(compiled, { runId: "run-dynamic" });
    const producer = kernel.acquireProducerLease("run-dynamic", {
      producerId: "planner-1",
      leaseId: "producer-lease-1",
      ttlMs: 10_000,
    });
    expect(() => kernel.sealRun("run-dynamic")).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_PRODUCERS_ACTIVE" }),
    );
    const append = {
      expectedGraphRevision: 1,
      requestId: "append-1",
      producerLeaseId: producer.id,
      producerFence: producer.fence,
      nodes: [node("child", { dependsOn: ["root"] })],
      edges: [],
    };
    const revised = kernel.appendGraph("run-dynamic", append);
    expect(revised).toMatchObject({
      graphRevision: 2,
      addedNodeIds: ["child"],
    });
    expect(kernel.appendGraph("run-dynamic", append)).toEqual(revised);
    expect(() =>
      kernel.appendGraph("run-dynamic", {
        ...append,
        nodes: [node("different")],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_REQUEST_ID_CONFLICT" }),
    );
    expect(() =>
      kernel.appendGraph("run-dynamic", {
        ...append,
        requestId: "append-stale",
        nodes: [node("later")],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_REVISION_CONFLICT" }),
    );
    kernel.releaseProducerLease("run-dynamic", producer.id, producer.fence);
    expect(kernel.sealRun("run-dynamic")).toMatchObject({
      phase: "sealed",
      status: "running",
      graphRevision: 2,
    });
  });

  it("schedules dependencies, requires evidence, and recovers deterministic state", () => {
    const context = createKernel();
    const compiled = graph([
      node("first"),
      node("second", { dependsOn: ["first"] }),
    ]);
    startSealed(context.kernel, compiled, "run-recovery");
    expect(
      context.kernel.readyNodes("run-recovery").map((item) => item.nodeId),
    ).toEqual(["first"]);
    const first = assign(context.kernel, "run-recovery", "first");
    expect(() =>
      context.kernel.settleAttempt("run-recovery", {
        attemptId: first.id,
        leaseId: first.leaseId,
        fence: first.fence,
        outcome: "succeeded",
        evidence: {},
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED" }),
    );
    succeed(context.kernel, "run-recovery", first);
    expect(
      context.kernel.readyNodes("run-recovery").map((item) => item.nodeId),
    ).toEqual(["second"]);
    const second = assign(context.kernel, "run-recovery", "second");
    succeed(context.kernel, "run-recovery", second, {
      usage: { turns: 1, tokens: 20 },
    });
    const terminal = context.kernel.getRun("run-recovery");
    expect(terminal).toMatchObject({
      status: "succeeded",
      budgetUsed: { turns: 2, tokens: 30 },
    });

    const recoveredKernel = new GraphKernel({
      eventStore: context.eventStore,
      now: () => 1_700_000_000_000,
    });
    expect(recoveredKernel.recoverRun("run-recovery")).toEqual(terminal);
    expect(
      recoveredKernel.events("run-recovery").at(-1).payload.state.status,
    ).toBe("succeeded");
  });

  it("propagates failure to a deterministic blocked root", () => {
    const { kernel } = createKernel();
    const compiled = graph([
      node("root"),
      node("child", { dependsOn: ["root"] }),
      node("grandchild", { dependsOn: ["child"] }),
    ]);
    startSealed(kernel, compiled, "run-failure");
    const attempt = assign(kernel, "run-failure", "root");
    kernel.settleAttempt("run-failure", {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "failed",
      error: "boom",
      evidence: { outputDigest: DIGEST_B },
    });
    const run = kernel.getRun("run-failure");
    expect(run.status).toBe("failed");
    expect(run.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "root", status: "failed" }),
        expect.objectContaining({
          nodeId: "child",
          status: "upstream_failed",
          blockedRoot: "root",
        }),
        expect.objectContaining({
          nodeId: "grandchild",
          status: "upstream_failed",
          blockedRoot: "child",
        }),
      ]),
    );
  });

  it("fences expired writers and accepts artifacts only from the live lease", () => {
    const context = createKernel();
    const compiled = graph([
      node("write", {
        effectClass: "workspace_write",
        workspaceIsolation: "declared_scope",
        writeSet: ["src/**"],
        idempotencyKey: "write-effect",
      }),
    ]);
    startSealed(context.kernel, compiled, "run-fence");
    const stale = context.kernel.assignNode("run-fence", "write", "agent-old", {
      attemptId: "attempt-old",
      leaseId: "lease-old",
      ttlMs: 10,
    });
    context.advance(11);
    context.kernel.tick("run-fence");
    expect(() =>
      context.kernel.registerArtifact("run-fence", {
        artifactId: "artifact-late",
        attemptId: stale.id,
        leaseId: stale.leaseId,
        fence: stale.fence,
        digest: DIGEST_A,
        dataPolicy: trustedPolicy,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STALE_ATTEMPT_LEASE" }),
    );
    const winner = assign(
      context.kernel,
      "run-fence",
      "write",
      "agent-new",
      "new",
    );
    const artifact = context.kernel.registerArtifact("run-fence", {
      artifactId: "artifact-winner",
      attemptId: winner.id,
      leaseId: winner.leaseId,
      fence: winner.fence,
      digest: DIGEST_A,
      schema: { type: "object" },
      commit: "abc123",
      validationEvidence: ["test-1"],
      dataPolicy: trustedPolicy,
    });
    expect(artifact).toMatchObject({
      producerAttemptId: winner.id,
      producerLeaseId: winner.leaseId,
      producerFence: winner.fence,
    });
    succeed(context.kernel, "run-fence", winner, {
      evidence: { outputDigest: null, artifactIds: [artifact.id] },
    });
    expect(context.kernel.getRun("run-fence").status).toBe("succeeded");
  });

  it("provides at-least-once messages with explicit read/processed dedup", () => {
    const { kernel } = createKernel({ maxPendingMessagesPerAgent: 2 });
    const compiled = graph([node("talk")]);
    startSealed(kernel, compiled, "run-message");
    const sender = assign(kernel, "run-message", "talk", "sender");
    const message = kernel.sendMessage("run-message", {
      messageId: "message-1",
      fromAttemptId: sender.id,
      leaseId: sender.leaseId,
      fence: sender.fence,
      toAgentId: "recipient",
      mode: "followup",
      payload: { text: "review this" },
      dataPolicy: trustedPolicy,
      causationId: "cause-1",
      correlationId: "conversation-1",
    });
    expect(message.status).toBe("admitted");
    kernel.deliverMessage("run-message", message.id);
    kernel.deliverMessage("run-message", message.id);
    const inbox = kernel.receiveMessages("run-message", "recipient");
    expect(inbox).toEqual([
      expect.objectContaining({
        id: "message-1",
        status: "read",
        deliveryCount: 2,
      }),
    ]);
    const receipt = kernel.processMessage(
      "run-message",
      message.id,
      "recipient",
      "consumer-1",
    );
    expect(
      kernel.processMessage(
        "run-message",
        message.id,
        "recipient",
        "consumer-1",
      ),
    ).toEqual(receipt);
    expect(kernel.receiveMessages("run-message", "recipient")).toEqual([]);

    expect(() =>
      kernel.sendMessage("run-message", {
        messageId: "message-untrusted",
        fromAttemptId: sender.id,
        leaseId: sender.leaseId,
        fence: sender.fence,
        toAgentId: "recipient",
        payload: { approval: { kind: "acceptOnce" } },
        dataPolicy: {
          ...trustedPolicy,
          trust: "untrusted_content",
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_UNTRUSTED_AUTHORITY_PAYLOAD" }),
    );
  });

  it("transfers custody only after offer/accept/commit and fences the sender", () => {
    const { kernel } = createKernel();
    const compiled = graph([node("task")]);
    startSealed(kernel, compiled, "run-handoff");
    const sender = assign(kernel, "run-handoff", "task", "sender");
    const offered = kernel.offerHandoff("run-handoff", {
      handoffId: "handoff-1",
      fromAttemptId: sender.id,
      leaseId: sender.leaseId,
      fence: sender.fence,
      toAgentId: "recipient",
    });
    expect(offered.status).toBe("offered");
    expect(
      kernel.acceptHandoff("run-handoff", offered.id, "recipient").status,
    ).toBe("accepted");
    const committed = kernel.commitHandoff("run-handoff", offered.id, {
      attemptId: "attempt-recipient",
      leaseId: "lease-recipient",
    });
    expect(committed).toMatchObject({
      handoff: { status: "committed" },
      assignmentAttempt: {
        agentId: "recipient",
        nodeId: "task",
        status: "active",
      },
    });
    expect(() => succeed(kernel, "run-handoff", sender)).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_STALE_ATTEMPT_LEASE" }),
    );
    succeed(kernel, "run-handoff", committed.assignmentAttempt);
    expect(kernel.getRun("run-handoff").status).toBe("succeeded");
  });

  it("makes HumanTask durable, digest-bound, quorum-aware, and slot-releasing", () => {
    const { kernel } = createKernel();
    const compiled = graph([node("approve")]);
    startSealed(kernel, compiled, "run-human");
    kernel.registerAgent("run-human", { agentId: "agent-1", capacity: 1 });
    const attempt = assign(kernel, "run-human", "approve");
    const task = kernel.createHumanTask("run-human", {
      humanTaskId: "human-1",
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      operation: { tool: "run_shell", args: { command: "npm test" } },
      nonce: "nonce-1",
      quorum: 2,
      separationOfDuties: true,
    });
    expect(kernel.getRun("run-human")).toMatchObject({
      status: "waiting_human",
      pendingHumanTaskIds: ["human-1"],
    });
    // Waiting releases capacity; another independent participant can be registered.
    expect(
      kernel.registerAgent("run-human", { agentId: "agent-1", capacity: 1 }),
    ).toMatchObject({
      status: "idle",
    });
    const firstClaim = kernel.claimHumanTask(
      "run-human",
      task.id,
      "reviewer-1",
      { claimLeaseId: "claim-1" },
    );
    expect(() =>
      kernel.decideHumanTask("run-human", task.id, {
        actorId: "reviewer-1",
        claimLeaseId: firstClaim.claimLeaseId,
        revisionDigest: task.revisionDigest,
        operationDigest: DIGEST_B,
        nonce: task.nonce,
        decision: { kind: "acceptOnce" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_HUMAN_TASK_BINDING_MISMATCH" }),
    );
    const partial = kernel.decideHumanTask("run-human", task.id, {
      actorId: "reviewer-1",
      claimLeaseId: firstClaim.claimLeaseId,
      revisionDigest: task.revisionDigest,
      operationDigest: task.operationDigest,
      nonce: task.nonce,
      decision: { kind: "acceptOnce" },
    });
    expect(partial.status).toBe("open");
    const secondClaim = kernel.claimHumanTask(
      "run-human",
      task.id,
      "reviewer-2",
      { claimLeaseId: "claim-2" },
    );
    const decided = kernel.decideHumanTask("run-human", task.id, {
      actorId: "reviewer-2",
      claimLeaseId: secondClaim.claimLeaseId,
      revisionDigest: task.revisionDigest,
      operationDigest: task.operationDigest,
      nonce: task.nonce,
      decision: { kind: "acceptOnce" },
    });
    expect(decided).toMatchObject({ status: "decided" });
    expect(kernel.getRun("run-human").nodes[0].status).toBe("pending");
    const resumed = assign(kernel, "run-human", "approve", "agent-1", "resume");
    succeed(kernel, "run-human", resumed);
    expect(kernel.getRun("run-human").status).toBe("succeeded");
  });

  it("does not claim quiescence while open and diagnoses wait-for deadlock after seal", () => {
    const { kernel } = createKernel();
    const compiled = graph([node("a"), node("b")]);
    kernel.startRun(compiled, { runId: "run-deadlock" });
    kernel.setWaitReason("run-deadlock", "a", {
      kind: "scope",
      resourceId: "scope-a",
      ownerNodeId: "b",
    });
    kernel.setWaitReason("run-deadlock", "b", {
      kind: "scope",
      resourceId: "scope-b",
      ownerNodeId: "a",
    });
    expect(kernel.classify("run-deadlock").status).toBe("running");
    kernel.sealRun("run-deadlock");
    const classified = kernel.classify("run-deadlock");
    expect(classified).toMatchObject({
      status: "deadlocked",
      waitCycles: [["a", "b"]],
    });
  });

  it("waits for cancellation settlement and rejects the late winner", async () => {
    const { kernel } = createKernel();
    const compiled = graph([node("long")]);
    startSealed(kernel, compiled, "run-cancel");
    const attempt = assign(kernel, "run-cancel", "long");
    let settled = false;
    const interrupt = vi.fn(async () => {
      await Promise.resolve();
      settled = true;
    });
    const cancelled = await kernel.cancelRun("run-cancel", { interrupt });
    expect(settled).toBe(true);
    expect(interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ id: attempt.id }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(() => succeed(kernel, "run-cancel", attempt)).toThrowError(
      expect.objectContaining({
        code: expect.stringMatching(
          /CC_GRAPH_(RUN_TERMINAL|STALE_ATTEMPT_LEASE)/,
        ),
      }),
    );
  });

  it("donates descendant priority and flags repeated no-progress digests", () => {
    const { kernel, advance } = createKernel({ maxLivelockRepeats: 3 });
    const compiled = graph([
      node("low", { priority: -10 }),
      node("high", { dependsOn: ["low"], priority: 100 }),
      node("other", { priority: 0 }),
    ]);
    startSealed(kernel, compiled, "run-priority");
    advance(2500);
    const ready = kernel.readyNodes("run-priority");
    expect(ready[0]).toMatchObject({
      nodeId: "low",
      priority: { donation: 110, queueWaitMs: 2500 },
    });
    kernel.recordProgressDigest("run-priority", { frontier: ["low", "other"] });
    kernel.recordProgressDigest("run-priority", { frontier: ["low", "other"] });
    const third = kernel.recordProgressDigest("run-priority", {
      frontier: ["low", "other"],
    });
    expect(third.livelockSuspected).toBe(true);
    expect(kernel.getRun("run-priority").status).toBe(
      "reconciliation_required",
    );
  });

  it("propagates the strictest data policy unless an audited decision declassifies", () => {
    const derived = deriveDataPolicy([
      trustedPolicy,
      {
        origin: "mcp:remote",
        trust: "untrusted_content",
        sensitivity: "confidential",
        allowedSinks: ["agent:*", "log:redacted"],
      },
    ]);
    expect(derived).toMatchObject({
      trust: "untrusted_content",
      sensitivity: "confidential",
      allowedSinks: ["agent:*"],
    });
    expect(
      deriveDataPolicy([derived], {
        declassification: {
          decisionId: "decision-1",
          allowedSinks: ["log:redacted"],
        },
      }),
    ).toMatchObject({
      declassificationDecisionId: "decision-1",
      allowedSinks: ["log:redacted"],
    });
  });

  it("binds effect success to an idempotency key and immutable receipt", () => {
    const { kernel } = createKernel();
    const compiled = graph([
      node("effect", {
        effectClass: "external",
        idempotencyKey: "effect-key",
      }),
    ]);
    startSealed(kernel, compiled, "run-effect");
    const attempt = assign(kernel, "run-effect", "effect");
    const effect = kernel.beginEffect("run-effect", {
      effectId: "effect-1",
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      idempotencyKey: "effect-key",
      operationDigest: DIGEST_B,
    });
    expect(() => succeed(kernel, "run-effect", attempt)).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_EFFECT_RECEIPT_REQUIRED" }),
    );
    const committed = kernel.settleEffect("run-effect", {
      effectId: effect.id,
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "committed",
      receipt: { receiptDigest: DIGEST_A, externalId: "remote-1" },
    });
    expect(committed).toMatchObject({
      status: "committed",
      receipt: { receiptDigest: DIGEST_A, externalId: "remote-1" },
    });
    expect(
      kernel.beginEffect("run-effect", {
        effectId: "different-id",
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey: "effect-key",
        operationDigest: DIGEST_B,
      }),
    ).toEqual(committed);
    succeed(kernel, "run-effect", attempt);
    expect(kernel.getRun("run-effect")).toMatchObject({
      status: "succeeded",
      effectIds: ["effect-1"],
    });
  });

  it("moves an in-flight effect to audited reconciliation after crash recovery", () => {
    const context = createKernel();
    const compiled = graph([
      node("effect", {
        effectClass: "external",
        idempotencyKey: "effect-crash-key",
      }),
    ]);
    startSealed(context.kernel, compiled, "run-effect-crash");
    const attempt = assign(context.kernel, "run-effect-crash", "effect");
    context.kernel.beginEffect("run-effect-crash", {
      effectId: "effect-crash",
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      idempotencyKey: "effect-crash-key",
      operationDigest: DIGEST_B,
    });

    const recovered = new GraphKernel({
      eventStore: context.eventStore,
      now: () => 1_700_000_000_000,
    });
    expect(recovered.recoverRun("run-effect-crash")).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: ["effect-crash"],
    });
    expect(() =>
      recovered.reconcileEffect("run-effect-crash", {
        effectId: "effect-crash",
        decision: "committed",
        receipt: { receiptDigest: DIGEST_A },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_RECONCILIATION_AUDIT_REQUIRED",
      }),
    );
    recovered.reconcileEffect("run-effect-crash", {
      effectId: "effect-crash",
      decision: "committed",
      receipt: { receiptDigest: DIGEST_A },
      auditDecisionId: "audit-1",
    });
    const retry = assign(
      recovered,
      "run-effect-crash",
      "effect",
      "agent-2",
      "retry",
    );
    expect(
      recovered.beginEffect("run-effect-crash", {
        effectId: "effect-retry",
        attemptId: retry.id,
        leaseId: retry.leaseId,
        fence: retry.fence,
        idempotencyKey: "effect-crash-key",
        operationDigest: DIGEST_B,
      }),
    ).toMatchObject({ id: "effect-crash", status: "committed" });
    succeed(recovered, "run-effect-crash", retry);
    expect(recovered.getRun("run-effect-crash").status).toBe("succeeded");
  });

  it("executes durable inverse effects in reverse dependency order", () => {
    const context = createKernel();
    const compiled = graph([
      node("apply-a", {
        effectClass: "external",
        idempotencyKey: "apply-a-key",
        compensationNodeId: "undo-a",
      }),
      node("apply-b", {
        dependsOn: ["apply-a"],
        effectClass: "external",
        idempotencyKey: "apply-b-key",
        compensationNodeId: "undo-b",
      }),
      node("fail", { dependsOn: ["apply-b"] }),
      node("undo-a", {
        effectClass: "external",
        idempotencyKey: "undo-a-key",
      }),
      node("undo-b", {
        effectClass: "external",
        idempotencyKey: "undo-b-key",
      }),
    ]);
    startSealed(context.kernel, compiled, "run-compensation");

    for (const [nodeId, effectId, idempotencyKey] of [
      ["apply-a", "effect-apply-a", "apply-a-key"],
      ["apply-b", "effect-apply-b", "apply-b-key"],
    ]) {
      const attempt = assign(
        context.kernel,
        "run-compensation",
        nodeId,
        "agent-1",
      );
      context.kernel.beginEffect("run-compensation", {
        effectId,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey,
        operationDigest: DIGEST_B,
      });
      context.kernel.settleEffect("run-compensation", {
        effectId,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "committed",
        receipt: { receiptDigest: DIGEST_A },
      });
      succeed(context.kernel, "run-compensation", attempt);
    }

    const failed = assign(context.kernel, "run-compensation", "fail");
    context.kernel.settleAttempt("run-compensation", {
      attemptId: failed.id,
      leaseId: failed.leaseId,
      fence: failed.fence,
      outcome: "failed",
      error: "force rollback",
    });
    expect(context.kernel.getRun("run-compensation").status).toBe("partial");
    const started = context.kernel.beginCompensation("run-compensation", {
      triggerNodeId: "fail",
      reason: "forward failure",
    });
    expect(started.compensation).toMatchObject({
      status: "running",
      terminalStatus: "partial",
      plan: [
        { nodeId: "apply-b", compensationNodeId: "undo-b" },
        { nodeId: "apply-a", compensationNodeId: "undo-a" },
      ],
    });

    const recovered = new GraphKernel({
      eventStore: context.eventStore,
      now: () => 1_700_000_000_000,
    });
    expect(recovered.recoverRun("run-compensation").compensation.status).toBe(
      "running",
    );
    expect(recovered.readyNodes("run-compensation")).toEqual([
      expect.objectContaining({
        nodeId: "undo-b",
        compensationForNodeId: "apply-b",
      }),
    ]);

    for (const [nodeId, sourceNodeId, effectId, idempotencyKey] of [
      ["undo-b", "apply-b", "effect-undo-b", "undo-b-key"],
      ["undo-a", "apply-a", "effect-undo-a", "undo-a-key"],
    ]) {
      const attempt = assign(
        recovered,
        "run-compensation",
        nodeId,
        "compensator",
      );
      expect(attempt.compensationForNodeId).toBe(sourceNodeId);
      expect(() =>
        succeed(recovered, "run-compensation", attempt),
      ).toThrowError(
        expect.objectContaining({
          code: "CC_GRAPH_COMPENSATION_RECEIPT_REQUIRED",
        }),
      );
      recovered.beginEffect("run-compensation", {
        effectId,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey,
        operationDigest: DIGEST_B,
      });
      recovered.settleEffect("run-compensation", {
        effectId,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "committed",
        receipt: { receiptDigest: DIGEST_A },
      });
      succeed(recovered, "run-compensation", attempt);
    }

    const terminal = recovered.getRun("run-compensation");
    expect(terminal).toMatchObject({
      status: "partial",
      compensation: {
        status: "completed",
        completedNodeIds: ["apply-b", "apply-a"],
      },
    });
    const effects = Object.fromEntries(
      recovered.events("run-compensation").at(-1).payload.state.effects,
    );
    expect(effects["effect-apply-b"]).toMatchObject({
      status: "compensated",
      compensationEffectId: "effect-undo-b",
    });
    expect(effects["effect-apply-a"]).toMatchObject({
      status: "compensated",
      compensationEffectId: "effect-undo-a",
    });
  });

  it("requires reconciliation when an inverse effect exhausts retries", () => {
    const { kernel } = createKernel();
    const compiled = graph([
      node("apply", {
        effectClass: "external",
        idempotencyKey: "apply-key",
        compensationNodeId: "undo",
      }),
      node("fail", { dependsOn: ["apply"] }),
      node("undo", {
        effectClass: "external",
        idempotencyKey: "undo-key",
      }),
    ]);
    startSealed(kernel, compiled, "run-compensation-failure");
    const applied = assign(kernel, "run-compensation-failure", "apply");
    const effect = kernel.beginEffect("run-compensation-failure", {
      effectId: "effect-apply",
      attemptId: applied.id,
      leaseId: applied.leaseId,
      fence: applied.fence,
      idempotencyKey: "apply-key",
      operationDigest: DIGEST_B,
    });
    kernel.settleEffect("run-compensation-failure", {
      effectId: effect.id,
      attemptId: applied.id,
      leaseId: applied.leaseId,
      fence: applied.fence,
      outcome: "committed",
      receipt: { receiptDigest: DIGEST_A },
    });
    succeed(kernel, "run-compensation-failure", applied);
    const failed = assign(kernel, "run-compensation-failure", "fail");
    kernel.settleAttempt("run-compensation-failure", {
      attemptId: failed.id,
      leaseId: failed.leaseId,
      fence: failed.fence,
      outcome: "failed",
      error: "forward failure",
    });
    kernel.beginCompensation("run-compensation-failure", {
      triggerNodeId: "fail",
    });
    const undo = assign(kernel, "run-compensation-failure", "undo");
    kernel.settleAttempt("run-compensation-failure", {
      attemptId: undo.id,
      leaseId: undo.leaseId,
      fence: undo.fence,
      outcome: "failed",
      error: "remote rollback rejected",
    });

    expect(kernel.getRun("run-compensation-failure")).toMatchObject({
      status: "reconciliation_required",
      compensation: {
        status: "failed",
        failure: {
          nodeId: "apply",
          compensationNodeId: "undo",
          error: "remote rollback rejected",
        },
      },
    });
  });
});
