import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
import { WorkspaceTransactionManager } from "../../src/lib/process-execution-broker/workspace-transaction.js";
import { managedToolCheckpointBinding } from "../../src/lib/managed-tool-checkpoint.js";

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

  async function runDurable(runId, runTask, commandOverrides = {}) {
    await command({
      workflowRunTask: runTask,
      workflowExecutionAuthorityProvider: () => executionProof(projectRoot),
      ...commandOverrides,
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

  it("answers a durable stage input by request id and exact revision", async () => {
    const definition = workflowDefinition();
    definition.steps[1].needsInput = {
      prompt: "Choose release decision",
      options: ["approve", "reject"],
    };
    saveWorkflow(projectRoot, definition);
    const runId = "command-needs-input";
    const runTask = vi.fn(async (args) => completedTask(args));

    await runDurable(runId, runTask);
    expect(process.exitCode).toBe(1);
    const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("needs_input");
    expect(runTask).toHaveBeenCalledTimes(1);

    process.exitCode = undefined;
    logSpy.mockClear();
    await runtimeCommand("runtime-status", runId, "--json");
    const projection = latestJsonOutput();
    expect(projection.pendingInputRequests).toMatchObject([
      {
        id: state.inputRequests[0].id,
        stepId: "review",
        prompt: "Choose release decision",
      },
    ]);

    const responsePath = join(root, "workflow-input.json");
    writeFileSync(responsePath, JSON.stringify({ answer: "approve" }), "utf8");
    logSpy.mockClear();
    await runtimeCommand(
      "runtime-reply",
      runId,
      state.inputRequests[0].id,
      responsePath,
      "--expected-revision",
      String(state.revision),
      "--json",
    );
    expect(process.exitCode).toBeUndefined();
    expect(latestJsonOutput()).toMatchObject({
      status: "ready",
      inputRequestCount: 1,
      answeredInputRequestCount: 1,
      pendingInputRequests: [],
    });

    process.exitCode = undefined;
    await runDurable(runId, runTask);
    expect(process.exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(runTask.mock.calls[1][0].userMessage).toContain(
      '## Bound user input for stage review\n"approve"',
    );
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("completed");
  });

  it("recovers a bound terminal checkpoint call through the production command path", async () => {
    let sequence = 0;
    const checkpointStore = new WorkspaceTransactionManager({
      stateDir: join(root, "checkpoint-state"),
      lockDir: join(root, "checkpoint-locks"),
      allowNonCanonicalLockDirForTests: true,
      now: () => Date.parse("2026-08-18T06:30:00.000Z") + sequence * 1000,
      uuid: () =>
        `20000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      ownerToken: () =>
        `30000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    });
    const runId = "command-checkpoint-recovery";
    await runDurable(
      runId,
      async (args) => {
        const transaction = checkpointStore.begin({
          id: "wcp-command-checkpoint-recovery",
          runId,
          taskKey: "command-checkpoint-recovery",
          workspaceRoot: args.cwd,
          coverageTarget: "partial",
          writerIsolation: "unknown",
          externalSideEffects: false,
          exclusions: args.managedCheckpointExclusions,
        });
        const tool = "write_file";
        const toolUseId = "tool-command-checkpoint-recovery";
        const childEffectId = `sha256:${createHash("sha256")
          .update(
            `${args.workflowEffectId}\0tool\0${String(1)}\0${toolUseId}\0${tool}`,
            "utf8",
          )
          .digest("hex")}`;
        args.onToolCallBoundary({
          type: "tool-executing",
          tool,
          args: {},
          tool_use_id: toolUseId,
          workflowEffectProtocol: "cc-workflow-child-effect/v1",
          workflowEffectId: args.workflowEffectId,
          workflowChildEffectId: childEffectId,
          workflowChildSequence: 1,
          managedCheckpointBinding: managedToolCheckpointBinding({
            skipped: false,
            transactionId: transaction.id,
            checkpointId: transaction.checkpointId,
            prepared: transaction.snapshot(),
          }),
        });
        writeFileSync(
          join(projectRoot, "checkpoint-command.txt"),
          "committed\n",
          "utf8",
        );
        transaction.accept();
        throw new Error("crash after checkpoint commit");
      },
      { workflowCheckpointStore: checkpointStore },
    );
    expect(process.exitCode).toBe(1);
    const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
    let state = readDynamicWorkflowRuntimeState(statePath);
    const callRecordId = state.effects[0].calls[0].id;

    process.exitCode = undefined;
    logSpy.mockClear();
    await command({ workflowCheckpointStore: checkpointStore }).parseAsync([
      "node",
      "cc",
      "cowork",
      "workflow",
      "runtime-recover-checkpoint",
      runId,
      callRecordId,
      "--expected-revision",
      String(state.revision),
      "--json",
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(
      latestJsonOutput().observability.checkpoints.storeReadbacks,
    ).toMatchObject({
      preparedBindingCalls: 1,
      terminalStoreRecoveredCalls: 1,
      committedCalls: 1,
    });
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects[0].calls[0]).toMatchObject({
      status: "completed",
      settlementCode: "checkpoint_store_recovered_commit",
    });
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
