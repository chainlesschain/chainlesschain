#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DEFAULT_MAP_PATH = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "claude-2.1.221-238-security-map.json",
);
const COMMITMENT_ID = "SEC-DELTA";
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const PROFILE_VERSION = "sec-delta-v2";
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const JOB_ID_RE = /^[A-Za-z0-9_.-]+$/u;
const FRAGMENT_KEYS = Object.freeze([
  "commitmentId",
  "disposition",
  "headSha",
  "measurements",
  "os",
  "outcome",
  "producerDigests",
  "profileVersion",
  "runtime",
  "schema",
  "source",
  "testIds",
  "thresholds",
]);
const MEASUREMENT_KEYS = Object.freeze([
  "failedMappedRows",
  "mappedRows",
  "missingMappedRows",
  "passedMappedRows",
  "reportDurationMs",
  "reportFailedTests",
  "reportPassedTests",
  "requiredGroupCount",
  "testReportDigest",
  "upstreamRevertedParitySuccess",
  "upstreamRevertedRows",
]);
const ALLOWED_DISPOSITIONS = new Set([
  "existing-test",
  "new-test",
  "not-applicable+reason",
  "upstream-reverted",
]);
const REQUIRED_GROUPS = Object.freeze([
  "shell/path",
  "trust/authority",
  "sandbox/worktree/socket",
  "approval/redaction",
  "upstream-rollback",
]);
const REQUIRED_GATES = Object.freeze([
  "CLI CI",
  "CLI Strict Sandbox",
  "IDE Roadmap Safety Matrix",
]);
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const REQUIRED_DELTA_IDS = Object.freeze([
  "cc-2.1.221-credential-file-mask",
  "cc-2.1.221-zsh-conditional-permission",
  "cc-2.1.221-powershell-quoted-path",
  "cc-2.1.221-powershell-variable-write",
  "cc-2.1.222-destructive-git-worktree",
  "cc-2.1.222-pretooluse-restriction-ceiling",
  "cc-2.1.222-raw-git-blob-diff",
  "cc-2.1.222-repo-config-remote-control",
  "cc-2.1.223-invisible-unicode-approval",
  "cc-2.1.223-workflow-dynamic-import-bash",
  "cc-2.1.223-agent-org-policy-ceiling",
  "cc-2.1.223-notification-hook-authority",
  "cc-2.1.224-jwt-aws-redaction",
  "cc-2.1.225-nested-repo-trust",
  "cc-2.1.227-allowed-non-write-users",
  "cc-2.1.228-synced-skill-trust",
  "cc-2.1.228-remote-resume-history-isolation",
  "cc-2.1.229-self-hosted-server-hooks",
  "cc-2.1.232-sandbox-binary-ripgrep-scope",
  "cc-2.1.232-shared-temp-socket-authority",
  "cc-2.1.233-cygwin-symlink-permission",
  "cc-2.1.233-input-redirection-permission",
  "cc-2.1.234-windows-nt-namespace",
  "cc-2.1.234-deny-path-trailing-slash",
  "cc-2.1.234-ide-diff-reprompt",
  "cc-2.1.234-mid-turn-permission-fence",
  "cc-2.1.234-mcp-diagnostic-redaction",
  "cc-2.1.234-approval-target-display",
  "cc-2.1.235-permission-comment-grant-display",
  "cc-2.1.236-macos-wildcard-deny-precedence",
  "cc-2.1.236-git-status-monitor-rules",
  "cc-2.1.238-helper-trust-environment",
]);
const REVERTED_IDS = new Set([
  "cc-2.1.233-cygwin-symlink-permission",
  "cc-2.1.233-input-redirection-permission",
]);
const THRESHOLDS = Object.freeze({
  failedMappedRowsMax: 0,
  mappedRowsMin: REQUIRED_DELTA_IDS.length,
  missingMappedRowsMax: 0,
  reportFailedTestsMax: 0,
  requiredGroupCountMin: REQUIRED_GROUPS.length,
  upstreamRevertedParitySuccessMax: 0,
});
export const EVIDENCE_PRODUCER_PATHS = Object.freeze([
  ".github/workflows/cli-ci.yml",
  ".github/workflows/cli-strict-sandbox.yml",
  ".github/workflows/ide-roadmap-safety.yml",
  "packages/cli/scripts/run-claude-security-map-tests.mjs",
  "packages/cli/scripts/verify-claude-security-map.mjs",
  "tests/fixtures/claude-2.1.221-238-security-map.json",
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

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJsonBytes(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeOperatingSystem(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`unsupported operating system: ${platform}`);
}

function currentHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .toLowerCase();
}

function producerPath(relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.ok(relativePath.length > 0);
  assert.equal(relativePath, relativePath.replaceAll("\\", "/"));
  const resolved = path.resolve(REPOSITORY_ROOT, relativePath);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  return resolved;
}

function gitBlobDigest(headSha, relativePath) {
  const bytes = execFileSync(
    "git",
    ["cat-file", "blob", `${headSha}:${relativePath}`],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return sha256(bytes);
}

function sourceDigest(relativePath, headSha, verifyGitHead) {
  const bytes = fs.readFileSync(producerPath(relativePath));
  const digest = sha256(bytes);
  if (verifyGitHead) {
    assert.equal(
      gitBlobDigest(headSha, relativePath),
      digest,
      `${relativePath}/Git blob`,
    );
  }
  return digest;
}

function validateSecurityMap(mapPath = DEFAULT_MAP_PATH) {
  const resolvedMapPath = path.resolve(mapPath);
  const { bytes, value: map } = readJsonBytes(resolvedMapPath);
  assert.equal(map.schema, "chainlesschain.claude-security-map.v1");
  assert.equal(map.profileVersion, 2);
  assert.deepEqual(map.upstreamRange, { from: "2.1.221", to: "2.1.238" });
  assert.deepEqual(map.requiredGates, REQUIRED_GATES);
  assert.deepEqual(map.requiredOperatingSystems, REQUIRED_OPERATING_SYSTEMS);
  assert.ok(Array.isArray(map.rows));
  assert.deepEqual(
    map.rows.map((row) => row.id).sort(),
    [...REQUIRED_DELTA_IDS].sort(),
  );
  assert.deepEqual(
    [...new Set(map.rows.map((row) => row.group))].sort(),
    [...REQUIRED_GROUPS].sort(),
  );

  for (const row of map.rows) {
    assert.ok(
      ALLOWED_DISPOSITIONS.has(row.disposition),
      `${row.id}/disposition`,
    );
    assert.match(row.upstreamVersion || "", /^2\.1\.2(?:2[1-9]|3[0-8])$/u);
    assert.equal(typeof row.upstreamFix, "string");
    assert.ok(row.upstreamFix.length >= 12, `${row.id}/upstreamFix`);
    assert.equal(typeof row.testId, "string");
    assert.ok(row.testId.length >= 8, `${row.id}/testId`);
    assert.equal(typeof row.producer?.path, "string");
    assert.match(row.producer?.sha256 || "", DIGEST_RE);
    const source = fs.readFileSync(producerPath(row.producer.path));
    assert.equal(
      sha256(source),
      row.producer.sha256,
      `${row.id}/producer digest`,
    );
    assert.ok(
      source.toString("utf8").includes(row.testId),
      `${row.id}/test id missing from producer`,
    );
    assert.deepEqual(row.gates, REQUIRED_GATES, `${row.id}/gates`);
    assert.deepEqual(
      row.operatingSystems,
      REQUIRED_OPERATING_SYSTEMS,
      `${row.id}/operatingSystems`,
    );
    if (row.disposition === "not-applicable+reason") {
      assert.equal(typeof row.reason, "string", `${row.id}/reason`);
      assert.ok(row.reason.length >= 24, `${row.id}/reason`);
      assert.equal(
        typeof row.productBoundary,
        "string",
        `${row.id}/productBoundary`,
      );
      assert.ok(row.productBoundary.length >= 12, `${row.id}/productBoundary`);
      assert.notEqual(
        row.testId,
        "requires reasons for non-applicable rows and rejects stale producer digests",
        `${row.id}/placeholder test`,
      );
    } else {
      assert.equal(row.reason, undefined, `${row.id}/unexpected reason`);
      assert.equal(
        row.productBoundary,
        undefined,
        `${row.id}/unexpected productBoundary`,
      );
    }
    if (REVERTED_IDS.has(row.id)) {
      assert.equal(row.disposition, "upstream-reverted", `${row.id}/rollback`);
      assert.equal(row.revertedBy, "2.1.233", `${row.id}/revertedBy`);
      assert.equal(row.paritySuccess, false, `${row.id}/paritySuccess`);
    } else {
      assert.notEqual(
        row.disposition,
        "upstream-reverted",
        `${row.id}/rollback`,
      );
      assert.equal(row.paritySuccess, undefined, `${row.id}/paritySuccess`);
    }
  }
  return { map, mapPath: resolvedMapPath, mapDigest: sha256(bytes) };
}

function canonicalTestPath(value) {
  const resolved = path.resolve(String(value || ""));
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function evaluateMappedReport(validated, testReportPath) {
  assert.equal(typeof testReportPath, "string");
  const resolved = path.resolve(testReportPath);
  const { bytes, value: report } = readJsonBytes(resolved);
  assert.ok(
    Array.isArray(report.testResults),
    "Vitest report is missing testResults",
  );
  const files = new Map(
    report.testResults.map((result) => [
      canonicalTestPath(result.name),
      result,
    ]),
  );
  const rows = validated.map.rows.map((row) => {
    const result = files.get(
      canonicalTestPath(producerPath(row.producer.path)),
    );
    const matches = (result?.assertionResults || []).filter(
      (assertion) => assertion.title === row.testId,
    );
    const passed =
      matches.length > 0 && matches.every((match) => match.status === "passed");
    const failed = matches.some((match) => match.status === "failed");
    return { id: row.id, passed, failed, missing: matches.length === 0 };
  });
  const durations = report.testResults.flatMap((result) =>
    (result.assertionResults || []).map(
      (assertion) => Number(assertion.duration) || 0,
    ),
  );
  const measurements = {
    failedMappedRows: rows.filter((row) => row.failed).length,
    mappedRows: rows.length,
    missingMappedRows: rows.filter((row) => row.missing).length,
    passedMappedRows: rows.filter((row) => row.passed).length,
    reportDurationMs: Math.round(
      durations.reduce((sum, value) => sum + value, 0),
    ),
    reportFailedTests: Number(report.numFailedTests) || 0,
    reportPassedTests: Number(report.numPassedTests) || 0,
    requiredGroupCount: new Set(validated.map.rows.map((row) => row.group))
      .size,
    testReportDigest: sha256(bytes),
    upstreamRevertedParitySuccess: validated.map.rows.filter(
      (row) =>
        row.disposition === "upstream-reverted" && row.paritySuccess === true,
    ).length,
    upstreamRevertedRows: validated.map.rows.filter(
      (row) => row.disposition === "upstream-reverted",
    ).length,
  };
  const passed =
    report.success === true &&
    measurements.failedMappedRows <= THRESHOLDS.failedMappedRowsMax &&
    measurements.mappedRows >= THRESHOLDS.mappedRowsMin &&
    measurements.missingMappedRows <= THRESHOLDS.missingMappedRowsMax &&
    measurements.passedMappedRows === measurements.mappedRows &&
    measurements.reportFailedTests <= THRESHOLDS.reportFailedTestsMax &&
    measurements.requiredGroupCount >= THRESHOLDS.requiredGroupCountMin &&
    measurements.upstreamRevertedParitySuccess <=
      THRESHOLDS.upstreamRevertedParitySuccessMax;
  return { measurements, passed };
}

function normalizeSource(source = {}) {
  exactKeys(
    source,
    ["artifactName", "jobId", "runId", "workflowId"],
    "fragment source",
  );
  const normalized = {
    workflowId: String(
      source.workflowId || process.env.GITHUB_WORKFLOW_REF || "",
    ),
    runId: String(source.runId || process.env.GITHUB_RUN_ID || ""),
    jobId: String(source.jobId || process.env.GITHUB_JOB || ""),
    artifactName: String(source.artifactName || ""),
  };
  assert.match(
    normalized.workflowId,
    /^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@[^\s]+$/u,
  );
  assert.match(normalized.runId, /^[1-9][0-9]*$/u);
  assert.match(normalized.jobId, JOB_ID_RE);
  assert.ok(
    normalized.artifactName.length > 0 && normalized.artifactName.length <= 255,
  );
  assert.ok(!/[\\/]/u.test(normalized.artifactName));
  return normalized;
}

function evidenceProducerDigests(validated, headSha, verifyGitHead) {
  const paths = [
    ...new Set([
      ...EVIDENCE_PRODUCER_PATHS,
      ...validated.map.rows.map((row) => row.producer.path),
    ]),
  ].sort();
  return Object.fromEntries(
    paths.map((relativePath) => [
      relativePath,
      sourceDigest(relativePath, headSha, verifyGitHead),
    ]),
  );
}

function produceEvidence({
  mapPath = DEFAULT_MAP_PATH,
  releaseCommit,
  output,
  testReport,
  platform = process.platform,
  disposition,
  source,
  verifyGitHead = true,
}) {
  const normalizedCommit = String(releaseCommit || "").toLowerCase();
  assert.match(normalizedCommit, SHA_RE);
  assert.ok(disposition === "required" || disposition === "advisory");
  if (verifyGitHead) assert.equal(currentHead(), normalizedCommit);
  const validated = validateSecurityMap(mapPath);
  const report = evaluateMappedReport(validated, testReport);
  const fragment = {
    schema: FRAGMENT_SCHEMA,
    commitmentId: COMMITMENT_ID,
    headSha: normalizedCommit,
    os: normalizeOperatingSystem(platform),
    runtime: { name: "node", version: process.version, arch: process.arch },
    profileVersion: PROFILE_VERSION,
    thresholds: { ...THRESHOLDS },
    measurements: report.measurements,
    testIds: [...new Set(validated.map.rows.map((row) => row.testId))].sort(),
    producerDigests: evidenceProducerDigests(
      validated,
      normalizedCommit,
      verifyGitHead,
    ),
    disposition,
    source: normalizeSource(source),
    outcome: report.passed ? "passed" : "failed",
  };
  if (output) writeJson(path.resolve(output), fragment);
  assert.equal(
    fragment.outcome,
    "passed",
    "mapped security test report did not pass",
  );
  return fragment;
}

function exactKeys(value, expected, scope) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), scope);
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    `${scope}/keys`,
  );
}

