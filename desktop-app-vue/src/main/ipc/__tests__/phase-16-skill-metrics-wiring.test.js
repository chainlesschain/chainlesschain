import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const require = createRequire(import.meta.url);
const { registerPhases16to20 } = require("../phases/phase-16-20-skill-evo");
const { BaseSkill } = require("../../ai-engine/cowork/skills/base-skill");
const {
  SkillRegistry,
} = require("../../ai-engine/cowork/skills/skill-registry");
const {
  SkillPipelineEngine,
} = require("../../ai-engine/cowork/skills/skill-pipeline-engine");
const {
  SkillMetricsCollector,
} = require("../../ai-engine/cowork/skills/skill-metrics-collector");
const {
  SkillWorkflowEngine,
} = require("../../ai-engine/cowork/skills/skill-workflow-engine");
const {
  registerSkillPipelineIPC,
} = require("../../ai-engine/cowork/skills/skill-pipeline-ipc");
const {
  registerSkillMetricsIPC,
} = require("../../ai-engine/cowork/skills/skill-metrics-ipc");
const {
  registerSkillWorkflowIPC,
} = require("../../ai-engine/cowork/skills/skill-workflow-ipc");

class MeteredSkill extends BaseSkill {
  constructor() {
    super({ skillId: "metered-skill", name: "Metered Skill" });
  }

  async execute() {
    return {
      success: true,
      usage: { input_tokens: 12, output_tokens: 8 },
      costUsd: 0.025,
    };
  }
}

class FailingSkill extends BaseSkill {
  constructor() {
    super({ skillId: "failing-skill", name: "Failing Skill" });
  }

  async execute() {
    throw new Error("intentional failure");
  }
}

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
  };
}

function invoke(ipcMain, channel, payload) {
  const handler = ipcMain.handlers.get(channel);
  if (!handler) {
    throw new Error(`handler not registered: ${channel}`);
  }
  return handler({}, payload);
}

