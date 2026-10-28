#!/usr/bin/env node
// Real Codex processes with an isolated home and a finite loopback provider.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
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
}) {
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
  let client, report, failure;
  const guard = (promise, label) =>
    bounded(Promise.race([promise, provider.failure]), 30_000, label);
  const request = (method, params) =>
    guard(client.guard(client.request(method, params), method), method);
  async function connect() {
    const child = spawn(
      upstream.binary,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: workspace,
        env,
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
    const [main, other] = await Promise.all([
      request("thread/start", startParams),
      request("thread/start", startParams),
    ]);
    const first = await execute(main.thread.id, "history-main-1");
    const unrelated = await execute(other.thread.id, "history-other-1");
    closures.push(await client.stop());
    assert.equal(client.running, false);
    await connect();
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
  } catch (error) {
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
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const names = {
      "--codex-js": "codexJs",
      "--commit-sha": "commitSha",
      "--output": "output",
      "--version": "version",
    };
    assert.ok(
      names[process.argv[index]] && process.argv[index + 1],
      "invalid history probe arguments",
    );
    options[names[process.argv[index]]] = process.argv[index + 1];
  }
  runHistoryProbe(options)
    .then((report) => process.stdout.write(JSON.stringify(report) + "\n"))
    .catch((error) => {
      process.stderr.write(error.stack + "\n");
      process.exitCode = 1;
    });
}
