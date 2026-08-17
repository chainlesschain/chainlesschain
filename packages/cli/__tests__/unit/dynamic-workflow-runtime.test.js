import {
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDynamicWorkflowRunAdmission,
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
} from "../../src/lib/dynamic-workflow-facade.js";
import {
  DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
  dynamicWorkflowRunStatePath,
  executeDurableDynamicWorkflow,
  prepareDurableWorkflowResume,
  projectDynamicWorkflowRuntime,
  readDynamicWorkflowEffectResultFile,
  readDynamicWorkflowRuntimeState,
  reconcileDurableWorkflowEffect,
  requestDurableWorkflowPause,
  requestDurableWorkflowStop,
} from "../../src/lib/dynamic-workflow-runtime.js";
import {
  generateDynamicWorkflowDraft,
  reviewDynamicWorkflowDraft,
} from "../../src/lib/dynamic-workflow-draft.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import {
  createCoworkWorkflowRecord,
  verifyCoworkWorkflowRecord,
} from "../../src/lib/workflow-definition-contract.js";

function workflowDefinition(overrides = {}) {
  return {
    id: "durable-release-review",
    name: "Durable release review",
    steps: [
      { id: "collect", message: "Collect release evidence" },
      {
        id: "review",
        message: "Review ${step.collect.summary}",
        dependsOn: ["collect"],
      },
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
    ...overrides,
  };
}

function clock(start = Date.parse("2026-08-18T05:00:00.000Z")) {
  let tick = 0;
  return () => new Date(start + tick++ * 1000).toISOString();
}

function executionLocation(projectRoot) {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-18T05:00:00.000Z",
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
  });
}

function admittedExecution(projectRoot, workflow = workflowDefinition()) {
  const definitionAuthority = verifyCoworkWorkflowRecord(
    createCoworkWorkflowRecord(workflow),
  );
  const executionLocationAuthority = {
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "verified-session-start",
    sessionId: "durable-session-1",
    headHash: "d".repeat(64),
    eventCount: 4,
    binding: executionLocation(projectRoot),
  };
  const admission = buildDynamicWorkflowRunAdmission(
    {
      definitionAuthority,
      executionAuthoritySessionId: "durable-session-1",
      maxParallel: 1,
      execution: {
        cwd: projectRoot,
        continueOnError: false,
        pipeline: false,
        provider: "fixture",
        model: "fixture-model",
      },
    },
    {
      verifyAuthorities: () => ({
        definitionAuthority,
        executionLocationAuthority,
      }),
    },
  );
  expect(admission.allowed).toBe(true);
  return {
    workflow: definitionAuthority.definition,
    definitionDigest: definitionAuthority.definitionDigest,
    cwd: projectRoot,
    continueOnError: false,
    pipeline: false,
    llmOptions: { provider: "fixture", model: "fixture-model" },
    runAdmission: admission.admission,
  };
}

function completedTask(args) {
  return {
    taskId: `task-${args.workflowEffect.stepId}-${args.workflowEffect.iteration}-${args.workflowEffect.attempt}`,
    status: "completed",
    result: { summary: `done:${args.userMessage}`, tokenCount: 10 },
  };
}

