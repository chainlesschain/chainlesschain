#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runDistributedWorker } from "../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../src/lib/agent-team/team-distributed-queue.js";

const [configurationPath, mode, workerId] = process.argv.slice(2);

function requiredText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function readConfiguration(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const field of [
    "statePath",
    "repo",
    "runId",
    "effectsDir",
    "workflowMode",
  ]) {
    requiredText(parsed[field], `configuration.${field}`);
  }
  return parsed;
}

function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function deterministicAgentExecutor(configuration, id) {
  let attemptSequence = 0;
  return async (prompt, cwd, options) => {
    const task = JSON.parse(prompt);
    if (
      task?.kind !== "chainlesschain-team-soak-task" ||
      typeof task.key !== "string" ||
      !Array.isArray(task.dependsOn)
    ) {
      throw new Error("soak Agent received an invalid deterministic prompt");
    }
    if (
      options?.managedCheckpoint !== true ||
      options?.worktreeRequired !== true ||
      options?.signal?.aborted
    ) {
      throw new Error("soak Agent lost its managed worktree contract");
    }

    const dependencyEvidence = task.dependsOn.map((dependencyKey) => {
      const dependencyPath = path.join(
        cwd,
        "soak-output",
        `${dependencyKey}.json`,
      );
      const dependency = JSON.parse(fs.readFileSync(dependencyPath, "utf8"));
      if (
        dependency.key !== dependencyKey ||
        dependency.runId !== configuration.runId ||
        typeof dependency.attemptId !== "string"
      ) {
        throw new Error(
          `dependency baseline for ${dependencyKey} is not authoritative`,
        );
      }
      return {
        key: dependencyKey,
        attemptId: dependency.attemptId,
        contentDigest: crypto
          .createHash("sha256")
          .update(JSON.stringify(dependency))
          .digest("hex"),
      };
    });

    attemptSequence += 1;
    const attemptId = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          runId: configuration.runId,
          taskKey: task.key,
          workerId: id,
          pid: process.pid,
          attemptSequence,
        }),
      )
      .digest("hex");
    const attempt = {
      kind: "chainlesschain-team-soak-effect-attempt",
      runId: configuration.runId,
      taskKey: task.key,
      attemptId,
      workerId: id,
      pid: process.pid,
    };
    writeExclusiveJson(
      path.join(
        configuration.effectsDir,
        "attempts",
        task.key,
        `${attemptId}.json`,
      ),
      attempt,
    );
    writeExclusiveJson(
      path.join(configuration.effectsDir, "confirmed", `${task.key}.json`),
      {
        ...attempt,
        kind: "chainlesschain-team-soak-confirmed-effect",
        confirmationId: crypto
          .createHash("sha256")
          .update(`${configuration.runId}\0${task.key}`)
          .digest("hex"),
      },
    );

    fs.mkdirSync(path.join(cwd, "soak-output"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "soak-output", `${task.key}.json`),
      `${JSON.stringify(
        {
          kind: "chainlesschain-team-soak-output",
          runId: configuration.runId,
          key: task.key,
          attemptId,
          workerId: id,
          dependencyEvidence,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    if (Number(configuration.taskDelayMs) > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Number(configuration.taskDelayMs)),
      );
    }
    return {
      usage: { input_tokens: 2, output_tokens: 1 },
      provider: "chainlesschain-local",
      model: "deterministic-soak",
    };
  };
}

function emit(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(
      `${JSON.stringify({ ...value, rssBytes: process.memoryUsage().rss })}\n`,
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

async function waitForDrainBarrier(configuration, id) {
  const readyDir = requiredText(
    configuration.readyDir,
    "configuration.readyDir",
  );
  writeExclusiveJson(path.join(readyDir, `${id}.json`), {
    kind: "chainlesschain-team-soak-worker-ready",
    runId: configuration.runId,
    workerId: id,
    pid: process.pid,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = fs
      .readdirSync(readyDir)
      .filter((name) => name.endsWith(".json")).length;
    if (ready === Number(configuration.workers)) {
      await emit({
        type: "worker-barrier-released",
        workerId: id,
        pid: process.pid,
        ready,
      });
      return;
    }
    if (ready > Number(configuration.workers)) {
      throw new Error("soak worker barrier has unaccounted participants");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("soak worker barrier timed out");
}

async function main() {
  requiredText(configurationPath, "configuration path");
  requiredText(mode, "worker mode");
  requiredText(workerId, "worker id");
  const configuration = readConfiguration(configurationPath);

  if (mode === "crash-before-execution") {
    const queue = new TeamDistributedQueue({
      filePath: configuration.statePath,
    });
    const claim = queue.claim({
      holder: workerId,
      ttlMs: Number(configuration.crashLeaseTtlMs),
      slots: Number(configuration.workers),
    });
    await emit({
      type: "claimed",
      mode,
      workerId,
      pid: process.pid,
      claim,
    });
    // The fault boundary is deliberately before any worktree, checkpoint, or
    // external-effect attempt. A dead PID may therefore be reclaimed only for
    // a graph task explicitly pinned retrySafe=true.
    process.exitCode = claim.ok ? 86 : 2;
    return;
  }

  if (mode !== "agent-drain" && mode !== "shell-drain") {
    throw new TypeError(`unsupported soak worker mode: ${mode}`);
  }
  if (
    (mode === "agent-drain") !==
    (configuration.workflowMode === "agent-worktree")
  ) {
    throw new Error("worker mode does not match pinned queue authority");
  }

  process.env.CC_TEAM_SOAK_EFFECTS_DIR = configuration.effectsDir;
  process.env.CC_TEAM_SOAK_RUN_ID = configuration.runId;
  process.env.CC_TEAM_SOAK_WORKER_ID = workerId;
  await emit({ type: "worker-started", mode, workerId, pid: process.pid });
  await waitForDrainBarrier(configuration, workerId);
  const memoryTimer = setInterval(() => {
    void emit({
      type: "worker-memory",
      mode,
      workerId,
      pid: process.pid,
    }).catch(() => {});
  }, 1_000);
  memoryTimer.unref();
  const localTaskCap = Math.ceil(
    Number(configuration.tasks) / Number(configuration.workers),
  );
  let result;
  try {
    // Keep the production evidence genuinely multi-process. The start barrier
    // aligns worker admission, while a per-worker drain cap prevents one fast
    // process from consuming the whole DAG before its peer can win a claim.
    result = await runDistributedWorker(
      {
        state: configuration.statePath,
        repo: configuration.repo,
        runId: configuration.runId,
        workerId,
        mode: configuration.workflowMode,
        agent: configuration.workflowMode === "agent-worktree",
        managedCheckpoint: configuration.workflowMode === "agent-worktree",
        checkpointStateDir:
          configuration.workflowMode === "agent-worktree"
            ? configuration.checkpointStateDir
            : undefined,
        ttlMs: Number(configuration.workerTtlMs),
        renewEveryMs: Number(configuration.renewEveryMs),
        pollMs: Number(configuration.pollMs),
        maxTasks: localTaskCap,
      },
      configuration.workflowMode === "agent-worktree"
        ? {
            buildAgentPrompt: (prompt) => prompt,
            agentExecutor: deterministicAgentExecutor(configuration, workerId),
          }
        : {},
    );
  } finally {
    clearInterval(memoryTimer);
  }
  await emit({
    type: "worker-finished",
    mode,
    workerId,
    pid: process.pid,
    localTaskCap,
    summary: result.summary,
    queue: result.queue,
    completed: result.completed.map((entry) => entry.key),
  });
}

try {
  await main();
} catch (error) {
  await emit({
    type: "fatal",
    workerId: workerId || null,
    pid: process.pid,
    code: error?.code || null,
    message: error?.message || String(error),
  }).catch(() => {});
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
