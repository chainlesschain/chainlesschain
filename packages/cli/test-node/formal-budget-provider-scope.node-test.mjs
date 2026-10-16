import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import { createFormalBudgetTransport } from "../src/lib/formal-budget-transport.js";
import {
  providerFetch,
  withFormalBudgetProviderScope,
} from "../src/lib/formal-budget-provider-scope.js";
import { isRetryableStreamError } from "../src/lib/stream-retry.js";
import {
  chatWithTools,
  agentLoop,
  _retryStreamingChat,
} from "../src/runtime/agent-core.js";
import { streamOpenAI } from "../src/lib/chat-core.js";
import { openAIStream } from "../src/lib/provider-stream.js";
import { probeLlmConnection } from "../src/lib/llm-connection-probe.js";
import { openAiCompatChat } from "../src/lib/hub-llm-client.js";
import { queryLLM } from "../src/commands/ask.js";
import { createChatFn } from "../src/lib/cowork-adapter.js";
import { LLMProviderRegistry } from "../src/lib/llm-providers.js";
import { createGovernedHubLlm } from "../src/lib/evolution/governed-hub-llm.js";
import { createGovernedHubResolver } from "../src/lib/evolution/governed-hub-resolver.js";
import { createGovernedSkillSynthesisProcessGrader } from "../src/lib/evolution/governed-skill-synthesis-process-grader.js";
import { SubAgentContext } from "../src/lib/sub-agent-context.js";
import { makeFallbackChatFn } from "../src/runtime/fallback-model.js";
import { isTerminalModelFailure } from "../src/lib/model-failure-policy.js";
import { isAuthError } from "../src/lib/runnable-provider.js";
import { createTestAgentEvolutionComposition } from "../__tests__/fixtures/agent-evolution-test-deployment.js";
import { createAgentEvolutionRuntimeComposition } from "../src/lib/evolution/agent-evolution-runtime-composition.js";
import executionBroker from "../src/lib/process-execution-broker/index.js";
import { createTypeSafeDecisionProvider } from "../src/lib/decision-layer/typesafe-provider.js";
import { compactConversationWithProvider } from "../src/harness/provider-backed-compaction.js";
import {
  invokeToolFreeAdvisor,
  AdvisorRuntime,
} from "../src/lib/advisor-runtime.js";
import {
  NOW,
  body,
  response,
  config,
  attest,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const endpoint = "https://fixture.invalid/v1/chat/completions";
const require = createRequire(import.meta.url);
const hubSdk = require("@chainlesschain/personal-data-hub/entity-resolver");
const {
  OllamaClient,
} = require("@chainlesschain/personal-data-hub/llm-client");
const {
  CcLLMAdapter,
} = require("@chainlesschain/personal-data-hub/bridges/cc-llm-adapter");
const target = {
  provider: "volcengine",
  model: body.model,
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "caller-key-must-not-be-sent",
};
const options = {
  ...target,
  contextMemorySkipPlanning: true,
  enabledToolNames: [],
  extraToolDefinitions: [],
};
const post = (request = body, extra = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer caller",
  },
  body: JSON.stringify(request),
  ...extra,
});
const frame = (row) => `data: ${JSON.stringify(row)}\n\n`;
const delta = frame({
  ...response(),
  usage: null,
  choices: [{ index: 0, delta: { content: "first" }, finish_reason: null }],
});
const ending = frame({
  ...response(),
  usage: null,
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
});
const usageFrame = frame({ ...response(), choices: [] });
const sse = (raw = delta + ending + usageFrame + "data: [DONE]\n\n") =>
  new Response(raw, { headers: { "Content-Type": "text/event-stream" } });

