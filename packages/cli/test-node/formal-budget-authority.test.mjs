import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, fork } from "node:child_process";
import { createRequire } from "node:module";
import { FormalBudgetAuthority } from "../src/lib/formal-budget-authority.js";
import { evidenceDigest } from "../src/lib/formal-budget-contract.js";
import {
  createFormalBudgetTransport,
  formalBudgetTaskEnvironment,
  requireFormalBudgetRuntime,
  parseBudgetJson,
} from "../src/lib/formal-budget-transport.js";
import {
  NOW,
  body,
  response,
  config,
  attest,
  verifyFixtureEvidence,
} from "./formal-budget-fixture.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
function fixture(t, modify = () => {}, now = () => NOW) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-budget-"));
  const cfg = config();
  modify(cfg);
  attest(cfg);
  const descriptor = FormalBudgetAuthority.initialize({
    filename: path.join(root, "authority.sqlite"),
    config: cfg,
    verifyEvidence: verifyFixtureEvidence,
    now,
  });
  const descriptorFile = path.join(root, "descriptor.json");
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const opened = [];
  const open = () => {
    const a = new FormalBudgetAuthority({
      ...descriptor,
      verifyEvidence: verifyFixtureEvidence,
      now,
    });
    opened.push(a);
    return a;
  };
  const a = open();
  t.after(() => {
    for (const item of opened) {
      try {
        item.close();
      } catch {
        /* already closed */
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { a, open, cfg, root, descriptor, descriptorFile };
}
function start(a) {
  a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" });
}
function reserve(a, callId = "call-1", request = body) {
  return a.reserve({ runId: "initial", callId, body: request });
}
function settle(a, callId = "call-1", receipt = response()) {
  a.markDispatched(callId, body);
  return a.settle(callId, receipt);
}

test("activation refuses missing contract, FX, history and untrusted evidence before creating storage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-budget-activation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const mutate of [
    (c) => delete c.evidence.contracts,
    (c) => delete c.fx,
    (c) => delete c.history,
    (c) => {
      c.history.complete = false;
    },
    (c) => {
      c.contracts[0].allBilledDimensionsBounded = false;
    },
  ]) {
    const cfg = config();
    mutate(cfg);
    const filename = path.join(root, "missing.sqlite");
    assert.throws(() =>
      FormalBudgetAuthority.initialize({
        filename,
        config: cfg,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
    );
    assert.equal(fs.existsSync(filename), false);
  }
  assert.throws(
    () =>
      FormalBudgetAuthority.initialize({
        filename: path.join(root, "unverified"),
        config: config(),
        now: () => NOW,
      }),
    { code: "CC_BUDGET_EVIDENCE_REQUIRED" },
  );
});
test("activation binds exact original lineage and cannot reset existing database", (t) => {
  const { descriptor, cfg } = fixture(t);
  assert.throws(
    () =>
      FormalBudgetAuthority.initialize({
        filename: descriptor.filename,
        config: cfg,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
    { code: "EEXIST" },
  );
  assert.throws(
    () =>
      new FormalBudgetAuthority({
        ...descriptor,
        lineageId: "other",
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
  );
  assert.throws(
    () =>
      new FormalBudgetAuthority({
        ...descriptor,
        activationDigest: "f".repeat(64),
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
  );
  assert.throws(
    () =>
      new FormalBudgetAuthority({
        ...descriptor,
        filename: descriptor.filename + ".missing",
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
  );
});
test("full output plus reasoning reserved with native currency; reasoning not billed twice", (t) => {
  const { a } = fixture(t);
  start(a);
  assert.deepEqual(reserve(a), {
    callId: "call-1",
    requestDigest: evidenceDigest(body),
    reservedUsdMicros: 1500,
    reservedNativeMicros: 3000,
    currency: "CNY",
  });
  assert.deepEqual(settle(a), {
    costUsdMicros: 46,
    costNativeMicros: 92,
    currency: "CNY",
    duplicate: false,
  });
  assert.equal(a.status().exposureUsdMicros, 46);
});
test("max_tokens never reduces reasoning/full-contract reservation", (t) => {
  const { a } = fixture(t);
  start(a);
  assert.equal(
    reserve(a, "limited", { ...body, max_tokens: 1 }).reservedNativeMicros,
    3000,
  );
});
test("same task initial and only one remediation retain original spend across reopen", (t) => {
  const { a, open } = fixture(t, (c) => {
    c.history.tasks[0].spentUsdMicros = 1_998_454;
  });
  start(a);
  reserve(a);
  settle(a);
  a.finishRun("initial");
  a.close();
  const resumed = open();
  resumed.beginRun({
    taskId: "task-0",
    runId: "remediation",
    phase: "remediation",
  });
  resumed.reserve({ runId: "remediation", callId: "call-2", body });
  resumed.markDispatched("call-2", body);
  resumed.settle("call-2", response());
  resumed.finishRun("remediation");
  assert.throws(
    () =>
      resumed.beginRun({
        taskId: "task-0",
        runId: "third",
        phase: "remediation",
      }),
    { code: "CC_BUDGET_RUN_LIMIT" },
  );
  assert.equal(resumed.status().exposureUsdMicros, 1_998_546);
});
test("remediation is not a second allowance; over-cap request is rejected before reserve", (t) => {
  const { a } = fixture(t, (c) => {
    c.history.tasks[0].spentUsdMicros = 1_998_501;
    c.history.tasks[0].runsUsed = 1;
  });
  a.beginRun({ taskId: "task-0", runId: "remediation", phase: "remediation" });
  assert.throws(
    () => a.reserve({ runId: "remediation", callId: "no-room", body }),
    { code: "CC_BUDGET_TASK_LIMIT" },
  );
  assert.equal(a.status().pending.length, 0);
});
test("historical unknown liability remains halted even if numeric amount is zero", (t) => {
  const { a } = fixture(t, (c) => {
    c.history.tasks[7].unknown = true;
  });
  assert.throws(() => start(a), { code: "CC_BUDGET_HALTED" });
  assert.match(a.status().halted, /historical/u);
});
test("historical task allocations sum to original $99 and are never reset", (t) => {
  const { a } = fixture(t, (c) => {
    for (const item of c.history.tasks)
      item.spentUsdMicros = c.plan.tasks.find(
        (task) => task.id === item.id,
      ).capUsdMicros;
  });
  assert.equal(a.status().exposureUsdMicros, 99_000_000);
  start(a);
  assert.throws(() => reserve(a), { code: "CC_BUDGET_TASK_LIMIT" });
});
test("duplicate run resume does not consume remediation and active initial must close", (t) => {
  const { a } = fixture(t);
  start(a);
  assert.equal(
    a.beginRun({ taskId: "task-0", runId: "initial", phase: "initial" })
      .resumed,
    true,
  );
  assert.throws(() =>
    a.beginRun({
      taskId: "task-0",
      runId: "remediation",
      phase: "remediation",
    }),
  );
  assert.throws(() =>
    a.beginRun({ taskId: "task-1", runId: "initial", phase: "initial" }),
  );
});
test("one physical call ID cannot be redispatched; repeated settlement is idempotent", (t) => {
  const { a } = fixture(t);
  start(a);
  reserve(a);
  settle(a);
  assert.equal(a.settle("call-1", response()).duplicate, true);
  assert.equal(a.status().exposureUsdMicros, 46);
  assert.throws(() => reserve(a), { code: "CC_BUDGET_CALL_REPLAY" });
  assert.throws(() => a.markDispatched("call-1", body), {
    code: "CC_BUDGET_CALL_REPLAY",
  });
  assert.throws(() => a.settle("call-1", response({ id: "different" })), {
    code: "CC_BUDGET_SETTLEMENT_CONFLICT",
  });
  assert.equal(a.status().exposureUsdMicros, 1500);
  assert.throws(() => reserve(a, "after-conflict"), {
    code: "CC_BUDGET_HALTED",
  });
});
test("invalid usage/model/tier/cache/reasoning permanently retains the whole reservation", async (t) => {
  const variants = [
    (r) => delete r.usage,
    (r) => {
      r.model = "unknown";
    },
    (r) => {
      r.service_tier = "other";
    },
    (r) => {
      r.usage.prompt_tokens_details.cached_tokens = 101;
    },
    (r) => {
      r.usage.completion_tokens_details.reasoning_tokens = 11;
    },
    (r) => {
      r.usage.prompt_tokens = -1;
    },
    (r) => {
      r.usage.prompt_tokens = 1.5;
    },
    (r) => {
      r.usage.total_tokens = 0;
    },
  ];
  for (const [i, mutate] of variants.entries())
    await t.test(String(i), (sub) => {
      const { a, open } = fixture(sub);
      start(a);
      reserve(a);
      a.markDispatched("call-1", body);
      const receipt = response();
      mutate(receipt);
      assert.throws(() => a.settle("call-1", receipt), {
        code: "CC_BUDGET_UNKNOWN_USAGE",
      });
      a.close();
      const next = open();
      assert.equal(next.status().exposureUsdMicros, 1500);
      assert.throws(() => reserve(next, "call-2"), {
        code: "CC_BUDGET_HALTED",
      });
      assert.throws(() => next.settle("call-1", response()), {
        code: "CC_BUDGET_PENDING",
      });
    });
});
test("expired contract/FX cannot admit new dispatch", (t) => {
  let now = NOW;
  const { a } = fixture(
    t,
    () => {},
    () => now,
  );
  start(a);
  now += 100_000;
  assert.throws(() => reserve(a), { code: "CC_BUDGET_EXPIRED" });
  assert.equal(a.status().pending.length, 0);
});
test("reserved body mutation cannot consume dispatch authorization", (t) => {
  const { a } = fixture(t);
  start(a);
  reserve(a);
  assert.throws(() => a.markDispatched("call-1", { ...body, max_tokens: 2 }));
  assert.equal(a.status().pending[0].state, "held");
});
test("multi-completion, thinking override and paid hosted tools fail before reservation", (t) => {
  const { a } = fixture(t);
  start(a);
  for (const extra of [
    { n: 2 },
    { thinking: { type: "disabled" } },
    { tools: [{ type: "web_search" }] },
    { service_tier: "flex" },
  ])
    assert.throws(() => reserve(a, "never", { ...body, ...extra }));
  assert.equal(a.status().pending.length, 0);
});
test("concurrent separate processes grant exactly one atomic reservation", async (t) => {
  const { a, descriptorFile } = fixture(t);
  start(a);
  const results = await Promise.all(
    Array.from(
      { length: 6 },
      (_, i) =>
        new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            [
              path.join(directory, "formal-budget-child.mjs"),
              "reserve",
              descriptorFile,
              `concurrent-${i}`,
            ],
            { windowsHide: true, stdio: "ignore" },
          );
          child.on("close", resolve);
        }),
    ),
  );
  assert.equal(results.filter((code) => code === 0).length, 1);
  assert.equal(results.filter((code) => code === 2).length, 5);
  assert.equal(a.status().pending.length, 1);
  assert.equal(a.status().exposureUsdMicros, 1500);
});
for (const phase of ["reserved", "dispatched", "settled"])
  test(`real process kill after ${phase} preserves durable accounting`, async (t) => {
    const { a, open, descriptorFile } = fixture(t);
    start(a);
    a.close();
    const child = fork(
      path.join(directory, "formal-budget-child.mjs"),
      [`crash-${phase}`, descriptorFile, "crash-call"],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    await new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Premature crash worker exit ${code}`)),
      );
    });
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await stopped;
    const reopened = open();
    if (phase === "settled") {
      assert.equal(reopened.status().exposureUsdMicros, 46);
      assert.equal(reopened.status().pending.length, 0);
    } else {
      assert.equal(reopened.status().exposureUsdMicros, 1500);
      assert.throws(() => reserve(reopened, "new-call"), {
        code: "CC_BUDGET_PENDING",
      });
    }
  });
test("SQLite write failure admits no reservation and transport never calls provider", async (t) => {
  const { a, descriptor } = fixture(t);
  start(a);
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(descriptor.filename);
  db.exec(
    "CREATE TRIGGER reject_call BEFORE INSERT ON call BEGIN SELECT RAISE(ABORT,'fixture storage unavailable'); END;",
  );
  db.close();
  let requests = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => "fixture",
    fetchImpl: async () => {
      requests++;
    },
  });
  await assert.rejects(
    transport.dispatch({ runId: "initial", callId: "storage-fail", body }),
  );
  assert.equal(requests, 0);
  assert.equal(a.status().pending.length, 0);
});
test("credential-owning JSON transport reserves before fetch, preserves body, never exposes key", async (t) => {
  const { a } = fixture(t);
  start(a);
  let requests = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => "fixture-secret",
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(a.status().pending[0].state, "dispatched");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fixture-secret");
      assert.deepEqual(JSON.parse(options.body), body);
      return Response.json(response());
    },
  });
  const result = await transport.dispatch({
    runId: "initial",
    callId: "json",
    body,
  });
  assert.equal(requests, 1);
  assert.equal(result.cost.costUsdMicros, 46);
  assert(!JSON.stringify(result).includes("fixture-secret"));
});
test("successful SSE requires complete terminal usage and settles once", async (t) => {
  const { a } = fixture(t);
  start(a);
  const receipt = response();
  const bytes = `data: ${JSON.stringify({ ...receipt, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null })}\n\ndata: ${JSON.stringify({ ...receipt, choices: [], usage: receipt.usage })}\n\ndata: [DONE]\n\n`;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => "fixture",
    fetchImpl: async () =>
      new Response(bytes, { headers: { "content-type": "text/event-stream" } }),
  });
  const result = await transport.dispatch({
    runId: "initial",
    callId: "stream",
    body: { ...body, stream: true },
  });
  assert.equal(result.cost.costUsdMicros, 46);
});
test("disconnect, missing usage, redirect/HTTP error never retry and halt next physical request", async (t) => {
  for (const variant of ["disconnect", "missing", "http", "stream-truncated"])
    await t.test(variant, async (sub) => {
      const { a } = fixture(sub);
      start(a);
      let requests = 0;
      const transport = createFormalBudgetTransport({
        authority: a,
        credentialProvider: () => "fixture",
        fetchImpl: async () => {
          requests++;
          if (variant === "disconnect")
            throw new Error("secret-bearing upstream error");
          if (variant === "http")
            return new Response("failed", { status: 503 });
          if (variant === "stream-truncated")
            return new Response(`data: ${JSON.stringify(response())}\n\n`, {
              headers: { "content-type": "text/event-stream" },
            });
          return Response.json(response({ usage: null }));
        },
      });
      await assert.rejects(
        transport.dispatch({
          runId: "initial",
          callId: "failed",
          body:
            variant === "stream-truncated" ? { ...body, stream: true } : body,
        }),
        { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
      );
      await assert.rejects(
        transport.dispatch({ runId: "initial", callId: "retry", body }),
        { code: "CC_BUDGET_HALTED" },
      );
      assert.equal(requests, 1);
      assert.equal(a.status().exposureUsdMicros, 1500);
    });
});
test("tool environment excludes provider keys, homes, runtime injection and ledger authority", () => {
  const env = formalBudgetTaskEnvironment({
    PATH: "fixture-path",
    HOME: "secret-home",
    VOLCENGINE_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    NODE_OPTIONS: "--import bypass",
    CC_BUDGET_DB: "private",
    CUSTOM_PROVIDER_KEY: "secret",
  });
  assert.deepEqual(env, { PATH: "fixture-path" });
  assert.throws(requireFormalBudgetRuntime, {
    code: "CC_BUDGET_RUNTIME_NOT_COVERED",
  });
});

test("unknown billed usage dimensions halt rather than silently underprice", (t) => {
  const { a } = fixture(t);
  start(a);
  reserve(a);
  a.markDispatched("call-1", body);
  const receipt = response();
  receipt.usage.completion_tokens_details.audio_tokens = 1;
  assert.throws(() => a.settle("call-1", receipt), {
    code: "CC_BUDGET_UNKNOWN_USAGE",
  });
  assert.equal(a.status().exposureUsdMicros, 1500);
});

test("rational FX uses upward integer rounding instead of floating point", (t) => {
  const { a } = fixture(t, (c) => {
    c.fx[0].denominator = 3;
  });
  start(a);
  assert.equal(reserve(a).reservedUsdMicros, 1000);
  assert.equal(settle(a).costUsdMicros, 31);
});

test("corrupt durable storage is not silently replaced or initialized", (t) => {
  const { a, descriptor } = fixture(t);
  a.close();
  const corrupt = Buffer.from("intentionally corrupted offline fixture");
  fs.writeFileSync(descriptor.filename, corrupt);
  assert.throws(
    () =>
      new FormalBudgetAuthority({
        ...descriptor,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
  );
  assert(fs.readFileSync(descriptor.filename).equals(corrupt));
});

test("verified receipts cannot silently substitute the frozen 18 plus 18 provider strata", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-budget-strata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cfg = config();
  cfg.plan.tasks[18].contractId = "fixture-contract";
  attest(cfg);
  assert.throws(
    () =>
      FormalBudgetAuthority.initialize({
        filename: path.join(root, "authority.sqlite"),
        config: cfg,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
    /18 Volcengine and 18 OpenAI/u,
  );
});

test("final dispatch rechecks contract and FX after awaited credential preparation", async (t) => {
  for (const expires of ["contract", "fx"])
    await t.test(expires, async (sub) => {
      let clock = NOW;
      const { a } = fixture(
        sub,
        (c) => {
          if (expires === "contract") c.contracts[0].validUntil = NOW + 10;
          else c.fx[0].validUntil = NOW + 10;
        },
        () => clock,
      );
      start(a);
      let fetches = 0;
      const transport = createFormalBudgetTransport({
        authority: a,
        credentialProvider: async () => {
          await Promise.resolve();
          clock = NOW + 11;
          return "fixture";
        },
        fetchImpl: async () => {
          fetches++;
          return Response.json(response());
        },
      });
      await assert.rejects(
        transport.dispatch({
          runId: "initial",
          callId: "expired-before-send",
          body,
        }),
        { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
      );
      assert.equal(fetches, 0);
      assert.equal(a.status().pending[0].state, "unknown");
      assert.equal(a.status().exposureUsdMicros, 1500);
    });
});

test("accounting JSON parser rejects duplicate/escaped keys and nonfinite numbers", () => {
  for (const text of [
    '{"usage":1,"usage":0}',
    '{"usage":1,"us\\u0061ge":0}',
    '{"usage":{"prompt_tokens":2,"prompt_tokens":0}}',
    '{"usage":1e400}',
    '{"usage":-1e400}',
    '{"a":[1,]}',
    '{"a":1,}',
    '{"a":1} trailing',
  ])
    assert.throws(() => parseBudgetJson(text));
  const good = {
    content: 'braces {}, quote " and slash \\',
    usage: { input: 0 },
    nested: [true, false, null, -2.1e-7],
  };
  assert.deepEqual(parseBudgetJson(JSON.stringify(good)), good);
});

test("ambiguous JSON, error envelopes and nonfinite usage never settle", async (t) => {
  const valid = JSON.stringify(response());
  const variants = {
    duplicate:
      valid.slice(0, -1) +
      ',"usage":' +
      JSON.stringify(response().usage).replace(
        '"prompt_tokens":100',
        '"prompt_tokens":0',
      ) +
      "}",
    escapedDuplicate: valid.slice(0, -1) + ',"us\\u0061ge":null}',
    errorAndUsage: JSON.stringify(
      response({ error: { message: "failed despite usage" } }),
    ),
    errorNull: JSON.stringify(response({ error: null })),
    nonfinite: valid.replace('"prompt_tokens":100', '"prompt_tokens":1e400'),
  };
  for (const [name, raw] of Object.entries(variants))
    await t.test(name, async (sub) => {
      const { a } = fixture(sub);
      start(a);
      let fetches = 0;
      const transport = createFormalBudgetTransport({
        authority: a,
        credentialProvider: () => "fixture",
        fetchImpl: async () => {
          fetches++;
          return new Response(raw);
        },
      });
      await assert.rejects(
        transport.dispatch({ runId: "initial", callId: "ambiguous", body }),
        { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
      );
      assert.equal(fetches, 1);
      assert.equal(a.status().exposureUsdMicros, 1500);
      assert(a.status().halted);
      await assert.rejects(
        transport.dispatch({ runId: "initial", callId: "later", body }),
        { code: "CC_BUDGET_HALTED" },
      );
      assert.equal(fetches, 1);
    });
});

test("SSE requires a completed choice and coherent terminal order", async (t) => {
  const row = response(),
    frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
  const complete = {
    ...row,
    usage: null,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  const usage = { ...row, choices: [] };
  const partial = {
    ...row,
    choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }],
  };
  const variants = {
    incomplete: frame(partial) + "data: [DONE]\n\n",
    usageOnly: frame(usage) + "data: [DONE]\n\n",
    contentAfterFinish:
      frame(complete) +
      frame({ ...partial, usage: null }) +
      frame(usage) +
      "data: [DONE]\n\n",
    duplicateFinish:
      frame(complete) + frame(complete) + frame(usage) + "data: [DONE]\n\n",
    unsupportedFinish:
      frame({
        ...complete,
        choices: [{ index: 0, finish_reason: "unknown" }],
      }) +
      frame(usage) +
      "data: [DONE]\n\n",
    errorAndUsage:
      frame(complete) + frame({ ...usage, error: {} }) + "data: [DONE]\n\n",
    duplicateUsageKey:
      frame(complete) +
      "data: " +
      JSON.stringify(usage).slice(0, -1) +
      ',"usage":null}\n\ndata: [DONE]\n\n',
  };
  for (const [name, raw] of Object.entries(variants))
    await t.test(name, async (sub) => {
      const { a } = fixture(sub);
      start(a);
      const transport = createFormalBudgetTransport({
        authority: a,
        credentialProvider: () => "fixture",
        fetchImpl: async () =>
          new Response(raw, {
            headers: { "content-type": "text/event-stream" },
          }),
      });
      await assert.rejects(
        transport.dispatch({
          runId: "initial",
          callId: "incomplete",
          body: { ...body, stream: true },
        }),
        { code: "CC_BUDGET_TRANSPORT_UNKNOWN" },
      );
      assert.equal(a.status().exposureUsdMicros, 1500);
      assert(a.status().halted);
    });
});

test("noncanonical duplicate settlement restores full liability and halts durably", (t) => {
  const { a, open } = fixture(t);
  start(a);
  reserve(a);
  settle(a);
  const bad = response();
  bad.usage.prompt_tokens = Infinity;
  assert.throws(() => a.settle("call-1", bad), {
    code: "CC_BUDGET_SETTLEMENT_CONFLICT",
  });
  a.close();
  const reopened = open();
  assert.equal(reopened.status().exposureUsdMicros, 1500);
  assert.throws(() => reserve(reopened, "should-not-dispatch"), {
    code: "CC_BUDGET_HALTED",
  });
});

test("unpriced input/output dimensions and oversized serialized input fail before fetch", async (t) => {
  const { a } = fixture(t);
  start(a);
  let fetches = 0,
    credentials = 0;
  const transport = createFormalBudgetTransport({
    authority: a,
    credentialProvider: () => {
      credentials++;
      return "fixture";
    },
    fetchImpl: async () => {
      fetches++;
      return Response.json(response());
    },
  });
  const variants = [
    { ...body, max_tokens: 1001 },
    {
      ...body,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: "fixture", format: "wav" },
            },
          ],
        },
      ],
    },
    {
      ...body,
      messages: [
        {
          role: "user",
          content: "text",
          image_url: "https://fixture.invalid/image",
        },
      ],
    },
    {
      ...body,
      tools: [
        { type: "function", function: { name: "safe", hosted_search: true } },
      ],
    },
    { ...body, messages: [{ role: "user", content: "x".repeat(4096) }] },
  ];
  for (const request of variants)
    await assert.rejects(
      transport.dispatch({
        runId: "initial",
        callId: "unbounded",
        body: request,
      }),
    );
  assert.equal(fetches, 0);
  assert.equal(credentials, 0);
  assert.equal(a.status().pending.length, 0);
});

test("inclusive input envelope is mandatory verified contract evidence", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-budget-input-envelope-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const change of [
    (c) => delete c.contracts[0].inputEnvelope,
    (c) => {
      c.contracts[0].inputEnvelope.includesAllBilledInputAndImplicitSystemOverhead = false;
    },
    (c) => {
      c.contracts[0].inputEnvelope.inclusivePromptTokenUpperBound = 1001;
    },
    (c) => {
      c.contracts[0].inputEnvelope.requestSchema = "arbitrary-input";
    },
  ]) {
    const cfg = config();
    change(cfg);
    attest(cfg);
    assert.throws(() =>
      FormalBudgetAuthority.initialize({
        filename: path.join(root, "refused.sqlite"),
        config: cfg,
        verifyEvidence: verifyFixtureEvidence,
        now: () => NOW,
      }),
    );
  }
});
