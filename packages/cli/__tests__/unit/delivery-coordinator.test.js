import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  createDeliveryFlow,
  DELIVERY_ACTION,
  DELIVERY_ACTION_SCHEMA,
  DeliveryCoordinator,
  projectDeliveryFlow,
  requestDeliveryAction,
  restoreDeliveryFlow,
  settleDeliveryAction,
  validateDeliveryActionRequest,
  validateDeliveryActionResult,
  validateDeliveryFlowProjection,
  verifyDeliveryFlowState,
} from "../../src/lib/delivery-coordinator.js";

const HEAD = "a".repeat(40);
const NEXT = "d".repeat(40);
const BASE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const NEXT_DIGEST = `sha256:${"e".repeat(64)}`;
const NOW = "2026-08-01T00:00:00.000Z";

function config(overrides = {}) {
  return {
    flowId: "delivery-test",
    commitSha: HEAD,
    diff: {
      baseCommitSha: BASE,
      headCommitSha: HEAD,
      digest: DIGEST,
      changedFiles: ["src/widget.js"],
    },
    environment: {
      os: "linux",
      arch: "x64",
      runtime: "node",
      runtimeVersion: "22.12.0",
      dependencyDigest: DIGEST,
    },
    requiredGates: [
      {
        id: "cli-ci",
        always: true,
        matrix: ["linux", "windows"],
      },
    ],
    analysis: {
      confidence: 0.99,
      dependencyGraphComplete: true,
      languageServicesComplete: true,
      testHistoryComplete: true,
      classifications: [
        {
          path: "src/widget.js",
          language: "javascript",
          ecosystem: "npm",
          confidence: 0.99,
        },
      ],
    },
    unverified: [],
    sideEffects: [],
    policy: {
      maxRounds: 2,
      maxNoProgressRounds: 1,
      autoMergeEnabled: true,
    },
    ...overrides,
  };
}

function passedGates(commitSha = HEAD) {
  return {
    commitSha,
    results: [
      {
        id: "cli-ci",
        status: "passed",
        commitSha,
        matrix: [
          { id: "linux", status: "passed", commitSha },
          { id: "windows", status: "passed", commitSha },
        ],
      },
    ],
    sideEffects: [],
  };
}

function failedGates(commitSha = HEAD) {
  return {
    commitSha,
    results: [
      {
        id: "cli-ci",
        status: "failed",
        commitSha,
        message: "unit failed",
        matrix: [
          { id: "linux", status: "failed", commitSha },
          { id: "windows", status: "passed", commitSha },
        ],
      },
    ],
    failures: [
      {
        id: "unit-a",
        gateId: "cli-ci",
        test: "widget.test.js",
        file: "src/widget.js",
        line: 12,
        hunk: "@@ -10,4 +10,5 @@",
        turnId: "turn-3",
        toolCallId: "tool-7",
        message: "expected true",
      },
    ],
    sideEffects: [],
  };
}

function preview(commitSha = HEAD) {
  return {
    commitSha,
    passed: true,
    artifacts: [
      {
        kind: "test-result",
        data: {
          tier: "static-check",
          passed: true,
          total: 2,
          failed: 0,
          output: "all passed",
        },
      },
    ],
    sideEffects: [],
  };
}

function review(commitSha = HEAD) {
  const finding = {
    path: "src/widget.js",
    line: 4,
    title: "Minor naming",
    severity: "Low",
    confidence: 0.8,
    category: "correctness",
    failureScenario: "Name is ambiguous",
    evidence: "local variable",
  };
  return {
    commitSha,
    rawFindings: [
      { ...finding, dimension: "correctness" },
      { ...finding, dimension: "tests", confidence: 0.7 },
    ],
    sideEffects: [],
  };
}

