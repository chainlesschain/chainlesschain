#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMAL_SCHEDULER_SOAK_LEASE_FLOOR_MS } from "./scheduler-kernel-soak.mjs";

const AGGREGATE_SCHEMA = "chainlesschain.scheduler-kernel-soak-aggregate.v1";
const EXPECTED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CAMPAIGN_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/u;
const GITHUB_RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const SOURCE_WORKFLOW_PATH = ".github/workflows/cli-scheduler-soak.yml";
const SOURCE_WORKFLOW_NAME = "CLI Scheduler Kernel Soak";
const CAMPAIGN_WORKFLOW_PATH =
  ".github/workflows/cli-scheduler-soak-campaign.yml";
const CAMPAIGN_WORKFLOW_NAME = "CLI Scheduler Kernel Soak Campaign";
const MINIMUM_OBSERVATION_HOURS_FLOOR = 72;
const MINIMUM_SEGMENTS_FLOOR = 4;
const MAXIMUM_GAP_HOURS_CEILING = 30;
const MAXIMUM_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const CAMPAIGN_SCHEMA =
  "chainlesschain.scheduler-kernel-soak-campaign.v1";

function normalizeFullSha(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a full 40-character SHA`);
  }
  return normalized;
}

function normalizeSeed(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new TypeError("campaign seed must be an unsigned 32-bit integer");
  }
  return parsed;
}

function normalizeCampaign(value) {
  const normalized = String(value || "").trim();
  if (!CAMPAIGN_PATTERN.test(normalized)) {
    throw new TypeError(
      "campaign must use 1-128 letters, digits, '.', '_', ':', or '-'",
    );
  }
  return normalized;
}

function normalizePolicy(options) {
  const minimumObservationHours = Number(
    options.minimumObservationHours ?? MINIMUM_OBSERVATION_HOURS_FLOOR,
  );
  const minimumSegments = Number(
    options.minimumSegments ?? MINIMUM_SEGMENTS_FLOOR,
  );
  const maximumGapHours = Number(
    options.maximumGapHours ?? MAXIMUM_GAP_HOURS_CEILING,
  );
  if (
    !Number.isFinite(minimumObservationHours) ||
    minimumObservationHours < MINIMUM_OBSERVATION_HOURS_FLOOR
  ) {
    throw new TypeError(
      `minimum observation hours must be at least ${MINIMUM_OBSERVATION_HOURS_FLOOR}`,
    );
  }
  if (
    !Number.isSafeInteger(minimumSegments) ||
    minimumSegments < MINIMUM_SEGMENTS_FLOOR
  ) {
    throw new TypeError(
      `minimum segments must be an integer of at least ${MINIMUM_SEGMENTS_FLOOR}`,
    );
  }
  if (
    !Number.isFinite(maximumGapHours) ||
    maximumGapHours <= 0 ||
    maximumGapHours > MAXIMUM_GAP_HOURS_CEILING
  ) {
    throw new TypeError(
      `maximum gap hours must be greater than zero and at most ${MAXIMUM_GAP_HOURS_CEILING}`,
    );
  }
  return Object.freeze({
    minimumObservationHours,
    minimumSegments,
    maximumGapHours,
  });
}

function normalizeVerifierIdentity(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("campaign verifier execution identity is required");
  }
  if (
    value.provider !== "github-actions" ||
    value.eventName !== "workflow_dispatch"
  ) {
    throw new Error(
      "campaign verifier must be a workflow_dispatch GitHub Actions run",
    );
  }
  const repository = requireNonEmptyString(
    value.repository,
    "campaign verifier repository",
  );
  const workflow = requireNonEmptyString(
    value.workflow,
    "campaign verifier workflow",
  );
  if (workflow !== CAMPAIGN_WORKFLOW_NAME) {
    throw new Error("campaign verifier workflow identity is invalid");
  }
  const workflowRef = requireNonEmptyString(
    value.workflowRef,
    "campaign verifier workflow ref",
    2_048,
  );
  const ref = requireNonEmptyString(value.ref, "campaign verifier ref", 2_048);
  const runId = requireNonEmptyString(
    value.runId,
    "campaign verifier run ID",
    256,
  );
  if (!GITHUB_RUN_ID_PATTERN.test(runId)) {
    throw new TypeError(
      "campaign verifier run ID must be a positive GitHub Actions run ID",
    );
  }
  const runAttempt = Number(value.runAttempt);
  if (!Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
    throw new TypeError("campaign verifier run attempt must be positive");
  }
  const controlPlaneSha = normalizeFullSha(
    value.controlPlaneSha,
    "campaign verifier control-plane SHA",
  );
  const sourceCommit = normalizeFullSha(
    value.sourceCommit,
    "campaign verifier source commit",
  );
  if (sourceCommit !== controlPlaneSha) {
    throw new Error(
      "campaign verifier source commit must equal its control-plane SHA",
    );
  }
  const runUrl = requireNonEmptyString(
    value.runUrl,
    "campaign verifier run URL",
    2_048,
  );
  let parsedRunUrl;
  try {
    parsedRunUrl = new URL(runUrl);
  } catch (error) {
    throw new TypeError("campaign verifier run URL must be absolute", {
      cause: error,
    });
  }
  if (
    parsedRunUrl.protocol !== "https:" ||
    parsedRunUrl.pathname.replace(/\/$/u, "") !==
      `/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
  ) {
    throw new Error(
      "campaign verifier run URL does not match its repository, run ID, and attempt",
    );
  }
  if (
    !ref.startsWith("refs/heads/") ||
    workflowRef !== `${repository}/${CAMPAIGN_WORKFLOW_PATH}@${ref}`
  ) {
    throw new Error(
      "campaign verifier must record one branch-bound workflow ref",
    );
  }
  return Object.freeze({
    provider: value.provider,
    repository,
    workflow,
    workflowRef,
    ref,
    eventName: value.eventName,
    runId,
    runAttempt,
    controlPlaneSha,
    sourceCommit,
    runUrl,
  });
}

function parseIsoTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return milliseconds;
}

function requireNonEmptyString(value, label, maximumLength = 512) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateFormalProfile(profile) {
  if (
    !profile ||
    profile.mode !== "formal" ||
    !Number.isFinite(profile.durationSeconds) ||
    profile.durationSeconds < 7_200 ||
    !Number.isSafeInteger(profile.rounds) ||
    profile.rounds < 100 ||
    !Number.isSafeInteger(profile.steadyOccurrencesPerRound) ||
    profile.steadyOccurrencesPerRound < 10 ||
    profile.steadyStateOccurrences !==
      profile.rounds * profile.steadyOccurrencesPerRound ||
    profile.steadyStateOccurrences < 1_000 ||
    !Number.isSafeInteger(profile.leaseMs) ||
    profile.leaseMs < FORMAL_SCHEDULER_SOAK_LEASE_FLOOR_MS ||
    profile.leaseMs > 60_000 ||
    !Number.isSafeInteger(profile.pollMs) ||
    profile.pollMs <= 0 ||
    profile.pollMs > 10_000 ||
    !Number.isSafeInteger(profile.checkpointIntervalSeconds) ||
    profile.checkpointIntervalSeconds <= 0 ||
    !Number.isSafeInteger(profile.cleanupDeadlineMs) ||
    profile.cleanupDeadlineMs <= 0 ||
    profile.cleanupDeadlineMs > 60_000 ||
    !Number.isFinite(profile.maxRssGrowthMb) ||
    profile.maxRssGrowthMb <= 0 ||
    !Number.isSafeInteger(profile.maxResourceGrowth) ||
    profile.maxResourceGrowth <= 0 ||
    !Number.isSafeInteger(profile.executionDelayMs) ||
    profile.executionDelayMs <= 0 ||
    profile.executionDelayMs > 5_000 ||
    !Number.isSafeInteger(profile.heartbeatDelayMs) ||
    profile.heartbeatDelayMs <= profile.leaseMs ||
    profile.heartbeatDelayMs > 300_000
  ) {
    throw new Error(
      "scheduler soak campaign segments must use a formal profile",
    );
  }
}

