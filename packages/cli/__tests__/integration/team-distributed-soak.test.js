import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(testDirectory, "../..");
const scriptPath = path.join(
  cliDirectory,
  "scripts",
  "team-distributed-soak.mjs",
);
const temporaryDirectories = [];
const activeSoakProcesses = new Map();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRunning(child) {
  return child.exitCode == null && child.signalCode == null;
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

function runShortSoak(outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
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
      ],
      {
        cwd: cliDirectory,
        detached: process.platform !== "win32",
        env: { ...process.env },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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

describe("distributed Agent Team production soak harness", () => {
  it(
    "passes a real Git/checkpoint/DAG/crash/finalize round without a live model",
    { timeout: 600_000 },
    async () => {
      const outputPath = temporaryOutput();
      const execution = await runShortSoak(outputPath);
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
          trackedWorktreeRequired: false,
          trackedWorktree: {
            available: true,
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
