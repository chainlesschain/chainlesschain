import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyMemoryCommand } from "@chainlesschain/context-memory-kernel";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";
import {
  createLocalSemanticSource,
  runLocalSemanticWorker,
  resolveLocalSemanticConfiguration,
  LOCAL_SEMANTIC_SCHEMA,
} from "../src/lib/context-memory-kernel/local-semantic-source.js";
import { CliCanonicalMemoryService } from "../src/lib/context-memory-kernel/memory-service.js";
import { prepareCanonicalProviderContext } from "../src/lib/context-memory-kernel/provider-context.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const now = Date.now();
function environment(directory) {
  return {
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    CC_MEMORY_SEMANTIC_MODE: "local-bge",
    CC_MEMORY_SEMANTIC_PYTHON: process.execPath,
    CC_MEMORY_SEMANTIC_PYTHON_SHA256: digest(fs.readFileSync(process.execPath)),
    CC_MEMORY_SEMANTIC_MODEL_DIR: directory,
  };
}
function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "cc-local-semantic-"));
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith("cc-local-semantic-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    env: environment(directory),
    memoryFilePath: path.join(directory, "memory.json"),
  };
}
// Protocol transport fixture only: these scores make no encoder/quality claim.
function brokerFixture(t, onInput) {
  const calls = [];
  t.mock.method(executionBroker, "spawn", (executable, args, options) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.signalCode = "SIGKILL";
      setImmediate(() => child.emit("close", null, "SIGKILL"));
      return true;
    };
    let input = "";
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        input += chunk;
        done();
      },
    });
    child.stdin.on("finish", () => {
      const request = JSON.parse(input);
      calls.push({ request, options, executable, args, child });
      const respond = (
        scores = request.records.map((row) => ({
          memoryId: row.memoryId,
          score: 0.9,
        })),
      ) => {
        child.stdout.write(
          JSON.stringify({
            schema: LOCAL_SEMANTIC_SCHEMA,
            requestDigest: digest(input),
            modelRevision: "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
            networkCalls: 0,
            scores,
          }),
        );
        child.exitCode = 0;
        child.emit("close", 0, null);
      };
      Promise.resolve(onInput?.(request, child, respond) ?? respond()).catch(
        (error) => child.emit("error", error),
      );
    });
    return child;
  });
  return calls;
}
function record(id, overrides = {}) {
  return {
    memoryId: id,
    revision: 1,
    digest: "sha256:" + "a".repeat(64),
    content: "private memory " + id,
    state: "active",
    scope: "user",
    scopeId: "local-user",
    allowedSinks: ["provider.local"],
    retentionPolicy: { mode: "durable" },
    ...overrides,
  };
}
const request = {
  query: "transport fixture inquiry",
  sink: "provider.local",
  scopeAdmissions: [{ scope: "user", scopeId: "local-user" }],
};

test("pre-filters lifecycle, TTL, scope and sink before worker input; binds exact canonical versions", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const rows = [
    record("admitted"),
    record("deleted", { state: "deleted" }),
    record("expired", {
      retentionPolicy: { expiresAt: new Date(now - 1).toISOString() },
    }),
    record("scope", { scopeId: "another-user" }),
    record("sink", { allowedSinks: ["cli.display"] }),
  ];
  const source = createLocalSemanticSource({
    memoryPort: { query: async () => rows },
    env: f.env,
  });
  assert.deepEqual(await source.candidates(request), [
    {
      memoryId: "admitted",
      revision: 1,
      recordDigest: rows[0].digest,
      score: 0.9,
    },
  ]);
  assert.deepEqual(
    calls[0].request.records.map((row) => row.memoryId),
    ["admitted"],
  );
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
});

test("all three production entries invoke the concrete source; provider dispatch still rejects deletion", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const service = new CliCanonicalMemoryService(f);
  const added = await service.add("The launch password is a cobalt lantern");
  assert.equal(
    (await service.search("unrelated-query")).entries[0].id,
    added.id,
  );
  assert.equal(
    (
      await service.recallScoped("unrelated-query", {
        scope: "user",
        scopeId: "local-user",
      })
    ).results[0].id,
    added.id,
  );
  const prepared = await prepareCanonicalProviderContext(
    [{ role: "user", content: "unrelated-query" }],
    {
      provider: "local",
      model: "local-test",
      sessionId: "local-semantic-fixture",
      contextMemoryEnv: f.env,
      contextMemoryFilePath: f.memoryFilePath,
      contextMemoryModelWindowTokens: 8192,
    },
  );
  assert.equal(prepared.recall.results[0].record.memoryId, added.id);
  assert.equal(calls.length, 3);
  await service.delete(added.id);
  // Provider authorization is checked immediately before dispatch.
  await assert.rejects(prepared.assertCurrent({ provider: "local" }), {
    code: "revision_conflict",
  });
});

