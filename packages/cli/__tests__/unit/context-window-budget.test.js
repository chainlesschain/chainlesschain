import { describe, it, expect } from "vitest";
import { getContextWindow } from "../../src/lib/model-context-window.js";
import { resolveModelCapabilityProfile } from "../../src/lib/model-capabilities.js";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";

describe("shared context window budget", () => {
  it.each([undefined, 1000000, 8192])(
    "honors endpoint and override %s",
    (override) => {
      const options = {
        provider: "openai",
        model: "gpt-6-astra",
        baseUrl: "https://example.invalid/v1",
        contextMemoryModelWindowTokens: override,
      };
      const expected =
        resolveModelCapabilityProfile(options).contextWindowTokens;
      expect(getContextWindow(options.model, options.provider, options)).toBe(
        expected,
      );
      const compressor = new PromptCompressor(options);
      expect(compressor._contextWindow).toBe(expected);
      compressor.adaptToModel(options.model, options.provider, options);
      expect(compressor._contextWindow).toBe(expected);
    },
  );

  it("does not auto-compact a small conversation just because it exceeds 50 messages", () => {
    const compressor = new PromptCompressor({
      provider: "gemini",
      model: "gemini-2.0-flash",
    });
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `short message ${i}`,
    }));
    expect(compressor.shouldAutoCompact(messages)).toBe(false);
    expect(
      compressor.shouldAutoCompact([
        { role: "user", content: "x".repeat(4000000) },
      ]),
    ).toBe(true);
    expect(
      new PromptCompressor({ maxMessages: 50 }).shouldAutoCompact(messages),
    ).toBe(true);
  });
});
