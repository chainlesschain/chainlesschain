/**
 * 火山引擎工具调用 IPC 处理器
 *
 * 提供渲染进程与主进程之间的通信桥梁
 */

const { ipcMain } = require('electron');
const { VolcengineToolsClient } = require('./volcengine-tools');
const { getLLMConfig } = require('./llm-config');
const { getModelSelector, TaskTypes } = require('./volcengine-models');

let toolsClient = null;

/**
 * 获取或创建工具客户端
 */
function getToolsClient() {
  if (!toolsClient) {
    const llmConfig = getLLMConfig();
    const volcengineConfig = llmConfig.getProviderConfig('volcengine');

    if (!volcengineConfig.apiKey) {
      throw new Error('火山引擎 API Key 未配置');
    }

    toolsClient = new VolcengineToolsClient({
      apiKey: volcengineConfig.apiKey,
      baseURL: volcengineConfig.baseURL,
      model: volcengineConfig.model,
    });
  }

  return toolsClient;
}

/**
 * 注册所有 IPC 处理器
 */
function registerVolcengineIPC() {
  console.log('[VolcengineIPC] 注册火山引擎工具调用IPC处理器');

  // ========== 模型选择器 ==========

  /**
   * 智能选择模型（根据场景）
   */
  ipcMain.handle('volcengine:select-model', async (event, { scenario }) => {
    try {
      const selector = getModelSelector();
      const model = selector.selectByScenario(scenario);

      return {
        success: true,
        data: {
          modelId: model.id,
          modelName: model.name,
          capabilities: model.capabilities,
          pricing: model.pricing,
          description: model.description,
          contextLength: model.contextLength,
          maxOutputTokens: model.maxOutputTokens,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 模型选择失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 根据任务类型选择模型
   */
  ipcMain.handle('volcengine:select-model-by-task', async (event, { taskType, options }) => {
    try {
      const selector = getModelSelector();
      const model = selector.selectModel(taskType, options);

      return {
        success: true,
        data: {
          modelId: model.id,
          modelName: model.name,
          capabilities: model.capabilities,
          pricing: model.pricing,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 任务模型选择失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 估算成本
   */
  ipcMain.handle('volcengine:estimate-cost', async (event, { modelId, inputTokens, outputTokens, imageCount }) => {
    try {
      const selector = getModelSelector();
      const cost = selector.estimateCost(modelId, inputTokens, outputTokens, imageCount);

      return {
        success: true,
        data: {
          cost: cost,
          formatted: `¥${cost.toFixed(4)}`,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 成本估算失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 列出所有模型
   */
  ipcMain.handle('volcengine:list-models', async (event, { filters }) => {
    try {
      const selector = getModelSelector();
      const models = selector.listModels(filters || {});

      return {
        success: true,
        data: models.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          capabilities: m.capabilities,
          pricing: m.pricing,
          recommended: m.recommended,
        })),
      };
    } catch (error) {
      console.error('[VolcengineIPC] 列出模型失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 联网搜索 ==========

  /**
   * 联网搜索对话
   */
  ipcMain.handle('volcengine:chat-with-web-search', async (event, { messages, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithWebSearch(messages, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          searchResults: result.choices?.[0]?.message?.search_results,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 联网搜索对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 图像处理 ==========

  /**
   * 图像处理对话
   */
  ipcMain.handle('volcengine:chat-with-image', async (event, { messages, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithImageProcess(messages, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 图像处理对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 图像理解（简化接口）
   */
  ipcMain.handle('volcengine:understand-image', async (event, { prompt, imageUrl, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.understandImage(prompt, imageUrl, options || {});

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[VolcengineIPC] 图像理解失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 知识库搜索 ==========

  /**
   * 配置知识库（上传文档）
   */
  ipcMain.handle('volcengine:setup-knowledge-base', async (event, { knowledgeBaseId, documents }) => {
    try {
      const client = getToolsClient();
      const result = await client.setupKnowledgeBase(knowledgeBaseId, documents);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[VolcengineIPC] 配置知识库失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 知识库搜索对话
   */
  ipcMain.handle('volcengine:chat-with-knowledge-base', async (event, { messages, knowledgeBaseId, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithKnowledgeBase(messages, knowledgeBaseId, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          knowledgeResults: result.choices?.[0]?.message?.knowledge_results,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 知识库搜索对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 函数调用 ==========

  /**
   * Function Calling 对话
   */
  ipcMain.handle('volcengine:chat-with-function-calling', async (event, { messages, functions, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithFunctionCalling(messages, functions, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
          finishReason: result.choices?.[0]?.finish_reason,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 函数调用对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 执行完整的 Function Calling 流程
   * 注意：functionExecutor 需要在主进程侧定义
   */
  ipcMain.handle('volcengine:execute-function-calling', async (event, { messages, functions, executorType, options }) => {
    try {
      const client = getToolsClient();

      // 根据类型获取函数执行器
      const functionExecutor = getFunctionExecutor(executorType);

      const result = await client.executeFunctionCalling(messages, functions, functionExecutor, options || {});

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[VolcengineIPC] 执行函数调用流程失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== MCP ==========

  /**
   * MCP 对话
   */
  ipcMain.handle('volcengine:chat-with-mcp', async (event, { messages, mcpConfig, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithMCP(messages, mcpConfig, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] MCP对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 多工具混合调用 ==========

  /**
   * 多工具混合对话
   */
  ipcMain.handle('volcengine:chat-with-multiple-tools', async (event, { messages, toolConfig, options }) => {
    try {
      const client = getToolsClient();
      const result = await client.chatWithMultipleTools(messages, toolConfig || {}, options || {});

      return {
        success: true,
        data: {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model,
          usage: result.usage,
          toolCalls: result.choices?.[0]?.message?.tool_calls,
        },
      };
    } catch (error) {
      console.error('[VolcengineIPC] 多工具对话失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ========== 配置管理 ==========

  /**
   * 检查配置状态
   */
  ipcMain.handle('volcengine:check-config', async (event) => {
    try {
      const client = getToolsClient();
      const config = client.getConfig();

      return {
        success: true,
        data: config,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新配置
   */
  ipcMain.handle('volcengine:update-config', async (event, { config }) => {
    try {
      // 更新 LLM 配置
      const llmConfig = getLLMConfig();
      llmConfig.setProviderConfig('volcengine', config);

      // 重新创建客户端
      toolsClient = null;

      return {
        success: true,
        message: '配置已更新',
      };
    } catch (error) {
      console.error('[VolcengineIPC] 更新配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  console.log('[VolcengineIPC] IPC处理器注册完成');
}

/**
 * 获取函数执行器
 * @param {string} executorType - 执行器类型
 * @returns {Object} 函数执行器
 */
function getFunctionExecutor(executorType) {
  // 这里可以根据类型返回不同的执行器
  // 示例：返回一个简单的执行器
  return {
    async execute(functionName, args) {
      console.log(`[FunctionExecutor] 执行函数: ${functionName}`, args);

      // TODO: 根据 functionName 调用实际的业务逻辑
      // 例如：调用数据库、文件系统、P2P网络等

      switch (functionName) {
        case 'create_note':
          // 调用笔记创建逻辑
          return { noteId: 'mock-note-id', success: true };

        case 'search_notes':
          // 调用笔记搜索逻辑
          return { notes: [], total: 0 };

        case 'send_p2p_message':
          // 调用P2P消息发送逻辑
          return { messageId: 'mock-message-id', success: true };

        default:
          throw new Error(`未知函数: ${functionName}`);
      }
    }
  };
}

/**
 * 注销所有 IPC 处理器
 */
function unregisterVolcengineIPC() {
  console.log('[VolcengineIPC] 注销火山引擎工具调用IPC处理器');

  const channels = [
    'volcengine:select-model',
    'volcengine:select-model-by-task',
    'volcengine:estimate-cost',
    'volcengine:list-models',
    'volcengine:chat-with-web-search',
    'volcengine:chat-with-image',
    'volcengine:understand-image',
    'volcengine:setup-knowledge-base',
    'volcengine:chat-with-knowledge-base',
    'volcengine:chat-with-function-calling',
    'volcengine:execute-function-calling',
    'volcengine:chat-with-mcp',
    'volcengine:chat-with-multiple-tools',
    'volcengine:check-config',
    'volcengine:update-config',
  ];

  channels.forEach(channel => {
    ipcMain.removeHandler(channel);
  });

  console.log('[VolcengineIPC] IPC处理器已注销');
}

module.exports = {
  registerVolcengineIPC,
  unregisterVolcengineIPC,
  TaskTypes, // 导出供渲染进程使用
};