test("a revision change during encoding is rejected by the canonical kernel", async (t) => {
  const f = fixture(t);
  const service = new CliCanonicalMemoryService(f);
  const added = await service.add("original transport fixture");
  brokerFixture(t, async (_input, _child, respond) => {
    const current = await service.runtime.memoryPort.read(added.id);
    const mutation = applyMemoryCommand(current, {
      type: "reinforce",
      expectedRevision: current.revision,
      confidenceDelta: 0.01,
      authority: "concurrent-fixture",
      at: new Date().toISOString(),
    });
    assert.equal(
      (await service.runtime.memoryPort.commit(mutation, current.revision)).ok,
      true,
    );
    respond();
  });
  await assert.rejects(service.search("original"), {
    code: "revision_conflict",
  });
});

test("Stop kills owned worker and settles only after close; no late result can revive recall", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let killed = false;
  let closed = false;
  brokerFixture(t, (_input, child) => {
    child.kill = () => {
      killed = true;
      setTimeout(() => {
        closed = true;
        child.emit("close", null, "SIGKILL");
      }, 15);
      return true;
    };
    controller.abort(new Error("fixture Stop"));
    return true;
  });
  const config = resolveLocalSemanticConfiguration(f.env);
  await assert.rejects(
    runLocalSemanticWorker(
      config,
      { query: "q", records: [{ memoryId: "m", content: "text" }] },
      { signal: controller.signal },
    ),
    /fixture Stop/,
  );
  assert.equal(killed, true);
  assert.equal(closed, true);
});

test("disabled mode and wildcard recall do not launch an encoder; invalid executable identity fails closed", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const source = createLocalSemanticSource({
    memoryPort: { query: async () => [record("m")] },
    env: {},
  });
  assert.equal(await source.candidates(request), undefined);
  const configured = createLocalSemanticSource({
    memoryPort: { query: async () => [record("m")] },
    env: f.env,
  });
  assert.equal(
    await configured.candidates({ ...request, query: "*" }),
    undefined,
  );
  f.env.CC_MEMORY_SEMANTIC_PYTHON_SHA256 = "0".repeat(64);
  await assert.rejects(configured.candidates(request), {
    code: "CC_MEMORY_SEMANTIC_IDENTITY",
  });
  assert.equal(calls.length, 0);
});

test("malformed, duplicate and missing worker IDs cannot become semantic candidates", async (t) => {
  const f = fixture(t);
  brokerFixture(t, (_input, _child, respond) => {
    respond([{ memoryId: "foreign", score: 0.9 }]);
    return true;
  });
  const source = createLocalSemanticSource({
    memoryPort: { query: async () => [record("m")] },
    env: f.env,
  });
  await assert.rejects(source.candidates(request), {
    code: "CC_MEMORY_SEMANTIC_OUTPUT",
  });
});