function validateOperatingSystemMatrix(aggregate, label) {
  if (
    !Array.isArray(aggregate.operatingSystems) ||
    aggregate.operatingSystems.length !== EXPECTED_OPERATING_SYSTEMS.length ||
    stableJson([...aggregate.operatingSystems].sort()) !==
      stableJson(EXPECTED_OPERATING_SYSTEMS)
  ) {
    throw new Error(`${label} must contain exactly linux, macos, and windows`);
  }
  if (
    !Array.isArray(aggregate.evidence) ||
    aggregate.evidence.length !== EXPECTED_OPERATING_SYSTEMS.length
  ) {
    throw new Error(
      `${label} must contain three operating-system evidence files`,
    );
  }
  const evidenceOperatingSystems = aggregate.evidence
    .map((entry) => entry?.operatingSystem)
    .sort();
  if (
    stableJson(evidenceOperatingSystems) !==
    stableJson(EXPECTED_OPERATING_SYSTEMS)
  ) {
    throw new Error(
      `${label} evidence must contain exactly linux, macos, and windows`,
    );
  }
}

function validateAggregateTotals(aggregate, label) {
  const profile = aggregate.profile;
  const platformCount = EXPECTED_OPERATING_SYSTEMS.length;
  const expected = {
    rounds: profile.rounds * platformCount,
    steadyOccurrences: profile.steadyStateOccurrences * platformCount,
    hardKills: profile.rounds * 2 * platformCount,
    effects:
      (profile.steadyStateOccurrences + profile.rounds * 2 + 1) * platformCount,
  };
  if (
    !aggregate.totals ||
    Object.entries(expected).some(
      ([field, value]) => aggregate.totals[field] !== value,
    )
  ) {
    throw new Error(`${label} workload totals are invalid`);
  }
}

function validateSourceArtifacts(aggregate, expected, label, sourceBounds) {
  const artifacts = aggregate.sourceArtifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== 3) {
    throw new Error(`${label} must bind exactly three source artifacts`);
  }
  const expectedNames = ["Linux", "Windows", "macOS"]
    .map(
      (operatingSystem) =>
        `cli-scheduler-soak-${operatingSystem}-${expected.releaseCommit}-${aggregate.execution.runAttempt}`,
    )
    .sort();
  if (
    stableJson(artifacts.map((artifact) => artifact?.name).sort()) !==
    stableJson(expectedNames)
  ) {
    throw new Error(`${label} source artifact names do not match its matrix`);
  }
  const artifactIds = new Set();
  for (const artifact of artifacts) {
    if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0) {
      throw new TypeError(`${label} source artifact ID must be positive`);
    }
    if (artifactIds.has(artifact.id)) {
      throw new Error(`${label} source artifact IDs must be unique`);
    }
    artifactIds.add(artifact.id);
    if (
      !Number.isSafeInteger(artifact.sizeInBytes) ||
      artifact.sizeInBytes <= 0
    ) {
      throw new TypeError(`${label} source artifact size must be positive`);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(String(artifact.digest || ""))) {
      throw new TypeError(`${label} source artifact digest must be SHA-256`);
    }
    if (artifact.expired !== false) {
      throw new Error(`${label} source artifact is expired`);
    }
    const createdMs = parseIsoTimestamp(
      artifact.createdAt,
      `${label} source artifact createdAt`,
    );
    const expiresMs = parseIsoTimestamp(
      artifact.expiresAt,
      `${label} source artifact expiresAt`,
    );
    if (
      expiresMs <= createdMs ||
      createdMs < sourceBounds.createdMs ||
      createdMs > sourceBounds.updatedMs
    ) {
      throw new Error(`${label} source artifact expiry is invalid`);
    }
    let downloadUrl;
    try {
      downloadUrl = new URL(
        requireNonEmptyString(
          artifact.archiveDownloadUrl,
          `${label} source artifact archiveDownloadUrl`,
          2_048,
        ),
      );
    } catch (error) {
      throw new TypeError(
        `${label} source artifact archiveDownloadUrl must be absolute`,
        { cause: error },
      );
    }
    if (
      downloadUrl.protocol !== "https:" ||
      downloadUrl.search ||
      downloadUrl.hash ||
      downloadUrl.pathname !==
        `/repos/${aggregate.execution.repository}/actions/artifacts/${artifact.id}/zip`
    ) {
      throw new Error(
        `${label} source artifact URL does not match its repository and artifact ID`,
      );
    }
  }
  return artifacts;
}

