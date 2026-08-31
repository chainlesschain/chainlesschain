#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  digestP110Evidence,
  P1_10_EVIDENCE_DOMAIN,
  P1_10_EVIDENCE_SCHEMA,
  P1_10_MATRIX_DOMAIN,
  P1_10_PLATFORM_EVIDENCE_DOMAIN,
  P1_10_SCENARIO_EVIDENCE_DOMAIN,
  validateExternalEvidence,
} from "./p1-10-external-evidence-gate.mjs";
import { runOwnedProcess } from "./p1-10-owned-process-runner.mjs";
import {
  deriveScenarioMetrics,
  normalizeScenarioReceipt,
  P1_10_SCENARIO_CONTRACT_DIGEST,
  P1_10_SCENARIO_RECEIPT_SCHEMAS,
} from "./p1-10-scenario-receipts.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const defaultMatrixPath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "p1-10-conformance-matrix.json",
);
const defaultRegistryPath = path.join(
  repoRoot,
  ".github",
  "p1-10-physical-host-registry.json",
);
const windowsSupervisorPath = path.join(
  scriptDirectory,
  "p1-10-windows-job-supervisor.ps1",
);

export const P1_10_PRODUCER_WORKFLOW =
  ".github/workflows/p1-10-external-evidence-producer.yml";
export const P1_10_PRODUCER_ENVIRONMENT = "p1-10-external-conformance";
export const P1_10_RAW_REPORT_SCHEMA =
  "chainlesschain.p1-10-raw-host-scenario-report/v3";
export const P1_10_HOST_REGISTRY_SCHEMA =
  "chainlesschain.p1-10-physical-host-registry/v3";
export const P1_10_PLATFORM_BUNDLE_SCHEMA =
  "chainlesschain.p1-10-physical-host-bundle/v3";
export const P1_10_HARNESS_EXECUTION_SCHEMA =
  "chainlesschain.p1-10-builder-harness-execution/v2";
export const P1_10_PROTECTED_INPUT_MANIFEST_SCHEMA =
  "chainlesschain.p1-10-protected-input-manifest/v1";
export const P1_10_RAW_REPORT_SIGNATURE_DOMAIN =
  "cc.p1-10.raw-host-scenario-signature/v3";
export const P1_10_RAW_REPORT_DIGEST_DOMAIN =
  "cc.p1-10.raw-host-scenario-report/v3";
export const P1_10_PLATFORM_BUNDLE_DOMAIN = "cc.p1-10.physical-host-bundle/v3";
export const P1_10_HOST_REGISTRY_DOMAIN = "cc.p1-10.physical-host-registry/v3";
export const P1_10_HARNESS_EXECUTION_DOMAIN =
  "cc.p1-10.builder-harness-execution/v2";
export const P1_10_HARNESS_EXECUTION_SIGNATURE_DOMAIN =
  "cc.p1-10.builder-harness-execution-signature/v2";
export const P1_10_SIGNED_HARNESS_EXECUTION_DOMAIN =
  "cc.p1-10.signed-builder-harness-execution/v2";
export const P1_10_ATTESTER_REQUEST_SCHEMA =
  "chainlesschain.p1-10-local-attester-request/v2";
export const P1_10_ATTESTER_REQUEST_DOMAIN =
  "cc.p1-10.local-attester-request/v2";
export const P1_10_PROTECTED_INPUT_MANIFEST_DOMAIN =
  "cc.p1-10.protected-input-manifest/v1";
export const P1_10_FIXTURE_SET_DOMAIN = "cc.p1-10.protected-fixture-set/v1";

const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const EXECUTION_ID = /^[A-Za-z0-9_-]{32,128}$/u;
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const HOST_SLOTS = Object.freeze(["a", "b"]);
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_FIXTURE_BYTES = 64 * 1024 * 1024;
const MAX_HARNESS_BYTES = 128 * 1024 * 1024;
const MAX_ATTESTER_BYTES = 128 * 1024 * 1024;
const MAX_HARNESS_OUTPUT_BYTES = 1024 * 1024;
const HARNESS_TIMEOUT_MS = 100 * 60 * 1000;
const MAX_WALL_MONOTONIC_DRIFT_MS = 60_000;
const CONTAINMENT_BY_PLATFORM = Object.freeze({
  linux: "linux-delegated-cgroup-v2",
  macos: "macos-strong-external-supervisor",
  windows: "windows-job-object",
});

function fail(message, field = "") {
  const error = new Error(message);
  error.name = "P110ExternalEvidenceBuilderError";
  error.code = "CC_P1_10_EXTERNAL_EVIDENCE_BUILD_INVALID";
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

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function exactKeys(value, expectedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(field + " must be an object", field);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(field + " must contain exactly: " + expected.join(", "), field);
  }
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
      field + " must contain exactly: " + normalizedExpected.join(", "),
      field,
    );
  }
}

function boundedText(value, field, maximumBytes = 1024) {
  if (typeof value !== "string") fail(field + " must be a string", field);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    fail(field + " must be a non-empty bounded string", field);
  }
  return normalized;
}

function exactCommit(value, field) {
  if (typeof value !== "string" || !COMMIT.test(value)) {
    fail(field + " must be an exact lowercase 40-character commit", field);
  }
  return value;
}

function exactDigest(value, field) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(field + " must be a lowercase sha256 digest", field);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(field + " must be a positive safe integer", field);
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(field + " must be a non-negative safe integer", field);
  }
  return value;
}

function canonicalTimestamp(value, field) {
  if (typeof value !== "string") fail(field + " must be a timestamp", field);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(field + " must be a canonical timestamp", field);
  }
  return { value, milliseconds };
}

function apiTimestamp(value, field) {
  if (typeof value !== "string") fail(field + " must be a timestamp", field);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    fail(field + " must be a valid timestamp", field);
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

function sha256Buffer(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mode === right.mode &&
    left.nlink === right.nlink
  );
}

function readRegularBytes(file, field, maximumBytes) {
  const resolved = path.resolve(file);
  let descriptor;
  try {
    const pathBefore = fs.lstatSync(resolved);
    if (pathBefore.isSymbolicLink()) {
      fail(field + " must not be a symbolic link", field);
    }
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size < 1 ||
      stat.size > maximumBytes ||
      !sameFileIdentity(pathBefore, stat)
    ) {
      fail(
        field + " must be a stable bounded non-hardlinked regular file",
        field,
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const openedAfter = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(resolved);
    if (
      bytes.length !== stat.size ||
      !sameFileIdentity(stat, openedAfter) ||
      !sameFileIdentity(stat, pathAfter)
    ) {
      fail(field + " changed while its verified descriptor was open", field);
    }
    return { resolved, stat, bytes };
  } catch (error) {
    if (error?.code === "CC_P1_10_EXTERNAL_EVIDENCE_BUILD_INVALID") throw error;
    fail(
      field + " cannot be opened without following links: " + error.message,
      field,
    );
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function readJsonDocument(file, field, maximumBytes = MAX_JSON_BYTES) {
  const document = readRegularBytes(file, field, maximumBytes);
  try {
    return { ...document, value: JSON.parse(document.bytes.toString("utf8")) };
  } catch (error) {
    fail(field + " is not valid JSON: " + error.message, field);
  }
}

function readJson(file, field, maximumBytes = MAX_JSON_BYTES) {
  return readJsonDocument(file, field, maximumBytes).value;
}

function writeJson(file, value, exclusive = false) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(
    resolved,
    JSON.stringify(value, null, 2) + "\n",
    exclusive ? { encoding: "utf8", flag: "wx" } : "utf8",
  );
}

function parseJsonText(value, field) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 2 ||
    Buffer.byteLength(value, "utf8") > MAX_JSON_BYTES
  ) {
    fail(field + " must contain bounded JSON", field);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(field + " is not valid JSON: " + error.message, field);
  }
}

function normalizeExpected(input) {
  exactKeys(
    input,
    [
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
    ],
    "expected",
  );
  const repository = boundedText(input.repository, "expected.repository", 201);
  if (!REPOSITORY.test(repository))
    fail("expected.repository must be owner/repository", "expected.repository");
  if (input.workflow !== P1_10_PRODUCER_WORKFLOW) {
    fail(
      "expected.workflow must be the fixed P1-10 producer",
      "expected.workflow",
    );
  }
  if (input.environment !== P1_10_PRODUCER_ENVIRONMENT) {
    fail(
      "expected.environment must be the protected P1-10 environment",
      "expected.environment",
    );
  }
  if (typeof input.challenge !== "string" || !CHALLENGE.test(input.challenge)) {
    fail(
      "expected.challenge must be a 32-128 character URL-safe token",
      "expected.challenge",
    );
  }
  exactKeys(input.harnessDigests, PLATFORMS, "expected.harnessDigests");
  exactKeys(input.supervisorDigests, PLATFORMS, "expected.supervisorDigests");
  exactKeys(
    input.inputManifestDigests,
    PLATFORMS,
    "expected.inputManifestDigests",
  );
  return {
    commitSha: exactCommit(input.commitSha, "expected.commitSha"),
    repository,
    workflow: input.workflow,
    runId: positiveInteger(input.runId, "expected.runId"),
    runAttempt: positiveInteger(input.runAttempt, "expected.runAttempt"),
    environment: input.environment,
    challenge: input.challenge,
    registryDigest: exactDigest(
      input.registryDigest,
      "expected.registryDigest",
    ),
    harnessDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        exactDigest(
          input.harnessDigests[platform],
          "expected.harnessDigests." + platform,
        ),
      ]),
    ),
    supervisorDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        exactDigest(
          input.supervisorDigests[platform],
          "expected.supervisorDigests." + platform,
        ),
      ]),
    ),
    inputManifestDigests: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        exactDigest(
          input.inputManifestDigests[platform],
          "expected.inputManifestDigests." + platform,
        ),
      ]),
    ),
  };
}

function producerFromExpected(expected) {
  return {
    repository: expected.repository,
    workflow: expected.workflow,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    environment: expected.environment,
    challenge: expected.challenge,
  };
}

function normalizeProducer(input, expected, field) {
  exactKeys(
    input,
    [
      "repository",
      "workflow",
      "runId",
      "runAttempt",
      "environment",
      "challenge",
    ],
    field,
  );
  const normalized = producerFromExpected(expected);
  for (const [key, value] of Object.entries(normalized)) {
    if (input[key] !== value)
      fail(
        field + "." + key + " does not match this producer run",
        field + "." + key,
      );
  }
  return normalized;
}

function normalizeFixturePath(value, field) {
  const normalized = boundedText(value, field, 512);
  if (
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === "." ||
    normalized.startsWith("../")
  ) {
    fail(field + " must be a canonical repository-relative path", field);
  }
  return normalized;
}

function normalizeRequirement(
  cell,
  scenarioId,
  scenarioInterface,
  scenarioFixtures,
) {
  const evidenceScenario = boundedText(
    cell.evidenceScenario,
    scenarioId + ".evidenceScenario",
    128,
  );
  const requiredPlatforms = Array.isArray(cell.requiredPlatforms)
    ? cell.requiredPlatforms.map((platform) =>
        boundedText(platform, evidenceScenario + ".platform", 16).toLowerCase(),
      )
    : [];
  if (
    requiredPlatforms.length < 1 ||
    requiredPlatforms.some((platform) => !PLATFORMS.includes(platform))
  ) {
    fail(evidenceScenario + ".requiredPlatforms must name supported platforms");
  }
  exactMembers(
    requiredPlatforms,
    [...new Set(requiredPlatforms)],
    evidenceScenario + ".requiredPlatforms",
  );
  const positive = Array.isArray(cell.requiredMetrics?.positive)
    ? cell.requiredMetrics.positive.map((metric) =>
        boundedText(metric, evidenceScenario + ".positiveMetric", 128),
      )
    : [];
  const zero = Array.isArray(cell.requiredMetrics?.zero)
    ? cell.requiredMetrics.zero.map((metric) =>
        boundedText(metric, evidenceScenario + ".zeroMetric", 128),
      )
    : [];
  if (
    positive.length < 1 ||
    zero.length < 1 ||
    new Set([...positive, ...zero]).size !== positive.length + zero.length
  ) {
    fail(evidenceScenario + " must define unique positive and zero metrics");
  }
  if (!P1_10_SCENARIO_RECEIPT_SCHEMAS[evidenceScenario]) {
    fail(evidenceScenario + " has no reviewed scenario receipt schema");
  }
  return {
    matrixScenarioId: scenarioId,
    interface: boundedText(scenarioInterface, scenarioId + ".interface", 256),
    fixturePaths: scenarioFixtures.map((fixture, index) =>
      normalizeFixturePath(fixture, scenarioId + ".fixtures[" + index + "]"),
    ),
    evidenceScenario,
    requiredPlatforms: [...requiredPlatforms].sort(),
    minimumDurationMs: positiveInteger(
      cell.minimumDurationMs,
      evidenceScenario + ".minimumDurationMs",
    ),
    minimumDistinctHosts: positiveInteger(
      cell.minimumDistinctHosts,
      evidenceScenario + ".minimumDistinctHosts",
    ),
    requiredMetrics: { positive: [...positive].sort(), zero: [...zero].sort() },
  };
}