test(
  "optional real offline BGE smoke through all three production entry points",
  {
    skip: process.env.CC_MEMORY_SEMANTIC_REAL_TEST !== "1",
    timeout: 300_000,
  },
  async (t) => {
    const f = fixture(t);
    const env = {
      ...process.env,
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
      CC_MEMORY_SEMANTIC_MODE: "local-bge",
    };
    const service = new CliCanonicalMemoryService({ ...f, env });
    const relevant = await service.add(
      "Automobiles require regular maintenance, including replacing worn tyres and checking brake pads.",
    );
    await service.add(
      "Banana bread is baked with ripe fruit, flour, and eggs.",
    );
    const query = "Vehicle upkeep";
    const providerOptions = {
      provider: "local",
      model: "local-test",
      sessionId: "real-local-semantic",
      contextMemoryEnv: env,
      contextMemoryFilePath: f.memoryFilePath,
      contextMemoryModelWindowTokens: 8192,
    };
    const lexical = new CliCanonicalMemoryService({
      ...f,
      env: { ...env, CC_MEMORY_SEMANTIC_MODE: "off" },
    });
    assert.deepEqual((await lexical.search(query)).entries, []);
    assert.deepEqual(
      (
        await lexical.recallScoped(query, {
          scope: "user",
          scopeId: "local-user",
        })
      ).results,
      [],
    );
    const lexicalProvider = await prepareCanonicalProviderContext(
      [{ role: "user", content: query }],
      {
        ...providerOptions,
        contextMemoryEnv: { ...env, CC_MEMORY_SEMANTIC_MODE: "off" },
      },
    );
    assert.deepEqual(lexicalProvider.recall.results, []);
    const nativeSpawn = executionBroker.spawn.bind(executionBroker);
    let realWorkers = 0;
    t.mock.method(executionBroker, "spawn", (...args) => {
      if (args[2]?.origin === "memory-local-semantic") realWorkers++;
      return nativeSpawn(...args);
    });
    const searched = await service.search(query);
    assert.equal(searched.entries[0].id, relevant.id);
    assert.equal(searched.retrievalMode, "governed_hybrid");
    assert.ok(searched.results[0].semanticRelevance > 0);
    assert.equal(searched.results[0].lexicalRelevance, 0);
    const scoped = await service.recallScoped(query, {
      scope: "user",
      scopeId: "local-user",
    });
    assert.equal(scoped.results[0].id, relevant.id);
    assert.equal(scoped.retrievalMode, "governed_hybrid");
    assert.ok(scoped.semanticEvidenceCount > 0);
    const prepared = await prepareCanonicalProviderContext(
      [{ role: "user", content: query }],
      providerOptions,
    );
    assert.equal(prepared.recall.results[0].record.memoryId, relevant.id);
    assert.equal(prepared.recall.retrievalMode, "governed_hybrid");
    assert.ok(prepared.recall.results[0].semanticRelevance > 0);
    assert.equal(prepared.recall.results[0].lexicalRelevance, 0);
    assert.equal(realWorkers, 3);
  },
);

test("global scope with absent scopeId is admitted, never confused with a named scope", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const source = createLocalSemanticSource({
    memoryPort: {
      query: async () => [
        record("global", { scope: "global", scopeId: undefined }),
        record("named", { scope: "global", scopeId: "named" }),
      ],
    },
    env: f.env,
  });
  const result = await source.candidates({
    ...request,
    scopeAdmissions: [{ scope: "global" }],
  });
  assert.deepEqual(
    result.map((row) => row.memoryId),
    ["global"],
  );
  assert.equal(calls.length, 1);
});

test("large allowed identifiers fit the output bound; the complete corpus is scored before top1000", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const rows = Array.from({ length: 3000 }, (_, index) =>
    record("memory-" + String(index).padStart(4, "0") + "a".repeat(220)),
  );
  const source = createLocalSemanticSource({
    memoryPort: { query: async () => rows },
    env: f.env,
  });
  const result = await source.candidates(request);
  assert.equal(calls[0].request.records.length, 3000);
  assert.equal(result.length, 1000);
});

test("over-capacity corpus fails explicitly without launching or truncating", async (t) => {
  const f = fixture(t);
  const calls = brokerFixture(t);
  const source = createLocalSemanticSource({
    memoryPort: {
      query: async () =>
        Array.from({ length: 10001 }, (_, index) => record("m" + index)),
    },
    env: f.env,
  });
  await assert.rejects(source.candidates(request), {
    code: "CC_MEMORY_SEMANTIC_CAPACITY",
  });
  assert.equal(calls.length, 0);
});

test("review/disabled Memory and shadow never inspect invalid configured model paths", async (t) => {
  const f = fixture(t);
  f.env.CC_MEMORY_SEMANTIC_PYTHON = "not-an-absolute-path";
  const calls = brokerFixture(t);
  for (const controls of [
    { memoryEnabled: false },
    { contextMemoryRecall: false },
    { subAgentContract: { memory: false } },
  ]) {
    await prepareCanonicalProviderContext([{ role: "user", content: "q" }], {
      provider: "local",
      model: "local-test",
      sessionId: "disabled-semantic",
      contextMemoryEnv: f.env,
      contextMemoryFilePath: f.memoryFilePath,
      contextMemoryModelWindowTokens: 8192,
      ...controls,
    });
  }
  await prepareCanonicalProviderContext([{ role: "user", content: "q" }], {
    provider: "local",
    sessionId: "shadow-semantic",
    contextMemoryEnv: {
      ...f.env,
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "shadow",
    },
    contextMemoryFilePath: f.memoryFilePath,
  });
  assert.equal(calls.length, 0);
});