function fixture(
  t,
  fetchImpl = async () => Response.json(response()),
  transportOptions = {},
) {
  // ArtifactStore requires physical paths; macOS exposes its temp directory
  // through /var, a symlink to /private/var. Resolve only the test-owned root.
  const root = (fs.realpathSync.native || fs.realpathSync)(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-budget-scope-")),
  );
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Offline test refused an ungoverned fetch");
  });
  const cfg = config();
  // Synthetic, attested offline ceilings; these are never account evidence.
  cfg.contracts[0].maxAnswerTokens = 4096;
  cfg.contracts[0].inputEnvelope.maximumRequestBytes = 128 * 1024;
  attest(cfg);
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(root, "authority.sqlite"),
    config: cfg,
    verifyEvidence: verifyFixtureEvidence,
    now: () => NOW,
  });
  const open = () =>
    new FormalBudgetAuthority({
      ...descriptor,
      verifyEvidence: verifyFixtureEvidence,
      now: () => NOW,
    });
  const a = open();
  a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
  let physical = 0,
    credentials = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => {
      credentials++;
      return "host-secret";
    },
    fetchImpl: (...args) => {
      physical++;
      return fetchImpl(...args);
    },
    ...transportOptions,
  });
  t.after(() => {
    a.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    a,
    root,
    open,
    descriptor,
    transport,
    run: (operation) =>
      withFormalBudgetProviderScope({ transport, runId: "initial" }, operation),
    counts: () => ({ physical, credentials }),
  };
}

async function evolution(f) {
  const stateRoot = fs.mkdtempSync(path.join(f.root, "evolution-"));
  const composition = createTestAgentEvolutionComposition(
    createAgentEvolutionRuntimeComposition,
    { runId: "budget-route-fixture" },
    stateRoot,
  );
  const ingress = composition.evolutionIngress;
  await ingress.start();
  await ingress.ingestUserPrompt({
    messages: body.messages,
    source: "budget-route-test",
  });
  return ingress;
}

test("scoped requests use host credentials, a fresh physical ID and durable settlement", async (t) => {
  const sent = [];
  let f;
  f = fixture(t, async (url, init) => {
    assert.equal(f.a.status().pending[0].state, "dispatched");
    sent.push({ url, init });
    return Response.json(response({ id: `receipt-${sent.length}` }));
  });
  await f.run(async () => {
    for (let i = 0; i < 2; i++) {
      const res = await providerFetch(endpoint, post());
      assert.equal((await res.json()).model, body.model);
    }
  });
  assert.equal(f.counts().physical, 2);
  assert.equal(f.a.status().pending.length, 0);
  assert(f.a.status().exposureUsdMicros > 0);
  assert(
    sent.every(
      ({ url, init }) =>
        url === endpoint &&
        init.redirect === "error" &&
        init.headers.Authorization === "Bearer host-secret",
    ),
  );
  const stored = fs.readFileSync(f.descriptor.filename);
  assert(!stored.includes(Buffer.from("host-secret")));
  assert(!stored.includes(Buffer.from(body.messages[0].content)));
});

test("endpoint, schema, header, duplicate JSON and output bounds reject before reservation or credentials", async (t) => {
  const f = fixture(t);
  const variants = [
    [endpoint.replace("fixture.invalid", "other.invalid"), post()],
    [endpoint, post({ ...body, model: "other" })],
    [endpoint, post({ ...body, max_tokens: 4097 })],
    [endpoint, post(body, { method: "GET" })],
    [endpoint, post(body, { headers: { "Content-Type": "text/plain" } })],
    [
      endpoint,
      post(body, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "uncovered",
        },
      }),
    ],
    [endpoint, post(body, { dispatcher: {} })],
    [
      endpoint,
      post(body, {
        body: JSON.stringify(body).slice(0, -1) + ',"model":"fixture-model"}',
      }),
    ],
    [
      endpoint,
      post({
        ...body,
        messages: [{ role: "user", content: "x".repeat(128 * 1024) }],
      }),
    ],
  ];
  await f.run(async () => {
    for (const [url, init] of variants)
      await assert.rejects(providerFetch(url, init));
  });
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
  assert.equal(f.a.status().pending.length, 0);
});

