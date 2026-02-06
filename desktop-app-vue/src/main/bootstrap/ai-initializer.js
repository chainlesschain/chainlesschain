/**
 * AI 引擎初始化器
 * 负责 AI 引擎、技能工具系统、MCP 等 AI 相关模块的初始化
 *
 * @module bootstrap/ai-initializer
 */

const { logger } = require("../utils/logger.js");

/**
 * 注册 AI 引擎初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂
 */
function registerAIInitializers(factory) {
  // ========================================
  // Web 引擎
  // ========================================
  factory.register({
    name: "webEngine",
    async init() {
      const WebEngine = require("../engines/web-engine");
      return new WebEngine();
    },
  });

  // ========================================
  // 文档引擎
  // ========================================
  factory.register({
    name: "documentEngine",
    async init() {
      const DocumentEngine = require("../engines/document-engine");
      return new DocumentEngine();
    },
  });

  // ========================================
  // 数据引擎
  // ========================================
  factory.register({
    name: "dataEngine",
    async init() {
      const DataEngine = require("../engines/data-engine");
      return new DataEngine();
    },
  });

  // ========================================
  // 项目结构管理器
  // ========================================
  factory.register({
    name: "projectStructureManager",
    async init() {
      const ProjectStructureManager = require("../project/project-structure");
      return new ProjectStructureManager();
    },
  });

  // ========================================
  // Git 自动提交
  // ========================================
  factory.register({
    name: "gitAutoCommit",
    async init() {
      const GitAutoCommit = require("../git/git-auto-commit");
      return new GitAutoCommit({
        enabled: false,
        interval: 5 * 60 * 1000,
      });
    },
  });

  // ========================================
  // AI 引擎管理器
  // ========================================
  factory.register({
    name: "aiEngineManager",
    dependsOn: ["projectStructureManager"],
    async init(context) {
      const {
        getAIEngineManagerP1,
      } = require("../ai-engine/ai-engine-manager-p1");
      const aiEngineManager = getAIEngineManagerP1();

      // 异步初始化（不阻塞）
      aiEngineManager.initialize().catch((error) => {
        logger.error("[AI] AI引擎管理器初始化失败:", error);
      });

      // 注册自定义工具
      aiEngineManager.registerTool(
        "create_project_structure",
        async (params) => {
          return await context.projectStructureManager.createStructure(
            params.projectPath,
            params.type,
            params.projectName,
          );
        },
        {
          name: "create_project_structure",
          description: "创建项目目录结构",
          parameters: {
            projectPath: { type: "string", description: "项目路径" },
            type: { type: "string", description: "项目类型" },
            projectName: { type: "string", description: "项目名称" },
          },
        },
      );

      return aiEngineManager;
    },
  });

  // ========================================
  // Web IDE 管理器
  // ========================================
  factory.register({
    name: "webideManager",
    async init() {
      const WebIDEManager = require("../webide/webide-manager");
      const WebIDEIPC = require("../webide/webide-ipc");
      const PreviewServer = require("../engines/preview-server");

      const previewServer = new PreviewServer();
      const webideManager = new WebIDEManager();
      const webideIPC = new WebIDEIPC(webideManager, previewServer);
      webideIPC.registerHandlers();

      return { webideManager, webideIPC, previewServer };
    },
  });

  // ========================================
  // 工具管理器
  // ========================================
  factory.register({
    name: "toolManager",
    dependsOn: ["database", "aiEngineManager"],
    async init(context) {
      const ToolManager = require("../skill-tool-system/tool-manager");
      const functionCaller = context.aiEngineManager?.functionCaller;

      if (!functionCaller) {
        throw new Error("FunctionCaller未初始化");
      }

      const toolManager = new ToolManager(context.database, functionCaller);
      await toolManager.initialize();

      // 设置 FunctionCaller 的 ToolManager 引用
      functionCaller.setToolManager(toolManager);

      return toolManager;
    },
  });

  // ========================================
  // 技能管理器
  // ========================================
  factory.register({
    name: "skillManager",
    dependsOn: ["database", "toolManager"],
    async init(context) {
      const SkillManager = require("../skill-tool-system/skill-manager");
      const skillManager = new SkillManager(
        context.database,
        context.toolManager,
      );
      await skillManager.initialize();
      return skillManager;
    },
  });

  // ========================================
  // 技能执行器
  // ========================================
  factory.register({
    name: "skillExecutor",
    dependsOn: ["skillManager", "toolManager"],
    async init(context) {
      const SkillExecutor = require("../skill-tool-system/skill-executor");
      return new SkillExecutor(context.skillManager, context.toolManager);
    },
  });

  // ========================================
  // AI 调度器
  // ========================================
  factory.register({
    name: "aiScheduler",
    dependsOn: ["skillManager", "toolManager", "skillExecutor", "llmManager"],
    async init(context) {
      const AISkillScheduler = require("../skill-tool-system/ai-skill-scheduler");
      return new AISkillScheduler(
        context.skillManager,
        context.toolManager,
        context.skillExecutor,
        context.llmManager,
      );
    },
  });

  // ========================================
  // 对话-技能桥接器
  // ========================================
  factory.register({
    name: "chatSkillBridge",
    dependsOn: ["skillManager", "toolManager", "skillExecutor", "aiScheduler"],
    async init(context) {
      const ChatSkillBridge = require("../skill-tool-system/chat-skill-bridge");
      return new ChatSkillBridge(
        context.skillManager,
        context.toolManager,
        context.skillExecutor,
        context.aiScheduler,
      );
    },
  });

  // ========================================
  // 交互式任务规划系统 (Claude Plan模式)
  // ========================================
  factory.register({
    name: "interactiveTaskPlanner",
    dependsOn: [
      "database",
      "llmManager",
      "templateManager",
      "skillManager",
      "toolManager",
      "aiEngineManager",
    ],
    async init(context) {
      const InteractiveTaskPlanner = require("../ai-engine/task-planner-interactive");
      return new InteractiveTaskPlanner({
        database: context.database,
        llmManager: context.llmManager,
        templateManager: context.templateManager,
        skillManager: context.skillManager,
        toolManager: context.toolManager,
        aiEngineManager: context.aiEngineManager,
      });
    },
  });

  // ========================================
  // MCP 系统（懒加载）
  // ========================================
  factory.register({
    name: "mcpSystem",
    lazy: true, // 懒加载
    dependsOn: ["toolManager"],
    async init(context) {
      logger.info("[AI] 检查MCP系统配置...");

      // 🔥 始终注册基础配置IPC，允许用户通过UI启用/禁用MCP
      const { registerBasicMCPConfigIPC } = require("../mcp/mcp-ipc");
      registerBasicMCPConfigIPC();

      const { MCPConfigLoader } = require("../mcp/mcp-config-loader");
      const mcpConfigLoader = new MCPConfigLoader();
      const mcpConfig = mcpConfigLoader.load();

      logger.info(
        "[AI] MCP配置加载结果:",
        JSON.stringify({
          enabled: mcpConfig.enabled,
          serverCount: Object.keys(mcpConfig.servers || {}).length,
          configPath: mcpConfigLoader.configPath,
        }),
      );

      if (!mcpConfig.enabled) {
        logger.info("[AI] MCP系统已禁用，但基础配置IPC已注册");
        return { enabled: false, mcpConfigLoader };
      }

      const { MCPClientManager } = require("../mcp/mcp-client-manager");
      const { MCPToolAdapter } = require("../mcp/mcp-tool-adapter");
      const { MCPSecurityPolicy } = require("../mcp/mcp-security-policy");
      const { registerMCPIPC } = require("../mcp/mcp-ipc");

      // 初始化安全策略
      const mcpSecurity = new MCPSecurityPolicy({
        auditLog: true,
        requireConsent: true,
      });

      // 初始化MCP客户端管理器
      const mcpManager = new MCPClientManager(mcpConfig);

      // 初始化MCP工具适配器
      const mcpAdapter = new MCPToolAdapter(
        context.toolManager,
        mcpManager,
        mcpSecurity,
      );

      // 注册MCP IPC handlers
      registerMCPIPC(mcpManager, mcpAdapter, mcpSecurity);

      // 自动连接配置中的服务器
      await mcpAdapter.initializeServers(mcpConfig);

      logger.info("[AI] MCP系统初始化完成");

      return {
        enabled: true,
        mcpManager,
        mcpAdapter,
        mcpSecurity,
        mcpConfigLoader,
      };
    },
  });

  // ========================================
  // 插件系统（懒加载）
  // ========================================
  factory.register({
    name: "pluginSystem",
    lazy: true, // 懒加载
    dependsOn: [
      "database",
      "llmManager",
      "ragManager",
      "aiEngineManager",
      "skillManager",
      "toolManager",
    ],
    async init(context) {
      const path = require("path");
      const { app } = require("electron");
      const { getPluginManager } = require("../plugins/plugin-manager");

      const pluginManager = getPluginManager(context.database, {
        pluginsDir: path.join(app.getPath("userData"), "plugins"),
      });

      // 设置系统上下文
      pluginManager.setSystemContext({
        database: context.database,
        llmManager: context.llmManager,
        ragManager: context.ragManager,
        gitManager: context.gitManager?.gitManager,
        fileImporter: context.fileImporter,
        imageUploader: context.imageUploader,
        aiEngineManager: context.aiEngineManager,
        webEngine: context.webEngine,
        documentEngine: context.documentEngine,
        dataEngine: context.dataEngine,
        skillManager: context.skillManager,
        toolManager: context.toolManager,
      });

      await pluginManager.initialize();
      return pluginManager;
    },
  });

  // ========================================
  // 区块链模块（懒加载）
  // ========================================
  factory.register({
    name: "blockchainModules",
    lazy: true, // 懒加载
    dependsOn: ["database", "ukeyManager", "assetManager"],
    async init(context) {
      const { WalletManager } = require("../blockchain/wallet-manager");
      const BlockchainAdapter = require("../blockchain/blockchain-adapter");
      const {
        TransactionMonitor,
      } = require("../blockchain/transaction-monitor");
      const BridgeManager = require("../blockchain/bridge-manager");
      const {
        ExternalWalletConnector,
      } = require("../blockchain/external-wallet-connector");

      // 初始化钱包管理器
      const walletManager = new WalletManager(
        context.database,
        context.ukeyManager,
        null,
      );
      await walletManager.initialize();

      // 初始化区块链适配器
      const blockchainAdapter = new BlockchainAdapter(
        context.database,
        walletManager,
      );
      await blockchainAdapter.initialize();

      // 设置引用
      walletManager.blockchainAdapter = blockchainAdapter;
      if (context.assetManager) {
        context.assetManager.blockchainAdapter = blockchainAdapter;
      }

      // 初始化交易监控器
      const transactionMonitor = new TransactionMonitor(
        blockchainAdapter,
        context.database,
      );
      await transactionMonitor.initialize();

      // 初始化跨链桥管理器
      const bridgeManager = new BridgeManager(
        blockchainAdapter,
        context.database,
      );
      await bridgeManager.initialize();

      // 初始化外部钱包连接器
      const externalWalletConnector = new ExternalWalletConnector(
        context.database,
      );
      await externalWalletConnector.initialize();

      return {
        walletManager,
        blockchainAdapter,
        transactionMonitor,
        bridgeManager,
        externalWalletConnector,
      };
    },
  });
}

module.exports = { registerAIInitializers };
