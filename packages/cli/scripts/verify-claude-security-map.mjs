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
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .toLowerCase();
}

function producerPath(relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.ok(relativePath.length > 0);
  const resolved = path.resolve(REPOSITORY_ROOT, relativePath);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  return resolved;
}

function validateSecurityMap(mapPath = DEFAULT_MAP_PATH) {
  const resolvedMapPath = path.resolve(mapPath);
  const map = readJson(resolvedMapPath);
  assert.equal(map.schema, "chainlesschain.claude-security-map.v1");
  assert.equal(map.profileVersion, 1);
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
    const sourcePath = producerPath(row.producer.path);
    const source = fs.readFileSync(sourcePath);
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
    } else {
      assert.equal(row.reason, undefined, `${row.id}/unexpected reason`);
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
  return {
    map,
    mapPath: resolvedMapPath,
    mapDigest: sha256(fs.readFileSync(resolvedMapPath)),
  };
}

function evidenceProjection(validated, releaseCommit, operatingSystem) {
  return {
    schema: "chainlesschain.claude-security-map-evidence.v1",
    headSha: releaseCommit,
    operatingSystem,
    runtime: {
      node: process.version,
      architecture: process.arch,
    },
    profileVersion: validated.map.profileVersion,
    upstreamRange: validated.map.upstreamRange,
    disposition: "required",
    mapDigest: validated.mapDigest,
    rows: validated.map.rows.map((row) => ({
      id: row.id,
      group: row.group,
      disposition: row.disposition,
      testId: row.testId,
      producerDigest: row.producer.sha256,
      paritySuccess: row.paritySuccess ?? null,
    })),
  };
}

function produceEvidence({
  mapPath = DEFAULT_MAP_PATH,
  releaseCommit,
  output,
  platform = process.platform,
  verifyGitHead = true,
}) {
  const normalizedCommit = String(releaseCommit || "").toLowerCase();
  assert.match(normalizedCommit, SHA_RE);
  if (verifyGitHead) assert.equal(currentHead(), normalizedCommit);
  const validated = validateSecurityMap(mapPath);
  const evidence = evidenceProjection(
    validated,
    normalizedCommit,
    normalizeOperatingSystem(platform),
  );
  if (output) writeJson(path.resolve(output), evidence);
  return evidence;
}

function evidenceFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...evidenceFiles(candidate));
    else if (entry.name.endsWith(".json")) found.push(candidate);
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
  const byOperatingSystem = new Map();
  for (const filePath of evidenceFiles(path.resolve(evidenceDir))) {
    const candidate = readJson(filePath);
    if (candidate.schema !== "chainlesschain.claude-security-map-evidence.v1") {
      continue;
    }
    assert.ok(
      !byOperatingSystem.has(candidate.operatingSystem),
      `duplicate ${candidate.operatingSystem} security-map evidence`,
    );
    byOperatingSystem.set(candidate.operatingSystem, candidate);
  }
  assert.deepEqual([...byOperatingSystem.keys()].sort(), [
    "linux",
    "macos",
    "windows",
  ]);
  for (const operatingSystem of REQUIRED_OPERATING_SYSTEMS) {
    const actual = byOperatingSystem.get(operatingSystem);
    const expected = evidenceProjection(
      validated,
      normalizedCommit,
      operatingSystem,
    );
    assert.deepEqual(actual, expected, `${operatingSystem}/evidence`);
  }
  const aggregate = {
    schema: "chainlesschain.claude-security-map-aggregate.v1",
    headSha: normalizedCommit,
    profileVersion: validated.map.profileVersion,
    upstreamRange: validated.map.upstreamRange,
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    requiredGates: [...REQUIRED_GATES],
    rowCount: validated.map.rows.length,
    producerDigests: Object.fromEntries(
      validated.map.rows.map((row) => [row.id, row.producer.sha256]),
    ),
    producerEvidenceDigests: Object.fromEntries(
      [...byOperatingSystem].map(([operatingSystem, evidence]) => [
        operatingSystem,
        sha256(Buffer.from(JSON.stringify(evidence))),
      ]),
    ),
    disposition: "required",
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
  DEFAULT_MAP_PATH,
  REQUIRED_DELTA_IDS,
  REQUIRED_GATES,
  REQUIRED_GROUPS,
  REQUIRED_OPERATING_SYSTEMS,
  REVERTED_IDS,
  produceEvidence,
  validateSecurityMap,
  verifyEvidenceSet,
};
