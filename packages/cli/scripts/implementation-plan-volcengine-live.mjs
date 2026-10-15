#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../src/lib/config-manager.js";
import { applyConfigLlmDefaults } from "../src/lib/llm-config-defaults.js";
import { estimateCost, mergePricing } from "../src/lib/llm-pricing.js";
import { chatWithTools, executeTool } from "../src/runtime/agent-core.js";
import { compactConversationWithProvider } from "../src/harness/provider-backed-compaction.js";
import { requireUnscopedModelTransport } from "../src/lib/formal-budget-provider-scope.js";

const ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3";
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");

/** Bounded diagnostic on the production transport; never imports formal observations. */
export async function runVolcenginePlanDiagnostic(diagnosticOptions = {}) {
  requireUnscopedModelTransport();
  const { output, confirmLive = false } = diagnosticOptions;
  assert.equal(confirmLive, true, "--confirm-live is required for paid calls");
  assert.ok(output, "--output is required for request receipts");
  assert.equal(
    fs.existsSync(output),
    false,
    "Diagnostic evidence must not be overwritten",
  );
  const config = loadConfig();
  const resolved = applyConfigLlmDefaults(
    { provider: "volcengine" },
    config.llm || {},
  );
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  assert.equal(
    config.llm?.provider,
    "volcengine",
    "Select the existing Volcengine configuration first",
  );
  assert.equal((resolved.baseUrl || ENDPOINT).replace(/\/$/, ""), ENDPOINT);
  assert.ok(resolved.apiKey, "Volcengine credential unavailable");
  assert.ok(resolved.model, "Volcengine model unavailable");
  const table = mergePricing(config.llm?.pricing);
  const report = {
    schema: "chainlesschain.implementation-plan-volcengine-diagnostic/v1",
    startedAt: new Date().toISOString(),
    provider: "volcengine",
    model: resolved.model,
    formalSample: false,
    billingVerified: false,
    outputUpperBoundVerified: false,
    estimatedStopIsHardBudget: false,
    requestLimit: 8,
    estimatedSpendStopUsd: 0.05,
    requests: [],
    checks: [],
  };
  report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  }).trim();
  report.sourceBindings = [
    "../src/runtime/agent-core.js",
    "../src/runtime/provider-stream-state.js",
    "../src/harness/provider-backed-compaction.js",
    "../src/lib/llm-pricing.js",
  ].map((file) => ({
    path: file,
    digest: hash(fs.readFileSync(new URL(file, import.meta.url))),
  }));
  const save = () => {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  };
  const originalFetch = globalThis.fetch;
  const oldRetries = process.env.CC_MAX_RETRIES;
  process.env.CC_MAX_RETRIES = "0";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plan-live-"));
  fs.writeFileSync(path.join(root, "fixture.txt"), "PLAN_TOOL_MARKER_731\n");
  let estimatedSpend = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      ENDPOINT + "/chat/completions",
      "Unexpected diagnostic egress",
    );
    assert.ok(
      report.requests.length < report.requestLimit,
      "Request limit reached",
    );
    assert.ok(
      !report.requests.some((row) => row.accounting === "unknown"),
      "Unknown prior usage blocks further requests",
    );
    const body = JSON.parse(options.body);
    assert.equal(body.model, resolved.model);
    assert.ok(
      Buffer.byteLength(options.body) <= 24 * 1024,
      "Request byte limit exceeded",
    );
    assert.ok(
      Number.isInteger(body.max_tokens) &&
        body.max_tokens > 0 &&
        body.max_tokens <= 512,
      "Diagnostic max_tokens declaration missing",
    );
    const quote = estimateCost({
      provider: "volcengine",
      model: resolved.model,
      inputTokens: Buffer.byteLength(options.body),
      outputTokens: body.max_tokens,
      table,
    });
    assert.ok(
      quote.matched &&
        estimatedSpend + quote.totalCost <= report.estimatedSpendStopUsd,
      "Diagnostic estimate stop reached",
    );
    const row = {
      id: report.requests.length + 1,
      requestDigest: hash(options.body),
      startedAt: new Date().toISOString(),
      stream: body.stream === true,
      accounting: "pending",
      requestedMaxOutputTokens: body.max_tokens,
    };
    report.requests.push(row);
    save();
    try {
      const response = await originalFetch(url, options);
      row.httpStatus = response.status;
      return response;
    } catch (error) {
      row.accounting = "unknown";
      row.errorCode = error.code || error.name;
      save();
      throw error;
    }
  };
  const options = {
    ...resolved,
    baseUrl: ENDPOINT,
    cwd: root,
    hermeticExecution: true,
    exactToolNames: true,
    enabledToolNames: [],
    contextMemorySkipPlanning: true,
    maxOutputTokens: 512,
  };
  async function call(messages, overrides = {}) {
    const before = report.requests.length;
    try {
      const result = await chatWithTools(messages, {
        ...options,
        ...overrides,
        signal: overrides.signal || AbortSignal.timeout(60000),
      });
      assert.equal(
        report.requests.length,
        before + 1,
        "Unexpected provider retry",
      );
      const row = report.requests.at(-1);
      const usage = result.usage;
      assert.ok(
        usage &&
          [
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens ?? 0,
          ].every((value) => Number.isSafeInteger(value) && value >= 0),
        "Usage omitted or invalid",
      );
      const price = estimateCost({
        provider: "volcengine",
        model: resolved.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        serviceTier: usage.service_tier || "standard",
        pricingContextInvalid: usage.pricingContextInvalid,
        regionalProcessing: usage.regional_processing,
        table,
      });
      assert.ok(price.matched, "Usage cannot be priced");
      row.accounting = "estimated";
      row.usage = usage;
      row.estimatedCostUsd = price.totalCost;
      row.outputBoundExceeded =
        usage.output_tokens > row.requestedMaxOutputTokens;
      row.responseDigest = hash(JSON.stringify(result.message));
      row.finishedAt = new Date().toISOString();
      estimatedSpend += price.totalCost;
      save();
      assert.equal(
        row.outputBoundExceeded,
        false,
        "Provider output exceeded the requested diagnostic cap; usage was retained and the run stops",
      );
      return result;
    } catch (error) {
      for (const row of report.requests.slice(before))
        if (row.accounting === "pending") row.accounting = "unknown";
      save();
      throw error;
    }
  }
  async function check(name, run) {
    const row = { name, status: "running" };
    report.checks.push(row);
    save();
    try {
      await run();
      row.status = "passed";
    } catch (error) {
      row.status = "failed";
      row.errorCode = error.code || error.name;
      throw error;
    } finally {
      save();
    }
  }
  try {
    await check("stream-and-usage", async () => {
      let deltas = 0;
      const result = await call(
        [{ role: "user", content: "Reply with the two words PLAN READY." }],
        {
          onToken: (text) => {
            if (text) deltas++;
          },
        },
      );
      assert.ok(
        deltas > 0 &&
          result.message.content.length > 0 &&
          result.message._truncated !== true,
      );
      report.checks.at(-1).deltas = deltas;
    });
    await check("read-only-tool-roundtrip", async () => {
      const messages = [
        {
          role: "user",
          content:
            "Call read_file once for fixture.txt. Then repeat its marker exactly. Do not invent the marker.",
        },
      ];
      const result = await call(messages, { enabledToolNames: ["read_file"] });
      const tools = result.message.tool_calls || [];
      assert.equal(tools.length, 1);
      assert.equal(tools[0].function.name, "read_file");
      const args = JSON.parse(tools[0].function.arguments);
      assert.equal(args.path, "fixture.txt");
      const toolResult = await executeTool("read_file", args, {
        cwd: root,
        readOnly: true,
        enabledToolNames: ["read_file"],
        hermeticExecution: true,
      });
      assert.ok(JSON.stringify(toolResult).includes("PLAN_TOOL_MARKER_731"));
      const final = await call(
        [
          ...messages,
          result.message,
          {
            role: "tool",
            tool_call_id: tools[0].id,
            content: JSON.stringify(toolResult),
          },
        ],
        { enabledToolNames: [] },
      );
      assert.ok(final.message.content.includes("PLAN_TOOL_MARKER_731"));
    });
    await check("provider-compaction-fact-retention", async () => {
      const messages = [
        {
          role: "system",
          content: "Keep all user constraints when summarizing.",
        },
        {
          role: "user",
          content:
            "Project identifier cedar-27. Only deliverables.txt may be edited. Network calls and credential reads are forbidden.",
        },
        { role: "assistant", content: "Acknowledged." },
      ];
      for (let i = 0; i < 5; i++)
        messages.push({
          role: i % 2 ? "assistant" : "user",
          content:
            "Discuss implementation details and retain earlier constraints. ".repeat(
              12,
            ),
        });
      const result = await compactConversationWithProvider(messages, {
        force: true,
        maxMessages: 4,
        maxOutputTokens: 512,
        provider: "volcengine",
        model: resolved.model,
        llmQuery: async (prompt) => {
          const response = await call([{ role: "user", content: prompt }]);
          return {
            summary: response.message.content,
            usage: response.usage,
            provider: "volcengine",
            model: resolved.model,
          };
        },
      });
      assert.notEqual(result.stats.degraded, true);
      const text = JSON.stringify(result.messages);
      assert.ok(text.includes("cedar-27") && text.includes("deliverables.txt"));
      assert.ok(/network|网络/i.test(text) && /credential|凭据/i.test(text));
      report.checks.at(-1).savedEstimatedTokens = result.stats.saved;
    });
    await check("stream-stop-without-retry", async () => {
      const controller = new AbortController();
      let emitted = 0;
      let stopped = false;
      try {
        await call(
          [
            {
              role: "user",
              content:
                "List the integers from 1 to 100 with a brief word after each.",
            },
          ],
          {
            signal: controller.signal,
            onToken: (text) => {
              if (text) {
                emitted++;
                controller.abort();
              }
            },
          },
        );
      } catch (error) {
        stopped = controller.signal.aborted;
        if (!stopped) throw error;
      }
      assert.ok(emitted > 0 && controller.signal.aborted && stopped);
      report.checks.at(-1).usageUnknown =
        report.requests.at(-1).accounting === "unknown";
    });
  } catch (error) {
    report.errorCode = error.code || error.name;
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    if (oldRetries === undefined) delete process.env.CC_MAX_RETRIES;
    else process.env.CC_MAX_RETRIES = oldRetries;
    report.knownEstimatedCostUsd = estimatedSpend;
    report.totalEstimatedCostUsd = report.requests.some(
      (row) => row.accounting === "unknown",
    )
      ? null
      : estimatedSpend;
    report.finishedAt = new Date().toISOString();
    report.passed =
      report.checks.length === 4 &&
      report.checks.every((row) => row.status === "passed");
    save();
    const fixturePath = path.resolve(root);
    assert.ok(
      path.dirname(fixturePath) === path.resolve(os.tmpdir()) &&
        path.basename(fixturePath).startsWith("cc-plan-live-"),
      "Disposable fixture must remain within the intended temp directory",
    );
    fs.rmSync(fixturePath, { recursive: true, force: true });
    console.log(
      JSON.stringify({
        passed: report.passed,
        checks: report.checks,
        requests: report.requests.length,
        knownEstimatedCostUsd: estimatedSpend,
        totalEstimatedCostUsd: report.totalEstimatedCostUsd,
        billingVerified: false,
        formalSample: false,
      }),
    );
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      "confirm-live": { type: "boolean" },
      output: { type: "string" },
    },
  });
  runVolcenginePlanDiagnostic({
    output: values.output,
    confirmLive: values["confirm-live"],
  }).catch((error) => {
    console.error(JSON.stringify({ errorCode: error.code || error.name }));
    process.exitCode = 1;
  });
}
