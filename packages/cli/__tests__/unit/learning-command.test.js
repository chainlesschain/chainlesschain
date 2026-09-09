import { describe, expect, it } from "vitest";
import {
  classifySynthesisResult,
  executeLearningSynthesis,
} from "../../src/commands/learning.js";
import { createGovernedSkillSynthesisCliHost } from "../../src/lib/evolution/governed-skill-synthesis-cli-host.js";

describe("learning synthesize command outcome", () => {
  it("requires a branded deployment host and invokes it with CLI-owned learning state", async () => {
    const db = { prepare: () => ({ all: () => [] }) };
    const trajectoryStore = {
      findComplexUnprocessed: () => [],
      findSimilar: () => [],
      markSynthesized: () => {},
    };
    await expect(
      executeLearningSynthesis({ db, trajectoryStore }),
    ).resolves.toMatchObject({
      status: "unavailable",
      code: "LEARNING_SYNTHESIS_UNAVAILABLE",
      missingDependencies: ["trusted-deployment-host"],
    });
    await expect(
      executeLearningSynthesis({
        db,
        trajectoryStore,
        learningSynthesisHost: { synthesize: async () => ({}) },
      }),
    ).rejects.toThrow("trusted deployment host");

    const root = process.cwd();
    const host = createGovernedSkillSynthesisCliHost({
      descriptor: {
        tenantId: "tenant-learning",
        handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
      },
      llmChat: async () => "{}",
      candidateOutputDir: root,
      activeSkillsDirs: [root],
      evaluateCandidate: async () => false,
    });
    await expect(
      executeLearningSynthesis({
        db,
        trajectoryStore,
        learningSynthesisHost: host,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      code: "LEARNING_SYNTHESIS_UNAVAILABLE",
      reason:
        "Synthesis unavailable: candidate-output-overlaps-active-skill-tree",
      missingDependencies: [],
      blockers: ["candidate-output-overlaps-active-skill-tree"],
      created: [],
      skipped: [],
    });
  });

  it("maps unavailable synthesis to an explicit non-zero command outcome", () => {
    expect(
      classifySynthesisResult({
        status: "unavailable",
        reason: "Synthesis unavailable: missing llm",
      }),
    ).toEqual({
      kind: "unavailable",
      exitCode: 1,
      message: "Synthesis unavailable: missing llm",
      jsonResult: {
        status: "unavailable",
        reason: "Synthesis unavailable: missing llm",
      },
    });
  });

  it("keeps completed synthesis successful", () => {
    const result = {
      status: "completed",
      created: [],
      skipped: [],
      errors: [],
    };
    expect(classifySynthesisResult(result)).toEqual({
      kind: "completed",
      exitCode: 0,
      message: null,
      jsonResult: result,
    });
  });

  it("maps synthesis errors to a non-zero command outcome", () => {
    expect(
      classifySynthesisResult({
        status: "error",
        created: [],
        skipped: [],
        errors: ["registry failed"],
      }),
    ).toEqual({
      kind: "failed",
      exitCode: 1,
      message: "registry failed",
      jsonResult: {
        status: "error",
        created: [],
        skipped: [],
        errors: ["registry failed"],
      },
    });
  });

  it.each([undefined, {}, { status: "completed" }, { status: "mystery" }])(
    "fails closed for malformed result %#",
    (result) => {
      expect(classifySynthesisResult(result)).toEqual({
        kind: "failed",
        exitCode: 1,
        message: "Synthesis returned an invalid or unknown result",
        jsonResult: {
          status: "error",
          code: "LEARNING_SYNTHESIS_INVALID_RESULT",
          reason: "Synthesis returned an invalid or unknown result",
          created: [],
          skipped: [],
        },
      });
    },
  );

  it("rejects a completed result that still contains errors", () => {
    expect(
      classifySynthesisResult({
        status: "completed",
        created: [],
        skipped: [],
        errors: ["unexpected"],
      }).kind,
    ).toBe("failed");
  });
});
