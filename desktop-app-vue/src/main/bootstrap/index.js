/**
 * Bootstrap 模块入口
 * 统一导出所有初始化器，提供应用启动的模块化入口
 *
 * @module bootstrap
 */

const {
  InitializerFactory,
  initializerFactory,
} = require("./initializer-factory");
const { registerCoreInitializers } = require("./core-initializer");
const {
  registerSocialInitializers,
  setupP2PPostInit,
} = require("./social-initializer");
const { registerAIInitializers } = require("./ai-initializer");
const { registerTradeInitializers } = require("./trade-initializer");
const {
  registerHooksInitializer,
  bindHooksToManagers,
} = require("./hooks-initializer");
const { logger } = require("../utils/logger.js");

/**
 * 初始化阶段配置
 * @type {Array<{name: string, modules: string[], progress: number}>}
 */
const INIT_PHASES = [
  {
    name: "阶段 0: Hooks 系统",
    progress: 2,
    modules: ["hookSystem"],
  },
  {
    name: "阶段 1: 核心基础设施",
    progress: 10,
    modules: [
      "database",
      "graphExtractor",
      "versionManager",
      "performanceMonitor",
    ],
  },
  {
    name: "阶段 2: 文件和模板",
    progress: 20,
    modules: ["fileImporter", "templateManager", "ukeyManager"],
  },
  {
    name: "阶段 3: LLM 服务",
    progress: 35,
    modules: [
      "llmSelector",
      "tokenTracker",
      "promptCompressor",
      "responseCache",
      "llmManager",
      "permanentMemoryManager",
    ],
  },
  {
    name: "阶段 4: 会话和监控",
    progress: 45,
    modules: ["sessionManager", "errorMonitor", "multiAgent", "memoryBank"],
  },
  {
    name: "阶段 5: RAG 和 Git",
    progress: 55,
    modules: ["ragManager", "promptTemplateManager", "gitManager"],
  },
  {
    name: "阶段 6: 社交网络",
    progress: 65,
    modules: [
      "didManager",
      "p2pManager",
      "contactManager",
      "friendManager",
      "postManager",
    ],
  },
  {
    name: "阶段 7: 企业功能",
    progress: 75,
    modules: [
      "organizationManager",
      "collaborationManager",
      "syncEngine",
      "vcManager",
      "vcTemplateManager",
    ],
  },
  {
    name: "阶段 8: AI 引擎",
    progress: 85,
    modules: [
      "webEngine",
      "documentEngine",
      "dataEngine",
      "projectStructureManager",
      "gitAutoCommit",
      "aiEngineManager",
      "webideManager",
    ],
  },
  {
    name: "阶段 9: 技能工具系统",
    progress: 90,
    modules: [
      "toolManager",
      "skillManager",
      "skillExecutor",
      "aiScheduler",
      "chatSkillBridge",
      "interactiveTaskPlanner",
      "remoteGateway",
    ],
  },
  {
    name: "阶段 10: 交易系统",
    progress: 95,
    modules: [
      "assetManager",
      "escrowManager",
      "marketplaceManager",
      "contractEngine",
      "knowledgePaymentManager",
      "creditScoreManager",
      "reviewManager",
      "statsCollector",
    ],
  },
];

/**
 * 注册所有初始化器
 * @param {InitializerFactory} factory - 初始化器工厂
 */
function registerAllInitializers(factory) {
  // 🔥 Phase 0: Hooks 系统 (最先初始化，供其他模块使用)
  registerHooksInitializer(factory);

  // 原有初始化器
  registerCoreInitializers(factory);
  registerSocialInitializers(factory);
  registerAIInitializers(factory);
  registerTradeInitializers(factory);
}

/**
 * 关键阶段边界：前 CRITICAL_PHASE_COUNT 个阶段为必须在窗口显示前完成的关键阶段
 * 其余阶段为延迟阶段，主窗口显示后后台继续执行
 */
const CRITICAL_PHASE_COUNT = 6; // 阶段 0-5（Hooks/核心/文件/LLM/会话/RAG+Git）
const CRITICAL_PHASES = INIT_PHASES.slice(0, CRITICAL_PHASE_COUNT);
const DEFERRED_PHASES = INIT_PHASES.slice(CRITICAL_PHASE_COUNT);

/**
 * 预热配置管理器（异步 IO 移出事件循环）
 */
async function prewarmConfigs() {
  try {
    const [{ prewarmUnifiedConfigManager }, { prewarmAppConfig }] =
      await Promise.all([
        import("../config/unified-config-manager.js"),
        Promise.resolve(require("../config/database-config")),
      ]);
    const { prewarmLLMConfig } = require("../llm/llm-config");
    const {
      prewarmInitialSetupConfig,
    } = require("../config/initial-setup-config");
    const { app: electronApp } = require("electron");
    const userDataPath = electronApp.getPath("userData");
    await Promise.all([
      prewarmUnifiedConfigManager(),
      prewarmAppConfig(),
      prewarmLLMConfig(),
      prewarmInitialSetupConfig(userDataPath),
    ]);
  } catch (error) {
    logger.warn(
      "[Bootstrap] 配置异步预热失败，将回退到同步初始化:",
      error.message,
    );
  }
}

