/**
 * Phases 33-40 (v1.0.0 - v4.0.0): Git P2P Sync, Real-time Collaboration,
 * Dev Pipeline Orchestration, Autonomous Ops, NL Programming,
 * Multimodal Collaboration, Phase 39 wire-up, Decentralized Agent Network.
 *
 *  - Phase 33: Git P2P Sync (v1.0.0)
 *  - Phase 34: Real-time Collaboration / Yjs (v2.0.0)
 *  - Phase 35: Dev Pipeline Orchestration (v3.0)
 *  - Phase 36: Autonomous Ops — Anomaly Detection (v3.3)
 *  - Phase 37: NL Programming — Spec Translation (v3.1)
 *  - Phase 38: Multimodal Collaboration (v3.2)
 *  - Phase 39: Wire remaining deps (v3.0.C, v3.1.B, v3.2.B/C, v3.3.C)
 *  - Phase 40: Decentralized Agent Network (v4.0)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases33to40({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  const { app } = deps;

  // ============================================================
  // Phase 33: Git P2P Sync (v1.0.0)
  // ============================================================

  safeRegister("Git P2P IPC", {
    handlers: 15,
    register: () => {
      const { registerGitP2PIPC } = require("../../git/git-p2p-ipc");
      registerGitP2PIPC({
        p2pGitSync: app?.p2pGitSync || null,
        deviceDiscovery: app?.deviceDiscovery || null,
        p2pGitTransport: app?.p2pGitTransport || null,
        database: app?.database || null,
      });
    },
  });

  // ============================================================
  // Phase 34: Collaboration (v2.0.0)
  // ============================================================

  safeRegister("Collaboration IPC", {
    handlers: 22,
    register: () => {
      const { registerCollabIPC } = require("../../collab/collab-ipc");
      registerCollabIPC({
        yjsEngine: app?.yjsEngine || null,
        yjsProvider: app?.yjsProvider || null,
        sessionManager: app?.collabSessionManager || null,
        gitIntegration: app?.collabGitIntegration || null,
        mainWindow: app?.mainWindow || null,
      });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 33-34 Complete: Git P2P Sync, Real-time Collaboration ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 35: Dev Pipeline Orchestration (v3.0)
  // ============================================================

  safeRegister("Dev Pipeline IPC", {
    register: () => {
      const {
        getPipelineOrchestrator,
      } = require("../../ai-engine/cowork/pipeline-orchestrator");
      const {
        getRequirementParser,
      } = require("../../ai-engine/cowork/requirement-parser");
      const {
        registerPipelineIPC,
      } = require("../../ai-engine/cowork/pipeline-ipc");

      const pipelineOrchestrator = getPipelineOrchestrator();
      const requirementParser = getRequirementParser();

      if (deps.database) {
        requirementParser
          .initialize(deps.database, {
            codeKnowledgeGraph: registeredModules.codeKnowledgeGraph || null,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] RequirementParser init warning:",
              err.message,
            ),
          );
        pipelineOrchestrator
          .initialize(deps.database, {
            requirementParser,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PipelineOrchestrator init warning:",
              err.message,
            ),
          );
      }

      registerPipelineIPC({
        pipelineOrchestrator,
        requirementParser,
      });

      registeredModules.pipelineOrchestrator = pipelineOrchestrator;
      registeredModules.requirementParser = requirementParser;
    },
  });

  // ============================================================
  // Phase 36: Autonomous Ops — Anomaly Detection (v3.3)
  // ============================================================

  safeRegister("Autonomous Ops IPC", {
    register: () => {
      const {
        getAnomalyDetector,
      } = require("../../ai-engine/cowork/anomaly-detector");
      const {
        getIncidentClassifier,
      } = require("../../ai-engine/cowork/incident-classifier");
      const {
        registerAutonomousOpsIPC,
      } = require("../../ai-engine/cowork/autonomous-ops-ipc");
      const {
        getAutoRemediator,
      } = require("../../ai-engine/cowork/auto-remediator");
      const {
        getRollbackManager,
      } = require("../../ai-engine/cowork/rollback-manager");
      const {
        getAlertManager,
      } = require("../../ai-engine/cowork/alert-manager");

      const anomalyDetector = getAnomalyDetector();
      const incidentClassifier = getIncidentClassifier();
      const autoRemediator = getAutoRemediator();
      const rollbackManager = getRollbackManager();
      const alertManager = getAlertManager();

      if (deps.database) {
        anomalyDetector
          .initialize(deps.database, {
            errorMonitor: registeredModules.errorMonitor || null,
            performanceMonitor: registeredModules.performanceMonitor || null,
            incidentClassifier,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AnomalyDetector init warning:",
              err.message,
            ),
          );
        incidentClassifier
          .initialize(deps.database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] IncidentClassifier init warning:",
              err.message,
            ),
          );
        rollbackManager
          .initialize(deps.database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] RollbackManager init warning:",
              err.message,
            ),
          );
        alertManager
          .initialize(deps.database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AlertManager init warning:",
              err.message,
            ),
          );
        autoRemediator
          .initialize(deps.database, {
            rollbackManager,
            alertManager,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AutoRemediator init warning:",
              err.message,
            ),
          );
      }

      registerAutonomousOpsIPC({
        anomalyDetector,
        incidentClassifier,
        autoRemediator,
        rollbackManager,
        alertManager,
      });

      registeredModules.anomalyDetector = anomalyDetector;
      registeredModules.incidentClassifier = incidentClassifier;
      registeredModules.autoRemediator = autoRemediator;
      registeredModules.rollbackManager = rollbackManager;
      registeredModules.alertManager = alertManager;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 35-36 Complete: Dev Pipeline + Autonomous Ops ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 37: NL Programming — Spec Translation (v3.1)
  // ============================================================

  safeRegister("NL Programming IPC", {
    register: () => {
      const {
        getSpecTranslator,
      } = require("../../ai-engine/cowork/spec-translator");
      const {
        registerNLProgrammingIPC,
      } = require("../../ai-engine/cowork/nl-programming-ipc");

      const specTranslator = getSpecTranslator();

      if (deps.database) {
        specTranslator
          .initialize(deps.database, {
            ckg: registeredModules.codeKnowledgeGraph || null,
            llmService: registeredModules.llmService || null,
            instinctManager: registeredModules.instinctManager || null,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SpecTranslator init warning:",
              err.message,
            ),
          );
      }

      registerNLProgrammingIPC({ specTranslator });

      registeredModules.specTranslator = specTranslator;
    },
  });

  // ============================================================
  // Phase 38: Multimodal Collaboration (v3.2)
  // ============================================================

  safeRegister("Multimodal Collaboration IPC", {
    register: () => {
      const {
        getModalityFusion,
      } = require("../../ai-engine/cowork/modality-fusion");
      const {
        getDocumentParser,
      } = require("../../ai-engine/cowork/document-parser");
      const {
        getMultimodalContext,
      } = require("../../ai-engine/cowork/multimodal-context");
      const {
        registerMultimodalCollabIPC,
      } = require("../../ai-engine/cowork/multimodal-collab-ipc");

      const documentParser = getDocumentParser();
      const modalityFusion = getModalityFusion();
      const multimodalContext = getMultimodalContext();

      if (deps.database) {
        documentParser
          .initialize(deps.database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DocumentParser init warning:",
              err.message,
            ),
          );
        modalityFusion
          .initialize(deps.database, { documentParser })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ModalityFusion init warning:",
              err.message,
            ),
          );
        multimodalContext
          .initialize({ modalityFusion })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] MultimodalContext init warning:",
              err.message,
            ),
          );
      }

      registerMultimodalCollabIPC({
        modalityFusion,
        documentParser,
        multimodalContext,
      });

      registeredModules.documentParser = documentParser;
      registeredModules.modalityFusion = modalityFusion;
      registeredModules.multimodalContext = multimodalContext;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 37-38 Complete: NL Programming + Multimodal ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 39: Wire remaining deps (v3.0.C, v3.1.B, v3.2.B/C, v3.3.C)
  // ============================================================

  safeRegister("Phase 39 dependencies", {
    register: () => {
      // v3.0.C: DeployAgent + PostDeployMonitor
      const { getDeployAgent } = require("../../ai-engine/cowork/deploy-agent");
      const {
        getPostDeployMonitor,
      } = require("../../ai-engine/cowork/post-deploy-monitor");
      const deployAgent = getDeployAgent();
      const postDeployMonitor = getPostDeployMonitor();

      if (deps.database) {
        deployAgent
          .initialize(deps.database, {
            rollbackManager: registeredModules.rollbackManager || null,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DeployAgent init warning:",
              err.message,
            ),
          );
      }
      postDeployMonitor
        .initialize({
          errorMonitor: registeredModules.errorMonitor || null,
          performanceMonitor: registeredModules.performanceMonitor || null,
          anomalyDetector: registeredModules.anomalyDetector || null,
          rollbackManager: registeredModules.rollbackManager || null,
        })
        .catch((err) =>
          logger.warn(
            "[IPC Registry] PostDeployMonitor init warning:",
            err.message,
          ),
        );
      registeredModules.deployAgent = deployAgent;
      registeredModules.postDeployMonitor = postDeployMonitor;

      // v3.1.B: ProjectStyleAnalyzer
      const {
        getProjectStyleAnalyzer,
      } = require("../../ai-engine/cowork/project-style-analyzer");
      const projectStyleAnalyzer = getProjectStyleAnalyzer();

      if (deps.database) {
        projectStyleAnalyzer
          .initialize(deps.database, {
            ckg: registeredModules.codeKnowledgeGraph || null,
            instinctManager: registeredModules.instinctManager || null,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ProjectStyleAnalyzer init warning:",
              err.message,
            ),
          );
      }
      registeredModules.projectStyleAnalyzer = projectStyleAnalyzer;

      // v3.2.B/C: ScreenRecorder + MultimodalOutput
      const {
        getScreenRecorder,
      } = require("../../ai-engine/cowork/screen-recorder");
      const {
        getMultimodalOutput,
      } = require("../../ai-engine/cowork/multimodal-output");
      const screenRecorder = getScreenRecorder();
      const multimodalOutput = getMultimodalOutput();

      screenRecorder
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] ScreenRecorder init warning:",
            err.message,
          ),
        );
      multimodalOutput
        .initialize()
        .catch((err) =>
          logger.warn(
            "[IPC Registry] MultimodalOutput init warning:",
            err.message,
          ),
        );
      registeredModules.screenRecorder = screenRecorder;
      registeredModules.multimodalOutput = multimodalOutput;

      // v3.3.C: PostmortemGenerator
      const {
        getPostmortemGenerator,
      } = require("../../ai-engine/cowork/postmortem-generator");
      const postmortemGenerator = getPostmortemGenerator();

      if (deps.database) {
        postmortemGenerator
          .initialize(deps.database, {
            llmService: registeredModules.llmService || null,
            incidentClassifier: registeredModules.incidentClassifier || null,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PostmortemGenerator init warning:",
              err.message,
            ),
          );
      }
      registeredModules.postmortemGenerator = postmortemGenerator;
    },
  });

  // ============================================================
  // Phase 40: Decentralized Agent Network (v4.0)
  // ============================================================

  safeRegister("Decentralized Network IPC", {
    register: () => {
      const { getAgentDID } = require("../../ai-engine/cowork/agent-did");
      const {
        getFederatedAgentRegistry,
      } = require("../../ai-engine/cowork/federated-agent-registry");
      const {
        getAgentCredentialManager,
      } = require("../../ai-engine/cowork/agent-credential-manager");
      const {
        getCrossOrgTaskRouter,
      } = require("../../ai-engine/cowork/cross-org-task-router");
      const {
        getAgentReputation,
      } = require("../../ai-engine/cowork/agent-reputation");
      const {
        getAgentAuthenticator,
      } = require("../../ai-engine/cowork/agent-authenticator");
      const {
        registerDecentralizedNetworkIPC,
      } = require("../../ai-engine/cowork/decentralized-network-ipc");

      const agentDIDInstance = getAgentDID();
      const federatedRegistry = getFederatedAgentRegistry();
      const credentialManager = getAgentCredentialManager();
      const taskRouter = getCrossOrgTaskRouter();
      const reputationSystem = getAgentReputation();
      const authenticator = getAgentAuthenticator();

      if (deps.database) {
        agentDIDInstance
          .initialize(deps.database)
          .catch((err) =>
            logger.warn("[IPC Registry] AgentDID init warning:", err.message),
          );
        federatedRegistry
          .initialize(deps.database, { agentDID: agentDIDInstance })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] FederatedAgentRegistry init warning:",
              err.message,
            ),
          );
        credentialManager
          .initialize(deps.database, { agentDID: agentDIDInstance })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AgentCredentialManager init warning:",
              err.message,
            ),
          );
        reputationSystem
          .initialize(deps.database)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AgentReputation init warning:",
              err.message,
            ),
          );
        taskRouter
          .initialize(deps.database, {
            federatedRegistry,
            agentReputation: reputationSystem,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] CrossOrgTaskRouter init warning:",
              err.message,
            ),
          );
        authenticator
          .initialize(deps.database, {
            agentDID: agentDIDInstance,
            credentialManager,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AgentAuthenticator init warning:",
              err.message,
            ),
          );
      }

      registerDecentralizedNetworkIPC({
        agentDID: agentDIDInstance,
        federatedRegistry,
        credentialManager,
        taskRouter,
        reputation: reputationSystem,
        authenticator,
      });

      registeredModules.agentDID = agentDIDInstance;
      registeredModules.federatedRegistry = federatedRegistry;
      registeredModules.credentialManager = credentialManager;
      registeredModules.taskRouter = taskRouter;
      registeredModules.reputationSystem = reputationSystem;
      registeredModules.authenticator = authenticator;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 39-40 Complete: All v3.0-v4.0 modules ready!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases33to40 };