describe("Phase 16 Skill service wiring", () => {
  let registeredModules;
  let previousGraphMode;

  beforeEach(() => {
    previousGraphMode = process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
    process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = "legacy";
    registeredModules = {};
  });

  afterEach(() => {
    registeredModules.skillMetricsCollector?.destroy();
    if (previousGraphMode === undefined) {
      delete process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
    } else {
      process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = previousGraphMode;
    }
    vi.restoreAllMocks();
  });

  it("persists direct success, direct failure, and parallel branch metrics once", async () => {
    const database = { run: vi.fn().mockResolvedValue(undefined) };
    const skillRegistry = new SkillRegistry({ autoLoad: false });
    const ipcMain = makeIpcMain();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const enabledRegistrars = new Set([
      "Skill Pipeline IPC",
      "Skill Metrics IPC",
      "Skill Workflow IPC",
    ]);
    const safeRegister = vi.fn((name, options) => {
      if (enabledRegistrars.has(name)) {
        options.register();
      }
      return true;
    });

    registerPhases16to20({
      safeRegister,
      logger,
      deps: {
        database,
        skillRegistry,
        ipcMain,
        BrowserWindow: { getAllWindows: () => [] },
        hookSystem: null,
      },
      registeredModules,
    });

    expect(registeredModules.skillRegistry).toBe(skillRegistry);
    expect(registeredModules.skillPipelineEngine).toBeInstanceOf(
      SkillPipelineEngine,
    );
    expect(registeredModules.skillMetricsCollector).toBeInstanceOf(
      SkillMetricsCollector,
    );
    expect(registeredModules.skillWorkflowEngine).toBeInstanceOf(
      SkillWorkflowEngine,
    );
    expect(registeredModules.skillPipelineEngine.metricsCollector).toBe(
      registeredModules.skillMetricsCollector,
    );
    expect(registeredModules.skillMetricsCollector.pipelineEngine).toBe(
      registeredModules.skillPipelineEngine,
    );
    expect(registeredModules.skillRegistry.skillMetricsCollector).toBe(
      registeredModules.skillMetricsCollector,
    );
    expect(registeredModules.skillWorkflowEngine.pipelineEngine).toBe(
      registeredModules.skillPipelineEngine,
    );

    skillRegistry.register(new MeteredSkill());
    const completedEvent = vi.fn();
    skillRegistry.once("skill-completed", completedEvent);
    const created = await invoke(ipcMain, "pipeline:create", {
      id: "metrics-pipeline",
      name: "Metrics Pipeline",
      steps: [{ type: "skill", skillId: "metered-skill" }],
    });
    expect(created).toEqual({
      success: true,
      data: { id: "metrics-pipeline" },
    });

    const executed = await invoke(ipcMain, "pipeline:execute", {
      pipelineId: "metrics-pipeline",
      context: {},
    });
    expect(executed.success).toBe(true);
    expect(executed.data.state).toBe("completed");
    expect(completedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "metered-skill",
        skill: "metered-skill",
        pipelineId: "metrics-pipeline",
        metrics: expect.objectContaining({
          executionTime: expect.any(Number),
          durationMs: expect.any(Number),
          tokensInput: 12,
          tokensOutput: 8,
          tokensUsed: 20,
          cost: 0.025,
        }),
      }),
    );

    const exported = registeredModules.skillMetricsCollector.exportMetrics();
    expect(exported.buffer).toHaveLength(1);
    expect(exported.buffer[0]).toMatchObject({
      skillId: "metered-skill",
      pipelineId: "metrics-pipeline",
      success: 1,
      tokensInput: 12,
      tokensOutput: 8,
      costUsd: 0.025,
    });

    await expect(registeredModules.skillMetricsCollector.flush()).resolves.toBe(
      1,
    );
    expect(database.run).toHaveBeenCalledTimes(1);

    const queried = await invoke(ipcMain, "skills:get-metrics", {
      skillId: "metered-skill",
    });
    expect(queried).toMatchObject({
      success: true,
      data: {
        skillId: "metered-skill",
        totalExecutions: 1,
        successCount: 1,
        totalTokens: 20,
        totalCost: 0.025,
      },
    });

    const pipelineMetrics = await invoke(
      ipcMain,
      "skills:get-pipeline-metrics",
      "metrics-pipeline",
    );
    expect(pipelineMetrics).toMatchObject({
      success: true,
      data: {
        pipelineId: "metrics-pipeline",
        totalExecutions: 1,
        successCount: 1,
      },
    });

    skillRegistry.register(new FailingSkill());
    await invoke(ipcMain, "pipeline:create", {
      id: "failure-pipeline",
      name: "Failure Pipeline",
      steps: [{ type: "skill", skillId: "failing-skill" }],
    });
    const failed = await invoke(ipcMain, "pipeline:execute", {
      pipelineId: "failure-pipeline",
      context: {},
    });
    expect(failed).toMatchObject({
      success: true,
      data: { state: "failed", error: "intentional failure" },
    });

    let buffered = registeredModules.skillMetricsCollector.exportMetrics();
    expect(buffered.buffer).toHaveLength(1);
    expect(buffered.buffer[0]).toMatchObject({
      skillId: "failing-skill",
      pipelineId: "failure-pipeline",
      success: 0,
      errorMessage: "intentional failure",
    });
    const failedMetrics = await invoke(ipcMain, "skills:get-metrics", {
      skillId: "failing-skill",
    });
    expect(failedMetrics).toMatchObject({
      success: true,
      data: {
        totalExecutions: 1,
        successCount: 0,
        failureCount: 1,
      },
    });
    await expect(registeredModules.skillMetricsCollector.flush()).resolves.toBe(
      1,
    );
    expect(database.run).toHaveBeenCalledTimes(2);

    await invoke(ipcMain, "pipeline:create", {
      id: "parallel-pipeline",
      name: "Parallel Pipeline",
      steps: [
        {
          type: "parallel",
          branches: [
            { type: "skill", skillId: "metered-skill" },
            { type: "skill", skillId: "metered-skill" },
          ],
        },
      ],
    });
    const parallel = await invoke(ipcMain, "pipeline:execute", {
      pipelineId: "parallel-pipeline",
      context: {},
    });
    expect(parallel).toMatchObject({
      success: true,
      data: { state: "completed" },
    });

    buffered = registeredModules.skillMetricsCollector.exportMetrics();
    expect(buffered.buffer).toHaveLength(2);
    expect(buffered.buffer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: "metered-skill",
          pipelineId: "parallel-pipeline",
          success: 1,
        }),
      ]),
    );
    expect(
      buffered.buffer.every(
        (record) => record.pipelineId === "parallel-pipeline",
      ),
    ).toBe(true);

    const afterParallel = await invoke(ipcMain, "skills:get-metrics", {
      skillId: "metered-skill",
    });
    expect(afterParallel.data).toMatchObject({
      totalExecutions: 3,
      successCount: 3,
      failureCount: 0,
      totalTokens: 60,
    });
    expect(afterParallel.data.totalCost).toBeCloseTo(0.075);
    await expect(registeredModules.skillMetricsCollector.flush()).resolves.toBe(
      2,
    );
    expect(database.run).toHaveBeenCalledTimes(4);
  });

  it("rejects registration when a core engine dependency is missing", () => {
    const ipcMain = makeIpcMain();

    expect(() => registerSkillPipelineIPC({ ipcMain })).toThrow(
      /requires a pipelineEngine instance/,
    );
    expect(() => registerSkillMetricsIPC({ ipcMain })).toThrow(
      /requires a metricsCollector instance/,
    );
    expect(() => registerSkillWorkflowIPC({ ipcMain })).toThrow(
      /requires a workflowEngine instance/,
    );
    expect(ipcMain.handlers.size).toBe(0);
  });
});
