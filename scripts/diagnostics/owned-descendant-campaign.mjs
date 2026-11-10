import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn as nativeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const runnerPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(runnerPath), "../..");
const targetName = "owned cleanup terminates an actual descendant process";
const testPath = "scripts/__tests__/verify01-diagnostic-process.test.mjs";
const sourcePaths = [
  testPath,
  "scripts/lib/verify01-diagnostic-process.mjs",
  "scripts/diagnostics/owned-descendant-campaign.mjs",
];
const scope = "diagnostic-only; not complete VERIFY01 host acceptance";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(filename, value, exclusive = false) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, {
    flag: exclusive ? "wx" : "w",
  });
}

function targetPassed(tap) {
  const lines = tap.split(/\r?\n/u);
  return (
    lines.filter((line) =>
      new RegExp(`^ok \\d+ - ${targetName}$`, "u").test(line),
    ).length === 1 &&
    lines.filter((line) => line === "# pass 1").length === 1 &&
    lines.filter((line) => line === "# fail 0").length === 1 &&
    lines.filter((line) => line === "# cancelled 0").length === 1 &&
    !lines.some((line) => /^not ok /u.test(line))
  );
}

function execute(spawn, args, options) {
  return new Promise((resolve) => {
    let startupError = null;
    try {
      const child = spawn(process.execPath, args, options);
      child.once("error", (error) => {
        startupError = { name: error.name, code: error.code || null };
      });
      child.once("close", (exitCode, signal) => {
        resolve({ exitCode, signal: signal || null, startupError });
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        startupError: { name: error.name, code: error.code || null },
      });
    }
  });
}

/** Repeat the unchanged test in fresh processes, stopping at its first failure. */
export async function runOwnedDescendantCampaign({
  rounds = 100,
  output,
  spawn = nativeSpawn,
  repositoryRoot = defaultRoot,
} = {}) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100)
    throw new Error("rounds must be an integer from 1 through 100");
  if (typeof output !== "string" || !output.trim())
    throw new Error("output must name a new directory");
  const outputDirectory = path.resolve(output);
  const root = path.resolve(repositoryRoot);
  const args = [
    "--test",
    "--test-reporter=tap",
    "--test-concurrency=1",
    `--test-name-pattern=^${targetName}$`,
    testPath,
  ];
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const sources = Object.fromEntries(
    sourcePaths.map((filename) => [
      filename,
      digest(fs.readFileSync(path.join(root, filename))),
    ]),
  );
  // No recursive mkdir: an existing directory (including a symlink) is refused.
  fs.mkdirSync(outputDirectory);
  const manifest = {
    schema: "verify01-owned-descendant-campaign/v1",
    scope,
    sourceSha,
    sources,
    planned: rounds,
    command: process.execPath,
    args,
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      node: process.version,
      runnerOs: process.env.RUNNER_OS || null,
      runnerArch: process.env.RUNNER_ARCH || null,
      imageVersion: process.env.ImageVersion || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    },
    startedAt: new Date().toISOString(),
  };
  writeJson(path.join(outputDirectory, "manifest.json"), manifest, true);
  const summary = {
    schema: manifest.schema,
    scope,
    sourceSha,
    planned: rounds,
    completed: 0,
    passed: 0,
    firstFailedRound: null,
    status: "running",
    success: false,
    startedAt: manifest.startedAt,
  };
  const summaryPath = path.join(outputDirectory, "summary.json");
  writeJson(summaryPath, summary, true);
  for (let round = 1; round <= rounds; round++) {
    const basename = `round-${String(round).padStart(3, "0")}`;
    const tapPath = path.join(outputDirectory, `${basename}.tap`);
    const startedAt = new Date().toISOString();
    writeJson(
      path.join(outputDirectory, `${basename}.started.json`),
      { round, startedAt, sourceSha, scope },
      true,
    );
    const started = performance.now();
    const fd = fs.openSync(tapPath, "wx", 0o600);
    let result;
    try {
      result = await execute(spawn, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      });
    } finally {
      fs.closeSync(fd);
    }
    const bytes = fs.readFileSync(tapPath);
    const executedAndPassed = targetPassed(bytes.toString("utf8"));
    const success =
      result.exitCode === 0 &&
      result.signal === null &&
      result.startupError === null &&
      executedAndPassed;
    const receipt = {
      round,
      scope,
      sourceSha,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      ...result,
      targetExecutedAndPassed: executedAndPassed,
      success,
      tapFile: `${basename}.tap`,
      tapBytes: bytes.length,
      tapSha256: digest(bytes),
    };
    writeJson(
      path.join(outputDirectory, `${basename}.finished.json`),
      receipt,
      true,
    );
    summary.completed++;
    if (success) summary.passed++;
    else {
      summary.firstFailedRound = round;
      summary.status = "stopped-on-first-failure";
    }
    writeJson(summaryPath, summary);
    if (!success) break;
  }
  summary.success = summary.passed === rounds;
  if (summary.success) summary.status = "completed";
  summary.finishedAt = new Date().toISOString();
  writeJson(summaryPath, summary);
  return summary;
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!["--rounds", "--output"].includes(name) || args[i + 1] === undefined)
      throw new Error("Usage: --rounds 1..100 --output NEW_DIRECTORY");
    const key = name.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate ${name}`);
    const value = args[i + 1];
    if (key === "rounds" && !/^\d+$/u.test(value))
      throw new Error("rounds must be an integer from 1 through 100");
    options[key] = key === "rounds" ? Number(value) : value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === runnerPath) {
  try {
    const summary = await runOwnedDescendantCampaign(
      parseArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify(summary));
    process.exitCode = summary.success ? 0 : 1;
  } catch (error) {
    console.error(
      `Owned descendant diagnostic campaign failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