function fakeAdapter() {
  const adapter = {
    runGates: vi.fn(async () => passedGates()),
    runPreview: vi.fn(async () => preview()),
    runReview: vi.fn(async () => review()),
    applyFix: vi.fn(),
    createPr: vi.fn(async () => ({
      number: 42,
      hasOpenPr: true,
      headCommitSha: HEAD,
      url: "https://example.invalid/pr/42",
      sideEffects: [{ id: "pr-42", status: "committed" }],
    })),
    refreshCi: vi.fn(async () => ({
      headCommitSha: HEAD,
      ciCommitSha: HEAD,
      branchProtectionSatisfied: true,
      reviewApproved: true,
      pendingApprovals: 0,
      requiredMatrixComplete: true,
      requiredChecks: ["ci/linux", "ci/windows"],
      checks: [
        { name: "ci/linux", state: "success", commitSha: HEAD },
        { name: "ci/windows", state: "success", commitSha: HEAD },
      ],
      sideEffects: [],
    })),
    publishEvidence: vi.fn(async (payload) => ({
      artifact: {
        id: "artifact-1",
        immutable: true,
        recordDigest: payload.record.recordDigest,
      },
      sideEffects: [{ id: "artifact-1", status: "committed" }],
    })),
    merge: vi.fn(async () => ({
      merged: true,
      headCommitSha: HEAD,
      mergeCommitSha: "f".repeat(40),
      sideEffects: [{ id: "merge-42", status: "committed" }],
    })),
    archive: vi.fn(async () => ({
      archived: true,
      preservedUncommitted: true,
      preservedUnpushed: true,
      sideEffects: [{ id: "archive-42", status: "committed" }],
    })),
  };
  return adapter;
}

