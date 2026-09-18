#!/usr/bin/env node

import { loadConfig } from "../src/lib/config-manager.js";
import { applyConfigLlmDefaults } from "../src/lib/llm-config-defaults.js";
import { BUILT_IN_PROVIDERS } from "../src/lib/llm-providers.js";
import { estimateCost, mergePricing } from "../src/lib/llm-pricing.js";

const CONFIRM_FLAG = "--confirm-live";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 8;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function nonNegativeInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error(`${label} is not an accountable token count`);
  return result;
}

async function main() {
  if (!process.argv.slice(2).includes(CONFIRM_FLAG)) {
    fail(
      `Refusing a paid network call without ${CONFIRM_FLAG}; this probe never prints credentials or response content.`,
    );
    return;
  }
  const config = loadConfig();
  const llm = config?.llm || {};
  const resolved = { provider: "volcengine" };
  applyConfigLlmDefaults(resolved, llm);
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  const definition = BUILT_IN_PROVIDERS.volcengine;
  if (llm.provider !== "volcengine" || resolved.provider !== "volcengine")
    throw new Error("local LLM configuration is not Volcengine");
  if (!resolved.apiKey) throw new Error("VOLCENGINE_API_KEY is not configured");
  if (!resolved.model) throw new Error("Volcengine model is not configured");
  const baseUrl = (resolved.baseUrl || definition.baseUrl).replace(/\/$/u, "");
  if (baseUrl !== definition.baseUrl)
    throw new Error("Volcengine endpoint differs from the built-in endpoint");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [{ role: "user", content: "Reply exactly OK." }],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok)
    throw new Error(`Volcengine probe failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.usage || typeof data.usage !== "object")
    throw new Error("Volcengine probe response omitted usage");
  const cacheReadTokens = nonNegativeInteger(
    data.usage.prompt_tokens_details?.cached_tokens ??
      data.usage.prompt_cache_hit_tokens ??
      0,
    "cache read usage",
  );
  const promptTokens = nonNegativeInteger(
    data.usage.prompt_tokens,
    "prompt usage",
  );
  if (cacheReadTokens > promptTokens)
    throw new Error("cache read usage exceeds prompt usage");
  const inputTokens = promptTokens - cacheReadTokens;
  const outputTokens = nonNegativeInteger(
    data.usage.completion_tokens,
    "completion usage",
  );
  const totalTokens = inputTokens + outputTokens + cacheReadTokens;
  if (!Number.isSafeInteger(totalTokens) || totalTokens === 0)
    throw new Error("Volcengine probe returned invalid total usage");
  const cost = estimateCost({
    provider: "volcengine",
    model: resolved.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    table: mergePricing(llm.pricing),
  });
  if (!cost.matched)
    throw new Error("Volcengine probe model has no configured price");
  process.stdout.write(
    `${JSON.stringify({
      schema: "chainlesschain.pm-exploration-volcengine-live-probe/v1",
      provider: "volcengine",
      model: resolved.model,
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      usagePresent: true,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens,
      priceMatched: true,
      estimatedCostUsd: cost.totalCost,
      responseContentPresent: Boolean(data.choices?.[0]?.message?.content),
      credentialExposed: false,
      responseContentExposed: false,
      governedPmRun: false,
    })}\n`,
  );
}

main().catch((error) => {
  fail(error?.message || String(error));
});
