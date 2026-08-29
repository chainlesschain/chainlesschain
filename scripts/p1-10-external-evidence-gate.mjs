#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const defaultMatrixPath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "p1-10-conformance-matrix.json",
);

export const P1_10_MATRIX_SCHEMA = "chainlesschain.p1-10-conformance-matrix/v1";
export const P1_10_EVIDENCE_SCHEMA =
  "chainlesschain.p1-10-external-evidence/v1";
export const P1_10_RECEIPT_SCHEMA =
  "chainlesschain.p1-10-external-evidence-receipt/v1";
export const P1_10_PLATFORM_EVIDENCE_DOMAIN = "cc.p1-10.external-platform/v1";
export const P1_10_SCENARIO_EVIDENCE_DOMAIN = "cc.p1-10.external-scenario/v1";
export const P1_10_EVIDENCE_DOMAIN = "cc.p1-10.external-evidence/v1";
export const P1_10_MATRIX_DOMAIN = "cc.p1-10.conformance-matrix/v1";
export const P1_10_RECEIPT_DOMAIN = "cc.p1-10.external-receipt/v1";

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_HOSTS_PER_PLATFORM = 64;
const MAX_ARTIFACTS_PER_PLATFORM = 64;

function fail(message, field = "") {
  const error = new Error(message);
  error.name = "P110ExternalEvidenceError";
  error.code = "CC_P1_10_EXTERNAL_EVIDENCE_INVALID";
  if (field) error.field = field;
  throw error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function digestP110Evidence(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, field, maximumBytes = 1024) {
  const normalized = String(value || "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    fail(`${field} must be a non-empty bounded string`, field);
  }
  return normalized;
}

function exactCommit(value, field = "commitSha") {
  const normalized = String(value || "").toLowerCase();
  if (!COMMIT.test(normalized)) {
    fail(`${field} must be an exact 40-character commit`, field);
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value || "").toLowerCase();
  if (!DIGEST.test(normalized)) {
    fail(`${field} must be a sha256 digest`, field);
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    fail(`${field} must be a positive safe integer`, field);
  }
  return normalized;
}

function nonNegativeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(`${field} must be a non-negative safe integer`, field);
  }
  return normalized;
}

function canonicalTimestamp(value, field) {
  const normalized = String(value || "");
  const milliseconds = Date.parse(normalized);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    fail(`${field} must be a canonical ISO timestamp`, field);
  }
  return { value: normalized, milliseconds };
}

function exactMembers(actual, expected, field) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (
    new Set(normalizedActual).size !== normalizedActual.length ||
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((value, index) => value !== normalizedExpected[index])
  ) {
    fail(
      `${field} must contain exactly: ${normalizedExpected.join(", ")}`,
      field,
    );
  }
}

function verifyDigest(input, normalized, domain, field) {
  const supplied = sha256(input?.[field], field);
  const unsigned = clone(normalized);
  delete unsigned[field];
  const expected = digestP110Evidence(unsigned, domain);
  if (supplied !== expected) {
    fail(`${field} does not match normalized evidence`, field);
  }
  return supplied;
}

function normalizeRequirement(cell, scenarioId) {
  const evidenceScenario = text(
    cell.evidenceScenario,
    `${scenarioId}.evidenceScenario`,
    128,
  );
  const requiredPlatforms = Array.isArray(cell.requiredPlatforms)
    ? cell.requiredPlatforms.map((value) => String(value).toLowerCase())
    : [];
  if (
    requiredPlatforms.length === 0 ||
    requiredPlatforms.some((platform) => !PLATFORMS.includes(platform))
  ) {
    fail(
      `${evidenceScenario}.requiredPlatforms must name supported platforms`,
      `${evidenceScenario}.requiredPlatforms`,
    );
  }
  exactMembers(
    requiredPlatforms,
    [...new Set(requiredPlatforms)],
    `${evidenceScenario}.requiredPlatforms`,
  );
  const metrics = cell.requiredMetrics || {};
  const positiveMetrics = Array.isArray(metrics.positive)
    ? metrics.positive.map((value) => text(value, "positive metric", 128))
    : [];
  const zeroMetrics = Array.isArray(metrics.zero)
    ? metrics.zero.map((value) => text(value, "zero metric", 128))
    : [];
  const allMetrics = [...positiveMetrics, ...zeroMetrics];
  if (
    new Set(allMetrics).size !== allMetrics.length ||
    allMetrics.length === 0
  ) {
    fail(
      `${evidenceScenario}.requiredMetrics must be non-empty and unique`,
      `${evidenceScenario}.requiredMetrics`,
    );
  }
  return {
    evidenceScenario,
    requiredPlatforms: [...requiredPlatforms].sort(),
    minimumDurationMs: positiveInteger(
      cell.minimumDurationMs,
      `${evidenceScenario}.minimumDurationMs`,
    ),
    minimumDistinctHosts: positiveInteger(
      cell.minimumDistinctHosts,
      `${evidenceScenario}.minimumDistinctHosts`,
    ),
    requiredMetrics: {
      positive: [...positiveMetrics].sort(),
      zero: [...zeroMetrics].sort(),
    },
  };
}

