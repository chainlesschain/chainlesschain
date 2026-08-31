#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadTrustedJsonFile } from "./assemble-graph-production-cutover-evidence.mjs";

const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_ATTESTATION_AGE_MS = 370 * 24 * 60 * 60 * 1_000;
const MAX_VERIFIED_RESULTS = 32;
const MAX_VERIFIED_TIMESTAMPS = 32;

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function milliseconds(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) throw new Error(`${field} is invalid`);
  return parsed;
}

function positive(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return parsed;
}

export function verifyGraphProductionAttestationCertificate(
  results,
  expected,
  { clock = Date.now } = {},
) {
  if (
    !Array.isArray(results) ||
    results.length === 0 ||
    results.length > MAX_VERIFIED_RESULTS
  ) {
    throw new Error("verified attestation result must be a non-empty array");
  }
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs)) throw new Error("trusted clock is invalid");
  const run = expected.run;
  const artifact = expected.artifact;
  const sourceRepositoryURI = `${expected.serverUrl}/${expected.repository}`;
  const sourceRepositoryRef = "refs/heads/main";
  const buildSignerURI = `${sourceRepositoryURI}/${expected.workflow}@${sourceRepositoryRef}`;
  const runInvocationURI = `${sourceRepositoryURI}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`;
  const runStartedAt = milliseconds(run?.run_started_at, "run.run_started_at");
  const runCompletedAt = milliseconds(run?.updated_at, "run.updated_at");
  const artifactUpdatedAt = milliseconds(
    artifact?.updated_at,
    "artifact.updated_at",
  );
  if (
    positive(run?.id, "run.id") !== Number(expected.runId) ||
    positive(run?.run_attempt, "run.run_attempt") !==
      Number(expected.runAttempt) ||
    run?.head_sha !== expected.commitSha ||
    run?.path !== expected.workflow ||
    run?.event !== "workflow_dispatch" ||
    run?.conclusion !== "success" ||
    run?.head_branch !== "main" ||
    runStartedAt > runCompletedAt ||
    artifact?.name !==
      `graph-production-cutover-evidence-${expected.runAttempt}` ||
    artifact?.expired !== false ||
    positive(artifact?.workflow_run?.id, "artifact.workflow_run.id") !==
      Number(expected.runId) ||
    artifact?.workflow_run?.head_sha !== expected.commitSha ||
    artifactUpdatedAt < runStartedAt ||
    artifactUpdatedAt > runCompletedAt
  ) {
    throw new Error(
      "producer run and selected artifact do not bind the exact successful main attempt",
    );
  }
  const matches = results.flatMap((result) => {
    const certificate = result?.verificationResult?.signature?.certificate;
    if (
      typeof certificate?.certificateIssuer === "string" &&
      certificate.certificateIssuer.length >= 1 &&
      certificate.certificateIssuer.length <= 512 &&
      certificate?.issuer === "https://token.actions.githubusercontent.com" &&
      certificate?.subjectAlternativeName === buildSignerURI &&
      certificate?.runnerEnvironment === "github-hosted" &&
      certificate?.sourceRepositoryURI === sourceRepositoryURI &&
      certificate?.sourceRepositoryRef === sourceRepositoryRef &&
      certificate?.sourceRepositoryDigest === expected.commitSha &&
      certificate?.buildSignerURI === buildSignerURI &&
      certificate?.buildSignerDigest === expected.commitSha &&
      certificate?.buildTrigger === "workflow_dispatch" &&
      certificate?.runInvocationURI === runInvocationURI
    ) {
      const timestamps = result?.verificationResult?.verifiedTimestamps;
      if (
        !Array.isArray(timestamps) ||
        timestamps.length < 1 ||
        timestamps.length > MAX_VERIFIED_TIMESTAMPS
      ) {
        return [];
      }
      const verifiedTimes = timestamps.map((timestamp, index) => {
        if (
          typeof timestamp?.type !== "string" ||
          !timestamp.type ||
          typeof timestamp?.uri !== "string" ||
          !timestamp.uri
        ) {
          throw new Error(`verifiedTimestamps[${index}] is incomplete`);
        }
        return milliseconds(
          timestamp.timestamp,
          `verifiedTimestamps[${index}].timestamp`,
        );
      });
      if (
        verifiedTimes.some(
          (value) =>
            value < runStartedAt - CLOCK_SKEW_MS ||
            value > artifactUpdatedAt + CLOCK_SKEW_MS ||
            value > nowMs + CLOCK_SKEW_MS ||
            nowMs - value > MAX_ATTESTATION_AGE_MS,
        )
      ) {
        return [];
      }
      const trustedTimestampMs = Math.max(...verifiedTimes);
      return [{ result, trustedTimestampMs }];
    }
    return [];
  });
  if (matches.length !== 1) {
    throw new Error(
      "exactly one cryptographically verified certificate must bind the hosted aggregate run and attempt",
    );
  }
  return {
    result: matches[0].result,
    trustedTimestamp: new Date(matches[0].trustedTimestampMs).toISOString(),
    trustedTimestampMs: matches[0].trustedTimestampMs,
  };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const input = required("--input");
    const run = loadTrustedJsonFile(required("--run"), {
      field: "exact producer run",
    });
    const artifact = loadTrustedJsonFile(required("--artifact"), {
      field: "selected attempt artifact",
    });
    const expected = {
      serverUrl: required("--server-url").replace(/\/$/u, ""),
      repository: required("--repository"),
      workflow: required("--workflow"),
      commitSha: required("--commit"),
      runId: required("--run-id"),
      runAttempt: required("--run-attempt"),
      run,
      artifact,
    };
    const results = loadTrustedJsonFile(path.resolve(input), {
      field: "gh attestation verification result",
    });
    const verified = verifyGraphProductionAttestationCertificate(
      results,
      expected,
    );
    process.stdout.write(
      `${expected.runId}/${expected.runAttempt} ${verified.trustedTimestamp}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
