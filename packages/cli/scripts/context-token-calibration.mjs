#!/usr/bin/env node

// Compare the estimates used by canonical context planning with input usage
// returned by a provider. This tool never sends a request or prints prompts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { messagesToContextItems } from "../src/lib/context-memory-kernel/message-adapter.js";
import { toolDefinitionsToContextItems } from "../src/lib/context-memory-kernel/provider-context.js";

const CATEGORIES = new Set(["chinese", "code", "emoji", "tool-schema"]);

function nonnegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

export function observedInputTokens(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    throw new TypeError("usage must be a provider response usage object");
  }
  const hasPrompt = Object.hasOwn(usage, "prompt_tokens");
  const hasInput = Object.hasOwn(usage, "input_tokens");
  if (hasPrompt === hasInput) {
    throw new TypeError("usage needs exactly one input token field");
  }
  if (hasPrompt) {
    return nonnegativeInteger(usage.prompt_tokens, "prompt_tokens");
  }
  const input = nonnegativeInteger(usage.input_tokens, "input_tokens");
  // Anthropic reports cache creation/read separately from input_tokens.
  const creation = Object.hasOwn(usage, "cache_creation_input_tokens")
    ? nonnegativeInteger(
        usage.cache_creation_input_tokens,
        "cache_creation_input_tokens",
      )
    : 0;
  const read = Object.hasOwn(usage, "cache_read_input_tokens")
    ? nonnegativeInteger(
        usage.cache_read_input_tokens,
        "cache_read_input_tokens",
      )
    : 0;
  const total = input + creation + read;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("observed input token sum exceeds a safe integer");
  }
  return total;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function summarize(samples) {
  const errors = samples
    .map(
      (sample) =>
        Math.abs(sample.estimatedTokens - sample.observedTokens) /
        Math.max(1, sample.observedTokens),
    )
    .sort((a, b) => a - b);
  const underestimates = samples
    .map((sample) => sample.observedTokens - sample.estimatedTokens)
    .filter((difference) => difference > 0)
    .sort((a, b) => a - b);
  return {
    samples: samples.length,
    estimatedTokens: samples.reduce(
      (sum, sample) => sum + sample.estimatedTokens,
      0,
    ),
    observedTokens: samples.reduce(
      (sum, sample) => sum + sample.observedTokens,
      0,
    ),
    underestimates: underestimates.length,
    p95RelativeAbsoluteError: percentile(errors, 0.95),
    p95UnderestimateTokens: percentile(underestimates, 0.95) ?? 0,
  };
}

export function compareContextTokenEstimates(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError("at least one captured request is required");
  }
  const samples = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`row ${index + 1} must be an object`);
    }
    if (!CATEGORIES.has(row.category)) {
      throw new TypeError(`row ${index + 1} has an unknown category`);
    }
    if (
      typeof row.provider !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]{0,127}$/u.test(row.provider) ||
      typeof row.model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]{0,127}$/u.test(row.model)
    ) {
      throw new TypeError(`row ${index + 1} needs provider and model`);
    }
    if (!Array.isArray(row.messages) || !Array.isArray(row.toolDefinitions)) {
      throw new TypeError(
        `row ${index + 1} needs messages and toolDefinitions arrays`,
      );
    }
    const request = {
      messages: row.messages,
      toolDefinitions: row.toolDefinitions,
    };
    const requestSha256 = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    const messageItems = messagesToContextItems(row.messages, {
      sessionId: `calibration-${index}`,
      allowedSinks: [`provider.${row.provider}`],
    });
    const toolItems = toolDefinitionsToContextItems(row.toolDefinitions, {
      sessionId: `calibration-${index}`,
      sink: `provider.${row.provider}`,
    });
    return {
      category: row.category,
      provider: row.provider,
      model: row.model,
      requestSha256,
      estimatedTokens: [...messageItems, ...toolItems].reduce(
        (sum, item) => sum + item.tokenEstimate,
        0,
      ),
      observedTokens: observedInputTokens(row.usage),
    };
  });
  const groups = new Map();
  for (const sample of samples) {
    const key = JSON.stringify([
      sample.provider,
      sample.model,
      sample.category,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return {
    schema: "chainlesschain.context-token-calibration/v1",
    estimator: "canonical-context-item-utf8-bytes-divided-by-four",
    caveat:
      "Provider input usage includes request framing and may include hidden tokens; only captured real provider responses establish calibration evidence.",
    total: summarize(samples),
    groups: [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entries]) => {
        const [provider, model, category] = JSON.parse(key);
        return { provider, model, category, ...summarize(entries) };
      }),
    requests: samples.map((sample) => ({
      category: sample.category,
      provider: sample.provider,
      model: sample.model,
      requestSha256: sample.requestSha256,
      estimatedTokens: sample.estimatedTokens,
      observedTokens: sample.observedTokens,
    })),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--input") {
      throw new TypeError(
        "usage: node context-token-calibration.mjs --input requests.jsonl",
      );
    }
    const rows = readFileSync(process.argv[3], "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    process.stdout.write(
      `${JSON.stringify(compareContextTokenEstimates(rows), null, 2)}\n`,
    );
  } catch {
    // Node's JSON parser and provider adapters can include input snippets in
    // exception messages. Never echo them from a diagnostic that reads prompts.
    process.stderr.write(
      "Context token calibration failed: invalid input or request shape.\n",
    );
    process.exitCode = 1;
  }
}