function normalizeMatrix(matrix) {
  if (matrix?.schema !== "chainlesschain.p1-10-conformance-matrix/v1") {
    fail("invalid P1-10 matrix schema", "matrix.schema");
  }
  const requirements = [];
  for (const scenario of Array.isArray(matrix.scenarios)
    ? matrix.scenarios
    : []) {
    const scenarioId = boundedText(scenario?.id, "scenario.id", 128);
    if (!Array.isArray(scenario?.fixtures)) {
      fail(scenarioId + ".fixtures must be an array", scenarioId + ".fixtures");
    }
    const scenarioFixtures = scenario.fixtures.map((fixture, index) =>
      normalizeFixturePath(fixture, scenarioId + ".fixtures[" + index + "]"),
    );
    exactMembers(
      scenarioFixtures,
      [...new Set(scenarioFixtures)],
      scenarioId + ".fixtures",
    );
    for (const cell of Array.isArray(scenario?.cells) ? scenario.cells : []) {
      if (cell?.status === "external-required") {
        requirements.push(
          normalizeRequirement(
            cell,
            scenarioId,
            scenario.interface,
            scenarioFixtures,
          ),
        );
      }
    }
  }
  requirements.sort((left, right) =>
    left.evidenceScenario.localeCompare(right.evidenceScenario),
  );
  if (requirements.length < 1)
    fail("P1-10 matrix has no external requirements", "matrix");
  exactMembers(
    requirements.map((entry) => entry.evidenceScenario),
    [...new Set(requirements.map((entry) => entry.evidenceScenario))],
    "matrix.externalScenarios",
  );
  return {
    requirements,
    matrixDigest: digestP110Evidence(matrix, P1_10_MATRIX_DOMAIN),
  };
}

const PROTECTED_INPUT_FIELDS = Object.freeze({
  "real-multi-host-causal-agent-stream": [
    "payloadSetDigest",
    "minimumMessagesPerHost",
  ],
  "cross-version-graph-definition-migration": [
    "sourceVersion",
    "targetVersion",
    "sourceRuntimeArtifactDigest",
    "targetRuntimeArtifactDigest",
    "packageDigest",
    "packageSignatureDigest",
    "sourceStateDigest",
    "expectedMigratedDigest",
  ],
  "packaged-electron-collaboration-crash-recovery": [
    "packageDigest",
    "packageSignatureDigest",
    "collaborationFixtureDigest",
    "minimumRemoteUpdatesPerCrash",
  ],
  "two-physical-host-mtc-roundtrip": [
    "payloadSetDigest",
    "minimumRoundTripsPerHost",
  ],
  "long-running-desktop-soak": [
    "operationProfileDigest",
    "minimumOperationsPerWindow",
  ],
});

const PROTECTED_INPUT_COMMON_FIELDS = Object.freeze([
  "scenario",
  "matrixScenarioId",
  "interface",
  "fixtures",
  "fixtureSetDigest",
  "workloadProfileDigest",
]);

function reviewedFixtureDescriptors(requirement) {
  const fixtures = requirement.fixturePaths.map((fixturePath, index) => {
    const absolute = path.resolve(repoRoot, ...fixturePath.split("/"));
    const relative = path.relative(repoRoot, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      fail(
        "reviewed fixture path escapes the exact checkout",
        requirement.evidenceScenario + ".fixtures[" + index + "]",
      );
    }
    const document = readRegularBytes(
      absolute,
      requirement.evidenceScenario + ".fixtures[" + index + "]",
      MAX_FIXTURE_BYTES,
    );
    return {
      path: fixturePath,
      digest: sha256Buffer(document.bytes),
      sizeBytes: document.bytes.length,
    };
  });
  return {
    fixtures,
    fixtureSetDigest: digestP110Evidence(
      { fixtures },
      P1_10_FIXTURE_SET_DOMAIN,
    ),
  };
}

function normalizeManifestFixture(input, field) {
  exactKeys(input, ["path", "digest", "sizeBytes"], field);
  return {
    path: normalizeFixturePath(input.path, field + ".path"),
    digest: exactDigest(input.digest, field + ".digest"),
    sizeBytes: positiveInteger(input.sizeBytes, field + ".sizeBytes"),
  };
}

function normalizeProtectedScenarioInput(input, requirement, field) {
  const scenario = requirement.evidenceScenario;
  const extraFields = PROTECTED_INPUT_FIELDS[scenario];
  if (!extraFields) fail("protected input scenario is unsupported", field);
  exactKeys(input, [...PROTECTED_INPUT_COMMON_FIELDS, ...extraFields], field);
  const fixtures = Array.isArray(input.fixtures)
    ? input.fixtures.map((fixture, index) =>
        normalizeManifestFixture(fixture, field + ".fixtures[" + index + "]"),
      )
    : fail(field + ".fixtures must be an array", field + ".fixtures");
  const reviewed = reviewedFixtureDescriptors(requirement);
  if (
    JSON.stringify(canonicalValue(fixtures)) !==
      JSON.stringify(canonicalValue(reviewed.fixtures)) ||
    input.fixtureSetDigest !== reviewed.fixtureSetDigest
  ) {
    fail(
      field + " does not bind the exact reviewed checkout fixture bytes",
      field + ".fixtures",
    );
  }
  const common = {
    scenario,
    matrixScenarioId: boundedText(
      input.matrixScenarioId,
      field + ".matrixScenarioId",
      128,
    ),
    interface: boundedText(input.interface, field + ".interface", 256),
    fixtures,
    fixtureSetDigest: exactDigest(
      input.fixtureSetDigest,
      field + ".fixtureSetDigest",
    ),
    workloadProfileDigest: exactDigest(
      input.workloadProfileDigest,
      field + ".workloadProfileDigest",
    ),
  };
  if (
    input.scenario !== scenario ||
    common.matrixScenarioId !== requirement.matrixScenarioId ||
    common.interface !== requirement.interface
  ) {
    fail(field + " does not match its reviewed matrix scenario", field);
  }
  if (scenario === "real-multi-host-causal-agent-stream") {
    return {
      ...common,
      payloadSetDigest: exactDigest(
        input.payloadSetDigest,
        field + ".payloadSetDigest",
      ),
      minimumMessagesPerHost: positiveInteger(
        input.minimumMessagesPerHost,
        field + ".minimumMessagesPerHost",
      ),
    };
  }
  if (scenario === "cross-version-graph-definition-migration") {
    const sourceVersion = boundedText(
      input.sourceVersion,
      field + ".sourceVersion",
      64,
    );
    const targetVersion = boundedText(
      input.targetVersion,
      field + ".targetVersion",
      64,
    );
    const sourceRuntimeArtifactDigest = exactDigest(
      input.sourceRuntimeArtifactDigest,
      field + ".sourceRuntimeArtifactDigest",
    );
    const targetRuntimeArtifactDigest = exactDigest(
      input.targetRuntimeArtifactDigest,
      field + ".targetRuntimeArtifactDigest",
    );
    if (
      sourceVersion === targetVersion ||
      sourceRuntimeArtifactDigest === targetRuntimeArtifactDigest
    ) {
      fail(field + " must pin distinct source and target runtimes", field);
    }
    return {
      ...common,
      sourceVersion,
      targetVersion,
      sourceRuntimeArtifactDigest,
      targetRuntimeArtifactDigest,
      packageDigest: exactDigest(input.packageDigest, field + ".packageDigest"),
      packageSignatureDigest: exactDigest(
        input.packageSignatureDigest,
        field + ".packageSignatureDigest",
      ),
      sourceStateDigest: exactDigest(
        input.sourceStateDigest,
        field + ".sourceStateDigest",
      ),
      expectedMigratedDigest: exactDigest(
        input.expectedMigratedDigest,
        field + ".expectedMigratedDigest",
      ),
    };
  }
  if (scenario === "packaged-electron-collaboration-crash-recovery") {
    const collaborationFixtureDigest = exactDigest(
      input.collaborationFixtureDigest,
      field + ".collaborationFixtureDigest",
    );
    if (collaborationFixtureDigest !== common.fixtureSetDigest) {
      fail(
        field + " collaboration fixture must be the reviewed fixture set",
        field + ".collaborationFixtureDigest",
      );
    }
    return {
      ...common,
      packageDigest: exactDigest(input.packageDigest, field + ".packageDigest"),
      packageSignatureDigest: exactDigest(
        input.packageSignatureDigest,
        field + ".packageSignatureDigest",
      ),
      collaborationFixtureDigest,
      minimumRemoteUpdatesPerCrash: positiveInteger(
        input.minimumRemoteUpdatesPerCrash,
        field + ".minimumRemoteUpdatesPerCrash",
      ),
    };
  }
  if (scenario === "two-physical-host-mtc-roundtrip") {
    return {
      ...common,
      payloadSetDigest: exactDigest(
        input.payloadSetDigest,
        field + ".payloadSetDigest",
      ),
      minimumRoundTripsPerHost: positiveInteger(
        input.minimumRoundTripsPerHost,
        field + ".minimumRoundTripsPerHost",
      ),
    };
  }
  return {
    ...common,
    operationProfileDigest: exactDigest(
      input.operationProfileDigest,
      field + ".operationProfileDigest",
    ),
    minimumOperationsPerWindow: positiveInteger(
      input.minimumOperationsPerWindow,
      field + ".minimumOperationsPerWindow",
    ),
  };
}

function scenarioInputForReceipt(input) {
  const common = {
    scenario: input.scenario,
    interface: input.interface,
    fixtureSetDigest: input.fixtureSetDigest,
    workloadProfileDigest: input.workloadProfileDigest,
  };
  return Object.fromEntries(
    Object.entries({ ...common, ...input }).filter(
      ([key]) =>
        Object.hasOwn(common, key) ||
        PROTECTED_INPUT_FIELDS[input.scenario].includes(key),
    ),
  );
}

function normalizeProtectedInputManifest(
  input,
  { platform, expected, matrix, manifestDigest },
) {
  exactKeys(
    input,
    [
      "schema",
      "platform",
      "commitSha",
      "matrixDigest",
      "scenarioContractDigest",
      "scenarios",
    ],
    "inputManifest",
  );
  if (
    input.schema !== P1_10_PROTECTED_INPUT_MANIFEST_SCHEMA ||
    input.platform !== platform ||
    exactCommit(input.commitSha, "inputManifest.commitSha") !==
      expected.commitSha ||
    input.matrixDigest !== matrix.matrixDigest ||
    input.scenarioContractDigest !== P1_10_SCENARIO_CONTRACT_DIGEST ||
    manifestDigest !== expected.inputManifestDigests[platform]
  ) {
    fail(
      "protected input manifest does not match the exact commit, matrix, contract, platform, and digest pin",
      "inputManifest",
    );
  }
  const expectedScenarios = scenarioRequirements(matrix, platform);
  const inputs = Array.isArray(input.scenarios)
    ? input.scenarios.map((scenarioInput, index) => {
        const scenario = boundedText(
          scenarioInput?.scenario,
          "inputManifest.scenarios[" + index + "].scenario",
          128,
        );
        const requirement = expectedScenarios.find(
          (candidate) => candidate.evidenceScenario === scenario,
        );
        if (!requirement) {
          fail(
            "protected input manifest contains an unexpected scenario",
            "inputManifest.scenarios[" + index + "]",
          );
        }
        return normalizeProtectedScenarioInput(
          scenarioInput,
          requirement,
          "inputManifest.scenarios[" + index + "]",
        );
      })
    : fail(
        "inputManifest.scenarios must be an array",
        "inputManifest.scenarios",
      );
  exactMembers(
    inputs.map((entry) => entry.scenario),
    expectedScenarios.map((entry) => entry.evidenceScenario),
    "inputManifest.scenarios",
  );
  inputs.sort((left, right) => left.scenario.localeCompare(right.scenario));
  const body = {
    schema: P1_10_PROTECTED_INPUT_MANIFEST_SCHEMA,
    platform,
    commitSha: expected.commitSha,
    matrixDigest: matrix.matrixDigest,
    scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    scenarios: inputs,
  };
  return {
    ...body,
    manifestDigest,
    byScenario: new Map(
      inputs.map((entry) => [entry.scenario, scenarioInputForReceipt(entry)]),
    ),
  };
}

export function physicalHostIdDigest(publicKeyPem) {
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch (error) {
    fail(
      "physical host public key is invalid: " + error.message,
      "publicKeyPem",
    );
  }
  if (key.asymmetricKeyType !== "ed25519")
    fail("physical host public key must use Ed25519", "publicKeyPem");
  return sha256Buffer(key.export({ type: "spki", format: "der" }));
}

export function physicalHostRegistryDigest(input) {
  return normalizeRegistry(input, false).registryDigest;
}

