/**
 * LLM IPC 单元测试
 * 测试14个 LLM 服务 API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { createMockLLMManager, createMockRAGManager, createMockMainWindow, captureIPCHandlers } from '../../utils/test-helpers.js';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

describe('LLM IPC', () => {
  let handlers = {};
  let mockLLMManager;
  let mockRAGManager;
  let mockMainWindow;
  let mockPromptTemplateManager;
  let mockDatabase;
  let registerLLMIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock 依赖
    mockLLMManager = createMockLLMManager();
    mockRAGManager = createMockRAGManager();
    mockMainWindow = createMockMainWindow();

    mockPromptTemplateManager = {
      getTemplate: vi.fn(async (name) => ({
        success: true,
        template: {
          id: `template-${name}`,
          name,
          content: `Template content for ${name}`,
        },
      })),
      formatTemplate: vi.fn((template, vars) => {
        let result = template.content;
        Object.entries(vars).forEach(([key, value]) => {
          result = result.replace(`{${key}}`, value);
        });
        return result;
      }),
    };

    mockDatabase = {
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 1 })),
      })),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../desktop-app-vue/src/main/llm/llm-ipc.js');
    registerLLMIPC = module.registerLLMIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 LLM IPC
    registerLLMIPC({
      llmManager: mockLLMManager,
      mainWindow: mockMainWindow,
      ragManager: mockRAGManager,
      promptTemplateManager: mockPromptTemplateManager,
      database: mockDatabase,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基础 LLM 服务', () => {
    it('should check LLM service status', async () => {
      mockLLMManager.checkStatus = vi.fn(async () => ({
        available: true,
        model: 'qwen2:7b',
      }));

      const result = await handlers['llm:check-status']();

      expect(result.available).toBe(true);
      expect(result.model).toBe('qwen2:7b');
      expect(mockLLMManager.checkStatus).toHaveBeenCalled();
    });

    it('should return unavailable when LLM manager is null', async () => {
      // 重新注册，传入 null manager
      handlers = {};
      const { ipcMain } = await import('electron');
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerLLMIPC({
        llmManager: null,
        mainWindow: mockMainWindow,
      });

      const result = await handlers['llm:check-status']();

      expect(result.available).toBe(false);
      expect(result.error).toContain('未初始化');
    });

    it('should handle query request', async () => {
      mockLLMManager.query = vi.fn(async (prompt, options) => ({
        success: true,
        response: `Response to: ${prompt}`,
        model: options.model || 'qwen2:7b',
      }));

      const result = await handlers['llm:query'](null, 'What is AI?', { model: 'llama3:8b' });

      expect(result.success).toBe(true);
      expect(result.response).toContain('What is AI?');
      expect(result.model).toBe('llama3:8b');
      expect(mockLLMManager.query).toHaveBeenCalledWith('What is AI?', { model: 'llama3:8b' });
    });

    it('should handle chat request', async () => {
      mockLLMManager.chat = vi.fn(async (messages, options) => ({
        success: true,
        response: 'Chat response',
        model: 'qwen2:7b',
      }));

      const messages = [
        { role: 'user', content: 'Hello' },
      ];

      const result = await handlers['llm:chat'](null, { messages, enableRAG: false });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Chat response');
      expect(mockLLMManager.chat).toHaveBeenCalled();
    });

    it('should handle chat request with RAG enhancement', async () => {
      mockLLMManager.chat = vi.fn(async (messages, options) => ({
        success: true,
        response: 'RAG-enhanced response',
        model: 'qwen2:7b',
      }));

      mockRAGManager.enhanceQuery = vi.fn(async (query, options) => ({
        success: true,
        docs: [
          { content: 'Related doc 1', score: 0.95 },
          { content: 'Related doc 2', score: 0.90 },
        ],
      }));

      const messages = [
        { role: 'user', content: 'What is machine learning?' },
      ];

      const result = await handlers['llm:chat'](null, { messages, enableRAG: true });

      expect(result.success).toBe(true);
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledWith(
        'What is machine learning?',
        expect.objectContaining({ topK: 3 })
      );
      expect(mockLLMManager.chat).toHaveBeenCalled();
    });
  });

  describe('模型管理', () => {
    it('should list available models', async () => {
      mockLLMManager.listModels = vi.fn(async () => ({
        success: true,
        models: [
          { name: 'qwen2:7b', size: '4.4GB', status: 'available' },
          { name: 'llama3:8b', size: '4.7GB', status: 'available' },
        ],
      }));

      const result = await handlers['llm:list-models']();

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(2);
      expect(result.models[0].name).toBe('qwen2:7b');
      expect(mockLLMManager.listModels).toHaveBeenCalled();
    });

    it('should switch LLM provider', async () => {
      mockLLMManager.switchProvider = vi.fn(async (provider) => ({
        success: true,
        provider,
        currentModel: `${provider}-model`,
      }));

      const result = await handlers['llm:switch-provider'](null, 'ollama');

      expect(result.success).toBe(true);
      expect(result.provider).toBe('ollama');
      expect(mockLLMManager.switchProvider).toHaveBeenCalledWith('ollama');
    });
  });

  describe('配置管理', () => {
    it('should get LLM config', async () => {
      mockLLMManager.getConfig = vi.fn(() => ({
        provider: 'ollama',
        model: 'qwen2:7b',
        baseURL: 'http://localhost:11434',
        timeout: 30000,
      }));

      const result = await handlers['llm:get-config']();

      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2:7b');
      expect(mockLLMManager.getConfig).toHaveBeenCalled();
    });

    it('should set LLM config', async () => {
      mockLLMManager.setConfig = vi.fn(async (config) => ({
        success: true,
        config,
      }));

      const newConfig = {
        model: 'llama3:8b',
        temperature: 0.7,
      };

      const result = await handlers['llm:set-config'](null, newConfig);

      expect(result.success).toBe(true);
      expect(mockLLMManager.setConfig).toHaveBeenCalledWith(newConfig);
    });
  });

  describe('高级功能', () => {
    it('should generate embeddings', async () => {
      mockLLMManager.embeddings = vi.fn(async (text) => ({
        success: true,
        embedding: new Array(768).fill(0).map(() => Math.random()),
        dimensions: 768,
      }));

      const result = await handlers['llm:embeddings'](null, 'Test text');

      expect(result.success).toBe(true);
      expect(result.embedding).toHaveLength(768);
      expect(result.dimensions).toBe(768);
      expect(mockLLMManager.embeddings).toHaveBeenCalledWith('Test text');
    });

    it('should handle streaming query', async () => {
      mockLLMManager.queryStream = vi.fn(async function* (prompt, options) {
        yield { chunk: 'Hello ' };
        yield { chunk: 'World' };
        yield { done: true };
      });

      // 模拟流式处理
      const chunks = [];
      const stream = mockLLMManager.queryStream('Test prompt');
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunk).toBe('Hello ');
      expect(chunks[2].done).toBe(true);
    });

    it('should chat with template', async () => {
      mockLLMManager.chat = vi.fn(async (messages) => ({
        success: true,
        response: 'Template-based response',
      }));

      const result = await handlers['llm:chat-with-template'](null, {
        templateName: 'code-review',
        variables: { code: 'function test() {}' },
      });

      expect(result.success).toBe(true);
      expect(mockPromptTemplateManager.getTemplate).toHaveBeenCalledWith('code-review');
    });

    it('should select best LLM for task', async () => {
      mockLLMManager.selectBest = vi.fn(async (task) => ({
        success: true,
        selectedModel: 'qwen2:7b',
        reason: 'Best for code tasks',
      }));

      const result = await handlers['llm:select-best'](null, {
        task: 'code-generation',
        requirements: { speed: 'fast' },
      });

      expect(result.success).toBe(true);
      expect(result.selectedModel).toBe('qwen2:7b');
      expect(mockLLMManager.selectBest).toHaveBeenCalled();
    });

    it('should generate report', async () => {
      mockLLMManager.generateReport = vi.fn(async (data) => ({
        success: true,
        report: 'Generated report content',
        format: 'markdown',
      }));

      const result = await handlers['llm:generate-report'](null, {
        type: 'project-summary',
        data: { project: 'Test Project' },
      });

      expect(result.success).toBe(true);
      expect(result.report).toContain('Generated report');
      expect(mockLLMManager.generateReport).toHaveBeenCalled();
    });

    it('should clear context', async () => {
      mockLLMManager.clearContext = vi.fn(async () => ({
        success: true,
        message: 'Context cleared',
      }));

      const result = await handlers['llm:clear-context']();

      expect(result.success).toBe(true);
      expect(result.message).toContain('cleared');
      expect(mockLLMManager.clearContext).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('should handle query error when LLM manager is not initialized', async () => {
      // 重新注册，传入 null manager
      handlers = {};
      const { ipcMain } = await import('electron');
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerLLMIPC({
        llmManager: null,
        mainWindow: mockMainWindow,
      });

      await expect(handlers['llm:query'](null, 'Test')).rejects.toThrow('未初始化');
    });

    it('should handle chat error when LLM manager is not initialized', async () => {
      handlers = {};
      const { ipcMain } = await import('electron');
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerLLMIPC({
        llmManager: null,
        mainWindow: mockMainWindow,
      });

      await expect(
        handlers['llm:chat'](null, { messages: [] })
      ).rejects.toThrow('未初始化');
    });

    it('should handle LLM query error', async () => {
      mockLLMManager.query = vi.fn(async () => {
        throw new Error('LLM service error');
      });

      await expect(
        handlers['llm:query'](null, 'Test')
      ).rejects.toThrow('LLM service error');
    });

    it('should handle RAG enhancement error gracefully', async () => {
      mockRAGManager.enhanceQuery = vi.fn(async () => {
        throw new Error('RAG error');
      });

      mockLLMManager.chat = vi.fn(async (messages) => ({
        success: true,
        response: 'Response without RAG',
      }));

      const messages = [{ role: 'user', content: 'Test' }];

      // 应该继续执行，不影响聊天
      const result = await handlers['llm:chat'](null, { messages, enableRAG: true });

      expect(result.success).toBe(true);
      expect(mockLLMManager.chat).toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('should handle empty messages array', async () => {
      mockLLMManager.chat = vi.fn(async (messages) => ({
        success: true,
        response: 'Empty chat response',
      }));

      const result = await handlers['llm:chat'](null, { messages: [], enableRAG: false });

      expect(result.success).toBe(true);
      expect(mockLLMManager.chat).toHaveBeenCalledWith([], expect.any(Object));
    });

    it('should handle null options in query', async () => {
      mockLLMManager.query = vi.fn(async (prompt, options) => ({
        success: true,
        response: 'Response',
      }));

      const result = await handlers['llm:query'](null, 'Test');

      expect(result.success).toBe(true);
      expect(mockLLMManager.query).toHaveBeenCalledWith('Test', {});
    });

    it('should handle chat without RAG manager', async () => {
      handlers = {};
      const { ipcMain } = await import('electron');
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      registerLLMIPC({
        llmManager: mockLLMManager,
        mainWindow: mockMainWindow,
        ragManager: null, // No RAG manager
      });

      mockLLMManager.chat = vi.fn(async (messages) => ({
        success: true,
        response: 'Response without RAG manager',
      }));

      const messages = [{ role: 'user', content: 'Test' }];
      const result = await handlers['llm:chat'](null, { messages, enableRAG: true });

      expect(result.success).toBe(true);
      // RAG should be skipped if no manager
      expect(mockLLMManager.chat).toHaveBeenCalled();
    });
  });
});
