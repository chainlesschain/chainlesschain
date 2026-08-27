import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjudicateDistributedQueue,
  distributedQueueStatus,
  finalizeDistributedQueue,
  initDistributedQueue,
  interruptDistributedQueue,
  recoverDistributedQueueCheckpoint,
  registerTeamDistributedCommands,
  runDistributedWorker,
} from "../../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";
import { TeamProcessCheckpointBroker } from "../../src/lib/agent-team/team-process-checkpoint.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  SECURE_FILE_IDENTITY_ERROR,
  SecureFileIdentityError,
  isAffectedWindowsZeroDeviceStatRuntime,
} from "../../src/lib/secure-file-identity.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(here, "../../bin/chainlesschain.js");
const workerFixture = path.resolve(
  here,
  "../fixtures/team-distributed-cli-worker.mjs",
);
const recoveryWorkerFixture = path.resolve(
  here,
  "../fixtures/team-distributed-recovery-worker.mjs",
);
const temporaryDirectories = [];

function git(repo, ...args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo(name = "repo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-cli-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, name);
  const authority = path.join(root, "authority");
  fs.mkdirSync(repo);
  fs.mkdirSync(authority, { mode: 0o700 });
  git(repo, "init");
  git(repo, "config", "user.name", "Team Test");
  git(repo, "config", "user.email", "team-test@example.invalid");
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "base");
  return {
    root,
    repo,
    state: path.join(authority, "queue.json"),
    graph: path.join(authority, "tasks.json"),
  };
}

function writeGraph(location, tasks) {
  fs.writeFileSync(location, `${JSON.stringify({ tasks }, null, 2)}\n`, {
    mode: 0o600,
  });
}

