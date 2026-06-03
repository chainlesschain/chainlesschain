/**
 * Phases 21-30 (v0.38.0 - v1.0): Enterprise Edition + Multimodal/
 * Skill Marketplace / Trading Enhancement / DeFi / Advanced Cryptography.
 *
 *  - Phase 21: Enterprise Org Management (v1.0)
 *  - Phase 22: IPFS Decentralized Storage (v1.0)
 *  - Phase 23: Analytics Dashboard (v1.0)
 *  - Phase 24: Autonomous Agent Execution (v1.0)
 *  - Phase 25: Performance Auto-Tuner (v1.0)
 *  - Phase 26: Multimodal AI (v0.39.0)
 *  - Phase 27: Skill Marketplace (v0.39.0)
 *  - Phase 28: Trading Enhancement (v0.39.0)
 *  - Phase 29: DeFi Extension (v0.39.0)
 *  - Phase 30: Advanced Cryptography (v0.38.0 - v0.43.0)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases21to30({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  const { app, mainWindow } = deps;

  // ============================================================
  // Phase 21: Enterprise Edition - Enterprise Org Management (v1.0)
  // ============================================================

  safeRegister("Enterprise Org IPC", {
    handlers: 10,
    register: () => {
      const {
        getEnterpriseOrgManager,
      } = require("../../enterprise/enterprise-org-manager");
      const {
        registerEnterpriseIPC,
      } = require("../../enterprise/enterprise-ipc");

      const enterpriseOrgManager = getEnterpriseOrgManager();
      enterpriseOrgManager.initialize({
        database: deps.database,
        teamManager: registeredModules.teamManager || null,
        approvalManager: registeredModules.approvalManager || null,
        organizationManager: registeredModules.organizationManager || null,
      });
      registerEnterpriseIPC({ enterpriseOrgManager });
      registeredModules.enterpriseOrgManager = enterpriseOrgManager;
    },
  });

  // ============================================================
  // Phase 22: Enterprise Edition - IPFS Decentralized Storage (v1.0)
  // ============================================================

  safeRegister("IPFS Storage IPC", {
    handlers: 18,
    register: () => {
      const { getIPFSManager } = require("../../ipfs/ipfs-manager");
      const { registerIPFSIPC } = require("../../ipfs/ipfs-ipc");

      const ipfsManager = getIPFSManager();
      ipfsManager
        .initialize({ database: deps.database })
        .catch((e) =>
          logger.warn("[IPC Registry] IPFS init error:", e.message),
        );
      registerIPFSIPC({ ipfsManager });
      registeredModules.ipfsManager = ipfsManager;
    },
  });

  // ============================================================
  // Phase 23: Enterprise Edition - Analytics Dashboard (v1.0)
  // ============================================================

  safeRegister("Analytics Dashboard IPC", {
    handlers: 16,
    register: () => {
      const {
        getAnalyticsAggregator,
      } = require("../../analytics/analytics-aggregator");
      const { registerAnalyticsIPC } = require("../../analytics/analytics-ipc");

      const analyticsAggregator = getAnalyticsAggregator();
      analyticsAggregator
        .initialize({
          database: deps.database,
          tokenTracker: registeredModules.tokenTracker || null,
          skillMetrics: registeredModules.skillMetricsCollector || null,
          errorMonitor: registeredModules.errorMonitor || null,
          performanceMonitor: registeredModules.performanceMonitor || null,
          mainWindow: deps.mainWindow,
        })
        .catch((e) =>
          logger.warn("[IPC Registry] Analytics init error:", e.message),
        );
      registerAnalyticsIPC({ analyticsAggregator });
      analyticsAggregator.start();
      registeredModules.analyticsAggregator = analyticsAggregator;
    },
  });

  // ============================================================
  // Phase 24: Enterprise Edition - Autonomous Agent Execution (v1.0)
  // ============================================================

  safeRegister("Autonomous Agent IPC", {
    handlers: 18,
    register: () => {
      const {
        getAutonomousAgentRunner,
      } = require("../../ai-engine/autonomous/autonomous-agent-runner");
      const {
        AgentTaskQueue,
      } = require("../../ai-engine/autonomous/agent-task-queue");
      const {
        registerAutonomousIPC,
      } = require("../../ai-engine/autonomous/autonomous-ipc");

      const agentTaskQueue = new AgentTaskQueue();
      agentTaskQueue
        .initialize(deps.database)
        .catch((e) =>
          logger.warn("[IPC Registry] AgentTaskQueue init error:", e.message),
        );

      const autonomousRunner = getAutonomousAgentRunner();
      autonomousRunner.initialize({
        database: deps.database,
        llmManager: registeredModules.llmManager || null,
        skillExecutor: registeredModules.skillExecutor || null,
        toolRegistry: registeredModules.unifiedToolRegistry || null,
        taskQueue: agentTaskQueue,
      });

      registerAutonomousIPC({
        runner: autonomousRunner,
        taskQueue: agentTaskQueue,
        mainWindow: deps.mainWindow,
      });

      registeredModules.autonomousRunner = autonomousRunner;
      registeredModules.agentTaskQueue = agentTaskQueue;
    },
  });

  // ============================================================
  // Phase 25: Enterprise Edition - Performance Auto-Tuner (v1.0)
  // ============================================================

  safeRegister("Auto-Tuner IPC", {
    handlers: 12,
    register: () => {
      const {
        getUnifiedPerformanceCollector,
      } = require("../../performance/unified-performance-collector");
      const { getAutoTuner } = require("../../performance/auto-tuner");
      const {
        registerAutoTunerIPC,
      } = require("../../performance/auto-tuner-ipc");

      const unifiedPerformanceCollector = getUnifiedPerformanceCollector();
      unifiedPerformanceCollector.initialize({
        performanceMonitor: registeredModules.performanceMonitor || null,
        mcpPerformanceMonitor: registeredModules.mcpPerformanceMonitor || null,
        filePerformanceMetrics:
          registeredModules.filePerformanceMetrics || null,
        tokenTracker: registeredModules.tokenTracker || null,
      });
      unifiedPerformanceCollector.start();

      const autoTuner = getAutoTuner();
      autoTuner.initialize({
        database: deps.database,
        performanceCollector: unifiedPerformanceCollector,
        performanceMonitor: registeredModules.performanceMonitor || null,
      });
      autoTuner.start();

      registerAutoTunerIPC({ autoTuner, unifiedPerformanceCollector });
      registeredModules.unifiedPerformanceCollector =
        unifiedPerformanceCollector;
      registeredModules.autoTuner = autoTuner;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 21-25 Complete: Enterprise Edition v1.0 ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 26: Multimodal AI (v0.39.0)
  // ============================================================

  safeRegister("Multimodal IPC", {
    handlers: 12,
    register: () => {
      const {
        registerMultimodalIPC,
      } = require("../../ai-engine/multimodal-ipc");
      registerMultimodalIPC({
        multimodalRouter: app?.multimodalRouter || null,
        mainWindow,
      });
    },
  });

  // ============================================================
  // Phase 27: Skill Marketplace (v0.39.0)
  // ============================================================

  safeRegister("Skill Marketplace IPC", {
    handlers: 15,
    register: () => {
      const {
        registerSkillMarketplaceIPC,
      } = require("../../marketplace/skill-marketplace-ipc");
      registerSkillMarketplaceIPC({
        skillMarketplace: app?.skillMarketplace || null,
      });
    },
  });

  // ============================================================
  // Phase 28: Trading Enhancement (v0.39.0)
  // ============================================================

  safeRegister("Trading Enhancement IPC", {
    handlers: 28,
    register: () => {
      const {
        registerTradingEnhancementIPC,
      } = require("../../trade/trading-enhancement-ipc");
      registerTradingEnhancementIPC({
        auctionManager: app?.auctionManager || null,
        groupBuyingManager: app?.groupBuyingManager || null,
        installmentManager: app?.installmentManager || null,
        lightningPaymentManager: app?.lightningPaymentManager || null,
      });
    },
  });

  // ============================================================
  // Phase 29: DeFi Extension (v0.39.0)
  // ============================================================

  safeRegister("DeFi IPC", {
    handlers: 22,
    register: () => {
      const { registerDeFiIPC } = require("../../defi/defi-ipc");
      registerDeFiIPC({
        lendingManager: app?.lendingManager || null,
        insurancePoolManager: app?.insurancePoolManager || null,
        atomicSwapManager: app?.atomicSwapManager || null,
      });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 26-29 Complete: Multimodal, Skill Marketplace, Trading Enhancement, DeFi ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 30: Advanced Cryptography (v0.38.0 - v0.43.0)
  // ============================================================

  safeRegister("Advanced Cryptography IPC", {
    handlers: 92,
    register: () => {
      const { registerCryptoIPC } = require("../../crypto/crypto-ipc");
      registerCryptoIPC({
        postQuantumManager: app?.postQuantumManager || null,
        zeroKnowledgeManager: app?.zeroKnowledgeManager || null,
        homomorphicManager: app?.homomorphicManager || null,
        mpcManager: app?.mpcManager || null,
        hsmManager: app?.hsmManager || null,
        advancedCryptoManager: app?.advancedCryptoManager || null,
      });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 30 Complete: Advanced Cryptography (PQ, ZKP, HE, MPC, HSM, Advanced) ready!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases21to30 };