describe("durable dynamic workflow runtime", () => {
  let root;
  let projectRoot;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-dynamic-workflow-runtime-"));
    projectRoot = join(root, "project");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("persists request-before-provider and a settled, completed lineage", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-complete");
    const runTask = vi.fn(async (args) => completedTask(args));
    const record = await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-complete",
        execution: admittedExecution(projectRoot),
      },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(runTask.mock.calls[0][0].workflowEffectId).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("completed");
    expect(state.effects).toHaveLength(2);
    expect(state.effects.every((effect) => effect.status === "settled")).toBe(
      true,
    );
    expect(state.finalRecord).toEqual(record);
    expect(projectDynamicWorkflowRuntime(state)).toMatchObject({
      status: "completed",
      effectCount: 2,
      settledEffectCount: 2,
      pendingEffects: [],
      finalRecordStatus: "completed",
    });
  });

  it("never replays an outcome-unknown effect before explicit reconciliation", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-crash");
    const execution = admittedExecution(projectRoot);
    const firstResult = completedTask({
      workflowEffect: { stepId: "collect", iteration: 1, attempt: 1 },
      userMessage: "Collect release evidence",
    });
    const runTask = vi.fn(async (args) =>
      args.workflowEffect.stepId === "collect"
        ? firstResult
        : completedTask(args),
    );

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-crash", execution },
        {
          runTask,
          now: clock(),
          afterProvider: () => {
            throw new Error("simulated crash after provider success");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "reconciliation-required",
    });
    expect(runTask).toHaveBeenCalledTimes(1);
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects).toMatchObject([{ status: "pending" }]);

    expect(() =>
      prepareDurableWorkflowResume(statePath, state.revision),
    ).toThrow(/must be reconciled/u);
    expect(runTask).toHaveBeenCalledTimes(1);

    state = reconcileDurableWorkflowEffect(
      statePath,
      {
        expectedRevision: state.revision,
        effectId: state.effects[0].id,
        result: firstResult,
      },
      { now: clock(Date.parse("2026-08-18T05:10:00.000Z")) },
    );
    expect(state.status).toBe("ready");
    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-crash", execution },
      { runTask, now: clock(Date.parse("2026-08-18T05:20:00.000Z")) },
    );
    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects).toHaveLength(2);
    expect(state.effects[0].result).toEqual(firstResult);
  });

  it("pauses at the next safe point and resumes without replaying settled work", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-pause");
    const execution = admittedExecution(projectRoot);
    const runtimeClock = clock();
    const runTask = vi.fn(async (args) => {
      if (args.workflowEffect.stepId === "collect") {
        const state = readDynamicWorkflowRuntimeState(statePath);
        requestDurableWorkflowPause(statePath, state.revision, {
          now: runtimeClock,
        });
      }
      return completedTask(args);
    });

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-pause", execution },
        { runTask, now: runtimeClock },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "paused",
    });
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("paused");
    expect(state.effects).toMatchObject([{ status: "settled" }]);
    expect(runTask).toHaveBeenCalledTimes(1);

    state = prepareDurableWorkflowResume(statePath, state.revision, {
      now: runtimeClock,
    });
    expect(state.status).toBe("ready");
    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-pause", execution },
      { runTask, now: runtimeClock },
    );
    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it("stops permanently while retaining settlement evidence", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-stop");
    const execution = admittedExecution(projectRoot);
    const runtimeClock = clock();
    const runTask = vi.fn(async (args) => {
      const state = readDynamicWorkflowRuntimeState(statePath);
      requestDurableWorkflowStop(statePath, state.revision, {
        now: runtimeClock,
      });
      return completedTask(args);
    });
    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-stop", execution },
        { runTask, now: runtimeClock },
      ),
    ).rejects.toMatchObject({ reason: "stopped" });
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("stopped");
    expect(state.effects).toMatchObject([{ status: "settled" }]);
    expect(state.finalRecord).toBeNull();
    expect(() =>
      prepareDurableWorkflowResume(statePath, state.revision),
    ).toThrow(/cannot resume a stopped/u);
  });

  it("rejects stale control revisions and secret-bearing reconciliation", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-control");
    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath,
          runId: "run-control",
          execution: admittedExecution(projectRoot),
        },
        {
          runTask: async (args) => completedTask(args),
          now: clock(),
          afterProvider: () => {
            throw new Error("response lost");
          },
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(() =>
      requestDurableWorkflowStop(statePath, state.revision - 1),
    ).toThrow(/stale dynamic workflow runtime revision/u);
    expect(() =>
      reconcileDurableWorkflowEffect(statePath, {
        expectedRevision: state.revision,
        effectId: state.effects[0].id,
        result: {
          taskId: "secret-result",
          status: "completed",
          result: {
            summary: "Authorization: Bearer sk-abcd1234efgh5678ijkl",
          },
        },
      }),
    ).toThrow(/secret-shaped/u);

    const resultPath = join(root, "effect-result.json");
    writeFileSync(
      resultPath,
      JSON.stringify({
        taskId: "task-collect",
        status: "completed",
        result: { summary: "done:collect" },
      }),
      "utf8",
    );
    linkSync(resultPath, join(root, "effect-result-link.json"));
    expect(() => readDynamicWorkflowEffectResultFile(resultPath)).toThrow(
      /regular, single-link/u,
    );
  });

  it("rejects model-generated definitions until accepted review authority is present", async () => {
    const draft = await generateDynamicWorkflowDraft(
      {
        prompt: "Create a release review",
        provider: "fixture",
        model: "fixture-model",
      },
      {
        chat: async () => JSON.stringify(workflowDefinition()),
        now: () => "2026-08-18T05:30:00.000Z",
      },
    );
    const pendingExecution = admittedExecution(projectRoot, draft.definition);
    const pendingPath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-unreviewed",
    );
    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath: pendingPath,
          runId: "run-unreviewed",
          execution: pendingExecution,
        },
        { runTask: async (args) => completedTask(args), now: clock() },
      ),
    ).rejects.toMatchObject({
      code: "CC_DYNAMIC_WORKFLOW_REVIEW_AUTHORITY_REQUIRED",
    });
    expect(existsSync(pendingPath)).toBe(false);

    const review = reviewDynamicWorkflowDraft(
      {
        draft,
        expectedDraftDigest: draft.draftDigest,
        decision: "accept",
        reviewer: "alice@example.com",
      },
      { now: () => "2026-08-18T05:31:00.000Z" },
    );
    const reviewedExecution = admittedExecution(projectRoot, review.definition);
    const reviewedPath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-reviewed",
    );
    const record = await executeDurableDynamicWorkflow(
      {
        statePath: reviewedPath,
        runId: "run-reviewed",
        execution: reviewedExecution,
      },
      { runTask: async (args) => completedTask(args), now: clock() },
    );
    expect(record.status).toBe("completed");
  });

  it("fails closed before state creation for retry/timeout definitions", async () => {
    const retryWorkflow = workflowDefinition();
    retryWorkflow.steps[0].retries = 1;
    retryWorkflow.facade.requirements.capabilities.push("retry");
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-retry");
    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath,
          runId: "run-retry",
          execution: admittedExecution(projectRoot, retryWorkflow),
        },
        { runTask: async (args) => completedTask(args), now: clock() },
      ),
    ).rejects.toMatchObject({
      code: "CC_DYNAMIC_WORKFLOW_DURABLE_RETRY_TIMEOUT_UNSUPPORTED",
    });
    expect(existsSync(statePath)).toBe(false);
  });

  it("fails closed on state tamper and hard-linked state files", async () => {
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-integrity");
    await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-integrity",
        execution: admittedExecution(projectRoot),
      },
      { runTask: async (args) => completedTask(args), now: clock() },
    );
    const state = readDynamicWorkflowRuntimeState(statePath);
    writeFileSync(
      statePath,
      JSON.stringify({ ...state, status: "running" }),
      "utf8",
    );
    expect(() => readDynamicWorkflowRuntimeState(statePath)).toThrow(
      /state is invalid/u,
    );

    const secondPath = dynamicWorkflowRunStatePath(projectRoot, "run-hardlink");
    await executeDurableDynamicWorkflow(
      {
        statePath: secondPath,
        runId: "run-hardlink",
        execution: admittedExecution(projectRoot),
      },
      { runTask: async (args) => completedTask(args), now: clock() },
    );
    linkSync(secondPath, join(root, "runtime-state-link.json"));
    expect(() => readDynamicWorkflowRuntimeState(secondPath)).toThrow(
      /regular, single-link/u,
    );
  });
});
