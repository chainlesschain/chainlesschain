import { describe, expect, it } from "vitest";
import {
  createEvidenceJsonTextBoundary,
  EVIDENCE_JSON_POLICY,
} from "../../src/lib/evolution/evidence-json-text.js";

function boundary(codeText = true, policy = EVIDENCE_JSON_POLICY) {
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
