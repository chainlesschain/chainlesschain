import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  collectNetworkCalls,
  scanNetworkSources,
  reviewNetworkSources,
  SOURCE_REVIEW_SCHEMA,
  sha256,
} from "../scripts/lib/budget-egress-inventory.mjs";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";
import { FORMAL_BUDGET_RUNTIME_READINESS } from "../src/lib/formal-budget-transport.js";
import { webSearch, _deps as searchDeps } from "../src/lib/web-search.js";
import { executeTool } from "../src/runtime/agent-core.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-egress-audit-"));
  const repository = path.join(root, "repository");
  const source = path.join(repository, "packages/cli/src");
  fs.mkdirSync(source, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    const target = path.join(source, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return target;
  };
  return { root, repository, source, write };
}

function catalogue(scan) {
  return {
    schema: SOURCE_REVIEW_SCHEMA,
    reviewedAt: "2026-10-15",
    entries: scan.networkCandidates.map((row) => ({
      path: row.path,
      digest: row.digest,
      category: "MODEL_REQUEST",
      rationale: "Offline synthetic fixture; not production admission",
    })),
  };
}

test("AST ignores comments, declaration names, strings and generated template code", () => {
  const source = [
    "// fetch('not-a-call'); https.request(options)",
    "const text = 'fetch(url)';",
    "const generated = `https.request(options); fetch(url)`;",
    "async function providerFetch(input, options) { return input; }",
    "const expression = `actual result: ${fetch(url)}`;",
    "providerFetch(url, {});",
  ].join("\n");
  const rows = collectNetworkCalls(source);
  assert.deepEqual(
    rows.map((row) => [row.line, row.callee]),
    [
      [5, "fetch"],
      [6, "providerFetch"],
    ],
  );
});

