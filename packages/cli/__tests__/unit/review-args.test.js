import { describe, it, expect } from "vitest";
import {
  parseReviewReplArgs,
  describeReviewArgs,
} from "../../src/repl/review-args.js";

describe("parseReviewReplArgs", () => {
  it("defaults to working-tree review, no flags", () => {
    const { opts, errors } = parseReviewReplArgs("");
    expect(errors).toEqual([]);
    expect(opts).toEqual({
      effort: undefined,
      security: false,
      simplify: false,
      fix: false,
      staged: false,
      base: null,
      range: null,
    });
  });

  it("parses a bare effort tier (case-insensitive)", () => {
    expect(parseReviewReplArgs("HIGH").opts.effort).toBe("high");
    expect(parseReviewReplArgs("low").opts.effort).toBe("low");
  });

  it("parses lens + action flags", () => {
    const { opts, errors } = parseReviewReplArgs("--security --fix");
    expect(errors).toEqual([]);
    expect(opts.security).toBe(true);
    expect(opts.fix).toBe(true);
  });

  it("parses scope flags with values", () => {
    expect(parseReviewReplArgs("--base main").opts.base).toBe("main");
    expect(parseReviewReplArgs("--range A..B").opts.range).toBe("A..B");
    expect(parseReviewReplArgs("--staged").opts.staged).toBe(true);
  });

  it("parses -e/--effort with a value", () => {
    expect(parseReviewReplArgs("-e high").opts.effort).toBe("high");
    expect(parseReviewReplArgs("--effort low").opts.effort).toBe("low");
  });

  it("flags missing scope values", () => {
    expect(parseReviewReplArgs("--base").errors[0]).toMatch(
      /--base needs a ref/,
    );
    expect(parseReviewReplArgs("--range").errors[0]).toMatch(/--range needs/);
  });

  it("rejects an invalid effort value", () => {
    expect(parseReviewReplArgs("-e huge").errors[0]).toMatch(/invalid effort/);
  });

  it("rejects unknown arguments", () => {
    expect(parseReviewReplArgs("--nope").errors[0]).toMatch(/unknown argument/);
  });

  it("rejects mutually exclusive lenses", () => {
    expect(parseReviewReplArgs("--security --simplify").errors[0]).toMatch(
      /mutually exclusive/,
    );
  });

  it("combines effort, lens and scope", () => {
    const { opts, errors } = parseReviewReplArgs("high --simplify --staged");
    expect(errors).toEqual([]);
    expect(opts).toMatchObject({
      effort: "high",
      simplify: true,
      staged: true,
    });
  });
});

describe("describeReviewArgs", () => {
  it("describes the default review", () => {
    expect(describeReviewArgs({})).toBe(
      "working tree vs HEAD · medium effort · bugs + cleanup · read-only",
    );
  });

  it("reflects lens, scope, effort and action", () => {
    expect(
      describeReviewArgs({
        security: true,
        base: "main",
        effort: "high",
        fix: true,
      }),
    ).toBe("main...HEAD · high effort · security · applying fixes");
  });

  it("describes staged + simplify", () => {
    expect(describeReviewArgs({ simplify: true, staged: true })).toBe(
      "staged changes · medium effort · cleanup-only · read-only",
    );
  });
});
