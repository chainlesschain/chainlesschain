#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { P1_10_SCENARIO_CONTRACT_DIGEST } from "./p1-10-scenario-receipts.mjs";

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
  "chainlesschain.p1-10-external-evidence/v4";
export const P1_10_RECEIPT_SCHEMA =
  "chainlesschain.p1-10-external-evidence-receipt/v4";
export const P1_10_PLATFORM_EVIDENCE_DOMAIN = "cc.p1-10.external-platform/v4";
export const P1_10_SCENARIO_EVIDENCE_DOMAIN = "cc.p1-10.external-scenario/v4";
export const P1_10_EVIDENCE_DOMAIN = "cc.p1-10.external-evidence/v4";
export const P1_10_MATRIX_DOMAIN = "cc.p1-10.conformance-matrix/v1";
export const P1_10_RECEIPT_DOMAIN = "cc.p1-10.external-receipt/v4";
export const P1_10_CLOSE_IDEMPOTENCY_DOMAIN =
  "cc.p1-10.external-close-idempotency/v1";
export const P1_10_HOSTED_VERIFIER_BINDINGS_DOMAIN =
  "cc.p1-10.hosted-verifier-bindings/v1";

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_HOSTS_PER_PLATFORM = 64;
const MAX_ARTIFACTS_PER_PLATFORM = 64;
const MAX_EVIDENCE_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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
    "registryDigest",
    "harnessDigests",
    "supervisorDigests",
    "inputManifestDigests",
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
  if (
    !expected.harnessDigests ||
    typeof expected.harnessDigests !== "object" ||
    Array.isArray(expected.harnessDigests)
  ) {
    fail("expected.harnessDigests is required", "expected.harnessDigests");
  }
  exactMembers(
    Object.keys(expected.harnessDigests),
    PLATFORMS,
    "expected.harnessDigests",
  );
  if (
    !expected.supervisorDigests ||
    typeof expected.supervisorDigests !== "object" ||
    Array.isArray(expected.supervisorDigests)
  ) {
    fail(
      "expected.supervisorDigests is required",
      "expected.supervisorDigests",
    );
  }
  exactMembers(
    Object.keys(expected.supervisorDigests),
    PLATFORMS,
    "expected.supervisorDigests",
  );
  if (
    !expected.inputManifestDigests ||
    typeof expected.inputManifestDigests !== "object" ||
    Array.isArray(expected.inputManifestDigests)
  ) {
    fail(
      "expected.inputManifestDigests is required",
      "expected.inputManifestDigests",
    );
  }
  exactMembers(
    Object.keys(expected.inputManifestDigests),
    PLATFORMS,
    "expected.inputManifestDigests",
  );
  return {
    commitSha: exactCommit(expected.commitSha, "expected.commitSha"),
    repository,
    workflow,
    runId: positiveInteger(expected.runId, "expected.runId"),
    runAttempt: positiveInteger(expected.runAttempt, "expected.runAttempt"),
    environment: text(expected.environment, "expected.environment", 128),
    challenge,
    registryDigest: sha256(expected.registryDigest, "expected.registryDigest"),
    harnessDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        sha256(
          expected.harnessDigests[platform],
          `expected.harnessDigests.${platform}`,
        ),
      ]),
    ),
    supervisorDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        sha256(
          expected.supervisorDigests[platform],
          `expected.supervisorDigests.${platform}`,
        ),
      ]),
    ),
    inputManifestDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        sha256(
          expected.inputManifestDigests[platform],
          `expected.inputManifestDigests.${platform}`,
        ),
      ]),
    ),
  };
}

function normalizeTrust(input, expected, platform, field) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`${field} must be an object`, field);
  }
  exactMembers(
    Object.keys(input),
    [
      "harnessDigest",
      "registryDigest",
      "supervisorDigest",
      "inputManifestDigest",
      "scenarioContractDigest",
    ],
    field,
  );
  const normalized = {
    registryDigest: sha256(input.registryDigest, `${field}.registryDigest`),
    harnessDigest: sha256(input.harnessDigest, `${field}.harnessDigest`),
    supervisorDigest: sha256(
      input.supervisorDigest,
      `${field}.supervisorDigest`,
    ),
    inputManifestDigest: sha256(
      input.inputManifestDigest,
      `${field}.inputManifestDigest`,
    ),
    scenarioContractDigest: sha256(
      input.scenarioContractDigest,
      `${field}.scenarioContractDigest`,
    ),
  };
  if (
    normalized.registryDigest !== expected.registryDigest ||
    normalized.harnessDigest !== expected.harnessDigests[platform] ||
    normalized.supervisorDigest !== expected.supervisorDigests[platform] ||
    normalized.inputManifestDigest !==
      expected.inputManifestDigests[platform] ||
    normalized.scenarioContractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST
  ) {
    fail(`${field} does not match protected registry/harness pins`, field);
  }
  return normalized;
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