function statProjection(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function projectedFileSystem(filePath, overrides) {
  const runtimeFs = Object.create(fs);
  const nativeLstatSync = fs.lstatSync.bind(fs);
  const canonicalFilePath = path.join(
    fs.realpathSync.native(path.dirname(filePath)),
    path.basename(filePath),
  );
  runtimeFs.lstatSync = (target, options) => {
    const stat = nativeLstatSync(target, options);
    return path.resolve(String(target)) === path.resolve(canonicalFilePath)
      ? statProjection(stat, overrides)
      : stat;
  };
  return runtimeFs;
}

function createDirectoryAlias(target, alias) {
  try {
    fs.symlinkSync(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  }
}

function nodeWrite(file, value, { delay = 0, requireFiles = [] } = {}) {
  const assertions = requireFiles
    .map(
      (required) =>
        `if(!fs.existsSync(${JSON.stringify(required)}))process.exit(9);`,
    )
    .join("");
  const source = `const fs=require('fs');setTimeout(()=>{${assertions}fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(value)})},${delay})`;
  return `node -e "eval(Buffer.from('${Buffer.from(source).toString("base64")}','base64').toString())"`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function lightweightWorktreeCoordinator(runTask) {
  return class LightweightWorktreeCoordinator {
    constructor(_repoRoot, { snapshot } = {}) {
      this._snapshot = snapshot || { records: [] };
    }

    isGitRepo() {
      return true;
    }

    snapshot() {
      return {
        ...this._snapshot,
        records: [...(this._snapshot.records || [])],
      };
    }

    registerCompletedDependency() {}

    seed() {}

    makeRunTask() {
      return runTask;
    }
  };
}

function spawnWorker({ state, repo, runId, workerId, mode = "run" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerFixture, state, repo, runId, workerId, mode],
      {
        cwd: repo,
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    child.on("close", (code) => {
      let output;
      try {
        output = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
      } catch (error) {
        reject(
          new Error(`Invalid worker output (${code}): ${stdout}\n${stderr}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve({ code, output, stdout, stderr });
    });
  });
}

function spawnGraphWriterCli({ state, repo, runId }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cliBin,
        "team",
        "queue",
        "graph-writer",
        "--state",
        state,
        "--repo",
        repo,
        "--run-id",
        runId,
        "--graph-authority",
        "canonical",
        "--poll-ms",
        "25",
        "--json",
      ],
      {
        cwd: repo,
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    child.on("close", (code) => {
      try {
        resolve({ code, output: JSON.parse(stdout.trim()), stdout, stderr });
      } catch (error) {
        reject(
          new Error(
            `Invalid Graph writer CLI output (${code}): ${stdout}\n${stderr}`,
            { cause: error },
          ),
        );
      }
    });
  });
}

function spawnRecoveryWorker({ state, repo, runId, workerId, sentinel }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [recoveryWorkerFixture, state, repo, runId, workerId, sentinel],
      {
        cwd: repo,
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    child.on("close", (code) => {
      let output;
      try {
        output = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
      } catch (error) {
        reject(
          new Error(
            `Invalid recovery worker output (${code}): ${stdout}\n${stderr}`,
            { cause: error },
          ),
        );
        return;
      }
      resolve({ code, output, stdout, stderr });
    });
  });
}

function useDeterministicProcessTreeSandbox() {
  // These tests isolate checkpoint orchestration from host sandbox
  // availability. Native Linux/macOS/Windows enforcement stays covered by the
  // live and Strict Sandbox suites.
  return vi
    .spyOn(executionBroker, "_prepareSandboxPlan")
    .mockImplementation((command, args, options, context = {}) => ({
      contractVersion: 1,
      applied: true,
      platform: process.platform,
      profile: context.sandboxPolicy?.profile || "default",
      command,
      args: [...(args || [])],
      options: { ...options },
      enforcement: "test-process-tree",
      backend: "test-process-tree",
      guarantees: ["process-tree"],
      requiredBoundaries: [
        ...(context.sandboxPolicy?.requiredBoundaries || []),
      ],
      reason: null,
      postSpawn: { required: false, mode: "none" },
      cleanup: vi.fn(),
    }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("team distributed CLI", () => {
  it("generates init authority instead of accepting ignored caller pins", () => {
    for (const invalidOptions of [
      { queueId: "caller-queue" },
      { authorityDigest: "a".repeat(64) },
    ]) {
      expect(() => initDistributedQueue(invalidOptions)).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_INVALID_OPTION" }),
      );
    }

    const program = new Command().exitOverride().configureOutput({
      writeErr() {},
    });
    const team = program.command("team");
    const queue = registerTeamDistributedCommands(team, {
      logger: { log() {}, error() {} },
    });
    const init = queue.commands.find((command) => command.name() === "init");
    const status = queue.commands.find(
      (command) => command.name() === "status",
    );

    expect(init.options.map((option) => option.long)).not.toContain(
      "--queue-id",
    );
    expect(init.options.map((option) => option.long)).not.toContain(
      "--authority-digest",
    );
    expect(status.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--queue-id", "--authority-digest"]),
    );
    expect(() =>
      program.parse(
        [
          "team",
          "queue",
          "init",
          "--tasks",
          "tasks.json",
          "--state",
          "queue.json",
          "--run-id",
          "run-1",
          "--queue-id",
          "caller-queue",
        ],
        { from: "user" },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "commander.unknownOption" }),
    );
  });

  it("bridges a zero-device task graph only on affected Windows libuv", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      {
        key: "build",
        command: nodeWrite("result.txt", "done\n"),
      },
    ]);
    const runtimeFs = projectedFileSystem(fixture.graph, {
      dev: 0n,
    });

    const initialize = () =>
      initDistributedQueue(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "zero-device-graph",
          tasks: fixture.graph,
          maxTasks: 1,
        },
        { fileSystem: runtimeFs },
      );
    if (!isAffectedWindowsZeroDeviceStatRuntime()) {
      expect(initialize).toThrow(
        expect.objectContaining({ code: "TEAM_QUEUE_INPUT_RACE" }),
      );
      return;
    }
    expect(initialize()).toMatchObject({
      runId: "zero-device-graph",
      mode: "shell-worktree",
    });
  });

  it("pins queue and checkpoint authorities to canonical paths", () => {
    const fixture = makeRepo();
    const canonicalParent = path.join(fixture.root, "checkpoint-authority");
    const aliasParent = path.join(fixture.root, "checkpoint-authority-alias");
    fs.mkdirSync(canonicalParent);
    if (!createDirectoryAlias(canonicalParent, aliasParent)) return;
    const requestedCheckpointStateDir = path.join(aliasParent, "transactions");
    const canonicalCheckpointStateDir = path.join(
      fs.realpathSync.native(canonicalParent),
      "transactions",
    );
    const canonicalStatePath = path.join(
      fs.realpathSync.native(path.dirname(fixture.state)),
      path.basename(fixture.state),
    );
    writeGraph(fixture.graph, [
      {
        key: "canonical-authority",
        command: nodeWrite("canonical.txt", "canonical\n"),
      },
    ]);

    const initialized = initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "canonical-authority",
      tasks: fixture.graph,
      managedCheckpoint: true,
      checkpointStateDir: requestedCheckpointStateDir,
    });
    expect(initialized.statePath).toBe(canonicalStatePath);
    expect(initialized.authority.checkpoint.stateDir).toBe(
      canonicalCheckpointStateDir,
    );
    expect(initialized.checkpoint.stateDir).toBe(canonicalCheckpointStateDir);

    const status = distributedQueueStatus({
      state: fixture.state,
      repo: fixture.repo,
      runId: "canonical-authority",
      checkpointStateDir: requestedCheckpointStateDir,
    });
    expect(status.authority.checkpoint.stateDir).toBe(
      canonicalCheckpointStateDir,
    );
  });

  it.each([
    [SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT, "TEAM_QUEUE_INSECURE_INPUT"],
    [SECURE_FILE_IDENTITY_ERROR.PARENT_RACE, "TEAM_QUEUE_INPUT_RACE"],
  ])(
    "maps secure task-graph parent error %s to %s and preserves its cause",
    (secureCode, expectedCode) => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "build",
          command: nodeWrite("result.txt", "done\n"),
        },
      ]);
      const secureCause = new SecureFileIdentityError(
        secureCode,
        "secure parent rejected",
      );
      let failure;
      try {
        initDistributedQueue(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: `secure-parent-${secureCode}`,
            tasks: fixture.graph,
            maxTasks: 1,
          },
          {
            secureFileParent: () => {
              throw secureCause;
            },
          },
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        code: expectedCode,
        details: { secureFileIdentityCode: secureCode },
      });
      expect(failure.cause).toBe(secureCause);
    },
  );

  it("keeps the task-graph unavailable code for ordinary I/O failures", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      {
        key: "build",
        command: nodeWrite("result.txt", "done\n"),
      },
    ]);
    const ioFailure = Object.assign(new Error("device unavailable"), {
      code: "EIO",
    });

    expect(() =>
      initDistributedQueue(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "ordinary-io-parent",
          tasks: fixture.graph,
          maxTasks: 1,
        },
        {
          secureFileParent: () => {
            throw ioFailure;
          },
        },
      ),
    ).toThrow(
      expect.objectContaining({ code: "TEAM_QUEUE_INPUT_UNAVAILABLE" }),
    );
  });

  it("keeps draining from one queue revision when a peer claims between observations", async () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      {
        key: "interleaved",
        command: nodeWrite("interleaved.txt", "done\n"),
      },
    ]);
    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "atomic-drain-view",
      tasks: fixture.graph,
      maxTasks: 2,
    });

    let peerClaim = null;
    let claimableCountReads = 0;
    let runnerRuns = 0;
    const Queue = {
      open(options) {
        const queue = TeamDistributedQueue.open(options);
        return new Proxy(queue, {
          get(target, property) {
            if (property === "stats") {
              return (...args) => {
                const stats = target.stats(...args);
                if (peerClaim == null) {
                  expect(stats).toMatchObject({ claimable: 1, leased: 0 });
                  peerClaim = target.acquire("interleaved", {
                    holder: "interleaving-peer",
                    ttlMs: 60_000,
                  });
                  expect(peerClaim).toMatchObject({ ok: true });
                }
                return stats;
              };
            }
            if (property === "claimableCount") {
              return (...args) => {
                claimableCountReads += 1;
                return target.claimableCount(...args);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    class ControlledRunner {
      async run() {
        runnerRuns += 1;
        return {
          done: false,
          success: false,
          executions: runnerRuns === 1 ? 0 : 1,
          maxConcurrent: 0,
          requestedTeammates: 1,
          activeTeammates: 1,
          budgetStopped: false,
          budgetReason: null,
          members: [],
          messages: 0,
          stats: {},
        };
      }
    }

    const worker = await runDistributedWorker(
      {
        state: fixture.state,
        repo: fixture.repo,
        runId: "atomic-drain-view",
        workerId: "observing-worker",
        maxTasks: 1,
      },
      { Queue, Runner: ControlledRunner },
    );

    expect(peerClaim).toMatchObject({ ok: true });
    expect(claimableCountReads).toBe(0);
    expect(runnerRuns).toBe(2);
    expect(worker.summary).toMatchObject({
      executions: 1,
      rounds: 2,
    });
  });

  it(
    "restores durable wall elapsed time and aborts an active real runner claim",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const initialNow = 2_000_000_000_000;
      vi.setSystemTime(initialNow);
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "wall-active",
          command: nodeWrite("never-written.txt", "unexpected\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "wall-active",
        tasks: fixture.graph,
        maxTasks: 5,
        maxWallMs: 1_000,
      });

      const durableQueue = TeamDistributedQueue.open({
        filePath: fixture.state,
        runId: "wall-active",
      });
      const now = () => Date.now();
      const started = deferred();
      let activeSignal = null;
      let runnerBudget = null;
      let persistedStartedAt = null;
      const WorktreeCoordinator = lightweightWorktreeCoordinator(
        async ({ signal }) => {
          activeSignal = signal;
          started.resolve();
          return new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
      );
      const workerPromise = runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "wall-active",
          workerId: "wall-worker",
        },
        {
          WorktreeCoordinator,
          now,
          onRunner(runner) {
            // The initial queue view was still unused. Start the durable wall
            // clock from a peer after that view but before Runner.start(), then
            // advance partway through the cap. The adapter must refresh and use
            // this persisted start rather than its earlier observation.
            vi.setSystemTime(initialNow + 200);
            const seed = durableQueue.acquire("wall-active", {
              holder: "elapsed-seed",
            });
            expect(seed).toMatchObject({ ok: true });
            expect(
              durableQueue.release("wall-active", {
                holder: "elapsed-seed",
                leaseId: seed.lease.leaseId,
              }),
            ).toMatchObject({ ok: true });
            persistedStartedAt = durableQueue.stats().budget.startedAt;
            vi.setSystemTime(initialNow + 600);
            expect(runner).toBeInstanceOf(TeamRunner);
            runnerBudget = runner.budget;
          },
        },
      );
      await started.promise;

      expect(activeSignal.aborted).toBe(false);
      expect(runnerBudget).toBeTruthy();
      expect(runnerBudget.maxWallMs).toBe(1_000);
      expect(runnerBudget.status()).toMatchObject({
        maxTasks: null,
        maxWallMs: 1_000,
        reason: null,
      });
      expect(persistedStartedAt).toBe(initialNow + 200);
      expect(runnerBudget.status().elapsedMs).toBe(400);

      await vi.advanceTimersByTimeAsync(601);
      const worker = await workerPromise;
      expect(activeSignal.aborted).toBe(true);
      expect(worker.summary).toMatchObject({
        done: false,
        success: false,
        executions: 1,
        budgetStopped: true,
        budgetReason: "max-wall-ms",
        localBudgetReason: "max-wall-ms",
        durableBudgetReason: "max-wall-ms",
        stats: {
          completed: 0,
          leased: 0,
          budget: {
            reason: "max-wall-ms",
            reservations: 0,
          },
        },
      });
      expect(worker.queue.stats).toBe(worker.summary.stats);
      expect(worker.queue.stats.budget.startedAt).toBe(persistedStartedAt);
    },
  );

  it(
    "does not spend an unused durable wall cap while its refresh waits",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const initialNow = 2_100_000_000_000;
      vi.setSystemTime(initialNow);
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "wall-after-view",
          command: nodeWrite("wall-after-view.txt", "done\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "wall-after-view",
        tasks: fixture.graph,
        maxTasks: 5,
        maxWallMs: 1_000,
      });

      let delayedRefresh = false;
      const Queue = {
        open(options) {
          const queue = TeamDistributedQueue.open(options);
          return new Proxy(queue, {
            get(target, property) {
              if (property === "budgetStatus") {
                return (...args) => {
                  if (!delayedRefresh) {
                    delayedRefresh = true;
                    vi.setSystemTime(initialNow + 2_000);
                  }
                  return target.budgetStatus(...args);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
      const runTask = vi.fn(async () => ({ marker: "executed-after-view" }));

      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "wall-after-view",
          workerId: "wall-after-view-worker",
        },
        {
          Queue,
          WorktreeCoordinator: lightweightWorktreeCoordinator(runTask),
          now: () => Date.now(),
        },
      );

      expect(delayedRefresh).toBe(true);
      expect(runTask).toHaveBeenCalledOnce();
      expect(worker.summary).toMatchObject({
        done: true,
        success: true,
        executions: 1,
        budgetStopped: false,
        budgetReason: null,
        localBudgetReason: null,
        durableBudgetReason: null,
      });
      expect(worker.queue.stats.budget).toMatchObject({
        startedAt: initialNow + 2_000,
        reason: null,
        reservations: 0,
      });
    },
  );

  it(
    "does not execute when the durable wall budget expired before the first runner",
    { timeout: 30_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "wall-expired",
          command: nodeWrite("never-started.txt", "unexpected\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "wall-expired",
        tasks: fixture.graph,
        maxTasks: 5,
        maxWallMs: 100,
      });

      const durableQueue = TeamDistributedQueue.open({
        filePath: fixture.state,
        runId: "wall-expired",
      });
      const seed = durableQueue.acquire("wall-expired", {
        holder: "elapsed-seed",
      });
      expect(seed).toMatchObject({ ok: true });
      expect(
        durableQueue.release("wall-expired", {
          holder: "elapsed-seed",
          leaseId: seed.lease.leaseId,
        }),
      ).toMatchObject({ ok: true });

      const now = () => Date.now() + 150;
      const runTask = vi.fn(async () => ({ unexpected: true }));
      let runnerBudget = null;
      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "wall-expired",
          workerId: "expired-worker",
        },
        {
          Queue: {
            open(options) {
              return TeamDistributedQueue.open({ ...options, now });
            },
          },
          WorktreeCoordinator: lightweightWorktreeCoordinator(runTask),
          now,
          onRunner(runner) {
            expect(runner).toBeInstanceOf(TeamRunner);
            runnerBudget = runner.budget;
          },
        },
      );

      expect(runTask).not.toHaveBeenCalled();
      expect(runnerBudget.reason()).toBe("max-wall-ms");
      expect(worker.summary).toMatchObject({
        done: false,
        success: false,
        executions: 0,
        budgetStopped: true,
        budgetReason: "max-wall-ms",
        localBudgetReason: "max-wall-ms",
        durableBudgetReason: "max-wall-ms",
        stats: {
          completed: 0,
          leased: 0,
          budget: {
            reason: "max-wall-ms",
            reservations: 0,
          },
        },
      });
    },
  );

  it(
    "builds the final summary from one atomic status revision",
    { timeout: 30_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "atomic-summary",
          command: nodeWrite("atomic-summary.txt", "done\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "atomic-summary",
        tasks: fixture.graph,
        maxTasks: 2,
      });

      let allDoneReads = 0;
      let statusViewReads = 0;
      let statsReads = 0;
      let lateMutation = null;
      const Queue = {
        open(options) {
          const queue = TeamDistributedQueue.open(options);
          return new Proxy(queue, {
            get(target, property) {
              if (property === "allDone") {
                return () => {
                  allDoneReads += 1;
                  throw new Error(
                    "worker must derive terminal state from its atomic stats view",
                  );
                };
              }
              if (property === "stats") {
                return (...args) => {
                  statsReads += 1;
                  return target.stats(...args);
                };
              }
              if (property === "statusView") {
                return (...args) => {
                  statusViewReads += 1;
                  const view = target.statusView(...args);
                  lateMutation = target.addTask({
                    key: "late-peer-task",
                    title: "late peer task",
                    metadata: { command: "unused" },
                  });
                  return view;
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
      class CompletingRunner {
        constructor(registry) {
          this.registry = registry;
        }

        async run() {
          const key = this.registry.nextClaimable();
          const acquired = this.registry.acquire(key, {
            holder: "summary-runner",
          });
          expect(acquired).toMatchObject({ ok: true });
          expect(
            this.registry.complete(key, {
              holder: "summary-runner",
              leaseId: acquired.lease.leaseId,
              result: { marker: "atomic-status-view" },
            }),
          ).toMatchObject({ ok: true });
          return {
            done: true,
            success: true,
            executions: 1,
            maxConcurrent: 1,
            requestedTeammates: 1,
            activeTeammates: 1,
            budgetStopped: false,
            budgetReason: null,
            members: [],
            messages: 0,
            stats: this.registry.stats(),
          };
        }
      }

      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "atomic-summary",
          workerId: "summary-worker",
        },
        { Queue, Runner: CompletingRunner },
      );

      expect(lateMutation).toMatchObject({ ok: true });
      expect(allDoneReads).toBe(0);
      expect(statsReads).toBe(1);
      expect(statusViewReads).toBe(1);
      expect(worker.summary).toMatchObject({
        done: true,
        success: true,
        executions: 1,
        stats: {
          total: 1,
          completed: 1,
        },
      });
      expect(worker.summary.stats).toBe(worker.queue.stats);
      expect(worker.summary.stats.revision).toBe(worker.queue.revision);
      expect(worker.queue.stats.revision).toBe(worker.queue.revision);

      const nativeStatus = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "atomic-summary",
      });
      expect(nativeStatus.revision).toBeGreaterThan(worker.queue.revision);
      expect(nativeStatus.stats).toMatchObject({
        total: 2,
        completed: 1,
      });
      expect(nativeStatus.tasks.map((task) => task.key)).toContain(
        "late-peer-task",
      );
    },
  );

  it(
    "reports a peer-exhausted global task budget from the same queue status",
    { timeout: 30_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "peer-task", command: nodeWrite("peer.txt", "peer\n") },
        { key: "blocked-task", command: nodeWrite("blocked.txt", "blocked\n") },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "peer-budget",
        tasks: fixture.graph,
        maxTasks: 1,
      });

      const peerQueue = TeamDistributedQueue.open({
        filePath: fixture.state,
        runId: "peer-budget",
      });
      const acquired = peerQueue.acquire("peer-task", {
        holder: "budget-peer",
      });
      expect(acquired).toMatchObject({ ok: true });
      expect(
        peerQueue.complete("peer-task", {
          holder: "budget-peer",
          leaseId: acquired.lease.leaseId,
          result: { marker: "peer-completed" },
        }),
      ).toMatchObject({ ok: true });

      const runTask = vi.fn(async () => ({ unexpected: true }));
      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "peer-budget",
          workerId: "budget-observer",
        },
        {
          WorktreeCoordinator: lightweightWorktreeCoordinator(runTask),
        },
      );

      expect(runTask).not.toHaveBeenCalled();
      expect(worker.summary).toMatchObject({
        done: false,
        success: false,
        executions: 0,
        budgetStopped: true,
        budgetReason: "max-tasks",
        localBudgetReason: "max-tasks",
        durableBudgetReason: "max-tasks",
        stats: {
          total: 2,
          completed: 1,
          leased: 0,
          budget: {
            reason: "max-tasks",
            reservations: 0,
          },
        },
      });
      expect(worker.summary.stats).toBe(worker.queue.stats);
      expect(worker.summary.budgetReason).toBe(
        worker.queue.stats.budget.reason,
      );
      expect(worker.summary.stats.revision).toBe(worker.queue.revision);
    },
  );

  it(
    "runs a real two-process DAG, composes dependency baselines, and finalizes",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "left",
          command: nodeWrite("left.txt", "left\n", { delay: 250 }),
        },
        {
          key: "right",
          command: nodeWrite("right.txt", "right\n", { delay: 250 }),
        },
        {
          key: "join",
          dependsOn: ["left", "right"],
          command: nodeWrite("join.txt", "joined\n", {
            requireFiles: ["left.txt", "right.txt"],
          }),
        },
      ]);

      const initialized = initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        tasks: fixture.graph,
        maxTasks: 3,
      });
      expect(initialized).toMatchObject({
        runId: "real-dag",
        mode: "shell-worktree",
        budget: { maxTasks: 3 },
      });

      const workers = await Promise.all([
        spawnWorker({ ...fixture, runId: "real-dag", workerId: "worker-a" }),
        spawnWorker({ ...fixture, runId: "real-dag", workerId: "worker-b" }),
      ]);
      expect(
        workers.every((worker) => worker.code === 0),
        workers,
      ).toBe(true);
      expect(
        workers.reduce((total, worker) => total + worker.output.executions, 0),
      ).toBe(3);

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        queueId: initialized.queueId,
        authorityDigest: initialized.authorityDigest,
      });
      expect(
        status.stats,
        JSON.stringify(
          {
            workers: workers.map((worker) => worker.output),
            tasks: status.tasks,
          },
          null,
          2,
        ),
      ).toMatchObject({
        total: 3,
        completed: 3,
        leased: 0,
      });
      const join = status.tasks.find((task) => task.key === "join");
      expect(
        join.metadata.result.dependencyCommits.map((item) => item.key),
      ).toEqual(["left", "right"]);
      for (const dependency of join.metadata.result.dependencyCommits) {
        expect(
          git(
            fixture.repo,
            "merge-base",
            "--is-ancestor",
            dependency.commitOid,
            join.metadata.result.baselineCommitOid,
          ),
        ).toBe("");
      }

      expect(fs.existsSync(path.join(fixture.repo, "join.txt"))).toBe(false);

      const merged = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        merge: true,
      });
      expect(merged.preview.every((item) => item.clean)).toBe(true);
      expect(merged.integration.every((item) => item.clean)).toBe(true);
      expect(
        fs
          .readFileSync(path.join(fixture.repo, "join.txt"), "utf8")
          .replaceAll("\r\n", "\n"),
      ).toBe("joined\n");
    },
  );

  it(
    "routes a real worktree task through the canonical distributed Graph writer",
    { timeout: 60_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "canonical",
          command: nodeWrite("canonical.txt", "canonical\n"),
        },
      ]);
      const initialized = initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "canonical-distributed",
        tasks: fixture.graph,
        graphAuthority: "canonical",
      });
      expect(initialized.authority.graphAuthorityMode).toBe("canonical");

      const [writerProcess, worker] = await Promise.all([
        spawnGraphWriterCli({
          ...fixture,
          runId: "canonical-distributed",
        }),
        runDistributedWorker({
          state: fixture.state,
          repo: fixture.repo,
          runId: "canonical-distributed",
          graphAuthority: "canonical",
          workerId: "canonical-worker",
          graphTimeoutMs: 30_000,
          graphPollMs: 10,
        }),
      ]);

      expect(worker).toMatchObject({
        graphAuthorityMode: "canonical",
        summary: { success: true, executions: 1 },
      });
      expect(writerProcess.code, writerProcess).toBe(0);
      expect(writerProcess.output).toMatchObject({
        graphAuthorityMode: "canonical",
        processed: 2,
        graph: {
          status: "succeeded",
          authoritySource: "graph_kernel",
        },
        bridge: { pending: 0 },
      });
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "canonical-distributed",
        }).tasks[0],
      ).toMatchObject({
        status: "completed",
        metadata: { result: { commitOid: expect.any(String) } },
      });
    },
  );

  it(
    "does not enter the executor when the canonical Graph writer is absent",
    { timeout: 30_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "fenced", command: "must-not-execute" },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "canonical-writer-absent",
        tasks: fixture.graph,
        graphAuthority: "canonical",
      });
      const runTask = vi.fn(async () => ({ unexpected: true }));

      await expect(
        runDistributedWorker(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: "canonical-writer-absent",
            workerId: "fenced-worker",
            graphTimeoutMs: 20,
            graphPollMs: 1,
          },
          {
            WorktreeCoordinator: lightweightWorktreeCoordinator(runTask),
          },
        ),
      ).rejects.toMatchObject({
        code: "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_TIMEOUT",
      });

      expect(runTask).not.toHaveBeenCalled();
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "canonical-writer-absent",
        }).tasks[0].status,
      ).toBe("pending");
    },
  );

  it(
    "persists managed checkpoint running/final evidence with the worktree result",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(
        fixture.root,
        "workspace-checkpoints",
      );
      writeGraph(fixture.graph, [
        {
          key: "managed",
          command: nodeWrite("managed.txt", "managed\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
        tasks: fixture.graph,
        managedCheckpoint: true,
        checkpointStateDir,
      });
      const canonicalCheckpointStateDir = path.join(
        fs.realpathSync.native(fixture.root),
        path.basename(checkpointStateDir),
      );

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
        workerId: "managed-worker",
      });
      expect(worker.summary).toMatchObject({
        success: true,
        executions: 1,
      });

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
      });
      expect(status.authority.checkpoint).toEqual({
        enabled: true,
        stateDir: canonicalCheckpointStateDir,
        coverageTarget: "partial",
        writerIsolation: "unknown",
        externalSideEffects: true,
      });
      expect(status.tasks[0]).toMatchObject({
        status: "completed",
        metadata: {
          workspaceExecution: {
            phase: "completed",
            workerId: "managed-worker",
            checkpoint: {
              state: "committed",
              coverage: "partial",
              externalSideEffects: true,
              recoveryRequired: false,
            },
          },
          result: {
            workspaceCheckpoint: {
              state: "committed",
              coverage: "partial",
            },
          },
        },
      });
      expect(
        fs.readdirSync(path.join(checkpointStateDir, "transactions")),
      ).toHaveLength(1);
    },
  );

  it(
    "restores a rolled-back worktree from queue history before cross-process retry",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(fixture.root, "retry-checkpoints");
      const sentinel = path.join(fixture.root, "first-attempt");
      const source = `const fs=require('fs');const sentinel=${JSON.stringify(
        sentinel,
      )};if(!fs.existsSync(sentinel)){fs.writeFileSync(sentinel,'1');process.exit(7)}fs.writeFileSync('retried.txt','ok\\n')`;
      const command = `node -e "eval(Buffer.from('${Buffer.from(
        source,
      ).toString("base64")}','base64').toString())"`;
      writeGraph(fixture.graph, [{ key: "retry", command, retrySafe: true }]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        tasks: fixture.graph,
        maxTasks: 2,
        managedCheckpoint: true,
        checkpointStateDir,
      });

      const first = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        workerId: "retry-worker-one",
        maxTasks: 1,
      });
      expect(first.summary).toMatchObject({
        success: false,
        executions: 1,
      });
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "managed-retry",
        }).tasks[0],
      ).toMatchObject({
        status: "pending",
        metadata: {
          workspaceExecution: {
            phase: "rolled-back",
            checkpoint: { state: "rolled_back" },
          },
        },
      });

      const second = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        workerId: "retry-worker-two",
        maxTasks: 1,
      });

      expect(second.summary).toMatchObject({
        success: true,
        executions: 1,
      });
      const retried = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
      }).tasks[0];
      expect(retried).toMatchObject({
        status: "completed",
        metadata: {
          workspaceExecutionHistory: [
            {
              phase: "rolled-back",
              checkpoint: { state: "rolled_back" },
            },
          ],
          workspaceExecution: {
            phase: "completed",
            checkpoint: { state: "committed" },
          },
        },
      });
    },
  );

  it("interrupts only the exact durable lease/fence and preserves replay evidence", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      { key: "interrupt-me", command: nodeWrite("unused.txt", "unused\n") },
    ]);
    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "durable-interrupt",
      tasks: fixture.graph,
    });
    const queue = TeamDistributedQueue.open({
      filePath: fixture.state,
      runId: "durable-interrupt",
    });
    const claim = queue.claim({
      holder: "interrupt-worker",
      ttlMs: 30_000,
    });
    expect(claim).toMatchObject({ ok: true, key: "interrupt-me" });

    expect(() =>
      interruptDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "durable-interrupt",
        task: "interrupt-me",
        holder: "interrupt-worker",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken + 1,
        requestId: "stale-interrupt",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INTERRUPT_REJECTED" }),
    );

    const request = {
      state: fixture.state,
      repo: fixture.repo,
      runId: "durable-interrupt",
      task: "interrupt-me",
      holder: "interrupt-worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "exact-interrupt",
      actor: "operator@example.test",
      reason: "take over the exact running attempt",
    };
    const interrupted = interruptDistributedQueue(request);
    expect(interrupted).toMatchObject({
      ok: true,
      task: "interrupt-me",
      requestId: "exact-interrupt",
      evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(interruptDistributedQueue(request)).toMatchObject({
      ok: true,
      idempotent: true,
      requestId: "exact-interrupt",
    });
    expect(
      distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "durable-interrupt",
      }).interruptions,
    ).toEqual([
      expect.objectContaining({
        requestId: "exact-interrupt",
        evidenceDigest: interrupted.evidenceDigest,
      }),
    ]);

    const renewal = queue.renew("interrupt-me", {
      holder: "interrupt-worker",
      leaseId: claim.lease.leaseId,
      ttlMs: 30_000,
    });
    expect(renewal).toMatchObject({
      ok: false,
      reason: "interrupted",
      error: {
        code: "TEAM_TASK_HUMAN_INTERRUPTED",
        retryable: false,
        adjudication: {
          requestId: "exact-interrupt",
          evidenceDigest: interrupted.evidenceDigest,
        },
      },
    });
  });

  it(
    "recovers a dead Agent checkpoint, adjudicates retry, and continues under a new fence",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(
        fixture.root,
        "recovery-checkpoints",
      );
      const sentinel = path.join(fixture.root, "first-attempt");
      writeGraph(fixture.graph, [
        {
          key: "recover-agent",
          prompt: "perform deterministic recovery work",
          retrySafe: false,
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        tasks: fixture.graph,
        mode: "agent-worktree",
        managedCheckpoint: true,
        checkpointStateDir,
        model: "gpt-4o",
        maxTasks: 2,
      });

      const failed = await spawnRecoveryWorker({
        ...fixture,
        runId: "checkpoint-recovery-control",
        workerId: "dead-recovery-worker",
        sentinel,
      });
      expect(failed).toMatchObject({
        code: 0,
        output: {
          ok: true,
          success: false,
          executions: 1,
        },
      });
      expect(fs.existsSync(sentinel)).toBe(true);

      const blocked = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
      });
      expect(blocked.pendingAdjudications).toHaveLength(1);
      expect(blocked.tasks[0]).toMatchObject({
        status: "cancelled",
        metadata: {
          workspaceExecution: {
            phase: "rollback-recovery-required",
            checkpoint: { recoveryRequired: true },
          },
        },
      });
      const evidenceDigest = blocked.pendingAdjudications[0].evidenceDigest;
      const checkpointTransactionId =
        blocked.tasks[0].metadata.workspaceExecution.checkpoint.transactionId;
      class TerminalLockRecoveryBroker extends TeamProcessCheckpointBroker {
        recoverPending(options) {
          return super.recoverPending(options).map((entry) =>
            entry.id === checkpointTransactionId
              ? {
                  ...entry,
                  status: "terminal_lock_recovery_required",
                  manualRecoveryRequired: true,
                }
              : entry,
          );
        }
      }
      expect(() =>
        recoverDistributedQueueCheckpoint(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: "checkpoint-recovery-control",
            task: "recover-agent",
            recoveryId: "must-not-reconcile-terminal-lock",
            evidenceDigest,
            actor: "recovery-operator",
          },
          { CheckpointBroker: TerminalLockRecoveryBroker },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "TEAM_QUEUE_CHECKPOINT_RECOVERY_REQUIRED",
        }),
      );
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
        }).tasks[0].metadata.workspaceRecovery,
      ).toBeUndefined();

      const recovered = recoverDistributedQueueCheckpoint({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        task: "recover-agent",
        recoveryId: "recover-dead-checkpoint",
        evidenceDigest,
        actor: "recovery-operator",
        reason: "dead owner and settled execution were proven",
      });
      expect(recovered).toMatchObject({
        ok: true,
        task: "recover-agent",
        outcome: "rolled-back",
        execution: {
          phase: "rolled-back",
          worktree: {
            workspaceCheckpoint: {
              state: "rolled_back",
              recoveryRequired: false,
            },
          },
          checkpoint: {
            state: "rolled_back",
            recoveryRequired: false,
          },
        },
      });
      expect(
        fs.existsSync(
          path.join(recovered.execution.worktree.path, "must-rollback.txt"),
        ),
      ).toBe(false);

      const residualPath = path.join(
        recovered.execution.worktree.path,
        "residual-write.txt",
      );
      fs.writeFileSync(residualPath, "must block retry\n");
      expect(() =>
        adjudicateDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
          task: "recover-agent",
          decision: "retry",
          decisionId: "must-not-retry-dirty-worktree",
          evidenceDigest,
          actor: "recovery-operator",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "TEAM_QUEUE_RETRY_GIT_RECOVERY_REQUIRED",
        }),
      );
      fs.rmSync(residualPath);

      const adjudicated = adjudicateDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        task: "recover-agent",
        decision: "retry",
        decisionId: "retry-recovered-agent",
        evidenceDigest,
        actor: "recovery-operator",
        reason: "checkpoint rollback and Git baseline are settled",
      });
      expect(adjudicated).toMatchObject({
        ok: true,
        decision: "retry",
        status: "pending",
      });

      const retried = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
          workerId: "replacement-agent",
          maxTasks: 1,
        },
        {
          agentExecutor: async (_prompt, cwd) => {
            fs.writeFileSync(path.join(cwd, "recovered.txt"), "ok\n");
            return {
              usage: { input_tokens: 3, output_tokens: 1 },
              provider: "openai",
              model: "gpt-4o",
            };
          },
        },
      );
      expect(retried.summary, JSON.stringify(retried, null, 2)).toMatchObject({
        success: true,
        executions: 1,
      });
      const final = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
      });
      expect(final.tasks[0]).toMatchObject({
        status: "completed",
        metadata: {
          attempts: 1,
          workspaceExecutionHistory: [
            {
              phase: "rolled-back",
              checkpoint: { state: "rolled_back" },
            },
          ],
          workspaceExecution: {
            phase: "completed",
            checkpoint: { state: "committed" },
          },
        },
      });
    },
  );

  it("revalidates accepted Git evidence and replays an exact accept decision", () => {
    const fixture = makeRepo();
    const checkpointStateDir = path.join(fixture.root, "accept-checkpoints");
    writeGraph(fixture.graph, [
      {
        key: "accept-task",
        command: nodeWrite("unused.txt", "unused\n"),
        retrySafe: false,
      },
    ]);
    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "accept-control",
      tasks: fixture.graph,
      managedCheckpoint: true,
      checkpointStateDir,
    });
    const canonicalCheckpointStateDir = path.join(
      fs.realpathSync.native(fixture.root),
      path.basename(checkpointStateDir),
    );

    const baselineCommitOid = git(fixture.repo, "rev-parse", "HEAD");
    const branch = "team/accept-control/accept-task";
    const worktreePath = path.join(fixture.root, "accept-worktree");
    git(
      fixture.repo,
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      baselineCommitOid,
    );
    fs.writeFileSync(path.join(worktreePath, "accepted.txt"), "accepted\n");
    git(worktreePath, "add", "accepted.txt");
    git(worktreePath, "commit", "-m", "accepted task result");
    const verifiedCommitOid = git(worktreePath, "rev-parse", "HEAD");

    const alive = new Set([111, 222]);
    const workerQueue = new TeamDistributedQueue({
      filePath: fixture.state,
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const claim = workerQueue.acquire("accept-task", {
      holder: "crashed-accept-worker",
    });
    expect(claim).toMatchObject({ ok: true });
    const execution = (phase, state) => {
      const committed = state === "committed";
      return {
        workerId: "crashed-accept-worker",
        phase,
        verifiedCommitOid: ["validated", "committed"].includes(phase)
          ? verifiedCommitOid
          : null,
        worktree: {
          key: "accept-task",
          branch,
          path: worktreePath,
          committed: false,
          completed: false,
          commitOid: null,
          dependencyCommits: [],
          baselineCommitOid,
          managedLinks: [],
          workspaceCheckpoint: null,
        },
        checkpoint: {
          transactionId: "txn-accept-task",
          checkpointId: "checkpoint-txn-accept-task",
          runId: "accept-control",
          taskKey: "accept-task",
          workspaceRoot: worktreePath,
          stateDir: canonicalCheckpointStateDir,
          state,
          writerIsolation: "unknown",
          requestedCoverage: "partial",
          coverage: "partial",
          fileCoverage: "partial",
          externalSideEffects: true,
          uncoveredPaths: [".git", "@external-git-metadata"],
          checkpointDigest: `sha256:${"1".repeat(64)}`,
          writeManifestDigest: committed ? `sha256:${"2".repeat(64)}` : null,
          evidenceDigest: committed ? `sha256:${"3".repeat(64)}` : null,
          updatedAt: "2026-07-29T10:00:00.000Z",
          recoveryRequired: !committed,
          failureCode: null,
        },
      };
    };
    const record = (value) =>
      workerQueue.recordWorkspaceExecution("accept-task", {
        holder: claim.lease.holder,
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution: value,
      });
    expect(record(execution("prepared", "prepared"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("running", "running"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("validated", "running"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("committed", "committed"))).toMatchObject({
      ok: true,
    });
    alive.delete(111);
    const rescuer = new TeamDistributedQueue({
      filePath: fixture.state,
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = rescuer.pendingAdjudications();
    expect(pending).toHaveLength(1);
    const evidenceDigest = pending[0].evidenceDigest;
    const baseRequest = {
      state: fixture.state,
      repo: fixture.repo,
      runId: "accept-control",
      task: "accept-task",
      decision: "accept",
      decisionId: "accept-exact-worktree",
      evidenceDigest,
      actor: "operator@example.test",
      reason: "validated commit is the intended result",
    };

    const driftPath = path.join(worktreePath, "unreviewed.txt");
    fs.writeFileSync(driftPath, "drift\n");
    expect(() => adjudicateDistributedQueue(baseRequest)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_RECOVERY_GIT_DRIFT" }),
    );
    fs.rmSync(driftPath);

    const accepted = adjudicateDistributedQueue(baseRequest);
    expect(accepted).toMatchObject({
      ok: true,
      decision: "accept",
      status: "completed",
      acceptance: {
        verifiedCommitOid,
        branch,
      },
    });
    expect(adjudicateDistributedQueue(baseRequest)).toMatchObject({
      ok: true,
      idempotent: true,
      decision: "accept",
      status: "completed",
    });
    expect(() =>
      adjudicateDistributedQueue({
        ...baseRequest,
        actor: "different-operator@example.test",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_ADJUDICATION_REJECTED" }),
    );
  });

  it("pins state outside the repo and rejects another run authority", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      { key: "only", command: nodeWrite("only.txt", "ok\n") },
    ]);
    expect(() =>
      initDistributedQueue({
        state: path.join(fixture.repo, "queue.json"),
        repo: fixture.repo,
        runId: "inside",
        tasks: fixture.graph,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_QUEUE_STATE_INSIDE_REPOSITORY",
      }),
    );

    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "pinned",
      tasks: fixture.graph,
    });
    expect(() =>
      distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "wrong",
      }),
    ).toThrow();
  });

  it(
    "blocks workers and finalize when a crashed unsafe lease needs adjudication",
    { timeout: 60_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "unsafe",
          command: nodeWrite("unsafe.txt", "unknown\n"),
          retrySafe: false,
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        tasks: fixture.graph,
      });
      const crashed = await spawnWorker({
        ...fixture,
        runId: "unsafe-crash",
        workerId: "crashed-worker",
        mode: "crash",
      });
      expect(crashed).toMatchObject({
        code: 0,
        output: { ok: true, claim: { key: "unsafe" } },
      });

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
      });
      expect(status.pendingAdjudications).toHaveLength(1);
      expect(status.stats).toMatchObject({
        completed: 0,
        adjudicationRequired: 1,
      });

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        workerId: "safe-observer",
      });
      expect(worker.summary.executions).toBe(0);
      expect(worker.queue.pendingAdjudications).toHaveLength(1);
      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "unsafe-crash",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_FINALIZE_BLOCKED" }),
      );

      const evidenceDigest = status.pendingAdjudications[0].evidenceDigest;
      const request = {
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        task: "unsafe",
        decision: "cancel",
        decisionId: "cancel-unsafe-crash",
        evidenceDigest,
        actor: "operator@example.test",
        reason: "external effects cannot be proven safe",
      };
      expect(adjudicateDistributedQueue(request)).toMatchObject({
        ok: true,
        decision: "cancel",
        status: "cancelled",
      });
      expect(adjudicateDistributedQueue(request)).toMatchObject({
        ok: true,
        idempotent: true,
        decision: "cancel",
      });
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "unsafe-crash",
        }).pendingAdjudications,
      ).toHaveLength(0);
    },
  );

  it(
    "enforces the global queue budget and blocks incomplete finalization",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "one", command: nodeWrite("one.txt", "one\n") },
        { key: "two", command: nodeWrite("two.txt", "two\n") },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "budget",
        tasks: fixture.graph,
        maxTasks: 1,
      });

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "budget",
        workerId: "budget-worker",
      });
      expect(worker.queue.stats.completed).toBe(1);
      expect(worker.queue.stats.budget.reason).toBe("max-tasks");
      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "budget",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_FINALIZE_BLOCKED" }),
      );
    },
  );

  it(
    "fails closed on a real sequential merge conflict",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      fs.writeFileSync(path.join(fixture.repo, "shared.txt"), "base\n");
      git(fixture.repo, "add", "shared.txt");
      git(fixture.repo, "commit", "-m", "shared base");
      writeGraph(fixture.graph, [
        { key: "first", command: nodeWrite("shared.txt", "first\n") },
        { key: "second", command: nodeWrite("shared.txt", "second\n") },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "conflict",
        tasks: fixture.graph,
      });
      await Promise.all([
        spawnWorker({ ...fixture, runId: "conflict", workerId: "conflict-a" }),
        spawnWorker({ ...fixture, runId: "conflict", workerId: "conflict-b" }),
      ]);

      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "conflict",
          merge: true,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_INTEGRATION_CONFLICT" }),
      );
    },
  );
});
