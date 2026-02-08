/**
 * LLM服务 IPC 处理器
 * 负责处理 LLM 相关的前后端通信
 *
 * @module llm-ipc
 * @description 提供 LLM 服务的所有 IPC 接口，包括聊天、查询、配置管理、智能选择等
 */

const { logger } = require("../utils/logger.js");
const defaultIpcGuard = require("../ipc/ipc-guard");

/**
 * 🔥 检测任务类型（用于 Multi-Agent 路由）
 * @param {string} content - 用户消息内容
 * @returns {string} 任务类型
 */
function detectTaskType(content) {
  if (!content || typeof content !== "string") {
    return "general";
  }

  const lowerContent = content.toLowerCase();

  // 代码相关任务
  if (
    /写代码|编写|实现|代码|函数|class|function|重构|优化代码|bug|修复|调试/i.test(
      content,
    ) ||
    /```|代码块/.test(content)
  ) {
    return "code_generation";
  }

  // 数据分析任务
  if (
    /分析数据|统计|图表|可视化|趋势|预测|数据集|excel|csv|json.*数据/i.test(
      content,
    )
  ) {
    return "data_analysis";
  }

  // 文档相关任务
  if (/写文档|文档|翻译|摘要|总结|格式化|markdown|报告|文章/i.test(content)) {
    return "document";
  }

  // 知识问答
  if (/什么是|如何|怎么|为什么|解释|介绍|告诉我/i.test(content)) {
    return "knowledge_qa";
  }

  return "general";
}

/**
 * 注册所有 LLM IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} [dependencies.ragManager] - RAG 管理器（可选，用于RAG增强）
 * @param {Object} [dependencies.promptTemplateManager] - 提示词模板管理器（可选）
 * @param {Object} [dependencies.llmSelector] - LLM 智能选择器（可选）
 * @param {Object} [dependencies.database] - 数据库实例（可选）
 * @param {Object} [dependencies.app] - App 实例（可选，用于更新 llmManager 引用）
 * @param {Object} [dependencies.tokenTracker] - Token 追踪器（可选）
 * @param {Object} [dependencies.promptCompressor] - Prompt 压缩器（可选）
 * @param {Object} [dependencies.responseCache] - 响应缓存（可选）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.mcpClientManager] - MCP 客户端管理器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.mcpToolAdapter] - MCP 工具适配器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.sessionManager] - 会话管理器（可选，用于自动会话追踪）
 * @param {Object} [dependencies.agentOrchestrator] - Agent 协调器（可选，用于Multi-Agent路由）
 * @param {Object} [dependencies.errorMonitor] - 错误监控器（可选，用于AI诊断）
 */
function registerLLMIPC({
  llmManager,
  mainWindow,
  ragManager,
  promptTemplateManager,
  llmSelector,
  database,
  app,
  tokenTracker,
  promptCompressor,
  responseCache,
  ipcMain: injectedIpcMain,
  mcpClientManager,
  mcpToolAdapter,
  // 🔥 新增：高级特性依赖
  sessionManager,
  agentOrchestrator,
  errorMonitor,
  // 依赖注入支持（用于测试）
  ipcGuard: injectedIpcGuard,
}) {
  // 支持依赖注入，用于测试
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("llm-ipc")) {
    logger.info("[LLM IPC] Handlers already registered, skipping...");
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info("[LLM IPC] Registering LLM IPC handlers...");

  // 🔥 在测试模式下，如果 llmManager 为 null，创建 Mock LLM 服务
  let effectiveManager = llmManager;
  const isTestMode =
    process.env.NODE_ENV === "test" && process.env.MOCK_LLM === "true";

  if (isTestMode && !effectiveManager) {
    logger.info("[LLM IPC] 测试模式且无 LLM Manager，创建 Mock LLM 服务");
    try {
      const { getTestModeConfig } = require("../config/test-mode-config");
      const testModeConfig = getTestModeConfig();
      effectiveManager = testModeConfig.getMockLLMService();
      logger.info("[LLM IPC] ✓ Mock LLM 服务已创建");
    } catch (error) {
      logger.error("[LLM IPC] 创建 Mock LLM 服务失败:", error);
    }
  }

  // 创建一个可变的引用容器
  const managerRef = { current: effectiveManager };

  // ============================================================
  // 基础 LLM 服务
  // ============================================================

  /**
   * 检查 LLM 服务状态
   * Channel: 'llm:check-status'
   */
  ipcMain.handle("llm:check-status", async () => {
    try {
      if (!managerRef.current) {
        return {
          available: false,
          error: "LLM服务未初始化",
        };
      }

      return await managerRef.current.checkStatus();
    } catch (error) {
      return {
        available: false,
        error: error.message,
      };
    }
  });

  /**
   * LLM 查询（简单文本）
   * Channel: 'llm:query'
   */
  ipcMain.handle("llm:query", async (_event, prompt, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM服务未初始化");
      }

      return await managerRef.current.query(prompt, options);
    } catch (error) {
      logger.error("[LLM IPC] LLM查询失败:", error);
      throw error;
    }
  });

  /**
   * LLM 聊天对话（支持 messages 数组格式，保留完整对话历史，自动RAG增强）
   *
   * 🔥 v2.0 增强版：集成以下高级特性
   * - SessionManager: 自动会话追踪和压缩
   * - Manus Optimizations: Context Engineering + Tool Masking
   * - Multi-Agent: 复杂任务自动路由到专用Agent
   * - ErrorMonitor: AI诊断预检查
   *
   * Channel: 'llm:chat'
   */
  ipcMain.handle(
    "llm:chat",
    async (
      _event,
      {
        messages,
        stream = false,
        enableRAG = true,
        enableCache = true,
        enableCompression = true,
        // 🔥 新增：高级特性控制
        enableSessionTracking = true,
        enableManusOptimization = true,
        enableMultiAgent = true,
        enableErrorPrecheck = true,
        sessionId = null,
        conversationId = null,
        ...options
      },
    ) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        logger.info(
          "[LLM IPC] LLM 聊天请求, messages:",
          messages?.length || 0,
          "stream:",
          stream,
          "RAG:",
          enableRAG,
          "Cache:",
          enableCache,
          "Compress:",
          enableCompression,
          "Session:",
          enableSessionTracking,
          "Manus:",
          enableManusOptimization,
          "MultiAgent:",
          enableMultiAgent,
        );

        // 🔥 高级特性集成结果
        const integrationResults = {
          sessionUsed: false,
          sessionId: null,
          manusOptimized: false,
          multiAgentRouted: false,
          agentUsed: null,
          errorPrechecked: false,
        };

        const provider = managerRef.current.provider;
        const model =
          options.model || managerRef.current.config.model || "unknown";

        // ============================================================
        // 🔥 高级特性整合 - 步骤 0: 预检查和会话管理
        // ============================================================

        // 🔥 0.1: ErrorMonitor 预检查（如果启用）
        if (enableErrorPrecheck && errorMonitor) {
          try {
            // 检查系统状态，提前发现可能的问题
            const prechecks = [];

            // 检查 LLM 服务是否暂停（预算超限）
            if (managerRef.current.paused) {
              throw new Error(
                "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
              );
            }

            integrationResults.errorPrechecked = true;
            logger.info("[LLM IPC] ✓ ErrorMonitor 预检查通过");
          } catch (precheckError) {
            logger.warn(
              "[LLM IPC] ErrorMonitor 预检查失败:",
              precheckError.message,
            );
            // 记录错误但不阻塞（除非是服务暂停）
            if (precheckError.message.includes("预算超限")) {
              throw precheckError;
            }
          }
        }

        // 🔥 0.2: SessionManager 会话追踪（如果启用）
        let currentSessionId = sessionId;
        let currentConversationId =
          conversationId || options.conversationId || `conv-${Date.now()}`;

        if (enableSessionTracking && sessionManager) {
          try {
            // 如果有 sessionId，加载现有会话
            if (currentSessionId) {
              try {
                const session =
                  await sessionManager.loadSession(currentSessionId);
                currentConversationId = session.conversationId;
                logger.info("[LLM IPC] ✓ 加载现有会话:", currentSessionId);
              } catch (loadError) {
                logger.warn("[LLM IPC] 会话不存在，将创建新会话");
                currentSessionId = null;
              }
            }

            // 如果没有 sessionId，创建新会话
            if (!currentSessionId) {
              const lastUserMsg = [...messages]
                .reverse()
                .find((msg) => msg.role === "user");
              const sessionTitle = lastUserMsg
                ? typeof lastUserMsg.content === "string"
                  ? lastUserMsg.content.substring(0, 50)
                  : "AI对话"
                : "AI对话";

              const newSession = await sessionManager.createSession({
                conversationId: currentConversationId,
                title: sessionTitle,
                metadata: { provider, model },
              });
              currentSessionId = newSession.id;
              logger.info("[LLM IPC] ✓ 创建新会话:", currentSessionId);
            }

            // 添加用户消息到会话
            const lastUserMsg = [...messages]
              .reverse()
              .find((msg) => msg.role === "user");
            if (lastUserMsg) {
              await sessionManager.addMessage(currentSessionId, {
                role: "user",
                content: lastUserMsg.content,
              });
            }

            integrationResults.sessionUsed = true;
            integrationResults.sessionId = currentSessionId;
          } catch (sessionError) {
            logger.warn(
              "[LLM IPC] SessionManager 会话追踪失败:",
              sessionError.message,
            );
            // 不阻塞主流程
          }
        }

        // 🔥 0.3: Multi-Agent 路由检查（如果启用）
        let agentResult = null;
        if (enableMultiAgent && agentOrchestrator) {
          try {
            const lastUserMsg = [...messages]
              .reverse()
              .find((msg) => msg.role === "user");
            if (lastUserMsg) {
              const userContent =
                typeof lastUserMsg.content === "string"
                  ? lastUserMsg.content
                  : JSON.stringify(lastUserMsg.content);

              // 构建任务对象
              const task = {
                type: detectTaskType(userContent),
                input: userContent,
                context: { messages, provider, model },
              };

              // 检查是否有 Agent 能处理此任务
              const capableAgents = agentOrchestrator.getCapableAgents(task);

              if (capableAgents.length > 0 && capableAgents[0].score > 0.7) {
                logger.info(
                  "[LLM IPC] 🤖 发现高匹配度 Agent:",
                  capableAgents[0].agentId,
                  "得分:",
                  capableAgents[0].score,
                );

                // 分发任务到 Agent
                try {
                  agentResult = await agentOrchestrator.dispatch(task);
                  integrationResults.multiAgentRouted = true;
                  integrationResults.agentUsed = capableAgents[0].agentId;
                  logger.info("[LLM IPC] ✓ Multi-Agent 任务执行完成");

                  // 如果 Agent 返回了完整的响应，直接返回
                  if (agentResult && agentResult.response) {
                    // 记录到 SessionManager
                    if (
                      enableSessionTracking &&
                      sessionManager &&
                      currentSessionId
                    ) {
                      await sessionManager.addMessage(currentSessionId, {
                        role: "assistant",
                        content: agentResult.response,
                      });
                    }

                    return {
                      content: agentResult.response,
                      message: {
                        role: "assistant",
                        content: agentResult.response,
                      },
                      usage: agentResult.usage || { total_tokens: 0 },
                      retrievedDocs: [],
                      wasCached: false,
                      wasCompressed: false,
                      ...integrationResults,
                      agentResult: agentResult,
                    };
                  }
                } catch (agentError) {
                  logger.warn(
                    "[LLM IPC] Agent 执行失败，回退到标准流程:",
                    agentError.message,
                  );
                }
              }
            }
          } catch (agentCheckError) {
            logger.warn(
              "[LLM IPC] Multi-Agent 路由检查失败:",
              agentCheckError.message,
            );
            // 不阻塞主流程
          }
        }

        // ============================================================
        // 原有逻辑继续
        // ============================================================

        // 🔥 优化步骤 1: 检查缓存
        if (enableCache && responseCache && !stream) {
          try {
            const cached = await responseCache.get(
              provider,
              model,
              messages,
              options,
            );

            if (cached.hit) {
              logger.info(
                "[LLM IPC] 🎯 缓存命中! 节省",
                cached.tokensSaved,
                "tokens",
              );

              // 记录缓存命中到 TokenTracker
              if (tokenTracker) {
                await tokenTracker.recordUsage({
                  conversationId: options.conversationId,
                  messageId: options.messageId,
                  provider,
                  model,
                  inputTokens: 0,
                  outputTokens: 0,
                  cachedTokens: cached.tokensSaved || 0,
                  wasCached: true,
                  wasCompressed: false,
                  compressionRatio: 1.0,
                  responseTime: 0,
                  endpoint: options.endpoint,
                  userId: options.userId || "default",
                });
              }

              // 返回缓存的响应
              return {
                content: cached.response.content || cached.response.text || "",
                message: cached.response.message || {
                  role: "assistant",
                  content:
                    cached.response.content || cached.response.text || "",
                },
                usage: cached.response.usage || {
                  total_tokens: 0,
                },
                wasCached: true,
                tokensSaved: cached.tokensSaved,
                cacheAge: cached.cacheAge,
                retrievedDocs: [],
              };
            }
          } catch (cacheError) {
            logger.warn(
              "[LLM IPC] 缓存检查失败，继续正常流程:",
              cacheError.message,
            );
          }
        }

        // 🔥 火山引擎智能模型选择 + 工具调用自动启用
        const toolsToUse = [];
        if (managerRef.current.provider === "volcengine" && !options.model) {
          try {
            const TaskTypes = require("./volcengine-models").TaskTypes;

            // 分析对话场景，智能选择模型
            const scenario = {
              userBudget: options.userBudget || "medium",
            };

            // 分析消息内容，判断是否需要特殊能力
            const lastUserMsg = [...messages]
              .reverse()
              .find((msg) => msg.role === "user");
            if (lastUserMsg) {
              const content = lastUserMsg.content;

              // 检查是否需要深度思考（复杂问题、分析、推理）
              if (/(为什么|怎么|如何|分析|推理|思考|解释|原理)/.test(content)) {
                scenario.needsThinking = true;
                logger.info("[LLM IPC] 检测到需要深度思考");
              }

              // 检查是否包含代码（代码生成、调试）
              if (
                /(代码|函数|class|function|编程|bug|调试)/.test(content) ||
                /```/.test(content)
              ) {
                scenario.needsCodeGeneration = true;
                logger.info("[LLM IPC] 检测到代码相关任务");
              }

              // 检查上下文长度，如果消息很多或很长，选择大上下文模型
              const totalLength = messages.reduce(
                (sum, msg) => sum + (msg.content?.length || 0),
                0,
              );
              if (totalLength > 10000 || messages.length > 20) {
                scenario.needsLongContext = true;
                logger.info(
                  "[LLM IPC] 检测到长上下文需求，总长度:",
                  totalLength,
                );
              }

              // 🔥 检测是否需要联网搜索
              if (
                /(最新|今天|现在|实时|新闻|天气|股票|汇率|当前|最近)/.test(
                  content,
                )
              ) {
                toolsToUse.push("web_search");
                logger.info("[LLM IPC] 检测到需要联网搜索");
              }

              // 🔥 检测是否包含图片（多模态消息）
              if (Array.isArray(lastUserMsg.content)) {
                const hasImage = lastUserMsg.content.some(
                  (item) => item.type === "image_url",
                );
                if (hasImage) {
                  scenario.hasImage = true;
                  toolsToUse.push("image_process");
                  logger.info("[LLM IPC] 检测到图片输入");
                }
              }
            }

            // 智能选择模型
            const selectedModel =
              managerRef.current.selectVolcengineModel(scenario);
            if (selectedModel) {
              options.model = selectedModel.modelId;
              logger.info(
                "[LLM IPC] 智能选择火山引擎模型:",
                selectedModel.modelName,
                "(",
                selectedModel.modelId,
                ")",
              );
            }
          } catch (selectError) {
            logger.warn(
              "[LLM IPC] 智能模型选择失败，使用默认配置:",
              selectError.message,
            );
          }
        }

        let enhancedMessages = messages;
        let retrievedDocs = [];
        let compressionResult = null;

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
                  "[LLM IPC] MCP 工具可用:",
                  mcpFunctions.map((f) => f.name).join(", "),
                );
              }
            }
          } catch (mcpError) {
            logger.warn("[LLM IPC] 获取 MCP 工具失败:", mcpError.message);
          }
        }

        // 如果启用RAG，自动检索知识库并增强上下文
        if (enableRAG && ragManager) {
          try {
            // 获取最后一条用户消息作为查询
            const lastUserMessage = [...messages]
              .reverse()
              .find((msg) => msg.role === "user");

            if (lastUserMessage) {
              const query = lastUserMessage.content;

              // 检索相关知识
              const ragResult = await ragManager.enhanceQuery(query, {
                topK: options.ragTopK || 3,
                includeMetadata: true,
              });

              if (
                ragResult.retrievedDocs &&
                ragResult.retrievedDocs.length > 0
              ) {
                logger.info(
                  "[LLM IPC] RAG检索到",
                  ragResult.retrievedDocs.length,
                  "条相关知识",
                );
                retrievedDocs = ragResult.retrievedDocs;

                // 构建知识库上下文
                const knowledgeContext = ragResult.retrievedDocs
                  .map(
                    (doc, idx) =>
                      `[知识${idx + 1}] ${doc.title || doc.content.substring(0, 50)}\n${doc.content}`,
                  )
                  .join("\n\n");

                // 在消息数组中插入知识库上下文
                // 如果有系统消息，追加到系统消息；否则创建新的系统消息
                const systemMsgIndex = messages.findIndex(
                  (msg) => msg.role === "system",
                );

                if (systemMsgIndex >= 0) {
                  enhancedMessages = [...messages];
                  enhancedMessages[systemMsgIndex] = {
                    ...messages[systemMsgIndex],
                    content: `${messages[systemMsgIndex].content}\n\n## 知识库参考\n${knowledgeContext}`,
                  };
                } else {
                  enhancedMessages = [
                    {
                      role: "system",
                      content: `## 知识库参考\n以下是从知识库中检索到的相关信息，请参考这些内容来回答用户的问题：\n\n${knowledgeContext}`,
                    },
                    ...messages,
                  ];
                }
              }
            }
          } catch (ragError) {
            logger.error("[LLM IPC] RAG检索失败，继续普通对话:", ragError);
          }
        }

        // 🔥 优化步骤 2: Prompt 压缩（在 RAG 增强之后）
        if (
          enableCompression &&
          promptCompressor &&
          enhancedMessages.length > 3
        ) {
          try {
            compressionResult = await promptCompressor.compress(
              enhancedMessages,
              {
                preserveSystemMessage: true,
                preserveLastUserMessage: true,
              },
            );

            if (compressionResult.compressionRatio < 0.95) {
              logger.info(
                "[LLM IPC] ⚡ Prompt 压缩成功! 压缩率:",
                compressionResult.compressionRatio.toFixed(2),
                "节省",
                compressionResult.tokensSaved,
                "tokens",
              );
              enhancedMessages = compressionResult.messages;
            } else {
              logger.info("[LLM IPC] Prompt 压缩效果不明显，使用原始消息");
              compressionResult = null;
            }
          } catch (compressError) {
            logger.warn(
              "[LLM IPC] Prompt 压缩失败，使用原始消息:",
              compressError.message,
            );
            compressionResult = null;
          }
        }

        // 🔥 根据检测结果选择调用方法（MCP工具调用 vs 火山引擎工具 vs 普通对话）
        let response;
        let usedMCPTools = false;

        // 🔥 优先使用 MCP 工具（如果有）
        if (mcpFunctions.length > 0 && mcpExecutor) {
          const provider = managerRef.current.provider;

          // 火山引擎使用 executeFunctionCalling 方法
          if (provider === "volcengine" && managerRef.current.toolsClient) {
            logger.info(
              "[LLM IPC] 使用火山引擎 Function Calling，MCP 工具数:",
              mcpFunctions.length,
            );

            try {
              response =
                await managerRef.current.toolsClient.executeFunctionCalling(
                  enhancedMessages,
                  mcpFunctions,
                  mcpExecutor,
                  options,
                );

              // 转换为统一格式
              response = {
                text: response.text || "",
                message: response.message || {
                  role: "assistant",
                  content: response.text || "",
                },
                usage: response.usage,
                tokens: response.usage?.total_tokens || 0,
              };
              usedMCPTools = true;
            } catch (fcError) {
              logger.warn(
                "[LLM IPC] 火山引擎 Function Calling 失败，回退到标准对话:",
                fcError.message,
              );
            }
          }
          // OpenAI 和 DeepSeek 使用标准 chat 接口的 tools 参数
          else if (provider === "openai" || provider === "deepseek") {
            logger.info(
              "[LLM IPC] 使用 OpenAI 兼容 Function Calling，MCP 工具数:",
              mcpFunctions.length,
            );

            try {
              // 将 MCP 函数转换为 OpenAI tools 格式
              const tools = mcpFunctions.map((func) => ({
                type: "function",
                function: func,
              }));

              // 第一次调用：让 LLM 决定是否调用工具
              let result = await managerRef.current.chatWithMessages(
                enhancedMessages,
                {
                  ...options,
                  tools: tools,
                  tool_choice: "auto",
                },
              );

              // 如果 LLM 请求调用工具
              let currentMessages = enhancedMessages;
              while (result.message?.tool_calls) {
                const toolCalls = result.message.tool_calls;
                logger.info(
                  "[LLM IPC] LLM 请求调用",
                  toolCalls.length,
                  "个 MCP 工具",
                );

                // 执行所有工具调用
                const toolResults = [];
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(toolCall.function.arguments);

                  logger.info("[LLM IPC] 执行 MCP 工具:", functionName);

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
                      "[LLM IPC] MCP 工具执行失败:",
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
                result = await managerRef.current.chatWithMessages(
                  currentMessages,
                  {
                    ...options,
                    tools: tools,
                    tool_choice: "auto",
                  },
                );
              }

              response = result;
              usedMCPTools = true;
            } catch (fcError) {
              logger.warn(
                "[LLM IPC] OpenAI Function Calling 失败，回退到标准对话:",
                fcError.message,
              );
            }
          }
        }

        // 🔥 如果没有使用 MCP 工具，检查火山引擎内置工具
        if (
          !usedMCPTools &&
          toolsToUse.length > 0 &&
          managerRef.current.provider === "volcengine" &&
          managerRef.current.toolsClient
        ) {
          logger.info("[LLM IPC] 使用火山引擎内置工具:", toolsToUse.join(", "));

          // 如果只有一个工具，使用专用方法
          if (toolsToUse.length === 1) {
            const tool = toolsToUse[0];
            if (tool === "web_search") {
              response = await managerRef.current.chatWithWebSearch(
                enhancedMessages,
                {
                  ...options,
                  searchMode: options.searchMode || "auto",
                },
              );
            } else if (tool === "image_process") {
              response = await managerRef.current.chatWithImageProcess(
                enhancedMessages,
                options,
              );
            }

            // 转换为统一格式
            response = {
              text: response.choices?.[0]?.message?.content || "",
              message: response.choices?.[0]?.message,
              usage: response.usage,
              tokens: response.usage?.total_tokens || 0,
            };
          } else {
            // 多个工具，使用混合工具调用
            const toolConfig = {};
            if (toolsToUse.includes("web_search")) {
              toolConfig.enableWebSearch = true;
            }
            if (toolsToUse.includes("image_process")) {
              toolConfig.enableImageProcess = true;
            }

            response = await managerRef.current.chatWithMultipleTools(
              enhancedMessages,
              toolConfig,
              options,
            );

            // 转换为统一格式
            response = {
              text: response.choices?.[0]?.message?.content || "",
              message: response.choices?.[0]?.message,
              usage: response.usage,
              tokens: response.usage?.total_tokens || 0,
            };
          }
        }
        // 🔥 标准对话（无工具调用）
        else if (!usedMCPTools) {
          // 🔥 使用 Manus 优化的 chatWithOptimizedPrompt（如果启用）
          if (
            enableManusOptimization &&
            managerRef.current.manusOptimizations
          ) {
            logger.info("[LLM IPC] 使用 Manus Context Engineering 优化");
            response = await managerRef.current.chatWithOptimizedPrompt(
              enhancedMessages,
              {
                ...options,
                systemPrompt: options.systemPrompt,
              },
            );
            integrationResults.manusOptimized = true;
            logger.info("[LLM IPC] ✓ Manus 优化已应用");
          } else {
            // 使用标准的 chatWithMessages 方法，保留完整的 messages 历史
            response = await managerRef.current.chatWithMessages(
              enhancedMessages,
              options,
            );
          }
        }

        logger.info("[LLM IPC] LLM 聊天响应成功, tokens:", response.tokens);

        // 🔥 记录 AI 响应到 SessionManager
        if (
          enableSessionTracking &&
          sessionManager &&
          currentSessionId &&
          response
        ) {
          try {
            const assistantContent =
              response.text || response.message?.content || "";
            if (assistantContent) {
              await sessionManager.addMessage(currentSessionId, {
                role: "assistant",
                content: assistantContent,
              });
              logger.info("[LLM IPC] ✓ AI响应已记录到会话");
            }
          } catch (sessionRecordError) {
            logger.warn(
              "[LLM IPC] 记录AI响应到会话失败:",
              sessionRecordError.message,
            );
          }
        }

        // 🔥 优化步骤 3: 缓存响应（缓存未命中的情况）
        if (enableCache && responseCache && !stream) {
          try {
            // 使用原始的 messages 作为缓存键（而非压缩后的）
            await responseCache.set(
              provider,
              model,
              messages,
              {
                content: response.text,
                text: response.text,
                message: response.message,
                usage: response.usage,
                tokens: response.tokens,
              },
              options,
            );

            logger.info("[LLM IPC] 响应已缓存");
          } catch (cacheError) {
            logger.warn("[LLM IPC] 缓存响应失败:", cacheError.message);
          }
        }

        // 构建最终响应
        const finalResponse = {
          content: response.text,
          message: response.message || {
            role: "assistant",
            content: response.text,
          },
          usage: response.usage || {
            total_tokens: response.tokens || 0,
          },
          // 返回检索到的知识库文档，供前端展示引用
          retrievedDocs: retrievedDocs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            content: doc.content.substring(0, 200), // 只返回摘要
            score: doc.score,
          })),
          // 🔥 优化信息
          wasCached: false,
          wasCompressed: compressionResult !== null,
          compressionRatio: compressionResult?.compressionRatio || 1.0,
          tokensSaved: compressionResult?.tokensSaved || 0,
          optimizationStrategy: compressionResult?.strategy || "none",
          // 🔥 MCP 工具使用信息
          usedMCPTools: usedMCPTools,
          mcpToolsAvailable: mcpFunctions.length,
          // 🔥 高级特性集成信息
          ...integrationResults,
          // Manus 优化详情（如果启用）
          promptOptimization: response.promptOptimization || null,
        };

        return finalResponse;
      } catch (error) {
        logger.error("[LLM IPC] LLM 聊天失败:", error);

        // 🔥 使用 ErrorMonitor 进行错误分析（如果启用）
        if (errorMonitor) {
          try {
            const analysis = await errorMonitor.analyzeError(error);
            logger.info("[LLM IPC] ErrorMonitor 错误分析完成:", {
              classification: analysis.classification,
              severity: analysis.severity,
              hasAIDiagnosis: !!analysis.aiDiagnosis,
            });

            // 如果有 AI 诊断，附加到错误信息
            if (analysis.aiDiagnosis) {
              error.aiDiagnosis = analysis.aiDiagnosis;
              error.recommendations = analysis.recommendations;
            }
          } catch (analysisError) {
            logger.warn(
              "[LLM IPC] ErrorMonitor 分析失败:",
              analysisError.message,
            );
          }
        }

        throw error;
      }
    },
  );

  /**
   * 使用提示词模板进行聊天
   * Channel: 'llm:chat-with-template'
   */
  ipcMain.handle(
    "llm:chat-with-template",
    async (_event, { templateId, variables, messages = [], ...options }) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        logger.info("[LLM IPC] 使用模板进行聊天, templateId:", templateId);

        let filledPrompt;

        // 🔥 在测试模式或 promptTemplateManager 未初始化时，使用简单的模板填充
        if (!promptTemplateManager || isTestMode) {
          logger.info("[LLM IPC] 测试模式：使用简单模板填充");
          // 简单的模板填充逻辑
          const templates = {
            "code-review": `Please review the following ${variables?.language || "code"}:\n\n${variables?.code || ""}`,
            translate: `Please translate the following text to ${variables?.targetLanguage || "English"}:\n\n${variables?.text || ""}`,
            summarize: `Please summarize the following text:\n\n${variables?.text || ""}`,
          };
          filledPrompt =
            templates[templateId] ||
            `Template: ${templateId}\nVariables: ${JSON.stringify(variables)}`;
        } else {
          // 填充模板变量
          filledPrompt = await promptTemplateManager.fillTemplate(
            templateId,
            variables,
          );
        }

        logger.info("[LLM IPC] 模板已填充");

        // 构建消息数组，将填充后的模板作为用户消息
        const enhancedMessages = [
          ...messages,
          {
            role: "user",
            content: filledPrompt,
          },
        ];

        // 调用标准的聊天方法
        return await managerRef.current.chatWithMessages(
          enhancedMessages,
          options,
        );
      } catch (error) {
        logger.error("[LLM IPC] 模板聊天失败:", error);
        throw error;
      }
    },
  );

  /**
   * LLM 流式查询
   * Channel: 'llm:query-stream'
   */
  ipcMain.handle("llm:query-stream", async (_event, prompt, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM服务未初始化");
      }

      // 流式响应通过事件发送
      const result = await managerRef.current.queryStream(
        prompt,
        (chunk, fullText) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-chunk", {
              chunk,
              fullText,
              conversationId: options.conversationId,
            });
          }
        },
        options,
      );

      return result;
    } catch (error) {
      logger.error("[LLM IPC] LLM流式查询失败:", error);
      throw error;
    }
  });

  /**
   * 获取 LLM 配置
   * Channel: 'llm:get-config'
   */
  ipcMain.handle("llm:get-config", async () => {
    try {
      const { getLLMConfig } = require("./llm-config");
      const llmConfig = getLLMConfig();
      return llmConfig.getAll();
    } catch (error) {
      logger.error("[LLM IPC] 获取LLM配置失败:", error);
      throw error;
    }
  });

  /**
   * 设置 LLM 配置
   * Channel: 'llm:set-config'
   */
  ipcMain.handle("llm:set-config", async (_event, config) => {
    try {
      const { getLLMConfig } = require("./llm-config");
      const llmConfig = getLLMConfig();

      // 更新配置
      Object.keys(config).forEach((key) => {
        llmConfig.set(key, config[key]);
      });

      llmConfig.save();

      // 🔥 在测试模式下，不重新初始化LLM Manager，保持使用Mock LLM
      const isTestMode =
        process.env.NODE_ENV === "test" && process.env.MOCK_LLM === "true";

      if (isTestMode) {
        logger.info("[LLM IPC] 测试模式：配置已更新，但保持使用 Mock LLM 服务");
        // 如果 managerRef.current 是 MockLLMService，更新其配置
        if (
          managerRef.current &&
          typeof managerRef.current.setConfig === "function"
        ) {
          await managerRef.current.setConfig(config);
        }
        return true;
      }

      // 正常模式：重新初始化LLM管理器
      const { LLMManager } = require("./llm-manager");

      if (managerRef.current) {
        // LLMManager 没有 close 方法，直接清空引用即可
        managerRef.current = null;
      }

      const managerConfig = llmConfig.getManagerConfig();
      // 创建新的 LLMManager 实例
      const newManager = new LLMManager(managerConfig);
      await newManager.initialize();

      // 更新引用容器
      managerRef.current = newManager;

      // 如果有 app 实例，也更新 app 上的引用
      if (app) {
        app.llmManager = newManager;
      }

      logger.info("[LLM IPC] LLM配置已更新并重新初始化");

      return true;
    } catch (error) {
      logger.error("[LLM IPC] 设置LLM配置失败:", error);
      throw error;
    }
  });

  /**
   * 列出可用模型
   * Channel: 'llm:list-models'
   */
  ipcMain.handle("llm:list-models", async () => {
    try {
      if (!managerRef.current) {
        return [];
      }

      return await managerRef.current.listModels();
    } catch (error) {
      logger.error("[LLM IPC] 列出模型失败:", error);
      return [];
    }
  });

  /**
   * 清除对话上下文
   * Channel: 'llm:clear-context'
   */
  ipcMain.handle("llm:clear-context", async (_event, conversationId) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM服务未初始化");
      }

      managerRef.current.clearContext(conversationId);
      return true;
    } catch (error) {
      logger.error("[LLM IPC] 清除上下文失败:", error);
      throw error;
    }
  });

  /**
   * 生成文本嵌入（Embeddings）
   * Channel: 'llm:embeddings'
   */
  ipcMain.handle("llm:embeddings", async (_event, text) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM服务未初始化");
      }

      return await managerRef.current.embeddings(text);
    } catch (error) {
      logger.error("[LLM IPC] 生成嵌入失败:", error);
      throw error;
    }
  });

  // ============================================================
  // LLM 智能选择
  // ============================================================

  /**
   * 获取 LLM 选择器信息
   * Channel: 'llm:get-selector-info'
   */
  ipcMain.handle("llm:get-selector-info", async () => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      return {
        characteristics: llmSelector.getAllCharacteristics(),
        taskTypes: llmSelector.getTaskTypes(),
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取LLM选择器信息失败:", error);
      throw error;
    }
  });

  /**
   * 智能选择最优 LLM
   * Channel: 'llm:select-best'
   */
  ipcMain.handle("llm:select-best", async (_event, options = {}) => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      const provider = llmSelector.selectBestLLM(options);
      return provider;
    } catch (error) {
      logger.error("[LLM IPC] 智能选择LLM失败:", error);
      throw error;
    }
  });

  /**
   * 生成 LLM 选择报告
   * Channel: 'llm:generate-report'
   */
  ipcMain.handle("llm:generate-report", async (_event, taskType = "chat") => {
    try {
      if (!llmSelector) {
        throw new Error("LLM选择器未初始化");
      }

      return llmSelector.generateSelectionReport(taskType);
    } catch (error) {
      logger.error("[LLM IPC] 生成LLM选择报告失败:", error);
      throw error;
    }
  });

  /**
   * 切换 LLM 提供商
   * Channel: 'llm:switch-provider'
   */
  ipcMain.handle("llm:switch-provider", async (_event, provider) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { getLLMConfig } = require("./llm-config");
      const { LLMManager } = require("./llm-manager");

      // 保存新的提供商到llm-config.json
      const llmConfig = getLLMConfig();
      llmConfig.setProvider(provider);

      // 重新初始化LLM管理器
      if (managerRef.current) {
        await managerRef.current.close();
      }

      const managerConfig = llmConfig.getManagerConfig();
      logger.info(`[LLM IPC] 切换到LLM提供商: ${provider}, 配置:`, {
        model: managerConfig.model,
        baseURL: managerConfig.baseURL,
      });

      const newManager = new LLMManager(managerConfig);
      await newManager.initialize();

      // 更新引用容器
      managerRef.current = newManager;

      // 如果有 app 实例，也更新 app 上的引用
      if (app) {
        app.llmManager = newManager;
      }

      logger.info(`[LLM IPC] 已切换到LLM提供商: ${provider}`);
      return true;
    } catch (error) {
      logger.error("[LLM IPC] 切换LLM提供商失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 流式输出控制 (Stream Control) - 6 handlers
  // ============================================================

  /**
   * 创建流式输出控制器
   * Channel: 'llm:create-stream-controller'
   */
  ipcMain.handle(
    "llm:create-stream-controller",
    async (_event, options = {}) => {
      try {
        const { createStreamController } = require("./stream-controller");
        const controller = createStreamController(options);

        // 生成唯一ID
        const controllerId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // 存储控制器（在app实例中）
        if (!app.streamControllers) {
          app.streamControllers = new Map();
        }
        app.streamControllers.set(controllerId, controller);

        // 设置事件监听
        controller.on("chunk", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-chunk", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("pause", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-pause", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("resume", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-resume", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("cancel", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-cancel", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("complete", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-complete", {
              controllerId,
              ...data,
            });
          }
        });

        controller.on("error", (data) => {
          if (mainWindow) {
            mainWindow.webContents.send("llm:stream-error", {
              controllerId,
              ...data,
            });
          }
        });

        return { controllerId, status: controller.status };
      } catch (error) {
        logger.error("[LLM IPC] 创建流控制器失败:", error);
        throw error;
      }
    },
  );

  /**
   * 暂停流式输出
   * Channel: 'llm:pause-stream'
   */
  ipcMain.handle("llm:pause-stream", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.pause();

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 暂停流失败:", error);
      throw error;
    }
  });

  /**
   * 恢复流式输出
   * Channel: 'llm:resume-stream'
   */
  ipcMain.handle("llm:resume-stream", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.resume();

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 恢复流失败:", error);
      throw error;
    }
  });

  /**
   * 取消流式输出
   * Channel: 'llm:cancel-stream'
   */
  ipcMain.handle("llm:cancel-stream", async (_event, controllerId, reason) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      controller.cancel(reason);

      return { success: true, status: controller.status };
    } catch (error) {
      logger.error("[LLM IPC] 取消流失败:", error);
      throw error;
    }
  });

  /**
   * 获取流式输出统计信息
   * Channel: 'llm:get-stream-stats'
   */
  ipcMain.handle("llm:get-stream-stats", async (_event, controllerId) => {
    try {
      if (!app.streamControllers || !app.streamControllers.has(controllerId)) {
        throw new Error("流控制器不存在");
      }

      const controller = app.streamControllers.get(controllerId);
      const stats = controller.getStats();

      return stats;
    } catch (error) {
      logger.error("[LLM IPC] 获取流统计失败:", error);
      throw error;
    }
  });

  /**
   * 销毁流式输出控制器
   * Channel: 'llm:destroy-stream-controller'
   */
  ipcMain.handle(
    "llm:destroy-stream-controller",
    async (_event, controllerId) => {
      try {
        if (
          !app.streamControllers ||
          !app.streamControllers.has(controllerId)
        ) {
          return { success: true, message: "控制器已不存在" };
        }

        const controller = app.streamControllers.get(controllerId);
        controller.destroy();
        app.streamControllers.delete(controllerId);

        return { success: true };
      } catch (error) {
        logger.error("[LLM IPC] 销毁流控制器失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // Token 追踪与成本管理 (Token Tracking & Cost Management) - 8 handlers
  // ============================================================

  /**
   * 获取 Token 使用统计
   * Channel: 'llm:get-usage-stats'
   */
  ipcMain.handle("llm:get-usage-stats", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getUsageStats(options);
      }

      // Fallback: 直接从数据库查询
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const {
        startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate = Date.now(),
      } = options;

      const sql = `
        SELECT
          COUNT(*) as total_calls,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as total_cost_usd,
          COALESCE(SUM(cost_cny), 0) as total_cost_cny,
          COALESCE(SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END), 0) as cached_calls,
          COALESCE(SUM(CASE WHEN was_compressed = 1 THEN 1 ELSE 0 END), 0) as compressed_calls,
          COALESCE(AVG(response_time), 0) as avg_response_time
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
      `;

      const stmt = database.prepare(sql);
      const stats = stmt.get([startDate, endDate]);

      const cacheHitRate =
        stats.total_calls > 0
          ? (((stats.cached_calls || 0) / stats.total_calls) * 100).toFixed(2)
          : 0;

      return {
        totalCalls: stats.total_calls || 0,
        totalInputTokens: stats.total_input_tokens || 0,
        totalOutputTokens: stats.total_output_tokens || 0,
        totalTokens: stats.total_tokens || 0,
        totalCostUsd: stats.total_cost_usd || 0,
        totalCostCny: stats.total_cost_cny || 0,
        cachedCalls: stats.cached_calls || 0,
        compressedCalls: stats.compressed_calls || 0,
        cacheHitRate: parseFloat(cacheHitRate),
        avgResponseTime: Math.round(stats.avg_response_time || 0),
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取使用统计失败:", error);
      throw error;
    }
  });

  /**
   * 获取时间序列数据
   * Channel: 'llm:get-time-series'
   */
  ipcMain.handle("llm:get-time-series", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getTimeSeriesData(options);
      }

      // Fallback: 直接从数据库查询
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const {
        startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate = Date.now(),
        interval = "day",
      } = options;

      let bucketSize;
      switch (interval) {
        case "hour":
          bucketSize = 60 * 60 * 1000;
          break;
        case "day":
          bucketSize = 24 * 60 * 60 * 1000;
          break;
        case "week":
          bucketSize = 7 * 24 * 60 * 60 * 1000;
          break;
        default:
          bucketSize = 24 * 60 * 60 * 1000;
      }

      const sql = `
        SELECT
          (created_at / ${bucketSize}) * ${bucketSize} as time_bucket,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

      const stmt = database.prepare(sql);
      const rows = stmt.all([startDate, endDate]);

      return rows.map((row) => ({
        timestamp: row.time_bucket,
        date: new Date(row.time_bucket).toISOString(),
        calls: row.calls || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        totalTokens: row.total_tokens || 0,
        costUsd: row.cost_usd || 0,
        costCny: row.cost_cny || 0,
      }));
    } catch (error) {
      logger.error("[LLM IPC] 获取时间序列数据失败:", error);
      throw error;
    }
  });

  /**
   * 获取成本分解
   * Channel: 'llm:get-cost-breakdown'
   */
  ipcMain.handle("llm:get-cost-breakdown", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getCostBreakdown(options);
      }

      // Fallback: 直接从数据库查询
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const {
        startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
        endDate = Date.now(),
      } = options;

      // 按提供商分组
      const providerSql = `
        SELECT
          provider,
          COUNT(*) as calls,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider
        ORDER BY cost_usd DESC
      `;

      const providerStmt = database.prepare(providerSql);
      const byProvider = providerStmt.all([startDate, endDate]);

      // 按模型分组
      const modelSql = `
        SELECT
          provider,
          model,
          COUNT(*) as calls,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
        LIMIT 10
      `;

      const modelStmt = database.prepare(modelSql);
      const byModel = modelStmt.all([startDate, endDate]);

      return {
        byProvider: byProvider.map((row) => ({
          provider: row.provider,
          calls: row.calls || 0,
          totalTokens: row.total_tokens || 0,
          costUsd: row.cost_usd || 0,
          costCny: row.cost_cny || 0,
        })),
        byModel: byModel.map((row) => ({
          provider: row.provider,
          model: row.model,
          calls: row.calls || 0,
          totalTokens: row.total_tokens || 0,
          costUsd: row.cost_usd || 0,
          costCny: row.cost_cny || 0,
        })),
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取成本分解失败:", error);
      throw error;
    }
  });

  /**
   * 获取预算配置
   * Channel: 'llm:get-budget'
   */
  ipcMain.handle("llm:get-budget", async (_event, userId = "default") => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.getBudgetConfig(userId);
    } catch (error) {
      logger.error("[LLM IPC] 获取预算配置失败:", error);
      throw error;
    }
  });

  /**
   * 设置预算配置
   * Channel: 'llm:set-budget'
   */
  ipcMain.handle("llm:set-budget", async (_event, userId, config) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.saveBudgetConfig(userId, config);
    } catch (error) {
      logger.error("[LLM IPC] 设置预算配置失败:", error);
      throw error;
    }
  });

  /**
   * 导出成本报告
   * Channel: 'llm:export-cost-report'
   */
  ipcMain.handle("llm:export-cost-report", async (_event, options = {}) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.exportCostReport(options);
    } catch (error) {
      logger.error("[LLM IPC] 导出成本报告失败:", error);
      throw error;
    }
  });

  /**
   * 清除响应缓存
   * Channel: 'llm:clear-cache'
   */
  ipcMain.handle("llm:clear-cache", async (_event) => {
    try {
      if (!responseCache) {
        throw new Error("响应缓存未初始化");
      }

      const deletedCount = await responseCache.clear();
      return { success: true, deletedCount };
    } catch (error) {
      logger.error("[LLM IPC] 清除缓存失败:", error);
      throw error;
    }
  });

  /**
   * 获取缓存统计信息
   * Channel: 'llm:get-cache-stats'
   */
  ipcMain.handle("llm:get-cache-stats", async (_event) => {
    try {
      if (!responseCache) {
        throw new Error("响应缓存未初始化");
      }

      return await responseCache.getStats();
    } catch (error) {
      logger.error("[LLM IPC] 获取缓存统计失败:", error);
      throw error;
    }
  });

  /**
   * 恢复 LLM 服务（预算超限暂停后）
   * Channel: 'llm:resume-service'
   */
  ipcMain.handle("llm:resume-service", async (_event, userId = "default") => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM 服务未初始化");
      }

      const result = await managerRef.current.resumeService(userId);

      logger.info("[LLM IPC] ✓ LLM 服务已恢复");

      return result;
    } catch (error) {
      logger.error("[LLM IPC] 恢复 LLM 服务失败:", error);
      throw error;
    }
  });

  /**
   * 暂停 LLM 服务（手动暂停）
   * Channel: 'llm:pause-service'
   */
  ipcMain.handle("llm:pause-service", async (_event) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM 服务未初始化");
      }

      const result = await managerRef.current.pauseService();

      logger.info("[LLM IPC] ✓ LLM 服务已暂停");

      return result;
    } catch (error) {
      logger.error("[LLM IPC] 暂停 LLM 服务失败:", error);
      throw error;
    }
  });

  /**
   * 计算成本估算
   * Channel: 'llm:calculate-cost-estimate'
   */
  ipcMain.handle(
    "llm:calculate-cost-estimate",
    async (
      _event,
      { provider, model, inputTokens, outputTokens, cachedTokens = 0 },
    ) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        return managerRef.current.calculateCostEstimate(
          provider,
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
        );
      } catch (error) {
        logger.error("[LLM IPC] 计算成本估算失败:", error);
        throw error;
      }
    },
  );

  /**
   * 检查是否可以执行操作（预算检查）
   * Channel: 'llm:can-perform-operation'
   */
  ipcMain.handle(
    "llm:can-perform-operation",
    async (_event, estimatedTokens = 0) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        return await managerRef.current.canPerformOperation(estimatedTokens);
      } catch (error) {
        logger.error("[LLM IPC] 检查操作权限失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // Alert History (告警历史)
  // ============================================================

  /**
   * 获取告警历史
   * Channel: 'llm:get-alert-history'
   */
  ipcMain.handle("llm:get-alert-history", async (_event, options = {}) => {
    try {
      if (!database) {
        return [];
      }

      const {
        limit = 100,
        userId = "default",
        level,
        includesDismissed = true,
      } = options;

      let sql = `
        SELECT * FROM llm_alert_history
        WHERE user_id = ?
      `;
      const params = [userId];

      if (level) {
        sql += " AND level = ?";
        params.push(level);
      }

      if (!includesDismissed) {
        sql += " AND dismissed = 0";
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const alerts = database.prepare(sql).all(...params);

      return alerts.map((alert) => ({
        ...alert,
        details: alert.details ? JSON.parse(alert.details) : null,
        dismissed: alert.dismissed === 1,
      }));
    } catch (error) {
      logger.error("[LLM IPC] 获取告警历史失败:", error);
      return [];
    }
  });

  /**
   * 添加告警到历史记录
   * Channel: 'llm:add-alert'
   */
  ipcMain.handle("llm:add-alert", async (_event, alert) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { v4: uuidv4 } = require("uuid");
      const now = Date.now();

      const id = uuidv4();
      const insert = database.prepare(`
        INSERT INTO llm_alert_history (
          id, user_id, type, level, title, message, details,
          dismissed, dismissed_at, dismissed_by,
          related_provider, related_model,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?)
      `);

      insert.run(
        id,
        alert.userId || "default",
        alert.type,
        alert.level,
        alert.title,
        alert.message,
        alert.details ? JSON.stringify(alert.details) : null,
        alert.provider || null,
        alert.model || null,
        now,
        now,
      );

      return { success: true, id };
    } catch (error) {
      logger.error("[LLM IPC] 添加告警失败:", error);
      throw error;
    }
  });

  /**
   * 忽略/处理告警
   * Channel: 'llm:dismiss-alert'
   */
  ipcMain.handle(
    "llm:dismiss-alert",
    async (_event, alertId, dismissedBy = "user") => {
      try {
        if (!database) {
          throw new Error("数据库未初始化");
        }

        const now = Date.now();
        const update = database.prepare(`
        UPDATE llm_alert_history
        SET dismissed = 1, dismissed_at = ?, dismissed_by = ?, updated_at = ?
        WHERE id = ?
      `);

        update.run(now, dismissedBy, now, alertId);

        return { success: true };
      } catch (error) {
        logger.error("[LLM IPC] 忽略告警失败:", error);
        throw error;
      }
    },
  );

  /**
   * 清除告警历史
   * Channel: 'llm:clear-alert-history'
   */
  ipcMain.handle("llm:clear-alert-history", async (_event, options = {}) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { userId = "default", olderThanDays } = options;

      if (olderThanDays) {
        const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
        database
          .prepare(
            "DELETE FROM llm_alert_history WHERE user_id = ? AND created_at < ?",
          )
          .run(userId, cutoff);
      } else {
        database
          .prepare("DELETE FROM llm_alert_history WHERE user_id = ?")
          .run(userId);
      }

      return { success: true };
    } catch (error) {
      logger.error("[LLM IPC] 清除告警历史失败:", error);
      throw error;
    }
  });

  // ============================================================
  // Model-specific Budgets (按模型预算)
  // ============================================================

  /**
   * 获取模型预算列表
   * Channel: 'llm:get-model-budgets'
   */
  ipcMain.handle(
    "llm:get-model-budgets",
    async (_event, userId = "default") => {
      try {
        if (!database) {
          return [];
        }

        const budgets = database
          .prepare(
            "SELECT * FROM llm_model_budgets WHERE user_id = ? ORDER BY total_cost_usd DESC",
          )
          .all(userId);

        return budgets.map((b) => ({
          ...b,
          enabled: b.enabled === 1,
          alertOnLimit: b.alert_on_limit === 1,
          blockOnLimit: b.block_on_limit === 1,
        }));
      } catch (error) {
        logger.error("[LLM IPC] 获取模型预算失败:", error);
        return [];
      }
    },
  );

  /**
   * 设置模型预算
   * Channel: 'llm:set-model-budget'
   */
  ipcMain.handle("llm:set-model-budget", async (_event, config) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { v4: uuidv4 } = require("uuid");
      const now = Date.now();

      const upsert = database.prepare(`
        INSERT INTO llm_model_budgets (
          id, user_id, provider, model,
          daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
          current_daily_spend, current_weekly_spend, current_monthly_spend,
          total_calls, total_tokens, total_cost_usd,
          enabled, alert_on_limit, block_on_limit,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider, model) DO UPDATE SET
          daily_limit_usd = excluded.daily_limit_usd,
          weekly_limit_usd = excluded.weekly_limit_usd,
          monthly_limit_usd = excluded.monthly_limit_usd,
          enabled = excluded.enabled,
          alert_on_limit = excluded.alert_on_limit,
          block_on_limit = excluded.block_on_limit,
          updated_at = excluded.updated_at
      `);

      upsert.run(
        uuidv4(),
        config.userId || "default",
        config.provider,
        config.model,
        config.dailyLimitUsd || 0,
        config.weeklyLimitUsd || 0,
        config.monthlyLimitUsd || 0,
        config.enabled !== false ? 1 : 0,
        config.alertOnLimit !== false ? 1 : 0,
        config.blockOnLimit === true ? 1 : 0,
        now,
        now,
      );

      return { success: true };
    } catch (error) {
      logger.error("[LLM IPC] 设置模型预算失败:", error);
      throw error;
    }
  });

  /**
   * 删除模型预算
   * Channel: 'llm:delete-model-budget'
   */
  ipcMain.handle(
    "llm:delete-model-budget",
    async (_event, { userId = "default", provider, model }) => {
      try {
        if (!database) {
          throw new Error("数据库未初始化");
        }

        database
          .prepare(
            "DELETE FROM llm_model_budgets WHERE user_id = ? AND provider = ? AND model = ?",
          )
          .run(userId, provider, model);

        return { success: true };
      } catch (error) {
        logger.error("[LLM IPC] 删除模型预算失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // Data Retention (数据保留设置)
  // ============================================================

  /**
   * 获取数据保留配置
   * Channel: 'llm:get-retention-config'
   */
  ipcMain.handle(
    "llm:get-retention-config",
    async (_event, userId = "default") => {
      try {
        if (!database) {
          return null;
        }

        const config = database
          .prepare("SELECT * FROM llm_data_retention_config WHERE user_id = ?")
          .get(userId);

        if (config) {
          return {
            ...config,
            autoCleanupEnabled: config.auto_cleanup_enabled === 1,
            usageLogRetentionDays: config.usage_log_retention_days,
            cacheRetentionDays: config.cache_retention_days,
            alertHistoryRetentionDays: config.alert_history_retention_days,
          };
        }

        return null;
      } catch (error) {
        logger.error("[LLM IPC] 获取数据保留配置失败:", error);
        return null;
      }
    },
  );

  /**
   * 设置数据保留配置
   * Channel: 'llm:set-retention-config'
   */
  ipcMain.handle("llm:set-retention-config", async (_event, config) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const now = Date.now();

      database
        .prepare(
          `
        UPDATE llm_data_retention_config SET
          usage_log_retention_days = ?,
          cache_retention_days = ?,
          alert_history_retention_days = ?,
          auto_cleanup_enabled = ?,
          updated_at = ?
        WHERE user_id = ?
      `,
        )
        .run(
          config.usageLogRetentionDays || 90,
          config.cacheRetentionDays || 7,
          config.alertHistoryRetentionDays || 30,
          config.autoCleanupEnabled !== false ? 1 : 0,
          now,
          config.userId || "default",
        );

      return { success: true };
    } catch (error) {
      logger.error("[LLM IPC] 设置数据保留配置失败:", error);
      throw error;
    }
  });

  /**
   * 手动清理旧数据
   * Channel: 'llm:cleanup-old-data'
   */
  ipcMain.handle("llm:cleanup-old-data", async (_event, userId = "default") => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      // 获取保留配置
      const config = database
        .prepare("SELECT * FROM llm_data_retention_config WHERE user_id = ?")
        .get(userId);

      if (!config) {
        return { success: false, error: "配置不存在" };
      }

      const now = Date.now();
      const deletedCounts = {
        usageLogs: 0,
        cache: 0,
        alerts: 0,
      };

      // 清理使用日志
      if (config.usage_log_retention_days > 0) {
        const usageCutoff =
          now - config.usage_log_retention_days * 24 * 60 * 60 * 1000;
        const usageResult = database
          .prepare(
            "DELETE FROM llm_usage_log WHERE created_at < ? AND user_id = ?",
          )
          .run(usageCutoff, userId);
        deletedCounts.usageLogs = usageResult.changes;
      }

      // 清理缓存
      if (config.cache_retention_days > 0) {
        const cacheCutoff =
          now - config.cache_retention_days * 24 * 60 * 60 * 1000;
        const cacheResult = database
          .prepare("DELETE FROM llm_cache WHERE created_at < ?")
          .run(cacheCutoff);
        deletedCounts.cache = cacheResult.changes;
      }

      // 清理告警历史
      if (config.alert_history_retention_days > 0) {
        const alertCutoff =
          now - config.alert_history_retention_days * 24 * 60 * 60 * 1000;
        const alertResult = database
          .prepare(
            "DELETE FROM llm_alert_history WHERE created_at < ? AND user_id = ?",
          )
          .run(alertCutoff, userId);
        deletedCounts.alerts = alertResult.changes;
      }

      // 更新最后清理时间
      database
        .prepare(
          `
        UPDATE llm_data_retention_config SET last_cleanup_at = ?, updated_at = ?
        WHERE user_id = ?
      `,
        )
        .run(now, now, userId);

      logger.info("[LLM IPC] 数据清理完成:", deletedCounts);

      return { success: true, deletedCounts };
    } catch (error) {
      logger.error("[LLM IPC] 清理旧数据失败:", error);
      throw error;
    }
  });

  // ============================================================
  // Test Data Generation (测试数据生成)
  // ============================================================

  /**
   * 生成 LLM 测试数据（仅用于开发测试）
   * Channel: 'llm:generate-test-data'
   */
  ipcMain.handle("llm:generate-test-data", async (_event, options = {}) => {
    const { days = 30, recordsPerDay = 50, clear = false } = options;

    if (!database) {
      throw new Error("数据库未初始化");
    }

    const { v4: uuidv4 } = require("uuid");

    // 定价数据
    const PRICING = {
      ollama: {
        "qwen2:7b": { input: 0, output: 0 },
        "llama3:8b": { input: 0, output: 0 },
        "mistral:7b": { input: 0, output: 0 },
      },
      openai: {
        "gpt-4o": { input: 2.5, output: 10.0 },
        "gpt-4o-mini": { input: 0.15, output: 0.6 },
        "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
      },
      anthropic: {
        "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
        "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
        "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
      },
      deepseek: {
        "deepseek-chat": { input: 0.14, output: 0.28 },
        "deepseek-coder": { input: 0.14, output: 0.28 },
      },
    };

    const EXCHANGE_RATE = 7.2;
    const randomInt = (min, max) =>
      Math.floor(Math.random() * (max - min + 1)) + min;
    const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const calculateCost = (provider, model, inputTokens, outputTokens) => {
      const pricing = PRICING[provider]?.[model];
      if (!pricing) {
        return { costUsd: 0, costCny: 0 };
      }
      const inputCost = (inputTokens / 1_000_000) * pricing.input;
      const outputCost = (outputTokens / 1_000_000) * pricing.output;
      const costUsd = inputCost + outputCost;
      return { costUsd, costCny: costUsd * EXCHANGE_RATE };
    };

    try {
      if (clear) {
        database.prepare("DELETE FROM llm_usage_log").run();
        logger.info("[LLM IPC] 已清除现有测试数据");
      }

      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;
      const providers = Object.keys(PRICING);

      const insert = database.prepare(`
          INSERT INTO llm_usage_log (
            id, conversation_id, message_id, provider, model,
            input_tokens, output_tokens, total_tokens, cached_tokens,
            cost_usd, cost_cny,
            was_cached, was_compressed, compression_ratio,
            latency_ms, response_time,
            endpoint, user_id, session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

      const insertMany = database.transaction((records) => {
        for (const r of records) {
          insert.run(...r);
        }
      });

      const records = [];
      let totalRecords = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;

      for (let day = 0; day < days; day++) {
        const dailyRecords = recordsPerDay + randomInt(-20, 20);

        for (let i = 0; i < dailyRecords; i++) {
          const provider = randomChoice(providers);
          const models = Object.keys(PRICING[provider]);
          const model = randomChoice(models);

          const inputTokens = randomInt(100, 4000);
          const outputTokens = randomInt(50, 2000);
          const totalTokensVal = inputTokens + outputTokens;
          const cachedTokens =
            Math.random() > 0.7 ? randomInt(0, inputTokens / 2) : 0;

          const { costUsd, costCny } = calculateCost(
            provider,
            model,
            inputTokens,
            outputTokens,
          );

          const dayStart = now - (day + 1) * msPerDay;
          const timestamp = dayStart + randomInt(0, msPerDay);

          const wasCached = Math.random() > 0.85 ? 1 : 0;
          const wasCompressed = Math.random() > 0.7 ? 1 : 0;
          const compressionRatio = wasCompressed
            ? 0.5 + Math.random() * 0.4
            : 1.0;
          const latencyMs = randomInt(200, 5000);

          records.push([
            uuidv4(),
            `conv-test-${randomInt(1, 100)}`,
            `msg-${uuidv4().slice(0, 8)}`,
            provider,
            model,
            inputTokens,
            outputTokens,
            totalTokensVal,
            cachedTokens,
            costUsd,
            costCny,
            wasCached,
            wasCompressed,
            compressionRatio,
            latencyMs,
            latencyMs,
            null,
            "default",
            null,
            timestamp,
          ]);

          totalRecords++;
          totalTokens += totalTokensVal;
          totalCostUsd += costUsd;
        }
      }

      insertMany(records);

      logger.info(
        `[LLM IPC] 测试数据生成完成: ${totalRecords} 条记录, ${totalTokens} tokens, $${totalCostUsd.toFixed(4)}`,
      );

      return {
        success: true,
        totalRecords,
        totalTokens,
        totalCostUsd,
        totalCostCny: totalCostUsd * EXCHANGE_RATE,
      };
    } catch (error) {
      logger.error("[LLM IPC] 生成测试数据失败:", error);
      throw error;
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("llm-ipc");

  logger.info(
    "[LLM IPC] ✓ All LLM IPC handlers registered successfully (44 handlers: 14 basic + 6 stream + 13 token tracking + 4 alerts + 4 model budgets + 3 retention)",
  );
}

module.exports = {
  registerLLMIPC,
};