test("SSE reaches the consumer before completion and settles only at verified EOF", async (t) => {
  let upstream;
  const f = fixture(t, async () =>
    sse(
      new ReadableStream({
        start(controller) {
          upstream = controller;
          controller.enqueue(Buffer.from(delta));
        },
      }),
    ),
  );
  await f.run(async () => {
    const res = await providerFetch(endpoint, post({ ...body, stream: true }));
    const reader = res.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /first/,
    );
    assert.equal(f.a.status().pending[0].state, "dispatched");
    upstream.enqueue(Buffer.from(ending + usageFrame + "data: [DONE]\n\n"));
    upstream.close();
    while (!(await reader.read()).done) {
      /* consume through durable settlement */
    }
    assert.equal(f.a.status().pending.length, 0);
  });
});

test("consumer mutation cannot alter the private accounting snapshot", async (t) => {
  const f = fixture(t);
  await f.run(async () => {
    const res = await providerFetch(endpoint, post());
    const reader = res.body.getReader();
    const first = await reader.read();
    first.value.fill(0);
    assert.equal((await reader.read()).done, true);
  });
  assert.equal(f.a.status().pending.length, 0);
});

test("Stop after visible output keeps liability across reopen and prevents any retry", async (t) => {
  const f = fixture(t, async () =>
    sse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(delta));
        },
      }),
    ),
  );
  await f.run(async () => {
    const controller = new AbortController();
    const res = await providerFetch(
      endpoint,
      post({ ...body, stream: true }, { signal: controller.signal }),
    );
    const reader = res.body.getReader();
    await reader.read();
    const held = f.a.status().exposureUsdMicros;
    controller.abort();
    await assert.rejects(reader.read(), {
      code: "CC_BUDGET_TRANSPORT_UNKNOWN",
    });
    await assert.rejects(providerFetch(endpoint, post()), {
      code: "CC_BUDGET_HALTED",
    });
    const reopened = f.open();
    try {
      assert.equal(reopened.status().pending[0].state, "unknown");
      assert.equal(reopened.status().exposureUsdMicros, held);
    } finally {
      reopened.close();
    }
  });
  assert.equal(f.counts().physical, 1);
});

test("body cancellation and returning an unread body both halt outstanding liability", async (t) => {
  for (const cancel of [true, false])
    await t.test(String(cancel), async (sub) => {
      const f = fixture(sub);
      const res = await f.run(async () => {
        const result = await providerFetch(endpoint, post());
        if (cancel) await result.body.cancel();
        return result;
      });
      assert.equal(f.a.status().pending[0].state, "unknown");
      if (!cancel)
        await assert.rejects(res.text(), {
          code: "CC_BUDGET_TRANSPORT_UNKNOWN",
        });
    });
});

test("scope isolation preserves ordinary calls and independent concurrent host scopes", async (t) => {
  const left = fixture(t),
    right = fixture(t);
  let fallback = 0;
  const ordinaryFetch = async () => {
    fallback++;
    return Response.json({ ordinary: true });
  };
  const result = await Promise.all([
    left.run(async () =>
      (await providerFetch(endpoint, post(), ordinaryFetch)).json(),
    ),
    right.run(async () =>
      (await providerFetch(endpoint, post(), ordinaryFetch)).json(),
    ),
    providerFetch(endpoint, post(), ordinaryFetch).then((res) => res.json()),
  ]);
  assert(result[2].ordinary);
  assert.equal(fallback, 1);
  assert.equal(left.counts().physical, 1);
  assert.equal(right.counts().physical, 1);
});

test("nested scopes and detached async work cannot rebind or escape a closed budget scope", async (t) => {
  const f = fixture(t);
  let release, late;
  await f.run(async () => {
    await assert.rejects(
      f.run(async () => {}),
      { code: "CC_BUDGET_SCOPE_NESTED" },
    );
    late = new Promise((resolve) => {
      release = resolve;
    }).then(() => providerFetch(endpoint, post()));
  });
  release();
  await assert.rejects(late, { code: "CC_BUDGET_SCOPE_CLOSED" });
  assert.equal(f.counts().physical, 0);
});

