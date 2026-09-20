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

const fetch = require("node-fetch");
const { getModelSelector } = require("./volcengine-models");
const { createProviderLogger } = require("./provider-log-privacy");
const {
  projectVolcengineToolSuccess,
} = require("./volcengine-tool-success-projection");
const providerLog = createProviderLogger("volcengine");

const _deps = {
  fetch: (...args) => fetch(...args),
};

function assertGovernedKnowledgeBaseIngress() {
  const error = new Error(
    "External knowledge-base document upload requires a governed evidence ingress",
  );
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}

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
    this.timeout = config.timeout || 300000; // 5分钟超时
    this.modelSelector = getModelSelector();
  }

  /**
   * 通用 API 调用方法
   * @private
   */
  async _callAPI(endpoint, body, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    try {
      const {
        prepareDesktopModelRequest,
      } = require("../evolution/desktop-model-ingress");
      const governed =
        endpoint === "/chat/completions"
          ? await prepareDesktopModelRequest(this, body)
          : null;
      const response = await _deps.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify(governed?.body ?? body),
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw providerLog.failure("chat");
      }

      const result = await response.json();
      if (governed) {
        if (!result.choices?.[0]?.message || result.error) {
          const error = new Error("Tool model response is invalid");
          error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
          throw error;
        }
        await governed.complete(result.choices[0].message);
      }
      return result;
    } catch (error) {
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
      if (error.code === "CC_LLM_PROVIDER_OPERATION_FAILED") throw error;
      throw providerLog.failure("chat");
    }
  }

  /**
   * 流式 API 调用
   * @private
   */
  async _callStreamAPI(endpoint, body, onChunk, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    try {
      const {
        prepareDesktopModelRequest,
        consumeDesktopToolStream,
      } = require("../evolution/desktop-model-ingress");
      const governed = await prepareDesktopModelRequest(this, {
        ...body,
        stream: true,
      });
      const response = await _deps.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify(governed?.body ?? { ...body, stream: true }),
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw providerLog.failure("chat-stream");
      }

      let fullText = "";
      if (governed)
        return await consumeDesktopToolStream(governed, response, onChunk);
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
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      return { text: fullText };
    } catch (error) {
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
      if (error.code === "CC_LLM_PROVIDER_OPERATION_FAILED") throw error;
      throw providerLog.failure("chat-stream");
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

    providerLog.started(stream ? "chat-stream" : "chat");

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
    const { stream = false, onChunk = null } = options;

    providerLog.started(stream ? "chat-stream" : "chat");

    // 自动选择最优视觉模型
    const selectedModel = this.modelSelector.selectByScenario({
      hasImage: true,
      userBudget: options.userBudget || "medium",
      needsThinking: options.needsThinking || false,
    });

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

    return projectVolcengineToolSuccess(result);
  }

  // ========== 3. 私域知识库搜索 (Knowledge Search) ==========

  /**
   * 配置知识库（上传文档）
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Array} documents - 文档数组
   * @returns {Promise<Object>} 上传结果
   */
  async setupKnowledgeBase(knowledgeBaseId, documents) {
    // The Desktop model capability only governs model requests. It cannot
    // attest arbitrary raw document uploads, so this legacy cloud-KB endpoint
    // must remain unavailable until an evidence-ingress bridge is supplied.
    assertGovernedKnowledgeBaseIngress();
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

    providerLog.started(stream ? "chat-stream" : "chat");

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

    providerLog.started(stream ? "chat-stream" : "chat");

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
    const {
      runDesktopModelWorkflow,
    } = require("../evolution/desktop-model-ingress");
    return runDesktopModelWorkflow(this, { messages, functions }, () =>
      this._executeFunctionCalling(
        messages,
        functions,
        functionExecutor,
        options,
      ),
    );
  }

  async _executeFunctionCalling(
    messages,
    functions,
    functionExecutor,
    options,
  ) {
    providerLog.started("chat");

    // 第一次调用：模型决定是否调用函数
    let result = await this.chatWithFunctionCalling(
      messages,
      functions,
      options,
    );

    // Bound the tool-call loop: a model stuck returning tool_calls every turn
    // would otherwise re-invoke the API forever. Cap the iterations.
    const maxToolIterations = options.maxToolIterations || 10;
    let toolIterations = 0;

    // 如果模型决定调用函数
    while (result.choices?.[0]?.message?.tool_calls) {
      if (++toolIterations > maxToolIterations) {
        require("../evolution/desktop-model-ingress").assertDesktopToolLoopComplete(
          this,
        );
        providerLog.retry("chat", toolIterations);
        break;
      }
      const toolCalls = result.choices[0].message.tool_calls;
      // 执行所有函数调用
      const functionResults = [];
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;

        try {
          // Parse args inside the try: model tool-call arguments are frequently
          // malformed/truncated (length-limited / streamed), and an unguarded
          // JSON.parse here threw out of the WHOLE flow instead of being handled
          // per-tool like execution errors below.
          const functionArgs = JSON.parse(toolCall.function.arguments);

          const {
            runDesktopToolExecution,
          } = require("../evolution/desktop-model-ingress");
          const execResult = await runDesktopToolExecution(this, toolCall, () =>
            functionExecutor.execute(functionName, functionArgs),
          );
          functionResults.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify(execResult),
          });
        } catch (error) {
          if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
          providerLog.failure("chat");
          functionResults.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify({
              error: "Tool execution failed",
              code: "CC_LLM_TOOL_EXECUTION_FAILED",
            }),
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

    return projectVolcengineToolSuccess(result);
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

    providerLog.started(stream ? "chat-stream" : "chat");

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

    providerLog.started(stream ? "chat-stream" : "chat");

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
      endpointConfigured:
        typeof this.baseURL === "string" && this.baseURL.length > 0,
      modelConfigured: typeof this.model === "string" && this.model.length > 0,
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

    providerLog.success("configure");
  }
}

module.exports = {
  VolcengineToolsClient,
  ToolTypes,
  _deps,
};