function validateSourceRun(aggregate, expected, label) {
  const sourceRun = aggregate.sourceRun;
  const execution = aggregate.execution;
  if (!sourceRun || typeof sourceRun !== "object") {
    throw new Error(`${label} is missing GitHub source-run metadata`);
  }
  if (
    sourceRun.id !== execution.runId ||
    sourceRun.attempt !== execution.runAttempt ||
    sourceRun.eventName !== execution.eventName ||
    sourceRun.headSha !== execution.controlPlaneSha ||
    sourceRun.workflowPath !== SOURCE_WORKFLOW_PATH
  ) {
    throw new Error(
      `${label} source run does not match its execution identity`,
    );
  }
  const expectedSourceUrl = execution.runUrl.replace(
    new RegExp(`/attempts/${execution.runAttempt}/?$`, "u"),
    "",
  );
  if (sourceRun.url !== expectedSourceUrl) {
    throw new Error(`${label} source run URL does not match its execution URL`);
  }
  const createdMs = parseIsoTimestamp(
    sourceRun.createdAt,
    `${label} sourceRun.createdAt`,
  );
  const runStartedMs = parseIsoTimestamp(
    sourceRun.runStartedAt,
    `${label} sourceRun.runStartedAt`,
  );
  const updatedMs = parseIsoTimestamp(
    sourceRun.updatedAt,
    `${label} sourceRun.updatedAt`,
  );
  const aggregateStartedMs = parseIsoTimestamp(
    aggregate.startedAt,
    `${label} startedAt`,
  );
  const aggregateCompletedMs = parseIsoTimestamp(
    aggregate.completedAt,
    `${label} completedAt`,
  );
  if (
    createdMs > runStartedMs ||
    runStartedMs > aggregateStartedMs ||
    aggregateCompletedMs > updatedMs ||
    updatedMs > expected.maximumTimestampMs
  ) {
    throw new Error(
      `${label} workload timestamps fall outside the authoritative source run`,
    );
  }
  validateSourceArtifacts(aggregate, expected, label, {
    createdMs,
    updatedMs,
  });
  return { createdMs, runStartedMs, updatedMs };
}