/**
 * 执行关键阶段初始化（阶段 0-5），阻塞 splash 直到完成
 * 完成后主窗口即可创建显示
 * @param {Object} options - 初始化选项
 * @param {Function} [options.progressCallback] - 进度回调 (message, progress) => void
 * @param {Object} [options.context] - 初始上下文（如 mainWindow）
 * @returns {Promise<Object>} 已初始化的实例（仅关键阶段模块）
 */
async function bootstrapCritical(options = {}) {
  const { progressCallback, context = {} } = options;

  logger.info("=".repeat(60));
  logger.info("[Bootstrap] 关键阶段初始化开始 (0-5)...");
  logger.info("=".repeat(60));

  const startTime = Date.now();

  await prewarmConfigs();

  // 重置工厂状态
  initializerFactory.reset();

  if (progressCallback) {
    initializerFactory.setProgressCallback(progressCallback);
  }

  registerAllInitializers(initializerFactory);

  await initializerFactory.runPhased(CRITICAL_PHASES, context);

  const duration = Date.now() - startTime;
  logger.info(`[Bootstrap] 关键阶段完成，耗时: ${duration}ms`);

  return initializerFactory.getAllInstances();
}

/**
 * 执行延迟阶段初始化（阶段 6+），主窗口显示后在后台运行
 * @param {Object} options - 初始化选项
 * @param {Function} [options.progressCallback] - 进度回调
 * @param {Object} [options.context] - 额外上下文（如 mainWindow）
 * @returns {Promise<Object>} 全部已初始化的实例
 */
async function bootstrapDeferred(options = {}) {
  const { progressCallback, context = {} } = options;

  logger.info("=".repeat(60));
  logger.info("[Bootstrap] 延迟阶段初始化开始 (6+)...");
  logger.info("=".repeat(60));

  const startTime = Date.now();

  if (progressCallback) {
    initializerFactory.setProgressCallback(progressCallback);
  }

  await initializerFactory.runPhased(DEFERRED_PHASES, context);

  const instances = initializerFactory.getAllInstances();

  // 🔥 Post-init: 绑定 Hooks 到其他管理器
  try {
    await bindHooksToManagers(instances);
  } catch (error) {
    logger.warn("[Bootstrap] Hooks 绑定失败 (非致命):", error.message);
  }

  initializerFactory.printStats();

  const duration = Date.now() - startTime;
  logger.info("=".repeat(60));
  logger.info(`[Bootstrap] 延迟阶段完成，耗时: ${duration}ms`);
  logger.info("=".repeat(60));

  return instances;
}

/**
 * 执行完整的应用启动初始化（兼容旧调用方）
 * 依次运行关键阶段 + 延迟阶段，全部完成后返回
 * @param {Object} options - 初始化选项
 * @returns {Promise<Object>} 所有初始化实例
 */
async function bootstrapApplication(options = {}) {
  await bootstrapCritical(options);
  return bootstrapDeferred(options);
}

/**
 * 懒加载指定模块
 * @param {string} name - 模块名称
 * @param {Object} [context] - 额外上下文
 * @returns {Promise<*>} 模块实例
 */
async function lazyLoadModule(name, context = {}) {
  // 检查是否已初始化
  const existing = initializerFactory.getInstance(name);
  if (existing) {
    return existing;
  }

  // 执行懒加载
  const result = await initializerFactory.runOne(name, {
    ...initializerFactory.getAllInstances(),
    ...context,
  });

  if (!result.success) {
    throw result.error || new Error(`模块 ${name} 懒加载失败`);
  }

  return result.instance;
}

/**
 * 获取已初始化的模块实例
 * @param {string} name - 模块名称
 * @returns {*} 模块实例
 */
function getModule(name) {
  return initializerFactory.getInstance(name);
}

/**
 * 获取所有已初始化的模块实例
 * @returns {Object} 所有模块实例
 */
function getAllModules() {
  return initializerFactory.getAllInstances();
}

module.exports = {
  // 工厂和类
  InitializerFactory,
  initializerFactory,

  // 注册函数
  registerAllInitializers,
  registerCoreInitializers,
  registerSocialInitializers,
  registerAIInitializers,
  registerTradeInitializers,
  registerHooksInitializer,

  // 初始化函数
  bootstrapApplication,
  bootstrapCritical,
  bootstrapDeferred,
  lazyLoadModule,
  setupP2PPostInit,
  bindHooksToManagers,

  // 获取器
  getModule,
  getAllModules,

  // 常量
  INIT_PHASES,
  CRITICAL_PHASES,
  DEFERRED_PHASES,
};
