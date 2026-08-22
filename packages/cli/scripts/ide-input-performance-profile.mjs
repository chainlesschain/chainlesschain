#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const requireFromRoot = createRequire(
  path.join(REPOSITORY_ROOT, "package.json"),
);
const { MAX_CANDIDATES, MAX_PATHS, WorkspaceMentionIndex } = requireFromRoot(
  "./packages/vscode-extension/src/chat/workspace-mention-index.js",
);

const PROFILE_VERSION = "ide-input-perf/v1";
const QUERY_COUNT = 20;
const P95_LIMIT_MS = 200;
const SHA_RE = /^[a-f0-9]{40}$/u;
const SOURCE_PATHS = Object.freeze([
  "packages/vscode-extension/src/chat/workspace-mention-index.js",
  "packages/vscode-extension/src/chat/chat-view.js",
  "packages/vscode-extension/src/chat/chat-html.js",
  "packages/vscode-extension/src/chat/symbol-mentions.js",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/Mentions.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/WorkspaceMentionIndex.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatMentionPopups.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexPerformanceProfile.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexPerformanceTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexTest.java",
  "packages/cli/scripts/ide-input-performance-profile.mjs",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
  "packages/cli/__tests__/unit/ide-input-performance.test.js",
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
]);

const THRESHOLDS = Object.freeze({
  pathCount: MAX_PATHS,
  consecutiveQueries: QUERY_COUNT,
  rapidQueries: QUERY_COUNT,
  p95Ms: P95_LIMIT_MS,
  maxCandidates: MAX_CANDIDATES,
  staleCommitCount: 0,
  leakCount: 0,
  contentReadCount: 0,
});
const TEST_IDS = Object.freeze([
  "ide-input-performance-profile#vscode100kAndRapidQueries",
  "WorkspaceMentionIndexPerformanceTest#profiles100kPathsAndRapidQueries",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((value / 100) * sorted.length) - 1)];
}

function producerDigests() {
  return Object.fromEntries(
    SOURCE_PATHS.map((sourcePath) => {
      const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, sourcePath));
      return [sourcePath, digest(bytes)];
    }),
  );
}

function canonicalOs(value = process.platform) {
  const normalized = String(value).toLowerCase();
  if (["linux"].includes(normalized)) return "linux";
  if (["darwin", "macos"].includes(normalized)) return "macos";
  if (["win32", "windows"].includes(normalized)) return "windows";
  throw new Error(`unsupported operating system: ${value}`);
}

