/**
 * Project AI IPC handlers — code group.
 * Split verbatim from project-ai-ipc.js registerProjectAIIPC(); ipcMain + deps via ctx.
 *
 * @module project/project-ai-ipc-code
 */
const { logger } = require("../utils/logger.js");
const path = require("path");

function registerCodeHandlers(ctx) {
  const { ipcMain, database, llmManager, mainWindow } = ctx;

  // ============================================================
  // AI 代码助手 (Code Assistant)
  // ============================================================

  /**
   * 代码生成
   * Channel: 'project:code-generate'
   */
  ipcMain.handle(
    "project:code-generate",
    async (_event, description, language, options = {}) => {
      try {
        const CodeAPI = require("./code-api");
        return await CodeAPI.generate(
          description,
          language,
          options.style || "modern",
          options.includeTests || false,
          options.includeComments !== false,
          options.context,
        );
      } catch (error) {
        logger.error("[Main] 代码生成失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 代码审查
   * Channel: 'project:code-review'
   */
  ipcMain.handle(
    "project:code-review",
    async (_event, code, language, focusAreas = null) => {
      try {
        const CodeAPI = require("./code-api");
        return await CodeAPI.review(code, language, focusAreas);
      } catch (error) {
        logger.error("[Main] 代码审查失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 代码重构
   * Channel: 'project:code-refactor'
   */
  ipcMain.handle(
    "project:code-refactor",
    async (_event, code, language, refactorType = "general") => {
      try {
        const CodeAPI = require("./code-api");
        return await CodeAPI.refactor(code, language, refactorType);
      } catch (error) {
        logger.error("[Main] 代码重构失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 代码解释
   * Channel: 'project:code-explain'
   */
  ipcMain.handle("project:code-explain", async (_event, code, language) => {
    try {
      const CodeAPI = require("./code-api");
      return await CodeAPI.explain(code, language);
    } catch (error) {
      logger.error("[Main] 代码解释失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Bug修复
   * Channel: 'project:code-fix-bug'
   */
  ipcMain.handle(
    "project:code-fix-bug",
    async (_event, code, language, bugDescription) => {
      try {
        const CodeAPI = require("./code-api");
        return await CodeAPI.fixBug(code, language, bugDescription);
      } catch (error) {
        logger.error("[Main] Bug修复失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 生成测试代码
   * Channel: 'project:code-generate-tests'
   */
  ipcMain.handle(
    "project:code-generate-tests",
    async (_event, code, language) => {
      try {
        const CodeAPI = require("./code-api");
        return await CodeAPI.generateTests(code, language);
      } catch (error) {
        logger.error("[Main] 生成测试失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 代码优化
   * Channel: 'project:code-optimize'
   */
  ipcMain.handle("project:code-optimize", async (_event, code, language) => {
    try {
      const CodeAPI = require("./code-api");
      return await CodeAPI.optimize(code, language);
    } catch (error) {
      logger.error("[Main] 代码优化失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 项目AI对话（流式） - 支持文件操作和流式输出
   * Channel: 'project:aiChatStream'
   */
  ipcMain.handle("project:aiChatStream", async (_event, chatData) => {
    try {
      logger.info("[Main] 项目AI对话（流式）:", chatData);

      const {
        projectId,
        userMessage,
        conversationHistory,
        contextMode,
        currentFile,
        projectInfo: _projectInfo,
        fileList: _fileList,
        options = {},
      } = chatData;

      // 1. 检查数据库
      if (!database) {
        throw new Error("数据库未初始化");
      }

      // 2. 检查LLM管理器
      if (!llmManager) {
        throw new Error("LLM管理器未初始化，请在设置中配置LLM服务");
      }

      // 3. 获取当前窗口（动态获取，避免引用过期）
      const { BrowserWindow } = require("electron");
      const currentWindow =
        mainWindow && !mainWindow.isDestroyed()
          ? mainWindow
          : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

      if (!currentWindow) {
        throw new Error("没有可用的窗口发送流式消息");
      }

      // 4. 获取项目信息
      const project = database.db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      let projectPath = project.root_path;

      // 🔥 修复：如果项目路径不存在，自动创建
      if (!projectPath) {
        logger.warn("[Main] 项目路径未设置（流式），自动创建项目目录");

        const fs = require("fs").promises;
        const { getProjectConfig } = require("../config/project-config");
        const projectConfig = getProjectConfig();

        // 使用项目名称或ID作为目录名
        const dirName = project.name
          ? project.name.replace(/[^\w\s-]/g, "_")
          : `project_${projectId}`;
        projectPath = path.join(projectConfig.getProjectsRootPath(), dirName);

        // 创建目录
        await fs.mkdir(projectPath, { recursive: true });
        logger.info("[Main] 项目目录已自动创建:", projectPath);

        // 更新数据库中的项目路径
        database.db
          .prepare(
            "UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?",
          )
          .run(projectPath, Date.now(), projectId);

        logger.info("[Main] 项目路径已更新到数据库");
      }

      logger.info("[Main] 项目路径:", projectPath);

      // 5. 构建消息列表
      const messages = [];

      // 添加系统提示
      messages.push({
        role: "system",
        content: `你是一个智能项目助手，正在协助用户处理项目: ${project.name}。
当前上下文模式: ${contextMode || "project"}
${currentFile ? `当前文件: ${currentFile}` : ""}

请根据用户的问题提供有帮助的回答。`,
      });

      // 添加对话历史
      if (conversationHistory && Array.isArray(conversationHistory)) {
        messages.push(...conversationHistory);
      }

      // 添加用户消息
      messages.push({
        role: "user",
        content: userMessage,
      });

      logger.info("[Main] 使用流式LLM，消息数量:", messages.length);

      // 6. 创建流式控制器
      const { createStreamController } = require("../llm/stream-controller");
      const streamController = createStreamController({
        enableBuffering: true,
      });

      streamController.start();

      // 7. 准备响应累积
      let fullResponse = "";
      let totalTokens = 0;
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 8. 定义chunk回调函数
      const onChunk = async (chunk) => {
        logger.info(
          "[Main] 📥 收到 LLM chunk:",
          JSON.stringify(chunk).substring(0, 100),
        );

        // 处理chunk
        const shouldContinue = await streamController.processChunk(chunk);
        if (!shouldContinue) {
          logger.info("[Main] ⏸️  Stream controller 指示停止");
          return false;
        }

        // 提取chunk内容
        const chunkContent =
          chunk.content || chunk.text || chunk.delta?.content || "";
        logger.info("[Main] 📝 提取的 chunk 内容长度:", chunkContent.length);

        if (chunkContent) {
          fullResponse += chunkContent;

          // 发送chunk给前端
          logger.info(
            "[Main] 📤 发送 chunk 到前端，完整内容长度:",
            fullResponse.length,
          );
          currentWindow.webContents.send("project:aiChatStream-chunk", {
            projectId,
            messageId,
            chunk: chunkContent,
            fullContent: fullResponse,
          });
        }

        // 更新tokens
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens || 0;
        }

        return true;
      };

      // 9. 智能选择模型（如果是火山引擎）
      const chatOptions = {
        temperature: 0.7,
        maxTokens: 2000,
        ...options,
      };

      if (llmManager.provider === "volcengine") {
        try {
          // 根据项目类型和对话内容智能选择模型
          const scenario = {
            userBudget: "medium",
          };

          // 根据项目类型调整场景
          const projectType = project.project_type;
          if (
            projectType === "code" ||
            projectType === "app" ||
            projectType === "web"
          ) {
            scenario.needsCodeGeneration = true;
            logger.info("[Main] 检测到代码项目，启用代码生成模式");
          }

          // 根据上下文模式调整
          if (contextMode === "file" || contextMode === "project") {
            scenario.needsLongContext = true;
            logger.info("[Main] 检测到需要长上下文（项目/文件模式）");
          }

          // 分析用户消息内容
          if (userMessage) {
            if (/(分析|推理|思考|为什么|如何|怎么)/.test(userMessage)) {
              scenario.needsThinking = true;
              logger.info("[Main] 检测到需要深度思考");
            }
          }

          // 智能选择模型（会尝试使用推荐模型，不可用时回退到用户配置的模型）
          const selectedModel = llmManager.selectVolcengineModel(scenario);
          if (selectedModel) {
            chatOptions.model = selectedModel.modelId;
            logger.info(
              "[Main] 项目AI对话（流式）智能选择模型:",
              selectedModel.modelName,
            );
          }
        } catch (selectError) {
          logger.warn(
            "[Main] 智能模型选择失败，使用默认配置:",
            selectError.message,
          );
        }
      }

      // 10. 调用LLM流式对话
      // 🔥 注：模型回退逻辑已在 LLMManager 层实现，智能选择的模型不可用时会自动回退到用户配置的默认模型
      try {
        logger.info("[Main] 🚀 开始调用 llmManager.chatStream");
        const llmResult = await llmManager.chatStream(
          messages,
          onChunk,
          chatOptions,
        );

        logger.info("[Main] ✅ 流式对话完成，总长度:", fullResponse.length);

        // 11. 通知前端完成
        streamController.complete({
          messageId,
          tokens: totalTokens || llmResult.tokens,
        });

        currentWindow.webContents.send("project:aiChatStream-complete", {
          projectId,
          messageId,
          fullContent: fullResponse,
          tokens: totalTokens || llmResult.tokens,
          stats: streamController.getStats(),
        });

        return {
          success: true,
          messageId,
          tokens: totalTokens || llmResult.tokens,
          response: fullResponse,
        };
      } catch (llmError) {
        logger.error("[Main] LLM流式对话失败:", llmError);

        // 通知前端错误
        streamController.error(llmError);

        currentWindow.webContents.send("project:aiChatStream-error", {
          projectId,
          messageId,
          error: llmError.message,
        });

        throw llmError;
      }
    } catch (error) {
      logger.error("[Main] 项目AI对话（流式）失败:", error);

      // 提供更友好的错误信息
      if (
        error.message.includes("LLM管理器未初始化") ||
        error.message.includes("LLM服务未初始化")
      ) {
        throw new Error(
          "AI功能未配置，请在设置中配置LLM服务（Ollama或云端API）",
        );
      }

      if (
        error.message.includes("API 密钥") ||
        error.message.includes("API 访问") ||
        error.message.includes("API 请求频率") ||
        error.message.includes("API 服务暂时不可用") ||
        error.message.includes("无法连接到 API") ||
        error.message.includes("API 请求超时")
      ) {
        throw new Error(error.message);
      }

      // 对未处理的 401/403/429 等 HTTP 错误也提供友好提示
      if (error.message.includes("status code 401")) {
        throw new Error("API 密钥无效或已过期，请在设置中检查 API Key 配置");
      }
      if (error.message.includes("status code 403")) {
        throw new Error("API 访问被拒绝，请检查 API Key 权限或账户状态");
      }
      if (error.message.includes("status code 429")) {
        throw new Error("API 请求频率超限或额度用尽，请稍后重试或检查账户余额");
      }

      throw error;
    }
  });
}

module.exports = { registerCodeHandlers };
