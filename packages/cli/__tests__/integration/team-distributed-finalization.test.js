import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  finalizeDistributedQueue,
  initDistributedQueue,
} from "../../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";
import { TeamWorktreeCoordinator } from "../../src/lib/agent-team/team-worktree.js";

const temporaryDirectories = [];
let previousSandboxDisable;
const workerFixture = fileURLToPath(
  new URL("../fixtures/team-distributed-finalize-worker.mjs", import.meta.url),
);

function git(repo, ...args) {
  return String(
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  ).trim();
}

async function makeFixture(runId, { taskCount = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-finalize-git-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, "repo");
  const state = path.join(root, "queue.json");
  const graph = path.join(root, "tasks.json");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Finalization Test");
  git(repo, "config", "user.email", "finalization@example.invalid");
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-m", "base");
  fs.writeFileSync(
    graph,
    JSON.stringify({
      tasks: Array.from({ length: taskCount }, (_, index) => ({
        key: `task-${index + 1}`,
        command: "unused",
        retrySafe: true,
      })),
    }),
  );
  initDistributedQueue({
    state,
    repo,
    runId,
    tasks: graph,
  });

  const queue = TeamDistributedQueue.open({
    filePath: state,
    runId,
  });
  const coordinator = new TeamWorktreeCoordinator(repo, { runId });
  const execute = coordinator.makeRunTask({
    runInWorktree: async ({ cwd, key }) => {
      const suffix = taskCount === 1 ? "" : `-${key.slice("task-".length)}`;
      fs.writeFileSync(path.join(cwd, `result${suffix}.txt`), `${runId}\n`);
      return null;
    },
  });
  const results = [];
  for (let index = 0; index < taskCount; index += 1) {
    const key = `task-${index + 1}`;
    const claim = queue.claim({ holder: "fixture-worker" });
    expect(claim).toMatchObject({ ok: true, key });
    const result = await execute({
      key,
      task: queue.getTask(key),
      holder: "fixture-worker",
      renew: async () => ({ ok: true }),
      budget: { reason: () => null },
    });
    expect(
      queue.complete(key, {
        holder: "fixture-worker",
        leaseId: claim.lease.leaseId,
        result,
      }),
    ).toMatchObject({ ok: true });
    results.push(result);
  }
  return {
    root,
    repo,
    state,
    graph,
    runId,
    result: results[0],
    results,
  };
}

function runFinalizeChild(fixture, mode, finalizerId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        workerFixture,
        fixture.state,
        fixture.repo,
        fixture.runId,
        mode,
        finalizerId,
      ],
      {
        cwd: path.dirname(workerFixture),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      let output = null;
      const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
      if (line) {
        try {
          output = JSON.parse(line);
        } catch {
          output = null;
        }
      }
      resolve({ code, output, stdout, stderr });
    });
  });
}