function measureVsCodeIndex() {
  const root = "/workspace";
  const paths = Array.from(
    { length: MAX_PATHS },
    (_, index) =>
      `${root}/src/pkg${String(index % 100).padStart(3, "0")}/file${String(index).padStart(5, "0")}.ts`,
  );
  const index = new WorkspaceMentionIndex({ roots: [root], trusted: true });
  assert.equal(index.replacePaths(paths), MAX_PATHS);
  const displaced = paths[paths.length - 1];
  assert.equal(index.removePath(displaced), true);
  assert.equal(index.upsertPath(`${root}/src/live-created.ts`), true);
  assert.equal(index.removePath(`${root}/src/live-created.ts`), true);
  assert.equal(index.upsertPath(displaced), true);
  assert.equal(index.upsertPath("/outside/private.txt"), false);
  assert.equal(index.upsertPath(`${root}/.git/config`), false);

  const symbolTicket = index.beginQuery();
  assert.equal(
    index.replaceSymbols(symbolTicket, [
      {
        name: "NeedleSymbol",
        kindLabel: "class",
        location: { uri: { fsPath: `${root}/src/pkg042/file00042.ts` } },
      },
      {
        name: "OutsideSymbol",
        kindLabel: "class",
        location: { uri: { fsPath: "/outside/private.txt" } },
      },
    ]),
    true,
  );
  const symbolResult = index.query(symbolTicket, "needlesymbol");
  assert.equal(index.commit(symbolTicket, symbolResult), true);
  assert.ok(
    symbolResult.items.some(
      (item) => item?.value === "src/pkg042/file00042.ts",
    ),
  );

  const samplesMs = [];
  let maxCandidates = 0;
  for (let query = 0; query < QUERY_COUNT; query++) {
    const ticket = index.beginQuery();
    const started = performance.now();
    const result = index.query(
      ticket,
      query % 2 === 0
        ? `file${query}`
        : `pkg${String(query % 100).padStart(3, "0")}`,
    );
    samplesMs.push(performance.now() - started);
    assert.equal(index.commit(ticket, result), true);
    maxCandidates = Math.max(maxCandidates, result.items.length);
    assert.ok(result.items.length <= MAX_CANDIDATES);
  }

  const rapid = [];
  for (let query = 0; query < QUERY_COUNT; query++) {
    const ticket = index.beginQuery();
    rapid.push(
      Promise.resolve().then(() => ({
        ticket,
        result: index.query(ticket, `file${query}`),
      })),
    );
  }
  return Promise.all(rapid).then((rapidResults) => {
    const committed = rapidResults.filter(
      ({ ticket, result }) => !result.cancelled && index.commit(ticket, result),
    );
    assert.equal(committed.length, 1);
    assert.equal(
      committed[0].ticket.generation,
      rapidResults[QUERY_COUNT - 1].ticket.generation,
    );
    const untrusted = new WorkspaceMentionIndex({
      roots: [root],
      trusted: false,
    });
    assert.equal(untrusted.replacePaths(paths), 0);
    const untrustedTicket = untrusted.beginQuery();
    assert.deepEqual(untrusted.query(untrustedTicket, "file").items, []);

    const snapshot = index.snapshot();
    const p50Ms = percentile(samplesMs, 50);
    const p95Ms = percentile(samplesMs, 95);
    const p99Ms = percentile(samplesMs, 99);
    assert.ok(p95Ms <= P95_LIMIT_MS, `VS Code P95 ${p95Ms}ms`);
    assert.equal(snapshot.pathCount, MAX_PATHS);
    assert.equal(snapshot.staleCommitCount, 0);
    assert.equal(snapshot.leakCount, 0);
    assert.equal(snapshot.contentReadCount, 0);
    return {
      pathCount: snapshot.pathCount,
      consecutiveQueries: QUERY_COUNT,
      rapidQueries: QUERY_COUNT,
      samplesMs,
      p50Ms,
      p95Ms,
      p99Ms,
      maxCandidates,
      workspaceRevision: snapshot.workspaceRevision,
      queryGeneration: snapshot.queryGeneration,
      cancellationCount: snapshot.cancellationCount,
      discardedQueryCount: snapshot.discardedQueryCount,
      deniedPathCount: snapshot.deniedPathCount,
      staleCommitCount: snapshot.staleCommitCount,
      leakCount: snapshot.leakCount,
      contentReadCount: snapshot.contentReadCount,
      symbolObserved: true,
      workspaceTrustEnforced: true,
    };
  });
}

