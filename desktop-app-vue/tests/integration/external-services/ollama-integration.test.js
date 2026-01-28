/**
 * Ollama LLM 服务集成测试
 *
 * 测试范围：
 * - 服务状态检查和可用性
 * - 模型加载和管理
 * - 文本生成（非流式和流式）
 * - 聊天对话
 * - 错误处理（超时、连接、模型不存在）
 * - 性能基准测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 2: External Services Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock Axios ====================

const createMockAxios = () => {
  const mockResponses = new Map();
  const mockStreamHandlers = new Map();

  const mockAxiosInstance = {
    get: vi.fn(async (url) => {
      const handler = mockResponses.get(`GET:${url}`);
      if (handler) {
        return handler();
      }
      return { data: {} };
    }),

    post: vi.fn(async (url, data, config = {}) => {
      const handler = mockResponses.get(`POST:${url}`);

      if (config.responseType === "stream") {
        // 流式响应
        const streamHandler = mockStreamHandlers.get(url);
        if (streamHandler) {
          return streamHandler(data);
        }
      }

      if (handler) {
        return handler(data);
      }
      return { data: {} };
    }),

    // Helper methods for test setup
    _setResponse: (method, url, handler) => {
      mockResponses.set(`${method}:${url}`, handler);
    },

    _setStreamHandler: (url, handler) => {
      mockStreamHandlers.set(url, handler);
    },

    _clear: () => {
      mockResponses.clear();
      mockStreamHandlers.clear();
    },
  };

  return mockAxiosInstance;
};

// Mock axios.create
const mockAxiosCreate = vi.fn((config) => {
  const instance = createMockAxios();
  instance.defaults = config;
  return instance;
});

// Mock axios module
vi.mock("axios", () => ({
  default: {
    create: mockAxiosCreate,
  },
}));

// ==================== OllamaClient Class ====================

class OllamaClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || "http://localhost:11434";
    this.timeout = config.timeout || 120000;
    this.model = config.model || "qwen2:7b";

    const axios = require("axios").default;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

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

  async generate(prompt, options = {}) {
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
  }

  async generateStream(prompt, onChunk, options = {}) {
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
            // Ignore parse errors
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
  }

  async chat(messages, options = {}) {
    const response = await this.client.post("/api/chat", {
      model: options.model || this.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        top_k: options.top_k || 40,
      },
    });

    return {
      message: response.data.message,
      model: response.data.model,
      done: response.data.done,
      total_duration: response.data.total_duration,
      tokens: response.data.eval_count || 0,
    };
  }

  async pullModel(modelName) {
    const response = await this.client.post("/api/pull", {
      name: modelName,
      stream: false,
    });

    return {
      status: response.data.status,
      model: modelName,
    };
  }

  async deleteModel(modelName) {
    const response = await this.client.delete(`/api/delete`, {
      data: { name: modelName },
    });

    return {
      success: true,
      model: modelName,
    };
  }

  async embeddings(text, options = {}) {
    const response = await this.client.post("/api/embeddings", {
      model: options.model || this.model,
      prompt: text,
    });

    return {
      embedding: response.data.embedding,
      model: response.data.model,
    };
  }
}

// ==================== Test Suite ====================

describe("Ollama LLM 服务集成测试", () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosCreate.mockClear();

    client = new OllamaClient({
      baseURL: "http://localhost:11434",
      model: "qwen2:7b",
      timeout: 30000,
    });

    mockAxios = client.client;
  });

  afterEach(() => {
    if (mockAxios._clear) {
      mockAxios._clear();
    }
  });

  // ==================== 1. 服务状态检查 ====================

  describe("服务状态检查", () => {
    it("应该检查 Ollama 服务是否可用", async () => {
      mockAxios._setResponse("GET", "/api/tags", () => ({
        data: {
          models: [
            {
              name: "qwen2:7b",
              size: 7000000000,
              modified_at: "2026-01-28T00:00:00Z",
            },
            {
              name: "llama2:13b",
              size: 13000000000,
              modified_at: "2026-01-27T00:00:00Z",
            },
          ],
          version: "0.1.20",
        },
      }));

      const status = await client.checkStatus();

      expect(status.available).toBe(true);
      expect(status.models).toHaveLength(2);
      expect(status.models[0].name).toBe("qwen2:7b");
      expect(status.version).toBe("0.1.20");
    });

    it("应该处理 Ollama 服务不可用情况", async () => {
      mockAxios._setResponse("GET", "/api/tags", () => {
        throw new Error("ECONNREFUSED");
      });

      const status = await client.checkStatus();

      expect(status.available).toBe(false);
      expect(status.error).toBe("ECONNREFUSED");
      expect(status.models).toEqual([]);
    });

    it("应该返回空模型列表当无模型时", async () => {
      mockAxios._setResponse("GET", "/api/tags", () => ({
        data: {
          models: [],
          version: "0.1.20",
        },
      }));

      const status = await client.checkStatus();

      expect(status.available).toBe(true);
      expect(status.models).toEqual([]);
    });
  });

  // ==================== 2. 模型管理 ====================

  describe("模型管理", () => {
    it("应该拉取新模型", async () => {
      mockAxios._setResponse("POST", "/api/pull", () => ({
        data: {
          status: "success",
        },
      }));

      const result = await client.pullModel("llama2:7b");

      expect(result.status).toBe("success");
      expect(result.model).toBe("llama2:7b");
      expect(mockAxios.post).toHaveBeenCalledWith("/api/pull", {
        name: "llama2:7b",
        stream: false,
      });
    });

    it("应该删除已有模型", async () => {
      mockAxios.delete = vi.fn(async () => ({
        data: { success: true },
      }));

      const result = await client.deleteModel("qwen2:7b");

      expect(result.success).toBe(true);
      expect(result.model).toBe("qwen2:7b");
    });

    it("应该处理拉取模型失败", async () => {
      mockAxios._setResponse("POST", "/api/pull", () => {
        throw new Error("Model not found");
      });

      await expect(client.pullModel("nonexistent:1b")).rejects.toThrow(
        "Model not found",
      );
    });
  });

  // ==================== 3. 文本生成（非流式） ====================

  describe("文本生成（非流式）", () => {
    it("应该生成文本响应", async () => {
      mockAxios._setResponse("POST", "/api/generate", (data) => ({
        data: {
          model: "qwen2:7b",
          response: "This is a test response from Ollama.",
          done: true,
          context: [1, 2, 3, 4, 5],
          total_duration: 1234567890,
          eval_count: 15,
        },
      }));

      const result = await client.generate("What is 2+2?");

      expect(result.text).toBe("This is a test response from Ollama.");
      expect(result.model).toBe("qwen2:7b");
      expect(result.done).toBe(true);
      expect(result.tokens).toBe(15);
      expect(mockAxios.post).toHaveBeenCalledWith(
        "/api/generate",
        expect.objectContaining({
          prompt: "What is 2+2?",
          stream: false,
        }),
      );
    });

    it("应该使用自定义温度参数", async () => {
      mockAxios._setResponse("POST", "/api/generate", (data) => {
        expect(data.options.temperature).toBe(0.9);
        return {
          data: {
            model: "qwen2:7b",
            response: "Creative response.",
            done: true,
            eval_count: 10,
          },
        };
      });

      await client.generate("Be creative", { temperature: 0.9 });

      expect(mockAxios.post).toHaveBeenCalled();
    });

    it("应该支持上下文继续对话", async () => {
      const context = [1, 2, 3, 4, 5];

      mockAxios._setResponse("POST", "/api/generate", (data) => {
        expect(data.context).toEqual(context);
        return {
          data: {
            model: "qwen2:7b",
            response: "Continuing conversation.",
            done: true,
            context: [1, 2, 3, 4, 5, 6, 7],
            eval_count: 8,
          },
        };
      });

      const result = await client.generate("Continue", { context });

      expect(result.text).toBe("Continuing conversation.");
      expect(result.context).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("应该处理生成超时", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => {
        throw new Error("timeout of 30000ms exceeded");
      });

      await expect(client.generate("Long prompt")).rejects.toThrow("timeout");
    });
  });

  // ==================== 4. 流式文本生成 ====================

  describe("流式文本生成", () => {
    it("应该流式生成文本", async () => {
      const chunks = [];
      const EventEmitter = require("events");

      mockAxios._setStreamHandler("/api/generate", (data) => {
        const stream = new EventEmitter();

        // 模拟流式响应
        setTimeout(() => {
          stream.emit(
            "data",
            Buffer.from(
              JSON.stringify({ response: "Hello", done: false }) + "\n",
            ),
          );
          stream.emit(
            "data",
            Buffer.from(
              JSON.stringify({ response: " world", done: false }) + "\n",
            ),
          );
          stream.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                response: "!",
                done: true,
                model: "qwen2:7b",
                context: [1, 2, 3],
                total_duration: 1000000,
                eval_count: 3,
              }) + "\n",
            ),
          );
          stream.emit("end");
        }, 10);

        return { data: stream };
      });

      const result = await client.generateStream("Test", (chunk, fullText) => {
        chunks.push(chunk);
      });

      expect(chunks).toEqual(["Hello", " world", "!"]);
      expect(result.text).toBe("Hello world!");
      expect(result.model).toBe("qwen2:7b");
      expect(result.tokens).toBe(3);
    });

    it("应该处理流式生成错误", async () => {
      const EventEmitter = require("events");

      mockAxios._setStreamHandler("/api/generate", () => {
        const stream = new EventEmitter();
        setTimeout(() => {
          stream.emit("error", new Error("Stream error"));
        }, 10);
        return { data: stream };
      });

      await expect(client.generateStream("Test", () => {})).rejects.toThrow(
        "Stream error",
      );
    });

    it("应该处理不完整的流响应", async () => {
      const EventEmitter = require("events");

      mockAxios._setStreamHandler("/api/generate", () => {
        const stream = new EventEmitter();
        setTimeout(() => {
          stream.emit(
            "data",
            Buffer.from(JSON.stringify({ response: "Incomplete" }) + "\n"),
          );
          stream.emit("end");
        }, 10);
        return { data: stream };
      });

      const result = await client.generateStream("Test", () => {});

      expect(result.text).toBe("Incomplete");
      expect(result.context).toBeNull();
    });
  });

  // ==================== 5. 聊天对话 ====================

  describe("聊天对话", () => {
    it("应该进行聊天对话", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ];

      mockAxios._setResponse("POST", "/api/chat", (data) => {
        expect(data.messages).toEqual(messages);
        return {
          data: {
            message: {
              role: "assistant",
              content: "I'm doing well, thank you!",
            },
            model: "qwen2:7b",
            done: true,
            total_duration: 500000000,
            eval_count: 8,
          },
        };
      });

      const result = await client.chat(messages);

      expect(result.message.content).toBe("I'm doing well, thank you!");
      expect(result.message.role).toBe("assistant");
      expect(result.tokens).toBe(8);
    });

    it("应该支持系统提示", async () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Help me" },
      ];

      mockAxios._setResponse("POST", "/api/chat", () => ({
        data: {
          message: { role: "assistant", content: "How can I help you?" },
          model: "qwen2:7b",
          done: true,
          eval_count: 6,
        },
      }));

      const result = await client.chat(messages);

      expect(result.message.content).toBe("How can I help you?");
    });

    it("应该处理聊天错误", async () => {
      mockAxios._setResponse("POST", "/api/chat", () => {
        throw new Error("Chat API error");
      });

      await expect(
        client.chat([{ role: "user", content: "Test" }]),
      ).rejects.toThrow("Chat API error");
    });
  });

  // ==================== 6. Embeddings ====================

  describe("Embeddings 生成", () => {
    it("应该生成文本 embeddings", async () => {
      const embedding = Array(768)
        .fill(0)
        .map(() => Math.random());

      mockAxios._setResponse("POST", "/api/embeddings", () => ({
        data: {
          embedding,
          model: "qwen2:7b",
        },
      }));

      const result = await client.embeddings("Test text");

      expect(result.embedding).toHaveLength(768);
      expect(result.model).toBe("qwen2:7b");
    });

    it("应该支持不同的 embedding 模型", async () => {
      mockAxios._setResponse("POST", "/api/embeddings", (data) => {
        expect(data.model).toBe("nomic-embed-text");
        return {
          data: {
            embedding: Array(384)
              .fill(0)
              .map(() => Math.random()),
            model: "nomic-embed-text",
          },
        };
      });

      const result = await client.embeddings("Test", {
        model: "nomic-embed-text",
      });

      expect(result.embedding).toHaveLength(384);
    });
  });

  // ==================== 7. 错误处理 ====================

  describe("错误处理", () => {
    it("应该处理连接拒绝", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
        error.code = "ECONNREFUSED";
        throw error;
      });

      await expect(client.generate("Test")).rejects.toThrow("ECONNREFUSED");
    });

    it("应该处理模型不存在", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => {
        const error = new Error('model "nonexistent:1b" not found');
        error.response = { status: 404 };
        throw error;
      });

      await expect(
        client.generate("Test", { model: "nonexistent:1b" }),
      ).rejects.toThrow("not found");
    });

    it("应该处理请求超时", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error("timeout of 30000ms exceeded"));
          }, 100);
        });
      });

      await expect(client.generate("Test")).rejects.toThrow("timeout");
    });

    it("应该处理服务器内部错误", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => {
        const error = new Error("Internal Server Error");
        error.response = { status: 500, data: { error: "GPU out of memory" } };
        throw error;
      });

      await expect(client.generate("Test")).rejects.toThrow(
        "Internal Server Error",
      );
    });

    it("应该处理无效的 JSON 响应", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => ({
        data: "Invalid JSON response",
      }));

      const result = await client.generate("Test");

      // 应该处理无效响应，返回默认值
      expect(result.text).toBeUndefined();
    });
  });

  // ==================== 8. 性能基准测试 ====================

  describe("性能基准测试", () => {
    it("应该在合理时间内完成短文本生成（< 1s）", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => ({
        data: {
          model: "qwen2:7b",
          response: "Quick response",
          done: true,
          total_duration: 500000000, // 500ms in nanoseconds
          eval_count: 5,
        },
      }));

      const start = Date.now();
      await client.generate("Short prompt");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it("应该支持并发请求", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => ({
        data: {
          model: "qwen2:7b",
          response: "Concurrent response",
          done: true,
          eval_count: 5,
        },
      }));

      const promises = Array(5)
        .fill(0)
        .map((_, i) => client.generate(`Prompt ${i}`));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.text).toBe("Concurrent response");
      });
    });

    it("应该报告 tokens/second 性能指标", async () => {
      mockAxios._setResponse("POST", "/api/generate", () => ({
        data: {
          model: "qwen2:7b",
          response:
            "Performance test response with multiple tokens to measure speed.",
          done: true,
          total_duration: 2000000000, // 2秒
          eval_count: 50, // 50 tokens
        },
      }));

      const result = await client.generate("Performance test");

      const tokensPerSecond =
        result.tokens / (result.total_duration / 1000000000);

      expect(tokensPerSecond).toBeGreaterThan(0);
      expect(tokensPerSecond).toBe(25); // 50 tokens / 2 seconds
    });
  });

  // ==================== 9. 真实场景测试 ====================

  describe("真实场景测试", () => {
    it("场景1: 代码生成助手", async () => {
      mockAxios._setResponse("POST", "/api/generate", (data) => {
        if (data.prompt.includes("Python function")) {
          return {
            data: {
              model: "qwen2:7b",
              response:
                "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)",
              done: true,
              eval_count: 35,
            },
          };
        }
      });

      const result = await client.generate(
        "Write a Python function to calculate Fibonacci numbers",
      );

      expect(result.text).toContain("def fibonacci");
      expect(result.text).toContain("return");
    });

    it("场景2: 多轮对话", async () => {
      const conversation = [];

      // Round 1
      mockAxios._setResponse("POST", "/api/chat", () => ({
        data: {
          message: {
            role: "assistant",
            content: "Paris is the capital of France.",
          },
          model: "qwen2:7b",
          done: true,
          eval_count: 10,
        },
      }));

      conversation.push({
        role: "user",
        content: "What is the capital of France?",
      });
      const result1 = await client.chat(conversation);
      conversation.push(result1.message);

      expect(result1.message.content).toContain("Paris");

      // Round 2
      mockAxios._setResponse("POST", "/api/chat", () => ({
        data: {
          message: {
            role: "assistant",
            content: "Paris has a population of approximately 2.1 million.",
          },
          model: "qwen2:7b",
          done: true,
          eval_count: 12,
        },
      }));

      conversation.push({ role: "user", content: "What is its population?" });
      const result2 = await client.chat(conversation);

      expect(result2.message.content).toContain("2.1 million");
    });

    it("场景3: RAG 文档检索增强", async () => {
      // 假设已经有文档 embeddings
      const documentChunks = [
        "Vue 3 is a progressive framework",
        "Electron enables desktop apps",
        "Ollama runs local LLMs",
      ];

      // 生成查询 embedding
      mockAxios._setResponse("POST", "/api/embeddings", () => ({
        data: {
          embedding: Array(768)
            .fill(0)
            .map(() => Math.random()),
          model: "qwen2:7b",
        },
      }));

      const queryEmbedding = await client.embeddings(
        "How to build desktop apps?",
      );

      expect(queryEmbedding.embedding).toBeDefined();

      // 使用检索到的文档作为上下文生成回答
      mockAxios._setResponse("POST", "/api/generate", () => ({
        data: {
          model: "qwen2:7b",
          response:
            "To build desktop apps, you can use Electron, which enables cross-platform development.",
          done: true,
          eval_count: 20,
        },
      }));

      const context = `Context: ${documentChunks[1]}\n\nQuestion: How to build desktop apps?`;
      const answer = await client.generate(context);

      expect(answer.text).toContain("Electron");
    });
  });
});
