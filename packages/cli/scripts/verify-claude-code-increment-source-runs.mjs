#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserEvidenceDigest } from "../src/lib/browser-evidence.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
const META_WORKFLOW_PATH = ".github/workflows/claude-code-increment-audit.yml";
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const SOURCE_RUN_PLAN_SCHEMA =
  "chainlesschain.claude-code-increment-source-run-plan.v1";
const SOURCE_RUN_SCHEMA = "chainlesschain.claude-code-increment-source-runs.v2";
const BROWSER_WORKFLOW_PROVENANCE_SCHEMA =
  "chainlesschain.browser-evidence-workflow-provenance.v1";
const BROWSER_JOURNEY_SUMMARY_SCHEMA =
  "chainlesschain.browser-evidence-journey-summary.v2";
const BROWSER_WORKFLOW_PATH = ".github/workflows/ide-extensions.yml";
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID_RE = /^[1-9][0-9]{4,24}$/u;
const ARTIFACT_ID_RE = /^[1-9][0-9]{0,31}$/u;
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const RUNNER_OS = Object.freeze({
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
});
const MATRIX_OS = Object.freeze({
  linux: "ubuntu-latest",
  macos: "macos-latest",
  windows: "windows-latest",
});

export const SOURCE_RUNS = Object.freeze({
  safety: Object.freeze({
    outputKey: "safety_artifact_ids",
    workflowPath: ".github/workflows/ide-roadmap-safety.yml",
    commitments: Object.freeze(["RC-DEFAULT", "SEC-DELTA"]),
  }),
  reliability: Object.freeze({
    outputKey: "reliability_artifact_ids",
    workflowPath: ".github/workflows/cli-reliability-soak.yml",
    commitments: Object.freeze(["XSESSION", "MCP-LIFECYCLE"]),
  }),
  accessibility: Object.freeze({
    outputKey: "accessibility_artifact_ids",
    workflowPath: ".github/workflows/ide-roadmap-accessibility-performance.yml",
    commitments: Object.freeze([
      "AX-TRANSCRIPT",
      "SESSION-UX",
      "DIAG-SCALE",
      "IDE-INPUT-PERF",
    ]),
  }),
  sessionScale: Object.freeze({
    outputKey: "session_scale_artifact_ids",
    workflowPath: ".github/workflows/cli-session-scale.yml",
    commitments: Object.freeze(["SESSION-RUNTIME"]),
  }),
  marketplace: Object.freeze({
    outputKey: "marketplace_artifact_ids",
    workflowPath: ".github/workflows/ide-roadmap-marketplace-supply-chain.yml",
    commitments: Object.freeze(["PLUGIN-SOURCE"]),
  }),
  location: Object.freeze({
    outputKey: "location_artifact_ids",
    workflowPath: ".github/workflows/ide-roadmap-execution-location.yml",
    commitments: Object.freeze(["LOCATION-DRAIN"]),
  }),
  ideExtensions: Object.freeze({
    outputKey: "ide_extensions_artifact_ids",
    workflowPath: ".github/workflows/ide-extensions.yml",
    commitments: Object.freeze(["BROWSER-EVIDENCE"]),
  }),
});

const REQUIRED_COMMITMENTS = Object.freeze(
  Object.values(SOURCE_RUNS).flatMap((source) => source.commitments),
);
const EXPECTED_REQUIRED_CELL_COUNT =
  REQUIRED_COMMITMENTS.length * REQUIRED_OPERATING_SYSTEMS.length;

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

function assertExactKeys(value, expectedKeys, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expectedKeys].sort(),
    `${label} keys`,
  );
}

