/**
 * Workflow Optimizations IPC Integration Tests
 *
 * Tests the IPC layer for workflow optimizations dashboard
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { WorkflowOptimizationsIPC } = require('../../src/main/ipc/workflow-optimizations-ipc');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('WorkflowOptimizationsIPC', () => {
  let ipc;
  let testConfigPath;

  beforeEach(() => {
    // Create temporary config directory
    const tmpDir = path.join(os.tmpdir(), `workflow-opt-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    testConfigPath = path.join(tmpDir, 'config.json');

    ipc = new WorkflowOptimizationsIPC({
      configPath: testConfigPath,
    });
  });

  afterEach(() => {
    // Cleanup
    try {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
      fs.rmdirSync(path.dirname(testConfigPath));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Configuration Management', () => {
    it('should load default configuration when file does not exist', () => {
      const config = ipc._loadConfig();
      expect(config).toBeDefined();
      expect(config.workflow).toBeDefined();
      expect(config.workflow.optimizations).toBeDefined();
    });

    it('should save and load configuration', () => {
      const config = ipc._getDefaultConfig();
      config.workflow.optimizations.phase1.ragParallel = false;

      ipc._saveConfig(config);

      const loaded = ipc._loadConfig();
      expect(loaded.workflow.optimizations.phase1.ragParallel).toBe(false);
    });

    it('should get optimization status correctly', () => {
      const config = ipc._getDefaultConfig();
      const status = ipc._getOptimizationStatus(config);

      expect(status.global).toBe(true);
      expect(status.phase1).toBeDefined();
      expect(status.phase2).toBeDefined();
      expect(status.phase3).toBeDefined();
      expect(status.phase1.ragParallel).toBe(true);
    });

    it('should set optimization value correctly', () => {
      const config = ipc._getDefaultConfig();

      ipc._setOptimizationValue(config, 'planCache', false);

      expect(config.workflow.optimizations.phase3.planCache.enabled).toBe(false);
    });

    it('should throw error for invalid optimization key', () => {
      const config = ipc._getDefaultConfig();

      expect(() => {
        ipc._setOptimizationValue(config, 'invalidKey', true);
      }).toThrow('Unknown optimization key');
    });
  });

  describe('Statistics Collection', () => {
    it('should collect stats with fallback values', async () => {
      const stats = await ipc._collectStats();

      expect(stats).toBeDefined();
      expect(stats.planCache).toBeDefined();
      expect(stats.decisionEngine).toBeDefined();
      expect(stats.agentPool).toBeDefined();
      expect(stats.criticalPath).toBeDefined();

      // Should return default values when modules are not available
      expect(stats.planCache.hitRate).toBe('0%');
      expect(stats.decisionEngine.multiAgentRate).toBe('0%');
      expect(stats.agentPool.reuseRate).toBe('0%');
    });
  });

  describe('Performance Report Generation', () => {
    it('should generate performance report', async () => {
      const report = await ipc._generateReport();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.status).toBeDefined();
      expect(report.stats).toBeDefined();
      expect(report.expectedGains).toBeDefined();

      expect(report.summary.totalOptimizations).toBe(17);
      expect(report.summary.healthStatus).toBe('healthy');
    });

    it('should calculate expected gains correctly', () => {
      const status = {
        phase1: {
          ragParallel: true,
          messageAggregation: true,
          toolCache: true,
          lazyFileTree: true,
        },
        phase2: {
          llmFallback: true,
          dynamicConcurrency: true,
          smartRetry: true,
          qualityGate: true,
        },
        phase3: {
          planCache: true,
          llmDecision: true,
          agentPool: true,
          criticalPath: true,
          realtimeQuality: false,
          autoPhaseTransition: true,
          smartCheckpoint: true,
        },
      };

      const gains = ipc._calculateExpectedGains(status);

      expect(gains.responseTime).toBeGreaterThan(0);
      expect(gains.throughput).toBeGreaterThan(0);
      expect(gains.tokenSavings).toBeGreaterThan(0);
      expect(gains.reliability).toBeGreaterThan(0);

      // Verify specific gains
      expect(gains.responseTime).toBeGreaterThanOrEqual(30 + 15 + 60 + 35 + 45 + 40); // Sum of all enabled
      expect(gains.tokenSavings).toBeGreaterThanOrEqual(25 + 40 + 70); // Sum of all enabled
    });

    it('should calculate zero gains when all optimizations disabled', () => {
      const status = {
        phase1: {
          ragParallel: false,
          messageAggregation: false,
          toolCache: false,
          lazyFileTree: false,
        },
        phase2: {
          llmFallback: false,
          dynamicConcurrency: false,
          smartRetry: false,
          qualityGate: false,
        },
        phase3: {
          planCache: false,
          llmDecision: false,
          agentPool: false,
          criticalPath: false,
          realtimeQuality: false,
          autoPhaseTransition: false,
          smartCheckpoint: false,
        },
      };

      const gains = ipc._calculateExpectedGains(status);

      expect(gains.responseTime).toBe(0);
      expect(gains.throughput).toBe(0);
      expect(gains.tokenSavings).toBe(0);
      expect(gains.reliability).toBe(0);
    });
  });

  describe('Health Check', () => {
    it('should perform health check', async () => {
      const health = await ipc._performHealthCheck();

      expect(health).toBeDefined();
      expect(health.healthy).toBeDefined();
      expect(health.checks).toBeDefined();
      expect(health.timestamp).toBeDefined();

      expect(health.checks.configFile).toBeDefined();
      expect(health.checks.dependencies).toBeDefined();
      expect(health.checks.modules).toBeDefined();
    });

    it('should report unhealthy when config file missing', async () => {
      // Use default config path which doesn't exist
      const tmpIpc = new WorkflowOptimizationsIPC({
        configPath: '/nonexistent/path/config.json',
      });

      const health = await tmpIpc._performHealthCheck();

      expect(health.checks.configFile).toBe(false);
      expect(health.healthy).toBe(false);
    });
  });

  describe('Module Access', () => {
    it('should return null for plan cache when not available', () => {
      const planCache = ipc._getPlanCache();
      expect(planCache).toBeNull();
    });

    it('should return null for decision engine when not available', () => {
      const decisionEngine = ipc._getDecisionEngine();
      expect(decisionEngine).toBeNull();
    });

    it('should return null for agent pool when not available', () => {
      const agentPool = ipc._getAgentPool();
      expect(agentPool).toBeNull();
    });

    it('should return null for critical path optimizer when not available', () => {
      const criticalPath = ipc._getCriticalPathOptimizer();
      expect(criticalPath).toBeNull();
    });
  });

  describe('Agent Pool Status', () => {
    it('should handle missing agent pool gracefully', () => {
      const status = ipc._getAgentPoolStatus(null);
      expect(status).toEqual({ available: 0, busy: 0 });
    });

    it('should calculate status from agent pool properties', () => {
      const mockAgentPool = {
        availableAgents: [1, 2, 3],
        busyAgents: new Map([[1, {}], [2, {}]]),
      };

      const status = ipc._getAgentPoolStatus(mockAgentPool);
      expect(status.available).toBe(3);
      expect(status.busy).toBe(2);
    });
  });
});

describe('WorkflowOptimizationsIPC Integration', () => {
  let ipc;

  beforeEach(() => {
    ipc = new WorkflowOptimizationsIPC();
  });

  it('should have all required methods', () => {
    expect(typeof ipc.registerHandlers).toBe('function');
    expect(typeof ipc._loadConfig).toBe('function');
    expect(typeof ipc._saveConfig).toBe('function');
    expect(typeof ipc._getOptimizationStatus).toBe('function');
    expect(typeof ipc._setOptimizationValue).toBe('function');
    expect(typeof ipc._collectStats).toBe('function');
    expect(typeof ipc._generateReport).toBe('function');
    expect(typeof ipc._calculateExpectedGains).toBe('function');
    expect(typeof ipc._performHealthCheck).toBe('function');
  });

  it('should provide default configuration structure', () => {
    const config = ipc._getDefaultConfig();

    expect(config.workflow.optimizations.enabled).toBe(true);
    expect(config.workflow.optimizations.phase1).toBeDefined();
    expect(config.workflow.optimizations.phase2).toBeDefined();
    expect(config.workflow.optimizations.phase3).toBeDefined();

    // Verify all 17 optimizations are present
    expect(Object.keys(config.workflow.optimizations.phase1).length).toBe(4);
    expect(Object.keys(config.workflow.optimizations.phase2).length).toBe(4);
    expect(Object.keys(config.workflow.optimizations.phase3).length).toBe(7);
  });
});
