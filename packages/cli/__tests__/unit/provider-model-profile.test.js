import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatWithTools } from "../helpers/test-model-egress.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";
import * as contextRuntime from "../../src/lib/context-memory-kernel/runtime.js";

const MESSAGES = [{ role: "user", content: "Say hello." }];
const WINDOW = 65_536;
const CANONICAL_ENV = {
  CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
};

let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cc-provider-model-profile-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

function callOptions(overrides = {}) {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "test-only-provider-key",
    baseUrl: "https://provider-profile.invalid/v1",
    cwd: directory,
    sessionId: "provider-model-profile-test",
    contextMemoryEnv: CANONICAL_ENV,
    contextMemoryFilePath: join(directory, "memory", "kernel-v1.json"),
    contextMemoryModelWindowTokens: WINDOW,
    contextMemorySkipPlanning: false,
    // Keep the request focused on model budget rather than registry size.
    contextMemorySelectedToolNames: [],
    promptCaching: false,
    ...overrides,
  };
}

function captureProviderFetch(provider) {
  const requests = [];
  const fetch = vi.fn(async (url, init) => {
    requests.push({ url, body: init.body, parsed: JSON.parse(init.body) });
    const payload =
      provider === "anthropic"
        ? {
            content: [{ type: "text", text: "Hello." }],
            usage: { input_tokens: 5, output_tokens: 2 },
            stop_reason: "end_turn",
          }
        : provider === "ollama"
          ? { message: { role: "assistant", content: "Hello." } }
          : {
              choices: [{ message: { role: "assistant", content: "Hello." } }],
            };
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fetch };
}

function expectBoundPlan(prepared, reserve, window = WINDOW) {
  const profile = prepared.modelCapabilities;
  expect(prepared.plan).not.toBeNull();
  expect(profile.runtimeVerified).toBe(false);
  expect(profile.contextWindowTokens).toBe(window);
  expect(prepared.plan.modelProfile).toBe(
    `${profile.profileId}:${profile.digest}`,
  );
  const margin = Math.min(
    window - reserve - 1,
    Math.max(64, Math.floor(window * 0.05)),
  );
  expect(prepared.plan.inputBudget).toBe(window - reserve - margin);
}

describe("canonical provider model-profile budget integration", () => {
  it.each([
    ["claude-sonnet-4-6", 8192],
    ["claude-opus-4-6", 16384],
    ["claude-haiku-4-5-20251001", 4096],
  ])(
    "reserves the actual %s Anthropic request default (%i)",
    async (model, cap) => {
      const options = callOptions({ model });
      const prepared = await prepareCanonicalProviderContext(MESSAGES, options);
      expectBoundPlan(prepared, cap);
      expect(prepared.modelCapabilities).toMatchObject({
        requestMaxOutputTokens: cap,
        plannedOutputReserveTokens: cap,
        outputReserveSource: "anthropic-request-default",
      });

      const captured = captureProviderFetch("anthropic");
      await chatWithTools(MESSAGES, options);
      expect(captured.fetch).toHaveBeenCalledTimes(1);
      expect(captured.requests[0].parsed.max_tokens).toBe(cap);
    },
  );

  it.each([
    ["claude-sonnet-4-6", 32768, 8192, "anthropic-request-clamp"],
    ["claude-opus-4-6", 32768, 16384, "anthropic-request-clamp"],
    ["claude-haiku-4-5-20251001", 8192, 4096, "anthropic-request-clamp"],
    ["claude-sonnet-4-6", 2048, 2048, "explicit-request-cap"],
  ])(
    "uses the same clamped budget for %s override %i in plan and body",
    async (model, maxOutputTokens, effectiveCap, source) => {
      const options = callOptions({ model, maxOutputTokens });
      const prepared = await prepareCanonicalProviderContext(MESSAGES, options);
      expectBoundPlan(prepared, effectiveCap);
      expect(prepared.modelCapabilities).toMatchObject({
        requestMaxOutputTokens: effectiveCap,
        plannedOutputReserveTokens: effectiveCap,
        outputReserveSource: source,
      });

      const captured = captureProviderFetch("anthropic");
      await chatWithTools(MESSAGES, options);
      expect(captured.requests[0].parsed.max_tokens).toBe(effectiveCap);
    },
  );

  it.each([128, 256])(
    "allows a small explicit cap of %i with a conservative 256-token reserve",
    async (cap) => {
      const options = callOptions({ maxOutputTokens: cap });
      const prepared = await prepareCanonicalProviderContext(MESSAGES, options);
      expectBoundPlan(prepared, 256);
      expect(prepared.modelCapabilities.requestMaxOutputTokens).toBe(cap);

      const captured = captureProviderFetch("anthropic");
      await chatWithTools(MESSAGES, options);
      expect(captured.requests[0].parsed.max_tokens).toBe(cap);
    },
  );

  it.each([
    ["anthropic", "claude-sonnet-4-6", undefined, 8192],
    ["anthropic", "claude-opus-4-6", undefined, 8192],
    ["openai", "gpt-4o", 2048, 2048],
    ["ollama", "qwen2.5:7b", 4096, 2048],
  ])(
    "rejects %s output at or above the window before runtime I/O or fetch",
    async (provider, model, maxOutputTokens, window) => {
      const options = callOptions({
        provider,
        model,
        maxOutputTokens,
        contextMemoryModelWindowTokens: window,
      });
      const createRuntime = vi.spyOn(
        contextRuntime,
        "createCliContextMemoryRuntime",
      );
      const captured = captureProviderFetch(provider);
      await expect(
        prepareCanonicalProviderContext(MESSAGES, options),
      ).rejects.toMatchObject({
        code: "CC_MODEL_OUTPUT_BUDGET_EXCEEDS_WINDOW",
      });
      await expect(chatWithTools(MESSAGES, options)).rejects.toMatchObject({
        code: "CC_MODEL_OUTPUT_BUDGET_EXCEEDS_WINDOW",
      });
      expect(createRuntime).not.toHaveBeenCalled();
      expect(captured.fetch).not.toHaveBeenCalled();
      expect(existsSync(options.contextMemoryFilePath)).toBe(false);
    },
  );

  it.each([
    ["openai", "gpt-4o"],
    ["ollama", "qwen2.5:7b"],
  ])(
    "keeps the uncapped %s body unchanged while reserving 4096 for planning",
    async (provider, model) => {
      const options = callOptions({ provider, model });
      const prepared = await prepareCanonicalProviderContext(MESSAGES, options);
      expectBoundPlan(prepared, 4096);
      expect(prepared.modelCapabilities).toMatchObject({
        requestMaxOutputTokens: null,
        plannedOutputReserveTokens: 4096,
        outputReserveSource: "planning-fallback",
      });

      const captured = captureProviderFetch(provider);
      await chatWithTools(MESSAGES, options);
      expect(captured.fetch).toHaveBeenCalledTimes(1);
      const expectedBody = {
        model,
        messages: prepared.messages,
        tools: [],
        ...(provider === "ollama" ? { stream: false } : {}),
      };
      expect(captured.requests[0].body).toBe(JSON.stringify(expectedBody));
      expect(captured.requests[0].parsed).not.toHaveProperty("max_tokens");
      expect(captured.requests[0].parsed).not.toHaveProperty("options");
    },
  );

  it("retains the legacy small-window clamp for an uncapped planning fallback", async () => {
    const prepared = await prepareCanonicalProviderContext(
      [],
      callOptions({
        provider: "ollama",
        model: "qwen2.5:7b",
        contextMemoryModelWindowTokens: 1024,
      }),
    );
    expectBoundPlan(prepared, 1023, 1024);
    expect(prepared.modelCapabilities.requestMaxOutputTokens).toBeNull();
    expect(prepared.plan.inputBudget).toBe(1);
  });

  it("binds changes in model, window, and output override to different digests", async () => {
    const base = await prepareCanonicalProviderContext(MESSAGES, callOptions());
    const same = await prepareCanonicalProviderContext(MESSAGES, callOptions());
    expect(same.modelCapabilities.digest).toBe(base.modelCapabilities.digest);
    const variants = [
      { model: "claude-opus-4-6" },
      { contextMemoryModelWindowTokens: WINDOW * 2 },
      { maxOutputTokens: 2048 },
    ];
    for (const variant of variants) {
      const changed = await prepareCanonicalProviderContext(
        MESSAGES,
        callOptions(variant),
      );
      expect(changed.modelCapabilities.digest).not.toBe(
        base.modelCapabilities.digest,
      );
      expect(changed.plan.modelProfile).not.toBe(base.plan.modelProfile);
    }
  });

  it.each([
    { contextMemorySkipPlanning: true },
    { contextMemoryEnv: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "shadow" } },
  ])(
    "does not fabricate a planned profile when planning is inactive: %j",
    async (override) => {
      const prepared = await prepareCanonicalProviderContext(
        MESSAGES,
        callOptions(override),
      );
      expect(prepared.plan).toBeNull();
      expect(prepared.recall).toBeNull();
      expect(prepared.modelCapabilities).toBeNull();
      expect(prepared.messages).toEqual(MESSAGES);
    },
  );

  it("still rejects an unauthenticated ingress before any provider fetch", async () => {
    const captured = captureProviderFetch("anthropic");
    await expect(
      chatWithTools(MESSAGES, callOptions({ evolutionIngress: {} })),
    ).rejects.toThrow("a branded Agent evolution ingress is required");
    expect(captured.fetch).not.toHaveBeenCalled();
  });
});
