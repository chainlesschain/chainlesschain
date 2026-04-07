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
    // Phases 9-15: Cowork/Workflow/Audit/Marketplace/Agents/SSO/UnifiedTools
    // Extracted to ./phases/phase-9-15-core.js
    // ============================================================
    {
      const { registerPhases9to15 } = require("./phases/phase-9-15-core");
      registerPhases9to15({
        safeRegister,
        logger,
        deps: {
          ...dependencies,
          app,
          mainWindow,
          aiEngineManager,
          llmManager,
          mcpToolAdapter,
        },
        registeredModules,
      });
    }

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
    // Phases 21-30: Enterprise Edition + Multimodal/Skill/Trading/DeFi/Crypto
    // Extracted to ./phases/phase-21-30-enterprise.js
    // ============================================================
    {
      const {
        registerPhases21to30,
      } = require("./phases/phase-21-30-enterprise");
      registerPhases21to30({
        safeRegister,
        logger,
        deps: { ...dependencies, app, mainWindow },
        registeredModules,
      });
    }

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
    // Phases 33-40: Git P2P/Collab/Pipeline/Ops/NL/Multimodal/Network
    // Extracted to ./phases/phase-33-40-collab-ops.js
    // ============================================================
    {
      const {
        registerPhases33to40,
      } = require("./phases/phase-33-40-collab-ops");
      registerPhases33to40({
        safeRegister,
        logger,
        deps: { ...dependencies, app },
        registeredModules,
      });
    }

    // ============================================================
    // Phase 41: EvoMap GEP Protocol Integration (v1.0.0)
    // Extracted to ./phases/phase-41-evomap-gep.js
    // ============================================================
    {
      const { registerPhase41 } = require("./phases/phase-41-evomap-gep");
      registerPhase41({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 42-50 (v1.1.0): Social, Compliance, Identity, U-Key, DLP
    // Extracted to ./phases/phase-42-50-v1-1.js
    // ============================================================
    {
      const { registerPhases42to50 } = require("./phases/phase-42-50-v1-1");
      registerPhases42to50({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 51-57 (v1.1.0): SIEM, PQC, Firmware OTA, Governance,
    // Matrix, Terraform, Production Hardening
    // Extracted to ./phases/phase-51-57-v1-1.js
    // ============================================================
    {
      const { registerPhases51to57 } = require("./phases/phase-51-57-v1-1");
      registerPhases51to57({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 58-77 (v1.1.0 - v3.4.0): Federation, Reputation, SLA,
    // Tech Learning, Autonomous Dev, Skill Service, Token, Inference,
    // Trust Root, PQC Ecosystem, Satellite, HSM, Protocol Fusion,
    // AI Social, Decentralized Storage, Anti-Censorship, EvoMap.
    // Extracted to ./phases/phase-58-77-v2-v3.js
    // ============================================================
    {
      const { registerPhases58to77 } = require("./phases/phase-58-77-v2-v3");
      registerPhases58to77({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phase 4 (2027 Q1): WebAuthn, ZKP, FL, IPFS Cluster, GraphQL API
    // Extracted to ./phases/phase-q1-2027.js
    // ============================================================
    {
      const { registerPhaseQ12027 } = require("./phases/phase-q1-2027");
      registerPhaseQ12027({
        safeRegister,
        logger,
        deps: dependencies,
      });
    }

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