function normalizeEvidenceHost(host, expected, field) {
  if (!host || typeof host !== "object" || Array.isArray(host)) {
    fail(`${field} must be an object`, field);
  }
  exactMembers(
    Object.keys(host),
    [
      "hostClass",
      "idDigest",
      "artifactId",
      "artifactName",
      "hardwareIdentityDigest",
      "jobSlot",
      "runnerName",
      "runnerRegistrationId",
      "attesterRequestDigest",
      "attesterMeasurementDigest",
      "inputManifestDigest",
      "bootIdDigest",
      "signedExecutionReceiptDigest",
      "reportDigest",
      "bundleDigest",
      "sourceJob",
    ],
    field,
  );
  if (!host.sourceJob || typeof host.sourceJob !== "object") {
    fail(`${field}.sourceJob must be an object`, `${field}.sourceJob`);
  }
  exactMembers(
    Object.keys(host.sourceJob),
    [
      "jobDatabaseId",
      "jobId",
      "jobName",
      "jobSlot",
      "repository",
      "runAttempt",
      "runId",
      "startedAt",
      "workflow",
    ],
    `${field}.sourceJob`,
  );
  const jobSlot = text(host.jobSlot, `${field}.jobSlot`, 8);
  const sourceJob = {
    repository: text(
      host.sourceJob.repository,
      `${field}.sourceJob.repository`,
      201,
    ),
    workflow: text(host.sourceJob.workflow, `${field}.sourceJob.workflow`, 256),
    runId: positiveInteger(host.sourceJob.runId, `${field}.sourceJob.runId`),
    runAttempt: positiveInteger(
      host.sourceJob.runAttempt,
      `${field}.sourceJob.runAttempt`,
    ),
    jobId: text(host.sourceJob.jobId, `${field}.sourceJob.jobId`, 64),
    jobName: text(host.sourceJob.jobName, `${field}.sourceJob.jobName`, 256),
    jobSlot: text(host.sourceJob.jobSlot, `${field}.sourceJob.jobSlot`, 8),
    jobDatabaseId: positiveInteger(
      host.sourceJob.jobDatabaseId,
      `${field}.sourceJob.jobDatabaseId`,
    ),
    startedAt: canonicalTimestamp(
      host.sourceJob.startedAt,
      `${field}.sourceJob.startedAt`,
    ).value,
  };
  if (
    host.hostClass !== "physical" ||
    !["a", "b"].includes(jobSlot) ||
    sourceJob.jobSlot !== jobSlot ||
    sourceJob.jobId !== "collect-host" ||
    sourceJob.repository !== expected.repository ||
    sourceJob.workflow !== expected.workflow ||
    sourceJob.runId !== expected.runId ||
    sourceJob.runAttempt !== expected.runAttempt
  ) {
    fail(
      `${field} is not an independent exact-run physical job identity`,
      field,
    );
  }
  return {
    artifactId: positiveInteger(host.artifactId, `${field}.artifactId`),
    artifactName: text(host.artifactName, `${field}.artifactName`, 256),
    idDigest: sha256(host.idDigest, `${field}.idDigest`),
    hardwareIdentityDigest: sha256(
      host.hardwareIdentityDigest,
      `${field}.hardwareIdentityDigest`,
    ),
    hostClass: "physical",
    runnerRegistrationId: positiveInteger(
      host.runnerRegistrationId,
      `${field}.runnerRegistrationId`,
    ),
    runnerName: text(host.runnerName, `${field}.runnerName`, 128),
    jobSlot,
    attesterMeasurementDigest: sha256(
      host.attesterMeasurementDigest,
      `${field}.attesterMeasurementDigest`,
    ),
    inputManifestDigest: sha256(
      host.inputManifestDigest,
      `${field}.inputManifestDigest`,
    ),
    bootIdDigest: sha256(host.bootIdDigest, `${field}.bootIdDigest`),
    attesterRequestDigest: sha256(
      host.attesterRequestDigest,
      `${field}.attesterRequestDigest`,
    ),
    signedExecutionReceiptDigest: sha256(
      host.signedExecutionReceiptDigest,
      `${field}.signedExecutionReceiptDigest`,
    ),
    reportDigest: sha256(host.reportDigest, `${field}.reportDigest`),
    bundleDigest: sha256(host.bundleDigest, `${field}.bundleDigest`),
    sourceJob,
  };
}

