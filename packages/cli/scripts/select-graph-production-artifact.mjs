#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  loadTrustedJsonFile,
  writeNewAggregateFile,
} from "./assemble-graph-production-cutover-evidence.mjs";

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function time(value, field) {
  const milliseconds = Date.parse(String(value || ""));
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} is invalid`);
  return milliseconds;
}

export function selectGraphProductionArtifact(
  pages,
  run,
  { expectedName, expectedRunId, expectedRunAttempt, expectedCommitSha },
) {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 100) {
    throw new Error("paginated artifact response must contain 1-100 pages");
  }
  const totals = pages.map((page, index) => {
    const total = Number(page?.total_count);
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      !Array.isArray(page.artifacts) ||
      !Number.isSafeInteger(total) ||
      total < 1
    ) {
      throw new Error(`artifact page ${index + 1} has an invalid shape`);
    }
    return total;
  });
  if (new Set(totals).size !== 1) {
    throw new Error("paginated artifact total_count changed between pages");
  }
  const artifacts = pages.flatMap((page) => page.artifacts);
  const artifactIds = artifacts.map((artifact, index) => {
    const id = Number(artifact?.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`artifact ${index + 1} has an invalid id`);
    }
    return id;
  });
  const apiTotalCount = totals[0];
  if (
    apiTotalCount !== artifacts.length ||
    new Set(artifactIds).size !== artifactIds.length
  ) {
    throw new Error(
      "paginated artifact response is truncated or contains duplicate ids",
    );
  }
  const matches = artifacts.filter(
    (artifact) => artifact?.name === expectedName,
  );
  if (matches.length !== 1) {
    throw new Error("expected exactly one attempt-scoped production artifact");
  }
  const artifact = matches[0];
  const startedAt = time(run?.run_started_at, "run.run_started_at");
  const completedAt = time(run?.updated_at, "run.updated_at");
  const createdAt = time(artifact?.created_at, "artifact.created_at");
  const updatedAt = time(artifact?.updated_at, "artifact.updated_at");
  if (
    !Number.isSafeInteger(Number(artifact?.id)) ||
    Number(artifact.id) < 1 ||
    artifact?.expired !== false ||
    Number(run?.id) !== Number(expectedRunId) ||
    !Number.isSafeInteger(Number(run?.run_attempt)) ||
    Number(run.run_attempt) !== Number(expectedRunAttempt) ||
    Number(artifact?.workflow_run?.id) !== Number(expectedRunId) ||
    run?.head_sha !== expectedCommitSha ||
    artifact?.workflow_run?.head_sha !== expectedCommitSha ||
    createdAt < startedAt ||
    updatedAt < createdAt ||
    updatedAt > completedAt
  ) {
    throw new Error(
      "production artifact does not bind the exact non-expired producer attempt window",
    );
  }
  return artifact;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const artifact = selectGraphProductionArtifact(
      loadTrustedJsonFile(required("--artifact-pages"), {
        field: "paginated artifact API response",
      }),
      loadTrustedJsonFile(required("--run"), {
        field: "exact producer run",
      }),
      {
        expectedName: required("--expected-name"),
        expectedRunId: required("--run-id"),
        expectedRunAttempt: required("--run-attempt"),
        expectedCommitSha: required("--commit"),
      },
    );
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) throw new Error("GITHUB_OUTPUT is required");
    writeNewAggregateFile(
      `${JSON.stringify(artifact, null, 2)}\n`,
      required("--metadata-output"),
    );
    fs.appendFileSync(githubOutput, `id=${artifact.id}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
