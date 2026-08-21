#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DEFAULT_CONTRACT_PATH = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "claude-code-increment-audit-contract.json",
);

const CONTRACT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-contract.v1";
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const MANIFEST_SCHEMA =
  "chainlesschain.claude-code-increment-audit-manifest.v1";
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,299}$/u;
const RUNTIME_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,299}$/u;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const RUN_ID_RE = /^[1-9][0-9]{0,31}$/u;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 100_000;
const MAX_DISCOVERED_FILES = 50_000;
const MAX_PRODUCER_BYTES = 128 * 1024 * 1024;

const REQUIRED_COMMITMENTS = Object.freeze([
  "RC-DEFAULT",
  "SEC-DELTA",
  "XSESSION",
  "AX-TRANSCRIPT",
  "SESSION-UX",
  "DIAG-SCALE",
  "IDE-INPUT-PERF",
  "MCP-LIFECYCLE",
  "SESSION-RUNTIME",
  "PLUGIN-SOURCE",
  "LOCATION-DRAIN",
  "BROWSER-EVIDENCE",
]);
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const DISPOSITIONS = new Set(["required", "advisory"]);
const OUTCOMES = new Set(["passed", "failed"]);
const DANGEROUS_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const CONTRACT_KEYS = Object.freeze([
  "contractVersion",
  "lockedProfiles",
  "profilePolicy",
  "requiredCommitments",
  "requiredDisposition",
  "requiredOperatingSystems",
  "requiredOutcome",
  "schema",
  "sourcePolicy",
]);
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
const MANIFEST_KEYS = Object.freeze([
  "advisoryRows",
  "artifactName",
  "contract",
  "headSha",
  "requiredCommitments",
  "requiredOperatingSystems",
  "requiredRows",
  "result",
  "schema",
  "summary",
]);
const ROW_KEYS = Object.freeze([
  "commitmentId",
  "disposition",
  "fragmentDigest",
  "fragmentFile",
  "headSha",
  "measurements",
  "os",
  "outcome",
  "producerDigests",
  "profileVersion",
  "runtime",
  "source",
  "testIds",
  "thresholds",
]);

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertPlainObject(value, scope) {
  if (!isPlainObject(value)) fail(`${scope} must be a JSON object`);
}

function assertExactKeys(value, expectedKeys, scope) {
  assertPlainObject(value, scope);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${scope} keys must be exactly ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
}

function assertSafeText(value, scope, { maxLength = 512 } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${scope} must be a non-empty string`);
  }
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${scope} contains an invalid control character or is too long`);
  }
  return value;
}

function assertToken(value, scope) {
  assertSafeText(value, scope, { maxLength: 300 });
  if (!TOKEN_RE.test(value)) fail(`${scope} is not a safe identifier`);
  return value;
}

function assertJsonTree(value, scope) {
  let nodes = 0;
  function visit(candidate, depth, location) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail(`${scope} exceeds the JSON node limit`);
    if (depth > MAX_JSON_DEPTH) fail(`${scope} exceeds the JSON depth limit`);
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      if (typeof candidate === "string") {
        assertSafeText(candidate, location, { maxLength: 64 * 1024 });
      }
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) fail(`${location} must be finite`);
      return;
    }
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        visit(candidate[index], depth + 1, `${location}[${index}]`);
      }
      return;
    }
    assertPlainObject(candidate, location);
    for (const [key, nested] of Object.entries(candidate)) {
      assertSafeText(key, `${location} key`, { maxLength: 300 });
      if (DANGEROUS_JSON_KEYS.has(key)) {
        fail(`${location} contains forbidden key ${key}`);
      }
      visit(nested, depth + 1, `${location}.${key}`);
    }
  }
  visit(value, 0, scope);
}

function readJsonBytes(filePath, scope = filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${scope} must be a regular file`);
  }
  if (stat.size > MAX_JSON_BYTES) fail(`${scope} exceeds the JSON byte limit`);
  const bytes = fs.readFileSync(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${scope} is not valid JSON: ${error.message}`);
  }
  assertJsonTree(value, scope);
  return { bytes, value };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function validateLockedProfile(profile, scope) {
  assertExactKeys(profile, ["profileVersion", "thresholds"], scope);
  assertToken(profile.profileVersion, `${scope}.profileVersion`);
  assertPlainObject(profile.thresholds, `${scope}.thresholds`);
  if (Object.keys(profile.thresholds).length === 0) {
    fail(`${scope}.thresholds must not be empty`);
  }
  assertJsonTree(profile.thresholds, `${scope}.thresholds`);
}

