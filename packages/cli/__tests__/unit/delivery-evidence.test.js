import { describe, expect, it } from "vitest";
import {
  assessDeliveryEvidence,
  createDeliveryEvidenceRecord,
  DELIVERY_EVIDENCE_SCHEMA,
  verifyDeliveryEvidenceRecord,
} from "../../src/lib/delivery-evidence.js";
import {
  IMPACTED_GATE_SELECTION_SCHEMA,
  IMPACTED_GATE_SELECTION_VERSION,
} from "../../src/lib/impacted-gate-selector.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;

function validInput(overrides = {}) {
  const requiredChecks = ["cli-ci/linux", "cli-ci/windows", "cli-ci/macos"];
  return {
    commit: { sha: HEAD },
    diff: {
      baseCommitSha: BASE,
      headCommitSha: HEAD,
      digest: DIGEST,
      changedFiles: ["packages/cli/src/lib/example.js"],
    },
    environment: {
      os: "linux",
      arch: "x64",
      runtime: "node",
      runtimeVersion: "22.12.0",
      dependencyLockDigest: DIGEST,
    },
    gates: {
      selection: {
        schema: IMPACTED_GATE_SELECTION_SCHEMA,
        version: IMPACTED_GATE_SELECTION_VERSION,
        decision: "selected",
        mode: "full",
        fallback: true,
        reason: "confidence-insufficient",
        reasons: ["confidence-insufficient"],
        requiredGateIds: ["cli-ci", "review"],
        selectedGateIds: ["cli-ci", "review"],
      },
      required: [
        { id: "cli-ci", matrix: ["linux", "windows", "macos"] },
        { id: "review", matrix: [] },
      ],
      results: [
        {
          id: "cli-ci",
          status: "passed",
          commitSha: HEAD,
          matrix: [
            { id: "linux", status: "passed", commitSha: HEAD },
            { id: "windows", status: "passed", commitSha: HEAD },
            { id: "macos", status: "passed", commitSha: HEAD },
          ],
        },
        { id: "review", status: "passed", commitSha: HEAD, matrix: [] },
      ],
    },
    review: {
      status: "approved",
      commitSha: HEAD,
      reportDigest: DIGEST,
      findingsCount: 0,
    },
    unverified: [],
    sideEffects: [],
    pr: {
      number: 42,
      autoMergeEnabled: true,
      hasOpenPr: true,
      branchProtectionSatisfied: true,
      reviewApproved: true,
      pendingApprovals: 0,
      headCommitSha: HEAD,
      ciCommitSha: HEAD,
      requiredMatrixComplete: true,
      requiredChecks,
      checks: requiredChecks.map((name) => ({
        name,
        state: "success",
        commitSha: HEAD,
      })),
    },
    artifacts: [{ kind: "preview", digest: DIGEST }],
    ...overrides,
  };
}

describe("delivery evidence record", () => {
  it("creates a versioned, deterministic, deeply immutable record", () => {
    const now = "2026-08-01T00:00:00.000Z";
    const first = createDeliveryEvidenceRecord(validInput(), { now });
    const second = createDeliveryEvidenceRecord(validInput(), { now });
    expect(first).toMatchObject({
      schema: DELIVERY_EVIDENCE_SCHEMA,
      version: 1,
      createdAt: now,
      recordDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(first.recordDigest).toBe(second.recordDigest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.gates.results)).toBe(true);
    expect(verifyDeliveryEvidenceRecord(first)).toMatchObject({
      valid: true,
      reason: "ok",
    });
  });

  it("passes only with exact commits, complete matrices and settled effects", () => {
    const record = createDeliveryEvidenceRecord(validInput(), {
      now: "2026-08-01T00:00:00.000Z",
    });
    expect(assessDeliveryEvidence(record)).toMatchObject({
      ready: true,
      reason: "ok",
      commitSha: HEAD,
      prDecision: { allow: true, reason: "ok" },
    });
  });

  it("detects mutation of a previously issued record", () => {
    const record = createDeliveryEvidenceRecord(validInput(), {
      now: "2026-08-01T00:00:00.000Z",
    });
    const tampered = JSON.parse(JSON.stringify(record));
    tampered.review.status = "rejected";
    expect(verifyDeliveryEvidenceRecord(tampered)).toMatchObject({
      valid: false,
      reason: "record-digest-mismatch",
    });
    expect(assessDeliveryEvidence(tampered).unmet).toContain(
      "record-digest-mismatch",
    );
  });

  it("fails closed on a partial matrix or stale gate result", () => {
    const input = validInput();
    input.gates.results[0].matrix.pop();
    input.gates.results[0].commitSha = BASE;
    const decision = assessDeliveryEvidence(
      createDeliveryEvidenceRecord(input, {
        now: "2026-08-01T00:00:00.000Z",
      }),
    );
    expect(decision.ready).toBe(false);
    expect(decision.unmet).toContain("gate-matrix-cell-missing:cli-ci:macos");
    expect(decision.unmet).toContain("gate-commit-mismatch:cli-ci");
  });

  it("fails closed when CI targets an old head", () => {
    const input = validInput();
    input.pr.ciCommitSha = BASE;
    const decision = assessDeliveryEvidence(
      createDeliveryEvidenceRecord(input, {
        now: "2026-08-01T00:00:00.000Z",
      }),
    );
    expect(decision.unmet).toContain("pr-ci-commit-mismatch");
    expect(decision.unmet).toContain("pr:ci-head-mismatch");
    expect(decision.prDecision.allow).toBe(false);
  });

  it("fails closed on unknown items or an unadjudicated side effect", () => {
    const input = validInput({
      unverified: ["preview-network-not-captured"],
      sideEffects: [{ id: "publish-1", status: "unknown" }],
    });
    const decision = assessDeliveryEvidence(
      createDeliveryEvidenceRecord(input, {
        now: "2026-08-01T00:00:00.000Z",
      }),
    );
    expect(decision.unmet).toContain("unverified-items-present");
    expect(decision.unmet).toContain("side-effect-unresolved:publish-1");
    expect(decision.unmet).toContain("pr:side-effect-unresolved:publish-1");
  });
});
