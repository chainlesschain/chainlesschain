/**
 * OllamaClient 单元测试
 * 测试目标: src/main/llm/ollama-client.js
 * 覆盖场景: Ollama API客户端、生成对话、流式输出、模型管理
 *
 * ✅ 全部测试通过 - 无外部依赖
 *
 * OllamaClient是本地LLM的核心客户端，基于axios实现
 * - 非流式/流式生成
 * - 非流式/流式聊天
 * - 模型管理（拉取、删除、查看）
 * - 嵌入向量生成
 *
 * 测试覆盖：
 * - 构造函数和配置
 * - checkStatus - 服务状态检查
 * - generate - 非流式生成
 * - generateStream - 流式生成
 * - chat - 非流式聊天
 * - chatStream - 流式聊天
 * - pullModel - 拉取模型
 * - deleteModel - 删除模型
 * - showModel - 查看模型信息
 * - embeddings - 生成嵌入向量
 * - 错误处理和边界情况
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// Mock axios
const mockAxios = {
  create: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
};

const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
};

mockAxios.create.mockReturnValue(mockAxiosInstance);

vi.mock("axios", () => ({
  default: mockAxios,
}));

describe("OllamaClient", () => {
  let OllamaClient;
  let client;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAxios.create.mockReturnValue(mockAxiosInstance);

    // Dynamic import
    const module = await import("../../../src/main/llm/ollama-client.js");
    OllamaClient = module.default;
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      client = new OllamaClient();

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(OllamaClient);
      expect(client).toBeInstanceOf(EventEmitter);
    });

    it("应该使用默认配置", () => {
      client = new OllamaClient();

      expect(client.baseURL).toBe("http://localhost:11434");
      expect(client.timeout).toBe(120000);
      expect(client.model).toBe("llama2");
    });

    it("应该接受自定义配置", () => {
      client = new OllamaClient({
        baseURL: "http://custom:8080",
        timeout: 60000,
        model: "qwen2:7b",
      });

      expect(client.baseURL).toBe("http://custom:8080");
      expect(client.timeout).toBe(60000);
      expect(client.model).toBe("qwen2:7b");
    });

    it("应该创建axios实例", () => {
      client = new OllamaClient();

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: "http://localhost:11434",
        timeout: 120000,
        headers: {
          "Content-Type": "application/json",
        },
      });
      expect(client.client).toBe(mockAxiosInstance);
    });
  });

  describe("checkStatus", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该检查服务状态并返回可用模型", async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          models: [
            {
              name: "llama2:7b",
              size: 3826793768,
              modified_at: "2024-01-20T10:00:00Z",
            },
            {
              name: "qwen2:7b",
              size: 4500000000,
              modified_at: "2024-01-21T10:00:00Z",
            },
          ],
          version: "0.1.20",
        },
      });

      const status = await client.checkStatus();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/api/tags");
      expect(status.available).toBe(true);
      expect(status.models).toHaveLength(2);
      expect(status.models[0]).toEqual({
        name: "llama2:7b",
        size: 3826793768,
        modified: "2024-01-20T10:00:00Z",
      });
      expect(status.version).toBe("0.1.20");
    });

    it("应该处理服务不可用", async () => {
      mockAxiosInstance.get.mockRejectedValue(
        new Error("connect ECONNREFUSED")
      );

      const status = await client.checkStatus();

      expect(status.available).toBe(false);
      expect(status.error).toBe("connect ECONNREFUSED");
      expect(status.models).toEqual([]);
    });

    it("应该处理空模型列表", async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          models: [],
          version: "0.1.20",
        },
      });

      const status = await client.checkStatus();

      expect(status.available).toBe(true);
      expect(status.models).toEqual([]);
    });

    it("应该处理缺失models字段", async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          version: "0.1.20",
        },
      });

      const status = await client.checkStatus();

      expect(status.available).toBe(true);
      expect(status.models).toEqual([]);
    });
  });

  describe("generate", () => {
    beforeEach(() => {
      client = new OllamaClient({ model: "llama2" });
    });

    it("应该生成非流式响应", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          model: "llama2",
          response: "Hello! How can I help you?",
          context: [1, 2, 3],
          done: true,
          total_duration: 1234567890,
          eval_count: 10,
        },
      });

      const result = await client.generate("Hello");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/generate", {
        model: "llama2",
        prompt: "Hello",
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
        },
        context: undefined,
      });

      expect(result.text).toBe("Hello! How can I help you?");
      expect(result.model).toBe("llama2");
      expect(result.context).toEqual([1, 2, 3]);
      expect(result.done).toBe(true);
      expect(result.total_duration).toBe(1234567890);
      expect(result.tokens).toBe(10);
    });

    it("应该使用自定义选项", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          model: "qwen2:7b",
          response: "Test response",
          done: true,
        },
      });

      await client.generate("Test", {
        model: "qwen2:7b",
        temperature: 0.8,
        top_p: 0.95,
        top_k: 50,
        context: [4, 5, 6],
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/generate", {
        model: "qwen2:7b",
        prompt: "Test",
        stream: false,
        options: {
          temperature: 0.8,
          top_p: 0.95,
          top_k: 50,
        },
        context: [4, 5, 6],
      });
    });

    it("应该处理缺失tokens字段", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          model: "llama2",
          response: "Response",
          done: true,
        },
      });

      const result = await client.generate("Test");

      expect(result.tokens).toBe(0);
    });

    it("应该处理错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Network error"));

      await expect(client.generate("Test")).rejects.toThrow("Network error");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("generateStream", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该生成流式响应", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onChunk = vi.fn();
      const resultPromise = client.generateStream("Hello", onChunk);

      // Simulate stream data
      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            response: "Hello",
            context: [1, 2],
            done: false,
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            response: " World",
            context: [1, 2, 3],
            done: false,
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            response: "!",
            model: "llama2",
            context: [1, 2, 3],
            done: true,
            total_duration: 12345,
            eval_count: 3,
          }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/generate",
        {
          model: "llama2",
          prompt: "Hello",
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
          },
          context: undefined,
        },
        { responseType: "stream" }
      );

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, "Hello", "Hello");
      expect(onChunk).toHaveBeenNthCalledWith(2, " World", "Hello World");
      expect(onChunk).toHaveBeenNthCalledWith(3, "!", "Hello World!");

      expect(result.text).toBe("Hello World!");
      expect(result.model).toBe("llama2");
      expect(result.context).toEqual([1, 2, 3]);
      expect(result.total_duration).toBe(12345);
      expect(result.tokens).toBe(3);
    });

    it("应该处理多行JSON数据", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onChunk = vi.fn();
      const resultPromise = client.generateStream("Test", onChunk);

      // Multiple JSON objects in one chunk
      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({ response: "A", done: false }) +
            "\n" +
            JSON.stringify({ response: "B", done: false }) +
            "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            response: "C",
            model: "llama2",
            done: true,
          }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(result.text).toBe("ABC");
    });

    it("应该处理流错误", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.generateStream("Test", vi.fn());

      mockStream.emit("error", new Error("Stream error"));

      await expect(resultPromise).rejects.toThrow("Stream error");
    });

    it("应该处理流结束（无done标记）", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.generateStream("Test", vi.fn());

      mockStream.emit(
        "data",
        Buffer.from(JSON.stringify({ response: "Text" }) + "\n")
      );
      mockStream.emit("end");

      const result = await resultPromise;

      expect(result.text).toBe("Text");
      expect(result.context).toBeNull();
      expect(result.tokens).toBe(0);
    });

    it("应该忽略无效JSON", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onChunk = vi.fn();
      const resultPromise = client.generateStream("Test", onChunk);

      mockStream.emit("data", Buffer.from("invalid json\n"));
      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({ response: "OK", model: "llama2", done: true }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(result.text).toBe("OK");
    });

    it("应该处理请求错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Request failed"));

      await expect(
        client.generateStream("Test", vi.fn())
      ).rejects.toThrow("Request failed");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("chat", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该进行非流式聊天", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          message: {
            role: "assistant",
            content: "I'm doing well, thank you!",
          },
          model: "llama2",
          done: true,
          total_duration: 9876543,
          eval_count: 8,
        },
      });

      const messages = [
        { role: "user", content: "How are you?" },
      ];

      const result = await client.chat(messages);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/chat", {
        model: "llama2",
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
        },
      });

      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toBe("I'm doing well, thank you!");
      expect(result.model).toBe("llama2");
      expect(result.done).toBe(true);
      expect(result.tokens).toBe(8);
    });

    it("应该使用自定义选项", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          message: { role: "assistant", content: "Response" },
          model: "qwen2:7b",
          done: true,
        },
      });

      const messages = [{ role: "user", content: "Test" }];

      await client.chat(messages, {
        model: "qwen2:7b",
        temperature: 0.5,
        top_p: 0.8,
        top_k: 30,
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/chat", {
        model: "qwen2:7b",
        messages,
        stream: false,
        options: {
          temperature: 0.5,
          top_p: 0.8,
          top_k: 30,
        },
      });
    });

    it("应该处理缺失tokens字段", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          message: { role: "assistant", content: "Test" },
          model: "llama2",
          done: true,
        },
      });

      const result = await client.chat([{ role: "user", content: "Test" }]);

      expect(result.tokens).toBe(0);
    });

    it("应该处理错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Chat failed"));

      await expect(
        client.chat([{ role: "user", content: "Test" }])
      ).rejects.toThrow("Chat failed");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("chatStream", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该进行流式聊天", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const messages = [{ role: "user", content: "Hello" }];
      const onChunk = vi.fn();
      const resultPromise = client.chatStream(messages, onChunk);

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            message: { content: "Hi" },
            done: false,
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            message: { content: " there!" },
            done: false,
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            message: { content: "" },
            model: "llama2",
            done: true,
            total_duration: 5555,
            eval_count: 2,
          }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/chat",
        {
          model: "llama2",
          messages,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
          },
        },
        { responseType: "stream" }
      );

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, "Hi", "Hi");
      expect(onChunk).toHaveBeenNthCalledWith(2, " there!", "Hi there!");

      expect(result.message.role).toBe("assistant");
      expect(result.message.content).toBe("Hi there!");
      expect(result.model).toBe("llama2");
      expect(result.tokens).toBe(2);
    });

    it("应该处理流错误", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.chatStream(
        [{ role: "user", content: "Test" }],
        vi.fn()
      );

      mockStream.emit("error", new Error("Chat stream error"));

      await expect(resultPromise).rejects.toThrow("Chat stream error");
    });

    it("应该处理流结束（无done标记）", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.chatStream(
        [{ role: "user", content: "Test" }],
        vi.fn()
      );

      mockStream.emit(
        "data",
        Buffer.from(JSON.stringify({ message: { content: "OK" } }) + "\n")
      );
      mockStream.emit("end");

      const result = await resultPromise;

      expect(result.message.content).toBe("OK");
      expect(result.tokens).toBe(0);
    });

    it("应该忽略无效JSON", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onChunk = vi.fn();
      const resultPromise = client.chatStream(
        [{ role: "user", content: "Test" }],
        onChunk
      );

      mockStream.emit("data", Buffer.from("{invalid\n"));
      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            message: { content: "OK" },
            model: "llama2",
            done: true,
          }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(result.message.content).toBe("OK");
    });

    it("应该处理请求错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Request failed"));

      await expect(
        client.chatStream([{ role: "user", content: "Test" }], vi.fn())
      ).rejects.toThrow("Request failed");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("pullModel", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该拉取模型并报告进度", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onProgress = vi.fn();
      const resultPromise = client.pullModel("qwen2:7b", onProgress);

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            status: "pulling manifest",
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            status: "downloading",
            completed: 1024,
            total: 4096,
          }) + "\n"
        )
      );

      mockStream.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            status: "success",
          }) + "\n"
        )
      );

      const result = await resultPromise;

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/pull",
        {
          name: "qwen2:7b",
          stream: true,
        },
        { responseType: "stream" }
      );

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, {
        status: "pulling manifest",
      });
      expect(onProgress).toHaveBeenNthCalledWith(2, {
        status: "downloading",
        completed: 1024,
        total: 4096,
      });

      expect(result.status).toBe("success");
    });

    it("应该处理无进度回调", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.pullModel("llama2");

      mockStream.emit(
        "data",
        Buffer.from(JSON.stringify({ status: "success" }) + "\n")
      );

      const result = await resultPromise;

      expect(result.status).toBe("success");
    });

    it("应该忽略无效JSON", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const onProgress = vi.fn();
      const resultPromise = client.pullModel("llama2", onProgress);

      mockStream.emit("data", Buffer.from("invalid\n"));
      mockStream.emit(
        "data",
        Buffer.from(JSON.stringify({ status: "success" }) + "\n")
      );

      await resultPromise;

      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it("应该处理流错误", async () => {
      const mockStream = new EventEmitter();
      mockAxiosInstance.post.mockResolvedValue({
        data: mockStream,
      });

      const resultPromise = client.pullModel("llama2");

      mockStream.emit("error", new Error("Download failed"));

      await expect(resultPromise).rejects.toThrow("Download failed");
    });

    it("应该处理请求错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Network error"));

      await expect(client.pullModel("llama2")).rejects.toThrow(
        "Network error"
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("deleteModel", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该删除模型", async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.deleteModel("old-model");

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/delete", {
        data: {
          name: "old-model",
        },
      });
      expect(result).toBe(true);
    });

    it("应该处理错误", async () => {
      mockAxiosInstance.delete.mockRejectedValue(
        new Error("Model not found")
      );

      await expect(client.deleteModel("unknown")).rejects.toThrow(
        "Model not found"
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("showModel", () => {
    beforeEach(() => {
      client = new OllamaClient();
    });

    it("应该获取模型信息", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          modelfile: "FROM llama2\nPARAMETER temperature 0.7",
          parameters: "temperature 0.7",
          template: "{{ .Prompt }}",
          details: {
            format: "gguf",
            family: "llama",
            parameter_size: "7B",
          },
        },
      });

      const info = await client.showModel("llama2");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/show", {
        name: "llama2",
      });

      expect(info.modelfile).toContain("FROM llama2");
      expect(info.details.parameter_size).toBe("7B");
    });

    it("应该处理错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Model not found"));

      await expect(client.showModel("unknown")).rejects.toThrow(
        "Model not found"
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("embeddings", () => {
    beforeEach(() => {
      client = new OllamaClient({ model: "llama2" });
    });

    it("应该生成嵌入向量", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
        },
      });

      const embedding = await client.embeddings("Hello world");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/embeddings", {
        model: "llama2",
        prompt: "Hello world",
      });

      expect(embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    });

    it("应该使用自定义模型", async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          embedding: [0.5, 0.6],
        },
      });

      await client.embeddings("Test", "custom-model");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/api/embeddings", {
        model: "custom-model",
        prompt: "Test",
      });
    });

    it("应该处理错误", async () => {
      mockAxiosInstance.post.mockRejectedValue(
        new Error("Embedding failed")
      );

      await expect(client.embeddings("Test")).rejects.toThrow(
        "Embedding failed"
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置对象", () => {
      client = new OllamaClient({});

      expect(client.baseURL).toBe("http://localhost:11434");
      expect(client.model).toBe("llama2");
    });

    it("应该处理部分配置", () => {
      client = new OllamaClient({ model: "qwen2:7b" });

      expect(client.baseURL).toBe("http://localhost:11434");
      expect(client.model).toBe("qwen2:7b");
    });

    it("应该是EventEmitter实例", () => {
      client = new OllamaClient();

      expect(typeof client.on).toBe("function");
      expect(typeof client.emit).toBe("function");
    });
  });
});
