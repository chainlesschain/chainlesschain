/**
 * PromptOptimizer 单元测试 — v2.1.0
 *
 * 覆盖：initialize、recordExecution（SHA-256 hash）、createVariant、
 *       optimizePrompt（no-data / analyzed）、compareVariants、getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { PromptOptimizer, getPromptOptimizer } = require("../prompt-optimizer");
const {
  ARTIFACT_TYPE,
  EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  createEvolvableArtifactActiveReleaseReader,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  createEvolvableArtifactReceipt,
  createEvolvableArtifactReleaseGate,
  digestEvolvableArtifactValue: digest,
} = require("@chainlesschain/session-core/evolvable-artifact");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVariantRow(overrides = {}) {
  return {
    id: "var-001",
    skill_name: "code-review",
    variant_name: "v1",
    prompt_text: "Review this code carefully",
    success_rate: 0.75,
    use_count: 10,
    is_active: 1,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0, avg: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

function manifest(body) {
  return { ...body, digest: digest(body) };
}

function artifactCandidate() {
  const dependencies = [];
  return {
    parent: null,
    lineage: [],
    dependencyLock: {
      dependencies,
      digest: digest({ dependencies }),
    },
    runtimeManifest: manifest({
      executable: false,
      dataPolicyDigest: digest("prompt-data-policy"),
    }),
    permissionManifest: manifest({ capabilities: [] }),
  };
}

function createPromptCandidateGate() {
  const revision = "prompt-policy-v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const policy = createEvolvableArtifactPolicy({
    type: ARTIFACT_TYPE.PROMPT,
    revision,
    admission: allow,
    evaluator: allow,
    activation: allow,
    rollback: allow,
  });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy,
  });
  return createEvolvableArtifactCandidateGate({
    authority,
    candidateWriter: {
      async persistCandidate(artifact) {
        return {
          schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
          tenantId: artifact.tenantId,
          type: artifact.type,
          artifactId: artifact.artifactId,
          candidateId: artifact.candidate.candidateId,
          contentDigest: artifact.contentDigest,
          artifactDigest: artifact.artifactDigest,
          status: "candidate",
          persisted: true,
        };
      },
    },
  });
}

function artifactReceipt(artifact, kind) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `${kind}-authority`,
    issuerRevision: `${kind}-v1`,
    issuedAt: "2026-09-04T00:00:00.000Z",
    decision: "allow",
  });
}

function createPromptActiveReleaseReader(promptText = "Use the active prompt") {
  const revision = "prompt-policy-v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.PROMPT,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  let artifact = authority.stageCandidate({
    ...artifactCandidate(),
    tenantId: "tenant-a",
    artifactId: "prompt:code-review",
    candidateId: "prompt-candidate-active",
    type: ARTIFACT_TYPE.PROMPT,
    contentDigest: digest(promptText),
    lineage: [digest(promptText)],
  });
  artifact = authority.recordEvaluation(
    artifact,
    artifactReceipt(artifact, "eval"),
  );
  artifact = authority.activateCandidate(artifact, {
    reviewReceipt: artifactReceipt(artifact, "review"),
    promotionReceipt: artifactReceipt(artifact, "promotion"),
    releaseId: "prompt-release-active",
  });
  const active = {
    schema: EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: artifact.tenantId,
    type: artifact.type,
    artifactId: artifact.artifactId,
    releaseId: artifact.activeReleaseId,
    contentDigest: artifact.contentDigest,
    artifactDigest: artifact.artifactDigest,
    artifact,
    contentAvailable: true,
    content: promptText,
  };
  const releaseGate = createEvolvableArtifactReleaseGate({
    authority,
    transitionWriter: { async commitTransition() {} },
    transitionReader: { async readTransition() {} },
  });
  return createEvolvableArtifactActiveReleaseReader({
    releaseGate,
    provider: {
      async listActive() {
        return [active];
      },
      async readActive({ artifactId }) {
        return artifactId === active.artifactId ? active : null;
      },
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PromptOptimizer", () => {
  let po;
  let db;

  beforeEach(() => {
    po = new PromptOptimizer({
      artifactCandidateGate: createPromptCandidateGate(),
    });
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await po.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(po.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await po.initialize(db);
      await po.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should call getStats after table creation", async () => {
      // getStats does COUNT queries — verify no exceptions
      await expect(po.initialize(db)).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // recordExecution
  // ─────────────────────────────────────────────────────────────────────────
  describe("recordExecution()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should throw when skillName is missing", () => {
      expect(() => po.recordExecution({ promptText: "test" })).toThrow(
        "skillName is required",
      );
    });

    it("should return execution object with id and promptHash", () => {
      const exec = po.recordExecution({
        skillName: "summarize",
        promptText: "Summarize the following text",
        resultSuccess: true,
        executionTimeMs: 500,
      });

      expect(exec.id).toBeTruthy();
      expect(exec.promptHash).toBeTruthy();
      expect(exec.promptHash).toHaveLength(16); // slice(0,16) of sha256
    });

    it("should produce consistent SHA-256 hash for same prompt text", () => {
      const exec1 = po.recordExecution({
        skillName: "s1",
        promptText: "hello world",
      });
      const exec2 = po.recordExecution({
        skillName: "s1",
        promptText: "hello world",
      });

      expect(exec1.promptHash).toBe(exec2.promptHash);
    });

    it("should produce different hashes for different prompt text", () => {
      const exec1 = po.recordExecution({
        skillName: "s1",
        promptText: "prompt A",
      });
      const exec2 = po.recordExecution({
        skillName: "s1",
        promptText: "prompt B",
      });

      expect(exec1.promptHash).not.toBe(exec2.promptHash);
    });

    it("should store resultSuccess as 0/1 integer", () => {
      const execSuccess = po.recordExecution({
        skillName: "s1",
        resultSuccess: true,
      });
      const execFail = po.recordExecution({
        skillName: "s1",
        resultSuccess: false,
      });

      expect(execSuccess.resultSuccess).toBe(1);
      expect(execFail.resultSuccess).toBe(0);
    });

    it("should persist to DB via db.run()", () => {
      po.recordExecution({ skillName: "s1", promptText: "test" });

      expect(db.run).toHaveBeenCalled();
    });

    it("should handle empty promptText gracefully", () => {
      const exec = po.recordExecution({ skillName: "s1" });
      expect(exec.promptHash).toBeTruthy(); // hash of ""
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createVariant
  // ─────────────────────────────────────────────────────────────────────────
  describe("createVariant()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should throw when skillName or promptText missing", async () => {
      await expect(po.createVariant({ skillName: "s1" })).rejects.toThrow(
        "skillName and promptText are required",
      );
      await expect(po.createVariant({ promptText: "test" })).rejects.toThrow(
        "skillName and promptText are required",
      );
    });

    it("should stage a persisted candidate and never mark it active", async () => {
      const variant = await po.createVariant({
        skillName: "code-review",
        variantName: "v-concise",
        promptText: "Be concise. Review the code.",
        artifactCandidate: artifactCandidate(),
      });

      expect(variant.id).toBeTruthy();
      expect(variant.isActive).toBe(false);
      expect(variant.lifecycle).toBe("candidate");
      expect(variant.persistenceReceipt.persisted).toBe(true);
      expect(variant.successRate).toBe(0);
      expect(variant.useCount).toBe(0);
    });

    it("should auto-generate variantName when not provided", async () => {
      const variant = await po.createVariant({
        skillName: "summarize",
        promptText: "Summarize",
        artifactCandidate: artifactCandidate(),
      });

      expect(variant.variantName).toBeTruthy();
      expect(variant.variantName).toMatch(/^variant-/);
    });

    it("should persist the local projection as inactive", async () => {
      await po.createVariant({
        skillName: "s1",
        promptText: "p1",
        artifactCandidate: artifactCandidate(),
      });
      expect(db.run).toHaveBeenCalled();
      expect(db.run.mock.calls.at(-1)[1][6]).toBe(0);
    });

    it("fails closed when the governed candidate gate is absent", async () => {
      const ungated = new PromptOptimizer();
      await ungated.initialize(db);
      await expect(
        ungated.createVariant({
          skillName: "s1",
          promptText: "p1",
          artifactCandidate: artifactCandidate(),
        }),
      ).rejects.toMatchObject({
        code: "CC_PROMPT_EVOLUTION_CANDIDATE_GATE_UNAVAILABLE",
      });
    });
  });

  describe("getActiveVariant()", () => {
    it("fails closed instead of trusting the local is_active projection", async () => {
      await po.initialize(db);
      db._prep.get.mockReturnValueOnce(makeVariantRow());

      await expect(po.getActiveVariant("code-review")).rejects.toMatchObject({
        code: "CC_PROMPT_ACTIVE_RELEASE_READER_UNAVAILABLE",
      });
    });

    it("rejects an unbranded active release reader", () => {
      expect(
        () =>
          new PromptOptimizer({
            artifactActiveReleaseReader: { type: ARTIFACT_TYPE.PROMPT },
          }),
      ).toThrow(/branded prompt active release reader/);
    });

    it("returns exact content only from the active Prompt release", async () => {
      const governed = new PromptOptimizer({
        artifactCandidateGate: createPromptCandidateGate(),
        artifactActiveReleaseReader: createPromptActiveReleaseReader(),
      });
      await governed.initialize(db);
      db.prepare.mockClear();

      await expect(
        governed.getActiveVariant("code-review"),
      ).resolves.toMatchObject({
        id: "prompt-candidate-active",
        skillName: "code-review",
        variantName: "prompt-release-active",
        promptText: "Use the active prompt",
        isActive: true,
        lifecycle: "active",
        releaseId: "prompt-release-active",
      });
      expect(db.prepare).not.toHaveBeenCalled();
      await expect(governed.getActiveVariant("unknown")).resolves.toBeNull();
    });

    it("upgrades an existing singleton with the host-owned active reader", () => {
      const existing = getPromptOptimizer({
        artifactCandidateGate: createPromptCandidateGate(),
      });
      const reader = createPromptActiveReleaseReader();

      expect(getPromptOptimizer({ artifactActiveReleaseReader: reader })).toBe(
        existing,
      );
      expect(existing.artifactActiveReleaseReader).toBe(reader);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // optimizePrompt
  // ─────────────────────────────────────────────────────────────────────────
  describe("optimizePrompt()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return no-data status when no execution history", () => {
      db._prep.all.mockReturnValueOnce([]); // hashStats = []

      const result = po.optimizePrompt("unknown-skill");

      expect(result.status).toBe("no-data");
      expect(result.skillName).toBe("unknown-skill");
    });

    it("should return analyzed status when execution history exists", () => {
      const hashStats = [
        {
          prompt_hash: "abc123",
          prompt_text: "Review carefully",
          total: 10,
          successes: 8,
          avg_time: 300,
        },
        {
          prompt_hash: "def456",
          prompt_text: "Quick review",
          total: 5,
          successes: 2,
          avg_time: 150,
        },
      ];
      db._prep.all
        .mockReturnValueOnce(hashStats) // hashStats query
        .mockReturnValueOnce([]); // failures query

      const result = po.optimizePrompt("code-review");

      expect(result.status).toBe("analyzed");
      expect(result.skillName).toBe("code-review");
      expect(result.variants).toHaveLength(2);
      expect(result.best).toBeDefined();
      expect(result.best.successRate).toBeCloseTo(0.8, 2);
    });

    it("should suggest variant-performance-gap when gap > 0.1", () => {
      const hashStats = [
        {
          prompt_hash: "h1",
          prompt_text: "Good prompt",
          total: 10,
          successes: 9,
          avg_time: 200,
        },
        {
          prompt_hash: "h2",
          prompt_text: "Bad prompt",
          total: 10,
          successes: 1,
          avg_time: 500,
        },
      ];
      db._prep.all.mockReturnValueOnce(hashStats).mockReturnValueOnce([]);

      const result = po.optimizePrompt("skill-x");

      const gapSuggestion = result.suggestions.find(
        (s) => s.type === "variant-performance-gap",
      );
      expect(gapSuggestion).toBeDefined();
    });

    it("should include failure-feedback suggestion when failures exist", () => {
      const hashStats = [
        {
          prompt_hash: "h1",
          prompt_text: "P",
          total: 5,
          successes: 2,
          avg_time: 100,
        },
      ];
      db._prep.all
        .mockReturnValueOnce(hashStats)
        .mockReturnValueOnce([{ feedback: "Not enough detail" }]);

      const result = po.optimizePrompt("skill-y");

      const feedbackSuggestion = result.suggestions.find(
        (s) => s.type === "failure-feedback",
      );
      expect(feedbackSuggestion).toBeDefined();
      expect(feedbackSuggestion.feedback).toContain("Not enough detail");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compareVariants
  // ─────────────────────────────────────────────────────────────────────────
  describe("compareVariants()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return error when one or both variants not found", () => {
      db._prep.get.mockReturnValue(null);

      const result = po.compareVariants("id-a", "id-b");

      expect(result).toHaveProperty("error");
    });

    it("should identify the winner by higher success_rate", () => {
      const rowA = makeVariantRow({
        id: "va",
        success_rate: 0.9,
        use_count: 10,
      });
      const rowB = makeVariantRow({
        id: "vb",
        success_rate: 0.5,
        use_count: 8,
      });

      db._prep.get.mockReturnValueOnce(rowA).mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.winner).toBe("va");
      expect(result.successRateDiff).toBeCloseTo(0.4, 2);
    });

    it("should return tie when success rates are equal", () => {
      const rowA = makeVariantRow({
        id: "va",
        success_rate: 0.7,
        use_count: 5,
      });
      const rowB = makeVariantRow({
        id: "vb",
        success_rate: 0.7,
        use_count: 5,
      });

      db._prep.get.mockReturnValueOnce(rowA).mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.winner).toBe("tie");
    });

    it("should report sufficient=true when both have >= 5 uses", () => {
      const rowA = makeVariantRow({ id: "va", use_count: 6 });
      const rowB = makeVariantRow({ id: "vb", use_count: 7 });

      db._prep.get.mockReturnValueOnce(rowA).mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.sufficient).toBe(true);
    });

    it("should report sufficient=false when either has < 5 uses", () => {
      const rowA = makeVariantRow({ id: "va", use_count: 3 });
      const rowB = makeVariantRow({ id: "vb", use_count: 10 });

      db._prep.get.mockReturnValueOnce(rowA).mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.sufficient).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return zero stats for empty DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 }) // totalExecutions
        .mockReturnValueOnce({ count: 0 }) // totalVariants
        .mockReturnValueOnce({ count: 0 }) // activeVariants
        .mockReturnValueOnce({ count: 0 }) // skillsCovered
        .mockReturnValueOnce({ avg: null }); // avgSuccessRate

      const stats = po.getStats();

      expect(stats).toMatchObject({
        totalExecutions: 0,
        totalVariants: 0,
        activeVariants: null,
        activeAuthority: "unavailable",
        legacyActiveProjectionRows: 0,
        skillsCovered: 0,
        avgSuccessRate: 0,
      });
    });

    it("should return correct stats from DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 50 }) // totalExecutions
        .mockReturnValueOnce({ count: 5 }) // totalVariants
        .mockReturnValueOnce({ count: 4 }) // activeVariants
        .mockReturnValueOnce({ count: 3 }) // skillsCovered
        .mockReturnValueOnce({ avg: 0.72 }); // avgSuccessRate

      const stats = po.getStats();

      expect(stats.totalExecutions).toBe(50);
      expect(stats.totalVariants).toBe(5);
      expect(stats.activeVariants).toBeNull();
      expect(stats.activeAuthority).toBe("unavailable");
      expect(stats.legacyActiveProjectionRows).toBe(4);
      expect(stats.skillsCovered).toBe(3);
      expect(stats.avgSuccessRate).toBe(0.72);
    });
  });
});
