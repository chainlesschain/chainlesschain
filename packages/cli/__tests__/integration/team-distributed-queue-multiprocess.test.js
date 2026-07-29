import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(
  testDirectory,
  "../fixtures/team-distributed-queue-worker.mjs",
);
const temporaryDirectories = [];

function tempState() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-distributed-mp-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "queue.json");
}

function runWorker(filePath, mode, holder, extraArguments = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerPath, filePath, mode, holder, ...extraArguments],
      {
        cwd: path.resolve(testDirectory, "../.."),
        env: { ...process.env },
        shell: false,
        windowsHide: true,
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
    child.on("close", (code, signal) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      let message = null;
      try {
        message = lines.length > 0 ? JSON.parse(lines.at(-1)) : null;
      } catch (error) {
        reject(
          new Error(`worker returned invalid JSON: ${stdout}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve({ code, signal, stdout, stderr, message });
    });
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TeamDistributedQueue real multi-process integration", () => {
  it(
    "lets six real processes compete without duplicate valid holders",
    { timeout: 60_000 },
    async () => {
      const filePath = tempState();
      const leafTasks = Array.from({ length: 24 }, (_, index) => ({
        key: `leaf-${index}`,
        title: `Leaf ${index}`,
      }));
      TeamDistributedQueue.create({
        filePath,
        authority: { runId: "multiprocess-race" },
        budget: { maxTasks: 25 },
        tasks: [
          ...leafTasks,
          {
            key: "join",
            title: "Join",
            dependsOn: leafTasks.map((task) => task.key),
          },
        ],
      });

      const workers = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          runWorker(filePath, "compete", `worker-${index}`),
        ),
      );
      for (const worker of workers) {
        expect(worker, worker.stderr).toMatchObject({
          code: 0,
          signal: null,
          message: { allDone: true },
        });
      }
      const completed = workers.flatMap(
        (worker) => worker.message.completed || [],
      );
      expect(completed).toHaveLength(25);
      expect(new Set(completed).size).toBe(25);
      expect(completed).toContain("join");

      const queue = new TeamDistributedQueue({ filePath });
      expect(queue.allDone()).toBe(true);
      expect(queue.stats()).toMatchObject({
        total: 25,
        completed: 25,
        leased: 0,
        budget: {
          tasksStarted: 25,
          tasksSettled: 25,
          reservations: 0,
        },
      });
      for (const task of queue.list()) {
        expect(task.metadata.result.completedByPid).toBeGreaterThan(0);
      }
    },
  );

  it(
    "survives repeated worker crashes and fences every abandoned lease",
    { timeout: 60_000 },
    async () => {
      const filePath = tempState();
      TeamDistributedQueue.create({
        filePath,
        authority: { runId: "fault-recovery-soak" },
        budget: { maxTasks: 6 },
        defaultTtlMs: 60_000,
        tasks: [
          {
            key: "recoverable",
            title: "Recoverable",
            metadata: { retrySafe: true },
          },
        ],
      });

      const abandoned = [];
      for (let index = 0; index < 5; index += 1) {
        const crashed = await runWorker(
          filePath,
          "crash",
          `crashed-worker-${index}`,
        );
        expect(crashed, crashed.stderr).toMatchObject({
          code: 0,
          message: { claim: { ok: true, key: "recoverable" } },
        });
        abandoned.push(crashed.message.claim.lease);
      }
      expect(abandoned.map((lease) => lease.fencingToken)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(new Set(abandoned.map((lease) => lease.leaseId)).size).toBe(5);

      const rescued = await runWorker(filePath, "rescue", "final-rescuer");
      expect(rescued, rescued.stderr).toMatchObject({
        code: 0,
        message: {
          claim: {
            ok: true,
            key: "recoverable",
            lease: { fencingToken: 6 },
          },
          settled: { ok: true },
        },
      });

      const queue = new TeamDistributedQueue({ filePath });
      for (const lease of abandoned) {
        expect(
          queue.complete("recoverable", {
            holder: lease.holder,
            leaseId: lease.leaseId,
          }),
        ).toMatchObject({ ok: false });
      }
      expect(queue.getTask("recoverable")).toMatchObject({
        status: "completed",
        metadata: {
          result: {
            completedByPid: rescued.message.pid,
          },
        },
      });
      expect(queue.budgetStatus()).toMatchObject({
        tasksStarted: 6,
        tasksSettled: 1,
        reservations: 0,
        reason: "max-tasks",
      });
    },
  );

  it(
    "does not replay an unknown side effect after a real worker crash",
    { timeout: 30_000 },
    async () => {
      const filePath = tempState();
      TeamDistributedQueue.create({
        filePath,
        authority: { runId: "unsafe-crash-adjudication" },
        budget: { maxTasks: 1 },
        defaultTtlMs: 60_000,
        tasks: [
          {
            key: "external-write",
            title: "External write",
            metadata: { retrySafe: false },
          },
        ],
      });

      const crashed = await runWorker(
        filePath,
        "crash",
        "unsafe-crashed-worker",
      );
      expect(crashed, crashed.stderr).toMatchObject({
        code: 0,
        signal: null,
        message: {
          claim: {
            ok: true,
            key: "external-write",
            lease: { fencingToken: 1 },
          },
        },
      });

      const refused = await runWorker(
        filePath,
        "rescue",
        "unsafe-must-not-replay",
      );
      expect(refused, refused.stderr).toMatchObject({
        code: 2,
        signal: null,
        message: {
          claim: {
            ok: false,
            reason: "no_claimable_task",
          },
        },
      });

      const queue = new TeamDistributedQueue({ filePath });
      expect(queue.getTask("external-write")).toMatchObject({
        status: "cancelled",
        lease: null,
        metadata: {
          adjudication: {
            required: true,
            code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
          },
          abandonedLeaseEvidence: {
            reason: "owner-dead",
            lease: {
              holder: "unsafe-crashed-worker",
              fencingToken: 1,
              ownerPid: crashed.message.pid,
            },
          },
        },
      });
      expect(queue.stats()).toMatchObject({
        adjudicationRequired: 1,
        budget: {
          tasksStarted: 1,
          tasksSettled: 0,
          reservations: 0,
        },
      });
      expect(queue.allDone()).toBe(false);
    },
  );

  it(
    "serializes exact and conflicting adjudication races without extra revisions",
    { timeout: 60_000 },
    async () => {
      const exactPath = tempState();
      TeamDistributedQueue.create({
        filePath: exactPath,
        authority: { runId: "multiprocess-exact-adjudication" },
        budget: { maxTasks: 1 },
        defaultTtlMs: 60_000,
        tasks: [
          {
            key: "unsafe",
            title: "Unsafe",
            metadata: { retrySafe: false },
          },
        ],
      });
      const exactCrash = await runWorker(
        exactPath,
        "crash",
        "exact-crashed-worker",
      );
      expect(exactCrash.message.claim.ok).toBe(true);
      const exactQueue = new TeamDistributedQueue({ filePath: exactPath });
      const exactPending = exactQueue.pendingAdjudications()[0];
      const exactRevision = exactQueue.snapshot().revision;
      const exactContenders = await Promise.all([
        runWorker(exactPath, "adjudicate", "operator", [
          "unsafe",
          "cancel",
          "shared-decision-id",
          exactPending.evidenceDigest,
        ]),
        runWorker(exactPath, "adjudicate", "operator", [
          "unsafe",
          "cancel",
          "shared-decision-id",
          exactPending.evidenceDigest,
        ]),
      ]);
      expect(exactContenders.every((worker) => worker.code === 0)).toBe(true);
      expect(
        exactContenders.map((worker) => worker.message.resolved.ok),
      ).toEqual([true, true]);
      expect(
        exactContenders.filter(
          (worker) => worker.message.resolved.idempotent === true,
        ),
      ).toHaveLength(1);
      expect(exactQueue.snapshot().revision).toBe(exactRevision + 1);

      const conflictingPath = tempState();
      TeamDistributedQueue.create({
        filePath: conflictingPath,
        authority: { runId: "multiprocess-conflicting-adjudication" },
        budget: { maxTasks: 1 },
        defaultTtlMs: 60_000,
        tasks: [
          {
            key: "unsafe",
            title: "Unsafe",
            metadata: { retrySafe: false },
          },
        ],
      });
      const conflictingCrash = await runWorker(
        conflictingPath,
        "crash",
        "conflicting-crashed-worker",
      );
      expect(conflictingCrash.message.claim.ok).toBe(true);
      const conflictingQueue = new TeamDistributedQueue({
        filePath: conflictingPath,
      });
      const conflictingPending = conflictingQueue.pendingAdjudications()[0];
      const conflictingRevision = conflictingQueue.snapshot().revision;
      const conflictingContenders = await Promise.all([
        runWorker(conflictingPath, "adjudicate", "operator", [
          "unsafe",
          "cancel",
          "decision-a",
          conflictingPending.evidenceDigest,
        ]),
        runWorker(conflictingPath, "adjudicate", "operator", [
          "unsafe",
          "cancel",
          "decision-b",
          conflictingPending.evidenceDigest,
        ]),
      ]);
      expect(
        conflictingContenders.filter((worker) => worker.message.resolved.ok),
      ).toHaveLength(1);
      expect(
        conflictingContenders.filter(
          (worker) =>
            worker.message.resolved.reason === "adjudication_not_required",
        ),
      ).toHaveLength(1);
      expect(conflictingQueue.snapshot().revision).toBe(
        conflictingRevision + 1,
      );
    },
  );

  it(
    "does not oversell token or USD reservations across real processes",
    { timeout: 30_000 },
    async () => {
      const filePath = tempState();
      TeamDistributedQueue.create({
        filePath,
        authority: { runId: "multiprocess-budget" },
        budget: { maxTasks: 2, maxTokens: 10, maxUsd: 1 },
        tasks: [
          { key: "a", title: "A" },
          { key: "b", title: "B" },
        ],
      });

      const contenders = await Promise.all([
        runWorker(filePath, "budget-claim", "budget-a", ["6", "0.6", "150"]),
        runWorker(filePath, "budget-claim", "budget-b", ["6", "0.6", "150"]),
      ]);
      expect(contenders.every((worker) => worker.code === 0)).toBe(true);
      const successful = contenders.filter((worker) => worker.message.claim.ok);
      const refused = contenders.filter((worker) => !worker.message.claim.ok);
      expect(successful).toHaveLength(1);
      expect(successful[0].message.settled).toMatchObject({ ok: true });
      expect(refused).toHaveLength(1);
      expect(["max-tokens", "max-usd"]).toContain(
        refused[0].message.claim.reason,
      );

      const queue = new TeamDistributedQueue({ filePath });
      expect(queue.budgetStatus()).toMatchObject({
        tasksStarted: 1,
        tasksSettled: 1,
        tokens: 6,
        spentUsd: 0.6,
        reservedTokens: 0,
        reservedUsd: 0,
      });
      const final = queue.claim({
        holder: "budget-final",
        maxTokens: 4,
        maxUsd: 0.4,
      });
      expect(final.ok).toBe(true);
      expect(
        queue.complete(final.key, {
          holder: "budget-final",
          leaseId: final.lease.leaseId,
          usage: { input_tokens: 4, output_tokens: 0 },
          costUsd: 0.4,
        }),
      ).toMatchObject({ ok: true });
      expect(queue.budgetStatus()).toMatchObject({
        tasksStarted: 2,
        tasksSettled: 2,
        tokens: 10,
        spentUsd: 1,
        reason: "max-tasks",
      });
    },
  );
});
