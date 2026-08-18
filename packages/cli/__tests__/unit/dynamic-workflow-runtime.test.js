import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  readDynamicWorkflowInputResponseFile,
  readDynamicWorkflowRuntimeState,
  recoverDurableWorkflowCheckpointCall,
  recoverDurableWorkflowCheckpointCalls,
  reconcileDurableWorkflowEffect,
  requestDurableWorkflowPause,
  requestDurableWorkflowStop,
  submitDurableWorkflowInput,
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
import {
  ArtifactStore,
  publicArtifactMetadata,
} from "../../src/lib/artifact-store.js";
import { WorkspaceTransactionManager } from "../../src/lib/process-execution-broker/workspace-transaction.js";
import { managedToolCheckpointBinding } from "../../src/lib/managed-tool-checkpoint.js";

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

function withRebuiltRuntimeLineage(state, lineage) {
  const rebuilt = structuredClone(state);
  let previousDigest = null;
  rebuilt.lineage = lineage.map((event, index) => {
    const material = {
      sequence: index + 1,
      revision: index + 1,
      at: event.at,
      type: event.type,
      details: event.details,
      previousDigest,
    };
    const next = {
      ...material,
      eventDigest: `sha256:${createHash("sha256")
        .update("chainlesschain.dynamic-workflow.runtime-event.v1\0", "utf8")
        .update(canonicalJson(material, "dynamicWorkflowRuntime"), "utf8")
        .digest("hex")}`,
    };
    previousDigest = next.eventDigest;
    return next;
  });
  rebuilt.revision = rebuilt.lineage.length;
  rebuilt.updatedAt = rebuilt.lineage.at(-1).at;
  return withRuntimeStateDigest(rebuilt);
}

function projectLegacyResultOnlyState(statePath) {
  const legacyState = readDynamicWorkflowRuntimeState(statePath);
  for (const effect of legacyState.effects) delete effect.calls;
  return projectDynamicWorkflowRuntime(withRuntimeStateDigest(legacyState));
}

function workflowProviderRequestId(effectId, source = "model", sequence = 1) {
  return `ccwf_${createHash("sha256")
    .update(`${effectId}\0${source}\0${String(sequence)}`, "utf8")
    .digest("hex")}`;
}

function workflowProviderReceipt(boundary, overrides = {}) {
  return {
    protocol: "cc-provider-request-receipt/v1",
    provider: boundary.provider,
    workflowEffectId: boundary.workflowEffectId,
    callId: boundary.callId,
    callSequence: boundary.callSequence,
    source: boundary.workflowRequestSource || boundary.source,
    clientRequestId: boundary.providerRequestId,
    requestId: `req_${boundary.callId}`,
    responseId: `resp_${boundary.callId}`,
    requestIdentitySemantics: "trace-only",
    independentlyReadable: false,
    ...overrides,
  };
}

