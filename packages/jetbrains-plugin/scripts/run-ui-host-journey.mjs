#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyConversationRecovery } from "./conversation-recovery-evidence.mjs";
import { verifyNativeTranscriptEvidence } from "./native-transcript-evidence.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_ROBOT_URL = "http://127.0.0.1:8082";
export const WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT = 100;
export const WORKBENCH_NEEDS_INPUT_SLA_MS = 2_000;
export const WORKBENCH_READINESS_MINIMUM_SAMPLES = 40;
export const WORKBENCH_READINESS_MAXIMUM_SAMPLES = 75;
export const WORKBENCH_READINESS_CONSECUTIVE_SAMPLES = 10;
export const WORKBENCH_QUIESCENCE_STABLE_PROBES = 4;
export const WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MS = 250;

function usage() {
  return [
    "Usage: node scripts/run-ui-host-journey.mjs [options]",
    "",
    "Options:",
    "  --ide-version <version>  Exact IntelliJ version (default: 2024.2)",
    "  --artifact-dir <path>    Immutable journey evidence directory (required)",
    "  --robot-url <url>        Remote Robot endpoint (default: http://127.0.0.1:8082)",
    "  --startup-timeout-ms <n> IDE startup deadline (default: 1200000)",
    "  --release-commit <sha>   Exact release commit override",
    "  --help                   Show this help",
  ].join("\n");
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    ideVersion: "2024.2",
    artifactDir: null,
    robotUrl: DEFAULT_ROBOT_URL,
    startupTimeoutMs: 1_200_000,
    releaseCommit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--ide-version") {
      options.ideVersion = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--artifact-dir") {
      options.artifactDir = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--robot-url") {
      options.robotUrl = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--startup-timeout-ms") {
      const value = Number(takeValue(argv, index, argument));
      if (!Number.isSafeInteger(value) || value < 10_000 || value > 3_600_000) {
        throw new Error(`${argument} must be between 10000 and 3600000`);
      }
      options.startupTimeoutMs = value;
      index += 1;
    } else if (argument === "--release-commit") {
      options.releaseCommit = takeValue(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.help && !options.artifactDir) {
    throw new Error("--artifact-dir is required");
  }
  if (!/^\d{4}\.\d+(?:\.\d+)*$/.test(options.ideVersion)) {
    throw new Error("--ide-version must be an exact IntelliJ version");
  }
  try {
    const robotUrl = new URL(options.robotUrl);
    if (
      robotUrl.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(robotUrl.hostname)
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("--robot-url must be an HTTP loopback URL");
  }
  return options;
}

function gradleExecutable() {
  const configured = String(
    process.env.CC_JETBRAINS_GRADLE_EXECUTABLE || "",
  ).trim();
  if (configured) {
    if (configured !== "gradle") {
      throw new Error(
        "CC_JETBRAINS_GRADLE_EXECUTABLE accepts only the setup-gradle command",
      );
    }
    return configured;
  }
  return path.join(
    PACKAGE_ROOT,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
}

function openProcessLogs(logRoot, label) {
  mkdirSync(logRoot, { recursive: true });
  const stdoutPath = path.join(logRoot, `${label}.stdout.log`);
  const stderrPath = path.join(logRoot, `${label}.stderr.log`);
  return {
    stdoutPath,
    stderrPath,
    stdout: createWriteStream(stdoutPath, { flags: "wx", mode: 0o600 }),
    stderr: createWriteStream(stderrPath, { flags: "wx", mode: 0o600 }),
  };
}

function launchGradle(args, logRoot, label, options = {}) {
  const logs = openProcessLogs(logRoot, label);
  const captured = { stdout: "", stderr: "", diagnosticWriteFailed: false };
  const capture = (stream, chunk) => {
    const limit = 250_000;
    captured[stream] = `${captured[stream]}${String(chunk)}`.slice(-limit);
    if (
      stream === "stderr" &&
      captured.stderr.includes("[cc-ui-event-diagnostic-write-failed]")
    )
      captured.diagnosticWriteFailed = true;
  };
  const child = spawn(gradleExecutable(), args, {
    cwd: PACKAGE_ROOT,
    env: options.env || process.env,
    windowsHide: true,
    shell: process.platform === "win32",
    detached: options.detached === true && process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(logs.stdout);
  child.stderr.pipe(logs.stderr);
  child.stdout.on("data", (chunk) => capture("stdout", chunk));
  child.stderr.on("data", (chunk) => capture("stderr", chunk));
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  const closeLogs = () => {
    logs.stdout.end();
    logs.stderr.end();
  };
  child.once("close", closeLogs);
  child.once("error", closeLogs);
  return { child, logs, captured };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

/** Prepend one directory without creating a second PATH/Path key on Windows. */
export function prependPath(environment, directory) {
  const next = { ...(environment || {}) };
  const pathKey =
    Object.keys(next).find((key) => key.toUpperCase() === "PATH") || "PATH";
  next[pathKey] = [directory, next[pathKey]]
    .filter(Boolean)
    .join(path.delimiter);
  return next;
}

/**
 * Build an isolated `cc` shim for the sandbox IDE. The shim is never installed,
 * persisted in IDE settings, or exposed to build/publish tasks; only the child
 * environment returned here can resolve it.
 */
export function createFakeCliEnvironment(
  logRoot,
  baseEnvironment = process.env,
) {
  const fakeBin = path.join(logRoot, "fake-cli-bin");
  mkdirSync(fakeBin, { recursive: true });
  const fixtureScript = path.join(
    REPO_ROOT,
    "tests",
    "fixtures",
    "ide-roadmap",
    "fake-stream-json-agent.mjs",
  );
  if (!existsSync(fixtureScript)) {
    throw new Error(`missing UI journey CLI fixture: ${fixtureScript}`);
  }

  // Keep every production discovery fallback inside this isolated fixture.
  for (const binary of ["cc", "chainlesschain", "clc", "clchain"]) {
    const posixWrapper = path.join(fakeBin, binary);
    writeFileSync(
      posixWrapper,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixtureScript)} "$@"\n`,
      { encoding: "utf8", mode: 0o700, flag: "wx" },
    );
    chmodSync(posixWrapper, 0o700);
    writeFileSync(
      path.join(fakeBin, `${binary}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fixtureScript}" %*\r\n`,
      { encoding: "utf8", mode: 0o700, flag: "wx" },
    );
  }

  const canonicalRoot =
    baseEnvironment.CC_UI_CONVERSATION_RECOVERY === "1"
      ? mkdtempSync(path.join(os.tmpdir(), "cc-jb-canonical-"))
      : null;
  if (canonicalRoot)
    writeFileSync(
      path.join(logRoot, "canonical-environment.json"),
      JSON.stringify({
        root: canonicalRoot,
        model: "deterministic fixture",
        persistence: "production canonical store and actual CLI command",
      }) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
  return prependPath(
    {
      ...baseEnvironment,
      CC_UI_FIXTURE_STATE: path.join(logRoot, "fake-cli-state.json"),
      CC_UI_FIXTURE_TRACE: path.join(logRoot, "fake-cli-protocol.jsonl"),
      CC_UI_INIT_GATE: path.join(logRoot, "init-gate.json"),
      ...(canonicalRoot
        ? {
            CC_UI_CANONICAL_ROOT: canonicalRoot,
            CHAINLESSCHAIN_HOME: path.join(canonicalRoot, "home"),
            CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(
              canonicalRoot,
              "security",
            ),
          }
        : {}),
    },
    fakeBin,
  );
}

async function runGradle(args, logRoot, label) {
  const { child, captured } = launchGradle(args, logRoot, label);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(0);
      else {
        const error = new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit ${code}`}`,
        );
        error.processOutput = `${captured.stdout}\n${captured.stderr}`;
        reject(error);
      }
    });
  });
  return exitCode;
}

