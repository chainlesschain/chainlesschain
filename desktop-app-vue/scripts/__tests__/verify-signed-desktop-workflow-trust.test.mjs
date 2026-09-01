import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DESKTOP_PRODUCER_WORKFLOW,
  readDesktopTrustJson,
  verifyDesktopAttestation,
  verifyDesktopProducerRun,
} from "../verify-signed-desktop-workflow-trust.mjs";

const EXPECTED = Object.freeze({
  commitSha: "a".repeat(40),
  repository: "chainlesschain/chainlesschain",
  runId: 33275381962,
  runAttempt: 3,
  serverUrl: "https://github.com",
  requireSuccess: true,
});

function producerRun(overrides = {}) {
  return {
    id: EXPECTED.runId,
    run_attempt: EXPECTED.runAttempt,
    head_sha: EXPECTED.commitSha,
    head_branch: "main",
    path: DESKTOP_PRODUCER_WORKFLOW,
    event: "workflow_dispatch",
    head_repository: { full_name: EXPECTED.repository },
    status: "completed",
    conclusion: "success",
    run_started_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T02:00:00Z",
    ...overrides,
  };
}

function attestation(overrides = {}) {
  const repositoryUri = `${EXPECTED.serverUrl}/${EXPECTED.repository}`;
  const signerUri = `${repositoryUri}/${DESKTOP_PRODUCER_WORKFLOW}@refs/heads/main`;
  const certificate = {
    certificateIssuer: "Fulcio",
    issuer: "https://token.actions.githubusercontent.com",
    subjectAlternativeName: signerUri,
    runnerEnvironment: "github-hosted",
    sourceRepositoryURI: repositoryUri,
    sourceRepositoryRef: "refs/heads/main",
    sourceRepositoryDigest: EXPECTED.commitSha,
    buildSignerURI: signerUri,
    buildSignerDigest: EXPECTED.commitSha,
    buildTrigger: "workflow_dispatch",
    runInvocationURI: `${repositoryUri}/actions/runs/${EXPECTED.runId}/attempts/${EXPECTED.runAttempt}`,
    ...overrides,
  };
  return [
    {
      verificationResult: {
        signature: { certificate },
        verifiedTimestamps: [
          {
            type: "rekor",
            uri: "https://rekor.sigstore.dev",
            timestamp: "2026-09-01T01:30:00Z",
          },
        ],
      },
    },
  ];
}

test("accepts the exact completed producer attempt and current in-run caller", () => {
  assert.equal(
    verifyDesktopProducerRun(producerRun(), EXPECTED).runAttempt,
    EXPECTED.runAttempt,
  );
  assert.doesNotThrow(() =>
    verifyDesktopProducerRun(
      producerRun({ status: "in_progress", conclusion: null }),
      { ...EXPECTED, requireSuccess: false },
    ),
  );
});

test("rejects stale attempts, non-main branches, forks, and non-success runs", () => {
  for (const [override, expectedOverride] of [
    [{ run_attempt: 2 }, {}],
    [{ head_sha: "b".repeat(40) }, {}],
    [{ head_branch: "release" }, {}],
    [{ path: ".github/workflows/other.yml" }, {}],
    [{ event: "push" }, {}],
    [{ head_repository: { full_name: "attacker/fork" } }, {}],
    [{ status: "completed", conclusion: "failure" }, {}],
    [{ status: "completed", conclusion: "success" }, { requireSuccess: false }],
  ]) {
    assert.throws(
      () =>
        verifyDesktopProducerRun(producerRun(override), {
          ...EXPECTED,
          ...expectedOverride,
        }),
      /exact protected-main Desktop workflow attempt/u,
    );
  }
});

test("certificate binds hosted main, signer digest, and exact run attempt", () => {
  const now = Date.parse("2026-09-01T02:00:00Z");
  assert.doesNotThrow(() =>
    verifyDesktopAttestation(attestation(), producerRun(), EXPECTED, now),
  );
  for (const override of [
    { runnerEnvironment: "self-hosted" },
    { sourceRepositoryURI: "https://github.com/attacker/fork" },
    { sourceRepositoryRef: "refs/heads/release" },
    { sourceRepositoryDigest: "b".repeat(40) },
    { buildSignerDigest: "b".repeat(40) },
    {
      runInvocationURI: `${EXPECTED.serverUrl}/${EXPECTED.repository}/actions/runs/${EXPECTED.runId}/attempts/2`,
    },
  ]) {
    assert.throws(
      () =>
        verifyDesktopAttestation(
          attestation(override),
          producerRun(),
          EXPECTED,
          now,
        ),
      /exactly one attestation certificate/u,
    );
  }
});

test("certificate identity rejects non-canonical server and repository origins", () => {
  for (const expectedOverride of [
    { serverUrl: "https://github.com/chainlesschain" },
    { serverUrl: "https://github.com?repository=chainlesschain" },
    { serverUrl: "http://github.com" },
    { repository: "chainlesschain/chainlesschain/extra" },
  ]) {
    assert.throws(
      () =>
        verifyDesktopAttestation(
          attestation(),
          producerRun(),
          { ...EXPECTED, ...expectedOverride },
          Date.parse("2026-09-01T02:00:00Z"),
        ),
      /canonical HTTPS origin|owner\/repository/u,
    );
  }
});

test("rejects stale, future, out-of-window, and ambiguous verified timestamps", () => {
  for (const [timestamp, now] of [
    ["2026-08-31T23:00:00Z", "2026-09-01T02:00:00Z"],
    ["2026-09-01T03:00:00Z", "2026-09-01T02:00:00Z"],
    ["2026-09-01T01:30:00Z", "2026-09-02T02:00:00Z"],
  ]) {
    const results = attestation();
    results[0].verificationResult.verifiedTimestamps[0].timestamp = timestamp;
    assert.throws(
      () =>
        verifyDesktopAttestation(
          results,
          producerRun(),
          EXPECTED,
          Date.parse(now),
        ),
      /exactly one attestation certificate/u,
    );
  }
  const duplicate = [...attestation(), ...attestation()];
  assert.throws(
    () =>
      verifyDesktopAttestation(
        duplicate,
        producerRun(),
        EXPECTED,
        Date.parse("2026-09-01T02:00:00Z"),
      ),
    /exactly one attestation certificate/u,
  );
});

test("trust JSON loader requires one read-only regular inode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-desktop-trust-"));
  const file = path.join(root, "run.json");
  const linked = path.join(root, "run-linked.json");
  try {
    fs.writeFileSync(file, '{"status":"in_progress"}\n', "utf8");
    assert.throws(
      () => readDesktopTrustJson(file),
      /read-only, non-hardlinked regular JSON file/u,
    );
    fs.chmodSync(file, 0o444);
    assert.equal(readDesktopTrustJson(file).status, "in_progress");
    fs.linkSync(file, linked);
    assert.throws(
      () => readDesktopTrustJson(file),
      /read-only, non-hardlinked regular JSON file/u,
    );
  } finally {
    for (const target of [file, linked]) {
      try {
        fs.chmodSync(target, 0o644);
      } catch {
        // The target might not have been created.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