function validateHost(host, expectedHost) {
  assert.equal(host.schema, "chainlesschain.ide-input-performance-host.v1");
  assert.equal(host.host, expectedHost);
  assert.equal(host.measurementSurface, "metadata-only-product-index");
  assert.equal(host.profileVersion, PROFILE_VERSION);
  assert.deepEqual(host.thresholds, THRESHOLDS);
  assert.equal(host.disposition, "required");
  assert.equal(host.outcome, "pass");
  assert.deepEqual(host.testIds, [
    TEST_IDS[expectedHost === "vscode" ? 0 : 1],
  ]);
  const measurement = host.measurements;
  assert.equal(measurement.pathCount, MAX_PATHS);
  assert.equal(measurement.consecutiveQueries, QUERY_COUNT);
  assert.equal(measurement.rapidQueries, QUERY_COUNT);
  assert.equal(measurement.samplesMs.length, QUERY_COUNT);
  assert.ok(
    measurement.samplesMs.every(
      (sample) => Number.isFinite(sample) && sample >= 0,
    ),
  );
  assert.ok(
    Number.isFinite(measurement.p50Ms) &&
      measurement.p50Ms <= measurement.p95Ms &&
      measurement.p95Ms <= measurement.p99Ms,
  );
  assert.ok(measurement.p95Ms <= P95_LIMIT_MS);
  assert.ok(measurement.maxCandidates <= MAX_CANDIDATES);
  assert.equal(measurement.staleCommitCount, 0);
  assert.ok(measurement.cancellationCount >= QUERY_COUNT - 1);
  assert.ok(measurement.discardedQueryCount >= QUERY_COUNT - 1);
  assert.ok(measurement.deniedPathCount >= 2);
  assert.equal(measurement.leakCount, 0);
  assert.equal(measurement.contentReadCount, 0);
  assert.equal(measurement.symbolObserved, true);
  assert.equal(measurement.workspaceTrustEnforced, true);
  return host;
}

async function runProfile({
  headSha,
  jetbrainsEvidence,
  output,
  operatingSystem,
  source,
}) {
  assert.match(headSha || "", SHA_RE);
  for (const field of ["workflowId", "runId", "jobId", "artifactName"]) {
    assert.ok(String(source?.[field] || "").length > 0, `source.${field}`);
  }
  const jetbrains = validateHost(
    JSON.parse(fs.readFileSync(path.resolve(jetbrainsEvidence), "utf8")),
    "jetbrains",
  );
  const vscodeMeasurements = await measureVsCodeIndex();
  const vscode = validateHost(
    {
      schema: "chainlesschain.ide-input-performance-host.v1",
      host: "vscode",
      measurementSurface: "metadata-only-product-index",
      profileVersion: PROFILE_VERSION,
      runtime: { node: process.version },
      thresholds: THRESHOLDS,
      measurements: vscodeMeasurements,
      testIds: [TEST_IDS[0]],
      disposition: "required",
      outcome: "pass",
    },
    "vscode",
  );
  const digests = producerDigests();
  const javaVersion = jetbrains.runtime?.java || "unknown";
  assert.notEqual(javaVersion, "unknown");
  const evidence = {
    schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
    commitmentId: "IDE-INPUT-PERF",
    headSha,
    os: canonicalOs(operatingSystem),
    runtime: {
      name: "node+java",
      version: `${process.version};${javaVersion}`,
      arch: process.arch,
    },
    profileVersion: PROFILE_VERSION,
    thresholds: THRESHOLDS,
    measurements: {
      vscode: vscode.measurements,
      jetbrains: jetbrains.measurements,
    },
    testIds: [...TEST_IDS],
    producerDigests: digests,
    disposition: "required",
    source,
    outcome: "passed",
  };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

function assertExactHead(headSha) {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  assert.equal(actual, headSha);
  for (const sourcePath of SOURCE_PATHS) {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", sourcePath], {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
  }
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...SOURCE_PATHS], {
    cwd: REPOSITORY_ROOT,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertExactHead(options.headSha);
  await runProfile({
    headSha: options.headSha,
    jetbrainsEvidence: options.jetbrainsEvidence,
    output: options.output,
    operatingSystem: options.os || process.platform,
    source: {
      workflowId: options.workflowId || process.env.GITHUB_WORKFLOW_REF,
      runId: options.runId || process.env.GITHUB_RUN_ID,
      jobId: options.jobId || process.env.GITHUB_JOB,
      artifactName: options.artifactName,
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`IDE-INPUT-PERF profile failed (${digest(String(error))})`);
    process.exitCode = 1;
  });
}

export {
  PROFILE_VERSION,
  QUERY_COUNT,
  SOURCE_PATHS,
  TEST_IDS,
  THRESHOLDS,
  canonicalOs,
  measureVsCodeIndex,
  runProfile,
  validateHost,
};
