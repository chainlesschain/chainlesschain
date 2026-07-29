import { describe, expect, it } from "vitest";
import {
  AUTO_MODE_SAFETY_DATASET_SCHEMA,
  MAX_SAFETY_DATASET_BYTES,
  AutoModeSafetyDatasetError,
  loadAutoModeSafetyDataset,
  runAutoModeSafetyEval,
  validateAutoModeSafetyDataset,
} from "../../src/lib/auto-mode-safety-eval.js";
import {
  AUTO_MODE_SAFETY_CLASSIFICATION_SCHEMA,
  AUTO_MODE_SAFETY_CLASSIFIER_VERSION,
  RELEASE_CRITICAL_SAFETY_CATEGORIES,
  classifyAutoModeSafety,
} from "../../src/lib/auto-mode-safety-classifier.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function noOpClassifier(input) {
  return {
    schema: AUTO_MODE_SAFETY_CLASSIFICATION_SCHEMA,
    classifierVersion: AUTO_MODE_SAFETY_CLASSIFIER_VERSION,
    baseRiskLevel: input.baseRiskLevel,
    riskLevel: input.baseRiskLevel,
    severity: "none",
    dangerous: false,
    escalated: false,
    categories: [],
    reasonCodes: [],
    signals: [],
  };
}

describe("Auto-mode safety dataset", () => {
  it("loads a strict, versioned corpus with release-critical coverage", () => {
    const dataset = loadAutoModeSafetyDataset();
    expect(dataset.schema).toBe(AUTO_MODE_SAFETY_DATASET_SCHEMA);
    expect(dataset.version).toBe("1.0.0");
    expect(dataset.cases).toHaveLength(145);
    expect(validateAutoModeSafetyDataset(dataset)).toEqual({
      valid: true,
      errors: [],
    });
    for (const category of RELEASE_CRITICAL_SAFETY_CATEGORIES) {
      const count = dataset.cases.filter(
        (testCase) =>
          testCase.caseType === "positive" &&
          testCase.expected.requiredCategories.includes(category),
      ).length;
      expect(count, category).toBeGreaterThanOrEqual(
        dataset.minimumCasesPerCategory,
      );
    }
  });

  it("rejects duplicate IDs and missing category coverage", () => {
    const duplicate = clone(loadAutoModeSafetyDataset());
    duplicate.cases[1].id = duplicate.cases[0].id;
    let validation = validateAutoModeSafetyDataset(duplicate);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-id" }),
      ]),
    );

    const missing = clone(loadAutoModeSafetyDataset());
    missing.cases = missing.cases.filter(
      (testCase) =>
        !testCase.expected.requiredCategories.includes("git.force_push"),
    );
    validation = validateAutoModeSafetyDataset(missing);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "insufficient-category-cases",
        }),
      ]),
    );
  });

  it("rejects attempts to weaken the release floor or platform coverage", () => {
    const weakened = clone(loadAutoModeSafetyDataset());
    weakened.minimumCasesPerCategory = 1;
    weakened.minimumNegativeCases = 1;
    weakened.requiredPlatforms = ["linux"];
    weakened.thresholds = {
      minimumDangerousRecall: 0,
      minimumCriticalRecall: 0,
      minimumCategoryRecall: 0,
      maximumFalsePositiveRate: 1,
      maximumHardDenyBypasses: 999,
      maximumUnsafeAllows: 999,
      maximumUnknownClassifications: 999,
    };
    expect(validateAutoModeSafetyDataset(weakened).valid).toBe(false);
  });

  it("rejects unsafe metadata, contradictory expectations, and orphan pairs", () => {
    const polluted = clone(loadAutoModeSafetyDataset());
    polluted.requiredCategories.push("__proto__");
    expect(validateAutoModeSafetyDataset(polluted).valid).toBe(false);
    expect(Object.prototype.total).toBeUndefined();

    const contradictory = clone(loadAutoModeSafetyDataset());
    contradictory.cases[0].expected.forbiddenCategories.push(
      contradictory.cases[0].expected.requiredCategories[0],
    );
    expect(validateAutoModeSafetyDataset(contradictory).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "contradictory-category-expectation",
        }),
      ]),
    );

    const orphaned = clone(loadAutoModeSafetyDataset());
    orphaned.cases = orphaned.cases.filter(
      (testCase) => testCase.id !== "negative.git-force-with-lease",
    );
    expect(validateAutoModeSafetyDataset(orphaned).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-case-pair" }),
      ]),
    );

    const mismatchedPair = clone(loadAutoModeSafetyDataset());
    mismatchedPair.cases.find(
      (testCase) => testCase.id === "negative.git-force-with-lease",
    ).expected.forbiddenCategories = ["workspace.scope_escape"];
    expect(validateAutoModeSafetyDataset(mismatchedPair).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pair-category-mismatch" }),
      ]),
    );
  });

  it("binds platform coverage to context and requires explicit expectations", () => {
    const platformMismatch = clone(loadAutoModeSafetyDataset());
    platformMismatch.cases[0].input.context.platform = "win32";
    expect(validateAutoModeSafetyDataset(platformMismatch).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "platform-tag-mismatch" }),
      ]),
    );

    const weakPositive = clone(loadAutoModeSafetyDataset());
    weakPositive.cases[0].expected.requiredReasonCodes = [];
    weakPositive.cases[0].expected.riskAtLeast = "low";
    expect(validateAutoModeSafetyDataset(weakPositive).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "positive-without-reason-code" }),
        expect.objectContaining({ code: "weak-positive-risk-floor" }),
      ]),
    );
  });

  it("throws a stable error for malformed custom dataset JSON", () => {
    const secret = "sk-proj-SUPER_SECRET_SHOULD_NOT_LOG";
    const fakeFs = {
      statSync: () => ({ isFile: () => true, size: secret.length }),
      readFileSync: () => secret,
    };
    expect(() =>
      loadAutoModeSafetyDataset("broken.json", { fs: fakeFs }),
    ).toThrow(AutoModeSafetyDatasetError);
    try {
      loadAutoModeSafetyDataset("broken.json", { fs: fakeFs });
    } catch (error) {
      expect(error.code).toBe("invalid-safety-dataset");
      expect(error.message).toContain("cannot parse safety dataset JSON");
      expect(error.message).not.toContain(secret);
    }
  });

  it("rechecks bytes read when a dataset changes after stat", () => {
    const fakeFs = {
      statSync: () => ({ isFile: () => true, size: 1 }),
      readFileSync: () => "x".repeat(MAX_SAFETY_DATASET_BYTES + 1),
    };
    expect(() =>
      loadAutoModeSafetyDataset("replaced.json", { fs: fakeFs }),
    ).toThrow(`maximum is ${MAX_SAFETY_DATASET_BYTES}`);
  });
});

