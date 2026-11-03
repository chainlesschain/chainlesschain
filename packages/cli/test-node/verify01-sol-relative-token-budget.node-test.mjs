import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SOL_TOKEN_BUDGET_REFERENCE as reference,
  VOLCENGINE_SOL_RELATIVE_TOKEN_BUDGETS as tokenBudgets,
} from "../scripts/verify01-sol-relative-token-budget.mjs";
import { PUBLIC140_GENERATION_RECOVERY_BUDGETS as budgets } from "../scripts/verify01-volcengine-public140-generation-recovery.mjs";
import {
  BROKER,
  createVolcengineDiagnosticBroker,
} from "../scripts/verify01-volcengine-diagnostic-broker.mjs";

const request = (max_tokens, content = "offline fixture") => ({
  model: BROKER.model,
  messages: [{ role: "user", content }],
  ...(max_tokens === undefined ? {} : { max_tokens }),
});
const fileTool = { type: "function", function: { name: "write_file" } };
function response(prompt, output) {
  return {
    status: 200,
    raw: Buffer.from(
      JSON.stringify({
        id: "offline-bounded-token-policy",
        model: BROKER.model,
        service_tier: "default",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "offline" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: prompt,
          completion_tokens: output,
          total_tokens: prompt + output,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    ),
  };
}
async function fixture(t, requestImpl) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-sol-relative-tokens-"),
  );
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  const output = path.join(root, "broker");
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: output,
    key: "offline-not-a-provider-key",
    executionBudgets: budgets,
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
  async function send(body) {
    const result = await fetch(broker.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + broker.childKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: result.status, text: await result.text() };
  }
  return { root: output, broker, send };
}

test("the future token reference is finite and doubles Sol output and internal-summary allowances separately", async (t) => {
  assert.equal(reference.outputTokensPerRequest, 8192);
  assert.equal(reference.physicalRequests, 24);
  assert.equal(tokenBudgets.maximumTaskTokens, 1966080);
  const seen = [];
  const f = await fixture(t, async (body) => {
    seen.push(body.max_tokens);
    return response(100, 1);
  });
  for (const body of [
    request(),
    request(2048),
    request(4096),
    { ...request(1024), tools: [fileTool] },
  ])
    assert.equal((await f.send(body)).status, 200);
  assert.deepEqual(seen, [16384, 2048, 4096, 1024]);
  assert.equal(
    f.broker.taskStatus("verify-31").tokenBudget.knownTotalTokens,
    404,
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.root, "request-3.receipt.json"), "utf8"),
  );
  assert.equal(receipt.tokenReservation.maximumOutputTokens, 4096);
});

test("cumulative output is capped at twice Sol's whole-task allowance, not twice both requests and per-call output", async (t) => {
  const seen = [];
  const f = await fixture(t, async (body) => {
    seen.push(body.max_tokens);
    return response(100, body.max_tokens);
  });
  for (let i = 0; i < 23; i++)
    assert.equal((await f.send(request())).status, 200);
  assert.equal(
    (await f.send({ ...request(10000), tools: [fileTool] })).status,
    200,
  );
  assert.equal((await f.send(request())).status, 200);
  assert.equal(
    seen.at(-1),
    6384,
    "the last output allowance must shrink before dispatch",
  );
  const blocked = await f.send(request());
  assert.equal(blocked.status, 403);
  assert.match(blocked.text, /TASK_TOKEN_BUDGET_EXHAUSTED/u);
  assert.equal(
    seen.length,
    25,
    "no model request after the task allowance is spent",
  );
  const status = f.broker.taskStatus("verify-31");
  assert.equal(status.tokenBudget.knownOutputTokens, 2 * 24 * 8192);
  assert.equal(status.tokenBudget.remainingOutputTokens, 0);
  assert.equal(status.physicalRequestsStarted, 25);
});

test("input plus output is reserved before each dispatch and exhaustion does not create a physical slot", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return response(180000, 1);
  });
  const input = request(undefined, "p".repeat(190000));
  for (let i = 0; i < 10; i++) assert.equal((await f.send(input)).status, 200);
  const blocked = await f.send(input);
  assert.equal(blocked.status, 403);
  assert.match(blocked.text, /TASK_TOKEN_BUDGET_EXHAUSTED/u);
  assert.equal(calls, 10);
  assert.equal(f.broker.taskStatus("verify-31").physicalRequestsStarted, 10);
  assert.equal(
    f.broker.taskStatus("verify-31").tokenBudget.knownTotalTokens,
    1800010,
  );
  assert.ok(!fs.existsSync(path.join(f.root, "request-11.dispatch.json")));
});

test("unknown dispatched usage retains its reservation and prevents another paid request", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    throw new Error("DIAGNOSTIC_TIMEOUT_USAGE_UNKNOWN");
  });
  assert.equal((await f.send(request())).status, 403);
  assert.equal((await f.send(request())).status, 403);
  const status = f.broker.taskStatus("verify-31");
  assert.equal(calls, 1);
  assert.equal(status.usageCompleteRequests, 0);
  assert.equal(status.tokenBudget.unsettledRequests, 1);
  assert.ok(status.tokenBudget.unsettledReservedTokens > 0);
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.root, "request-1.receipt.json"), "utf8"),
  );
  assert.equal(receipt.usage, null);
  assert.equal(receipt.actualBilledCostCny, null);
});

test("provider usage beyond the reserved input bound is rejected without further generation", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return response(100000, 1);
  });
  const result = await f.send(request());
  assert.equal(result.status, 403);
  assert.match(result.text, /INPUT_TOKEN_BOUND_EXCEEDED/u);
  assert.equal((await f.send(request())).status, 403);
  assert.equal(calls, 1);
});
