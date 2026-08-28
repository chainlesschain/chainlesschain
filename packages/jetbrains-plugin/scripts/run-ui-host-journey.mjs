#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const DEFAULT_ROBOT_URL = "http://127.0.0.1:8082";
export const WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT = 100;
export const WORKBENCH_NEEDS_INPUT_WARMUP_COUNT = 1;
export const WORKBENCH_NEEDS_INPUT_SLA_MS = 2_000;

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
  const captured = { stdout: "", stderr: "" };
  const capture = (stream, chunk) => {
    const limit = 250_000;
    captured[stream] = `${captured[stream]}${String(chunk)}`.slice(-limit);
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

  const posixWrapper = path.join(fakeBin, "cc");
  writeFileSync(
    posixWrapper,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixtureScript)} "$@"\n`,
    { encoding: "utf8", mode: 0o700, flag: "wx" },
  );
  chmodSync(posixWrapper, 0o700);

  const windowsWrapper = path.join(fakeBin, "cc.cmd");
  writeFileSync(
    windowsWrapper,
    `@echo off\r\n"${process.execPath}" "${fixtureScript}" %*\r\n`,
    { encoding: "utf8", mode: 0o700, flag: "wx" },
  );

  return prependPath(
    {
      ...baseEnvironment,
      CC_UI_FIXTURE_STATE: path.join(logRoot, "fake-cli-state.json"),
      CC_UI_FIXTURE_TRACE: path.join(logRoot, "fake-cli-protocol.jsonl"),
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
  return /robot server at http:\/\/(?:127\.0\.0\.1|localhost):\d+ did not come up within \d+s/u.test(
    String(error?.processOutput || ""),
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

export function verifyWorkbenchFixtureLedger(tracePath) {
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
  const totalCycles =
    WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT;
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
    warmupSamples: WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
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
  const sorted = samples
    .map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  const summary = {
    samples: samples.length,
    minLatencyMs: sorted[0],
    maxLatencyMs: sorted[sorted.length - 1],
    p95LatencyMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    warmupSamples: WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
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

function firstPluginArchive() {
  const distributions = path.join(PACKAGE_ROOT, "build", "distributions");
  if (!existsSync(distributions)) return null;
  const name = readdirSync(distributions)
    .filter((entry) => entry.endsWith(".zip"))
    .sort()[0];
  return name ? path.join(distributions, name) : null;
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
  const pluginArchive = firstPluginArchive();
  return writeIdeJourneyEvidence({
    artifactDir: options.artifactDir,
    journeyId: "jetbrains-chat-control-workbench-restart-rewind",
    host: "jetbrains",
    hostVersion: options.ideVersion,
    cliVersion: readPackageVersion(
      path.join(REPO_ROOT, "packages", "cli", "package.json"),
    ),
    extensionVersion: readPluginVersion(
      path.join(
        PACKAGE_ROOT,
        "src",
        "main",
        "resources",
        "META-INF",
        "plugin.xml",
      ),
    ),
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
    const hostPhases = [];
    for (const phase of ["initial", "restart"]) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const suffix = attempt === 1 ? "" : `-retry-${attempt}`;
        const launched = launchGradle(
          ["runIdeForUiTests", ...gradleOptions],
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
    const rewindCoverage = verifyRewindFixtureLedger(fixtureTracePath);
    const workbenchCoverage = verifyWorkbenchFixtureLedger(fixtureTracePath);
    const visibilitySummary = verifyWorkbenchVisibilityMetrics(metricsPath);
    writeFileSync(
      path.join(logRoot, "workbench-host-phases.json"),
      `${JSON.stringify(
        {
          phases: hostPhases,
          rewindCoverage,
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
