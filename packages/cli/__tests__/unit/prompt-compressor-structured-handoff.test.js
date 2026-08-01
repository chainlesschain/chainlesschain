import { describe, expect, it, vi } from "vitest";
import {
  buildExtractiveHandoff,
  formatStructuredHandoff,
  parseStructuredHandoff,
  PromptCompressor,
  StructuredHandoffValidationError,
  STRUCTURED_HANDOFF_FIELDS,
} from "../../src/harness/prompt-compressor.js";

function validHandoff() {
  return {
    objective: "finish the checkout fix",
    constraints: ["do not widen permissions"],
    keyDecisions: ["use revision CAS"],
    changedFiles: ["packages/cli/src/lib/store.js"],
    tests: ["vitest passed"],
    unresolvedSideEffects: [],
    checkpoints: ["implementation complete"],
    blockers: [],
    nextSteps: ["verify replay"],
  };
}

function historyWithFrozenFacts() {
  return [
    { role: "system", content: "system" },
    {
      role: "user",
      content: "Fix the checkout race without widening policy.",
    },
    { role: "assistant", content: "Decision: use revision CAS." },
    {
      role: "assistant",
      content: "Changed packages/cli/src/lib/store.js.",
    },
    { role: "assistant", content: "Tests passed with Vitest." },
    {
      role: "assistant",
      content:
        "Unresolved side effects: Marketplace publish not yet performed.",
    },
    { role: "assistant", content: "Checkpoint: commit abcdef123 completed." },
    { role: "assistant", content: "Blocker: release credentials missing." },
    { role: "assistant", content: "Next step: verify replay." },
    { role: "user", content: "Continue when ready." },
  ];
}

describe("structured handoff protocol", () => {
  it("accepts only the canonical strict nine-field JSON object", () => {
    const expected = validHandoff();
    expect(parseStructuredHandoff(JSON.stringify(expected))).toEqual(expected);
    expect(Object.keys(parseStructuredHandoff(expected))).toEqual(
      STRUCTURED_HANDOFF_FIELDS,
    );

    for (const invalid of [
      `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``,
      JSON.stringify({ ...expected, extra: [] }),
      JSON.stringify({ constraints: [], ...expected }),
      JSON.stringify({ ...expected, tests: [42] }),
    ]) {
      expect(() => parseStructuredHandoff(invalid)).toThrow(
        StructuredHandoffValidationError,
      );
    }
  });

  it("builds a bounded deterministic fallback that retains frozen facts", () => {
    const handoff = buildExtractiveHandoff(historyWithFrozenFacts(), {
      maxContentChars: 2_000,
      maxFallbackSourceChars: 4_000,
    });

    expect(Object.keys(handoff)).toEqual(STRUCTURED_HANDOFF_FIELDS);
    expect(handoff.objective).toContain("Fix the checkout race");
    expect(handoff.constraints.join(" ")).toContain("without widening policy");
    expect(handoff.keyDecisions).toContain("use revision CAS.");
    expect(handoff.changedFiles).toContain("packages/cli/src/lib/store.js");
    expect(handoff.tests.join(" ")).toContain("passed with Vitest");
    expect(handoff.unresolvedSideEffects.join(" ")).toContain(
      "Marketplace publish not yet performed",
    );
    expect(handoff.checkpoints.join(" ")).toContain("abcdef123");
    expect(handoff.blockers.join(" ")).toContain("release credentials missing");
    expect(handoff.nextSteps).toContain("verify replay.");
    expect(formatStructuredHandoff(handoff).length).toBeLessThanOrEqual(2_000);
  });

  it("uses the bounded provider prompt and records structured usage", async () => {
    const llmQuery = vi.fn(async () => ({
      summary: JSON.stringify(validHandoff()),
      usage: {
        input_tokens: 123,
        output_tokens: 45,
        cache_read_input_tokens: 7,
      },
      provider: "mock-provider",
      model: "summary-model",
    }));
    const compressor = new PromptCompressor({
      maxMessages: 4,
      maxTokens: 10,
      summaryInputMaxChars: 1_024,
      llmQuery,
    });

    const { messages, stats } = await compressor.compress(
      historyWithFrozenFacts(),
    );

    expect(llmQuery).toHaveBeenCalledOnce();
    const prompt = llmQuery.mock.calls[0][0];
    expect(prompt.length).toBeLessThanOrEqual(1_024);
    expect(prompt).toContain("Fix the checkout race");
    expect(stats).toMatchObject({
      summaryMode: "llm-structured",
      degraded: false,
      summaryProvider: "mock-provider",
      summaryModel: "summary-model",
      summaryUsage: {
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 7,
      },
    });
    const summaryMessage = messages.find((message) =>
      String(message.content).startsWith("[Conversation Summary]"),
    );
    expect(
      parseStructuredHandoff(
        summaryMessage.content.slice("[Conversation Summary]".length),
      ),
    ).toEqual(validHandoff());
  });

  it("degrades visibly to the extractive handoff on invalid provider output", async () => {
    const compressor = new PromptCompressor({
      maxMessages: 4,
      maxTokens: 10,
      llmQuery: async () => "not-json",
    });

    const { messages, stats } = await compressor.compress(
      historyWithFrozenFacts(),
    );

    expect(stats).toMatchObject({
      summaryMode: "extractive-fallback",
      degraded: true,
      degradedReason: "invalid_llm_summary:invalid_json",
    });
    const summaryMessage = messages.find((message) =>
      String(message.content).startsWith("[Conversation Summary]"),
    );
    const handoff = parseStructuredHandoff(
      summaryMessage.content.slice("[Conversation Summary]".length),
    );
    expect(handoff.objective).toContain("Fix the checkout race");
    expect(handoff.changedFiles).toContain("packages/cli/src/lib/store.js");
    expect(handoff.tests.length).toBeGreaterThan(0);
    expect(handoff.blockers.length).toBeGreaterThan(0);
    expect(handoff.nextSteps.length).toBeGreaterThan(0);
  });
});
