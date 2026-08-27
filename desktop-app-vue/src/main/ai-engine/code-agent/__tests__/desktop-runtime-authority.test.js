import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const {
  assertDesktopLegacyMutationAllowed,
  desktopGraphAuthorityMode,
  desktopLegacyRuntimeClaims,
} = require("../desktop-runtime-authority.js");
const { AgentCoordinator } = require("../../agents/agent-coordinator.js");
const {
  AgentOrchestrator,
} = require("../../multi-agent/agent-orchestrator.js");
const { WorkflowPipeline } = require("../../../workflow/workflow-pipeline.js");
const { WorkflowEngine } = require("../../workflow/workflow-engine.js");
const {
  SkillWorkflowEngine,
} = require("../../cowork/skills/skill-workflow-engine.js");
const {
  SkillPipelineEngine,
} = require("../../cowork/skills/skill-pipeline-engine.js");
const {
  AutonomousAgentRunner,
} = require("../../autonomous/autonomous-agent-runner.js");
const { AgentTaskQueue } = require("../../autonomous/agent-task-queue.js");
const {
  LongRunningTaskManager,
} = require("../../cowork/long-running-task-manager.js");
const {
  PipelineOrchestrator,
} = require("../../cowork/pipeline-orchestrator.js");
const { HybridExecutor } = require("../../cowork/hybrid-executor.js");
const { P2PAgentNetwork } = require("../../cowork/p2p-agent-network.js");
const { CrossOrgTaskRouter } = require("../../cowork/cross-org-task-router.js");
const { DeployAgent } = require("../../cowork/deploy-agent.js");
const { PostDeployMonitor } = require("../../cowork/post-deploy-monitor.js");
const { AutoRemediator } = require("../../cowork/auto-remediator.js");
const { RollbackManager } = require("../../cowork/rollback-manager.js");
const { TeammateTool } = require("../../cowork/teammate-tool.js");
const { AgentPool } = require("../../cowork/agent-pool.js");
const {
  BrowserAutomationAgent,
} = require("../../../browser/browser-automation-agent.js");
const {
  WorkflowEngine: BrowserWorkflowEngine,
} = require("../../../browser/workflow/workflow-engine.js");
const {
  WorkflowEngine: BrowserActionWorkflowEngine,
} = require("../../../browser/actions/workflow-engine.js");
const {
  WorkflowEngine: RemoteWorkflowEngine,
} = require("../../../remote/workflow/workflow-engine.js");
const {
  assertBrowserWorkflowEnabled,
  browserWorkflowRuntimeClaims,
} = require("../../../browser/workflow/browser-workflow-authority.js");

const originalDesktopMode = process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
const originalReadOnly = process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY;
const originalBrowserExperimental =
  process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL;

afterEach(() => {
  if (originalDesktopMode === undefined) {
    delete process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
  } else {
    process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = originalDesktopMode;
  }
  if (originalReadOnly === undefined) {
    delete process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY;
  } else {
    process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY = originalReadOnly;
  }
  if (originalBrowserExperimental === undefined) {
    delete process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL;
  } else {
    process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL =
      originalBrowserExperimental;
  }
});