function filesRecursively(directory) {
  const files = [];
  const pending = [path.resolve(directory)];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const stat = fs.lstatSync(entryPath);
      assert.equal(
        stat.isSymbolicLink(),
        false,
        `source evidence cannot contain symlinks: ${entryPath}`,
      );
      if (stat.isDirectory()) pending.push(entryPath);
      else if (stat.isFile() && entry.name.endsWith(".json")) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function workflowRefPattern(repository, workflowPath) {
  const escaped = `${repository}/${workflowPath}`.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  return new RegExp(`^${escaped}@(?:refs/[^\\s]+|[a-f0-9]{40})$`, "u");
}

function sourceRunLabel(commitmentId) {
  const matches = Object.entries(SOURCE_RUNS).filter(([, source]) =>
    source.commitments.includes(commitmentId),
  );
  assert.equal(matches.length, 1, `source mapping for ${commitmentId}`);
  return matches[0][0];
}

export function expectedArtifactNames(label, releaseCommit, runAttempt) {
  assert.match(releaseCommit || "", SHA_RE, "release commit");
  assert.ok(Number.isInteger(runAttempt) && runAttempt >= 1, "run attempt");
  const attempt = String(runAttempt);
  switch (label) {
    case "safety":
      return REQUIRED_OPERATING_SYSTEMS.map(
        (os) =>
          `ide-roadmap-safety-${RUNNER_OS[os]}-${releaseCommit}-${attempt}`,
      );
    case "reliability":
      return [
        ...REQUIRED_OPERATING_SYSTEMS.map(
          (os) =>
            `session-message-fabric-${MATRIX_OS[os]}-${releaseCommit}-${attempt}`,
        ),
        ...REQUIRED_OPERATING_SYSTEMS.map(
          (os) => `mcp-lifecycle-${RUNNER_OS[os]}-${releaseCommit}-${attempt}`,
        ),
      ];
    case "accessibility":
      return REQUIRED_OPERATING_SYSTEMS.map(
        (os) => `ide-accessibility-performance-${os}-${attempt}`,
      );
    case "sessionScale":
      return REQUIRED_OPERATING_SYSTEMS.map(
        (os) =>
          `cli-session-scale-${MATRIX_OS[os]}-${releaseCommit}-${attempt}`,
      );
    case "marketplace":
      return [`ide-marketplace-supply-chain-aggregate-${attempt}`];
    case "location":
      return [`claude-code-increment-audit-location-drain-${attempt}`];
    case "ideExtensions":
      return REQUIRED_OPERATING_SYSTEMS.map(
        (os) => `browser-evidence-${os}-${releaseCommit}-${attempt}`,
      );
    default:
      throw new Error(`unknown source run label ${label}`);
  }
}

function expectedFragmentSource(
  label,
  commitmentId,
  os,
  releaseCommit,
  runAttempt,
) {
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(os), `unsupported OS ${os}`);
  const attempt = String(runAttempt);
  switch (label) {
    case "safety":
      return {
        artifactName: `ide-roadmap-safety-${RUNNER_OS[os]}-${releaseCommit}-${attempt}`,
        jobId: "safety-matrix",
      };
    case "reliability":
      return commitmentId === "XSESSION"
        ? {
            artifactName: `session-message-fabric-${MATRIX_OS[os]}-${releaseCommit}-${attempt}`,
            jobId: `session-message-fabric-${RUNNER_OS[os]}`,
          }
        : {
            artifactName: `mcp-lifecycle-${RUNNER_OS[os]}-${releaseCommit}-${attempt}`,
            jobId: "mcp-security-soak",
          };
    case "accessibility":
      return {
        artifactName: `ide-accessibility-performance-${os}-${attempt}`,
        jobId: "accessibility-performance",
      };
    case "sessionScale":
      return {
        artifactName: `cli-session-scale-${MATRIX_OS[os]}-${releaseCommit}-${attempt}`,
        jobId: "session-scale",
      };
    case "marketplace":
      return {
        artifactName: `ide-marketplace-supply-chain-aggregate-${attempt}`,
        jobId: "trusted-supply-chain-aggregate",
      };
    case "location":
      return {
        artifactName: `claude-code-increment-audit-location-drain-${attempt}`,
        jobId: "trusted-execution-location-aggregate",
      };
    case "ideExtensions":
      return {
        artifactName: `browser-evidence-${os}-${releaseCommit}-${attempt}`,
        jobId: `browser-evidence-producer-${os}`,
      };
    default:
      throw new Error(`unknown source run label ${label}`);
  }
}