function normalizeMatrix(matrix) {
  if (matrix?.schema !== P1_10_MATRIX_SCHEMA) {
    fail("invalid P1-10 conformance matrix schema", "matrix.schema");
  }
  if (!Array.isArray(matrix.scenarios) || matrix.scenarios.length === 0) {
    fail("P1-10 conformance matrix has no scenarios", "matrix.scenarios");
  }
  const requirements = [];
  for (const scenario of matrix.scenarios) {
    const scenarioId = text(scenario?.id, "scenario.id", 128);
    for (const cell of Array.isArray(scenario?.cells) ? scenario.cells : []) {
      if (cell?.status === "external-required") {
        requirements.push(normalizeRequirement(cell, scenarioId));
      }
    }
  }
  requirements.sort((left, right) =>
    left.evidenceScenario.localeCompare(right.evidenceScenario),
  );
  exactMembers(
    requirements.map((entry) => entry.evidenceScenario),
    [...new Set(requirements.map((entry) => entry.evidenceScenario))],
    "external evidence scenarios",
  );
  if (requirements.length === 0) {
    fail("P1-10 matrix has no external evidence requirements");
  }
  return {
    requirements,
    matrixDigest: digestP110Evidence(matrix, P1_10_MATRIX_DOMAIN),
  };
}

function normalizeExpected(expected) {
  const required = [
    "commitSha",
    "repository",
    "workflow",
    "runId",
    "runAttempt",
    "environment",
    "challenge",
  ];
  for (const field of required) {
    if (expected?.[field] == null || expected[field] === "") {
      fail(`expected.${field} is required`, `expected.${field}`);
    }
  }
  const repository = String(expected.repository);
  const workflow = String(expected.workflow);
  const challenge = String(expected.challenge);
  if (!REPOSITORY.test(repository)) {
    fail("expected.repository must be owner/repository", "expected.repository");
  }
  if (!WORKFLOW.test(workflow)) {
    fail(
      "expected.workflow must be a repository workflow path",
      "expected.workflow",
    );
  }
  if (!CHALLENGE.test(challenge)) {
    fail(
      "expected.challenge must be an unpredictable 32-128 character token",
      "expected.challenge",
    );
  }
  return {
    commitSha: exactCommit(expected.commitSha, "expected.commitSha"),
    repository,
    workflow,
    runId: positiveInteger(expected.runId, "expected.runId"),
    runAttempt: positiveInteger(expected.runAttempt, "expected.runAttempt"),
    environment: text(expected.environment, "expected.environment", 128),
    challenge,
  };
}

function normalizeProducer(input, expected) {
  const producer = {
    repository: String(input?.repository || ""),
    workflow: String(input?.workflow || ""),
    runId: positiveInteger(input?.runId, "producer.runId"),
    runAttempt: positiveInteger(input?.runAttempt, "producer.runAttempt"),
    environment: text(input?.environment, "producer.environment", 128),
    challenge: String(input?.challenge || ""),
  };
  for (const field of Object.keys(producer)) {
    if (producer[field] !== expected[field]) {
      fail(`producer.${field} does not match protected expectation`, field);
    }
  }
  return producer;
}

function normalizeArtifact(input, field) {
  return {
    kind: text(input?.kind, `${field}.kind`, 64),
    name: text(input?.name, `${field}.name`, 256),
    digest: sha256(input?.digest, `${field}.digest`),
    sizeBytes: positiveInteger(input?.sizeBytes, `${field}.sizeBytes`),
  };
}

