import { describe, expect, it } from "vitest";
import { classifySynthesisResult } from "../../src/commands/learning.js";

describe("learning synthesize command outcome", () => {
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
