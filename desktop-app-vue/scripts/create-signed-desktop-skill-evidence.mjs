#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_EVIDENCE_SCHEMA,
  evidenceDigest,
  validatePlatformEvidence,
} from "./verify-signed-desktop-skill-matrix.mjs";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function readJson(file, label) {
  const resolved = path.resolve(file || "");
  const stat = fs.statSync(resolved);
  assertion(
    stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024,
    `${label} is not a bounded file`,
  );
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function createPlatformEvidence(options) {
  const artifactPath = path.resolve(options.artifact || "");
  const artifactStat = fs.statSync(artifactPath);
  assertion(
    artifactStat.isFile() && artifactStat.size > 0,
    "installer artifact is empty or missing",
  );
  assertion(
    COMMIT_SHA.test(options.commitSha || ""),
    "platform evidence requires an exact commit SHA",
  );
  assertion(
    SHA256.test(options.challengeDigest || ""),
    "platform evidence requires a challenge digest",
  );
  assertion(
    Number.isSafeInteger(options.runId) && options.runId > 0,
    "platform evidence requires a run ID",
  );
  assertion(
    Number.isSafeInteger(options.runAttempt) && options.runAttempt > 0,
    "platform evidence requires a run attempt",
  );
  const journeys = Array.isArray(options.journeys)
    ? options.journeys
    : options.journeys?.journeys;
  assertion(Array.isArray(journeys), "Skill journey evidence is missing");
  const artifactSha256 = sha256File(artifactPath);
  const record = {
    schema: PLATFORM_EVIDENCE_SCHEMA,
    status: "passed",
    platform: options.platform,
    arch: options.arch,
    commitSha: options.commitSha,
    challengeDigest: options.challengeDigest,
    artifact: {
      name: path.basename(artifactPath),
      bytes: artifactStat.size,
      sha256: artifactSha256,
      signature: options.signature,
    },
    install: options.install,
    launch: options.launch,
    skillJourneys: journeys,
    provenance: {
      repository: options.repository,
      workflowRef: options.workflowRef,
      headSha: options.commitSha,
      runId: options.runId,
      runAttempt: options.runAttempt,
    },
  };
  record.evidenceDigest = evidenceDigest(record);
  validatePlatformEvidence(record, {
    expectedCommitSha: options.commitSha,
    repository: options.repository,
    workflowRef: options.workflowRef,
  });
  return Object.freeze(record);
}

async function main(argv = process.argv.slice(2)) {
  const output = argument(argv, "--output");
  assertion(output, "--output is required");
  const record = createPlatformEvidence({
    platform: argument(argv, "--platform"),
    arch: argument(argv, "--arch"),
    commitSha: argument(argv, "--expected-sha"),
    challengeDigest: argument(argv, "--challenge"),
    artifact: argument(argv, "--artifact"),
    signature: readJson(argument(argv, "--signature"), "signature evidence"),
    install: readJson(argument(argv, "--install"), "install evidence"),
    launch: readJson(argument(argv, "--launch"), "launch evidence"),
    journeys: readJson(argument(argv, "--journeys"), "Skill journey evidence"),
    repository: argument(argv, "--repository"),
    workflowRef: argument(argv, "--workflow-ref"),
    runId: Number(argument(argv, "--run-id")),
    runAttempt: Number(argument(argv, "--run-attempt")),
  });
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Signed Desktop evidence created for ${record.platform}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
