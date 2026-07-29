import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(testDirectory, "../..");
const repositoryRoot = path.resolve(cliDirectory, "../..");
const scriptPath = path.join(
  cliDirectory,
  "scripts",
  "team-distributed-soak.mjs",
);
const temporaryDirectories = [];
const activeSoakProcesses = new Map();
const sourceOverrideRoots = [
  "packages/cli/bin",
  "packages/cli/scripts",
  "packages/cli/src",
  "packages/agent-sdk/src",
];

function safeGitEnvironment(extra = {}) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/iu.test(key)) environment[key] = value;
  }
  return {
    ...environment,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function safeGitArguments(repo, args) {
  return [
    "-c",
    `safe.directory=${path.resolve(repo).replaceAll("\\", "/")}`,
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
}

function gitOutput(args, { allowDetached = false, cwd = repositoryRoot } = {}) {
  const result = spawnSync("git", safeGitArguments(cwd, args), {
    cwd,
    encoding: "utf8",
    env: safeGitEnvironment(),
    windowsHide: true,
  });
  if (allowDetached && result.status === 1 && !result.error) return null;
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${
        result.error?.message ||
        result.stderr?.trim() ||
        `exit ${result.status}`
      }`,
    );
  }
  return result.stdout;
}

function gitBytes(args, { cwd = repositoryRoot } = {}) {
  const result = spawnSync("git", safeGitArguments(cwd, args), {
    cwd,
    encoding: null,
    env: safeGitEnvironment(),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${
        result.error?.message ||
        result.stderr?.toString("utf8").trim() ||
        `exit ${result.status}`
      }`,
    );
  }
  return result.stdout;
}

function exactSourceCheckoutIsAvailable() {
  try {
    const identity = invocationRepositoryIdentity();
    const untracked = gitOutput([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    const ignoredSourceOverrides = gitOutput([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...sourceOverrideRoots,
    ]);
    return (
      identity.trackedStatus === "" &&
      identity.unstagedTrackedDiff === "" &&
      identity.stagedTrackedDiff === "" &&
      untracked === "" &&
      ignoredSourceOverrides === ""
    );
  } catch {
    return false;
  }
}

function invocationRepositoryIdentity() {
  const branch = gitOutput(["symbolic-ref", "--quiet", "HEAD"], {
    allowDetached: true,
  });
  return {
    branchRef: branch?.trim() || null,
    detached: branch == null,
    head: gitOutput(["rev-parse", "HEAD"]).trim().toLowerCase(),
    trackedStatus: gitOutput([
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
    ]),
    unstagedTrackedDiff: gitOutput([
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ]),
    stagedTrackedDiff: gitOutput([
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ]),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRunning(child) {
  return child.exitCode == null && child.signalCode == null;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await delay(25);
  }
  return !processExists(pid);
}

function taskkillTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (isRunning(killer)) killer.kill("SIGKILL");
      finish();
    }, 2_000);
    killer.once("error", finish);
    killer.once("close", finish);
  });
}

async function waitForClose(closed, milliseconds) {
  return Promise.race([
    closed.then(() => true),
    delay(milliseconds).then(() => false),
  ]);
}

async function terminateProcessTree(child, closed) {
  if (await waitForClose(closed, 0)) return;
  if (child.pid == null) {
    if (!(await waitForClose(closed, 2_000))) {
      throw new Error("soak process failed to close without a process ID");
    }
    return;
  }
  if (process.platform === "win32") {
    await taskkillTree(child.pid);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  if (await waitForClose(closed, 2_000)) return;

  if (process.platform === "win32") {
    await taskkillTree(child.pid);
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  if (isRunning(child)) child.kill("SIGKILL");
  if (!(await waitForClose(closed, 5_000)) && isRunning(child)) {
    throw new Error(`soak process tree ${child.pid} did not terminate`);
  }
}

function temporaryOutput() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-production-soak-test-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "result.json");
}