function normalizePlatform(input, requirement, field, expected) {
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
    ? input.hosts.map((host, index) =>
        normalizeEvidenceHost(host, expected, `${field}.hosts[${index}]`),
      )
    : [];
  if (
    hosts.length !== 2 ||
    hosts.length > MAX_HOSTS_PER_PLATFORM ||
    hosts.length < requirement.minimumDistinctHosts ||
    new Set(hosts.map((host) => host.idDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerRegistrationId)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.artifactId)).size !== hosts.length ||
    new Set(hosts.map((host) => host.artifactName)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerName)).size !== hosts.length ||
    new Set(hosts.map((host) => host.hardwareIdentityDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.attesterMeasurementDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.bootIdDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.sourceJob.jobDatabaseId)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.signedExecutionReceiptDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.attesterRequestDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.reportDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.bundleDigest)).size !== hosts.length
  ) {
    fail(
      `${field}.hosts requires two independent registered physical runner jobs`,
      `${field}.hosts`,
    );
  }
  exactMembers(
    hosts.map((host) => host.jobSlot),
    ["a", "b"],
    `${field}.hostSlots`,
  );
  hosts.sort((left, right) => left.idDigest.localeCompare(right.idDigest));
  const artifacts = Array.isArray(input?.artifacts)
    ? input.artifacts.map((artifact, index) =>
        normalizeArtifact(artifact, `${field}.artifacts[${index}]`),
      )
    : [];
  if (
    artifacts.length !== 2 ||
    artifacts.length > MAX_ARTIFACTS_PER_PLATFORM ||
    new Set(artifacts.map((artifact) => artifact.digest)).size !==
      artifacts.length
  ) {
    fail(`${field}.artifacts must contain unique content digests`, field);
  }
  artifacts.sort((left, right) => left.digest.localeCompare(right.digest));
  const normalized = {
    platform,
    status: "passed",
    trust: normalizeTrust(input?.trust, expected, platform, `${field}.trust`),
    startedAt: started.value,
    endedAt: ended.value,
    durationMs,
    hosts,
    artifacts,
    metrics: normalizeMetrics(input?.metrics, requirement, `${field}.metrics`),
    evidenceDigest: String(input?.evidenceDigest || ""),
  };
  if (
    normalized.hosts.some(
      (host) =>
        host.inputManifestDigest !== normalized.trust.inputManifestDigest,
    )
  ) {
    fail(
      `${field}.hosts do not bind the platform protected input manifest`,
      `${field}.hosts`,
    );
  }
  normalized.evidenceDigest = verifyDigest(
    input,
    normalized,
    P1_10_PLATFORM_EVIDENCE_DOMAIN,
    "evidenceDigest",
  );
  return normalized;
}