function validateFragment(fragment, validated, releaseCommit, verifyGitHead) {
  exactKeys(fragment, FRAGMENT_KEYS, "fragment");
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, COMMITMENT_ID);
  assert.equal(fragment.headSha, releaseCommit);
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(fragment.os));
  exactKeys(fragment.runtime, ["arch", "name", "version"], "fragment runtime");
  assert.equal(fragment.runtime.name, "node");
  assert.equal(typeof fragment.runtime.version, "string");
  assert.equal(typeof fragment.runtime.arch, "string");
  assert.equal(fragment.profileVersion, PROFILE_VERSION);
  assert.deepEqual(fragment.thresholds, THRESHOLDS);
  assert.ok(
    fragment.disposition === "required" || fragment.disposition === "advisory",
  );
  assert.ok(fragment.outcome === "passed" || fragment.outcome === "failed");
  if (fragment.disposition === "required") {
    assert.equal(fragment.outcome, "passed");
  }
  normalizeSource(fragment.source);
  const expectedIds = [
    ...new Set(validated.map.rows.map((row) => row.testId)),
  ].sort();
  assert.deepEqual(fragment.testIds, expectedIds);
  assert.deepEqual(
    fragment.producerDigests,
    evidenceProducerDigests(validated, releaseCommit, verifyGitHead),
  );
  const measurement = fragment.measurements || {};
  exactKeys(measurement, MEASUREMENT_KEYS, "fragment measurements");
  assert.match(measurement.testReportDigest || "", DIGEST_RE);
  if (fragment.outcome === "passed") {
    assert.equal(measurement.mappedRows, REQUIRED_DELTA_IDS.length);
    assert.equal(measurement.passedMappedRows, measurement.mappedRows);
    assert.equal(measurement.failedMappedRows, 0);
    assert.equal(measurement.missingMappedRows, 0);
    assert.equal(measurement.reportFailedTests, 0);
    assert.equal(measurement.requiredGroupCount, REQUIRED_GROUPS.length);
    assert.equal(measurement.upstreamRevertedParitySuccess, 0);
  }
  return fragment;
}