function normalizeRegistry(input, requireComplete = true) {
  exactKeys(input, ["schema", "hosts"], "registry");
  if (input.schema !== P1_10_HOST_REGISTRY_SCHEMA)
    fail("invalid physical host registry schema", "registry.schema");
  if (!Array.isArray(input.hosts))
    fail("physical host registry hosts must be an array", "registry.hosts");
  const hosts = input.hosts.map((host, index) => {
    const field = "registry.hosts[" + index + "]";
    exactKeys(
      host,
      [
        "idDigest",
        "platform",
        "hostSlot",
        "runnerRegistrationId",
        "runnerName",
        "hardwareIdentityDigest",
        "requiredLabels",
        "hostClass",
        "publicKeyPem",
        "enabled",
        "validFrom",
        "validUntil",
        "workflow",
        "environment",
        "attesterId",
        "attesterVersion",
        "attesterEndpoint",
        "attesterMeasurementDigest",
        "supervisorDigest",
        "supervisorVersion",
        "inputManifestDigest",
      ],
      field,
    );
    const platform = boundedText(
      host.platform,
      field + ".platform",
      16,
    ).toLowerCase();
    const hostSlot = boundedText(
      host.hostSlot,
      field + ".hostSlot",
      8,
    ).toLowerCase();
    if (!PLATFORMS.includes(platform) || !HOST_SLOTS.includes(hostSlot))
      fail(field + " has an unsupported platform/slot", field);
    if (host.hostClass !== "physical" || host.enabled !== true)
      fail(field + " must be an enabled physical host", field);
    if (
      host.workflow !== P1_10_PRODUCER_WORKFLOW ||
      host.environment !== P1_10_PRODUCER_ENVIRONMENT
    ) {
      fail(
        field + " must be enrolled only for the fixed workflow/environment",
        field,
      );
    }
    if (host.attesterEndpoint !== "local://p1-10-non-exportable-attester") {
      fail(
        field + " must use the fixed local non-exportable attester endpoint",
        field,
      );
    }
    const requiredLabels = Array.isArray(host.requiredLabels)
      ? host.requiredLabels.map((label) =>
          boundedText(label, field + ".requiredLabels", 128),
        )
      : [];
    exactMembers(
      requiredLabels,
      [
        "self-hosted",
        "physical",
        "p1-10-external-conformance",
        platform,
        "p1-10-host-" + hostSlot,
      ],
      field + ".requiredLabels",
    );
    const validFrom = canonicalTimestamp(host.validFrom, field + ".validFrom");
    const validUntil = canonicalTimestamp(
      host.validUntil,
      field + ".validUntil",
    );
    if (validUntil.milliseconds <= validFrom.milliseconds)
      fail(field + " has an invalid enrollment window", field);
    const publicKeyPem = boundedText(
      host.publicKeyPem,
      field + ".publicKeyPem",
      4096,
    );
    const idDigest = exactDigest(host.idDigest, field + ".idDigest");
    if (idDigest !== physicalHostIdDigest(publicKeyPem))
      fail(field + ".idDigest does not identify its Ed25519 key", field);
    return {
      idDigest,
      platform,
      hostSlot,
      runnerRegistrationId: positiveInteger(
        host.runnerRegistrationId,
        field + ".runnerRegistrationId",
      ),
      runnerName: boundedText(host.runnerName, field + ".runnerName", 128),
      hardwareIdentityDigest: exactDigest(
        host.hardwareIdentityDigest,
        field + ".hardwareIdentityDigest",
      ),
      requiredLabels: [...requiredLabels].sort(),
      hostClass: "physical",
      publicKeyPem,
      enabled: true,
      validFrom: validFrom.value,
      validUntil: validUntil.value,
      workflow: P1_10_PRODUCER_WORKFLOW,
      environment: P1_10_PRODUCER_ENVIRONMENT,
      attesterId: boundedText(host.attesterId, field + ".attesterId", 128),
      attesterVersion: boundedText(
        host.attesterVersion,
        field + ".attesterVersion",
        64,
      ),
      attesterEndpoint: "local://p1-10-non-exportable-attester",
      attesterMeasurementDigest: exactDigest(
        host.attesterMeasurementDigest,
        field + ".attesterMeasurementDigest",
      ),
      supervisorDigest: exactDigest(
        host.supervisorDigest,
        field + ".supervisorDigest",
      ),
      supervisorVersion: boundedText(
        host.supervisorVersion,
        field + ".supervisorVersion",
        64,
      ),
      inputManifestDigest: exactDigest(
        host.inputManifestDigest,
        field + ".inputManifestDigest",
      ),
    };
  });
  if (
    new Set(hosts.map((host) => host.idDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerName)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerRegistrationId)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.hardwareIdentityDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.attesterId)).size !== hosts.length ||
    new Set(hosts.map((host) => host.attesterMeasurementDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.platform + "\0" + host.hostSlot)).size !==
      hosts.length
  ) {
    fail(
      "registry physical runner identities must be unique",
      "registry.hosts",
    );
  }
  if (requireComplete) {
    if (hosts.length !== PLATFORMS.length * HOST_SLOTS.length) {
      fail(
        "checked-in registry enrollment is incomplete; six real physical runners are required",
        "registry.hosts",
      );
    }
    for (const platform of PLATFORMS) {
      exactMembers(
        hosts
          .filter((host) => host.platform === platform)
          .map((host) => host.hostSlot),
        HOST_SLOTS,
        "registry." + platform + ".hostSlots",
      );
    }
  }
  hosts.sort((left, right) => left.idDigest.localeCompare(right.idDigest));
  const body = { schema: P1_10_HOST_REGISTRY_SCHEMA, hosts };
  return {
    ...body,
    registryDigest: digestP110Evidence(body, P1_10_HOST_REGISTRY_DOMAIN),
    byDigest: new Map(hosts.map((host) => [host.idDigest, host])),
    byRunnerName: new Map(hosts.map((host) => [host.runnerName, host])),
  };
}

function requireRegistryDigest(registry, expected) {
  if (registry.registryDigest !== expected.registryDigest) {
    fail(
      "checked-in host registry does not match the protected digest pin",
      "registryDigest",
    );
  }
}

function normalizeCollector(input, platform, registry, expected) {
  exactKeys(
    input,
    [
      "runnerName",
      "runnerEnvironment",
      "runnerOs",
      "runnerRegistrationId",
      "jobDatabaseId",
      "jobName",
      "jobId",
      "jobSlot",
      "labels",
      "jobStartedAt",
    ],
    "collector",
  );
  if (input.runnerEnvironment !== "self-hosted") {
    fail(
      "P1-10 physical evidence cannot run on a GitHub-hosted runner",
      "collector.runnerEnvironment",
    );
  }
  const osPlatforms = { Linux: "linux", macOS: "macos", Windows: "windows" };
  if (osPlatforms[input.runnerOs] !== platform)
    fail(
      "collector runner OS does not match its platform",
      "collector.runnerOs",
    );
  const runnerName = boundedText(input.runnerName, "collector.runnerName", 128);
  const registered = registry.byRunnerName.get(runnerName);
  const jobSlot = boundedText(
    input.jobSlot,
    "collector.jobSlot",
    8,
  ).toLowerCase();
  if (
    !registered ||
    registered.platform !== platform ||
    registered.hostSlot !== jobSlot ||
    input.runnerRegistrationId !== registered.runnerRegistrationId
  ) {
    fail(
      "collector must match its registered physical runner, id, and fixed host slot",
      "collector.runnerName",
    );
  }
  if (registered.supervisorDigest !== expected.supervisorDigests[platform]) {
    fail(
      "registered local attester/supervisor digest does not match the protected pin",
      "collector.runnerName",
    );
  }
  if (
    registered.inputManifestDigest !== expected.inputManifestDigests[platform]
  ) {
    fail(
      "registered protected input manifest does not match the protected pin",
      "collector.runnerName",
    );
  }
  if (input.jobId !== "collect-host")
    fail(
      "collector must originate from the fixed collect-host job",
      "collector.jobId",
    );
  const requiredJobName =
    "Collect authenticated host (" + platform + "/" + jobSlot + ")";
  if (input.jobName !== requiredJobName)
    fail(
      "collector job name is not the fixed matrix identity",
      "collector.jobName",
    );
  const labels = Array.isArray(input.labels)
    ? input.labels.map((label) => boundedText(label, "collector.labels", 128))
    : [];
  if (
    labels.length < registered.requiredLabels.length ||
    labels.length > 32 ||
    new Set(labels).size !== labels.length ||
    registered.requiredLabels.some((label) => !labels.includes(label))
  ) {
    fail(
      "collector labels do not include every checked-in required label",
      "collector.labels",
    );
  }
  const jobStartedAt = canonicalTimestamp(
    input.jobStartedAt,
    "collector.jobStartedAt",
  );
  const validFrom = Date.parse(registered.validFrom);
  const validUntil = Date.parse(registered.validUntil);
  if (
    jobStartedAt.milliseconds < validFrom ||
    jobStartedAt.milliseconds > validUntil
  ) {
    fail(
      "collector job is outside its checked-in enrollment validity",
      "collector.jobStartedAt",
    );
  }
  return {
    hostIdDigest: registered.idDigest,
    hostClass: "physical",
    hostSlot: registered.hostSlot,
    runnerRegistrationId: registered.runnerRegistrationId,
    runnerName,
    hardwareIdentityDigest: registered.hardwareIdentityDigest,
    runnerEnvironment: "self-hosted",
    runnerOs: input.runnerOs,
    labels: [...labels].sort(),
    attesterId: registered.attesterId,
    attesterVersion: registered.attesterVersion,
    attesterEndpoint: registered.attesterEndpoint,
    attesterMeasurementDigest: registered.attesterMeasurementDigest,
    supervisorDigest: registered.supervisorDigest,
    supervisorVersion: registered.supervisorVersion,
    inputManifestDigest: registered.inputManifestDigest,
    sourceJob: {
      repository: expected.repository,
      workflow: expected.workflow,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      jobId: "collect-host",
      jobName: requiredJobName,
      jobSlot: registered.hostSlot,
      jobDatabaseId: positiveInteger(
        input.jobDatabaseId,
        "collector.jobDatabaseId",
      ),
      startedAt: jobStartedAt.value,
    },
  };
}

function normalizeSource(input, collector, field) {
  exactKeys(
    input,
    [
      "hostIdDigest",
      "hostClass",
      "hostSlot",
      "runnerRegistrationId",
      "runnerName",
      "hardwareIdentityDigest",
      "runnerEnvironment",
      "runnerOs",
      "labels",
      "attesterId",
      "attesterVersion",
      "attesterEndpoint",
      "attesterMeasurementDigest",
      "supervisorDigest",
      "supervisorVersion",
      "inputManifestDigest",
      "sourceJob",
    ],
    field,
  );
  exactKeys(
    input.sourceJob,
    [
      "repository",
      "workflow",
      "runId",
      "runAttempt",
      "jobId",
      "jobName",
      "jobSlot",
      "jobDatabaseId",
      "startedAt",
    ],
    field + ".sourceJob",
  );
  if (
    JSON.stringify(canonicalValue(input)) !==
    JSON.stringify(canonicalValue(collector))
  ) {
    fail(
      field + " does not match the authenticated runner/job identity",
      field,
    );
  }
  return clone(collector);
}

function trustForPlatform(expected, platform) {
  return {
    registryDigest: expected.registryDigest,
    harnessDigest: expected.harnessDigests[platform],
    supervisorDigest: expected.supervisorDigests[platform],
    inputManifestDigest: expected.inputManifestDigests[platform],
    scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
  };
}

function normalizeTrust(input, expected, platform, field) {
  exactKeys(
    input,
    [
      "registryDigest",
      "harnessDigest",
      "supervisorDigest",
      "inputManifestDigest",
      "scenarioContractDigest",
    ],
    field,
  );
  const normalized = {
    registryDigest: exactDigest(
      input.registryDigest,
      field + ".registryDigest",
    ),
    harnessDigest: exactDigest(input.harnessDigest, field + ".harnessDigest"),
    supervisorDigest: exactDigest(
      input.supervisorDigest,
      field + ".supervisorDigest",
    ),
    inputManifestDigest: exactDigest(
      input.inputManifestDigest,
      field + ".inputManifestDigest",
    ),
    scenarioContractDigest: exactDigest(
      input.scenarioContractDigest,
      field + ".scenarioContractDigest",
    ),
  };
  const required = trustForPlatform(expected, platform);
  if (
    normalized.registryDigest !== required.registryDigest ||
    normalized.harnessDigest !== required.harnessDigest ||
    normalized.supervisorDigest !== required.supervisorDigest ||
    normalized.inputManifestDigest !== required.inputManifestDigest ||
    normalized.scenarioContractDigest !== required.scenarioContractDigest
  ) {
    fail(field + " does not match the reviewed trust roots", field);
  }
  return normalized;
}

function safeScenarioDirectory(root, scenario) {
  const resolvedRoot = fs.realpathSync(root);
  const resolved = path.resolve(resolvedRoot, scenario);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("scenario directory escapes output", "scenario");
  return resolved;
}

function resolveRegularFile(baseDirectory, name, field, maximumBytes) {
  const baseReal = fs.realpathSync(baseDirectory);
  const resolved = path.resolve(baseReal, name);
  const relative = path.relative(baseReal, resolved);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !fs.existsSync(resolved)
  ) {
    fail(field + " is missing or escapes its directory", field);
  }
  const document = readRegularBytes(resolved, field, maximumBytes);
  return {
    path: document.resolved,
    stat: document.stat,
    bytes: document.bytes,
  };
}

function listRegularFiles(directory, baseDirectory = directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      fail("evidence directory contains a symlink", absolute);
    if (entry.isDirectory())
      files.push(...listRegularFiles(absolute, baseDirectory));
    else if (entry.isFile())
      files.push(
        path.relative(baseDirectory, absolute).split(path.sep).join("/"),
      );
    else fail("evidence directory contains a non-file entry", absolute);
  }
  return files.sort();
}

