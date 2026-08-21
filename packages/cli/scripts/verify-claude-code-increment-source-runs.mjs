#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const META_WORKFLOW_PATH =
  ".github/workflows/claude-code-increment-audit.yml";
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const SOURCE_RUN_SCHEMA =
  "chainlesschain.claude-code-increment-source-runs.v1";
const SHA_RE = /^[a-f0-9]{40}$/u;
const RUN_ID_RE = /^[1-9][0-9]{4,24}$/u;

export const SOURCE_RUNS = Object.freeze({
  safety: Object.freeze({
    workflowPath: ".github/workflows/ide-roadmap-safety.yml",
    commitments: Object.freeze(["RC-DEFAULT", "SEC-DELTA"]),
  }),
  reliability: Object.freeze({
    workflowPath: ".github/workflows/cli-reliability-soak.yml",
    commitments: Object.freeze(["XSESSION", "MCP-LIFECYCLE"]),
  }),
  accessibility: Object.freeze({
    workflowPath:
      ".github/workflows/ide-roadmap-accessibility-performance.yml",
    commitments: Object.freeze([
      "AX-TRANSCRIPT",
      "SESSION-UX",
      "DIAG-SCALE",
      "IDE-INPUT-PERF",
    ]),
  }),
  sessionScale: Object.freeze({
    workflowPath: ".github/workflows/cli-session-scale.yml",
    commitments: Object.freeze(["SESSION-RUNTIME"]),
  }),
  marketplace: Object.freeze({
    workflowPath:
      ".github/workflows/ide-roadmap-marketplace-supply-chain.yml",
    commitments: Object.freeze(["PLUGIN-SOURCE"]),
  }),
  location: Object.freeze({
    workflowPath: ".github/workflows/ide-roadmap-execution-location.yml",
    commitments: Object.freeze(["LOCATION-DRAIN"]),
  }),
  ideExtensions: Object.freeze({
    workflowPath: ".github/workflows/ide-extensions.yml",
    commitments: Object.freeze(["BROWSER-EVIDENCE"]),
  }),
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return value;
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, resolved);
}

