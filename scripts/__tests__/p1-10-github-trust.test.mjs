import assert from "node:assert/strict";
import test from "node:test";
import {
  selectP110Artifacts,
  verifyP110Attestation,
} from "../p1-10-github-trust.mjs";

const expected = Object.freeze({
  serverUrl: "https://github.com",
  repository: "chainlesschain/chainlesschain",
  workflow: ".github/workflows/p1-10-external-evidence-producer.yml",
  commitSha: "a".repeat(40),
  runId: 33411796790,
  runAttempt: 3,
});

function runFixture() {
  return {
    id: expected.runId,
    run_attempt: expected.runAttempt,
    head_sha: expected.commitSha,
    path: expected.workflow,
    event: "workflow_dispatch",
    conclusion: "success",
    head_branch: "main",
    head_repository: { full_name: expected.repository },
    run_started_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T01:00:00Z",
  };
}

function artifact(id, kind, minute) {
  return {
    id,
    name: `p1-10-${kind}-${expected.runId}-${expected.runAttempt}`,
    expired: false,
    created_at: `2026-09-01T00:${minute}:00Z`,
    updated_at: `2026-09-01T00:${minute}:30Z`,
    workflow_run: { id: expected.runId, head_sha: expected.commitSha },
  };
}

function pagesFixture() {
  return [
    {
      total_count: 2,
      artifacts: [
        artifact(11, "challenge", "05"),
        artifact(12, "external-evidence", "55"),
      ],
    },
  ];
}

function attestationFixture() {
  const sourceRepositoryURI = `${expected.serverUrl}/${expected.repository}`;
  const sourceRef = "refs/heads/main";
  const signer = `${sourceRepositoryURI}/${expected.workflow}@${sourceRef}`;
  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            certificateIssuer: "Fulcio",
            issuer: "https://token.actions.githubusercontent.com",
            subjectAlternativeName: signer,
            runnerEnvironment: "github-hosted",
            sourceRepositoryURI,
            sourceRepositoryRef: sourceRef,
            sourceRepositoryDigest: expected.commitSha,
            buildSignerURI: signer,
            buildSignerDigest: expected.commitSha,
            buildTrigger: "workflow_dispatch",
            runInvocationURI: `${sourceRepositoryURI}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`,
          },
        },
        verifiedTimestamps: [
          {
            type: "rekor",
            uri: "https://rekor.sigstore.dev",
            timestamp: "2026-09-01T00:55:20Z",
          },
        ],
      },
    },
  ];
}

test("attempt artifact selection is unique, complete, and bound to the run REST window", () => {
  const selected = selectP110Artifacts(pagesFixture(), runFixture(), expected);
  assert.equal(selected.challenge.id, 11);
  assert.equal(selected.evidence.id, 12);

  const duplicate = pagesFixture();
  duplicate[0].total_count += 1;
  duplicate[0].artifacts.push(structuredClone(duplicate[0].artifacts[1]));
  duplicate[0].artifacts[2].id = 13;
  assert.throws(
    () => selectP110Artifacts(duplicate, runFixture(), expected),
    /exactly one non-replayable evidence artifact/,
  );

  const incomplete = pagesFixture();
  incomplete[0].total_count = 3;
  assert.throws(
    () => selectP110Artifacts(incomplete, runFixture(), expected),
    /pagination is incomplete/,
  );
});

test("OIDC certificate identity binds hosted main, signer digest, and exact run attempt", () => {
  const selected = selectP110Artifacts(pagesFixture(), runFixture(), expected);
  assert.doesNotThrow(() =>
    verifyP110Attestation(
      attestationFixture(),
      runFixture(),
      selected.evidence,
      expected,
      Date.parse("2026-09-01T01:00:00Z"),
    ),
  );

  for (const mutate of [
    (certificate) => {
      certificate.runnerEnvironment = "self-hosted";
    },
    (certificate) => {
      certificate.runInvocationURI = certificate.runInvocationURI.replace(
        "/attempts/3",
        "/attempts/2",
      );
    },
    (certificate) => {
      certificate.buildSignerDigest = "b".repeat(40);
    },
  ]) {
    const invalid = attestationFixture();
    mutate(invalid[0].verificationResult.signature.certificate);
    assert.throws(
      () =>
        verifyP110Attestation(
          invalid,
          runFixture(),
          selected.evidence,
          expected,
          Date.parse("2026-09-01T01:00:00Z"),
        ),
      /exactly one certificate/,
    );
  }
});

test("stale verified timestamps are rejected to prevent replay", () => {
  const selected = selectP110Artifacts(pagesFixture(), runFixture(), expected);
  assert.throws(
    () =>
      verifyP110Attestation(
        attestationFixture(),
        runFixture(),
        selected.evidence,
        expected,
        Date.parse("2026-09-02T00:00:00Z"),
      ),
    /exactly one certificate/,
  );
});
