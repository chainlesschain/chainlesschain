import {
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
  verifyDynamicWorkflowRuntimeState,
} from "../../src/lib/dynamic-workflow-runtime.js";
import {
  generateDynamicWorkflowDraft,
  reviewDynamicWorkflowDraft,
} from "../../src/lib/dynamic-workflow-draft.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import { canonicalJson } from "../../src/lib/scheduler-kernel/contract.js";
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

function withRuntimeStateDigest(state) {
  const material = structuredClone(state);
  delete material.stateDigest;
  return {
    ...material,
    stateDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.dynamic-workflow.runtime-state.v1\0", "utf8")
      .update(canonicalJson(material, "dynamicWorkflowRuntime"), "utf8")
      .digest("hex")}`,
  };
}

function workflowProviderRequestId(effectId, source = "model", sequence = 1) {
  return `ccwf_${createHash("sha256")
    .update(`${effectId}\0${source}\0${String(sequence)}`, "utf8")
    .digest("hex")}`;
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

function admittedExecution(
  projectRoot,
  workflow = workflowDefinition(),
  maxParallel = 1,
  pipeline = false,
) {
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
      maxParallel,
      execution: {
        cwd: projectRoot,
        continueOnError: false,
        pipeline,
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
    pipeline,
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

function nestedToolEvidence(args) {
  const childSequence = 1;
  const toolUseId = `tool-${args.workflowEffect.stepId}`;
  const tool = "mcp__repo__publish";
  const childEffectId = `sha256:${createHash("sha256")
    .update(
      `${args.workflowEffectId}\0tool\0${childSequence}\0${toolUseId}\0${tool}`,
      "utf8",
    )
    .digest("hex")}`;
  return {
    nestedEffectAttempts: [
      {
        protocol: "cc-workflow-child-effect/v1",
        workflowEffectId: args.workflowEffectId,
        childEffectId,
        childSequence,
        kind: "tool",
        tool,
        toolUseId,
        identitySemantics: "runtime-derived",
      },
    ],
    nestedEffectSettlements: [
      {
        protocol: "cc-workflow-child-effect/v1",
        workflowEffectId: args.workflowEffectId,
        childEffectId,
        childSequence,
        kind: "tool",
        tool,
        toolUseId,
        status: "completed",
        outcomeUnknown: false,
        mcpLedgerId: `mcp-${args.workflowEffect.stepId}`,
        mcpLedgerPrewritePersisted: true,
        mcpLedgerSettlementPersisted: true,
      },
    ],
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
    const runTask = vi.fn(async (args) => ({
      ...completedTask(args),
      workflowEffectId: args.workflowEffectId,
      providerRequestAttempts: [
        {
          protocol: "cc-provider-request-attempt/v1",
          provider: "openai",
          workflowEffectId: args.workflowEffectId,
          callId: `mdl-${args.workflowEffect.stepId}`,
          callSequence: 1,
          source: "model",
          clientRequestId: `ccwf_${args.workflowEffectId.slice("sha256:".length)}`,
          requestIdentitySemantics: "trace-only",
        },
      ],
      providerRequestReceipts: [
        {
          protocol: "cc-provider-request-receipt/v1",
          provider: "openai",
          workflowEffectId: args.workflowEffectId,
          callId: `mdl-${args.workflowEffect.stepId}`,
          callSequence: 1,
          source: "model",
          clientRequestId: `ccwf_${args.workflowEffectId.slice("sha256:".length)}`,
          requestId: `req_${args.workflowEffect.stepId}`,
          responseId: `chatcmpl_${args.workflowEffect.stepId}`,
          requestIdentitySemantics: "trace-only",
          independentlyReadable: false,
        },
      ],
      ...nestedToolEvidence(args),
    }));
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
    const projection = projectDynamicWorkflowRuntime(state);
    expect(projection).toMatchObject({
      status: "completed",
      effectCount: 2,
      settledEffectCount: 2,
      pendingEffects: [],
      finalRecordStatus: "completed",
    });
    expect(projection.observability.providerReceipts).toMatchObject({
      authority: "provider-returned-trace-only",
      count: 2,
      projectedRecords: 2,
      requestAttempts: 2,
      projectedRequestAttempts: 2,
      requestAttemptEffects: 2,
      observedEffects: 2,
      missingProviderReturnedEffects: 0,
      missingRequestReceipts: 0,
      invalidRequestAttempts: 0,
      invalidRecords: 0,
      nativeIdempotencyProven: false,
      independentlyReadable: false,
    });
    expect(projection.observability.providerReceipts.lineage).toEqual([
      expect.objectContaining({
        effectId: state.effects[0].id,
        requestId: "req_collect",
        requestIdentitySemantics: "trace-only",
      }),
      expect.objectContaining({
        effectId: state.effects[1].id,
        requestId: "req_review",
        requestIdentitySemantics: "trace-only",
      }),
    ]);
    expect(projection.observability.nestedEffects).toMatchObject({
      authority: "task-result-bound-with-mcp-session-ledger-flags",
      attempts: 2,
      settlements: 2,
      projectedAttempts: 2,
      projectedSettlements: 2,
      durableMcpSettlements: 2,
      missingSettlements: 0,
      invalidAttempts: 0,
      invalidSettlements: 0,
      allEffectsIndependentlyDurable: false,
    });
    expect(projection.observability.nestedEffects.settlementLineage).toEqual([
      expect.objectContaining({
        effectId: state.effects[0].id,
        status: "completed",
        mcpLedgerSettlementPersisted: true,
      }),
      expect.objectContaining({
        effectId: state.effects[1].id,
        status: "completed",
        mcpLedgerSettlementPersisted: true,
      }),
    ]);
    expect(projection.observability.gaps).toEqual(
      expect.arrayContaining([
        "provider-native-idempotency-unavailable",
        "provider-receipt-independent-readback-unavailable",
        "nested-tool-independent-ledger-incomplete",
      ]),
    );
    expect(projection.observability.gaps).not.toContain(
      "provider-request-receipt-incomplete",
    );
  });

  it("persists provider and tool call rows before dispatch and settles them independently", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "publish", message: "Publish release" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-durable-calls",
    );
    const runTask = vi.fn(async (args) => {
      const providerBoundary = {
        type: "model-usage-started",
        callId: "mdl-publish-1",
        provider: "openai",
        model: "gpt-4o",
        source: "model",
        workflowEffectId: args.workflowEffectId,
        callSequence: 1,
        providerRequestId: workflowProviderRequestId(args.workflowEffectId),
        requestIdentitySemantics: "trace-only",
      };
      args.onUsageBoundary(providerBoundary);
      let state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls).toEqual([
        expect.objectContaining({
          kind: "provider",
          callId: "mdl-publish-1",
          status: "started",
        }),
      ]);
      args.onUsageSettlement({
        type: "token-usage",
        callId: providerBoundary.callId,
        provider: "openai",
        model: "gpt-4o",
        usage: { input_tokens: 2, output_tokens: 1 },
      });

      const toolUseId = "tool-publish-1";
      const tool = "mcp__repo__publish";
      const childEffectId = `sha256:${createHash("sha256")
        .update(
          `${args.workflowEffectId}\0tool\0${String(1)}\0${toolUseId}\0${tool}`,
          "utf8",
        )
        .digest("hex")}`;
      const toolBoundary = {
        type: "tool-executing",
        tool,
        args: {},
        tool_use_id: toolUseId,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
        workflowEffectId: args.workflowEffectId,
        workflowChildEffectId: childEffectId,
        workflowChildSequence: 1,
      };
      args.onToolCallBoundary(toolBoundary);
      state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls).toHaveLength(2);
      expect(state.effects[0].calls[1]).toMatchObject({
        kind: "tool",
        childEffectId,
        status: "started",
      });
      args.onToolCallSettlement({
        ...toolBoundary,
        type: "tool-result",
        result: {
          ok: true,
          mcpLedgerId: "mcp-publish-1",
          mcpLedgerPrewritePersisted: true,
          mcpLedgerSettlementPersisted: true,
        },
        error: null,
      });
      return completedTask(args);
    });

    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-durable-calls", execution },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls).toEqual([
      expect.objectContaining({
        kind: "provider",
        status: "completed",
        settledAt: expect.any(String),
      }),
      expect.objectContaining({
        kind: "tool",
        status: "completed",
        mcpLedgerId: "mcp-publish-1",
        mcpLedgerPrewritePersisted: true,
        mcpLedgerSettlementPersisted: true,
      }),
    ]);
    expect(
      state.lineage.filter((event) => event.type === "effect-call-started"),
    ).toHaveLength(2);
    expect(
      state.lineage.filter((event) => event.type === "effect-call-settled"),
    ).toHaveLength(2);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      count: 2,
      started: 0,
      completed: 2,
      outcomeUnknown: 0,
    });
  });

  it("retains a crash-visible started provider call until operator reconciliation", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-crash",
    );
    const runTask = vi.fn(async (args) => {
      args.onUsageBoundary({
        type: "model-usage-started",
        callId: "mdl-crash-1",
        provider: "openai",
        model: "gpt-4o",
        source: "model",
        workflowEffectId: args.workflowEffectId,
        callSequence: 1,
        providerRequestId: workflowProviderRequestId(args.workflowEffectId),
        requestIdentitySemantics: "trace-only",
      });
      throw new Error("process stopped after provider dispatch");
    });

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-call-crash", execution },
        { runTask, now: clock() },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects[0].status).toBe("pending");
    expect(state.effects[0].calls).toEqual([
      expect.objectContaining({
        kind: "provider",
        callId: "mdl-crash-1",
        status: "started",
        settledAt: null,
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      count: 1,
      started: 1,
      completed: 0,
    });

    state = reconcileDurableWorkflowEffect(
      statePath,
      {
        expectedRevision: state.revision,
        effectId: state.effects[0].id,
        result: completedTask({
          workflowEffect: state.effects[0],
          userMessage: "operator verified provider outcome",
        }),
      },
      { now: clock(Date.parse("2026-08-18T06:30:00.000Z")) },
    );
    expect(state.effects[0].calls[0]).toMatchObject({
      status: "operator_reconciled",
      settlementCode: "operator_reconciled",
      settledAt: expect.any(String),
    });
  });

  it("persists an unknown provider outcome before blocking the outer effect", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "publish", message: "Publish release" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-outcome-unknown",
    );
    const runTask = vi.fn(async (args) => {
      const boundary = {
        type: "model-usage-started",
        callId: "mdl-unknown-1",
        provider: "openai",
        model: "gpt-4o",
        source: "model",
        workflowEffectId: args.workflowEffectId,
        callSequence: 1,
        providerRequestId: workflowProviderRequestId(args.workflowEffectId),
        requestIdentitySemantics: "trace-only",
      };
      args.onUsageBoundary(boundary);
      args.onUsageSettlement({
        ...boundary,
        type: "model-usage-unknown",
        code: "provider_outcome_unknown",
      });
      return completedTask(args);
    });

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-call-outcome-unknown", execution },
        { runTask, now: clock() },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls).toEqual([
      expect.objectContaining({
        kind: "provider",
        status: "outcome_unknown",
        outcomeUnknown: true,
        settlementCode: "provider_outcome_unknown",
        settledAt: expect.any(String),
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      count: 1,
      started: 0,
      outcomeUnknown: 1,
    });
  });

  it("rejects malformed and duplicate call boundaries before another dispatch", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "publish", message: "Publish release" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const malformedStatePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-malformed",
    );
    let malformedBoundaryReturned = false;

    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath: malformedStatePath,
          runId: "run-call-malformed",
          execution,
        },
        {
          runTask: async (args) => {
            args.onUsageBoundary({
              type: "model-usage-started",
              callId: "mdl-malformed-1",
              provider: "openai",
              source: "model",
              workflowEffectId: args.workflowEffectId,
              callSequence: 1,
              providerRequestId: "not-effect-bound",
              requestIdentitySemantics: "trace-only",
            });
            malformedBoundaryReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });
    expect(malformedBoundaryReturned).toBe(false);
    expect(
      readDynamicWorkflowRuntimeState(malformedStatePath).effects[0].calls,
    ).toEqual([]);

    const duplicateStatePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-duplicate",
    );
    let duplicateBoundaryReturned = false;
    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath: duplicateStatePath,
          runId: "run-call-duplicate",
          execution,
        },
        {
          runTask: async (args) => {
            const boundary = {
              type: "model-usage-started",
              callId: "mdl-duplicate-1",
              provider: "openai",
              source: "model",
              workflowEffectId: args.workflowEffectId,
              callSequence: 1,
              providerRequestId: workflowProviderRequestId(
                args.workflowEffectId,
              ),
              requestIdentitySemantics: "trace-only",
            };
            args.onUsageBoundary(boundary);
            args.onUsageBoundary(boundary);
            duplicateBoundaryReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });
    expect(duplicateBoundaryReturned).toBe(false);
    expect(
      readDynamicWorkflowRuntimeState(duplicateStatePath).effects[0].calls,
    ).toEqual([
      expect.objectContaining({
        callId: "mdl-duplicate-1",
        status: "started",
      }),
    ]);
  });

  it("rejects a tampered durable call record even with a recomputed state digest", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "publish", message: "Publish release" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-tamper",
    );
    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-call-tamper", execution },
      {
        runTask: async (args) => {
          const boundary = {
            type: "model-usage-started",
            callId: "mdl-tamper-1",
            provider: "openai",
            source: "model",
            workflowEffectId: args.workflowEffectId,
            callSequence: 1,
            providerRequestId: workflowProviderRequestId(args.workflowEffectId),
            requestIdentitySemantics: "trace-only",
          };
          args.onUsageBoundary(boundary);
          args.onUsageSettlement({
            ...boundary,
            type: "token-usage",
            usage: { input_tokens: 1, output_tokens: 1 },
          });
          return completedTask(args);
        },
        now: clock(),
      },
    );

    const state = readDynamicWorkflowRuntimeState(statePath);
    const tampered = structuredClone(state);
    tampered.effects[0].calls[0].name = "OpenAI";
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(tampered)),
    ).toThrow(/effect-0-call-0-invalid/u);
  });

  it("persists descendant provider and tool calls under an authorized spawn effect", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "delegate", message: "Delegate release review" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-descendant-calls",
    );
    const runTask = vi.fn(async (args) => {
      const nestedEffectId = (ownerEffectId, sequence, callId, tool) =>
        `sha256:${createHash("sha256")
          .update(
            `${ownerEffectId}\0tool\0${String(sequence)}\0${callId}\0${tool}`,
            "utf8",
          )
          .digest("hex")}`;
      const spawnCallId = "tool-spawn-reviewer";
      const spawnEffectId = nestedEffectId(
        args.workflowEffectId,
        1,
        spawnCallId,
        "spawn_sub_agent",
      );
      const spawnBoundary = {
        type: "tool-executing",
        tool: "spawn_sub_agent",
        args: {},
        tool_use_id: spawnCallId,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
        workflowEffectId: args.workflowEffectId,
        workflowChildEffectId: spawnEffectId,
        workflowChildSequence: 1,
      };
      args.onToolCallBoundary(spawnBoundary);

      const providerRequestId = `ccwf_${createHash("sha256")
        .update(`${spawnEffectId}\0model\0${String(1)}`, "utf8")
        .digest("hex")}`;
      const providerBoundary = {
        type: "model-usage-started",
        callId: "mdl-descendant-review",
        provider: "openai",
        model: "gpt-4o",
        source: "subagent",
        workflowRequestSource: "model",
        workflowEffectId: spawnEffectId,
        callSequence: 1,
        providerRequestId,
        requestIdentitySemantics: "trace-only",
      };
      args.onUsageBoundary(providerBoundary);
      let state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls[1]).toMatchObject({
        kind: "provider",
        ownerEffectId: spawnEffectId,
        source: "subagent",
        requestSource: "model",
        status: "started",
      });
      args.onUsageSettlement({
        type: "token-usage",
        callId: providerBoundary.callId,
        provider: "openai",
        source: "subagent",
        usage: { input_tokens: 3, output_tokens: 2 },
      });

      const readCallId = "tool-descendant-read";
      const readEffectId = nestedEffectId(
        spawnEffectId,
        1,
        readCallId,
        "read_file",
      );
      const readBoundary = {
        type: "tool-executing",
        tool: "read_file",
        args: {},
        tool_use_id: readCallId,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
        workflowEffectId: spawnEffectId,
        workflowChildEffectId: readEffectId,
        workflowChildSequence: 1,
      };
      args.onToolCallBoundary(readBoundary);
      args.onToolCallSettlement({
        ...readBoundary,
        type: "tool-result",
        result: { ok: true },
        error: null,
      });
      args.onToolCallSettlement({
        ...spawnBoundary,
        type: "tool-result",
        result: { ok: true },
        error: null,
      });

      state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls).toHaveLength(3);
      return completedTask(args);
    });

    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-descendant-calls", execution },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    const state = readDynamicWorkflowRuntimeState(statePath);
    const projection =
      projectDynamicWorkflowRuntime(state).observability.durableCalls;
    expect(projection).toMatchObject({
      count: 3,
      completed: 3,
      descendants: 2,
    });
    expect(projection.lineage.filter((call) => call.descendant)).toEqual([
      expect.objectContaining({
        ownerEffectId: expect.stringMatching(/^sha256:/u),
        kind: "provider",
        requestSource: "model",
      }),
      expect.objectContaining({
        ownerEffectId: expect.stringMatching(/^sha256:/u),
        kind: "tool",
        name: "read_file",
      }),
    ]);

    const tampered = structuredClone(state);
    tampered.effects[0].calls[1].ownerEffectId = `sha256:${"f".repeat(64)}`;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(tampered)),
    ).toThrow(/effect-0-call-1-invalid/u);
  });

  it("rejects a descendant call whose owner has no durable spawn boundary", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "delegate", message: "Delegate release review" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-descendant-owner-missing",
    );
    let boundaryReturned = false;
    const orphanEffectId = `sha256:${"b".repeat(64)}`;
    const providerRequestId = `ccwf_${createHash("sha256")
      .update(`${orphanEffectId}\0model\0${String(1)}`, "utf8")
      .digest("hex")}`;

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-descendant-owner-missing", execution },
        {
          runTask: async (args) => {
            args.onUsageBoundary({
              type: "model-usage-started",
              callId: "mdl-orphan-descendant",
              provider: "openai",
              source: "subagent",
              workflowRequestSource: "model",
              workflowEffectId: orphanEffectId,
              callSequence: 1,
              providerRequestId,
              requestIdentitySemantics: "trace-only",
            });
            boundaryReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    expect(boundaryReturned).toBe(false);
    expect(readDynamicWorkflowRuntimeState(statePath).effects[0].calls).toEqual(
      [],
    );
  });

  it("does not project a mismatched or idempotency-overclaiming provider receipt", async () => {
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-invalid-provider-receipt",
    );
    const runTask = vi.fn(async (args) => ({
      ...completedTask(args),
      workflowEffectId: args.workflowEffectId,
      providerRequestAttempts: [
        {
          protocol: "cc-provider-request-attempt/v1",
          provider: "openai",
          workflowEffectId: args.workflowEffectId,
          callId: "mdl-invalid",
          callSequence: 1,
          source: "model",
          clientRequestId: `ccwf_${args.workflowEffectId.slice("sha256:".length)}`,
          requestIdentitySemantics: "trace-only",
        },
      ],
      providerRequestReceipts: [
        {
          protocol: "cc-provider-request-receipt/v1",
          provider: "openai",
          workflowEffectId: `sha256:${"f".repeat(64)}`,
          callId: "mdl-invalid",
          callSequence: 1,
          source: "model",
          clientRequestId: `ccwf_${"f".repeat(64)}`,
          requestId: "req_invalid",
          responseId: null,
          requestIdentitySemantics: "idempotent",
          independentlyReadable: true,
        },
      ],
    }));

    await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-invalid-provider-receipt",
        execution: admittedExecution(projectRoot),
      },
      { runTask, now: clock() },
    );
    const projection = projectDynamicWorkflowRuntime(statePath);
    expect(projection.observability.providerReceipts).toMatchObject({
      count: 2,
      projectedRecords: 0,
      requestAttempts: 2,
      projectedRequestAttempts: 2,
      observedEffects: 0,
      missingProviderReturnedEffects: 2,
      missingRequestReceipts: 2,
      invalidRequestAttempts: 0,
      invalidRecords: 2,
      nativeIdempotencyProven: false,
      independentlyReadable: false,
    });
    expect(projection.observability.gaps).toEqual(
      expect.arrayContaining([
        "provider-request-receipt-incomplete",
        "provider-request-receipt-invalid",
      ]),
    );
  });

  it("reports a missing receipt for each effect-bound provider attempt", async () => {
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-partial-provider-receipts",
    );
    const runTask = vi.fn(async (args) => {
      const effectHex = args.workflowEffectId.slice("sha256:".length);
      const compactionRequestId = `ccwf_${effectHex}`;
      const modelRequestId = `ccwf_${effectHex.slice(0, -1)}${effectHex.endsWith("0") ? "1" : "0"}`;
      return {
        ...completedTask(args),
        workflowEffectId: args.workflowEffectId,
        providerRequestAttempts: [
          {
            protocol: "cc-provider-request-attempt/v1",
            provider: "openai",
            workflowEffectId: args.workflowEffectId,
            callId: `cmp-${args.workflowEffect.stepId}`,
            callSequence: 1,
            source: "semantic-compaction",
            clientRequestId: compactionRequestId,
            requestIdentitySemantics: "trace-only",
          },
          {
            protocol: "cc-provider-request-attempt/v1",
            provider: "openai",
            workflowEffectId: args.workflowEffectId,
            callId: `mdl-${args.workflowEffect.stepId}`,
            callSequence: 1,
            source: "model",
            clientRequestId: modelRequestId,
            requestIdentitySemantics: "trace-only",
          },
        ],
        providerRequestReceipts: [
          {
            protocol: "cc-provider-request-receipt/v1",
            provider: "openai",
            workflowEffectId: args.workflowEffectId,
            callId: `cmp-${args.workflowEffect.stepId}`,
            callSequence: 1,
            source: "semantic-compaction",
            clientRequestId: compactionRequestId,
            requestId: `req_cmp_${args.workflowEffect.stepId}`,
            responseId: null,
            requestIdentitySemantics: "trace-only",
            independentlyReadable: false,
          },
        ],
      };
    });

    await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-partial-provider-receipts",
        execution: admittedExecution(projectRoot),
      },
      { runTask, now: clock() },
    );
    const projection = projectDynamicWorkflowRuntime(statePath);
    expect(projection.observability.providerReceipts).toMatchObject({
      count: 2,
      projectedRecords: 2,
      requestAttempts: 4,
      projectedRequestAttempts: 4,
      missingRequestReceipts: 2,
      invalidRequestAttempts: 0,
      invalidRecords: 0,
    });
    expect(projection.observability.gaps).toContain(
      "provider-request-receipt-incomplete",
    );
  });

  it("persists each parallel dispatch batch atomically before any provider call", async () => {
    const workflow = workflowDefinition({
      steps: [
        { id: "collect-a", message: "Collect release evidence A" },
        { id: "collect-b", message: "Collect release evidence B" },
      ],
    });
    workflow.facade.requirements.capabilities.push("parallel");
    const execution = admittedExecution(projectRoot, workflow, 2);
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-parallel");
    let releaseProviders;
    const providersStarted = new Promise((resolve) => {
      releaseProviders = resolve;
    });
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const observedBatches = [];
    const runTask = vi.fn(async (args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const state = readDynamicWorkflowRuntimeState(statePath);
      observedBatches.push(
        state.effects.map((effect) => ({
          id: effect.id,
          status: effect.status,
          batchId: effect.batchId,
          batchIndex: effect.batchIndex,
          batchSize: effect.batchSize,
        })),
      );
      started += 1;
      if (started === 2) releaseProviders();
      await providersStarted;
      active -= 1;
      return completedTask(args);
    });

    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-parallel", execution },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);
    expect(observedBatches).toHaveLength(2);
    for (const observed of observedBatches) {
      expect(observed).toHaveLength(2);
      expect(observed.every((effect) => effect.status === "pending")).toBe(
        true,
      );
      expect(new Set(observed.map((effect) => effect.batchId)).size).toBe(1);
      expect(observed.map((effect) => effect.batchIndex)).toEqual([0, 1]);
      expect(observed.map((effect) => effect.batchSize)).toEqual([2, 2]);
    }
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects).toHaveLength(2);
    expect(state.effects.every((effect) => effect.status === "settled")).toBe(
      true,
    );
    expect(
      state.lineage.filter((event) => event.type === "effect-batch-requested"),
    ).toHaveLength(1);
  });

  it("keeps multiple unknown outcomes blocked until ordered reconciliation completes", async () => {
    const workflow = workflowDefinition({
      steps: [
        { id: "collect-a", message: "Collect release evidence A" },
        { id: "collect-b", message: "Collect release evidence B" },
      ],
    });
    workflow.facade.requirements.capabilities.push("parallel");
    const execution = admittedExecution(projectRoot, workflow, 2);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-parallel-reconcile",
    );
    const runTask = vi.fn(async (args) => completedTask(args));

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-parallel-reconcile", execution },
        {
          runTask,
          now: clock(),
          afterProvider: async () => {
            await Promise.resolve();
            throw new Error("provider response lost after parallel dispatch");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "reconciliation-required",
    });
    expect(runTask).toHaveBeenCalledTimes(2);

    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects).toHaveLength(2);
    expect(state.effects.every((effect) => effect.status === "pending")).toBe(
      true,
    );
    expect(new Set(state.effects.map((effect) => effect.batchId)).size).toBe(1);

    expect(() =>
      reconcileDurableWorkflowEffect(
        statePath,
        {
          expectedRevision: state.revision,
          effectId: state.effects[1].id,
          result: completedTask({
            workflowEffect: state.effects[1],
            userMessage: state.effects[1].stepId,
          }),
        },
        { now: clock(Date.parse("2026-08-18T05:40:00.000Z")) },
      ),
    ).toThrow(/must be reconciled before/u);

    state = reconcileDurableWorkflowEffect(
      statePath,
      {
        expectedRevision: state.revision,
        effectId: state.effects[0].id,
        result: completedTask({
          workflowEffect: state.effects[0],
          userMessage: state.effects[0].stepId,
        }),
      },
      { now: clock(Date.parse("2026-08-18T05:41:00.000Z")) },
    );
    expect(state.status).toBe("blocked");
    expect(state.effects.map((effect) => effect.status)).toEqual([
      "settled",
      "pending",
    ]);

    state = reconcileDurableWorkflowEffect(
      statePath,
      {
        expectedRevision: state.revision,
        effectId: state.effects[1].id,
        result: completedTask({
          workflowEffect: state.effects[1],
          userMessage: state.effects[1].stepId,
        }),
      },
      { now: clock(Date.parse("2026-08-18T05:42:00.000Z")) },
    );
    expect(state.status).toBe("ready");

    const replayTask = vi.fn(async (args) => completedTask(args));
    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-parallel-reconcile", execution },
      {
        runTask: replayTask,
        now: clock(Date.parse("2026-08-18T05:43:00.000Z")),
      },
    );
    expect(record.status).toBe("completed");
    expect(replayTask).not.toHaveBeenCalled();
  });

  it("waits for every in-flight parallel provider to settle before surfacing reconciliation", async () => {
    const workflow = workflowDefinition({
      steps: [
        { id: "collect-a", message: "Collect release evidence A" },
        { id: "collect-b", message: "Collect release evidence B" },
      ],
    });
    workflow.facade.requirements.capabilities.push("parallel");
    const execution = admittedExecution(projectRoot, workflow, 2);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-parallel-barrier",
    );
    let releaseSecond;
    const secondProvider = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    let markBothStarted;
    const bothStarted = new Promise((resolve) => {
      markBothStarted = resolve;
    });
    let started = 0;
    const runTask = vi.fn(async (args) => {
      started += 1;
      if (started === 2) markBothStarted();
      if (args.workflowEffect.stepId === "collect-a") {
        throw new Error("provider A outcome unknown");
      }
      await secondProvider;
      return completedTask(args);
    });
    let executionSettled = false;
    const runPromise = executeDurableDynamicWorkflow(
      { statePath, runId: "run-parallel-barrier", execution },
      { runTask, now: clock() },
    ).finally(() => {
      executionSettled = true;
    });

    await bothStarted;
    await Promise.resolve();
    expect(executionSettled).toBe(false);
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects.map((effect) => effect.status)).toEqual([
      "pending",
      "pending",
    ]);

    releaseSecond();
    await expect(runPromise).rejects.toMatchObject({
      reason: "reconciliation-required",
    });
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects.map((effect) => effect.status)).toEqual([
      "pending",
      "settled",
    ]);
  });

  it("propagates reconciliation control after parallel pipeline providers settle", async () => {
    const workflow = workflowDefinition({
      steps: [
        { id: "collect-a", message: "Collect release evidence A" },
        { id: "collect-b", message: "Collect release evidence B" },
      ],
    });
    workflow.facade.requirements.capabilities.push("parallel", "pipeline");
    workflow.pipeline = true;
    const execution = admittedExecution(projectRoot, workflow, 2, true);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-parallel-pipeline",
    );
    const runTask = vi.fn(async (args) => {
      if (args.workflowEffect.stepId === "collect-a") {
        throw new Error("pipeline provider outcome unknown");
      }
      return completedTask(args);
    });

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-parallel-pipeline", execution },
        { runTask, now: clock() },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "reconciliation-required",
    });
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects.map((effect) => effect.status)).toEqual([
      "pending",
      "settled",
    ]);
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it("keeps pause requested until the parallel settlement barrier closes", async () => {
    const workflow = workflowDefinition({
      steps: [
        { id: "collect-a", message: "Collect release evidence A" },
        { id: "collect-b", message: "Collect release evidence B" },
        {
          id: "review-a",
          message: "Review release evidence A",
          dependsOn: ["collect-a"],
        },
      ],
    });
    workflow.facade.requirements.capabilities.push("parallel");
    const execution = admittedExecution(projectRoot, workflow, 2);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-parallel-pause",
    );
    const runtimeClock = clock();
    let releaseSecond;
    const secondProvider = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    let markBothStarted;
    const bothStarted = new Promise((resolve) => {
      markBothStarted = resolve;
    });
    let started = 0;
    const runTask = vi.fn(async (args) => {
      started += 1;
      if (started === 2) markBothStarted();
      if (args.workflowEffect.stepId === "collect-a") {
        const state = readDynamicWorkflowRuntimeState(statePath);
        requestDurableWorkflowPause(statePath, state.revision, {
          now: runtimeClock,
        });
      } else if (args.workflowEffect.stepId === "collect-b") {
        await secondProvider;
      }
      return completedTask(args);
    });
    let executionSettled = false;
    const runPromise = executeDurableDynamicWorkflow(
      { statePath, runId: "run-parallel-pause", execution },
      { runTask, now: runtimeClock },
    ).finally(() => {
      executionSettled = true;
    });

    await bothStarted;
    await Promise.resolve();
    expect(executionSettled).toBe(false);
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("pause_requested");
    expect(state.effects.some((effect) => effect.status === "pending")).toBe(
      true,
    );

    releaseSecond();
    await expect(runPromise).rejects.toMatchObject({ reason: "paused" });
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("paused");
    expect(state.effects.every((effect) => effect.status === "settled")).toBe(
      true,
    );
    expect(runTask).toHaveBeenCalledTimes(2);
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

  it("persists each explicit failed retry attempt before dispatch", async () => {
    const retryWorkflow = workflowDefinition({
      steps: [
        {
          id: "collect",
          message: "Collect release evidence",
          retries: 1,
        },
      ],
    });
    retryWorkflow.facade.requirements.capabilities.push("retry");
    const statePath = dynamicWorkflowRunStatePath(projectRoot, "run-retry");
    let calls = 0;
    const runTask = vi.fn(async (args) => {
      calls += 1;
      return calls === 1
        ? {
            taskId: "task-collect-failed",
            status: "failed",
            result: { summary: "provider reported a retryable failure" },
          }
        : completedTask(args);
    });

    const record = await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-retry",
        execution: admittedExecution(projectRoot, retryWorkflow),
      },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects.map((effect) => effect.attempt)).toEqual([1, 2]);
    expect(
      state.effects.every(
        (effect) =>
          effect.status === "settled" &&
          effect.settlementAuthority === "provider-return" &&
          typeof effect.providerDispatchedAt === "string",
      ),
    ).toBe(true);
  });

  it("replays a persisted effect only when provider dispatch never started", async () => {
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-before-dispatch-crash",
    );
    const execution = admittedExecution(projectRoot);
    const runTask = vi.fn(async (args) => completedTask(args));

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-before-dispatch-crash", execution },
        {
          beforeProviderDispatch: () => {
            throw new Error("crash before provider dispatch");
          },
          runTask,
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "undispatched-recovery-required",
    });
    expect(runTask).not.toHaveBeenCalled();
    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("running");
    expect(state.effects).toMatchObject([
      {
        status: "pending",
        providerDispatchedAt: null,
      },
    ]);

    state = prepareDurableWorkflowResume(statePath, state.revision, {
      now: clock(Date.parse("2026-08-18T05:50:00.000Z")),
    });
    expect(state.status).toBe("ready");
    const record = await executeDurableDynamicWorkflow(
      { statePath, runId: "run-before-dispatch-crash", execution },
      {
        runTask,
        now: clock(Date.parse("2026-08-18T05:51:00.000Z")),
      },
    );
    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects).toHaveLength(2);
    expect(
      state.effects.every(
        (effect) =>
          effect.status === "settled" &&
          typeof effect.providerDispatchedAt === "string",
      ),
    ).toBe(true);
  });

  it("does not retry a provider that completes successfully after timeout", async () => {
    const timeoutWorkflow = workflowDefinition({
      steps: [
        {
          id: "collect",
          message: "Collect release evidence",
          retries: 2,
          timeoutMs: 5,
        },
      ],
    });
    timeoutWorkflow.facade.requirements.capabilities.push("retry", "timeout");
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-timeout-late-success",
    );
    const runTask = vi.fn(
      (args) =>
        new Promise((resolve) => {
          const finish = () => resolve(completedTask(args));
          if (args.signal.aborted) finish();
          else args.signal.addEventListener("abort", finish, { once: true });
        }),
    );

    const record = await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-timeout-late-success",
        execution: admittedExecution(projectRoot, timeoutWorkflow),
      },
      { runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(1);
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects).toMatchObject([
      {
        attempt: 1,
        status: "settled",
        settlementAuthority: "provider-return",
        timeoutMs: 5,
      },
    ]);
    expect(state.effects[0].timeoutObservedAt).toMatch(/Z$/u);
    expect(state.effects[0].providerDispatchedAt).toMatch(/Z$/u);
    expect(
      projectDynamicWorkflowRuntime(state).observability.effects,
    ).toMatchObject({
      providerDispatched: 1,
      timeoutObserved: 1,
      runtimeNotDispatched: 0,
    });
  });

  it("retries a timeout that expires before provider dispatch", async () => {
    const timeoutWorkflow = workflowDefinition({
      steps: [
        {
          id: "collect",
          message: "Collect release evidence",
          retries: 1,
          timeoutMs: 5,
        },
      ],
    });
    timeoutWorkflow.facade.requirements.capabilities.push("retry", "timeout");
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-timeout-before-dispatch",
    );
    let dispatchChecks = 0;
    const beforeProviderDispatch = vi.fn(async (_effect, args) => {
      dispatchChecks += 1;
      if (dispatchChecks !== 1) return;
      await new Promise((resolve) => {
        if (args.signal.aborted) resolve();
        else args.signal.addEventListener("abort", resolve, { once: true });
      });
    });
    const runTask = vi.fn(async (args) => completedTask(args));

    const record = await executeDurableDynamicWorkflow(
      {
        statePath,
        runId: "run-timeout-before-dispatch",
        execution: admittedExecution(projectRoot, timeoutWorkflow),
      },
      { beforeProviderDispatch, runTask, now: clock() },
    );

    expect(record.status).toBe("completed");
    expect(beforeProviderDispatch).toHaveBeenCalledTimes(2);
    expect(runTask).toHaveBeenCalledTimes(1);
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects).toMatchObject([
      {
        attempt: 1,
        status: "settled",
        settlementAuthority: "runtime-not-dispatched",
        providerDispatchedAt: null,
      },
      {
        attempt: 2,
        status: "settled",
        settlementAuthority: "provider-return",
      },
    ]);
    expect(state.effects[0].timeoutObservedAt).toMatch(/Z$/u);
    expect(state.effects[1].providerDispatchedAt).toMatch(/Z$/u);
    expect(
      projectDynamicWorkflowRuntime(state).observability.effects,
    ).toMatchObject({
      providerDispatched: 1,
      timeoutObserved: 1,
      runtimeNotDispatched: 1,
    });
  });

  it("blocks without retry when a timed-out provider outcome is unknown", async () => {
    const timeoutWorkflow = workflowDefinition({
      steps: [
        {
          id: "collect",
          message: "Collect release evidence",
          retries: 2,
          timeoutMs: 5,
        },
      ],
    });
    timeoutWorkflow.facade.requirements.capabilities.push("retry", "timeout");
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-timeout-unknown",
    );
    const runTask = vi.fn(
      (args) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new Error("provider outcome unknown"));
          if (args.signal.aborted) fail();
          else args.signal.addEventListener("abort", fail, { once: true });
        }),
    );

    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath,
          runId: "run-timeout-unknown",
          execution: admittedExecution(projectRoot, timeoutWorkflow),
        },
        { runTask, now: clock() },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "reconciliation-required",
    });
    expect(runTask).toHaveBeenCalledTimes(1);
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("blocked");
    expect(state.effects).toMatchObject([
      {
        attempt: 1,
        status: "pending",
      },
    ]);
    expect(state.effects[0].timeoutObservedAt).toMatch(/Z$/u);
    expect(state.effects[0].providerDispatchedAt).toMatch(/Z$/u);
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
