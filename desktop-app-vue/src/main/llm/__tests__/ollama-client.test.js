/**
 * Ollama Client 单元测试
 *
 * 测试内容：
 * - OllamaClient 类的构造函数
 * - checkStatus 服务状态检查
 * - generate/generateStream 文本生成
 * - chat/chatStream 对话功能
 * - pullModel/deleteModel/showModel 模型管理
 * - embeddings 向量生成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const OllamaClient = require('../ollama-client');

describe('OllamaClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();

    client = new OllamaClient({
      baseURL: 'http://localhost:11434',
      timeout: 60000,
      model: 'llama2',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultClient = new OllamaClient();
      expect(defaultClient.baseURL).toBe('http://localhost:11434');
      expect(defaultClient.timeout).toBe(120000);
      expect(defaultClient.model).toBe('llama2');
    });

    it('should initialize with custom config', () => {
      const customClient = new OllamaClient({
        baseURL: 'http://custom:8080',
        timeout: 30000,
        model: 'qwen2',
      });
      expect(customClient.baseURL).toBe('http://custom:8080');
      expect(customClient.timeout).toBe(30000);
      expect(customClient.model).toBe('qwen2');
    });

    it('should be an EventEmitter', () => {
      expect(typeof client.on).toBe('function');
      expect(typeof client.emit).toBe('function');
    });

    it('should have an axios client instance', () => {
      expect(client.client).toBeDefined();
      expect(typeof client.client.get).toBe('function');
      expect(typeof client.client.post).toBe('function');
    });
  });

  describe('checkStatus', () => {
    it('should return available status when service is running', async () => {
      // Mock client.get
      client.client.get = vi.fn().mockResolvedValue({
        data: {
          models: [
            { name: 'llama2', size: 3826793472, modified_at: '2024-01-01T00:00:00Z' },
            { name: 'qwen2:7b', size: 4500000000, modified_at: '2024-01-02T00:00:00Z' },
          ],
          version: '0.1.23',
        },
      });

      const result = await client.checkStatus();

      expect(result.available).toBe(true);
      expect(result.models).toHaveLength(2);
      expect(result.models[0].name).toBe('llama2');
      expect(result.version).toBe('0.1.23');
      expect(client.client.get).toHaveBeenCalledWith('/api/tags');
    });

    it('should return unavailable status when service is down', async () => {
      client.client.get = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await client.checkStatus();

      expect(result.available).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.models).toEqual([]);
    });

    it('should handle empty models list', async () => {
      client.client.get = vi.fn().mockResolvedValue({
        data: {
          version: '0.1.23',
        },
      });

      const result = await client.checkStatus();

      expect(result.available).toBe(true);
      expect(result.models).toEqual([]);
    });
  });

  describe('generate', () => {
    it('should generate text successfully', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          response: 'Hello, World!',
          model: 'llama2',
          context: [1, 2, 3],
          done: true,
          total_duration: 1000000000,
          eval_count: 10,
        },
      });

      const result = await client.generate('Hello');

      expect(result.text).toBe('Hello, World!');
      expect(result.model).toBe('llama2');
      expect(result.context).toEqual([1, 2, 3]);
      expect(result.done).toBe(true);
      expect(result.tokens).toBe(10);
      expect(client.client.post).toHaveBeenCalledWith('/api/generate', {
        model: 'llama2',
        prompt: 'Hello',
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
        },
        context: undefined,
      });
    });

    it('should use custom model and options', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          response: 'Test response',
          model: 'qwen2',
          done: true,
        },
      });

      await client.generate('Test', {
        model: 'qwen2',
        temperature: 0.5,
        top_p: 0.8,
        top_k: 30,
        context: [4, 5, 6],
      });

      expect(client.client.post).toHaveBeenCalledWith('/api/generate', {
        model: 'qwen2',
        prompt: 'Test',
        stream: false,
        options: {
          temperature: 0.5,
          top_p: 0.8,
          top_k: 30,
        },
        context: [4, 5, 6],
      });
    });

    it('should throw error on failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('API Error'));

      await expect(client.generate('Hello')).rejects.toThrow('API Error');
    });

    it('should handle missing eval_count', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          response: 'Test',
          model: 'llama2',
          done: true,
        },
      });

      const result = await client.generate('Hello');
      expect(result.tokens).toBe(0);
    });
  });

  describe('generateStream', () => {
    it('should stream generate text', async () => {
      // 创建 mock stream
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            // 模拟分块数据
            setTimeout(() => {
              callback(Buffer.from(JSON.stringify({ response: 'Hello' }) + '\n'));
              callback(Buffer.from(JSON.stringify({ response: ', World!' }) + '\n'));
              callback(
                Buffer.from(
                  JSON.stringify({
                    response: '',
                    done: true,
                    model: 'llama2',
                    context: [1, 2, 3],
                    total_duration: 1000000000,
                    eval_count: 5,
                  }) + '\n'
                )
              );
            }, 10);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      const chunks = [];
      const onChunk = vi.fn((chunk, fullText) => {
        chunks.push({ chunk, fullText });
      });

      const result = await client.generateStream('Hello', onChunk);

      expect(result.text).toBe('Hello, World!');
      expect(result.model).toBe('llama2');
      expect(onChunk).toHaveBeenCalledTimes(2);
    });

    it('should handle stream errors', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => {
              callback(new Error('Stream error'));
            }, 10);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      await expect(client.generateStream('Hello', vi.fn())).rejects.toThrow('Stream error');
    });

    it('should resolve on stream end without done', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => {
              callback(Buffer.from(JSON.stringify({ response: 'Hello' }) + '\n'));
            }, 5);
          }
          if (event === 'end') {
            setTimeout(() => {
              callback();
            }, 20);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      const result = await client.generateStream('Hello', vi.fn());

      expect(result.text).toBe('Hello');
      expect(result.context).toBeNull();
    });

    it('should throw error on post failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Network Error'));

      await expect(client.generateStream('Hello', vi.fn())).rejects.toThrow('Network Error');
    });
  });

  describe('chat', () => {
    it('should chat successfully', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          message: { role: 'assistant', content: 'I am fine, thank you!' },
          model: 'llama2',
          done: true,
          total_duration: 2000000000,
          eval_count: 15,
        },
      });

      const messages = [{ role: 'user', content: 'How are you?' }];
      const result = await client.chat(messages);

      expect(result.message).toEqual({ role: 'assistant', content: 'I am fine, thank you!' });
      expect(result.model).toBe('llama2');
      expect(result.done).toBe(true);
      expect(result.tokens).toBe(15);
      expect(client.client.post).toHaveBeenCalledWith('/api/chat', {
        model: 'llama2',
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
        },
      });
    });

    it('should use custom options', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          message: { role: 'assistant', content: 'Response' },
          model: 'qwen2',
          done: true,
        },
      });

      const messages = [{ role: 'user', content: 'Test' }];
      await client.chat(messages, {
        model: 'qwen2',
        temperature: 0.3,
      });

      expect(client.client.post).toHaveBeenCalledWith('/api/chat', {
        model: 'qwen2',
        messages,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          top_k: 40,
        },
      });
    });

    it('should throw error on failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Chat failed'));

      await expect(client.chat([])).rejects.toThrow('Chat failed');
    });

    it('should handle missing eval_count', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: {
          message: { role: 'assistant', content: 'Hi' },
          model: 'llama2',
          done: true,
        },
      });

      const result = await client.chat([{ role: 'user', content: 'Hello' }]);
      expect(result.tokens).toBe(0);
    });
  });

  describe('chatStream', () => {
    it('should stream chat messages', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => {
              callback(Buffer.from(JSON.stringify({ message: { content: 'Hi' } }) + '\n'));
              callback(Buffer.from(JSON.stringify({ message: { content: ' there!' } }) + '\n'));
              callback(
                Buffer.from(
                  JSON.stringify({
                    done: true,
                    model: 'llama2',
                    total_duration: 1000000000,
                    eval_count: 3,
                  }) + '\n'
                )
              );
            }, 10);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      const onChunk = vi.fn();
      const result = await client.chatStream([{ role: 'user', content: 'Hello' }], onChunk);

      expect(result.message.role).toBe('assistant');
      expect(result.message.content).toBe('Hi there!');
      expect(onChunk).toHaveBeenCalledTimes(2);
    });

    it('should resolve on stream end', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => {
              callback(Buffer.from(JSON.stringify({ message: { content: 'Test' } }) + '\n'));
            }, 5);
          }
          if (event === 'end') {
            setTimeout(() => {
              callback();
            }, 20);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      const result = await client.chatStream([{ role: 'user', content: 'Test' }], vi.fn());

      expect(result.message.content).toBe('Test');
    });

    it('should throw error on post failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Stream failed'));

      await expect(
        client.chatStream([{ role: 'user', content: 'Test' }], vi.fn())
      ).rejects.toThrow('Stream failed');
    });
  });

  describe('pullModel', () => {
    it('should pull model with progress', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => {
              callback(
                Buffer.from(
                  JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n'
                )
              );
              callback(
                Buffer.from(
                  JSON.stringify({ status: 'downloading', completed: 100, total: 100 }) + '\n'
                )
              );
              callback(Buffer.from(JSON.stringify({ status: 'success' }) + '\n'));
            }, 10);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      const onProgress = vi.fn();
      const result = await client.pullModel('llama2:latest', onProgress);

      expect(result.status).toBe('success');
      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(client.client.post).toHaveBeenCalledWith(
        '/api/pull',
        { name: 'llama2:latest', stream: true },
        { responseType: 'stream' }
      );
    });

    it('should handle pull errors', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Pull failed'));

      await expect(client.pullModel('invalid-model')).rejects.toThrow('Pull failed');
    });

    it('should handle stream errors during pull', async () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => {
              callback(new Error('Download interrupted'));
            }, 10);
          }
          return mockStream;
        }),
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: mockStream,
      });

      await expect(client.pullModel('llama2:latest')).rejects.toThrow('Download interrupted');
    });
  });

  describe('deleteModel', () => {
    it('should delete model successfully', async () => {
      client.client.delete = vi.fn().mockResolvedValue({});

      const result = await client.deleteModel('llama2:latest');

      expect(result).toBe(true);
      expect(client.client.delete).toHaveBeenCalledWith('/api/delete', {
        data: { name: 'llama2:latest' },
      });
    });

    it('should throw error on delete failure', async () => {
      client.client.delete = vi.fn().mockRejectedValue(new Error('Delete failed'));

      await expect(client.deleteModel('llama2')).rejects.toThrow('Delete failed');
    });
  });

  describe('showModel', () => {
    it('should get model info successfully', async () => {
      const modelInfo = {
        modelfile: 'FROM llama2',
        parameters: 'temperature 0.8',
        template: '{{ .Prompt }}',
      };

      client.client.post = vi.fn().mockResolvedValue({
        data: modelInfo,
      });

      const result = await client.showModel('llama2');

      expect(result).toEqual(modelInfo);
      expect(client.client.post).toHaveBeenCalledWith('/api/show', { name: 'llama2' });
    });

    it('should throw error on show failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Model not found'));

      await expect(client.showModel('invalid')).rejects.toThrow('Model not found');
    });
  });

  describe('embeddings', () => {
    it('should generate embeddings successfully', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      client.client.post = vi.fn().mockResolvedValue({
        data: { embedding },
      });

      const result = await client.embeddings('Hello world');

      expect(result).toEqual(embedding);
      expect(client.client.post).toHaveBeenCalledWith('/api/embeddings', {
        model: 'llama2',
        prompt: 'Hello world',
      });
    });

    it('should use custom model for embeddings', async () => {
      client.client.post = vi.fn().mockResolvedValue({
        data: { embedding: [0.1, 0.2] },
      });

      await client.embeddings('Test', 'nomic-embed-text');

      expect(client.client.post).toHaveBeenCalledWith('/api/embeddings', {
        model: 'nomic-embed-text',
        prompt: 'Test',
      });
    });

    it('should throw error on embeddings failure', async () => {
      client.client.post = vi.fn().mockRejectedValue(new Error('Embeddings failed'));

      await expect(client.embeddings('Test')).rejects.toThrow('Embeddings failed');
    });
  });
});