test("a pre-aborted call creates no liability and no physical request", async (t) => {
  const f = fixture(t);
  await f.run(async () => {
    await assert.rejects(
      providerFetch(endpoint, post(body, { signal: AbortSignal.abort() })),
    );
  });
  assert.equal(f.a.status().exposureUsdMicros, 0);
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
});

test("cancellation bounds credential preparation and a physical fetch that ignores AbortSignal", async (t) => {
  for (const waiting of ["credential", "fetch"])
    await t.test(waiting, async (sub) => {
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      const hang = () => {
        started();
        return new Promise(() => {});
      };
      const f = fixture(
        sub,
        waiting === "fetch" ? hang : undefined,
        waiting === "credential" ? { credentialProvider: hang } : {},
      );
      await f.run(async () => {
        const controller = new AbortController();
        const pending = providerFetch(
          endpoint,
          post(body, { signal: controller.signal }),
        );
        const rejected = assert.rejects(pending, {
          code: "CC_BUDGET_TRANSPORT_UNKNOWN",
        });
        await ready;
        controller.abort();
        await rejected;
      });
      assert.equal(f.counts().physical, waiting === "fetch" ? 1 : 0);
      assert.equal(f.a.status().pending[0].state, "unknown");
    });
});

test("a deadline halts even an unread response", async (t) => {
  const f = fixture(t, undefined, { timeoutMs: 20 });
  await f.run(async () => {
    const res = await providerFetch(endpoint, post());
    await delay(40);
    await assert.rejects(res.text(), { code: "CC_BUDGET_TRANSPORT_UNKNOWN" });
    assert.equal(f.a.status().pending[0].state, "unknown");
  });
});

test("a late physical response is cancelled after an abort without releasing liability", async (t) => {
  let deliver,
    started,
    cancelled = 0;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture(t, () => {
    started();
    return new Promise((resolve) => {
      deliver = resolve;
    });
  });
  await f.run(async () => {
    const controller = new AbortController();
    const rejected = assert.rejects(
      providerFetch(endpoint, post(body, { signal: controller.signal })),
      { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
    );
    await ready;
    controller.abort();
    await rejected;
    deliver(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
      ),
    );
    await delay(0);
    assert.equal(cancelled, 1);
    assert.equal(f.a.status().pending[0].state, "unknown");
  });
});

test("a storage error during abort leaves the durable dispatch blocking another request", async (t) => {
  const f = fixture(t);
  await f.run(async () => {
    const controller = new AbortController();
    const res = await providerFetch(
      endpoint,
      post(body, { signal: controller.signal }),
    );
    f.a.markUnknown = () => {
      throw new Error("offline storage failure injection");
    };
    controller.abort();
    await assert.rejects(res.text(), { code: "CC_BUDGET_TRANSPORT_UNKNOWN" });
    assert.equal(f.a.status().pending[0].state, "dispatched");
    await assert.rejects(providerFetch(endpoint, post()), {
      code: "CC_BUDGET_PENDING",
    });
  });
  assert.equal(f.counts().physical, 1);
});

test("the response byte ceiling errors the stream and retains the full reservation", async (t) => {
  const f = fixture(t, undefined, { maximumResponseBytes: 16 });
  await f.run(async () => {
    const res = await providerFetch(endpoint, post());
    await assert.rejects(res.text(), { code: "CC_BUDGET_TRANSPORT_UNKNOWN" });
    assert.equal(f.a.status().pending[0].state, "unknown");
  });
});

