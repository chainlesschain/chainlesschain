/**
 * Google Gemini API 客户端
 *
 * Gemini API 使用非 OpenAI 兼容格式：
 * - 消息格式: contents[{role, parts[{text}]}]
 * - 认证: ?key= 查询参数
 * - 系统指令: systemInstruction 字段
 *
 * @see https://ai.google.dev/api/rest
 */

const axios = require("axios");
const { logger } = require("../utils/logger.js");

class GeminiClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || "";
    this.baseURL =
      config.baseURL || "https://generativelanguage.googleapis.com/v1beta";
    this.model = config.model || "gemini-1.5-pro";
    this.embeddingModel = config.embeddingModel || "text-embedding-004";
    this.timeout = config.timeout || 300000;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 检查服务状态
   */
  async checkStatus() {
    try {
      const url = `/models/${this.model}?key=${this.apiKey}`;
      const response = await this.client.get(url);
      return {
        available: true,
        model: response.data.name,
        displayName: response.data.displayName,
      };
    } catch (error) {
      logger.error("[GeminiClient] 状态检查失败:", error.message);
      return {
        available: false,
        error: this._extractError(error),
      };
    }
  }

  /**
   * 将标准消息格式转换为 Gemini 格式
   */
  _convertMessages(messages) {
    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        if (!systemInstruction) {
          systemInstruction = { parts: [{ text: msg.content }] };
        } else {
          systemInstruction.parts.push({ text: msg.content });
        }
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      contents.push({
        role,
        parts: [{ text: msg.content || "" }],
      });
    }

    // Gemini requires at least one user message
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "" }] });
    }

    return { systemInstruction, contents };
  }

  /**
   * 非流式聊天
   */
  async chat(messages, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages);

    const payload = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        topP: options.top_p ?? 0.9,
        topK: options.top_k ?? 40,
        maxOutputTokens: options.max_tokens ?? 2000,
      },
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    try {
      const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await this.client.post(url, payload);
      const data = response.data;

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || "";

      const usageMetadata = data.usageMetadata || {};

      return {
        content: text,
        model: this.model,
        usage: {
          prompt_tokens: usageMetadata.promptTokenCount || 0,
          completion_tokens: usageMetadata.candidatesTokenCount || 0,
          total_tokens: usageMetadata.totalTokenCount || 0,
        },
        finish_reason: candidate?.finishReason || "STOP",
      };
    } catch (error) {
      logger.error("[GeminiClient] 聊天请求失败:", error.message);
      throw new Error(`Gemini API 错误: ${this._extractError(error)}`);
    }
  }

  /**
   * 流式聊天
   */
  async chatStream(messages, options = {}, onChunk) {
    const { systemInstruction, contents } = this._convertMessages(messages);

    const payload = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        topP: options.top_p ?? 0.9,
        topK: options.top_k ?? 40,
        maxOutputTokens: options.max_tokens ?? 2000,
      },
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    try {
      const url = `/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
      const response = await this.client.post(url, payload, {
        responseType: "stream",
      });

      let fullText = "";
      let usageMetadata = {};

      return new Promise((resolve, reject) => {
        let buffer = "";

        response.data.on("data", (chunk) => {
          buffer += chunk.toString();

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) {continue;}

            const jsonStr = trimmed.slice(6);
            if (jsonStr === "[DONE]") {continue;}

            try {
              const parsed = JSON.parse(jsonStr);
              const text =
                parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";

              if (text) {
                fullText += text;
                if (onChunk) {
                  onChunk({ content: text, done: false });
                }
              }

              if (parsed.usageMetadata) {
                usageMetadata = parsed.usageMetadata;
              }
            } catch (_e) {
              // Skip malformed JSON
            }
          }
        });

        response.data.on("end", () => {
          if (onChunk) {
            onChunk({ content: "", done: true });
          }
          resolve({
            content: fullText,
            model: this.model,
            usage: {
              prompt_tokens: usageMetadata.promptTokenCount || 0,
              completion_tokens: usageMetadata.candidatesTokenCount || 0,
              total_tokens: usageMetadata.totalTokenCount || 0,
            },
          });
        });

        response.data.on("error", (err) => {
          reject(new Error(`Gemini stream error: ${err.message}`));
        });
      });
    } catch (error) {
      logger.error("[GeminiClient] 流式聊天失败:", error.message);
      throw new Error(`Gemini stream API 错误: ${this._extractError(error)}`);
    }
  }

  /**
   * 嵌入向量
   */
  async embeddings(text) {
    try {
      const url = `/models/${this.embeddingModel}:embedContent?key=${this.apiKey}`;
      const payload = {
        model: `models/${this.embeddingModel}`,
        content: {
          parts: [{ text: typeof text === "string" ? text : text.join(" ") }],
        },
      };

      const response = await this.client.post(url, payload);
      const embedding = response.data.embedding?.values || [];

      return {
        embedding,
        model: this.embeddingModel,
        usage: { total_tokens: 0 },
      };
    } catch (error) {
      logger.error("[GeminiClient] 嵌入请求失败:", error.message);
      throw new Error(`Gemini embedding 错误: ${this._extractError(error)}`);
    }
  }

  /**
   * 提取错误信息
   */
  _extractError(error) {
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message;
    }
    return error.message;
  }
}

module.exports = { GeminiClient };