function normalizeRun(label, metadata, { releaseCommit, repository }) {
  const expected = SOURCE_RUNS[label];
  assert.ok(expected, `unknown source run label ${label}`);
  assert.ok(RUN_ID_RE.test(String(metadata.id || "")), `${label} run id`);
  assert.equal(
    metadata.repository?.full_name,
    repository,
    `${label} repository`,
  );
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
  assert.equal(
    metadata.html_url,
    `https://github.com/${repository}/actions/runs/${metadata.id}`,
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

function artifactRows(document, label) {
  const pages = Array.isArray(document) ? document : [document];
  assert.ok(pages.length > 0, `${label} artifact inventory is empty`);
  return pages.flatMap((page, index) => {
    assert.ok(
      page && typeof page === "object" && Array.isArray(page.artifacts),
      `${label} artifact inventory page ${index + 1}`,
    );
    return page.artifacts;
  });
}

function normalizeArtifact(artifact, run, expectedName) {
  assert.equal(artifact.name, expectedName, `${run.label} artifact name`);
  assert.match(String(artifact.id || ""), ARTIFACT_ID_RE, `${expectedName} id`);
  assert.equal(artifact.expired, false, `${expectedName} is expired`);
  assert.match(artifact.digest || "", DIGEST_RE, `${expectedName} digest`);
  assert.ok(
    Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
    `${expectedName} size`,
  );
  assert.ok(
    artifact.workflow_run && typeof artifact.workflow_run === "object",
    `${expectedName} workflow run metadata`,
  );
  assert.equal(
    String(artifact.workflow_run.id),
    run.runId,
    `${expectedName} workflow run`,
  );
  assert.equal(
    artifact.workflow_run.head_sha,
    run.headSha,
    `${expectedName} workflow head`,
  );
  return {
    id: String(artifact.id),
    name: expectedName,
    digest: artifact.digest,
    sizeInBytes: artifact.size_in_bytes,
  };
}

function selectCurrentAttemptArtifacts(label, inventory, run) {
  const expectedNames = expectedArtifactNames(
    label,
    run.headSha,
    run.runAttempt,
  );
  const rows = artifactRows(inventory, label);
  const selected = expectedNames.map((expectedName) => {
    const matches = rows.filter((artifact) => artifact?.name === expectedName);
    assert.equal(
      matches.length,
      1,
      `${label} requires exactly one current-attempt artifact ${expectedName}`,
    );
    return normalizeArtifact(matches[0], run, expectedName);
  });
  assert.equal(
    new Set(selected.map((artifact) => artifact.id)).size,
    selected.length,
    `${label} selected duplicate artifact ids`,
  );
  return selected;
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
  assert.equal(
    githubActions,
    "true",
    "required aggregation must run in Actions",
  );
  assert.equal(
    githubSha,
    releaseCommit,
    "aggregator run head must equal release commit",
  );
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

export function createSourceRunPlan({
  metadataDirectory,
  artifactsMetadataDirectory,
  releaseCommit,
  repository,
  required = false,
  authority = {},
}) {
  assert.match(releaseCommit || "", SHA_RE, "release commit");
  assert.match(repository || "", /^[^/\s]+\/[^/\s]+$/u, "repository");
  const aggregatorWorkflowDigest = verifyMetaWorkflowAuthority({
    releaseCommit,
    required,
    repository,
    ...authority,
  });
  const runs = [];
  const seenRunIds = new Set();
  const seenArtifactIds = new Set();
  for (const label of Object.keys(SOURCE_RUNS)) {
    const metadata = readJson(
      path.join(path.resolve(metadataDirectory), `${label}.json`),
      `${label} source run`,
    );
    const run = normalizeRun(label, metadata, { releaseCommit, repository });
    assert.equal(
      seenRunIds.has(run.runId),
      false,
      `duplicate source run ${run.runId}`,
    );
    seenRunIds.add(run.runId);
    const inventory = readJson(
      path.join(path.resolve(artifactsMetadataDirectory), `${label}.json`),
      `${label} artifact inventory`,
    );
    const artifacts = selectCurrentAttemptArtifacts(label, inventory, run);
    for (const artifact of artifacts) {
      assert.equal(
        seenArtifactIds.has(artifact.id),
        false,
        `duplicate selected artifact id ${artifact.id}`,
      );
      seenArtifactIds.add(artifact.id);
    }
    runs.push({ ...run, artifacts });
  }
  return {
    schema: SOURCE_RUN_PLAN_SCHEMA,
    releaseCommit,
    repository,
    aggregatorWorkflowDigest,
    runs,
  };
}

function validateArtifactRecord(artifact, label) {
  assertExactKeys(
    artifact,
    ["digest", "id", "name", "sizeInBytes"],
    `${label} artifact`,
  );
  assert.match(artifact.id || "", ARTIFACT_ID_RE, `${label} artifact id`);
  assert.match(artifact.digest || "", DIGEST_RE, `${label} artifact digest`);
  assert.ok(
    Number.isSafeInteger(artifact.sizeInBytes) && artifact.sizeInBytes > 0,
    `${label} artifact size`,
  );
  assert.ok(
    typeof artifact.name === "string" &&
      artifact.name.length > 0 &&
      artifact.name.length <= 255 &&
      !/[\\/]/u.test(artifact.name),
    `${label} artifact name`,
  );
  return artifact;
}

export function validateSourceRunPlan(plan, { requireAuthority = true } = {}) {
  assertExactKeys(
    plan,
    [
      "aggregatorWorkflowDigest",
      "releaseCommit",
      "repository",
      "runs",
      "schema",
    ],
    "source run plan",
  );
  assert.equal(plan.schema, SOURCE_RUN_PLAN_SCHEMA, "source run plan schema");
  assert.match(
    plan.releaseCommit || "",
    SHA_RE,
    "source run plan release commit",
  );
  assert.match(
    plan.repository || "",
    /^[^/\s]+\/[^/\s]+$/u,
    "source run plan repository",
  );
  if (requireAuthority) {
    assert.match(
      plan.aggregatorWorkflowDigest || "",
      DIGEST_RE,
      "aggregator workflow digest",
    );
  } else if (plan.aggregatorWorkflowDigest !== null) {
    assert.match(plan.aggregatorWorkflowDigest, DIGEST_RE);
  }
  assert.ok(Array.isArray(plan.runs), "source run plan runs");
  assert.deepEqual(
    plan.runs.map((run) => run.label),
    Object.keys(SOURCE_RUNS),
    "source run plan labels",
  );
  const artifactIds = new Set();
  for (const run of plan.runs) {
    assertExactKeys(
      run,
      [
        "artifacts",
        "commitments",
        "event",
        "headSha",
        "htmlUrl",
        "label",
        "runAttempt",
        "runId",
        "workflowPath",
      ],
      `${run.label} source run`,
    );
    const expected = SOURCE_RUNS[run.label];
    assert.ok(expected, `unknown source run ${run.label}`);
    assert.match(run.runId || "", RUN_ID_RE, `${run.label} run id`);
    assert.ok(Number.isInteger(run.runAttempt) && run.runAttempt >= 1);
    assert.equal(run.workflowPath, expected.workflowPath);
    assert.equal(run.headSha, plan.releaseCommit);
    assert.ok(
      ["pull_request", "push", "schedule", "workflow_dispatch"].includes(
        run.event,
      ),
      `${run.label} run event`,
    );
    assert.equal(
      run.htmlUrl,
      `https://github.com/${plan.repository}/actions/runs/${run.runId}`,
      `${run.label} run URL`,
    );
    assert.deepEqual(run.commitments, [...expected.commitments]);
    assert.ok(Array.isArray(run.artifacts));
    assert.deepEqual(
      run.artifacts.map((artifact) => artifact.name),
      expectedArtifactNames(run.label, plan.releaseCommit, run.runAttempt),
      `${run.label} current-attempt artifact names`,
    );
    for (const artifact of run.artifacts) {
      validateArtifactRecord(artifact, run.label);
      assert.equal(
        artifactIds.has(artifact.id),
        false,
        `duplicate artifact id ${artifact.id}`,
      );
      artifactIds.add(artifact.id);
    }
  }
  return plan;
}

function sourceArtifactDirectory(sourceRoot, filePath) {
  const relative = path.relative(sourceRoot, filePath);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  return relative.split(/[\\/]/u)[0];
}

function validateDownloadedArtifactDirectories(sourceRoot, run) {
  assert.ok(
    fs.existsSync(sourceRoot) && fs.lstatSync(sourceRoot).isDirectory(),
    `${run.label} fragment directory`,
  );
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    assert.equal(
      entry.isDirectory(),
      true,
      `${run.label}/${entry.name} must be an artifact directory`,
    );
  }
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    run.artifacts.map((artifact) => artifact.name).sort(),
    `${run.label} downloaded artifact set`,
  );
}

function cellSort(left, right) {
  return (
    REQUIRED_COMMITMENTS.indexOf(left.commitmentId) -
      REQUIRED_COMMITMENTS.indexOf(right.commitmentId) ||
    REQUIRED_OPERATING_SYSTEMS.indexOf(left.os) -
      REQUIRED_OPERATING_SYSTEMS.indexOf(right.os) ||
    left.disposition.localeCompare(right.disposition) ||
    left.fragmentDigest.localeCompare(right.fragmentDigest)
  );
}

function expectedRequiredCells() {
  return REQUIRED_COMMITMENTS.flatMap((commitmentId) =>
    REQUIRED_OPERATING_SYSTEMS.map((os) => `${commitmentId}/${os}`),
  );
}

function validateBrowserWorkflowProvenance(
  workflow,
  { repository, releaseCommit, run, workflowId },
) {
  assertExactKeys(
    workflow,
    [
      "exactHeadWorkflowDigest",
      "exactHeadWorkflowSha",
      "executedWorkflowDigest",
      "executedWorkflowSha",
      "ref",
      "repository",
      "runAttempt",
      "runId",
      "schema",
      "workflowPath",
      "workflowRef",
    ],
    "browser workflow provenance",
  );
  assert.equal(workflow.schema, BROWSER_WORKFLOW_PROVENANCE_SCHEMA);
  assert.equal(workflow.repository, repository);
  assert.match(workflow.ref || "", /^refs\/[^\s]+$/u);
  assert.equal(workflow.workflowRef, workflowId);
  assert.equal(workflow.workflowPath, BROWSER_WORKFLOW_PATH);
  assert.match(workflow.executedWorkflowSha || "", SHA_RE);
  assert.match(workflow.executedWorkflowDigest || "", DIGEST_RE);
  assert.equal(workflow.exactHeadWorkflowSha, releaseCommit);
  assert.match(workflow.exactHeadWorkflowDigest || "", DIGEST_RE);
  assert.equal(
    workflow.executedWorkflowDigest,
    workflow.exactHeadWorkflowDigest,
    "browser executed workflow bytes must equal the exact-head workflow bytes",
  );
  assert.equal(workflow.runId, run.runId);
  assert.equal(workflow.runAttempt, String(run.runAttempt));
  return workflow;
}

function browserWorkflowProvenance(filePath, fragment, plan, run) {
  const summaryPath = path.join(
    path.dirname(filePath),
    "browser-evidence-journey-summary.json",
  );
  const summary = readJson(summaryPath, `${filePath} browser journey summary`);
  assert.equal(summary.schema, BROWSER_JOURNEY_SUMMARY_SCHEMA);
  const workflow = validateBrowserWorkflowProvenance(summary.workflow, {
    repository: plan.repository,
    releaseCommit: plan.releaseCommit,
    run,
    workflowId: fragment.source.workflowId,
  });
  assert.equal(
    fragment.producerDigests?.[BROWSER_WORKFLOW_PATH],
    workflow.exactHeadWorkflowDigest,
    `${filePath} browser exact-head workflow producer digest`,
  );
  assert.equal(
    fragment.measurements?.workflowProvenanceDigest,
    browserEvidenceDigest(workflow),
    `${filePath} browser workflow provenance digest`,
  );
  return workflow;
}

export function verifySourceRuns({
  plan,
  planPath,
  fragmentsDirectory,
  requireAuthority = true,
}) {
  const resolvedPlan = validateSourceRunPlan(
    plan || readJson(path.resolve(planPath), "source run plan"),
    { requireAuthority },
  );
  const cells = [];
  const requiredCells = new Map();
  const observedArtifacts = new Set();
  for (const run of resolvedPlan.runs) {
    const expected = SOURCE_RUNS[run.label];
    const sourceRoot = path.join(path.resolve(fragmentsDirectory), run.label);
    validateDownloadedArtifactDirectories(sourceRoot, run);
    const artifactsByName = new Map(
      run.artifacts.map((artifact) => [artifact.name, artifact]),
    );
    const fragments = filesRecursively(sourceRoot)
      .map((filePath) => ({
        filePath,
        bytes: fs.readFileSync(filePath),
        value: readJson(filePath, filePath),
      }))
      .filter(({ value }) => value?.schema === FRAGMENT_SCHEMA);
    assert.ok(fragments.length > 0, `${run.label} has no canonical fragments`);
    for (const { filePath, bytes, value } of fragments) {
      if (!expected.commitments.includes(value.commitmentId)) {
        const claimedArtifact = value.source?.artifactName;
        assert.equal(
          run.artifacts.some((artifact) => artifact.name === claimedArtifact),
          false,
          `${run.label} contains unexpected ${value.commitmentId} fragment`,
        );
        continue;
      }
      assert.ok(
        REQUIRED_OPERATING_SYSTEMS.includes(value.os),
        `${filePath} OS`,
      );
      assert.ok(
        ["required", "advisory"].includes(value.disposition),
        `${filePath} disposition`,
      );
      assert.ok(
        ["passed", "failed"].includes(value.outcome),
        `${filePath} outcome`,
      );
      assert.equal(
        value.headSha,
        resolvedPlan.releaseCommit,
        `${filePath} head SHA`,
      );
      assertExactKeys(
        value.source,
        ["artifactName", "jobId", "runId", "workflowId"],
        `${filePath} source`,
      );
      assert.equal(value.source.runId, run.runId, `${filePath} source run`);
      assert.match(
        value.source.workflowId || "",
        workflowRefPattern(resolvedPlan.repository, expected.workflowPath),
        `${filePath} source workflow`,
      );
      const expectedSource = expectedFragmentSource(
        run.label,
        value.commitmentId,
        value.os,
        resolvedPlan.releaseCommit,
        run.runAttempt,
      );
      assert.equal(
        value.source.artifactName,
        expectedSource.artifactName,
        `${filePath} source artifact`,
      );
      assert.equal(
        value.source.jobId,
        expectedSource.jobId,
        `${filePath} source job`,
      );
      const artifactDirectory = sourceArtifactDirectory(sourceRoot, filePath);
      assert.equal(
        artifactDirectory,
        value.source.artifactName,
        `${filePath} is outside its claimed artifact`,
      );
      const artifact = artifactsByName.get(artifactDirectory);
      assert.ok(artifact, `${filePath} is from an unplanned artifact`);
      observedArtifacts.add(`${run.label}/${artifact.name}`);
      const workflowProvenance =
        run.label === "ideExtensions"
          ? browserWorkflowProvenance(filePath, value, resolvedPlan, run)
          : null;
      const cell = {
        commitmentId: value.commitmentId,
        os: value.os,
        disposition: value.disposition,
        outcome: value.outcome,
        fragmentDigest: sha256(bytes),
        workflowId: value.source.workflowId,
        runId: run.runId,
        runAttempt: run.runAttempt,
        jobId: value.source.jobId,
        artifactId: artifact.id,
        artifactName: artifact.name,
        artifactDigest: artifact.digest,
        artifactSizeInBytes: artifact.sizeInBytes,
        workflowProvenance,
      };
      cells.push(cell);
      if (value.disposition === "required") {
        assert.equal(value.outcome, "passed", `${filePath} required outcome`);
        const key = `${value.commitmentId}/${value.os}`;
        assert.equal(
          requiredCells.has(key),
          false,
          `duplicate required source cell ${key}`,
        );
        requiredCells.set(key, cell);
      }
    }
    for (const artifact of run.artifacts) {
      assert.ok(
        observedArtifacts.has(`${run.label}/${artifact.name}`),
        `${run.label} artifact ${artifact.name} contains no canonical fragment`,
      );
    }
  }
  assert.deepEqual(
    [...requiredCells.keys()].sort(),
    expectedRequiredCells().sort(),
    "required source cells must be exactly 12 commitments by three operating systems",
  );
  assert.equal(requiredCells.size, EXPECTED_REQUIRED_CELL_COUNT);
  return {
    schema: SOURCE_RUN_SCHEMA,
    releaseCommit: resolvedPlan.releaseCommit,
    repository: resolvedPlan.repository,
    aggregatorWorkflowDigest: resolvedPlan.aggregatorWorkflowDigest,
    requiredCellCount: requiredCells.size,
    runs: resolvedPlan.runs,
    cells: cells.sort(cellSort),
  };
}

function validateAttestationCell(
  cell,
  attestation,
  runsByLabel,
  seenArtifacts,
) {
  assertExactKeys(
    cell,
    [
      "artifactDigest",
      "artifactId",
      "artifactName",
      "artifactSizeInBytes",
      "commitmentId",
      "disposition",
      "fragmentDigest",
      "jobId",
      "os",
      "outcome",
      "runAttempt",
      "runId",
      "workflowId",
      "workflowProvenance",
    ],
    "source attestation cell",
  );
  assert.ok(REQUIRED_COMMITMENTS.includes(cell.commitmentId));
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(cell.os));
  assert.ok(["required", "advisory"].includes(cell.disposition));
  assert.ok(["passed", "failed"].includes(cell.outcome));
  assert.match(cell.fragmentDigest || "", DIGEST_RE);
  const label = sourceRunLabel(cell.commitmentId);
  const run = runsByLabel.get(label);
  assert.ok(run, `missing run for ${cell.commitmentId}`);
  assert.equal(cell.runId, run.runId);
  assert.equal(cell.runAttempt, run.runAttempt);
  assert.match(
    cell.workflowId || "",
    workflowRefPattern(attestation.repository, run.workflowPath),
  );
  const expectedSource = expectedFragmentSource(
    label,
    cell.commitmentId,
    cell.os,
    attestation.releaseCommit,
    run.runAttempt,
  );
  assert.equal(cell.artifactName, expectedSource.artifactName);
  assert.equal(cell.jobId, expectedSource.jobId);
  const artifact = run.artifacts.find(
    (candidate) => candidate.name === cell.artifactName,
  );
  assert.ok(
    artifact,
    `${cell.commitmentId}/${cell.os} artifact is not in the source plan`,
  );
  assert.equal(cell.artifactId, artifact.id);
  assert.equal(cell.artifactDigest, artifact.digest);
  assert.equal(cell.artifactSizeInBytes, artifact.sizeInBytes);
  if (label === "ideExtensions") {
    validateBrowserWorkflowProvenance(cell.workflowProvenance, {
      repository: attestation.repository,
      releaseCommit: attestation.releaseCommit,
      run,
      workflowId: cell.workflowId,
    });
  } else {
    assert.equal(cell.workflowProvenance, null);
  }
  seenArtifacts.add(`${label}/${artifact.name}`);
}

