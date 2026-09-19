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

function assertGovernedModelIngress() {
  const error = new Error(
    "External Gemini embeddings require a governed model ingress",
  );
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}

function hasMultimodalMessages(messages) {
  return messages.some((message) => Array.isArray(message?.content));
}

function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content) || !content.length) {
    throw new TypeError("Gemini message content is invalid");
  }
  return content.map((block) => {
    if (block?.type === "text" && typeof block.text === "string") {
      return { text: block.text };
    }
    if (block?.type !== "image_url") {
      throw new TypeError("Unsupported Gemini vision content block");
    }
    const match =
      /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/u.exec(
        block.image_url?.url || "",
      );
    if (!match || match[2].length % 4 !== 0) {
      throw new TypeError(
        "Gemini vision input requires a supported base64 data URL",
      );
    }
    const decoded = Buffer.from(match[2], "base64");
    if (!decoded.length || decoded.toString("base64") !== match[2]) {
      throw new TypeError("Gemini vision input contains invalid base64");
    }
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    };
  });
}

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
        if (typeof msg.content !== "string") {
          throw new TypeError("Gemini system message must be text");
        }
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
        parts: toGeminiParts(msg.content || ""),
      });
    }

    // Gemini requires at least one user message
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "" }] });
    }

    return { systemInstruction, contents };
  }

  _buildPayload(messages, options = {}) {
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
    if (systemInstruction) payload.systemInstruction = systemInstruction;
    return payload;
  }

  async _prepareChatRequest(messages, options = {}) {
    const {
      prepareDesktopModelRequest,
    } = require("../evolution/desktop-model-ingress");
    if (hasMultimodalMessages(messages)) {
      // Commit and restore provider-neutral image_url blocks before converting
      // them to Gemini inlineData at the final wire boundary.
      const governed = await prepareDesktopModelRequest(this, { messages });
      return {
        governed,
        body: this._buildPayload(governed.body.messages, options),
      };
    }
    const payload = this._buildPayload(messages, options);
    const governed = await prepareDesktopModelRequest(this, payload, "gemini");
    return { governed, body: governed.body };
  }

  /**
   * 非流式聊天
   */
  async chat(messages, options = {}) {
    try {
      const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;
      const { governed, body } = await this._prepareChatRequest(
        messages,
        options,
      );
      const response = await this.client.post(url, body, {
        ...(options.signal && { signal: options.signal }),
      });
      const data = response.data;

      const candidate = data.candidates?.[0];
      const text = governed
        ? (candidate?.content?.parts || [])
            .map((part) => {
              if (typeof part.text !== "string") {
                const error = new Error("Unsupported Gemini response part");
                error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
                throw error;
              }
              return part.text;
            })
            .join("")
        : candidate?.content?.parts?.[0]?.text || "";

      const usageMetadata = data.usageMetadata || {};
      if (governed) {
        if (data.error || !candidate?.finishReason) {
          const error = new Error("Gemini response is not complete");
          error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
          throw error;
        }
      }

      const result = {
        content: text,
        text,
        message: { role: "assistant", content: text },
        model: this.model,
        usage: {
          prompt_tokens: usageMetadata.promptTokenCount || 0,
          completion_tokens: usageMetadata.candidatesTokenCount || 0,
          total_tokens: usageMetadata.totalTokenCount || 0,
        },
        finish_reason: candidate?.finishReason || "STOP",
      };
      if (governed) await governed.complete(candidate, result);
      return result;
    } catch (error) {
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
      logger.error("[GeminiClient] 聊天请求失败:", error.message);
      throw new Error(`Gemini API 错误: ${this._extractError(error)}`);
    }
  }

  /**
   * 流式聊天
   *
   * Signature is (messages, onChunk, options) to match every other client and
   * all callers (LLMManager.chatWithMessagesStream, conversation-ipc). The
   * previous (messages, options, onChunk) order bound onChunk to the options
   * object → "onChunk is not a function" TypeError on the first delta, crashing
   * any streaming chat whenever the configured provider was Gemini.
   */
  async chatStream(messages, onChunk, options = {}) {
    let governed = null;

    try {
      const url = `/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
      const {
        consumeDesktopGeminiStream,
      } = require("../evolution/desktop-model-ingress");
      const prepared = await this._prepareChatRequest(messages, options);
      governed = prepared.governed;
      const response = await this.client.post(url, prepared.body, {
        responseType: "stream",
        ...(options.signal && { signal: options.signal }),
      });
      if (governed)
        return await consumeDesktopGeminiStream(
          governed,
          response,
          this.model,
          onChunk,
          options.signal,
        );

      let fullText = "";
      let usageMetadata = {};

      return new Promise((resolve, reject) => {
        let buffer = "";

        response.data.on("data", (chunk) => {
          buffer += chunk.toString("utf8");

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) {
              continue;
            }

            const jsonStr = trimmed.slice(6);
            if (jsonStr === "[DONE]") {
              continue;
            }

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
            text: fullText,
            message: { role: "assistant", content: fullText },
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
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
      if (governed) {
        const interrupted = new Error(
          "Governed Desktop Gemini stream did not complete",
          { cause: error },
        );
        interrupted.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
        throw interrupted;
      }
      logger.error("[GeminiClient] 流式聊天失败:", error.message);
      throw new Error(`Gemini stream API 错误: ${this._extractError(error)}`);
    }
  }

  /**
   * 嵌入向量
   */
  async embeddings(text) {
    try {
      assertGovernedModelIngress();
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
      if (error.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw error;
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