export function isRobotStartupFailure(error) {
  const details = [error?.message, error?.processOutput]
    .filter(Boolean)
    .join("\n");
  return /(?:robot server at http:\/\/(?:127\.0\.0\.1|localhost):\d+ did not come up within \d+s|Remote Robot did not become ready within \d+ms|sandbox IDE exited before Remote Robot became ready)/iu.test(
    details,
  );
}

async function robotReady(robotUrl) {
  try {
    const response = await fetch(robotUrl, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRobot(child, robotUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("sandbox IDE exited before Remote Robot became ready");
    }
    if (await robotReady(robotUrl)) return;
    await delay(5_000);
  }
  throw new Error(`Remote Robot did not become ready within ${timeoutMs}ms`);
}

async function waitForRobotStopped(robotUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await robotReady(robotUrl))) return;
    await delay(500);
  }
  throw new Error(`Remote Robot did not stop within ${timeoutMs}ms`);
}

function processAlive(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

async function stopProcessTree(child) {
  if (!processAlive(child)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 10 && processAlive(child); attempt += 1) {
      await delay(500);
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  for (let attempt = 0; attempt < 10 && processAlive(child); attempt += 1) {
    await delay(500);
  }
  if (processAlive(child)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function readPackageVersion(filePath) {
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (typeof value.version !== "string") {
    throw new Error(`package has no version: ${filePath}`);
  }
  return value.version;
}

export function readPluginVersion(pluginXmlPath) {
  const xml = readFileSync(pluginXmlPath, "utf8");
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  if (matches.length !== 1 || !matches[0][1].trim()) {
    throw new Error("plugin.xml must contain exactly one version");
  }
  return matches[0][1].trim();
}

const REQUIRED_REWIND_ACTIONS = Object.freeze([
  "restore-code",
  "restore-conversation",
  "restore-both",
  "summary-from",
  "summary-to",
  "branch",
]);

export function verifyRewindFixtureLedger(tracePath) {
  const records = readFileSync(tracePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `fixture ledger has invalid JSON at line ${index + 1}: ${error.message}`,
        );
      }
    });
  const timelineReads = records.filter(
    (record) =>
      record.direction === "command" &&
      record.command === "checkpoint-timeline",
  ).length;
  if (timelineReads < REQUIRED_REWIND_ACTIONS.length) {
    throw new Error(
      `fixture ledger proves only ${timelineReads} checkpoint timeline read(s)`,
    );
  }
  for (const action of REQUIRED_REWIND_ACTIONS) {
    for (const mode of ["preview", "confirm"]) {
      if (
        !records.some(
          (record) =>
            record.direction === "command" &&
            record.command === "checkpoint-action" &&
            record.action === action &&
            record.mode === mode &&
            record.turnId === "turn-2",
        )
      ) {
        throw new Error(`fixture ledger does not prove ${action}/${mode}`);
      }
    }
  }
  return {
    timelineReads,
    actions: [...REQUIRED_REWIND_ACTIONS],
    coverage: "partial",
  };
}

export function verifyWorkbenchFixtureLedger(tracePath, readinessSamples) {
  if (
    !Number.isSafeInteger(readinessSamples) ||
    readinessSamples < WORKBENCH_READINESS_MINIMUM_SAMPLES ||
    readinessSamples > WORKBENCH_READINESS_MAXIMUM_SAMPLES
  ) {
    throw new Error(
      `fixture ledger requires a validated Workbench readiness sample count between ${WORKBENCH_READINESS_MINIMUM_SAMPLES} and ${WORKBENCH_READINESS_MAXIMUM_SAMPLES}`,
    );
  }
  const records = readFileSync(tracePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `fixture ledger has invalid JSON at line ${index + 1}: ${error.message}`,
        );
      }
    });
  let cursor = -1;
  const totalCycles = readinessSamples + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT;
  const lifecycleResumes = records.filter(
    (record) =>
      record.direction === "command" &&
      record.command === "daemon-resume" &&
      record.stage === "needs_input",
  ).length;
  const lifecycleReplies = records.filter(
    (record) =>
      record.direction === "command" &&
      record.command === "daemon-reply" &&
      record.stage === "done",
  ).length;
  if (lifecycleResumes !== totalCycles || lifecycleReplies !== totalCycles) {
    throw new Error(
      `fixture ledger proves ${lifecycleResumes} Workbench resume(s) and ${lifecycleReplies} reply/replies; expected exactly ${totalCycles}`,
    );
  }
  for (let cycle = 0; cycle < totalCycles; cycle += 1) {
    const resume = records.findIndex(
      (record, index) =>
        index > cursor &&
        record.direction === "command" &&
        record.command === "daemon-resume" &&
        record.stage === "needs_input",
    );
    const reply = records.findIndex(
      (record, index) =>
        index > resume &&
        record.direction === "command" &&
        record.command === "daemon-reply" &&
        record.stage === "done",
    );
    if (resume < 0 || reply <= resume) {
      throw new Error(
        `fixture ledger does not prove ordered Workbench lifecycle cycle ${cycle + 1}`,
      );
    }
    cursor = reply;
  }
  const recoveredProjection = records.findIndex(
    (record, index) =>
      index > cursor &&
      record.direction === "command" &&
      record.command === "session-projection",
  );
  if (recoveredProjection <= cursor) {
    throw new Error(
      "fixture ledger does not prove dispatch -> needs_input -> reply -> restart projection",
    );
  }
  return {
    samples: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
    readinessSamples,
    warmupSamples: readinessSamples,
    finalReply: cursor,
    recoveredProjection,
    coverage: "canonical-workbench-restart",
  };
}

