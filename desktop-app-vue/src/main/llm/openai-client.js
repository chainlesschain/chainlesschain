/**
 * OpenAI 兼容 API 客户端
 *
 * 支持: OpenAI, DeepSeek, 以及其他兼容OpenAI API的服务
 */

const { createProviderLogger } = require("./provider-log-privacy");

function assertGovernedModelIngress() {
  const error = new Error(
    "External OpenAI embeddings require a governed model ingress",
  );
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}
const axios = require("axios");
const EventEmitter = require("events");
const {
  prepareDesktopModelRequest,
} = require("../evolution/desktop-model-ingress");

const RETRYABLE_TRANSPORT_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_NETWORK",
]);

function isRetryableTransportError(error) {
  try {
    return (
      RETRYABLE_TRANSPORT_CODES.has(error?.code) ||
      error?.name === "TimeoutError"
    );
  } catch {
    return false;
  }
}

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
    this.providerLog = createProviderLogger(config.providerId || "openai");

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
      // Health checks must not invoke a model.  In particular, the former
      // Volcengine branch sent an ungoverned `/chat/completions` request just
      // to determine availability.  `/models` is a control-plane request and
      // keeps startup from becoming an unrecorded model ingress.
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
    } catch {
      return {
        ...this.providerLog.unavailable("status"),
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

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

        const governed = await prepareDesktopModelRequest(this, requestBody);
        const response = await this.client.post(
          "/chat/completions",
          governed?.body ?? requestBody,
          {
            ...(options.signal && { signal: options.signal }),
          },
        );

        const choice = response.data.choices[0];
        const result = {
          message: choice.message,
          finish_reason: choice.finish_reason,
          model: response.data.model,
          usage: response.data.usage,
          tokens: response.data.usage?.total_tokens || 0,
        };
        if (governed) {
          await governed.complete(choice.message, result);
        }
        return result;
      } catch (error) {
        if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") {
          throw error;
        }

        // Only retry on timeout or network errors
        if (isRetryableTransportError(error) && attempt < maxRetries) {
          this.providerLog.retry("chat", attempt + 1);
          // Wait before retry (exponential backoff: 2s, 4s)
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * Math.pow(2, attempt)),
          );
          continue;
        }

        throw this.providerLog.failure("chat");
      }
    }

    // Should not reach here, but just in case
    throw this.providerLog.failure("chat");
  }

  /**
   * 聊天补全（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async chatStream(messages, onChunk, options = {}) {
    let governed = null;
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

      governed = await prepareDesktopModelRequest(this, requestBody);
      const response = await this.client.post(
        "/chat/completions",
        governed?.body ?? requestBody,
        {
          responseType: "stream",
          ...(options.signal && { signal: options.signal }),
        },
      );

      const fullMessage = {
        role: "assistant",
        content: "",
      };

      const result = await new Promise((resolve, reject) => {
        let buffer = "";
        let sawTerminal = false;
        let responseModel = options.model || this.model;
        let finishReason = "stop";
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
              sawTerminal = true;
              if (governed) {
                continue;
              }
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
              if (parsed.model) {
                responseModel = parsed.model;
              }
              if (parsed.choices[0]?.finish_reason) {
                sawTerminal = true;
                finishReason = parsed.choices[0].finish_reason;
              }

              if (delta?.content) {
                fullMessage.content += delta.content;
                // 传递对象格式的chunk，保持统一接口
                onChunk({
                  content: delta.content,
                  delta: delta,
                  fullContent: fullMessage.content,
                });
              }

              if (parsed.choices[0]?.finish_reason && !governed) {
                resolve({
                  message: fullMessage,
                  model: parsed.model,
                  finish_reason: parsed.choices[0].finish_reason,
                });
              }
            } catch {
              // 忽略解析错误
            }
          }
        });

        response.data.on("error", (error) => {
          reject(error);
        });
        if (governed) {
          response.data.on("close", () => {
            if (!response.data.readableEnded) {
              reject(
                new Error("Desktop model stream closed before completion"),
              );
            }
          });
        }

        response.data.on("end", () => {
          if (governed && !sawTerminal) {
            reject(
              new Error("Desktop model stream ended without a terminal frame"),
            );
            return;
          }
          // 如果没有收到[DONE]，也要resolve
          resolve({
            message: fullMessage,
            model: responseModel,
            finish_reason: finishReason,
          });
        });
      });
      if (governed) {
        await governed.complete(result.message);
      }
      return result;
    } catch (error) {
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") {
        throw error;
      }
      if (governed) {
        const interrupted = new Error(
          "Governed Desktop model stream did not complete",
        );
        interrupted.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
        throw interrupted;
      }
      throw this.providerLog.failure("chat-stream");
    }
  }

  /**
   * 文本补全（非流式）- 兼容老版API
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   */
  async complete(prompt, options = {}) {
    try {
      const requestBody = {
        model: options.model || "gpt-3.5-turbo-instruct",
        prompt,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1000,
        top_p: options.top_p || 1,
        stream: false,
      };
      const governed = await prepareDesktopModelRequest(this, requestBody);
      const response = await this.client.post(
        "/completions",
        governed?.body ?? requestBody,
      );

      const choice = response.data.choices[0];
      if (governed) {
        await governed.complete(choice.text);
      }

      return {
        text: choice.text,
        finish_reason: choice.finish_reason,
        model: response.data.model,
        usage: response.data.usage,
        tokens: response.data.usage?.total_tokens || 0,
      };
    } catch (error) {
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") {
        throw error;
      }
      throw this.providerLog.failure("complete");
    }
  }

  /**
   * 生成嵌入向量
   * @param {string|Array} input - 文本或文本数组
   * @param {string} model - 模型（可选，默认使用配置的embeddingModel）
   */
  async embeddings(input, model = null) {
    try {
      assertGovernedModelIngress();
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
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") {
        throw error;
      }
      throw this.providerLog.failure("embed");
    }
  }

  /**
   * 列出可用模型
   */
  async listModels() {
    try {
      const response = await this.client.get("/models");
      return response.data.data;
    } catch {
      throw this.providerLog.failure("list-models");
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
    } catch {
      throw this.providerLog.failure("model-info");
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
      providerId: "deepseek",
    });
  }
}

module.exports = {
  OpenAIClient,
  DeepSeekClient,
  isRetryableTransportError,
};