export function rawReportSigningPayload(unsignedReport) {
  return Buffer.from(
    P1_10_RAW_REPORT_SIGNATURE_DOMAIN +
      "\0" +
      JSON.stringify(canonicalValue(unsignedReport)),
    "utf8",
  );
}

export function executionReceiptSigningPayload(unsignedReceipt) {
  return Buffer.from(
    P1_10_HARNESS_EXECUTION_SIGNATURE_DOMAIN +
      "\0" +
      JSON.stringify(canonicalValue(unsignedReceipt)),
    "utf8",
  );
}

function maximumPlatformDuration(matrix, platform) {
  return Math.max(
    ...matrix.requirements
      .filter((requirement) => requirement.requiredPlatforms.includes(platform))
      .map((requirement) => requirement.minimumDurationMs),
  );
}

function executionReceiptBody({
  expected,
  platform,
  collector,
  executionId,
  attesterRequestDigest,
  startedAt,
  endedAt,
  monotonicElapsedMs,
  requiredMinimumMs,
  containment,
}) {
  const wallClockElapsedMs = endedAt.milliseconds - startedAt.milliseconds;
  return {
    schema: P1_10_HARNESS_EXECUTION_SCHEMA,
    status: "passed",
    commitSha: expected.commitSha,
    producer: producerFromExpected(expected),
    platform,
    trust: trustForPlatform(expected, platform),
    source: clone(collector),
    executionId,
    attesterRequestDigest,
    wallClockStartedAt: startedAt.value,
    wallClockEndedAt: endedAt.value,
    wallClockElapsedMs,
    monotonicElapsedMs,
    requiredMinimumMs,
    containment: clone(containment),
    processTreeTerminated: true,
  };
}

function normalizeExecutionReceipt(
  input,
  {
    expected,
    platform,
    collector,
    registry,
    requiredMinimumMs,
    expectedAttesterRequestDigest = null,
  },
) {
  exactKeys(
    input,
    [
      "schema",
      "status",
      "commitSha",
      "producer",
      "platform",
      "trust",
      "source",
      "executionId",
      "attesterRequestDigest",
      "wallClockStartedAt",
      "wallClockEndedAt",
      "wallClockElapsedMs",
      "monotonicElapsedMs",
      "requiredMinimumMs",
      "containment",
      "processTreeTerminated",
      "receiptDigest",
      "attestation",
      "signedExecutionReceiptDigest",
    ],
    "executionReceipt",
  );
  if (
    input.schema !== P1_10_HARNESS_EXECUTION_SCHEMA ||
    input.status !== "passed" ||
    input.platform !== platform
  ) {
    fail("builder execution receipt identity is invalid", "executionReceipt");
  }
  if (
    exactCommit(input.commitSha, "executionReceipt.commitSha") !==
    expected.commitSha
  )
    fail("execution receipt commit mismatch");
  normalizeProducer(input.producer, expected, "executionReceipt.producer");
  normalizeTrust(input.trust, expected, platform, "executionReceipt.trust");
  normalizeSource(input.source, collector, "executionReceipt.source");
  if (
    typeof input.executionId !== "string" ||
    !EXECUTION_ID.test(input.executionId)
  )
    fail("executionReceipt.executionId is invalid");
  const attesterRequestDigest = exactDigest(
    input.attesterRequestDigest,
    "executionReceipt.attesterRequestDigest",
  );
  if (
    expectedAttesterRequestDigest != null &&
    attesterRequestDigest !== expectedAttesterRequestDigest
  ) {
    fail(
      "execution receipt is not bound to the builder-issued attester request",
      "executionReceipt.attesterRequestDigest",
    );
  }
  const started = canonicalTimestamp(
    input.wallClockStartedAt,
    "executionReceipt.wallClockStartedAt",
  );
  const ended = canonicalTimestamp(
    input.wallClockEndedAt,
    "executionReceipt.wallClockEndedAt",
  );
  const wallClockElapsedMs = ended.milliseconds - started.milliseconds;
  const monotonicElapsedMs = nonNegativeInteger(
    input.monotonicElapsedMs,
    "executionReceipt.monotonicElapsedMs",
  );
  exactKeys(
    input.containment,
    [
      "kind",
      "attesterId",
      "attesterVersion",
      "attesterMeasurementDigest",
      "supervisorDigest",
      "supervisorVersion",
      "bootIdDigest",
      "processTreeTerminated",
      "daemonizationDenied",
      "secretsCleared",
    ],
    "executionReceipt.containment",
  );
  const containment = {
    kind: boundedText(
      input.containment.kind,
      "executionReceipt.containment.kind",
      64,
    ),
    attesterId: boundedText(
      input.containment.attesterId,
      "executionReceipt.containment.attesterId",
      128,
    ),
    attesterVersion: boundedText(
      input.containment.attesterVersion,
      "executionReceipt.containment.attesterVersion",
      64,
    ),
    attesterMeasurementDigest: exactDigest(
      input.containment.attesterMeasurementDigest,
      "executionReceipt.containment.attesterMeasurementDigest",
    ),
    supervisorDigest: exactDigest(
      input.containment.supervisorDigest,
      "executionReceipt.containment.supervisorDigest",
    ),
    supervisorVersion: boundedText(
      input.containment.supervisorVersion,
      "executionReceipt.containment.supervisorVersion",
      64,
    ),
    bootIdDigest: exactDigest(
      input.containment.bootIdDigest,
      "executionReceipt.containment.bootIdDigest",
    ),
    processTreeTerminated: input.containment.processTreeTerminated,
    daemonizationDenied: input.containment.daemonizationDenied,
    secretsCleared: input.containment.secretsCleared,
  };
  if (
    input.wallClockElapsedMs !== wallClockElapsedMs ||
    input.requiredMinimumMs !== requiredMinimumMs ||
    wallClockElapsedMs < requiredMinimumMs ||
    monotonicElapsedMs < requiredMinimumMs ||
    Math.abs(wallClockElapsedMs - monotonicElapsedMs) >
      MAX_WALL_MONOTONIC_DRIFT_MS ||
    input.processTreeTerminated !== true ||
    containment.kind !== CONTAINMENT_BY_PLATFORM[platform] ||
    containment.attesterId !== collector.attesterId ||
    containment.attesterVersion !== collector.attesterVersion ||
    containment.attesterMeasurementDigest !==
      collector.attesterMeasurementDigest ||
    containment.supervisorDigest !== collector.supervisorDigest ||
    containment.supervisorVersion !== collector.supervisorVersion ||
    containment.processTreeTerminated !== true ||
    containment.daemonizationDenied !== true ||
    containment.secretsCleared !== true ||
    started.milliseconds < Date.parse(collector.sourceJob.startedAt)
  ) {
    fail(
      "execution receipt does not prove the required measured runtime, job bound, and process-tree exit",
      "executionReceipt",
    );
  }
  const body = executionReceiptBody({
    expected,
    platform,
    collector,
    executionId: input.executionId,
    attesterRequestDigest,
    startedAt: started,
    endedAt: ended,
    monotonicElapsedMs,
    requiredMinimumMs,
    containment,
  });
  const receiptDigest = exactDigest(
    input.receiptDigest,
    "executionReceipt.receiptDigest",
  );
  if (
    receiptDigest !== digestP110Evidence(body, P1_10_HARNESS_EXECUTION_DOMAIN)
  ) {
    fail(
      "execution receipt digest is invalid",
      "executionReceipt.receiptDigest",
    );
  }
  exactKeys(
    input.attestation,
    ["hostIdDigest", "algorithm", "signature"],
    "executionReceipt.attestation",
  );
  if (
    input.attestation.hostIdDigest !== collector.hostIdDigest ||
    input.attestation.algorithm !== "ed25519" ||
    typeof input.attestation.signature !== "string" ||
    !BASE64.test(input.attestation.signature)
  ) {
    fail(
      "execution receipt attestation identity is invalid",
      "executionReceipt.attestation",
    );
  }
  const unsignedReceipt = { ...body, receiptDigest };
  const registered = registry.byDigest.get(collector.hostIdDigest);
  const signature = Buffer.from(input.attestation.signature, "base64");
  if (
    !registered ||
    signature.length !== 64 ||
    !verifySignature(
      null,
      executionReceiptSigningPayload(unsignedReceipt),
      registered.publicKeyPem,
      signature,
    )
  ) {
    fail(
      "execution receipt host signature is invalid",
      "executionReceipt.attestation.signature",
    );
  }
  const signedExecutionReceiptDigest = exactDigest(
    input.signedExecutionReceiptDigest,
    "executionReceipt.signedExecutionReceiptDigest",
  );
  if (
    signedExecutionReceiptDigest !==
    digestP110Evidence(
      { receipt: unsignedReceipt, attestation: input.attestation },
      P1_10_SIGNED_HARNESS_EXECUTION_DOMAIN,
    )
  ) {
    fail(
      "signed execution receipt digest is invalid",
      "executionReceipt.signedExecutionReceiptDigest",
    );
  }
  return {
    ...unsignedReceipt,
    attestation: clone(input.attestation),
    signedExecutionReceiptDigest,
    startedMs: started.milliseconds,
    endedMs: ended.milliseconds,
  };
}

function scenarioRequirements(matrix, platform) {
  return matrix.requirements.filter((requirement) =>
    requirement.requiredPlatforms.includes(platform),
  );
}

function harnessEnvironment() {
  const allowed = [
    "LANG",
    "LC_ALL",
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ];
  return Object.fromEntries(
    allowed
      .filter((name) => process.env[name] != null)
      .map((name) => [name, process.env[name]]),
  );
}

function ensurePathInside(parent, child, field) {
  const resolvedParent = path.resolve(parent || "");
  const resolvedChild = path.resolve(child || "");
  const relative = path.relative(resolvedParent, resolvedChild);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail(field + " must be a child of RUNNER_TEMP", field);
  return resolvedChild;
}

function stagePinnedExecutable({
  sourcePath,
  declaredDigest,
  expectedDigest,
  privateDirectory,
  name,
  field,
  maximumBytes,
}) {
  const configured = boundedText(sourcePath, field + "Path", 2048);
  if (!path.isAbsolute(configured)) {
    fail(field + " path must be absolute", field + "Path");
  }
  const protectedDigest = exactDigest(declaredDigest, field + "Digest");
  if (protectedDigest !== expectedDigest) {
    fail(field + " digest does not match the protected pin", field + "Digest");
  }
  const source = readRegularBytes(configured, field + "Path", maximumBytes);
  if (sha256Buffer(source.bytes) !== protectedDigest) {
    fail(field + " bytes do not match the protected digest", field + "Digest");
  }
  const extension = path.extname(source.resolved).slice(0, 16);
  const stagedPath = path.join(privateDirectory, name + extension);
  fs.writeFileSync(stagedPath, source.bytes, {
    flag: "wx",
    mode: 0o700,
  });
  if (process.platform !== "win32") fs.chmodSync(stagedPath, 0o700);
  const staged = readRegularBytes(
    stagedPath,
    field + "StagedPath",
    maximumBytes,
  );
  if (sha256Buffer(staged.bytes) !== protectedDigest) {
    fail(
      field + " staged bytes failed the identity recheck",
      field + "StagedPath",
    );
  }
  return staged.resolved;
}

function readProtectedInputManifest({
  sourcePath,
  platform,
  expected,
  matrix,
  field = "inputManifest",
}) {
  const configured = boundedText(sourcePath, field + "Path", 2048);
  if (!path.isAbsolute(configured)) {
    fail(field + " path must be absolute", field + "Path");
  }
  const document = readRegularBytes(
    configured,
    field + "Path",
    MAX_INPUT_MANIFEST_BYTES,
  );
  const manifestDigest = sha256Buffer(document.bytes);
  if (manifestDigest !== expected.inputManifestDigests[platform]) {
    fail(
      field + " bytes do not match the protected platform digest pin",
      field + "Digest",
    );
  }
  const normalized = normalizeProtectedInputManifest(
    parseJsonText(document.bytes.toString("utf8"), field),
    { platform, expected, matrix, manifestDigest },
  );
  return { ...document, normalized, manifestDigest };
}

function stageProtectedInputManifest({
  sourcePath,
  platform,
  expected,
  matrix,
  privateDirectory,
}) {
  const source = readProtectedInputManifest({
    sourcePath,
    platform,
    expected,
    matrix,
  });
  const stagedPath = path.join(
    privateDirectory,
    "protected-input-manifest.json",
  );
  fs.writeFileSync(stagedPath, source.bytes, { flag: "wx", mode: 0o600 });
  const staged = readProtectedInputManifest({
    sourcePath: stagedPath,
    platform,
    expected,
    matrix,
    field: "stagedInputManifest",
  });
  if (staged.manifestDigest !== source.manifestDigest) {
    fail(
      "staged protected input manifest failed the identity recheck",
      "inputManifest",
    );
  }
  return staged;
}

function requireProtectedAttesterInstallation(document) {
  const parent = path.dirname(document.resolved);
  const parentStat = fs.lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    fs.realpathSync(parent) !== parent
  ) {
    fail("local attester parent must be a canonical protected directory");
  }
  if (process.platform === "win32") {
    for (const target of [document.resolved, parent]) {
      try {
        fs.accessSync(target, fs.constants.W_OK);
        fail(
          "local attester installation must deny the runner account write access",
          "attesterPath",
        );
      } catch (error) {
        if (error?.code === "CC_P1_10_EXTERNAL_EVIDENCE_BUILD_INVALID")
          throw error;
      }
    }
    return;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    (uid != null && (document.stat.uid === uid || parentStat.uid === uid)) ||
    (document.stat.mode & 0o022) !== 0 ||
    (parentStat.mode & 0o022) !== 0
  ) {
    fail(
      "local attester executable and parent must be admin-owned and runner-nonwritable",
      "attesterPath",
    );
  }
}