function filesRecursively(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesRecursively(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

function workflowRefPattern(repository, workflowPath) {
  const escaped = `${repository}/${workflowPath}`.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  return new RegExp(`^${escaped}@(?:refs/[^\\s]+|[a-f0-9]{40})$`, "u");
}

function normalizeRun(label, metadata, { releaseCommit, repository }) {
  const expected = SOURCE_RUNS[label];
  assert.ok(expected, `unknown source run label ${label}`);
  assert.ok(RUN_ID_RE.test(String(metadata.id || "")), `${label} run id`);
  assert.equal(metadata.repository?.full_name, repository, `${label} repository`);
  assert.equal(metadata.path, expected.workflowPath, `${label} workflow path`);
  assert.equal(metadata.head_sha, releaseCommit, `${label} head SHA`);
  assert.equal(metadata.status, "completed", `${label} run status`);
  assert.equal(metadata.conclusion, "success", `${label} run conclusion`);
  assert.ok(
    ["pull_request", "push", "schedule", "workflow_dispatch"].includes(
      metadata.event,
    ),
    `${label} run event`,
  );
  assert.ok(
    Number.isInteger(metadata.run_attempt) && metadata.run_attempt >= 1,
    `${label} run attempt`,
  );
  assert.match(
    metadata.html_url || "",
    /^https:\/\/github\.com\/[^\s]+\/actions\/runs\/[0-9]+$/u,
    `${label} run URL`,
  );
  return {
    label,
    runId: String(metadata.id),
    runAttempt: metadata.run_attempt,
    workflowPath: expected.workflowPath,
    headSha: metadata.head_sha,
    event: metadata.event,
    htmlUrl: metadata.html_url,
    commitments: [...expected.commitments],
  };
}

function verifyMetaWorkflowAuthority({
  releaseCommit,
  required,
  githubActions = process.env.GITHUB_ACTIONS,
  githubSha = process.env.GITHUB_SHA,
  workflowSha = process.env.GITHUB_WORKFLOW_SHA,
  workflowRef = process.env.GITHUB_WORKFLOW_REF,
  repository = process.env.GITHUB_REPOSITORY,
  producerReader = (commit, producerPath) =>
    execFileSync("git", ["show", `${commit}:${producerPath}`], {
      cwd: REPOSITORY_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    }),
}) {
  if (!required) return null;
  assert.equal(githubActions, "true", "required aggregation must run in Actions");
  assert.equal(githubSha, releaseCommit, "aggregator run head must equal release commit");
  assert.match(workflowSha || "", SHA_RE, "aggregator workflow SHA");
  assert.match(
    workflowRef || "",
    workflowRefPattern(repository, META_WORKFLOW_PATH),
    "aggregator workflow ref",
  );
  const releaseBytes = producerReader(releaseCommit, META_WORKFLOW_PATH);
  const executedBytes = producerReader(workflowSha, META_WORKFLOW_PATH);
  assert.equal(
    sha256(executedBytes),
    sha256(releaseBytes),
    "executed aggregator workflow bytes differ from the release commit",
  );
  return sha256(releaseBytes);
}

export function verifySourceRuns({
  metadataDirectory,
  fragmentsDirectory,
  releaseCommit,
  repository,
  required = false,
  authority = {},
}) {
  assert.match(releaseCommit || "", SHA_RE, "release commit");
  assert.match(repository || "", /^[^/\s]+\/[^/\s]+$/u, "repository");
  const workflowDigest = verifyMetaWorkflowAuthority({
    releaseCommit,
    required,
    repository,
    ...authority,
  });
  const runs = [];
  const seenRunIds = new Set();
  const requiredCells = [];
  for (const [label, expected] of Object.entries(SOURCE_RUNS)) {
    const metadata = readJson(
      path.join(path.resolve(metadataDirectory), `${label}.json`),
      `${label} source run`,
    );
    const run = normalizeRun(label, metadata, { releaseCommit, repository });
    assert.ok(!seenRunIds.has(run.runId), `duplicate source run ${run.runId}`);
    seenRunIds.add(run.runId);
    const sourceRoot = path.join(path.resolve(fragmentsDirectory), label);
    assert.ok(fs.statSync(sourceRoot).isDirectory(), `${label} fragment directory`);
    const fragments = filesRecursively(sourceRoot)
      .map((filePath) => ({ filePath, value: readJson(filePath, filePath) }))
      .filter(({ value }) => value?.schema === FRAGMENT_SCHEMA);
    assert.ok(fragments.length > 0, `${label} has no canonical fragments`);
    const requiredCommitments = new Set();
    for (const { filePath, value } of fragments) {
      assert.ok(
        expected.commitments.includes(value.commitmentId),
        `${label} contains unexpected ${value.commitmentId} fragment`,
      );
      assert.equal(value.headSha, releaseCommit, `${filePath} head SHA`);
      assert.equal(value.source?.runId, run.runId, `${filePath} source run`);
      assert.match(
        value.source?.workflowId || "",
        workflowRefPattern(repository, expected.workflowPath),
        `${filePath} source workflow`,
      );
      if (value.disposition === "required") {
        requiredCommitments.add(value.commitmentId);
        requiredCells.push(`${value.commitmentId}/${value.os}`);
      }
    }
    for (const commitmentId of expected.commitments) {
      assert.ok(
        requiredCommitments.has(commitmentId),
        `${label} is missing required ${commitmentId} fragments`,
      );
    }
    runs.push(run);
  }
  return {
    schema: SOURCE_RUN_SCHEMA,
    releaseCommit,
    repository,
    aggregatorWorkflowDigest: workflowDigest,
    requiredCellCount: new Set(requiredCells).size,
    runs,
  };
}

function parseArgs(argv) {
  const options = { required: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--required") {
      options.required = true;
      continue;
    }
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[++index];
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.ok(options.metadataDir, "--metadata-dir is required");
  assert.ok(options.fragmentsDir, "--fragments-dir is required");
  assert.ok(options.releaseCommit, "--release-commit is required");
  assert.ok(options.repository, "--repository is required");
  assert.ok(options.output, "--output is required");
  writeJson(
    options.output,
    verifySourceRuns({
      metadataDirectory: options.metadataDir,
      fragmentsDirectory: options.fragmentsDir,
      releaseCommit: options.releaseCommit,
      repository: options.repository,
      required: options.required,
    }),
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(SCRIPT_PATH).href
) {
  main();
}

export { META_WORKFLOW_PATH, SOURCE_RUN_SCHEMA, verifyMetaWorkflowAuthority };