export function verifyWorkbenchVisibilityMetrics(metricsPath) {
  if (!existsSync(metricsPath)) {
    throw new Error("Workbench visibility metrics are missing");
  }
  const records = readFileSync(metricsPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Workbench metrics have invalid JSON at line ${index + 1}: ${error.message}`,
        );
      }
    });
  const samples = records.filter(
    (record) =>
      record.host === "jetbrains" && record.metric === "needs-input-visible",
  );
  const readiness = records.filter(
    (record) =>
      record.host === "jetbrains" && record.metric === "needs-input-readiness",
  );
  if (
    readiness.length < WORKBENCH_READINESS_MINIMUM_SAMPLES ||
    readiness.length > WORKBENCH_READINESS_MAXIMUM_SAMPLES
  ) {
    throw new Error(
      `Workbench metrics prove ${readiness.length} readiness sample(s); expected between ${WORKBENCH_READINESS_MINIMUM_SAMPLES} and ${WORKBENCH_READINESS_MAXIMUM_SAMPLES}`,
    );
  }
  let consecutivePassing = 0;
  for (const [index, sample] of readiness.entries()) {
    if (
      sample.sample !== index + 1 ||
      sample.minimumSampleCount !== WORKBENCH_READINESS_MINIMUM_SAMPLES ||
      sample.maximumSampleCount !== WORKBENCH_READINESS_MAXIMUM_SAMPLES ||
      sample.thresholdMs !== WORKBENCH_NEEDS_INPUT_SLA_MS ||
      sample.requiredConsecutivePassingSamples !==
        WORKBENCH_READINESS_CONSECUTIVE_SAMPLES ||
      !Number.isFinite(sample.latencyMs) ||
      sample.latencyMs < 0
    ) {
      throw new Error(
        `Workbench metrics contain an invalid readiness sample: ${JSON.stringify(sample)}`,
      );
    }
    consecutivePassing =
      sample.latencyMs < WORKBENCH_NEEDS_INPUT_SLA_MS
        ? consecutivePassing + 1
        : 0;
    if (sample.consecutivePassingSamples !== consecutivePassing) {
      throw new Error(
        `Workbench readiness streak is inconsistent: ${JSON.stringify(sample)}`,
      );
    }
    const ready =
      sample.sample >= WORKBENCH_READINESS_MINIMUM_SAMPLES &&
      consecutivePassing >= WORKBENCH_READINESS_CONSECUTIVE_SAMPLES;
    if (ready && index !== readiness.length - 1) {
      throw new Error(
        `Workbench readiness metrics continued after readiness at sample ${sample.sample}`,
      );
    }
  }
  const finalReadiness = readiness[readiness.length - 1];
  if (
    finalReadiness.sample < WORKBENCH_READINESS_MINIMUM_SAMPLES ||
    finalReadiness.consecutivePassingSamples <
      WORKBENCH_READINESS_CONSECUTIVE_SAMPLES
  ) {
    throw new Error(
      "Workbench metrics do not prove the required pre-measurement readiness streak",
    );
  }

  const quiescence = records.filter(
    (record) =>
      record.host === "jetbrains" && record.metric === "workbench-quiescence",
  );
  if (
    quiescence.length !== 1 ||
    quiescence[0].state !== "done" ||
    quiescence[0].dispatchEnabled !== true ||
    quiescence[0].replyEnabled !== false ||
    quiescence[0].stableProbes !== WORKBENCH_QUIESCENCE_STABLE_PROBES ||
    quiescence[0].requiredStableProbes !== WORKBENCH_QUIESCENCE_STABLE_PROBES ||
    quiescence[0].probeIntervalMs !== WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MS
  ) {
    throw new Error(
      `Workbench metrics do not prove pre-measurement quiescence: ${JSON.stringify(quiescence)}`,
    );
  }
  if (samples.length !== WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT) {
    throw new Error(
      `Workbench metrics prove ${samples.length} needs_input visibility sample(s); expected ${WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT}`,
    );
  }
  for (const [index, sample] of samples.entries()) {
    if (
      sample.sample !== index + 1 ||
      sample.sampleCount !== WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT ||
      sample.thresholdMs !== WORKBENCH_NEEDS_INPUT_SLA_MS ||
      !Number.isFinite(sample.latencyMs) ||
      sample.latencyMs < 0
    ) {
      throw new Error(
        `Workbench metrics contain an invalid needs_input visibility sample: ${JSON.stringify(sample)}`,
      );
    }
  }
  const finalReadinessIndex = records.indexOf(finalReadiness);
  const quiescenceIndex = records.indexOf(quiescence[0]);
  const firstMeasurementIndex = records.indexOf(samples[0]);
  if (
    finalReadinessIndex < 0 ||
    quiescenceIndex <= finalReadinessIndex ||
    firstMeasurementIndex <= quiescenceIndex
  ) {
    throw new Error(
      "Workbench metrics do not order readiness -> quiescence -> measurement",
    );
  }
  const sorted = samples
    .map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  const summary = {
    samples: samples.length,
    minLatencyMs: sorted[0],
    maxLatencyMs: sorted[sorted.length - 1],
    p95LatencyMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    readinessSamples: readiness.length,
    readinessMinimumSamples: WORKBENCH_READINESS_MINIMUM_SAMPLES,
    readinessMaximumSamples: WORKBENCH_READINESS_MAXIMUM_SAMPLES,
    readinessConsecutiveSamples: WORKBENCH_READINESS_CONSECUTIVE_SAMPLES,
    quiescenceStableProbes: WORKBENCH_QUIESCENCE_STABLE_PROBES,
    warmupSamples: readiness.length,
    networkCondition: "loopback fixture; no external network",
    transport: "installed-plugin-remote-robot-production-route",
    runnerEnvironment:
      process.env.GITHUB_ACTIONS === "true" ? "github-hosted" : "local",
    runnerName: process.env.RUNNER_NAME || null,
    runnerOS: process.env.RUNNER_OS || process.platform,
    runnerArch: process.env.RUNNER_ARCH || process.arch,
    runnerImageOS: process.env.ImageOS || null,
    runnerImageVersion: process.env.ImageVersion || null,
  };
  if (summary.p95LatencyMs >= WORKBENCH_NEEDS_INPUT_SLA_MS) {
    throw new Error(
      `Workbench metrics violate the needs_input visibility P95 SLA: ${JSON.stringify(summary)}`,
    );
  }
  return summary;
}

export function findPluginArchive(distributions, version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version))
    throw new Error("Invalid plugin archive version");
  const archive = path.join(
    distributions,
    `chainlesschain-ide-bridge-${version}.zip`,
  );
  return existsSync(archive) ? archive : null;
}

/** Preserve unmodified IDE logs separately from the collector's redacted text copies. */
export function captureHostDiagnostics(sandboxRoot, captureRoot, stderr = "") {
  if (
    !path.isAbsolute(captureRoot) ||
    realpathSync(captureRoot) !== captureRoot
  )
    throw new Error("unsafe-capture-root");
  const status = {
    schema: "chainlesschain.ui-host-capture/v1",
    complete: false,
    scope:
      "Metadata event trace and original IDE log bytes after this host phase stopped",
    files: [],
    failures: [],
    failureDetails: [],
  };
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  // Exception messages/paths (including JSON parser excerpts) can contain secrets.
  // Retain native error identity and fixed validation reasons, never raw messages.
  const validationReasons = new Set([
    "unsafe-sandbox-root",
    "unsafe-event-trace",
    "missing-or-invalid-event-trace",
    "unsafe-idea-log",
    "missing-idea-log",
    "idea-log-exceeds-artifact-limit",
  ]);
  const recordFailure = (failure, stage, error) => {
    status.failures.push(failure);
    const detail = { failure, stage, name: error.name };
    for (const key of ["code", "syscall"]) {
      if (typeof error[key] === "string" && /^[A-Za-z0-9_]+$/u.test(error[key]))
        detail[key] = error[key];
    }
    if (validationReasons.has(error.message)) detail.reason = error.message;
    status.failureDetails.push(detail);
  };
  let stage = "event-trace.validate-sandbox-root";
  try {
    if (
      !path.isAbsolute(sandboxRoot) ||
      realpathSync(sandboxRoot) !== sandboxRoot
    )
      throw new Error("unsafe-sandbox-root");
    const trace = path.join(captureRoot, "host-events.jsonl");
    stage = "event-trace.stat";
    if (!lstatSync(trace).isFile() || lstatSync(trace).isSymbolicLink())
      throw new Error("unsafe-event-trace");
    stage = "event-trace.read";
    const bytes = readFileSync(trace);
    stage = "event-trace.parse";
    const records = bytes
      .toString("utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(JSON.parse);
    stage = "event-trace.validate-schema";
    if (
      !records.length ||
      records.some(
        (record) => record?.schema !== "chainlesschain.ui-event-diagnostic/v1",
      )
    )
      throw new Error("missing-or-invalid-event-trace");
    stage = "event-trace.write-original";
    writeFileSync(path.join(captureRoot, "host-events.jsonl.bin"), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    status.files.push({
      path: "host-events.jsonl.bin",
      source: "host-events.jsonl",
      bytes: bytes.length,
      sha256: digest(bytes),
      originalBytes: true,
    });
  } catch (error) {
    recordFailure("event-trace-or-capture-root-unavailable", stage, error);
  }
  if (stderr.includes("[cc-ui-event-diagnostic-write-failed]"))
    status.failures.push("event-diagnostic-write-failed");
  stage = "idea-log.validate-sandbox-root";
  try {
    if (
      !path.isAbsolute(sandboxRoot) ||
      realpathSync(sandboxRoot) !== sandboxRoot
    )
      throw new Error("unsafe-sandbox-root");
    const logs = [];
    const visit = (directory, depth) => {
      stage = "idea-log.enumerate";
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (
          entry.isDirectory() &&
          depth < 2 &&
          (depth === 0 || /^log(?:_|$)/u.test(entry.name))
        )
          visit(file, depth + 1);
        else if (/^idea(?:\.\d+)?\.log(?:\.\d+)?$/u.test(entry.name)) {
          stage = "idea-log.validate-file";
          if (!entry.isFile() || entry.isSymbolicLink())
            throw new Error("unsafe-idea-log");
          logs.push(file);
        }
      }
    };
    visit(sandboxRoot, 0);
    stage = "idea-log.require-files";
    if (!logs.length) throw new Error("missing-idea-log");
    for (const [index, source] of logs.sort().entries()) {
      stage = "idea-log.read";
      const bytes = readFileSync(source);
      stage = "idea-log.validate-size";
      if (bytes.length > 20 * 1024 * 1024)
        throw new Error("idea-log-exceeds-artifact-limit");
      const name = `idea-${String(index + 1).padStart(3, "0")}.log.bin`;
      stage = "idea-log.write-original";
      writeFileSync(path.join(captureRoot, name), bytes, {
        mode: 0o600,
        flag: "wx",
      });
      status.files.push({
        path: name,
        source: path.relative(sandboxRoot, source).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: digest(bytes),
        originalBytes: true,
      });
    }
  } catch (error) {
    recordFailure("original-idea-log-capture-failed", stage, error);
  }
  status.complete = status.failures.length === 0;
  writeFileSync(
    path.join(captureRoot, "capture-status.json"),
    `${JSON.stringify(status, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  return status;
}

async function writeEvidence(options, result, startedAt, logRoot) {
  const evidenceModule = path.join(
    REPO_ROOT,
    "scripts",
    "ide-journey-evidence.mjs",
  );
  const { writeIdeJourneyEvidence } = await import(
    pathToFileURL(evidenceModule).href
  );
  const testResults = path.join(
    PACKAGE_ROOT,
    "build",
    "test-results",
    "uiSmokeTest",
  );
  const screenshots = path.join(PACKAGE_ROOT, "build", "reports", "ui-smoke");
  const sourceRoots = [logRoot, testResults, screenshots].filter(existsSync);
  const extensionVersion = readPluginVersion(
    path.join(
      PACKAGE_ROOT,
      "src",
      "main",
      "resources",
      "META-INF",
      "plugin.xml",
    ),
  );
  const pluginArchive = findPluginArchive(
    path.join(PACKAGE_ROOT, "build", "distributions"),
    extensionVersion,
  );
  return writeIdeJourneyEvidence({
    artifactDir: options.artifactDir,
    journeyId:
      process.env.CC_UI_CONVERSATION_RECOVERY === "1"
        ? "jetbrains-canonical-conversation-recovery"
        : "jetbrains-chat-control-workbench-restart-rewind",
    host: "jetbrains",
    hostVersion: options.ideVersion,
    cliVersion: readPackageVersion(
      path.join(REPO_ROOT, "packages", "cli", "package.json"),
    ),
    extensionVersion,
    transport: "local-ide-bridge",
    result,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceRoots,
    artifactPaths: [
      pluginArchive ||
        path.join(
          PACKAGE_ROOT,
          "build",
          "distributions",
          "__missing-plugin.zip",
        ),
    ],
    repoRoot: REPO_ROOT,
    releaseCommit: options.releaseCommit,
    env: process.env,
  });
}

export function verifyModelConfigurationFixtureLedger(tracePath) {
  const records = readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const commands = records.filter((record) => record.direction === "command");
  const saves = commands.filter((record) => record.command === "llm-configure");
  const before = commands.find(
    (record) =>
      record.command === "model-probe" &&
      record.probe === "journey:model:initial-before",
  );
  const after = commands.find(
    (record) =>
      record.command === "model-probe" &&
      record.probe === "journey:model:initial-after",
  );
  const restart = commands.find(
    (record) =>
      record.command === "model-probe" &&
      record.probe === "journey:model:restart",
  );
  if (
    saves.length !== 1 ||
    !before ||
    !after ||
    !restart ||
    before.model !== "deterministic-host-peer" ||
    before.sessionId !== after.sessionId ||
    after.sessionId !== restart.sessionId ||
    // Windows can reuse a PID between the two IDE launches. Each fixture
    // invocation records a fresh UUID, which identifies the actual process.
    [before, after, restart].some(
      (record) =>
        typeof record.processId !== "number" ||
        !Number.isSafeInteger(record.processId) ||
        record.processId <= 0 ||
        typeof record.processInstanceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          record.processInstanceId,
        ),
    ) ||
    before.processInstanceId === after.processInstanceId ||
    after.processInstanceId === restart.processInstanceId ||
    [saves[0], after, restart].some(
      (record) =>
        record.model !== "ui-config-model" ||
        record.visionModel !== "ui-config-vision",
    ) ||
    commands.indexOf(before) >= commands.indexOf(saves[0]) ||
    commands.indexOf(saves[0]) >= commands.indexOf(after) ||
    commands.indexOf(after) >= commands.indexOf(restart)
  ) {
    throw new Error(
      "Model configuration evidence does not prove save -> existing-session reload -> IDE restart",
    );
  }
  const savedReads = commands.filter(
    (record, index) =>
      index > commands.indexOf(saves[0]) &&
      record.command === "config-list" &&
      record.model === "ui-config-model",
  ).length;
  const tests = commands.filter(
    (record) =>
      record.command === "llm-test" && record.model === "ui-config-model",
  ).length;
  if (savedReads < 3 || tests !== 1)
    throw new Error(
      "Model configuration evidence lacks saved readback/reopen or explicit connection test",
    );
  return {
    saves: 1,
    savedReads,
    tests,
    existingSessionReload: true,
    ideRestart: true,
    unsavedChangesDiscarded: true,
    providerEvidence: "deterministic keyless fixture",
  };
}

export async function runJourney(options) {
  const startedAt = new Date().toISOString();
  const logRoot = path.join(
    PACKAGE_ROOT,
    "build",
    "reports",
    "ui-host-driver",
    `${options.ideVersion}-${Date.now()}`,
  );
  const metricsPath = path.join(logRoot, "workbench-metrics.jsonl");
  const localIdePath = String(
    process.env.CC_JETBRAINS_IDE_LOCAL_PATH || "",
  ).trim();
  if (
    localIdePath &&
    (!path.isAbsolute(localIdePath) || !existsSync(localIdePath))
  ) {
    throw new Error(
      "CC_JETBRAINS_IDE_LOCAL_PATH must name an existing absolute directory",
    );
  }
  const gradleOptions = [
    `-PhostIdeVersion=${options.ideVersion}`,
    `-PuiJourneyRunId=${path.basename(logRoot).replaceAll(".", "-")}`,
    ...(localIdePath ? [`-PhostIdeLocalPath=${localIdePath}`] : []),
    "--no-daemon",
    "--stacktrace",
    ...(process.env.CC_JETBRAINS_GRADLE_EXECUTABLE
      ? ["--no-configuration-cache"]
      : []),
  ];
  let ideProcess = null;
  let journeyError = null;
  let result = "failed";

  try {
    await runGradle(
      ["compileUiTestJava", "buildPlugin", ...gradleOptions],
      logRoot,
      "prepare",
    );
    const fixtureEnvironment = createFakeCliEnvironment(logRoot);
    const pluginArchive = findPluginArchive(
      path.join(PACKAGE_ROOT, "build", "distributions"),
      readPluginVersion(
        path.join(
          PACKAGE_ROOT,
          "src",
          "main",
          "resources",
          "META-INF",
          "plugin.xml",
        ),
      ),
    );
    if (!pluginArchive) throw new Error("Built plugin archive is missing");
    const hostPhases = [];
    for (const phase of ["initial", "restart"]) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const suffix = attempt === 1 ? "" : `-retry-${attempt}`;
        const captureRoot = path.join(
          logRoot,
          `host-capture-${phase}${suffix}`,
        );
        mkdirSync(captureRoot, { recursive: true, mode: 0o700 });
        const launched = launchGradle(
          [
            "runIdeForUiTests",
            ...gradleOptions,
            `-Dui.event.captureRoot=${captureRoot}`,
          ],
          logRoot,
          `sandbox-ide-${phase}${suffix}`,
          {
            detached: true,
            env: fixtureEnvironment,
          },
        );
        ideProcess = launched.child;
        const phaseStartedAt = new Date().toISOString();
        let phaseError = null;
        try {
          await waitForRobot(
            ideProcess,
            options.robotUrl,
            options.startupTimeoutMs,
          );
          await runGradle(
            [
              "uiSmokeTest",
              "--rerun-tasks",
              `-Dui.robot.url=${options.robotUrl}`,
              `-Dui.journey.phase=${phase}`,
              `-Dui.metrics.path=${metricsPath}`,
              ...(fixtureEnvironment.CC_UI_CANONICAL_ROOT
                ? [
                    `-Dui.recovery.root=${logRoot}`,
                    `-Dui.plugin.archive=${pluginArchive}`,
                  ]
                : []),
              ...gradleOptions,
            ],
            logRoot,
            `ui-smoke-${phase}${suffix}`,
          );
          hostPhases.push({
            phase,
            attempt,
            processId: ideProcess.pid,
            startedAt: phaseStartedAt,
            completedAt: new Date().toISOString(),
          });
        } catch (error) {
          phaseError = error;
        } finally {
          await stopProcessTree(ideProcess);
          ideProcess = null;
          try {
            const capture = captureHostDiagnostics(
              path.join(
                PACKAGE_ROOT,
                "build",
                "idea-sandbox",
                path.basename(logRoot).replaceAll(".", "-"),
              ),
              captureRoot,
              launched.captured.diagnosticWriteFailed
                ? "[cc-ui-event-diagnostic-write-failed]"
                : "",
            );
            if (!capture.complete) {
              process.stderr.write(
                `[jetbrains-ui-host] incomplete host diagnostics: ${capture.failures.join(", ")}\n`,
              );
            }
          } catch (captureError) {
            process.stderr.write(
              `[jetbrains-ui-host] diagnostic capture failed: ${captureError.message}\n`,
            );
          }
        }
        await waitForRobotStopped(options.robotUrl);
        if (!phaseError) break;
        if (attempt === 1 && isRobotStartupFailure(phaseError)) {
          process.stderr.write(
            `[jetbrains-ui-host] ${phase} Robot startup timed out; restarting the IDE once\n`,
          );
          continue;
        }
        throw phaseError;
      }
    }
    const fixtureTracePath = path.join(logRoot, "fake-cli-protocol.jsonl");
    if (fixtureEnvironment.CC_UI_CANONICAL_ROOT) {
      const recovery = verifyConversationRecovery(logRoot, fixtureTracePath);
      const recoveryInitial = JSON.parse(
        readFileSync(
          path.join(logRoot, "conversation-recovery-initial.json"),
          "utf8",
        ),
      );
      const nativeTranscript = verifyNativeTranscriptEvidence(
        path.join(logRoot, "native-transcript-metrics.json"),
        {
          processId: recoveryInitial.a.processId,
          ideVersion: options.ideVersion,
        },
      );
      writeFileSync(
        path.join(logRoot, "conversation-recovery-host-phases.json"),
        JSON.stringify(
          { phases: hostPhases, recovery, nativeTranscript },
          null,
          2,
        ) + "\n",
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
    } else {
      const rewindCoverage = verifyRewindFixtureLedger(fixtureTracePath);
      const modelConfigurationCoverage =
        verifyModelConfigurationFixtureLedger(fixtureTracePath);
      const visibilitySummary = verifyWorkbenchVisibilityMetrics(metricsPath);
      const workbenchCoverage = verifyWorkbenchFixtureLedger(
        fixtureTracePath,
        visibilitySummary.readinessSamples,
      );
      writeFileSync(
        path.join(logRoot, "workbench-host-phases.json"),
        `${JSON.stringify(
          {
            phases: hostPhases,
            rewindCoverage,
            modelConfigurationCoverage,
            workbenchCoverage,
            visibilitySummary: {
              ...visibilitySummary,
              measurementStartedAt: hostPhases[0]?.startedAt,
              measurementCompletedAt: hostPhases[0]?.completedAt,
            },
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
    }
    result = "passed";
  } catch (error) {
    journeyError = error;
  } finally {
    await stopProcessTree(ideProcess);
  }

  let evidenceResult;
  try {
    evidenceResult = await writeEvidence(options, result, startedAt, logRoot);
    process.stdout.write(
      `[jetbrains-ui-host] evidence: ${evidenceResult.destination} (${evidenceResult.evidence.evidenceDigest})\n`,
    );
    if (!evidenceResult.evidence.evidenceComplete) {
      throw new Error(
        `IDE journey evidence incomplete: ${evidenceResult.evidence.incidents
          .map((incident) => incident.code)
          .join(", ")}`,
      );
    }
  } catch (error) {
    if (!journeyError) journeyError = error;
    else {
      process.stderr.write(
        `[jetbrains-ui-host] evidence failure: ${error.message}\n`,
      );
    }
  }
  if (journeyError) throw journeyError;
  return evidenceResult;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    await runJourney({
      ...options,
      artifactDir: path.resolve(options.artifactDir),
    });
    process.stdout.write(
      `[jetbrains-ui-host] PASS IntelliJ ${options.ideVersion}\n`,
    );
  } catch (error) {
    process.stderr.write(`[jetbrains-ui-host] FAIL ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
