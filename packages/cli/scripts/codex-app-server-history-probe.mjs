#!/usr/bin/env node
// Real Codex processes with an isolated home and a finite loopback provider.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerAdapter } from "../src/lib/codex-app-server-adapter.js";
import {
  bounded,
  exactSource,
  isolatedEnvironment,
  officialValidators,
  ProbeClient,
  PROBE_VERSION,
  resolveBinary,
} from "./codex-app-server-turn-probe.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validateScope(scope) {
  assert.ok(
    ["database", "scan-repair"].includes(scope),
    "invalid history probe scope",
  );
  return scope;
}

export function parseHistoryProbeOptions(argv) {
  const options = { scope: "database" };
  const names = {
    "--codex-js": "codexJs",
    "--commit-sha": "commitSha",
    "--output": "output",
    "--version": "version",
    "--scope": "scope",
  };
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(
      Object.hasOwn(names, argv[index]) && argv[index + 1],
      "invalid history probe arguments",
    );
    options[names[argv[index]]] = argv[index + 1];
  }
  validateScope(options.scope);
  return options;
}

// Continue independent observations after a strict failure, but never turn a
// successful later repair into acceptance of the original incomplete scan.
export function createHistoryCheckRecorder() {
  const failures = [];
  let firstError;
  return {
    failures,
    async check(name, operation) {
      try {
        await operation();
        return true;
      } catch (error) {
        firstError ||= error;
        failures.push({
          name,
          error: {
            name: error.name,
            message: String(error.message).slice(0, 2000),
          },
        });
        return false;
      }
    },
    assertPassed() {
      if (firstError) throw firstError;
    },
  };
}

