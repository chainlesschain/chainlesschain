import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  distributedQueueStatus,
  finalizeDistributedQueue,
  initDistributedQueue,
  runDistributedWorker,
} from "../../src/commands/team-distributed.js";

const temporaryDirectories = [];

function git(repo, ...args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-agent-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, "repo");
  const authority = path.join(root, "authority");
  fs.mkdirSync(repo);
  fs.mkdirSync(authority, { mode: 0o700 });
  git(repo, "init");
  git(repo, "config", "user.name", "Distributed Agent Test");
  git(repo, "config", "user.email", "agent-test@example.invalid");
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "base");
  return {
    root,
    repo,
    state: path.join(authority, "queue.json"),
    graph: path.join(authority, "tasks.json"),
    checkpointStateDir: path.join(authority, "checkpoints"),
  };
}

function writeGraph(location, tasks) {
  fs.writeFileSync(location, `${JSON.stringify({ tasks }, null, 2)}\n`, {
    mode: 0o600,
  });
}

function agentInit(fixture, overrides = {}) {
  return initDistributedQueue({
    state: fixture.state,
    repo: fixture.repo,
    runId: "agent-run",
    tasks: fixture.graph,
    mode: "agent-worktree",
    managedCheckpoint: true,
    checkpointStateDir: fixture.checkpointStateDir,
    ...overrides,
  });
}

