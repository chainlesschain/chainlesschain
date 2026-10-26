import { describe, expect, it } from "vitest";
import {
  retainedContextText,
  serializeRetainedContext,
} from "../../src/lib/retained-context-preview.js";

describe("host-created recovery context previews", () => {
  it("bounds the serialized envelope without cutting JSON or Unicode", () => {
    const source = {
      objective: "Inspect the saved source",
      excerpts: Array.from({ length: 8 }, () => "😀\n".repeat(1500)),
    };
    const saved = structuredClone(source);
    const result = serializeRetainedContext(source, 4500);
    expect(result.length).toBeLessThanOrEqual(4500);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(result.isWellFormed()).toBe(true);
    expect(source).toEqual(saved);
  });

  it.each([
    '```json\n{"events":[{"result":"' + "x".repeat(4000) + '"}]}\n```',
    '{"result":"' + "x".repeat(4000) + '"}',
    'source = {"value": "' + "x".repeat(4000) + '"}',
    'legacy {"events":[{"result":"half … [truncated]',
  ])("never retains a cut structured span (%s)", (source) => {
    const excerpt = retainedContextText(source, 200);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt).not.toContain("xxxx");
    expect(excerpt).toMatch(/omitted|truncated/iu);
  });

  it("labels omitted file content and preserves its cursor and version", () => {
    const result = JSON.parse(
      serializeRetainedContext(
        {
          path: "WORKLOG.md",
          fileVersion: "v1",
          range: { start: 1, end: 8 },
          content: '{"events":[',
        },
        1000,
      ),
    );
    expect(result).toMatchObject({
      path: "WORKLOG.md",
      fileVersion: "v1",
      range: { start: 1, end: 8 },
      contentOmitted: true,
      contentOmittedChars: 11,
    });
  });

  it("retains useful ordinary diagnostic evidence", () => {
    const source = "FAIL parser.test.js\nAssertionError: expected 20, got 10\n";
    expect(retainedContextText(source, 200)).toBe(source);
    expect(retainedContextText("😀".repeat(100), 40).isWellFormed()).toBe(true);
  });
});