function normalizeMetrics(input, requirement, field) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`${field} must be an object`, field);
  }
  const entries = Object.entries(input);
  if (entries.length > 64) fail(`${field} has too many metrics`, field);
  const normalized = Object.fromEntries(
    entries
      .map(([name, value]) => [
        text(name, `${field}.name`, 128),
        nonNegativeInteger(value, `${field}.${name}`),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  for (const name of requirement.requiredMetrics.positive) {
    if (!Number.isSafeInteger(normalized[name]) || normalized[name] < 1) {
      fail(`${field}.${name} must be positive`, `${field}.${name}`);
    }
  }
  for (const name of requirement.requiredMetrics.zero) {
    if (normalized[name] !== 0) {
      fail(`${field}.${name} must be zero`, `${field}.${name}`);
    }
  }
  return normalized;
}

function normalizePlatform(input, requirement, field) {
  const platform = String(input?.platform || "").toLowerCase();
  if (!requirement.requiredPlatforms.includes(platform)) {
    fail(`${field}.platform is not required`, `${field}.platform`);
  }
  if (input?.status !== "passed") {
    fail(`${field} must explicitly report passed`, `${field}.status`);
  }
  const started = canonicalTimestamp(input?.startedAt, `${field}.startedAt`);
  const ended = canonicalTimestamp(input?.endedAt, `${field}.endedAt`);
  const durationMs = ended.milliseconds - started.milliseconds;
  if (
    durationMs < requirement.minimumDurationMs ||
    input?.durationMs !== durationMs
  ) {
    fail(
      `${field}.durationMs must equal its timestamp window and meet ${requirement.minimumDurationMs}ms`,
      `${field}.durationMs`,
    );
  }
  const hosts = Array.isArray(input?.hosts)
    ? input.hosts.map((host, index) => ({
        idDigest: sha256(host?.idDigest, `${field}.hosts[${index}].idDigest`),
        hostClass: host?.hostClass,
      }))
    : [];
  if (
    hosts.length > MAX_HOSTS_PER_PLATFORM ||
    hosts.length < requirement.minimumDistinctHosts ||
    hosts.some((host) => host.hostClass !== "physical") ||
    new Set(hosts.map((host) => host.idDigest)).size !== hosts.length
  ) {
    fail(
      `${field}.hosts requires ${requirement.minimumDistinctHosts} distinct physical hosts`,
      `${field}.hosts`,
    );
  }
  hosts.sort((left, right) => left.idDigest.localeCompare(right.idDigest));
  const artifacts = Array.isArray(input?.artifacts)
    ? input.artifacts.map((artifact, index) =>
        normalizeArtifact(artifact, `${field}.artifacts[${index}]`),
      )
    : [];
  if (
    artifacts.length > MAX_ARTIFACTS_PER_PLATFORM ||
    artifacts.length === 0 ||
    new Set(artifacts.map((artifact) => artifact.digest)).size !==
      artifacts.length
  ) {
    fail(`${field}.artifacts must contain unique content digests`, field);
  }
  artifacts.sort((left, right) => left.digest.localeCompare(right.digest));
  const normalized = {
    platform,
    status: "passed",
    startedAt: started.value,
    endedAt: ended.value,
    durationMs,
    hosts,
    artifacts,
    metrics: normalizeMetrics(input?.metrics, requirement, `${field}.metrics`),
    evidenceDigest: String(input?.evidenceDigest || ""),
  };
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    P1_10_PLATFORM_EVIDENCE_DOMAIN,
    "evidenceDigest",
  );
  return normalized;
}

function normalizeScenario(input, requirement, field) {
  if (
    input?.scenario !== requirement.evidenceScenario ||
    input?.status !== "passed"
  ) {
    fail(`${field} does not match the required passing scenario`, field);
  }
  const platforms = Array.isArray(input?.platforms)
    ? input.platforms.map((platform, index) =>
        normalizePlatform(
          platform,
          requirement,
          `${field}.platforms[${index}]`,
        ),
      )
    : [];
  platforms.sort((left, right) => left.platform.localeCompare(right.platform));
  exactMembers(
    platforms.map((entry) => entry.platform),
    requirement.requiredPlatforms,
    `${field}.platforms`,
  );
  const normalized = {
    scenario: requirement.evidenceScenario,
    status: "passed",
    platforms,
    evidenceDigest: String(input?.evidenceDigest || ""),
  };
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    P1_10_SCENARIO_EVIDENCE_DOMAIN,
    "evidenceDigest",
  );
  return normalized;
}