function validateContract(contract) {
  assertExactKeys(contract, CONTRACT_KEYS, "audit contract");
  if (contract.schema !== CONTRACT_SCHEMA) {
    fail(`audit contract schema must be ${CONTRACT_SCHEMA}`);
  }
  assertToken(contract.contractVersion, "audit contract contractVersion");
  if (!deepEqual(contract.requiredCommitments, REQUIRED_COMMITMENTS)) {
    fail("audit contract must enumerate all 12 commitments in canonical order");
  }
  if (
    !deepEqual(contract.requiredOperatingSystems, REQUIRED_OPERATING_SYSTEMS)
  ) {
    fail("audit contract must require linux, macos, and windows");
  }
  if (contract.requiredDisposition !== "required") {
    fail("audit contract requiredDisposition must be required");
  }
  if (contract.requiredOutcome !== "passed") {
    fail("audit contract requiredOutcome must be passed");
  }
  assertExactKeys(
    contract.profilePolicy,
    [
      "requireSameProfileVersionAcrossOperatingSystems",
      "requireSameThresholdsAcrossOperatingSystems",
    ],
    "audit contract profilePolicy",
  );
  if (
    contract.profilePolicy.requireSameProfileVersionAcrossOperatingSystems !==
      true ||
    contract.profilePolicy.requireSameThresholdsAcrossOperatingSystems !== true
  ) {
    fail("audit contract cannot relax cross-OS profile or threshold equality");
  }
  assertExactKeys(
    contract.sourcePolicy,
    ["requireGitHubActions"],
    "audit contract sourcePolicy",
  );
  if (contract.sourcePolicy.requireGitHubActions !== true) {
    fail("audit contract cannot allow local required evidence");
  }
  assertPlainObject(contract.lockedProfiles, "audit contract lockedProfiles");
  for (const [commitmentId, profile] of Object.entries(
    contract.lockedProfiles,
  )) {
    if (!REQUIRED_COMMITMENTS.includes(commitmentId)) {
      fail(`audit contract locks unknown commitment ${commitmentId}`);
    }
    validateLockedProfile(profile, `locked profile ${commitmentId}`);
  }
  return contract;
}

function loadContract(contractPath = DEFAULT_CONTRACT_PATH) {
  const resolved = path.resolve(contractPath);
  const { bytes, value } = readJsonBytes(resolved, "audit contract");
  return {
    path: resolved,
    bytes,
    digest: sha256(bytes),
    value: validateContract(value),
  };
}

