/**
 * Phases 16-20 (v1.1.0 - v2.1.0): Skill Pipeline/Workflow, Instinct,
 * Cowork v2.0 Cross-device, ML Scheduler/LB/CICD/APIDocs, Evolution Metrics.
 *
 *  - Phase 16: Skill Pipeline / Metrics / Workflow / Git Hooks (v1.1.0)
 *  - Phase 17: Instinct Learning System (v0.39.0)
 *  - Phase 18: Cowork v2.0.0 Cross-device Collaboration
 *  - Phase 19: ML Scheduler, Load Balancer, CI/CD, API Docs (v1.3.0)
 *  - Phase 20: Evolution Metrics & Knowledge Graph (v2.1.0)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function createPhase16SkillServices({
  deps = {},
  registeredModules = {},
} = {}) {
  const {
    getSkillRegistry,
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

  const skillRegistry =
    deps.skillRegistry || registeredModules.skillRegistry || getSkillRegistry();
  if (
    !skillRegistry ||
    typeof skillRegistry.executeSkill !== "function" ||
    typeof skillRegistry.on !== "function"
  ) {
    throw new TypeError("Phase 16 requires a usable SkillRegistry instance");
  }

  const pipelineEngine =
    deps.skillPipelineEngine ||
    deps.pipelineEngine ||
    registeredModules.skillPipelineEngine ||
    new SkillPipelineEngine({ skillRegistry });
  if (
    typeof pipelineEngine.executePipeline !== "function" ||
    typeof pipelineEngine.on !== "function"
  ) {
    throw new TypeError(
      "Phase 16 requires a usable SkillPipelineEngine instance",
    );
  }

  const metricsCollector =
    deps.skillMetricsCollector ||
    deps.metricsCollector ||
    registeredModules.skillMetricsCollector ||
    pipelineEngine.metricsCollector ||
    new SkillMetricsCollector({
      database: deps.database || null,
      skillRegistry,
      pipelineEngine,
    });
  if (
    typeof metricsCollector.recordExecution !== "function" ||
    typeof metricsCollector.initialize !== "function"
  ) {
    throw new TypeError(
      "Phase 16 requires a usable SkillMetricsCollector instance",
    );
  }

  if (
    pipelineEngine.skillRegistry &&
    pipelineEngine.skillRegistry !== skillRegistry
  ) {
    throw new Error("Phase 16 pipelineEngine uses a different SkillRegistry");
  }
  if (
    pipelineEngine.metricsCollector &&
    pipelineEngine.metricsCollector !== metricsCollector
  ) {
    throw new Error(
      "Phase 16 pipelineEngine uses a different SkillMetricsCollector",
    );
  }
  if (
    metricsCollector.skillRegistry &&
    metricsCollector.skillRegistry !== skillRegistry
  ) {
    throw new Error("Phase 16 metricsCollector uses a different SkillRegistry");
  }
  if (
    metricsCollector.pipelineEngine &&
    metricsCollector.pipelineEngine !== pipelineEngine
  ) {
    throw new Error(
      "Phase 16 metricsCollector uses a different SkillPipelineEngine",
    );
  }

  pipelineEngine.skillRegistry = skillRegistry;
  pipelineEngine.metricsCollector = metricsCollector;
  metricsCollector.skillRegistry = skillRegistry;
  metricsCollector.pipelineEngine = pipelineEngine;
  // Skills IPC is registered earlier and closes over this singleton Registry.
  // Publish only the collector reference; the renderer never receives it.
  skillRegistry.skillMetricsCollector = metricsCollector;

  const workflowEngine =
    deps.skillWorkflowEngine ||
    deps.workflowEngine ||
    registeredModules.skillWorkflowEngine ||
    new SkillWorkflowEngine({ pipelineEngine, skillRegistry });
  if (typeof workflowEngine.executeWorkflow !== "function") {
    throw new TypeError(
      "Phase 16 requires a usable SkillWorkflowEngine instance",
    );
  }
  if (
    workflowEngine.pipelineEngine &&
    workflowEngine.pipelineEngine !== pipelineEngine
  ) {
    throw new Error(
      "Phase 16 workflowEngine uses a different SkillPipelineEngine",
    );
  }
  workflowEngine.pipelineEngine = pipelineEngine;
  workflowEngine.skillRegistry = skillRegistry;

  metricsCollector.initialize();

  Object.assign(registeredModules, {
    skillRegistry,
    skillPipelineEngine: pipelineEngine,
    skillMetricsCollector: metricsCollector,
    skillWorkflowEngine: workflowEngine,
  });

  return {
    skillRegistry,
    pipelineEngine,
    metricsCollector,
    workflowEngine,
  };
}

function registerPhases16to20({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  const { database, hookSystem } = deps;
  let phase16Services = null;
  const getPhase16Services = () => {
    if (!phase16Services) {
      phase16Services = createPhase16SkillServices({ deps, registeredModules });
    }
    return phase16Services;
  };

  // ============================================================
  // Phase 16: v1.1.0 — Skill Pipeline, Metrics, Workflow, Git Hooks
  // ============================================================

  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 16: v1.1.0 Skill Ecosystem & Workflow");
  logger.info("[IPC Registry] ========================================");

  // 🔥 Skill Pipeline IPC (流水线引擎, 12 handlers)
  safeRegister("Skill Pipeline IPC", {
    register: () => {
      const {
        registerSkillPipelineIPC,
      } = require("../../ai-engine/cowork/skills/skill-pipeline-ipc");
      const { pipelineEngine } = getPhase16Services();
      registerSkillPipelineIPC({ pipelineEngine, ipcMain: deps.ipcMain });
    },
    handlers: 12,
  });

  // 🔥 Skill Metrics IPC (技能指标, 5 handlers)
  safeRegister("Skill Metrics IPC", {
    handlers: 5,
    register: () => {
      const {
        registerSkillMetricsIPC,
      } = require("../../ai-engine/cowork/skills/skill-metrics-ipc");
      const { metricsCollector } = getPhase16Services();
      registerSkillMetricsIPC({ metricsCollector, ipcMain: deps.ipcMain });
    },
  });

  // 🔥 Skill Workflow IPC (工作流引擎, 12 handlers)
  safeRegister("Skill Workflow IPC", {
    handlers: 12,
    register: () => {
      const {
        registerSkillWorkflowIPC,
      } = require("../../ai-engine/cowork/skills/skill-workflow-ipc");
      const { workflowEngine } = getPhase16Services();
      registerSkillWorkflowIPC({
        workflowEngine,
        ipcMain: deps.ipcMain,
        BrowserWindow: deps.BrowserWindow,
      });
    },
  });

  // 🔥 Git Hook IPC (Git 钩子, 8 handlers)
  safeRegister("Git Hook IPC", {
    handlers: 8,
    register: () => {
      const { registerGitHookIPC } = require("../../hooks/git-hook-ipc");
      registerGitHookIPC({ hookSystem });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 16 Complete: v1.1.0 Ecosystem ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 17: Instinct Learning System (v0.39.0)
  // ============================================================

  safeRegister("Instinct Learning IPC", {
    register: () => {
      const { registerInstinctIPC } = require("../../llm/instinct-ipc");
      const { getInstinctManager } = require("../../llm/instinct-manager");

      const instinctManager = getInstinctManager();
      const database = deps.database || null;
      const permanentMemoryManager = deps.permanentMemoryManager || null;
      const hookSystem = deps.hookSystem || null;

      if (database) {
        instinctManager
          .initialize(database, permanentMemoryManager, hookSystem)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] InstinctManager async init error (non-fatal):",
              err.message,
            ),
          );
      }

      registerInstinctIPC(instinctManager);
      registeredModules.instinctManager = instinctManager;
    },
    handlers: 11,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 17 Complete: Instinct Learning System ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 18: Cowork v2.0.0 — Cross-device Collaboration (v0.39.0)
  // ============================================================

  safeRegister("Cowork v2.0.0 Cross-device IPC", {
    register: () => {
      const {
        getP2PAgentNetwork,
      } = require("../../ai-engine/cowork/p2p-agent-network");
      const {
        getDeviceDiscovery,
      } = require("../../ai-engine/cowork/device-discovery");
      const {
        getHybridExecutor,
      } = require("../../ai-engine/cowork/hybrid-executor");
      const {
        getComputerUseBridge,
      } = require("../../ai-engine/cowork/computer-use-bridge");
      const {
        getCoworkAPIServer,
      } = require("../../ai-engine/cowork/cowork-api-server");
      const {
        getWebhookManager,
      } = require("../../ai-engine/cowork/webhook-manager");
      const {
        registerCoworkV2IPC,
      } = require("../../ai-engine/cowork/cowork-v2-ipc");

      const p2pNetwork = getP2PAgentNetwork();
      const deviceDiscovery = getDeviceDiscovery();
      const hybridExecutor = getHybridExecutor();
      const computerUseBridge = getComputerUseBridge();
      const coworkAPIServer = getCoworkAPIServer();
      const webhookManager = getWebhookManager();

      // Wire dependencies
      const database = deps.database || null;
      const skillRegistry = registeredModules.skillRegistry || null;
      const mobileBridge = deps.mobileBridge || null;
      const teammateTool = registeredModules.teammateTool || null;

      // Initialize P2P Agent Network
      p2pNetwork.mobileBridge = mobileBridge;
      p2pNetwork.teammateTool = teammateTool;
      p2pNetwork.skillRegistry = skillRegistry;
      p2pNetwork.db = database;
      p2pNetwork
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] P2PAgentNetwork init warning:",
            err.message,
          ),
        );

      // Initialize Device Discovery
      deviceDiscovery.p2pNetwork = p2pNetwork;
      deviceDiscovery.skillRegistry = skillRegistry;
      deviceDiscovery.db = database;
      deviceDiscovery
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] DeviceDiscovery init warning:",
            err.message,
          ),
        );

      // Initialize Hybrid Executor
      hybridExecutor.p2pNetwork = p2pNetwork;
      hybridExecutor.deviceDiscovery = deviceDiscovery;
      hybridExecutor.skillRegistry = skillRegistry;
      hybridExecutor
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] HybridExecutor init warning:",
            err.message,
          ),
        );

      // Initialize Computer Use Bridge
      computerUseBridge.skillRegistry = skillRegistry;
      computerUseBridge
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] ComputerUseBridge init warning:",
            err.message,
          ),
        );

      // Initialize Cowork API Server (wires teammateTool, skills, etc.)
      coworkAPIServer.teammateTool = teammateTool;
      coworkAPIServer.skillRegistry = skillRegistry;
      coworkAPIServer.hybridExecutor = hybridExecutor;
      coworkAPIServer.deviceDiscovery = deviceDiscovery;
      coworkAPIServer.webhookManager = webhookManager;

      // Initialize Webhook Manager
      webhookManager.teammateTool = teammateTool;
      webhookManager.p2pNetwork = p2pNetwork;
      webhookManager.deviceDiscovery = deviceDiscovery;
      webhookManager.db = database;
      webhookManager
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] WebhookManager init warning:",
            err.message,
          ),
        );

      // Register IPC handlers
      registerCoworkV2IPC({
        p2pNetwork,
        deviceDiscovery,
        hybridExecutor,
        computerUseBridge,
        coworkAPIServer,
        webhookManager,
      });

      registeredModules.p2pNetwork = p2pNetwork;
      registeredModules.deviceDiscovery = deviceDiscovery;
      registeredModules.hybridExecutor = hybridExecutor;
      registeredModules.computerUseBridge = computerUseBridge;
      registeredModules.coworkAPIServer = coworkAPIServer;
      registeredModules.webhookManager = webhookManager;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 18 Complete: Cross-device Collaboration ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 19: v1.3.0 ML Scheduler, Load Balancer, CI/CD, API Docs
  // ============================================================

  // 🔥 ML Task Scheduler (ML 驱动的任务调度, 8 handlers)
  safeRegister("ML Task Scheduler IPC", {
    register: () => {
      const {
        MLTaskScheduler,
      } = require("../../ai-engine/cowork/ml-task-scheduler");
      const {
        registerMLSchedulerIPC,
      } = require("../../ai-engine/cowork/ml-task-scheduler-ipc");

      const mlTaskScheduler = new MLTaskScheduler(database || null);
      mlTaskScheduler
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] MLTaskScheduler async init error (non-fatal):",
            err.message,
          ),
        );

      registerMLSchedulerIPC(mlTaskScheduler);
      registeredModules.mlTaskScheduler = mlTaskScheduler;
    },
    handlers: 8,
  });

  // 🔥 Load Balancer (动态负载均衡, 8 handlers)
  safeRegister("Load Balancer IPC", {
    register: () => {
      const { LoadBalancer } = require("../../ai-engine/cowork/load-balancer");
      const {
        registerLoadBalancerIPC,
      } = require("../../ai-engine/cowork/load-balancer-ipc");

      const loadBalancer = new LoadBalancer(null, null, database || null);
      loadBalancer
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] LoadBalancer async init error (non-fatal):",
            err.message,
          ),
        );

      registerLoadBalancerIPC(loadBalancer);
      registeredModules.loadBalancer = loadBalancer;
    },
    handlers: 8,
  });

  // 🔥 CI/CD Optimizer (CI/CD 深度优化, 10 handlers)
  safeRegister("CI/CD Optimizer IPC", {
    register: () => {
      const {
        CICDOptimizer,
      } = require("../../ai-engine/cowork/cicd-optimizer");
      const {
        registerCICDOptimizerIPC,
      } = require("../../ai-engine/cowork/cicd-optimizer-ipc");

      const cicdOptimizer = new CICDOptimizer(database || null, process.cwd());
      cicdOptimizer
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] CICDOptimizer async init error (non-fatal):",
            err.message,
          ),
        );

      registerCICDOptimizerIPC(cicdOptimizer);
      registeredModules.cicdOptimizer = cicdOptimizer;
    },
    handlers: 10,
  });

  // 🔥 IPC API Doc Generator (API 文档自动生成, 6 handlers)
  safeRegister("API Doc Generator IPC", {
    register: () => {
      const {
        IPCApiDocGenerator,
      } = require("../../ai-engine/cowork/ipc-api-doc-generator");
      const {
        registerApiDocsIPC,
      } = require("../../ai-engine/cowork/ipc-api-doc-generator-ipc");

      const srcDir = require("path").join(__dirname, "..");
      const apiDocGenerator = new IPCApiDocGenerator(srcDir);
      apiDocGenerator
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] IPCApiDocGenerator async init error (non-fatal):",
            err.message,
          ),
        );

      registerApiDocsIPC(apiDocGenerator);
      registeredModules.apiDocGenerator = apiDocGenerator;
    },
    handlers: 6,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 19 Complete: v1.3.0 ML/LB/CICD/APIDocs ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 20: Evolution Metrics & Knowledge Graph (v2.1.0)
  // ============================================================

  safeRegister("Evolution Metrics & Knowledge Graph IPC", {
    register: () => {
      const {
        getCodeKnowledgeGraph,
      } = require("../../ai-engine/cowork/code-knowledge-graph");
      const {
        getDecisionKnowledgeBase,
      } = require("../../ai-engine/cowork/decision-knowledge-base");
      const {
        getPromptOptimizer,
      } = require("../../ai-engine/cowork/prompt-optimizer");
      const {
        getSkillDiscoverer,
      } = require("../../ai-engine/cowork/skill-discoverer");
      const {
        getDebateReview,
      } = require("../../ai-engine/cowork/debate-review");
      const {
        getABComparator,
      } = require("../../ai-engine/cowork/ab-comparator");
      const {
        registerEvolutionIPC,
      } = require("../../ai-engine/cowork/evolution-ipc");

      const evoDb = database || null;
      const hookSystem = deps.hookSystem || null;
      const marketplaceClient = registeredModules.marketplaceClient || null;
      const teammateTool = registeredModules.teammateTool || null;
      const agentCoordinator = registeredModules.agentCoordinator || null;

      // Initialize managers
      const codeKnowledgeGraph = getCodeKnowledgeGraph();
      const decisionKnowledgeBase = getDecisionKnowledgeBase();
      const promptOptimizer = getPromptOptimizer({
        artifactCandidateGate:
          deps.evolvableArtifactPromptCandidateGate || undefined,
        artifactActiveReleaseReader:
          deps.evolvableArtifactPromptActiveReleaseReader || undefined,
      });
      const skillDiscoverer = getSkillDiscoverer();
      const debateReview = getDebateReview();
      const abComparator = getABComparator();

      if (evoDb) {
        codeKnowledgeGraph
          .initialize(evoDb)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] CodeKnowledgeGraph init warning:",
              err.message,
            ),
          );
        decisionKnowledgeBase
          .initialize(evoDb, hookSystem)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DecisionKnowledgeBase init warning:",
              err.message,
            ),
          );
        promptOptimizer
          .initialize(evoDb)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PromptOptimizer init warning:",
              err.message,
            ),
          );
        skillDiscoverer
          .initialize(evoDb, marketplaceClient, hookSystem)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SkillDiscoverer init warning:",
              err.message,
            ),
          );
        debateReview
          .initialize(evoDb, teammateTool, decisionKnowledgeBase)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DebateReview init warning:",
              err.message,
            ),
          );
        abComparator
          .initialize(evoDb, agentCoordinator, decisionKnowledgeBase)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ABComparator init warning:",
              err.message,
            ),
          );
      }

      // Wire CodeKnowledgeGraph into ContextEngineering
      if (registeredModules.contextEngineering) {
        registeredModules.contextEngineering.setCodeKnowledgeGraph(
          codeKnowledgeGraph,
        );
      }

      // Register IPC handlers
      registerEvolutionIPC({
        codeKnowledgeGraph,
        decisionKnowledgeBase,
        promptOptimizer,
        skillDiscoverer,
        debateReview,
        abComparator,
      });

      registeredModules.codeKnowledgeGraph = codeKnowledgeGraph;
      registeredModules.decisionKnowledgeBase = decisionKnowledgeBase;
      registeredModules.promptOptimizer = promptOptimizer;
      registeredModules.skillDiscoverer = skillDiscoverer;
      registeredModules.debateReview = debateReview;
      registeredModules.abComparator = abComparator;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 20 Complete: Evolution Metrics & Knowledge Graph ready!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { createPhase16SkillServices, registerPhases16to20 };
