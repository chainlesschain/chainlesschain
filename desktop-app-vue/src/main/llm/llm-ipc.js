/**
 * LLM服务 IPC 处理器
 * 负责处理 LLM 相关的前后端通信
 *
 * @module llm-ipc
 * @description 提供 LLM 服务的所有 IPC 接口，包括聊天、查询、配置管理、智能选择等
 */

const { ipcMain } = require('electron');

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
 */
function registerLLMIPC({ llmManager, mainWindow, ragManager, promptTemplateManager, llmSelector, database, app }) {
  console.log('[LLM IPC] Registering LLM IPC handlers...');

  // 创建一个可变的引用容器
  const managerRef = { current: llmManager };

  // ============================================================
  // 基础 LLM 服务
  // ============================================================

  /**
   * 检查 LLM 服务状态
   * Channel: 'llm:check-status'
   */
  ipcMain.handle('llm:check-status', async () => {
    try {
      if (!managerRef.current) {
        return {
          available: false,
          error: 'LLM服务未初始化',
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
  ipcMain.handle('llm:query', async (_event, prompt, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      return await managerRef.current.query(prompt, options);
    } catch (error) {
      console.error('[LLM IPC] LLM查询失败:', error);
      throw error;
    }
  });

  /**
   * LLM 聊天对话（支持 messages 数组格式，保留完整对话历史，自动RAG增强）
   * Channel: 'llm:chat'
   */
  ipcMain.handle('llm:chat', async (_event, { messages, stream = false, enableRAG = true, ...options }) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      console.log('[LLM IPC] LLM 聊天请求, messages:', messages?.length || 0, 'stream:', stream, 'RAG:', enableRAG);

      let enhancedMessages = messages;
      let retrievedDocs = [];

      // 如果启用RAG，自动检索知识库并增强上下文
      if (enableRAG && ragManager) {
        try {
          // 获取最后一条用户消息作为查询
          const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');

          if (lastUserMessage) {
            const query = lastUserMessage.content;

            // 检索相关知识
            const ragResult = await ragManager.enhanceQuery(query, {
              topK: options.ragTopK || 3,
              includeMetadata: true,
            });

            if (ragResult.retrievedDocs && ragResult.retrievedDocs.length > 0) {
              console.log('[LLM IPC] RAG检索到', ragResult.retrievedDocs.length, '条相关知识');
              retrievedDocs = ragResult.retrievedDocs;

              // 构建知识库上下文
              const knowledgeContext = ragResult.retrievedDocs
                .map((doc, idx) => `[知识${idx + 1}] ${doc.title || doc.content.substring(0, 50)}\n${doc.content}`)
                .join('\n\n');

              // 在消息数组中插入知识库上下文
              // 如果有系统消息，追加到系统消息；否则创建新的系统消息
              const systemMsgIndex = messages.findIndex(msg => msg.role === 'system');

              if (systemMsgIndex >= 0) {
                enhancedMessages = [...messages];
                enhancedMessages[systemMsgIndex] = {
                  ...messages[systemMsgIndex],
                  content: `${messages[systemMsgIndex].content}\n\n## 知识库参考\n${knowledgeContext}`,
                };
              } else {
                enhancedMessages = [
                  {
                    role: 'system',
                    content: `## 知识库参考\n以下是从知识库中检索到的相关信息，请参考这些内容来回答用户的问题：\n\n${knowledgeContext}`,
                  },
                  ...messages,
                ];
              }
            }
          }
        } catch (ragError) {
          console.error('[LLM IPC] RAG检索失败，继续普通对话:', ragError);
        }
      }

      // 使用新的 chatWithMessages 方法，保留完整的 messages 历史
      const response = await managerRef.current.chatWithMessages(enhancedMessages, options);

      console.log('[LLM IPC] LLM 聊天响应成功, tokens:', response.tokens);

      // 返回 OpenAI 兼容格式，包含检索到的文档
      return {
        content: response.text,
        message: response.message || {
          role: 'assistant',
          content: response.text,
        },
        usage: response.usage || {
          total_tokens: response.tokens || 0,
        },
        // 返回检索到的知识库文档，供前端展示引用
        retrievedDocs: retrievedDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          content: doc.content.substring(0, 200), // 只返回摘要
          score: doc.score,
        })),
      };
    } catch (error) {
      console.error('[LLM IPC] LLM 聊天失败:', error);
      throw error;
    }
  });

  /**
   * 使用提示词模板进行聊天
   * Channel: 'llm:chat-with-template'
   */
  ipcMain.handle('llm:chat-with-template', async (_event, { templateId, variables, messages = [], ...options }) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      if (!promptTemplateManager) {
        throw new Error('提示词模板管理器未初始化');
      }

      console.log('[LLM IPC] 使用模板进行聊天, templateId:', templateId);

      // 填充模板变量
      const filledPrompt = await promptTemplateManager.fillTemplate(templateId, variables);

      console.log('[LLM IPC] 模板已填充');

      // 构建消息数组，将填充后的模板作为用户消息
      const enhancedMessages = [
        ...messages,
        {
          role: 'user',
          content: filledPrompt,
        },
      ];

      // 调用标准的聊天方法
      return await managerRef.current.chatWithMessages(enhancedMessages, options);
    } catch (error) {
      console.error('[LLM IPC] 模板聊天失败:', error);
      throw error;
    }
  });

  /**
   * LLM 流式查询
   * Channel: 'llm:query-stream'
   */
  ipcMain.handle('llm:query-stream', async (_event, prompt, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      // 流式响应通过事件发送
      const result = await managerRef.current.queryStream(
        prompt,
        (chunk, fullText) => {
          if (mainWindow) {
            mainWindow.webContents.send('llm:stream-chunk', {
              chunk,
              fullText,
              conversationId: options.conversationId,
            });
          }
        },
        options
      );

      return result;
    } catch (error) {
      console.error('[LLM IPC] LLM流式查询失败:', error);
      throw error;
    }
  });

  /**
   * 获取 LLM 配置
   * Channel: 'llm:get-config'
   */
  ipcMain.handle('llm:get-config', async () => {
    try {
      const { getLLMConfig } = require('./llm-config');
      const llmConfig = getLLMConfig();
      return llmConfig.getAll();
    } catch (error) {
      console.error('[LLM IPC] 获取LLM配置失败:', error);
      throw error;
    }
  });

  /**
   * 设置 LLM 配置
   * Channel: 'llm:set-config'
   */
  ipcMain.handle('llm:set-config', async (_event, config) => {
    try {
      const { getLLMConfig } = require('./llm-config');
      const { LLMManager } = require('./llm-manager');
      const llmConfig = getLLMConfig();

      // 更新配置
      Object.keys(config).forEach((key) => {
        llmConfig.set(key, config[key]);
      });

      llmConfig.save();

      // 重新初始化LLM管理器
      if (managerRef.current) {
        await managerRef.current.close();
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

      console.log('[LLM IPC] LLM配置已更新并重新初始化');

      return true;
    } catch (error) {
      console.error('[LLM IPC] 设置LLM配置失败:', error);
      throw error;
    }
  });

  /**
   * 列出可用模型
   * Channel: 'llm:list-models'
   */
  ipcMain.handle('llm:list-models', async () => {
    try {
      if (!managerRef.current) {
        return [];
      }

      return await managerRef.current.listModels();
    } catch (error) {
      console.error('[LLM IPC] 列出模型失败:', error);
      return [];
    }
  });

  /**
   * 清除对话上下文
   * Channel: 'llm:clear-context'
   */
  ipcMain.handle('llm:clear-context', async (_event, conversationId) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      managerRef.current.clearContext(conversationId);
      return true;
    } catch (error) {
      console.error('[LLM IPC] 清除上下文失败:', error);
      throw error;
    }
  });

  /**
   * 生成文本嵌入（Embeddings）
   * Channel: 'llm:embeddings'
   */
  ipcMain.handle('llm:embeddings', async (_event, text) => {
    try {
      if (!managerRef.current) {
        throw new Error('LLM服务未初始化');
      }

      return await managerRef.current.embeddings(text);
    } catch (error) {
      console.error('[LLM IPC] 生成嵌入失败:', error);
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
  ipcMain.handle('llm:get-selector-info', async () => {
    try {
      if (!llmSelector) {
        throw new Error('LLM选择器未初始化');
      }

      return {
        characteristics: llmSelector.getAllCharacteristics(),
        taskTypes: llmSelector.getTaskTypes(),
      };
    } catch (error) {
      console.error('[LLM IPC] 获取LLM选择器信息失败:', error);
      throw error;
    }
  });

  /**
   * 智能选择最优 LLM
   * Channel: 'llm:select-best'
   */
  ipcMain.handle('llm:select-best', async (_event, options = {}) => {
    try {
      if (!llmSelector) {
        throw new Error('LLM选择器未初始化');
      }

      const provider = llmSelector.selectBestLLM(options);
      return provider;
    } catch (error) {
      console.error('[LLM IPC] 智能选择LLM失败:', error);
      throw error;
    }
  });

  /**
   * 生成 LLM 选择报告
   * Channel: 'llm:generate-report'
   */
  ipcMain.handle('llm:generate-report', async (_event, taskType = 'chat') => {
    try {
      if (!llmSelector) {
        throw new Error('LLM选择器未初始化');
      }

      return llmSelector.generateSelectionReport(taskType);
    } catch (error) {
      console.error('[LLM IPC] 生成LLM选择报告失败:', error);
      throw error;
    }
  });

  /**
   * 切换 LLM 提供商
   * Channel: 'llm:switch-provider'
   */
  ipcMain.handle('llm:switch-provider', async (_event, provider) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      const { getLLMConfig } = require('./llm-config');
      const { LLMManager } = require('./llm-manager');

      // 保存新的提供商到llm-config.json
      const llmConfig = getLLMConfig();
      llmConfig.setProvider(provider);

      // 重新初始化LLM管理器
      if (managerRef.current) {
        await managerRef.current.close();
      }

      const managerConfig = llmConfig.getManagerConfig();
      console.log(`[LLM IPC] 切换到LLM提供商: ${provider}, 配置:`, { model: managerConfig.model, baseURL: managerConfig.baseURL });

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
      console.error('[LLM IPC] 切换LLM提供商失败:', error);
      throw error;
    }
  });

  console.log('[LLM IPC] ✓ All LLM IPC handlers registered successfully (14 handlers)');
}

module.exports = {
  registerLLMIPC
};