test("legacy runtime injection with kernel.recallMemory remains supported by both service entries", async () => {
  let calls = 0;
  const service = new CliCanonicalMemoryService({
    runtime: {
      kernel: {
        recallMemory: async () => {
          calls++;
          return { results: [] };
        },
      },
    },
  });
  assert.deepEqual((await service.search("q")).entries, []);
  assert.deepEqual(
    (await service.recallScoped("q", { scope: "user", scopeId: "local-user" }))
      .results,
    [],
  );
  assert.equal(calls, 2);
});

test("failed kill has a bounded diagnostic and prevents another worker until close is observed", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let owned;
  brokerFixture(t, (_input, child) => {
    owned = child;
    child.kill = () => false;
    controller.abort(new Error("stop after failed kill"));
    return true;
  });
  const configuration = resolveLocalSemanticConfiguration(f.env);
  const input = { query: "q", records: [{ memoryId: "m", content: "text" }] };
  try {
    await assert.rejects(
      runLocalSemanticWorker(configuration, input, {
        signal: controller.signal,
      }),
      {
        code: "CC_MEMORY_SEMANTIC_CLEANUP_UNCONFIRMED",
        recoveryRequired: true,
      },
    );
    await assert.rejects(runLocalSemanticWorker(configuration, input), {
      code: "CC_MEMORY_SEMANTIC_CLEANUP_UNCONFIRMED",
    });
  } finally {
    owned?.emit("close", null, "SIGKILL");
  }
});

test("corpus selection does not forward recall limit or lexical query to the semantic scan", async (t) => {
  const f = fixture(t);
  brokerFixture(t);
  let scan;
  const source = createLocalSemanticSource({
    env: f.env,
    memoryPort: {
      query: async (value) => {
        scan = value;
        return [record("m")];
      },
    },
  });
  await source.candidates({ ...request, limit: 1, tokenBudget: 1 });
  assert.equal(scan.limit, undefined);
  assert.equal(scan.tokenBudget, undefined);
  assert.equal(scan.query, "*");
});

test("global null scopeId is canonical-equivalent to an omitted global scopeId", async (t) => {
  const f = fixture(t);
  brokerFixture(t);
  const source = createLocalSemanticSource({
    env: f.env,
    memoryPort: {
      query: async () => [
        record("global", { scope: "global", scopeId: undefined }),
      ],
    },
  });
  const result = await source.candidates({
    ...request,
    scopeAdmissions: [{ scope: "global", scopeId: null }],
  });
  assert.equal(result[0].memoryId, "global");
});

test("newly admitted memory during inference invalidates the complete corpus snapshot", async (t) => {
  const f = fixture(t);
  const service = new CliCanonicalMemoryService(f);
  await service.add("old corpus");
  brokerFixture(t, async (_input, _child, respond) => {
    await service.add("new record added while encoder was running");
    respond();
  });
  await assert.rejects(service.search("query"), { code: "revision_conflict" });
});

test("concurrent local encoders are bounded and stopping a contender cannot cancel the owner", async (t) => {
  const f = fixture(t);
  let release;
  let ready;
  const entered = new Promise((resolve) => {
    ready = resolve;
  });
  brokerFixture(t, (_input, _child, respond) => {
    release = respond;
    ready();
    return true;
  });
  const configuration = resolveLocalSemanticConfiguration(f.env);
  const input = { query: "q", records: [{ memoryId: "m", content: "text" }] };
  const owner = runLocalSemanticWorker(configuration, input);
  await entered;
  const contender = new AbortController();
  try {
    await assert.rejects(
      runLocalSemanticWorker(configuration, input, {
        signal: contender.signal,
      }),
      { code: "CC_MEMORY_SEMANTIC_BUSY" },
    );
    contender.abort();
  } finally {
    release();
  }
  assert.equal((await owner)[0].memoryId, "m");
});

test("Unicode identifiers retain their exact UTF-8 identity through bounded output", async (t) => {
  const f = fixture(t);
  brokerFixture(t);
  const identifier = "記憶-😀-é-مرحبا";
  const source = createLocalSemanticSource({
    env: f.env,
    memoryPort: { query: async () => [record(identifier)] },
  });
  assert.equal((await source.candidates(request))[0].memoryId, identifier);
});
