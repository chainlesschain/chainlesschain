/**
 * OpenAI 兼容 API 客户端
 *
 * 支持: OpenAI, DeepSeek, 以及其他兼容OpenAI API的服务
 */

const { logger } = require("../utils/logger.js");
const axios = require("axios");
const EventEmitter = require("events");

/**
 * OpenAI兼容客户端类
 */
class OpenAIClient extends EventEmitter {
  constructor(config = {}) {
    super();

    // API配置
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || "https://api.openai.com/v1";
    this.model = config.model || "gpt-3.5-turbo";
    this.embeddingModel = config.embeddingModel || "text-embedding-ada-002";
    this.timeout = config.timeout || 300000; // 5 minutes default
    this.maxRetries = config.maxRetries || 2; // Retry up to 2 times on timeout
    this.organization = config.organization;

    // 创建axios实例
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        ...(this.organization && { "OpenAI-Organization": this.organization }),
      },
    });
  }

  /**
   * 检查服务状态
   */
  async checkStatus() {
    try {
      // 火山引擎特殊处理：使用简单的聊天测试代替模型列表
      if (this.baseURL && this.baseURL.includes("volces.com")) {
        logger.info("[OpenAIClient] 检测到火山引擎，使用聊天测试代替模型列表");

        const testResponse = await this.client.post(
          "/chat/completions",
          {
            model: this.model,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5,
          },
          {
            timeout: 10000, // 10秒快速超时
          },
        );

        return {
          available: true,
          models: [
            {
              name: this.model,
              created: Date.now(),
              owned_by: "volcengine",
            },
          ],
          testResponse: testResponse.data,
        };
      }

      // 标准OpenAI API：尝试列出模型
      const response = await this.client.get("/models");

      const models = response.data.data || [];

      return {
        available: true,
        models: models.map((m) => ({
          name: m.id,
          created: m.created,
          owned_by: m.owned_by,
        })),
      };
    } catch (error) {
      return {
        available: false,
        error: error.response?.data?.error?.message || error.message,
        models: [],
      };
    }
  }

  /**
   * 聊天补全（非流式）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   */
  async chat(messages, options = {}) {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`[OpenAIClient] 重试第 ${attempt} 次...`);
        }

        // 构建请求体
        const requestBody = {
          model: options.model || this.model,
          messages,
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 1,
          max_tokens: options.max_tokens,
          presence_penalty: options.presence_penalty || 0,
          frequency_penalty: options.frequency_penalty || 0,
          stream: false,
        };

        // 🔥 修复：只有在 tools 有效且非空时才添加（避免阿里云等API报错）
        if (
          options.tools &&
          Array.isArray(options.tools) &&
          options.tools.length > 0
        ) {
          // 验证每个tool都有必要的字段
          const validTools = options.tools.filter((tool) => {
            if (tool.type === "function") {
              return tool.function && tool.function.name;
            }
            return true; // 其他类型的工具暂时允许
          });

          if (validTools.length > 0) {
            requestBody.tools = validTools;
          }
        }

        const response = await this.client.post(
          "/chat/completions",
          requestBody,
          {
            ...(options.signal && { signal: options.signal }),
          },
        );

        const choice = response.data.choices[0];

        return {
          message: choice.message,
          finish_reason: choice.finish_reason,
          model: response.data.model,
          usage: response.data.usage,
          tokens: response.data.usage?.total_tokens || 0,
        };
      } catch (error) {
        lastError = error;
        const isTimeout =
          error.code === "ECONNABORTED" || error.message?.includes("timeout");
        const isNetworkError =
          error.code === "ECONNRESET" || error.code === "ENOTFOUND";

        // Only retry on timeout or network errors
        if ((isTimeout || isNetworkError) && attempt < maxRetries) {
          logger.warn(
            `[OpenAIClient] 请求超时或网络错误，将重试: ${error.message}`,
          );
          // Wait before retry (exponential backoff: 2s, 4s)
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * Math.pow(2, attempt)),
          );
          continue;
        }

        logger.error("[OpenAIClient] 聊天失败:", error.response?.data || error);
        throw new Error(this._formatAPIError(error));
      }
    }

    // Should not reach here, but just in case
    throw lastError;
  }

  /**
   * 聊天补全（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async chatStream(messages, onChunk, options = {}) {
    try {
      // 构建请求体
      const requestBody = {
        model: options.model || this.model,
        messages,
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 1,
        max_tokens: options.max_tokens,
        presence_penalty: options.presence_penalty || 0,
        frequency_penalty: options.frequency_penalty || 0,
        stream: true,
      };

      // 🔥 修复：只有在 tools 有效且非空时才添加（避免阿里云等API报错）
      if (
        options.tools &&
        Array.isArray(options.tools) &&
        options.tools.length > 0
      ) {
        // 验证每个tool都有必要的字段
        const validTools = options.tools.filter((tool) => {
          if (tool.type === "function") {
            return tool.function && tool.function.name;
          }
          return true; // 其他类型的工具暂时允许
        });

        if (validTools.length > 0) {
          requestBody.tools = validTools;
        }
      }

      const response = await this.client.post(
        "/chat/completions",
        requestBody,
        {
          responseType: "stream",
        },
      );

      const fullMessage = {
        role: "assistant",
        content: "",
      };

      return new Promise((resolve, reject) => {
        let buffer = "";
        response.data.on("data", (chunk) => {
          // Buffer across 'data' events: a single SSE "data:" frame can be split
          // across TCP chunks; parsing each chunk independently dropped the
          // halves (silently losing tokens). anthropic/gemini clients buffer;
          // this one didn't. Keep the trailing incomplete line in the buffer.
          buffer += chunk.toString();
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";
          const lines = parts.filter((line) =>
            line.trim().startsWith("data: "),
          );

          for (const line of lines) {
            const data = line.trim().replace(/^data: /, "");

            if (data === "[DONE]") {
              resolve({
                message: fullMessage,
                model: options.model || this.model,
                finish_reason: "stop",
              });
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices[0]?.delta;

              if (delta?.content) {
                fullMessage.content += delta.content;
                // 传递对象格式的chunk，保持统一接口
                onChunk({
                  content: delta.content,
                  delta: delta,
                  fullContent: fullMessage.content,
                });
              }

              if (parsed.choices[0]?.finish_reason) {
                resolve({
                  message: fullMessage,
                  model: parsed.model,
                  finish_reason: parsed.choices[0].finish_reason,
                });
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        response.data.on("error", (error) => {
          reject(error);
        });

        response.data.on("end", () => {
          // 如果没有收到[DONE]，也要resolve
          resolve({
            message: fullMessage,
            model: options.model || this.model,
            finish_reason: "stop",
          });
        });
      });
    } catch (error) {
      logger.error(
        "[OpenAIClient] 流式聊天失败:",
        error.response?.data || error,
      );
      throw new Error(this._formatAPIError(error));
    }
  }

  /**
   * 文本补全（非流式）- 兼容老版API
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   */
  async complete(prompt, options = {}) {
    try {
      const response = await this.client.post("/completions", {
        model: options.model || "gpt-3.5-turbo-instruct",
        prompt,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1000,
        top_p: options.top_p || 1,
        stream: false,
      });

      const choice = response.data.choices[0];

      return {
        text: choice.text,
        finish_reason: choice.finish_reason,
        model: response.data.model,
        usage: response.data.usage,
        tokens: response.data.usage?.total_tokens || 0,
      };
    } catch (error) {
      logger.error("[OpenAIClient] 补全失败:", error.response?.data || error);
      throw new Error(this._formatAPIError(error));
    }
  }

  /**
   * 生成嵌入向量
   * @param {string|Array} input - 文本或文本数组
   * @param {string} model - 模型（可选，默认使用配置的embeddingModel）
   */
  async embeddings(input, model = null) {
    try {
      const embeddingModel = model || this.embeddingModel;

      const response = await this.client.post("/embeddings", {
        model: embeddingModel,
        input,
      });

      if (Array.isArray(input)) {
        return response.data.data.map((d) => d.embedding);
      } else {
        return response.data.data[0].embedding;
      }
    } catch (error) {
      logger.error(
        "[OpenAIClient] 生成嵌入失败:",
        error.response?.data || error,
      );
      throw new Error(this._formatAPIError(error));
    }
  }

  /**
   * 列出可用模型
   */
  async listModels() {
    try {
      const response = await this.client.get("/models");
      return response.data.data;
    } catch (error) {
      logger.error(
        "[OpenAIClient] 列出模型失败:",
        error.response?.data || error,
      );
      throw new Error(this._formatAPIError(error));
    }
  }

  /**
   * 获取模型信息
   * @param {string} modelId - 模型ID
   */
  async getModel(modelId) {
    try {
      const response = await this.client.get(`/models/${modelId}`);
      return response.data;
    } catch (error) {
      logger.error(
        "[OpenAIClient] 获取模型信息失败:",
        error.response?.data || error,
      );
      throw new Error(this._formatAPIError(error));
    }
  }

  /**
   * 格式化 API 错误为用户友好的消息
   * @param {Error} error - axios 错误对象
   * @returns {string} 用户友好的错误消息
   */
  _formatAPIError(error) {
    const status = error.response?.status;
    const serverMessage = error.response?.data?.error?.message;
    const baseURL = this.baseURL || "";

    switch (status) {
      case 401:
        return `API 密钥无效或已过期，请在设置中检查 API Key 配置（${baseURL}）`;
      case 403:
        return `API 访问被拒绝，请检查 API Key 权限或账户状态（${baseURL}）`;
      case 429:
        return `API 请求频率超限或额度用尽，请稍后重试或检查账户余额（${baseURL}）`;
      case 500:
      case 502:
      case 503:
        return `API 服务暂时不可用（HTTP ${status}），请稍后重试（${baseURL}）`;
      case 404:
        return `API 端点不存在或模型不可用，请检查 API 地址和模型配置（${baseURL}）`;
      default:
        if (
          error.code === "ECONNABORTED" ||
          error.message?.includes("timeout")
        ) {
          return `API 请求超时，请检查网络连接或稍后重试（${baseURL}）`;
        }
        if (error.code === "ECONNREFUSED") {
          return `无法连接到 API 服务，请检查服务地址是否正确（${baseURL}）`;
        }
        if (error.code === "ENOTFOUND") {
          return `无法解析 API 服务地址，请检查网络连接和 API 地址配置（${baseURL}）`;
        }
        return serverMessage || error.message;
    }
  }
}

/**
 * DeepSeek 客户端 (使用OpenAI兼容API)
 */
class DeepSeekClient extends OpenAIClient {
  constructor(config = {}) {
    super({
      ...config,
      baseURL: config.baseURL || "https://api.deepseek.com/v1",
      model: config.model || "deepseek-chat",
    });
  }
}

module.exports = {
  OpenAIClient,
  DeepSeekClient,
};