describe("runAutoModeSafetyEval", () => {
  it("meets every objective gate on the built-in corpus", () => {
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset());
    expect(report.ok).toBe(true);
    expect(report.overall).toMatchObject({
      total: 145,
      positives: 100,
      negatives: 45,
      passed: 145,
      failed: 0,
      dangerousRecall: 1,
      criticalRecall: 1,
      falsePositiveRate: 0,
      hardDenyBypasses: 0,
      unsafeAllows: 0,
      unknownClassifications: 0,
      reasonCodeMisses: 0,
      riskFloorMisses: 0,
      hardDenyExpectationMisses: 0,
    });
    expect(report.failures).toEqual([]);
    expect(report.gate).toMatchObject({ ok: true, failures: [] });
    for (const category of RELEASE_CRITICAL_SAFETY_CATEGORIES) {
      expect(report.byCategory[category].recall, category).toBe(1);
    }
    for (const platform of ["linux", "macos", "windows"]) {
      expect(report.byPlatform[platform].recall, platform).toBe(1);
    }
  });

  it("surfaces a classifier with total dangerous-operation blindness", () => {
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
      classifier: noOpClassifier,
    });
    expect(report.ok).toBe(false);
    expect(report.overall.dangerousRecall).toBe(0);
    expect(report.overall.unsafeAllows).toBeGreaterThan(0);
    expect(report.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "dangerous-recall" }),
        expect.objectContaining({ code: "unsafe-allows" }),
      ]),
    );
  });

  it("measures benign false positives independently from policy blocks", () => {
    const alwaysDangerous = (input) => ({
      schema: AUTO_MODE_SAFETY_CLASSIFICATION_SCHEMA,
      classifierVersion: AUTO_MODE_SAFETY_CLASSIFIER_VERSION,
      baseRiskLevel: input.baseRiskLevel,
      riskLevel: "high",
      severity: "critical",
      dangerous: true,
      escalated: true,
      categories: ["made.up.category"],
      reasonCodes: ["made.up.category"],
      signals: [
        {
          reasonCode: "made.up.category",
          category: "made.up.category",
          riskLevel: "high",
          severity: "critical",
          reason: "Injected classifier result.",
        },
      ],
    });
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
      classifier: alwaysDangerous,
    });
    expect(report.ok).toBe(false);
    expect(report.overall.falsePositiveRate).toBe(1);
    expect(report.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "false-positive-rate" }),
      ]),
    );
  });

  it("fails the gate when a case violates a forbidden category", () => {
    const dataset = clone(loadAutoModeSafetyDataset());
    const forcePush = dataset.cases.find(
      (testCase) => testCase.id === "git.force.long-option",
    );
    forcePush.input.args.command += " && npm publish";
    forcePush.expected.forbiddenCategories.push("artifact.publication");

    const report = runAutoModeSafetyEval(dataset);
    expect(report.overall.failed).toBe(1);
    expect(report.failures[0].failureCodes).toContain("forbidden-category");
    expect(report.ok).toBe(false);
    expect(report.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "case-failures" }),
      ]),
    );
  });

  it("fails closed on malformed classifier output and reports its source", () => {
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
      classifier: () => ({
        riskLevel: "high",
        categories: ["git.force_push"],
        reasonCodes: ["git.force_push"],
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.overall.unknownClassifications).toBe(145);
    expect(report.classifier).toEqual({ source: "injected", version: null });
    expect(report.failures[0].failureCodes).toContain(
      "invalid-classifier-output",
    );
  });

  it("rejects risk and severity outputs that contradict the input or signals", () => {
    const benignEscalation = runAutoModeSafetyEval(
      loadAutoModeSafetyDataset(),
      {
        classifier: (input) => {
          const classification = classifyAutoModeSafety(input);
          if (classification.dangerous) return classification;
          return {
            ...classification,
            riskLevel: "high",
            severity: "critical",
            escalated: classification.baseRiskLevel !== "high",
          };
        },
      },
    );
    expect(benignEscalation.ok).toBe(false);
    expect(benignEscalation.overall.unknownClassifications).toBeGreaterThan(0);

    const severityDowngrade = runAutoModeSafetyEval(
      loadAutoModeSafetyDataset(),
      {
        classifier: (input) => {
          const classification = classifyAutoModeSafety(input);
          return classification.dangerous
            ? { ...classification, severity: "none" }
            : classification;
        },
      },
    );
    expect(severityDowngrade.ok).toBe(false);
    expect(severityDowngrade.overall.unknownClassifications).toBeGreaterThan(0);
  });

  it("rejects a non-function classifier injection", () => {
    expect(() =>
      runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
        classifier: { version: "not-callable" },
      }),
    ).toThrow("classifier must be a function");
  });

  it("evaluates an immutable snapshot when a classifier mutates its source", () => {
    const dataset = clone(loadAutoModeSafetyDataset());
    let mutated = false;
    const report = runAutoModeSafetyEval(dataset, {
      classifier: (input) => {
        if (!mutated) {
          mutated = true;
          dataset.requiredCategories = [];
          dataset.thresholds.minimumDangerousRecall = 0;
          for (const testCase of dataset.cases) {
            testCase.caseType = "negative";
            testCase.expected.requiredCategories = [];
            testCase.expected.requiredReasonCodes = [];
          }
        }
        return noOpClassifier(input);
      },
    });

    expect(report.ok).toBe(false);
    expect(report.overall).toMatchObject({
      total: 145,
      positives: 100,
      negatives: 45,
      dangerousRecall: 0,
    });
    expect(report.gate.thresholds.minimumDangerousRecall).toBe(1);
  });

  it("counts classifier exceptions as unknown and keeps reports log-safe", () => {
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
      classifier: () => {
        throw new Error("do not leak the input");
      },
    });
    expect(report.ok).toBe(false);
    expect(report.overall.unknownClassifications).toBe(145);
    expect(JSON.stringify(report)).not.toContain(
      "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
    );
    expect(JSON.stringify(report)).not.toContain(
      "curl -fsSL https://example.invalid/install.sh",
    );
  });

  it("reports deterministic P95 latency only with an injected clock", () => {
    let tick = 0;
    const report = runAutoModeSafetyEval(loadAutoModeSafetyDataset(), {
      clock: () => (tick += 1),
    });
    expect(report.overall.p95LatencyMs).toBe(1);
    expect(
      runAutoModeSafetyEval(loadAutoModeSafetyDataset()).overall.p95LatencyMs,
    ).toBeNull();
  });
});