function expectOnlyPrimaryWorktree(repo) {
  const worktrees = git(repo, "worktree", "list", "--porcelain")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "));
  expect(worktrees).toHaveLength(1);
  const actual = fs.realpathSync.native(
    path.resolve(worktrees[0].slice("worktree ".length)),
  );
  const expected = fs.realpathSync.native(repo);
  expect(process.platform === "win32" ? actual.toLowerCase() : actual).toBe(
    process.platform === "win32" ? expected.toLowerCase() : expected,
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

beforeAll(() => {
  // These tests isolate the durable Git/finalization protocol. Platform
  // sandbox acceptance remains in process-broker-platform-sandbox-live.test.js
  // and the default distributed CLI suite; do not make restricted-token
  // availability a prerequisite for exercising crash recovery here.
  previousSandboxDisable = process.env.CC_SANDBOX_DISABLE;
  process.env.CC_SANDBOX_DISABLE = "1";
});

afterAll(() => {
  if (previousSandboxDisable == null) {
    delete process.env.CC_SANDBOX_DISABLE;
  } else {
    process.env.CC_SANDBOX_DISABLE = previousSandboxDisable;
  }
});

describe("distributed finalization real Git recovery", () => {
  it(
    "completes cleanup and makes an exact finalize replay idempotent",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-complete");
      const preview = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        finalizerId: "primary-finalizer",
      });
      expect(preview.finalization).toMatchObject({
        phase: "previewed",
        mode: "preview",
        lease: null,
      });
      expect(fs.existsSync(path.join(fixture.repo, "result.txt"))).toBe(false);
      expect(fs.existsSync(fixture.result.worktreePath)).toBe(true);

      const result = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        merge: true,
        finalizerId: "primary-finalizer",
      });
      expect(result.finalization.phase).toBe("completed");
      expect(
        fs
          .readFileSync(path.join(fixture.repo, "result.txt"), "utf8")
          .replaceAll("\r\n", "\n"),
      ).toBe("finalize-complete\n");
      expect(fs.existsSync(fixture.result.worktreePath)).toBe(false);
      expectOnlyPrimaryWorktree(fixture.repo);

      const replay = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        merge: true,
        finalizerId: "primary-finalizer",
      });
      expect(replay).toMatchObject({
        idempotent: true,
        finalization: { phase: "completed" },
      });
      expect(git(fixture.repo, "rev-list", "--count", "HEAD")).toBe("2");
    },
  );

  it(
    "renews the fenced lease before, between, and after multi-worktree side effects",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-heartbeat", {
        taskCount: 3,
      });
      const progress = [];
      const Queue = {
        open(options) {
          const queue = TeamDistributedQueue.open(options);
          const renew = queue.renewFinalization.bind(queue);
          queue.renewFinalization = (request) => {
            progress.push(request.progress || null);
            return renew(request);
          };
          return queue;
        },
      };

      const result = finalizeDistributedQueue(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: fixture.runId,
          merge: true,
          finalizerId: "heartbeat-finalizer",
          ttlMs: 5_000,
        },
        { Queue },
      );

      expect(result.finalization).toMatchObject({
        phase: "completed",
        lease: null,
      });
      expect(
        progress.filter(
          (event) => event?.phase === "previewing" && event.timing === "start",
        ),
      ).toHaveLength(1);
      expect(
        progress.filter(
          (event) => event?.phase === "merging" && event.timing === "start",
        ),
      ).toHaveLength(1);
      expect(
        progress.filter(
          (event) => event?.phase === "integrate" && event.timing === "before",
        ),
      ).toHaveLength(6);
      expect(
        progress.filter(
          (event) => event?.phase === "integrate" && event.timing === "after",
        ),
      ).toHaveLength(6);
      expect(
        progress.filter(
          (event) =>
            event?.phase === "prepare-cleanup" && event.timing === "before",
        ),
      ).toHaveLength(3);
      expect(
        progress.filter(
          (event) => event?.phase === "cleanup" && event.timing === "after",
        ),
      ).toHaveLength(3);
      expectOnlyPrimaryWorktree(fixture.repo);
    },
  );

  it(
    "takes over and resumes after a process dies immediately after Git merge",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-kill-merge", {
        taskCount: 2,
      });
      const killed = await runFinalizeChild(
        fixture,
        "kill-merge",
        "dead-merge-finalizer",
      );
      expect(killed.code, killed.stderr || killed.stdout).toBe(86);
      expect(
        TeamDistributedQueue.open({
          filePath: fixture.state,
          runId: fixture.runId,
        }).getFinalization(),
      ).toMatchObject({
        phase: "merging",
        intent: { kind: "merge" },
      });

      const recovered = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        merge: true,
        finalizerId: "merge-recovery-finalizer",
      });
      expect(recovered.finalization).toMatchObject({
        phase: "completed",
        recovery: null,
      });
      for (const index of [1, 2]) {
        expect(
          fs
            .readFileSync(
              path.join(fixture.repo, `result-${index}.txt`),
              "utf8",
            )
            .replaceAll("\r\n", "\n"),
        ).toBe("finalize-kill-merge\n");
      }
      expect(git(fixture.repo, "rev-list", "--count", "HEAD")).toBe("4");
      expectOnlyPrimaryWorktree(fixture.repo);
    },
  );

  it(
    "resumes cleanup from durable preparation after the deleting process dies",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-kill-cleanup");
      const killed = await runFinalizeChild(
        fixture,
        "kill-cleanup",
        "dead-cleanup-finalizer",
      );
      expect(killed.code, killed.stderr || killed.stdout).toBe(87);
      expect(fs.existsSync(fixture.result.worktreePath)).toBe(false);
      expect(
        TeamDistributedQueue.open({
          filePath: fixture.state,
          runId: fixture.runId,
        }).getFinalization(),
      ).toMatchObject({
        phase: "cleaning",
        intent: { kind: "cleanup" },
        coordinator: {
          records: [{ cleanupPrepared: true, cleaned: false }],
        },
      });

      const recovered = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        merge: true,
        finalizerId: "cleanup-recovery-finalizer",
      });
      expect(recovered.finalization).toMatchObject({
        phase: "completed",
        coordinator: {
          records: [{ cleanupPrepared: true, cleaned: true }],
        },
      });
      expectOnlyPrimaryWorktree(fixture.repo);
    },
  );

  it(
    "allows only one live finalizer across competing processes",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-concurrent");
      const slow = runFinalizeChild(fixture, "slow", "slow-live-finalizer");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const competitor = await runFinalizeChild(
        fixture,
        "normal",
        "competing-finalizer",
      );
      const winner = await slow;
      expect(winner).toMatchObject({
        code: 0,
        output: { ok: true, phase: "completed" },
      });
      expect(competitor).toMatchObject({
        code: 2,
        output: { ok: false, code: "TEAM_QUEUE_FINALIZE_BUSY" },
      });
      expectOnlyPrimaryWorktree(fixture.repo);
      expect(git(fixture.repo, "rev-list", "--count", "HEAD")).toBe("2");
    },
  );

  it(
    "fails closed when base HEAD drifts after the durable preview",
    { timeout: 60_000 },
    async () => {
      const fixture = await makeFixture("finalize-head-drift");
      const preview = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: fixture.runId,
        finalizerId: "drift-finalizer",
      });
      expect(preview.finalization.phase).toBe("previewed");

      fs.writeFileSync(path.join(fixture.repo, "external.txt"), "external\n");
      git(fixture.repo, "add", "external.txt");
      git(fixture.repo, "commit", "-m", "unrelated external commit");
      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: fixture.runId,
          merge: true,
          finalizerId: "drift-finalizer",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_FINALIZE_GIT_DRIFT" }),
      );
      expect(
        TeamDistributedQueue.open({
          filePath: fixture.state,
          runId: fixture.runId,
        }).getFinalization(),
      ).toMatchObject({
        phase: "blocked",
        blocked: { code: "TEAM_QUEUE_FINALIZE_GIT_DRIFT" },
      });
      expect(fs.existsSync(fixture.result.worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(fixture.repo, "result.txt"))).toBe(false);
    },
  );
});
