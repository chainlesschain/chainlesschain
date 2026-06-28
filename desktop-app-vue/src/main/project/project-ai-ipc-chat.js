/**
 * Project AI IPC handlers — chat group.
 * Split verbatim from project-ai-ipc.js registerProjectAIIPC(); ipcMain + deps via ctx.
 *
 * Carries the module-level PPT/Word helpers + activeChatAbortController,
 * which only the AI-Chat handlers use.
 * @module project/project-ai-ipc-chat
 */
const { logger } = require("../utils/logger.js");
const { looseParseJSON } = require("../ai-engine/response-parser.js");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

/**
 * 当前活跃的AI对话AbortController
 * 用于在主进程中取消正在进行的AI请求（因为AbortSignal无法通过IPC序列化）
 */
let activeChatAbortController = null;

/**
 * 从AI响应中提取PPT大纲
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} PPT大纲对象，如果没有则返回null
 */
function extractPPTOutline(aiResponse) {
  try {
    // 查找PPT大纲标记
    const startMarker = "**[PPT_OUTLINE_START]**";
    const endMarker = "**[PPT_OUTLINE_END]**";

    const startIndex = aiResponse.indexOf(startMarker);
    const endIndex = aiResponse.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
      logger.info("[PPT Detector] 未找到PPT大纲标记");
      return null;
    }

    // 提取标记之间的内容
    const outlineSection = aiResponse.substring(
      startIndex + startMarker.length,
      endIndex,
    );

    // 提取JSON
    let outline;
    try {
      outline = looseParseJSON(outlineSection);
    } catch {
      logger.warn("[PPT Detector] 未找到JSON格式的大纲");
      return null;
    }

    logger.info("[PPT Detector] 成功提取PPT大纲:", outline.title);
    return outline;
  } catch (error) {
    logger.error("[PPT Detector] 提取PPT大纲失败:", error);
    return null;
  }
}

/**
 * 生成PPT文件
 * @param {Object} outline - PPT大纲
 * @param {string} projectPath - 项目路径
 * @param {Object} project - 项目信息
 * @returns {Promise<Object>} 生成结果
 */
async function generatePPTFile(outline, projectPath, project) {
  try {
    const PPTEngine = require("../engines/ppt-engine");
    const pptEngine = new PPTEngine();

    // 生成PPT文件
    const outputPath = path.join(
      projectPath,
      `${outline.title || "presentation"}.pptx`,
    );

    logger.info("[PPT Generator] 开始生成PPT:", outline.title);
    logger.info("[PPT Generator] 输出路径:", outputPath);

    const result = await pptEngine.generateFromOutline(outline, {
      theme: "business",
      author: project.user_id || "作者",
      outputPath: outputPath,
    });

    logger.info("[PPT Generator] PPT生成成功:", result.fileName);

    return {
      success: true,
      generated: true,
      filePath: result.path,
      fileName: result.fileName,
      slideCount: result.slideCount,
      theme: result.theme,
    };
  } catch (error) {
    logger.error("[PPT Generator] 生成PPT失败:", error);
    return {
      success: false,
      generated: false,
      error: error.message,
    };
  }
}

/**
 * 检测Word文档生成请求
 * @param {string} userMessage - 用户消息
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} Word请求信息，如果没有则返回null
 */
