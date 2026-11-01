import { describe, expect, it } from "vitest";
import {
  createEvidenceJsonTextBoundary,
  EVIDENCE_JSON_POLICY,
} from "../../src/lib/evolution/evidence-json-text.js";

function boundary(
  codeText = true,
  policy = EVIDENCE_JSON_POLICY,
  sourceText = false,
) {
  const scan = createEvidenceJsonTextBoundary(
    (message) => new Error(message),
    policy,
  );
  const visit = (value, layer, textContext) => {
    if (typeof value === "string") return project(value, layer, textContext);
    if (Array.isArray(value)) return value.map((child) => visit(child, layer));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          visit(child, layer, textContext),
        ]),
      );
    return value;
  };
  const project = (text, layer = 0, textContext) =>
    scan(text, {
      codeText,
      sourceText: sourceText && layer === 0,
      pythonFString: textContext?.pythonFString === true,
      layer,
      visit,
      plain: (value) => value,
      equal: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    });
  return project;
}

describe("code text evidence budgets", () => {
  it("keeps one decoded node budget across independent source fields", () => {
    const scan = boundary();
    const text = JSON.stringify(Array(2100).fill(true));
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/u);
  });

  it("keeps one decoded byte budget across independent source fields", () => {
    const scan = boundary();
    const text = "a".repeat(EVIDENCE_JSON_POLICY.maxDecodedBytes / 2 + 1);
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/u);
  });

  it("does not reset the layer budget for quoted code literals", () => {
    const text = Array.from({ length: 5 }).reduce(
      (value) => JSON.stringify(value),
      '{"ok":true}',
    );
    expect(() => boundary()(text)).toThrow(/budget/u);
  });

  it("charges parsing work before falling back on a source expression", () => {
    const scan = boundary();
    const text = `[${Array(2100).fill("true").join(",")}, sourceValue]`;
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/u);
  });

  it("keeps the node budget across spread fallbacks and independent fields", () => {
    const scan = boundary(true, {
      ...EVIDENCE_JSON_POLICY,
      sourceExpressionPolicy: "bounded-source-tokens-v1",
    });
    const text = `[${Array(2100).fill("true").join(",")}, *args]`;
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/u);
  });

  it("charges formatted literal labels to the shared node budget", () => {
    const scan = boundary(true, {
      ...EVIDENCE_JSON_POLICY,
      maxNodes: 3,
      pythonFStringPolicy: "bounded-static-label-alignment-v1",
    });
    const text = `print(f"{'branch':<52}")`;
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/u);
  });

  it("keeps the layer budget when decoding a formatted literal label", () => {
    const scan = boundary(true, {
      ...EVIDENCE_JSON_POLICY,
      maxLayers: 1,
      pythonFStringPolicy: "bounded-static-label-alignment-v1",
    });
    expect(() => scan(`print(f"{'branch':<52}")`)).toThrow(/budget/u);
  });
});

describe("explicit source container grammar", () => {
  const policy = {
    ...EVIDENCE_JSON_POLICY,
    sourceLiteralPolicy: "explicit-source-containers-v1",
  };
  const source = () => boundary(true, policy, true);
  it.each([
    'const values = ["one", "two",];',
    'store(id, `question-${i}: ${"x".repeat(90)}`);',
    'const values = {"one": 1,};',
    "const sizes = [0, 40_000_001];",
    "const sizes = [-40_000_001, +0xff, -0b101, -1_0e2,];",
    "const sizes = [0xff, 0b101, 0o70, 1_000.25];",
    '["one", "two",].includes(value);',
    'const values = ["one",];\nfunction unfinished(',
  ])("preserves explicit JavaScript source: %s", (text) => {
    expect(source()(text)).toBe(text);
  });
  it.each([
    '["one",]',
    '{"one":1,}',
    'const values = {"one":1,"\\u006fne":2,};',
    "const values = [9_007_199_254_740_992];",
    "const values = [1_0e999];",
    'const values = ["one",};',
    '/* const values = */ ["one",];',
    'store(`question-${{"one":1,"one":2}}`);',
    "store(`question-${[9_007_199_254_740_992]}`);",
    'store(`question-${{"note":"bad\\q"}}`);',
  ])("rejects unsafe or unproven source: %s", (text) => {
    expect(() => source()(text)).toThrow();
  });
  it("does not grant syntax to arbitrary codeText or decoded source strings", () => {
    const text = 'const values = ["one",];';
    expect(() => boundary(true, policy)(text)).toThrow();
    expect(() => source()(JSON.stringify(text))).toThrow();
    expect(() => boundary(true)(text)).toThrow();
  });
  it("accounts source proof tokens separately while bounding them across fields", () => {
    const text = "const x = 1;\n".repeat(5) + 'const values = ["one",];';
    const scan = boundary(
      true,
      { ...policy, maxNodes: 16, maxSourceTokens: 50 },
      true,
    );
    expect(scan(text)).toBe(text);
    expect(() => scan(text)).toThrow(/budget/);
  });
  it("retains shared resource limits", () => {
    expect(() =>
      boundary(
        true,
        { ...policy, maxNodes: 4 },
        true,
      )('const values = ["one", "two",];'),
    ).toThrow(/budget/);
    expect(() =>
      boundary(
        true,
        { ...policy, maxDecodedBytes: 4 },
        true,
      )('const values = ["one",];'),
    ).toThrow(/budget/);
  });
});