function validatePinnedAttester({
  sourcePath,
  declaredDigest,
  expectedDigest,
  assertProtected,
}) {
  const configured = boundedText(sourcePath, "attesterPath", 2048);
  if (!path.isAbsolute(configured)) {
    fail("attester path must be absolute", "attesterPath");
  }
  const protectedDigest = exactDigest(declaredDigest, "attesterDigest");
  if (protectedDigest !== expectedDigest) {
    fail("attester digest does not match the protected pin", "attesterDigest");
  }
  const document = readRegularBytes(
    configured,
    "attesterPath",
    MAX_ATTESTER_BYTES,
  );
  if (sha256Buffer(document.bytes) !== protectedDigest) {
    fail("attester bytes do not match the protected digest", "attesterDigest");
  }
  assertProtected(document);
  return document.resolved;
}

function stageRepositoryWindowsSupervisor(privateDirectory) {
  const source = readRegularBytes(
    windowsSupervisorPath,
    "windowsSupervisorPath",
    MAX_ATTESTER_BYTES,
  );
  const stagedPath = path.join(privateDirectory, "windows-job-supervisor.ps1");
  fs.writeFileSync(stagedPath, source.bytes, { flag: "wx", mode: 0o600 });
  const staged = readRegularBytes(
    stagedPath,
    "windowsSupervisorStagedPath",
    MAX_ATTESTER_BYTES,
  );
  if (sha256Buffer(staged.bytes) !== sha256Buffer(source.bytes)) {
    fail("Windows supervisor staged bytes failed the identity recheck");
  }
  return stagedPath;
}

function attesterRequest({
  expected,
  matrix,
  platform,
  collector,
  executionId,
  requiredMinimumMs,
  output,
  receiptPath,
  harnessPath,
  inputManifest,
}) {
  return {
    schema: P1_10_ATTESTER_REQUEST_SCHEMA,
    commitSha: expected.commitSha,
    producer: producerFromExpected(expected),
    platform,
    trust: trustForPlatform(expected, platform),
    matrixDigest: matrix.matrixDigest,
    scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    source: clone(collector),
    executionId,
    requiredMinimumMs,
    outputDirectory: output,
    executionReceiptPath: receiptPath,
    harness: {
      path: harnessPath,
      digest: expected.harnessDigests[platform],
    },
    protectedInputManifest: {
      path: inputManifest.resolved,
      digest: inputManifest.manifestDigest,
      body: clone({
        schema: inputManifest.normalized.schema,
        platform: inputManifest.normalized.platform,
        commitSha: inputManifest.normalized.commitSha,
        matrixDigest: inputManifest.normalized.matrixDigest,
        scenarioContractDigest: inputManifest.normalized.scenarioContractDigest,
        scenarios: inputManifest.normalized.scenarios,
      }),
    },
    requiredScenarios: scenarioRequirements(matrix, platform).map(
      (requirement) => ({
        scenario: requirement.evidenceScenario,
        receiptSchema:
          P1_10_SCENARIO_RECEIPT_SCHEMAS[requirement.evidenceScenario],
        minimumDurationMs: requirement.minimumDurationMs,
        protectedInput: clone(
          inputManifest.normalized.byScenario.get(requirement.evidenceScenario),
        ),
      }),
    ),
  };
}

const productionHarnessDependencies = Object.freeze({
  wallNow: () => Date.now(),
  executionId: () => randomBytes(32).toString("base64url"),
  runProcess: runOwnedProcess,
  assertAttesterProtected: requireProtectedAttesterInstallation,
});

async function runPhysicalHarnessInternal(
  {
    outputDirectory,
    executionReceiptPath,
    platform,
    matrix: matrixInput,
    expected: expectedInput,
    registry: registryInput,
    collector: collectorInput,
    runnerTemp,
    harnessPath,
    harnessDigest,
    attesterPath,
    attesterDigest,
    inputManifestPath,
  },
  dependencies,
) {
  if (!PLATFORMS.includes(platform))
    fail("unsupported platform: " + platform, "platform");
  const matrix = normalizeMatrix(matrixInput);
  const expected = normalizeExpected(expectedInput);
  const registry = normalizeRegistry(registryInput);
  requireRegistryDigest(registry, expected);
  const collector = normalizeCollector(
    collectorInput,
    platform,
    registry,
    expected,
  );
  const output = ensurePathInside(runnerTemp, outputDirectory, "output");
  const receiptPath = ensurePathInside(
    runnerTemp,
    executionReceiptPath,
    "executionReceipt",
  );
  if (
    output === receiptPath ||
    fs.existsSync(output) ||
    fs.existsSync(receiptPath)
  ) {
    fail(
      "harness output and execution receipt must be distinct absent paths",
      "output",
    );
  }
  const executionId = dependencies.executionId();
  if (typeof executionId !== "string" || !EXECUTION_ID.test(executionId))
    fail("builder executionId generator failed closed", "executionId");
  const requiredMinimumMs = maximumPlatformDuration(matrix, platform);
  const privateDirectory = fs.mkdtempSync(
    path.join(path.resolve(runnerTemp), "p1-10-attester-"),
  );
  if (process.platform !== "win32") fs.chmodSync(privateDirectory, 0o700);
  const stagedHarness = stagePinnedExecutable({
    sourcePath: harnessPath,
    declaredDigest: harnessDigest,
    expectedDigest: expected.harnessDigests[platform],
    privateDirectory,
    name: "physical-harness",
    field: "harness",
    maximumBytes: MAX_HARNESS_BYTES,
  });
  const protectedAttester = validatePinnedAttester({
    sourcePath: attesterPath,
    declaredDigest: attesterDigest,
    expectedDigest: expected.supervisorDigests[platform],
    assertProtected: dependencies.assertAttesterProtected,
  });
  const inputManifest = stageProtectedInputManifest({
    sourcePath: inputManifestPath,
    platform,
    expected,
    matrix,
    privateDirectory,
  });
  const request = attesterRequest({
    expected,
    matrix,
    platform,
    collector,
    executionId,
    requiredMinimumMs,
    output,
    receiptPath,
    harnessPath: stagedHarness,
    inputManifest,
  });
  const requestDigest = digestP110Evidence(
    request,
    P1_10_ATTESTER_REQUEST_DOMAIN,
  );
  const requestBase64 = Buffer.from(
    JSON.stringify(canonicalValue({ ...request, requestDigest })),
    "utf8",
  ).toString("base64");
  const wallStartedMs = dependencies.wallNow();
  // This outer runner bounds and cleans up the attester client only. In
  // particular, a Unix process group is not treated as strong harness
  // containment. That proof comes exclusively from the registry-pinned
  // attester's signed containment receipt validated below.
  const processResult = await dependencies.runProcess(
    protectedAttester,
    ["--request-base64", requestBase64],
    {
      cwd: privateDirectory,
      env: harnessEnvironment(),
      timeoutMs: HARNESS_TIMEOUT_MS,
      maxOutputBytes: MAX_HARNESS_OUTPUT_BYTES,
      windowsSupervisorPath:
        platform === "windows"
          ? stageRepositoryWindowsSupervisor(privateDirectory)
          : undefined,
    },
  );
  const wallEndedMs = dependencies.wallNow();
  const outerElapsedMs = nonNegativeInteger(
    processResult?.monotonicElapsedMs,
    "attester.monotonicElapsedMs",
  );
  if (
    wallEndedMs - wallStartedMs < requiredMinimumMs ||
    outerElapsedMs < requiredMinimumMs ||
    Math.abs(wallEndedMs - wallStartedMs - outerElapsedMs) >
      MAX_WALL_MONOTONIC_DRIFT_MS
  ) {
    fail(
      "local attester invocation did not cover the real monotonic and wall-clock minimum",
      "duration",
    );
  }
  if (!fs.existsSync(output) || !fs.existsSync(receiptPath)) {
    fail(
      "local attester did not emit its signed execution and scenario receipts",
      "attesterOutput",
    );
  }
  const executionDocument = readJsonDocument(receiptPath, "executionReceipt");
  const executionReceipt = normalizeExecutionReceipt(executionDocument.value, {
    expected,
    platform,
    collector,
    registry,
    requiredMinimumMs,
    expectedAttesterRequestDigest: requestDigest,
  });
  if (
    executionReceipt.executionId !== executionId ||
    executionReceipt.startedMs < wallStartedMs ||
    executionReceipt.endedMs > wallEndedMs ||
    outerElapsedMs < executionReceipt.monotonicElapsedMs
  ) {
    fail(
      "signed attester execution is outside the builder-owned wall/monotonic bounds",
      "executionReceipt",
    );
  }
  validateHostReports({
    reportsRoot: output,
    platform,
    matrix,
    registry,
    expected,
    collector,
    executionReceipt,
    inputManifest: inputManifest.normalized,
  });
  return { outputDirectory: output, executionReceiptPath: receiptPath };
}

export function runPhysicalHarness(options) {
  return runPhysicalHarnessInternal(options, productionHarnessDependencies);
}

// Unit tests can exercise 1,800-second validation without sleeping. The CLI
// never accepts dependency, clock, duration, or process-result overrides and
// always calls runPhysicalHarness above with the frozen production dependencies.
export const p110BuilderTestOnly = Object.freeze({
  runPhysicalHarnessWithDependencies(options, dependencies) {
    exactKeys(
      dependencies,
      ["wallNow", "executionId", "runProcess", "assertAttesterProtected"],
      "testDependencies",
    );
    return runPhysicalHarnessInternal(options, dependencies);
  },
});

function normalizeRawReport(
  input,
  requirement,
  platform,
  expected,
  registry,
  collector,
  executionReceipt,
  inputManifest,
  directory,
) {
  exactKeys(
    input,
    [
      "schema",
      "status",
      "commitSha",
      "producer",
      "scenario",
      "platform",
      "trust",
      "source",
      "executionId",
      "signedExecutionReceiptDigest",
      "receipt",
      "attestation",
    ],
    "rawReport",
  );
  if (
    input.schema !== P1_10_RAW_REPORT_SCHEMA ||
    input.status !== "passed" ||
    input.scenario !== requirement.evidenceScenario ||
    input.platform !== platform
  ) {
    fail("raw report identity does not match its matrix cell", "rawReport");
  }
  if (
    exactCommit(input.commitSha, "rawReport.commitSha") !== expected.commitSha
  )
    fail("raw report commit mismatch");
  normalizeProducer(input.producer, expected, "rawReport.producer");
  const trust = normalizeTrust(
    input.trust,
    expected,
    platform,
    "rawReport.trust",
  );
  const source = normalizeSource(input.source, collector, "rawReport.source");
  if (input.executionId !== executionReceipt.executionId)
    fail(
      "raw report executionId does not match builder receipt",
      "rawReport.executionId",
    );
  if (
    input.signedExecutionReceiptDigest !==
    executionReceipt.signedExecutionReceiptDigest
  ) {
    fail(
      "raw report does not bind the signed builder execution receipt",
      "rawReport.signedExecutionReceiptDigest",
    );
  }
  exactKeys(
    input.receipt,
    ["schema", "path", "digest", "sizeBytes"],
    "rawReport.receipt",
  );
  if (
    input.receipt.schema !==
      P1_10_SCENARIO_RECEIPT_SCHEMAS[requirement.evidenceScenario] ||
    input.receipt.path !== "scenario-receipt.json"
  ) {
    fail(
      "raw report must name the fixed scenario receipt",
      "rawReport.receipt",
    );
  }
  const receiptFile = resolveRegularFile(
    directory,
    "scenario-receipt.json",
    "rawReport.receipt",
    MAX_RECEIPT_BYTES,
  );
  const bytes = receiptFile.bytes;
  const sizeBytes = positiveInteger(
    input.receipt.sizeBytes,
    "rawReport.receipt.sizeBytes",
  );
  const receiptDigest = exactDigest(
    input.receipt.digest,
    "rawReport.receipt.digest",
  );
  if (sizeBytes !== bytes.length || receiptDigest !== sha256Buffer(bytes)) {
    fail(
      "scenario receipt bytes do not match the signed descriptor",
      "rawReport.receipt",
    );
  }
  const registeredHostIds = new Set(
    registry.hosts
      .filter((host) => host.platform === platform)
      .map((host) => host.idDigest),
  );
  const receipt = normalizeScenarioReceipt(
    parseJsonText(receiptFile.bytes.toString("utf8"), "scenarioReceipt"),
    {
      requirement,
      platform,
      sourceHostIdDigest: collector.hostIdDigest,
      executionId: executionReceipt.executionId,
      registeredHostIds,
      challenge: expected.challenge,
      inputManifestDigest: inputManifest.manifestDigest,
      scenarioInput: inputManifest.byScenario.get(requirement.evidenceScenario),
      attesterMeasurementDigest: collector.attesterMeasurementDigest,
      bootIdDigest: executionReceipt.containment.bootIdDigest,
      supervisorDigest: collector.supervisorDigest,
    },
  );
  if (
    Date.parse(receipt.startedAt) < executionReceipt.startedMs ||
    Date.parse(receipt.endedAt) > executionReceipt.endedMs
  ) {
    fail(
      "scenario window is outside the measured builder execution",
      "scenarioReceipt",
    );
  }
  exactKeys(
    input.attestation,
    ["hostIdDigest", "algorithm", "signature"],
    "rawReport.attestation",
  );
  if (
    input.attestation.hostIdDigest !== collector.hostIdDigest ||
    input.attestation.algorithm !== "ed25519"
  ) {
    fail(
      "raw report attestation is not from its authenticated runner",
      "rawReport.attestation",
    );
  }
  if (
    typeof input.attestation.signature !== "string" ||
    !BASE64.test(input.attestation.signature)
  )
    fail("raw signature must be base64");
  const unsigned = clone(input);
  delete unsigned.attestation;
  const signature = Buffer.from(input.attestation.signature, "base64");
  const registered = registry.byDigest.get(collector.hostIdDigest);
  if (
    signature.length !== 64 ||
    !verifySignature(
      null,
      rawReportSigningPayload(unsigned),
      registered.publicKeyPem,
      signature,
    )
  ) {
    fail("raw report signature is invalid", "rawReport.attestation.signature");
  }
  const attestation = clone(input.attestation);
  return {
    scenario: requirement.evidenceScenario,
    reportDigest: digestP110Evidence(
      { body: unsigned, attestation },
      P1_10_RAW_REPORT_DIGEST_DOMAIN,
    ),
    trust,
    source,
    receipt,
    artifact: {
      kind: "scenario-receipt",
      name:
        requirement.evidenceScenario +
        "-" +
        platform +
        "-" +
        collector.hostSlot +
        ".json",
      digest: receiptDigest,
      sizeBytes,
    },
    reportBytes: null,
    receiptBytes: Buffer.from(bytes),
  };
}