test("canonical Agent, compaction and Advisor requests settle in the same host lineage", async (t) => {
  const handoff = JSON.stringify({
    objective: "Keep the original goal",
    constraints: ["Do not read credentials"],
    keyDecisions: [],
    changedFiles: [],
    tests: [],
    unresolvedSideEffects: [],
    checkpoints: [],
    blockers: [],
    nextSteps: ["Verify the result"],
  });
  const f = fixture(t, async () =>
    Response.json(
      response({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: handoff },
          },
        ],
      }),
    ),
  );
  await f.run(async () => {
    await chatWithTools(body.messages, options);
    const compacted = await compactConversationWithProvider(
      [
        { role: "user", content: "Original goal" },
        { role: "assistant", content: "Inspected files" },
        { role: "user", content: "Preserve constraints" },
        { role: "assistant", content: "Recorded evidence" },
        { role: "user", content: "Continue" },
        { role: "assistant", content: "More evidence" },
      ],
      { ...target, chatFn: chatWithTools, force: true, chatOptions: options },
    );
    assert.equal(compacted.stats.degraded, false);
    await invokeToolFreeAdvisor({ ...target, messages: body.messages });
  });
  assert.equal(f.counts().physical, 3);
  assert.equal(f.a.status().pending.length, 0);
});

test("Agent streaming preserves early tokens but propagates unresolved accounting after visible output", async (t) => {
  for (const complete of [true, false])
    await t.test(String(complete), async (sub) => {
      const f = fixture(sub, async () =>
        sse(delta + ending + (complete ? usageFrame : "") + "data: [DONE]\n\n"),
      );
      const tokens = [];
      await f.run(async () => {
        const operation = chatWithTools(body.messages, {
          ...options,
          onToken: (value) => tokens.push(value),
        });
        if (complete) assert.equal((await operation).message.content, "first");
        else
          await assert.rejects(operation, {
            code: "CC_BUDGET_TRANSPORT_UNKNOWN",
          });
      });
      assert.deepEqual(tokens, ["first"]);
      assert.equal(f.counts().physical, 1);
      assert.equal(f.a.status().pending.length, complete ? 0 : 1);
    });
});

test("Chat and stream provider consume verified EOF and share the same budget", async (t) => {
  const f = fixture(t, async () => sse());
  await f.run(async () => {
    const tokens = [];
    const text = await streamOpenAI(
      body.messages,
      body.model,
      target.baseUrl,
      target.apiKey,
      (token) => tokens.push(token),
      undefined,
      undefined,
      { requireCompletion: true },
    );
    assert.equal(text, "first");
    assert.deepEqual(tokens, ["first"]);
    const streamed = [];
    for await (const token of openAIStream({
      ...target,
      messages: body.messages,
      requireCompletion: true,
    }))
      streamed.push(token);
    assert.deepEqual(streamed, ["first"]);
  });
  assert.equal(f.counts().physical, 2);
  assert.equal(f.a.status().pending.length, 0);
});

test("probe and Hub cannot bypass the scope through an injected fetch", async (t) => {
  const f = fixture(t);
  const bypass = () => {
    throw new Error("injected ungoverned fetch must not run");
  };
  await f.run(async () => {
    const probe = await probeLlmConnection(target, {
      fetchImpl: bypass,
      includeUsage: true,
    });
    assert.equal(probe.ok, true);
    const hub = await openAiCompatChat({
      base: target.baseUrl,
      key: target.apiKey,
      model: body.model,
      messages: body.messages,
      fetchImpl: bypass,
    });
    assert.equal(hub.text, "fixture");
  });
  assert.equal(f.counts().physical, 2);
  assert.equal(f.a.status().pending.length, 0);
});

test("uncovered native protocols and typed decision endpoints cannot send in the scope", async (t) => {
  const f = fixture(t);
  await f.run(async () => {
    for (const provider of ["anthropic", "ollama", "openai"]) {
      await assert.rejects(
        chatWithTools(body.messages, {
          ...options,
          provider,
          ...(provider === "openai"
            ? { model: "gpt-6.1-sol", baseUrl: "https://api.openai.com/v1" }
            : {}),
        }),
      );
    }
    await assert.rejects(probeLlmConnection({ ...target, provider: "gemini" }));
    const typed = createTypeSafeDecisionProvider({
      apiKey: "fixture",
      baseUrl: target.baseUrl,
      model: body.model,
    });
    await assert.rejects(
      typed.decide({ payload: { state: {}, questions: [] } }),
    );
  });
  assert.equal(f.counts().physical, 0);
  assert.equal(f.a.status().pending.length, 0);
});