export async function collectHistoryPages(
  request,
  method,
  params,
  maxPages = 8,
) {
  assert.ok(Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 32);
  const data = [],
    pages = [],
    ids = new Set(),
    cursors = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const result = await request(method, {
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    assert.ok(Array.isArray(result?.data), "history page must contain data");
    assert.ok(
      result.nextCursor === null ||
        (typeof result.nextCursor === "string" && result.nextCursor.length > 0),
      "invalid history cursor",
    );
    for (const entry of result.data) {
      assert.ok(
        typeof entry?.id === "string" && entry.id.length > 0,
        "missing history identity",
      );
      assert.ok(!ids.has(entry.id), "duplicate history identity");
      ids.add(entry.id);
      data.push(entry);
    }
    pages.push({
      ids: result.data.map((entry) => entry.id),
      nextCursor: result.nextCursor,
    });
    if (result.nextCursor === null) return { data, pages };
    assert.ok(result.data.length > 0, "empty nonterminal history page");
    assert.ok(!cursors.has(result.nextCursor), "repeated history cursor");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("history pagination exceeded its bound");
}

// Observe raw upstream parameters without repairing cursors or changing sort
// semantics. A terminal page can still omit known identities.
export async function observeThreadHistory(request, params, expectedIds) {
  const paged = await collectHistoryPages(request, "thread/list", params);
  const all = await request("thread/list", { ...params, limit: 100 });
  assert.ok(Array.isArray(all?.data), "full history must contain data");
  assert.equal(all.nextCursor, null, "fixture exceeds full history page");
  const ids = paged.data.map((entry) => entry.id);
  const allIds = all.data.map((entry) => entry.id);
  const sameIdentities = (values) =>
    values.length === expectedIds.length &&
    new Set(values).size === values.length &&
    expectedIds.every((id) => values.includes(id));
  return {
    params,
    pages: paged.pages,
    ids,
    allIds,
    missingIds: expectedIds.filter((id) => !ids.includes(id)),
    unexpectedIds: ids.filter((id) => !expectedIds.includes(id)),
    complete: sameIdentities(ids) && sameIdentities(allIds),
  };
}

// Unsupported raw-default diagnostics must retain their failure without
// preventing the separately asserted recency/repair journeys from running.
export async function observeRawThreadHistory(request, params, expectedIds) {
  try {
    return await observeThreadHistory(request, params, expectedIds);
  } catch (error) {
    return {
      params,
      complete: false,
      error: {
        name: error.name,
        message: String(error.message).slice(0, 2000),
      },
    };
  }
}

export function assertCompleteScanHistory(observed) {
  for (const direction of ["asc", "desc"]) {
    assert.equal(
      observed[direction]?.complete,
      true,
      `rollout scan ${direction} omitted or changed known thread identities`,
    );
    assert.ok(
      observed[direction].pages.length >= 2,
      `rollout scan ${direction} did not exercise cursor continuation`,
    );
  }
  assert.deepEqual(
    observed.desc.ids,
    [...observed.asc.ids].reverse(),
    "rollout scan sort direction did not reverse the stable identity order",
  );
}

// Only genuine rollouts from this probe's stopped process may enter the new
// home. Never copy a state DB or follow links out of the isolated fixture.
export function copyHistoryRollouts(threads, sourceHome, targetHome) {
  const sourceRoot = resolve(sourceHome);
  const destinationRoot = resolve(targetHome);
  assert.notEqual(sourceRoot, destinationRoot, "rollout homes must differ");
  for (const directory of [sourceRoot, destinationRoot]) {
    const stat = lstatSync(directory);
    assert.ok(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "rollout home must be an unlinked directory",
    );
  }
  const copied = [];
  for (const thread of threads) {
    assert.equal(
      typeof thread.path,
      "string",
      "missing generated rollout path",
    );
    const source = resolve(thread.path);
    const local = relative(sourceRoot, source);
    const parts = local.split(sep);
    assert.ok(
      !isAbsolute(local) && parts[0] === "sessions" && parts.length >= 2,
      "rollout must be inside the isolated home sessions tree",
    );
    let current = sourceRoot;
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      const stat = lstatSync(current);
      const leaf = index === parts.length - 1;
      assert.ok(
        !stat.isSymbolicLink() &&
          (leaf ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()),
        "rollout source must not contain links or special files",
      );
      if (leaf)
        assert.ok(
          stat.size <= 8 * 1024 * 1024,
          "rollout exceeds fixture bound",
        );
    }
    const bytes = readFileSync(source);
    const metadata = JSON.parse(bytes.toString("utf8").split(/\r?\n/u)[0]);
    assert.equal(
      metadata.type,
      "session_meta",
      "missing real rollout metadata",
    );
    assert.equal(metadata.payload?.id, thread.id, "rollout identity mismatch");
    const destination = resolve(destinationRoot, local);
    current = destinationRoot;
    for (const part of parts.slice(0, -1)) {
      current = resolve(current, part);
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const stat = lstatSync(current);
      assert.ok(
        stat.isDirectory() && !stat.isSymbolicLink(),
        "rollout destination must not contain links",
      );
    }
    writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    const digest = sha256(bytes);
    assert.equal(
      sha256(readFileSync(destination)),
      digest,
      "rollout copy changed bytes",
    );
    copied.push({
      threadId: thread.id,
      relativePath: local,
      bytes: bytes.length,
      sha256: digest,
    });
  }
  return copied;
}

function historyProvider() {
  const plans = ["history-main-1", "history-other-1", "history-main-2"];
  const requests = [];
  let rejectFailure;
  const failure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  failure.catch(() => {});
  const server = http.createServer((req, res) => {
    (async () => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      assert.equal(
        req.headers.authorization,
        undefined,
        "credential reached history fixture",
      );
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        assert.ok(bytes <= 1024 * 1024, "history provider request too large");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.model, "fixture-codex");
      const lastUser = JSON.stringify(
        body.input?.filter((item) => item.role === "user").at(-1),
      );
      const matches = plans.filter((plan) => lastUser?.includes(plan));
      assert.equal(matches.length, 1, "missing history scenario");
      const scenario = matches[0];
      assert.equal(
        scenario,
        plans[requests.length],
        "history replay or unexpected request",
      );
      const retainedContext = scenario === "history-main-2";
      if (retainedContext) {
        const context = JSON.stringify(body.input);
        assert.ok(
          context.includes("history-main-1"),
          "original user input lost after restart",
        );
        assert.ok(
          context.includes("history-main-1-result"),
          "original assistant output lost after restart",
        );
        assert.ok(
          !context.includes("history-other-1"),
          "another thread entered resumed context",
        );
      }
      requests.push({ scenario, authorization: false, retainedContext });
      const item = {
        type: "message",
        id: "msg_" + scenario,
        role: "assistant",
        status: "completed",
        phase: "final_answer",
        content: [
          { type: "output_text", text: scenario + "-result", annotations: [] },
        ],
      };
      const response = {
        id: "resp_" + scenario,
        object: "response",
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 12,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };
      const send = (event) =>
        res.write("data: " + JSON.stringify(event) + "\n\n");
      res.writeHead(200, { "content-type": "text/event-stream" });
      send({
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      });
      send({
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({ type: "response.completed", response });
      res.end();
    })().catch((error) => {
      rejectFailure(error);
      res.destroy();
    });
  });
  server.on("error", rejectFailure);
  server.requestTimeout = 15_000;
  return { server, requests, failure };
}

export async function runHistoryProbe({
  codexJs,
  commitSha,
  output,
  version = PROBE_VERSION,
  scope = "database",
}) {
  validateScope(scope);
  exactSource(commitSha);
  const upstream = resolveBinary(codexJs, version);
  const root = mkdtempSync(resolve(tmpdir(), "cc-codex-history-probe-"));
  const workspace = resolve(root, "workspace"),
    env = isolatedEnvironment(root);
  for (const directory of [
    workspace,
    ...Object.values(env).filter((value) => value.startsWith(root)),
  ])
    mkdirSync(directory, { recursive: true });
  const reported = execFileSync(upstream.binary, ["--version"], {
    cwd: workspace,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  }).trim();
  assert.equal(reported, "codex-cli " + version);
  const provider = historyProvider(),
    validators = officialValidators(version),
    clients = [],
    closures = [];
  const historyChecks = {
    database: { status: "not-run", verified: false },
    rawUpstreamQueries: { status: "not-run" },
    rolloutScanRecency: { status: "not-run", verified: false },
    rolloutRepair: {
      status: "not-run",
      verified: false,
      orderComparison: { status: "not-run", verified: false },
      cases: {
        asc: { status: "not-run", verified: false },
        desc: { status: "not-run", verified: false },
      },
    },
  };
  const strictChecks = createHistoryCheckRecorder();
  let threadSample;
  let client, report, failure;
  const guard = (promise, label) =>
    bounded(Promise.race([promise, provider.failure]), 30_000, label);
  const request = (method, params) =>
    guard(client.guard(client.request(method, params), method), method);
  async function connect(environment = env) {
    const child = spawn(
      upstream.binary,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: workspace,
        env: environment,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    client = new ProbeClient(child, validators);
    clients.push(client);
    await request("initialize", {
      clientInfo: { name: "chainlesschain_history_probe", version: "1.0.0" },
    });
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
  }
  async function execute(threadId, scenario) {
    const adapter = new CodexAppServerAdapter({
      client,
      enabled: true,
      upstreamVersion: version,
      compatibilityMatrix: [{ version }],
      timeoutMs: 20_000,
      fallback: () => {
        throw new Error("history probe must never fall back");
      },
    });
    const result = await guard(
      client.guard(
        adapter.execute({
          threadId,
          prompt:
            scenario + ": Respond with the fixture output. Do not call tools.",
        }),
        scenario,
      ),
      scenario,
    );
    assert.equal(result.terminal, "completed");
    assert.equal(result.output, scenario + "-result");
    assert.equal(result.fallback, false);
    assert.equal(result.threadId, threadId);
    return { threadId, turnId: result.turnId, output: result.output };
  }
  try {
    historyChecks.database.status = "checking";
    await bounded(
      new Promise((yes, no) => {
        provider.server.once("error", no);
        provider.server.listen(0, "127.0.0.1", yes);
      }),
      5000,
      "history provider listen",
    );
    writeFileSync(
      resolve(env.CODEX_HOME, "config.toml"),
      [
        'model = "fixture-codex"',
        'model_provider = "fixture"',
        'approval_policy = "never"',
        'sandbox_mode = "read-only"',
        "[model_providers.fixture]",
        'name = "Isolated history fixture"',
        'base_url = "http://127.0.0.1:' +
          provider.server.address().port +
          '/v1"',
        'wire_api = "responses"',
        "requires_openai_auth = false",
        "request_max_retries = 0",
        "stream_max_retries = 0",
        "",
      ].join("\n"),
    );
    await connect();
    const startParams = {
      ephemeral: false,
      cwd: workspace,
      model: "fixture-codex",
      modelProvider: "fixture",
      sandbox: "read-only",
      approvalPolicy: "never",
    };
    // Launch both siblings together near the start of a wall-clock second.
    // Never stagger their creation to avoid the upstream timestamp collision.
    await bounded(
      new Promise((yes) => setTimeout(yes, 1025 - (Date.now() % 1000))),
      2000,
      "same-second thread sample",
    );
    const [main, other] = await Promise.all([
      request("thread/start", startParams),
      request("thread/start", startParams),
    ]);
    threadSample = [main.thread, other.thread].map(({ id, createdAt }) => ({
      id,
      createdAt,
    }));
    assert.ok(
      threadSample.every((thread) => Number.isSafeInteger(thread.createdAt)),
      "missing integer thread creation timestamp",
    );
    assert.equal(
      main.thread.createdAt,
      other.thread.createdAt,
      "concurrent fixture missed the same-created-at-second boundary",
    );
    const first = await execute(main.thread.id, "history-main-1");
    const unrelated = await execute(other.thread.id, "history-other-1");
    closures.push(await client.stop());
    assert.equal(client.running, false);
    await connect();
    const expectedIds = [first.threadId, unrelated.threadId];
    const historyFilters = {
      limit: 1,
      cwd: workspace,
      modelProviders: ["fixture"],
      sourceKinds: [main.thread.source],
    };
    const listed = await collectHistoryPages(request, "thread/list", {
      limit: 1,
      cwd: workspace,
      modelProviders: ["fixture"],
      sourceKinds: [main.thread.source],
      sortDirection: "asc",
      // Default rollout scanning and legacy created_at DB cursors can omit
      // siblings. recency_at uses a timestamp plus identity on both versions.
      sortKey: "recency_at",
      useStateDbOnly: true,
    });
    assert.deepEqual(
      new Set(listed.data.map((entry) => entry.id)),
      new Set([first.threadId, unrelated.threadId]),
    );
    assert.ok(
      listed.pages.length >= 2,
      "thread cursor continuation was not exercised",
    );
    if (scope === "scan-repair") {
      // Never rewrite explicit created_at or count raw-default omissions as
      // supported behavior. These diagnostics retain their own failures.
      for (const [name, extra] of [
        ["defaults", {}],
        ["createdAt", { sortKey: "created_at" }],
        ["databaseCreatedAt", { sortKey: "created_at", useStateDbOnly: true }],
      ]) {
        historyChecks.rawUpstreamQueries[name] = await observeRawThreadHistory(
          request,
          { ...historyFilters, sortDirection: "asc", ...extra },
          expectedIds,
        );
      }
      historyChecks.rawUpstreamQueries.status = "observed";
      const verified = await strictChecks.check(
        "indexed-rollout-recency",
        async () => {
          for (const sortDirection of ["asc", "desc"]) {
            historyChecks.rolloutScanRecency[sortDirection] =
              await observeThreadHistory(
                request,
                {
                  ...historyFilters,
                  sortDirection,
                  sortKey: "recency_at",
                  useStateDbOnly: false,
                },
                expectedIds,
              );
          }
          assertCompleteScanHistory(historyChecks.rolloutScanRecency);
        },
      );
      Object.assign(historyChecks.rolloutScanRecency, {
        verified,
        status: verified ? "verified" : "failed",
      });
    }
    const metadata = await request("thread/read", {
      threadId: first.threadId,
      includeTurns: false,
    });
    assert.equal(metadata.thread.id, first.threadId);
    assert.equal(
      provider.requests.length,
      2,
      "history reads launched a model request",
    );
    const resumed = await request("thread/resume", {
      threadId: first.threadId,
      excludeTurns: true,
    });
    assert.equal(resumed.thread.id, first.threadId);
    assert.equal(resumed.model, "fixture-codex");
    assert.equal(resumed.modelProvider, "fixture");
    assert.equal(resolve(resumed.cwd), workspace);
    assert.equal(resumed.approvalPolicy, "never");
    assert.equal(resumed.sandbox.type, "readOnly");
    assert.equal(
      provider.requests.length,
      2,
      "resume replayed a completed request",
    );
    const before = await collectHistoryPages(request, "thread/turns/list", {
      threadId: first.threadId,
      limit: 1,
      sortDirection: "asc",
      itemsView: "full",
    });
    assert.deepEqual(
      before.data.map((entry) => entry.id),
      [first.turnId],
    );
    const second = await execute(first.threadId, "history-main-2");
    const after = await collectHistoryPages(request, "thread/turns/list", {
      threadId: first.threadId,
      limit: 1,
      sortDirection: "asc",
      itemsView: "full",
    });
    assert.deepEqual(
      after.data.map((entry) => entry.id),
      [first.turnId, second.turnId],
    );
    assert.ok(
      after.pages.length >= 2,
      "turn cursor continuation was not exercised",
    );
    for (const [index, result] of [first, second].entries()) {
      assert.equal(after.data[index].status, "completed");
      assert.ok(
        after.data[index].items.some(
          (item) => item.type === "agentMessage" && item.text === result.output,
        ),
        "persisted assistant output missing",
      );
    }
    assert.equal(
      provider.requests.length,
      3,
      "history caused extra provider requests",
    );
    closures.push(await client.stop());
    assert.equal(client.running, false);
    Object.assign(historyChecks.database, {
      status: "verified",
      verified: true,
      settingsRestored: true,
      completedRequestReplayed: false,
      threadPages: listed.pages,
      turnPagesBeforeResume: before.pages,
      turnPagesAfterResume: after.pages,
    });
    if (scope === "scan-repair") {
      const rolloutThreads = listed.data.map(({ id, path }) => ({ id, path }));
      const repairSummary = historyChecks.rolloutRepair;
      repairSummary.status = "checking";
      for (const sortDirection of ["asc", "desc"]) {
        const repair = repairSummary.cases[sortDirection];
        const failuresBefore = strictChecks.failures.length;
        repair.status = "preparing";
        await strictChecks.check(`cold-${sortDirection}:fixture`, async () => {
          try {
            if (
              rolloutThreads.some((thread) => typeof thread.path !== "string")
            ) {
              repair.status = "not-exercised";
              repair.reason =
                "upstream did not expose both genuine rollout paths";
              assert.fail(repair.reason);
            }
            // Each direction gets an independent cold index. No full query or
            // scan in the opposite direction may warm its first limit:1 call.
            const repairRoot = resolve(root, `rollout-repair-${sortDirection}`);
            const repairEnv = isolatedEnvironment(repairRoot);
            repair.home = repairEnv.CODEX_HOME;
            for (const directory of Object.values(repairEnv).filter((value) =>
              value.startsWith(repairRoot),
            ))
              mkdirSync(directory, { recursive: true });
            writeFileSync(
              resolve(repairEnv.CODEX_HOME, "config.toml"),
              readFileSync(resolve(env.CODEX_HOME, "config.toml")),
              { flag: "wx", mode: 0o600 },
            );
            await connect(repairEnv);
            const databaseParams = {
              ...historyFilters,
              sortDirection,
              sortKey: "recency_at",
              useStateDbOnly: true,
            };
            repair.beforeCopy = await collectHistoryPages(
              request,
              "thread/list",
              databaseParams,
            );
            assert.deepEqual(
              repair.beforeCopy.data,
              [],
              "new isolated home unexpectedly contains history",
            );
            repair.rollouts = copyHistoryRollouts(
              rolloutThreads,
              env.CODEX_HOME,
              repairEnv.CODEX_HOME,
            );
            repair.afterCopy = await collectHistoryPages(
              request,
              "thread/list",
              databaseParams,
            );
            repair.indexAbsenceEvidence =
              "fresh-home-without-copied-state-db-and-state-db-only-list";
            if (repair.afterCopy.data.length > 0) {
              repair.status = "not-exercised";
              repair.reason =
                "upstream indexed rollouts before the missing-index observation";
              assert.fail(repair.reason);
            }
            repair.status = "checking";
            repair.missingIndexObserved = true;
            const scanParams = { ...databaseParams, useStateDbOnly: false };
            repair.firstScanVerified = await strictChecks.check(
              `cold-${sortDirection}:first-scan`,
              async () => {
                const scanned = await collectHistoryPages(
                  request,
                  "thread/list",
                  scanParams,
                );
                repair.firstScan = { params: scanParams, ...scanned };
                assert.deepEqual(
                  new Set(scanned.data.map((thread) => thread.id)),
                  new Set(expectedIds),
                  `cold rollout scan ${sortDirection} omitted known identities`,
                );
                assert.ok(
                  scanned.pages.length >= 2,
                  "cold rollout scan did not exercise cursor continuation",
                );
              },
            );
            // These are later observations, never replacements for firstScan.
            await strictChecks.check(
              `cold-${sortDirection}:full-scan`,
              async () => {
                repair.fullScan = await request("thread/list", {
                  ...scanParams,
                  limit: 100,
                });
                assert.equal(
                  repair.fullScan.nextCursor,
                  null,
                  "full rollout scan is unexpectedly truncated",
                );
                assert.deepEqual(
                  new Set(repair.fullScan.data.map((thread) => thread.id)),
                  new Set(expectedIds),
                );
                assert.equal(repair.fullScan.data.length, expectedIds.length);
              },
            );
            await strictChecks.check(
              `cold-${sortDirection}:database-after-full-scan`,
              async () => {
                repair.afterFullScan = await observeThreadHistory(
                  request,
                  databaseParams,
                  expectedIds,
                );
                assert.equal(
                  repair.afterFullScan.complete,
                  true,
                  "full rollout scan did not repair the database index",
                );
              },
            );
            repair.knownIdRecovery = {};
            for (const expectedTurns of [[first, second], [unrelated]]) {
              const threadId = expectedTurns[0].threadId;
              const recovery = { status: "checking", verified: false };
              repair.knownIdRecovery[threadId] = recovery;
              const recovered = await strictChecks.check(
                `cold-${sortDirection}:known-id:${threadId}`,
                async () => {
                  const resumedThread = await request("thread/resume", {
                    threadId,
                    excludeTurns: true,
                  });
                  assert.equal(resumedThread.thread.id, threadId);
                  assert.equal(resumedThread.model, "fixture-codex");
                  assert.equal(resumedThread.modelProvider, "fixture");
                  assert.equal(resolve(resumedThread.cwd), workspace);
                  assert.equal(resumedThread.approvalPolicy, "never");
                  assert.equal(resumedThread.sandbox.type, "readOnly");
                  recovery.settingsRestored = true;
                  const turns = await collectHistoryPages(
                    request,
                    "thread/turns/list",
                    {
                      threadId,
                      limit: 1,
                      sortDirection: "asc",
                      itemsView: "full",
                    },
                  );
                  recovery.turnPages = turns.pages;
                  assert.deepEqual(
                    turns.data.map((turn) => turn.id),
                    expectedTurns.map((result) => result.turnId),
                  );
                  if (expectedTurns.length > 1)
                    assert.ok(
                      turns.pages.length >= 2,
                      "repaired turn history did not exercise cursor continuation",
                    );
                  for (const [index, result] of expectedTurns.entries()) {
                    assert.equal(turns.data[index].status, "completed");
                    assert.ok(
                      turns.data[index].items.some(
                        (item) =>
                          item.type === "agentMessage" &&
                          item.text === result.output,
                      ),
                      "repaired rollout lost persisted assistant output",
                    );
                  }
                  assert.equal(
                    provider.requests.length,
                    3,
                    "rollout recovery launched a model request",
                  );
                },
              );
              Object.assign(recovery, {
                verified: recovered,
                status: recovered ? "verified" : "failed",
              });
            }
          } finally {
            if (client?.running) closures.push(await client.stop());
          }
        });
        repair.verified =
          strictChecks.failures.length === failuresBefore &&
          repair.missingIndexObserved === true;
        if (repair.status !== "not-exercised")
          repair.status = repair.verified ? "verified" : "failed";
      }
      repairSummary.orderComparison = { status: "not-run", verified: false };
      if (
        Object.values(repairSummary.cases).every(
          (entry) => entry.firstScanVerified,
        )
      ) {
        const verified = await strictChecks.check(
          "cold-direction-order",
          async () => {
            assert.deepEqual(
              repairSummary.cases.desc.firstScan.data.map(
                (thread) => thread.id,
              ),
              repairSummary.cases.asc.firstScan.data
                .map((thread) => thread.id)
                .reverse(),
              "independent cold scan directions did not reverse the identity order",
            );
          },
        );
        repairSummary.orderComparison = {
          verified,
          status: verified ? "verified" : "failed",
        };
      }
      repairSummary.verified =
        Object.values(repairSummary.cases).every((entry) => entry.verified) &&
        repairSummary.orderComparison.verified;
      repairSummary.status = repairSummary.verified ? "verified" : "failed";
      assert.equal(
        provider.requests.length,
        3,
        "rollout observations launched a model request",
      );
    }
    exactSource(commitSha);
    report = {
      schema: "chainlesschain.codex-history-probe/v1",
      status: "passed",
      commitSha,
      platform: process.platform,
      arch: process.arch,
      upstream: { version, reported, binarySha256: upstream.binarySha256 },
      provider: "synthetic-loopback-responses",
      realProviderAcceptance: false,
      productionAdmission: false,
      processRestarted: true,
      threadSource: main.thread.source,
      threadListMode: "state-db-only",
      threadListSortKey: "recency_at",
      threadCreationTimes: [main.thread.createdAt, other.thread.createdAt],
      sameCreatedAtSecond: main.thread.createdAt === other.thread.createdAt,
      rolloutScanPaginationVerified: false,
      settingsRestored: true,
      completedRequestReplayed: false,
      threadPages: listed.pages,
      turnPagesBeforeResume: before.pages,
      turnPagesAfterResume: after.pages,
      results: [first, unrelated, second],
      providerRequests: provider.requests,
      officialSchema: {
        hashes: validators.hashes,
        validatedMessages: validators.counts,
      },
    };
    strictChecks.assertPassed();
  } catch (error) {
    if (historyChecks.database.status === "checking")
      historyChecks.database.status = "failed";
    if (historyChecks.rolloutRepair.status === "checking")
      historyChecks.rolloutRepair.status = "failed";
    failure = error;
  } finally {
    try {
      if (client?.running) closures.push(await client.stop());
      provider.server.closeAllConnections();
      await bounded(
        new Promise((yes) => provider.server.close(yes)),
        5000,
        "history provider shutdown",
      );
    } catch (error) {
      failure ||= error;
    }
  }
  const transcript =
    JSON.stringify(clients.map((entry) => entry.notifications)) + "\n";
  const destination = resolve(output);
  mkdirSync(dirname(destination), { recursive: true });
  report = {
    ...(report || {
      schema: "chainlesschain.codex-history-probe/v1",
      commitSha,
      platform: process.platform,
      upstream: { version },
      productionAdmission: false,
      realProviderAcceptance: false,
    }),
    status: failure ? "failed" : "passed",
    scope,
    requiredChecks:
      scope === "database"
        ? ["database"]
        : [
            "database",
            "indexed-rollout-recency",
            "cold-asc",
            "cold-desc",
            "cold-direction-order",
          ],
    unverifiedScopes: [
      "raw-upstream-default-pagination",
      "created-at-pagination",
      ...(!historyChecks.database.verified ? ["database"] : []),
      ...(!historyChecks.rolloutScanRecency.verified
        ? ["indexed-rollout-recency"]
        : []),
      ...Object.entries(historyChecks.rolloutRepair.cases)
        .filter(([, result]) => !result.verified)
        .map(([direction]) => `cold-${direction}`),
      ...(!historyChecks.rolloutRepair.orderComparison.verified
        ? ["cold-direction-order"]
        : []),
    ],
    strictFailures: strictChecks.failures,
    arch: process.arch,
    upstream: { version, reported, binarySha256: upstream.binarySha256 },
    officialSchema: {
      hashes: validators.hashes,
      validatedMessages: validators.counts,
    },
    threadSample,
    historyChecks,
    // This additional scope never promotes the raw default/created_at scan.
    rolloutScanRecencyPaginationVerified:
      historyChecks.rolloutScanRecency.verified === true,
    providerRequests: provider.requests,
    processClosed: closures,
    notificationsSha256: sha256(transcript),
    ...(failure
      ? {
          error: {
            name: failure.name,
            message: String(failure.message).slice(0, 2000),
          },
        }
      : {}),
  };
  writeFileSync(destination + ".notifications.json", transcript);
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  if (failure) throw failure;
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseHistoryProbeOptions(process.argv.slice(2));
  runHistoryProbe(options)
    .then((report) => process.stdout.write(JSON.stringify(report) + "\n"))
    .catch((error) => {
      process.stderr.write(error.stack + "\n");
      process.exitCode = 1;
    });
}
