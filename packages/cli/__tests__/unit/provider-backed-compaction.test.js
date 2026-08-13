import { describe, expect, it, vi } from "vitest";
import { compactConversationWithProvider } from "../../src/harness/provider-backed-compaction.js";

const structuredSummary = JSON.stringify({
  objective: "Finish the semantic compaction wiring",
  constraints: ["Keep provider tools disabled"],
  keyDecisions: ["Use one shared service"],
  changedFiles: [],
  tests: ["Run targeted Vitest suites"],
  unresolvedSideEffects: [],
  checkpoints: [],
  blockers: [],
  nextSteps: ["Wire both long-lived hosts"],
});

function longConversation() {
  return [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Implement semantic compaction." },
    { role: "assistant", content: "I inspected the compressor." },
    { role: "user", content: "Preserve provider usage." },
    { role: "assistant", content: "I found the usage projection." },
    { role: "user", content: "Continue with the host wiring." },
  ];
}

describe("compactConversationWithProvider", () => {
  it("uses a tool-free provider call and projects semantic usage", async () => {
    const chatFn = vi.fn(async () => ({
      message: { content: structuredSummary },
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 7,
      },
    }));

    const result = await compactConversationWithProvider(longConversation(), {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://provider.invalid",
      apiKey: "test-key",
      chatFn,
      force: true,
    });

    expect(chatFn).toHaveBeenCalledOnce();
    expect(chatFn.mock.calls[0][1]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      enabledToolNames: [],
      extraToolDefinitions: [],
      hostManagedToolPolicy: null,
      contextEngine: null,
    });
    expect(result.stats).toMatchObject({
      summaryMode: "llm-structured",
      degraded: false,
      summaryProvider: "anthropic",
      summaryModel: "claude-sonnet-4-6",
    });
    expect(
      result.messages.some((message) =>
        String(message.content).includes(
          "Finish the semantic compaction wiring",
        ),
      ),
    ).toBe(true);
    expect(result.degradedEvent).toBeNull();
    expect(result.usageEvent).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 0,
      },
      source: "semantic-compaction",
    });
  });

  it("propagates the started call id through stats and the usage event", async () => {
    const onProviderCallStart = vi.fn(() => "semantic-call-1");
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      force: true,
      onProviderCallStart,
      llmQuery: async () => ({
        summary: structuredSummary,
        usage: { input_tokens: 12, output_tokens: 4 },
      }),
    });

    expect(onProviderCallStart).toHaveBeenCalledOnce();
    expect(result.stats.summaryCallId).toBe("semantic-call-1");
    expect(result.usageEvent).toMatchObject({
      callId: "semantic-call-1",
      source: "semantic-compaction",
      usage: { input_tokens: 12, output_tokens: 4 },
    });
  });

  it("propagates an already-settled custom query without losing its call id", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "openai",
      model: "gpt-4o",
      force: true,
      llmQuery: async () => ({
        summary: structuredSummary,
        usage: { input_tokens: 20, output_tokens: 8 },
        callId: "pre-metered-call",
        usageLedgerSettled: true,
      }),
    });

    expect(result.stats).toMatchObject({
      summaryCallId: "pre-metered-call",
      summaryUsageLedgerSettled: true,
    });
    expect(result.usageEvent).toMatchObject({
      callId: "pre-metered-call",
      usageLedgerSettled: true,
    });
  });

  it("propagates settled metadata to an outcome-unknown event", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "openai",
      model: "gpt-4o",
      force: true,
      llmQuery: async () => ({
        summary: structuredSummary,
        callId: "pre-metered-unknown-call",
        usageLedgerSettled: true,
      }),
    });

    expect(result.usageEvent).toBeNull();
    expect(result.usageUnknownEvent).toMatchObject({
      callId: "pre-metered-unknown-call",
      usageLedgerSettled: true,
      usageOutcome: "unknown",
      reason: "provider_usage_not_reported",
    });
  });

  it("keeps a structured extractive handoff and billed usage on invalid output", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "openai",
      model: "gpt-4o",
      force: true,
      llmQuery: async () => ({
        summary: "not structured JSON",
        usage: { input_tokens: 30, output_tokens: 4 },
      }),
    });

    expect(result.stats).toMatchObject({
      summaryMode: "extractive-fallback",
      degraded: true,
    });
    expect(result.degradedEvent?.reason).toMatch(/^invalid_llm_summary:/);
    expect(
      result.messages.some((message) =>
        String(message.content).includes('"objective"'),
      ),
    ).toBe(true);
    expect(result.usageEvent).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      usage: { input_tokens: 30, output_tokens: 4 },
      source: "semantic-compaction",
    });
  });

  it("marks provider transport usage as outcome-unknown", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      force: true,
      onProviderCallStart: () => "failed-semantic-call",
      llmQuery: async () => {
        throw new Error("connection reset after request upload");
      },
    });

    expect(result.stats).toMatchObject({
      degraded: true,
      summaryMode: "extractive-fallback",
      summaryUsageUnknown: true,
      summaryUsageUnknownReason: "provider_transport_outcome_unknown",
    });
    expect(result.usageEvent).toBeNull();
    expect(result.usageUnknownEvent).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      source: "semantic-compaction",
      reason: "provider_transport_outcome_unknown",
      usageOutcome: "unknown",
      callId: "failed-semantic-call",
    });
  });

  it("omits unsafe query call ids from public stats and events", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "openai",
      model: "gpt-4o",
      force: true,
      llmQuery: async () => ({
        summary: structuredSummary,
        usage: { input_tokens: 3, output_tokens: 1 },
        callId: "unsafe\ncall",
      }),
    });

    expect(result.stats.summaryCallId).toBeUndefined();
    expect(result.usageEvent.callId).toBeUndefined();
  });

  it("marks a provider response with missing usage as outcome-unknown", async () => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      force: true,
      chatFn: async () => ({ message: { content: structuredSummary } }),
    });

    expect(result.stats).toMatchObject({
      summaryUsageUnknown: true,
      summaryUsageUnknownReason: "provider_usage_not_reported",
    });
    expect(result.usageUnknownEvent).toMatchObject({
      usageOutcome: "unknown",
      reason: "provider_usage_not_reported",
    });
  });

  it.each([
    ["empty", {}],
    ["input-only", { input_tokens: 3 }],
    ["output-only", { output_tokens: 1 }],
    [
      "conflicting-required-alias",
      {
        input_tokens: 3,
        prompt_tokens: 4,
        output_tokens: 1,
      },
    ],
    [
      "invalid-cache",
      { input_tokens: 3, output_tokens: 1, cache_read_tokens: "2" },
    ],
  ])("keeps incomplete %s compaction usage unknown", async (_label, usage) => {
    const result = await compactConversationWithProvider(longConversation(), {
      provider: "openai",
      model: "gpt-4o",
      force: true,
      llmQuery: async () => ({ summary: structuredSummary, usage }),
    });

    expect(result.usageEvent).toBeNull();
    expect(result.stats).toMatchObject({
      summaryUsageUnknown: true,
      summaryUsageUnknownReason: "provider_usage_not_reported",
    });
    expect(result.usageUnknownEvent).toMatchObject({
      usageOutcome: "unknown",
      reason: "provider_usage_not_reported",
    });
  });

  it("propagates cancellation instead of manufacturing a fallback", async () => {
    const aborted = Object.assign(new Error("user interrupted compaction"), {
      name: "AbortError",
    });

    await expect(
      compactConversationWithProvider(longConversation(), {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        force: true,
        llmQuery: async () => {
          throw aborted;
        },
      }),
    ).rejects.toBe(aborted);
  });

  it("preserves the last completed exchange for between-turn compaction", async () => {
    const messages = [
      ...longConversation(),
      { role: "assistant", content: "The host wiring is complete." },
    ];
    const result = await compactConversationWithProvider(messages, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      force: true,
      preserveCompletedExchange: true,
      llmQuery: async () => structuredSummary,
    });

    expect(result.messages.slice(-2)).toEqual(messages.slice(-2));
    expect(result.messages.at(-1)?.role).toBe("assistant");
    expect(result.stats.compressedMessages).toBe(result.messages.length);

    const retryQuery = vi.fn(async () => structuredSummary);
    const retry = await compactConversationWithProvider(result.messages, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      force: true,
      preserveCompletedExchange: true,
      llmQuery: retryQuery,
    });
    expect(retryQuery).not.toHaveBeenCalled();
    expect(retry.stats.strategy).toBe("none");
    expect(retry.messages.slice(-2)).toEqual(messages.slice(-2));
  });

  it("does not call the provider when an automatic candidate is below threshold", async () => {
    const messages = [
      { role: "system", content: "host" },
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
    ];
    const llmQuery = vi.fn();

    const result = await compactConversationWithProvider(messages, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxMessages: 10,
      onlyIfNeeded: true,
      llmQuery,
    });

    expect(llmQuery).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      messages,
      stats: { strategy: "none", saved: 0, ratio: 1 },
      usageEvent: null,
      usageUnknownEvent: null,
    });
  });
});