export function validateSourceRunAttestation(attestation) {
  assertExactKeys(
    attestation,
    [
      "aggregatorWorkflowDigest",
      "cells",
      "releaseCommit",
      "repository",
      "requiredCellCount",
      "runs",
      "schema",
    ],
    "source run attestation",
  );
  assert.equal(attestation.schema, SOURCE_RUN_SCHEMA);
  validateSourceRunPlan(
    {
      schema: SOURCE_RUN_PLAN_SCHEMA,
      releaseCommit: attestation.releaseCommit,
      repository: attestation.repository,
      aggregatorWorkflowDigest: attestation.aggregatorWorkflowDigest,
      runs: attestation.runs,
    },
    { requireAuthority: true },
  );
  assert.equal(attestation.requiredCellCount, EXPECTED_REQUIRED_CELL_COUNT);
  assert.ok(Array.isArray(attestation.cells));
  const runsByLabel = new Map(attestation.runs.map((run) => [run.label, run]));
  const requiredCells = new Set();
  const fragmentDigests = new Set();
  const seenArtifacts = new Set();
  const workflowRefsByRun = new Map();
  const browserWorkflowAuthorities = new Set();
  for (const cell of attestation.cells) {
    validateAttestationCell(cell, attestation, runsByLabel, seenArtifacts);
    if (!workflowRefsByRun.has(cell.runId)) {
      workflowRefsByRun.set(cell.runId, new Set());
    }
    workflowRefsByRun.get(cell.runId).add(cell.workflowId);
    if (cell.commitmentId === "BROWSER-EVIDENCE") {
      browserWorkflowAuthorities.add(
        browserEvidenceDigest(cell.workflowProvenance),
      );
    }
    assert.equal(
      fragmentDigests.has(cell.fragmentDigest),
      false,
      `duplicate attested fragment ${cell.fragmentDigest}`,
    );
    fragmentDigests.add(cell.fragmentDigest);
    if (cell.disposition === "required") {
      assert.equal(cell.outcome, "passed");
      const key = `${cell.commitmentId}/${cell.os}`;
      assert.equal(
        requiredCells.has(key),
        false,
        `duplicate attested required cell ${key}`,
      );
      requiredCells.add(key);
    }
  }
  assert.deepEqual([...requiredCells].sort(), expectedRequiredCells().sort());
  for (const [runId, workflowRefs] of workflowRefsByRun) {
    assert.equal(
      workflowRefs.size,
      1,
      `source run ${runId} has mixed workflow refs`,
    );
  }
  assert.equal(
    browserWorkflowAuthorities.size,
    1,
    "BROWSER-EVIDENCE cells must share one executed workflow authority",
  );
  for (const run of attestation.runs) {
    for (const artifact of run.artifacts) {
      assert.ok(
        seenArtifacts.has(`${run.label}/${artifact.name}`),
        `unreferenced source artifact ${artifact.name}`,
      );
    }
  }
  assert.deepEqual(
    attestation.cells,
    [...attestation.cells].sort(cellSort),
    "source attestation cell order",
  );
  return attestation;
}

