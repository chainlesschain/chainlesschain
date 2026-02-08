/**
 * 火山引擎豆包工具调用客户端
 *
 * 支持以下工具调用功能：
 * 1. 联网搜索 (Web Search)
 * 2. 图像处理 (Image Process)
 * 3. 私域知识库搜索 (Knowledge Search)
 * 4. 函数调用 (Function Calling)
 * 5. MCP (Model Context Protocol)
 */

const { logger } = require("../utils/logger.js");
const fetch = require("node-fetch");
const { getModelSelector } = require("./volcengine-models");

/**
 * 工具类型枚举
 */
const ToolTypes = {
  WEB_SEARCH: "web_search",
  IMAGE_PROCESS: "image_process",
  KNOWLEDGE_SEARCH: "knowledge_search",
  FUNCTION_CALLING: "function",
  MCP: "remote_mcp",
};

/**
 * 火山引擎工具调用客户端
 */
class VolcengineToolsClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || "https://ark.cn-beijing.volces.com/api/v3";
    this.model = config.model || "doubao-seed-1.6";
    this.timeout = config.timeout || 120000; // 2分钟超时
    this.modelSelector = getModelSelector();
  }

  /**
   * 通用 API 调用方法
   * @private
   */
  async _callAPI(endpoint, body, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify(body),
        timeout: this.timeout,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API调用失败: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error("[VolcengineTools] API调用错误:", error);
      throw error;
    }
  }

  /**
   * 流式 API 调用
   * @private
   */
  async _callStreamAPI(endpoint, body, onChunk, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify({ ...body, stream: true }),
        timeout: this.timeout,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API调用失败: ${response.status} - ${errorText}`);
      }

      let fullText = "";
      const reader = response.body;

      for await (const chunk of reader) {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              continue;
            }

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) {
                fullText += delta;
                if (onChunk) {
                  onChunk(delta);
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      return { text: fullText };
    } catch (error) {
      logger.error("[VolcengineTools] 流式API调用错误:", error);
      throw error;
    }
  }

  // ========== 1. 联网搜索 (Web Search) ==========

  /**
   * 启用联网搜索的对话
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   * @param {string} options.searchMode - 搜索模式: 'auto' | 'always' | 'never'
   * @param {boolean} options.stream - 是否流式输出
   * @param {Function} options.onChunk - 流式输出回调
   * @returns {Promise<Object>} API响应
   */
  async chatWithWebSearch(messages, options = {}) {
    const {
      searchMode = "auto",
      stream = false,
      onChunk = null,
      model = this.model,
    } = options;

    logger.info("[VolcengineTools] 启用联网搜索对话");
    logger.info("[VolcengineTools] 搜索模式:", searchMode);

    const body = {
      model: model,
      messages: messages,
      tools: [
        {
          type: ToolTypes.WEB_SEARCH,
          web_search: {
            search_mode: searchMode,
          },
        },
      ],
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  // ========== 2. 图像处理 (Image Process) ==========

  /**
   * 启用图像处理的对话
   * @param {Array} messages - 消息数组（需包含图像URL）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithImageProcess(messages, options = {}) {
    const {
      model = "doubao-seed-1.6-vision",
      stream = false,
      onChunk = null,
    } = options;

    logger.info("[VolcengineTools] 启用图像处理对话");

    // 自动选择最优视觉模型
    const selectedModel = this.modelSelector.selectByScenario({
      hasImage: true,
      userBudget: options.userBudget || "medium",
      needsThinking: options.needsThinking || false,
    });

    logger.info("[VolcengineTools] 选择视觉模型:", selectedModel.name);

    const body = {
      model: selectedModel.id,
      messages: messages,
      tools: [
        {
          type: ToolTypes.IMAGE_PROCESS,
        },
      ],
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  /**
   * 图像理解（简化接口）
   * @param {string} prompt - 提示词
   * @param {string|Array} imageUrl - 图片URL或URL数组
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 理解结果
   */
  async understandImage(prompt, imageUrl, options = {}) {
    const imageUrls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...imageUrls.map((url) => ({
            type: "image_url",
            image_url: { url: url },
          })),
        ],
      },
    ];

    const result = await this.chatWithImageProcess(messages, options);

    return {
      text: result.choices?.[0]?.message?.content || "",
      model: result.model,
      usage: result.usage,
      toolCalls: result.choices?.[0]?.message?.tool_calls,
    };
  }

  // ========== 3. 私域知识库搜索 (Knowledge Search) ==========

  /**
   * 配置知识库（上传文档）
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Array} documents - 文档数组
   * @returns {Promise<Object>} 上传结果
   */
  async setupKnowledgeBase(knowledgeBaseId, documents) {
    logger.info("[VolcengineTools] 上传文档到知识库:", knowledgeBaseId);

    return await this._callAPI(`/knowledge_base/${knowledgeBaseId}/documents`, {
      documents: documents,
    });
  }

  /**
   * 使用知识库增强的对话
   * @param {Array} messages - 消息数组
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithKnowledgeBase(messages, knowledgeBaseId, options = {}) {
    const {
      topK = 5,
      scoreThreshold = 0.7,
      enableRerank = true,
      model = this.model,
      stream = false,
      onChunk = null,
    } = options;

    logger.info("[VolcengineTools] 启用知识库搜索对话");
    logger.info("[VolcengineTools] 知识库ID:", knowledgeBaseId);

    const body = {
      model: model,
      messages: messages,
      tools: [
        {
          type: ToolTypes.KNOWLEDGE_SEARCH,
          knowledge_search: {
            knowledge_base_id: knowledgeBaseId,
            top_k: topK,
            score_threshold: scoreThreshold,
            enable_rerank: enableRerank,
          },
        },
      ],
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  // ========== 4. 函数调用 (Function Calling) ==========

  /**
   * Function Calling 对话
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithFunctionCalling(messages, functions, options = {}) {
    const {
      toolChoice = "auto",
      model = this.model,
      stream = false,
      onChunk = null,
    } = options;

    logger.info("[VolcengineTools] 启用函数调用对话");
    logger.info("[VolcengineTools] 可用函数数量:", functions.length);

    const tools = functions.map((func) => ({
      type: "function",
      function: func,
    }));

    const body = {
      model: model,
      messages: messages,
      tools: tools,
      tool_choice: toolChoice,
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  /**
   * 执行完整的 Function Calling 流程（包括函数执行）
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} functionExecutor - 函数执行器（包含execute方法）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 最终响应
   */
  async executeFunctionCalling(
    messages,
    functions,
    functionExecutor,
    options = {},
  ) {
    logger.info("[VolcengineTools] 执行完整函数调用流程");

    // 第一次调用：模型决定是否调用函数
    let result = await this.chatWithFunctionCalling(
      messages,
      functions,
      options,
    );

    // 如果模型决定调用函数
    while (result.choices?.[0]?.message?.tool_calls) {
      const toolCalls = result.choices[0].message.tool_calls;
      logger.info("[VolcengineTools] 模型请求调用", toolCalls.length, "个函数");

      // 执行所有函数调用
      const functionResults = [];
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        logger.info("[VolcengineTools] 执行函数:", functionName);
        logger.info("[VolcengineTools] 参数:", functionArgs);

        try {
          const execResult = await functionExecutor.execute(
            functionName,
            functionArgs,
          );
          functionResults.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify(execResult),
          });
        } catch (error) {
          logger.error("[VolcengineTools] 函数执行失败:", error);
          functionResults.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify({ error: error.message }),
          });
        }
      }

      // 将函数结果返回给模型
      const updatedMessages = [
        ...messages,
        result.choices[0].message,
        ...functionResults,
      ];

      // 再次调用模型，获取最终回答
      result = await this.chatWithFunctionCalling(
        updatedMessages,
        functions,
        options,
      );
      messages = updatedMessages;
    }

    return {
      text: result.choices?.[0]?.message?.content || "",
      model: result.model,
      usage: result.usage,
      messages: messages, // 返回完整对话历史
    };
  }

  // ========== 5. MCP (Model Context Protocol) ==========

  /**
   * 使用 Remote MCP
   * @param {Array} messages - 消息数组
   * @param {Object} mcpConfig - MCP配置
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithMCP(messages, mcpConfig, options = {}) {
    const { model = this.model, stream = false, onChunk = null } = options;

    logger.info("[VolcengineTools] 启用MCP对话");
    logger.info("[VolcengineTools] MCP服务器:", mcpConfig.serverURL);

    const body = {
      model: model,
      messages: messages,
      tools: [
        {
          type: ToolTypes.MCP,
          remote_mcp: {
            server_url: mcpConfig.serverURL,
            tools: mcpConfig.tools || [],
          },
        },
      ],
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  // ========== 混合工具调用 ==========

  /**
   * 同时启用多个工具的对话
   * @param {Array} messages - 消息数组
   * @param {Object} toolConfig - 工具配置
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithMultipleTools(messages, toolConfig = {}, options = {}) {
    const {
      enableWebSearch = false,
      enableImageProcess = false,
      enableKnowledgeSearch = false,
      enableFunctionCalling = false,
      enableMCP = false,
      model = this.model,
      stream = false,
      onChunk = null,
    } = options;

    logger.info("[VolcengineTools] 启用多工具对话");

    const tools = [];

    // 联网搜索
    if (enableWebSearch) {
      tools.push({
        type: ToolTypes.WEB_SEARCH,
        web_search: {
          search_mode: toolConfig.searchMode || "auto",
        },
      });
    }

    // 图像处理
    if (enableImageProcess) {
      tools.push({
        type: ToolTypes.IMAGE_PROCESS,
      });
    }

    // 知识库搜索
    if (enableKnowledgeSearch && toolConfig.knowledgeBaseId) {
      tools.push({
        type: ToolTypes.KNOWLEDGE_SEARCH,
        knowledge_search: {
          knowledge_base_id: toolConfig.knowledgeBaseId,
          top_k: toolConfig.topK || 5,
          score_threshold: toolConfig.scoreThreshold || 0.7,
          enable_rerank: toolConfig.enableRerank !== false,
        },
      });
    }

    // 函数调用
    if (enableFunctionCalling && toolConfig.functions) {
      const functionTools = toolConfig.functions.map((func) => ({
        type: "function",
        function: func,
      }));
      tools.push(...functionTools);
    }

    // MCP
    if (enableMCP && toolConfig.mcpConfig) {
      tools.push({
        type: ToolTypes.MCP,
        remote_mcp: {
          server_url: toolConfig.mcpConfig.serverURL,
          tools: toolConfig.mcpConfig.tools || [],
        },
      });
    }

    logger.info("[VolcengineTools] 启用工具数量:", tools.length);

    const body = {
      model: model,
      messages: messages,
      tools: tools,
    };

    if (stream && onChunk) {
      return await this._callStreamAPI("/chat/completions", body, onChunk);
    } else {
      return await this._callAPI("/chat/completions", body);
    }
  }

  // ========== 辅助方法 ==========

  /**
   * 检查API Key是否配置
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * 获取当前配置
   * @returns {Object}
   */
  getConfig() {
    return {
      baseURL: this.baseURL,
      model: this.model,
      timeout: this.timeout,
      hasApiKey: !!this.apiKey,
    };
  }

  /**
   * 更新配置
   * @param {Object} config - 新配置
   */
  updateConfig(config = {}) {
    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }
    if (config.baseURL) {
      this.baseURL = config.baseURL;
    }
    if (config.model) {
      this.model = config.model;
    }
    if (config.timeout) {
      this.timeout = config.timeout;
    }

    logger.info("[VolcengineTools] 配置已更新");
  }
}

module.exports = {
  VolcengineToolsClient,
  ToolTypes,
};