describe("DeliveryCoordinator", () => {
  it("runs the explicit happy-path actions through shared primitives", async () => {
    const adapter = fakeAdapter();
    const coordinator = new DeliveryCoordinator({
      config: config(),
      adapter,
      now: NOW,
    });
    const actions = [
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.CREATE_PR,
      DELIVERY_ACTION.REFRESH_CI,
      DELIVERY_ACTION.PUBLISH_EVIDENCE,
      DELIVERY_ACTION.MERGE,
      DELIVERY_ACTION.ARCHIVE,
    ];
    for (const action of actions) await coordinator.execute(action);

    const state = coordinator.snapshot();
    expect(state).toMatchObject({
      status: "completed",
      phase: "completed",
      round: 0,
      merge: { merged: true, headCommitSha: HEAD },
      archive: {
        archived: true,
        preservedUncommitted: true,
        preservedUnpushed: true,
      },
    });
    expect(state.review.report.summary.total).toBe(1); // deduped
    expect(state.review.status).toBe("approved");
    expect(state.previewArtifacts[0]).toMatchObject({
      kind: "test-result",
      passed: true,
    });
    expect(state.evidence).toMatchObject({
      readiness: { ready: true, reason: "ok" },
      artifact: { id: "artifact-1", immutable: true },
    });
    expect(verifyDeliveryFlowState(state)).toMatchObject({ valid: true });
    expect(projectDeliveryFlow(state).availableActions).toEqual([]);
    expect(adapter.merge).toHaveBeenCalledTimes(1);
  });

  it("maps failures to file/test/hunk/turn/tool and reruns after a real fix", () => {
    let state = createDeliveryFlow(config(), { now: NOW });
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(state, state.pendingEffect.id, failedGates(), {
      now: NOW,
    });
    expect(projectDeliveryFlow(state)).toMatchObject({
      phase: "fix",
      availableActions: ["apply_fix"],
    });
    expect(state.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/widget.js",
          test: "widget.test.js",
          hunk: "@@ -10,4 +10,5 @@",
          turnId: "turn-3",
          toolCallId: "tool-7",
        }),
      ]),
    );

    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.APPLY_FIX,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(
      state,
      state.pendingEffect.id,
      {
        changed: true,
        commitSha: NEXT,
        diffDigest: NEXT_DIGEST,
        progressDigest: `sha256:${"9".repeat(64)}`,
        sideEffects: [{ id: "fix-1", status: "committed" }],
      },
      { now: NOW },
    );
    expect(state).toMatchObject({
      phase: "gates",
      round: 1,
      commitSha: NEXT,
      diff: { headCommitSha: NEXT, digest: NEXT_DIGEST },
      gateSelection: {
        mode: "full",
        fallback: true,
        selectedGateIds: ["cli-ci"],
      },
      failures: [],
    });
  });

  it("stops at max rounds after a rerun fails again", () => {
    let state = createDeliveryFlow(
      config({ policy: { maxRounds: 1, autoMergeEnabled: true } }),
      { now: NOW },
    );
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(state, state.pendingEffect.id, failedGates(), {
      now: NOW,
    });
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.APPLY_FIX,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(
      state,
      state.pendingEffect.id,
      {
        changed: true,
        commitSha: NEXT,
        diffDigest: NEXT_DIGEST,
        progressDigest: `sha256:${"9".repeat(64)}`,
        sideEffects: [],
      },
      { now: NOW },
    );
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(
      state,
      state.pendingEffect.id,
      failedGates(NEXT),
      { now: NOW },
    );
    expect(state).toMatchObject({
      status: "stopped",
      phase: "evidence",
      stopReason: "max-rounds-reached",
      round: 1,
    });
    expect(projectDeliveryFlow(state).availableActions).toEqual([
      "publish_evidence",
    ]);
  });

  it("stops when a fix reports no progress", () => {
    let state = createDeliveryFlow(config(), { now: NOW });
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(state, state.pendingEffect.id, failedGates(), {
      now: NOW,
    });
    state = requestDeliveryAction(
      state,
      DELIVERY_ACTION.APPLY_FIX,
      {},
      { now: NOW },
    );
    state = settleDeliveryAction(
      state,
      state.pendingEffect.id,
      { changed: false, sideEffects: [] },
      { now: NOW },
    );
    expect(state).toMatchObject({
      status: "stopped",
      stopReason: "no-progress",
      noProgressRounds: 1,
      round: 1,
    });
  });

  it("restores a pending effect without replaying the adapter", () => {
    const adapter = fakeAdapter();
    const initial = createDeliveryFlow(config(), { now: NOW });
    const pending = requestDeliveryAction(
      initial,
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    const restored = new DeliveryCoordinator({
      state: JSON.parse(JSON.stringify(pending)),
      adapter,
      now: NOW,
    });
    expect(adapter.runGates).not.toHaveBeenCalled();
    expect(restored.projection()).toMatchObject({
      pendingEffect: { action: "run_gates" },
      availableActions: [],
    });
    restored.settle(pending.pendingEffect.id, passedGates());
    expect(restored.projection().phase).toBe("preview");
  });

  it("leaves an adapter-throw effect pending for explicit adjudication", async () => {
    const adapter = fakeAdapter();
    adapter.runGates.mockRejectedValueOnce(new Error("connection dropped"));
    const coordinator = new DeliveryCoordinator({
      config: config(),
      adapter,
      now: NOW,
    });
    await expect(
      coordinator.execute(DELIVERY_ACTION.RUN_GATES),
    ).rejects.toThrow("connection dropped");
    expect(coordinator.snapshot().pendingEffect).toMatchObject({
      action: "run_gates",
    });
    expect(coordinator.projection().availableActions).toEqual([]);
  });

  it("never exposes merge when CI targets a stale commit", async () => {
    const adapter = fakeAdapter();
    adapter.refreshCi.mockResolvedValueOnce({
      headCommitSha: HEAD,
      ciCommitSha: BASE,
      branchProtectionSatisfied: true,
      reviewApproved: true,
      pendingApprovals: 0,
      requiredMatrixComplete: true,
      requiredChecks: ["ci/linux"],
      checks: [{ name: "ci/linux", state: "success", commitSha: HEAD }],
      sideEffects: [],
    });
    const coordinator = new DeliveryCoordinator({
      config: config(),
      adapter,
      now: NOW,
    });
    for (const action of [
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.CREATE_PR,
      DELIVERY_ACTION.REFRESH_CI,
    ]) {
      await coordinator.execute(action);
    }
    expect(coordinator.snapshot()).toMatchObject({
      status: "blocked",
      phase: "evidence",
      mergeDecision: { allow: false },
    });
    expect(coordinator.snapshot().mergeDecision.unmet).toContain(
      "ci-head-mismatch",
    );
    expect(coordinator.projection().availableActions).toEqual([
      "publish_evidence",
    ]);
    expect(adapter.merge).not.toHaveBeenCalled();
  });

  it("reuses the existing PR after a CI fix instead of creating a duplicate", async () => {
    const adapter = fakeAdapter();
    adapter.refreshCi.mockResolvedValueOnce({
      headCommitSha: HEAD,
      ciCommitSha: HEAD,
      branchProtectionSatisfied: true,
      reviewApproved: true,
      pendingApprovals: 0,
      requiredMatrixComplete: true,
      requiredChecks: ["ci/linux"],
      checks: [
        {
          name: "ci/linux",
          state: "failure",
          commitSha: HEAD,
          file: "src/widget.js",
          test: "widget.test.js",
        },
      ],
      sideEffects: [],
    });
    adapter.applyFix.mockResolvedValueOnce({
      changed: true,
      commitSha: NEXT,
      diffDigest: NEXT_DIGEST,
      progressDigest: `sha256:${"9".repeat(64)}`,
      sideEffects: [{ id: "fix-ci", status: "committed" }],
    });
    adapter.runGates
      .mockResolvedValueOnce(passedGates(HEAD))
      .mockResolvedValueOnce(passedGates(NEXT));
    adapter.runPreview
      .mockResolvedValueOnce(preview(HEAD))
      .mockResolvedValueOnce(preview(NEXT));
    adapter.runReview
      .mockResolvedValueOnce(review(HEAD))
      .mockResolvedValueOnce(review(NEXT));

    const coordinator = new DeliveryCoordinator({
      config: config(),
      adapter,
      now: NOW,
    });
    for (const action of [
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.CREATE_PR,
      DELIVERY_ACTION.REFRESH_CI,
      DELIVERY_ACTION.APPLY_FIX,
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
    ]) {
      await coordinator.execute(action);
    }
    expect(coordinator.snapshot()).toMatchObject({
      phase: "ci",
      commitSha: NEXT,
      pr: { number: 42, hasOpenPr: true, headCommitSha: NEXT },
    });
    expect(adapter.createPr).toHaveBeenCalledTimes(1);
  });

  it("fails archive closed unless uncommitted and unpushed work is preserved", async () => {
    const adapter = fakeAdapter();
    adapter.archive.mockResolvedValueOnce({ archived: true, sideEffects: [] });
    const coordinator = new DeliveryCoordinator({
      config: config(),
      adapter,
      now: NOW,
    });
    for (const action of [
      DELIVERY_ACTION.RUN_GATES,
      DELIVERY_ACTION.RUN_PREVIEW,
      DELIVERY_ACTION.RUN_REVIEW,
      DELIVERY_ACTION.CREATE_PR,
      DELIVERY_ACTION.REFRESH_CI,
      DELIVERY_ACTION.PUBLISH_EVIDENCE,
      DELIVERY_ACTION.MERGE,
      DELIVERY_ACTION.ARCHIVE,
    ]) {
      await coordinator.execute(action);
    }
    expect(coordinator.snapshot()).toMatchObject({
      status: "stopped",
      phase: "archive",
      stopReason: "archive-safety-unverified",
      archive: null,
    });
  });

  it("blocks before external actions when exact delivery identity is missing", () => {
    const state = createDeliveryFlow(
      config({
        commitSha: "abc123",
        diff: {
          baseCommitSha: BASE,
          headCommitSha: "abc123",
          digest: DIGEST,
          changedFiles: ["src/widget.js"],
        },
      }),
      { now: NOW },
    );
    expect(state).toMatchObject({
      status: "blocked",
      phase: "evidence",
      stopReason: "commit-sha-not-exact",
    });
    expect(projectDeliveryFlow(state).availableActions).toEqual([
      "publish_evidence",
    ]);
  });

  it("emits a versioned action request bound to revision and state digest", () => {
    const state = requestDeliveryAction(
      createDeliveryFlow(config(), { now: NOW }),
      DELIVERY_ACTION.RUN_GATES,
      {},
      { now: NOW },
    );
    expect(state.pendingEffect).toMatchObject({
      schema: DELIVERY_ACTION_SCHEMA,
      version: 1,
      flowId: "delivery-test",
      expectedRevision: 1,
      action: "run_gates",
    });
    expect(validateDeliveryActionRequest(state.pendingEffect)).toEqual({
      valid: true,
      reason: "ok",
      unmet: [],
    });
    expect(() => restoreDeliveryFlow(state)).not.toThrow();
  });

  it("does not let caller payload override coordinator-owned commit bindings", () => {
    const initial = createDeliveryFlow(config(), { now: NOW });
    const pending = requestDeliveryAction(
      initial,
      DELIVERY_ACTION.RUN_GATES,
      {
        commitSha: NEXT,
        flowId: "forged-flow",
        revision: 999,
        baseCommitSha: "e".repeat(40),
        changedFiles: ["forged.js"],
        gateSelection: { selectedGateIds: [] },
        requiredGates: [],
        callerNote: "preserved",
      },
      { now: NOW },
    );

    expect(pending.pendingEffect.payload).toMatchObject({
      flowId: initial.flowId,
      revision: initial.revision,
      commitSha: HEAD,
      baseCommitSha: BASE,
      changedFiles: ["src/widget.js"],
      gateSelection: initial.gateSelection,
      requiredGates: initial.requiredGates,
      callerNote: "preserved",
    });
  });

  it("rejects a mutated recovery snapshot", () => {
    const state = JSON.parse(
      JSON.stringify(createDeliveryFlow(config(), { now: NOW })),
    );
    state.phase = "merge";
    expect(verifyDeliveryFlowState(state)).toMatchObject({
      valid: false,
      reason: "state-digest-mismatch",
    });
    expect(() => restoreDeliveryFlow(state)).toThrow(/state-digest-mismatch/);
  });

  it("normalizes and hash-protects causal session bindings", () => {
    const state = createDeliveryFlow(
      config({
        causality: {
          scope: {
            workspaceId: " workspace-1 ",
            teamId: " team-a ",
            policyId: " policy-release ",
          },
          sessions: [
            {
              sessionId: " session-b ",
              headHash: "B".repeat(64),
              eventCount: "8",
            },
            {
              sessionId: "session-a",
              headHash: "a".repeat(64),
              eventCount: 3,
            },
          ],
        },
      }),
      { now: NOW },
    );

    expect(state.causality).toEqual({
      scope: {
        workspaceId: "workspace-1",
        teamId: "team-a",
        policyId: "policy-release",
      },
      sessions: [
        {
          sessionId: "session-a",
          headHash: "a".repeat(64),
          eventCount: 3,
        },
        {
          sessionId: "session-b",
          headHash: "b".repeat(64),
          eventCount: 8,
        },
      ],
    });
    expect(verifyDeliveryFlowState(state)).toMatchObject({ valid: true });

    const reordered = JSON.parse(JSON.stringify(state));
    reordered.causality.sessions.reverse();
    expect(verifyDeliveryFlowState(reordered)).toMatchObject({
      valid: false,
      reason: "causality-noncanonical",
    });
  });

  it.each([
    [
      "duplicate session ids after normalization",
      [
        { sessionId: "session-a", headHash: "a".repeat(64), eventCount: 1 },
        {
          sessionId: " session-a ",
          headHash: "b".repeat(64),
          eventCount: 2,
        },
      ],
      /duplicate sessionId/,
    ],
    [
      "an unsafe session id",
      [{ sessionId: "../session-a", headHash: "a".repeat(64), eventCount: 1 }],
      /sessionId is unsafe/,
    ],
    [
      "an invalid transcript head",
      [{ sessionId: "session-a", headHash: "abc", eventCount: 1 }],
      /headHash is invalid/,
    ],
    [
      "a non-positive transcript event count",
      [{ sessionId: "session-a", headHash: "a".repeat(64), eventCount: 0 }],
      /positive safe integer/,
    ],
  ])("rejects causal bindings with %s", (_label, sessions, expected) => {
    expect(() =>
      createDeliveryFlow(
        config({
          causality: { scope: { workspaceId: "workspace-1" }, sessions },
        }),
        { now: NOW },
      ),
    ).toThrow(expected);
  });

  it.each(["", " ", "\t"])(
    "rejects an explicitly blank causal scope value %j",
    (workspaceId) => {
      expect(() =>
        createDeliveryFlow(
          config({
            causality: {
              scope: { workspaceId },
              sessions: [],
            },
          }),
          { now: NOW },
        ),
      ).toThrow(/causality\.scope\.workspaceId must not be blank/);
    },
  );

  it("requires at least one scope dimension when sessions are bound", () => {
    expect(() =>
      createDeliveryFlow(
        config({
          causality: {
            scope: { workspaceId: null, teamId: null, policyId: null },
            sessions: [
              {
                sessionId: "session-a",
                headHash: "a".repeat(64),
                eventCount: 1,
              },
            ],
          },
        }),
        { now: NOW },
      ),
    ).toThrow(/scope requires at least one dimension/);
  });

  it("sorts causal session bindings by deterministic code-unit order", () => {
    const binding = (sessionId, head) => ({
      sessionId,
      headHash: head.repeat(64),
      eventCount: 1,
    });
    const sessions = [binding("ä-session", "a"), binding("z-session", "b")];
    const create = (bindings) =>
      createDeliveryFlow(
        config({
          flowId: undefined,
          causality: {
            scope: { workspaceId: "workspace-1" },
            sessions: bindings,
          },
        }),
        { now: NOW },
      );

    const forward = create(sessions);
    const reversed = create([...sessions].reverse());
    expect(
      forward.causality.sessions.map(({ sessionId }) => sessionId),
    ).toEqual(["z-session", "ä-session"]);
    expect(reversed).toEqual(forward);
  });

  it("keeps legacy flow identity and state unchanged for empty causality", () => {
    const base = config({ flowId: undefined });
    const legacy = createDeliveryFlow(base, { now: NOW });
    const empty = createDeliveryFlow(
      {
        ...base,
        causality: {
          scope: { workspaceId: null, teamId: null, policyId: undefined },
          sessions: [],
        },
      },
      { now: NOW },
    );

    expect(empty).toEqual(legacy);
    expect(empty.flowId).toBe(legacy.flowId);
    expect(empty).not.toHaveProperty("causality");
  });

  it("validates the same host fixture consumed by VS Code and JetBrains", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        new URL(
          "../../../agent-sdk/__fixtures__/delivery-workflow/cases.json",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    for (const testCase of fixture.projectionCases) {
      expect(validateDeliveryFlowProjection(testCase.value).valid).toBe(
        testCase.valid,
      );
    }
    for (const testCase of fixture.actionCases) {
      expect(validateDeliveryActionRequest(testCase.value).valid).toBe(
        testCase.valid,
      );
    }
    for (const testCase of fixture.resultCases) {
      expect(validateDeliveryActionResult(testCase.value).valid).toBe(
        testCase.valid,
      );
    }
  });
});
