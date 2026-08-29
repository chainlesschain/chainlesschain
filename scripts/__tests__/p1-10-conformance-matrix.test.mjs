import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  digestP110Evidence,
  P1_10_EVIDENCE_DOMAIN,
  P1_10_EVIDENCE_SCHEMA,
  P1_10_MATRIX_DOMAIN,
  P1_10_PLATFORM_EVIDENCE_DOMAIN,
  P1_10_RECEIPT_SCHEMA,
  P1_10_SCENARIO_EVIDENCE_DOMAIN,
  validateExternalEvidence,
} from "../p1-10-external-evidence-gate.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const matrix = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "tests/fixtures/p1-10-conformance-matrix.json"),
    "utf8",
  ),
);
const expected = Object.freeze({
  commitSha: "a".repeat(40),
  repository: "chainlesschain/chainlesschain",
  workflow: ".github/workflows/p1-10-external-producer.yml",
  runId: 123456,
  runAttempt: 2,
  environment: "p1-10-external-conformance",
  challenge: "p1_10_external_challenge_0123456789abcdef",
});

function externalRequirements() {
  return matrix.scenarios
    .flatMap((scenario) =>
      scenario.cells.filter((cell) => cell.status === "external-required"),
    )
    .sort((left, right) =>
      left.evidenceScenario.localeCompare(right.evidenceScenario),
    );
}

function platformEvidence(requirement, platform, seed) {
  const startedAt = "2026-08-30T00:00:00.000Z";
  const endedAt = new Date(
    Date.parse(startedAt) + requirement.minimumDurationMs,
  ).toISOString();
  const metrics = Object.fromEntries([
    ...requirement.requiredMetrics.positive.map((name) => [name, 1]),
    ...requirement.requiredMetrics.zero.map((name) => [name, 0]),
  ]);
  const body = {
    platform,
    status: "passed",
    startedAt,
    endedAt,
    durationMs: requirement.minimumDurationMs,
    hosts: Array.from(
      { length: requirement.minimumDistinctHosts },
      (_, index) => ({
        idDigest: `sha256:${String(seed + index).padStart(64, "0")}`,
        hostClass: "physical",
      }),
    ),
    artifacts: [
      {
        kind: "journey-receipt",
        name: `${requirement.evidenceScenario}-${platform}.json`,
        digest: `sha256:${String(seed + 100).padStart(64, "0")}`,
        sizeBytes: 1024,
      },
    ],
    metrics,
  };
  return {
    ...body,
    evidenceDigest: digestP110Evidence(body, P1_10_PLATFORM_EVIDENCE_DOMAIN),
  };
}

function scenarioEvidence(requirement, index) {
  const body = {
    scenario: requirement.evidenceScenario,
    status: "passed",
    platforms: [...requirement.requiredPlatforms]
      .sort()
      .map((platform, platformIndex) =>
        platformEvidence(
          requirement,
          platform,
          1000 + index * 100 + platformIndex * 10,
        ),
      ),
  };
  return {
    ...body,
    evidenceDigest: digestP110Evidence(body, P1_10_SCENARIO_EVIDENCE_DOMAIN),
  };
}

function validEvidence() {
  const body = {
    schema: P1_10_EVIDENCE_SCHEMA,
    status: "passed",
    commitSha: expected.commitSha,
    matrixDigest: digestP110Evidence(matrix, P1_10_MATRIX_DOMAIN),
    producer: {
      repository: expected.repository,
      workflow: expected.workflow,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      environment: expected.environment,
      challenge: expected.challenge,
    },
    issuedAt: "2026-08-30T01:00:00.000Z",
    results: externalRequirements().map(scenarioEvidence),
  };
  return {
    ...body,
    evidenceDigest: digestP110Evidence(body, P1_10_EVIDENCE_DOMAIN),
  };
}

