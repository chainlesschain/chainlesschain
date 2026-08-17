import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCoworkCommand } from "../../src/commands/cowork.js";
import {
  dynamicWorkflowRunStatePath,
  readDynamicWorkflowRuntimeState,
  requestDurableWorkflowPause,
} from "../../src/lib/dynamic-workflow-runtime.js";
import { saveWorkflow } from "../../src/lib/cowork-workflow.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";

function workflowDefinition() {
  return {
    id: "runtime-command-workflow",
    name: "Runtime command workflow",
    steps: [
      { id: "collect", message: "collect" },
      { id: "review", message: "review", dependsOn: ["collect"] },
    ],
    facade: {
      requirements: {
        capabilities: ["cowork-task", "dag", "variables"],
        executionLocations: ["local"],
        permissions: {
          file: "read",
          shell: false,
          network: false,
          mcp: false,
          externalSystems: false,
        },
        sandbox: "strong",
        dataBoundary: "repository",
        credentials: [],
      },
      estimates: {
        tokensPerTask: 100,
        usdPerTask: 0.01,
        durationMsPerTask: 1000,
      },
      budget: {
        maxExpandedTasks: 8,
        maxParallel: 2,
        maxTokens: 1000,
        maxUsd: 1,
        maxDurationMs: 10000,
      },
    },
  };
}

function executionProof(projectRoot) {
  return {
    sessionId: "runtime-command-session",
    headHash: "d".repeat(64),
    eventCount: 5,
    binding: createExecutionLocationBinding({
      location: "local",
      observed: true,
      observedAt: "2026-08-18T06:00:00.000Z",
      source: {
        cwd: projectRoot,
        git: { root: projectRoot, commit: "a".repeat(40) },
      },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        tools: ["node"],
      },
      model: {
        provider: "fixture",
        name: "fixture-model",
        credentialSource: "none",
      },
      permissions: {
        status: "declared",
        file: "read",
        shell: false,
        network: false,
        mcp: false,
        externalSystems: false,
      },
      policy: {
        network: "offline",
        sandbox: "strong",
        dataBoundary: { kind: "repository", root: projectRoot },
      },
    }),
  };
}

function completedTask(args) {
  return {
    taskId: `task-${args.workflowEffect.stepId}`,
    status: "completed",
    result: { summary: `done:${args.userMessage}` },
  };
}

describe("cowork durable workflow runtime commands", () => {
  let root;
  let projectRoot;
  let previousCwd;
  let previousExitCode;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    root = realpathSync.native(
      mkdtempSync(join(tmpdir(), "cc-cowork-runtime-command-")),
    );
    projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    previousCwd = process.cwd();
    previousExitCode = process.exitCode;
    process.chdir(projectRoot);
    process.exitCode = undefined;
    saveWorkflow(projectRoot, workflowDefinition());
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = previousExitCode;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  });

  function command(commandDeps = {}) {
    const program = new Command();
    program.exitOverride();
    registerCoworkCommand(program, commandDeps);
    return program;
  }

  async function runDurable(runId, runTask) {
    await command({
      workflowRunTask: runTask,
      workflowExecutionAuthorityProvider: () => executionProof(projectRoot),
    }).parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "run",
      "runtime-command-workflow",
      "--execution-authority-session",
      "runtime-command-session",
      "--durable-run-id",
      runId,
    ]);
  }

  async function runtimeCommand(action, ...args) {
    await command().parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      action,
      ...args,
    ]);
  }

  function latestJsonOutput() {
    return JSON.parse(logSpy.mock.calls.at(-1)[0]);
  }

  it("executes and reports one durable run through the production command path", async () => {
    const runTask = vi.fn(async (args) => completedTask(args));
    await runDurable("command-complete", runTask);
    expect(process.exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);

    logSpy.mockClear();
    await runtimeCommand("runtime-status", "command-complete", "--json");
    expect(latestJsonOutput()).toMatchObject({
      runId: "command-complete",
      status: "completed",
      effectCount: 2,
      settledEffectCount: 2,
      pendingEffects: [],
    });
  });

  it("pauses at a safe point, authorizes resume by revision, and reuses settlement", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "command-pause");
    const runTask = vi.fn(async (args) => {
      if (args.workflowEffect.stepId === "collect") {
        const state = readDynamicWorkflowRuntimeState(statePath);
        requestDurableWorkflowPause(statePath, state.revision);
      }
      return completedTask(args);
    });
    await runDurable("command-pause", runTask);
    expect(process.exitCode).toBe(1);
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("paused");
    expect(runTask).toHaveBeenCalledTimes(1);

    process.exitCode = undefined;
    logSpy.mockClear();
    await runtimeCommand(
      "runtime-resume",
      "command-pause",
      "--expected-revision",
      String(state.revision),
      "--json",
    );
    expect(latestJsonOutput().status).toBe("ready");

    process.exitCode = undefined;
    await runDurable("command-pause", runTask);
    expect(process.exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("completed");
  });

  it("requires a bounded reconciliation file before an unknown effect can resume", async () => {
    let failOnce = true;
    const runTask = vi.fn(async (args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("provider response was lost");
      }
      return completedTask(args);
    });
    await runDurable("command-reconcile", runTask);
    expect(process.exitCode).toBe(1);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "command-reconcile",
    );
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects).toMatchObject([{ status: "pending" }]);

    const resultPath = join(root, "provider-result.json");
    writeFileSync(
      resultPath,
      JSON.stringify({
        taskId: "task-collect",
        status: "completed",
        result: { summary: "done:collect" },
      }),
      "utf8",
    );
    process.exitCode = undefined;
    logSpy.mockClear();
    await runtimeCommand(
      "runtime-reconcile",
      "command-reconcile",
      state.effects[0].id,
      resultPath,
      "--expected-revision",
      String(state.revision),
      "--json",
    );
    expect(latestJsonOutput()).toMatchObject({
      status: "ready",
      settledEffectCount: 1,
      pendingEffects: [],
    });

    process.exitCode = undefined;
    await runDurable("command-reconcile", runTask);
    expect(process.exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("completed");
  });

  it("accepts bounded parallel durable admission and rejects stale control revisions", async () => {
    const runTask = vi.fn(async (args) => completedTask(args));
    await command({
      workflowRunTask: runTask,
      workflowExecutionAuthorityProvider: () => executionProof(projectRoot),
    }).parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "run",
      "runtime-command-workflow",
      "--execution-authority-session",
      "runtime-command-session",
      "--durable-run-id",
      "command-invalid",
      "--max-parallel",
      "2",
    ]);
    expect(process.exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(
      readDynamicWorkflowRuntimeState(
        dynamicWorkflowRunStatePath(projectRoot, "command-invalid"),
      ).status,
    ).toBe("completed");

    process.exitCode = undefined;
    await runDurable("command-stale", runTask);
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "command-stale");
    const state = readDynamicWorkflowRuntimeState(statePath);
    process.exitCode = undefined;
    errorSpy.mockClear();
    await runtimeCommand(
      "runtime-stop",
      "command-stale",
      "--expected-revision",
      String(state.revision - 1),
    );
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "stale dynamic workflow runtime revision",
    );
  });
});