describe("Desktop Graph authority retirement", () => {
  it("keeps every legacy AI manager and task planner behind the source guard", () => {
    const guarded = new Map([
      [
        "src/main/ai-engine/ai-engine-manager.js",
        [
          "AIEngineManager.initialize",
          "AIEngineManager.processUserInput",
          "AIEngineManager.clearHistory",
        ],
      ],
      [
        "src/main/ai-engine/ai-engine-manager-optimized.js",
        [
          "AIEngineManagerOptimized.initialize",
          "AIEngineManagerOptimized.processUserInput",
          "AIEngineManagerOptimized.cleanOldPerformanceData",
        ],
      ],
      [
        "src/main/ai-engine/ai-engine-manager-p1.js",
        [
          "AIEngineManagerP1.initialize",
          "AIEngineManagerP1.processUserInput",
          "AIEngineManagerP1.cleanOldPerformanceData",
        ],
      ],
      [
        "src/main/ai-engine/task-planner.js",
        ["TaskPlanner.initialize", "TaskPlanner.decomposeTask"],
      ],
      [
        "src/main/ai-engine/task-planner-enhanced.js",
        [
          "TaskPlannerEnhanced.decomposeTask",
          "TaskPlannerEnhanced.saveTaskPlan",
          "TaskPlannerEnhanced.updateTaskPlan",
          "TaskPlannerEnhanced.executeTaskPlan",
          "TaskPlannerEnhanced.executeSubtask",
          "TaskPlannerEnhanced.cancelTaskPlan",
        ],
      ],
    ]);
    for (const [file, entrypoints] of guarded) {
      const source = fs
        .readFileSync(path.resolve(process.cwd(), file), "utf8")
        .replace(/\s+/gu, "");
      for (const entrypoint of entrypoints) {
        expect(source).toContain(
          `assertDesktopLegacyMutationAllowed("${entrypoint}"`,
        );
      }
    }
  });

  it("publishes truthful legacy, shadow, and canonical claims", () => {
    expect(desktopGraphAuthorityMode({})).toBe("legacy");
    expect(
      desktopLegacyRuntimeClaims({ CHAINLESSCHAIN_GRAPH_DESKTOP: "shadow" }),
    ).toMatchObject({
      authorityMode: "shadow",
      authoritySource: "graph_kernel_shadow",
      execution: "legacy",
      legacyReadOnly: false,
    });
    expect(
      desktopLegacyRuntimeClaims({
        CHAINLESSCHAIN_GRAPH_DESKTOP: "canonical",
      }),
    ).toMatchObject({
      authoritySource: "graph_kernel",
      execution: "designer-only",
      legacyReadOnly: true,
    });
  });

  it("resolves a declared Desktop entry with a stable per-run key", () => {
    const seen = [];
    expect(
      desktopGraphAuthorityMode(
        { CHAINLESSCHAIN_GRAPH_DESKTOP: "legacy" },
        {
          entryId: "desktop-workflow-manager",
          runKey: "desktop-workflow:stable",
          optIn: true,
          resolver: (input) => {
            seen.push(input);
            return { mode: "canonical" };
          },
        },
      ),
    ).toBe("canonical");
    expect(seen).toEqual([{ runKey: "desktop-workflow:stable", optIn: true }]);
  });

  it("fails every classified legacy mutation closed in canonical mode", async () => {
    process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = "canonical";
    const expected = expect.objectContaining({
      code: "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY",
      authoritySource: "graph_kernel",
      replacementEntrypoint: expect.any(String),
      replacementEntryIds: expect.arrayContaining([expect.any(String)]),
      historicalReadFunctions: expect.arrayContaining([expect.any(String)]),
    });
    expect(() =>
      assertDesktopLegacyMutationAllowed("AIEngineManagerP1.processUserInput"),
    ).toThrowError(expected);
    await expect(new AgentCoordinator().orchestrate("task")).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new AgentCoordinator().assignTask("agent", "task"),
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new AgentOrchestrator().dispatch({ id: "legacy-task", type: "code" }),
    ).rejects.toEqual(expected);
    await expect(
      new AgentOrchestrator().sendMessage("agent-a", "agent-b", {
        id: "legacy-message",
      }),
    ).rejects.toEqual(expected);
    await expect(new AgentOrchestrator().executeParallel([])).rejects.toEqual(
      expected,
    );
    await expect(new AgentOrchestrator().executeChain([])).rejects.toEqual(
      expected,
    );
    expect(() =>
      new AgentOrchestrator().registerAgent({ agentId: "legacy-agent" }),
    ).toThrowError(expected);
    await expect(
      new AgentCoordinator().cancelTask("task"),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Active Graph task not found"),
    });
    await expect(new WorkflowPipeline().execute({})).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new WorkflowEngine().executeWorkflow("workflow"),
    ).rejects.toEqual(expected);
    expect(() =>
      new WorkflowEngine().createWorkflow({ name: "must-not-write" }),
    ).toThrowError(expected);
    await expect(
      new SkillWorkflowEngine().executeWorkflow("workflow"),
    ).rejects.toEqual(expected);
    await expect(
      new SkillPipelineEngine().executePipeline("pipeline"),
    ).rejects.toEqual(expected);
    expect(() =>
      new SkillWorkflowEngine().createWorkflow({ name: "must-not-write" }),
    ).toThrowError(expected);
    expect(() =>
      new SkillPipelineEngine().createPipeline({ name: "must-not-write" }),
    ).toThrowError(expected);
    expect(() =>
      assertDesktopLegacyMutationAllowed("AIEngineManagerP1.processUserInput"),
    ).toThrowError(expected);
    const historicalGoalRow = {
      id: "historical-goal",
      description: "completed before cutover",
      priority: 1,
      status: "completed",
      tool_permissions: "[]",
      context: "{}",
      plan: "{}",
      result: "done",
      step_count: 1,
      tokens_used: 2,
      error_message: null,
      created_by: "user",
      created_at: "2026-08-27T00:00:00.000Z",
      updated_at: "2026-08-27T00:01:00.000Z",
      completed_at: "2026-08-27T00:01:00.000Z",
    };
    const historicalGoalDb = {
      exec: () => {
        throw new Error("historical goal read attempted schema mutation");
      },
      prepare: (sql) => ({
        get: () => {
          expect(sql).toContain("SELECT * FROM autonomous_goals");
          return historicalGoalRow;
        },
      }),
    };
    const historicalRunner = new AutonomousAgentRunner();
    expect(() =>
      historicalRunner.initialize({ database: historicalGoalDb }),
    ).not.toThrow();
    expect(historicalRunner.legacyReadOnly).toBe(true);
    await expect(
      historicalRunner.getGoalStatus("historical-goal"),
    ).resolves.toMatchObject({
      success: true,
      data: { id: "historical-goal", status: "completed" },
    });
    await expect(
      historicalRunner.submitGoal({ description: "must not execute" }),
    ).rejects.toEqual(expected);
    expect(() =>
      historicalRunner.updateConfig({ maxStepsPerGoal: 2 }),
    ).toThrowError(expected);

    const historicalQueueDb = {
      exec: () => {
        throw new Error("historical queue read attempted schema mutation");
      },
      run: () => {
        throw new Error("historical queue read attempted a write");
      },
      prepare: (sql) => ({
        all: () =>
          sql.includes("status = 'queued'")
            ? [
                {
                  id: "historical-queue-item",
                  goal_id: "historical-goal",
                  priority: 1,
                  description: "queued before cutover",
                  status: "queued",
                  created_at: "2026-08-27T00:00:00.000Z",
                  started_at: null,
                  completed_at: null,
                },
              ]
            : [],
        get: () => ({ count: 0 }),
      }),
    };
    const historicalQueue = new AgentTaskQueue();
    await expect(
      historicalQueue.initialize(historicalQueueDb),
    ).resolves.toBeUndefined();
    expect(historicalQueue.legacyReadOnly).toBe(true);
    await expect(historicalQueue.getQueueStatus()).resolves.toMatchObject({
      success: true,
      data: { pending: 1 },
    });
    await expect(
      historicalQueue.enqueue({ goalId: "must-not-write" }),
    ).rejects.toEqual(expected);
    expect(() => historicalQueue.reSort()).toThrowError(expected);
    await expect(new AgentPool().initialize()).rejects.toEqual(expected);
    await expect(
      new LongRunningTaskManager().createTask({ name: "legacy task" }),
    ).rejects.toEqual(expected);
    const historicalPipelineDb = {
      prepare: (sql) => ({
        all: () =>
          sql.includes("FROM dev_pipelines")
            ? [
                {
                  id: "historical-pipeline",
                  name: "completed before cutover",
                  template: "feature",
                  requirement: "legacy requirement",
                  spec_json: "{}",
                  status: "completed",
                  current_stage: null,
                  config: "{}",
                  metrics: "{}",
                  created_by: "user",
                  created_at: "2026-08-27T00:00:00.000Z",
                  updated_at: "2026-08-27T00:01:00.000Z",
                  completed_at: "2026-08-27T00:01:00.000Z",
                },
              ]
            : [],
        run: () => {
          throw new Error("historical pipeline read attempted a write");
        },
      }),
    };
    const historicalPipeline = new PipelineOrchestrator();
    await expect(
      historicalPipeline.initialize(historicalPipelineDb),
    ).resolves.toBeUndefined();
    expect(historicalPipeline.legacyReadOnly).toBe(true);
    expect(historicalPipeline.getAllPipelines()).toEqual([
      expect.objectContaining({
        id: "historical-pipeline",
        status: "completed",
      }),
    ]);
    await expect(
      historicalPipeline.startPipeline("historical-pipeline"),
    ).rejects.toEqual(expected);
    await expect(new HybridExecutor().initialize()).rejects.toEqual(expected);
    await expect(new HybridExecutor().executeBatch([])).rejects.toEqual(
      expected,
    );
    const historicalP2P = new P2PAgentNetwork({
      mobileBridge: {
        on: () => {
          throw new Error("historical P2P read attached a transport listener");
        },
      },
      database: {
        exec: () => {
          throw new Error("historical P2P read attempted schema mutation");
        },
      },
    });
    await expect(historicalP2P.initialize()).resolves.toBeUndefined();
    expect(historicalP2P).toMatchObject({
      legacyReadOnly: true,
      initialized: true,
      _heartbeatTimer: null,
      _heartbeatCheckTimer: null,
    });
    await expect(historicalP2P.announcePresence()).rejects.toEqual(expected);
    expect(() => historicalP2P._startHeartbeat()).toThrowError(expected);

    const historicalTaskRow = {
      id: "historical-route",
      task_id: "historical-route",
      requester_did: "did:requester",
      executor_did: "did:executor",
      task_type: "legacy",
      description: "completed before cutover",
      status: "completed",
      input_hash: "input",
      output_hash: "output",
      credential_proof: null,
      duration_ms: 5,
      result: JSON.stringify({ ok: true }),
      created_at: "2026-08-27T00:00:00.000Z",
      completed_at: "2026-08-27T00:01:00.000Z",
    };
    const historicalRouterDb = {
      exec: () => {
        throw new Error("historical route read attempted schema mutation");
      },
      run: () => {
        throw new Error("historical route read attempted a write");
      },
      prepare: (sql) => ({
        all: () =>
          sql.includes("status IN ('pending', 'routing', 'executing')")
            ? []
            : [historicalTaskRow],
      }),
    };
    const historicalRouter = new CrossOrgTaskRouter();
    await expect(
      historicalRouter.initialize(historicalRouterDb),
    ).resolves.toBeUndefined();
    expect(historicalRouter.legacyReadOnly).toBe(true);
    expect(historicalRouter._cleanupTimer).toBeNull();
    expect(historicalRouter.getTaskLog()).toEqual([
      expect.objectContaining({
        taskId: "historical-route",
        status: "completed",
      }),
    ]);
    await expect(
      historicalRouter.routeTask({
        requesterDID: "did:new",
        taskType: "must-not-write",
      }),
    ).rejects.toEqual(expected);
    expect(() => historicalRouter.destroy()).toThrowError(expected);
    await expect(new DeployAgent().deploy({})).rejects.toEqual(expected);
    expect(() => new PostDeployMonitor().startMonitoring({})).toThrowError(
      expected,
    );
    const historicalRemediationDb = {
      prepare: () => ({
        all: () => [
          {
            id: "historical-playbook",
            name: "legacy playbook",
            description: "read only",
            trigger_config: "{}",
            steps: "[]",
            rollback_on_failure: 1,
            notify_channels: "[]",
            active: 1,
            success_count: 1,
            failure_count: 0,
            avg_duration_ms: 5,
            created_at: "2026-08-27T00:00:00.000Z",
          },
        ],
        run: () => {
          throw new Error("historical remediation read attempted a write");
        },
      }),
    };
    const historicalRemediator = new AutoRemediator();
    await expect(
      historicalRemediator.initialize(historicalRemediationDb),
    ).resolves.toBeUndefined();
    expect(historicalRemediator.legacyReadOnly).toBe(true);
    expect(historicalRemediator.getPlaybooks()).toEqual([
      expect.objectContaining({ id: "historical-playbook" }),
    ]);
    await expect(historicalRemediator.triggerRemediation({})).rejects.toEqual(
      expected,
    );

    const historicalRollback = new RollbackManager();
    await expect(historicalRollback.initialize(null)).resolves.toBeUndefined();
    expect(historicalRollback.legacyReadOnly).toBe(true);
    expect(historicalRollback.getHistory()).toEqual([]);
    await expect(historicalRollback.rollback({})).rejects.toEqual(expected);
    const historicalDb = {
      run: () => {
        throw new Error("historical read attempted a write");
      },
      all: async (sql, params) => {
        expect(sql).toContain("FROM cowork_teams");
        expect(params).toEqual([]);
        return [
          {
            id: "historical-team",
            name: "completed before cutover",
            status: "completed",
            max_agents: 5,
            created_at: 1,
            metadata: JSON.stringify({ allowDynamicJoin: false }),
            agent_count: 2,
          },
        ];
      },
      get: async (sql, params) => {
        expect(sql).toContain("SELECT * FROM cowork_tasks");
        expect(params).toEqual(["historical-task"]);
        return {
          id: "historical-task",
          team_id: "historical-team",
          description: "completed before cutover",
          status: "completed",
          priority: 1,
          assigned_to: "historical-agent",
          result: JSON.stringify({ ok: true }),
          created_at: 1,
          completed_at: 2,
          metadata: JSON.stringify({ source: "legacy" }),
        };
      },
    };
    const historicalTeammateTool = new TeammateTool(historicalDb);
    expect(historicalTeammateTool.legacyReadOnly).toBe(true);
    expect(historicalTeammateTool.getAgentPoolStatus()).toEqual({
      enabled: false,
    });
    await expect(historicalTeammateTool.discoverTeams()).resolves.toEqual([
      expect.objectContaining({
        id: "historical-team",
        status: "completed",
        agentCount: 2,
      }),
    ]);
    await expect(
      historicalTeammateTool.getTask("historical-task"),
    ).resolves.toMatchObject({
      id: "historical-task",
      status: "completed",
      result: { ok: true },
      metadata: { source: "legacy" },
    });
    await expect(
      historicalTeammateTool.spawnTeam("must-not-write"),
    ).rejects.toEqual(expected);

    const historicalWorkflowDb = {
      exec: () => {
        throw new Error("historical workflow read attempted schema mutation");
      },
      prepare: (sql) => ({
        all: () =>
          sql.includes("FROM workflows")
            ? [
                {
                  id: "historical-workflow",
                  name: "completed before cutover",
                  description: "read only",
                  dag: JSON.stringify({ stages: [], edges: [] }),
                  version: 1,
                  status: "completed",
                },
              ]
            : [],
        get: () =>
          sql.includes("FROM workflow_executions")
            ? { log: JSON.stringify([{ status: "completed" }]) }
            : null,
        run: () => {
          throw new Error("historical workflow read attempted a write");
        },
      }),
    };
    const historicalWorkflow = new WorkflowEngine();
    await expect(
      historicalWorkflow.initialize(historicalWorkflowDb),
    ).resolves.toBeUndefined();
    expect(historicalWorkflow.legacyReadOnly).toBe(true);
    expect(historicalWorkflow.getAllWorkflows()).toEqual([
      expect.objectContaining({ id: "historical-workflow" }),
    ]);
    expect(historicalWorkflow.getExecutionLog("historical-execution")).toEqual([
      { status: "completed" },
    ]);
  });

  it("keeps Browser workflow non-durable and disabled by default", async () => {
    delete process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL;
    expect(browserWorkflowRuntimeClaims({})).toMatchObject({
      execution: "disabled",
      persistence: "non_durable",
      featureGated: true,
    });
    expect(() =>
      assertBrowserWorkflowEnabled("browser:workflow:execute", {}),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
      }),
    );
    expect(
      assertBrowserWorkflowEnabled("browser:workflow:execute", {
        CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL: "1",
      }),
    ).toBe(true);
    const browserAgent = new BrowserAutomationAgent(null, null);
    await expect(
      browserAgent.execute("tab-1", "legacy automation"),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
      }),
    );
    expect(browserAgent.executionHistory).toEqual([]);
    await expect(
      new BrowserWorkflowEngine(null).executeWorkflow({ id: "disabled" }),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
    });
    expect(() => new BrowserWorkflowEngine(null).cancel("disabled")).toThrow(
      expect.objectContaining({
        code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
      }),
    );
    await expect(
      new BrowserActionWorkflowEngine().execute("disabled"),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
    });
    await expect(
      new RemoteWorkflowEngine().execute({ id: "disabled" }),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
    });
  });
});