function normalizeProducerPath(relativePath, scope) {
  assertSafeText(relativePath, scope, { maxLength: 500 });
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    fail(`${scope} must be a repository-relative POSIX path`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (
    normalized !== relativePath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith(".git/") ||
    normalized.includes("/../")
  ) {
    fail(`${scope} escapes or aliases the repository root`);
  }
  return normalized;
}

function normalizeRuntime(runtime, scope) {
  assertExactKeys(runtime, ["arch", "name", "version"], scope);
  const name = assertSafeText(runtime.name, `${scope}.name`, {
    maxLength: 300,
  });
  if (!RUNTIME_NAME_RE.test(name)) {
    fail(`${scope}.name is not a safe runtime identifier`);
  }
  return {
    name,
    version: assertSafeText(runtime.version, `${scope}.version`, {
      maxLength: 300,
    }),
    arch: assertToken(runtime.arch, `${scope}.arch`),
  };
}

function normalizeSource(source, scope, requireGitHubActions) {
  assertExactKeys(
    source,
    ["artifactName", "jobId", "runId", "workflowId"],
    scope,
  );
  const workflowId = assertSafeText(source.workflowId, `${scope}.workflowId`, {
    maxLength: 512,
  });
  const runId = assertSafeText(source.runId, `${scope}.runId`, {
    maxLength: 32,
  });
  const jobId = assertSafeText(source.jobId, `${scope}.jobId`, {
    maxLength: 128,
  });
  const artifactName = assertSafeText(
    source.artifactName,
    `${scope}.artifactName`,
    { maxLength: 255 },
  );
  if (/[\\/]/u.test(artifactName)) {
    fail(`${scope}.artifactName cannot contain a path separator`);
  }
  if (!JOB_ID_RE.test(jobId)) fail(`${scope}.jobId is invalid`);
  if (requireGitHubActions) {
    if (!RUN_ID_RE.test(runId)) fail(`${scope}.runId must be a GitHub run id`);
    if (
      !/^[^\s]+\/\.github\/workflows\/[^@\s]+\.ya?ml@(?:refs\/[^\s]+|[a-f0-9]{40})$/u.test(
        workflowId,
      )
    ) {
      fail(`${scope}.workflowId must be a GitHub workflow ref`);
    }
    for (const [field, value] of Object.entries({
      workflowId,
      jobId,
      artifactName,
    })) {
      if (value.toLowerCase() === "local") {
        fail(`${scope}.${field} cannot use local provenance`);
      }
    }
  }
  return { workflowId, runId, jobId, artifactName };
}

function normalizeFragment(fragment, contract, scope = "audit fragment") {
  assertExactKeys(fragment, FRAGMENT_KEYS, scope);
  if (fragment.schema !== FRAGMENT_SCHEMA) {
    fail(`${scope}.schema must be ${FRAGMENT_SCHEMA}`);
  }
  if (!REQUIRED_COMMITMENTS.includes(fragment.commitmentId)) {
    fail(`${scope}.commitmentId is not one of the 12 commitments`);
  }
  if (!SHA_RE.test(fragment.headSha || "")) {
    fail(`${scope}.headSha must be a lowercase 40-character SHA`);
  }
  if (!REQUIRED_OPERATING_SYSTEMS.includes(fragment.os)) {
    fail(`${scope}.os must be linux, macos, or windows`);
  }
  if (!DISPOSITIONS.has(fragment.disposition)) {
    fail(`${scope}.disposition must be required or advisory`);
  }
  if (!OUTCOMES.has(fragment.outcome)) {
    fail(`${scope}.outcome must be passed or failed`);
  }
  const runtime = normalizeRuntime(fragment.runtime, `${scope}.runtime`);
  const profileVersion = assertToken(
    fragment.profileVersion,
    `${scope}.profileVersion`,
  );
  assertPlainObject(fragment.thresholds, `${scope}.thresholds`);
  assertPlainObject(fragment.measurements, `${scope}.measurements`);
  if (Object.keys(fragment.thresholds).length === 0) {
    fail(`${scope}.thresholds must not be empty`);
  }
  if (Object.keys(fragment.measurements).length === 0) {
    fail(`${scope}.measurements must not be empty`);
  }
  assertJsonTree(fragment.thresholds, `${scope}.thresholds`);
  assertJsonTree(fragment.measurements, `${scope}.measurements`);
  if (!Array.isArray(fragment.testIds) || fragment.testIds.length === 0) {
    fail(`${scope}.testIds must be a non-empty array`);
  }
  const testIds = fragment.testIds.map((testId, index) =>
    assertSafeText(testId, `${scope}.testIds[${index}]`, { maxLength: 500 }),
  );
  if (new Set(testIds).size !== testIds.length) {
    fail(`${scope}.testIds must not contain duplicates`);
  }
  assertPlainObject(fragment.producerDigests, `${scope}.producerDigests`);
  const producerEntries = Object.entries(fragment.producerDigests);
  if (producerEntries.length === 0) {
    fail(`${scope}.producerDigests must not be empty`);
  }
  const producerDigests = {};
  for (const [producerPath, producerDigest] of producerEntries.sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const normalizedPath = normalizeProducerPath(
      producerPath,
      `${scope}.producerDigests key`,
    );
    if (!DIGEST_RE.test(producerDigest || "")) {
      fail(`${scope}.producerDigests.${normalizedPath} is not sha256`);
    }
    producerDigests[normalizedPath] = producerDigest;
  }
  const source = normalizeSource(
    fragment.source,
    `${scope}.source`,
    contract.sourcePolicy.requireGitHubActions,
  );
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId: fragment.commitmentId,
    headSha: fragment.headSha,
    os: fragment.os,
    runtime,
    profileVersion,
    thresholds: fragment.thresholds,
    measurements: fragment.measurements,
    testIds,
    producerDigests,
    disposition: fragment.disposition,
    source,
    outcome: fragment.outcome,
  };
}

function currentHead(repositoryRoot = REPOSITORY_ROOT) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .toLowerCase();
}

function assertExactHead(releaseCommit, repositoryRoot, verifyGitHead) {
  const normalized = String(releaseCommit || "").toLowerCase();
  if (!SHA_RE.test(normalized)) {
    fail("releaseCommit must be a lowercase 40-character SHA");
  }
  if (verifyGitHead && currentHead(repositoryRoot) !== normalized) {
    fail("releaseCommit does not match the checked-out Git HEAD");
  }
  return normalized;
}