function validateHostReports({
  reportsRoot,
  platform,
  matrix,
  registry,
  expected,
  collector,
  executionReceipt,
  inputManifest,
}) {
  const resolvedRoot = path.resolve(reportsRoot);
  if (
    !fs.existsSync(resolvedRoot) ||
    !fs.lstatSync(resolvedRoot).isDirectory() ||
    fs.lstatSync(resolvedRoot).isSymbolicLink()
  ) {
    fail("raw reports root is missing", "reportsRoot");
  }
  const requirements = scenarioRequirements(matrix, platform);
  exactMembers(
    fs.readdirSync(resolvedRoot),
    requirements.map((entry) => entry.evidenceScenario),
    "reportsRoot.scenarios",
  );
  return requirements
    .map((requirement) => {
      const directory = safeScenarioDirectory(
        resolvedRoot,
        requirement.evidenceScenario,
      );
      exactMembers(
        listRegularFiles(directory),
        ["report.json", "scenario-receipt.json"],
        requirement.evidenceScenario + ".files",
      );
      const reportDocument = readJsonDocument(
        path.join(directory, "report.json"),
        requirement.evidenceScenario + ".report",
      );
      const normalized = normalizeRawReport(
        reportDocument.value,
        requirement,
        platform,
        expected,
        registry,
        collector,
        executionReceipt,
        inputManifest,
        directory,
      );
      normalized.reportBytes = Buffer.from(reportDocument.bytes);
      return normalized;
    })
    .sort((left, right) => left.scenario.localeCompare(right.scenario));
}

function ensureEmptyOutputDirectory(directory) {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      fs.readdirSync(resolved).length !== 0
    ) {
      fail("output directory must be absent or empty", "output");
    }
  } else fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function hostBundleBody(
  expected,
  matrix,
  platform,
  collector,
  executionReceipt,
  reports,
) {
  const cleanExecution = clone(executionReceipt);
  delete cleanExecution.startedMs;
  delete cleanExecution.endedMs;
  return {
    schema: P1_10_PLATFORM_BUNDLE_SCHEMA,
    status: "passed",
    producer: producerFromExpected(expected),
    trust: trustForPlatform(expected, platform),
    matrixDigest: matrix.matrixDigest,
    inputManifestDigest: expected.inputManifestDigests[platform],
    platform,
    collector,
    attesterRequestDigest: executionReceipt.attesterRequestDigest,
    signedExecutionReceiptDigest: executionReceipt.signedExecutionReceiptDigest,
    executionReceipt: cleanExecution,
    reports: reports.map((report) => ({
      scenario: report.scenario,
      reportDigest: report.reportDigest,
      receiptDigest: report.artifact.digest,
    })),
  };
}

export function collectHostEvidence({
  reportsRoot,
  executionReceiptPath,
  outputDirectory,
  platform,
  matrix: matrixInput,
  registry: registryInput,
  expected: expectedInput,
  collector: collectorInput,
  inputManifestPath,
}) {
  const matrix = normalizeMatrix(matrixInput);
  const registry = normalizeRegistry(registryInput);
  const expected = normalizeExpected(expectedInput);
  requireRegistryDigest(registry, expected);
  const collector = normalizeCollector(
    collectorInput,
    platform,
    registry,
    expected,
  );
  const executionDocument = readJsonDocument(
    executionReceiptPath,
    "executionReceipt",
  );
  const executionReceipt = normalizeExecutionReceipt(executionDocument.value, {
    expected,
    platform,
    collector,
    registry,
    requiredMinimumMs: maximumPlatformDuration(matrix, platform),
  });
  const inputManifest = readProtectedInputManifest({
    sourcePath: inputManifestPath,
    platform,
    expected,
    matrix,
  });
  const reports = validateHostReports({
    reportsRoot,
    platform,
    matrix,
    registry,
    expected,
    collector,
    executionReceipt,
    inputManifest: inputManifest.normalized,
  });
  const output = ensureEmptyOutputDirectory(outputDirectory);
  fs.writeFileSync(
    path.join(output, "harness-execution.json"),
    executionDocument.bytes,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(output, "protected-input-manifest.json"),
    inputManifest.bytes,
    { flag: "wx" },
  );
  for (const report of reports) {
    const destination = path.join(output, "raw", report.scenario);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(
      path.join(destination, "report.json"),
      report.reportBytes,
      {
        flag: "wx",
      },
    );
    fs.writeFileSync(
      path.join(destination, "scenario-receipt.json"),
      report.receiptBytes,
      { flag: "wx" },
    );
  }
  const body = hostBundleBody(
    expected,
    matrix,
    platform,
    collector,
    executionReceipt,
    reports,
  );
  const bundle = {
    ...body,
    bundleDigest: digestP110Evidence(body, P1_10_PLATFORM_BUNDLE_DOMAIN),
  };
  writeJson(path.join(output, "host-evidence.json"), bundle);
  return bundle;
}

export const collectPlatformEvidence = collectHostEvidence;

function hostArtifactName(expected, platform, hostSlot) {
  return (
    "p1-10-raw-host-" +
    platform +
    "-" +
    hostSlot +
    "-" +
    expected.runId +
    "-" +
    expected.runAttempt
  );
}

function validateCollectedHost({
  artifactDirectory,
  platform,
  hostSlot,
  matrix,
  registry,
  expected,
}) {
  exactMembers(
    fs.readdirSync(artifactDirectory),
    [
      "harness-execution.json",
      "host-evidence.json",
      "protected-input-manifest.json",
      "raw",
    ],
    platform + "." + hostSlot + ".files",
  );
  const bundle = readJson(
    path.join(artifactDirectory, "host-evidence.json"),
    platform + ".bundle",
  );
  exactKeys(
    bundle,
    [
      "schema",
      "status",
      "producer",
      "trust",
      "matrixDigest",
      "inputManifestDigest",
      "platform",
      "collector",
      "attesterRequestDigest",
      "signedExecutionReceiptDigest",
      "executionReceipt",
      "reports",
      "bundleDigest",
    ],
    platform + ".bundle",
  );
  if (
    bundle.schema !== P1_10_PLATFORM_BUNDLE_SCHEMA ||
    bundle.status !== "passed" ||
    bundle.platform !== platform ||
    bundle.matrixDigest !== matrix.matrixDigest ||
    bundle.collector?.hostSlot !== hostSlot
  ) {
    fail("host bundle identity is invalid", platform + ".bundle");
  }
  normalizeProducer(bundle.producer, expected, platform + ".bundle.producer");
  normalizeTrust(bundle.trust, expected, platform, platform + ".bundle.trust");
  if (bundle.inputManifestDigest !== expected.inputManifestDigests[platform]) {
    fail(
      "host bundle input manifest digest does not match the protected pin",
      platform + ".bundle.inputManifestDigest",
    );
  }
  const collector = normalizeCollector(
    {
      runnerName: bundle.collector.runnerName,
      runnerEnvironment: bundle.collector.runnerEnvironment,
      runnerOs: bundle.collector.runnerOs,
      runnerRegistrationId: bundle.collector.runnerRegistrationId,
      jobDatabaseId: bundle.collector.sourceJob?.jobDatabaseId,
      jobName: bundle.collector.sourceJob?.jobName,
      jobId: bundle.collector.sourceJob?.jobId,
      jobSlot: bundle.collector.hostSlot,
      labels: bundle.collector.labels,
      jobStartedAt: bundle.collector.sourceJob?.startedAt,
    },
    platform,
    registry,
    expected,
  );
  normalizeSource(bundle.collector, collector, platform + ".bundle.collector");
  const executionInput = readJson(
    path.join(artifactDirectory, "harness-execution.json"),
    platform + ".executionReceipt",
  );
  if (
    JSON.stringify(canonicalValue(executionInput)) !==
    JSON.stringify(canonicalValue(bundle.executionReceipt))
  ) {
    fail(
      "host bundle execution receipt does not match its file",
      platform + ".bundle.executionReceipt",
    );
  }
  if (
    bundle.attesterRequestDigest !== executionInput.attesterRequestDigest ||
    bundle.signedExecutionReceiptDigest !==
      executionInput.signedExecutionReceiptDigest
  ) {
    fail(
      "host bundle does not bind its signed execution receipt",
      platform + ".bundle.signedExecutionReceiptDigest",
    );
  }
  const executionReceipt = normalizeExecutionReceipt(executionInput, {
    expected,
    platform,
    collector,
    registry,
    requiredMinimumMs: maximumPlatformDuration(matrix, platform),
  });
  const inputManifest = readProtectedInputManifest({
    sourcePath: path.join(artifactDirectory, "protected-input-manifest.json"),
    platform,
    expected,
    matrix,
    field: platform + ".inputManifest",
  });
  const reports = validateHostReports({
    reportsRoot: path.join(artifactDirectory, "raw"),
    platform,
    matrix,
    registry,
    expected,
    collector,
    executionReceipt,
    inputManifest: inputManifest.normalized,
  });
  const body = hostBundleBody(
    expected,
    matrix,
    platform,
    collector,
    executionReceipt,
    reports,
  );
  const bundleDigest = exactDigest(
    bundle.bundleDigest,
    platform + ".bundle.bundleDigest",
  );
  if (bundleDigest !== digestP110Evidence(body, P1_10_PLATFORM_BUNDLE_DOMAIN))
    fail("host bundle digest is invalid");
  if (
    JSON.stringify(canonicalValue(bundle.reports)) !==
    JSON.stringify(canonicalValue(body.reports))
  ) {
    fail("host bundle does not match its authenticated raw reports");
  }
  return { ...body, reports, bundleDigest };
}

function authoritativeJobsEndpointPath(expected) {
  return (
    "/repos/" +
    expected.repository +
    "/actions/runs/" +
    expected.runId +
    "/attempts/" +
    expected.runAttempt +
    "/jobs"
  );
}