function validateAggregate(aggregate, expected, sourceFile, aggregateFilePath) {
  const label = `aggregate ${sourceFile}`;
  if (
    aggregate?.schema !== AGGREGATE_SCHEMA ||
    aggregate?.result !== "passed"
  ) {
    throw new Error(`${label} is not passed ${AGGREGATE_SCHEMA} evidence`);
  }
  if (
    normalizeFullSha(aggregate.releaseCommit, `${label} release commit`) !==
    expected.releaseCommit
  ) {
    throw new Error(
      `${label} release commit does not match the requested exact SHA`,
    );
  }
  if (normalizeSeed(aggregate.seed) !== expected.seed) {
    throw new Error(`${label} seed does not match the requested seed`);
  }
  if (normalizeCampaign(aggregate.campaign) !== expected.campaign) {
    throw new Error(`${label} campaign does not match the requested campaign`);
  }
  validateFormalProfile(aggregate.profile);
  validateOperatingSystemMatrix(aggregate, label);
  validateAggregateTotals(aggregate, label);

  const execution = aggregate.execution;
  if (!execution || typeof execution !== "object") {
    throw new Error(`${label} is missing execution identity`);
  }
  const runId = requireNonEmptyString(
    execution.runId,
    `${label} execution.runId`,
    256,
  );
  if (!GITHUB_RUN_ID_PATTERN.test(runId)) {
    throw new TypeError(
      `${label} execution.runId must be a positive GitHub Actions run ID`,
    );
  }
  if (
    !Number.isSafeInteger(execution.runAttempt) ||
    execution.runAttempt <= 0
  ) {
    throw new TypeError(
      `${label} execution.runAttempt must be a positive integer`,
    );
  }
  for (const field of ["repository", "workflow", "eventName", "runUrl"]) {
    requireNonEmptyString(
      execution[field],
      `${label} execution.${field}`,
      2_048,
    );
  }
  if (execution.provider !== "github-actions") {
    throw new Error(`${label} must come from GitHub Actions`);
  }
  if (
    execution.workflow !== SOURCE_WORKFLOW_NAME ||
    !["schedule", "workflow_dispatch"].includes(execution.eventName) ||
    !/^[^/\s]+\/[^/\s]+$/u.test(execution.repository)
  ) {
    throw new Error(`${label} source workflow identity is invalid`);
  }
  let runUrl;
  try {
    runUrl = new URL(execution.runUrl);
  } catch (error) {
    throw new TypeError(`${label} execution.runUrl must be an absolute URL`, {
      cause: error,
    });
  }
  const expectedRunPath = `/${execution.repository}/actions/runs/${runId}/attempts/${execution.runAttempt}`;
  if (
    runUrl.protocol !== "https:" ||
    runUrl.search ||
    runUrl.hash ||
    runUrl.pathname.replace(/\/$/u, "") !== expectedRunPath
  ) {
    throw new Error(
      `${label} execution.runUrl does not match its repository, run ID, and attempt`,
    );
  }
  const controlPlaneSha = normalizeFullSha(
    execution.controlPlaneSha,
    `${label} execution.controlPlaneSha`,
  );
  const startedMs = parseIsoTimestamp(
    aggregate.startedAt,
    `${label} startedAt`,
  );
  const completedMs = parseIsoTimestamp(
    aggregate.completedAt,
    `${label} completedAt`,
  );
  const verifiedMs = parseIsoTimestamp(
    aggregate.verifiedAt,
    `${label} verifiedAt`,
  );
  const wallDurationSeconds = (completedMs - startedMs) / 1_000;
  if (
    completedMs <= startedMs ||
    wallDurationSeconds < aggregate.profile.durationSeconds
  ) {
    throw new Error(
      `${label} wall-clock duration does not satisfy its formal profile`,
    );
  }
  if (verifiedMs < completedMs) {
    throw new Error(`${label} verifiedAt must not precede completedAt`);
  }
  if (
    completedMs > expected.maximumTimestampMs ||
    verifiedMs > expected.maximumTimestampMs
  ) {
    throw new Error(`${label} contains a future completion timestamp`);
  }
  if (
    !Number.isFinite(aggregate.continuousDurationSeconds) ||
    aggregate.continuousDurationSeconds < aggregate.profile.durationSeconds ||
    Math.abs(aggregate.continuousDurationSeconds - wallDurationSeconds) > 0.001
  ) {
    throw new Error(`${label} does not satisfy its formal continuous duration`);
  }

  const evidenceFiles = new Set();
  const evidenceStartedValues = [];
  const evidenceCompletedValues = [];
  for (const evidence of aggregate.evidence) {
    const evidenceFile = requireNonEmptyString(
      evidence.file,
      `${label} evidence file`,
      2_048,
    );
    if (
      path.posix.basename(evidenceFile) !== evidenceFile ||
      path.win32.basename(evidenceFile) !== evidenceFile ||
      evidenceFile === "." ||
      evidenceFile === ".."
    ) {
      throw new Error(`${label} evidence file must be a basename`);
    }
    if (evidenceFiles.has(evidenceFile)) {
      throw new Error(`${label} evidence file names must be unique`);
    }
    evidenceFiles.add(evidenceFile);
    if (!SHA256_PATTERN.test(String(evidence.sha256 || ""))) {
      throw new TypeError(
        `${label} evidence sha256 must be 64 lowercase hex characters`,
      );
    }
    const evidenceStartedMs = parseIsoTimestamp(
      evidence.startedAt,
      `${label} ${evidence.operatingSystem} evidence startedAt`,
    );
    const evidenceCompletedMs = parseIsoTimestamp(
      evidence.completedAt,
      `${label} ${evidence.operatingSystem} evidence completedAt`,
    );
    if (
      evidenceCompletedMs <= evidenceStartedMs ||
      evidenceCompletedMs - evidenceStartedMs <
        aggregate.profile.durationSeconds * 1_000
    ) {
      throw new Error(
        `${label} platform evidence does not satisfy the formal wall-clock duration`,
      );
    }
    if (evidenceStartedMs < startedMs || evidenceCompletedMs > completedMs) {
      throw new Error(
        `${label} timestamps do not envelope its platform evidence`,
      );
    }
    evidenceStartedValues.push(evidenceStartedMs);
    evidenceCompletedValues.push(evidenceCompletedMs);
  }
  if (
    startedMs !== Math.min(...evidenceStartedValues) ||
    completedMs !== Math.max(...evidenceCompletedValues)
  ) {
    throw new Error(
      `${label} timestamps must exactly envelope its platform evidence`,
    );
  }
  const rawEvidenceDirectory = path.join(
    path.dirname(aggregateFilePath),
    "raw",
  );
  for (const evidence of aggregate.evidence) {
    const rawEvidenceFile = path.join(rawEvidenceDirectory, evidence.file);
    let stats;
    try {
      stats = fs.statSync(rawEvidenceFile);
    } catch (error) {
      throw new Error(`${label} is missing bundled raw evidence`, {
        cause: error,
      });
    }
    if (!stats.isFile() || sha256File(rawEvidenceFile) !== evidence.sha256) {
      throw new Error(`${label} bundled raw evidence hash does not match`);
    }
  }
  const sourceRun = validateSourceRun(aggregate, expected, label);

  return {
    runId,
    controlPlaneSha,
    executionIdentity: Object.freeze({
      provider: execution.provider,
      repository: execution.repository,
      workflow: execution.workflow,
      eventName: execution.eventName,
    }),
    sourceRun,
    startedMs,
    completedMs,
  };
}

