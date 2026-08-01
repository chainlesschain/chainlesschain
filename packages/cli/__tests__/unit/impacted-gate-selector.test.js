import { describe, expect, it } from "vitest";
import {
  IMPACTED_GATE_SELECTION_SCHEMA,
  selectImpactedGates,
} from "../../src/lib/impacted-gate-selector.js";

function reliable(overrides = {}) {
  return {
    changedFiles: ["src/widget.ts"],
    requiredGates: [
      { id: "lint", selectors: { languages: ["typescript"] } },
      { id: "unit", selectors: { paths: ["src/**"] } },
      { id: "docs", selectors: { paths: ["docs/**"] } },
      { id: "security", always: true },
    ],
    analysis: {
      confidence: 0.98,
      dependencyGraphComplete: true,
      languageServicesComplete: true,
      testHistoryComplete: true,
      classifications: [
        {
          path: "src/widget.ts",
          language: "typescript",
          ecosystem: "npm",
          confidence: 0.98,
        },
      ],
    },
    ...overrides,
  };
}

describe("selectImpactedGates", () => {
  it("selects an impacted subset only from complete high-confidence evidence", () => {
    const result = selectImpactedGates(reliable());
    expect(result).toMatchObject({
      schema: IMPACTED_GATE_SELECTION_SCHEMA,
      version: 1,
      decision: "selected",
      mode: "impacted",
      fallback: false,
      reason: "impact-analysis-complete",
      requiredGateIds: ["lint", "unit", "docs", "security"],
      selectedGateIds: ["lint", "unit", "security"],
    });
    expect(result.analysisDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selectedGateIds)).toBe(true);
  });

  it("falls back to every required gate when confidence is insufficient", () => {
    const input = reliable();
    input.analysis.confidence = 0.4;
    const result = selectImpactedGates(input);
    expect(result.mode).toBe("full");
    expect(result.selectedGateIds).toEqual(result.requiredGateIds);
    expect(result.reasons).toContain("confidence-insufficient");
  });

  it("falls back for an unknown language or build ecosystem", () => {
    const input = reliable();
    input.analysis.classifications[0].language = "future-lang";
    input.analysis.classifications[0].ecosystem = "future-build";
    const result = selectImpactedGates(input);
    expect(result.mode).toBe("full");
    expect(result.reasons).toContain("language-unknown:future-lang");
    expect(result.reasons).toContain("ecosystem-unknown:future-build");
    expect(result.selectedGateIds).toEqual(result.requiredGateIds);
  });

  it("falls back when a gate selector uses an unsupported classifier label", () => {
    const result = selectImpactedGates(
      reliable({
        requiredGates: [
          { id: "future", selectors: { ecosystems: ["future-build"] } },
          { id: "security", always: true },
        ],
      }),
    );
    expect(result.mode).toBe("full");
    expect(result.reasons).toContain(
      "gate-selector-ecosystem-unknown:future:future-build",
    );
    expect(result.selectedGateIds).toEqual(result.requiredGateIds);
  });

  it("falls back when any changed file lacks a classification", () => {
    const input = reliable({
      changedFiles: ["src/widget.ts", "native/bridge.xyz"],
    });
    const result = selectImpactedGates(input);
    expect(result.mode).toBe("full");
    expect(result.reasons).toContain(
      "classification-missing:native/bridge.xyz",
    );
  });

  it("always runs the full suite across build and CI workflow boundaries", () => {
    const input = reliable({
      changedFiles: ["package-lock.json"],
      analysis: {
        confidence: 0.99,
        dependencyGraphComplete: true,
        languageServicesComplete: true,
        testHistoryComplete: true,
        classifications: [
          {
            path: "package-lock.json",
            language: "json",
            ecosystem: "npm",
            confidence: 0.99,
          },
        ],
      },
    });
    const result = selectImpactedGates(input);
    expect(result.mode).toBe("full");
    expect(result.reason).toBe("build-or-workflow-boundary-changed");
    expect(result.selectedGateIds).toEqual(result.requiredGateIds);
  });

  it("blocks when the project has no authoritative required gate set", () => {
    const result = selectImpactedGates(reliable({ requiredGates: [] }));
    expect(result).toMatchObject({
      decision: "blocked",
      mode: "blocked",
      reason: "required-gates-undefined",
      selectedGateIds: [],
    });
  });

  it("treats a required gate without selectors as always impacted", () => {
    const result = selectImpactedGates(
      reliable({
        requiredGates: [{ id: "project-defined-gate" }],
      }),
    );
    expect(result).toMatchObject({
      mode: "impacted",
      selectedGateIds: ["project-defined-gate"],
    });
  });
});