function runShortSoak(outputPath, { expectedSha = null } = {}) {
  return new Promise((resolve, reject) => {
    const argumentsList = [
      scriptPath,
      "--duration-ms=250",
      "--max-rounds=1",
      "--tasks=5",
      "--workers=2",
      "--crashes=2",
      "--ttl-ms=60000",
      "--task-delay-ms=1",
      "--seed=424242",
      `--output=${outputPath}`,
    ];
    if (expectedSha != null) {
      argumentsList.push(`--expected-sha=${expectedSha}`);
    }
    const child = spawn(process.execPath, argumentsList, {
      cwd: cliDirectory,
      detached: process.platform !== "win32",
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = new Promise((closeResolve) => {
      child.once("close", closeResolve);
    });
    activeSoakProcesses.set(child, closed);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      activeSoakProcesses.delete(child);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function spawnDescendantFixture() {
  return new Promise((resolve, reject) => {
    const grandchildProgram = "setInterval(() => {}, 1000);";
    const parentProgram = `
      const { spawn } = require("node:child_process");
      const grandchild = spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchildProgram)}],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      process.stdout.write(String(grandchild.pid) + "\\n");
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["-e", parentProgram], {
      detached: process.platform !== "win32",
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = new Promise((closeResolve) => {
      child.once("close", closeResolve);
    });
    activeSoakProcesses.set(child, closed);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`process-tree fixture did not start: ${stderr}`));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline < 0 || settled) return;
      const grandchildPid = Number(stdout.slice(0, newline).trim());
      if (!Number.isInteger(grandchildPid) || grandchildPid <= 0) {
        fail(new Error(`invalid descendant PID: ${stdout}`));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ child, closed, grandchildPid });
    });
    child.once("error", fail);
    child.once("close", (code, signal) => {
      activeSoakProcesses.delete(child);
      if (!settled) {
        fail(
          new Error(
            `process-tree fixture closed early (${code}/${signal}): ${stderr}`,
          ),
        );
      }
    });
  });
}

afterEach(async () => {
  try {
    await Promise.all(
      [...activeSoakProcesses.entries()].map(([child, closed]) =>
        terminateProcessTree(child, closed),
      ),
    );
  } finally {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

const exactSourceCheckout = exactSourceCheckoutIsAvailable();

describe("distributed Agent Team production soak harness", () => {
  it("rejects an exact-SHA report path inside the calling repository", () => {
    const trackedOutput = path.join(repositoryRoot, "package.json");
    const before = fs.readFileSync(trackedOutput);
    const execution = spawnSync(
      process.execPath,
      [
        scriptPath,
        `--expected-sha=${gitOutput(["rev-parse", "HEAD"]).trim()}`,
        `--output=${trackedOutput}`,
      ],
      {
        cwd: cliDirectory,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    expect(execution.status).toBe(1);
    expect(execution.stderr).toMatch(
      /exact-SHA soak report must be written outside/iu,
    );
    expect(fs.readFileSync(trackedOutput)).toEqual(before);
  });

  it("rejects a canonical output alias that resolves into the repository", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-team-soak-output-alias-test-"),
    );
    temporaryDirectories.push(directory);
    const aliasPath = path.join(directory, "repository-alias");
    fs.symlinkSync(
      repositoryRoot,
      aliasPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    const repositoryOutput = path.join(
      repositoryRoot,
      `.soak-alias-${crypto.randomUUID()}.json`,
    );
    try {
      const execution = spawnSync(
        process.execPath,
        [
          scriptPath,
          `--output=${path.join(aliasPath, path.basename(repositoryOutput))}`,
        ],
        {
          cwd: cliDirectory,
          encoding: "utf8",
          windowsHide: true,
        },
      );
      expect(execution.status).toBe(1);
      expect(execution.stderr).toMatch(
        /report ancestor is not a real directory|output resolves inside the calling repository/iu,
      );
      expect(fs.existsSync(repositoryOutput)).toBe(false);
    } finally {
      fs.unlinkSync(aliasPath);
    }
  });

  it("never overwrites an existing report output", () => {
    const outputPath = temporaryOutput();
    const original = Buffer.from("existing-report-must-survive\n");
    fs.writeFileSync(outputPath, original);
    const execution = spawnSync(
      process.execPath,
      [scriptPath, `--output=${outputPath}`],
      {
        cwd: cliDirectory,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(execution.status).toBe(1);
    expect(execution.stderr).toMatch(/report output already exists/iu);
    expect(fs.readFileSync(outputPath)).toEqual(original);
  });

  it("accepts the committed blob's controlled CRLF worktree representation", async () => {
    const { crlfWorkingTreeBytes } = await import(
      pathToFileURL(scriptPath).href
    );
    const relativePath =
      "packages/cli/scripts/build-windows-sandbox-helper.ps1";
    const expectedOid = gitOutput(["rev-parse", `HEAD:${relativePath}`]).trim();
    const blobBytes = gitBytes(["cat-file", "blob", expectedOid]);
    const worktreeBytes = fs.readFileSync(
      path.join(repositoryRoot, ...relativePath.split("/")),
    );
    const rawWorktreeOid = gitOutput([
      "hash-object",
      "--no-filters",
      relativePath,
    ]).trim();
    expect(rawWorktreeOid).not.toBe(expectedOid);
    expect(crlfWorkingTreeBytes(blobBytes)).toEqual(worktreeBytes);
  });

  it("succeeds against a clean exact-SHA controlled source fixture", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-team-soak-exact-source-test-"),
    );
    temporaryDirectories.push(directory);
    const repo = path.join(directory, "repo");
    fs.mkdirSync(repo);
    fs.writeFileSync(
      path.join(repo, ".gitattributes"),
      "* text eol=lf\n*.cmd text eol=crlf\n",
    );
    fs.writeFileSync(path.join(repo, "source.js"), "export default 42;\n");
    fs.writeFileSync(path.join(repo, "run.cmd"), "@echo off\necho exact\n");
    gitOutput(["init"], { cwd: repo });
    gitOutput(["config", "user.name", "Soak Exact Test"], { cwd: repo });
    gitOutput(["config", "user.email", "soak-exact@example.invalid"], {
      cwd: repo,
    });
    gitOutput(["add", ".gitattributes", "source.js", "run.cmd"], {
      cwd: repo,
    });
    gitOutput(["commit", "-m", "exact source fixture"], { cwd: repo });
    const expectedSha = gitOutput(["rev-parse", "HEAD"], {
      cwd: repo,
    }).trim();
    const cmdOid = gitOutput(["rev-parse", `${expectedSha}:run.cmd`], {
      cwd: repo,
    }).trim();
    const { crlfWorkingTreeBytes, verifyExactSourceTree } = await import(
      pathToFileURL(scriptPath).href
    );
    fs.writeFileSync(
      path.join(repo, "run.cmd"),
      crlfWorkingTreeBytes(
        gitBytes(["cat-file", "blob", cmdOid], { cwd: repo }),
      ),
    );
    gitOutput(["add", "run.cmd"], { cwd: repo });
    expect(
      gitOutput(["hash-object", "run.cmd"], {
        cwd: repo,
      }).trim(),
    ).toBe(cmdOid);

    expect(
      verifyExactSourceTree(expectedSha.toUpperCase(), repo),
    ).toMatchObject({
      available: true,
      matches: true,
      expectedSha,
      headSha: expectedSha,
      trackedEntries: 3,
      attributes: {
        committedMatchesWorktree: true,
        crlfEntries: 1,
      },
      untracked: {
        count: 0,
      },
      ignoredSourceOverrides: {
        count: 0,
      },
      errors: [],
    });
  });

  it("rejects a clean filter before any status or diff can execute it", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-team-soak-clean-filter-test-"),
    );
    temporaryDirectories.push(directory);
    const repo = path.join(directory, "repo");
    const filterScript = path.join(directory, "filter.mjs");
    const marker = path.join(directory, "filter-executed.txt");
    fs.mkdirSync(repo);
    fs.writeFileSync(
      filterScript,
      [
        'import fs from "node:fs";',
        "fs.writeFileSync(process.argv[2], 'executed\\n');",
        "process.stdin.pipe(process.stdout);",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(repo, ".gitattributes"), "* filter=soak-evil\n");
    const sourcePath = path.join(repo, "source.txt");
    fs.writeFileSync(sourcePath, "controlled source\n");
    gitOutput(["init"], { cwd: repo });
    gitOutput(["config", "user.name", "Soak Filter Test"], { cwd: repo });
    gitOutput(["config", "user.email", "soak-filter@example.invalid"], {
      cwd: repo,
    });
    gitOutput(["add", ".gitattributes", "source.txt"], { cwd: repo });
    gitOutput(["commit", "-m", "filter fixture"], { cwd: repo });
    const filterCommand = [process.execPath, filterScript, marker]
      .map((value) => `"${value.replaceAll("\\", "/")}"`)
      .join(" ");
    gitOutput(["config", "filter.soak-evil.clean", filterCommand], {
      cwd: repo,
    });
    const changedTime = new Date(Date.now() + 2_000);
    fs.utimesSync(sourcePath, changedTime, changedTime);

    const { verifyExactSourceTree } = await import(
      pathToFileURL(scriptPath).href
    );
    const expectedSha = gitOutput(["rev-parse", "HEAD"], {
      cwd: repo,
    }).trim();
    expect(() => verifyExactSourceTree(expectedSha, repo)).toThrow(
      /unsupported filter=soak-evil conversion/iu,
    );
    expect(fs.existsSync(marker)).toBe(false);

    gitOutput(["status", "--porcelain=v1"], { cwd: repo });
    expect(fs.readFileSync(marker, "utf8")).toBe("executed\n");
  });

  it(
    "terminates the complete descendant tree on the timeout failure path",
    { timeout: 30_000 },
    async () => {
      const { loadSoakRuntimeModules, withTimeout: withSoakTimeout } =
        await import(pathToFileURL(scriptPath).href);
      await loadSoakRuntimeModules();
      const fixture = await spawnDescendantFixture();
      await expect(
        withSoakTimeout(new Promise(() => {}), 250, "process-tree fixture", [
          fixture.child,
        ]),
      ).rejects.toMatchObject({
        code: "ERR_SOAK_TIMEOUT",
      });
      expect(await waitForClose(fixture.closed, 5_000)).toBe(true);
      expect(await waitForProcessExit(fixture.grandchildPid, 5_000)).toBe(true);
    },
  );

  it.skipIf(!exactSourceCheckout)(
    "proves every tracked source byte at the exact SHA",
    { timeout: 600_000 },
    () => {
      const expectedSha = gitOutput(["rev-parse", "HEAD"]).trim().toUpperCase();
      const execution = spawnSync(
        process.execPath,
        [scriptPath, "--verify-source-only", `--expected-sha=${expectedSha}`],
        {
          cwd: cliDirectory,
          encoding: "utf8",
          env: safeGitEnvironment({
            GIT_DIR: path.join(
              os.tmpdir(),
              `cc-team-soak-poisoned-git-dir-${crypto.randomUUID()}`,
            ),
            GIT_WORK_TREE: path.join(
              os.tmpdir(),
              `cc-team-soak-poisoned-work-tree-${crypto.randomUUID()}`,
            ),
          }),
          maxBuffer: 16 * 1024 * 1024,
          timeout: 600_000,
          windowsHide: true,
        },
      );
      expect(
        execution,
        `${execution.stderr}\n${execution.stdout}`,
      ).toMatchObject({
        status: 0,
        signal: null,
      });
      const result = JSON.parse(execution.stdout.trim());
      expect(result).toMatchObject({
        success: true,
        expectedSha: expectedSha.toLowerCase(),
        sourceBytes: {
          available: true,
          matches: true,
          expectedSha: expectedSha.toLowerCase(),
          headSha: expectedSha.toLowerCase(),
          untracked: {
            count: 0,
          },
          ignoredSourceOverrides: {
            count: 0,
          },
          attributes: {
            committedMatchesWorktree: true,
          },
          errors: [],
        },
      });
      expect(result.sourceBytes.attributes.crlfEntries).toBeGreaterThan(0);
      expect(result.sourceBytes.trackedEntries).toBeGreaterThan(1_000);
      expect(result.sourceBytes.trackedBytes).toBeGreaterThan(1_000_000);
      expect(result.sourceBytes.sourceEntriesDigest).toMatch(/^[0-9a-f]{64}$/u);
    },
  );

  it(
    "passes a real Git/checkpoint/DAG/crash/finalize round without a live model",
    { timeout: 600_000 },
    async () => {
      const outputPath = temporaryOutput();
      const invocationRepositoryBefore = invocationRepositoryIdentity();
      const execution = await runShortSoak(outputPath);
      const invocationRepositoryAfter = invocationRepositoryIdentity();
      expect(invocationRepositoryAfter).toEqual(invocationRepositoryBefore);
      expect(
        execution,
        `${execution.stderr}\n${execution.stdout}`,
      ).toMatchObject({
        code: 0,
        signal: null,
      });
      expect(fs.existsSync(outputPath)).toBe(true);

      const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      expect(report).toMatchObject({
        schemaVersion: 2,
        kind: "chainlesschain-cli-team-production-soak",
        success: true,
        seed: 424242,
        checkoutEvidence: {
          expectedSha: null,
          headMatchesExpected: null,
          expectedTreeOid: null,
          sourceTreeMatchesExpected: null,
          trackedWorktreeRequired: false,
          trackedWorktree: {
            available: true,
          },
          invocationRepository: {
            afterCleanup: {
              available: true,
              overlays: {
                available: true,
              },
            },
            afterReportWrite: {
              available: true,
              overlays: {
                available: true,
              },
            },
            unchanged: true,
          },
        },
        coverageSemantics: {
          managedProcess: "capability-probe",
          agentExecution: "deterministic-contract",
          faultInjection: "pre-execution-worker-exit",
        },
        configuration: {
          workers: 2,
          tasksPerRound: 5,
          crashesPerRound: 2,
          ttlMs: 60000,
          maxRounds: 1,
          liveModel: false,
          networkRequired: false,
        },
        totals: {
          rounds: 1,
          tasks: 5,
          workerCrashes: 2,
          adjudicatedCrashRetries:
            report.platformCapability.workflowMode === "agent-worktree" ? 2 : 0,
          successfulSettlements: 5,
          rejectedStaleSettlements: 2,
          confirmedExternalEffects: 5,
          duplicateConfirmedExternalEffects: 0,
          finalizedWorktrees: 5,
          residues: 0,
        },
        failures: [],
      });
      expect(report.platformCapability).toMatchObject({
        directFileCheckpoint: {
          outcome: "committed",
          state: "committed",
          fileCoverage: "full",
        },
      });
      expect(["agent-worktree", "shell-worktree"]).toContain(
        report.platformCapability.workflowMode,
      );
      expect(report.platformCapability.truth).toContain(
        "managed-process capability probe",
      );
      expect(report.platformCapability.truth).not.toMatch(
        /positive managed Agent|spawned live Agent|hard kill/iu,
      );
      if (report.platformCapability.workflowMode === "shell-worktree") {
        expect(report.platformCapability).toMatchObject({
          managedProcessSupported: false,
          managedProcessProbe: {
            outcome: "failed-closed",
            checkpointState: "rolled_back",
          },
        });
      }

      expect(report.rounds).toHaveLength(1);
      expect(report.rounds[0]).toMatchObject({
        tasks: 5,
        workers: 2,
        productiveWorkers: 2,
        workerExecutionCeiling: {
          limitPerWorker: 3,
          totalExecutions: 5,
          expectedExecutions: 5,
          enforced: true,
        },
        preExecutionCrashes: 2,
        reclaimedLeases: 2,
        adjudicatedCrashRetries:
          report.platformCapability.workflowMode === "agent-worktree" ? 2 : 0,
        rejectedStaleSettlements: 2,
        successfulSettlements: 5,
        maxFence: 7,
        budget: {
          tasksStarted: 7,
          tasksSettled: 5,
          reservations: 0,
          reason: "max-tasks",
        },
        dag: {
          outputs: 5,
          dependencyEdges: 4,
          diamondBaselineVerified: true,
        },
        effects: {
          attempts: 5,
          confirmed: 5,
          duplicateConfirmed: 0,
          uniqueAttemptIds: 5,
          productiveWorkers: 2,
          crashBoundary: "before-worktree-checkpoint-and-external-effect",
        },
        finalization: {
          previewed: 5,
          merged: 5,
          cleaned: 5,
          phase: "completed",
        },
        git: {
          registeredWorktrees: 1,
          retainedVerifiedTaskBranches: 5,
          operationResidue: [],
        },
        residues: [],
        verifiedRoundStateRemoved: true,
      });
      expect(report.rounds[0].workerExecutionCeiling.workers).toHaveLength(2);
      expect(
        report.rounds[0].workerExecutionCeiling.workers.every(
          (worker) =>
            worker.withinLimit === true &&
            worker.executions <= worker.limit &&
            worker.limit === 3,
        ),
      ).toBe(true);
      expect(report.rounds[0].budget.tokens).toBe(
        report.platformCapability.workflowMode === "agent-worktree" ? 15 : 0,
      );
      expect(report.rounds[0].checkpoint).toMatchObject(
        report.platformCapability.workflowMode === "agent-worktree"
          ? {
              taskManagedCheckpointSupported: true,
              transactions: 5,
              terminal: 5,
              committed: 5,
              lockResidues: [],
            }
          : {
              taskManagedCheckpointSupported: false,
              transactions: 0,
              terminal: 0,
            },
      );
      expect(report.memory).toMatchObject({
        samples: 1,
        bounded: true,
        workerMaximaTrend: {
          samples: 1,
          bounded: true,
        },
      });
      expect(report.rounds[0].childRss.maximumBytes).toBeLessThanOrEqual(
        report.rounds[0].childRss.limitBytes,
      );
    },
  );
});