function listJsonFilesRecursively(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((first, second) => first.name.localeCompare(second.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json"))
        result.push(entryPath);
    }
  };
  visit(root);
  return result;
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeAll(descriptor, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      null,
    );
    if (!Number.isSafeInteger(written) || written <= 0) {
      throw new Error("campaign evidence write made no progress");
    }
    offset += written;
  }
}

function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    writeAll(
      descriptor,
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    if (process.platform !== "win32") {
      let directoryDescriptor;
      try {
        directoryDescriptor = fs.openSync(directory, "r");
        fs.fsyncSync(directoryDescriptor);
      } finally {
        if (directoryDescriptor !== undefined)
          fs.closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export function verifySchedulerSoakCampaignEvidenceSet(options = {}) {
  if (
    typeof options.evidenceDir !== "string" ||
    options.evidenceDir.trim().length === 0
  ) {
    throw new TypeError("campaign evidence directory is required");
  }
  const evidenceDir = path.resolve(options.evidenceDir);
  let evidenceDirectoryStats;
  try {
    evidenceDirectoryStats = fs.statSync(evidenceDir);
  } catch (error) {
    throw new TypeError(
      `campaign evidence directory is not readable: ${evidenceDir}`,
      {
        cause: error,
      },
    );
  }
  if (!evidenceDirectoryStats.isDirectory()) {
    throw new TypeError("campaign evidence directory must be a directory");
  }
  const expected = {
    releaseCommit: normalizeFullSha(options.releaseCommit, "release commit"),
    seed: normalizeSeed(options.seed),
    campaign: normalizeCampaign(options.campaign),
    maximumTimestampMs: Date.now() + MAXIMUM_CLOCK_SKEW_MS,
  };
  const policy = normalizePolicy(options);
  const verifier = normalizeVerifierIdentity(options.verifier);
  const candidates = [];
  for (const filePath of listJsonFilesRecursively(evidenceDir)) {
    let value;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`invalid JSON evidence ${filePath}: ${error.message}`, {
        cause: error,
      });
    }
    if (value?.schema !== AGGREGATE_SCHEMA) continue;
    const relativeFile = path
      .relative(evidenceDir, filePath)
      .split(path.sep)
      .join("/");
    const identity = validateAggregate(value, expected, relativeFile, filePath);
    candidates.push({
      filePath,
      relativeFile,
      value,
      identity,
      sha256: sha256File(filePath),
      semanticJson: stableJson(value),
    });
  }

  const byRunId = new Map();
  for (const candidate of candidates) {
    const previous = byRunId.get(candidate.identity.runId);
    if (previous && previous.semanticJson !== candidate.semanticJson) {
      throw new Error(
        `conflicting scheduler soak aggregates share execution.runId ${candidate.identity.runId}`,
      );
    }
    if (!previous) byRunId.set(candidate.identity.runId, candidate);
  }
  const segments = [...byRunId.values()].sort(
    (first, second) =>
      first.identity.sourceRun.runStartedMs -
        second.identity.sourceRun.runStartedMs ||
      first.identity.runId.localeCompare(second.identity.runId),
  );
  if (segments.length < policy.minimumSegments) {
    throw new Error(
      `scheduler soak campaign requires at least ${policy.minimumSegments} unique segments; found ${segments.length}`,
    );
  }

  const profileJson = stableJson(segments[0].value.profile);
  const controlPlaneSha = segments[0].identity.controlPlaneSha;
  const executionIdentity = segments[0].identity.executionIdentity;
  const executionIdentityJson = stableJson(executionIdentity);
  for (const segment of segments) {
    if (stableJson(segment.value.profile) !== profileJson) {
      throw new Error(
        "scheduler soak campaign profiles differ across segments",
      );
    }
    if (segment.identity.controlPlaneSha !== controlPlaneSha) {
      throw new Error(
        "scheduler soak campaign control-plane SHAs differ across segments",
      );
    }
    if (
      stableJson(segment.identity.executionIdentity) !== executionIdentityJson
    ) {
      throw new Error(
        "scheduler soak campaign execution provenance differs across segments",
      );
    }
  }

  const firstStartedMs = segments[0].identity.sourceRun.runStartedMs;
  const lastStartedMs = segments.at(-1).identity.sourceRun.runStartedMs;
  const lastCompletedMs = Math.max(
    ...segments.map((segment) => segment.identity.sourceRun.updatedMs),
  );
  const observationHours = (lastStartedMs - firstStartedMs) / 3_600_000;
  const endToEndHours = (lastCompletedMs - firstStartedMs) / 3_600_000;
  if (observationHours < policy.minimumObservationHours) {
    throw new Error(
      `scheduler soak campaign observation is ${observationHours.toFixed(3)}h; requires ${policy.minimumObservationHours}h`,
    );
  }
  const gaps = [];
  for (let index = 1; index < segments.length; index += 1) {
    const gapHours =
      (segments[index].identity.sourceRun.runStartedMs -
        segments[index - 1].identity.sourceRun.runStartedMs) /
      3_600_000;
    if (gapHours > policy.maximumGapHours) {
      throw new Error(
        `scheduler soak campaign start gap is ${gapHours.toFixed(3)}h between run ${segments[index - 1].identity.runId} and ${segments[index].identity.runId}; maximum is ${policy.maximumGapHours}h`,
      );
    }
    gaps.push({
      fromRunId: segments[index - 1].identity.runId,
      toRunId: segments[index].identity.runId,
      hours: gapHours,
    });
  }

  const campaignEvidence = {
    schema: CAMPAIGN_SCHEMA,
    result: "passed",
    releaseCommit: expected.releaseCommit,
    controlPlaneSha,
    seed: expected.seed,
    campaign: expected.campaign,
    verifiedAt: new Date().toISOString(),
    evidenceBase: ".",
    verifier,
    execution: executionIdentity,
    profile: segments[0].value.profile,
    policy,
    observation: {
      firstStartedAt: new Date(firstStartedMs).toISOString(),
      lastStartedAt: new Date(lastStartedMs).toISOString(),
      lastCompletedAt: new Date(lastCompletedMs).toISOString(),
      hours: observationHours,
      endToEndHours,
      maximumObservedStartGapHours:
        gaps.length > 0 ? Math.max(...gaps.map((gap) => gap.hours)) : 0,
      gaps,
    },
    totals: {
      discoveredAggregates: candidates.length,
      uniqueSegments: segments.length,
      deduplicatedAggregates: candidates.length - segments.length,
      operatingSystemExecutions:
        segments.length * EXPECTED_OPERATING_SYSTEMS.length,
    },
    sourceAggregates: candidates.map((candidate) => ({
      runId: candidate.identity.runId,
      file: candidate.relativeFile,
      sha256: candidate.sha256,
      selected:
        byRunId.get(candidate.identity.runId)?.filePath === candidate.filePath,
    })),
    segments: segments.map((segment) => ({
      runId: segment.identity.runId,
      runAttempt: segment.value.execution.runAttempt,
      startedAt: segment.value.startedAt,
      completedAt: segment.value.completedAt,
      continuousDurationSeconds: segment.value.continuousDurationSeconds,
      sourceRun: { ...segment.value.sourceRun },
      sourceArtifacts: segment.value.sourceArtifacts.map((artifact) => ({
        ...artifact,
      })),
      aggregate: {
        file: segment.relativeFile,
        sha256: segment.sha256,
      },
      evidence: segment.value.evidence.map((entry) => ({
        ...entry,
        sourceFile: entry.file,
        file: path.posix.join(
          path.posix.dirname(segment.relativeFile),
          "raw",
          entry.file,
        ),
      })),
    })),
  };
  if (options.output) atomicWriteJson(options.output, campaignEvidence);
  return campaignEvidence;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length)
        throw new TypeError(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--evidence-dir") options.evidenceDir = next();
    else if (argument === "--release-commit") options.releaseCommit = next();
    else if (argument === "--seed") options.seed = next();
    else if (argument === "--campaign") options.campaign = next();
    else if (argument === "--minimum-observation-hours") {
      options.minimumObservationHours = next();
    } else if (argument === "--minimum-segments")
      options.minimumSegments = next();
    else if (argument === "--maximum-gap-hours")
      options.maximumGapHours = next();
    else if (argument === "--output") options.output = next();
    else if (argument === "--verifier-repository") {
      options.verifier = { ...options.verifier, repository: next() };
    } else if (argument === "--verifier-workflow") {
      options.verifier = { ...options.verifier, workflow: next() };
    } else if (argument === "--verifier-workflow-ref") {
      options.verifier = { ...options.verifier, workflowRef: next() };
    } else if (argument === "--verifier-ref") {
      options.verifier = { ...options.verifier, ref: next() };
    } else if (argument === "--verifier-event-name") {
      options.verifier = { ...options.verifier, eventName: next() };
    } else if (argument === "--verifier-run-id") {
      options.verifier = { ...options.verifier, runId: next() };
    } else if (argument === "--verifier-run-attempt") {
      options.verifier = { ...options.verifier, runAttempt: next() };
    } else if (argument === "--verifier-control-plane-sha") {
      options.verifier = { ...options.verifier, controlPlaneSha: next() };
    } else if (argument === "--verifier-source-commit") {
      options.verifier = { ...options.verifier, sourceCommit: next() };
    } else if (argument === "--verifier-run-url") {
      options.verifier = { ...options.verifier, runUrl: next() };
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else
      throw new TypeError(
        `unknown scheduler soak campaign option: ${argument}`,
      );
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node packages/cli/scripts/scheduler-kernel-soak-campaign.mjs --evidence-dir DIR --release-commit SHA --seed N --campaign ID --minimum-observation-hours 72 --minimum-segments 4 --maximum-gap-hours 30 --output FILE --verifier-repository OWNER/REPO --verifier-workflow NAME --verifier-workflow-ref REF --verifier-ref GIT_REF --verifier-event-name workflow_dispatch --verifier-run-id ID --verifier-run-attempt N --verifier-control-plane-sha SHA --verifier-source-commit SHA --verifier-run-url URL",
  ].join("\n");
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    for (const required of [
      "evidenceDir",
      "releaseCommit",
      "seed",
      "campaign",
      "output",
    ]) {
      if (options[required] === undefined) {
        throw new TypeError(
          `--${required.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`,
        );
      }
    }
    options.verifier = {
      provider: "github-actions",
      ...options.verifier,
    };
    const result = verifySchedulerSoakCampaignEvidenceSet(options);
    process.stdout.write(
      `${JSON.stringify({ result: result.result, segments: result.totals.uniqueSegments, output: path.resolve(options.output) })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