test("budget errors cannot trigger stream replay even with misleading network error wording", async () => {
  for (const wrapped of [false, true]) {
    const failure = Object.assign(new Error("network error: timeout"), {
      code: "CC_BUDGET_HALTED",
    });
    const error = wrapped
      ? Object.assign(new Error("fetch failed"), { cause: failure })
      : failure;
    assert.equal(isRetryableStreamError(error), false);
    let attempts = 0;
    await assert.rejects(
      _retryStreamingChat(
        async () => {
          attempts++;
          throw error;
        },
        { retries: 3, baseDelayMs: 0 },
      ),
      (caught) => caught === error,
    );
    assert.equal(attempts, 1);
  }
});

test("compaction and Advisor do not hide unknown provider liability behind optional fallback", async (t) => {
  for (const consumer of ["compaction", "advisor"])
    await t.test(consumer, async (sub) => {
      const f = fixture(sub, async () =>
        Response.json(response({ usage: null })),
      );
      await f.run(async () => {
        if (consumer === "compaction") {
          const history = Array.from({ length: 6 }, (_, index) => ({
            role: index % 2 ? "assistant" : "user",
            content: `original ${index}`,
          }));
          const before = structuredClone(history);
          await assert.rejects(
            compactConversationWithProvider(history, {
              ...target,
              chatFn: chatWithTools,
              chatOptions: options,
              force: true,
            }),
            { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
          );
          assert.deepEqual(history, before);
        } else {
          const advisor = new AdvisorRuntime({
            mainProvider: target.provider,
            mainModel: target.model,
            baseUrl: target.baseUrl,
            apiKey: target.apiKey,
            overrides: {
              enabled: true,
              provider: target.provider,
              model: target.model,
            },
          });
          await assert.rejects(
            advisor.advise({ trigger: "manual", messages: body.messages }),
            { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
          );
        }
      });
      assert.equal(f.counts().physical, 1);
      assert.equal(f.a.status().pending[0].state, "unknown");
    });
});

test("ask and Cowork use the host budget after real evolution admission", async (t) => {
  const f = fixture(t);
  const ingress = await evolution(f);
  await f.run(async () => {
    assert.equal(await queryLLM("synthetic task", target, ingress), "fixture");
    const chat = createChatFn({ ...target, evolutionIngress: ingress });
    assert.equal(await chat(body.messages), "fixture");
  });
  assert.equal(f.counts().physical, 2);
  assert.equal(f.a.status().pending.length, 0);
});

test("ask and Cowork reject unsupported protocols before an ordinary fetch can run", async (t) => {
  const f = fixture(t);
  const ingress = await evolution(f);
  await f.run(async () => {
    await assert.rejects(
      queryLLM("synthetic task", { ...target, provider: "ollama" }, ingress),
      { code: "CC_BUDGET_ENDPOINT_MISMATCH" },
    );
    const chat = createChatFn({
      ...target,
      provider: "anthropic",
      evolutionIngress: ingress,
    });
    await assert.rejects(chat(body.messages), { code: "CC_BUDGET_INVALID" });
  });
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
});

test("the legacy provider connectivity probe uses the same durable authority", async (t) => {
  const f = fixture(t);
  // testProvider uses no DB operations; keep this test independent of registry
  // configuration persistence and give it only the selected fixture provider.
  const registry = Object.create(LLMProviderRegistry.prototype);
  registry.providers = new Map([
    [
      "volcengine",
      { baseUrl: target.baseUrl, models: [body.model], apiKeyEnv: null },
    ],
  ]);
  registry.getApiKey = () => "caller-probe-key";
  await f.run(async () => {
    const result = await registry.testProvider("volcengine", body.model);
    assert.equal(result.ok, true);
    assert.equal(result.response, "fixture");
  });
  assert.equal(f.counts().physical, 1);
  assert.equal(f.a.status().pending.length, 0);
});

test("opaque Hub SDK callbacks are rejected before invoking an ungoverned model", async (t) => {
  const f = fixture(t);
  let sdkCalls = 0;
  const sdk = {
    name: "opaque-fixture",
    isLocal: false,
    chat: async () => {
      sdkCalls++;
      return { text: "must not run" };
    },
  };
  const wrapped = createGovernedHubLlm(sdk, async (context) =>
    createTestAgentEvolutionComposition(
      createAgentEvolutionRuntimeComposition,
      context,
      fs.mkdtempSync(path.join(f.root, "hub-evolution-")),
    ),
  );
  await f.run(async () => {
    await assert.rejects(wrapped.chat(body.messages), {
      code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
    });
  });
  assert.equal(sdkCalls, 0);
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
});

test("a model grader process is rejected before child launch or credential provisioning", async (t) => {
  const f = fixture(t);
  let launches = 0;
  t.mock.method(executionBroker, "spawn", () => {
    launches++;
    throw new Error("Offline test refused an ungoverned child process");
  });
  // Construction captures the real worker. Invoking the port in a budget
  // scope must stop before the execution broker or credential transport.
  const grader = createGovernedSkillSynthesisProcessGrader({
    provider: "volcengine",
    model: body.model,
    apiKey: "offline-grader-secret",
    maxTokens: 512,
  });
  await f.run(async () => {
    await assert.rejects(grader(body.messages), {
      code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
    });
  });
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
  assert.equal(launches, 0);
});

test("returning a lazy model generator without consuming it fails at the host boundary", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.run(() => openAIStream({ ...target, messages: body.messages })),
    { code: "CC_BUDGET_SCOPE_UNCONSUMED" },
  );
  assert.equal(f.counts().physical, 0);
});

