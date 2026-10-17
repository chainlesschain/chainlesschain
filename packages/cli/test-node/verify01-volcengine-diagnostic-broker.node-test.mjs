import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  BROKER,
  diagnosticBody,
  diagnosticUsage,
  diagnosticJsonUsage,
  parseDiagnosticJson,
  createVolcengineDiagnosticBroker,
  requestArk,
} from "../scripts/verify01-volcengine-diagnostic-broker.mjs";

const request = () => ({
  model: BROKER.model,
  stream: true,
  messages: [{ role: "user", content: "offline fixture" }],
  tools: [
    {
      type: "function",
      function: { name: "read_file", parameters: { type: "object" } },
    },
  ],
});
function response(mutate = () => {}) {
  const row = {
    model: BROKER.model,
    service_tier: "default",
    choices: [
      { index: 0, delta: { content: "fixture" }, finish_reason: "stop" },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
  mutate(row);
  return Buffer.from(`data: ${JSON.stringify(row)}\n\ndata: [DONE]\n\n`);
}
test("effective diagnostic request fixes model, thinking, service tier and token ceiling", () => {
  const body = diagnosticBody({ ...request(), max_tokens: 999999 });
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.service_tier, "default");
  assert.throws(
    () => diagnosticBody({ ...request(), model: "other" }),
    /MODEL_MISMATCH/,
  );
  assert.throws(
    () =>
      diagnosticBody({
        ...request(),
        tools: [{ type: "function", function: { name: "run_shell" } }],
      }),
    /FILE_TOOLS_REQUIRED/,
  );
  assert.throws(
    () => diagnosticBody({ ...request(), thinking: { type: "enabled" } }),
    /UNEXPECTED_FIELD/,
  );
  assert.doesNotThrow(() =>
    diagnosticBody({
      ...request(),
      messages: [{ role: "user", content: "x".repeat(82 * 1024) }],
    }),
  );
  assert.throws(
    () =>
      diagnosticBody({
        ...request(),
        messages: [
          { role: "user", content: "x".repeat(BROKER.maximumRequestBytes) },
        ],
      }),
    /REQUEST_BYTES_LIMIT/,
  );
});
test("pre-dispatch request size rejection fails only its own task", async (t) => {
  let calls = 0;
  const { broker, send } = await fixture(t, async () => {
    calls += 1;
    return { status: 200, raw: response() };
  });
  try {
    assert.equal((await send()).status, 200);
    const oversized = {
      ...request(),
      messages: [
        { role: "user", content: "x".repeat(BROKER.maximumRequestBytes) },
      ],
    };
    const rejected = await fetch(`${broker.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${broker.childKey}` },
      body: JSON.stringify(oversized),
    });
    assert.equal(rejected.status, 403);
    assert.match(await rejected.text(), /DIAGNOSTIC_REQUEST_BYTES_LIMIT/u);
    assert.equal(calls, 1);
    assert.deepEqual(broker.taskStatus("verify-04"), {
      physicalRequestsStarted: 1,
      usageCompleteRequests: 1,
      passed: false,
      poisoned: null,
      errorCode: "DIAGNOSTIC_REQUEST_BYTES_LIMIT",
    });
    broker.beginTask("verify-22");
    assert.equal((await send()).status, 200);
    assert.equal(broker.taskStatus("verify-22").passed, true);
    assert.equal(calls, 2);
  } finally {
    const result = await broker.close();
    assert.equal(result.poisoned, null);
    assert.equal(result.physicalRequestsStarted, 2);
    assert.equal(result.usageCompleteRequests, 2);
  }
});
function fakeRequest() {
  const req = new EventEmitter();
  req.payloads = [];
  req.end = (payload) => {
    req.payloads.push(payload);
    req.emit("finish");
  };
  req.destroy = () => {
    req.destroyed = true;
  };
  return req;
}
test("Ark transport gates HTTP dispatch on TLS and records the failure phase", async () => {
  const before = fakeRequest();
  const socketBefore = new EventEmitter();
  const preflight = requestArk(diagnosticBody(request()), "OFFLINE-KEY", {
    requestFactory: (_endpoint, options) => {
      assert.equal(options.autoSelectFamily, true);
      assert.equal(options.autoSelectFamilyAttemptTimeout, 2000);
      return before;
    },
    timeoutMs: 100,
  });
  before.emit("socket", socketBefore);
  socketBefore.emit("connectionAttempt", "OFFLINE-IP", 443, 6);
  socketBefore.emit("connectionAttemptTimeout", "OFFLINE-IP", 443, 6);
  assert.equal(before.payloads.length, 0);
  before.emit(
    "error",
    Object.assign(new Error("DNS failed"), {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
    }),
  );
  await assert.rejects(preflight, (error) => {
    assert.equal(error.message, "DIAGNOSTIC_REQUEST_NOT_DISPATCHED");
    assert.equal(error.captured.transport.dispatchStarted, false);
    assert.equal(error.captured.transport.errorCode, "ENOTFOUND");
    assert.equal(error.captured.transport.errorSyscall, "GETADDRINFO");
    assert.deepEqual(
      error.captured.transport.connectionAttempts.map(({ event, family }) => ({
        event,
        family,
      })),
      [
        { event: "start", family: 6 },
        { event: "timeout", family: 6 },
      ],
    );
    return true;
  });
  socketBefore.emit("secureConnect");
  assert.equal(before.payloads.length, 0);

  const after = fakeRequest();
  const socketAfter = new EventEmitter();
  const dispatched = requestArk(diagnosticBody(request()), "OFFLINE-KEY", {
    requestFactory: () => after,
    timeoutMs: 100,
  });
  after.emit("socket", socketAfter);
  socketAfter.emit("secureConnect");
  assert.equal(after.payloads.length, 1);
  after.emit(
    "error",
    Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  );
  await assert.rejects(dispatched, (error) => {
    assert.equal(error.message, "DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN");
    assert.equal(error.captured.transport.dispatchStarted, true);
    assert.equal(error.captured.transport.errorCode, "ECONNRESET");
    return true;
  });

  const timed = fakeRequest();
  const lateSocket = new EventEmitter();
  const timeout = requestArk(diagnosticBody(request()), "OFFLINE-KEY", {
    requestFactory: () => timed,
    timeoutMs: 5,
  });
  timed.emit("socket", lateSocket);
  await assert.rejects(timeout, /DIAGNOSTIC_REQUEST_NOT_DISPATCHED/u);
  lateSocket.emit("secureConnect");
  assert.equal(timed.payloads.length, 0);

  const normal = fakeRequest();
  const normalSocket = new EventEmitter();
  const completed = requestArk(diagnosticBody(request()), "OFFLINE-KEY", {
    requestFactory: () => normal,
    timeoutMs: 100,
  });
  normal.emit("socket", normalSocket);
  normalSocket.emit("secureConnect");
  const res = new EventEmitter();
  res.statusCode = 200;
  normal.emit("response", res);
  res.emit("data", jsonResponse());
  res.emit("end");
  const result = await completed;
  assert.equal(result.status, 200);
  assert.equal(result.transport.dispatchStarted, true);
  assert.equal(result.raw.toString(), jsonResponse().toString());
  assert.equal(normal.payloads.length, 1);

  const throwing = fakeRequest();
  throwing.end = () => {
    throw new Error("write failed");
  };
  const throwingSocket = new EventEmitter();
  const failedWrite = requestArk(diagnosticBody(request()), "OFFLINE-KEY", {
    requestFactory: () => throwing,
    timeoutMs: 100,
  });
  throwing.emit("socket", throwingSocket);
  throwingSocket.emit("secureConnect");
  await assert.rejects(failedWrite, (error) => {
    assert.equal(error.message, "DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN");
    assert.equal(error.captured.transport.dispatchStarted, true);
    return true;
  });
  assert.equal(throwing.destroyed, true);
});
test("proven pre-HTTP network failure fails one task without retrying it", async (t) => {
  let calls = 0;
  const { root, broker, send } = await fixture(t, async () => {
    calls += 1;
    if (calls === 1)
      throw Object.assign(new Error("DIAGNOSTIC_REQUEST_NOT_DISPATCHED"), {
        captured: {
          status: null,
          raw: Buffer.alloc(0),
          transport: { dispatchStarted: false, errorCode: "ENOTFOUND" },
        },
      });
    return { status: 200, raw: response() };
  });
  try {
    assert.equal((await send()).status, 403);
    assert.equal((await send()).status, 403);
    assert.equal(calls, 1);
    assert.equal(
      broker.taskStatus("verify-04").errorCode,
      "DIAGNOSTIC_REQUEST_NOT_DISPATCHED",
    );
    const receipt = JSON.parse(
      fs.readFileSync(path.join(root, "broker", "request-1.receipt.json")),
    );
    assert.equal(receipt.errorCode, "DIAGNOSTIC_REQUEST_NOT_DISPATCHED");
    assert.equal(receipt.transport.dispatchStarted, false);
    broker.beginTask("verify-22");
    assert.equal((await send()).status, 200);
    assert.equal(broker.taskStatus("verify-22").passed, true);
    assert.equal(calls, 2);
  } finally {
    const summary = await broker.close();
    assert.equal(summary.poisoned, null);
    assert.equal(summary.physicalRequestsStarted, 2);
    assert.equal(summary.usageCompleteRequests, 1);
  }
});
test("claimed pre-dispatch failure after HTTP submission still poisons the broker", async (t) => {
  const { broker, send } = await fixture(t, async () => {
    throw Object.assign(new Error("DIAGNOSTIC_REQUEST_NOT_DISPATCHED"), {
      captured: {
        status: null,
        raw: Buffer.alloc(0),
        transport: { dispatchStarted: true, errorCode: "ECONNRESET" },
      },
    });
  });
  try {
    assert.equal((await send()).status, 403);
    assert.throws(() => broker.beginTask("verify-22"));
  } finally {
    assert.equal(
      (await broker.close()).poisoned,
      "DIAGNOSTIC_REQUEST_ERROR_USAGE_UNKNOWN",
    );
  }
});
test("unknown usage, model, tier, partial output and reasoning cannot settle", () => {
  assert.equal(
    diagnosticUsage(response().toString()).tokenOnlyEstimateCny,
    0.00039,
  );
  for (const mutate of [
    (r) => delete r.usage,
    (r) => delete r.service_tier,
    (r) => {
      r.model = "other";
    },
    (r) => {
      r.usage.completion_tokens_details.reasoning_tokens = 1;
    },
    (r) => {
      r.usage.total_tokens += 1;
    },
    (r) => {
      r.choices[0].finish_reason = "length";
    },
    (r) => {
      r.usage.prompt_tokens_details.cached_tokens = 101;
    },
  ])
    assert.throws(() => diagnosticUsage(response(mutate).toString()));
  assert.throws(
    () => diagnosticUsage(response().toString().replace("data: [DONE]", "")),
    /INCOMPLETE_STREAM/,
  );
});
test("duplicate decoded members, overflow and incomplete JSON never become usage", () => {
  for (const raw of [
    '{"prompt_tokens":999999,"prompt_tokens":100}',
    '{"prompt_tokens":1,"prompt_\\u0074okens":2}',
    '{"x":1e999}',
    '{"x":1} extra',
    '{"x":1,}',
  ])
    assert.throws(() => parseDiagnosticJson(raw));
  const duplicate = response()
    .toString()
    .replace(
      '"prompt_tokens":100',
      '"prompt_tokens":999999,"prompt_tokens":100',
    );
  assert.throws(() => diagnosticUsage(duplicate), /JSON_DUPLICATE_MEMBER/);
});
function jsonResponse(mutate = () => {}) {
  const row = {
    id: "OFFLINE-FIXTURE-RECEIPT",
    model: BROKER.model,
    service_tier: "default",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "fixture" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
  mutate(row);
  return Buffer.from(JSON.stringify(row));
}
test("public CLI nonstreaming JSON request preserves all diagnostic bounds", () => {
  const input = request();
  delete input.stream;
  const body = diagnosticBody(input);
  assert.equal(body.stream, false);
  assert.equal(Object.hasOwn(body, "stream_options"), false);
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(
    diagnosticJsonUsage(jsonResponse().toString()).tokenOnlyEstimateCny,
    0.00039,
  );
  for (const mutate of [
    (r) => delete r.usage,
    (r) => delete r.id,
    (r) => {
      r.model = "other";
    },
    (r) => delete r.service_tier,
    (r) => {
      r.choices.push(r.choices[0]);
    },
    (r) => {
      r.choices[0].message.reasoning_content = "unexpected";
    },
    (r) => {
      r.usage.completion_tokens_details.reasoning_tokens = 1;
    },
    (r) => {
      r.choices[0].message.content = {};
    },
    (r) => {
      r.choices[0].message.tool_calls = {};
    },
    (r) => {
      r.choices[0].finish_reason = "tool_calls";
      r.choices[0].message.tool_calls = [];
    },
  ])
    assert.throws(() => diagnosticJsonUsage(jsonResponse(mutate).toString()));
  assert.throws(
    () =>
      diagnosticJsonUsage(
        jsonResponse()
          .toString()
          .replace(
            '"prompt_tokens":100',
            '"prompt_tokens":999999,"prompt_tokens":100',
          ),
      ),
    /JSON_DUPLICATE_MEMBER/,
  );
});
test("JSON response is persisted before forwarding and unknown JSON usage poisons the next call", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-volcengine-json-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: path.join(root, "broker"),
    key: "OFFLINE-FAKE-SECRET",
    requestImpl: async (body) => {
      assert.equal(body.stream, false);
      assert.equal(body.max_tokens, 4096);
      calls += 1;
      return {
        status: 200,
        raw: jsonResponse(calls === 1 ? () => {} : (r) => delete r.usage),
      };
    },
  });
  broker.beginTask("verify-04");
  const input = request();
  delete input.stream;
  const send = () =>
    fetch(`${broker.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${broker.childKey}` },
      body: JSON.stringify(input),
    });
  try {
    const res = await send();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.ok(
      fs.existsSync(path.join(root, "broker", "request-1.receipt.json")),
    );
    assert.deepEqual(await res.json(), JSON.parse(jsonResponse()));
    assert.equal((await send()).status, 403);
    assert.equal((await send()).status, 403);
    assert.equal(calls, 2);
  } finally {
    const result = await broker.close();
    assert.equal(result.physicalRequestsStarted, 2);
    assert.equal(result.usageCompleteRequests, 1);
    assert.equal(result.tokenOnlyEstimateCny, null);
  }
  assert.ok(fs.existsSync(path.join(root, "broker", "response-1.json")));
});
async function fixture(t, requestImpl) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-volcengine-broker-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: path.join(root, "broker"),
    key: "OFFLINE-FAKE-SECRET",
    requestImpl,
  });
  broker.beginTask("verify-04");
  const send = (key = broker.childKey) =>
    fetch(`${broker.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request()),
    });
  return { root, broker, send };
}
test("physical slots persist before dispatch; secret is absent; restart and 15th request reject", async (t) => {
  let calls = 0;
  const { root, broker, send } = await fixture(t, async (body) => {
    calls += 1;
    assert.ok(
      fs.existsSync(
        path.join(root, "broker", `request-${calls}.dispatch.json`),
      ),
    );
    assert.equal(body.thinking.type, "disabled");
    return { status: 200, raw: response() };
  });
  try {
    assert.equal((await send("wrong")).status, 403);
    assert.equal(calls, 0);
    for (let i = 0; i < 14; i++) {
      const res = await send();
      assert.equal(res.status, 200);
      await res.text();
    }
    assert.equal((await send()).status, 403);
    assert.equal(calls, 14);
    assert.throws(
      () => broker.beginTask("verify-04"),
      /TASK_ALLOWANCE_INVALID/,
    );
  } finally {
    const result = await broker.close();
    assert.equal(result.physicalRequestsStarted, 14);
    assert.equal(result.usageCompleteRequests, 14);
    assert.equal(result.actualBilledCostCny, null);
  }
  for (const file of fs.readdirSync(path.join(root, "broker")))
    assert.ok(
      !fs
        .readFileSync(path.join(root, "broker", file), "utf8")
        .includes("OFFLINE-FAKE-SECRET"),
    );
  await assert.rejects(
    () =>
      createVolcengineDiagnosticBroker({
        outputDir: path.join(root, "broker"),
        key: "fixture",
      }),
    /EEXIST/,
  );
});
test("usage unknown poisons allowance, stays null, and never silently retries", async (t) => {
  let calls = 0;
  const { broker, send } = await fixture(t, async () => {
    calls += 1;
    return {
      status: 200,
      raw: response((r) => {
        delete r.usage;
      }),
    };
  });
  try {
    assert.equal((await send()).status, 403);
    assert.equal((await send()).status, 403);
    assert.equal(calls, 1);
    assert.throws(() => broker.beginTask("verify-22"));
  } finally {
    const result = await broker.close();
    assert.equal(result.physicalRequestsStarted, 1);
    assert.equal(result.tokenOnlyEstimateCny, null);
    assert.equal(result.poisoned, "DIAGNOSTIC_USAGE_UNKNOWN");
  }
});
test("last-call receipt failure prevents HTTP 200 and poisons task status", async (t) => {
  const { root, broker, send } = await fixture(t, async () => {
    fs.mkdirSync(path.join(root, "broker", "request-1.receipt.json"));
    return { status: 200, raw: response() };
  });
  try {
    const res = await send();
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes("[DONE]"));
    assert.equal(broker.taskStatus("verify-04").passed, false);
  } finally {
    assert.equal(
      (await broker.close()).poisoned,
      "DIAGNOSTIC_EVIDENCE_FAILURE",
    );
  }
});
test("literal and JSON-escaped credentials are redacted from saved requests and responses", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-volcengine-redaction-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const secret = 'OFFLINE"\\SECRET';
  const broker = await createVolcengineDiagnosticBroker({
    outputDir: path.join(root, "broker"),
    key: secret,
    requestImpl: async () => ({
      status: 200,
      raw: response((r) => {
        r.choices[0].delta.content = secret;
      }),
    }),
  });
  broker.beginTask("verify-04");
  try {
    const input = request();
    input.messages[0].content = secret;
    const res = await fetch(`${broker.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${broker.childKey}` },
      body: JSON.stringify(input),
    });
    assert.equal(res.status, 200);
    assert.ok(
      !(await res.text()).includes(JSON.stringify(secret).slice(1, -1)),
    );
  } finally {
    await broker.close();
  }
  for (const file of fs.readdirSync(path.join(root, "broker"))) {
    const text = fs.readFileSync(path.join(root, "broker", file), "utf8");
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes(JSON.stringify(secret).slice(1, -1)));
  }
});