function evidenceFiles(directory, state = { count: 0 }) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`evidence symlink rejected: ${candidate}`);
    if (entry.isDirectory()) found.push(...evidenceFiles(candidate, state));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      state.count += 1;
      assert.ok(state.count <= 512, "too many security evidence JSON files");
      assert.ok(
        fs.statSync(candidate).size <= 16 * 1024 * 1024,
        `security evidence file too large: ${candidate}`,
      );
      found.push(candidate);
    }
  }
  return found;
}

function verifyEvidenceSet({
  evidenceDir,
  mapPath = DEFAULT_MAP_PATH,
  releaseCommit,
  output,
  verifyGitHead = true,
}) {
  const normalizedCommit = String(releaseCommit || "").toLowerCase();
  assert.match(normalizedCommit, SHA_RE);
  if (verifyGitHead) assert.equal(currentHead(), normalizedCommit);
  const validated = validateSecurityMap(mapPath);
  const records = [];
  const otherDigests = new Set();
  for (const filePath of evidenceFiles(path.resolve(evidenceDir))) {
    const { bytes, value } = readJsonBytes(filePath);
    if (value?.commitmentId === COMMITMENT_ID) {
      records.push({
        filePath,
        bytes,
        value: validateFragment(
          value,
          validated,
          normalizedCommit,
          verifyGitHead,
        ),
      });
    } else {
      otherDigests.add(sha256(bytes));
    }
  }
  const required = records.filter(
    (record) => record.value.disposition === "required",
  );
  const advisory = records.filter(
    (record) => record.value.disposition === "advisory",
  );
  const byOperatingSystem = new Map();
  for (const record of required) {
    assert.ok(
      record.value.source.workflowId.includes(
        "/.github/workflows/ide-roadmap-safety.yml@",
      ),
      `${record.value.os}/required source`,
    );
    assert.ok(
      !byOperatingSystem.has(record.value.os),
      `duplicate ${record.value.os} required SEC-DELTA evidence`,
    );
    assert.ok(
      otherDigests.has(record.value.measurements.testReportDigest),
      `${record.value.os}/test report artifact missing`,
    );
    byOperatingSystem.set(record.value.os, record);
  }
  assert.deepEqual(
    [...byOperatingSystem.keys()].sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  assert.equal(
    new Set(required.map((record) => record.value.profileVersion)).size,
    1,
  );
  assert.equal(
    new Set(required.map((record) => JSON.stringify(record.value.thresholds)))
      .size,
    1,
  );
  const aggregate = {
    schema: "chainlesschain.claude-security-map-aggregate.v2",
    commitmentId: COMMITMENT_ID,
    headSha: normalizedCommit,
    profileVersion: PROFILE_VERSION,
    thresholds: { ...THRESHOLDS },
    requiredOperatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    requiredFragmentDigests: Object.fromEntries(
      required
        .sort((left, right) => left.value.os.localeCompare(right.value.os))
        .map((record) => [record.value.os, sha256(record.bytes)]),
    ),
    advisoryFragmentCount: advisory.length,
    failedAdvisoryFragmentCount: advisory.filter(
      (record) => record.value.outcome === "failed",
    ).length,
    requiredFragmentCount: required.length,
    result: "passed",
  };
  if (output) writeJson(path.resolve(output), aggregate);
  return aggregate;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.verifyEvidenceDir) {
    verifyEvidenceSet({
      evidenceDir: options.verifyEvidenceDir,
      mapPath: options.map,
      releaseCommit: options.releaseCommit,
      output: options.output,
    });
    return;
  }
  produceEvidence({
    mapPath: options.map,
    releaseCommit: options.releaseCommit,
    output: options.output,
    testReport: options.testReport,
    disposition: options.disposition,
    source: {
      workflowId: options.workflowId,
      runId: options.runId,
      jobId: options.jobId,
      artifactName: options.artifactName,
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `security map verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}

export {
  ALLOWED_DISPOSITIONS,
  COMMITMENT_ID,
  DEFAULT_MAP_PATH,
  FRAGMENT_SCHEMA,
  PROFILE_VERSION,
  REQUIRED_DELTA_IDS,
  REQUIRED_GATES,
  REQUIRED_GROUPS,
  REQUIRED_OPERATING_SYSTEMS,
  REVERTED_IDS,
  THRESHOLDS,
  produceEvidence,
  validateSecurityMap,
  verifyEvidenceSet,
};
