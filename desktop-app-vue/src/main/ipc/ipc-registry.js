/**
 * IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦
 */

import { createRequire } from "module";
import { logger } from "../utils/logger.js";
import ipcGuard from "./ipc-guard.js";

const require = createRequire(import.meta.url);

/**
 * 递归移除对象中的 undefined 值
 * @param {*} obj - 要处理的对象
 * @returns {*} 清理后的对象
 */
function removeUndefinedValues(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedValues(item));
  }
  if (typeof obj === "object") {
    const result = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== undefined) {
        result[key] = removeUndefinedValues(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * 递归将对象中的 undefined 值替换为 null（用于 IPC 序列化）
 * @param {*} obj - 要处理的对象
 * @returns {*} 处理后的对象
 */
function _replaceUndefinedWithNull(obj) {
  if (obj === undefined) {
    return null;
  }
  if (obj === null) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => _replaceUndefinedWithNull(item));
  }
  if (typeof obj === "object") {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = _replaceUndefinedWithNull(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * 安全注册 IPC 模块的辅助函数
 *
 * 封装重复的 try/catch + 日志模式，每个 phase 从 ~25 行降到 ~10 行。
 *
 * @param {string} name - 模块显示名 (e.g., "Cowork IPC")
 * @param {Object} options
 * @param {Function} options.register - 实际注册逻辑（同步函数）
 * @param {number} [options.handlers] - handler 数量（用于日志）
 * @param {string[]} [options.subDetails] - 子模块详情列表（"TeammateTool: 15 handlers"）
 * @param {boolean} [options.fatal=false] - 失败时使用 error（true）还是 warn（false）
 * @param {string} [options.continueMessage] - 失败后的提示
 * @returns {boolean} 注册是否成功
 */
function safeRegister(name, options) {
  const {
    register,
    handlers,
    subDetails = [],
    fatal = false,
    continueMessage,
  } = options;
  try {
    logger.info(`[IPC Registry] Registering ${name}...`);
    register();
    const suffix = handlers != null ? ` (${handlers} handlers)` : "";
    logger.info(`[IPC Registry] ✓ ${name} registered${suffix}`);
    for (const detail of subDetails) {
      logger.info(`[IPC Registry]   - ${detail}`);
    }
    return true;
  } catch (err) {
    const level = fatal ? "error" : "warn";
    const icon = fatal ? "❌" : "⚠️ ";
    const tag = fatal ? "" : " (non-fatal)";
    logger[level](
      `[IPC Registry] ${icon} ${name} registration failed${tag}:`,
      err.message,
    );
    if (continueMessage) {
      logger.info(`[IPC Registry] ⚠️  ${continueMessage}`);
    }
    return false;
  }
}

/**
 * 注册所有 IPC 处理器
 * @param {Object} dependencies - 依赖对象，包含所有管理器实例
 * @param {Object} dependencies.app - ChainlessChainApp 实例
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.ragManager - RAG 管理器
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.gitManager - Git 管理器
 * @param {Object} dependencies.didManager - DID 管理器
 * @param {Object} dependencies.p2pManager - P2P 管理器
 * @param {Object} dependencies.skillManager - 技能管理器
 * @param {Object} dependencies.toolManager - 工具管理器
 * @param {Object} [dependencies.*] - 其他管理器实例...
 * @returns {Object} 返回所有 IPC 模块实例，便于测试和调试
 */
function registerAllIPC(dependencies) {
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Starting modular IPC registration...");
  logger.info("[IPC Registry] ========================================");

  const startTime = Date.now();
  const registeredModules = {};

  // 检查是否已经注册过（防止重复注册）
  if (ipcGuard.isModuleRegistered("ipc-registry")) {
    logger.warn(
      "[IPC Registry] ⚠️  IPC Registry already marked as initialized!",
    );
    logger.warn(
      "[IPC Registry] This may indicate a stale registration state. Clearing and re-registering...",
    );

    // 清除所有注册状态以便重新注册
    try {
      ipcGuard.resetAll();
      logger.info(
        "[IPC Registry] ✓ Registration state cleared, proceeding with fresh registration...",
      );
    } catch (e) {
      logger.error("[IPC Registry] ❌ Failed to clear registration state:", e);
      // 继续执行，不要返回
    }
  }

  try {
    // 解构所有依赖（便于后续传递给各个模块）
    // 注意：部分依赖在此文件中未使用，但保留用于保持兼容性
    const {
      app,
      database,
      mainWindow,
      llmManager,
      ragManager,
      ukeyManager,
      gitManager,
      gitHotReload,
      didManager,
      p2pManager,
      // skillManager, // Kept in dependencies for future use
      // toolManager, // Kept in dependencies for future use
      imageUploader,
      fileImporter,
      templateManager,
      promptTemplateManager,
      knowledgePaymentManager,
      creditScoreManager,
      reviewManager,
      vcTemplateManager,
      identityContextManager,
      aiEngineManager,
      webEngine,
      documentEngine,
      dataEngine,
      // projectStructureManager, // Kept for future use
      // pluginManager, // Kept for future use
      // webideManager, // Kept for future use
      // statsCollector, // Kept for future use
      fileSyncManager,
      // previewManager, // Kept for future use
      markdownExporter,
      // nativeMessagingServer, // Kept for future use
      gitAutoCommit,
      // skillExecutor, // Kept for future use
      // aiScheduler, // Kept for future use
      chatSkillBridge,
      syncManager,
      contactManager,
      friendManager,
      postManager,
      vcManager,
      organizationManager,
      dbManager,
      versionManager,
    } = dependencies;

    // ============================================================
    // 第一阶段模块 (AI 相关 - 优先级最高，作为示范)
    // ============================================================

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
        const { registerLLMIPC } = require("../llm/llm-ipc");
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
        });
        if (!llmManager) {
          logger.info(
            "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
          );
        }
      },
      handlers: 14,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // PermanentMemory 永久记忆管理 (Clawdbot 风格, 7 handlers)
    safeRegister("PermanentMemory IPC", {
      register: () => {
        if (permanentMemoryManager) {
          const {
            registerPermanentMemoryIPC,
          } = require("../llm/permanent-memory-ipc");
          registerPermanentMemoryIPC(permanentMemoryManager);
        } else {
          const { ipcMain } = require("electron");
          const fallbackChannels = [
            "memory:write-daily-note",
            "memory:read-daily-note",
            "memory:get-recent-daily-notes",
            "memory:read-memory",
            "memory:append-to-memory",
            "memory:update-memory",
            "memory:get-stats",
            "memory:search",
            "memory:get-today-date",
            "memory:get-index-stats",
            "memory:rebuild-index",
            "memory:start-file-watcher",
            "memory:stop-file-watcher",
            "memory:get-embedding-cache-stats",
            "memory:clear-embedding-cache",
            "memory:save-to-memory",
            "memory:extract-from-conversation",
            "memory:extract-from-session",
            "memory:get-memory-sections",
          ];
          for (const channel of fallbackChannels) {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, async () => ({
              success: false,
              error: "PermanentMemoryManager is not initialized",
              code: "PERMANENT_MEMORY_UNAVAILABLE",
            }));
          }
          logger.warn(
            "[IPC Registry] ⚠️ PermanentMemoryManager unavailable (fallback handlers registered)",
          );
        }
      },
      handlers: 7,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 🔥 Hooks 系统 (Claude Code 风格, 11 handlers)
    let hookSystem = null;
    safeRegister("Hooks IPC", {
      register: () => {
        const { registerHooksIPC } = require("../hooks/hooks-ipc");
        const { getHookSystem } = require("../hooks");
        hookSystem = getHookSystem();
        registerHooksIPC({ hookSystem });
      },
      handlers: 11,
    });

    // 🔥 Plan Mode 系统 (Claude Code 风格, 14 handlers)
    safeRegister("Plan Mode IPC", {
      register: () => {
        const {
          registerPlanModeIPC,
        } = require("../ai-engine/plan-mode/plan-mode-ipc");
        registerPlanModeIPC({
          hookSystem,
          functionCaller: aiEngineManager?.functionCaller || null,
        });
      },
      handlers: 14,
    });

    // 🔥 Markdown Skills 系统 (Claude Code 风格, 17 handlers)
    safeRegister("Markdown Skills IPC", {
      register: () => {
        const {
          registerSkillsIPC,
        } = require("../ai-engine/cowork/skills/skills-ipc");
        registerSkillsIPC({ hookSystem, workspacePath: process.cwd() });
      },
      handlers: 17,
    });

    // 🔥 跨设备技能同步 (7 handlers)
    safeRegister("Skill Sync IPC", {
      register: () => {
        const {
          registerSkillSyncIPC,
        } = require("../ai-engine/cowork/skills/skill-sync-ipc");
        const {
          SkillSyncManager,
        } = require("../ai-engine/cowork/skills/skill-sync-manager");
        const {
          getSkillRegistry,
        } = require("../ai-engine/cowork/skills/skill-registry");

        const skillSyncManager = new SkillSyncManager({
          skillRegistry: getSkillRegistry(),
        });
        registerSkillSyncIPC({ syncManager: skillSyncManager });
      },
      handlers: 7,
    });

    // 🔥 Context Engineering 系统 (KV-Cache 优化, 17 handlers)
    safeRegister("Context Engineering IPC", {
      register: () => {
        const {
          registerContextEngineeringIPC,
        } = require("../llm/context-engineering-ipc");
        registerContextEngineeringIPC();
      },
      handlers: 17,
    });

    // 🔥 AI Engine IPC (AI引擎核心, 含Word/PPT生成等, 20+ handlers)
    safeRegister("AI Engine IPC", {
      register: () => {
        const AIEngineIPC = require("../ai-engine/ai-engine-ipc");
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
        } = require("../llm/prompt-compressor-ipc");
        registerPromptCompressorIPC({ llmManager: llmManager || null });
      },
      handlers: 10,
    });

    // 🔥 Response Cache 系统 (响应缓存, 11 handlers)
    safeRegister("Response Cache IPC", {
      register: () => {
        const {
          registerResponseCacheIPC,
        } = require("../llm/response-cache-ipc");
        registerResponseCacheIPC({
          responseCache: responseCache || null,
          database: database || null,
        });
      },
      handlers: 11,
    });

    // 🔥 Token Tracker 系统 (Token 追踪与成本管理, 12 handlers)
    safeRegister("Token Tracker IPC", {
      register: () => {
        const { registerTokenTrackerIPC } = require("../llm/token-tracker-ipc");
        registerTokenTrackerIPC({
          tokenTracker: tokenTracker || null,
          database: database || null,
        });
      },
      handlers: 12,
    });

    // 🔥 Stream Controller 系统 (流式输出控制, 12 handlers)
    safeRegister("Stream Controller IPC", {
      register: () => {
        const {
          registerStreamControllerIPC,
        } = require("../llm/stream-controller-ipc");
        registerStreamControllerIPC({ mainWindow: mainWindow || null });
      },
      handlers: 12,
    });

    // 🔥 Resource Monitor 系统 (资源监控与降级, 13 handlers)
    safeRegister("Resource Monitor IPC", {
      register: () => {
        const {
          registerResourceMonitorIPC,
        } = require("../utils/resource-monitor-ipc");
        registerResourceMonitorIPC({ mainWindow: mainWindow || null });
      },
      handlers: 13,
    });

    // 🔥 Message Aggregator 系统 (消息批量聚合, 10 handlers)
    safeRegister("Message Aggregator IPC", {
      register: () => {
        const {
          registerMessageAggregatorIPC,
        } = require("../utils/message-aggregator-ipc");
        registerMessageAggregatorIPC({ mainWindow: mainWindow || null });
      },
      handlers: 10,
    });

    // 🔥 Progress Emitter 系统 (统一进度通知, 12 handlers)
    safeRegister("Progress Emitter IPC", {
      register: () => {
        const {
          registerProgressEmitterIPC,
        } = require("../utils/progress-emitter-ipc");
        registerProgressEmitterIPC({ mainWindow: mainWindow || null });
      },
      handlers: 12,
    });

    // 🔥 Team Task Management 系统 (任务看板, 49 handlers)
    safeRegister("Team Task Management IPC", {
      register: () => {
        const { registerTaskIPC } = require("../task/task-ipc");
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
        } = require("../permission/permission-ipc");
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
        const { registerLoggerIPC } = require("./logger-ipc");
        registerLoggerIPC();
      },
      handlers: 6,
    });

    // RAG 检索 (函数模式 - 小模块示范，7 handlers)
    if (ragManager) {
      safeRegister("RAG IPC", {
        register: () => {
          const { registerRAGIPC } = require("../rag/rag-ipc");
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
        } = require("../ai-engine/followup-intent-ipc");
        registerFollowupIntentIPC(llmManager);
      },
      handlers: 3,
    });

    // 联网搜索工具 (Web Search，4 handlers)
    safeRegister("Web Search IPC", {
      register: () => {
        const { registerWebSearchIPC } = require("../utils/web-search-ipc");
        registerWebSearchIPC();
      },
      handlers: 4,
    });

    // 浏览器自动化控制 (Browser Control，22 handlers: 12 Phase1 + 6 Phase2 + 4 Phase3)
    safeRegister("Browser IPC", {
      register: () => {
        const { registerBrowserIPC } = require("../browser/browser-ipc");
        registerBrowserIPC();
      },
      handlers: 22,
      continueMessage: "Browser automation features will be disabled",
    });

    // ============================================================
    // 第二阶段模块 (核心功能)
    // ============================================================

    // U-Key 硬件管理 (函数模式 - 小模块，9 handlers)
    // 注意：即使 ukeyManager 为 null 也注册，handler 内部会处理 null 情况
    safeRegister("U-Key IPC", {
      register: () => {
        const { registerUKeyIPC } = require("../ukey/ukey-ipc");
        registerUKeyIPC({ ukeyManager });
        if (!ukeyManager) {
          logger.info(
            "[IPC Registry] ⚠️  U-Key manager not initialized (handlers registered with degraded functionality)",
          );
        }
      },
      handlers: 9,
    });

    // 数据库管理 (函数模式 - 中等模块，22 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    safeRegister("Database IPC", {
      register: () => {
        const { registerDatabaseIPC } = require("../database/database-ipc");
        const { getAppConfig } = require("../config/database-config");
        registerDatabaseIPC({
          database,
          ragManager,
          getAppConfig,
        });
        if (!database) {
          logger.info(
            "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
          );
        }
      },
      handlers: 22,
    });

    // Git 版本控制 (函数模式 - 中等模块，16 handlers)
    // 注意：即使 gitManager 为 null 也注册 IPC，让 handler 内部处理
    safeRegister("Git IPC", {
      register: () => {
        const { registerGitIPC } = require("../git/git-ipc");
        const { getGitConfig } = require("../git/git-config");
        registerGitIPC({
          gitManager,
          markdownExporter,
          getGitConfig,
          llmManager,
          gitHotReload,
          mainWindow,
        });
        if (!gitManager) {
          logger.info(
            "[IPC Registry] ⚠️  Git manager not initialized (Git sync disabled in config)",
          );
        }
        if (gitHotReload) {
          logger.info("[IPC Registry] ✓ Git Hot Reload enabled");
        }
      },
      handlers: 22,
    });

    // ============================================================
    // 关键IPC模块 - 提前注册 (用于E2E测试)
    // ============================================================

    // 🔥 MCP 基础配置 IPC - 始终注册，允许用户通过UI启用/禁用MCP
    // 这是独立于MCP系统初始化的，因为用户需要先能配置MCP才能启用它
    safeRegister("MCP Basic Config IPC (early)", {
      register: () => {
        const { registerBasicMCPConfigIPC } = require("../mcp/mcp-ipc");
        registerBasicMCPConfigIPC();
      },
      handlers: 5,
      fatal: true,
    });

    // 系统窗口控制 - 提前注册 (不需要 mainWindow 的部分)
    safeRegister("System IPC (early)", {
      register: () => {
        const { registerSystemIPC } = require("../system/system-ipc");
        registerSystemIPC({ mainWindow: mainWindow || null });
      },
      handlers: 16,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 通知管理 - 提前注册
    safeRegister("Notification IPC (early)", {
      register: () => {
        const {
          registerNotificationIPC,
        } = require("../notification/notification-ipc");
        registerNotificationIPC({ database: database || null });
      },
      handlers: 5,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // ============================================================
    // 第三阶段模块 (社交网络 - DID, P2P, Social)
    // ============================================================

    // DID 身份管理 (函数模式 - 中等模块，24 handlers)
    if (didManager) {
      safeRegister("DID IPC", {
        register: () => {
          const { registerDIDIPC } = require("../did/did-ipc");
          registerDIDIPC({ didManager });
        },
        handlers: 24,
        fatal: true,
        continueMessage: "Continuing with other IPC registrations...",
      });
    }

    // P2P 网络通信 (函数模式 - 中等模块，18 handlers)
    if (p2pManager) {
      safeRegister("P2P + Signaling IPC", {
        register: () => {
          const { registerP2PIPC } = require("../p2p/p2p-ipc");
          registerP2PIPC({ p2pManager });
          // 嵌入式信令服务器 (函数模式 - 小模块，11 handlers)
          // Note: Signaling server IPC is registered with p2pManager as provider
          const { registerSignalingIPC } = require("../p2p/signaling-ipc");
          registerSignalingIPC({ p2pManager });
        },
        handlers: 29,
        fatal: true,
        continueMessage: "Continuing with other IPC registrations...",
      });
    }

    // 外部设备文件管理 (函数模式 - 中等模块，15 handlers)
    if (p2pManager && database) {
      const externalFileManager = dependencies.externalFileManager;
      if (externalFileManager) {
        safeRegister("External Device File IPC", {
          register: () => {
            const {
              registerExternalDeviceFileIPC,
            } = require("../file/external-device-file-ipc");
            registerExternalDeviceFileIPC(
              require("electron").ipcMain,
              externalFileManager,
            );
          },
          handlers: 15,
          fatal: true,
          continueMessage: "Continuing with other IPC registrations...",
        });
      }
    }

    // 社交网络 (函数模式 - 大模块，33 handlers: contact + friend + post + chat)
    safeRegister("Social IPC", {
      register: () => {
        const { registerSocialIPC } = require("../social/social-ipc");
        registerSocialIPC({
          contactManager: contactManager || null,
          friendManager: friendManager || null,
          postManager: postManager || null,
          database: database || null,
        });
        if (!contactManager && !friendManager && !postManager && !database) {
          logger.warn(
            "[IPC Registry] ⚠ Social IPC registered with null dependencies (degraded mode)",
          );
        }
      },
      handlers: 33,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // v0.39.0 — 通话 IPC (12 handlers)
    safeRegister("Call IPC", {
      register: () => {
        const { registerCallIPC } = require("../social/call-ipc");
        registerCallIPC({
          callManager: dependencies.callManager || null,
          mediaEngine: dependencies.mediaEngine || null,
          callSignaling: dependencies.callSignaling || null,
          sfuRelay: dependencies.sfuRelay || null,
        });
      },
      handlers: 12,
      fatal: true,
    });

    // v0.40.0 — 共享相册 IPC (12 handlers)
    safeRegister("Album IPC", {
      register: () => {
        const { registerAlbumIPC } = require("../social/album-ipc");
        registerAlbumIPC({
          sharedAlbumManager: dependencies.sharedAlbumManager || null,
          photoEncryptor: dependencies.photoEncryptor || null,
          photoSync: dependencies.photoSync || null,
          exifStripper: dependencies.exifStripper || null,
        });
      },
      handlers: 12,
      fatal: true,
    });

    // v0.41.0 — 社交协作编辑 IPC (12 handlers)
    safeRegister("Social Collab IPC", {
      register: () => {
        const {
          registerCollabSocialIPC,
        } = require("../social/collab-social-ipc");
        registerCollabSocialIPC({
          collabEngine: dependencies.collabEngine || null,
          collabSync: dependencies.collabSync || null,
          collabAwareness: dependencies.collabAwareness || null,
          docVersionManager: dependencies.docVersionManager || null,
        });
      },
      handlers: 12,
      fatal: true,
    });

    // v0.42.0 — 社区/频道 IPC (24 handlers)
    safeRegister("Community IPC", {
      register: () => {
        const { registerCommunityIPC } = require("../social/community-ipc");
        registerCommunityIPC({
          communityManager: dependencies.communityManager || null,
          channelManager: dependencies.channelManager || null,
          governanceEngine: dependencies.governanceEngine || null,
          gossipProtocol: dependencies.gossipProtocol || null,
          contentModerator: dependencies.contentModerator || null,
        });
      },
      handlers: 24,
      fatal: true,
    });

    // v0.43.0 — 时光机 IPC (15 handlers)
    safeRegister("Time Machine IPC", {
      register: () => {
        const {
          registerTimeMachineIPC,
        } = require("../social/time-machine-ipc");
        registerTimeMachineIPC({
          timeMachine: dependencies.timeMachine || null,
          memoryGenerator: dependencies.memoryGenerator || null,
          sentimentAnalyzer: dependencies.sentimentAnalyzer || null,
          socialStats: dependencies.socialStats || null,
        });
      },
      handlers: 15,
      fatal: true,
    });

    // v0.44.0 — 直播 IPC (12 handlers)
    safeRegister("Livestream IPC", {
      register: () => {
        const { registerLivestreamIPC } = require("../social/livestream-ipc");
        registerLivestreamIPC({
          livestreamManager: dependencies.livestreamManager || null,
          danmakuEngine: dependencies.danmakuEngine || null,
        });
      },
      handlers: 12,
      fatal: true,
    });

    // v0.45.0+ — 未来功能 IPC (38 handlers)
    safeRegister("Future Social IPC", {
      register: () => {
        const { registerFutureIPC } = require("../social/future-ipc");
        registerFutureIPC({
          anonymousMode: dependencies.anonymousMode || null,
          platformBridge: dependencies.platformBridge || null,
          socialToken: dependencies.socialToken || null,
          aiSocialAssistant: dependencies.aiSocialAssistant || null,
          storageMarket: dependencies.storageMarket || null,
          meshSocial: dependencies.meshSocial || null,
        });
      },
      handlers: 38,
      fatal: true,
    });

    // ============================================================
    // 第四阶段模块 (企业版 - VC, Organization, Identity Context)
    // ============================================================

    // 可验证凭证 (函数模式 - 小模块，10 handlers)
    if (vcManager) {
      safeRegister("VC IPC", {
        register: () => {
          const { registerVCIPC } = require("../vc/vc-ipc");
          registerVCIPC({ vcManager });
        },
        handlers: 10,
        fatal: true,
      });
    }

    // 身份上下文 (函数模式 - 小模块，7 handlers)
    if (identityContextManager) {
      safeRegister("Identity Context IPC", {
        register: () => {
          const {
            registerIdentityContextIPC,
          } = require("../identity-context/identity-context-ipc");
          registerIdentityContextIPC({ identityContextManager });
        },
        handlers: 7,
        fatal: true,
      });
    }

    // 组织管理 (函数模式 - 大模块，32 handlers)
    // 🔥 始终注册，handlers 内部会处理 organizationManager 为 null 的情况
    logger.info("[IPC Registry] Organization 依赖状态:", {
      organizationManager: !!organizationManager,
      dbManager: !!dbManager,
      versionManager: !!versionManager,
    });
    safeRegister("Organization IPC", {
      register: () => {
        const {
          registerOrganizationIPC,
        } = require("../organization/organization-ipc");
        registerOrganizationIPC({
          organizationManager,
          dbManager,
          versionManager,
        });
        if (!organizationManager && !dbManager) {
          logger.warn(
            "[IPC Registry] ⚠️  Organization IPC registered with null dependencies",
          );
          logger.warn("[IPC Registry] 企业版功能将返回空数据直到依赖初始化");
        }
      },
      handlers: 32,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 企业版仪表板 (函数模式 - 中模块，10 handlers)
    if (database) {
      safeRegister("Dashboard IPC", {
        register: () => {
          const {
            registerDashboardIPC,
          } = require("../organization/dashboard-ipc");
          registerDashboardIPC({
            database,
            organizationManager,
          });
        },
        handlers: 10,
        fatal: true,
      });
    }

    // 企业版权限管理扩展 (降级模式)
    // 注意：这些处理器已由 registerPermissionIPC() 注册（第二阶段），此处跳过
    // 保留注释以说明设计意图：当 PermissionEngine 不可用时提供降级服务
    logger.info(
      "[IPC Registry] ✓ Organization Permission IPC skipped (already registered by Permission IPC)",
    );

    // ============================================================
    // 第五阶段模块 (项目管理 - 最大模块组，分为多个子模块)
    // ============================================================

    // 项目核心管理 (函数模式 - 大模块，34 handlers)
    // 🔥 始终注册，handlers 内部会处理 database 为 null 的情况
    safeRegister("Project Core IPC", {
      register: () => {
        const {
          registerProjectCoreIPC,
        } = require("../project/project-core-ipc");
        registerProjectCoreIPC({
          database: database || null,
          fileSyncManager,
          removeUndefinedValues,
          _replaceUndefinedWithNull,
        });
        if (!database) {
          logger.info(
            "[IPC Registry] ⚠️  Database not initialized (Project Core handlers registered with degraded functionality)",
          );
        }
      },
      handlers: 34,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 项目AI功能 (函数模式 - 中等模块，16 handlers)
    // 🔥 始终注册，handlers 内部会处理 llmManager/database 为 null 的情况
    safeRegister("Project AI IPC", {
      register: () => {
        const { registerProjectAIIPC } = require("../project/project-ai-ipc");
        registerProjectAIIPC({
          database: database || null,
          llmManager: llmManager || null,
          aiEngineManager: aiEngineManager || null,
          chatSkillBridge: chatSkillBridge || null,
          mainWindow: mainWindow || null,
          scanAndRegisterProjectFiles:
            app?.scanAndRegisterProjectFiles?.bind(app) || null,
          // 🔥 MCP 集成：传递 MCP 依赖用于项目AI会话工具调用
          mcpClientManager,
          mcpToolAdapter,
        });
        if (!database) {
          logger.info(
            "[IPC Registry] ⚠️  Database not initialized (Project AI handlers registered with degraded functionality)",
          );
        }
        if (!llmManager) {
          logger.info(
            "[IPC Registry] ⚠️  LLM manager not initialized (Project AI handlers registered with degraded functionality)",
          );
        }
      },
      handlers: 16,
      fatal: true,
    });

    // 项目导出分享 (函数模式 - 大模块，17 handlers)
    // 🔥 始终注册，handlers 内部会处理 database/llmManager 为 null 的情况
    safeRegister("Project Export/Share IPC", {
      register: () => {
        const {
          registerProjectExportIPC,
        } = require("../project/project-export-ipc");
        const { getDatabaseConnection, saveDatabase } = require("../database");
        const { getProjectConfig } = require("../project/project-config");
        const { copyDirectory } = require("../utils/file-utils");

        registerProjectExportIPC({
          database: database || null,
          llmManager: llmManager || null,
          mainWindow: mainWindow || null,
          getDatabaseConnection,
          saveDatabase,
          getProjectConfig,
          copyDirectory,
          convertSlidesToOutline: app.convertSlidesToOutline?.bind(app),
        });
      },
      handlers: 17,
      fatal: true,
    });

    // 项目RAG检索 (函数模式 - 中等模块，10 handlers)
    safeRegister("Project RAG IPC", {
      register: () => {
        const { registerProjectRAGIPC } = require("../project/project-rag-ipc");
        const { getProjectRAGManager } = require("../project/project-rag");
        const {
          getProjectConfig: getRagProjectConfig,
        } = require("../project/project-config");
        const RAGAPI = require("../project/rag-api");

        registerProjectRAGIPC({
          getProjectRAGManager,
          getProjectConfig: getRagProjectConfig,
          RAGAPI,
        });
      },
      handlers: 10,
      fatal: true,
    });

    // 项目Git集成 (函数模式 - 大模块，14 handlers)
    safeRegister("Project Git IPC", {
      register: () => {
        const { registerProjectGitIPC } = require("../project/project-git-ipc");
        const {
          getProjectConfig: getGitProjectConfig,
        } = require("../project/project-config");
        const GitAPI = require("../project/git-api");

        registerProjectGitIPC({
          getProjectConfig: getGitProjectConfig,
          GitAPI,
          gitManager,
          fileSyncManager,
          mainWindow,
        });
      },
      handlers: 14,
      fatal: true,
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 5 Complete: All 91 project: handlers migrated!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第六阶段模块 (核心功能 - File, Template, Knowledge, Prompt, Image)
    // ============================================================

    // 文件操作 (函数模式 - 中等模块，17 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering File IPC...");
      const { registerFileIPC } = require("../file/file-ipc");
      const { getProjectConfig } = require("../project/project-config");

      registerFileIPC({
        database,
        mainWindow,
        getProjectConfig,
      });
      logger.info("[IPC Registry] ✓ File IPC registered (17 handlers)");
    }

    // Office 文件操作 (类模式 - Office 文件处理)
    safeRegister("Office File IPC", {
      register: () => {
        const FileIPC = require("../ipc/file-ipc");
        const fileIPC = new FileIPC();
        fileIPC.registerHandlers(mainWindow);
      },
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 模板管理 (函数模式 - 大模块，20 handlers)
    safeRegister("Template IPC", {
      register: () => {
        const { registerTemplateIPC } = require("../template/template-ipc");
        registerTemplateIPC({
          templateManager: templateManager || null,
        });
        if (!templateManager) {
          logger.warn(
            "[IPC Registry] ⚠ templateManager not initialized, Template IPC running in degraded mode",
          );
        }
      },
      handlers: 20,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 知识管理 (函数模式 - 中等模块，17 handlers)
    if (dbManager || versionManager || knowledgePaymentManager) {
      logger.info("[IPC Registry] Registering Knowledge IPC...");
      const { registerKnowledgeIPC } = require("../knowledge/knowledge-ipc");

      registerKnowledgeIPC({
        dbManager,
        versionManager,
        knowledgePaymentManager,
      });
      logger.info("[IPC Registry] ✓ Knowledge IPC registered (17 handlers)");
    }

    // 提示词模板 (函数模式 - 小模块，11 handlers)
    if (promptTemplateManager) {
      logger.info("[IPC Registry] Registering Prompt Template IPC...");
      const {
        registerPromptTemplateIPC,
      } = require("../prompt-template/prompt-template-ipc");

      registerPromptTemplateIPC({
        promptTemplateManager,
      });
      logger.info(
        "[IPC Registry] ✓ Prompt Template IPC registered (11 handlers)",
      );
    }

    // 图像管理 (函数模式 - 大模块，22 handlers)
    if (imageUploader) {
      logger.info("[IPC Registry] Registering Image IPC...");
      const { registerImageIPC } = require("../image/image-ipc");

      registerImageIPC({
        imageUploader,
        llmManager,
        mainWindow,
      });
      logger.info("[IPC Registry] ✓ Image IPC registered (22 handlers)");
    }

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 6 Complete: 5 modules migrated (87 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第七阶段模块 (媒体处理 - Speech, Video, PDF, Document)
    // ============================================================

    // 语音处理 (函数模式 - 超大模块，34 handlers)
    // 注意：检查 initializeSpeechManager 是否存在
    if (
      app.initializeSpeechManager &&
      typeof app.initializeSpeechManager === "function"
    ) {
      safeRegister("Speech IPC", {
        register: () => {
          const { registerSpeechIPC } = require("../speech/speech-ipc");
          const initializeSpeechManager = app.initializeSpeechManager.bind(app);
          registerSpeechIPC({
            initializeSpeechManager,
          });
        },
        handlers: 34,
        fatal: true,
        continueMessage: "Continuing with other IPC registrations...",
      });
    } else {
      logger.info(
        "[IPC Registry] ⚠️  Speech IPC skipped (initializeSpeechManager not available)",
      );
    }

    // 视频处理 (函数模式 - 大模块，18 handlers)
    if (app.videoImporter) {
      logger.info("[IPC Registry] Registering Video IPC...");
      const { registerVideoIPC } = require("../video/video-ipc");

      registerVideoIPC({
        videoImporter: app.videoImporter,
        mainWindow,
        llmManager,
      });
      logger.info("[IPC Registry] ✓ Video IPC registered (18 handlers)");
    }

    // PDF 处理 (函数模式 - 小模块，4 handlers)
    logger.info("[IPC Registry] Registering PDF IPC...");
    const { registerPDFIPC } = require("../pdf/pdf-ipc");

    // 获取 getPDFEngine 函数
    const { getPDFEngine } = require("../engines/pdf-engine");

    registerPDFIPC({
      getPDFEngine,
    });
    logger.info("[IPC Registry] ✓ PDF IPC registered (4 handlers)");

    // 文档处理 (函数模式 - 小模块，1 handler)
    logger.info("[IPC Registry] Registering Document IPC...");
    const { registerDocumentIPC } = require("../document/document-ipc");

    registerDocumentIPC({
      convertSlidesToOutline: app.convertSlidesToOutline?.bind(app),
    });
    logger.info("[IPC Registry] ✓ Document IPC registered (1 handler)");

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 7 Complete: 4 modules migrated (57 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第八阶段模块 (新增模块 - 区块链、代码工具、知识图谱等)
    // ============================================================

    // 区块链核心 (7个模块, 75 handlers) - 懒加载模式
    // 注册懒加载的区块链 IPC 处理器，在首次访问时才初始化区块链模块
    logger.info("[IPC Registry] Registering Blockchain IPC (Lazy Loading)...");
    const {
      registerLazyBlockchainIPC,
    } = require("../blockchain/blockchain-lazy-ipc");
    registerLazyBlockchainIPC({ app, database, mainWindow });
    logger.info(
      "[IPC Registry] ✓ Blockchain IPC registered (75 handlers, lazy loading enabled)",
    );

    // 代码工具 (2个模块, 20 handlers)
    if (llmManager) {
      logger.info("[IPC Registry] Registering Code Tools IPC...");
      const { registerCodeIPC } = require("../code-tools/code-ipc");
      registerCodeIPC({ llmManager });
      logger.info("[IPC Registry] ✓ Code Tools IPC registered (10 handlers)");
    }

    if (reviewManager) {
      logger.info("[IPC Registry] Registering Review System IPC...");
      const { registerReviewIPC } = require("../code-tools/review-ipc");
      registerReviewIPC({ reviewManager });
      logger.info(
        "[IPC Registry] ✓ Review System IPC registered (10 handlers)",
      );
    }

    // 企业协作 (3个模块, 28 handlers)
    logger.info("[IPC Registry] Registering Collaboration IPC...");
    const {
      registerCollaborationIPC,
    } = require("../collaboration/collaboration-ipc");
    registerCollaborationIPC();
    logger.info("[IPC Registry] ✓ Collaboration IPC registered (8 handlers)");

    if (vcTemplateManager) {
      logger.info("[IPC Registry] Registering VC Template IPC...");
      const {
        registerVCTemplateIPC,
      } = require("../vc-template/vc-template-ipc");
      registerVCTemplateIPC(vcTemplateManager);
      logger.info("[IPC Registry] ✓ VC Template IPC registered (11 handlers)");
    }

    logger.info("[IPC Registry] Registering Automation IPC...");
    const { registerAutomationIPC } = require("../automation/automation-ipc");
    registerAutomationIPC();
    logger.info("[IPC Registry] ✓ Automation IPC registered (9 handlers)");

    // 知识图谱与信用 (2个模块, 18 handlers)
    if (database || app.graphExtractor) {
      logger.info("[IPC Registry] Registering Knowledge Graph IPC...");
      const { registerGraphIPC } = require("../knowledge-graph/graph-ipc");
      registerGraphIPC({
        database,
        graphExtractor: app.graphExtractor,
        llmManager,
      });
      logger.info(
        "[IPC Registry] ✓ Knowledge Graph IPC registered (11 handlers)",
      );
    }

    if (creditScoreManager) {
      logger.info("[IPC Registry] Registering Credit Score IPC...");
      const { registerCreditIPC } = require("../credit/credit-ipc");
      registerCreditIPC({ creditScoreManager });
      logger.info("[IPC Registry] ✓ Credit Score IPC registered (7 handlers)");
    }

    // 插件系统 - 懒加载模式
    logger.info("[IPC Registry] Registering Plugin IPC (Lazy Loading)...");
    const { registerLazyPluginIPC } = require("../plugins/plugin-lazy-ipc");
    registerLazyPluginIPC({ app, mainWindow });
    logger.info(
      "[IPC Registry] ✓ Plugin IPC registered (lazy loading enabled)",
    );

    // 其他功能 (3个模块, 13 handlers)
    if (fileImporter) {
      logger.info("[IPC Registry] Registering Import IPC...");
      const { registerImportIPC } = require("../import/import-ipc");
      registerImportIPC({
        fileImporter,
        mainWindow,
        database,
        ragManager,
      });
      logger.info("[IPC Registry] ✓ Import IPC registered (5 handlers)");
    }

    safeRegister("Sync IPC", {
      register: () => {
        if (!syncManager) {
          logger.warn(
            "[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers",
          );
        }
        const { registerSyncIPC } = require("../sync/sync-ipc");
        registerSyncIPC({ syncManager: syncManager || null });
      },
      handlers: 4,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // Notification IPC already registered early (line 305-311)

    // Preference Manager IPC
    safeRegister("Preference Manager IPC", {
      register: () => {
        const preferenceManager = app ? app.preferenceManager || null : null;
        if (preferenceManager) {
          const {
            registerPreferenceManagerIPC,
          } = require("../memory/preference-manager-ipc");
          registerPreferenceManagerIPC({ preferenceManager });
        } else {
          logger.warn(
            "[IPC Registry] ⚠️ preferenceManager 未初始化，跳过 Preference IPC 注册",
          );
        }
      },
      handlers: 12,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 对话管理 (函数模式 - 中等模块，17 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    // 🔥 v2.0: 整合高级特性（SessionManager, Manus, Multi-Agent, RAG等）
    safeRegister("Conversation IPC", {
      register: () => {
        const {
          registerConversationIPC,
        } = require("../conversation/conversation-ipc");
        registerConversationIPC({
          database: database || null,
          llmManager: llmManager || null,
          mainWindow: mainWindow || null,
          // 🔥 高级特性依赖
          sessionManager,
          agentOrchestrator,
          ragManager: ragManager || null,
          promptCompressor,
          responseCache,
          tokenTracker,
          errorMonitor,
        });
        if (!database) {
          logger.info(
            "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
          );
        }
        if (!llmManager) {
          logger.info(
            "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
          );
        }
        // 🔥 打印高级特性状态
        logger.info("[IPC Registry] Conversation advanced features:", {
          sessionManager: !!sessionManager,
          agentOrchestrator: !!agentOrchestrator,
          ragManager: !!ragManager,
          promptCompressor: !!promptCompressor,
          tokenTracker: !!tokenTracker,
        });
      },
      handlers: 17,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 文件同步监听 (函数模式 - 小模块，3 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering File Sync IPC...");
      if (!fileSyncManager) {
        logger.warn(
          "[IPC Registry] ⚠️ fileSyncManager 未初始化，将注册降级的 File Sync IPC handlers",
        );
      }
      const { registerFileSyncIPC } = require("../file-sync/file-sync-ipc");
      registerFileSyncIPC({
        fileSyncManager: fileSyncManager || null,
        database,
      });
      logger.info("[IPC Registry] ✓ File Sync IPC registered (3 handlers)");
    } else {
      logger.warn("[IPC Registry] ⚠️ 数据库未初始化，跳过 File Sync IPC 注册");
    }

    // 配置管理 (函数模式 - 小模块，4 handlers)
    logger.info("[IPC Registry] Registering Config IPC...");
    const { registerConfigIPC } = require("../config/config-ipc");
    const {
      getAppConfig: getConfigForIPC,
    } = require("../config/database-config");
    registerConfigIPC({ appConfig: getConfigForIPC() });
    logger.info("[IPC Registry] ✓ Config IPC registered (4 handlers)");

    // 分类管理 (函数模式 - 中等模块，7 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering Category IPC...");
      const {
        registerCategoryIPCHandlers,
      } = require("../organization/category-ipc");
      registerCategoryIPCHandlers(database, mainWindow);
      logger.info("[IPC Registry] ✓ Category IPC registered (7 handlers)");
    }

    // System IPC already registered early (line 299-303)

    // ============================================================
    // 第九阶段模块 (工作流系统)
    // ============================================================

    // 工作流管道 (函数模式 - 中等模块，14 handlers)
    safeRegister("Workflow IPC", {
      register: () => {
        const { registerWorkflowIPC } = require("../workflow/workflow-ipc");
        const { WorkflowManager } = require("../workflow/workflow-pipeline");
        const ProgressEmitter = require("../utils/progress-emitter");

        // 创建工作流管理器
        const progressEmitter = new ProgressEmitter({
          autoForwardToIPC: true,
          throttleInterval: 100,
        });

        if (mainWindow) {
          progressEmitter.setMainWindow(mainWindow);
        }

        const workflowManager = new WorkflowManager({
          progressEmitter,
          llmService: llmManager,
        });

        if (mainWindow) {
          workflowManager.setMainWindow(mainWindow);
        }

        // 保存到 app 实例以便后续使用
        if (app) {
          app.workflowManager = workflowManager;
          app.workflowProgressEmitter = progressEmitter;
        }

        const workflowIPC = registerWorkflowIPC({ workflowManager });
        if (workflowIPC) {
          registeredModules.workflowIPC = workflowIPC;
        }
      },
      handlers: 14,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 8 Complete: 20 modules migrated (176 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 9: Cowork 多代理协作系统
    // ============================================================

    safeRegister("Cowork IPC", {
      handlers: 44,
      subDetails: [
        "TeammateTool: 15 handlers",
        "FileSandbox: 11 handlers",
        "LongRunningTaskManager: 9 handlers",
        "SkillRegistry: 5 handlers",
        "Utilities: 4 handlers",
      ],
      fatal: true,
      continueMessage: "Continuing without Cowork functionality...",
      register: () => {
        const { registerCoworkIPC } = require("../ai-engine/cowork/cowork-ipc");
        registerCoworkIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 9 Complete: Cowork system ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 10: Workflow Optimizations
    // ============================================================

    safeRegister("Workflow Optimizations IPC", {
      handlers: 7,
      subDetails: [
        "Status & Statistics: 2 handlers",
        "Toggle & Configuration: 3 handlers",
        "Reports & Health: 2 handlers",
      ],
      fatal: true,
      continueMessage: "Continuing without Workflow Optimizations dashboard...",
      register: () => {
        const {
          registerWorkflowOptimizationsIPC,
        } = require("./workflow-optimizations-ipc");
        registerWorkflowOptimizationsIPC({
          database: database || null,
          aiEngineManager: aiEngineManager || null,
        });
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 10 Complete: Workflow Optimizations ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 11: Enterprise Audit & Compliance (v0.34.0)
    // ============================================================

    safeRegister("Enterprise Audit IPC", {
      handlers: 18,
      subDetails: [
        "Audit Logs: 4 handlers",
        "Compliance: 6 handlers",
        "Data Subject Requests: 6 handlers",
        "Retention: 2 handlers",
      ],
      register: () => {
        const { registerAuditIPC } = require("../audit/audit-ipc");
        registerAuditIPC({ database: database || null });
      },
    });

    // ============================================================
    // Phase 12: Plugin Marketplace (v0.34.0)
    // ============================================================

    safeRegister("Plugin Marketplace IPC", {
      handlers: 22,
      subDetails: [
        "Browse: 6 handlers",
        "Install: 6 handlers",
        "Installed: 3 handlers",
        "Rating: 3 handlers",
        "Publish: 3 handlers",
        "Config: 1 handler",
      ],
      register: () => {
        const {
          registerMarketplaceIPC,
        } = require("../marketplace/marketplace-ipc");
        registerMarketplaceIPC({ database: database || null });
      },
    });

    // ============================================================
    // Phase 13: Specialized Multi-Agent System (v0.34.0)
    // ============================================================

    safeRegister("Specialized Agents IPC", {
      handlers: 16,
      subDetails: [
        "Templates: 5 handlers",
        "Deploy: 4 handlers",
        "Tasks: 3 handlers",
        "Coordination: 2 handlers",
        "Analytics: 2 handlers",
      ],
      register: () => {
        const { registerAgentsIPC } = require("../ai-engine/agents/agents-ipc");
        registerAgentsIPC({ database: database || null });
      },
    });

    // ============================================================
    // Phase 14: SSO & Enterprise Authentication (v0.34.0)
    // ============================================================

    safeRegister("SSO IPC", {
      handlers: 20,
      subDetails: [
        "Config: 5 handlers",
        "Auth: 4 handlers",
        "Identity: 4 handlers",
        "Session: 3 handlers",
        "SAML: 2 handlers",
        "OIDC: 2 handlers",
      ],
      register: () => {
        const { registerSSOIPC } = require("../auth/sso-ipc");
        registerSSOIPC({ database: database || null });
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 14 Complete: All v0.34.0 features registered!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 15: Unified Tool Registry (v0.35.0)
    // ============================================================

    safeRegister("Unified Tool Registry IPC", {
      register: () => {
        const {
          UnifiedToolRegistry,
        } = require("../ai-engine/unified-tool-registry");
        const {
          registerUnifiedToolsIPC,
        } = require("../ai-engine/unified-tools-ipc");

        const unifiedToolRegistry = new UnifiedToolRegistry();

        // Bind available subsystems
        const functionCaller = aiEngineManager?.functionCaller || null;
        if (functionCaller) {
          unifiedToolRegistry.bindFunctionCaller(functionCaller);
        }
        if (mcpToolAdapter) {
          unifiedToolRegistry.bindMCPAdapter(mcpToolAdapter);
        }

        // Bind SkillRegistry (from skills-ipc singleton)
        try {
          const {
            getSkillRegistry,
          } = require("../ai-engine/cowork/skills/skill-registry");
          const skillRegistry = getSkillRegistry?.();
          if (skillRegistry) {
            unifiedToolRegistry.bindSkillRegistry(skillRegistry);
          }
        } catch (srError) {
          logger.warn(
            "[IPC Registry] ⚠️  SkillRegistry not available for UnifiedToolRegistry:",
            srError.message,
          );
        }

        // Initialize asynchronously (non-blocking), then bind to ManusOptimizations
        unifiedToolRegistry
          .initialize()
          .then(() => {
            // Wire into ManusOptimizations so AI conversations get skill context in prompts
            if (llmManager?.manusOptimizations?.bindUnifiedRegistry) {
              llmManager.manusOptimizations.bindUnifiedRegistry(
                unifiedToolRegistry,
              );
              logger.info(
                "[IPC Registry] ✓ UnifiedToolRegistry bound to ManusOptimizations",
              );
            }
          })
          .catch((initError) => {
            logger.warn(
              "[IPC Registry] ⚠️  UnifiedToolRegistry initialization error:",
              initError.message,
            );
          });

        // Save to app instance
        if (app) {
          app.unifiedToolRegistry = unifiedToolRegistry;
        }

        // Register IPC handlers
        registerUnifiedToolsIPC({ unifiedToolRegistry });
      },
      handlers: 8,
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 15 Complete: Unified Tool Registry ready!",
    );
    logger.info("[IPC Registry] ========================================");

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
        } = require("../ai-engine/cowork/skills/skill-pipeline-ipc");
        registerSkillPipelineIPC({ hookSystem });
      },
      handlers: 12,
    });

    // 🔥 Skill Metrics IPC (技能指标, 5 handlers)
    safeRegister("Skill Metrics IPC", {
      handlers: 5,
      register: () => {
        const {
          registerSkillMetricsIPC,
        } = require("../ai-engine/cowork/skills/skill-metrics-ipc");
        registerSkillMetricsIPC({});
      },
    });

    // 🔥 Skill Workflow IPC (工作流引擎, 10 handlers)
    safeRegister("Skill Workflow IPC", {
      handlers: 10,
      register: () => {
        const {
          registerSkillWorkflowIPC,
        } = require("../ai-engine/cowork/skills/skill-workflow-ipc");
        registerSkillWorkflowIPC({});
      },
    });

    // 🔥 Git Hook IPC (Git 钩子, 8 handlers)
    safeRegister("Git Hook IPC", {
      handlers: 8,
      register: () => {
        const { registerGitHookIPC } = require("../hooks/git-hook-ipc");
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
        const { registerInstinctIPC } = require("../llm/instinct-ipc");
        const { getInstinctManager } = require("../llm/instinct-manager");

        const instinctManager = getInstinctManager();
        const database = dependencies.database || null;
        const permanentMemoryManager =
          dependencies.permanentMemoryManager || null;
        const hookSystem = dependencies.hookSystem || null;

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
        } = require("../ai-engine/cowork/p2p-agent-network");
        const {
          getDeviceDiscovery,
        } = require("../ai-engine/cowork/device-discovery");
        const {
          getHybridExecutor,
        } = require("../ai-engine/cowork/hybrid-executor");
        const {
          getComputerUseBridge,
        } = require("../ai-engine/cowork/computer-use-bridge");
        const {
          getCoworkAPIServer,
        } = require("../ai-engine/cowork/cowork-api-server");
        const {
          getWebhookManager,
        } = require("../ai-engine/cowork/webhook-manager");
        const {
          registerCoworkV2IPC,
        } = require("../ai-engine/cowork/cowork-v2-ipc");

        const p2pNetwork = getP2PAgentNetwork();
        const deviceDiscovery = getDeviceDiscovery();
        const hybridExecutor = getHybridExecutor();
        const computerUseBridge = getComputerUseBridge();
        const coworkAPIServer = getCoworkAPIServer();
        const webhookManager = getWebhookManager();

        // Wire dependencies
        const database = dependencies.database || null;
        const skillRegistry = registeredModules.skillRegistry || null;
        const mobileBridge = dependencies.mobileBridge || null;
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
        } = require("../ai-engine/cowork/ml-task-scheduler");
        const {
          registerMLSchedulerIPC,
        } = require("../ai-engine/cowork/ml-task-scheduler-ipc");

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
        const { LoadBalancer } = require("../ai-engine/cowork/load-balancer");
        const {
          registerLoadBalancerIPC,
        } = require("../ai-engine/cowork/load-balancer-ipc");

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
        const { CICDOptimizer } = require("../ai-engine/cowork/cicd-optimizer");
        const {
          registerCICDOptimizerIPC,
        } = require("../ai-engine/cowork/cicd-optimizer-ipc");

        const cicdOptimizer = new CICDOptimizer(
          database || null,
          process.cwd(),
        );
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
        } = require("../ai-engine/cowork/ipc-api-doc-generator");
        const {
          registerApiDocsIPC,
        } = require("../ai-engine/cowork/ipc-api-doc-generator-ipc");

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
    // Phase 20: Self-Evolution & Knowledge Graph (v2.1.0)
    // ============================================================

    safeRegister("Self-Evolution & Knowledge Graph IPC", {
      register: () => {
        const {
          getCodeKnowledgeGraph,
        } = require("../ai-engine/cowork/code-knowledge-graph");
        const {
          getDecisionKnowledgeBase,
        } = require("../ai-engine/cowork/decision-knowledge-base");
        const {
          getPromptOptimizer,
        } = require("../ai-engine/cowork/prompt-optimizer");
        const {
          getSkillDiscoverer,
        } = require("../ai-engine/cowork/skill-discoverer");
        const {
          getDebateReview,
        } = require("../ai-engine/cowork/debate-review");
        const {
          getABComparator,
        } = require("../ai-engine/cowork/ab-comparator");
        const {
          registerEvolutionIPC,
        } = require("../ai-engine/cowork/evolution-ipc");

        const evoDb = database || null;
        const hookSystem = dependencies.hookSystem || null;
        const marketplaceClient = registeredModules.marketplaceClient || null;
        const teammateTool = registeredModules.teammateTool || null;
        const agentCoordinator = registeredModules.agentCoordinator || null;

        // Initialize managers
        const codeKnowledgeGraph = getCodeKnowledgeGraph();
        const decisionKnowledgeBase = getDecisionKnowledgeBase();
        const promptOptimizer = getPromptOptimizer();
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
      "[IPC Registry] Phase 20 Complete: Self-Evolution & Knowledge Graph ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 21: Enterprise Edition - Enterprise Org Management (v1.0)
    // ============================================================

    safeRegister("Enterprise Org IPC", {
      handlers: 10,
      register: () => {
        const {
          getEnterpriseOrgManager,
        } = require("../enterprise/enterprise-org-manager");
        const {
          registerEnterpriseIPC,
        } = require("../enterprise/enterprise-ipc");

        const enterpriseOrgManager = getEnterpriseOrgManager();
        enterpriseOrgManager.initialize({
          database: dependencies.database,
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
        const { getIPFSManager } = require("../ipfs/ipfs-manager");
        const { registerIPFSIPC } = require("../ipfs/ipfs-ipc");

        const ipfsManager = getIPFSManager();
        ipfsManager
          .initialize({ database: dependencies.database })
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
        } = require("../analytics/analytics-aggregator");
        const { registerAnalyticsIPC } = require("../analytics/analytics-ipc");

        const analyticsAggregator = getAnalyticsAggregator();
        analyticsAggregator
          .initialize({
            database: dependencies.database,
            tokenTracker: registeredModules.tokenTracker || null,
            skillMetrics: registeredModules.skillMetricsCollector || null,
            errorMonitor: registeredModules.errorMonitor || null,
            performanceMonitor: registeredModules.performanceMonitor || null,
            mainWindow: dependencies.mainWindow,
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
        } = require("../ai-engine/autonomous/autonomous-agent-runner");
        const {
          AgentTaskQueue,
        } = require("../ai-engine/autonomous/agent-task-queue");
        const {
          registerAutonomousIPC,
        } = require("../ai-engine/autonomous/autonomous-ipc");

        const agentTaskQueue = new AgentTaskQueue();
        agentTaskQueue
          .initialize(dependencies.database)
          .catch((e) =>
            logger.warn("[IPC Registry] AgentTaskQueue init error:", e.message),
          );

        const autonomousRunner = getAutonomousAgentRunner();
        autonomousRunner.initialize({
          database: dependencies.database,
          llmManager: registeredModules.llmManager || null,
          skillExecutor: registeredModules.skillExecutor || null,
          toolRegistry: registeredModules.unifiedToolRegistry || null,
          taskQueue: agentTaskQueue,
        });

        registerAutonomousIPC({
          autonomousRunner,
          agentTaskQueue,
          mainWindow: dependencies.mainWindow,
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
        } = require("../performance/unified-performance-collector");
        const { getAutoTuner } = require("../performance/auto-tuner");
        const {
          registerAutoTunerIPC,
        } = require("../performance/auto-tuner-ipc");

        const unifiedPerformanceCollector = getUnifiedPerformanceCollector();
        unifiedPerformanceCollector.initialize({
          performanceMonitor: registeredModules.performanceMonitor || null,
          mcpPerformanceMonitor:
            registeredModules.mcpPerformanceMonitor || null,
          filePerformanceMetrics:
            registeredModules.filePerformanceMetrics || null,
          tokenTracker: registeredModules.tokenTracker || null,
        });
        unifiedPerformanceCollector.start();

        const autoTuner = getAutoTuner();
        autoTuner.initialize({
          database: dependencies.database,
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
        } = require("../ai-engine/multimodal-ipc");
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
        } = require("../marketplace/skill-marketplace-ipc");
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
        } = require("../trade/trading-enhancement-ipc");
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
        const { registerDeFiIPC } = require("../defi/defi-ipc");
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
        const { registerCryptoIPC } = require("../crypto/crypto-ipc");
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

    // ============================================================
    // Phase 31: AI Models — 7 Advanced Features (v1.1.0)
    // Extracted to ./phases/phase-31-ai-models.js
    // ============================================================
    {
      const { registerPhase31 } = require("./phases/phase-31-ai-models");
      registerPhase31({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phase 33: Git P2P Sync (v1.0.0)
    // ============================================================

    safeRegister("Git P2P IPC", {
      handlers: 15,
      register: () => {
        const { registerGitP2PIPC } = require("../git/git-p2p-ipc");
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
        const { registerCollabIPC } = require("../collab/collab-ipc");
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
        } = require("../ai-engine/cowork/pipeline-orchestrator");
        const {
          getRequirementParser,
        } = require("../ai-engine/cowork/requirement-parser");
        const {
          registerPipelineIPC,
        } = require("../ai-engine/cowork/pipeline-ipc");

        const pipelineOrchestrator = getPipelineOrchestrator();
        const requirementParser = getRequirementParser();

        if (dependencies.database) {
          requirementParser
            .initialize(dependencies.database, {
              codeKnowledgeGraph: registeredModules.codeKnowledgeGraph || null,
            })
            .catch((err) =>
              logger.warn(
                "[IPC Registry] RequirementParser init warning:",
                err.message,
              ),
            );
          pipelineOrchestrator
            .initialize(dependencies.database, {
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
        } = require("../ai-engine/cowork/anomaly-detector");
        const {
          getIncidentClassifier,
        } = require("../ai-engine/cowork/incident-classifier");
        const {
          registerAutonomousOpsIPC,
        } = require("../ai-engine/cowork/autonomous-ops-ipc");
        const {
          getAutoRemediator,
        } = require("../ai-engine/cowork/auto-remediator");
        const {
          getRollbackManager,
        } = require("../ai-engine/cowork/rollback-manager");
        const {
          getAlertManager,
        } = require("../ai-engine/cowork/alert-manager");

        const anomalyDetector = getAnomalyDetector();
        const incidentClassifier = getIncidentClassifier();
        const autoRemediator = getAutoRemediator();
        const rollbackManager = getRollbackManager();
        const alertManager = getAlertManager();

        if (dependencies.database) {
          anomalyDetector
            .initialize(dependencies.database, {
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
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] IncidentClassifier init warning:",
                err.message,
              ),
            );
          rollbackManager
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] RollbackManager init warning:",
                err.message,
              ),
            );
          alertManager
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AlertManager init warning:",
                err.message,
              ),
            );
          autoRemediator
            .initialize(dependencies.database, {
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
        } = require("../ai-engine/cowork/spec-translator");
        const {
          registerNLProgrammingIPC,
        } = require("../ai-engine/cowork/nl-programming-ipc");

        const specTranslator = getSpecTranslator();

        if (dependencies.database) {
          specTranslator
            .initialize(dependencies.database, {
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
        } = require("../ai-engine/cowork/modality-fusion");
        const {
          getDocumentParser,
        } = require("../ai-engine/cowork/document-parser");
        const {
          getMultimodalContext,
        } = require("../ai-engine/cowork/multimodal-context");
        const {
          registerMultimodalCollabIPC,
        } = require("../ai-engine/cowork/multimodal-collab-ipc");

        const documentParser = getDocumentParser();
        const modalityFusion = getModalityFusion();
        const multimodalContext = getMultimodalContext();

        if (dependencies.database) {
          documentParser
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] DocumentParser init warning:",
                err.message,
              ),
            );
          modalityFusion
            .initialize(dependencies.database, { documentParser })
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
        const { getDeployAgent } = require("../ai-engine/cowork/deploy-agent");
        const {
          getPostDeployMonitor,
        } = require("../ai-engine/cowork/post-deploy-monitor");
        const deployAgent = getDeployAgent();
        const postDeployMonitor = getPostDeployMonitor();

        if (dependencies.database) {
          deployAgent
            .initialize(dependencies.database, {
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
        } = require("../ai-engine/cowork/project-style-analyzer");
        const projectStyleAnalyzer = getProjectStyleAnalyzer();

        if (dependencies.database) {
          projectStyleAnalyzer
            .initialize(dependencies.database, {
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
        } = require("../ai-engine/cowork/screen-recorder");
        const {
          getMultimodalOutput,
        } = require("../ai-engine/cowork/multimodal-output");
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
        } = require("../ai-engine/cowork/postmortem-generator");
        const postmortemGenerator = getPostmortemGenerator();

        if (dependencies.database) {
          postmortemGenerator
            .initialize(dependencies.database, {
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
        const { getAgentDID } = require("../ai-engine/cowork/agent-did");
        const {
          getFederatedAgentRegistry,
        } = require("../ai-engine/cowork/federated-agent-registry");
        const {
          getAgentCredentialManager,
        } = require("../ai-engine/cowork/agent-credential-manager");
        const {
          getCrossOrgTaskRouter,
        } = require("../ai-engine/cowork/cross-org-task-router");
        const {
          getAgentReputation,
        } = require("../ai-engine/cowork/agent-reputation");
        const {
          getAgentAuthenticator,
        } = require("../ai-engine/cowork/agent-authenticator");
        const {
          registerDecentralizedNetworkIPC,
        } = require("../ai-engine/cowork/decentralized-network-ipc");

        const agentDIDInstance = getAgentDID();
        const federatedRegistry = getFederatedAgentRegistry();
        const credentialManager = getAgentCredentialManager();
        const taskRouter = getCrossOrgTaskRouter();
        const reputationSystem = getAgentReputation();
        const authenticator = getAgentAuthenticator();

        if (dependencies.database) {
          agentDIDInstance
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn("[IPC Registry] AgentDID init warning:", err.message),
            );
          federatedRegistry
            .initialize(dependencies.database, { agentDID: agentDIDInstance })
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FederatedAgentRegistry init warning:",
                err.message,
              ),
            );
          credentialManager
            .initialize(dependencies.database, { agentDID: agentDIDInstance })
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AgentCredentialManager init warning:",
                err.message,
              ),
            );
          reputationSystem
            .initialize(dependencies.database)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AgentReputation init warning:",
                err.message,
              ),
            );
          taskRouter
            .initialize(dependencies.database, {
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
            .initialize(dependencies.database, {
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

    // ============================================================
    // Phase 41: EvoMap GEP Protocol Integration (v1.0.0)
    // ============================================================

    safeRegister("EvoMap GEP Protocol IPC", {
      register: () => {
        const { getEvoMapClient } = require("../evomap/evomap-client");
        const {
          getEvoMapNodeManager,
        } = require("../evomap/evomap-node-manager");
        const {
          getEvoMapGeneSynthesizer,
        } = require("../evomap/evomap-gene-synthesizer");
        const {
          getEvoMapAssetBridge,
        } = require("../evomap/evomap-asset-bridge");
        const { registerEvoMapIPC } = require("../evomap/evomap-ipc");

        const evoMapClient = getEvoMapClient();
        const evoMapNodeManager = getEvoMapNodeManager();
        const evoMapSynthesizer = getEvoMapGeneSynthesizer();
        const evoMapBridge = getEvoMapAssetBridge();

        const database = dependencies.database || null;
        const hookSystem = dependencies.hookSystem || null;
        const didManager = registeredModules.didManager || null;
        const instinctManager = registeredModules.instinctManager || null;
        const decisionKnowledgeBase =
          registeredModules.decisionKnowledgeBase || null;
        const promptOptimizer = registeredModules.promptOptimizer || null;
        const skillRegistry = registeredModules.skillRegistry || null;

        if (database) {
          evoMapNodeManager
            .initialize(database, didManager, hookSystem)
            .catch((err) =>
              logger.warn(
                "[IPC Registry] EvoMapNodeManager init warning:",
                err.message,
              ),
            );
          evoMapSynthesizer
            .initialize(
              database,
              instinctManager,
              decisionKnowledgeBase,
              promptOptimizer,
            )
            .catch((err) =>
              logger.warn(
                "[IPC Registry] EvoMapGeneSynthesizer init warning:",
                err.message,
              ),
            );
          evoMapBridge
            .initialize({
              database,
              client: evoMapClient,
              nodeManager: evoMapNodeManager,
              synthesizer: evoMapSynthesizer,
              skillRegistry,
              instinctManager,
              hookSystem,
            })
            .catch((err) =>
              logger.warn(
                "[IPC Registry] EvoMapAssetBridge init warning:",
                err.message,
              ),
            );
        }

        if (registeredModules.contextEngineering) {
          registeredModules.contextEngineering.setEvoMapBridge(evoMapBridge);
        }

        registerEvoMapIPC({
          nodeManager: evoMapNodeManager,
          client: evoMapClient,
          synthesizer: evoMapSynthesizer,
          bridge: evoMapBridge,
        });

        registeredModules.evoMapBridge = evoMapBridge;
        registeredModules.evoMapNodeManager = evoMapNodeManager;
        registeredModules.evoMapClient = evoMapClient;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 41 Complete: EvoMap GEP Protocol ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 42: Social AI + ActivityPub Bridge (v1.1.0)
    // ============================================================

    safeRegister("Social AI + ActivityPub IPC", {
      register: () => {
        const { TopicAnalyzer } = require("../social/topic-analyzer");
        const { SocialGraph } = require("../social/social-graph");
        const { AISocialAssistant } = require("../social/ai-social-assistant");
        const { ActivityPubBridge } = require("../social/activitypub-bridge");
        const { APContentSync } = require("../social/ap-content-sync");
        const { APWebFinger } = require("../social/ap-webfinger");

        const database = dependencies.database || null;
        const llmManager = registeredModules.llmManager || null;
        const didManager = registeredModules.didManager || null;

        const topicAnalyzer = new TopicAnalyzer(database, llmManager);
        const socialGraph = new SocialGraph(database);
        const aiSocialAssistant = new AISocialAssistant(llmManager);

        if (database) {
          topicAnalyzer
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] TopicAnalyzer init warning:",
                err.message,
              ),
            );
          socialGraph
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SocialGraph init warning:",
                err.message,
              ),
            );
          aiSocialAssistant
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AISocialAssistant init warning:",
                err.message,
              ),
            );
        }

        const activityPubBridge = new ActivityPubBridge(database, didManager);
        const apContentSync = new APContentSync(database, activityPubBridge);
        const apWebFinger = new APWebFinger(activityPubBridge);

        if (database) {
          activityPubBridge
            .initialize({ domain: "localhost" })
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ActivityPubBridge init warning:",
                err.message,
              ),
            );
          apContentSync
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] APContentSync init warning:",
                err.message,
              ),
            );
        }

        registeredModules.topicAnalyzer = topicAnalyzer;
        registeredModules.socialGraph = socialGraph;
        registeredModules.activityPubBridge = activityPubBridge;
        registeredModules.apContentSync = apContentSync;
        registeredModules.apWebFinger = apWebFinger;

        if (registeredModules.contextEngineering) {
          registeredModules.contextEngineering.setSocialGraph(socialGraph);
        }
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 42 Complete: Social AI + ActivityPub ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 43: Compliance + Data Classification (v1.1.0)
    // ============================================================

    safeRegister("Compliance + Classification IPC", {
      register: () => {
        const { SOC2Compliance } = require("../audit/soc2-compliance");
        const { DataClassifier } = require("../audit/data-classifier");
        const {
          ClassificationPolicy,
        } = require("../audit/classification-policy");
        const { registerComplianceIPC } = require("../audit/compliance-ipc");

        const database = dependencies.database || null;
        const auditLogger = registeredModules.auditLogger || null;
        const llmManager = registeredModules.llmManager || null;

        const soc2Compliance = new SOC2Compliance(database, auditLogger);
        const dataClassifier = new DataClassifier(database, llmManager);
        const classificationPolicy = new ClassificationPolicy(database);

        if (database) {
          soc2Compliance
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SOC2Compliance init warning:",
                err.message,
              ),
            );
          dataClassifier
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] DataClassifier init warning:",
                err.message,
              ),
            );
          classificationPolicy
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ClassificationPolicy init warning:",
                err.message,
              ),
            );
        }

        registerComplianceIPC({
          soc2Compliance,
          dataClassifier,
          classificationPolicy,
        });

        registeredModules.soc2Compliance = soc2Compliance;
        registeredModules.dataClassifier = dataClassifier;
        registeredModules.classificationPolicy = classificationPolicy;

        if (registeredModules.contextEngineering) {
          registeredModules.contextEngineering.setComplianceManager(
            soc2Compliance,
          );
        }
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 43 Complete: Compliance + Classification ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 44: SCIM 2.0 User Sync (v1.1.0)
    // ============================================================

    safeRegister("SCIM 2.0 IPC", {
      register: () => {
        const { SCIMServer } = require("../enterprise/scim-server");
        const { SCIMSync } = require("../enterprise/scim-sync");
        const { registerSCIMIPC } = require("../enterprise/scim-ipc");

        const database = dependencies.database || null;

        const scimServer = new SCIMServer(database);
        const scimSync = new SCIMSync(database, scimServer);

        if (database) {
          scimServer
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SCIMServer init warning:",
                err.message,
              ),
            );
          scimSync
            .initialize()
            .catch((err) =>
              logger.warn("[IPC Registry] SCIMSync init warning:", err.message),
            );
        }

        registerSCIMIPC({ scimServer, scimSync });

        registeredModules.scimServer = scimServer;
        registeredModules.scimSync = scimSync;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 44 Complete: SCIM 2.0 ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 45: Unified Key + FIDO2 + USB Transport (v1.1.0)
    // ============================================================

    safeRegister("Unified Key + FIDO2 modules", {
      register: () => {
        const { UnifiedKeyManager } = require("../ukey/unified-key-manager");
        const { FIDO2Authenticator } = require("../ukey/fido2-authenticator");

        const database = dependencies.database || null;

        const unifiedKeyManager = new UnifiedKeyManager(database);
        const fido2Authenticator = new FIDO2Authenticator(database);

        if (database) {
          unifiedKeyManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] UnifiedKeyManager init warning:",
                err.message,
              ),
            );
          fido2Authenticator
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FIDO2Authenticator init warning:",
                err.message,
              ),
            );
        }

        registeredModules.unifiedKeyManager = unifiedKeyManager;
        registeredModules.fido2Authenticator = fido2Authenticator;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 45 Complete: Unified Key + FIDO2 ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 46: Threshold Signatures + Biometric Binding (v1.1.0)
    // ============================================================

    safeRegister("Threshold Signature + Biometric", {
      register: () => {
        const {
          ThresholdSignatureManager,
        } = require("../ukey/threshold-signature-manager");
        const { BiometricBinding } = require("../ukey/biometric-binding");

        const database = dependencies.database || null;

        const thresholdManager = new ThresholdSignatureManager(database);
        const biometricBinding = new BiometricBinding(database);

        if (database) {
          thresholdManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ThresholdSignatureManager init warning:",
                err.message,
              ),
            );
          biometricBinding
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] BiometricBinding init warning:",
                err.message,
              ),
            );
        }

        registeredModules.thresholdManager = thresholdManager;
        registeredModules.biometricBinding = biometricBinding;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 46 Complete: Threshold Signatures ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 47: BLE U-Key (v1.1.0)
    // ============================================================

    safeRegister("BLE U-Key driver", {
      register: () => {
        const { getBLEDriver } = require("../ukey/ble-driver");
        const bleDriver = getBLEDriver();
        registeredModules.bleDriver = bleDriver;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 47 Complete: BLE U-Key ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 48: Smart Content Recommendation (v1.1.0)
    // ============================================================

    safeRegister("Recommendation modules", {
      register: () => {
        const { LocalRecommender } = require("../social/local-recommender");
        const { InterestProfiler } = require("../social/interest-profiler");
        const {
          registerRecommendationIPC,
        } = require("../social/recommendation-ipc");

        const database = dependencies.database || null;

        const localRecommender = new LocalRecommender(database);
        const interestProfiler = new InterestProfiler(database);

        if (database) {
          localRecommender
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] LocalRecommender init warning:",
                err.message,
              ),
            );
          interestProfiler
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] InterestProfiler init warning:",
                err.message,
              ),
            );
        }

        localRecommender.setInterestProfiler(interestProfiler);

        registerRecommendationIPC({ localRecommender, interestProfiler });

        registeredModules.localRecommender = localRecommender;
        registeredModules.interestProfiler = interestProfiler;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 48 Complete: Content Recommendation ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 49: Nostr Bridge (v1.1.0)
    // ============================================================

    safeRegister("Nostr Bridge modules", {
      register: () => {
        const { NostrBridge } = require("../social/nostr-bridge");
        const { NostrIdentity } = require("../social/nostr-identity");
        const {
          registerNostrBridgeIPC,
        } = require("../social/nostr-bridge-ipc");

        const database = dependencies.database || null;

        const nostrBridge = new NostrBridge(database);
        const nostrIdentity = new NostrIdentity(database);

        if (database) {
          nostrBridge
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] NostrBridge init warning:",
                err.message,
              ),
            );
          nostrIdentity
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] NostrIdentity init warning:",
                err.message,
              ),
            );
        }

        registerNostrBridgeIPC({ nostrBridge, nostrIdentity });

        registeredModules.nostrBridge = nostrBridge;
        registeredModules.nostrIdentity = nostrIdentity;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 49 Complete: Nostr Bridge ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 50: DLP Data Loss Prevention (v1.1.0)
    // ============================================================

    safeRegister("DLP modules", {
      register: () => {
        const { DLPEngine } = require("../audit/dlp-engine");
        const { DLPPolicyManager } = require("../audit/dlp-policy");
        const { registerDLPIPC } = require("../audit/dlp-ipc");

        const database = dependencies.database || null;

        const dlpEngine = new DLPEngine(database);
        const dlpPolicyManager = new DLPPolicyManager(database);

        if (database) {
          dlpEngine
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] DLPEngine init warning:",
                err.message,
              ),
            );
          dlpPolicyManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] DLPPolicyManager init warning:",
                err.message,
              ),
            );
        }

        dlpEngine.setPolicyManager(dlpPolicyManager);

        registerDLPIPC({ dlpEngine, dlpPolicyManager });

        registeredModules.dlpEngine = dlpEngine;
        registeredModules.dlpPolicyManager = dlpPolicyManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 50 Complete: DLP ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 51: SIEM Integration (v1.1.0)
    // ============================================================

    safeRegister("SIEM module", {
      register: () => {
        const { SIEMExporter } = require("../audit/siem-exporter");
        const { registerSIEMIPC } = require("../audit/siem-ipc");

        const database = dependencies.database || null;

        const siemExporter = new SIEMExporter(database);

        if (database) {
          siemExporter
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SIEMExporter init warning:",
                err.message,
              ),
            );
        }

        registerSIEMIPC({ siemExporter });

        registeredModules.siemExporter = siemExporter;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 51 Complete: SIEM Integration ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 52: PQC Migration (v1.1.0)
    // ============================================================

    safeRegister("PQC Migration module", {
      register: () => {
        const {
          PQCMigrationManager,
        } = require("../ukey/pqc-migration-manager");
        const { registerPQCIPC } = require("../ukey/pqc-ipc");

        const database = dependencies.database || null;

        const pqcManager = new PQCMigrationManager(database);

        if (database) {
          pqcManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] PQCMigrationManager init warning:",
                err.message,
              ),
            );
        }

        registerPQCIPC({ pqcManager });

        registeredModules.pqcManager = pqcManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 52 Complete: PQC Migration ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 53: Firmware OTA (v1.1.0)
    // ============================================================

    safeRegister("Firmware OTA module", {
      register: () => {
        const { FirmwareOTAManager } = require("../ukey/firmware-ota-manager");
        const { registerFirmwareOTAIPC } = require("../ukey/firmware-ota-ipc");

        const database = dependencies.database || null;

        const firmwareManager = new FirmwareOTAManager(database);

        if (database) {
          firmwareManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FirmwareOTAManager init warning:",
                err.message,
              ),
            );
        }

        registerFirmwareOTAIPC({ firmwareManager });

        registeredModules.firmwareManager = firmwareManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 53 Complete: Firmware OTA ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 54: AI Community Governance (v1.1.0)
    // ============================================================

    safeRegister("Governance AI module", {
      register: () => {
        const { GovernanceAI } = require("../social/governance-ai");
        const { registerGovernanceIPC } = require("../social/governance-ipc");

        const database = dependencies.database || null;

        const governanceAI = new GovernanceAI(database);

        if (database) {
          governanceAI
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] GovernanceAI init warning:",
                err.message,
              ),
            );
        }

        registerGovernanceIPC({ governanceAI });

        registeredModules.governanceAI = governanceAI;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 54 Complete: AI Governance ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 55: Matrix Integration (v1.1.0)
    // ============================================================

    safeRegister("Matrix Bridge module", {
      register: () => {
        const { MatrixBridge } = require("../social/matrix-bridge");
        const { registerMatrixIPC } = require("../social/matrix-ipc");

        const database = dependencies.database || null;

        const matrixBridge = new MatrixBridge(database);

        if (database) {
          matrixBridge
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] MatrixBridge init warning:",
                err.message,
              ),
            );
        }

        registerMatrixIPC({ matrixBridge });

        registeredModules.matrixBridge = matrixBridge;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 55 Complete: Matrix Integration ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 56: Terraform Provider (v1.1.0)
    // ============================================================

    safeRegister("Terraform module", {
      register: () => {
        const { TerraformManager } = require("../enterprise/terraform-manager");
        const { registerTerraformIPC } = require("../enterprise/terraform-ipc");

        const database = dependencies.database || null;

        const terraformManager = new TerraformManager(database);

        if (database) {
          terraformManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] TerraformManager init warning:",
                err.message,
              ),
            );
        }

        registerTerraformIPC({ terraformManager });

        registeredModules.terraformManager = terraformManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 56 Complete: Terraform Provider ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 57: Production Hardening (v1.1.0)
    // ============================================================

    safeRegister("Production Hardening", {
      register: () => {
        const {
          PerformanceBaseline,
        } = require("../performance/performance-baseline");
        const { SecurityAuditor } = require("../audit/security-auditor");
        const {
          registerHardeningIPC,
        } = require("../performance/hardening-ipc");

        const database = dependencies.database || null;

        const performanceBaseline = new PerformanceBaseline(database);
        const securityAuditor = new SecurityAuditor(database);

        if (database) {
          performanceBaseline
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] PerformanceBaseline init warning:",
                err.message,
              ),
            );
          securityAuditor
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SecurityAuditor init warning:",
                err.message,
              ),
            );
        }

        registerHardeningIPC({ performanceBaseline, securityAuditor });

        registeredModules.performanceBaseline = performanceBaseline;
        registeredModules.securityAuditor = securityAuditor;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 57 Complete: Production Hardening ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 58: Federation Hardening (v1.1.0)
    // ============================================================

    safeRegister("Federation Hardening", {
      register: () => {
        const {
          FederationHardening,
        } = require("../ai-engine/cowork/federation-hardening");
        const {
          registerFederationHardeningIPC,
        } = require("../ai-engine/cowork/federation-hardening-ipc");

        const database = dependencies.database || null;

        const federationHardening = new FederationHardening(database);

        if (database) {
          federationHardening
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FederationHardening init warning:",
                err.message,
              ),
            );
        }

        registerFederationHardeningIPC({ federationHardening });

        registeredModules.federationHardening = federationHardening;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 58 Complete: Federation Hardening ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 59: Federation Stress Test (v2.0.0)
    // ============================================================

    safeRegister("Federation Stress Test", {
      register: () => {
        const {
          FederationStressTester,
        } = require("../ai-engine/cowork/federation-stress-tester");
        const {
          registerStressTestIPC,
        } = require("../ai-engine/cowork/stress-test-ipc");

        const database = dependencies.database || null;

        const stressTester = new FederationStressTester(database);

        if (database) {
          stressTester
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FederationStressTester init warning:",
                err.message,
              ),
            );
        }

        registerStressTestIPC({ stressTester });

        registeredModules.stressTester = stressTester;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 59 Complete: Federation Stress Test ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 60: Reputation Optimizer (v2.0.0)
    // ============================================================

    safeRegister("Reputation Optimizer", {
      register: () => {
        const {
          ReputationOptimizer,
        } = require("../ai-engine/cowork/reputation-optimizer");
        const {
          registerReputationOptimizerIPC,
        } = require("../ai-engine/cowork/reputation-optimizer-ipc");

        const database = dependencies.database || null;

        const reputationOptimizer = new ReputationOptimizer(database);

        if (database) {
          reputationOptimizer
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ReputationOptimizer init warning:",
                err.message,
              ),
            );
        }

        registerReputationOptimizerIPC({ reputationOptimizer });

        registeredModules.reputationOptimizer = reputationOptimizer;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 60 Complete: Reputation Optimizer ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 61: Cross-Org SLA (v2.0.0)
    // ============================================================

    safeRegister("Cross-Org SLA", {
      register: () => {
        const { SLAManager } = require("../ai-engine/cowork/sla-manager");
        const { registerSLAIPC } = require("../ai-engine/cowork/sla-ipc");

        const database = dependencies.database || null;

        const slaManager = new SLAManager(database);

        if (database) {
          slaManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SLAManager init warning:",
                err.message,
              ),
            );
        }

        registerSLAIPC({ slaManager });

        registeredModules.slaManager = slaManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 61 Complete: Cross-Org SLA ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 62: Tech Learning Engine (v3.0.0)
    // ============================================================

    safeRegister("Tech Learning Engine", {
      register: () => {
        const {
          TechLearningEngine,
        } = require("../ai-engine/autonomous/tech-learning-engine");
        const {
          registerTechLearningIPC,
        } = require("../ai-engine/autonomous/tech-learning-ipc");

        const database = dependencies.database || null;

        const techLearningEngine = new TechLearningEngine(database);

        if (database) {
          techLearningEngine
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] TechLearningEngine init warning:",
                err.message,
              ),
            );
        }

        registerTechLearningIPC({ techLearningEngine });

        registeredModules.techLearningEngine = techLearningEngine;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 62 Complete: Tech Learning Engine ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 63: Autonomous Developer (v3.0.0)
    // ============================================================

    safeRegister("Autonomous Developer", {
      register: () => {
        const {
          AutonomousDeveloper,
        } = require("../ai-engine/autonomous/autonomous-developer");
        const {
          registerAutonomousDevIPC,
        } = require("../ai-engine/autonomous/autonomous-developer-ipc");

        const database = dependencies.database || null;

        const autonomousDeveloper = new AutonomousDeveloper(database);

        if (database) {
          autonomousDeveloper
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AutonomousDeveloper init warning:",
                err.message,
              ),
            );
        }

        registerAutonomousDevIPC({ autonomousDeveloper });

        registeredModules.autonomousDeveloper = autonomousDeveloper;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 63 Complete: Autonomous Developer ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 64: Collaboration Governance (v3.0.0)
    // ============================================================

    safeRegister("Collaboration Governance", {
      register: () => {
        const {
          CollaborationGovernance,
        } = require("../ai-engine/autonomous/collaboration-governance");
        const {
          registerCollaborationGovernanceIPC,
        } = require("../ai-engine/autonomous/collaboration-governance-ipc");

        const database = dependencies.database || null;

        const collaborationGovernance = new CollaborationGovernance(database);

        if (database) {
          collaborationGovernance
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] CollaborationGovernance init warning:",
                err.message,
              ),
            );
        }

        registerCollaborationGovernanceIPC({ collaborationGovernance });

        registeredModules.collaborationGovernance = collaborationGovernance;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 64 Complete: Collaboration Governance ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 65: Skill-as-a-Service (v3.1.0)
    // ============================================================

    safeRegister("Skill-as-a-Service", {
      register: () => {
        const {
          SkillServiceProtocol,
        } = require("../marketplace/skill-service-protocol");
        const {
          registerSkillServiceIPC,
        } = require("../marketplace/skill-service-ipc");

        const database = dependencies.database || null;

        const skillServiceProtocol = new SkillServiceProtocol(database);

        if (database) {
          skillServiceProtocol
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SkillServiceProtocol init warning:",
                err.message,
              ),
            );
        }

        registerSkillServiceIPC({ skillServiceProtocol });

        registeredModules.skillServiceProtocol = skillServiceProtocol;
      },
    });

    // ============================================================
    // Phase 66: Token Incentive (v3.1.0)
    // ============================================================

    safeRegister("Token Incentive", {
      register: () => {
        const { TokenLedger } = require("../marketplace/token-ledger");
        const { registerTokenIPC } = require("../marketplace/token-ipc");

        const database = dependencies.database || null;

        const tokenLedger = new TokenLedger(database);

        if (database) {
          tokenLedger
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] TokenLedger init warning:",
                err.message,
              ),
            );
        }

        registerTokenIPC({ tokenLedger });

        registeredModules.tokenLedger = tokenLedger;
      },
    });

    // ============================================================
    // Phase 67: Decentralized Inference Network (v3.1.0)
    // ============================================================

    safeRegister("Inference Network", {
      register: () => {
        const {
          InferenceNodeRegistry,
        } = require("../ai-engine/inference/inference-node-registry");
        const {
          InferenceScheduler,
        } = require("../ai-engine/inference/inference-scheduler");
        const {
          registerInferenceIPC,
        } = require("../ai-engine/inference/inference-ipc");

        const database = dependencies.database || null;

        const inferenceNodeRegistry = new InferenceNodeRegistry(database);
        const inferenceScheduler = new InferenceScheduler(database);
        inferenceScheduler.setNodeRegistry(inferenceNodeRegistry);

        if (database) {
          inferenceNodeRegistry
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] InferenceNodeRegistry init warning:",
                err.message,
              ),
            );
          inferenceScheduler
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] InferenceScheduler init warning:",
                err.message,
              ),
            );
        }

        registerInferenceIPC({ inferenceNodeRegistry, inferenceScheduler });

        registeredModules.inferenceNodeRegistry = inferenceNodeRegistry;
        registeredModules.inferenceScheduler = inferenceScheduler;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] v3.1.0 Complete: Decentralized AI Market ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 68: Trinity Trust Root (v3.2.0)
    // ============================================================

    safeRegister("Trinity Trust Root", {
      register: () => {
        const { TrustRootManager } = require("../ukey/trust-root-manager");
        const { registerTrustRootIPC } = require("../ukey/trust-root-ipc");

        const database = dependencies.database || null;

        const trustRootManager = new TrustRootManager(database);

        if (database) {
          trustRootManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] TrustRootManager init warning:",
                err.message,
              ),
            );
        }

        registerTrustRootIPC({ trustRootManager });

        registeredModules.trustRootManager = trustRootManager;
      },
    });

    // ============================================================
    // Phase 69: PQC Full Migration (v3.2.0)
    // ============================================================

    safeRegister("PQC Ecosystem", {
      register: () => {
        const {
          PQCEcosystemManager,
        } = require("../ukey/pqc-ecosystem-manager");
        const {
          registerPQCEcosystemIPC,
        } = require("../ukey/pqc-ecosystem-ipc");

        const database = dependencies.database || null;

        const pqcEcosystemManager = new PQCEcosystemManager(database);

        if (database) {
          pqcEcosystemManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] PQCEcosystemManager init warning:",
                err.message,
              ),
            );
        }

        registerPQCEcosystemIPC({ pqcEcosystemManager });

        registeredModules.pqcEcosystemManager = pqcEcosystemManager;
      },
    });

    // ============================================================
    // Phase 70: Satellite Communication (v3.2.0)
    // ============================================================

    safeRegister("Satellite Communication", {
      register: () => {
        const { SatelliteComm } = require("../security/satellite-comm");
        const { registerSatelliteIPC } = require("../security/satellite-ipc");

        const database = dependencies.database || null;

        const satelliteComm = new SatelliteComm(database);

        if (database) {
          satelliteComm
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] SatelliteComm init warning:",
                err.message,
              ),
            );
        }

        registerSatelliteIPC({ satelliteComm });

        registeredModules.satelliteComm = satelliteComm;
      },
    });

    // ============================================================
    // Phase 71: Open Hardware Standard (v3.2.0)
    // ============================================================

    safeRegister("HSM Adapter", {
      register: () => {
        const { HsmAdapterManager } = require("../ukey/hsm-adapter-manager");
        const { registerHsmAdapterIPC } = require("../ukey/hsm-adapter-ipc");

        const database = dependencies.database || null;

        const hsmAdapterManager = new HsmAdapterManager(database);

        if (database) {
          hsmAdapterManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] HsmAdapterManager init warning:",
                err.message,
              ),
            );
        }

        registerHsmAdapterIPC({ hsmAdapterManager });

        registeredModules.hsmAdapterManager = hsmAdapterManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] v3.2.0 Complete: Hardware Security Ecosystem ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 72: Protocol Fusion Bridge (v3.3.0)
    // ============================================================

    safeRegister("Protocol Fusion", {
      register: () => {
        const {
          ProtocolFusionBridge,
        } = require("../social/protocol-fusion-bridge");
        const {
          registerProtocolFusionIPC,
        } = require("../social/protocol-fusion-ipc");

        const database = dependencies.database || null;

        const protocolFusionBridge = new ProtocolFusionBridge(database);

        if (database) {
          protocolFusionBridge
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ProtocolFusionBridge init warning:",
                err.message,
              ),
            );
        }

        registerProtocolFusionIPC({ protocolFusionBridge });

        registeredModules.protocolFusionBridge = protocolFusionBridge;
      },
    });

    // ============================================================
    // Phase 73: AI Social Enhancement (v3.3.0)
    // ============================================================

    safeRegister("AI Social Enhancement", {
      register: () => {
        const { RealtimeTranslator } = require("../social/realtime-translator");
        const {
          ContentQualityAssessor,
        } = require("../social/content-quality-assessor");
        const { registerAISocialIPC } = require("../social/ai-social-ipc");

        const database = dependencies.database || null;

        const realtimeTranslator = new RealtimeTranslator(database);
        const contentQualityAssessor = new ContentQualityAssessor(database);

        if (database) {
          realtimeTranslator
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] RealtimeTranslator init warning:",
                err.message,
              ),
            );
          contentQualityAssessor
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ContentQualityAssessor init warning:",
                err.message,
              ),
            );
        }

        registerAISocialIPC({ realtimeTranslator, contentQualityAssessor });

        registeredModules.realtimeTranslator = realtimeTranslator;
        registeredModules.contentQualityAssessor = contentQualityAssessor;
      },
    });

    // ============================================================
    // Phase 74: Decentralized Content Storage (v3.3.0)
    // ============================================================

    safeRegister("Decentralized Storage", {
      register: () => {
        const { FilecoinStorage } = require("../ipfs/filecoin-storage");
        const { ContentDistributor } = require("../ipfs/content-distributor");
        const {
          registerDecentralizedStorageIPC,
        } = require("../ipfs/decentralized-storage-ipc");

        const database = dependencies.database || null;

        const filecoinStorage = new FilecoinStorage(database);
        const contentDistributor = new ContentDistributor(database);

        if (database) {
          filecoinStorage
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] FilecoinStorage init warning:",
                err.message,
              ),
            );
          contentDistributor
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] ContentDistributor init warning:",
                err.message,
              ),
            );
        }

        registerDecentralizedStorageIPC({
          filecoinStorage,
          contentDistributor,
        });

        registeredModules.filecoinStorage = filecoinStorage;
        registeredModules.contentDistributor = contentDistributor;
      },
    });

    // ============================================================
    // Phase 75: Anti-Censorship Communication (v3.3.0)
    // ============================================================

    safeRegister("Anti-Censorship", {
      register: () => {
        const {
          AntiCensorshipManager,
        } = require("../security/anti-censorship-manager");
        const {
          registerAntiCensorshipIPC,
        } = require("../security/anti-censorship-ipc");

        const database = dependencies.database || null;

        const antiCensorshipManager = new AntiCensorshipManager(database);

        if (database) {
          antiCensorshipManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] AntiCensorshipManager init warning:",
                err.message,
              ),
            );
        }

        registerAntiCensorshipIPC({ antiCensorshipManager });

        registeredModules.antiCensorshipManager = antiCensorshipManager;
      },
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] v3.3.0 Complete: Global Decentralized Social ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 76: Global Evolution Network (v3.4.0)
    // ============================================================

    safeRegister("EvoMap Federation", {
      register: () => {
        const { EvoMapFederation } = require("../evomap/evomap-federation");
        const {
          registerEvoMapFederationIPC,
        } = require("../evomap/evomap-federation-ipc");

        const database = dependencies.database || null;
        const evoMapFederation = new EvoMapFederation(database);

        if (database) {
          evoMapFederation
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] EvoMapFederation init warning:",
                err.message,
              ),
            );
        }

        registerEvoMapFederationIPC({ evoMapFederation });
        registeredModules.evoMapFederation = evoMapFederation;
      },
      handlers: 5,
    });

    // ============================================================
    // Phase 77: IP & Governance DAO (v3.4.0)
    // ============================================================

    safeRegister("EvoMap Governance", {
      register: () => {
        const { GeneIPManager } = require("../evomap/gene-ip-manager");
        const { EvoMapDAO } = require("../evomap/evomap-dao");
        const {
          registerEvoMapGovernanceIPC,
        } = require("../evomap/evomap-governance-ipc");

        const database = dependencies.database || null;
        const geneIPManager = new GeneIPManager(database);
        const evoMapDAO = new EvoMapDAO(database);

        if (database) {
          geneIPManager
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] GeneIPManager init warning:",
                err.message,
              ),
            );
          evoMapDAO
            .initialize()
            .catch((err) =>
              logger.warn(
                "[IPC Registry] EvoMapDAO init warning:",
                err.message,
              ),
            );
        }

        registerEvoMapGovernanceIPC({ geneIPManager, evoMapDAO });
        registeredModules.geneIPManager = geneIPManager;
        registeredModules.evoMapDAO = evoMapDAO;
      },
      handlers: 5,
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] v3.4.0 Complete: EvoMap Global Evolution Network ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 4 (2027 Q1): WebAuthn, ZKP, Federated Learning, IPFS Cluster, GraphQL API
    // ============================================================

    // 🔐 WebAuthn / Passkey Manager (10 handlers)
    safeRegister("WebAuthn IPC", {
      register: () => {
        const {
          registerWebAuthnIPC,
        } = require("../ai-engine/cowork/webauthn-ipc");
        registerWebAuthnIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
      handlers: 10,
    });

    // 🔒 Zero-Knowledge Proof (14 handlers)
    safeRegister("ZKP IPC", {
      register: () => {
        const { registerZKPIPC } = require("../ai-engine/cowork/zkp-ipc");
        registerZKPIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
      handlers: 14,
    });

    // 🧠 Federated Learning (14 handlers)
    safeRegister("Federated Learning IPC", {
      register: () => {
        const {
          registerFederatedLearningIPC,
        } = require("../ai-engine/cowork/federated-learning-ipc");
        registerFederatedLearningIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
      handlers: 14,
    });

    // 📦 IPFS Cluster (12 handlers)
    safeRegister("IPFS Cluster IPC", {
      register: () => {
        const {
          registerIPFSClusterIPC,
        } = require("../ai-engine/cowork/ipfs-cluster-ipc");
        registerIPFSClusterIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
      handlers: 12,
    });

    // 🔗 GraphQL API (8 handlers)
    safeRegister("GraphQL API IPC", {
      register: () => {
        const {
          registerGraphQLIPC,
        } = require("../ai-engine/cowork/graphql-ipc");
        registerGraphQLIPC({
          database: database || null,
          mainWindow: mainWindow || null,
        });
      },
      handlers: 8,
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] 2027 Q1 Complete: WebAuthn + ZKP + FL + IPFS Cluster + GraphQL (58 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 注册统计
    // ============================================================

    const endTime = Date.now();
    const duration = endTime - startTime;

    // 标记IPC Registry为已注册
    ipcGuard.markModuleRegistered("ipc-registry");

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Registration complete!");
    logger.info(
      `[IPC Registry] Registered modules: ${Object.keys(registeredModules).length}`,
    );
    logger.info(`[IPC Registry] Duration: ${duration}ms`);
    logger.info("[IPC Registry] ========================================");

    // 打印IPC Guard统计信息
    ipcGuard.printStats();

    return registeredModules;
  } catch (error) {
    logger.error("[IPC Registry] ❌ Registration failed:", error);
    throw error;
  }
}

/**
 * 注销所有 IPC 处理器（用于测试和热重载）
 * @param {Object} ipcMain - Electron ipcMain 实例 (not used in this implementation)
 */
function unregisterAllIPC() {
  logger.info("[IPC Registry] Unregistering all IPC handlers...");
  // 使用IPC Guard的resetAll功能
  ipcGuard.resetAll();
  logger.info("[IPC Registry] ✓ All IPC handlers unregistered");
}

export {
  registerAllIPC,
  unregisterAllIPC,
  ipcGuard, // 导出IPC Guard供外部使用
};
