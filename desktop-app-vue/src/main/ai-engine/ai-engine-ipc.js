/**
 * AI引擎 IPC Handlers
 * 处理前端与AI引擎之间的通信
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

class AIEngineIPC {
  constructor(
    aiEngineManager,
    webEngineManager,
    documentEngineManager,
    dataEngineManager,
    gitAutoCommit,
  ) {
    this.aiEngineManager = aiEngineManager;
    this.webEngineManager = webEngineManager;
    this.documentEngineManager = documentEngineManager;
    this.dataEngineManager = dataEngineManager;
    this.gitAutoCommit = gitAutoCommit;
  }

  /**
   * 注册所有IPC handlers
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  registerHandlers(mainWindow) {
    // AI引擎：处理用户输入
    ipcMain.handle("ai:processInput", async (event, { input, context }) => {
      try {
        logger.info("[AI Engine IPC] 处理用户输入:", input);

        // 步骤更新回调
        const onStepUpdate = (step) => {
          mainWindow.webContents.send("ai:stepUpdate", step);
        };

        const result = await this.aiEngineManager.processUserInput(
          input,
          context,
          onStepUpdate,
        );

        return {
          success: true,
          result,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] 处理失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // AI引擎：获取执行历史
    ipcMain.handle("ai:getHistory", async (_event, limit = 10) => {
      try {
        const history = this.aiEngineManager.getExecutionHistory(limit);

        return {
          success: true,
          history,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] 获取历史失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // AI引擎：清除执行历史
    ipcMain.handle("ai:clearHistory", async () => {
      try {
        this.aiEngineManager.clearHistory();

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] 清除历史失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // AI引擎：获取可用工具列表
    ipcMain.handle("ai:getAvailableTools", async () => {
      try {
        const tools = this.aiEngineManager.getAvailableTools();

        return {
          success: true,
          tools,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] 获取工具列表失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：生成Web项目
    ipcMain.handle("web-engine:generate", async (_event, options) => {
      try {
        logger.info("[Web Engine IPC] 生成Web项目:", options);

        const result = await this.webEngineManager.generateProject(options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 生成失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：获取模板列表
    ipcMain.handle("web-engine:getTemplates", async () => {
      try {
        const templates = this.webEngineManager.getTemplates();

        return {
          success: true,
          templates,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 获取模板失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：启动预览服务器
    ipcMain.handle(
      "web-engine:startPreview",
      async (_event, projectPath, port) => {
        try {
          const result = await this.webEngineManager.startPreview(
            projectPath,
            port,
          );

          return {
            success: true,
            ...result,
          };
        } catch (error) {
          logger.error("[Web Engine IPC] 启动预览失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // Web引擎：停止预览服务器
    ipcMain.handle("web-engine:stopPreview", async () => {
      try {
        const result = await this.webEngineManager.stopPreview();

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 停止预览失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：重启预览服务器
    ipcMain.handle("web-engine:restartPreview", async (_event, projectPath) => {
      try {
        const result = await this.webEngineManager.restartPreview(projectPath);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 重启预览失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：获取预览服务器状态
    ipcMain.handle("web-engine:getPreviewStatus", async () => {
      try {
        const status = this.webEngineManager.getPreviewStatus();

        return {
          success: true,
          ...status,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 获取预览状态失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Web引擎：更改预览端口
    ipcMain.handle("web-engine:changePreviewPort", async (_event, newPort) => {
      try {
        const result = await this.webEngineManager.changePreviewPort(newPort);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Web Engine IPC] 更改端口失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 文档引擎：生成文档
    ipcMain.handle("document-engine:generate", async (_event, options) => {
      try {
        logger.info("[Document Engine IPC] 生成文档:", options);

        const result =
          await this.documentEngineManager.generateDocument(options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Document Engine IPC] 生成失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 文档引擎：获取模板列表
    ipcMain.handle("document-engine:getTemplates", async () => {
      try {
        const templates = this.documentEngineManager.getTemplates();

        return {
          success: true,
          templates,
        };
      } catch (error) {
        logger.error("[Document Engine IPC] 获取模板失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：读取CSV
    ipcMain.handle("data-engine:readCSV", async (_event, filePath) => {
      try {
        const result = await this.dataEngineManager.readCSV(filePath);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Data Engine IPC] 读取CSV失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：写入CSV
    ipcMain.handle("data-engine:writeCSV", async (_event, filePath, data) => {
      try {
        const result = await this.dataEngineManager.writeCSV(filePath, data);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Data Engine IPC] 写入CSV失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：读取Excel
    ipcMain.handle("data-engine:readExcel", async (_event, filePath) => {
      try {
        const result = await this.dataEngineManager.readExcel(filePath);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Data Engine IPC] 读取Excel失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：写入Excel
    ipcMain.handle("data-engine:writeExcel", async (_event, filePath, data) => {
      try {
        const result = await this.dataEngineManager.writeExcel(filePath, data);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Data Engine IPC] 写入Excel失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：分析数据
    ipcMain.handle("data-engine:analyze", async (_event, data, options) => {
      try {
        const result = this.dataEngineManager.analyzeData(data, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[Data Engine IPC] 分析数据失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 数据引擎：生成图表
    ipcMain.handle(
      "data-engine:generateChart",
      async (_event, data, options) => {
        try {
          const result = await this.dataEngineManager.generateChart(
            data,
            options,
          );

          return {
            success: true,
            ...result,
          };
        } catch (error) {
          logger.error("[Data Engine IPC] 生成图表失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // 数据引擎：生成报告
    ipcMain.handle(
      "data-engine:generateReport",
      async (_event, analysisResults, outputPath) => {
        try {
          const result = await this.dataEngineManager.generateReport(
            analysisResults,
            outputPath,
          );

          return {
            success: true,
            ...result,
          };
        } catch (error) {
          logger.error("[Data Engine IPC] 生成报告失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // Git自动提交：启动监控
    ipcMain.handle(
      "git-auto-commit:start",
      async (_event, projectId, repoPath) => {
        try {
          this.gitAutoCommit.start(projectId, repoPath);

          return {
            success: true,
          };
        } catch (error) {
          logger.error("[Git Auto Commit IPC] 启动失败:", error);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    );

    // Git自动提交：停止监控
    ipcMain.handle("git-auto-commit:stop", async (_event, projectId) => {
      try {
        this.gitAutoCommit.stop(projectId);

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[Git Auto Commit IPC] 停止失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Git自动提交：停止所有
    ipcMain.handle("git-auto-commit:stopAll", async () => {
      try {
        this.gitAutoCommit.stopAll();

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[Git Auto Commit IPC] 停止所有失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Git自动提交：设置间隔
    ipcMain.handle("git-auto-commit:setInterval", async (_event, interval) => {
      try {
        this.gitAutoCommit.setInterval(interval);

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[Git Auto Commit IPC] 设置间隔失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Git自动提交：启用/禁用
    ipcMain.handle("git-auto-commit:setEnabled", async (_event, enabled) => {
      try {
        this.gitAutoCommit.setEnabled(enabled);

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[Git Auto Commit IPC] 设置启用状态失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Git自动提交：获取监控的项目列表
    ipcMain.handle("git-auto-commit:getWatchedProjects", async () => {
      try {
        const projects = this.gitAutoCommit.getWatchedProjects();

        return {
          success: true,
          projects,
        };
      } catch (error) {
        logger.error("[Git Auto Commit IPC] 获取监控项目失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 意图识别：使用LLM分析用户意图
    ipcMain.handle("aiEngine:recognizeIntent", async (_event, userInput) => {
      try {
        logger.info("[AI Engine IPC] 开始意图识别:", userInput);

        const { recognizeProjectIntent } = require("./intent-recognizer");
        const { getLLMConfig } = require("../llm/llm-config");
        const { LLMManager } = require("../llm/llm-manager");

        // 获取LLM配置并初始化管理器
        const llmConfig = getLLMConfig();
        const managerConfig = llmConfig.getManagerConfig();
        const llmManager = new LLMManager(managerConfig);
        await llmManager.initialize();

        // 调用意图识别
        const result = await recognizeProjectIntent(userInput, llmManager);

        logger.info("[AI Engine IPC] 意图识别成功:", result);

        return result;
      } catch (error) {
        logger.error("[AI Engine IPC] 意图识别失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // PPT生成：从大纲生成PPT文件
    ipcMain.handle("aiEngine:generatePPT", async (_event, options) => {
      try {
        logger.info("[AI Engine IPC] 开始生成PPT:", options);

        const PPTEngine = require("../engines/ppt-engine");
        const pptEngine = new PPTEngine();

        const result = await pptEngine.generateFromOutline(options.outline, {
          theme: options.theme || "business",
          author: options.author || "作者",
          outputPath: options.outputPath,
        });

        logger.info("[AI Engine IPC] PPT生成成功:", result);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] PPT生成失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Word文档生成：从结构生成Word文件
    ipcMain.handle("aiEngine:generateWord", async (_event, options) => {
      try {
        logger.info("[AI Engine IPC] 开始生成Word文档:", options);

        const wordEngine = require("../engines/word-engine");

        const result = await wordEngine.writeWord(
          options.outputPath,
          options.structure,
        );

        logger.info("[AI Engine IPC] Word文档生成成功:", result);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error("[AI Engine IPC] Word文档生成失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    logger.info("[AI Engine IPC] 所有IPC handlers已注册");
  }

  /**
   * 注销所有IPC handlers
   */
  unregisterHandlers() {
    const channels = [
      "ai:processInput",
      "ai:getHistory",
      "ai:clearHistory",
      "ai:getAvailableTools",
      "web-engine:generate",
      "web-engine:getTemplates",
      "web-engine:startPreview",
      "web-engine:stopPreview",
      "web-engine:restartPreview",
      "web-engine:getPreviewStatus",
      "web-engine:changePreviewPort",
      "document-engine:generate",
      "document-engine:getTemplates",
      "data-engine:readCSV",
      "data-engine:writeCSV",
      "data-engine:readExcel",
      "data-engine:writeExcel",
      "data-engine:analyze",
      "data-engine:generateChart",
      "data-engine:generateReport",
      "git-auto-commit:start",
      "git-auto-commit:stop",
      "git-auto-commit:stopAll",
      "git-auto-commit:setInterval",
      "git-auto-commit:setEnabled",
      "git-auto-commit:getWatchedProjects",
      "aiEngine:recognizeIntent",
      "aiEngine:generatePPT",
      "aiEngine:generateWord",
    ];

    channels.forEach((channel) => {
      ipcMain.removeHandler(channel);
    });

    logger.info("[AI Engine IPC] 所有IPC handlers已注销");
  }
}

module.exports = AIEngineIPC;
