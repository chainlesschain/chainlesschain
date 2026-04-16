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
    // 解构本文件直接引用的依赖；其余通过 `...dependencies` 透传给各 phase
    const { app, database, mainWindow, llmManager, aiEngineManager } =
      dependencies;

    // ============================================================
    // 第一阶段模块 (AI 相关) — extracted to phases/phase-1-ai.js
    // ============================================================
    let hookSystem = null;
    {
      const { registerPhase1AI } = require("./phases/phase-1-ai");
      const phase1Result = registerPhase1AI({
        safeRegister,
        logger,
        deps: dependencies,
      });
      hookSystem = phase1Result.hookSystem;
    }

    // ============================================================
    // Phase 2 + Critical Early IPC — extracted to phases/phase-2-core.js
    // ============================================================
    {
      const { registerPhase2Core } = require("./phases/phase-2-core");
      registerPhase2Core({
        safeRegister,
        logger,
        deps: dependencies,
      });
    }

    // ============================================================
    // Phase 3+4: Social Network + Enterprise (DID/P2P/Social/VC/Org)
    // Extracted to ./phases/phase-3-4-social.js
    // ============================================================
    {
      const { registerPhases3to4Social } = require("./phases/phase-3-4-social");
      registerPhases3to4Social({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phase 5: Project Management Suite
    // Extracted to ./phases/phase-5-project.js
    // ============================================================
    {
      const { registerPhase5Project } = require("./phases/phase-5-project");
      registerPhase5Project({
        safeRegister,
        logger,
        deps: {
          ...dependencies,
          app,
          mainWindow,
          removeUndefinedValues,
          _replaceUndefinedWithNull,
        },
        registeredModules,
      });
    }

    // ============================================================
    // Phase 6+7: Content & Media — extracted to phases/phase-6-7-content.js
    // ============================================================
    {
      const {
        registerPhases6to7Content,
      } = require("./phases/phase-6-7-content");
      registerPhases6to7Content({
        safeRegister,
        logger,
        deps: dependencies,
      });
    }

    // ============================================================
    // Phase 8+9: Extras + Workflow — extracted to phases/phase-8-9-extras.js
    // ============================================================
    {
      const { registerPhases8to9Extras } = require("./phases/phase-8-9-extras");
      registerPhases8to9Extras({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

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
        },
        registeredModules,
      });
    }

    // ============================================================
    // Phases 16-20: Skill Pipeline/Instinct/Cowork v2/ML Sched/Self-Evolution
    // Extracted to ./phases/phase-16-20-skill-evo.js
    // ============================================================
    {
      const {
        registerPhases16to20,
      } = require("./phases/phase-16-20-skill-evo");
      registerPhases16to20({
        safeRegister,
        logger,
        deps: { ...dependencies, database, hookSystem },
        registeredModules,
      });
    }
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
    // Phase H (Managed Agents parity): session-core IPC
    // 18 channels: session policy/lifecycle + memory + agent stream + beta
    // ============================================================
    {
      try {
        const { ipcMain } = require("electron");
        const {
          registerSessionCoreIpc,
        } = require("../session/session-core-ipc.js");
        const res = registerSessionCoreIpc(ipcMain);
        registeredModules["session-core"] = {
          channelCount: res.channels.length,
        };
        logger.info(
          `[IPC Registry] session-core: registered ${res.channels.length} channels`,
        );
      } catch (e) {
        logger.error("[IPC Registry] session-core registration failed:", e);
      }
    }

    // ============================================================
    // Phase CutClaw: Video Editing Agent IPC (7 channels)
    // ============================================================
    {
      try {
        const { ipcMain } = require("electron");
        const {
          registerVideoEditingIPC,
        } = require("../video/video-editing-ipc.js");
        const res = registerVideoEditingIPC(ipcMain, {
          mainWindow: dependencies.mainWindow,
          llmManager: dependencies.llmManager,
        });
        registeredModules["video-editing"] = {
          channelCount: res.channels.length,
        };
        logger.info(
          `[IPC Registry] video-editing: registered ${res.channels.length} channels`,
        );
      } catch (e) {
        logger.error("[IPC Registry] video-editing registration failed:", e);
      }
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
