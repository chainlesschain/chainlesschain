/**
 * Unit tests for the REPL /think · /ultrathink extended-thinking toggle parser.
 * Pure → no readline/agent loop needed.
 */
import { describe, it, expect } from "vitest";
import { parseThinkCommand } from "../../src/repl/think-command.js";

describe("parseThinkCommand", () => {
  it("returns null for non-think input", () => {
    expect(parseThinkCommand("/model gpt")).toBe(null);
    expect(parseThinkCommand("hello /think inline")).toBe(null); // not at start
    expect(parseThinkCommand("/thinking")).toBe(null); // not a real command
    expect(parseThinkCommand("")).toBe(null);
    expect(parseThinkCommand(null)).toBe(null);
  });

  it("/think and /think on → on (true), Anthropic note", () => {
    for (const cmd of ["/think", "/think on", "/think true", "  /think  "]) {
      expect(parseThinkCommand(cmd)).toEqual({
        thinking: true,
        label: "on",
        anthropic: true,
      });
    }
  });

  it("/think off (and aliases, and /think-off) → null, no Anthropic note", () => {
    for (const cmd of ["/think off", "/think none", "/think 0", "/think-off"]) {
      expect(parseThinkCommand(cmd)).toEqual({
        thinking: null,
        label: "off",
        anthropic: false,
      });
    }
  });

  it("/think ultra and /ultrathink → ultra (max budget)", () => {
    expect(parseThinkCommand("/think ultra")).toEqual({
      thinking: "ultra",
      label: "ultra (max budget)",
      anthropic: true,
    });
    expect(parseThinkCommand("/ultrathink")).toEqual({
      thinking: "ultra",
      label: "ultra (max budget)",
      anthropic: true,
    });
  });

  it("passes an explicit effort level through", () => {
    expect(parseThinkCommand("/think high")).toEqual({
      thinking: "high",
      label: "high",
      anthropic: true,
    });
  });

  it("is case-insensitive on the argument", () => {
    expect(parseThinkCommand("/think OFF").thinking).toBe(null);
    expect(parseThinkCommand("/think Ultra").thinking).toBe("ultra");
  });
});
