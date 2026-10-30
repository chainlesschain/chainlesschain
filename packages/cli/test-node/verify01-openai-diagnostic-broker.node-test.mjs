import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OPENAI_BROKER,
  openAiDiagnosticBody,
  openAiDiagnosticJsonUsage,
  openAiDiagnosticUsage,
  createOpenAiDiagnosticBroker,
} from "../scripts/verify01-openai-diagnostic-broker.mjs";

const request = () => ({
  model: OPENAI_BROKER.model,
  stream: true,
  store: false,
  include: ["reasoning.encrypted_content"],
  reasoning: { effort: "medium" },
  input: [
    {
      role: "user",
      content: [{ type: "input_text", text: "offline fixture" }],
    },
    {
      type: "reasoning",
      id: "rs_fixture",
      summary: [],
      encrypted_content: "opaque-fixture",
    },
    {
      type: "function_call",
      id: "fc_fixture",
      call_id: "call_fixture",
      name: "read_file",
      arguments: "{}",
    },
    {
      type: "function_call_output",
      call_id: "call_fixture",
      output: "fixture contents",
    },
  ],
  tools: [
    { type: "function", name: "read_file", parameters: { type: "object" } },
  ],
});

const response = (overrides = {}) => ({
  id: "resp_fixture",
  model: OPENAI_BROKER.model,
  status: "completed",
  service_tier: "default",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "offline fixture" }],
    },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 10,
    total_tokens: 110,
    input_tokens_details: { cached_tokens: 20 },
    output_tokens_details: { reasoning_tokens: 4 },
  },
  ...overrides,
});
const sse = (value) =>
  `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", sequence_number: 2, response: value })}\n\n`;

test("native Responses replay retains empty reasoning summaries, tools and reasoning policy", () => {
  const original = request();
  const body = openAiDiagnosticBody({ ...original, max_output_tokens: 16000 });
  assert.deepEqual(body.input, original.input);
  assert.deepEqual(body.input[1].summary, []);
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.deepEqual(body.tools, original.tools);
  assert.equal(body.max_output_tokens, 8192);
  assert.equal(body.service_tier, "default");
  assert.equal(body.store, false);
  assert.equal(original.max_output_tokens, undefined);
});

test("model, remote state and tool authority cannot be changed by child requests", () => {
  for (const mutate of [
    (value) => {
      value.model = "different-model";
    },
    (value) => {
      value.previous_response_id = "foreign-history";
    },
    (value) => {
      value.conversation = "foreign-conversation";
    },
    (value) => {
      value.service_tier = "fast";
    },
    (value) => {
      value.background = true;
    },
    (value) => {
      value.tools = [{ type: "web_search" }];
    },
    (value) => {
      value.tools[0].name = "run_shell";
    },
    (value) => {
      value.input[1].summary = undefined;
    },
    (value) => {
      value.input[2].name = "mcp__remote";
    },
    (value) => {
      value.input[0].content = [
        { type: "input_image", image_url: "https://invalid.example/secret" },
      ];
    },
  ]) {
    const value = request();
    mutate(value);
    assert.throws(() => openAiDiagnosticBody(value), /DIAGNOSTIC_OPENAI_/u);
  }
  const textOnly = request();
  delete textOnly.tools;
  assert.throws(() => openAiDiagnosticBody(textOnly), /FILE_TOOLS_REQUIRED/u);
  assert.equal(
    openAiDiagnosticBody(textOnly, { allowTextOnlyRequests: true }).tools,
    undefined,
  );
});

