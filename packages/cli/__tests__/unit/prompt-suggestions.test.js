import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveLocalPromptSuggestions,
  normalizePromptSuggestions,
  PromptSuggestionController,
  resolvePromptSuggestionsEnabled,
  runPromptSuggestionsCommand,
} from "../../src/repl/prompt-suggestions.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("background prompt suggestions", () => {
  it("resolves the opt-out setting with environment precedence", () => {
    expect(
      resolvePromptSuggestionsEnabled({
        env: { CC_PROMPT_SUGGESTIONS: "0" },
        config: { features: { promptSuggestions: true } },
      }),
    ).toBe(false);
    expect(
      resolvePromptSuggestionsEnabled({
        env: {},
        config: { features: { promptSuggestions: false } },
      }),
    ).toBe(false);
    expect(resolvePromptSuggestionsEnabled({ env: {}, config: {} })).toBe(true);
  });

  it("generates asynchronously and normalizes bounded suggestions", async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const generate = vi.fn(async () => [
      " Run tests ",
      "Run tests",
      "x".repeat(300),
      "Review diff",
      "ignored fourth",
    ]);
    const controller = new PromptSuggestionController({
      generate,
      debounceMs: 20,
      onUpdate,
    });

    const scheduled = controller.schedule({ sessionId: "s-1" });
    expect(scheduled.scheduled).toBe(true);
    expect(controller.status().generating).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    const result = await scheduled.promise;

    expect(result.status).toBe("ready");
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toBe("Run tests");
    expect(result.suggestions[1].length).toBe(180);
    expect(onUpdate).toHaveBeenCalledWith(result.suggestions, {
      generation: 1,
    });
  });

  it("cancels obsolete work and disabling clears suggestions", async () => {
    vi.useFakeTimers();
    const controller = new PromptSuggestionController({
      generate: async ({ value }) => [value],
      debounceMs: 10,
    });
    const first = controller.schedule({ value: "old" });
    const second = controller.schedule({ value: "new" });
    await expect(first.promise).resolves.toMatchObject({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(second.promise).resolves.toEqual({
      status: "ready",
      suggestions: ["new"],
    });
    expect(controller.status().suggestions).toEqual(["new"]);
    controller.setEnabled(false);
    expect(controller.status()).toMatchObject({
      enabled: false,
      generating: false,
      suggestions: [],
    });
  });

  it("supports on/off/status/refresh commands without awaiting generation", async () => {
    vi.useFakeTimers();
    const persistEnabled = vi.fn();
    const controller = new PromptSuggestionController({ debounceMs: 1 });
    expect(
      runPromptSuggestionsCommand("off", { controller, persistEnabled }),
    ).toMatchObject({ ok: true, enabled: false });
    expect(persistEnabled).toHaveBeenCalledWith(false);
    expect(
      runPromptSuggestionsCommand("refresh", { controller }).message,
    ).toContain("disabled");
    runPromptSuggestionsCommand("on", { controller, persistEnabled });
    const refreshed = runPromptSuggestionsCommand("refresh", {
      controller,
      context: { lastAssistantText: "Tests failed; next step remains." },
    });
    expect(refreshed.message).toContain("background");
    await vi.advanceTimersByTimeAsync(1);
    const ready = await refreshed.promise;
    expect(ready.suggestions.length).toBeGreaterThan(0);
  });

  it("keeps the current setting when persistence rejects a toggle", () => {
    const controller = new PromptSuggestionController({ enabled: true });
    const result = runPromptSuggestionsCommand("off", {
      controller,
      persistEnabled: () => {
        throw new Error("managed setting is locked");
      },
    });
    expect(result).toMatchObject({ ok: false, enabled: true });
    expect(result.message).toContain("managed setting is locked");
    expect(controller.status().enabled).toBe(true);
  });

  it("provides a provider-neutral local fallback", async () => {
    expect(
      await deriveLocalPromptSuggestions({
        lastAssistantText: "Tests failed. Remaining implementation changed.",
      }),
    ).toEqual([
      "定位刚才失败的根因，修复后重新验证",
      "运行相关测试并汇总仍需处理的问题",
      "继续完成尚未处理的下一项，并给出验证结果",
      "审查最新变更，检查边界情况和回归风险",
    ]);
    expect(normalizePromptSuggestions("- one\n2. two")).toEqual(["one", "two"]);
    expect(
      normalizePromptSuggestions([
        { prompt: "prompt object" },
        { text: "text object" },
        { ignored: true },
      ]),
    ).toEqual(["prompt object", "text object"]);
  });
});
