#!/usr/bin/env node

// Four to twenty bounded paid calls against the configured Volcengine endpoint.
// The resulting receipt contains counts and hashes, never response content.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/lib/config-manager.js";
import { applyConfigLlmDefaults } from "../src/lib/llm-config-defaults.js";
import { BUILT_IN_PROVIDERS } from "../src/lib/llm-providers.js";
import { estimateCost, mergePricing } from "../src/lib/llm-pricing.js";
import {
  assessCalibrationMatrix,
  compareContextTokenEstimates,
} from "./context-token-calibration.mjs";

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
  return parseLiveProbeOptions(args).repeats;
}

export function parseLiveProbeOptions(args) {
  if (!Array.isArray(args) || args[0] !== CONFIRM_FLAG) {
    throw new TypeError(`explicit ${CONFIRM_FLAG} is required for paid calls`);
  }
  const options = { repeats: 1 };
  const seen = new Set();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--repeats", "--output", "--matrix"].includes(flag) ||
      seen.has(flag) ||
      typeof value !== "string" ||
      !value ||
      value.startsWith("--")
    ) {
      throw new TypeError("invalid or duplicate live probe option");
    }
    seen.add(flag);
    if (flag === "--repeats") {
      if (!/^[1-5]$/u.test(value))
        throw new TypeError("--repeats must be an integer from 1 to 5");
      options.repeats = Number(value);
    } else options[flag === "--output" ? "outputDir" : "matrixFile"] = value;
  }
  return options;
}

async function main() {
  const options = parseLiveProbeOptions(process.argv.slice(2));
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

  const report = await runContextTokenLiveProbe({
    ...options,
    ...resolved,
    baseUrl,
    pricing: llm.pricing,
    matrix: options.matrixFile
      ? JSON.parse(fs.readFileSync(options.matrixFile, "utf8"))
      : null,
    onProgress: (attempt) =>
      process.stderr.write(
        `Calibration request ${attempt.ordinal}/${options.repeats * 4}: ${attempt.status}\n`,
      ),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.executionStatus !== "COMPLETED") process.exitCode = 1;
}

const digest = (value) => createHash("sha256").update(value).digest("hex");

export function captureLiveProbeMetadata() {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  let commit = null;
  let workingTreeDirty = null;
  try {
    const git = (args) =>
      execFileSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const head = git(["rev-parse", "HEAD"]);
    if (/^[a-f0-9]{40}$/u.test(head)) commit = head;
    workingTreeDirty = Boolean(
      git(["status", "--porcelain", "--untracked-files=normal"]),
    );
  } catch {
    /* Keep unavailable source identity unknown. */
  }
  const files = [
    "packages/cli/scripts/context-token-volcengine-live-probe.mjs",
    "packages/cli/scripts/context-token-calibration.mjs",
    "packages/cli/src/lib/context-memory-kernel/message-adapter.js",
    "packages/cli/src/lib/context-memory-kernel/provider-context.js",
    "packages/cli/src/lib/llm-pricing.js",
    "packages/cli/src/lib/model-context-catalog.js",
  ].map((relative) => ({
    path: relative,
    sha256: digest(fs.readFileSync(path.join(repository, relative))),
  }));
  return {
    source: { commit, workingTreeDirty, scriptSha256: files[0].sha256, files },
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      osRelease: os.release(),
    },
  };
}

