import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import {
  bounded,
  resolveBinary,
  ProbeClient,
  isolatedEnvironment,
  officialValidators,
} from "file:///C:/code/chainlesschain/packages/cli/scripts/codex-app-server-turn-probe.mjs";
import { CodexAppServerAdapter } from "file:///C:/code/chainlesschain/packages/cli/src/lib/codex-app-server-adapter.js";
const version = process.argv[2] || "0.164.0";
assert.ok(["0.160.0", "0.164.0"].includes(version));
const root = mkdtempSync(join(tmpdir(), "cc-codex-cursor-diagnostic-"));
const workspace = join(root, "workspace"),
  env = isolatedEnvironment(root);
for (const path of [
  workspace,
  ...Object.values(env).filter((value) => value.startsWith(root)),
])
  mkdirSync(path, { recursive: true });
let requests = 0;
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    assert.equal(req.headers.authorization, undefined);
    const n = ++requests;
    const item = {
      type: "message",
      id: "msg_diag_" + n,
      role: "assistant",
      status: "completed",
      phase: "final_answer",
      content: [{ type: "output_text", text: "ok", annotations: [] }],
    };
    const response = {
      id: "resp_diag_" + n,
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
  });
});
await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
writeFileSync(
  join(env.CODEX_HOME, "config.toml"),
  [
    'model = "fixture-codex"',
    'model_provider = "fixture"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    "[model_providers.fixture]",
    'name = "Diagnostic fixture"',
    'base_url = "http://127.0.0.1:' + server.address().port + '/v1"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
  ].join("\n"),
);
const upstream = resolveBinary(
  join(
    process.env.TEMP,
    (version === "0.160.0" ? "cc-codex-01600" : "cc-codex-01640") +
      "-gap-20261028/node_modules/@openai/codex/bin/codex.js",
  ),
  version,
);
let client;
async function connect() {
  const child = spawn(upstream.binary, ["app-server", "--listen", "stdio://"], {
    cwd: workspace,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  client = new ProbeClient(child, officialValidators(version));
  await client.guard(
    client.request("initialize", {
      clientInfo: {
        name: "chainlesschain_cursor_diagnostic",
        version: "1.0.0",
      },
    }),
    "initialize",
  );
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
}
const observed = {
  schema: "chainlesschain.codex-cursor-diagnostic/v1",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  version,
  binarySha256: upstream.binarySha256,
  platform: process.platform,
  realProviderAcceptance: false,
  productionAdmission: false,
};
try {
  await connect();
  const params = {
    ephemeral: false,
    cwd: workspace,
    model: "fixture-codex",
    modelProvider: "fixture",
    sandbox: "read-only",
    approvalPolicy: "never",
  };
  await new Promise((yes) => setTimeout(yes, 1100 - (Date.now() % 1000)));
  const [a, b] = await Promise.all([
    client.request("thread/start", params),
    client.request("thread/start", params),
  ]);
  observed.threads = [a, b].map(({ thread }) => ({
    id: thread.id,
    createdAt: thread.createdAt,
    source: thread.source,
  }));
  const adapter = new CodexAppServerAdapter({
    client,
    enabled: true,
    upstreamVersion: version,
    compatibilityMatrix: [{ version }],
  });
  for (const item of [a, b])
    await client.guard(
      adapter.execute({
        threadId: item.thread.id,
        prompt: "Say ok. Do not call tools.",
      }),
      "complete fixture",
    );
  await client.stop();
  await connect();
  for (const [label, extra] of [
    ["default", {}],
    ["database", { useStateDbOnly: true }],
    ["updated", { sortKey: "updated_at" }],
    ["recency", { sortKey: "recency_at" }],
  ]) {
    const query = {
      limit: 1,
      cwd: workspace,
      modelProviders: ["fixture"],
      sourceKinds: [a.thread.source],
      sortDirection: "asc",
      ...extra,
    };
    const first = await client.request("thread/list", query);
    const second = first.nextCursor
      ? await client.request("thread/list", {
          ...query,
          cursor: first.nextCursor,
        })
      : null;
    const all = await client.request("thread/list", { ...query, limit: 100 });
    observed[label] = {
      first: {
        ids: first.data.map((row) => row.id),
        nextCursor: first.nextCursor,
      },
      second: second && {
        ids: second.data.map((row) => row.id),
        nextCursor: second.nextCursor,
      },
      all: all.data.map((row) => row.id),
    };
  }
  observed.providerRequests = requests;
  console.log(JSON.stringify(observed));
  writeFileSync(
    join(
      process.env.TEMP,
      "codex-thread-cursor-diagnostic-20261028-" + version + ".json",
    ),
    JSON.stringify(observed, null, 2) + "\n",
  );
} finally {
  if (client?.running) await client.stop();
  server.closeAllConnections();
  await bounded(new Promise((yes) => server.close(yes)), 5000, "shutdown");
}
