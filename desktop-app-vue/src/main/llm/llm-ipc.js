/**
 * LLM服务 IPC 处理器
 * 负责处理 LLM 相关的前后端通信
 *
 * @module llm-ipc
 * @description 提供 LLM 服务的所有 IPC 接口，包括聊天、查询、配置管理、智能选择等
 */

const ipcGuard = require("../ipc-guard");

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
}) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered("llm-ipc")) {
    console.log("[LLM IPC] Handlers already registered, skipping...");
    return;
  }

  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log("[LLM IPC] Registering LLM IPC handlers...");

  // 创建一个可变的引用容器
  const managerRef = { current: llmManager };

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
      console.error("[LLM IPC] LLM查询失败:", error);
      throw error;
    }
  });

  /**
   * LLM 聊天对话（支持 messages 数组格式，保留完整对话历史，自动RAG增强）
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
        ...options
      },
    ) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM服务未初始化");
        }

        console.log(
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
        );

        const provider = managerRef.current.provider;
        const model =
          options.model || managerRef.current.config.model || "unknown";

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
              console.log(
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
            console.warn(
              "[LLM IPC] 缓存检查失败，继续正常流程:",
              cacheError.message,
            );
          }
        }

        // 🔥 火山引擎智能模型选择 + 工具调用自动启用
        let toolsToUse = [];
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
                console.log("[LLM IPC] 检测到需要深度思考");
              }

              // 检查是否包含代码（代码生成、调试）
              if (
                /(代码|函数|class|function|编程|bug|调试)/.test(content) ||
                /```/.test(content)
              ) {
                scenario.needsCodeGeneration = true;
                console.log("[LLM IPC] 检测到代码相关任务");
              }

              // 检查上下文长度，如果消息很多或很长，选择大上下文模型
              const totalLength = messages.reduce(
                (sum, msg) => sum + (msg.content?.length || 0),
                0,
              );
              if (totalLength > 10000 || messages.length > 20) {
                scenario.needsLongContext = true;
                console.log(
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
                console.log("[LLM IPC] 检测到需要联网搜索");
              }

              // 🔥 检测是否包含图片（多模态消息）
              if (Array.isArray(lastUserMsg.content)) {
                const hasImage = lastUserMsg.content.some(
                  (item) => item.type === "image_url",
                );
                if (hasImage) {
                  scenario.hasImage = true;
                  toolsToUse.push("image_process");
                  console.log("[LLM IPC] 检测到图片输入");
                }
              }
            }

            // 智能选择模型
            const selectedModel =
              managerRef.current.selectVolcengineModel(scenario);
            if (selectedModel) {
              options.model = selectedModel.modelId;
              console.log(
                "[LLM IPC] 智能选择火山引擎模型:",
                selectedModel.modelName,
                "(",
                selectedModel.modelId,
                ")",
              );
            }
          } catch (selectError) {
            console.warn(
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
                mcpToolAdapter
              );
              mcpFunctions = await mcpExecutor.getFunctions();

              if (mcpFunctions.length > 0) {
                console.log(
                  "[LLM IPC] MCP 工具可用:",
                  mcpFunctions.map((f) => f.name).join(", ")
                );
              }
            }
          } catch (mcpError) {
            console.warn(
              "[LLM IPC] 获取 MCP 工具失败:",
              mcpError.message
            );
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
                console.log(
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
            console.error("[LLM IPC] RAG检索失败，继续普通对话:", ragError);
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
              console.log(
                "[LLM IPC] ⚡ Prompt 压缩成功! 压缩率:",
                compressionResult.compressionRatio.toFixed(2),
                "节省",
                compressionResult.tokensSaved,
                "tokens",
              );
              enhancedMessages = compressionResult.messages;
            } else {
              console.log("[LLM IPC] Prompt 压缩效果不明显，使用原始消息");
              compressionResult = null;
            }
          } catch (compressError) {
            console.warn(
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
            console.log(
              "[LLM IPC] 使用火山引擎 Function Calling，MCP 工具数:",
              mcpFunctions.length
            );

            try {
              response =
                await managerRef.current.toolsClient.executeFunctionCalling(
                  enhancedMessages,
                  mcpFunctions,
                  mcpExecutor,
                  options
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
              console.warn(
                "[LLM IPC] 火山引擎 Function Calling 失败，回退到标准对话:",
                fcError.message
              );
            }
          }
          // OpenAI 和 DeepSeek 使用标准 chat 接口的 tools 参数
          else if (provider === "openai" || provider === "deepseek") {
            console.log(
              "[LLM IPC] 使用 OpenAI 兼容 Function Calling，MCP 工具数:",
              mcpFunctions.length
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
                }
              );

              // 如果 LLM 请求调用工具
              let currentMessages = enhancedMessages;
              while (result.message?.tool_calls) {
                const toolCalls = result.message.tool_calls;
                console.log(
                  "[LLM IPC] LLM 请求调用",
                  toolCalls.length,
                  "个 MCP 工具"
                );

                // 执行所有工具调用
                const toolResults = [];
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name;
                  const functionArgs = JSON.parse(
                    toolCall.function.arguments
                  );

                  console.log("[LLM IPC] 执行 MCP 工具:", functionName);

                  try {
                    const execResult = await mcpExecutor.execute(
                      functionName,
                      functionArgs
                    );
                    toolResults.push({
                      tool_call_id: toolCall.id,
                      role: "tool",
                      content: JSON.stringify(execResult),
                    });
                  } catch (execError) {
                    console.error(
                      "[LLM IPC] MCP 工具执行失败:",
                      execError.message
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
                  }
                );
              }

              response = result;
              usedMCPTools = true;
            } catch (fcError) {
              console.warn(
                "[LLM IPC] OpenAI Function Calling 失败，回退到标准对话:",
                fcError.message
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
          console.log("[LLM IPC] 使用火山引擎内置工具:", toolsToUse.join(", "));

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
          // 使用标准的 chatWithMessages 方法，保留完整的 messages 历史
          response = await managerRef.current.chatWithMessages(
            enhancedMessages,
            options,
          );
        }

        console.log("[LLM IPC] LLM 聊天响应成功, tokens:", response.tokens);

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

            console.log("[LLM IPC] 响应已缓存");
          } catch (cacheError) {
            console.warn("[LLM IPC] 缓存响应失败:", cacheError.message);
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
        };

        return finalResponse;
      } catch (error) {
        console.error("[LLM IPC] LLM 聊天失败:", error);
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

        if (!promptTemplateManager) {
          throw new Error("提示词模板管理器未初始化");
        }

        console.log("[LLM IPC] 使用模板进行聊天, templateId:", templateId);

        // 填充模板变量
        const filledPrompt = await promptTemplateManager.fillTemplate(
          templateId,
          variables,
        );

        console.log("[LLM IPC] 模板已填充");

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
        console.error("[LLM IPC] 模板聊天失败:", error);
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
      console.error("[LLM IPC] LLM流式查询失败:", error);
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
      console.error("[LLM IPC] 获取LLM配置失败:", error);
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
      const { LLMManager } = require("./llm-manager");
      const llmConfig = getLLMConfig();

      // 更新配置
      Object.keys(config).forEach((key) => {
        llmConfig.set(key, config[key]);
      });

      llmConfig.save();

      // 重新初始化LLM管理器
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

      console.log("[LLM IPC] LLM配置已更新并重新初始化");

      return true;
    } catch (error) {
      console.error("[LLM IPC] 设置LLM配置失败:", error);
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
      console.error("[LLM IPC] 列出模型失败:", error);
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
      console.error("[LLM IPC] 清除上下文失败:", error);
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
      console.error("[LLM IPC] 生成嵌入失败:", error);
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
      console.error("[LLM IPC] 获取LLM选择器信息失败:", error);
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
      console.error("[LLM IPC] 智能选择LLM失败:", error);
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
      console.error("[LLM IPC] 生成LLM选择报告失败:", error);
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
      console.log(`[LLM IPC] 切换到LLM提供商: ${provider}, 配置:`, {
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

      console.log(`[LLM IPC] 已切换到LLM提供商: ${provider}`);
      return true;
    } catch (error) {
      console.error("[LLM IPC] 切换LLM提供商失败:", error);
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
        console.error("[LLM IPC] 创建流控制器失败:", error);
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
      console.error("[LLM IPC] 暂停流失败:", error);
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
      console.error("[LLM IPC] 恢复流失败:", error);
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
      console.error("[LLM IPC] 取消流失败:", error);
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
      console.error("[LLM IPC] 获取流统计失败:", error);
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
        console.error("[LLM IPC] 销毁流控制器失败:", error);
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
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.getUsageStats(options);
    } catch (error) {
      console.error("[LLM IPC] 获取使用统计失败:", error);
      throw error;
    }
  });

  /**
   * 获取时间序列数据
   * Channel: 'llm:get-time-series'
   */
  ipcMain.handle("llm:get-time-series", async (_event, options = {}) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.getTimeSeriesData(options);
    } catch (error) {
      console.error("[LLM IPC] 获取时间序列数据失败:", error);
      throw error;
    }
  });

  /**
   * 获取成本分解
   * Channel: 'llm:get-cost-breakdown'
   */
  ipcMain.handle("llm:get-cost-breakdown", async (_event, options = {}) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.getCostBreakdown(options);
    } catch (error) {
      console.error("[LLM IPC] 获取成本分解失败:", error);
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
      console.error("[LLM IPC] 获取预算配置失败:", error);
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
      console.error("[LLM IPC] 设置预算配置失败:", error);
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
      console.error("[LLM IPC] 导出成本报告失败:", error);
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
      console.error("[LLM IPC] 清除缓存失败:", error);
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
      console.error("[LLM IPC] 获取缓存统计失败:", error);
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

      console.log("[LLM IPC] ✓ LLM 服务已恢复");

      return result;
    } catch (error) {
      console.error("[LLM IPC] 恢复 LLM 服务失败:", error);
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

      console.log("[LLM IPC] ✓ LLM 服务已暂停");

      return result;
    } catch (error) {
      console.error("[LLM IPC] 暂停 LLM 服务失败:", error);
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
        console.error("[LLM IPC] 计算成本估算失败:", error);
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
        console.error("[LLM IPC] 检查操作权限失败:", error);
        throw error;
      }
    },
  );

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("llm-ipc");

  console.log(
    "[LLM IPC] ✓ All LLM IPC handlers registered successfully (32 handlers: 14 basic + 6 stream + 12 token tracking)",
  );
}

module.exports = {
  registerLLMIPC,
};
