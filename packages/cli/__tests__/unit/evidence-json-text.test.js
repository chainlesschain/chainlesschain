import { describe, expect, it } from "vitest";
import {
  createEvidenceJsonTextBoundary,
  EVIDENCE_JSON_POLICY,
} from "../../src/lib/evolution/evidence-json-text.js";

function boundary(codeText = true) {
  const scan = createEvidenceJsonTextBoundary((message) => new Error(message));
  const visit = (value, layer) => {
    if (typeof value === "string") return project(value, layer);
    if (Array.isArray(value)) return value.map((child) => visit(child, layer));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, visit(child, layer)]),
      );
    return value;
  };
  const project = (text, layer = 0) =>
    scan(text, {
      codeText,
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
});