export function assertAttestationMatchesFragments(
  attestation,
  fragmentRecords,
) {
  validateSourceRunAttestation(attestation);
  assert.equal(
    attestation.cells.length,
    fragmentRecords.length,
    "source attestation fragment count",
  );
  const unmatched = [...attestation.cells];
  for (const record of fragmentRecords) {
    const fragment = record.value;
    const index = unmatched.findIndex((cell) =>
      attestationCellMatchesFragment(cell, record),
    );
    assert.notEqual(
      index,
      -1,
      `fragment ${fragment.commitmentId}/${fragment.os} is absent from source attestation`,
    );
    if (fragment.commitmentId === "BROWSER-EVIDENCE") {
      const workflow = unmatched[index].workflowProvenance;
      assert.equal(
        fragment.measurements?.workflowProvenanceDigest,
        browserEvidenceDigest(workflow),
        "BROWSER-EVIDENCE workflow provenance digest",
      );
      assert.equal(
        fragment.producerDigests?.[BROWSER_WORKFLOW_PATH],
        workflow.exactHeadWorkflowDigest,
        "BROWSER-EVIDENCE exact-head workflow producer digest",
      );
    }
    unmatched.splice(index, 1);
  }
  assert.deepEqual(
    unmatched,
    [],
    "source attestation contains unmatched fragments",
  );
  return attestation;
}