function resignPlatform(evidence, scenarioIndex, platformIndex) {
  const platform = evidence.results[scenarioIndex].platforms[platformIndex];
  const body = { ...platform };
  delete body.evidenceDigest;
  platform.evidenceDigest = digestP110Evidence(
    body,
    P1_10_PLATFORM_EVIDENCE_DOMAIN,
  );
  const scenario = evidence.results[scenarioIndex];
  const scenarioBody = { ...scenario };
  delete scenarioBody.evidenceDigest;
  scenario.evidenceDigest = digestP110Evidence(
    scenarioBody,
    P1_10_SCENARIO_EVIDENCE_DOMAIN,
  );
  const evidenceBody = { ...evidence };
  delete evidenceBody.evidenceDigest;
  evidence.evidenceDigest = digestP110Evidence(
    evidenceBody,
    P1_10_EVIDENCE_DOMAIN,
  );
}

test("P1-10 conformance matrix covers every local host and exact external boundary", () => {
  assert.equal(matrix.schema, "chainlesschain.p1-10-conformance-matrix/v1");
  assert.ok(matrix.scenarios.length >= 5);
  const causal = matrix.scenarios.find(
    (scenario) => scenario.id === "causal-agent-stream",
  );
  assert.deepEqual(
    causal.cells
      .filter((cell) => cell.status === "repo-local")
      .map((cell) => cell.host)
      .sort(),
    ["cli", "desktop", "jetbrains", "python-sdk", "vscode"],
  );
  const requirements = externalRequirements();
  assert.deepEqual(requirements.map((cell) => cell.evidenceScenario).sort(), [
    "cross-version-graph-definition-migration",
    "long-running-desktop-soak",
    "packaged-electron-collaboration-crash-recovery",
    "real-multi-host-causal-agent-stream",
    "two-physical-host-mtc-roundtrip",
  ]);
  for (const requirement of requirements) {
    assert.deepEqual([...requirement.requiredPlatforms].sort(), [
      "linux",
      "macos",
      "windows",
    ]);
    assert.ok(requirement.minimumDurationMs > 0);
    assert.ok(requirement.minimumDistinctHosts > 0);
    assert.ok(requirement.requiredMetrics.positive.length > 0);
    assert.ok(requirement.requiredMetrics.zero.length > 0);
  }
});

test("every repo-local cell points to a present fixture and consumer test", () => {
  for (const scenario of matrix.scenarios) {
    for (const fixture of scenario.fixtures) {
      assert.ok(fs.existsSync(path.join(repoRoot, fixture)), fixture);
    }
    for (const cell of scenario.cells.filter(
      (candidate) => candidate.status === "repo-local",
    )) {
      assert.ok(cell.consumerTest, `${scenario.id}/${cell.host}`);
      assert.ok(
        fs.existsSync(path.join(repoRoot, cell.consumerTest)),
        cell.consumerTest,
      );
    }
  }
  assert.ok(fs.existsSync(path.join(repoRoot, matrix.externalEvidenceGate)));
});

test("valid exact-SHA evidence returns a content-free receipt", () => {
  const receipt = validateExternalEvidence(matrix, validEvidence(), expected);
  assert.equal(receipt.schema, P1_10_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.commitSha, expected.commitSha);
  assert.equal(receipt.scenarioCount, 5);
  assert.equal(receipt.platformCount, 15);
  assert.match(receipt.receiptDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(receipt).includes("messagesSent"), false);
});

test("protected producer identity and exact source are mandatory", () => {
  assert.throws(
    () => validateExternalEvidence(matrix, validEvidence()),
    /expected\.commitSha is required/,
  );
  assert.throws(
    () =>
      validateExternalEvidence(matrix, validEvidence(), {
        ...expected,
        commitSha: "b".repeat(40),
      }),
    /commit does not match/,
  );
  assert.throws(
    () =>
      validateExternalEvidence(matrix, validEvidence(), {
        ...expected,
        runId: expected.runId + 1,
      }),
    /producer\.runId does not match/,
  );
});

