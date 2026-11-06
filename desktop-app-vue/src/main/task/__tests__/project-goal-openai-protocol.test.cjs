"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https"),
  http = require("node:http");
const {
  createFixture,
  SYNTHETIC_MEMORY,
} = require("./project-goal-volcengine-fixture.cjs");
const { ProjectGoalModelDrafts } = require("../project-goal-model-drafts");
const {
  privateOpenAIEndpoint,
  volcengineEndpoint,
  captureProjectGoalModel,
  ENDPOINT,
} = require("../project-goal-volcengine-model");
function wire(t, transport, mode, onResponse = () => {}) {
  const calls = [];
  t.mock.method(transport, "request", (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => req.emit("close");
    req.end = (bytes) => {
      calls.push({ url, options, body: JSON.parse(bytes) });
      queueMicrotask(() => {
        onResponse();
        const incoming = new EventEmitter();
        incoming.statusCode = mode === "redirect" ? 302 : 200;
        incoming.headers =
          mode === "compressed" ? { "content-encoding": "gzip" } : {};
        incoming.destroy = () => {};
        callback(incoming);
        const data = {
          model: "synthetic-returned-model",
          choices: [
            {
              index: 0,
              finish_reason: mode === "incomplete" ? "length" : "stop",
              message: {
                role: "assistant",
                content:
                  mode === "invalid-json"
                    ? "plain text"
                    : JSON.stringify({
                        title: "Review overdue API delivery",
                        description:
                          "Verify delivery status with Mira using AZURE-17 and record an owner/date checklist.",
                      }),
                ...(mode === "tool-output" ? { tool_calls: [{}] } : {}),
                ...(mode === "reasoning"
                  ? { reasoning_content: "private reasoning" }
                  : {}),
              },
            },
          ],
          ...(mode === "missing-usage"
            ? {}
            : { usage: { prompt_tokens: 31, completion_tokens: 12 } }),
        };
        incoming.emit(
          "data",
          mode === "invalid-utf8"
            ? Buffer.from([0xff])
            : mode === "oversize"
              ? Buffer.alloc(131073)
              : Buffer.from(JSON.stringify(data)),
        );
        incoming.emit("end");
        req.emit("close");
      });
    };
    return req;
  });
  return calls;
}
test("private OpenAI endpoints accept only literal loopback/RFC1918 /v1 with explicit ports", () => {
  for (const value of [
    "http://192.168.31.79:8889/v1",
    "https://10.0.0.2:443/v1/",
    "http://172.16.0.2:8000/v1",
    "http://127.0.0.1:8000/v1",
    "http://[::1]:8000/v1",
  ])
    assert.equal(privateOpenAIEndpoint(value), value.replace(/\/$/u, ""));
  for (const value of [
    "http://example.com:8000/v1",
    "http://192.168.31.79:8889",
    "http://192.168.31.79:8889/v1?key=x",
    "http://key@192.168.31.79:8889/v1",
    "http://8.8.8.8:8000/v1",
    "http://169.254.169.254:80/v1",
    "http://172.32.0.2:8000/v1",
    "http://192.168.031.79:8000/v1",
    "http://2130706433:8000/v1",
    "http://127.1:8000/v1",
    "http://localhost:8000/v1",
    "http://192.168.31.79:8000/%76%31",
    "http://192.168.31.79:99999/v1",
  ])
    assert.throws(() => privateOpenAIEndpoint(value));
  assert.equal(volcengineEndpoint(ENDPOINT), ENDPOINT);
  assert.throws(() => volcengineEndpoint(`${ENDPOINT}/other`));
  assert.throws(() =>
    captureProjectGoalModel({
      provider: "volcengine",
      client: { baseURL: ENDPOINT, model: "fake", apiKey: "fake" },
      isInitialized: true,
    }),
  );
});
for (const provider of ["volcengine", "custom"]) {
  test(`${provider}: signed ingress, exact bounded wire request, Memory consent, usage, replay and restart`, async (t) => {
    const endpoint =
      provider === "volcengine" ? ENDPOINT : "http://192.168.31.79:8889/v1";
    const calls = wire(t, provider === "volcengine" ? https : http, "success");
    const f = await createFixture({
      provider,
      endpoint,
      apiKey: provider === "custom" ? "" : "synthetic-test-key",
    });
    try {
      const result = await f.service.generate(f.request);
      assert.equal(result.state, "saved");
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.equal(call.url, `${endpoint}/chat/completions`);
      assert.equal(call.options.agent, false);
      assert.equal(
        Boolean(call.options.headers.Authorization),
        provider === "volcengine",
      );
      assert.equal(call.body.max_tokens, 512);
      assert.equal(call.body.stream, false);
      assert.equal(call.body.tools, undefined);
      assert.deepEqual(call.body.response_format, { type: "json_object" });
      assert.equal(
        call.body.thinking?.type,
        provider === "volcengine" ? "disabled" : undefined,
      );
      assert.ok(JSON.stringify(call.body.messages).includes(SYNTHETIC_MEMORY));
      assert.ok(f.state.compositions.length > 0);
      assert.equal(f.state.consents[0].model.provider, provider);
      assert.equal(f.state.consents[0].model.endpoint, endpoint);
      const journal = f.db
        .prepare("SELECT record_json FROM cc_project_goal_model_drafts")
        .get().record_json;
      assert.equal(journal.includes(SYNTHETIC_MEMORY), false);
      assert.equal(journal.includes("synthetic-test-key"), false);
      const usage = JSON.parse(
        f.db.prepare("SELECT record_json FROM cc_project_goal_usage").get()
          .record_json,
      );
      assert.equal(usage.usage.tokens, 43);
      assert.equal(usage.usage.costUsd, null);
      assert.equal(
        f.service.read({ id: result.proposalId }).state,
        "pending-confirmation",
      );
      const reopened = new ProjectGoalModelDrafts({
        workflow: f.workflow,
        memory: f.memory,
        getManager: () => {
          throw new Error("Replay cannot resolve a model");
        },
        confirm: () => {
          throw new Error("Replay cannot ask consent");
        },
      });
      assert.deepEqual(await reopened.generate(f.request), result);
      assert.equal(calls.length, 1);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM project_tasks").get().n,
        1,
      );
      f.revoke();
      assert.throws(() => f.service.read({ id: result.proposalId }));
    } finally {
      f.close();
    }
  });
}
for (const mode of [
  "revoke-preparation",
  "revoke-response",
  "incomplete",
  "tool-output",
  "reasoning",
  "invalid-json",
  "invalid-utf8",
  "oversize",
  "redirect",
  "compressed",
]) {
  test(`OpenAI protocol rejects ${mode}, persists uncertainty and never re-dispatches`, async (t) => {
    let f;
    const calls = wire(t, https, mode, () => {
      if (mode === "revoke-response") f.revoke();
    });
    f = await createFixture({ mode });
    try {
      const result = await f.service.generate(f.request);
      assert.equal(
        result.state,
        mode === "revoke-preparation" ? "failed" : "unknown",
      );
      assert.equal(calls.length, mode === "revoke-preparation" ? 0 : 1);
      assert.equal(
        f.db
          .prepare("SELECT COUNT(*) AS n FROM cc_project_goal_extension_drafts")
          .get().n,
        0,
      );
      await f.service.generate(f.request);
      assert.equal(calls.length, mode === "revoke-preparation" ? 0 : 1);
      if (mode !== "revoke-preparation")
        await assert.rejects(
          f.service.generate({ ...f.request, requestId: "different-id" }),
          /GOAL_MODEL_OPERATION_PENDING/u,
        );
    } finally {
      f.close();
    }
  });
}
test("missing token usage remains unknown and consent denial opens no socket", async (t) => {
  const calls = wire(t, https, "missing-usage");
  for (const confirm of [true, false]) {
    const f = await createFixture({
      confirm,
      useMemory: false,
      type: "task.description.update",
    });
    try {
      const result = await f.service.generate(f.request);
      assert.equal(result.state, confirm ? "saved" : "denied");
      if (confirm) {
        const usage = JSON.parse(
          f.db.prepare("SELECT record_json FROM cc_project_goal_usage").get()
            .record_json,
        );
        assert.equal(usage.status, "unknown");
        assert.equal(usage.usage.costUsd, null);
      }
    } finally {
      f.close();
    }
  }
  assert.equal(calls.length, 1);
});
test("provider/key/client change after native consent refuses before a socket", async (t) => {
  const calls = wire(t, https, "success");
  const f = await createFixture();
  try {
    f.service.confirm = async () => {
      f.manager.client.apiKey = "replacement";
      return true;
    };
    const result = await f.service.generate(f.request);
    assert.equal(result.state, "failed");
    assert.equal(calls.length, 0);
  } finally {
    f.close();
  }
});

test("private OpenAI adapter crosses an actual loopback HTTP socket", async () => {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls++;
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(body.model, "glm5.3-flash-tensorfold");
    assert.equal(body.stream, false);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                title: "Verify overdue review",
                description:
                  "Ask Mira to verify API delivery and record the AZURE-17 owner/date checklist.",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 33, completion_tokens: 15 },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let f;
  try {
    f = await createFixture({
      provider: "custom",
      endpoint: `http://127.0.0.1:${server.address().port}/v1`,
      model: "glm5.3-flash-tensorfold",
      apiKey: "",
    });
    const result = await f.service.generate(f.request);
    assert.equal(result.state, "saved");
    assert.equal(calls, 1);
    assert.equal(f.state.providerResults[0].usage.promptTokens, 33);
    await f.service.generate(f.request);
    assert.equal(calls, 1);
  } finally {
    f?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