function attestationCellMatchesFragment(cell, record) {
  const fragment = record.value;
  return (
    cell.fragmentDigest === record.digest &&
    cell.commitmentId === fragment.commitmentId &&
    cell.os === fragment.os &&
    cell.disposition === fragment.disposition &&
    cell.outcome === fragment.outcome &&
    cell.workflowId === fragment.source.workflowId &&
    cell.runId === fragment.source.runId &&
    cell.jobId === fragment.source.jobId &&
    cell.artifactName === fragment.source.artifactName
  );
}

export function selectAttestedFragments(attestation, fragmentRecords) {
  validateSourceRunAttestation(attestation);
  const selected = [];
  for (const cell of attestation.cells) {
    const matches = fragmentRecords.filter((record) =>
      attestationCellMatchesFragment(cell, record),
    );
    assert.equal(
      matches.length,
      1,
      `attested fragment ${cell.commitmentId}/${cell.os} multiplicity`,
    );
    selected.push(matches[0]);
  }
  const selectedRecords = new Set(selected);
  const plannedArtifactNames = new Set(
    attestation.runs.flatMap((run) =>
      run.artifacts.map((artifact) => artifact.name),
    ),
  );
  for (const record of fragmentRecords) {
    if (selectedRecords.has(record)) continue;
    assert.equal(
      plannedArtifactNames.has(record.value.source.artifactName),
      false,
      `unattested fragment ${record.value.commitmentId}/${record.value.os} claims an authoritative artifact`,
    );
  }
  return selected;
}

