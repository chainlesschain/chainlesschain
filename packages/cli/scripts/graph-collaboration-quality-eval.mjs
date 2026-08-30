#!/usr/bin/env node

import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BUILTIN_TASKS } from "../src/lib/eval/tasks.js";
import { evaluateGraphProjection } from "../src/lib/graph-kernel/eval.js";
import { redactSecrets } from "../src/lib/secret-scan.js";

export const PLATFORM_SCHEMA =
  "chainlesschain.graph-collaboration-quality-eval/v1";
export const MATRIX_SCHEMA =
  "chainlesschain.graph-collaboration-quality-eval-matrix/v1";
export const REQUIRED_PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
export const FORMAL_PROFILE = Object.freeze({
  name: "formal",
  minimumDurationSeconds: 1800,
  minimumRounds: 3,
  taskIds: Object.freeze([
    "add-function",
    "fix-failing-test",
    "fix-syntax-error",
    "refactor-rename",
    "secure-path",
    "write-test",
  ]),
});
export const FROZEN_THRESHOLDS = Object.freeze({
  controlPassRate: Object.freeze({ min: 0.8 }),
  candidatePassRate: Object.freeze({ min: 0.8 }),
  candidateVsControlPassRateDelta: Object.freeze({ min: -0.1 }),
  behaviorEquivalenceRate: Object.freeze({ min: 0.9 }),
  candidateUnrelatedChangeRate: Object.freeze({ max: 0 }),
  candidateDeadlockRate: Object.freeze({ max: 0 }),
  candidateReconciliationRate: Object.freeze({ max: 0 }),
  candidateMessageVisibilityRate: Object.freeze({ min: 1 }),
  candidateHandoffCompletionRate: Object.freeze({ min: 1 }),
  candidateTokenRatio: Object.freeze({ max: 2.5 }),
  candidateLatencyRatio: Object.freeze({ max: 1.5 }),
});

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.dirname(SCRIPT_DIRECTORY);
const REPOSITORY_ROOT = path.resolve(CLI_ROOT, "..", "..");
const CLI_BIN = path.join(CLI_ROOT, "bin", "chainlesschain.js");
const RUNTIME_PREFLIGHT_BIN = path.join(
  SCRIPT_DIRECTORY,
  "graph-collaboration-quality-runtime-preflight.mjs",
);
const EXACT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const CANDIDATE_AGENT_LIMIT = 4;
const FORMAL_EXECUTION_GUIDANCE =
  "Use only the task-local validation named in the prompt; do not run " +
  "repository-wide tests, builds, or linters. When using run_shell, use a " +
  "portable Node command through the default platform shell and omit both " +
  "the shell and timeout fields. If an explicit foreground timeout is " +
  "unavoidable, it must be at least 60000 milliseconds.";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function qualityEvidenceDigest(value) {
  return `sha256:${createHash("sha256")
    .update("cc.graph-collaboration-quality-eval/v1")
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function bytesDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactSha(value, label = "commit SHA") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!EXACT_SHA.test(normalized)) {
    throw new TypeError(`${label} must be an exact 40 or 64 character SHA`);
  }
  return normalized;
}

function finiteNumber(value, label, { min = -Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new TypeError(`${label} must be a finite number >= ${min}`);
  }
  return number;
}

function ratio(numerator, denominator) {
  if (!(denominator > 0)) return numerator > 0 ? Number.POSITIVE_INFINITY : 0;
  return numerator / denominator;
}

export function enforceQualityThresholds(
  metrics,
  thresholds = FROZEN_THRESHOLDS,
) {
  const failures = [];
  for (const [metric, constraint] of Object.entries(thresholds)) {
    const actual = Number(metrics?.[metric]);
    if (!Number.isFinite(actual)) {
      failures.push({ metric, actual: null, reason: "metric_missing" });
      continue;
    }
    if (constraint.min != null && actual < constraint.min) {
      failures.push({ metric, actual, expected: `>= ${constraint.min}` });
    }
    if (constraint.max != null && actual > constraint.max) {
      failures.push({ metric, actual, expected: `<= ${constraint.max}` });
    }
  }
  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures.map(Object.freeze)),
  });
}

function sumRoundField(rounds, mode, field) {
  return rounds.reduce(
    (total, round) => total + Number(round?.[mode]?.[field] || 0),
    0,
  );
}

export function summarizeQualityRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new TypeError("quality evaluation requires at least one round");
  }
  const taskRuns = rounds.reduce(
    (total, round) => total + Number(round?.control?.total || 0),
    0,
  );
  const candidateTaskRuns = rounds.reduce(
    (total, round) => total + Number(round?.candidate?.total || 0),
    0,
  );
  if (taskRuns <= 0 || candidateTaskRuns !== taskRuns) {
    throw new Error("control and candidate task populations must match");
  }
  const controlPassed = sumRoundField(rounds, "control", "passed");
  const candidatePassed = sumRoundField(rounds, "candidate", "passed");
  const controlTokens = sumRoundField(rounds, "control", "tokens");
  const candidateTokens = sumRoundField(rounds, "candidate", "tokens");
  const controlDurationMs = sumRoundField(rounds, "control", "durationMs");
  const candidateDurationMs = sumRoundField(rounds, "candidate", "durationMs");
  const controlPassRate = controlPassed / taskRuns;
  const candidatePassRate = candidatePassed / taskRuns;
  const graphMetrics = rounds.map((round) => round.candidate.graphMetrics);
  const mean = (field, fallback) => {
    const values = graphMetrics
      .map((entry) => Number(entry?.[field]))
      .filter(Number.isFinite);
    return values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : fallback;
  };
  return Object.freeze({
    rounds: rounds.length,
    taskRuns,
    controlPassRate,
    candidatePassRate,
    candidateVsControlPassRateDelta: candidatePassRate - controlPassRate,
    behaviorEquivalenceRate:
      rounds.reduce(
        (total, round) => total + Number(round.behaviorEquivalent || 0),
        0,
      ) / rounds.length,
    candidateUnrelatedChangeRate:
      rounds.reduce(
        (total, round) =>
          total + Number(round.candidate.unrelatedChangeRate || 0),
        0,
      ) / rounds.length,
    candidateDeadlockRate: mean("deadlocked", 1),
    candidateReconciliationRate: mean("reconciliationRequired", 1),
    candidateMessageVisibilityRate: mean("messageVisibilityRate", 0),
    candidateHandoffCompletionRate: mean("handoffCompletionRate", 0),
    controlTokens,
    candidateTokens,
    candidateTokenRatio: ratio(candidateTokens, controlTokens),
    controlDurationMs,
    candidateDurationMs,
    candidateLatencyRatio: ratio(candidateDurationMs, controlDurationMs),
    controlCostUsd: sumRoundField(rounds, "control", "costUsd"),
    candidateCostUsd: sumRoundField(rounds, "candidate", "costUsd"),
  });
}

export function sealPlatformRecord(record) {
  const body = canonicalValue(record);
  return Object.freeze({
    ...body,
    evidenceDigest: qualityEvidenceDigest(body),
  });
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateRoundMode(mode, label, { graph = false } = {}) {
  if (!mode || typeof mode !== "object" || Array.isArray(mode)) {
    throw new Error(`${label} evidence is missing`);
  }
  if (!Array.isArray(mode.results)) {
    throw new Error(`${label} task results are missing`);
  }
  const resultIds = mode.results.map((result) => result?.id);
  if (!sameJson(resultIds, FORMAL_PROFILE.taskIds)) {
    throw new Error(`${label} task population differs from the formal profile`);
  }
  for (const result of mode.results) {
    if (
      typeof result.pass !== "boolean" ||
      !SHA256.test(String(result.outcomeDigest || ""))
    ) {
      throw new Error(`${label} contains an invalid task result`);
    }
  }
  const passed = mode.results.filter((result) => result.pass).length;
  if (
    Number(mode.total) !== FORMAL_PROFILE.taskIds.length ||
    Number(mode.passed) !== passed
  ) {
    throw new Error(`${label} pass totals do not match its task results`);
  }
  const outcomeDigest = qualityEvidenceDigest(
    mode.results.map(({ id, pass, outcomeDigest: digest }) => ({
      id,
      pass,
      outcomeDigest: digest,
    })),
  );
  if (mode.outcomeDigest !== outcomeDigest) {
    throw new Error(`${label} outcome digest does not match its task results`);
  }
  if (!Array.isArray(mode.unrelatedChanges)) {
    throw new Error(`${label} unrelated-change evidence is missing`);
  }
  const unrelatedRate = mode.unrelatedChanges.length > 0 ? 1 : 0;
  if (Number(mode.unrelatedChangeRate) !== unrelatedRate) {
    throw new Error(`${label} unrelated-change rate does not recompute`);
  }
  finiteNumber(mode.tokens, `${label}.tokens`, { min: 1 });
  finiteNumber(mode.costUsd, `${label}.costUsd`, {
    min: Number.MIN_VALUE,
  });
  finiteNumber(mode.durationMs, `${label}.durationMs`, { min: 1 });
  if (graph) {
    if (
      !mode.graphRunId ||
      !SHA256.test(String(mode.graphProjectionDigest || ""))
    ) {
      throw new Error(`${label} lacks durable Graph projection identity`);
    }
    for (const field of [
      "deadlocked",
      "reconciliationRequired",
      "messageVisibilityRate",
      "handoffCompletionRate",
    ]) {
      const value = finiteNumber(
        mode.graphMetrics?.[field],
        `${label}.${field}`,
        {
          min: 0,
        },
      );
      if (value > 1) {
        throw new Error(`${label}.${field} must be <= 1`);
      }
    }
  }
}

export function validatePlatformRecord(record, expected = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("platform evidence must be one JSON object");
  }
  const { evidenceDigest, ...body } = record;
  if (!SHA256.test(String(evidenceDigest || ""))) {
    throw new Error("platform evidence digest is missing or malformed");
  }
  if (qualityEvidenceDigest(body) !== evidenceDigest) {
    throw new Error("platform evidence digest does not match its body");
  }
  if (record.schema !== PLATFORM_SCHEMA || record.status !== "passed") {
    throw new Error("platform evidence is not a passed quality report");
  }
  if (!REQUIRED_PLATFORMS.includes(record.platform)) {
    throw new Error("platform evidence has an unsupported platform");
  }
  const commitSha = exactSha(record.commitSha, "platform commit SHA");
  if (expected.commitSha && commitSha !== exactSha(expected.commitSha)) {
    throw new Error("platform evidence commit does not match the expected SHA");
  }
  if (
    expected.challenge &&
    String(record.challenge || "") !== String(expected.challenge)
  ) {
    throw new Error("platform evidence challenge does not match this run");
  }
  if (
    record.profile?.name !== FORMAL_PROFILE.name ||
    Number(record.profile?.minimumDurationSeconds) !==
      FORMAL_PROFILE.minimumDurationSeconds ||
    Number(record.profile?.minimumRounds) !== FORMAL_PROFILE.minimumRounds ||
    !sameJson(record.profile?.taskIds, FORMAL_PROFILE.taskIds)
  ) {
    throw new Error("platform evidence did not use the frozen formal profile");
  }
  if (!sameJson(record.thresholds, FROZEN_THRESHOLDS)) {
    throw new Error("platform evidence thresholds differ from the frozen gate");
  }
  if (
    finiteNumber(record.durationSeconds, "durationSeconds", { min: 0 }) <
      FORMAL_PROFILE.minimumDurationSeconds ||
    !Array.isArray(record.rounds) ||
    record.rounds.length < FORMAL_PROFILE.minimumRounds
  ) {
    throw new Error("platform evidence is shorter than the formal profile");
  }
  if (
    !record.provider ||
    !record.model ||
    !record.executionId ||
    !record.challenge ||
    !record.architecture ||
    !record.node
  ) {
    throw new Error(
      "platform evidence lacks provider/model/execution identity",
    );
  }
  const startedAt = Date.parse(record.startedAt);
  const completedAt = Date.parse(record.completedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt ||
    Math.abs((completedAt - startedAt) / 1000 - record.durationSeconds) > 1
  ) {
    throw new Error("platform evidence duration does not match its timestamps");
  }
  const seeds = new Set();
  for (const round of record.rounds) {
    if (
      !Number.isInteger(round.seed) ||
      seeds.has(round.seed) ||
      ![0, 1].includes(Number(round.behaviorEquivalent))
    ) {
      throw new Error(
        "platform evidence contains an incomplete real-model round",
      );
    }
    seeds.add(round.seed);
    validateRoundMode(round.control, "single-Agent control");
    validateRoundMode(round.candidate, "Graph candidate", { graph: true });
    if (
      Number(round.behaviorEquivalent) !==
      behaviorEquivalent(round.control, round.candidate)
    ) {
      throw new Error("round behavior equivalence does not recompute");
    }
  }
  const metrics = summarizeQualityRounds(record.rounds);
  if (!sameJson(metrics, record.metrics)) {
    throw new Error(
      "platform quality metrics do not recompute from its rounds",
    );
  }
  const budgetCeilingUsd = finiteNumber(
    record.budget?.ceilingUsd,
    "budget.ceilingUsd",
    { min: Number.MIN_VALUE },
  );
  const perInvocationCeilingUsd = finiteNumber(
    record.budget?.perInvocationCeilingUsd,
    "budget.perInvocationCeilingUsd",
    { min: Number.MIN_VALUE },
  );
  const plannedMaxRounds = finiteNumber(
    record.budget?.plannedMaxRounds,
    "budget.plannedMaxRounds",
    { min: FORMAL_PROFILE.minimumRounds },
  );
  const observedCostUsd = metrics.controlCostUsd + metrics.candidateCostUsd;
  if (
    !Number.isInteger(plannedMaxRounds) ||
    plannedMaxRounds < record.rounds.length ||
    plannedMaxRounds > 100 ||
    Number(record.budget?.controlInvocationsPerRound) !==
      FORMAL_PROFILE.taskIds.length ||
    Number(record.budget?.candidateAgentLimit) !== CANDIDATE_AGENT_LIMIT ||
    Math.abs(Number(record.budget?.observedCostUsd) - observedCostUsd) > 1e-9 ||
    observedCostUsd > budgetCeilingUsd + 1e-9 ||
    perInvocationCeilingUsd *
      plannedMaxRounds *
      (FORMAL_PROFILE.taskIds.length + CANDIDATE_AGENT_LIMIT) >
      budgetCeilingUsd + 1e-9
  ) {
    throw new Error("platform quality budget evidence does not recompute");
  }
  if (
    expected.maxTotalCostUsd !== undefined &&
    budgetCeilingUsd !== Number(expected.maxTotalCostUsd)
  ) {
    throw new Error("platform quality budget differs from the protected limit");
  }
  const gate = enforceQualityThresholds(metrics);
  if (!gate.passed || !sameJson(gate, record.gate)) {
    throw new Error("platform quality threshold gate did not pass");
  }
  return record;
}

function evidenceFiles(directory) {
  const root = path.resolve(directory);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function readBoundedJson(file) {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAX_EVIDENCE_BYTES
  ) {
    throw new Error(`quality evidence is unsafe or oversized: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function verifyQualityMatrix(records, expected = {}) {
  if (!Array.isArray(records) || records.length !== REQUIRED_PLATFORMS.length) {
    throw new Error("quality matrix requires exactly three platform records");
  }
  const validated = records.map((record) =>
    validatePlatformRecord(record, expected),
  );
  const platforms = validated.map((record) => record.platform).sort();
  if (!sameJson(platforms, REQUIRED_PLATFORMS)) {
    throw new Error("quality matrix is missing a required operating system");
  }
  if (new Set(validated.map((record) => record.executionId)).size !== 3) {
    throw new Error("quality matrix platform executions must be distinct");
  }
  if (
    new Set(validated.map((record) => record.commitSha)).size !== 1 ||
    new Set(validated.map((record) => record.challenge)).size !== 1 ||
    new Set(validated.map((record) => record.provider)).size !== 1 ||
    new Set(validated.map((record) => record.model)).size !== 1 ||
    new Set(validated.map((record) => record.budget.ceilingUsd)).size !== 1
  ) {
    throw new Error(
      "quality matrix mixes commit, run, provider, or model identity",
    );
  }
  const allRounds = validated.flatMap((record) => record.rounds);
  const metrics = summarizeQualityRounds(allRounds);
  const gate = enforceQualityThresholds(metrics);
  if (!gate.passed) throw new Error("aggregate quality threshold gate failed");
  const body = canonicalValue({
    schema: MATRIX_SCHEMA,
    status: "passed",
    commitSha: validated[0].commitSha,
    challenge: validated[0].challenge,
    provider: validated[0].provider,
    model: validated[0].model,
    profile: FORMAL_PROFILE,
    thresholds: FROZEN_THRESHOLDS,
    budget: {
      perPlatformCeilingUsd: validated[0].budget.ceilingUsd,
      aggregateCeilingUsd:
        validated[0].budget.ceilingUsd * REQUIRED_PLATFORMS.length,
      observedCostUsd: metrics.controlCostUsd + metrics.candidateCostUsd,
    },
    platforms,
    platformEvidenceDigests: validated
      .map((record) => record.evidenceDigest)
      .sort(),
    metrics,
    gate,
  });
  return Object.freeze({
    ...body,
    aggregateDigest: qualityEvidenceDigest(body),
  });
}

function parseArguments(argv) {
  const result = {
    challenge: "",
    commitSha: "",
    durationSeconds: FORMAL_PROFILE.minimumDurationSeconds,
    maxRounds: 12,
    maxTotalCostUsd: Number.NaN,
    minRounds: FORMAL_PROFILE.minimumRounds,
    model: "",
    output: "",
    platform: "",
    provider: "openai",
    verifyDirectory: "",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1] || "";
    if (key === "--challenge") result.challenge = value;
    else if (key === "--commit-sha") result.commitSha = value;
    else if (key === "--duration-seconds")
      result.durationSeconds = Number(value);
    else if (key === "--max-rounds") result.maxRounds = Number(value);
    else if (key === "--max-total-cost-usd")
      result.maxTotalCostUsd = Number(value);
    else if (key === "--min-rounds") result.minRounds = Number(value);
    else if (key === "--model") result.model = value;
    else if (key === "--output") result.output = value;
    else if (key === "--platform") result.platform = value.toLowerCase();
    else if (key === "--provider") result.provider = value;
    else if (key === "--verify-dir") result.verifyDirectory = value;
    else throw new TypeError(`Unknown argument: ${key}`);
  }
  result.commitSha = exactSha(result.commitSha);
  if (!result.output) throw new TypeError("--output is required");
  if (!result.challenge || result.challenge.length > 512) {
    throw new TypeError(
      "--challenge is required and must be <= 512 characters",
    );
  }
  if (
    !Number.isFinite(result.maxTotalCostUsd) ||
    result.maxTotalCostUsd <= 0 ||
    result.maxTotalCostUsd > 10_000
  ) {
    throw new TypeError(
      "--max-total-cost-usd is required and must be greater than 0 and at most 10000",
    );
  }
  if (!result.verifyDirectory) {
    if (!REQUIRED_PLATFORMS.includes(result.platform)) {
      throw new TypeError("--platform must be linux, macos, or windows");
    }
    if (!result.provider || !result.model) {
      throw new TypeError("--provider and --model are required");
    }
    if (
      result.durationSeconds < FORMAL_PROFILE.minimumDurationSeconds ||
      result.minRounds < FORMAL_PROFILE.minimumRounds ||
      result.maxRounds < result.minRounds ||
      result.maxRounds > 100
    ) {
      throw new TypeError("formal duration/round bounds are not satisfied");
    }
  }
  return result;
}