function readProducerAtCommit(repositoryRoot, releaseCommit, producerPath) {
  const objectName = `${releaseCommit}:${producerPath}`;
  let objectType;
  try {
    objectType = execFileSync("git", ["cat-file", "-t", objectName], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail(`producer ${producerPath} is absent from exact head ${releaseCommit}`);
  }
  if (objectType !== "blob") {
    fail(
      `producer ${producerPath} is not a file at exact head ${releaseCommit}`,
    );
  }
  try {
    return execFileSync("git", ["cat-file", "blob", objectName], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: MAX_PRODUCER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(`cannot read producer ${producerPath}: ${error.message}`);
  }
}

function verifyProducerDigests(
  fragment,
  { repositoryRoot, releaseCommit, producerCache },
) {
  for (const [producerPath, expectedDigest] of Object.entries(
    fragment.producerDigests,
  )) {
    const cacheKey = `${releaseCommit}:${producerPath}`;
    let actualDigest = producerCache.get(cacheKey);
    if (!actualDigest) {
      actualDigest = sha256(
        readProducerAtCommit(repositoryRoot, releaseCommit, producerPath),
      );
      producerCache.set(cacheKey, actualDigest);
    }
    if (actualDigest !== expectedDigest) {
      fail(
        `${fragment.commitmentId}/${fragment.os} producer digest drift for ${producerPath}`,
      );
    }
  }
}

function discoverJsonFiles(rootDirectory) {
  const root = path.resolve(rootDirectory);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    fail("fragments directory must exist and be a directory");
  }
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        fail(`evidence tree contains symbolic link ${candidate}`);
      }
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile()) {
        found.push(candidate);
        if (found.length > MAX_DISCOVERED_FILES) {
          fail("evidence tree exceeds the file-count limit");
        }
      }
    }
  }
  return found
    .filter((filePath) => filePath.toLowerCase().endsWith(".json"))
    .sort();
}

function discoverFragments(fragmentsDirectory, contract) {
  const root = path.resolve(fragmentsDirectory);
  const fragments = [];
  for (const filePath of discoverJsonFiles(root)) {
    const stat = fs.lstatSync(filePath);
    if (stat.size > MAX_JSON_BYTES) continue;
    let parsed;
    try {
      parsed = readJsonBytes(filePath, path.relative(root, filePath));
    } catch {
      continue;
    }
    if (parsed.value?.schema !== FRAGMENT_SCHEMA) continue;
    const relativeFile = path.relative(root, filePath).replaceAll("\\", "/");
    fragments.push({
      filePath,
      relativeFile,
      bytes: parsed.bytes,
      digest: sha256(parsed.bytes),
      value: normalizeFragment(parsed.value, contract, relativeFile),
    });
  }
  if (fragments.length === 0) {
    fail("no canonical Claude Code increment audit fragments were found");
  }
  return fragments;
}

function commitmentIndex(commitmentId) {
  return REQUIRED_COMMITMENTS.indexOf(commitmentId);
}

function operatingSystemIndex(operatingSystem) {
  return REQUIRED_OPERATING_SYSTEMS.indexOf(operatingSystem);
}

function sortFragments(left, right) {
  return (
    commitmentIndex(left.value.commitmentId) -
      commitmentIndex(right.value.commitmentId) ||
    operatingSystemIndex(left.value.os) -
      operatingSystemIndex(right.value.os) ||
    left.value.profileVersion.localeCompare(right.value.profileVersion) ||
    left.value.source.runId.localeCompare(right.value.source.runId) ||
    left.value.source.jobId.localeCompare(right.value.source.jobId) ||
    left.relativeFile.localeCompare(right.relativeFile)
  );
}

