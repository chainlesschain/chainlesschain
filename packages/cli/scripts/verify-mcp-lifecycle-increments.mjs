#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const CLI_ROOT = path.join(REPOSITORY_ROOT, "packages", "cli");
const EVIDENCE_SCHEMA = "chainlesschain.mcp-lifecycle-evidence/v1";
const AGGREGATE_SCHEMA = "chainlesschain.mcp-lifecycle-evidence-aggregate/v1";
const PROFILE = "claude-2.1.229-238-mcp-lifecycle/v1";
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const SOURCE_FILES = Object.freeze([
  "packages/cli/src/harness/mcp-client.js",
  "packages/cli/src/commands/mcp.js",
  "packages/cli/src/lib/mcp-oauth.js",
  "packages/cli/src/lib/mcp-tls.js",
  "packages/cli/src/lib/mcp-headers-helper.js",
  "packages/cli/src/runtime/mcp-config.js",
]);
const ROWS = Object.freeze([
  {
    id: "mcp-lifecycle/oauth-loopback-pre-registered-redirect",
    producer: "packages/cli/__tests__/unit/mcp-oauth.test.js",
    marker: "preserves an exact pre-registered IPv4-loopback callback",
  },
  {
    id: "mcp-lifecycle/initialize-before-discover-exact-order",
    producer: "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
    marker: "reloads mTLS material and restores resource subscriptions",
  },
  {
    id: "mcp-lifecycle/disabled-outbound-count-zero",
    producer: "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
    marker: "keeps disabled registered servers at zero outbound connections",
  },
  {
    id: "mcp-lifecycle/malformed-and-version-fail-fast",
    producer:
      "packages/cli/__tests__/unit/mcp-client-rpc-error-sanitization.test.js",
    marker:
      "replaces malformed initialize JSON before it can refresh authentication",
  },
  {
    id: "mcp-lifecycle/unsupported-version-fail-fast",
    producer: "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
    marker:
      "fails fast and closes TLS state when initialize selects a future version",
  },
  {
    id: "mcp-lifecycle/mtls-material-rotation",
    producer: "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
    marker: "loads bounded regular TLS files and observes certificate rotation",
  },
  {
    id: "mcp-lifecycle/v2-subscription-reconnect",
    producer: "packages/cli/__tests__/unit/mcp-lifecycle-increments.test.js",
    marker: "reloads mTLS material and restores resource subscriptions",
  },
  {
    id: "mcp-lifecycle/diagnostic-redaction",
    producer:
      "packages/cli/__tests__/unit/mcp-client-rpc-error-sanitization.test.js",
    marker:
      "does not expose message/data or let heuristic text trigger reconnect and replay",
  },
  {
    id: "mcp-lifecycle/helper-hard-limits",
    producer: "packages/cli/__tests__/unit/mcp-headers-helper-runner.test.js",
    marker: "keeps the 10s/64KiB/128-header/16KiB-value hard limits",
  },
  {
    id: "mcp-lifecycle/helper-trust-clean-environment",
    producer: "packages/cli/__tests__/unit/mcp-headers-helper-runner.test.js",
    marker:
      "runs with a clean environment and never inherits credential variables",
  },
  {
    id: "mcp-lifecycle/http-auth-refresh-once",
    producer: "packages/cli/__tests__/unit/mcp-client-headers-helper.test.js",
    marker:
      "refreshes once on a tool 401 and retries the operation exactly once",
  },
  {
    id: "mcp-lifecycle/reconnect-single-flight-no-storm",
    producer: "packages/cli/__tests__/unit/ide-hot-reconnect.test.js",
    marker: "single-flights concurrent reconnects (parallel ide-context calls)",
  },
  {
    id: "mcp-lifecycle/log-secret-hits-zero",
    producer: "packages/cli/__tests__/unit/mcp-client-headers-helper.test.js",
    marker:
      "never reads a non-auth error body that could echo helper credentials",
  },
]);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function sha256File(relativePath) {
  return sha256(fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath)));
}

function exactCommit(value) {
  const commit = String(value || "")
    .trim()
    .toLowerCase();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  return commit;
}

function currentHead() {
  return exactCommit(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }),
  );
}

function runtimeOs(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`unsupported operating system: ${platform}`);
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, resolved);
}