function normalizeScenario(input, requirement, field, expected) {
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
          expected,
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
    fail("external evidence must use the current schema and explicitly pass");
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
  if (!evidence.trust || typeof evidence.trust !== "object") {
    fail("external evidence trust roots are required", "trust");
  }
  exactMembers(
    Object.keys(evidence.trust),
    [
      "harnessDigests",
      "registryDigest",
      "supervisorDigests",
      "inputManifestDigests",
      "scenarioContractDigest",
    ],
    "trust",
  );
  const registryDigest = sha256(
    evidence.trust.registryDigest,
    "trust.registryDigest",
  );
  if (registryDigest !== expectedContract.registryDigest) {
    fail(
      "external evidence registry digest does not match protected expectation",
    );
  }
  if (
    !evidence.trust.harnessDigests ||
    typeof evidence.trust.harnessDigests !== "object"
  ) {
    fail(
      "external evidence harness digests are required",
      "trust.harnessDigests",
    );
  }
  exactMembers(
    Object.keys(evidence.trust.harnessDigests),
    PLATFORMS,
    "trust.harnessDigests",
  );
  const harnessDigests = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      sha256(
        evidence.trust.harnessDigests[platform],
        `trust.harnessDigests.${platform}`,
      ),
    ]),
  );
  if (
    JSON.stringify(harnessDigests) !==
    JSON.stringify(expectedContract.harnessDigests)
  ) {
    fail(
      "external evidence harness digests do not match protected expectation",
    );
  }
  if (
    !evidence.trust.supervisorDigests ||
    typeof evidence.trust.supervisorDigests !== "object"
  ) {
    fail(
      "external evidence supervisor digests are required",
      "trust.supervisorDigests",
    );
  }
  exactMembers(
    Object.keys(evidence.trust.supervisorDigests),
    PLATFORMS,
    "trust.supervisorDigests",
  );
  const supervisorDigests = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      sha256(
        evidence.trust.supervisorDigests[platform],
        `trust.supervisorDigests.${platform}`,
      ),
    ]),
  );
  if (
    JSON.stringify(supervisorDigests) !==
    JSON.stringify(expectedContract.supervisorDigests)
  ) {
    fail(
      "external evidence supervisor digests do not match protected expectation",
    );
  }
  if (
    !evidence.trust.inputManifestDigests ||
    typeof evidence.trust.inputManifestDigests !== "object"
  ) {
    fail(
      "external evidence input manifest digests are required",
      "trust.inputManifestDigests",
    );
  }
  exactMembers(
    Object.keys(evidence.trust.inputManifestDigests),
    PLATFORMS,
    "trust.inputManifestDigests",
  );
  const inputManifestDigests = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      sha256(
        evidence.trust.inputManifestDigests[platform],
        `trust.inputManifestDigests.${platform}`,
      ),
    ]),
  );
  if (
    JSON.stringify(inputManifestDigests) !==
    JSON.stringify(expectedContract.inputManifestDigests)
  ) {
    fail(
      "external evidence input manifest digests do not match protected expectation",
    );
  }
  const scenarioContractDigest = sha256(
    evidence.trust.scenarioContractDigest,
    "trust.scenarioContractDigest",
  );
  if (scenarioContractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST) {
    fail(
      "external evidence scenario contract digest does not match this checkout",
    );
  }
  const trust = {
    registryDigest,
    harnessDigests,
    supervisorDigests,
    inputManifestDigests,
    scenarioContractDigest,
  };
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
      expectedContract,
    );
  });
  results.sort((left, right) => left.scenario.localeCompare(right.scenario));
  const physicalHosts = new Map();
  for (const host of results.flatMap((result) =>
    result.platforms.flatMap((platform) => platform.hosts),
  )) {
    const identity = {
      runnerRegistrationId: host.runnerRegistrationId,
      runnerName: host.runnerName,
      hardwareIdentityDigest: host.hardwareIdentityDigest,
      attesterMeasurementDigest: host.attesterMeasurementDigest,
      inputManifestDigest: host.inputManifestDigest,
      bootIdDigest: host.bootIdDigest,
      attesterRequestDigest: host.attesterRequestDigest,
      signedExecutionReceiptDigest: host.signedExecutionReceiptDigest,
      bundleDigest: host.bundleDigest,
      artifactId: host.artifactId,
      artifactName: host.artifactName,
      jobSlot: host.jobSlot,
      sourceJob: host.sourceJob,
    };
    const previous = physicalHosts.get(host.idDigest);
    if (
      previous &&
      JSON.stringify(canonicalValue(previous)) !==
        JSON.stringify(canonicalValue(identity))
    ) {
      fail(
        "a physical host identity changed between scenario cells",
        "results.hosts",
      );
    }
    physicalHosts.set(host.idDigest, identity);
  }
  if (physicalHosts.size !== 6) {
    fail("evidence must bind exactly six globally independent physical hosts");
  }
  for (const field of [
    "runnerRegistrationId",
    "runnerName",
    "artifactId",
    "artifactName",
    "hardwareIdentityDigest",
    "attesterMeasurementDigest",
    "bootIdDigest",
  ]) {
    if (
      new Set([...physicalHosts.values()].map((host) => host[field])).size !== 6
    ) {
      fail("six physical hosts must have globally unique " + field);
    }
  }
  const latestEnd = Math.max(
    ...results.flatMap((result) =>
      result.platforms.map((platform) => Date.parse(platform.endedAt)),
    ),
  );
  const issuedAt = canonicalTimestamp(evidence.issuedAt, "issuedAt");
  if (issuedAt.milliseconds < latestEnd) {
    fail("issuedAt cannot precede completed platform evidence", "issuedAt");
  }
  let verifiedAt = null;
  if (expected?.verifiedAt != null) {
    verifiedAt = canonicalTimestamp(expected.verifiedAt, "expected.verifiedAt");
    if (
      issuedAt.milliseconds > verifiedAt.milliseconds + MAX_FUTURE_SKEW_MS ||
      verifiedAt.milliseconds - issuedAt.milliseconds > MAX_EVIDENCE_AGE_MS
    ) {
      fail(
        "evidence issuedAt is outside the close verifier skew/TTL window",
        "issuedAt",
      );
    }
  }
  const normalized = {
    schema: P1_10_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha,
    matrixDigest: matrixContract.matrixDigest,
    producer,
    trust,
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
    trust,
    evidenceDigest: normalized.evidenceDigest,
    verificationModel: "exact-run-hosted-aggregate-verifier",
    hostVerifierBindingsDigest: digestP110Evidence(
      [...physicalHosts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([idDigest, identity]) => ({ idDigest, ...identity })),
      P1_10_HOSTED_VERIFIER_BINDINGS_DOMAIN,
    ),
    idempotencyKey: digestP110Evidence(
      {
        repository: producer.repository,
        runId: producer.runId,
        runAttempt: producer.runAttempt,
        evidenceDigest: normalized.evidenceDigest,
      },
      P1_10_CLOSE_IDEMPOTENCY_DOMAIN,
    ),
    ...(verifiedAt ? { verifiedAt: verifiedAt.value } : {}),
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
    "    --expected-registry-digest <sha256> \\",
    "    --expected-linux-harness-digest <sha256> \\",
    "    --expected-macos-harness-digest <sha256> \\",
    "    --expected-windows-harness-digest <sha256> \\",
    "    --expected-linux-supervisor-digest <sha256> \\",
    "    --expected-macos-supervisor-digest <sha256> \\",
    "    --expected-windows-supervisor-digest <sha256> \\",
    "    --expected-linux-input-manifest-digest <sha256> \\",
    "    --expected-macos-input-manifest-digest <sha256> \\",
    "    --expected-windows-input-manifest-digest <sha256> \\",
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
      "--expected-registry-digest": "registryDigest",
      "--expected-linux-harness-digest": "linuxHarnessDigest",
      "--expected-macos-harness-digest": "macosHarnessDigest",
      "--expected-windows-harness-digest": "windowsHarnessDigest",
      "--expected-linux-supervisor-digest": "linuxSupervisorDigest",
      "--expected-macos-supervisor-digest": "macosSupervisorDigest",
      "--expected-windows-supervisor-digest": "windowsSupervisorDigest",
      "--expected-linux-input-manifest-digest": "linuxInputManifestDigest",
      "--expected-macos-input-manifest-digest": "macosInputManifestDigest",
      "--expected-windows-input-manifest-digest": "windowsInputManifestDigest",
      "--verified-at": "verifiedAt",
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
  let descriptor;
  try {
    const before = fs.lstatSync(resolved);
    if (before.isSymbolicLink()) {
      fail(`${field} must not be a symbolic link`, field);
    }
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const opened = fs.fstatSync(descriptor);
    const sameIdentity = (left, right) =>
      left.dev === right.dev &&
      left.ino === right.ino &&
      left.size === right.size &&
      left.mtimeMs === right.mtimeMs &&
      left.ctimeMs === right.ctimeMs &&
      left.mode === right.mode &&
      left.nlink === right.nlink;
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size < 1 ||
      opened.size > MAX_JSON_BYTES ||
      !sameIdentity(before, opened)
    ) {
      fail(`${field} must be a stable bounded regular file`, field);
    }
    const bytes = fs.readFileSync(descriptor);
    const openedAfter = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(resolved);
    if (
      bytes.length !== opened.size ||
      !sameIdentity(opened, openedAfter) ||
      !sameIdentity(opened, pathAfter)
    ) {
      fail(`${field} changed while its verified descriptor was open`, field);
    }
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error?.code === "CC_P1_10_EXTERNAL_EVIDENCE_INVALID") throw error;
    fail(`${field} cannot be opened as stable JSON: ${error.message}`, field);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
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
    registryDigest: options.registryDigest,
    harnessDigests: {
      linux: options.linuxHarnessDigest,
      macos: options.macosHarnessDigest,
      windows: options.windowsHarnessDigest,
    },
    supervisorDigests: {
      linux: options.linuxSupervisorDigest,
      macos: options.macosSupervisorDigest,
      windows: options.windowsSupervisorDigest,
    },
    inputManifestDigests: {
      linux: options.linuxInputManifestDigest,
      macos: options.macosInputManifestDigest,
      windows: options.windowsInputManifestDigest,
    },
    verifiedAt: options.verifiedAt || new Date().toISOString(),
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