function extractWordRequest(userMessage, aiResponse) {
  try {
    // 检测用户消息中的Word/docx关键词
    const userMsgLower = (userMessage || "").toLowerCase();
    const aiResponseLower = (aiResponse || "").toLowerCase();

    // BUGFIX: 增加更多文档关键词，支持 "生成...文档" 模式
    const wordKeywords = [
      "word",
      "docx",
      "doc文档",
      "word文档",
      "文档", // ✅ 通用关键词，匹配 "病历记录文档"、"技术文档" 等
      "生成文档",
      "创建文档",
      "生成一份", // ✅ 匹配 "生成一份病历记录"
      "文书", // ✅ 匹配 "医疗文书"
    ];
    const hasWordKeyword = wordKeywords.some(
      (keyword) =>
        userMsgLower.includes(keyword) || aiResponseLower.includes(keyword),
    );

    if (!hasWordKeyword) {
      logger.info("[Word Detector] 未检测到Word生成请求");
      return null;
    }

    // 提取文档描述
    let description = userMessage;

    // 尝试提取更具体的描述
    const descPatterns = [
      /生成(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
      /创建(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
      /写(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
    ];

    for (const pattern of descPatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        description = match[1].trim();
        break;
      }
    }

    logger.info("[Word Detector] 检测到Word生成请求");
    logger.info("[Word Detector] 文档描述:", description);

    return {
      description: description,
      format: "docx",
    };
  } catch (error) {
    logger.error("[Word Detector] 检测Word请求失败:", error);
    return null;
  }
}

/**
 * 生成Word文件
 * @param {Object} wordRequest - Word请求信息
 * @param {string} projectPath - 项目路径
 * @param {Object} llmManager - LLM管理器
 * @returns {Promise<Object>} 生成结果
 */
async function generateWordFile(wordRequest, projectPath, llmManager) {
  try {
    const wordEngine = require("../engines/word-engine");

    logger.info("[Word Generator] 开始生成Word文档");
    logger.info("[Word Generator] 描述:", wordRequest.description);
    logger.info("[Word Generator] 项目路径:", projectPath);

    const result = await wordEngine.handleProjectTask({
      description: wordRequest.description,
      projectPath: projectPath,
      llmManager: llmManager,
      action: "create_document",
    });

    logger.info("[Word Generator] Word文档生成成功:", result.fileName);

    return {
      success: true,
      generated: true,
      filePath: result.filePath,
      fileName: result.fileName,
      fileSize: result.fileSize,
    };
  } catch (error) {
    logger.error("[Word Generator] 生成Word文档失败:", error);
    return {
      success: false,
      generated: false,
      error: error.message,
    };
  }
}

function registerChatHandlers(ctx) {
  const {
    ipcMain,
    database,
    llmManager,
    chatSkillBridge,
    scanAndRegisterProjectFiles,
    mcpClientManager,
    mcpToolAdapter,
  } = ctx;

  // ============================================================
  // AI 对话功能 (AI Chat)
  // ============================================================

  /**
   * 项目AI对话 - 支持文件操作
   * Channel: 'project:aiChat'
   */
  ipcMain.handle("project:aiChat", async (_event, chatData) => {
    // 创建AbortController用于取消支持
    activeChatAbortController = new AbortController();
    const chatSignal = activeChatAbortController.signal;

    try {
      const { parseAIResponse } = require("../ai-engine/response-parser");
      const {
        executeOperations,
        ensureLogTable,
      } = require("../ai-engine/conversation-executor");
      const path = require("path");

      logger.info("[Main] 项目AI对话:", chatData);

      const {
        projectId,
        userMessage,
        conversationHistory,
        contextMode,
        currentFile,
        projectInfo,
        fileList,
      } = chatData;

      // 1. 检查数据库
      if (!database) {
        throw new Error("数据库未初始化");
      }

      // 2. 获取项目信息
      let project = database.db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);

      // 🔥 测试模式：如果项目不存在，创建虚拟测试项目
      const isTestMode = process.env.NODE_ENV === "test";
      if (!project && isTestMode) {
        logger.info("[Main] 测试模式：创建虚拟项目", projectId);
        const os = require("os");
        const tmpDir = path.join(
          os.tmpdir(),
          "chainlesschain-test-projects",
          projectId,
        );

        project = {
          id: projectId,
          name: chatData.context?.projectName || "Test Project",
          type: chatData.context?.projectType || "general",
          root_path: tmpDir,
          user_id: "test-user",
          created_at: Date.now(),
          updated_at: Date.now(),
          description: "Test project for E2E testing",
        };

        // 尝试在数据库中创建项目记录
        try {
          database.db
            .prepare(
              `
            INSERT OR IGNORE INTO projects (id, name, type, root_path, user_id, created_at, updated_at, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              project.id,
              project.name,
              project.type,
              project.root_path,
              project.user_id,
              project.created_at,
              project.updated_at,
              project.description,
            );
          logger.info("[Main] 测试项目已写入数据库:", projectId);
        } catch (dbError) {
          logger.warn(
            "[Main] 无法在数据库中创建测试项目（继续使用虚拟对象）:",
            dbError.message,
          );
        }

        // 确保测试项目目录存在
        try {
          const fs = require("fs");
          fs.mkdirSync(tmpDir, { recursive: true });
          logger.info("[Main] 测试项目目录已创建:", tmpDir);
        } catch (fsError) {
          logger.warn("[Main] 无法创建测试项目目录:", fsError.message);
        }
      }

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      let projectPath = project.root_path;

      // 🔥 修复：如果项目路径不存在，自动创建（解决PPT生成失败问题）
      if (!projectPath) {
        logger.warn("[Main] 项目路径未设置，自动创建项目目录");

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

      // 3. 确保日志表存在
      await ensureLogTable(database);

      // 4. 准备后端API请求数据
      const currentFilePath =
        currentFile && typeof currentFile === "object"
          ? currentFile.file_path
          : currentFile;

      // 5. 尝试调用后端AI服务，如果失败则使用本地LLM
      const AI_SERVICE_URL =
        process.env.AI_SERVICE_URL || "http://localhost:8001";
      let aiResponse = null;
      let operations = [];
      let rag_sources = [];
      let useLocalLLM = false;

      try {
        const requestData = {
          project_id: projectId,
          user_message: userMessage,
          conversation_history: conversationHistory || [],
          context_mode: contextMode || "project",
          current_file: currentFilePath || null,
          project_info: projectInfo || {
            name: project.name,
            description: project.description || "",
            type: project.project_type || "general",
          },
          file_list: fileList || [],
        };

        logger.info("[Main] 尝试连接后端AI服务:", AI_SERVICE_URL);

        const response = await axios.post(
          `${AI_SERVICE_URL}/api/projects/${projectId}/chat`,
          requestData,
          {
            timeout: 5000, // 5秒超时，快速失败
            signal: chatSignal,
          },
        );

        const responseData = response.data;
        aiResponse = responseData.response;
        operations = responseData.operations || [];
        rag_sources = responseData.rag_sources || [];

        logger.info("[Main] 后端AI服务响应成功");
      } catch (backendError) {
        logger.warn(
          "[Main] 后端AI服务不可用，切换到本地LLM:",
          backendError.message,
        );
        useLocalLLM = true;

        // 使用本地LLM管理器
        if (!llmManager) {
          throw new Error("LLM管理器未初始化，无法使用本地AI功能");
        }

        // 构建对话上下文
        const messages = [];

        // 添加系统提示
        const systemPrompt = `你是一个智能项目助手，正在协助用户处理项目: ${project.name}。
当前上下文模式: ${contextMode || "project"}
${currentFilePath ? `当前文件: ${currentFilePath}` : ""}

## 🎯 重要：PPT生成特殊指令（最高优先级）

**检测规则**：如果用户消息包含以下任一关键词，必须生成PPT大纲：
- "PPT" / "ppt"
- "幻灯片"
- "演示文稿" / "演示"
- "presentation"

**必须输出格式**（严格遵守）：

第一步：立即输出JSON大纲（必须使用标记包裹）

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "PPT标题（必填，20字以内）",
  "subtitle": "副标题（可选）",
  "sections": [
    {
      "title": "第一章节（必填）",
      "subsections": [
        {
          "title": "子主题1（必填）",
          "points": ["要点1（3-5个要点）", "要点2", "要点3"]
        },
        {
          "title": "子主题2",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    },
    {
      "title": "第二章节",
      "subsections": [
        {
          "title": "子主题",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    }
  ]
}
\`\`\`
**[PPT_OUTLINE_END]**

第二步：在大纲下方提供文字说明（可选）

**示例**：
用户："做一个新年致辞PPT"

你的回答必须是：

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "2026新年致辞",
  "subtitle": "迎接新征程",
  "sections": [
    {
      "title": "回顾2025",
      "subsections": [
        {
          "title": "年度成就",
          "points": ["业绩突破历史新高", "团队规模扩大50%", "产品获行业大奖"]
        }
      ]
    },
    {
      "title": "展望2026",
      "subsections": [
        {
          "title": "战略目标",
          "points": ["市场份额增长30%", "推出3款新产品", "拓展海外市场"]
        }
      ]
    },
    {
      "title": "致谢与祝福",
      "subsections": [
        {
          "title": "感谢团队",
          "points": ["感谢全体员工辛勤付出", "感谢合作伙伴信任支持", "祝愿大家新年快乐"]
        }
      ]
    }
  ]
}
\`\`\`
**[PPT_OUTLINE_END]**

我已为您生成了新年致辞PPT大纲，包含3个章节：回顾2025、展望2026、致谢与祝福。系统将自动生成.pptx文件并保存到项目目录。

---

对于非PPT请求，正常回答即可。请根据用户的问题提供有帮助的回答。`;

        messages.push({
          role: "system",
          content: systemPrompt,
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

        logger.info("[Main] 使用本地LLM，消息数量:", messages.length);

        // 🔥 火山引擎智能模型选择 + 工具调用（根据项目类型和对话场景）
        const chatOptions = {
          temperature: 0.7,
          maxTokens: 2000,
          signal: chatSignal,
        };

        const _useToolCalling = false;
        const toolsToUse = [];

        if (llmManager.provider === "volcengine") {
          try {
            // 根据项目类型和对话内容智能选择模型
            const scenario = {
              userBudget: "medium", // 默认中等预算
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
              // 检测深度思考需求
              if (/(分析|推理|思考|为什么|如何|怎么)/.test(userMessage)) {
                scenario.needsThinking = true;
                logger.info("[Main] 检测到需要深度思考");
              }

              // 🔥 检测是否需要联网搜索
              if (
                /(最新|今天|现在|实时|新闻|API文档|库文档|框架文档|技术文档)/.test(
                  userMessage,
                )
              ) {
                toolsToUse.push("web_search");
                logger.info("[Main] 检测到需要联网搜索（获取最新文档/信息）");
              }
            }

            // 智能选择模型
            const selectedModel = llmManager.selectVolcengineModel(scenario);
            if (selectedModel) {
              chatOptions.model = selectedModel.modelId;
              logger.info(
                "[Main] 项目AI对话智能选择模型:",
                selectedModel.modelName,
              );
              logger.info(
                "[Main] 预估成本: ¥",
                llmManager
                  .estimateCost(
                    selectedModel.modelId,
                    messages.reduce(
                      (sum, msg) => sum + (msg.content?.length || 0),
                      0,
                    ) / 4, // 粗略估计tokens
                    500, // 预估输出500 tokens
                    0,
                  )
                  .toFixed(4),
              );
            }
          } catch (selectError) {
            logger.warn(
              "[Main] 智能模型选择失败，使用默认配置:",
              selectError.message,
            );
          }
        }

        // 🔥 获取 MCP 工具（如果可用）
        let mcpFunctions = [];
        let mcpExecutor = null;

        if (mcpToolAdapter && mcpClientManager) {
          try {
            const connectedServers = mcpClientManager.getConnectedServers();
            if (connectedServers.length > 0) {
              const MCPFunctionExecutor = require("../mcp/mcp-function-executor");
              mcpExecutor = new MCPFunctionExecutor(
                mcpClientManager,
                mcpToolAdapter,
              );
              mcpFunctions = await mcpExecutor.getFunctions();

              if (mcpFunctions.length > 0) {
                logger.info(
                  "[Project AI] MCP 工具可用:",
                  mcpFunctions.map((f) => f.name).join(", "),
                );
              }
            }
          } catch (mcpError) {
            logger.warn("[Project AI] 获取 MCP 工具失败:", mcpError.message);
          }
        }

        // 调用本地LLM（根据是否需要工具调用选择不同方法）
        let llmResult;
        let usedMCPTools = false;

        // 🔥 优先使用 MCP 工具（如果有）
        if (mcpFunctions.length > 0 && mcpExecutor) {
          const provider = llmManager.provider;

          // OpenAI 和 DeepSeek 使用标准 chat 接口的 tools 参数
          if (provider === "openai" || provider === "deepseek") {
            logger.info(
              "[Project AI] 使用 MCP Function Calling，工具数:",
              mcpFunctions.length,
            );

            try {
              // 将 MCP 函数转换为 OpenAI tools 格式
              const tools = mcpFunctions.map((func) => ({
                type: "function",
                function: func,
              }));

              // 第一次调用：让 LLM 决定是否调用工具
              let result = await llmManager.chatWithMessages(messages, {
                ...chatOptions,
                tools: tools,
                tool_choice: "auto",
              });

              // 如果 LLM 请求调用工具
              let currentMessages = messages;
              while (result.message?.tool_calls) {
                const toolCalls = result.message.tool_calls;
                logger.info(
                  "[Project AI] LLM 请求调用",
                  toolCalls.length,
                  "个 MCP 工具",
                );

                // 执行所有工具调用
                const toolResults = [];
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(toolCall.function.arguments);

                  logger.info("[Project AI] 执行 MCP 工具:", functionName);

                  try {
                    const execResult = await mcpExecutor.execute(
                      functionName,
                      functionArgs,
                    );
                    toolResults.push({
                      tool_call_id: toolCall.id,
                      role: "tool",
                      content: JSON.stringify(execResult),
                    });
                  } catch (execError) {
                    logger.error(
                      "[Project AI] MCP 工具执行失败:",
                      execError.message,
                    );
                    toolResults.push({
                      tool_call_id: toolCall.id,
                      role: "tool",
                      content: JSON.stringify({ error: execError.message }),
                    });
                  }
                }

                // 将工具结果返回给 LLM
                currentMessages = [
                  ...currentMessages,
                  result.message,
                  ...toolResults,
                ];

                // 再次调用 LLM 获取最终回答
                result = await llmManager.chatWithMessages(currentMessages, {
                  ...chatOptions,
                  tools: tools,
                  tool_choice: "auto",
                });
              }

              llmResult = result;
              usedMCPTools = true;
            } catch (fcError) {
              logger.warn(
                "[Project AI] MCP Function Calling 失败，回退到标准对话:",
                fcError.message,
              );
            }
          }
        }

        // 如果没有使用 MCP 工具，使用标准对话
        // 🔥 注：模型回退逻辑已在 LLMManager 层实现，智能选择的模型不可用时会自动回退到用户配置的默认模型
        if (!usedMCPTools) {
          if (toolsToUse.length > 0 && toolsToUse.includes("web_search")) {
            // 使用通用联网搜索（不依赖特定LLM提供商）
            logger.info("[Main] 项目AI对话使用联网搜索");
            try {
              const { enhanceChatWithSearch } = require("../utils/web-search");

              // 使用搜索结果增强对话
              llmResult = await enhanceChatWithSearch(
                userMessage,
                messages,
                (msgs, opts) => llmManager.chat(msgs, opts),
                {
                  ...chatOptions,
                  maxResults: 5,
                  engine: "auto", // 自动选择可用搜索引擎（默认DuckDuckGo）
                },
              );
            } catch (searchError) {
              logger.warn(
                "[Main] 联网搜索失败，使用标准对话:",
                searchError.message,
              );
              llmResult = await llmManager.chat(messages, chatOptions);
            }
          } else {
            // 标准对话
            llmResult = await llmManager.chat(messages, chatOptions);
          }
        }

        aiResponse = llmResult.content || llmResult.text || llmResult;
        logger.info("[Main] 本地LLM响应成功");
      }

      logger.info("[Main] AI响应:", aiResponse);
      logger.info("[Main] 文件操作数量:", operations ? operations.length : 0);
      logger.info("[Main] 使用本地LLM:", useLocalLLM);

      // 6. 使用ChatSkillBridge拦截并处理
      let bridgeResult = null;
      if (chatSkillBridge) {
        try {
          logger.info("[Main] 使用ChatSkillBridge处理响应...");
          bridgeResult = await chatSkillBridge.interceptAndProcess(
            userMessage,
            aiResponse,
            {
              projectId,
              projectPath,
              currentFile: currentFilePath,
              conversationHistory,
            },
          );

          logger.info("[Main] 桥接器处理结果:", {
            shouldIntercept: bridgeResult.shouldIntercept,
            toolCallsCount: bridgeResult.toolCalls?.length || 0,
          });
        } catch (error) {
          logger.error("[Main] ChatSkillBridge处理失败:", error);
        }
      }

      // 7. 如果桥接器成功处理，返回增强响应
      if (bridgeResult && bridgeResult.shouldIntercept) {
        logger.info("[Main] 使用桥接器处理结果");

        // 🔥 检测并生成PPT（桥接器分支）
        let pptResult = null;
        try {
          const pptOutline = extractPPTOutline(aiResponse);
          if (pptOutline) {
            logger.info("[Main] 🎨 检测到PPT生成请求（桥接器分支）...");
            pptResult = await generatePPTFile(pptOutline, projectPath, project);

            if (pptResult.success && scanAndRegisterProjectFiles) {
              await scanAndRegisterProjectFiles(projectId, projectPath);
            }
          }
        } catch (pptError) {
          logger.error("[Main] PPT处理出错（桥接器分支）:", pptError);
        }

        // 🔥 检测并生成Word文档（桥接器分支）
        let wordResult = null;
        try {
          const wordRequest = extractWordRequest(userMessage, aiResponse);
          if (wordRequest) {
            logger.info("[Main] 📝 检测到Word文档生成请求（桥接器分支）...");
            wordResult = await generateWordFile(
              wordRequest,
              projectPath,
              llmManager,
            );

            if (wordResult.success && scanAndRegisterProjectFiles) {
              await scanAndRegisterProjectFiles(projectId, projectPath);
            }
          }
        } catch (wordError) {
          logger.error("[Main] Word处理出错（桥接器分支）:", wordError);
        }

        return {
          success: true,
          conversationResponse: bridgeResult.enhancedResponse,
          fileOperations: bridgeResult.executionResults || [],
          ragSources: rag_sources || [],
          hasFileOperations: bridgeResult.toolCalls.length > 0,
          usedBridge: true,
          useLocalLLM: useLocalLLM,
          toolCalls: bridgeResult.toolCalls,
          bridgeSummary: bridgeResult.summary,
          // 🔥 新增：PPT生成结果
          pptGenerated: pptResult?.generated || false,
          pptResult: pptResult,
          // 🔥 新增：Word生成结果
          wordGenerated: wordResult?.generated || false,
          wordResult: wordResult,
        };
      }

      // 8. 否则使用原有的解析逻辑
      logger.info("[Main] 使用原有解析逻辑");
      const parsed = parseAIResponse(aiResponse, operations);

      // 9. 执行文件操作（仅当使用后端服务时才执行文件操作）
      let operationResults = [];
      if (!useLocalLLM && parsed.hasFileOperations) {
        logger.info(`[Main] 执行 ${parsed.operations.length} 个文件操作`);

        try {
          operationResults = await executeOperations(
            parsed.operations,
            projectPath,
            database,
          );

          logger.info("[Main] 文件操作完成:", operationResults.length);
        } catch (error) {
          logger.error("[Main] 文件操作执行失败:", error);
          operationResults = [
            {
              status: "error",
              error: error.message,
            },
          ];
        }
      }

      // 10. 检测并生成PPT（如果AI响应包含PPT大纲）
      let pptResult = null;
      try {
        const pptOutline = extractPPTOutline(aiResponse);

        if (pptOutline) {
          logger.info("[Main] 🎨 检测到PPT生成请求，开始生成PPT文件...");
          pptResult = await generatePPTFile(pptOutline, projectPath, project);

          if (pptResult.success) {
            logger.info("[Main] ✅ PPT文件已生成:", pptResult.fileName);

            // 将生成的PPT文件添加到项目文件列表（可选）
            if (scanAndRegisterProjectFiles) {
              try {
                await scanAndRegisterProjectFiles(projectId, projectPath);
                logger.info("[Main] PPT文件已注册到项目");
              } catch (scanError) {
                logger.warn("[Main] 注册PPT文件失败:", scanError.message);
              }
            }
          } else {
            logger.error("[Main] ❌ PPT生成失败:", pptResult.error);
          }
        }
      } catch (pptError) {
        logger.error("[Main] PPT处理出错:", pptError);
        pptResult = {
          success: false,
          generated: false,
          error: pptError.message,
        };
      }

      // 10.5 检测并生成Word文档（如果用户请求生成Word文档）
      let wordResult = null;
      try {
        const wordRequest = extractWordRequest(userMessage, aiResponse);

        if (wordRequest) {
          logger.info("[Main] 📝 检测到Word文档生成请求，开始生成Word文件...");
          wordResult = await generateWordFile(
            wordRequest,
            projectPath,
            llmManager,
          );

          if (wordResult.success) {
            logger.info("[Main] ✅ Word文档已生成:", wordResult.fileName);

            // 将生成的Word文件添加到项目文件列表（可选）
            if (scanAndRegisterProjectFiles) {
              try {
                await scanAndRegisterProjectFiles(projectId, projectPath);
                logger.info("[Main] Word文件已注册到项目");
              } catch (scanError) {
                logger.warn("[Main] 注册Word文件失败:", scanError.message);
              }
            }
          } else {
            logger.error("[Main] ❌ Word生成失败:", wordResult.error);
          }
        }
      } catch (wordError) {
        logger.error("[Main] Word处理出错:", wordError);
        wordResult = {
          success: false,
          generated: false,
          error: wordError.message,
        };
      }

      // 11. 返回结果
      return {
        success: true,
        conversationResponse: aiResponse,
        fileOperations: operationResults,
        ragSources: rag_sources || [],
        hasFileOperations: !useLocalLLM && parsed.hasFileOperations,
        usedBridge: false,
        useLocalLLM: useLocalLLM,
        // 🔥 新增：PPT生成结果
        pptGenerated: pptResult?.generated || false,
        pptResult: pptResult,
        // 🔥 新增：Word生成结果
        wordGenerated: wordResult?.generated || false,
        wordResult: wordResult,
      };
    } catch (error) {
      // 检查是否是用户主动取消（AbortError for fetch, ERR_CANCELED for axios）
      if (
        error.name === "AbortError" ||
        error.code === "ERR_CANCELED" ||
        chatSignal.aborted
      ) {
        logger.info("[Main] AI对话已被用户取消");
        return {
          success: false,
          cancelled: true,
          conversationResponse: "对话已取消。",
        };
      }

      logger.error("[Main] 项目AI对话失败:", error);

      // 提供更友好的错误信息
      if (error.message.includes("LLM管理器未初始化")) {
        throw new Error(
          "AI功能未配置，请在设置中配置LLM服务（Ollama或云端API）",
        );
      }

      if (
        error.code === "ECONNREFUSED" ||
        error.message.includes("ECONNREFUSED")
      ) {
        throw new Error("后端AI服务未运行，已尝试使用本地LLM但配置不正确");
      }

      throw error;
    } finally {
      activeChatAbortController = null;
    }
  });

  /**
   * 取消正在进行的AI对话请求
   * Channel: 'project:cancelAiChat'
   */
  ipcMain.handle("project:cancelAiChat", async () => {
    if (activeChatAbortController) {
      logger.info("[Main] 用户取消AI对话请求");
      activeChatAbortController.abort("用户取消");
      activeChatAbortController = null;
      return { success: true, message: "已取消" };
    }
    return { success: true, message: "没有正在进行的请求" };
  });

  /**
   * 扫描项目文件夹并添加到数据库
   * Channel: 'project:scan-files'
   */
  ipcMain.handle("project:scan-files", async (_event, projectId) => {
    try {
      logger.info(`[Main] 扫描项目文件: ${projectId}`);
      const project = database.db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);
      if (!project) {
        throw new Error("项目不存在");
      }
      const rootPath = project.root_path || project.folder_path;
      if (!rootPath) {
        throw new Error("项目没有根路径");
      }

      const fs = require("fs").promises;
      const path = require("path");
      const addedFiles = [];

      async function scanDir(dir, base) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(base, fullPath);
          if (/(^|[/\\])\.|node_modules|\.git|dist|build/.test(relativePath)) {
            continue;
          }
          if (entry.isDirectory()) {
            await scanDir(fullPath, base);
          } else if (entry.isFile()) {
            addedFiles.push({ fullPath, relativePath });
          }
        }
      }

      await scanDir(rootPath, rootPath);
      logger.info(`[Main] 找到 ${addedFiles.length} 个文件`);

      let added = 0,
        skipped = 0;
      for (const { fullPath, relativePath } of addedFiles) {
        try {
          const exists = database.db
            .prepare(
              "SELECT id FROM project_files WHERE project_id = ? AND file_path = ?",
            )
            .get(projectId, relativePath);
          if (exists) {
            skipped++;
            continue;
          }

          const content = await fs.readFile(fullPath, "utf8");
          const stats = await fs.stat(fullPath);
          const hash = crypto
            .createHash("sha256")
            .update(content, "utf8")
            .digest("hex");
          const ext = path.extname(relativePath).substring(1);
          const fileId =
            "file_" +
            Date.now() +
            "_" +
            Math.random().toString(36).substring(7);
          const now = Date.now();

          database.db
            .prepare(
              `INSERT INTO project_files (
            id, project_id, file_name, file_path, file_type, content, content_hash,
            file_size, created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              fileId,
              projectId,
              path.basename(relativePath),
              relativePath,
              ext || "file",
              content,
              hash,
              stats.size,
              now,
              now,
              "synced",
            );

          added++;
        } catch (fileError) {
          logger.error(
            `[Main] 添加文件失败 ${relativePath}:`,
            fileError.message,
          );
        }
      }

      database.saveToFile();
      logger.info(`[Main] 扫描完成: 添加 ${added} 个，跳过 ${skipped} 个`);

      return {
        success: true,
        added,
        skipped,
        total: addedFiles.length,
      };
    } catch (error) {
      logger.error("[Main] 扫描文件失败:", error);
      throw error;
    }
  });
}

module.exports = { registerChatHandlers };
