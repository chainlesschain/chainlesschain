/**
 * AI Engine Manager - Workflow Optimizations Integration Tests
 *
 * Tests the initialization and statistics collection of workflow optimization modules
 */

import { vi } from "vitest";

const path = require("path");
const fs = require("fs");
const os = require("os");

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

describe("AIEngineManager - Workflow Optimizations", () => {
  let AIEngineManager;
  let manager;
  let tmpConfigPath;

  beforeEach(() => {
    // Create temporary config directory
    const tmpDir = path.join(os.tmpdir(), `ai-engine-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".chainlesschain"), { recursive: true });
    tmpConfigPath = path.join(tmpDir, ".chainlesschain", "config.json");

    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

    // Clear module cache and require fresh
    vi.resetModules();
    const module = require("../../src/main/ai-engine/ai-engine-manager");
    AIEngineManager = module.AIEngineManager;

    // Reset mock calls
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup
    try {
      if (fs.existsSync(tmpConfigPath)) {
        fs.unlinkSync(tmpConfigPath);
      }
      const tmpDir = process.cwd();
      if (fs.existsSync(path.join(tmpDir, ".chainlesschain"))) {
        fs.rmdirSync(path.join(tmpDir, ".chainlesschain"));
      }
      if (fs.existsSync(tmpDir)) {
        fs.rmdirSync(tmpDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }

    // Restore mocks
    vi.restoreAllMocks();
  });

  describe("Configuration Loading", () => {
    it("should load default workflow configuration when file does not exist", () => {
      manager = new AIEngineManager();
      const config = manager._loadWorkflowConfig();

      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.phase3).toBeDefined();
      expect(config.phase3.llmDecision).toBeDefined();
      expect(config.phase3.criticalPath).toBeDefined();
      expect(config.phase3.agentPool).toBeDefined();
    });

    it("should load workflow configuration from file if exists", () => {
      // Create config file
      const configData = {
        workflow: {
          optimizations: {
            enabled: true,
            phase3: {
              llmDecision: {
                enabled: true,
                highConfidenceThreshold: 0.85,
                contextLengthThreshold: 8000,
                subtaskCountThreshold: 5,
              },
              criticalPath: {
                enabled: false,
                priorityBoost: 1.5,
              },
              agentPool: {
                enabled: true,
                minSize: 2,
                maxSize: 8,
                warmupOnInit: false,
              },
            },
          },
        },
      };

      fs.writeFileSync(tmpConfigPath, JSON.stringify(configData, null, 2));

      manager = new AIEngineManager();
      const config = manager._loadWorkflowConfig();

      expect(config.phase3.llmDecision.highConfidenceThreshold).toBe(0.85);
      expect(config.phase3.llmDecision.contextLengthThreshold).toBe(8000);
      expect(config.phase3.criticalPath.enabled).toBe(false);
      expect(config.phase3.agentPool.minSize).toBe(2);
    });

    it("should use default values when config file is corrupted", () => {
      fs.writeFileSync(tmpConfigPath, "invalid json");

      manager = new AIEngineManager();
      const config = manager._loadWorkflowConfig();

      // Should fallback to default config when file is corrupted
      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.phase3).toBeDefined();
    });
  });

  describe("Module Initialization", () => {
    beforeEach(() => {
      manager = new AIEngineManager();
    });

    it("should have optimization module properties initialized to null", () => {
      expect(manager.decisionEngine).toBeNull();
      expect(manager.criticalPathOptimizer).toBeNull();
      expect(manager.agentPool).toBeNull();
    });

    it("should provide getWorkflowStats method", () => {
      expect(typeof manager.getWorkflowStats).toBe("function");
    });

    it("should return empty stats when no modules initialized", () => {
      const stats = manager.getWorkflowStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe("object");
      // Should not have stats since modules not initialized
      expect(stats.decisionEngine).toBeUndefined();
      expect(stats.agentPool).toBeUndefined();
      expect(stats.criticalPathOptimizer).toBeUndefined();
    });
  });

  describe("Statistics Collection", () => {
    it("should collect plan cache stats from taskPlannerEnhanced", () => {
      manager = new AIEngineManager();

      // Mock taskPlannerEnhanced with planCache
      manager.taskPlannerEnhanced = {
        planCache: {
          getStats: vi.fn().mockReturnValue({
            hitRate: "75.5%",
            cacheSize: 42,
            semanticHits: 15,
          }),
        },
      };

      const stats = manager.getWorkflowStats();

      expect(stats.planCache).toBeDefined();
      expect(stats.planCache.hitRate).toBe("75.5%");
      expect(stats.planCache.cacheSize).toBe(42);
      expect(manager.taskPlannerEnhanced.planCache.getStats).toHaveBeenCalled();
    });

    it("should collect decision engine stats when initialized", () => {
      manager = new AIEngineManager();

      // Mock decisionEngine
      manager.decisionEngine = {
        getStats: vi.fn().mockReturnValue({
          multiAgentRate: "68.2%",
          llmCallRate: "22.1%",
          avgDecisionTime: "38.5ms",
        }),
      };

      const stats = manager.getWorkflowStats();

      expect(stats.decisionEngine).toBeDefined();
      expect(stats.decisionEngine.multiAgentRate).toBe("68.2%");
      expect(manager.decisionEngine.getStats).toHaveBeenCalled();
    });

    it("should collect agent pool stats when initialized", () => {
      manager = new AIEngineManager();

      // Mock agentPool
      manager.agentPool = {
        getStats: vi.fn().mockReturnValue({
          reuseRate: "92.00",
          created: 10,
          reused: 85,
        }),
      };

      const stats = manager.getWorkflowStats();

      expect(stats.agentPool).toBeDefined();
      expect(stats.agentPool.reuseRate).toBe("92.00");
      expect(manager.agentPool.getStats).toHaveBeenCalled();
    });

    it("should collect critical path optimizer stats when initialized", () => {
      manager = new AIEngineManager();

      // Mock criticalPathOptimizer
      manager.criticalPathOptimizer = {
        getStats: vi.fn().mockReturnValue({
          totalAnalyses: 54,
          avgCriticalPathLength: "2.85",
          avgSlack: "1856.23ms",
        }),
      };

      const stats = manager.getWorkflowStats();

      expect(stats.criticalPathOptimizer).toBeDefined();
      expect(stats.criticalPathOptimizer.totalAnalyses).toBe(54);
      expect(manager.criticalPathOptimizer.getStats).toHaveBeenCalled();
    });

    it("should collect all stats when all modules initialized", () => {
      manager = new AIEngineManager();

      // Mock all modules
      manager.taskPlannerEnhanced = {
        planCache: {
          getStats: vi.fn().mockReturnValue({ hitRate: "75%" }),
        },
      };

      manager.decisionEngine = {
        getStats: vi.fn().mockReturnValue({ multiAgentRate: "70%" }),
      };

      manager.agentPool = {
        getStats: vi.fn().mockReturnValue({ reuseRate: "85.00" }),
      };

      manager.criticalPathOptimizer = {
        getStats: vi.fn().mockReturnValue({ totalAnalyses: 100 }),
      };

      const stats = manager.getWorkflowStats();

      expect(stats.planCache).toBeDefined();
      expect(stats.decisionEngine).toBeDefined();
      expect(stats.agentPool).toBeDefined();
      expect(stats.criticalPathOptimizer).toBeDefined();

      // Verify all getStats were called
      expect(manager.taskPlannerEnhanced.planCache.getStats).toHaveBeenCalled();
      expect(manager.decisionEngine.getStats).toHaveBeenCalled();
      expect(manager.agentPool.getStats).toHaveBeenCalled();
      expect(manager.criticalPathOptimizer.getStats).toHaveBeenCalled();
    });
  });

  describe("Integration", () => {
    it("should have all required properties", () => {
      manager = new AIEngineManager();

      expect(manager.intentClassifier).toBeDefined();
      expect(manager.taskPlanner).toBeDefined();
      expect(manager.functionCaller).toBeDefined();
      expect(manager.executionHistory).toBeDefined();
      expect(Array.isArray(manager.executionHistory)).toBe(true);
    });

    it("should have workflow optimization module properties", () => {
      manager = new AIEngineManager();

      expect("decisionEngine" in manager).toBe(true);
      expect("criticalPathOptimizer" in manager).toBe(true);
      expect("agentPool" in manager).toBe(true);
    });

    it("should provide getTaskPlanner method", () => {
      manager = new AIEngineManager();

      expect(typeof manager.getTaskPlanner).toBe("function");
    });

    it("should throw error when getting task planner before initialization", () => {
      manager = new AIEngineManager();

      expect(() => {
        manager.getTaskPlanner();
      }).toThrow("增强版任务规划器未初始化");
    });
  });
});