function normalizeAuthoritativeJobs(input, expected, registry) {
  exactKeys(
    input,
    [
      "schema",
      "repository",
      "commitSha",
      "workflow",
      "runId",
      "runAttempt",
      "endpointPath",
      "totalCount",
      "pageCount",
      "jobs",
    ],
    "jobsEnvelope",
  );
  if (
    input.schema !== "chainlesschain.p1-10-actions-jobs-envelope/v2" ||
    input.repository !== expected.repository ||
    input.commitSha !== expected.commitSha ||
    input.workflow !== expected.workflow ||
    input.runId !== expected.runId ||
    input.runAttempt !== expected.runAttempt ||
    input.endpointPath !== authoritativeJobsEndpointPath(expected) ||
    !Array.isArray(input.jobs)
  ) {
    fail(
      "authoritative jobs envelope does not match the exact producer attempt",
      "jobsEnvelope",
    );
  }
  if (
    input.totalCount !== input.jobs.length ||
    input.pageCount !== Math.max(1, Math.ceil(input.totalCount / 100))
  ) {
    fail(
      "authoritative jobs envelope is incomplete or has invalid pagination metadata",
      "jobsEnvelope",
    );
  }
  const physicalJobs = input.jobs.filter((job) =>
    String(job?.name || "").startsWith("Collect authenticated host ("),
  );
  const jobs = physicalJobs.map((job, index) => {
    const field = "jobs[" + index + "]";
    const name = boundedText(job?.name, field + ".name", 256);
    const runnerName = boundedText(
      job?.runner_name,
      field + ".runner_name",
      128,
    );
    const registered = registry.byRunnerName.get(runnerName);
    const labels = Array.isArray(job?.labels)
      ? job.labels
          .map((label) => boundedText(label, field + ".labels", 128))
          .sort()
      : [];
    if (
      !registered ||
      job?.status !== "completed" ||
      job?.conclusion !== "success" ||
      job?.run_id !== expected.runId ||
      (job?.run_attempt != null && job.run_attempt !== expected.runAttempt) ||
      job?.runner_id !== registered.runnerRegistrationId ||
      name !==
        "Collect authenticated host (" +
          registered.platform +
          "/" +
          registered.hostSlot +
          ")"
    ) {
      fail(
        field + " is not a successful exact-run registered physical job",
        field,
      );
    }
    if (
      labels.length < registered.requiredLabels.length ||
      labels.length > 32 ||
      new Set(labels).size !== labels.length ||
      registered.requiredLabels.some((label) => !labels.includes(label))
    ) {
      fail(
        field + " labels do not include every checked-in required label",
        field + ".labels",
      );
    }
    const started = apiTimestamp(job.started_at, field + ".started_at");
    const completed = apiTimestamp(job.completed_at, field + ".completed_at");
    if (completed.milliseconds <= started.milliseconds)
      fail(field + " has an invalid job window", field);
    if (
      started.milliseconds < Date.parse(registered.validFrom) ||
      completed.milliseconds > Date.parse(registered.validUntil)
    ) {
      fail(
        field + " execution/signing window is outside host enrollment validity",
        field,
      );
    }
    return {
      jobDatabaseId: positiveInteger(job.id, field + ".id"),
      runnerRegistrationId: registered.runnerRegistrationId,
      runnerName,
      name,
      labels,
      startedAt: started.value,
      completedAt: completed.value,
      startedMs: started.milliseconds,
      completedMs: completed.milliseconds,
    };
  });
  if (
    jobs.length !== 6 ||
    new Set(jobs.map((job) => job.jobDatabaseId)).size !== 6
  ) {
    fail(
      "authoritative jobs must contain exactly the six physical host-slot jobs",
      "jobs",
    );
  }
  return new Map(jobs.map((job) => [job.jobDatabaseId, job]));
}

function bindBundleToAuthoritativeJob(bundle, jobs) {
  const source = bundle.collector.sourceJob;
  const job = jobs.get(source.jobDatabaseId);
  if (
    !job ||
    job.runnerRegistrationId !== bundle.collector.runnerRegistrationId ||
    job.runnerName !== bundle.collector.runnerName ||
    job.name !== source.jobName ||
    job.startedAt !== source.startedAt ||
    bundle.executionReceipt.wallClockStartedAt < job.startedAt ||
    bundle.executionReceipt.wallClockEndedAt > job.completedAt
  ) {
    fail(
      "signed host bundle does not match the authoritative Actions job window/runner",
      "jobs",
    );
  }
}

function normalizeAuthoritativeArtifacts(input, expected) {
  exactKeys(
    input,
    [
      "schema",
      "repository",
      "commitSha",
      "workflow",
      "runId",
      "runAttempt",
      "endpointPath",
      "totalCount",
      "pageCount",
      "artifacts",
    ],
    "artifactsEnvelope",
  );
  const endpointPath =
    "/repos/" +
    expected.repository +
    "/actions/runs/" +
    expected.runId +
    "/artifacts";
  if (
    input.schema !== "chainlesschain.p1-10-actions-artifacts-envelope/v1" ||
    input.repository !== expected.repository ||
    input.commitSha !== expected.commitSha ||
    input.workflow !== expected.workflow ||
    input.runId !== expected.runId ||
    input.runAttempt !== expected.runAttempt ||
    input.endpointPath !== endpointPath ||
    !Array.isArray(input.artifacts) ||
    input.totalCount !== input.artifacts.length ||
    input.pageCount !== Math.max(1, Math.ceil(input.totalCount / 100))
  ) {
    fail(
      "authoritative artifacts envelope is incomplete or not from the exact producer attempt",
      "artifactsEnvelope",
    );
  }
  const expectedNames = PLATFORMS.flatMap((platform) =>
    HOST_SLOTS.map((slot) => hostArtifactName(expected, platform, slot)),
  );
  const selected = input.artifacts.filter((artifact) =>
    expectedNames.includes(String(artifact?.name || "")),
  );
  exactMembers(
    selected.map((artifact) => artifact.name),
    expectedNames,
    "artifactsEnvelope.hostArtifacts",
  );
  const normalized = selected.map((artifact, index) => {
    const field = "artifactsEnvelope.hostArtifacts[" + index + "]";
    if (
      artifact.expired !== false ||
      artifact?.workflow_run?.id !== expected.runId ||
      artifact?.workflow_run?.head_sha !== expected.commitSha
    ) {
      fail(
        field + " is expired or detached from the exact producer run",
        field,
      );
    }
    const created = apiTimestamp(artifact.created_at, field + ".created_at");
    const updated = apiTimestamp(artifact.updated_at, field + ".updated_at");
    if (updated.milliseconds < created.milliseconds) {
      fail(field + " has an invalid artifact window", field);
    }
    return {
      artifactId: positiveInteger(artifact.id, field + ".id"),
      artifactName: artifact.name,
    };
  });
  if (new Set(normalized.map((artifact) => artifact.artifactId)).size !== 6) {
    fail(
      "six host artifacts must have unique immutable IDs",
      "artifactsEnvelope",
    );
  }
  return new Map(
    normalized.map((artifact) => [artifact.artifactName, artifact]),
  );
}

function platformEvidenceFromHosts(
  requirement,
  platform,
  hostBundles,
  expected,
  authoritativeArtifacts,
) {
  const reports = hostBundles.map((bundle) => {
    const report = bundle.reports.find(
      (candidate) => candidate.scenario === requirement.evidenceScenario,
    );
    if (!report)
      fail(
        "missing authenticated host report for " + requirement.evidenceScenario,
      );
    return report;
  });
  const overlapStart = Math.max(
    ...reports.map((report) => Date.parse(report.receipt.startedAt)),
  );
  const overlapEnd = Math.min(
    ...reports.map((report) => Date.parse(report.receipt.endedAt)),
  );
  const durationMs = overlapEnd - overlapStart;
  if (durationMs < requirement.minimumDurationMs) {
    fail(
      "independent host scenario windows do not overlap for the matrix minimum",
      requirement.evidenceScenario,
    );
  }
  const metrics = deriveScenarioMetrics(
    requirement,
    reports.map((report) => report.receipt),
  );
  const hosts = hostBundles
    .map((bundle, index) => ({
      ...authoritativeArtifacts.get(
        hostArtifactName(expected, platform, bundle.collector.hostSlot),
      ),
      idDigest: bundle.collector.hostIdDigest,
      hostClass: "physical",
      runnerRegistrationId: bundle.collector.runnerRegistrationId,
      runnerName: bundle.collector.runnerName,
      hardwareIdentityDigest: bundle.collector.hardwareIdentityDigest,
      jobSlot: bundle.collector.hostSlot,
      attesterMeasurementDigest: bundle.collector.attesterMeasurementDigest,
      inputManifestDigest: bundle.collector.inputManifestDigest,
      bootIdDigest: bundle.executionReceipt.containment.bootIdDigest,
      attesterRequestDigest: bundle.attesterRequestDigest,
      signedExecutionReceiptDigest: bundle.signedExecutionReceiptDigest,
      reportDigest: reports[index].reportDigest,
      bundleDigest: bundle.bundleDigest,
      sourceJob: clone(bundle.collector.sourceJob),
    }))
    .sort((left, right) => left.idDigest.localeCompare(right.idDigest));
  if (
    hosts.length !== HOST_SLOTS.length ||
    new Set(hosts.map((host) => host.idDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerName)).size !== hosts.length ||
    new Set(hosts.map((host) => host.runnerRegistrationId)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.hardwareIdentityDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.attesterMeasurementDigest)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.bootIdDigest)).size !== hosts.length ||
    new Set(hosts.map((host) => host.sourceJob.jobDatabaseId)).size !==
      hosts.length ||
    new Set(hosts.map((host) => host.sourceJob.jobSlot)).size !== hosts.length
  ) {
    fail(
      "platform evidence requires two independent registered runner/job identities",
      platform + ".hosts",
    );
  }
  const artifacts = reports
    .map((report) => report.artifact)
    .sort((left, right) => left.digest.localeCompare(right.digest));
  if (
    new Set(artifacts.map((artifact) => artifact.digest)).size !==
    artifacts.length
  ) {
    fail(
      "independent hosts must provide distinct signed scenario receipts",
      platform + ".artifacts",
    );
  }
  const body = {
    platform,
    status: "passed",
    trust: trustForPlatform(expected, platform),
    startedAt: new Date(overlapStart).toISOString(),
    endedAt: new Date(overlapEnd).toISOString(),
    durationMs,
    hosts,
    artifacts,
    metrics,
  };
  return {
    ...body,
    evidenceDigest: digestP110Evidence(body, P1_10_PLATFORM_EVIDENCE_DOMAIN),
  };
}

export function aggregateExternalEvidence({
  platformArtifactsRoot,
  jobs: jobsInput,
  artifacts: artifactsInput,
  matrix: matrixInput,
  registry: registryInput,
  expected: expectedInput,
  issuedAt = new Date().toISOString(),
}) {
  const matrix = normalizeMatrix(matrixInput);
  const registry = normalizeRegistry(registryInput);
  const expected = normalizeExpected(expectedInput);
  requireRegistryDigest(registry, expected);
  const jobs = normalizeAuthoritativeJobs(jobsInput, expected, registry);
  const artifacts = normalizeAuthoritativeArtifacts(artifactsInput, expected);
  const issued = canonicalTimestamp(issuedAt, "issuedAt");
  const root = path.resolve(platformArtifactsRoot);
  const expectedDirectories = PLATFORMS.flatMap((platform) =>
    HOST_SLOTS.map((slot) => hostArtifactName(expected, platform, slot)),
  );
  exactMembers(fs.readdirSync(root), expectedDirectories, "platformArtifacts");
  const bundlesByPlatform = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      HOST_SLOTS.map((hostSlot) => {
        const bundle = validateCollectedHost({
          artifactDirectory: path.join(
            root,
            hostArtifactName(expected, platform, hostSlot),
          ),
          platform,
          hostSlot,
          matrix,
          registry,
          expected,
        });
        bindBundleToAuthoritativeJob(bundle, jobs);
        return bundle;
      }),
    ]),
  );
  const allBundles = Object.values(bundlesByPlatform).flat();
  for (const [field, values] of [
    [
      "hardwareIdentityDigest",
      allBundles.map((bundle) => bundle.collector.hardwareIdentityDigest),
    ],
    ["attesterId", allBundles.map((bundle) => bundle.collector.attesterId)],
    [
      "attesterMeasurementDigest",
      allBundles.map((bundle) => bundle.collector.attesterMeasurementDigest),
    ],
    [
      "bootIdDigest",
      allBundles.map(
        (bundle) => bundle.executionReceipt.containment.bootIdDigest,
      ),
    ],
  ]) {
    if (new Set(values).size !== PLATFORMS.length * HOST_SLOTS.length) {
      fail(
        "six host slots must have globally independent " + field,
        "physicalHosts." + field,
      );
    }
  }
  const results = matrix.requirements
    .map((requirement) => {
      const platforms = requirement.requiredPlatforms
        .map((platform) =>
          platformEvidenceFromHosts(
            requirement,
            platform,
            bundlesByPlatform[platform],
            expected,
            artifacts,
          ),
        )
        .sort((left, right) => left.platform.localeCompare(right.platform));
      const body = {
        scenario: requirement.evidenceScenario,
        status: "passed",
        platforms,
      };
      return {
        ...body,
        evidenceDigest: digestP110Evidence(
          body,
          P1_10_SCENARIO_EVIDENCE_DOMAIN,
        ),
      };
    })
    .sort((left, right) => left.scenario.localeCompare(right.scenario));
  const latestEnd = Math.max(
    ...results.flatMap((result) =>
      result.platforms.map((platform) => Date.parse(platform.endedAt)),
    ),
  );
  if (issued.milliseconds < latestEnd)
    fail("issuedAt cannot precede a physical scenario", "issuedAt");
  const body = {
    schema: P1_10_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha: expected.commitSha,
    matrixDigest: matrix.matrixDigest,
    producer: producerFromExpected(expected),
    trust: {
      registryDigest: expected.registryDigest,
      harnessDigests: clone(expected.harnessDigests),
      supervisorDigests: clone(expected.supervisorDigests),
      inputManifestDigests: clone(expected.inputManifestDigests),
      scenarioContractDigest: P1_10_SCENARIO_CONTRACT_DIGEST,
    },
    issuedAt: issued.value,
    results,
  };
  const evidence = {
    ...body,
    evidenceDigest: digestP110Evidence(body, P1_10_EVIDENCE_DOMAIN),
  };
  validateExternalEvidence(matrixInput, evidence, expected);
  return evidence;
}

