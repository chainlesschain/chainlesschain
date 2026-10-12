import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatWithTools } from "../helpers/test-model-egress.js";
import { CostBudget } from "../../src/lib/cost-budget.js";
import { priceRollup } from "../../src/lib/llm-pricing.js";

const messages = [{ role: "user", content: "Reply with one word." }];
function captureResponse(
  usage = { input_tokens: 5, output_tokens: 2, inference_geo: "global" },
) {
  const requests = [];
  const fetch = vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "ok" }],
        usage,
        stop_reason: "end_turn",
      }),
    };
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fetch };
}
const options = (overrides = {}) => ({
  provider: "anthropic",
  model: "claude-haiku-5-5",
  apiKey: "test-key",
  cwd: os.tmpdir(),
  ...overrides,
});
afterEach(() => vi.unstubAllGlobals());

describe("exact Haiku 5.5 Anthropic request and usage", () => {
  it("uses adaptive/medium with the existing default output budget and no sampling", async () => {
    const captured = captureResponse();
    await chatWithTools(
      messages,
      options({ temperature: 0.3, top_p: 0.4, top_k: 3 }),
    );
    expect(captured.fetch).toHaveBeenCalledOnce();
    expect(captured.requests[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    for (const key of ["temperature", "top_p", "top_k", "budget_tokens"])
      expect(captured.requests[0]).not.toHaveProperty(key);
  });
  it("caps an explicit larger output budget at the standard 128K limit", async () => {
    const captured = captureResponse();
    await chatWithTools(messages, options({ maxOutputTokens: 300000 }));
    expect(captured.requests[0].max_tokens).toBe(128000);
  });
  it.each([
    [{ thinking: "think" }, "medium"],
    [{ thinking: "hard" }, "high"],
    [{ thinking: "ultra" }, "xhigh"],
    [{ thinking: true }, "high"],
    [{ thinkingEffort: "max" }, "max"],
  ])(
    "preserves the caller's reasoning intent: %j",
    async (override, effort) => {
      const captured = captureResponse();
      await chatWithTools(messages, options(override));
      expect(captured.requests[0].thinking).toEqual({ type: "adaptive" });
      expect(captured.requests[0].output_config.effort).toBe(effort);
      expect(captured.requests[0].thinking).not.toHaveProperty("budget_tokens");
    },
  );
  it.each(["low", "medium", "high"])(
    "honors explicit thinking off at %s",
    async (effort) => {
      const captured = captureResponse();
      await chatWithTools(
        messages,
        options({ thinking: false, thinkingEffort: effort }),
      );
      expect(captured.requests[0].thinking).toEqual({ type: "disabled" });
      expect(captured.requests[0].output_config.effort).toBe(effort);
    },
  );
  it.each([
    { thinkingBudget: 8000 },
    { thinkingEffort: "invalid" },
    { thinking: false, thinkingEffort: "xhigh" },
    { thinking: false, thinkingEffort: "max" },
  ])("rejects unsupported reasoning before a request: %j", async (override) => {
    const captured = captureResponse();
    await expect(chatWithTools(messages, options(override))).rejects.toThrow();
    expect(captured.fetch).not.toHaveBeenCalled();
  });
  it("rejects assistant prefill before sending a request", async () => {
    const captured = captureResponse();
    await expect(
      chatWithTools(
        [...messages, { role: "assistant", content: "Partial answer" }],
        options(),
      ),
    ).rejects.toThrow(/assistant prefill/i);
    expect(captured.fetch).not.toHaveBeenCalled();
  });
  it("does not enable the exact-model contract for a future Haiku model", async () => {
    const captured = captureResponse();
    await chatWithTools(messages, options({ model: "claude-haiku-5-6" }));
    expect(captured.requests[0]).not.toHaveProperty("thinking");
    expect(captured.requests[0]).not.toHaveProperty("output_config");
  });
  it("keeps TTL and region evidence from a non-stream response for request pricing", async () => {
    const usage = {
      input_tokens: 47001,
      output_tokens: 100,
      cache_read_input_tokens: 50000,
      cache_creation_input_tokens: 3000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1000,
        ephemeral_1h_input_tokens: 2000,
      },
      inference_geo: "us",
      service_tier: "standard",
    };
    captureResponse(usage);
    const response = await chatWithTools(messages, options());
    expect(response.usage).toMatchObject({
      cacheCreation5mTokens: 1000,
      cacheCreation1hTokens: 2000,
      regional_processing: true,
      service_tier: "standard",
    });
    const budget = new CostBudget({ limitUsd: 1 });
    const cost = budget.add({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      usage: response.usage,
    });
    expect(cost.matched).toBe(true);
    expect(cost.totalCost).toBeCloseTo(0.03176305, 12);
    expect(budget.spentUsd).toBeCloseTo(cost.totalCost, 12);
  });
  it("does not price actual usage with no evidence of the inference region", async () => {
    captureResponse({ input_tokens: 5, output_tokens: 2 });
    const response = await chatWithTools(messages, options());
    const budget = new CostBudget({ limitUsd: 1 });
    const cost = budget.add({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      usage: response.usage,
    });
    expect(cost.matched).toBe(false);
    expect(budget.sawUnpriced).toBe(true);
    expect(budget.priced).toBe(false);
  });
  it.each([
    ["Anthropic", "claude-haiku-5-5"],
    ["anthropic", "CLAUDE-HAIKU-5-5"],
    ["ANTHROPIC", "CLAUDE-HAIKU-5-5"],
  ])(
    "keeps missing region evidence unpriced with case variants: %s/%s",
    (provider, model) => {
      const budget = new CostBudget({ limitUsd: 1 });
      expect(
        budget.add({
          provider,
          model,
          usage: { input_tokens: 5, output_tokens: 2 },
        }).matched,
      ).toBe(false);
      const rollup = priceRollup({
        byModel: [
          {
            provider,
            model,
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
            calls: 1,
          },
        ],
      });
      expect(rollup.byModel[0].matched).toBe(false);
      expect(rollup.cost.unpricedCount).toBe(1);
    },
  );
  it("keeps validated cache-write aliases compatible with TTL pricing evidence", async () => {
    captureResponse({
      input_tokens: 5,
      output_tokens: 2,
      cache_creation_tokens: 3000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1000,
        ephemeral_1h_input_tokens: 2000,
      },
      inference_geo: "global",
    });
    const response = await chatWithTools(messages, options());
    expect(response.usage).toMatchObject({
      cache_creation_input_tokens: 3000,
      cacheCreation5mTokens: 1000,
      cacheCreation1hTokens: 2000,
      regional_processing: false,
    });
    expect(response.usage.cacheCreationInvalid).not.toBe(true);
    const budget = new CostBudget({ limitUsd: 1 });
    expect(
      budget.add({
        provider: "anthropic",
        model: "claude-haiku-5-5",
        usage: response.usage,
      }).matched,
    ).toBe(true);
  });
});
