/**
 * Phase 1: AI Core IPC Registrations.
 *
 * Largest of the original phase blocks. Covers LLM, PermanentMemory,
 * Markdown Skills, Skill Sync, AI Engine, Prompt
 * Compressor, Response Cache, Token Tracker, Stream
 * Controller, Team Task, Permission, Logger, RAG (gated), Follow-up
 * Intent, Browser.
 *
 * Returns the resolved `hookSystem` so callers (Plan Mode IPC was once
 * a closure consumer; Phase 16-20 still depends on it via deps).
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhase1AI({ safeRegister, logger, deps }) {
  const {
    llmManager,
    mainWindow,
    ragManager,
    promptTemplateManager,
    database,
    app,
    aiEngineManager,
    webEngine,
    documentEngine,
    dataEngine,
    gitAutoCommit,
    desktopBrowserVisionObservationHost,
    desktopBrowserVisionActionHost,
    desktopBrowserNavigationActionHost,
    desktopBrowserKeyboardActionHost,
    desktopBrowserTabOpenActionHost,
    desktopBrowserDownloadActionHost,
    desktopBrowserDownloadArtifactDisposalHost,
    desktopBrowserQuarantineOperatorRevocationHost,
    desktopBrowserQuarantineLockMaintenanceHost,
    didManager,
  } = deps;

  // 获取 LLM 智能选择器（如果已初始化）
  const llmSelector = app ? app.llmSelector || null : null;

  // 获取 Token 追踪器（如果已初始化）
  const tokenTracker = app ? app.tokenTracker || null : null;

  // 获取 Prompt 压缩器（如果已初始化）
  const promptCompressor = app ? app.promptCompressor || null : null;

  // 获取响应缓存（如果已初始化）
  const responseCache = app ? app.responseCache || null : null;

  // 获取 MCP 相关依赖（如果已初始化）
  const mcpClientManager = app ? app.mcpManager || null : null;
  const mcpToolAdapter = app ? app.mcpAdapter || null : null;

  // 🔥 获取高级特性依赖（SessionManager, ErrorMonitor, Multi-Agent, PermanentMemory）
  const sessionManager = app ? app.sessionManager || null : null;
  const errorMonitor = app ? app.errorMonitor || null : null;
  const agentOrchestrator = app ? app.agentOrchestrator || null : null;
  const permanentMemoryManager = app
    ? app.permanentMemoryManager || null
    : null;

  // LLM 服务 (函数模式 - 小模块示范，14 handlers)
  // 注意：即使 llmManager 为 null 也注册，handler 内部会处理 null 情况
  safeRegister("LLM IPC", {
    register: () => {
      const { registerLLMIPC } = require("../../llm/llm-ipc");
      registerLLMIPC({
        llmManager: llmManager || null,
        mainWindow: mainWindow || null,
        ragManager: ragManager || null,
        promptTemplateManager: promptTemplateManager || null,
        llmSelector,
        tokenTracker,
        promptCompressor,
        responseCache,
        database: database || null,
        app: app || null,
        mcpClientManager,
        mcpToolAdapter,
        // 🔥 高级特性依赖
        sessionManager,
        agentOrchestrator,
        errorMonitor,
        didManager: didManager || null,
      });
      if (!llmManager) {
        logger.info(
          "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
        );
        require("../degraded-registry").note(
          "ai-llm",
          "LLM manager not initialized",
        );
      }
    },
    handlers: 14,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // PermanentMemory 永久记忆管理 (Clawdbot 风格, 15 handlers)
  safeRegister("PermanentMemory IPC", {
    register: () => {
      const {
        registerPermanentMemoryIPC,
      } = require("../../llm/permanent-memory-ipc");
      registerPermanentMemoryIPC(permanentMemoryManager, {
        getCanonicalPilot: () =>
          app?.codingAgentBootstrap?.appServerPilot || null,
      });
      if (!permanentMemoryManager) {
        logger.warn(
          "[IPC Registry] Legacy PermanentMemoryManager unavailable; canonical handlers registered",
        );
      }
    },
    handlers: 15,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // Hooks remain an internal dependency of Plan Mode and Markdown Skills.
  // The unused renderer IPC surface has been retired.
  const { getHookSystem } = require("../../hooks");
  const hookSystem = getHookSystem();

  safeRegister("Evolvable Artifact Lifecycle IPC", {
    register: () => {
      const {
        registerArtifactLifecycleIPC,
      } = require("../../evolution/artifact-lifecycle-ipc");
      registerArtifactLifecycleIPC({
        evolvableArtifactSkillLifecycleProducer:
          deps.evolvableArtifactSkillLifecycleProducer || undefined,
        evolvableArtifactPromptLifecycleProducer:
          deps.evolvableArtifactPromptLifecycleProducer || undefined,
        evolvableArtifactHookLifecycleProducer:
          deps.evolvableArtifactHookLifecycleProducer || undefined,
      });
    },
    handlers: 2,
  });

  // Plan Mode remains an internal coding-agent guard. Its unused renderer IPC
  // surface has been retired, while the manager keeps the shared HookSystem.
  const {
    getPlanModeManager,
  } = require("../../ai-engine/plan-mode");
  const planModeManager = getPlanModeManager();
  if (planModeManager.hookSystem !== hookSystem) {
    planModeManager.setHookSystem(hookSystem);
  }

  // 🔥 Markdown Skills 系统 (Claude Code 风格, 17 handlers)
  safeRegister("Markdown Skills IPC", {
    register: () => {
      const {
        registerSkillsIPC,
      } = require("../../ai-engine/cowork/skills/skills-ipc");
      registerSkillsIPC({
        hookSystem,
        workspacePath: process.cwd(),
        artifactActiveReleaseReader:
          deps.evolvableArtifactSkillActiveReleaseReader || undefined,
        getSkillVectorAuthority: () =>
          deps.skillVectorAuthority ??
          app?.codingAgentBootstrap?.skillVectorAuthority ??
          null,
      });
    },
    handlers: 18,
  });

  // 🔥 跨设备技能同步 (7 handlers)
  safeRegister("Skill Sync IPC", {
    register: () => {
      const {
        registerSkillSyncIPC,
      } = require("../../ai-engine/cowork/skills/skill-sync-ipc");
      const {
        SkillSyncManager,
      } = require("../../ai-engine/cowork/skills/skill-sync-manager");
      const {
        getSkillRegistry,
      } = require("../../ai-engine/cowork/skills/skill-registry");

      const skillSyncManager = new SkillSyncManager({
        skillRegistry: getSkillRegistry(),
        artifactCandidateGate:
          deps.evolvableArtifactSkillCandidateGate || undefined,
        resolveArtifactDependencies:
          deps.resolveSkillArtifactDependencies || undefined,
        resolveArtifactBase: deps.resolveSkillArtifactBase || undefined,
      });
      registerSkillSyncIPC({ syncManager: skillSyncManager });
    },
    handlers: 7,
  });

  // 🔥 AI Engine IPC (AI引擎核心, 含Word/PPT生成等, 20+ handlers)
  safeRegister("AI Engine IPC", {
    register: () => {
      const AIEngineIPC = require("../../ai-engine/ai-engine-ipc");
      const aiEngineIPC = new AIEngineIPC(
        aiEngineManager || null,
        webEngine || null,
        documentEngine || null,
        dataEngine || null,
        gitAutoCommit || null,
      );
      aiEngineIPC.registerHandlers(mainWindow);
    },
    continueMessage: "Word/PPT generation will not be available",
  });

  // 🔥 Prompt Compressor 系统 (上下文压缩, 10 handlers)
  safeRegister("Prompt Compressor IPC", {
    register: () => {
      const {
        registerPromptCompressorIPC,
      } = require("../../llm/prompt-compressor-ipc");
      registerPromptCompressorIPC({
        llmManager: llmManager || null,
        getMainWindow: () => mainWindow || null,
        getCurrentIdentity: () => didManager?.getCurrentIdentity?.() || null,
        authorizePurpose: deps.authorizePromptCompressorPurpose,
      });
    },
    handlers: 10,
  });

  // 🔥 Response Cache 系统 (响应缓存, 11 handlers)
  safeRegister("Response Cache IPC", {
    register: () => {
      const {
        registerResponseCacheIPC,
      } = require("../../llm/response-cache-ipc");
      registerResponseCacheIPC({
        responseCache: responseCache || null,
        database: database || null,
        getMainWindow: () => mainWindow || null,
        getCurrentIdentity: () => didManager?.getCurrentIdentity?.() || null,
        authorizePurpose: deps.authorizeResponseCachePurpose,
      });
    },
    handlers: 11,
  });

  // 🔥 Token Tracker 系统 (Token 追踪与成本管理, 12 handlers)
  safeRegister("Token Tracker IPC", {
    register: () => {
      const {
        registerTokenTrackerIPC,
      } = require("../../llm/token-tracker-ipc");
      registerTokenTrackerIPC({
        tokenTracker: tokenTracker || null,
        database: database || null,
        getMainWindow: () => mainWindow || null,
        getCurrentIdentity: () => didManager?.getCurrentIdentity?.() || null,
        authorizePurpose: deps.authorizeTokenTrackerPurpose,
      });
    },
    handlers: 12,
  });

  // 🔥 Stream Controller 系统 (流式输出控制, 12 handlers)
  safeRegister("Stream Controller IPC", {
    register: () => {
      const {
        registerStreamControllerIPC,
      } = require("../../llm/stream-controller-ipc");
      registerStreamControllerIPC({
        mainWindow: mainWindow || null,
        didManager: didManager || null,
      });
    },
    handlers: 12,
  });

  // 🔥 Team Task Management 系统 (任务看板, 49 handlers)
  safeRegister("Team Task Management IPC", {
    register: () => {
      const { registerTaskIPC } = require("../../task/task-ipc");
      registerTaskIPC(database);
    },
    handlers: 49,
    subDetails: [
      "Board Management: 9 handlers",
      "Task Query: 4 handlers",
      "Task CRUD: 12 handlers",
      "Checklists: 5 handlers",
      "Comments/Activity: 6 handlers",
      "Attachments: 4 handlers",
      "Sprint Management: 5 handlers",
      "Reports/Analytics: 5 handlers",
    ],
  });

  // 🔥 Permission System (RBAC, 39 handlers)
  safeRegister("Permission System IPC", {
    register: () => {
      const {
        registerPermissionIPC,
      } = require("../../permission/permission-ipc");
      registerPermissionIPC(database);
    },
    handlers: 39,
    subDetails: [
      "Permission Management: 8 handlers",
      "Approval Workflows: 8 handlers",
      "Delegation: 4 handlers",
      "Team Management: 8 handlers",
      "Enterprise Permission (permission:*): 11 handlers",
    ],
  });

  // Logger 服务 (日志管理器)
  safeRegister("Logger IPC", {
    register: () => {
      const { registerLoggerIPC } = require("../logger-ipc");
      registerLoggerIPC({
        mainWindow: mainWindow || null,
        didManager: didManager || null,
        authorizePurpose: deps.authorizeLoggerPurpose,
      });
    },
    handlers: 1,
  });

  // RAG 检索 (函数模式 - 小模块示范，7 handlers)
  if (ragManager) {
    safeRegister("RAG IPC", {
      register: () => {
        const { registerRAGIPC } = require("../../rag/rag-ipc");
        registerRAGIPC({ ragManager, llmManager });
      },
      handlers: 7,
    });
  }

  // 后续输入意图分类器 (Follow-up Intent Classifier，3 handlers)
  safeRegister("Follow-up Intent Classifier IPC", {
    register: () => {
      const {
        registerIPCHandlers: registerFollowupIntentIPC,
      } = require("../../ai-engine/followup-intent-ipc");
      registerFollowupIntentIPC({
        llmService: llmManager || null,
        mainWindow: mainWindow || null,
        didManager: didManager || null,
        authorizePurpose: deps.authorizeFollowupIntentPurpose,
      });
    },
    handlers: 3,
  });

  // 浏览器自动化控制 (Browser Control，24 handlers)
  safeRegister("Browser IPC", {
    register: () => {
      const { registerBrowserIPC } = require("../../browser/browser-ipc");
      registerBrowserIPC({
        llmManager: llmManager || null,
        desktopBrowserVisionObservationHost:
          desktopBrowserVisionObservationHost || null,
        desktopBrowserVisionActionHost: desktopBrowserVisionActionHost || null,
        desktopBrowserNavigationActionHost:
          desktopBrowserNavigationActionHost || null,
        desktopBrowserKeyboardActionHost:
          desktopBrowserKeyboardActionHost || null,
        desktopBrowserTabOpenActionHost:
          desktopBrowserTabOpenActionHost || null,
        desktopBrowserDownloadActionHost:
          desktopBrowserDownloadActionHost || null,
        desktopBrowserDownloadArtifactDisposalHost:
          desktopBrowserDownloadArtifactDisposalHost || null,
        desktopBrowserQuarantineOperatorRevocationHost:
          desktopBrowserQuarantineOperatorRevocationHost || null,
        desktopBrowserQuarantineLockMaintenanceHost:
          desktopBrowserQuarantineLockMaintenanceHost || null,
        didManager: didManager || null,
        database: database || null,
      });
    },
    handlers: 27,
    continueMessage: "Browser automation features will be disabled",
  });

  return { hookSystem };
}

module.exports = { registerPhase1AI };