function writeGitHubOutputs(filePath, plan) {
  const lines = plan.runs.flatMap((run) => {
    const key = SOURCE_RUNS[run.label].outputKey;
    const value = run.artifacts.map((artifact) => artifact.id).join(",");
    const outputs = [`${key}=${value}`];
    if (run.artifacts.length === 1) {
      outputs.push(
        `${key.replace(/_ids$/u, "_name")}=${run.artifacts[0].name}`,
      );
    }
    return outputs;
  });
  fs.appendFileSync(path.resolve(filePath), `${lines.join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  assert.ok(
    ["plan", "verify"].includes(command),
    "usage: plan|verify [options]",
  );
  const options = { required: false };
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--required") {
      options.required = true;
      continue;
    }
    assert.ok(tokens[index]?.startsWith("--") && tokens[index + 1]);
    options[
      tokens[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = tokens[++index];
  }
  return { command, options };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  assert.ok(options.output, "--output is required");
  if (command === "plan") {
    assert.ok(options.metadataDir, "--metadata-dir is required");
    assert.ok(
      options.artifactsMetadataDir,
      "--artifacts-metadata-dir is required",
    );
    assert.ok(options.releaseCommit, "--release-commit is required");
    assert.ok(options.repository, "--repository is required");
    assert.ok(options.githubOutput, "--github-output is required");
    const plan = createSourceRunPlan({
      metadataDirectory: options.metadataDir,
      artifactsMetadataDirectory: options.artifactsMetadataDir,
      releaseCommit: options.releaseCommit,
      repository: options.repository,
      required: options.required,
    });
    validateSourceRunPlan(plan, { requireAuthority: options.required });
    writeJson(options.output, plan);
    writeGitHubOutputs(options.githubOutput, plan);
    return;
  }
  assert.ok(options.plan, "--plan is required");
  assert.ok(options.fragmentsDir, "--fragments-dir is required");
  const attestation = verifySourceRuns({
    planPath: options.plan,
    fragmentsDirectory: options.fragmentsDir,
    requireAuthority: true,
  });
  validateSourceRunAttestation(attestation);
  writeJson(options.output, attestation);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(SCRIPT_PATH).href
) {
  main();
}

export {
  EXPECTED_REQUIRED_CELL_COUNT,
  META_WORKFLOW_PATH,
  REQUIRED_COMMITMENTS,
  REQUIRED_OPERATING_SYSTEMS,
  SOURCE_RUN_PLAN_SCHEMA,
  SOURCE_RUN_SCHEMA,
  expectedFragmentSource,
  sourceRunLabel,
  verifyMetaWorkflowAuthority,
  writeGitHubOutputs,
};