export function validateExternalEvidence(matrix, evidence, expected) {
  const matrixContract = normalizeMatrix(matrix);
  const expectedContract = normalizeExpected(expected);
  if (
    evidence?.schema !== P1_10_EVIDENCE_SCHEMA ||
    evidence?.status !== "passed"
  ) {
    fail("external evidence must use the v1 schema and explicitly pass");
  }
  const commitSha = exactCommit(evidence.commitSha);
  if (commitSha !== expectedContract.commitSha) {
    fail("external evidence commit does not match the expected exact SHA");
  }
  if (
    sha256(evidence.matrixDigest, "matrixDigest") !==
    matrixContract.matrixDigest
  ) {
    fail("external evidence matrix digest does not match this checkout");
  }
  const producer = normalizeProducer(evidence.producer, expectedContract);
  const resultsByScenario = new Map();
  for (const [index, result] of (Array.isArray(evidence.results)
    ? evidence.results
    : []
  ).entries()) {
    const scenario = text(result?.scenario, `results[${index}].scenario`, 128);
    if (resultsByScenario.has(scenario)) {
      fail(`duplicate external scenario: ${scenario}`);
    }
    resultsByScenario.set(scenario, { result, index });
  }
  exactMembers(
    [...resultsByScenario.keys()],
    matrixContract.requirements.map((entry) => entry.evidenceScenario),
    "results",
  );
  const results = matrixContract.requirements.map((requirement) => {
    const entry = resultsByScenario.get(requirement.evidenceScenario);
    return normalizeScenario(
      entry.result,
      requirement,
      `results[${entry.index}]`,
    );
  });
  results.sort((left, right) => left.scenario.localeCompare(right.scenario));
  const latestEnd = Math.max(
    ...results.flatMap((result) =>
      result.platforms.map((platform) => Date.parse(platform.endedAt)),
    ),
  );
  const issuedAt = canonicalTimestamp(evidence.issuedAt, "issuedAt");
  if (issuedAt.milliseconds < latestEnd) {
    fail("issuedAt cannot precede completed platform evidence", "issuedAt");
  }
  const normalized = {
    schema: P1_10_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha,
    matrixDigest: matrixContract.matrixDigest,
    producer,
    issuedAt: issuedAt.value,
    results,
    evidenceDigest: String(evidence.evidenceDigest || ""),
  };
  normalized.evidenceDigest = verifyDigest(
    evidence,
    normalized,
    P1_10_EVIDENCE_DOMAIN,
    "evidenceDigest",
  );
  const receiptBody = {
    schema: P1_10_RECEIPT_SCHEMA,
    status: "passed",
    commitSha,
    matrixDigest: matrixContract.matrixDigest,
    producer,
    evidenceDigest: normalized.evidenceDigest,
    scenarioCount: results.length,
    platformCount: results.reduce(
      (total, result) => total + result.platforms.length,
      0,
    ),
    scenarios: results.map((result) => ({
      scenario: result.scenario,
      evidenceDigest: result.evidenceDigest,
      platforms: result.platforms.map((platform) => ({
        platform: platform.platform,
        durationMs: platform.durationMs,
        hostCount: platform.hosts.length,
        artifactDigests: platform.artifacts.map((artifact) => artifact.digest),
        evidenceDigest: platform.evidenceDigest,
      })),
    })),
  };
  return Object.freeze({
    ...receiptBody,
    receiptDigest: digestP110Evidence(receiptBody, P1_10_RECEIPT_DOMAIN),
  });
}

function usage() {
  return [
    "Usage:",
    "  node scripts/p1-10-external-evidence-gate.mjs \\",
    "    --evidence <file.json> --expected-commit <sha> \\",
    "    --expected-repository <owner/repo> --expected-workflow <path> \\",
    "    --expected-run-id <id> --expected-run-attempt <attempt> \\",
    "    --expected-environment <name> --expected-challenge <token> \\",
    "    [--matrix <file.json>] [--output <receipt.json>]",
    "",
    "This command verifies externally produced evidence. It never fabricates",
    "physical hosts, packaged Electron recovery, migration, or soak results.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const fields = {
      "--evidence": "evidence",
      "--matrix": "matrix",
      "--output": "output",
      "--expected-commit": "commitSha",
      "--expected-repository": "repository",
      "--expected-workflow": "workflow",
      "--expected-run-id": "runId",
      "--expected-run-attempt": "runAttempt",
      "--expected-environment": "environment",
      "--expected-challenge": "challenge",
    };
    const field = fields[argument];
    if (!field) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${argument} requires a value`);
    }
    options[field] = value;
    index += 1;
  }
  return options;
}

function readJson(file, field) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    fail(`${field} is not a file: ${resolved}`, field);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_JSON_BYTES) {
    fail(
      `${field} must be a non-empty JSON file no larger than ${MAX_JSON_BYTES} bytes`,
      field,
    );
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function writeJson(value, output) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!output) {
    process.stdout.write(serialized);
    return;
  }
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, serialized, "utf8");
  process.stdout.write(`${resolved}\n`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.evidence) fail(`--evidence is required\n${usage()}`);
  const expected = {
    commitSha: options.commitSha,
    repository: options.repository,
    workflow: options.workflow,
    runId: options.runId,
    runAttempt: options.runAttempt,
    environment: options.environment,
    challenge: options.challenge,
  };
  const matrix = readJson(options.matrix || defaultMatrixPath, "--matrix");
  const evidence = readJson(options.evidence, "--evidence");
  writeJson(
    validateExternalEvidence(matrix, evidence, expected),
    options.output,
  );
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
    );
    process.exitCode = 1;
  }
}
