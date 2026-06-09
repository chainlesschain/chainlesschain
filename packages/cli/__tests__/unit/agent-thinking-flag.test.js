/**
 * `--thinking-budget <n>` resolution.
 *
 * resolveThinkingBudget() parses the CLI flag into the positive-integer
 * `thinkingBudget` option that chatWithTools / _anthropicThinkingParams
 * (agent-core.js) read for legacy Claude models. The companion `thinking`
 * toggle (--think/--ultrathink) is computed separately; the engine's
 * model-aware budget clamping is covered by
 * agent-core-anthropic-thinking.test.js.
 */
import { describe, it, expect } from "vitest";
import { resolveThinkingBudget } from "../../src/commands/agent.js";

describe("resolveThinkingBudget — --thinking-budget mapping", () => {
  it("returns undefined when the flag is absent", () => {
    expect(resolveThinkingBudget(undefined)).toBeUndefined();
    expect(resolveThinkingBudget(null)).toBeUndefined();
    expect(resolveThinkingBudget("")).toBeUndefined();
  });

  it("parses a numeric string into a positive integer", () => {
    expect(resolveThinkingBudget("8000")).toBe(8000);
    expect(resolveThinkingBudget("1024")).toBe(1024);
  });

  it("accepts an already-numeric value", () => {
    expect(resolveThinkingBudget(6000)).toBe(6000);
  });

  it("floors fractional values", () => {
    expect(resolveThinkingBudget("4096.9")).toBe(4096);
    expect(resolveThinkingBudget(2048.5)).toBe(2048);
  });

  it("rejects zero / negative / non-numeric as undefined (off)", () => {
    expect(resolveThinkingBudget("0")).toBeUndefined();
    expect(resolveThinkingBudget(0)).toBeUndefined();
    expect(resolveThinkingBudget("-100")).toBeUndefined();
    expect(resolveThinkingBudget("abc")).toBeUndefined();
    expect(resolveThinkingBudget(NaN)).toBeUndefined();
  });
});
