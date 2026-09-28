#!/usr/bin/env node

// Four bounded paid calls against the configured built-in Volcengine endpoint.
// The resulting receipt contains counts and hashes, never response content.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/lib/config-manager.js";
import { applyConfigLlmDefaults } from "../src/lib/llm-config-defaults.js";
import { BUILT_IN_PROVIDERS } from "../src/lib/llm-providers.js";
import { estimateCost, mergePricing } from "../src/lib/llm-pricing.js";
import { compareContextTokenEstimates } from "./context-token-calibration.mjs";

const CONFIRM_FLAG = "--confirm-live";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 8;

function cases(scale) {
  const fields = Object.fromEntries(
    Array.from({ length: 12 * scale + 4 }, (_, index) => [
      `field_${String(index).padStart(2, "0")}`,
      {
        type: "string",
        description: `Optional report field ${index}; retain the exact source value.`,
      },
    ]),
  );
  return [
    {
      category: "chinese",
      messages: [
        {
          role: "user",
          content: `阅读以下中文后只回答 OK。\n${"春天的项目记录包括日期、负责人和交付状态。".repeat(12 * scale)}`,
        },
      ],
      toolDefinitions: [],
    },
    {
      category: "code",
      messages: [
        {
          role: "user",
          content: `Read this code and reply OK.\n${"function sum(items) { return items.reduce((total, item) => total + item.value, 0); }\n".repeat(7 * scale)}`,
        },
      ],
      toolDefinitions: [],
    },
    {
      category: "emoji",
      messages: [
        {
          role: "user",
          content: `Reply OK after reading these symbols.\n${"😀🧑‍💻🚀✨".repeat(20 * scale)}`,
        },
      ],
      toolDefinitions: [],
    },
    {
      category: "tool-schema",
      messages: [{ role: "user", content: "Reply OK without calling a tool." }],
      toolDefinitions: [
        {
          type: "function",
          function: {
            name: "record_report",
            description: "Record a report with optional fields.",
            parameters: { type: "object", properties: fields },
          },
        },
      ],
    },
  ];
}

export function parseLiveProbeArgs(args) {
  if (!Array.isArray(args) || args[0] !== CONFIRM_FLAG) {
    throw new TypeError(`explicit ${CONFIRM_FLAG} is required for paid calls`);
  }
  if (args.length === 1) return 1;
  if (
    args.length !== 3 ||
    args[1] !== "--repeats" ||
    !/^[1-5]$/u.test(args[2])
  ) {
    throw new TypeError("--repeats must be an integer from 1 to 5");
  }
  return Number(args[2]);
}

async function main() {
  const repeats = parseLiveProbeArgs(process.argv.slice(2));
  const config = loadConfig();
  const llm = config?.llm || {};
  const resolved = { provider: "volcengine" };
  applyConfigLlmDefaults(resolved, llm);
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  if (llm.provider !== "volcengine" || resolved.provider !== "volcengine") {
    throw new TypeError("configured provider is not Volcengine");
  }
  if (!resolved.apiKey || !resolved.model) {
    throw new TypeError("Volcengine credentials or model are missing");
  }
  const baseUrl = (
    resolved.baseUrl || BUILT_IN_PROVIDERS.volcengine.baseUrl
  ).replace(/\/$/u, "");
  if (baseUrl !== BUILT_IN_PROVIDERS.volcengine.baseUrl) {
    throw new TypeError(
      "configured endpoint differs from the built-in endpoint",
    );
  }

  const rows = [];
  const responseHashes = [];
  let estimatedCostUsd = 0;
  let outputTokens = 0;
  const scales =
    repeats === 1 ? [5] : Array.from({ length: repeats }, (_, i) => i + 1);
  for (const scale of scales) {
    for (const sample of cases(scale)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      timer.unref?.();
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
            messages: sample.messages,
            ...(sample.toolDefinitions.length
              ? { tools: sample.toolDefinitions }
              : {}),
            max_tokens: MAX_OUTPUT_TOKENS,
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw new Error(`Volcengine HTTP ${response.status}`);
      }
      const data = await response.json();
      const usage = data.usage;
      const promptTokens = usage?.prompt_tokens;
      const completionTokens = usage?.completion_tokens;
      const cacheReadTokens =
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.prompt_cache_hit_tokens ??
        0;
      if (
        !Number.isSafeInteger(promptTokens) ||
        promptTokens <= 0 ||
        !Number.isSafeInteger(completionTokens) ||
        completionTokens < 0 ||
        !Number.isSafeInteger(cacheReadTokens) ||
        cacheReadTokens < 0 ||
        cacheReadTokens > promptTokens ||
        typeof data.id !== "string" ||
        !data.id
      ) {
        throw new TypeError(
          "provider response lacks accountable usage or identity",
        );
      }
      const cost = estimateCost({
        provider: "volcengine",
        model: resolved.model,
        inputTokens: promptTokens - cacheReadTokens,
        cacheReadTokens,
        outputTokens: completionTokens,
        table: mergePricing(llm.pricing),
      });
      if (!cost.matched) throw new TypeError("configured model has no price");
      estimatedCostUsd += cost.totalCost;
      outputTokens += completionTokens;
      responseHashes.push(createHash("sha256").update(data.id).digest("hex"));
      rows.push({
        ...sample,
        provider: "volcengine",
        model: resolved.model,
        usage: { prompt_tokens: promptTokens },
      });
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schema: "chainlesschain.context-token-volcengine-live-probe/v1",
        capturedAt: new Date().toISOString(),
        requestCount: rows.length,
        repeats,
        maxOutputTokensPerRequest: MAX_OUTPUT_TOKENS,
        timeoutMsPerRequest: TIMEOUT_MS,
        responseIdSha256: responseHashes,
        outputTokens,
        estimatedCostUsd,
        calibration: compareContextTokenEstimates(rows),
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      "Context token live probe failed; no request or response content was printed.\n",
    );
    process.exitCode = 1;
  });
}
