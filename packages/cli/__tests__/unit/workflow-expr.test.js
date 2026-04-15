import { describe, it, expect } from "vitest";
import {
  tokenize,
  evaluate,
  evaluateRaw,
  resolveReference,
} from "../../src/lib/workflow-expr.js";

function ctx(entries) {
  const step = new Map();
  for (const [id, data] of entries) step.set(id, data);
  return { step };
}

describe("workflow-expr tokenize", () => {
  it("tokenizes a simple comparison", () => {
    const t = tokenize("${step.a.status} == 'completed'");
    expect(t.map((x) => x.type)).toEqual(["ref", "op", "string"]);
  });

  it("tokenizes boolean and null literals", () => {
    expect(tokenize("true")[0].type).toBe("bool");
    expect(tokenize("false")[0].value).toBe(false);
    expect(tokenize("null")[0].type).toBe("null");
  });

  it("tokenizes contains as op", () => {
    const t = tokenize("'foo' contains 'f'");
    expect(t[1]).toEqual({ type: "op", value: "contains" });
  });

  it("tokenizes numbers including negative", () => {
    const t = tokenize("-3.5");
    expect(t[0]).toEqual({ type: "number", value: -3.5 });
  });

  it("throws on unterminated string", () => {
    expect(() => tokenize("'abc")).toThrow(/unterminated/);
  });

  it("throws on unterminated ref", () => {
    expect(() => tokenize("${step.a.b")).toThrow(/unterminated/);
  });

  it("throws on unknown identifier", () => {
    expect(() => tokenize("foobar")).toThrow(/unknown identifier/);
  });
});

describe("workflow-expr evaluate — comparisons", () => {
  const c = ctx([
    ["a", { status: "completed", result: { summary: "ok", tokenCount: 100 } }],
    ["b", { status: "failed", result: { summary: "boom" } }],
  ]);

  it("string equality", () => {
    expect(evaluate("${step.a.status} == 'completed'", c)).toBe(true);
    expect(evaluate("${step.a.status} == 'failed'", c)).toBe(false);
  });

  it("inequality", () => {
    expect(evaluate("${step.a.status} != 'failed'", c)).toBe(true);
  });

  it("numeric comparison", () => {
    expect(evaluate("${step.a.tokenCount} > 50", c)).toBe(true);
    expect(evaluate("${step.a.tokenCount} < 50", c)).toBe(false);
    expect(evaluate("${step.a.tokenCount} >= 100", c)).toBe(true);
  });

  it("contains on string", () => {
    expect(evaluate("${step.a.summary} contains 'o'", c)).toBe(true);
    expect(evaluate("${step.a.summary} contains 'xxx'", c)).toBe(false);
  });

  it("contains on array", () => {
    const c2 = ctx([["a", { result: { items: ["x", "y", "z"] } }]]);
    expect(evaluate("${step.a.items} contains 'y'", c2)).toBe(true);
    expect(evaluate("${step.a.items} contains 'q'", c2)).toBe(false);
  });

  it("unresolved ref → false for contains", () => {
    expect(evaluate("${step.missing.summary} contains 'x'", c)).toBe(false);
  });
});

describe("workflow-expr evaluate — logical", () => {
  const c = ctx([
    ["a", { status: "completed", result: { summary: "ok" } }],
    ["b", { status: "failed" }],
  ]);

  it("&& short-circuits", () => {
    expect(
      evaluate(
        "${step.a.status} == 'completed' && ${step.b.status} == 'failed'",
        c,
      ),
    ).toBe(true);
    expect(
      evaluate(
        "${step.a.status} == 'failed' && ${step.b.status} == 'failed'",
        c,
      ),
    ).toBe(false);
  });

  it("|| works", () => {
    expect(
      evaluate(
        "${step.a.status} == 'failed' || ${step.b.status} == 'failed'",
        c,
      ),
    ).toBe(true);
  });

  it("! negates", () => {
    expect(evaluate("!(${step.a.status} == 'failed')", c)).toBe(true);
    expect(evaluate("!${step.a.status} contains 'nope'", c)).toBe(true);
  });

  it("parens override precedence", () => {
    expect(
      evaluate(
        "(${step.a.status} == 'failed' || ${step.b.status} == 'failed') && ${step.a.status} != 'failed'",
        c,
      ),
    ).toBe(true);
  });
});

describe("workflow-expr evaluate — safety", () => {
  it("rejects identifier-looking call (no function support)", () => {
    expect(() => evaluate("require('fs')", {})).toThrow();
  });

  it("rejects bare dollar sign without braces", () => {
    expect(() => evaluate("$step.a.status", {})).toThrow();
  });

  it("rejects unclosed parens", () => {
    expect(() => evaluate("(${step.a.status} == 'ok'", ctx([]))).toThrow();
  });
});

describe("workflow-expr resolveReference", () => {
  const c = ctx([
    [
      "x",
      {
        status: "completed",
        taskId: "t-1",
        result: {
          summary: "s",
          tokenCount: 7,
          iterationCount: 2,
          toolsUsed: ["read"],
          items: [1, 2],
        },
      },
    ],
  ]);

  it("returns summary string", () => {
    expect(resolveReference("step.x.summary", c)).toBe("s");
  });

  it("returns array for items", () => {
    expect(resolveReference("step.x.items", c)).toEqual([1, 2]);
  });

  it("returns undefined for missing step", () => {
    expect(resolveReference("step.missing.summary", c)).toBeUndefined();
  });

  it("resolves item in forEach context", () => {
    expect(resolveReference("item", { item: "foo" })).toBe("foo");
  });

  it("throws on bad reference shape", () => {
    expect(() => resolveReference("notstep.x.y", c)).toThrow();
    expect(() => resolveReference("step.x", c)).toThrow();
  });
});

describe("workflow-expr evaluateRaw", () => {
  it("returns raw number without coercion", () => {
    const c = ctx([["a", { result: { tokenCount: 42 } }]]);
    expect(evaluateRaw("${step.a.tokenCount}", c)).toBe(42);
  });
});
