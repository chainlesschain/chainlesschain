/**
 * Ollama API 客户端
 *
 * 支持本地Ollama服务
 */

const { logger } = require("../utils/logger.js");
const axios = require("axios");
const EventEmitter = require("events");

/**
 * Ollama客户端类
 */
class OllamaClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.baseURL = config.baseURL || "http://localhost:11434";
    this.timeout = config.timeout || 120000; // 2分钟
    this.model = config.model || "llama2";

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * 检查Ollama服务状态
   */
  async checkStatus() {
    try {
      const response = await this.client.get("/api/tags");
      const models = response.data.models || [];

      return {
        available: true,
        models: models.map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })),
        version: response.data.version,
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        models: [],
      };
    }
  }

  /**
   * 生成对话（非流式）
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   */
  async generate(prompt, options = {}) {
    try {
      const response = await this.client.post("/api/generate", {
        model: options.model || this.model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          top_k: options.top_k || 40,
        },
        context: options.context,
      });

      return {
        text: response.data.response,
        model: response.data.model,
        context: response.data.context,
        done: response.data.done,
        total_duration: response.data.total_duration,
        tokens: response.data.eval_count || 0,
      };
    } catch (error) {
      logger.error("[OllamaClient] 生成失败:", error);
      throw error;
    }
  }

  /**
   * 生成对话（流式）
   * @param {string} prompt - 提示词
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async generateStream(prompt, onChunk, options = {}) {
    try {
      const response = await this.client.post(
        "/api/generate",
        {
          model: options.model || this.model,
          prompt,
          stream: true,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            top_k: options.top_k || 40,
          },
          context: options.context,
        },
        {
          responseType: "stream",
        },
      );

      let fullText = "";
      let lastContext = null;

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.response) {
                fullText += data.response;
                onChunk(data.response, fullText);
              }

              if (data.context) {
                lastContext = data.context;
              }

              if (data.done) {
                resolve({
                  text: fullText,
                  model: data.model,
                  context: lastContext,
                  total_duration: data.total_duration,
                  tokens: data.eval_count || 0,
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
          if (!lastContext) {
            resolve({
              text: fullText,
              model: options.model || this.model,
              context: null,
              tokens: 0,
            });
          }
        });
      });
    } catch (error) {
      logger.error("[OllamaClient] 流式生成失败:", error);
      throw error;
    }
  }

  /**
   * 聊天对话（非流式）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   */
  async chat(messages, options = {}) {
    try {
      const response = await this.client.post(
        "/api/chat",
        {
          model: options.model || this.model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            top_k: options.top_k || 40,
          },
        },
        {
          ...(options.signal && { signal: options.signal }),
        },
      );

      return {
        message: response.data.message,
        model: response.data.model,
        done: response.data.done,
        total_duration: response.data.total_duration,
        tokens: response.data.eval_count || 0,
      };
    } catch (error) {
      logger.error("[OllamaClient] 聊天失败:", error);
      throw error;
    }
  }

  /**
   * 聊天对话（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async chatStream(messages, onChunk, options = {}) {
    try {
      const response = await this.client.post(
        "/api/chat",
        {
          model: options.model || this.model,
          messages,
          stream: true,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            top_k: options.top_k || 40,
          },
        },
        {
          responseType: "stream",
        },
      );

      const fullMessage = {
        role: "assistant",
        content: "",
      };

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.message && data.message.content) {
                fullMessage.content += data.message.content;
                onChunk(data.message.content, fullMessage.content);
              }

              if (data.done) {
                resolve({
                  message: fullMessage,
                  model: data.model,
                  total_duration: data.total_duration,
                  tokens: data.eval_count || 0,
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
          resolve({
            message: fullMessage,
            model: options.model || this.model,
            tokens: 0,
          });
        });
      });
    } catch (error) {
      logger.error("[OllamaClient] 流式聊天失败:", error);
      throw error;
    }
  }

  /**
   * 拉取模型
   * @param {string} modelName - 模型名称
   * @param {Function} onProgress - 进度回调
   */
  async pullModel(modelName, onProgress) {
    try {
      const response = await this.client.post(
        "/api/pull",
        {
          name: modelName,
          stream: true,
        },
        {
          responseType: "stream",
        },
      );

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (onProgress) {
                onProgress(data);
              }

              if (data.status === "success") {
                resolve(data);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        });

        response.data.on("error", (error) => {
          reject(error);
        });
      });
    } catch (error) {
      logger.error("[OllamaClient] 拉取模型失败:", error);
      throw error;
    }
  }

  /**
   * 删除模型
   * @param {string} modelName - 模型名称
   */
  async deleteModel(modelName) {
    try {
      await this.client.delete("/api/delete", {
        data: {
          name: modelName,
        },
      });

      return true;
    } catch (error) {
      logger.error("[OllamaClient] 删除模型失败:", error);
      throw error;
    }
  }

  /**
   * 获取模型信息
   * @param {string} modelName - 模型名称
   */
  async showModel(modelName) {
    try {
      const response = await this.client.post("/api/show", {
        name: modelName,
      });

      return response.data;
    } catch (error) {
      logger.error("[OllamaClient] 获取模型信息失败:", error);
      throw error;
    }
  }

  /**
   * 生成嵌入向量
   * @param {string} text - 文本
   * @param {string} model - 模型（可选）
   */
  async embeddings(text, model = null) {
    try {
      const response = await this.client.post("/api/embeddings", {
        model: model || this.model,
        prompt: text,
      });

      return response.data.embedding;
    } catch (error) {
      logger.error("[OllamaClient] 生成嵌入失败:", error);
      throw error;
    }
  }
}

module.exports = OllamaClient;
