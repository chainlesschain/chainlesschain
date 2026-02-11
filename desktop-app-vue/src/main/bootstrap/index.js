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
 * 执行完整的应用启动初始化
 * @param {Object} options - 初始化选项
 * @param {Function} [options.progressCallback] - 进度回调 (message, progress) => void
 * @param {Object} [options.context] - 初始上下文（如 mainWindow）
 * @returns {Promise<Object>} 所有初始化实例
 */
async function bootstrapApplication(options = {}) {
  const { progressCallback, context = {} } = options;

  logger.info("=".repeat(60));
  logger.info("[Bootstrap] 开始应用初始化...");
  logger.info("=".repeat(60));

  const startTime = Date.now();

  // 重置工厂状态
  initializerFactory.reset();

  // 设置进度回调
  if (progressCallback) {
    initializerFactory.setProgressCallback(progressCallback);
  }

  // 注册所有初始化器
  registerAllInitializers(initializerFactory);

  // 执行分阶段初始化
  await initializerFactory.runPhased(INIT_PHASES, context);

  // 获取所有实例
  const instances = initializerFactory.getAllInstances();

  // 🔥 Post-init: 绑定 Hooks 到其他管理器
  try {
    await bindHooksToManagers(instances);
  } catch (error) {
    logger.warn("[Bootstrap] Hooks 绑定失败 (非致命):", error.message);
  }

  // 打印统计信息
  initializerFactory.printStats();

  const duration = Date.now() - startTime;
  logger.info("=".repeat(60));
  logger.info(`[Bootstrap] 应用初始化完成，总耗时: ${duration}ms`);
  logger.info("=".repeat(60));

  return instances;
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
  lazyLoadModule,
  setupP2PPostInit,
  bindHooksToManagers,

  // 获取器
  getModule,
  getAllModules,

  // 常量
  INIT_PHASES,
};