test("HTTP selectors, imported/destructured aliases and bound fetch retain actual calls", () => {
  const rows = collectNetworkCalls(
    [
      "import http from 'node:http'; import https from 'node:https';",
      "import { request as send } from 'https';",
      "const lib = secure ? https : http; lib.request(options);",
      "const selected = secure ? _deps.https : _deps.http; selected.get(url);",
      "const {request: requestAlias} = https; requestAlias(options);",
      "const direct = globalThis.fetch.bind(globalThis); direct(url);",
      "send(options); https['request']?.(options);",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((row) => row.callee),
    [
      "lib.request",
      "selected.get",
      "requestAlias",
      "direct",
      "send",
      "https['request']",
    ],
  );
});

test("named socket helpers and inbound server constructors are not outbound calls", () => {
  const rows = collectNetworkCalls(
    [
      "import {isIP, connect as openSocket} from 'node:net';",
      "import {createServer} from 'http';",
      "import {WebSocket, WebSocketServer} from 'ws';",
      "isIP(host); createServer(handler); new WebSocketServer({port: 1});",
      "openSocket(socketPath); new WebSocket(url);",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((row) => row.callee),
    ["openSocket", "WebSocket"],
  );
});

test("CommonJS imports, undici fetch aliases and SDK construction are candidates", () => {
  const rows = collectNetworkCalls(
    [
      "const {request: send} = require('https'); send(opts);",
      "const {fetch: nativeFetch} = require('undici'); nativeFetch(url);",
      "const OpenAI = require('openai'); const client = new OpenAI(options);",
      "client.responses.create(body);",
    ].join("\n"),
    { commonJs: true },
  );
  assert.deepEqual(
    rows.map((row) => row.callee),
    ["send", "nativeFetch", "OpenAI", "client.responses.create"],
  );
});

test("member fetch is conservatively retained, including non-HTTP content-addressed retrieval", () => {
  assert.deepEqual(
    collectNetworkCalls("await transport.fetch(cid);").map((row) => row.callee),
    ["transport.fetch"],
  );
});

test("literal dynamic imports and CommonJS named socket, WebSocket and SDK aliases are retained", () => {
  const rows = collectNetworkCalls(
    [
      "const {request: send} = await import('node:https'); send(options);",
      "const {createConnection: openSocket, isIP} = require('node:net');",
      "openSocket(socketPath); isIP(host);",
      "const {WebSocket: Socket, WebSocketServer: Server} = require('ws');",
      "new Socket(url); new Server({port: 1});",
      "const {OpenAI: Client} = require('openai'); const client = new Client(options);",
      "client.responses.create(body);",
      "const {default: download} = await import('node-fetch'); download(url);",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((row) => row.callee),
    [
      "send",
      "openSocket",
      "Socket",
      "Client",
      "client.responses.create",
      "download",
    ],
  );
});

test("source-bound review passes only for exactly reviewed bytes and never admits paid runtime", (t) => {
  const f = fixture(t);
  f.write("model.js", "fetch(url);");
  const scan = scanNetworkSources(f.repository);
  const reviewed = reviewNetworkSources(scan, catalogue(scan));
  assert.equal(reviewed.sourceReviewPassed, true);
  assert.equal(reviewed.runtimeCoverageVerified, false);
  assert.equal(FORMAL_BUDGET_RUNTIME_READINESS.paidReady, false);
  assert.equal(scan.filesScanned, 1);
});

test("changed reviewed files lose classification until reviewed again", (t) => {
  const f = fixture(t);
  f.write("model.js", "fetch(url);");
  const reviewed = catalogue(scanNetworkSources(f.repository));
  f.write("model.js", "fetch(otherEndpoint);");
  const result = reviewNetworkSources(
    scanNetworkSources(f.repository),
    reviewed,
  );
  assert.equal(result.sourceReviewPassed, false);
  assert.equal(result.rows[0].status, "STALE");
  assert.equal(result.rows[0].category, null);
});

test("new and removed candidate paths cannot silently reuse a prior review", (t) => {
  const f = fixture(t);
  const old = f.write("old.js", "fetch(url);");
  const reviewed = catalogue(scanNetworkSources(f.repository));
  fs.unlinkSync(old);
  f.write("new.js", "fetch(url);");
  const result = reviewNetworkSources(
    scanNetworkSources(f.repository),
    reviewed,
  );
  assert.deepEqual(result.issues.map((row) => row.status).sort(), [
    "REMOVED_OR_NO_LONGER_CANDIDATE",
    "UNREVIEWED",
  ]);
});

test("invalid syntax is visible and cannot yield a clean zero-candidate audit", (t) => {
  const f = fixture(t);
  f.write("broken.js", "export function broken( {");
  const scan = scanNetworkSources(f.repository);
  assert.equal(scan.parseErrors.length, 1);
  assert.equal(
    reviewNetworkSources(scan, catalogue(scan)).sourceReviewPassed,
    false,
  );
});

test("test sources are excluded and an explicit scripts scan exposes unreviewed probes", (t) => {
  const f = fixture(t);
  f.write("__tests__/mock.js", "fetch(testOnly);");
  f.write("real.js", "fetch(realEndpoint);");
  const scriptRoot = path.join(f.repository, "packages/cli/scripts");
  fs.mkdirSync(scriptRoot);
  fs.writeFileSync(path.join(scriptRoot, "probe.mjs"), "fetch(paidEndpoint);");
  const source = scanNetworkSources(f.repository);
  assert.equal(source.filesScanned, 1);
  const expanded = scanNetworkSources(f.repository, [
    "packages/cli/src",
    "packages/cli/scripts",
  ]);
  assert.equal(expanded.networkCandidates.length, 2);
  assert.equal(
    reviewNetworkSources(expanded, catalogue(source)).sourceReviewPassed,
    false,
  );
});

test("symlink directories are not followed and make the audit incomplete", (t) => {
  const f = fixture(t);
  const outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "external.js"), "fetch(external);");
  fs.symlinkSync(outside, path.join(f.source, "linked"), "junction");
  const scan = scanNetworkSources(f.repository);
  assert.equal(scan.filesScanned, 0);
  assert.equal(scan.skippedPaths.length, 1);
  assert.equal(
    reviewNetworkSources(scan, catalogue(scan)).sourceReviewPassed,
    false,
  );
  assert.throws(() => scanNetworkSources(f.repository, [outside]), /escapes/);
});

test("a combined review preserves independent source and scripts audit roots", (t) => {
  const f = fixture(t);
  f.write("model.js", "fetch(url);");
  const scripts = path.join(f.repository, "packages/cli/scripts");
  fs.mkdirSync(scripts);
  const probe = path.join(scripts, "probe.mjs");
  fs.writeFileSync(probe, "fetch(paidEndpoint);");
  const roots = ["packages/cli/src", "packages/cli/scripts"];
  const combinedReview = catalogue(scanNetworkSources(f.repository, roots));
  const sourceOnly = reviewNetworkSources(
    scanNetworkSources(f.repository),
    combinedReview,
  );
  assert.equal(sourceOnly.sourceReviewPassed, true);
  assert.deepEqual(sourceOnly.outOfScopeReviewedPaths, [
    "packages/cli/scripts/probe.mjs",
  ]);
  assert.equal(
    reviewNetworkSources(
      scanNetworkSources(f.repository, roots),
      combinedReview,
    ).sourceReviewPassed,
    true,
  );
  fs.writeFileSync(probe, "fetch(changedPaidEndpoint);");
  const stale = reviewNetworkSources(
    scanNetworkSources(f.repository, roots),
    combinedReview,
  );
  assert.deepEqual(stale.issues, [
    { path: "packages/cli/scripts/probe.mjs", status: "STALE" },
  ]);
  fs.unlinkSync(probe);
  const removed = reviewNetworkSources(
    scanNetworkSources(f.repository, roots),
    combinedReview,
  );
  assert.deepEqual(removed.issues, [
    {
      path: "packages/cli/scripts/probe.mjs",
      status: "REMOVED_OR_NO_LONGER_CANDIDATE",
    },
  ]);
});

test("explicit root symlinks remain incomplete and empty root sets are rejected", (t) => {
  const f = fixture(t);
  const alias = path.join(f.repository, "source-alias");
  fs.symlinkSync(f.source, alias, "junction");
  const scan = scanNetworkSources(f.repository, ["source-alias"]);
  assert.equal(scan.filesScanned, 0);
  assert.equal(scan.skippedPaths.length, 1);
  assert.equal(
    reviewNetworkSources(scan, catalogue(scan)).sourceReviewPassed,
    false,
  );
  assert.throws(() => scanNetworkSources(f.repository, []), /Nonempty/);
});

test("review catalogue rejects duplicate paths, invalid categories and malformed digests", () => {
  const scan = {
    networkCandidates: [{ path: "model.js", digest: sha256("fetch(url);") }],
    parseErrors: [],
    skippedPaths: [],
  };
  for (const change of [
    (c) => c.entries.push({ ...c.entries[0] }),
    (c) => {
      c.entries[0].category = "PAID_READY";
    },
    (c) => {
      c.entries[0].digest = "not-a-digest";
    },
  ]) {
    const c = catalogue(scan);
    change(c);
    assert.throws(() => reviewNetworkSources(scan, c));
  }
});

test("audit help does not require a review or create an output artifact", (t) => {
  const f = fixture(t);
  const output = path.join(f.root, "must-not-exist.json");
  const help = execFileSync(
    process.execPath,
    [
      "packages/cli/scripts/implementation-plan-budget-egress.mjs",
      "--help",
      "--output",
      output,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.match(help, /--check/);
  assert.equal(fs.existsSync(output), false);
});

const inScope = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-search-fixture",
      transport: {
        createFetch: () => () => {
          throw new Error(
            "No Chat request should be issued by a rejected search",
          );
        },
      },
    },
    operation,
  );

test("all search providers refuse unpriced service dispatch in a Chat-only budget scope", async (t) => {
  let requests = 0;
  t.mock.method(searchDeps.http, "request", () => {
    requests++;
    throw new Error("Offline test refused HTTP");
  });
  t.mock.method(searchDeps.https, "request", () => {
    requests++;
    throw new Error("Offline test refused HTTPS");
  });
  for (const provider of [
    "auto",
    "tavily",
    "brave",
    "bocha",
    "qianfan",
    "searxng",
    "duckduckgo",
    "baidu",
  ]) {
    await assert.rejects(
      inScope(() =>
        webSearch("synthetic query", { provider, apiKey: "fixture-only" }),
      ),
      { code: "CC_BUDGET_SERVICE_NOT_COVERED" },
    );
  }
  assert.equal(requests, 0);
});

test("search rejects before resolving configured credentials or acquiring a host tool lease", async () => {
  let configReads = 0,
    leases = 0;
  const options = {
    get config() {
      configReads++;
      throw new Error("Must not read credentials");
    },
    hostResourceBudget: {
      admitTool() {
        leases++;
      },
    },
  };
  await assert.rejects(
    inScope(() => webSearch("synthetic query", options)),
    { code: "CC_BUDGET_SERVICE_NOT_COVERED" },
  );
  assert.equal(configReads, 0);
  assert.equal(leases, 0);
});

test("the canonical web_search tool cannot turn a budget refusal into an ordinary tool result", async () => {
  await assert.rejects(
    inScope(() =>
      executeTool("web_search", { query: "synthetic", provider: "tavily" }),
    ),
    { code: "CC_BUDGET_TOOL_NOT_COVERED" },
  );
});