function workflowProviderReceiptEvent(boundary, overrides = {}) {
  const providerReceipt = workflowProviderReceipt(boundary, overrides);
  return {
    type: "provider-request-receipt",
    ...providerReceipt,
    source: boundary.source,
    workflowRequestSource: boundary.workflowRequestSource || boundary.source,
    providerReceipt,
  };
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

function workflowToolBoundary(
  args,
  { tool, toolUseId, sequence = 1, ownerEffectId = args.workflowEffectId },
) {
  const childEffectId = `sha256:${createHash("sha256")
    .update(
      `${ownerEffectId}\0tool\0${String(sequence)}\0${toolUseId}\0${tool}`,
      "utf8",
    )
    .digest("hex")}`;
  return {
    type: "tool-executing",
    tool,
    args: {},
    tool_use_id: toolUseId,
    workflowEffectProtocol: "cc-workflow-child-effect/v1",
    workflowEffectId: ownerEffectId,
    workflowChildEffectId: childEffectId,
    workflowChildSequence: sequence,
  };
}

function checkpointManager(root, label) {
  let sequence = 0;
  return new WorkspaceTransactionManager({
    stateDir: join(root, `${label}-checkpoint-state`),
    lockDir: join(root, `${label}-checkpoint-locks`),
    allowNonCanonicalLockDirForTests: true,
    now: () => Date.parse("2026-08-18T05:45:00.000Z") + sequence * 1000,
    uuid: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ownerToken: () =>
      `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
}

function transactionCheckpointBinding(transaction) {
  return managedToolCheckpointBinding({
    skipped: false,
    transactionId: transaction.id,
    checkpointId: transaction.checkpointId,
    prepared: transaction.snapshot(),
  });
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
      authority: "runtime-state-hash-chain-fsync",
      receiptSemantics: "provider-returned-trace-only",
      crashVisible: true,
      durableCallEffects: 0,
      legacyResultFallbackEffects: 0,
      conflictingOuterResultEffects: 2,
      count: 0,
      projectedRecords: 0,
      requestAttempts: 0,
      projectedRequestAttempts: 0,
      requestAttemptEffects: 0,
      observedEffects: 0,
      missingProviderReturnedEffects: 2,
      missingRequestReceipts: 0,
      invalidRequestAttempts: 0,
      invalidRecords: 0,
      nativeIdempotencyProven: false,
      independentlyReadable: false,
    });
    expect(projection.observability.providerReceipts.lineage).toEqual([]);
    expect(projection.observability.gaps).toEqual(
      expect.arrayContaining([
        "provider-request-receipt-incomplete",
        "provider-request-result-disagrees-with-durable-store",
      ]),
    );

    const legacyState = structuredClone(state);
    for (const effect of legacyState.effects) delete effect.calls;
    const legacyProjection = projectDynamicWorkflowRuntime(
      withRuntimeStateDigest(legacyState),
    );
    expect(legacyProjection.observability.providerReceipts).toMatchObject({
      authority:
        "runtime-state-hash-chain-fsync-with-legacy-task-result-fallback",
      durableCallEffects: 0,
      legacyResultFallbackEffects: 2,
      conflictingOuterResultEffects: 0,
      count: 2,
      projectedRecords: 2,
      requestAttempts: 2,
      projectedRequestAttempts: 2,
      requestAttemptEffects: 2,
      observedEffects: 2,
      missingProviderReturnedEffects: 0,
    });
    expect(legacyProjection.observability.providerReceipts.lineage).toEqual([
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
      authority: "runtime-state-hash-chain-fsync",
      crashVisible: true,
      durableCallEffects: 0,
      legacyResultFallbackEffects: 0,
      conflictingOuterResultEffects: 2,
      attempts: 0,
      settlements: 0,
      projectedAttempts: 0,
      projectedSettlements: 0,
      durableMcpSettlements: 0,
      missingSettlements: 0,
      invalidAttempts: 0,
      invalidSettlements: 0,
      allEffectsIndependentlyDurable: true,
    });
    expect(projection.observability.nestedEffects.settlementLineage).toEqual(
      [],
    );
    expect(projection.observability.gaps).toContain(
      "nested-tool-result-disagrees-with-durable-store",
    );
    expect(legacyProjection.observability.nestedEffects).toMatchObject({
      authority:
        "runtime-state-hash-chain-fsync-with-legacy-task-result-fallback",
      durableCallEffects: 0,
      legacyResultFallbackEffects: 2,
      conflictingOuterResultEffects: 0,
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
    expect(
      legacyProjection.observability.nestedEffects.settlementLineage,
    ).toEqual([
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
    expect(legacyProjection.observability.gaps).toEqual(
      expect.arrayContaining([
        "provider-native-idempotency-unavailable",
        "provider-receipt-independent-readback-unavailable",
        "provider-request-receipt-legacy-result-fallback",
        "nested-tool-independent-ledger-incomplete",
      ]),
    );
    expect(legacyProjection.observability.gaps).not.toContain(
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
          providerModel: "gpt-4o",
          providerPricing: expect.objectContaining({
            authority: "builtin-public-list-estimate",
            inputUsdPerMillion: 2.5,
            outputUsdPerMillion: 10,
            cacheReadMultiplier: 0.5,
            cacheCreationMultiplier: 1.25,
          }),
          providerCostEstimate: null,
        }),
      ]);
      args.onProviderReceipt(workflowProviderReceiptEvent(providerBoundary));
      state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls[0]).toMatchObject({
        status: "started",
        providerReceiptPersisted: true,
        providerReceiptRecordedAt: expect.any(String),
      });
      args.onUsageSettlement({
        type: "token-usage",
        callId: providerBoundary.callId,
        provider: "openai",
        model: "gpt-4o",
        usage: {
          input_tokens: 2,
          output_tokens: 1,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 4,
        },
        providerReceipt: workflowProviderReceipt(providerBoundary),
      });
      state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.effects[0].calls[0].providerUsage).toMatchObject({
        inputTokens: 2,
        outputTokens: 1,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        totalTokens: 10,
      });
      expect(
        projectDynamicWorkflowRuntime(state).observability.tokens
          .providerReported,
      ).toMatchObject({ totalTokens: 10 });
      expect(state.effects[0].calls[0].providerCostEstimate).toMatchObject({
        schema: "cc-provider-cost-estimate/v1",
        authority: "durable-pricing-snapshot-estimate",
        currency: "USD",
        totalUsd: 0.00003125,
      });
      expect(
        projectDynamicWorkflowRuntime(state).observability.cost.estimatedUsd,
      ).toBeCloseTo(0.00003125, 12);

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
      expect(
        projectDynamicWorkflowRuntime(state).observability.nestedEffects,
      ).toMatchObject({
        authority: "runtime-state-hash-chain-fsync",
        crashVisible: true,
        attempts: 1,
        settlements: 0,
        missingSettlements: 1,
        attemptLineage: [
          expect.objectContaining({
            authoritySource: "durable-call-store",
            childEffectId,
            status: "started",
          }),
        ],
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
      return {
        ...completedTask(args),
        providerRequestAttempts: [{ forged: "ignored-result-attempt" }],
        providerRequestReceipts: [{ forged: "ignored-result-receipt" }],
      };
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
        providerReceiptPersisted: true,
        providerReceiptRequestId: "req_mdl-publish-1",
        providerReceiptResponseId: "resp_mdl-publish-1",
        providerReceiptRecordedAt: expect.any(String),
        providerUsage: {
          schema: "cc-provider-token-usage/v1",
          inputTokens: 2,
          outputTokens: 1,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
          totalTokens: 10,
        },
        providerModel: "gpt-4o",
        providerCostEstimate: expect.objectContaining({
          authority: "durable-pricing-snapshot-estimate",
          totalUsd: 0.00003125,
        }),
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
      state.lineage.filter(
        (event) => event.type === "effect-call-receipt-recorded",
      ),
    ).toHaveLength(1);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      count: 2,
      started: 0,
      completed: 2,
      outcomeUnknown: 0,
      providerReceipts: 1,
      providerUsageRecords: 1,
      providerCostEstimateRecords: 1,
      providerNativeIdempotencyProven: false,
      providerReceiptsIndependentlyReadable: false,
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.providerReceipts,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      receiptSemantics: "provider-returned-trace-only",
      crashVisible: true,
      durableCallEffects: 1,
      legacyResultFallbackEffects: 0,
      conflictingOuterResultEffects: 1,
      count: 1,
      projectedRecords: 1,
      requestAttempts: 1,
      projectedRequestAttempts: 1,
      invalidRequestAttempts: 0,
      invalidRecords: 0,
      missingRequestReceipts: 0,
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.providerReceipts
        .lineage,
    ).toEqual([
      expect.objectContaining({
        authoritySource: "durable-call-store",
        callId: "mdl-publish-1",
        status: "completed",
        requestId: "req_mdl-publish-1",
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.gaps,
    ).not.toContain("provider-request-receipt-incomplete");
    expect(
      projectDynamicWorkflowRuntime(state).observability.gaps,
    ).not.toContain("provider-request-receipt-legacy-result-fallback");
    expect(
      projectDynamicWorkflowRuntime(state).observability.tokens,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      crashVisible: true,
      providerCalls: 1,
      providerReportedCalls: 1,
      providerReportedEffects: 1,
      missingProviderReportedCalls: 0,
      pendingCalls: 0,
      outcomeUnknownCalls: 0,
      legacyCalls: 0,
      providerReported: {
        inputTokens: 2,
        outputTokens: 1,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        totalTokens: 10,
      },
      estimateAuthority: "cowork-result-heuristic",
      estimated: 10,
    });
    for (const gap of [
      "provider-token-usage-unavailable",
      "provider-token-usage-incomplete",
      "provider-token-usage-legacy-call-schema",
    ]) {
      expect(
        projectDynamicWorkflowRuntime(state).observability.gaps,
      ).not.toContain(gap);
    }
    expect(
      projectDynamicWorkflowRuntime(state).observability.cost,
    ).toMatchObject({
      authority: "durable-pricing-snapshot-estimate",
      currency: "USD",
      reportedUsd: null,
      estimatedUsd: 0.00003125,
      providerCalls: 1,
      pricingSnapshotCalls: 1,
      pricedCalls: 1,
      pricedEffects: 1,
      missingEstimateCalls: 0,
      pendingCalls: 0,
      outcomeUnknownCalls: 0,
      unpricedCalls: 0,
      modelMissingCalls: 0,
      legacyCalls: 0,
      lineage: [
        expect.objectContaining({
          provider: "openai",
          model: "gpt-4o",
          estimate: expect.objectContaining({ totalUsd: 0.00003125 }),
        }),
      ],
    });
    for (const gap of [
      "provider-cost-estimate-unavailable",
      "provider-cost-estimate-incomplete",
      "provider-cost-estimate-legacy-call-schema",
    ]) {
      expect(
        projectDynamicWorkflowRuntime(state).observability.gaps,
      ).not.toContain(gap);
    }
    expect(projectDynamicWorkflowRuntime(state).observability.gaps).toContain(
      "provider-cost-usd-unavailable",
    );
    expect(projectDynamicWorkflowRuntime(state).observability.gaps).toContain(
      "provider-request-result-disagrees-with-durable-store",
    );
    expect(
      projectDynamicWorkflowRuntime(state).observability.nestedEffects,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      crashVisible: true,
      durableCallEffects: 1,
      legacyResultFallbackEffects: 0,
      conflictingOuterResultEffects: 0,
      attempts: 1,
      settlements: 1,
      projectedAttempts: 1,
      projectedSettlements: 1,
      durableMcpSettlements: 1,
      missingSettlements: 0,
      allEffectsIndependentlyDurable: true,
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.nestedEffects
        .settlementLineage,
    ).toEqual([
      expect.objectContaining({
        authoritySource: "durable-call-store",
        toolUseId: "tool-publish-1",
        status: "completed",
        mcpLedgerSettlementPersisted: true,
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.gaps,
    ).not.toContain("nested-tool-independent-ledger-incomplete");
  });

  it("rejects accessor-backed provider usage without mutating the started call", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-provider-usage-accessor",
    );
    let getterRead = false;
    let settlementReturned = false;

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-provider-usage-accessor", execution },
        {
          runTask: async (args) => {
            const boundary = {
              type: "model-usage-started",
              callId: "mdl-provider-usage-accessor-1",
              provider: "openai",
              source: "model",
              workflowEffectId: args.workflowEffectId,
              callSequence: 1,
              providerRequestId: workflowProviderRequestId(
                args.workflowEffectId,
              ),
              requestIdentitySemantics: "trace-only",
            };
            const usage = { output_tokens: 1 };
            Object.defineProperty(usage, "input_tokens", {
              enumerable: true,
              get() {
                getterRead = true;
                return 1;
              },
            });
            args.onUsageBoundary(boundary);
            args.onUsageSettlement({
              ...boundary,
              type: "token-usage",
              usage,
            });
            settlementReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    expect(getterRead).toBe(false);
    expect(settlementReturned).toBe(false);
    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls).toEqual([
      expect.objectContaining({
        status: "started",
        providerUsage: null,
        settledAt: null,
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.tokens,
    ).toMatchObject({
      providerCalls: 1,
      providerReportedCalls: 0,
      missingProviderReportedCalls: 1,
      pendingCalls: 1,
      providerReported: null,
    });
  });

  it("persists verified ArtifactStore index and byte readback before the outer task settles", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "publish", message: "Publish release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-artifact-readback",
    );
    const artifactStore = new ArtifactStore({
      dir: join(root, "artifact-store"),
      now: () => Date.parse("2026-08-18T05:30:00.000Z"),
    });
    const sourcePath = join(root, "release-evidence.md");
    writeFileSync(sourcePath, "verified release evidence\n", "utf8");
    let readbackVisibleBeforeReturn = false;

    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-artifact-readback", execution },
      {
        artifactStore,
        runTask: async (args) => {
          const boundary = workflowToolBoundary(args, {
            tool: "publish_artifact",
            toolUseId: "tool-publish-artifact-1",
          });
          args.onToolCallBoundary(boundary);
          const entry = artifactStore.publish({
            filePath: sourcePath,
            title: "Release evidence",
            kind: "report",
            sessionId: "workflow-session-1",
          });
          args.onToolCallSettlement({
            ...boundary,
            type: "tool-result",
            result: { published: publicArtifactMetadata(entry) },
          });
          const pending = readDynamicWorkflowRuntimeState(statePath);
          expect(pending.effects[0]).toMatchObject({
            status: "pending",
            calls: [
              expect.objectContaining({
                name: "publish_artifact",
                status: "completed",
                artifactReadback: expect.objectContaining({
                  schema: "cc-dynamic-workflow-artifact-readback/v1",
                  authority: "artifact-store-index-and-bytes-at-settlement",
                  metadata: expect.objectContaining({
                    id: entry.id,
                    title: "Release evidence",
                    sha256: entry.sha256,
                  }),
                  contentDigest: `sha256:${entry.sha256}`,
                }),
              }),
            ],
          });
          readbackVisibleBeforeReturn = true;
          return completedTask(args);
        },
        now: clock(),
      },
    );

    expect(readbackVisibleBeforeReturn).toBe(true);
    const state = readDynamicWorkflowRuntimeState(statePath);
    const projection = projectDynamicWorkflowRuntime(state);
    expect(projection.observability.durableCalls).toMatchObject({
      artifactReadbackRecords: 1,
    });
    expect(projection.observability.artifacts.storeReadbacks).toMatchObject({
      authority: "artifact-store-index-and-bytes-at-settlement",
      verificationTiming: "tool-settlement",
      immutableRetentionProven: false,
      artifactCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      verifiedCalls: 1,
      verifiedEffects: 1,
      missingReadbacks: 0,
      pendingCalls: 0,
      outcomeUnknownCalls: 0,
      operatorReconciledCalls: 0,
      legacyCalls: 0,
      lineage: [
        expect.objectContaining({
          descendant: false,
          readback: expect.objectContaining({
            metadata: expect.objectContaining({ title: "Release evidence" }),
          }),
        }),
      ],
    });
    for (const gap of [
      "artifact-store-readback-unavailable",
      "artifact-store-readback-incomplete",
      "artifact-store-readback-legacy-call-schema",
    ]) {
      expect(projection.observability.gaps).not.toContain(gap);
    }
    expect(projection.observability.gaps).toContain(
      "artifact-store-immutable-retention-unavailable",
    );
    let currentProjection = projectDynamicWorkflowRuntime(state, {
      currentStoreReadback: true,
      artifactStore,
      checkpointStore: { inspect: vi.fn() },
    });
    expect(currentProjection.currentStoreReadbacks).toMatchObject({
      complete: true,
      eligibleCalls: 1,
      verifiedCalls: 1,
      artifacts: {
        eligibleCalls: 1,
        verifiedCalls: 1,
        unavailableCalls: 0,
        lineage: [{ status: "verified" }],
      },
      gaps: [],
    });
    writeFileSync(
      artifactStore.storedPath(
        state.effects[0].calls[0].artifactReadback.metadata,
      ),
      "tampered after settlement\n",
      "utf8",
    );
    currentProjection = projectDynamicWorkflowRuntime(state, {
      currentStoreReadback: true,
      artifactStore,
      checkpointStore: { inspect: vi.fn() },
    });
    expect(currentProjection.currentStoreReadbacks).toMatchObject({
      complete: false,
      eligibleCalls: 1,
      verifiedCalls: 0,
      artifacts: { unavailableCalls: 1 },
      gaps: ["artifact-store-current-readback-unavailable"],
    });

    const tampered = structuredClone(state);
    tampered.effects[0].calls[0].artifactReadback.metadata.title = "Forged";
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(tampered)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const downgraded = structuredClone(state);
    delete downgraded.effects[0].calls[0].artifactReadback;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(downgraded)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const legacy = structuredClone(state);
    delete legacy.effects[0].calls[0].artifactReadback;
    for (const event of legacy.lineage) {
      if (event.type === "effect-call-started") {
        delete event.details.artifactReadbackSchema;
      }
      if (event.type === "effect-call-settled") {
        delete event.details.artifactReadbackDigest;
      }
    }
    const verifiedLegacy = verifyDynamicWorkflowRuntimeState(
      withRebuiltRuntimeLineage(legacy, legacy.lineage),
    );
    expect(
      projectDynamicWorkflowRuntime(verifiedLegacy).observability.artifacts
        .storeReadbacks,
    ).toMatchObject({
      authority:
        "artifact-store-index-and-bytes-at-settlement-with-legacy-call-schema",
      artifactCalls: 1,
      verifiedCalls: 0,
      missingReadbacks: 1,
      legacyCalls: 1,
    });
    expect(
      projectDynamicWorkflowRuntime(verifiedLegacy).observability.gaps,
    ).toEqual(
      expect.arrayContaining([
        "artifact-store-readback-unavailable",
        "artifact-store-readback-incomplete",
        "artifact-store-readback-legacy-call-schema",
      ]),
    );
  });

  it.each(["forged-metadata", "tampered-bytes"])(
    "rejects a publish_artifact settlement with %s",
    async (failureMode) => {
      const workflow = workflowDefinition({
        steps: [{ id: "publish", message: "Publish release evidence" }],
      });
      const execution = admittedExecution(projectRoot, workflow);
      const runId = `run-artifact-${failureMode}`;
      const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
      const artifactStore = new ArtifactStore({
        dir: join(root, `artifact-store-${failureMode}`),
        now: () => Date.parse("2026-08-18T05:31:00.000Z"),
      });
      const sourcePath = join(root, `release-${failureMode}.md`);
      writeFileSync(sourcePath, "original artifact bytes\n", "utf8");
      let settlementReturned = false;

      await expect(
        executeDurableDynamicWorkflow(
          { statePath, runId, execution },
          {
            artifactStore,
            runTask: async (args) => {
              const boundary = workflowToolBoundary(args, {
                tool: "publish_artifact",
                toolUseId: `tool-artifact-${failureMode}`,
              });
              args.onToolCallBoundary(boundary);
              const entry = artifactStore.publish({
                filePath: sourcePath,
                title: "Release evidence",
                kind: "report",
              });
              const published = publicArtifactMetadata(entry);
              if (failureMode === "forged-metadata") {
                published.title = "Forged release evidence";
              } else {
                writeFileSync(
                  artifactStore.storedPath(entry),
                  "tampered artifact bytes\n",
                  "utf8",
                );
              }
              args.onToolCallSettlement({
                ...boundary,
                type: "tool-result",
                result: { published },
              });
              settlementReturned = true;
              return completedTask(args);
            },
            now: clock(),
          },
        ),
      ).rejects.toMatchObject({ reason: "reconciliation-required" });

      expect(settlementReturned).toBe(false);
      const state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.status).toBe("blocked");
      expect(state.effects[0].calls).toEqual([
        expect.objectContaining({
          name: "publish_artifact",
          status: "started",
          artifactReadback: null,
        }),
      ]);
      expect(
        projectDynamicWorkflowRuntime(state).observability.artifacts
          .storeReadbacks,
      ).toMatchObject({
        artifactCalls: 1,
        verifiedCalls: 0,
        missingReadbacks: 1,
        pendingCalls: 1,
      });
      expect(projectDynamicWorkflowRuntime(state).observability.gaps).toEqual(
        expect.arrayContaining([
          "artifact-store-readback-unavailable",
          "artifact-store-readback-incomplete",
        ]),
      );
    },
  );

  it("persists a committed managed checkpoint store readback before the outer task settles", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "write", message: "Write release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-checkpoint-commit",
    );
    const checkpointStore = checkpointManager(root, "commit");
    let readbackVisibleBeforeReturn = false;

    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-checkpoint-commit", execution },
      {
        checkpointStore,
        runTask: async (args) => {
          expect(args.managedCheckpoint).toBe(true);
          expect(args.managedCheckpointExclusions).toEqual(
            expect.arrayContaining([expect.stringContaining("workflow-runs")]),
          );
          const transaction = checkpointStore.begin({
            id: "wcp-workflow-commit",
            runId: "run-checkpoint-commit",
            taskKey: "write-release-evidence",
            workspaceRoot: args.cwd,
            coverageTarget: "partial",
            writerIsolation: "unknown",
            externalSideEffects: false,
            exclusions: args.managedCheckpointExclusions,
          });
          const boundary = {
            ...workflowToolBoundary(args, {
              tool: "write_file",
              toolUseId: "tool-checkpoint-commit-1",
            }),
            managedCheckpointBinding: transactionCheckpointBinding(transaction),
          };
          args.onToolCallBoundary(boundary);
          writeFileSync(
            join(projectRoot, "release-evidence.md"),
            "committed evidence\n",
            "utf8",
          );
          const evidence = transaction.accept();
          args.onToolCallSettlement({
            ...boundary,
            type: "tool-result",
            result: {
              ok: true,
              managedCheckpoint: {
                skipped: false,
                toolName: "write_file",
                transactionId: transaction.id,
                checkpointId: transaction.checkpointId,
                evidence,
                coverage: evidence.coverage,
                fileCoverage: evidence.fileCoverage,
              },
            },
            error: null,
          });
          const pending = readDynamicWorkflowRuntimeState(statePath);
          expect(pending.effects[0]).toMatchObject({
            status: "pending",
            calls: [
              expect.objectContaining({
                name: "write_file",
                status: "completed",
                checkpointBinding: expect.objectContaining({
                  schema: "cc-managed-tool-checkpoint-binding/v1",
                  transactionId: "wcp-workflow-commit",
                }),
                checkpointReadback: expect.objectContaining({
                  schema: "cc-dynamic-workflow-checkpoint-readback/v1",
                  authority: "workspace-transaction-store-terminal-readback",
                  transactionId: "wcp-workflow-commit",
                  outcome: "committed",
                  coverage: "partial",
                  fileCoverage: "partial",
                  externalSideEffects: false,
                }),
              }),
            ],
          });
          readbackVisibleBeforeReturn = true;
          return completedTask(args);
        },
        now: clock(),
      },
    );

    expect(readbackVisibleBeforeReturn).toBe(true);
    const state = readDynamicWorkflowRuntimeState(statePath);
    const projection = projectDynamicWorkflowRuntime(state);
    expect(projection.observability.durableCalls).toMatchObject({
      checkpointReadbackRecords: 1,
      checkpointBindingRecords: 1,
    });
    expect(projection.observability.checkpoints.storeReadbacks).toMatchObject({
      authority: "workspace-transaction-store-terminal-readback",
      verificationTiming: "tool-settlement",
      rollbackScope: "workspace-files-only",
      externalSideEffectsRollbackProven: false,
      toolCalls: 1,
      completedCalls: 1,
      failedCalls: 0,
      verifiedCalls: 1,
      verifiedEffects: 1,
      committedCalls: 1,
      rolledBackCalls: 0,
      fullCoverageCalls: 0,
      partialCoverageCalls: 1,
      externalSideEffectCalls: 0,
      preparedBindingCalls: 1,
      terminalStoreRecoveredCalls: 0,
      bindingLegacyCalls: 0,
      missingReadbacks: 0,
      legacyCalls: 0,
      lineage: [
        expect.objectContaining({
          tool: "write_file",
          descendant: false,
          readback: expect.objectContaining({ outcome: "committed" }),
        }),
      ],
    });
    const currentProjection = projectDynamicWorkflowRuntime(state, {
      currentStoreReadback: true,
      artifactStore: {
        get: vi.fn(),
        verifyIntegrity: vi.fn(),
      },
      checkpointStore,
    });
    expect(currentProjection.currentStoreReadbacks).toMatchObject({
      complete: true,
      eligibleCalls: 1,
      verifiedCalls: 1,
      checkpoints: {
        eligibleCalls: 1,
        verifiedCalls: 1,
        unavailableCalls: 0,
        lineage: [{ status: "verified" }],
      },
      gaps: [],
    });
    expect(
      projectDynamicWorkflowRuntime(state, {
        currentStoreReadback: true,
        artifactStore: {
          get: vi.fn(),
          verifyIntegrity: vi.fn(),
        },
        checkpointStore: {
          inspect: vi.fn(() => {
            throw new Error("transaction store offline");
          }),
        },
      }).currentStoreReadbacks,
    ).toMatchObject({
      complete: false,
      eligibleCalls: 1,
      verifiedCalls: 0,
      checkpoints: { unavailableCalls: 1 },
      gaps: ["checkpoint-store-current-readback-unavailable"],
    });
    for (const gap of [
      "checkpoint-provider-readback-unavailable",
      "checkpoint-store-readback-incomplete",
      "checkpoint-store-readback-legacy-call-schema",
      "checkpoint-external-side-effect-rollback-unavailable",
    ]) {
      expect(projection.observability.gaps).not.toContain(gap);
    }
    expect(projection.observability.gaps).toContain(
      "checkpoint-full-coverage-incomplete",
    );

    const tampered = structuredClone(state);
    tampered.effects[0].calls[0].checkpointReadback.outcome = "rolled_back";
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(tampered)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const downgraded = structuredClone(state);
    delete downgraded.effects[0].calls[0].checkpointReadback;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(downgraded)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const legacy = structuredClone(state);
    delete legacy.effects[0].calls[0].checkpointReadback;
    delete legacy.effects[0].calls[0].checkpointBinding;
    for (const event of legacy.lineage) {
      if (event.type === "effect-call-started") {
        delete event.details.checkpointReadbackSchema;
        delete event.details.checkpointBindingDigest;
      }
      if (event.type === "effect-call-settled") {
        delete event.details.checkpointReadbackDigest;
      }
    }
    const verifiedLegacy = verifyDynamicWorkflowRuntimeState(
      withRebuiltRuntimeLineage(legacy, legacy.lineage),
    );
    const legacyProjection = projectDynamicWorkflowRuntime(verifiedLegacy);
    expect(
      legacyProjection.observability.checkpoints.storeReadbacks,
    ).toMatchObject({
      authority:
        "workspace-transaction-store-terminal-readback-with-legacy-call-schema",
      toolCalls: 1,
      verifiedCalls: 0,
      missingReadbacks: 1,
      legacyCalls: 1,
    });
    expect(legacyProjection.observability.gaps).toEqual(
      expect.arrayContaining([
        "checkpoint-provider-readback-unavailable",
        "checkpoint-store-readback-incomplete",
        "checkpoint-store-readback-legacy-call-schema",
      ]),
    );
  });

  it("persists a rolled-back checkpoint store readback for a failed tool", async () => {
    mkdirSync(projectRoot, { recursive: true });
    const targetPath = join(projectRoot, "release-state.txt");
    writeFileSync(targetPath, "before\n", "utf8");
    const workflow = workflowDefinition({
      steps: [{ id: "edit", message: "Edit release state" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-checkpoint-rollback",
    );
    const checkpointStore = checkpointManager(root, "rollback");

    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-checkpoint-rollback", execution },
      {
        checkpointStore,
        runTask: async (args) => {
          const transaction = checkpointStore.begin({
            id: "wcp-workflow-rollback",
            runId: "run-checkpoint-rollback",
            taskKey: "edit-release-state",
            workspaceRoot: args.cwd,
            coverageTarget: "partial",
            writerIsolation: "unknown",
            externalSideEffects: false,
            exclusions: args.managedCheckpointExclusions,
          });
          const boundary = {
            ...workflowToolBoundary(args, {
              tool: "edit_file",
              toolUseId: "tool-checkpoint-rollback-1",
            }),
            managedCheckpointBinding: transactionCheckpointBinding(transaction),
          };
          args.onToolCallBoundary(boundary);
          writeFileSync(targetPath, "after\n", "utf8");
          const evidence = transaction.rollback({ reason: "tool failed" });
          expect(readFileSync(targetPath, "utf8")).toBe("before\n");
          args.onToolCallSettlement({
            ...boundary,
            type: "tool-result",
            result: {
              error: "tool failed",
              managedCheckpoint: {
                skipped: false,
                toolName: "edit_file",
                transactionId: transaction.id,
                checkpointId: transaction.checkpointId,
                evidence,
                coverage: evidence.coverage,
                fileCoverage: evidence.fileCoverage,
              },
            },
            error: "tool failed",
          });
          return completedTask(args);
        },
        now: clock(),
      },
    );

    expect(
      readDynamicWorkflowRuntimeState(statePath).effects[0].calls[0],
    ).toMatchObject({
      status: "failed",
      settlementCode: "tool_failed",
      checkpointReadback: expect.objectContaining({
        transactionId: "wcp-workflow-rollback",
        outcome: "rolled_back",
      }),
    });
    const readbacks =
      projectDynamicWorkflowRuntime(statePath).observability.checkpoints
        .storeReadbacks;
    expect(readbacks).toMatchObject({
      toolCalls: 1,
      failedCalls: 1,
      verifiedCalls: 1,
      committedCalls: 0,
      rolledBackCalls: 1,
      missingReadbacks: 0,
    });
  });

  it.each(["committed", "rolled_back"])(
    "recovers a crash-visible tool call from its bound %s checkpoint store state",
    async (outcome) => {
      mkdirSync(projectRoot, { recursive: true });
      const targetPath = join(projectRoot, `recover-${outcome}.txt`);
      writeFileSync(targetPath, "before\n", "utf8");
      const workflow = workflowDefinition({
        steps: [{ id: "recover", message: "Recover checkpoint state" }],
      });
      const execution = admittedExecution(projectRoot, workflow);
      const runId = `run-checkpoint-recover-${outcome}`;
      const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
      const checkpointStore = checkpointManager(root, `recover-${outcome}`);

      await expect(
        executeDurableDynamicWorkflow(
          { statePath, runId, execution },
          {
            checkpointStore,
            runTask: async (args) => {
              const transaction = checkpointStore.begin({
                id: `wcp-workflow-recover-${outcome}`,
                runId,
                taskKey: "recover-checkpoint-state",
                workspaceRoot: args.cwd,
                coverageTarget: "partial",
                writerIsolation: "unknown",
                externalSideEffects: false,
                exclusions: args.managedCheckpointExclusions,
              });
              const boundary = {
                ...workflowToolBoundary(args, {
                  tool: "write_file",
                  toolUseId: `tool-checkpoint-recover-${outcome}`,
                }),
                managedCheckpointBinding:
                  transactionCheckpointBinding(transaction),
              };
              args.onToolCallBoundary(boundary);
              writeFileSync(targetPath, "after\n", "utf8");
              if (outcome === "committed") {
                transaction.accept();
              } else {
                transaction.rollback({ reason: "simulated tool failure" });
              }
              throw new Error("crash after terminal checkpoint settlement");
            },
            now: clock(),
          },
        ),
      ).rejects.toMatchObject({ reason: "reconciliation-required" });

      let state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.status).toBe("blocked");
      expect(state.effects[0].calls[0]).toMatchObject({
        status: "started",
        checkpointBinding: expect.objectContaining({
          transactionId: `wcp-workflow-recover-${outcome}`,
        }),
        checkpointReadback: null,
      });
      const callRecordId = state.effects[0].calls[0].id;
      const initialRevision = state.revision;
      expect(() =>
        recoverDurableWorkflowCheckpointCall(
          statePath,
          { expectedRevision: initialRevision, callRecordId },
          {
            checkpointStore: {
              inspect() {
                throw new Error("checkpoint store unavailable");
              },
            },
          },
        ),
      ).toThrow(/checkpoint store readback failed/u);
      expect(readDynamicWorkflowRuntimeState(statePath).revision).toBe(
        initialRevision,
      );

      const tampered = structuredClone(state);
      tampered.effects[0].calls[0].checkpointBinding.transactionId =
        "wcp-forged-binding";
      expect(() =>
        verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(tampered)),
      ).toThrow(/effect-0-call-0-invalid/u);

      state = recoverDurableWorkflowCheckpointCall(
        statePath,
        { expectedRevision: initialRevision, callRecordId },
        {
          checkpointStore,
          now: clock(Date.parse("2026-08-18T06:00:00.000Z")),
        },
      );
      expect(state.status).toBe("blocked");
      expect(state.effects[0].calls[0]).toMatchObject({
        status: outcome === "committed" ? "completed" : "failed",
        settlementCode:
          outcome === "committed"
            ? "checkpoint_store_recovered_commit"
            : "checkpoint_store_recovered_rollback",
        checkpointReadback: expect.objectContaining({ outcome }),
      });
      expect(
        projectDynamicWorkflowRuntime(state).observability.checkpoints
          .storeReadbacks,
      ).toMatchObject({
        preparedBindingCalls: 1,
        terminalStoreRecoveredCalls: 1,
        verifiedCalls: 1,
        committedCalls: outcome === "committed" ? 1 : 0,
        rolledBackCalls: outcome === "rolled_back" ? 1 : 0,
        missingReadbacks: 0,
      });
      expect(() =>
        prepareDurableWorkflowResume(statePath, state.revision),
      ).toThrow(/must be reconciled before resume/u);
      expect(() =>
        recoverDurableWorkflowCheckpointCall(
          statePath,
          { expectedRevision: state.revision, callRecordId },
          { checkpointStore },
        ),
      ).toThrow(/not pending terminal recovery/u);
    },
  );

  it("atomically recovers every terminal checkpoint call in one revision-bound batch", async () => {
    mkdirSync(projectRoot, { recursive: true });
    const workflow = workflowDefinition({
      steps: [{ id: "recover", message: "Recover checkpoint batch" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const runId = "run-checkpoint-recover-batch";
    const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
    const checkpointStore = checkpointManager(root, "recover-batch");

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId, execution },
        {
          checkpointStore,
          runTask: async (args) => {
            for (const sequence of [1, 2]) {
              const transaction = checkpointStore.begin({
                id: `wcp-workflow-recover-batch-${sequence}`,
                runId,
                taskKey: `recover-checkpoint-batch-${sequence}`,
                workspaceRoot: args.cwd,
                coverageTarget: "partial",
                writerIsolation: "unknown",
                externalSideEffects: false,
                exclusions: args.managedCheckpointExclusions,
              });
              const boundary = {
                ...workflowToolBoundary(args, {
                  tool: "write_file",
                  toolUseId: `tool-checkpoint-recover-batch-${sequence}`,
                  sequence,
                }),
                managedCheckpointBinding:
                  transactionCheckpointBinding(transaction),
              };
              args.onToolCallBoundary(boundary);
              writeFileSync(
                join(projectRoot, `batch-${sequence}.txt`),
                `after-${sequence}\n`,
                "utf8",
              );
              if (sequence === 1) transaction.accept();
              else transaction.rollback({ reason: "batch rollback" });
            }
            throw new Error("crash after checkpoint batch became terminal");
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls).toMatchObject([
      { status: "started" },
      { status: "started" },
    ]);
    const initialRevision = state.revision;
    expect(() =>
      recoverDurableWorkflowCheckpointCalls(
        statePath,
        { expectedRevision: initialRevision },
        {
          checkpointStore: {
            inspect(id) {
              if (id.endsWith("-2")) throw new Error("store unavailable");
              return checkpointStore.inspect(id);
            },
          },
        },
      ),
    ).toThrow(/checkpoint store readback failed/u);
    expect(readDynamicWorkflowRuntimeState(statePath).revision).toBe(
      initialRevision,
    );

    state = recoverDurableWorkflowCheckpointCalls(
      statePath,
      { expectedRevision: initialRevision },
      {
        checkpointStore,
        now: clock(Date.parse("2026-08-18T06:15:00.000Z")),
      },
    );
    expect(state.revision).toBe(initialRevision + 2);
    expect(state.status).toBe("blocked");
    expect(state.effects[0].calls).toMatchObject([
      {
        status: "completed",
        settlementCode: "checkpoint_store_recovered_commit",
        checkpointReadback: { outcome: "committed" },
      },
      {
        status: "failed",
        settlementCode: "checkpoint_store_recovered_rollback",
        checkpointReadback: { outcome: "rolled_back" },
      },
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.checkpoints
        .storeReadbacks,
    ).toMatchObject({
      terminalStoreRecoveredCalls: 2,
      committedCalls: 1,
      rolledBackCalls: 1,
    });
    expect(() =>
      recoverDurableWorkflowCheckpointCalls(
        statePath,
        { expectedRevision: state.revision },
        { checkpointStore },
      ),
    ).toThrow(/no workflow checkpoint calls/u);
  });

  it.each(["forged-evidence", "missing-store"])(
    "rejects a managed checkpoint settlement with %s",
    async (failureMode) => {
      const workflow = workflowDefinition({
        steps: [{ id: "write", message: "Write release state" }],
      });
      const execution = admittedExecution(projectRoot, workflow);
      const runId = `run-checkpoint-${failureMode}`;
      const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
      const manager = checkpointManager(root, failureMode);
      const checkpointStore =
        failureMode === "missing-store"
          ? {
              inspect() {
                throw new Error("missing checkpoint store");
              },
            }
          : manager;
      let settlementReturned = false;

      await expect(
        executeDurableDynamicWorkflow(
          { statePath, runId, execution },
          {
            checkpointStore,
            runTask: async (args) => {
              const transaction = manager.begin({
                id: `wcp-workflow-${failureMode}`,
                runId,
                taskKey: "write-release-state",
                workspaceRoot: args.cwd,
                coverageTarget: "partial",
                writerIsolation: "unknown",
                externalSideEffects: false,
                exclusions: args.managedCheckpointExclusions,
              });
              const boundary = {
                ...workflowToolBoundary(args, {
                  tool: "write_file",
                  toolUseId: `tool-checkpoint-${failureMode}`,
                }),
                managedCheckpointBinding:
                  transactionCheckpointBinding(transaction),
              };
              args.onToolCallBoundary(boundary);
              writeFileSync(
                join(projectRoot, `${failureMode}.txt`),
                "release state\n",
                "utf8",
              );
              const evidence = transaction.accept();
              if (failureMode === "forged-evidence") {
                evidence.coverage = "full";
              }
              args.onToolCallSettlement({
                ...boundary,
                type: "tool-result",
                result: {
                  ok: true,
                  managedCheckpoint: {
                    skipped: false,
                    toolName: "write_file",
                    transactionId: transaction.id,
                    checkpointId: transaction.checkpointId,
                    evidence,
                    coverage: evidence.coverage,
                    fileCoverage: evidence.fileCoverage,
                  },
                },
                error: null,
              });
              settlementReturned = true;
              return completedTask(args);
            },
            now: clock(),
          },
        ),
      ).rejects.toMatchObject({ reason: "reconciliation-required" });

      expect(settlementReturned).toBe(false);
      const state = readDynamicWorkflowRuntimeState(statePath);
      expect(state.status).toBe("blocked");
      expect(state.effects[0].calls).toEqual([
        expect.objectContaining({
          name: "write_file",
          status: "started",
          checkpointReadback: null,
        }),
      ]);
      expect(
        projectDynamicWorkflowRuntime(state).observability.checkpoints
          .storeReadbacks,
      ).toMatchObject({
        toolCalls: 1,
        verifiedCalls: 0,
        missingReadbacks: 1,
        pendingCalls: 1,
      });
    },
  );

  it("keeps unpriced provider usage without fabricating a USD estimate", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-provider-cost-unpriced",
    );

    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-provider-cost-unpriced", execution },
      {
        runTask: async (args) => {
          const boundary = {
            type: "model-usage-started",
            callId: "mdl-provider-cost-unpriced-1",
            provider: "openai",
            model: "future-unpriced-model-1",
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
            usage: { input_tokens: 10, output_tokens: 5 },
          });
          return completedTask(args);
        },
        now: clock(),
      },
    );

    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls[0]).toMatchObject({
      status: "completed",
      providerModel: "future-unpriced-model-1",
      providerPricing: null,
      providerCostEstimate: null,
      providerUsage: expect.objectContaining({ totalTokens: 15 }),
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.cost,
    ).toMatchObject({
      authority: "durable-pricing-snapshot-estimate",
      reportedUsd: null,
      estimatedUsd: null,
      providerCalls: 1,
      pricingSnapshotCalls: 0,
      pricedCalls: 0,
      missingEstimateCalls: 1,
      unpricedCalls: 1,
      modelMissingCalls: 0,
      legacyCalls: 0,
    });
    expect(projectDynamicWorkflowRuntime(state).observability.gaps).toEqual(
      expect.arrayContaining([
        "provider-cost-usd-unavailable",
        "provider-cost-estimate-unavailable",
        "provider-cost-estimate-incomplete",
      ]),
    );
  });

  it("keeps a priced local provider's zero USD estimate distinct from missing cost", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect local release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-provider-cost-free",
    );

    await executeDurableDynamicWorkflow(
      { statePath, runId: "run-provider-cost-free", execution },
      {
        runTask: async (args) => {
          const boundary = {
            type: "model-usage-started",
            callId: "mdl-provider-cost-free-1",
            provider: "ollama",
            model: "llama3.3",
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
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 10,
              cache_creation_input_tokens: 5,
            },
          });
          return completedTask(args);
        },
        now: clock(),
      },
    );

    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0].calls[0]).toMatchObject({
      status: "completed",
      providerModel: "llama3.3",
      providerPricing: expect.objectContaining({
        provider: "ollama",
        model: "llama3.3",
        pattern: "free",
        free: true,
        inputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
      }),
      providerCostEstimate: expect.objectContaining({ totalUsd: 0 }),
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.cost,
    ).toMatchObject({
      reportedUsd: null,
      estimatedUsd: 0,
      pricingSnapshotCalls: 1,
      pricedCalls: 1,
      missingEstimateCalls: 0,
      unpricedCalls: 0,
    });
    for (const gap of [
      "provider-cost-estimate-unavailable",
      "provider-cost-estimate-incomplete",
    ]) {
      expect(
        projectDynamicWorkflowRuntime(state).observability.gaps,
      ).not.toContain(gap);
    }
  });

  it("rejects a settlement whose model differs from the durable pricing boundary", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-provider-cost-model-mismatch",
    );
    let settlementReturned = false;

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-provider-cost-model-mismatch", execution },
        {
          runTask: async (args) => {
            const boundary = {
              type: "model-usage-started",
              callId: "mdl-provider-cost-model-mismatch-1",
              provider: "openai",
              model: "gpt-4o",
              source: "model",
              workflowEffectId: args.workflowEffectId,
              callSequence: 1,
              providerRequestId: workflowProviderRequestId(
                args.workflowEffectId,
              ),
              requestIdentitySemantics: "trace-only",
            };
            args.onUsageBoundary(boundary);
            args.onUsageSettlement({
              ...boundary,
              type: "token-usage",
              model: "gpt-4",
              usage: { input_tokens: 1, output_tokens: 1 },
            });
            settlementReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    expect(settlementReturned).toBe(false);
    expect(readDynamicWorkflowRuntimeState(statePath).effects[0].calls).toEqual(
      [
        expect.objectContaining({
          status: "started",
          providerModel: "gpt-4o",
          providerPricing: expect.objectContaining({ pattern: "gpt-4o" }),
          providerUsage: null,
          providerCostEstimate: null,
        }),
      ],
    );
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

  it("retains a provider receipt when the process fails before usage settlement", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-receipt-crash",
    );
    const runTask = vi.fn(async (args) => {
      const boundary = {
        type: "model-usage-started",
        callId: "mdl-receipt-crash-1",
        provider: "openai",
        model: "gpt-4o",
        source: "model",
        workflowEffectId: args.workflowEffectId,
        callSequence: 1,
        providerRequestId: workflowProviderRequestId(args.workflowEffectId),
        requestIdentitySemantics: "trace-only",
      };
      args.onUsageBoundary(boundary);
      args.onProviderReceipt(workflowProviderReceiptEvent(boundary));
      throw new Error("process stopped before usage settlement");
    });

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-call-receipt-crash", execution },
        { runTask, now: clock() },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    const state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.effects[0]).toMatchObject({ status: "pending" });
    expect(state.effects[0].calls).toEqual([
      expect.objectContaining({
        status: "started",
        providerReceiptPersisted: true,
        providerReceiptRequestId: "req_mdl-receipt-crash-1",
        providerReceiptResponseId: "resp_mdl-receipt-crash-1",
        providerReceiptRecordedAt: expect.any(String),
        settledAt: null,
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      started: 1,
      completed: 0,
      providerReceipts: 1,
      providerReceiptsIndependentlyReadable: false,
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.providerReceipts,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      crashVisible: true,
      durableCallEffects: 1,
      count: 1,
      requestAttempts: 1,
      missingRequestReceipts: 0,
      lineage: [
        expect.objectContaining({
          authoritySource: "durable-call-store",
          status: "started",
          requestId: "req_mdl-receipt-crash-1",
        }),
      ],
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.gaps,
    ).not.toContain("provider-request-receipt-incomplete");

    const recordedAt = state.effects[0].calls[0].providerReceiptRecordedAt;
    const reconciled = reconcileDurableWorkflowEffect(
      statePath,
      {
        expectedRevision: state.revision,
        effectId: state.effects[0].id,
        result: completedTask({
          workflowEffect: state.effects[0],
          userMessage: "operator verified provider outcome",
        }),
      },
      { now: clock(Date.parse("2026-08-18T06:45:00.000Z")) },
    );
    expect(reconciled.effects[0].calls[0]).toMatchObject({
      status: "operator_reconciled",
      providerReceiptPersisted: true,
      providerReceiptRequestId: "req_mdl-receipt-crash-1",
      providerReceiptResponseId: "resp_mdl-receipt-crash-1",
      providerReceiptRecordedAt: recordedAt,
    });
  });

  it("rejects a mismatched provider receipt without settling the durable call", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-receipt-mismatch",
    );
    let receiptReturned = false;

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId: "run-call-receipt-mismatch", execution },
        {
          runTask: async (args) => {
            const boundary = {
              type: "model-usage-started",
              callId: "mdl-receipt-mismatch-1",
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
            args.onProviderReceipt(
              workflowProviderReceiptEvent(boundary, {
                workflowEffectId: `sha256:${"f".repeat(64)}`,
              }),
            );
            receiptReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    expect(receiptReturned).toBe(false);
    expect(readDynamicWorkflowRuntimeState(statePath).effects[0].calls).toEqual(
      [
        expect.objectContaining({
          status: "started",
          providerReceiptPersisted: false,
        }),
      ],
    );
  });

  it("rejects a settlement receipt that was not durably prewritten", async () => {
    const workflow = workflowDefinition({
      steps: [{ id: "collect", message: "Collect release evidence" }],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const statePath = dynamicWorkflowRunStatePath(
      projectRoot,
      "run-call-receipt-without-prewrite",
    );
    let settlementReturned = false;

    await expect(
      executeDurableDynamicWorkflow(
        {
          statePath,
          runId: "run-call-receipt-without-prewrite",
          execution,
        },
        {
          runTask: async (args) => {
            const boundary = {
              type: "model-usage-started",
              callId: "mdl-receipt-without-prewrite-1",
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
            args.onUsageSettlement({
              ...boundary,
              type: "token-usage",
              usage: { input_tokens: 1, output_tokens: 1 },
              providerReceipt: workflowProviderReceipt(boundary),
            });
            settlementReturned = true;
            return completedTask(args);
          },
          now: clock(),
        },
      ),
    ).rejects.toMatchObject({ reason: "reconciliation-required" });

    expect(settlementReturned).toBe(false);
    expect(readDynamicWorkflowRuntimeState(statePath).effects[0].calls).toEqual(
      [
        expect.objectContaining({
          status: "started",
          providerReceiptPersisted: false,
          providerReceiptRecordedAt: null,
        }),
      ],
    );
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
      args.onProviderReceipt(
        workflowProviderReceiptEvent(boundary, { responseId: null }),
      );
      args.onUsageSettlement({
        ...boundary,
        type: "model-usage-unknown",
        code: "provider_outcome_unknown",
        providerReceipt: workflowProviderReceipt(boundary, {
          responseId: null,
        }),
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
        providerReceiptPersisted: true,
        providerReceiptRequestId: "req_mdl-unknown-1",
        providerReceiptResponseId: null,
        providerUsage: null,
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.durableCalls,
    ).toMatchObject({
      count: 1,
      started: 0,
      outcomeUnknown: 1,
      providerReceipts: 1,
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.tokens,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync",
      providerCalls: 1,
      providerReportedCalls: 0,
      missingProviderReportedCalls: 1,
      pendingCalls: 0,
      outcomeUnknownCalls: 1,
      providerReported: null,
    });
    expect(projectDynamicWorkflowRuntime(state).observability.gaps).toContain(
      "provider-token-usage-incomplete",
    );
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
            model: "gpt-4o",
            source: "model",
            workflowEffectId: args.workflowEffectId,
            callSequence: 1,
            providerRequestId: workflowProviderRequestId(args.workflowEffectId),
            requestIdentitySemantics: "trace-only",
          };
          args.onUsageBoundary(boundary);
          args.onProviderReceipt(workflowProviderReceiptEvent(boundary));
          args.onUsageSettlement({
            ...boundary,
            type: "token-usage",
            usage: { input_tokens: 1, output_tokens: 1 },
            providerReceipt: workflowProviderReceipt(boundary),
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

    const receiptTampered = structuredClone(state);
    receiptTampered.effects[0].calls[0].providerReceiptRequestId =
      "invalid receipt id";
    expect(() =>
      verifyDynamicWorkflowRuntimeState(
        withRuntimeStateDigest(receiptTampered),
      ),
    ).toThrow(/effect-0-call-0-invalid/u);

    const receiptTimestampTampered = structuredClone(state);
    receiptTimestampTampered.effects[0].calls[0].providerReceiptRecordedAt =
      "9999-12-31T23:59:59.999Z";
    expect(() =>
      verifyDynamicWorkflowRuntimeState(
        withRuntimeStateDigest(receiptTimestampTampered),
      ),
    ).toThrow(/effect-0-call-0-invalid/u);

    const usageTampered = structuredClone(state);
    usageTampered.effects[0].calls[0].providerUsage.inputTokens = 2;
    usageTampered.effects[0].calls[0].providerUsage.totalTokens = 3;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(usageTampered)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const usageRemoved = structuredClone(state);
    delete usageRemoved.effects[0].calls[0].providerUsage;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(usageRemoved)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const costTampered = structuredClone(state);
    costTampered.effects[0].calls[0].providerCostEstimate.totalUsd += 0.01;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(withRuntimeStateDigest(costTampered)),
    ).toThrow(/effect-0-call-0-invalid/u);

    const pricingTampered = structuredClone(state);
    pricingTampered.effects[0].calls[0].providerPricing.inputUsdPerMillion = 1;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(
        withRuntimeStateDigest(pricingTampered),
      ),
    ).toThrow(/effect-0-call-0-invalid/u);

    const costSchemaRemoved = structuredClone(state);
    delete costSchemaRemoved.effects[0].calls[0].providerCostEstimate;
    expect(() =>
      verifyDynamicWorkflowRuntimeState(
        withRuntimeStateDigest(costSchemaRemoved),
      ),
    ).toThrow(/effect-0-call-0-invalid/u);

    const legacyUsageState = structuredClone(state);
    const legacyCall = legacyUsageState.effects[0].calls[0];
    delete legacyCall.providerUsage;
    delete legacyCall.providerModel;
    delete legacyCall.providerPricing;
    delete legacyCall.providerCostEstimate;
    for (const event of legacyUsageState.lineage) {
      if (event.type === "effect-call-started") {
        delete event.details.providerModel;
        delete event.details.providerPricingDigest;
      }
      if (event.type === "effect-call-settled") {
        delete event.details.providerUsageDigest;
        delete event.details.providerCostEstimateDigest;
      }
    }
    const verifiedLegacyUsageState = verifyDynamicWorkflowRuntimeState(
      withRebuiltRuntimeLineage(legacyUsageState, legacyUsageState.lineage),
    );
    expect(
      projectDynamicWorkflowRuntime(verifiedLegacyUsageState).observability
        .tokens,
    ).toMatchObject({
      authority: "runtime-state-hash-chain-fsync-with-legacy-call-schema",
      providerCalls: 1,
      providerReportedCalls: 0,
      missingProviderReportedCalls: 1,
      legacyCalls: 1,
      providerReported: null,
    });
    expect(
      projectDynamicWorkflowRuntime(verifiedLegacyUsageState).observability
        .gaps,
    ).toEqual(
      expect.arrayContaining([
        "provider-token-usage-unavailable",
        "provider-token-usage-incomplete",
        "provider-token-usage-legacy-call-schema",
        "provider-cost-estimate-unavailable",
        "provider-cost-estimate-incomplete",
        "provider-cost-estimate-legacy-call-schema",
      ]),
    );

    const legacyReceiptState = structuredClone(state);
    delete legacyReceiptState.effects[0].calls[0].providerReceiptRecordedAt;
    const verifiedLegacyReceiptState = verifyDynamicWorkflowRuntimeState(
      withRebuiltRuntimeLineage(
        legacyReceiptState,
        legacyReceiptState.lineage.filter(
          (event) => event.type !== "effect-call-receipt-recorded",
        ),
      ),
    );
    expect(
      projectDynamicWorkflowRuntime(verifiedLegacyReceiptState).observability
        .durableCalls.lineage[0].providerReceipt.recordedAt,
    ).toBe(verifiedLegacyReceiptState.effects[0].calls[0].settledAt);
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
      args.onProviderReceipt(workflowProviderReceiptEvent(providerBoundary));
      args.onUsageSettlement({
        type: "token-usage",
        callId: providerBoundary.callId,
        provider: "openai",
        source: "subagent",
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          cache_read_tokens: 1,
          cache_creation_tokens: 1,
        },
        providerReceipt: workflowProviderReceipt(providerBoundary),
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
      providerReceipts: 1,
    });
    expect(projection.lineage.filter((call) => call.descendant)).toEqual([
      expect.objectContaining({
        ownerEffectId: expect.stringMatching(/^sha256:/u),
        kind: "provider",
        requestSource: "model",
        source: "subagent",
        providerReceipt: expect.objectContaining({
          requestId: "req_mdl-descendant-review",
          requestIdentitySemantics: "trace-only",
          independentlyReadable: false,
        }),
      }),
      expect.objectContaining({
        ownerEffectId: expect.stringMatching(/^sha256:/u),
        kind: "tool",
        name: "read_file",
      }),
    ]);
    expect(
      projectDynamicWorkflowRuntime(state).observability.tokens,
    ).toMatchObject({
      providerCalls: 1,
      providerReportedCalls: 1,
      providerReportedEffects: 1,
      missingProviderReportedCalls: 0,
      providerReported: {
        inputTokens: 3,
        outputTokens: 2,
        cacheReadInputTokens: 1,
        cacheCreationInputTokens: 1,
        totalTokens: 7,
      },
      lineage: [
        expect.objectContaining({
          descendant: true,
          source: "subagent",
          requestSource: "model",
        }),
      ],
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.cost,
    ).toMatchObject({
      pricedCalls: 1,
      missingEstimateCalls: 0,
      lineage: [
        expect.objectContaining({
          descendant: true,
          provider: "openai",
          model: "gpt-4o",
          source: "subagent",
          requestSource: "model",
        }),
      ],
    });
    expect(
      projectDynamicWorkflowRuntime(state).observability.cost.estimatedUsd,
    ).toBeCloseTo(0.000031875, 12);

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

  it("does not project a mismatched or idempotency-overclaiming legacy provider receipt", async () => {
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
    const projection = projectLegacyResultOnlyState(statePath);
    expect(projection.observability.providerReceipts).toMatchObject({
      authority:
        "runtime-state-hash-chain-fsync-with-legacy-task-result-fallback",
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

  it("reports a missing receipt for each legacy effect-bound provider attempt", async () => {
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
    const projection = projectLegacyResultOnlyState(statePath);
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

  it("parks a stage before dispatch and resumes only from its bound answer", async () => {
    const runId = "run-needs-input";
    const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
    const workflow = workflowDefinition({
      steps: [
        { id: "collect", message: "Collect release evidence" },
        {
          id: "review",
          message: "Review ${step.collect.summary}",
          dependsOn: ["collect"],
          needsInput: {
            prompt: "Choose release decision",
            options: ["approve", "reject"],
          },
        },
      ],
    });
    const execution = admittedExecution(projectRoot, workflow);
    const runTask = vi.fn(async (args) => completedTask(args));
    const runtimeClock = clock();

    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId, execution },
        { runTask, now: runtimeClock },
      ),
    ).rejects.toMatchObject({
      code: DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE,
      reason: "needs-input",
    });

    let state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("needs_input");
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0]).toMatchObject({
      stepId: "collect",
      status: "settled",
    });
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(state.inputRequests).toHaveLength(1);
    expect(state.inputRequests[0]).toMatchObject({
      stepId: "review",
      status: "pending",
      response: null,
    });
    const projection = projectDynamicWorkflowRuntime(state);
    expect(projection.pendingInputRequests).toMatchObject([
      {
        id: state.inputRequests[0].id,
        stepId: "review",
        prompt: "Choose release decision",
      },
    ]);
    expect(JSON.stringify(projection)).not.toContain('"response"');
    expect(() =>
      prepareDurableWorkflowResume(statePath, state.revision),
    ).toThrow(/must be answered before resume/u);

    const responseFile = join(projectRoot, "workflow-input.json");
    writeFileSync(responseFile, JSON.stringify({ answer: "approve" }));
    expect(readDynamicWorkflowInputResponseFile(responseFile)).toBe("approve");
    expect(() =>
      submitDurableWorkflowInput(statePath, {
        expectedRevision: state.revision - 1,
        requestId: state.inputRequests[0].id,
        answer: "approve",
      }),
    ).toThrow(/stale dynamic workflow runtime revision/u);
    expect(() =>
      submitDurableWorkflowInput(statePath, {
        expectedRevision: state.revision,
        requestId: state.inputRequests[0].id,
        answer: "later",
      }),
    ).toThrow(/answer is malformed/u);

    state = submitDurableWorkflowInput(
      statePath,
      {
        expectedRevision: state.revision,
        requestId: state.inputRequests[0].id,
        answer: "approve",
      },
      { now: runtimeClock },
    );
    expect(state.status).toBe("ready");
    expect(state.inputRequests[0]).toMatchObject({
      status: "answered",
      response: "approve",
    });
    expect(() =>
      submitDurableWorkflowInput(statePath, {
        expectedRevision: state.revision,
        requestId: state.inputRequests[0].id,
        answer: "approve",
      }),
    ).toThrow(/run is ready/u);

    const record = await executeDurableDynamicWorkflow(
      { statePath, runId, execution },
      { runTask, now: runtimeClock },
    );
    expect(record.status).toBe("completed");
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(runTask.mock.calls[1][0].userMessage).toContain(
      '## Bound user input for stage review\n"approve"',
    );
    state = readDynamicWorkflowRuntimeState(statePath);
    expect(state.status).toBe("completed");
    expect(state.effects).toHaveLength(2);
  });

  it("rejects a secret-shaped free-text stage answer without changing state", async () => {
    const runId = "run-needs-input-secret";
    const statePath = dynamicWorkflowRunStatePath(projectRoot, runId);
    const execution = admittedExecution(
      projectRoot,
      workflowDefinition({
        steps: [
          {
            id: "review",
            message: "Review release",
            needsInput: { prompt: "Provide a public release note" },
          },
        ],
      }),
    );
    await expect(
      executeDurableDynamicWorkflow(
        { statePath, runId, execution },
        { runTask: async (args) => completedTask(args), now: clock() },
      ),
    ).rejects.toMatchObject({ reason: "needs-input" });
    const state = readDynamicWorkflowRuntimeState(statePath);

    expect(() =>
      submitDurableWorkflowInput(statePath, {
        expectedRevision: state.revision,
        requestId: state.inputRequests[0].id,
        answer: "sk-abcdefghijklmnopqrstuvwxyz123456",
      }),
    ).toThrow(/secret-shaped/u);
    expect(readDynamicWorkflowRuntimeState(statePath)).toEqual(state);
    const stopped = requestDurableWorkflowStop(statePath, state.revision, {
      now: clock(Date.parse("2026-08-18T06:00:00.000Z")),
    });
    expect(stopped).toMatchObject({
      status: "stopped",
      inputRequests: [{ status: "cancelled", response: null }],
    });
    expect(() =>
      submitDurableWorkflowInput(statePath, {
        expectedRevision: stopped.revision,
        requestId: stopped.inputRequests[0].id,
        answer: "public note",
      }),
    ).toThrow(/run is stopped/u);
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