function pricedUsage(input = 10, output = 5, cacheRead = 0, cacheCreation = 0) {
  const usage = {
    input_tokens: input,
    output_tokens: output,
    ...(cacheRead > 0 ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheCreation > 0
      ? { cache_creation_input_tokens: cacheCreation }
      : {}),
  };
  return {
    usage,
    provider: "openai",
    model: "gpt-4o",
    usageRecords: [{ provider: "openai", model: "gpt-4o", usage }],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("team distributed native Agent workers", () => {
  it("fails closed on unsupported Agent graph/options and missing checkpoint authority", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [{ key: "task", prompt: "Implement it" }]);
    expect(() =>
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "missing-checkpoint",
        tasks: fixture.graph,
        mode: "agent-worktree",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_CHECKPOINT_REQUIRED" }),
    );

    writeGraph(fixture.graph, [
      {
        key: "task",
        prompt: "Implement it",
        agent: { permissionMode: "invented" },
      },
    ]);
    expect(() => agentInit(fixture)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_GRAPH" }),
    );

    writeGraph(fixture.graph, [
      {
        key: "task",
        prompt: "Implement it",
        policy: { checkpointRequired: false },
      },
    ]);
    expect(() => agentInit(fixture)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_GRAPH" }),
    );

    writeGraph(fixture.graph, [
      { key: "task", prompt: "Implement it", unexpectedAgentFlag: true },
    ]);
    expect(() => agentInit(fixture)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_GRAPH" }),
    );

    writeGraph(fixture.graph, [{ key: "task", prompt: "   " }]);
    expect(() => agentInit(fixture)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_GRAPH" }),
    );
  });

  it(
    "executes in a managed worktree and binds prompt, usage, Git, and checkpoint evidence",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "agent-task",
          prompt: "write agent-result.txt",
          retrySafe: true,
        },
      ]);
      const initialized = agentInit(fixture, {
        maxTokens: 100,
        maxUsd: 1,
        model: "gpt-4o",
        permissionMode: "acceptEdits",
        agentMaxTurns: 4,
      });
      expect(initialized).toMatchObject({
        mode: "agent-worktree",
        authority: {
          mode: "agent-worktree",
          checkpoint: { enabled: true },
          agent: {
            model: "gpt-4o",
            maxTurns: 4,
            maxTokens: 100,
            maxBudgetUsd: 1,
            checkpointRequired: true,
            worktreeRequired: true,
          },
        },
      });

      const calls = [];
      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "agent-run",
          workerId: "native-agent",
          agent: true,
        },
        {
          buildAgentPrompt: (prompt) => `trusted-wrapper\n${prompt}`,
          agentExecutor: async (prompt, cwd, options) => {
            calls.push({ prompt, cwd, options });
            fs.writeFileSync(path.join(cwd, "agent-result.txt"), "agent\n");
            return pricedUsage(10, 5, 4, 3);
          },
        },
      );
      expect(worker.summary).toMatchObject({
        success: true,
        executions: 1,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        prompt: "trusted-wrapper\nwrite agent-result.txt",
        options: {
          model: "gpt-4o",
          maxTurns: 4,
          maxTokens: 100,
          maxBudgetUsd: 1,
          checkpointRequired: false,
          worktreeRequired: true,
          managedCheckpoint: true,
        },
      });
      expect(calls[0].cwd).not.toBe(fixture.repo);

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
        mode: "agent-worktree",
      });
      expect(status.stats.budget.tokens).toBe(22);
      expect(status.stats.budget.spentUsd).toBeGreaterThan(0);
      expect(status.stats.budget.spentUsd).toBeLessThan(1);
      expect(status.tasks[0]).toMatchObject({
        status: "completed",
        metadata: {
          workspaceExecution: {
            phase: "completed",
            checkpoint: { state: "committed" },
          },
          result: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 4,
              cache_creation_input_tokens: 3,
            },
            provider: "openai",
            model: "gpt-4o",
            workspaceCheckpoint: { state: "committed" },
            agentExecution: {
              version: 1,
              mode: "agent-worktree",
              taskKey: "agent-task",
              workerId: "native-agent",
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                cache_read_input_tokens: 4,
                cache_creation_input_tokens: 3,
              },
              usageRecords: [
                {
                  provider: "openai",
                  model: "gpt-4o",
                  usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    cache_read_input_tokens: 4,
                    cache_creation_input_tokens: 3,
                  },
                },
              ],
              provider: "openai",
              model: "gpt-4o",
            },
          },
        },
      });
      const result = status.tasks[0].metadata.result;
      expect(result.agentExecution.commitOid).toBe(result.commitOid);
      expect(result.agentExecution.checkpointTransactionId).toBe(
        result.workspaceCheckpoint.transactionId,
      );
      expect(result.agentExecution.checkpointEvidenceDigest).toBe(
        result.workspaceCheckpoint.evidenceDigest,
      );
      expect(result.agentExecution.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.costUsd).toBe(status.stats.budget.spentUsd);

      const preview = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
        mode: "agent-worktree",
      });
      expect(preview.preview).toEqual([
        expect.objectContaining({ key: "agent-task", clean: true }),
      ]);
      const finalized = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
        mode: "agent-worktree",
        merge: true,
      });
      expect(finalized.integration).toEqual([
        expect.objectContaining({ key: "agent-task", clean: true }),
      ]);
      expect(
        fs
          .readFileSync(path.join(fixture.repo, "agent-result.txt"), "utf8")
          .replaceAll("\r\n", "\n"),
      ).toBe("agent\n");
    },
  );

  it(
    "lets competing workers claim distinct Agent tasks exactly once",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "left", prompt: "left", retrySafe: true },
        { key: "right", prompt: "right", retrySafe: true },
      ]);
      agentInit(fixture, { maxTasks: 2 });
      const calls = [];
      const agentExecutor = async (prompt, cwd) => {
        calls.push({ prompt, cwd });
        await new Promise((resolve) => setTimeout(resolve, 25));
        fs.writeFileSync(path.join(cwd, `${prompt}.txt`), `${prompt}\n`);
        return pricedUsage(2, 1);
      };

      const workers = await Promise.all([
        runDistributedWorker(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: "agent-run",
            workerId: "agent-a",
            maxTasks: 1,
          },
          { agentExecutor },
        ),
        runDistributedWorker(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: "agent-run",
            workerId: "agent-b",
            maxTasks: 1,
          },
          { agentExecutor },
        ),
      ]);
      expect(
        workers.reduce((total, worker) => total + worker.summary.executions, 0),
      ).toBe(2);
      expect(calls.map((call) => call.prompt).sort()).toEqual([
        "left",
        "right",
      ]);
      expect(new Set(calls.map((call) => call.cwd)).size).toBe(2);
      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
      });
      expect(status.stats).toMatchObject({
        total: 2,
        completed: 2,
        leased: 0,
      });
      expect(
        status.tasks.every(
          (task) =>
            task.metadata.workspaceExecution.checkpoint.state === "committed",
        ),
      ).toBe(true);
    },
  );

  it(
    "rolls back and refuses a budgeted Agent result with missing usage",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "unmetered", prompt: "unmetered", retrySafe: true },
      ]);
      agentInit(fixture, { maxTokens: 10 });
      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "agent-run",
          workerId: "unmetered-worker",
        },
        {
          agentExecutor: async (_prompt, cwd) => {
            fs.writeFileSync(path.join(cwd, "must-rollback.txt"), "unsafe\n");
            return { provider: "openai", model: "gpt-4o" };
          },
        },
      );
      expect(worker.summary).toMatchObject({
        success: false,
        executions: 1,
      });
      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
      });
      expect(status.stats.budget.tokens).toBe(10);
      expect(status.tasks[0]).toMatchObject({
        status: "cancelled",
        metadata: {
          workspaceExecution: {
            phase: "rolled-back",
            checkpoint: { state: "rolled_back" },
          },
        },
      });
      expect(
        worker.events.some(
          (event) =>
            event.type === "task:failed" &&
            event.error.includes("no accountable usage"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            status.tasks[0].metadata.workspaceExecution.worktree.path,
            "must-rollback.txt",
          ),
        ),
      ).toBe(false);
    },
  );

  it(
    "charges a failed Agent attempt, rolls it back, and retries under a new fence",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "retry", prompt: "retry", retrySafe: true },
      ]);
      agentInit(fixture, { maxTasks: 2, maxTokens: 20, maxUsd: 1 });
      let attempts = 0;
      const worker = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "agent-run",
          workerId: "retry-worker",
        },
        {
          agentExecutor: async (_prompt, cwd) => {
            attempts += 1;
            fs.writeFileSync(
              path.join(cwd, attempts === 1 ? "failed.txt" : "retried.txt"),
              `${attempts}\n`,
            );
            if (attempts === 1) {
              const error = new Error("deterministic first-attempt failure");
              Object.assign(error, pricedUsage(2, 1));
              throw error;
            }
            return pricedUsage(2, 1);
          },
        },
      );
      expect(worker.summary).toMatchObject({
        success: true,
        executions: 2,
      });
      expect(attempts).toBe(2);
      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "agent-run",
      });
      expect(status.stats.budget.tokens).toBe(6);
      expect(status.tasks[0]).toMatchObject({
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
      expect(
        status.tasks[0].metadata.workspaceExecution.lease.fencingToken,
      ).toBeGreaterThan(
        status.tasks[0].metadata.workspaceExecutionHistory[0].lease
          .fencingToken,
      );
      const result = status.tasks[0].metadata.result;
      expect(fs.existsSync(path.join(result.worktreePath, "failed.txt"))).toBe(
        false,
      );
      expect(
        fs
          .readFileSync(path.join(result.worktreePath, "retried.txt"), "utf8")
          .trim(),
      ).toBe("2");
    },
  );

  it(
    "rejects unpriced USD usage and honors exact-fence human cancellation",
    { timeout: 120_000 },
    async () => {
      const unpriced = makeRepo();
      writeGraph(unpriced.graph, [
        { key: "unpriced", prompt: "unpriced", retrySafe: true },
      ]);
      agentInit(unpriced, { maxUsd: 0.25 });
      await runDistributedWorker(
        {
          state: unpriced.state,
          repo: unpriced.repo,
          runId: "agent-run",
          workerId: "unpriced-worker",
        },
        {
          agentExecutor: async (_prompt, cwd) => {
            fs.writeFileSync(path.join(cwd, "unpriced.txt"), "unsafe\n");
            return {
              usage: { input_tokens: 5, output_tokens: 2 },
              provider: "remote-unknown",
              model: "not-in-pricing-table",
            };
          },
        },
      );
      const unpricedStatus = distributedQueueStatus({
        state: unpriced.state,
        repo: unpriced.repo,
        runId: "agent-run",
      });
      expect(unpricedStatus.tasks[0]).toMatchObject({
        status: "cancelled",
        metadata: {
          workspaceExecution: {
            phase: "rolled-back",
            checkpoint: { state: "rolled_back" },
          },
        },
      });
      expect(unpricedStatus.stats.budget.spentUsd).toBe(0.25);

      const cancelled = makeRepo();
      writeGraph(cancelled.graph, [
        { key: "cancelled", prompt: "cancelled", retrySafe: false },
      ]);
      agentInit(cancelled);
      let runner;
      let stale;
      let accepted;
      await runDistributedWorker(
        {
          state: cancelled.state,
          repo: cancelled.repo,
          runId: "agent-run",
          workerId: "cancel-worker",
        },
        {
          onRunner: (value) => {
            runner = value;
          },
          agentExecutor: (_prompt, cwd, options) =>
            new Promise((_resolve, reject) => {
              fs.writeFileSync(path.join(cwd, "cancelled.txt"), "unsafe\n");
              const onAbort = () =>
                reject(options.signal.reason || new Error("cancelled"));
              options.signal.addEventListener("abort", onAbort, { once: true });
              const claim = runner.activeClaims()[0];
              stale = runner.interruptTask(claim.key, {
                holder: claim.holder,
                leaseId: claim.leaseId,
                fencingToken: claim.fencingToken + 1,
              });
              accepted = runner.interruptTask(claim.key, {
                holder: claim.holder,
                leaseId: claim.leaseId,
                fencingToken: claim.fencingToken,
                requestId: "cancel-agent-attempt",
                actor: "test-operator",
              });
            }),
        },
      );
      expect(stale).toEqual({ ok: false, reason: "stale_attempt" });
      expect(accepted).toMatchObject({ ok: true });
      const cancelledStatus = distributedQueueStatus({
        state: cancelled.state,
        repo: cancelled.repo,
        runId: "agent-run",
      });
      expect(cancelledStatus.pendingAdjudications).toHaveLength(1);
      expect(cancelledStatus.tasks[0]).toMatchObject({
        status: "cancelled",
        metadata: {
          workspaceExecution: {
            phase: "rolled-back",
            checkpoint: { state: "rolled_back" },
          },
        },
      });
    },
  );
});