function git(args, cwd, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertExactCleanSource(commitSha) {
  if (git(["rev-parse", "HEAD"], REPOSITORY_ROOT) !== commitSha) {
    throw new Error("quality evaluation checkout does not match --commit-sha");
  }
  if (git(["status", "--porcelain", "--untracked-files=no"], REPOSITORY_ROOT)) {
    throw new Error("quality evaluation requires a clean tracked source tree");
  }
}

function selectedTasks() {
  const byId = new Map(BUILTIN_TASKS.map((task) => [task.id, task]));
  return FORMAL_PROFILE.taskIds.map((id) => {
    const task = byId.get(id);
    if (!task) throw new Error(`frozen eval task is unavailable: ${id}`);
    return task;
  });
}

function safeRemoveTemporary(directory) {
  const resolved = path.resolve(directory);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(temporaryRoot)) {
    throw new Error("refusing to remove an evaluation directory outside temp");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function prepareBenchmark(prefix, tasks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init"], root);
  git(["config", "user.email", "quality-eval@chainlesschain.local"], root);
  git(["config", "user.name", "Graph Quality Eval"], root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  for (const task of tasks) {
    const directory = path.join(root, "cases", task.id);
    fs.mkdirSync(directory, { recursive: true });
    if (typeof task.setup === "function") await task.setup(directory);
  }
  git(["add", "--all"], root);
  git(["commit", "-m", "test: seed quality evaluation"], root);
  return { root, baseline: git(["rev-parse", "HEAD"], root) };
}

export function createEvaluationModelEnvironment(
  provider,
  isolationRoot,
  { canonicalGraph = false } = {},
) {
  const resolvedIsolationRoot = path.resolve(String(isolationRoot || ""));
  const temporaryRelation = path.relative(
    path.resolve(os.tmpdir()),
    resolvedIsolationRoot,
  );
  if (
    !temporaryRelation ||
    temporaryRelation === ".." ||
    temporaryRelation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(temporaryRelation)
  ) {
    throw new Error("evaluation isolation root must be below the OS temp root");
  }
  const userHome = path.join(resolvedIsolationRoot, "user-home");
  const configHome = path.join(resolvedIsolationRoot, "chainlesschain-home");
  const appData = path.join(userHome, "app-data");
  const localAppData = path.join(userHome, "local-app-data");
  const xdgConfigHome = path.join(userHome, "xdg-config");
  const xdgCacheHome = path.join(userHome, "xdg-cache");
  for (const directory of [
    userHome,
    configHome,
    appData,
    localAppData,
    xdgConfigHome,
    xdgCacheHome,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CI",
    "GITHUB_ACTIONS",
    "NO_COLOR",
  ];
  const environment = Object.fromEntries(
    allowed
      .filter((name) => process.env[name] != null)
      .map((name) => [name, process.env[name]]),
  );
  environment.HOME = userHome;
  environment.USERPROFILE = userHome;
  environment.APPDATA = appData;
  environment.LOCALAPPDATA = localAppData;
  environment.XDG_CONFIG_HOME = xdgConfigHome;
  environment.XDG_CACHE_HOME = xdgCacheHome;
  environment.CHAINLESSCHAIN_HOME = configHome;
  environment.CC_API_KEY = process.env.CC_API_KEY;
  environment.LLM_PROVIDER = provider;
  environment.CLAUDECODE = "1";
  environment.CC_RUN_SHELL_MIN_TIMEOUT_MS = "60000";
  environment.CC_SECURE_FS_WINDOWS_ACL_TIMEOUT_MS = "60000";
  if (canonicalGraph) {
    environment.CHAINLESSCHAIN_GRAPH_CLI_TEAM = "canonical";
  }
  return environment;
}

export function candidateGraphEvidence(state) {
  if (state?.graphAuthorityMode !== "canonical") {
    throw new Error("Graph candidate did not use canonical Graph authority");
  }
  const projection = state?.graphTraceProjection;
  if (
    projection?.schema !== "chainlesschain.graph-trace-projection/v1" ||
    projection?.status !== "succeeded" ||
    !projection?.runId ||
    !SHA256.test(String(projection?.projectionDigest || ""))
  ) {
    throw new Error("Graph candidate lacks a successful canonical projection");
  }
  const evaluation = evaluateGraphProjection(projection);
  if (evaluation.metrics.terminalSuccess !== 1) {
    throw new Error("Graph candidate canonical projection is not successful");
  }
  return Object.freeze({
    graphRunId: projection.runId,
    graphProjectionDigest: projection.projectionDigest,
    graphMetrics: evaluation.metrics,
  });
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs || 20 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function assertEvaluationRuntimeReady(provider) {
  const support = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-quality-runtime-preflight-"),
  );
  try {
    const result = spawnSync(process.execPath, [RUNTIME_PREFLIGHT_BIN], {
      cwd: REPOSITORY_ROOT,
      env: createEvaluationModelEnvironment(provider, support),
      encoding: "utf8",
      timeout: 2 * 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `formal quality runtime preflight failed: ${redactSecrets(String(result.stderr || result.stdout)).slice(-2000)}`,
      );
    }
  } finally {
    safeRemoveTemporary(support);
  }
}

function jsonLines(value) {
  return String(value || "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function candidateFailureDetails(result) {
  const events = jsonLines(result?.stdout);
  const failures = events
    .filter((event) => event?.type === "task:failed")
    .slice(-FORMAL_PROFILE.taskIds.length)
    .map((event) => ({
      key: String(event.key || "").slice(0, 256),
      error: redactSecrets(String(event.error || "")).slice(0, 1000),
      retry: event.retry === true,
    }));
  const summary = [...events]
    .reverse()
    .find((event) => event?.summary)?.summary;
  return {
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal || null,
    failures,
    summary: summary
      ? {
          success: summary.success === true,
          done: summary.done === true,
          executions: Number(summary.executions || 0),
        }
      : null,
    stderr: redactSecrets(String(result?.stderr || "")).slice(-1500),
  };
}

export function buildCandidateTasks(tasks, seed) {
  return tasks.map((task) => ({
    key: task.id,
    title: task.description,
    dependsOn: [],
    scopePaths: [`cases/${task.id}`],
    // These benchmark tasks have no external effects and run inside isolated
    // Git worktrees. Linux/Windows add managed process checkpoints; macOS uses
    // the Agent checkpoint because its generic Seatbelt boundary cannot prove
    // complete descendant process-tree ownership. Retrying remains safe;
    // incorrect code still exits normally and is measured by the scorer.
    retrySafe: true,
    prompt:
      `Work only in cases/${task.id}. ${task.prompt}\n\n` +
      `Evaluation seed: ${seed}. Do not edit files outside cases/${task.id}. ` +
      FORMAL_EXECUTION_GUIDANCE,
  }));
}

export function buildControlPrompt(task, seed) {
  return (
    `${task.prompt}\n\nEvaluation seed: ${seed}. ` +
    "Work only in this directory and do not modify unrelated files. " +
    FORMAL_EXECUTION_GUIDANCE
  );
}

export function candidateCheckpointArgs(platform) {
  if (!REQUIRED_PLATFORMS.includes(platform)) {
    throw new Error(`unsupported evaluation platform: ${platform}`);
  }
  // Generic macOS Seatbelt and Linux bwrap profiles cannot truthfully attest
  // that an arbitrary Agent child owns its complete descendant process tree.
  // Keep the Broker fail-closed contract intact: those platforms use the
  // already isolated Git worktree plus the Agent's own checkpoint, while
  // Windows retains the managed process-checkpoint boundary backed by a Job.
  return platform === "windows" ? ["--managed-checkpoint"] : [];
}

function usageFromEvents(events) {
  const terminal = [...events]
    .reverse()
    .find((event) => event?.type === "result");
  const terminalUsage = terminal?.usage || terminal?.result?.usage;
  if (terminalUsage && typeof terminalUsage === "object") {
    const explicit = Number(
      terminalUsage.total_tokens ?? terminalUsage.totalTokens,
    );
    const tokens = Number.isFinite(explicit)
      ? explicit
      : Number(terminalUsage.input_tokens ?? terminalUsage.inputTokens ?? 0) +
        Number(terminalUsage.output_tokens ?? terminalUsage.outputTokens ?? 0);
    const costUsd = Number(
      terminal?.total_cost_usd ??
        terminal?.cost_usd ??
        terminal?.result?.costUsd ??
        0,
    );
    return {
      tokens: Number.isFinite(tokens) ? tokens : 0,
      costUsd: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
    };
  }

  let tokens = 0;
  let costUsd = 0;
  for (const event of events) {
    const usage = event?.usage || event?.result?.usage || null;
    if (usage && typeof usage === "object") {
      const explicit = Number(usage.total_tokens ?? usage.totalTokens);
      tokens += Number.isFinite(explicit)
        ? explicit
        : Number(usage.input_tokens ?? usage.inputTokens ?? 0) +
          Number(usage.output_tokens ?? usage.outputTokens ?? 0);
    }
    const cost = Number(
      event?.total_cost_usd ?? event?.cost_usd ?? event?.result?.costUsd,
    );
    if (Number.isFinite(cost) && cost > 0) costUsd += cost;
  }
  return { tokens, costUsd };
}

function changedFiles(root, baseline, includeCommitted) {
  const committed = includeCommitted
    ? git(["diff", "--name-only", `${baseline}..HEAD`], root)
    : "";
  const working = git(["status", "--porcelain"], root)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  return [...new Set([...committed.split(/\r?\n/u), ...working])]
    .filter(Boolean)
    .map((name) => name.replaceAll("\\", "/"))
    .sort();
}

function taskOutcomeDigest(root, task) {
  const entries = (task.expectedFiles || [])
    .map((relativePath) => {
      const file = path.join(root, "cases", task.id, relativePath);
      return {
        path: relativePath.replaceAll("\\", "/"),
        digest: fs.existsSync(file) ? bytesDigest(fs.readFileSync(file)) : null,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  return qualityEvidenceDigest(entries);
}

async function scoreBenchmark(root, baseline, tasks, includeCommitted) {
  const results = [];
  for (const task of tasks) {
    const verdict = await task.check(path.join(root, "cases", task.id));
    results.push({
      id: task.id,
      pass: verdict?.pass === true,
      detail: String(verdict?.detail || "").slice(0, 512),
      outcomeDigest: taskOutcomeDigest(root, task),
    });
  }
  const changed = changedFiles(root, baseline, includeCommitted);
  const expected = new Set(
    tasks.flatMap((task) =>
      (task.expectedFiles || []).map((file) =>
        `cases/${task.id}/${file}`.replaceAll("\\", "/"),
      ),
    ),
  );
  const unrelatedChanges = changed.filter(
    (file) => file !== "package.json" && !expected.has(file),
  );
  return {
    results,
    passed: results.filter((result) => result.pass).length,
    total: results.length,
    unrelatedChanges,
    unrelatedChangeRate: unrelatedChanges.length > 0 ? 1 : 0,
    outcomeDigest: qualityEvidenceDigest(
      results.map(({ id, pass, outcomeDigest }) => ({
        id,
        pass,
        outcomeDigest,
      })),
    ),
  };
}

async function runControl({
  tasks,
  seed,
  provider,
  model,
  perInvocationCeilingUsd,
}) {
  const benchmark = await prepareBenchmark("cc-quality-control-", tasks);
  const support = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-quality-control-state-"),
  );
  const started = Date.now();
  let tokens = 0;
  let costUsd = 0;
  try {
    for (const task of tasks) {
      const prompt = buildControlPrompt(task, seed);
      const result = runCli(
        [
          "exec",
          "--print",
          prompt,
          "--output-format",
          "stream-json",
          "--provider",
          provider,
          "--model",
          model,
          "--permission-mode",
          "acceptEdits",
          "--sandbox-mode",
          "off",
          "--max-turns",
          "12",
          "--max-budget-usd",
          String(perInvocationCeilingUsd),
          "--ephemeral",
        ],
        {
          cwd: path.join(benchmark.root, "cases", task.id),
          env: createEvaluationModelEnvironment(provider, support),
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `single-agent control failed for ${task.id}: ${String(result.stderr).slice(-1000)}`,
        );
      }
      const events = jsonLines(result.stdout);
      const terminal = [...events]
        .reverse()
        .find((event) => event.type === "result");
      if (
        !terminal ||
        terminal.is_error === true ||
        terminal.subtype !== "success"
      ) {
        throw new Error(
          `single-agent control lacks success evidence for ${task.id}`,
        );
      }
      const usage = usageFromEvents(events);
      tokens += usage.tokens;
      costUsd += usage.costUsd;
    }
    const score = await scoreBenchmark(
      benchmark.root,
      benchmark.baseline,
      tasks,
      false,
    );
    if (!(tokens > 0))
      throw new Error("single-agent control lacks token usage");
    if (!(costUsd > 0))
      throw new Error("single-agent control lacks cost evidence");
    return {
      ...score,
      tokens,
      costUsd,
      durationMs: Date.now() - started,
    };
  } finally {
    safeRemoveTemporary(benchmark.root);
    safeRemoveTemporary(support);
  }
}

async function runCandidate({
  tasks,
  seed,
  platform,
  provider,
  model,
  perInvocationCeilingUsd,
}) {
  const benchmark = await prepareBenchmark("cc-quality-candidate-", tasks);
  const support = fs.mkdtempSync(path.join(os.tmpdir(), "cc-quality-state-"));
  const tasksFile = path.join(support, "tasks.json");
  const stateFile = path.join(support, "team-state.json");
  fs.writeFileSync(
    tasksFile,
    `${JSON.stringify(
      {
        tasks: buildCandidateTasks(tasks, seed),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const started = Date.now();
  try {
    const result = runCli(
      [
        "team",
        "run",
        "--tasks",
        tasksFile,
        "--agent",
        "--worktree",
        ...candidateCheckpointArgs(platform),
        "--merge",
        "--graph-canary-opt-in",
        "--teammates",
        "3",
        "--model",
        model,
        "--permission-mode",
        "acceptEdits",
        "--agent-sandbox-mode",
        "off",
        "--agent-max-turns",
        "12",
        "--agent-max-budget-usd",
        String(perInvocationCeilingUsd),
        "--agent-max-wall",
        "900",
        "--max-tasks",
        String(tasks.length),
        "--max-usd",
        String(perInvocationCeilingUsd * CANDIDATE_AGENT_LIMIT),
        "--max-wall",
        "1800",
        "--state",
        stateFile,
        "--json",
      ],
      {
        cwd: benchmark.root,
        env: createEvaluationModelEnvironment(provider, support, {
          canonicalGraph: true,
        }),
        timeoutMs: 35 * 60_000,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Graph candidate failed: ${JSON.stringify(candidateFailureDetails(result))}`,
      );
    }
    const output = jsonLines(result.stdout);
    const summary = [...output]
      .reverse()
      .find((entry) => entry.summary)?.summary;
    if (!summary?.success || Number(summary.executions) !== tasks.length) {
      throw new Error("Graph candidate lacks a complete team summary");
    }
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const graphEvidence = candidateGraphEvidence(state);
    const score = await scoreBenchmark(
      benchmark.root,
      benchmark.baseline,
      tasks,
      true,
    );
    const tokens = Number(summary.budget?.tokens || 0);
    if (!(tokens > 0)) throw new Error("Graph candidate lacks token usage");
    const costUsd = Number(summary.budget?.spentUsd || 0);
    if (!(costUsd > 0)) throw new Error("Graph candidate lacks cost evidence");
    return {
      ...score,
      tokens,
      costUsd,
      durationMs: Date.now() - started,
      ...graphEvidence,
    };
  } finally {
    safeRemoveTemporary(benchmark.root);
    safeRemoveTemporary(support);
  }
}

function behaviorEquivalent(control, candidate) {
  if (control.total !== candidate.total) return 0;
  const left = control.results.map(({ id, pass }) => ({ id, pass }));
  const right = candidate.results.map(({ id, pass }) => ({ id, pass }));
  return sameJson(left, right) ? 1 : 0;
}

async function runPlatformEvaluation(options) {
  if (!process.env.CC_API_KEY) {
    throw new Error("CC_API_KEY is required for the real-model quality eval");
  }
  assertExactCleanSource(options.commitSha);
  assertEvaluationRuntimeReady(options.provider);
  const tasks = selectedTasks();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const rounds = [];
  const seeds = [101, 202, 303];
  const perInvocationCeilingUsd =
    options.maxTotalCostUsd /
    (options.maxRounds *
      (FORMAL_PROFILE.taskIds.length + CANDIDATE_AGENT_LIMIT));
  while (
    rounds.length < options.minRounds ||
    (Date.now() - started) / 1000 < options.durationSeconds
  ) {
    if (rounds.length >= options.maxRounds) {
      throw new Error("formal duration was not reached before --max-rounds");
    }
    const seed = seeds[rounds.length % seeds.length] + rounds.length * 1000;
    const control = await runControl({
      ...options,
      tasks,
      seed,
      perInvocationCeilingUsd,
    });
    const candidate = await runCandidate({
      ...options,
      tasks,
      seed,
      perInvocationCeilingUsd,
    });
    rounds.push({
      seed,
      control,
      candidate,
      behaviorEquivalent: behaviorEquivalent(control, candidate),
    });
    const observedCostUsd = rounds.reduce(
      (total, round) => total + round.control.costUsd + round.candidate.costUsd,
      0,
    );
    if (observedCostUsd > options.maxTotalCostUsd + 1e-9) {
      throw new Error("real-model quality eval exceeded its total cost budget");
    }
  }
  const completed = Date.now();
  const metrics = summarizeQualityRounds(rounds);
  const gate = enforceQualityThresholds(metrics);
  if (!gate.passed) {
    throw new Error(
      `quality thresholds failed: ${canonicalJson(gate.failures)}`,
    );
  }
  return sealPlatformRecord({
    schema: PLATFORM_SCHEMA,
    status: "passed",
    commitSha: options.commitSha,
    challenge: options.challenge,
    executionId:
      `${process.env.GITHUB_RUN_ID || "local"}:` +
      `${process.env.GITHUB_RUN_ATTEMPT || "1"}:` +
      `${options.platform}:${randomUUID()}`,
    platform: options.platform,
    architecture: process.arch,
    node: process.version,
    provider: options.provider,
    model: options.model,
    profile: FORMAL_PROFILE,
    thresholds: FROZEN_THRESHOLDS,
    budget: {
      ceilingUsd: options.maxTotalCostUsd,
      perInvocationCeilingUsd,
      plannedMaxRounds: options.maxRounds,
      controlInvocationsPerRound: FORMAL_PROFILE.taskIds.length,
      candidateAgentLimit: CANDIDATE_AGENT_LIMIT,
      observedCostUsd: metrics.controlCostUsd + metrics.candidateCostUsd,
    },
    startedAt,
    completedAt: new Date(completed).toISOString(),
    durationSeconds: (completed - started) / 1000,
    rounds,
    metrics,
    gate,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const output = path.resolve(options.output);
  let result;
  if (options.verifyDirectory) {
    const records = evidenceFiles(options.verifyDirectory).map(readBoundedJson);
    result = verifyQualityMatrix(records, {
      commitSha: options.commitSha,
      challenge: options.challenge,
      maxTotalCostUsd: options.maxTotalCostUsd,
    });
  } else {
    result = await runPlatformEvaluation(options);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ status: result.status, output, digest: result.evidenceDigest || result.aggregateDigest })}\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
