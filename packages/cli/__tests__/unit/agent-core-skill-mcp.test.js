/**
 * Security regression tests for run_skill.
 *
 * A skill handler must never be imported into the CLI process or receive the
 * raw MCP/process authority. Executable skills run through a constrained child
 * agent; legacy/non-isolated handlers fail closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  SKILL_VECTOR_ATTESTATION_SCHEMA,
  SKILL_VECTOR_RESULT_SCHEMA,
  createSkillVectorAuthority,
  digestSkillVectorResult,
} from "../../src/lib/skill-vector-authority.js";
import { openSkillRetrievalRevocationAuthority } from "../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function vectorAuthority(scoreForDigest) {
  return createSkillVectorAuthority({
    tenantId: "tenant:test",
    provider: {
      score: async (request) => {
        const result = {
          schema: SKILL_VECTOR_RESULT_SCHEMA,
          tenantId: request.tenantId,
          requestDigest: request.requestDigest,
          corpusDigest: request.corpusDigest,
          modelId: "embedding:model",
          modelRevision: "revision:1",
          indexDigest: D("agent-vector-index"),
          scores: request.corpus.map(({ digest }) => ({
            digest,
            score: scoreForDigest(digest),
          })),
          attestation: {
            schema: SKILL_VECTOR_ATTESTATION_SCHEMA,
            algorithm: "test-signature",
            keyId: "key:test-vector",
            value: "A".repeat(32),
          },
        };
        return { ...result, resultDigest: digestSkillVectorResult(result) };
      },
    },
    verifier: {
      verify: async (request) => ({
        authenticated: true,
        durable: true,
        tenantId: request.tenantId,
        requestDigest: request.requestDigest,
        resultDigest: request.resultDigest,
        receiptDigest: D(`agent-vector:${request.resultDigest}`),
      }),
    },
  });
}

const mocks = vi.hoisted(() => ({
  skills: [],
  childConfigs: [],
  childRuns: [],
  childRunOptions: [],
  createSubAgent: vi.fn(),
  outcomeMetrics: {},
}));

vi.mock("../../src/lib/plan-mode.js", () => {
  const planModeManager = {
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  };
  return { getPlanModeManager: vi.fn(() => planModeManager) };
});

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => mocks.skills) };
  }),
}));

vi.mock("../../src/lib/sub-agent-context.js", () => ({
  SubAgentContext: {
    create: mocks.createSubAgent,
  },
}));

vi.mock("../../src/lib/skill-outcome-transcript-authority.js", () => ({
  buildSkillOutcomeTranscriptAuthority: vi.fn(() => ({
    status: "verified",
    metrics: mocks.outcomeMetrics,
    evidence: {
      schema: "chainlesschain.skill-outcome-transcript-authority/v1",
      status: "verified",
      sourceDigest: `sha256:${"f".repeat(64)}`,
    },
  })),
  unavailableSkillOutcomeTranscriptAuthority: vi.fn(() => ({
    status: "unavailable",
    metrics: null,
    evidence: {
      schema: "chainlesschain.skill-outcome-transcript-authority/v1",
      status: "unavailable",
      code: "CC_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
    },
  })),
}));

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => null),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { agentLoop, executeTool } =
  await import("../../src/runtime/agent-core.js");

describe("run_skill controlled execution boundary", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-skill-boundary-"));
    mocks.skills.length = 0;
    mocks.childConfigs.length = 0;
    mocks.childRuns.length = 0;
    mocks.childRunOptions.length = 0;
    mocks.outcomeMetrics = {};
    mocks.createSubAgent.mockReset();
    mocks.createSubAgent.mockImplementation((config) => {
      mocks.childConfigs.push(config);
      return {
        id: `skill-child-${mocks.childConfigs.length}`,
        run: vi.fn(async (input, loopOptions) => {
          mocks.childRuns.push(input);
          mocks.childRunOptions.push(loopOptions);
          return {
            summary: `isolated:${input}`,
            toolsUsed: ["read_file"],
          };
        }),
      };
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function registerSkill({
    id,
    isolation = false,
    mcpServers = [],
    capabilities = [],
    body = "# Approved skill instructions",
    description = id,
  }) {
    mocks.skills.push({
      id,
      dirName: id,
      category: "test",
      activation: "manual",
      source: "workspace",
      hasHandler: true,
      description,
      version: "1.0.0",
      tags: [],
      paths: [],
      os: [],
      executionIdentity: {
        contentDigest: `sha256:${createHash("sha256").update(id).digest("hex")}`,
      },
      skillDir: join(tempDir, id),
      mcpServers,
      capabilities,
      isolation,
      body,
    });
  }

  it("has no dormant Skill process-broker module to reattach", () => {
    const brokerPath = new URL(
      "../../src/lib/skill-process-broker.js",
      import.meta.url,
    );
    expect(existsSync(brokerPath)).toBe(false);
  });

  it("blocks a legacy direct handler without importing or mounting anything", async () => {
    const fakeMcp = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    registerSkill({
      id: "legacy-weather",
      mcpServers: [{ name: "weather", command: "npx" }],
      capabilities: ["shell-exec"],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "legacy-weather", input: "London" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result).toMatchObject({
      code: "CC_SKILL_DIRECT_HANDLER_BLOCKED",
      policy: { decision: "blocked", via: "skill-execution-boundary" },
    });
    expect(fakeMcp.connect).not.toHaveBeenCalled();
    expect(fakeMcp.disconnect).not.toHaveBeenCalled();
    expect(mocks.createSubAgent).not.toHaveBeenCalled();
  });

  it("runs an isolated skill as a child with read-only tools intersected with the parent ceiling", async () => {
    registerSkill({
      id: "reviewer",
      isolation: true,
      body: "# Review files\nNever modify the workspace.",
      mcpServers: [{ name: "untrusted-server", command: "node" }],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "reviewer", input: "inspect src" },
      {
        cwd: tempDir,
        sessionId: "session:skill-receipt",
        turnId: "turn:skill-receipt:1",
        hookTraceId: "trace:skill-receipt",
        skillLifecycleMode: "canary",
        llmOptions: { provider: "test-provider", model: "test-model-v1" },
        effectiveAllowedToolNames: [
          "run_skill",
          "read_file",
          "list_dir",
          "write_file",
        ],
        mcpClient: { connect: vi.fn(), callTool: vi.fn() },
      },
    );

    expect(result).toMatchObject({
      success: true,
      isolated: true,
      skill: "reviewer",
      summary: "isolated:inspect src",
      toolsUsed: ["read_file"],
      invocationReceipt: {
        schema: "chainlesschain.skill-invocation-receipt/v1",
        evolutionRunId: "session:skill-receipt",
        traceId: "trace:skill-receipt",
        trajectorySegmentId: "turn:skill-receipt:1",
        providerModelVersion: "test-provider:test-model-v1",
        taskCohort: "cli:run_skill",
        attributionStatus: "complete",
        attributionEligible: true,
        executionStatus: "completed",
      },
    });
    expect(result.invocationReceipt.receiptDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(result.invocationReceipt.routerCandidates[0].reason).toBe(
      "explicit-run_skill",
    );
    expect(mocks.childRuns).toEqual(["inspect src"]);
    expect(mocks.childConfigs).toHaveLength(1);
    expect(mocks.childConfigs[0]).toMatchObject({
      role: "skill-reviewer",
      cwd: tempDir,
      allowedTools: ["read_file", "list_dir"],
    });
    expect(mocks.childConfigs[0].task).toContain("# Review files");
    expect(mocks.childConfigs[0].task).toContain("inspect src");
    expect(mocks.childConfigs[0]).not.toHaveProperty("mcpClient");
    expect(mocks.childConfigs[0]).not.toHaveProperty("processBroker");
  });

  it("fails closed before a canary child starts when invocation attribution is incomplete", async () => {
    registerSkill({ id: "unattributed-canary", isolation: true });

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "unattributed-canary", input: "inspect src" },
        { cwd: tempDir, skillLifecycleMode: "canary" },
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_ATTRIBUTION_REQUIRED" });
    expect(mocks.childRuns).toEqual([]);
    expect(mocks.childConfigs).toEqual([]);
  });

  it("forwards the isolated skill child's real call boundary and settlement without an aggregate sentinel", async () => {
    registerSkill({ id: "metered-reviewer", isolation: true });
    const workflowEffectId = `sha256:${"a".repeat(64)}`;
    const workflowChildEffectId = `sha256:${"b".repeat(64)}`;
    const usageSink = [];
    const boundaries = [];
    const receipts = [];
    const settlements = [];
    const providerCall = vi.fn();
    const boundaryWriter = vi.fn((event) => boundaries.push(event));
    const receiptWriter = vi.fn((event) => receipts.push(event));
    const settlementWriter = vi.fn((event) => settlements.push(event));
    const realCallId = "mdl-real-skill-call";
    mocks.createSubAgent.mockImplementationOnce((opts) => {
      mocks.childConfigs.push(opts);
      return {
        id: "skill-child-real",
        run: vi.fn(async (input) => {
          mocks.childRuns.push(input);
          opts.onUsageBoundary({
            type: "model-usage-started",
            callId: realCallId,
            provider: "openai",
            model: "gpt-test",
            source: "model",
          });
          providerCall();
          opts.onProviderReceipt({
            type: "provider-request-receipt",
            callId: realCallId,
            provider: "openai",
            source: "model",
            workflowRequestSource: "model",
            workflowEffectId: opts.workflowEffectId,
            providerReceipt: {
              protocol: "cc-provider-request-receipt/v1",
              provider: "openai",
              workflowEffectId: opts.workflowEffectId,
              callId: realCallId,
              callSequence: 1,
              source: "model",
              clientRequestId: `ccwf_${"1".repeat(64)}`,
              requestId: "req_skill_child",
              responseId: null,
              requestIdentitySemantics: "trace-only",
              independentlyReadable: false,
            },
          });
          const settlement = {
            type: "token-usage",
            callId: realCallId,
            provider: "openai",
            model: "gpt-test",
            source: "model",
            usage: {
              input_tokens: 7,
              output_tokens: 3,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            boundaryNotified: true,
          };
          opts.onUsageSettlement(settlement);
          settlement.ledgerPersisted = true;
          opts.onUsage(settlement);
          return { summary: `isolated:${input}`, toolsUsed: [] };
        }),
      };
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "metered-reviewer", input: "inspect" },
      {
        cwd: tempDir,
        sessionId: "parent-session",
        llmOptions: { provider: "openai", model: "gpt-test" },
        workflowEffectId,
        workflowChildEffectId,
        workflowChildSequence: 1,
        workflowEffectProtocol: "cc-workflow-child-effect/v1",
        strictUsageTelemetry: true,
        subAgentUsageSink: usageSink,
        onUsageBoundary: boundaryWriter,
        onProviderReceipt: receiptWriter,
        onUsageSettlement: settlementWriter,
      },
    );

    expect(result).toMatchObject({ success: true, isolated: true });
    expect(mocks.childConfigs[0]).toMatchObject({
      workflowEffectId: workflowChildEffectId,
      strictUsageTelemetry: true,
    });
    expect(providerCall).toHaveBeenCalledOnce();
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      type: "model-usage-started",
      callId: realCallId,
      provider: "openai",
      model: "gpt-test",
      source: "subagent",
      workflowRequestSource: "model",
      attribution: {
        origin: "skill",
        skill: "metered-reviewer",
        subagentId: "skill-child-real",
        parentSessionId: "parent-session",
      },
    });
    expect(receipts).toEqual([
      expect.objectContaining({
        callId: realCallId,
        source: "subagent",
        workflowRequestSource: "model",
        providerReceipt: expect.objectContaining({
          requestId: "req_skill_child",
        }),
        attribution: expect.objectContaining({
          origin: "skill",
          skill: "metered-reviewer",
        }),
      }),
    ]);
    expect(settlements).toEqual([
      expect.objectContaining({
        type: "token-usage",
        callId: realCallId,
        source: "subagent",
        boundaryNotified: true,
        attribution: expect.objectContaining({
          origin: "skill",
          skill: "metered-reviewer",
          subagentId: "skill-child-real",
        }),
      }),
    ]);
    expect(usageSink).toEqual([
      expect.objectContaining({
        type: "token-usage",
        callId: realCallId,
        source: "subagent",
        boundaryNotified: true,
        ledgerPersisted: true,
        attribution: expect.objectContaining({
          origin: "skill",
          skill: "metered-reviewer",
          subagentId: "skill-child-real",
        }),
      }),
    ]);
    expect(
      [...boundaries, ...settlements, ...usageSink].some(
        (event) =>
          event.callId !== realCallId || event.type === "model-usage-unknown",
      ),
    ).toBe(false);
    expect(boundaryWriter.mock.invocationCallOrder[0]).toBeLessThan(
      providerCall.mock.invocationCallOrder[0],
    );
    expect(providerCall.mock.invocationCallOrder[0]).toBeLessThan(
      settlementWriter.mock.invocationCallOrder[0],
    );
  });

  it("blocks an isolated skill child when strict boundary persistence fails", async () => {
    registerSkill({ id: "metered-failure", isolation: true });
    const persistenceError = new Error("ledger unavailable");
    const providerCall = vi.fn();
    mocks.createSubAgent.mockImplementationOnce((opts) => {
      mocks.childConfigs.push(opts);
      return {
        id: "skill-child-boundary-failure",
        run: vi.fn(async () => {
          opts.onUsageBoundary({
            type: "model-usage-started",
            callId: "mdl-boundary-failure",
            provider: "openai",
            model: "gpt-test",
            source: "model",
          });
          providerCall();
          return { summary: "must not complete", toolsUsed: [] };
        }),
      };
    });

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "metered-failure", input: "inspect" },
        {
          cwd: tempDir,
          strictUsageTelemetry: true,
          subAgentUsageSink: [],
          onUsageSettlement: vi.fn(),
          onUsageBoundary: () => {
            throw persistenceError;
          },
        },
      ),
    ).rejects.toBe(persistenceError);
    expect(providerCall).not.toHaveBeenCalled();
    expect(persistenceError).toMatchObject({
      runtimeLedgerPersistence: true,
      code: "CC_USAGE_BOUNDARY_PERSISTENCE_FAILED",
    });
  });

  it("rethrows an isolated workflow skill child's unknown outcome", async () => {
    registerSkill({ id: "unknown-reviewer", isolation: true });
    const unknown = new Error("skill child provider outcome is unknown");
    unknown.workflowEffectOutcomeUnknown = true;
    mocks.createSubAgent.mockImplementationOnce((opts) => {
      mocks.childConfigs.push(opts);
      return {
        id: "skill-child-unknown",
        run: vi.fn(async () => {
          throw unknown;
        }),
      };
    });

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "unknown-reviewer", input: "inspect" },
        {
          cwd: tempDir,
          workflowEffectId: `sha256:${"a".repeat(64)}`,
          workflowChildEffectId: `sha256:${"b".repeat(64)}`,
          workflowChildSequence: 1,
          workflowEffectProtocol: "cc-workflow-child-effect/v1",
          strictUsageTelemetry: true,
          subAgentUsageSink: [],
          onUsageBoundary: vi.fn(),
          onUsageSettlement: vi.fn(),
          onToolCallBoundary: vi.fn(),
          onToolCallSettlement: vi.fn(),
        },
      ),
    ).rejects.toBe(unknown);
  });

  it("fails closed after provider work when strict skill settlement persistence fails", async () => {
    registerSkill({ id: "metered-settlement-failure", isolation: true });
    const persistenceError = new Error("ledger settlement unavailable");
    const providerCall = vi.fn();
    const usageSink = [];
    const boundaryWriter = vi.fn();
    mocks.createSubAgent.mockImplementationOnce((opts) => {
      mocks.childConfigs.push(opts);
      return {
        id: "skill-child-settlement-failure",
        run: vi.fn(async () => {
          const callId = "mdl-settlement-failure";
          opts.onUsageBoundary({
            type: "model-usage-started",
            callId,
            provider: "openai",
            model: "gpt-test",
            source: "model",
          });
          providerCall();
          const settlement = {
            type: "token-usage",
            callId,
            provider: "openai",
            model: "gpt-test",
            source: "model",
            usage: { input_tokens: 4, output_tokens: 2 },
            boundaryNotified: true,
          };
          opts.onUsageSettlement(settlement);
          settlement.ledgerPersisted = true;
          opts.onUsage(settlement);
          return { summary: "must not complete", toolsUsed: [] };
        }),
      };
    });

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "metered-settlement-failure", input: "inspect" },
        {
          cwd: tempDir,
          sessionId: "parent-session",
          strictUsageTelemetry: true,
          subAgentUsageSink: usageSink,
          onUsageBoundary: boundaryWriter,
          onUsageSettlement: () => {
            throw persistenceError;
          },
        },
      ),
    ).rejects.toBe(persistenceError);

    expect(boundaryWriter).toHaveBeenCalledOnce();
    expect(providerCall).toHaveBeenCalledOnce();
    expect(usageSink).toEqual([]);
    expect(persistenceError).toMatchObject({
      runtimeLedgerPersistence: true,
      code: "CC_USAGE_SETTLEMENT_PERSISTENCE_FAILED",
    });
  });

  it("does not manufacture a paid boundary for a non-isolated skill", async () => {
    registerSkill({ id: "local-only", isolation: false });
    const onUsageBoundary = vi.fn(() => {
      throw new Error("must not be called");
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "local-only", input: "inspect" },
      {
        cwd: tempDir,
        strictUsageTelemetry: true,
        onUsageBoundary,
      },
    );

    expect(result).toMatchObject({ code: "CC_SKILL_DIRECT_HANDLER_BLOCKED" });
    expect(onUsageBoundary).not.toHaveBeenCalled();
    expect(mocks.childRuns).toEqual([]);
  });

  it("links the parent AbortSignal into the isolated Skill context", async () => {
    registerSkill({ id: "linked-cancel", isolation: true });
    const controller = new AbortController();

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "linked-cancel", input: "inspect" },
        { cwd: tempDir, signal: controller.signal },
      ),
    ).resolves.toMatchObject({ success: true, isolated: true });

    expect(mocks.childConfigs[0].signal).toBe(controller.signal);
  });

  it("rejects a pre-cancelled run_skill before discovery or child creation", async () => {
    const reason = Object.assign(new Error("parent already stopped"), {
      name: "AbortError",
    });
    const controller = new AbortController();
    controller.abort(reason);
    const getResolvedSkills = vi.fn(() => mocks.skills);

    await expect(
      executeTool(
        "run_skill",
        { skill_name: "never-discovered", input: "x" },
        {
          cwd: tempDir,
          signal: controller.signal,
          skillLoader: { getResolvedSkills },
        },
      ),
    ).rejects.toBe(reason);
    expect(getResolvedSkills).not.toHaveBeenCalled();
    expect(mocks.createSubAgent).not.toHaveBeenCalled();
  });

  it("cancels an in-flight authorization promptly and ignores its late success", async () => {
    registerSkill({ id: "cancel-auth", isolation: true });
    let resolveAuthorization;
    const materializeSkillForExecution = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAuthorization = resolve;
        }),
    );
    const controller = new AbortController();
    const reason = Object.assign(new Error("stopped during authorization"), {
      name: "AbortError",
    });
    const running = executeTool(
      "run_skill",
      { skill_name: "cancel-auth", input: "x" },
      {
        cwd: tempDir,
        signal: controller.signal,
        skillLoader: {
          getResolvedSkills: () => mocks.skills,
          materializeSkillForExecution,
        },
      },
    );
    await vi.waitFor(() =>
      expect(materializeSkillForExecution).toHaveBeenCalledOnce(),
    );

    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(mocks.createSubAgent).not.toHaveBeenCalled();

    resolveAuthorization({ ...mocks.skills[0], body: "late authorized body" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.createSubAgent).not.toHaveBeenCalled();
  });

  it("cancels a running isolated child promptly and fences its late result", async () => {
    registerSkill({ id: "cancel-child", isolation: true });
    let resolveChild;
    const childRun = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChild = resolve;
        }),
    );
    mocks.createSubAgent.mockImplementationOnce((config) => {
      mocks.childConfigs.push(config);
      return { id: "cancel-child-context", status: "active", run: childRun };
    });
    const controller = new AbortController();
    const reason = Object.assign(new Error("parent stopped child"), {
      name: "AbortError",
    });
    const running = executeTool(
      "run_skill",
      { skill_name: "cancel-child", input: "x" },
      { cwd: tempDir, signal: controller.signal },
    );
    await vi.waitFor(() => expect(childRun).toHaveBeenCalledOnce());
    expect(mocks.childConfigs[0].signal).toBe(controller.signal);

    controller.abort(reason);
    await expect(running).rejects.toBe(reason);

    resolveChild({ summary: "late child success", toolsUsed: [] });
    await Promise.resolve();
    await Promise.resolve();
    await expect(running).rejects.toBe(reason);
  });

  it("honors a loader execution-lease revocation while the isolated child is running", async () => {
    registerSkill({ id: "revoke-child", isolation: true });
    let resolveChild;
    const childRun = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChild = resolve;
        }),
    );
    mocks.createSubAgent.mockImplementationOnce((config) => {
      mocks.childConfigs.push(config);
      return { id: "revoked-child-context", status: "active", run: childRun };
    });
    const revocationController = new AbortController();
    const release = vi.fn();
    const acquireSkillExecution = vi.fn(() => ({
      signal: revocationController.signal,
      assertActive: () => {
        if (revocationController.signal.aborted) {
          throw revocationController.signal.reason;
        }
      },
      release,
    }));
    const skillLoader = {
      getResolvedSkills: () => mocks.skills,
      materializeSkillForExecution: vi.fn(async (skill) => skill),
      acquireSkillExecution,
    };
    const running = executeTool(
      "run_skill",
      { skill_name: "revoke-child", input: "x" },
      { cwd: tempDir, skillLoader },
    );
    await vi.waitFor(() => expect(childRun).toHaveBeenCalledOnce());
    expect(mocks.childConfigs[0].signal).toBe(revocationController.signal);

    const reason = Object.assign(new Error("skill authority revoked"), {
      name: "AbortError",
      code: "CC_SKILL_EXECUTION_REVOKED",
    });
    revocationController.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(release).toHaveBeenCalledOnce();

    resolveChild({ summary: "late revoked child success", toolsUsed: [] });
    await Promise.resolve();
    await expect(running).rejects.toBe(reason);
  });

  it("propagates the agentLoop parent signal through run_skill without appending a late tool result", async () => {
    registerSkill({ id: "loop-cancel", isolation: true });
    let resolveChild;
    const childRun = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChild = resolve;
        }),
    );
    mocks.createSubAgent.mockImplementationOnce((config) => {
      mocks.childConfigs.push(config);
      return { id: "loop-cancel-child", status: "active", run: childRun };
    });
    let chatCalls = 0;
    const chatFn = vi.fn(async () => {
      chatCalls += 1;
      if (chatCalls === 1) {
        return {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "run-skill-call",
                function: {
                  name: "run_skill",
                  arguments: JSON.stringify({
                    skill_name: "loop-cancel",
                    input: "inspect",
                  }),
                },
              },
            ],
          },
        };
      }
      return { message: { role: "assistant", content: "must not run" } };
    });
    const controller = new AbortController();
    const reason = Object.assign(new Error("loop parent stopped"), {
      name: "AbortError",
    });
    const messages = [{ role: "user", content: "use the skill" }];
    const draining = (async () => {
      const events = [];
      for await (const event of agentLoop(messages, {
        cwd: tempDir,
        signal: controller.signal,
        chatFn,
        skillLoader: { getResolvedSkills: () => mocks.skills },
        autoCompact: false,
        runnableProviderFallback: false,
      })) {
        events.push(event);
      }
      return events;
    })();
    await vi.waitFor(() => expect(childRun).toHaveBeenCalledOnce());

    controller.abort(reason);
    await expect(draining).rejects.toBe(reason);
    resolveChild({ summary: "late loop child success", toolsUsed: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(messages.some((message) => message.role === "tool")).toBe(false);
    expect(chatFn).toHaveBeenCalledOnce();
  });

  it("awaits the host's async execution materializer before creating the child", async () => {
    registerSkill({ id: "async-authorized", isolation: true });
    const controller = new AbortController();
    const materializeSkillForExecution = vi.fn(async (skill, context) => {
      await Promise.resolve();
      expect(context.loadedBecause).toBe("run_skill");
      expect(context.signal).toBe(controller.signal);
      return { ...skill, body: "# Authorized after IDE confirmation" };
    });
    const skillLoader = {
      getResolvedSkills: () => mocks.skills,
      materializeSkillForExecution,
    };

    const result = await executeTool(
      "run_skill",
      { skill_name: "async-authorized", input: "inspect" },
      { cwd: tempDir, skillLoader, signal: controller.signal },
    );

    expect(result).toMatchObject({ success: true, isolated: true });
    expect(materializeSkillForExecution).toHaveBeenCalledOnce();
    expect(mocks.childConfigs[0].task).toContain(
      "Authorized after IDE confirmation",
    );
  });

  it("inherits parent authority objects without adding executable MCP definitions", async () => {
    registerSkill({ id: "guarded", isolation: true });
    const permissionRules = { evaluate: vi.fn() };
    const hostManagedToolPolicy = {
      tools: { read_file: { allowed: true } },
      toolDefinitions: [
        { type: "function", function: { name: "host_external" } },
      ],
    };
    const approvalGate = vi.fn();
    const mcpCallLedger = { begin: vi.fn() };
    const mcpConflictScheduler = { acquire: vi.fn() };

    await executeTool(
      "run_skill",
      { skill_name: "guarded", input: "x" },
      {
        cwd: tempDir,
        permissionRules,
        hostManagedToolPolicy,
        approvalGate,
        mcpCallLedger,
        mcpConflictScheduler,
      },
    );

    expect(mocks.childConfigs[0]).toMatchObject({
      permissionRules,
      approvalGate,
      mcpCallLedger,
      mcpConflictScheduler,
      hostManagedToolPolicy: {
        tools: hostManagedToolPolicy.tools,
        toolDefinitions: [],
      },
    });
  });

  it("surfaces isolated child failure without falling back to the handler", async () => {
    registerSkill({ id: "broken", isolation: true });
    mocks.createSubAgent.mockReturnValueOnce({
      id: "broken-child",
      run: vi.fn(async () => {
        throw new Error("child failed");
      }),
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "broken", input: "x" },
      { cwd: tempDir },
    );

    expect(result.error).toMatch(
      /Isolated skill execution failed.*child failed/,
    );
    expect(result).toMatchObject({
      success: false,
      isolated: true,
      skill: "broken",
      code: "CC_SKILL_ISOLATED_EXECUTION_FAILED",
    });
  });

  it("does not wrap a resolved failed child result as success", async () => {
    registerSkill({ id: "resolved-broken", isolation: true });
    const child = {
      id: "resolved-broken-child",
      status: "active",
      run: vi.fn(async () => {
        child.status = "failed";
        return {
          summary: "Sub-agent failed: provider disconnected",
          artifacts: [],
          toolsUsed: [],
        };
      }),
    };
    mocks.createSubAgent.mockReturnValueOnce(child);

    const result = await executeTool(
      "run_skill",
      { skill_name: "resolved-broken", input: "x" },
      { cwd: tempDir },
    );

    expect(result).toMatchObject({
      success: false,
      isolated: true,
      skill: "resolved-broken",
      code: "CC_SKILL_ISOLATED_EXECUTION_FAILED",
      summary: "Sub-agent failed: provider disconnected",
    });
    expect(result.error).toContain("provider disconnected");
  });

  it("preserves the materialization security incident code", async () => {
    registerSkill({ id: "changed", isolation: true });
    const error = Object.assign(new Error("digest changed"), {
      code: "CC_SKILL_DIGEST_DRIFT",
    });
    const skillLoader = {
      getResolvedSkills: () => mocks.skills,
      materializeSkill: () => {
        throw error;
      },
    };

    const result = await executeTool(
      "run_skill",
      { skill_name: "changed", input: "x" },
      { cwd: tempDir, skillLoader },
    );

    expect(result).toMatchObject({
      code: "CC_SKILL_DIGEST_DRIFT",
      policy: { decision: "blocked", via: "skill-execution-boundary" },
    });
  });

  it("list_skills restricts descriptors to the contract allow-list", async () => {
    registerSkill({ id: "alpha" });
    registerSkill({ id: "beta" });
    registerSkill({ id: "gamma" });

    const restricted = await executeTool(
      "list_skills",
      {},
      { cwd: tempDir, skillAllowlist: ["alpha", "gamma"] },
    );

    expect(restricted.skills.map((skill) => skill.id).sort()).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("list_skills query returns ranked digest-bound routing evidence", async () => {
    registerSkill({ id: "write-docs", description: "write release notes" });
    registerSkill({
      id: "repair-tests",
      description: "repair failing vitest unit tests",
    });

    const result = await executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      { cwd: tempDir },
    );

    expect(result).toMatchObject({
      count: 1,
      routing: {
        schema: "chainlesschain.skill-retrieval-result/v1",
        selectedDigest: mocks.skills[1].executionIdentity.contentDigest,
        vectorAvailable: false,
        outcomeAuthority: {
          schema: "chainlesschain.skill-outcome-transcript-authority/v1",
          status: expect.stringMatching(/^(verified|unavailable)$/u),
        },
      },
      skills: [
        {
          id: "repair-tests",
          digest: mocks.skills[1].executionIdentity.contentDigest,
          version: "1.0.0",
          routeReason: expect.stringContaining("bm25="),
        },
      ],
    });
  });

  it("list_skills query consumes the host transcript outcome authority", async () => {
    registerSkill({ id: "alpha-repair", description: "repair failing tests" });
    registerSkill({ id: "omega-repair", description: "repair failing tests" });
    mocks.outcomeMetrics = {
      [mocks.skills[0].executionIdentity.contentDigest]: {
        samples: 10,
        successRate: 0.1,
        correctionRate: 0.5,
      },
      [mocks.skills[1].executionIdentity.contentDigest]: {
        samples: 10,
        successRate: 0.9,
        correctionRate: 0,
      },
    };

    const result = await executeTool(
      "list_skills",
      { query: "repair failing tests" },
      { cwd: tempDir },
    );

    expect(result.routing.selectedDigest).toBe(
      mocks.skills[1].executionIdentity.contentDigest,
    );
    expect(result.skills[0]).toMatchObject({
      id: "omega-repair",
      digest: mocks.skills[1].executionIdentity.contentDigest,
    });
  });

  it("list_skills query consumes only a branded verified vector authority", async () => {
    registerSkill({ id: "alpha-repair", description: "repair failing tests" });
    registerSkill({ id: "omega-repair", description: "repair failing tests" });
    const preferred = mocks.skills[1].executionIdentity.contentDigest;
    const authority = vectorAuthority((digest) =>
      digest === preferred ? 1 : 0.1,
    );

    const result = await executeTool(
      "list_skills",
      { query: "repair failing tests" },
      { cwd: tempDir, skillVectorAuthority: authority },
    );

    expect(result.routing).toMatchObject({
      selectedDigest: preferred,
      vectorAvailable: true,
      vectorAuthority: {
        status: "verified",
        tenantId: "tenant:test",
        modelId: "embedding:model",
        indexDigest: D("agent-vector-index"),
      },
    });
    expect(result.skills[0].id).toBe("omega-repair");
    await expect(
      executeTool(
        "list_skills",
        { query: "repair failing tests" },
        { cwd: tempDir, skillVectorAuthority: { tenantId: "tenant:test" } },
      ),
    ).rejects.toThrow(/branded Skill vector authority/u);
  });

  it("list_skills excludes content invalidated by the durable revocation authority", async () => {
    registerSkill({ id: "repair-tests", description: "repair failing tests" });
    registerSkill({ id: "repair-docs", description: "repair documentation" });
    const revoked = mocks.skills[0];
    let stored = null;
    const authority = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant:test",
      ports: {
        async load() {
          return {
            authenticated: true,
            durable: true,
            found: stored !== null,
            state: stored,
            receiptDigest: D(stored?.stateDigest ?? "empty-revocations"),
          };
        },
        async commit({ state }) {
          stored = structuredClone(state);
          return {
            authenticated: true,
            durable: true,
            committed: true,
            stateDigest: state.stateDigest,
            receiptDigest: D("revocation-commit"),
          };
        },
      },
    });
    const core = {
      schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
      tenantId: "tenant:test",
      streamId: "pilot-stream",
      operationId: "skill-revocation:repair-tests",
      transitionDigest: D("transition"),
      candidateId: D("candidate"),
      skillName: revoked.id,
      occurredAt: "2026-09-05T08:00:00.000Z",
      sourceReceiptDigest: D("source"),
      resolutionDigest: D("resolution"),
      dependency: {
        kind: "retrieval-index",
        ref: `skill-content:tenant:test:${revoked.id}`,
        digest: revoked.executionIdentity.contentDigest,
        disposition: "invalidate",
      },
    };
    await authority.invalidateRetrieval({
      ...core,
      requestDigest: digestSkillRevocationDependencyRequest(core),
    });

    const result = await executeTool(
      "list_skills",
      { query: "repair failing tests" },
      {
        cwd: tempDir,
        skillRetrievalRevocationReader: authority,
      },
    );

    expect(result.skills.map(({ id }) => id)).not.toContain(revoked.id);
    expect(result.routing.rejectedCount).toBeGreaterThanOrEqual(1);
  });

  it("does not hide a configured invalid index behind transcript fallback", async () => {
    registerSkill({ id: "repair-tests", description: "repair failing tests" });

    const result = await executeTool(
      "list_skills",
      { query: "repair failing tests" },
      {
        cwd: tempDir,
        skillOutcomeIndex: { tenantId: "tenant:test", readers: [] },
      },
    );

    expect(result.routing.outcomeAuthority).toEqual({
      schema: "chainlesschain.skill-outcome-index-authority/v1",
      status: "unavailable",
      code: "CC_SKILL_OUTCOME_INDEX_AUTHORITY_UNAVAILABLE",
      antiRollbackWitness: false,
    });
  });

  it("treats an empty skill allow-list as deny-all", async () => {
    registerSkill({ id: "alpha" });

    const result = await executeTool(
      "list_skills",
      {},
      { cwd: tempDir, skillAllowlist: [] },
    );

    expect(result.error).toMatch(/restricted by its contract/i);
  });

  it("does not let an allowed skill escape the controlled execution boundary", async () => {
    registerSkill({ id: "alpha" });
    registerSkill({ id: "beta" });

    const denied = await executeTool(
      "run_skill",
      { skill_name: "beta", input: "x" },
      { cwd: tempDir, skillAllowlist: ["alpha"] },
    );
    const allowed = await executeTool(
      "run_skill",
      { skill_name: "alpha", input: "x" },
      { cwd: tempDir, skillAllowlist: ["alpha"] },
    );

    expect(denied.error).toMatch(/not found/i);
    expect(allowed.code).toBe("CC_SKILL_DIRECT_HANDLER_BLOCKED");
  });
});