function enforceCoverage(fragments, contract, releaseCommit) {
  const required = [];
  const advisory = [];
  const byCell = new Map();
  for (const fragmentRecord of fragments) {
    const fragment = fragmentRecord.value;
    if (fragment.headSha !== releaseCommit) {
      fail(
        `${fragment.commitmentId}/${fragment.os} is bound to stale head ${fragment.headSha}`,
      );
    }
    if (fragment.disposition === contract.requiredDisposition) {
      if (fragment.outcome !== contract.requiredOutcome) {
        fail(
          `${fragment.commitmentId}/${fragment.os} required evidence did not pass`,
        );
      }
      const cell = `${fragment.commitmentId}/${fragment.os}`;
      if (byCell.has(cell)) fail(`duplicate required audit cell ${cell}`);
      byCell.set(cell, fragmentRecord);
      required.push(fragmentRecord);
    } else {
      advisory.push(fragmentRecord);
    }
  }

  const expectedCells = [];
  for (const commitmentId of contract.requiredCommitments) {
    for (const operatingSystem of contract.requiredOperatingSystems) {
      expectedCells.push(`${commitmentId}/${operatingSystem}`);
    }
  }
  const missing = expectedCells.filter((cell) => !byCell.has(cell));
  if (missing.length > 0) {
    fail(`missing required audit cells: ${missing.join(", ")}`);
  }
  if (required.length !== expectedCells.length) {
    fail(
      `required audit row count must be ${expectedCells.length}; received ${required.length}`,
    );
  }

  for (const commitmentId of contract.requiredCommitments) {
    const cells = required
      .filter((record) => record.value.commitmentId === commitmentId)
      .map((record) => record.value);
    const profileVersions = new Set(
      cells.map((fragment) => fragment.profileVersion),
    );
    if (
      contract.profilePolicy.requireSameProfileVersionAcrossOperatingSystems &&
      profileVersions.size !== 1
    ) {
      fail(`${commitmentId} profileVersion differs across operating systems`);
    }
    const thresholdDigests = new Set(
      cells.map((fragment) =>
        sha256(Buffer.from(stableJson(fragment.thresholds))),
      ),
    );
    if (
      contract.profilePolicy.requireSameThresholdsAcrossOperatingSystems &&
      thresholdDigests.size !== 1
    ) {
      fail(
        `${commitmentId} required thresholds differ across operating systems`,
      );
    }
    const locked = contract.lockedProfiles[commitmentId];
    if (locked) {
      for (const fragment of cells) {
        if (fragment.profileVersion !== locked.profileVersion) {
          fail(`${commitmentId} does not use its locked profileVersion`);
        }
        if (!deepEqual(fragment.thresholds, locked.thresholds)) {
          fail(`${commitmentId} relaxes or changes its locked thresholds`);
        }
      }
    }
  }
  required.sort(sortFragments);
  advisory.sort(sortFragments);
  return { required, advisory };
}

function slug(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
}

function rowFromFragment(fragment, fragmentFile, fragmentDigest) {
  return {
    commitmentId: fragment.commitmentId,
    headSha: fragment.headSha,
    os: fragment.os,
    runtime: fragment.runtime,
    profileVersion: fragment.profileVersion,
    thresholds: fragment.thresholds,
    measurements: fragment.measurements,
    testIds: fragment.testIds,
    producerDigests: fragment.producerDigests,
    disposition: fragment.disposition,
    source: fragment.source,
    outcome: fragment.outcome,
    fragmentFile,
    fragmentDigest,
  };
}

function writeRows(stageDirectory, records, disposition) {
  const rows = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const fragment = record.value;
    const suffix =
      disposition === "required"
        ? ""
        : `-${sha256(record.bytes).slice("sha256:".length, 13)}`;
    const relativeFile = path.posix.join(
      "fragments",
      disposition,
      `${String(index + 1).padStart(3, "0")}-${slug(fragment.commitmentId)}-${fragment.os}${suffix}.json`,
    );
    const absoluteFile = path.join(stageDirectory, ...relativeFile.split("/"));
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
    fs.writeFileSync(absoluteFile, record.bytes);
    rows.push(rowFromFragment(fragment, relativeFile, record.digest));
  }
  return rows;
}

