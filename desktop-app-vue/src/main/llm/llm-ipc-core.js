/**
 * LLM IPC handlers — core group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-core
 */
const { logger } = require("../utils/logger.js");

function registerCoreHandlers(ctx) {
  const {
    ipcMain,
    managerRef,
    detectTaskType,
    isTestMode,
    mainWindow,
    ragManager,
    promptTemplateManager,
    app,
    tokenTracker,
    promptCompressor,
    responseCache,
    mcpClientManager,
    mcpToolAdapter,
    sessionManager,
    agentOrchestrator,
    errorMonitor,
  } = ctx;

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
}

module.exports = { registerCoreHandlers };
