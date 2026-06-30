/**
 * Unit tests for the REPL /think · /ultrathink extended-thinking toggle parser.
 * Pure → no readline/agent loop needed.
 */
import { describe, it, expect } from "vitest";
import {
  parseThinkCommand,
  parseEffortCommand,
} from "../../src/repl/think-command.js";

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

describe("parseEffortCommand", () => {
  it("returns null for non-effort input", () => {
    expect(parseEffortCommand("/think high")).toBe(null);
    expect(parseEffortCommand("/efforts")).toBe(null); // not the real command
    expect(parseEffortCommand("hello /effort high")).toBe(null); // not at start
    expect(parseEffortCommand("")).toBe(null);
    expect(parseEffortCommand(null)).toBe(null);
  });

  it("maps each tier to a thinking level", () => {
    expect(parseEffortCommand("/effort low")).toEqual({
      thinking: "low",
      label: "effort low",
      anthropic: true,
    });
    expect(parseEffortCommand("/effort medium").thinking).toBe("medium");
    expect(parseEffortCommand("/effort high").thinking).toBe("high");
    expect(parseEffortCommand("/effort xhigh").thinking).toBe("xhigh");
  });

  it("accepts synonyms med→medium and max→xhigh", () => {
    expect(parseEffortCommand("/effort med").thinking).toBe("medium");
    expect(parseEffortCommand("/effort max").thinking).toBe("xhigh");
  });

  it("is case-insensitive and trims", () => {
    expect(parseEffortCommand("  /effort HIGH  ").thinking).toBe("high");
  });

  it("errors on a missing or unknown level (does not throw)", () => {
    expect(parseEffortCommand("/effort")).toEqual({
      error: "usage: /effort low|medium|high|xhigh",
    });
    expect(parseEffortCommand("/effort turbo").error).toMatch(/unknown effort/);
  });
});