test("native usage accounts for reasoning within output tokens and keeps billed cost unknown", () => {
  const result = openAiDiagnosticJsonUsage(JSON.stringify(response()));
  assert.equal(result.usage.output_tokens_details.reasoning_tokens, 4);
  assert.equal(result.finish, "stop");
  assert.equal(
    result.tokenOnlyEstimateUsd,
    (80 * 2 + 20 * 0.1 + 10 * 10) / 1e6,
  );
  assert.equal(result.actualBilledCostUsd, undefined);
  assert.equal(result.estimateExcludesUnreportedCacheWritesAndOtherFees, true);
  assert.deepEqual(openAiDiagnosticUsage(sse(response())), result);
  assert.deepEqual(
    openAiDiagnosticUsage(sse(response()) + "data: [DONE]\n\n"),
    result,
  );
});

test("missing, conflicting or nonfinite response identity and usage never settle", () => {
  for (const mutate of [
    (value) => {
      value.model = "different-model";
    },
    (value) => {
      value.service_tier = "fast";
    },
    (value) => {
      value.status = "in_progress";
    },
    (value) => {
      value.id = "";
    },
    (value) => {
      delete value.usage;
    },
    (value) => {
      delete value.usage.input_tokens_details;
    },
    (value) => {
      value.usage.output_tokens_details.reasoning_tokens = 11;
    },
    (value) => {
      value.usage.total_tokens = 111;
    },
    (value) => {
      value.output = [{ type: "function_call", name: "run_shell" }];
    },
  ]) {
    const value = response();
    mutate(value);
    assert.throws(
      () => openAiDiagnosticJsonUsage(JSON.stringify(value)),
      /DIAGNOSTIC_OPENAI_/u,
    );
  }
  assert.throws(
    () => openAiDiagnosticJsonUsage('{"id":"first","id":"second"}'),
    /DUPLICATE_MEMBER/u,
  );
  assert.throws(
    () => openAiDiagnosticUsage("event: response.created\ndata: {}\n\n"),
    /SEQUENCE_INVALID/u,
  );
  assert.throws(() => openAiDiagnosticUsage(""), /TERMINAL_MISSING/u);
  assert.throws(
    () => openAiDiagnosticUsage(sse(response()) + sse(response())),
    /EVENT_AFTER_TERMINAL/u,
  );
});

test("loopback child receives only a scoped capability and durable Responses receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-openai-offline-"));
  const outputDir = path.join(root, "broker");
  const key = "operator-only-offline-key";
  const dispatched = [];
  const broker = await createOpenAiDiagnosticBroker({
    key,
    outputDir,
    allowedTaskIds: ["verify-01"],
    maximumRequestsPerTask: 1,
    requestImpl: async (body, operatorKey) => {
      assert.equal(operatorKey, key);
      assert.deepEqual(body.input[1].summary, []);
      assert.ok(fs.existsSync(path.join(outputDir, "request-1.dispatch.json")));
      dispatched.push(body);
      return { status: 200, raw: Buffer.from(sse(response())) };
    },
  });
  try {
    broker.beginTask("verify-01");
    assert.notEqual(broker.childKey, key);
    assert.match(broker.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/u);
    const result = await fetch(broker.baseUrl + "/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${broker.childKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request()),
    });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), sse(response()));
    assert.ok(fs.existsSync(path.join(outputDir, "request-1.receipt.json")));
    assert.equal(broker.taskStatus("verify-01").passed, true);
    const denied = await fetch(broker.baseUrl + "/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${broker.childKey}` },
      body: JSON.stringify(request()),
    });
    assert.equal(denied.status, 403);
    assert.equal(dispatched.length, 1);
    const summary = await broker.close();
    assert.equal(summary.formalSample, false);
    assert.equal(summary.actualBilledCostUsd, null);
    assert.equal(typeof summary.tokenOnlyEstimateUsd, "number");
    assert.equal(summary.actualBilledCostCny, undefined);
    for (const entry of fs.readdirSync(outputDir)) {
      const content = fs.readFileSync(path.join(outputDir, entry), "utf8");
      assert.ok(!content.includes(key));
      assert.ok(!content.includes(broker.childKey));
    }
  } finally {
    // close() is idempotent at the HTTP layer; ensure assertions cannot leave
    // the loopback listener open when the fixture fails.
    await broker.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
