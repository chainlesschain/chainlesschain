/**
 * LLM IPC handlers — core group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-core
 */
const {
  mergeLlmConfigWrite,
  projectLlmConfigForRenderer,
} = require("./llm-config-projection");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const {
  boundedNumber,
  boundedString,
  ownData,
  projectEmbedding,
  projectModelResponse,
  projectModels,
  projectRetrievedDocs,
  projectStatus,
  projectStreamChunk,
} = require("./llm-ipc-success-projection");

function isGovernanceIngressFailure(error) {
  try {
    return error?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  } catch {
    return false;
  }
}

function projectIntegrationResults(value) {
  const sessionId = boundedString(value.sessionId);
  return {
    sessionUsed: value.sessionUsed === true,
    ...(sessionId === undefined ? {} : { sessionId }),
    manusOptimized: value.manusOptimized === true,
    multiAgentRouted: value.multiAgentRouted === true,
    agentUsed: value.agentUsed !== null,
    errorPrechecked: value.errorPrechecked === true,
  };
}

function registerCoreHandlers(ctx) {
  const getConfiguration =
    ctx.getLLMConfig || (() => require("./llm-config").getLLMConfig());
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
  const privacy = ctx.llmPrivacy || createLlmIpcPrivacy("core");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM core IPC authorization is required");
  }
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^llm:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          await authorization.authorize(event, operation);
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, ...args);
      });
    },
  };

  // ============================================================
  // 基础 LLM 服务
  // ============================================================

  /**
   * 检查 LLM 服务状态
   * Channel: 'llm:check-status'
   */
  authorizedIpcMain.handle("llm:check-status", async () => {
    try {
      if (!managerRef.current) {
        return {
          available: false,
          error: "LLM服务未初始化",
        };
      }

      return projectStatus(await managerRef.current.checkStatus());
    } catch {
      return privacy.unavailable("check-status");
    }
  });

  /**
   * LLM 查询（简单文本）
   * Channel: 'llm:query'
   */
  authorizedIpcMain.handle(
    "llm:query",
    async (_event, prompt, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        return projectModelResponse(
          await managerRef.current.query(prompt, options),
        );
      } catch (error) {
        if (isGovernanceIngressFailure(error)) {
          throw privacy.governanceFailure("query");
        }
        throw privacy.failure("query");
      }
    },
  );

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
  authorizedIpcMain.handle(
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

        privacy.event("chat-requested");

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
        const { isGovernedLLMManager } = require("./llm-manager");
        const governed = isGovernedLLMManager(managerRef.current);
        if (governed) {
          options.skipCache = !enableCache || options.skipCache === true;
          options.skipCompression =
            !enableCompression || options.skipCompression === true;
        }
        const model =
          options.model || managerRef.current.config.model || "unknown";

        // ============================================================
        // 🔥 高级特性整合 - 步骤 0: 预检查和会话管理
        // ============================================================

        // 🔥 0.1: ErrorMonitor 预检查（如果启用）
        if (enableErrorPrecheck && errorMonitor) {
          // 检查 LLM 服务是否暂停（预算超限）
          if (managerRef.current.paused) {
            privacy.event("error-precheck-failed");
            throw privacy.failure("chat");
          }

          integrationResults.errorPrechecked = true;
          privacy.event("error-precheck-succeeded");
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
                privacy.event("session-loaded");
              } catch (loadError) {
                if (loadError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
                  throw loadError;
                privacy.event("session-load-failed");
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
              privacy.event("session-created");
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
            if (sessionError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw sessionError;
            privacy.event("session-tracking-failed");
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
                privacy.event("agent-selected");

                // 分发任务到 Agent
                try {
                  agentResult = await agentOrchestrator.dispatch(task);
                  integrationResults.multiAgentRouted = true;
                  integrationResults.agentUsed = capableAgents[0].agentId;
                  privacy.event("agent-execution-succeeded");

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

                    const projectedAgentResponse = projectModelResponse({
                      text: agentResult.response,
                      usage: agentResult.usage,
                    });
                    return {
                      content: projectedAgentResponse.content,
                      message: projectedAgentResponse.message,
                      usage: projectedAgentResponse.usage,
                      retrievedDocs: [],
                      wasCached: false,
                      wasCompressed: false,
                      ...projectIntegrationResults(integrationResults),
                    };
                  }
                } catch (agentError) {
                  if (agentError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
                    throw agentError;
                  privacy.event("agent-execution-failed");
                }
              }
            }
          } catch (agentCheckError) {
            if (agentCheckError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw agentCheckError;
            privacy.event("agent-route-check-failed");
            // 不阻塞主流程
          }
        }

        // ============================================================
        // 原有逻辑继续
        // ============================================================

        // 🔥 优化步骤 1: 检查缓存
        if (!governed && enableCache && responseCache && !stream) {
          try {
            const cached = await responseCache.get(
              provider,
              model,
              messages,
              options,
            );

            if (cached.hit) {
              privacy.event("cache-hit");

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
              const projectedCachedResponse = projectModelResponse(
                cached.response,
              );
              return {
                content: projectedCachedResponse.content,
                message: projectedCachedResponse.message,
                usage: projectedCachedResponse.usage,
                wasCached: true,
                tokensSaved: boundedNumber(cached.tokensSaved) ?? 0,
                cacheAge: boundedNumber(cached.cacheAge) ?? 0,
                retrievedDocs: [],
              };
            }
          } catch (cacheError) {
            if (cacheError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw cacheError;
            privacy.event("cache-check-failed");
          }
        }

        // 🔥 火山引擎智能模型选择 + 工具调用自动启用
        const toolsToUse = [];
        if (managerRef.current.provider === "volcengine" && !options.model) {
          try {
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
                privacy.event("thinking-task-detected");
              }

              // 检查是否包含代码（代码生成、调试）
              if (
                /(代码|函数|class|function|编程|bug|调试)/.test(content) ||
                /```/.test(content)
              ) {
                scenario.needsCodeGeneration = true;
                privacy.event("code-task-detected");
              }

              // 检查上下文长度，如果消息很多或很长，选择大上下文模型
              const totalLength = messages.reduce(
                (sum, msg) => sum + (msg.content?.length || 0),
                0,
              );
              if (totalLength > 10000 || messages.length > 20) {
                scenario.needsLongContext = true;
                privacy.event("long-context-detected");
              }

              // 🔥 检测是否需要联网搜索
              if (
                /(最新|今天|现在|实时|新闻|天气|股票|汇率|当前|最近)/.test(
                  content,
                )
              ) {
                toolsToUse.push("web_search");
                privacy.event("web-search-detected");
              }

              // 🔥 检测是否包含图片（多模态消息）
              if (Array.isArray(lastUserMsg.content)) {
                const hasImage = lastUserMsg.content.some(
                  (item) => item.type === "image_url",
                );
                if (hasImage) {
                  scenario.hasImage = true;
                  toolsToUse.push("image_process");
                  privacy.event("image-input-detected");
                }
              }
            }

            // 智能选择模型
            const selectedModel =
              managerRef.current.selectVolcengineModel(scenario);
            if (selectedModel) {
              options.model = selectedModel.modelId;
              privacy.event("model-selected");
            }
          } catch (selectError) {
            if (selectError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw selectError;
            privacy.event("model-selection-failed");
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
                privacy.event("mcp-tools-available");
              }
            }
          } catch (mcpError) {
            if (mcpError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw mcpError;
            privacy.event("mcp-discovery-failed");
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
                privacy.event("rag-retrieval-succeeded");
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
            if (ragError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw ragError;
            privacy.event("rag-retrieval-failed");
          }
        }

        // 🔥 优化步骤 2: Prompt 压缩（在 RAG 增强之后）
        if (
          enableCompression &&
          !governed &&
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
              privacy.event("prompt-compressed");
              enhancedMessages = compressionResult.messages;
            } else {
              privacy.event("prompt-kept-original");
              compressionResult = null;
            }
          } catch (compressError) {
            if (compressError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw compressError;
            privacy.event("prompt-compression-failed");
            compressionResult = null;
          }
        }

        // 🔥 根据检测结果选择调用方法（MCP工具调用 vs 火山引擎工具 vs 普通对话）
        let response;
        let usedMCPTools = false;

        // 🔥 优先使用 MCP 工具（如果有）
        if (mcpFunctions.length > 0 && mcpExecutor) {
          const provider = managerRef.current.provider;

          // The Volcengine tools client owns an opaque multi-request loop.
          // A governed manager must not send it unprojected messages or let it
          // execute MCP calls outside the single-run workflow. Until its wire
          // protocol is adapted to that workflow, reject rather than bypass.
          if (governed && provider === "volcengine") {
            const error = new Error(
              "Governed Volcengine MCP tool calls are not supported",
            );
            error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
            throw error;
          }

          // 火山引擎使用 executeFunctionCalling 方法
          if (provider === "volcengine" && managerRef.current.toolsClient) {
            privacy.event("function-calling-started");

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
              if (fcError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
                throw fcError;
              privacy.event("function-calling-failed");
            }
          }
          // OpenAI 和 DeepSeek 使用标准 chat 接口的 tools 参数
          else if (
            governed &&
            (provider === "openai" || provider === "deepseek")
          ) {
            response = await managerRef.current.chatWithGovernedFunctions(
              enhancedMessages,
              mcpFunctions,
              mcpExecutor,
              options,
            );
            usedMCPTools = true;
          } else if (provider === "openai" || provider === "deepseek") {
            privacy.event("function-calling-started");

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
                privacy.event("mcp-tools-requested");

                // 执行所有工具调用
                const toolResults = [];
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(toolCall.function.arguments);

                  privacy.event("mcp-tool-execution-started");

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
                    if (execError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
                      throw execError;
                    privacy.event("mcp-tool-execution-failed");
                    toolResults.push({
                      tool_call_id: toolCall.id,
                      role: "tool",
                      content: JSON.stringify({
                        error: "MCP tool execution failed",
                        code: "CC_LLM_MCP_TOOL_FAILED",
                      }),
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
              if (fcError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
                throw fcError;
              privacy.event("function-calling-failed");
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
          if (governed) {
            const error = new Error(
              "Governed Volcengine built-in tools are not supported",
            );
            error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
            throw error;
          }
          privacy.event("volcengine-tools-selected");

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
            privacy.event("manus-optimization-started");
            response = await managerRef.current.chatWithOptimizedPrompt(
              enhancedMessages,
              {
                ...options,
                systemPrompt: options.systemPrompt,
              },
            );
            integrationResults.manusOptimized = true;
            privacy.event("manus-optimization-applied");
          } else {
            // 使用标准的 chatWithMessages 方法，保留完整的 messages 历史
            response = await managerRef.current.chatWithMessages(
              enhancedMessages,
              options,
            );
          }
        }

        privacy.event("chat-succeeded");

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
              privacy.event("response-recorded");
            }
          } catch (sessionRecordError) {
            if (sessionRecordError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw sessionRecordError;
            privacy.event("response-record-failed");
          }
        }

        // 🔥 优化步骤 3: 缓存响应（缓存未命中的情况）
        if (!governed && enableCache && responseCache && !stream) {
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

            privacy.event("response-cache-written");
          } catch (cacheError) {
            if (cacheError.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED")
              throw cacheError;
            privacy.event("cache-write-failed");
          }
        }

        // 构建最终响应
        const projectedResponse = projectModelResponse(response);
        const finalResponse = {
          content: projectedResponse.content,
          message: projectedResponse.message,
          usage: projectedResponse.usage,
          // 返回检索到的知识库文档，供前端展示引用
          retrievedDocs: projectRetrievedDocs(retrievedDocs),
          // 🔥 优化信息
          wasCached: ownData(response, "wasCached") === true,
          wasCompressed:
            ownData(response, "wasCompressed") === true ||
            compressionResult !== null,
          compressionRatio:
            boundedNumber(ownData(response, "compressionRatio")) ??
            boundedNumber(ownData(compressionResult, "compressionRatio")) ??
            1.0,
          tokensSaved:
            boundedNumber(ownData(response, "tokensSaved")) ??
            boundedNumber(ownData(compressionResult, "tokensSaved")) ??
            0,
          optimizationStrategy:
            boundedString(ownData(compressionResult, "strategy"), 64) || "none",
          // 🔥 MCP 工具使用信息
          usedMCPTools: usedMCPTools,
          mcpToolsAvailable: mcpFunctions.length,
          // 🔥 高级特性集成信息
          ...projectIntegrationResults(integrationResults),
          promptOptimized: ownData(response, "promptOptimization") != null,
        };

        return finalResponse;
      } catch (error) {
        if (isGovernanceIngressFailure(error)) {
          throw privacy.governanceFailure("chat");
        }
        throw privacy.failure("chat");
      }
    },
  );

  /**
   * 使用提示词模板进行聊天
   * Channel: 'llm:chat-with-template'
   */
  authorizedIpcMain.handle(
    "llm:chat-with-template",
    async (_event, { templateId, variables, messages = [], ...options }) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        privacy.event("template-chat-started");

        let filledPrompt;

        // 🔥 在测试模式或 promptTemplateManager 未初始化时，使用简单的模板填充
        if (!promptTemplateManager || isTestMode) {
          privacy.event("test-template-fill-started");
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

        privacy.event("template-filled");

        // 构建消息数组，将填充后的模板作为用户消息
        const enhancedMessages = [
          ...messages,
          {
            role: "user",
            content: filledPrompt,
          },
        ];

        // 调用标准的聊天方法
        return projectModelResponse(
          await managerRef.current.chatWithMessages(enhancedMessages, options),
        );
      } catch (error) {
        if (isGovernanceIngressFailure(error)) {
          throw privacy.governanceFailure("chat-with-template");
        }
        throw privacy.failure("chat-with-template");
      }
    },
  );

  /**
   * LLM 流式查询
   * Channel: 'llm:query-stream'
   */
  authorizedIpcMain.handle(
    "llm:query-stream",
    async (_event, prompt, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        // 流式响应通过事件发送
        const result = await managerRef.current.queryStream(
          prompt,
          (chunk, fullText) => {
            if (mainWindow) {
              mainWindow.webContents.send(
                "llm:stream-chunk",
                projectStreamChunk(chunk, fullText),
              );
            }
          },
          options,
        );

        return projectModelResponse(result);
      } catch (error) {
        if (isGovernanceIngressFailure(error)) {
          throw privacy.governanceFailure("query-stream");
        }
        throw privacy.failure("query-stream");
      }
    },
  );

  /**
   * 获取 LLM 配置
   * Channel: 'llm:get-config'
   */
  authorizedIpcMain.handle("llm:get-config", async () => {
    try {
      const llmConfig = getConfiguration();
      return projectLlmConfigForRenderer(llmConfig.getAll());
    } catch {
      throw privacy.failure("get-config");
    }
  });

  /**
   * 设置 LLM 配置
   * Channel: 'llm:set-config'
   */
  authorizedIpcMain.handle("llm:set-config", async (_event, config) => {
    try {
      const llmConfig = getConfiguration();
      const submittedConfig = mergeLlmConfigWrite(config, llmConfig.getAll());

      // 更新配置
      Object.keys(submittedConfig).forEach((key) => {
        llmConfig.set(key, submittedConfig[key]);
      });

      llmConfig.save();

      // 🔥 在测试模式下，不重新初始化LLM Manager，保持使用Mock LLM
      const isTestMode =
        process.env.NODE_ENV === "test" && process.env.MOCK_LLM === "true";

      if (isTestMode) {
        privacy.event("test-config-updated");
        // 如果 managerRef.current 是 MockLLMService，更新其配置
        if (
          managerRef.current &&
          typeof managerRef.current.setConfig === "function"
        ) {
          await managerRef.current.setConfig(submittedConfig);
        }
        return true;
      }

      // 正常模式：重新初始化LLM管理器
      const {
        createLLMManagerReplacement,
        _setLLMManagerInstance,
      } = require("./llm-manager");
      const previousManager = managerRef.current;

      const managerConfig = llmConfig.getManagerConfig();
      // 创建新的 LLMManager 实例
      const newManager = createLLMManagerReplacement(
        previousManager,
        managerConfig,
      );
      await newManager.initialize();
      if (managerRef.current !== previousManager)
        throw new Error("LLM manager changed during configuration update");

      // 更新引用容器
      managerRef.current = newManager;
      _setLLMManagerInstance(newManager);
      if (newManager.promptCompressor)
        newManager.promptCompressor.llmManager = newManager;

      // 如果有 app 实例，也更新 app 上的引用
      if (app) {
        app.llmManager = newManager;
      }

      privacy.event("config-reinitialized");

      return true;
    } catch {
      throw privacy.failure("set-config");
    }
  });

  /**
   * 列出可用模型
   * Channel: 'llm:list-models'
   */
  authorizedIpcMain.handle("llm:list-models", async () => {
    try {
      if (!managerRef.current) {
        return [];
      }

      return projectModels(await managerRef.current.listModels());
    } catch {
      privacy.failure("list-models");
      return [];
    }
  });

  /**
   * 清除对话上下文
   * Channel: 'llm:clear-context'
   */
  authorizedIpcMain.handle(
    "llm:clear-context",
    async (_event, conversationId) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        managerRef.current.clearContext(conversationId);
        return true;
      } catch {
        throw privacy.failure("clear-context");
      }
    },
  );

  /**
   * 生成文本嵌入（Embeddings）
   * Channel: 'llm:embeddings'
   */
  authorizedIpcMain.handle("llm:embeddings", async (_event, text) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM服务未初始化");
      }

      return projectEmbedding(await managerRef.current.embeddings(text));
    } catch (error) {
      if (isGovernanceIngressFailure(error)) {
        throw privacy.governanceFailure("embeddings");
      }
      throw privacy.failure("embeddings");
    }
  });
}

module.exports = { registerCoreHandlers };