test("model fallback and auth recovery never reinterpret nested budget errors", async () => {
  const budget = Object.assign(
    new Error("invalid API key: model not found: network timeout"),
    { code: "CC_BUDGET_TRANSPORT_UNKNOWN", status: 401 },
  );
  const error = new Error("fetch failed", {
    cause: new Error("provider unavailable", { cause: budget }),
  });
  assert.equal(isTerminalModelFailure(error), true);
  assert.equal(isAuthError(error), false);
  assert.equal(isRetryableStreamError(error), false);
  let attempts = 0,
    fallbacks = 0;
  const chat = makeFallbackChatFn({
    fallbackModels: ["backup-model"],
    baseChatFn: async () => {
      attempts++;
      throw error;
    },
    isRetryable: () => true,
    isModelNotFound: () => true,
    onFallback: () => {
      fallbacks++;
    },
  });
  await assert.rejects(
    chat(body.messages, options),
    (caught) => caught === error,
  );
  assert.equal(attempts, 1);
  assert.equal(fallbacks, 0);
});

test("in-process child agents retain unknown budget failures instead of returning a normal summary", async (t) => {
  const f = fixture(t, async () => Response.json(response({ usage: null })));
  const ingress = await evolution(f);
  const child = new SubAgentContext({
    role: "reviewer",
    task: "synthetic task",
    allowedTools: [],
    maxIterations: 1,
    useWorktree: false,
    memoryEnabled: false,
    cwd: f.root,
    llmOptions: { ...options, evolutionIngress: ingress },
    evolutionIngress: ingress,
  });
  await f.run(async () => {
    await assert.rejects(child.run("synthetic task"), {
      code: "CC_BUDGET_TRANSPORT_UNKNOWN",
    });
  });
  assert.equal(child.status, "failed");
  assert.equal(f.counts().physical, 1);
  assert.equal(f.a.status().pending[0].state, "unknown");
});