test("missing, duplicate, short, or single-host external cells fail closed", () => {
  const missing = validEvidence();
  missing.results.pop();
  assert.throws(
    () => validateExternalEvidence(matrix, missing, expected),
    /results must contain exactly/,
  );

  const duplicate = validEvidence();
  duplicate.results.push(structuredClone(duplicate.results[0]));
  assert.throws(
    () => validateExternalEvidence(matrix, duplicate, expected),
    /duplicate external scenario/,
  );

  const short = validEvidence();
  short.results[0].platforms[0].durationMs -= 1;
  assert.throws(
    () => validateExternalEvidence(matrix, short, expected),
    /durationMs must equal/,
  );

  const multiHostIndex = externalRequirements().findIndex(
    (requirement) => requirement.minimumDistinctHosts === 2,
  );
  const singleHost = validEvidence();
  singleHost.results[multiHostIndex].platforms[0].hosts.pop();
  assert.throws(
    () => validateExternalEvidence(matrix, singleHost, expected),
    /distinct physical hosts/,
  );
});

test("metric failures and digest tampering cannot be hidden by resigning parents", () => {
  const evidence = validEvidence();
  const requirement = externalRequirements()[0];
  const zeroMetric = requirement.requiredMetrics.zero[0];
  evidence.results[0].platforms[0].metrics[zeroMetric] = 1;
  resignPlatform(evidence, 0, 0);
  assert.throws(
    () => validateExternalEvidence(matrix, evidence, expected),
    new RegExp(`${zeroMetric} must be zero`),
  );

  const artifactTamper = validEvidence();
  artifactTamper.results[0].platforms[0].artifacts[0].sizeBytes += 1;
  assert.throws(
    () => validateExternalEvidence(matrix, artifactTamper, expected),
    /evidenceDigest does not match/,
  );
});

test("platform host and artifact collections stay bounded", () => {
  const tooManyHosts = validEvidence();
  tooManyHosts.results[0].platforms[0].hosts = Array.from(
    { length: 65 },
    (_, index) => ({
      idDigest: `sha256:${String(5000 + index).padStart(64, "0")}`,
      hostClass: "physical",
    }),
  );
  resignPlatform(tooManyHosts, 0, 0);
  assert.throws(
    () => validateExternalEvidence(matrix, tooManyHosts, expected),
    /distinct physical hosts/,
  );

  const tooManyArtifacts = validEvidence();
  tooManyArtifacts.results[0].platforms[0].artifacts = Array.from(
    { length: 65 },
    (_, index) => ({
      kind: "journey-receipt",
      name: `receipt-${index}.json`,
      digest: `sha256:${String(6000 + index).padStart(64, "0")}`,
      sizeBytes: 1,
    }),
  );
  resignPlatform(tooManyArtifacts, 0, 0);
  assert.throws(
    () => validateExternalEvidence(matrix, tooManyArtifacts, expected),
    /unique content digests/,
  );
});

test("matrix drift and replay challenge mismatches fail closed", () => {
  const driftedMatrix = structuredClone(matrix);
  driftedMatrix.scenarios.at(-1).cells[0].minimumDurationMs += 1;
  assert.throws(
    () => validateExternalEvidence(driftedMatrix, validEvidence(), expected),
    /matrix digest does not match/,
  );
  assert.throws(
    () =>
      validateExternalEvidence(matrix, validEvidence(), {
        ...expected,
        challenge: "different_external_challenge_0123456789abcdef",
      }),
    /producer\.challenge does not match/,
  );
});

test("protected close workflow binds the producer run, signer, source, and receipt", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/p1-10-external-evidence-close.yml"),
    "utf8",
  );
  for (const required of [
    "environment: p1-10-external-conformance-close",
    "actions/runs/${PRODUCER_RUN_ID}",
    '[[ "${run_path}" != "${PRODUCER_WORKFLOW}" ]]',
    '[[ "${run_conclusion}" != "success" ]]',
    "run-id: ${{ inputs.producer_run_id }}",
    "--signer-workflow",
    "GITHUB_SERVER_URL#*://",
    '--source-digest "${EVIDENCE_SHA}"',
    '--expected-run-attempt "${PRODUCER_RUN_ATTEMPT}"',
    '--expected-challenge "${EVIDENCE_CHALLENGE}"',
    "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
  ]) {
    assert.ok(workflow.includes(required), required);
  }
  assert.equal(workflow.includes("continue-on-error"), false);
});