function manifestSummary(requiredRows, advisoryRows) {
  return {
    requiredCommitmentCount: REQUIRED_COMMITMENTS.length,
    requiredRowCount: requiredRows.length,
    advisoryRowCount: advisoryRows.length,
    failedAdvisoryRowCount: advisoryRows.filter(
      (row) => row.outcome === "failed",
    ).length,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function artifactName(releaseCommit) {
  return `claude-code-increment-audit-${releaseCommit}`;
}

function aggregateAuditFragments({
  fragmentsDirectory,
  releaseCommit,
  outputRoot,
  contractPath = DEFAULT_CONTRACT_PATH,
  repositoryRoot = REPOSITORY_ROOT,
  verifyGitHead = true,
}) {
  const normalizedCommit = assertExactHead(
    releaseCommit,
    repositoryRoot,
    verifyGitHead,
  );
  const contractRecord = loadContract(contractPath);
  const fragments = discoverFragments(fragmentsDirectory, contractRecord.value);
  const producerCache = new Map();
  for (const record of fragments) {
    verifyProducerDigests(record.value, {
      repositoryRoot,
      releaseCommit: normalizedCommit,
      producerCache,
    });
  }
  const { required, advisory } = enforceCoverage(
    fragments,
    contractRecord.value,
    normalizedCommit,
  );

  const resolvedOutputRoot = path.resolve(outputRoot);
  const resolvedFragmentsDirectory = path.resolve(fragmentsDirectory);
  const relativeOutput = path.relative(
    resolvedFragmentsDirectory,
    resolvedOutputRoot,
  );
  if (
    relativeOutput === "" ||
    (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))
  ) {
    fail("outputRoot must be outside fragmentsDirectory");
  }
  fs.mkdirSync(resolvedOutputRoot, { recursive: true });
  const name = artifactName(normalizedCommit);
  const finalDirectory = path.join(resolvedOutputRoot, name);
  if (fs.existsSync(finalDirectory)) {
    fail(`refusing to overwrite existing audit artifact ${finalDirectory}`);
  }
  const stageDirectory = path.join(
    resolvedOutputRoot,
    `.${name}.staging-${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
  );
  fs.mkdirSync(stageDirectory);
  try {
    fs.writeFileSync(
      path.join(stageDirectory, "contract.json"),
      contractRecord.bytes,
    );
    const requiredRows = writeRows(stageDirectory, required, "required");
    const advisoryRows = writeRows(stageDirectory, advisory, "advisory");
    const manifest = {
      schema: MANIFEST_SCHEMA,
      artifactName: name,
      headSha: normalizedCommit,
      contract: {
        file: "contract.json",
        schema: contractRecord.value.schema,
        contractVersion: contractRecord.value.contractVersion,
        sha256: contractRecord.digest,
      },
      requiredCommitments: [...contractRecord.value.requiredCommitments],
      requiredOperatingSystems: [
        ...contractRecord.value.requiredOperatingSystems,
      ],
      result: "passed",
      summary: manifestSummary(requiredRows, advisoryRows),
      requiredRows,
      advisoryRows,
    };
    const manifestPath = path.join(stageDirectory, "manifest.json");
    writeJson(manifestPath, manifest);
    const manifestDigest = sha256(fs.readFileSync(manifestPath));
    fs.writeFileSync(
      path.join(stageDirectory, "manifest.sha256"),
      `${manifestDigest}\n`,
      "utf8",
    );
    fs.renameSync(stageDirectory, finalDirectory);
    return {
      artifactDirectory: finalDirectory,
      manifestPath: path.join(finalDirectory, "manifest.json"),
      manifestDigest,
      manifest,
    };
  } catch (error) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

function resolveArtifactFile(artifactDirectory, relativeFile, scope) {
  const normalized = normalizeProducerPath(relativeFile, scope);
  const root = path.resolve(artifactDirectory);
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${scope} escapes the audit artifact`);
  }
  let cursor = root;
  const components = normalized.split("/");
  for (let index = 0; index < components.length; index += 1) {
    cursor = path.join(cursor, components[index]);
    if (!fs.existsSync(cursor)) fail(`${scope} does not exist`);
    const componentStat = fs.lstatSync(cursor);
    if (componentStat.isSymbolicLink()) {
      fail(`${scope} traverses a symbolic link`);
    }
    if (index < components.length - 1 && !componentStat.isDirectory()) {
      fail(`${scope} traverses a non-directory component`);
    }
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${scope} must reference a regular artifact file`);
  }
  return absolute;
}

function fragmentFromRow(row) {
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId: row.commitmentId,
    headSha: row.headSha,
    os: row.os,
    runtime: row.runtime,
    profileVersion: row.profileVersion,
    thresholds: row.thresholds,
    measurements: row.measurements,
    testIds: row.testIds,
    producerDigests: row.producerDigests,
    disposition: row.disposition,
    source: row.source,
    outcome: row.outcome,
  };
}

function verifyManifestRow(
  row,
  expectedDisposition,
  { artifactDirectory, contract, releaseCommit, repositoryRoot, producerCache },
) {
  assertExactKeys(row, ROW_KEYS, "audit manifest row");
  if (row.disposition !== expectedDisposition) {
    fail(
      `audit manifest ${expectedDisposition} row contains ${row.disposition}`,
    );
  }
  if (!DIGEST_RE.test(row.fragmentDigest || "")) {
    fail("audit manifest row fragmentDigest is invalid");
  }
  const fragmentFile = resolveArtifactFile(
    artifactDirectory,
    row.fragmentFile,
    "audit manifest row fragmentFile",
  );
  const { bytes, value } = readJsonBytes(fragmentFile, row.fragmentFile);
  if (sha256(bytes) !== row.fragmentDigest) {
    fail(`${row.fragmentFile} digest drift`);
  }
  const normalized = normalizeFragment(value, contract, row.fragmentFile);
  if (!deepEqual(normalized, fragmentFromRow(row))) {
    fail(`${row.fragmentFile} does not match its manifest row`);
  }
  if (normalized.headSha !== releaseCommit) {
    fail(`${row.fragmentFile} is bound to stale head`);
  }
  if (expectedDisposition === "required" && normalized.outcome !== "passed") {
    fail(`${row.fragmentFile} is failed required evidence`);
  }
  verifyProducerDigests(normalized, {
    repositoryRoot,
    releaseCommit,
    producerCache,
  });
  return {
    filePath: fragmentFile,
    relativeFile: row.fragmentFile,
    bytes,
    digest: row.fragmentDigest,
    value: normalized,
  };
}

function verifyAuditArtifact({
  artifactDirectory,
  releaseCommit,
  contractPath = DEFAULT_CONTRACT_PATH,
  repositoryRoot = REPOSITORY_ROOT,
  verifyGitHead = true,
}) {
  const normalizedCommit = assertExactHead(
    releaseCommit,
    repositoryRoot,
    verifyGitHead,
  );
  const directory = path.resolve(artifactDirectory);
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
    fail("artifactDirectory must exist and be a directory");
  }
  if (path.basename(directory) !== artifactName(normalizedCommit)) {
    fail("audit artifact directory name is not bound to releaseCommit");
  }
  const expectedContract = loadContract(contractPath);
  const artifactContractPath = resolveArtifactFile(
    directory,
    "contract.json",
    "audit artifact contract",
  );
  const artifactContract = readJsonBytes(
    artifactContractPath,
    "audit artifact contract",
  );
  if (!artifactContract.bytes.equals(expectedContract.bytes)) {
    fail("audit artifact contract differs from the verifier contract");
  }
  validateContract(artifactContract.value);

  const manifestPath = resolveArtifactFile(
    directory,
    "manifest.json",
    "audit artifact manifest",
  );
  const manifestRecord = readJsonBytes(manifestPath, "audit artifact manifest");
  const sidecarPath = resolveArtifactFile(
    directory,
    "manifest.sha256",
    "audit artifact manifest digest",
  );
  const sidecar = fs.readFileSync(sidecarPath, "utf8");
  if (sidecar !== `${sha256(manifestRecord.bytes)}\n`) {
    fail("audit artifact manifest digest sidecar does not match manifest.json");
  }
  const manifest = manifestRecord.value;
  assertExactKeys(manifest, MANIFEST_KEYS, "audit manifest");
  if (manifest.schema !== MANIFEST_SCHEMA) {
    fail(`audit manifest schema must be ${MANIFEST_SCHEMA}`);
  }
  if (manifest.artifactName !== artifactName(normalizedCommit)) {
    fail("audit manifest artifactName is not exact-head bound");
  }
  if (manifest.headSha !== normalizedCommit) {
    fail("audit manifest headSha is stale");
  }
  assertExactKeys(
    manifest.contract,
    ["contractVersion", "file", "schema", "sha256"],
    "audit manifest contract",
  );
  if (
    manifest.contract.file !== "contract.json" ||
    manifest.contract.schema !== CONTRACT_SCHEMA ||
    manifest.contract.contractVersion !==
      expectedContract.value.contractVersion ||
    manifest.contract.sha256 !== expectedContract.digest
  ) {
    fail("audit manifest contract binding is invalid");
  }
  if (
    !deepEqual(
      manifest.requiredCommitments,
      expectedContract.value.requiredCommitments,
    ) ||
    !deepEqual(
      manifest.requiredOperatingSystems,
      expectedContract.value.requiredOperatingSystems,
    )
  ) {
    fail("audit manifest required coverage differs from the contract");
  }
  if (manifest.result !== "passed") {
    fail("audit manifest result must be passed");
  }
  if (!Array.isArray(manifest.requiredRows)) {
    fail("audit manifest requiredRows must be an array");
  }
  if (!Array.isArray(manifest.advisoryRows)) {
    fail("audit manifest advisoryRows must be an array");
  }
  const producerCache = new Map();
  const requiredRecords = manifest.requiredRows.map((row) =>
    verifyManifestRow(row, "required", {
      artifactDirectory: directory,
      contract: expectedContract.value,
      releaseCommit: normalizedCommit,
      repositoryRoot,
      producerCache,
    }),
  );
  const advisoryRecords = manifest.advisoryRows.map((row) =>
    verifyManifestRow(row, "advisory", {
      artifactDirectory: directory,
      contract: expectedContract.value,
      releaseCommit: normalizedCommit,
      repositoryRoot,
      producerCache,
    }),
  );
  const allFragmentFiles = discoverJsonFiles(
    path.join(directory, "fragments"),
  ).map((filePath) => path.relative(directory, filePath).replaceAll("\\", "/"));
  const referencedFragmentFiles = [...requiredRecords, ...advisoryRecords]
    .map((record) => record.relativeFile)
    .sort();
  if (!deepEqual(allFragmentFiles.sort(), referencedFragmentFiles)) {
    fail("audit artifact contains unreferenced or missing fragment files");
  }
  const coverage = enforceCoverage(
    [...requiredRecords, ...advisoryRecords],
    expectedContract.value,
    normalizedCommit,
  );
  const expectedRequiredRows = coverage.required.map((record) =>
    rowFromFragment(record.value, record.relativeFile, record.digest),
  );
  const expectedAdvisoryRows = coverage.advisory.map((record) =>
    rowFromFragment(record.value, record.relativeFile, record.digest),
  );
  if (!deepEqual(manifest.requiredRows, expectedRequiredRows)) {
    fail("audit manifest requiredRows are not canonical or complete");
  }
  if (!deepEqual(manifest.advisoryRows, expectedAdvisoryRows)) {
    fail("audit manifest advisoryRows are not canonical");
  }
  assertExactKeys(
    manifest.summary,
    [
      "advisoryRowCount",
      "failedAdvisoryRowCount",
      "requiredCommitmentCount",
      "requiredRowCount",
    ],
    "audit manifest summary",
  );
  if (
    !deepEqual(
      manifest.summary,
      manifestSummary(manifest.requiredRows, manifest.advisoryRows),
    )
  ) {
    fail("audit manifest summary does not match its rows");
  }
  return {
    manifest,
    manifestDigest: sha256(manifestRecord.bytes),
    artifactDirectory: directory,
  };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  if (!command || !["aggregate", "verify"].includes(command)) {
    fail("usage: claude-code-increment-audit.mjs aggregate|verify [options]");
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument ${key || ""}`.trim());
    }
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "aggregate") {
    if (
      !options.fragmentsDir ||
      !options.releaseCommit ||
      !options.outputRoot
    ) {
      fail(
        "aggregate requires --fragments-dir, --release-commit, and --output-root",
      );
    }
    const result = aggregateAuditFragments({
      fragmentsDirectory: options.fragmentsDir,
      releaseCommit: options.releaseCommit,
      outputRoot: options.outputRoot,
      contractPath: options.contract,
    });
    process.stdout.write(
      `${JSON.stringify({
        artifactDirectory: result.artifactDirectory,
        manifestDigest: result.manifestDigest,
        summary: result.manifest.summary,
      })}\n`,
    );
    return;
  }
  if (!options.artifactDir || !options.releaseCommit) {
    fail("verify requires --artifact-dir and --release-commit");
  }
  const result = verifyAuditArtifact({
    artifactDirectory: options.artifactDir,
    releaseCommit: options.releaseCommit,
    contractPath: options.contract,
  });
  process.stdout.write(
    `${JSON.stringify({
      artifactDirectory: result.artifactDirectory,
      manifestDigest: result.manifestDigest,
      summary: result.manifest.summary,
    })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `Claude Code increment audit failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}

export {
  CONTRACT_SCHEMA,
  DEFAULT_CONTRACT_PATH,
  FRAGMENT_SCHEMA,
  MANIFEST_SCHEMA,
  REQUIRED_COMMITMENTS,
  REQUIRED_OPERATING_SYSTEMS,
  aggregateAuditFragments,
  artifactName,
  loadContract,
  normalizeFragment,
  sha256,
  verifyAuditArtifact,
};