export function trustedGitHubApiBase(serverUrlValue, apiUrlValue) {
  let server;
  let api;
  try {
    server = new URL(boundedText(serverUrlValue, "GITHUB_SERVER_URL", 2048));
    api = new URL(boundedText(apiUrlValue, "GITHUB_API_URL", 2048));
  } catch (error) {
    fail(
      "trusted GitHub origins are invalid: " + error.message,
      "GITHUB_API_URL",
    );
  }
  if (
    server.protocol !== "https:" ||
    api.protocol !== "https:" ||
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    !["", "/"].includes(server.pathname) ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  ) {
    fail("GitHub origins must be credential-free HTTPS URLs", "GITHUB_API_URL");
  }
  if (server.hostname === "github.com") {
    if (
      api.origin !== "https://api.github.com" ||
      !["", "/"].includes(api.pathname)
    ) {
      fail(
        "github.com jobs API must use exactly https://api.github.com",
        "GITHUB_API_URL",
      );
    }
    return api.origin;
  }
  if (
    api.origin !== server.origin ||
    !["/api/v3", "/api/v3/"].includes(api.pathname)
  ) {
    fail(
      "GHES jobs API must use the trusted server's exact /api/v3 base",
      "GITHUB_API_URL",
    );
  }
  return api.origin + "/api/v3";
}

async function fetchAuthoritativeJobs({ token, expected, serverUrl, apiUrl }) {
  const base = trustedGitHubApiBase(serverUrl, apiUrl);
  const endpointPath = authoritativeJobsEndpointPath(expected);
  const authorization = "Bearer " + boundedText(token, "GITHUB_TOKEN", 4096);
  const jobs = [];
  let totalCount = null;
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(base + endpointPath);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: authorization,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    });
    if (!response.ok) {
      fail(
        "GitHub jobs API rejected identity lookup: " + response.status,
        "jobsApi",
      );
    }
    const payload = await response.json();
    if (
      !Number.isSafeInteger(payload?.total_count) ||
      payload.total_count < 1 ||
      !Array.isArray(payload.jobs) ||
      (totalCount != null && payload.total_count !== totalCount)
    ) {
      fail("GitHub jobs API returned an invalid paginated shape", "jobsApi");
    }
    totalCount = payload.total_count;
    jobs.push(...payload.jobs);
    if (jobs.length >= totalCount) break;
    if (payload.jobs.length !== 100) {
      fail("GitHub jobs API pagination ended before total_count", "jobsApi");
    }
  }
  if (jobs.length !== totalCount) {
    fail("GitHub jobs API pagination did not cover total_count", "jobsApi");
  }
  return {
    schema: "chainlesschain.p1-10-actions-jobs-envelope/v2",
    repository: expected.repository,
    commitSha: expected.commitSha,
    workflow: expected.workflow,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    endpointPath,
    totalCount,
    pageCount: Math.max(1, Math.ceil(totalCount / 100)),
    jobs,
  };
}

async function fetchAuthoritativeArtifacts({
  token,
  expected,
  serverUrl,
  apiUrl,
}) {
  const base = trustedGitHubApiBase(serverUrl, apiUrl);
  const endpointPath =
    "/repos/" +
    expected.repository +
    "/actions/runs/" +
    expected.runId +
    "/artifacts";
  const authorization = "Bearer " + boundedText(token, "GITHUB_TOKEN", 4096);
  const artifacts = [];
  let totalCount = null;
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(base + endpointPath);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: authorization,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    });
    if (!response.ok) {
      fail(
        "GitHub artifacts API rejected lookup: " + response.status,
        "artifactsApi",
      );
    }
    const payload = await response.json();
    if (
      !Number.isSafeInteger(payload?.total_count) ||
      payload.total_count < 1 ||
      !Array.isArray(payload.artifacts) ||
      (totalCount != null && payload.total_count !== totalCount)
    ) {
      fail(
        "GitHub artifacts API returned an invalid paginated shape",
        "artifactsApi",
      );
    }
    totalCount = payload.total_count;
    artifacts.push(...payload.artifacts);
    if (artifacts.length >= totalCount) break;
    if (payload.artifacts.length !== 100) {
      fail(
        "GitHub artifacts API pagination ended before total_count",
        "artifactsApi",
      );
    }
  }
  if (artifacts.length !== totalCount) {
    fail(
      "GitHub artifacts API pagination did not cover total_count",
      "artifactsApi",
    );
  }
  return {
    schema: "chainlesschain.p1-10-actions-artifacts-envelope/v1",
    repository: expected.repository,
    commitSha: expected.commitSha,
    workflow: expected.workflow,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    endpointPath,
    totalCount,
    pageCount: Math.max(1, Math.ceil(totalCount / 100)),
    artifacts,
  };
}

async function resolveJobIdentity({
  token,
  expected,
  registry,
  collectorBase,
  output,
  serverUrl,
  apiUrl,
}) {
  const payload = await fetchAuthoritativeJobs({
    token,
    expected,
    serverUrl,
    apiUrl,
  });
  const registered = registry.byRunnerName.get(collectorBase.runnerName);
  const requiredName =
    "Collect authenticated host (" +
    registered.platform +
    "/" +
    registered.hostSlot +
    ")";
  const matches = (Array.isArray(payload.jobs) ? payload.jobs : []).filter(
    (job) =>
      job.name === requiredName &&
      job.runner_name === collectorBase.runnerName &&
      job.status === "in_progress" &&
      job.run_id === expected.runId &&
      (job.run_attempt == null || job.run_attempt === expected.runAttempt),
  );
  if (matches.length !== 1)
    fail(
      "could not resolve exactly one current Actions job identity",
      "jobsApi",
    );
  const job = matches[0];
  const collector = normalizeCollector(
    {
      ...collectorBase,
      runnerRegistrationId: job.runner_id,
      jobDatabaseId: job.id,
      jobName: job.name,
      labels: job.labels,
      jobStartedAt: apiTimestamp(job.started_at, "jobsApi.started_at").value,
    },
    registered.platform,
    registry,
    expected,
  );
  writeJson(output, collector, true);
}

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      value == null ||
      value.startsWith("--") ||
      options[key] != null
    ) {
      fail("arguments must be unique --name value pairs", "arguments");
    }
    options[key] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) fail(name + " is required", name);
  return value;
}

function integerOption(value, field) {
  if (!/^[1-9][0-9]*$/u.test(String(value || "")))
    fail(field + " must be a positive integer", field);
  return positiveInteger(Number(value), field);
}

const trustOptions = Object.freeze([
  "--expected-registry-digest",
  "--expected-linux-harness-digest",
  "--expected-macos-harness-digest",
  "--expected-windows-harness-digest",
  "--expected-linux-supervisor-digest",
  "--expected-macos-supervisor-digest",
  "--expected-windows-supervisor-digest",
  "--expected-linux-input-manifest-digest",
  "--expected-macos-input-manifest-digest",
  "--expected-windows-input-manifest-digest",
]);
const commonOptions = Object.freeze([
  "--platform",
  "--expected-commit",
  "--expected-challenge",
  ...trustOptions,
  "--job-identity",
]);

function assertCommandOptions(command, options) {
  const optionalMatrix = options["--matrix"] ? ["--matrix"] : [];
  const optionalRegistry = options["--registry"] ? ["--registry"] : [];
  const commandOptions = {
    "resolve-job": [
      "--platform",
      "--expected-commit",
      "--expected-challenge",
      ...trustOptions,
      "--output",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    "capture-jobs": [
      "--expected-commit",
      "--expected-challenge",
      ...trustOptions,
      "--output",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    "capture-artifacts": [
      "--expected-commit",
      "--expected-challenge",
      ...trustOptions,
      "--output",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    "run-harness": [
      ...commonOptions,
      "--input-manifest",
      "--output",
      "--execution-receipt",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    "collect-host": [
      ...commonOptions,
      "--input-manifest",
      "--reports",
      "--execution-receipt",
      "--output",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    aggregate: [
      "--expected-commit",
      "--expected-challenge",
      ...trustOptions,
      "--platform-artifacts",
      "--jobs",
      "--artifacts",
      "--output",
      ...optionalMatrix,
      ...optionalRegistry,
    ],
    "registry-digest": ["--output", ...optionalRegistry],
  }[command];
  if (!commandOptions) fail("unsupported command", "command");
  exactMembers(Object.keys(options), commandOptions, "arguments");
}

function expectedFromProcess(options) {
  return {
    commitSha: requireOption(options, "--expected-commit"),
    repository: process.env.GITHUB_REPOSITORY,
    workflow: P1_10_PRODUCER_WORKFLOW,
    runId: integerOption(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID"),
    runAttempt: integerOption(
      process.env.GITHUB_RUN_ATTEMPT,
      "GITHUB_RUN_ATTEMPT",
    ),
    environment: P1_10_PRODUCER_ENVIRONMENT,
    challenge: requireOption(options, "--expected-challenge"),
    registryDigest: requireOption(options, "--expected-registry-digest"),
    harnessDigests: {
      linux: requireOption(options, "--expected-linux-harness-digest"),
      macos: requireOption(options, "--expected-macos-harness-digest"),
      windows: requireOption(options, "--expected-windows-harness-digest"),
    },
    supervisorDigests: {
      linux: requireOption(options, "--expected-linux-supervisor-digest"),
      macos: requireOption(options, "--expected-macos-supervisor-digest"),
      windows: requireOption(options, "--expected-windows-supervisor-digest"),
    },
    inputManifestDigests: {
      linux: requireOption(options, "--expected-linux-input-manifest-digest"),
      macos: requireOption(options, "--expected-macos-input-manifest-digest"),
      windows: requireOption(
        options,
        "--expected-windows-input-manifest-digest",
      ),
    },
  };
}

function collectorBaseFromProcess() {
  return {
    runnerName: process.env.RUNNER_NAME,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    runnerOs: process.env.RUNNER_OS,
    jobId: process.env.GITHUB_JOB,
    jobSlot: process.env.P1_10_HOST_SLOT,
  };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  assertCommandOptions(command, options);
  const registryPath = options["--registry"] || defaultRegistryPath;
  const registryInput = readJson(registryPath, "registry");
  if (command === "registry-digest") {
    writeJson(requireOption(options, "--output"), {
      registryDigest: physicalHostRegistryDigest(registryInput),
    });
    return;
  }
  const matrix = readJson(options["--matrix"] || defaultMatrixPath, "matrix");
  const expected = expectedFromProcess(options);
  if (command === "resolve-job") {
    const registry = normalizeRegistry(registryInput);
    requireRegistryDigest(registry, normalizeExpected(expected));
    await resolveJobIdentity({
      token: process.env.GITHUB_TOKEN,
      expected: normalizeExpected(expected),
      registry,
      collectorBase: collectorBaseFromProcess(),
      output: requireOption(options, "--output"),
      serverUrl: process.env.GITHUB_SERVER_URL,
      apiUrl: process.env.GITHUB_API_URL,
    });
    return;
  }
  if (command === "capture-jobs") {
    const envelope = await fetchAuthoritativeJobs({
      token: process.env.GITHUB_TOKEN,
      expected: normalizeExpected(expected),
      serverUrl: process.env.GITHUB_SERVER_URL,
      apiUrl: process.env.GITHUB_API_URL,
    });
    writeJson(requireOption(options, "--output"), envelope, true);
    return;
  }
  if (command === "capture-artifacts") {
    const envelope = await fetchAuthoritativeArtifacts({
      token: process.env.GITHUB_TOKEN,
      expected: normalizeExpected(expected),
      serverUrl: process.env.GITHUB_SERVER_URL,
      apiUrl: process.env.GITHUB_API_URL,
    });
    writeJson(requireOption(options, "--output"), envelope, true);
    return;
  }
  if (command === "run-harness") {
    await runPhysicalHarness({
      outputDirectory: requireOption(options, "--output"),
      executionReceiptPath: requireOption(options, "--execution-receipt"),
      platform: requireOption(options, "--platform"),
      matrix,
      expected,
      registry: registryInput,
      collector: readJson(
        requireOption(options, "--job-identity"),
        "jobIdentity",
      ),
      runnerTemp: process.env.RUNNER_TEMP,
      harnessPath: process.env.P1_10_PHYSICAL_HARNESS_PATH,
      harnessDigest: process.env.P1_10_PHYSICAL_HARNESS_SHA256,
      attesterPath: process.env.P1_10_LOCAL_ATTESTER_PATH,
      attesterDigest: process.env.P1_10_LOCAL_ATTESTER_SHA256,
      inputManifestPath: requireOption(options, "--input-manifest"),
    });
    return;
  }
  if (command === "collect-host") {
    collectHostEvidence({
      reportsRoot: requireOption(options, "--reports"),
      executionReceiptPath: requireOption(options, "--execution-receipt"),
      outputDirectory: requireOption(options, "--output"),
      platform: requireOption(options, "--platform"),
      matrix,
      registry: registryInput,
      expected,
      collector: readJson(
        requireOption(options, "--job-identity"),
        "jobIdentity",
      ),
      inputManifestPath: requireOption(options, "--input-manifest"),
    });
    return;
  }
  const jobsPayload = readJson(requireOption(options, "--jobs"), "jobs");
  const artifactsPayload = readJson(
    requireOption(options, "--artifacts"),
    "artifacts",
  );
  const evidence = aggregateExternalEvidence({
    platformArtifactsRoot: requireOption(options, "--platform-artifacts"),
    jobs: jobsPayload,
    artifacts: artifactsPayload,
    matrix,
    registry: registryInput,
    expected,
  });
  writeJson(requireOption(options, "--output"), evidence);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      (error?.code ? error.code + ": " : "") +
        (error?.message || String(error)) +
        "\n",
    );
    process.exitCode = 1;
  });
}
