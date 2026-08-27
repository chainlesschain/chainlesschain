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
const {
  CrossOrgTaskRouter,
} = require("../../cowork/cross-org-task-router.js");
const { DeployAgent } = require("../../cowork/deploy-agent.js");
const { PostDeployMonitor } = require("../../cowork/post-deploy-monitor.js");
const { AutoRemediator } = require("../../cowork/auto-remediator.js");
const { RollbackManager } = require("../../cowork/rollback-manager.js");
const { TeammateTool } = require("../../cowork/teammate-tool.js");
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
    await expect(
      new SkillWorkflowEngine().executeWorkflow("workflow"),
    ).rejects.toEqual(expected);
    await expect(
      new SkillPipelineEngine().executePipeline("pipeline"),
    ).rejects.toEqual(expected);
    expect(() =>
      assertDesktopLegacyMutationAllowed("AIEngineManagerP1.processUserInput"),
    ).toThrowError(expected);
    expect(() => new AutonomousAgentRunner().initialize({})).toThrowError(
      expected,
    );
    await expect(new AgentTaskQueue().initialize(null)).rejects.toEqual(
      expected,
    );
    await expect(
      new LongRunningTaskManager().createTask({ name: "legacy task" }),
    ).rejects.toEqual(expected);
    await expect(new PipelineOrchestrator().initialize(null)).rejects.toEqual(
      expected,
    );
    await expect(new HybridExecutor().initialize()).rejects.toEqual(expected);
    await expect(new P2PAgentNetwork().initialize()).rejects.toEqual(expected);
    await expect(new CrossOrgTaskRouter().initialize()).rejects.toEqual(
      expected,
    );
    await expect(new DeployAgent().deploy({})).rejects.toEqual(expected);
    expect(() => new PostDeployMonitor().startMonitoring({})).toThrowError(
      expected,
    );
    await expect(new AutoRemediator().triggerRemediation({})).rejects.toEqual(
      expected,
    );
    await expect(new RollbackManager().rollback({})).rejects.toEqual(expected);
    expect(() => new TeammateTool({ useAgentPool: false })).toThrowError(
      expected,
    );
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