async function boundedResponseBytes(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing response body");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("response body exceeded limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Captures each attempt before network I/O and its settlement afterwards.
 * Only generated prompts are sent. Credentials, response text and raw IDs are
 * never persisted. A started attempt without settlement has unknown cost.
 */
export async function runContextTokenLiveProbe({
  repeats = 1,
  apiKey,
  model,
  baseUrl = BUILT_IN_PROVIDERS.volcengine.baseUrl,
  pricing,
  matrix = null,
  outputDir,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  onProgress = () => {},
}) {
  if (
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > 5 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > TIMEOUT_MS ||
    !apiKey ||
    typeof model !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]{0,127}$/u.test(model) ||
    baseUrl !== BUILT_IN_PROVIDERS.volcengine.baseUrl
  )
    throw new TypeError("invalid live probe configuration");
  if (matrix) assessCalibrationMatrix([], matrix);
  const table = mergePricing(pricing);
  const root = outputDir ? path.resolve(outputDir) : null;
  // Do not reuse directories: even a failed paid attempt is evidence.
  if (root) fs.mkdirSync(root, { mode: 0o700 });
  const persist = (name, value) => {
    if (root)
      fs.writeFileSync(
        path.join(root, name),
        JSON.stringify(value, null, 2) + "\n",
        { flag: "wx", mode: 0o600, flush: true },
      );
  };
  const rows = [];
  const attempts = [];
  const metadata = captureLiveProbeMetadata();
  persist("metadata.json", metadata);
  let knownEstimatedCostUsd = 0;
  let outputTokens = 0;
  const scales =
    repeats === 1 ? [5] : Array.from({ length: repeats }, (_, i) => i + 1);
  probe: for (const scale of scales) {
    for (const sample of cases(scale)) {
      const body = JSON.stringify({
        model,
        messages: sample.messages,
        ...(sample.toolDefinitions.length
          ? { tools: sample.toolDefinitions }
          : {}),
        max_tokens: MAX_OUTPUT_TOKENS,
      });
      const attempt = {
        ordinal: attempts.length + 1,
        category: sample.category,
        scale,
        provider: "volcengine",
        model,
        requestPayloadSha256: digest(body),
        startedAt: new Date().toISOString(),
        status: "STARTED",
        responseIdSha256: null,
        responseBodySha256: null,
        requestedOutputLimit: MAX_OUTPUT_TOKENS,
        observedOutputLimitExceeded: null,
        usage: null,
        estimatedCostUsd: null,
      };
      const stem = `request-${String(attempt.ordinal).padStart(2, "0")}`;
      persist(`${stem}-started.json`, attempt);
      attempts.push(attempt);
      onProgress({ ...attempt });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        });
        attempt.httpStatus = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Volcengine HTTP ${response.status}`);
        }
        const responseBytes = await boundedResponseBytes(response);
        attempt.responseBodySha256 = digest(responseBytes);
        const data = JSON.parse(responseBytes.toString("utf8"));
        if (typeof data?.id === "string" && data.id)
          attempt.responseIdSha256 = digest(data.id);
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
        attempt.responseIdSha256 = digest(data.id);
        attempt.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          prompt_tokens_details: { cached_tokens: cacheReadTokens },
        };
        attempt.observedOutputLimitExceeded =
          completionTokens > MAX_OUTPUT_TOKENS;
        const cost = estimateCost({
          provider: "volcengine",
          model,
          inputTokens: promptTokens - cacheReadTokens,
          cacheReadTokens,
          outputTokens: completionTokens,
          table,
        });
        if (cost.matched) {
          attempt.estimatedCostUsd = cost.totalCost;
          knownEstimatedCostUsd += cost.totalCost;
        }
        outputTokens += completionTokens;
        rows.push({
          ...sample,
          provider: "volcengine",
          model,
          usage: { prompt_tokens: promptTokens },
        });
        attempt.status = "CAPTURED";
      } catch {
        attempt.status = "FAILED";
        attempt.failureKind = controller.signal.aborted
          ? "DEADLINE_EXCEEDED"
          : "RESPONSE_OR_TRANSPORT_FAILED";
      } finally {
        // Deadline includes headers AND the complete bounded response body.
        clearTimeout(timer);
        attempt.finishedAt = new Date().toISOString();
        persist(`${stem}-settled.json`, attempt);
        onProgress({ ...attempt });
      }
      if (attempt.status === "FAILED") break probe;
    }
  }
  const unknownCostRequests = attempts.filter(
    (attempt) => attempt.estimatedCostUsd === null,
  ).length;
  const report = {
    schema: "chainlesschain.context-token-volcengine-live-probe/v1",
    capturedAt: new Date().toISOString(),
    requestCount: rows.length,
    attemptedRequests: attempts.length,
    plannedRequests: repeats * 4,
    executionStatus:
      rows.length === repeats * 4 ? "COMPLETED" : "PARTIAL_FAILURE",
    repeats,
    ...metadata,
    // Legacy field is the REQUEST parameter, never a proven provider cap.
    maxOutputTokensPerRequest: MAX_OUTPUT_TOKENS,
    requestedOutputLimit: MAX_OUTPUT_TOKENS,
    observedMaxOutputTokens: attempts.reduce(
      (maximum, attempt) =>
        Math.max(maximum, attempt.usage?.completion_tokens ?? 0),
      0,
    ),
    observedOutputLimitExceeded: attempts.some(
      (attempt) => attempt.observedOutputLimitExceeded === true,
    ),
    outputLimitExceededRequests: attempts.filter(
      (attempt) => attempt.observedOutputLimitExceeded === true,
    ).length,
    outputLimitEnforcementVerified: false,
    timeoutMsPerRequest: timeoutMs,
    responseIdSha256: attempts
      .map((attempt) => attempt.responseIdSha256)
      .filter(Boolean),
    outputTokens,
    estimatedCostUsd: unknownCostRequests ? null : knownEstimatedCostUsd,
    knownEstimatedCostUsd,
    unknownCostRequests,
    invoiceAssessed: false,
    attempts,
    calibration: rows.length
      ? compareContextTokenEstimates(rows, matrix)
      : null,
    ...(matrix && !rows.length
      ? { matrix: assessCalibrationMatrix([], matrix) }
      : {}),
  };
  persist("receipt.json", report);
  return report;
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