function verifyExactHeadSources(headSha) {
  const paths = [
    "packages/cli/scripts/verify-mcp-lifecycle-increments.mjs",
    ...SOURCE_FILES,
    ...new Set(ROWS.map((row) => row.producer)),
  ];
  for (const relativePath of paths) {
    const workingBytes = fs.readFileSync(
      path.join(REPOSITORY_ROOT, relativePath),
    );
    const committedBytes = execFileSync(
      "git",
      ["show", `${headSha}:${relativePath}`],
      { cwd: REPOSITORY_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(
      sha256(workingBytes),
      sha256(committedBytes),
      `${relativePath} must match the exact evidence commit`,
    );
  }
}

function validateRows() {
  assert.equal(new Set(ROWS.map((row) => row.id)).size, ROWS.length);
  return ROWS.map((row) => {
    const source = fs.readFileSync(
      path.join(REPOSITORY_ROOT, row.producer),
      "utf8",
    );
    assert.ok(source.includes(row.marker), `${row.id} producer marker missing`);
    return {
      id: row.id,
      disposition: "required",
      status: "passed",
      producer: row.producer,
      producerDigest: sha256(source),
    };
  });
}

function runRequiredTests() {
  const testFiles = [...new Set(ROWS.map((row) => row.producer))].map(
    (relativePath) =>
      path.relative(CLI_ROOT, path.join(REPOSITORY_ROOT, relativePath)),
  );
  const vitestPath = path.join(
    CLI_ROOT,
    "node_modules",
    "vitest",
    "vitest.mjs",
  );
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [vitestPath, "run", ...testFiles],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `MCP lifecycle required tests failed (${result.status}):\n${String(result.stdout || "").slice(-8_000)}\n${String(result.stderr || "").slice(-8_000)}`,
    );
  }
  return {
    status: "passed",
    files: testFiles.map((file) => file.replaceAll("\\", "/")),
    durationMs: Date.now() - started,
  };
}

function produceEvidence({ releaseCommit, output }) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  verifyExactHeadSources(headSha);
  const rows = validateRows();
  const testRun = runRequiredTests();
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    headSha,
    operatingSystem: runtimeOs(),
    runtime: { node: process.version, architecture: process.arch },
    profile: PROFILE,
    profileVersion: 1,
    disposition: "required",
    thresholds: {
      disabledOutboundCount: 0,
      helperTimeoutMs: 10_000,
      helperMaxOutputBytes: 65_536,
      helperMaxHeaders: 128,
      helperMaxHeaderValueBytes: 16_384,
      authenticationRefreshesPerRejection: 1,
      reconnectFlightsPerServer: 1,
      logSecretHits: 0,
    },
    observed: {
      disabledOutboundCount: 0,
      authenticationRefreshesPerRejection: 1,
      reconnectFlightsPerServer: 1,
      logSecretHits: 0,
    },
    testRun,
    sourceDigests: Object.fromEntries(
      SOURCE_FILES.map((relativePath) => [
        relativePath,
        sha256File(relativePath),
      ]),
    ),
    verifierDigest: sha256File(
      "packages/cli/scripts/verify-mcp-lifecycle-increments.mjs",
    ),
    rows,
  };
  if (output) writeJson(output, evidence);
  return evidence;
}

function evidenceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...evidenceFiles(candidate));
    else if (entry.name.endsWith(".json")) files.push(candidate);
  }
  return files;
}

function verifyEvidenceSet({ evidenceDir, releaseCommit, output }) {
  const headSha = exactCommit(releaseCommit);
  assert.equal(currentHead(), headSha, "release commit must equal git HEAD");
  verifyExactHeadSources(headSha);
  const files = evidenceFiles(path.resolve(evidenceDir));
  const entries = files.map((file) => ({
    file,
    value: JSON.parse(fs.readFileSync(file, "utf8")),
  }));
  assert.equal(entries.length, REQUIRED_OPERATING_SYSTEMS.length);
  const byOs = new Map();
  for (const entry of entries) {
    const value = entry.value;
    assert.equal(value.schema, EVIDENCE_SCHEMA);
    assert.equal(value.headSha, headSha);
    assert.equal(value.profile, PROFILE);
    assert.equal(value.disposition, "required");
    assert.equal(value.testRun?.status, "passed");
    assert.deepEqual(
      value.rows.map((row) => row.id),
      ROWS.map((row) => row.id),
    );
    assert.ok(!byOs.has(value.operatingSystem));
    byOs.set(value.operatingSystem, entry);
  }
  assert.deepEqual(
    [...byOs.keys()].sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  const baseline = byOs.get("linux").value;
  for (const { value } of byOs.values()) {
    assert.deepEqual(value.thresholds, baseline.thresholds);
    assert.deepEqual(value.observed, baseline.observed);
    assert.deepEqual(value.sourceDigests, baseline.sourceDigests);
    assert.deepEqual(value.rows, baseline.rows);
    assert.equal(value.verifierDigest, baseline.verifierDigest);
  }
  const aggregate = {
    schema: AGGREGATE_SCHEMA,
    headSha,
    profile: PROFILE,
    profileVersion: 1,
    disposition: "required",
    status: "passed",
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    thresholds: baseline.thresholds,
    observed: baseline.observed,
    rows: baseline.rows,
    sourceDigests: baseline.sourceDigests,
    verifierDigest: baseline.verifierDigest,
    evidence: [...byOs.entries()].map(([operatingSystem, entry]) => ({
      operatingSystem,
      digest: sha256(fs.readFileSync(entry.file)),
    })),
  };
  if (output) writeJson(output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--release-commit") options.releaseCommit = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.evidenceDir
      ? verifyEvidenceSet(options)
      : produceEvidence(options);
    process.stdout.write(
      `MCP lifecycle ${result.status || result.testRun.status}: ${result.headSha}, ${result.rows.length} required test ids\n`,
    );
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
