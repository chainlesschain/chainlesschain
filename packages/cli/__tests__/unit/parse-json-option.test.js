import { describe, it, expect } from "vitest";
import { parseJsonOption } from "../../src/lib/parse-json-option.js";

describe("parseJsonOption", () => {
  it("parses a valid JSON object", () => {
    expect(parseJsonOption('{"a":1,"b":"x"}', "--input")).toEqual({
      a: 1,
      b: "x",
    });
  });

  it("parses a valid JSON array", () => {
    expect(parseJsonOption("[1,2,3]", "--data")).toEqual([1, 2, 3]);
  });

  it("parses JSON primitives", () => {
    expect(parseJsonOption("42", "--n")).toBe(42);
    expect(parseJsonOption("true", "--flag")).toBe(true);
    expect(parseJsonOption('"hello"', "--s")).toBe("hello");
  });

  it("returns the default fallback (undefined) for empty input", () => {
    expect(parseJsonOption(undefined, "--input")).toBeUndefined();
    expect(parseJsonOption(null, "--input")).toBeUndefined();
    expect(parseJsonOption("", "--input")).toBeUndefined();
  });

  it("returns a custom fallback for empty input", () => {
    expect(parseJsonOption(undefined, "--widgets", [])).toEqual([]);
    expect(parseJsonOption("", "--config", {})).toEqual({});
    expect(parseJsonOption(null, "--meta", null)).toBeNull();
  });

  it("does NOT use the fallback when a value is present", () => {
    expect(parseJsonOption("[1]", "--data", [])).toEqual([1]);
  });

  it("throws a friendly error for malformed JSON", () => {
    expect(() => parseJsonOption("{bad", "--input")).toThrow(
      /Invalid JSON for --input/,
    );
  });

  it("includes the label and underlying reason in the error message", () => {
    let err;
    try {
      parseJsonOption("{not json", "--params");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Invalid JSON for --params: /);
    // the original SyntaxError reason is preserved after the colon
    expect(err.message.length).toBeGreaterThan(
      "Invalid JSON for --params: ".length,
    );
  });

  it("passes through an already-parsed non-string value (defensive)", () => {
    const obj = { already: "parsed" };
    expect(parseJsonOption(obj, "--input")).toBe(obj);
  });
});