test("an optional prepareCall cannot hide budget failure and initiate the main model", async (t) => {
  const f = fixture(t, async () => Response.json(response({ usage: null })));
  const ingress = await evolution(f);
  const chat = createChatFn({ ...target, evolutionIngress: ingress });
  await f.run(async () => {
    await assert.rejects(
      async () => {
        for await (const event of agentLoop([...body.messages], {
          ...options,
          autoCompact: false,
          evolutionIngress: ingress,
          cwd: f.root,
          prepareCall: async () => {
            await chat(body.messages);
            return {};
          },
        })) {
          /* consume the actual host generator inside the budget scope */
        }
      },
      { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
    );
  });
  assert.equal(f.counts().physical, 1);
  assert.equal(f.a.status().pending[0].state, "unknown");
});

test("a captured Desktop SDK callback cannot bypass the budget authority", async (t) => {
  const f = fixture(t);
  let sdkCalls = 0;
  const client = { baseURL: target.baseUrl, model: body.model };
  const adapter = new CcLLMAdapter({
    getActiveProvider: () => target.provider,
    getActiveModel: () => body.model,
    getActiveClient: () => client,
    chat: async () => {
      sdkCalls++;
      return { content: "must not run" };
    },
  });
  const wrapped = createGovernedHubLlm(adapter, async (context) =>
    createTestAgentEvolutionComposition(
      createAgentEvolutionRuntimeComposition,
      context,
      fs.mkdtempSync(path.join(f.root, "desktop-evolution-")),
    ),
  );
  await f.run(async () => {
    await assert.rejects(wrapped.chat(body.messages), {
      code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
    });
  });
  assert.equal(sdkCalls, 0);
  assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
});

test("Hub resolver native and custom embeddings cannot send through an unmetered SDK", async (t) => {
  for (const custom of [false, true])
    await t.test(String(custom), async (sub) => {
      const f = fixture(sub);
      let embeddingCalls = 0,
        completions = 0,
        failures = 0;
      const people = ["a", "b"].map((id) => ({
        id,
        type: "person",
        names: ["Shared name"],
        identifiers: {},
      }));
      const vault = {
        _requireOpen: () => ({ prepare: () => ({ all: () => [{ id: "b" }] }) }),
        claimResolveBatch: () => [{ id: "queue", person_id: "a" }],
        getPerson: (id) => people.find((person) => person.id === id),
        getResolveDecision: () => null,
        queryEvents: () => [],
        recordResolveDecision() {},
        mergePair() {},
        enqueueReview() {},
        completeResolve() {
          completions++;
        },
        errorResolve() {
          failures++;
        },
      };
      const embeddingStage = new hubSdk.EntityResolverEmbeddingStage({
        vault,
        ollamaUrl: "http://127.0.0.1:11434",
        model: "fixture-embedding",
        ...(custom
          ? {
              embedFn: async () => {
                embeddingCalls++;
                return [1, 0];
              },
            }
          : {}),
      });
      const llm = new OllamaClient({ model: body.model });
      const original = new hubSdk.EntityResolver({
        vault,
        embeddingStage: embeddingStage.asStageFn(),
      });
      const scoped = createGovernedHubResolver(
        {
          resolver: original,
          llm,
          embeddingStage,
          EntityResolver: hubSdk.EntityResolver,
          EmbeddingStage: hubSdk.EntityResolverEmbeddingStage,
          LLMStage: hubSdk.EntityResolverLLMStage,
        },
        async (context) =>
          createTestAgentEvolutionComposition(
            createAgentEvolutionRuntimeComposition,
            context,
            fs.mkdtempSync(path.join(f.root, "embedding-evolution-")),
          ),
      );
      await f.run(async () => {
        const result = await scoped.drain();
        assert.equal(result.processed, 0);
        assert.equal(result.error, 1);
      });
      assert.equal(embeddingCalls, 0);
      assert.equal(completions, 0);
      assert.equal(failures, 1);
      assert.deepEqual(f.counts(), { physical: 0, credentials: 0 });
    });
});
