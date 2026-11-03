import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BROKER,
  diagnosticBody,
  createVolcengineDiagnosticBroker,
  volcengineBudgetRetryPolicy,
} from "../scripts/verify01-volcengine-diagnostic-broker.mjs";

const budgets = {
  modelTurns: 40,
  physicalRequests: 48,
  outputTokens: 393216,
  connectionAttemptTimeoutMs: 10000,
  parallelToolCalls: null,
  preserveExplicitOutputLimits: true,
};
const request = (max_tokens) => ({
  model: BROKER.model,
  messages: [{ role: "user", content: "offline fixture" }],
  ...(max_tokens === undefined ? {} : { max_tokens }),
});
const options = {
  allowTextOnlyRequests: true,
  maximumAnswerTokens: 393216,
  parallelToolCalls: null,
  preserveExplicitOutputLimits: true,
};
const raw = (tokens, finishReason = "stop", toolCalls) =>
  Buffer.from(
    JSON.stringify({
      id: "offline-explicit-output",
      model: BROKER.model,
      service_tier: "default",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "offline",
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: tokens,
        total_tokens: 100 + tokens,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
  );

test("uncapped agent requests keep the model maximum while explicit2048-token internal summaries remain2048", () => {
  assert.equal(diagnosticBody(request(), options).max_tokens, 393216);
  assert.equal(
    diagnosticBody(
      {
        ...request(),
        tools: [{ type: "function", function: { name: "write_file" } }],
      },
      options,
    ).max_tokens,
    393216,
  );
  for (const tools of [undefined, []])
    assert.equal(
      diagnosticBody({ ...request(2048), tools }, options).max_tokens,
      2048,
    );
  assert.equal(diagnosticBody(request(999999), options).max_tokens, 393216);
  assert.equal(
    diagnosticBody({ ...request(2048), stream: true }, options).stream,
    true,
  );
  assert.equal(
    Object.hasOwn(
      diagnosticBody(request(2048), options),
      "parallel_tool_calls",
    ),
    false,
  );
  assert.equal(
    diagnosticBody(request(2048), {
      ...options,
      preserveExplicitOutputLimits: false,
    }).max_tokens,
    393216,
    "historical forced-output policy remains byte-compatible",
  );
  assert.equal(BROKER.maximumAnswerTokens, 8192);
  assert.equal(
    volcengineBudgetRetryPolicy({
      ...budgets,
      preserveExplicitOutputLimits: undefined,
    }).preserveExplicitOutputLimits,
    undefined,
  );
  assert.equal(
    volcengineBudgetRetryPolicy(budgets).preserveExplicitOutputLimits,
    true,
  );
});

test("invalid explicit limits fail before dispatch rather than being silently replaced", () => {
  for (const value of [
    null,
    0,
    -1,
    0.5,
    "2048",
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])
    assert.throws(
      () => diagnosticBody(request(value), options),
      /EXPLICIT_OUTPUT_LIMIT_INVALID/u,
    );
  assert.throws(
    () =>
      diagnosticBody(request(), {
        ...options,
        preserveExplicitOutputLimits: "true",
      }),
    /EXPLICIT_OUTPUT_POLICY_INVALID/u,
  );
});

async function fixture(t, requestImpl, executionBudgets = budgets) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-explicit-output-"));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  const output = path.join(root, "broker");
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: output,
    key: "offline-not-an-account-key",
    executionBudgets,
    maximumRequestsPerTask: 48,
    allowedTaskIds: ["verify-31"],
    allowTextOnlyRequests: true,
    requestImpl,
  });
  t.after(async () => {
    await broker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  broker.beginTask("verify-31");
  const send = (body) =>
    fetch(broker.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + broker.childKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { root: output, broker, send };
}

test("loopback broker captures distinct agent/internal limits and settles both without paid egress", async (t) => {
  const seen = [];
  const f = await fixture(t, async (body) => {
    seen.push(body.max_tokens);
    return { status: 200, raw: raw(body.max_tokens === 2048 ? 2048 : 20000) };
  });
  for (const input of [request(), request(2048)]) {
    const response = await f.send(input);
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.deepEqual(seen, [393216, 2048]);
  assert.equal(f.broker.taskStatus("verify-31").physicalRequestsStarted, 2);
  assert.equal(f.broker.taskStatus("verify-31").usageCompleteRequests, 2);
  const effective = JSON.parse(
    fs.readFileSync(path.join(f.root, "request-2.effective.json"), "utf8"),
  );
  assert.equal(effective.max_tokens, 2048);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, "policy.json"), "utf8"))
      .preserveExplicitOutputLimits,
    true,
  );
});

test("a provider response exceeding the explicit internal limit is rejected and never automatically retried", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return { status: 200, raw: raw(2049) };
  });
  const response = await f.send(request(2048));
  assert.equal(response.status, 403);
  assert.match(await response.text(), /EXPLICIT_OUTPUT_LIMIT_EXCEEDED/u);
  assert.equal(calls, 1);
  assert.equal(f.broker.taskStatus("verify-31").passed, false);
  const again = await f.send(request());
  assert.equal(again.status, 403);
  await again.text();
  assert.equal(calls, 1);
});

test("bounded internal text may reach its caller-owned limit without poisoning subsequent agent calls", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async () => ({
      status: 200,
      raw: ++calls === 1 ? raw(2048, "length") : raw(20),
    }),
    { ...budgets, allowInternalTextLength: true },
  );
  const first = await f.send({ ...request(2048), tools: [] });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).choices[0].finish_reason, "length");
  assert.equal(f.broker.taskStatus("verify-31").passed, true);
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.root, "request-1.receipt.json"), "utf8"),
  );
  assert.equal(receipt.internalTextOutputBoundaryAccepted, true);
  assert.equal(receipt.usage.completion_tokens, 2048);
  const next = await f.send({
    ...request(),
    tools: [{ type: "function", function: { name: "write_file" } }],
  });
  assert.equal(next.status, 200);
  await next.text();
  assert.equal(calls, 2);
  assert.equal(f.broker.taskStatus("verify-31").usageCompleteRequests, 2);
});

test("ordinary/tool truncation remains fatal and the historical internal-summary verdict stays unchanged", async (t) => {
  for (const [input, executionBudgets, toolCalls] of [
    [request(), { ...budgets, allowInternalTextLength: true }],
    [
      {
        ...request(2048),
        tools: [{ type: "function", function: { name: "write_file" } }],
      },
      { ...budgets, allowInternalTextLength: true },
    ],
    [request(2048), budgets],
    [
      request(2048),
      { ...budgets, allowInternalTextLength: true },
      [
        {
          id: "offline-call",
          type: "function",
          function: { name: "write_file", arguments: '{"path":' },
        },
      ],
    ],
  ]) {
    const f = await fixture(
      t,
      async () => ({ status: 200, raw: raw(2048, "length", toolCalls) }),
      executionBudgets,
    );
    const response = await f.send(input);
    assert.equal(response.status, 403);
    assert.match(await response.text(), /OUTPUT_TRUNCATED/u);
    assert.equal(f.broker.taskStatus("verify-31").passed, false);
  }
  assert.throws(
    () =>
      volcengineBudgetRetryPolicy({
        ...budgets,
        preserveExplicitOutputLimits: undefined,
        allowInternalTextLength: true,
      }),
    /INTERNAL_TEXT_LENGTH_POLICY_INVALID/u,
  );
});
