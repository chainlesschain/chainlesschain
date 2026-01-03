/**
 * LLM Service IPC 单元测试
 * 测试14个 LLM IPC handlers 的注册和执行
 *
 * 使用依赖注入模式验证 IPC handlers，支持动态测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LLM Service IPC', () => {
  let handlers;
  let mockLlmManager;
  let mockMainWindow;
  let mockRagManager;
  let mockPromptTemplateManager;
  let mockLlmSelector;
  let mockDatabase;
  let mockApp;
  let mockIpcMain;
  let registerLLMIPC;

  const expectedChannels = [
    'llm:check-status',
    'llm:query',
    'llm:chat',
    'llm:chat-with-template',
    'llm:query-stream',
    'llm:get-config',
    'llm:set-config',
    'llm:list-models',
    'llm:clear-context',
    'llm:embeddings',
    'llm:get-selector-info',
    'llm:select-best',
    'llm:generate-report',
    'llm:switch-provider',
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // 创建 mock llmManager
    mockLlmManager = {
      checkStatus: vi.fn().mockResolvedValue({
        available: true,
        service: 'ollama',
        model: 'qwen2:7b',
      }),
      query: vi.fn().mockResolvedValue({
        text: 'Test response',
        tokens: 100,
      }),
      chatWithMessages: vi.fn().mockResolvedValue({
        text: 'Test chat response',
        tokens: 150,
        message: {
          role: 'assistant',
          content: 'Test chat response',
        },
        usage: {
          total_tokens: 150,
        },
      }),
      queryStream: vi.fn().mockResolvedValue({
        text: 'Streamed response',
        tokens: 200,
      }),
      listModels: vi.fn().mockResolvedValue([
        { id: 'qwen2:7b', name: 'Qwen2 7B' },
        { id: 'llama2', name: 'Llama2' },
      ]),
      clearContext: vi.fn(),
      embeddings: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      close: vi.fn().mockResolvedValue(true),
    };

    // 创建 mock mainWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };

    // 创建 mock ragManager
    mockRagManager = {
      enhanceQuery: vi.fn().mockResolvedValue({
        retrievedDocs: [
          {
            id: 'doc-1',
            title: 'Test Doc',
            content: 'Test content',
            score: 0.95,
          },
        ],
      }),
    };

    // 创建 mock promptTemplateManager
    mockPromptTemplateManager = {
      fillTemplate: vi.fn().mockResolvedValue('Filled template content'),
    };

    // 创建 mock llmSelector
    mockLlmSelector = {
      getAllCharacteristics: vi.fn().mockReturnValue({
        speed: ['fast', 'medium', 'slow'],
        accuracy: ['high', 'medium', 'low'],
      }),
      getTaskTypes: vi.fn().mockReturnValue(['chat', 'coding', 'analysis']),
      selectBestLLM: vi.fn().mockReturnValue({
        provider: 'ollama',
        model: 'qwen2:7b',
      }),
      generateSelectionReport: vi.fn().mockReturnValue({
        taskType: 'chat',
        selectedProvider: 'ollama',
        score: 0.95,
      }),
    };

    // 创建 mock database
    mockDatabase = {
      query: vi.fn(),
    };

    // 创建 mock app
    mockApp = {
      llmManager: mockLlmManager,
    };

    // 动态导入
    const module = await import('../../../src/main/llm/llm-ipc.js');
    registerLLMIPC = module.registerLLMIPC;

    // 注册 LLM IPC 并注入 mock 对象
    registerLLMIPC({
      llmManager: mockLlmManager,
      mainWindow: mockMainWindow,
      ragManager: mockRagManager,
      promptTemplateManager: mockPromptTemplateManager,
      llmSelector: mockLlmSelector,
      database: mockDatabase,
      app: mockApp,
      ipcMain: mockIpcMain,
    });
  });

  // ============================================================
  // Handler 注册验证
  // ============================================================

  describe('Handler 注册验证', () => {
    it('should have exactly 14 handlers registered', () => {
      expect(Object.keys(handlers).length).toBe(14);
    });

    it('should match all expected handler channels', () => {
      const registeredChannels = Object.keys(handlers).sort();
      const expectedSorted = expectedChannels.sort();
      expect(registeredChannels).toEqual(expectedSorted);
    });

    it('should have no duplicate handler channels', () => {
      const channels = Object.keys(handlers);
      const uniqueChannels = new Set(channels);
      expect(uniqueChannels.size).toBe(channels.length);
    });

    it('should contain all documented handlers', () => {
      expectedChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });
  });

  // ============================================================
  // 基础服务 Handlers (4个)
  // ============================================================

  describe('基础服务 Handlers', () => {
    const basicHandlers = [
      'llm:check-status',
      'llm:query',
      'llm:chat',
      'llm:query-stream',
    ];

    it('should have 4 basic service handlers', () => {
      const count = basicHandlers.filter((h) => handlers[h]).length;
      expect(count).toBe(4);
    });

    basicHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // 模板和流式 Handlers (1个)
  // ============================================================

  describe('模板和流式查询 Handlers', () => {
    const templateHandlers = [
      'llm:chat-with-template',
    ];

    it('should have 1 template handler', () => {
      const count = templateHandlers.filter((h) => handlers[h]).length;
      expect(count).toBe(1);
    });

    templateHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // 配置管理 Handlers (3个)
  // ============================================================

  describe('配置管理 Handlers', () => {
    const configHandlers = [
      'llm:get-config',
      'llm:set-config',
      'llm:list-models',
    ];

    it('should have 3 configuration management handlers', () => {
      const count = configHandlers.filter((h) => handlers[h]).length;
      expect(count).toBe(3);
    });

    configHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // 上下文和嵌入 Handlers (2个)
  // ============================================================

  describe('上下文和嵌入 Handlers', () => {
    const contextHandlers = [
      'llm:clear-context',
      'llm:embeddings',
    ];

    it('should have 2 context and embeddings handlers', () => {
      const count = contextHandlers.filter((h) => handlers[h]).length;
      expect(count).toBe(2);
    });

    contextHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // LLM 智能选择 Handlers (4个)
  // ============================================================

  describe('LLM 智能选择 Handlers', () => {
    const selectorHandlers = [
      'llm:get-selector-info',
      'llm:select-best',
      'llm:generate-report',
      'llm:switch-provider',
    ];

    it('should have 4 intelligent selection handlers', () => {
      const count = selectorHandlers.filter((h) => handlers[h]).length;
      expect(count).toBe(4);
    });

    selectorHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // 按功能域分组验证
  // ============================================================

  describe('按功能域分类验证', () => {
    it('should have 4 + 1 + 3 + 2 + 4 = 14 total handlers', () => {
      expect(Object.keys(handlers).length).toBe(14);
    });

    it('should group handlers correctly by functional domain', () => {
      const basicCount = [
        'llm:check-status',
        'llm:query',
        'llm:chat',
        'llm:query-stream',
      ].filter((h) => handlers[h]).length;
      const templateCount = [
        'llm:chat-with-template',
      ].filter((h) => handlers[h]).length;
      const configCount = [
        'llm:get-config',
        'llm:set-config',
        'llm:list-models',
      ].filter((h) => handlers[h]).length;
      const contextCount = [
        'llm:clear-context',
        'llm:embeddings',
      ].filter((h) => handlers[h]).length;
      const selectorCount = [
        'llm:get-selector-info',
        'llm:select-best',
        'llm:generate-report',
        'llm:switch-provider',
      ].filter((h) => handlers[h]).length;

      expect(basicCount).toBe(4);
      expect(templateCount).toBe(1);
      expect(configCount).toBe(3);
      expect(contextCount).toBe(2);
      expect(selectorCount).toBe(4);
    });
  });

  // ============================================================
  // Handler 命名约定验证
  // ============================================================

  describe('Handler 命名约定', () => {
    it('all handlers should start with "llm:" prefix', () => {
      Object.keys(handlers).forEach((channel) => {
        expect(channel.startsWith('llm:')).toBe(true);
      });
    });

    it('all handlers should use kebab-case naming convention', () => {
      const validPattern = /^llm:[a-z]+(-[a-z]+)*$/;
      Object.keys(handlers).forEach((channel) => {
        expect(validPattern.test(channel)).toBe(true);
      });
    });

    it('no handler should use underscores in channel name', () => {
      Object.keys(handlers).forEach((channel) => {
        expect(channel).not.toContain('_');
      });
    });

    it('no handler should use uppercase letters in channel name', () => {
      Object.keys(handlers).forEach((channel) => {
        expect(channel).toMatch(/^[a-z0-9:_-]+$/);
      });
    });
  });

  // ============================================================
  // Handler 功能验证 - 基础操作
  // ============================================================

  describe('Handler 功能验证 - 基础操作', () => {
    it('llm:check-status should invoke llmManager.checkStatus', async () => {
      const handler = handlers['llm:check-status'];
      const result = await handler({});
      expect(mockLlmManager.checkStatus).toHaveBeenCalled();
    });

    it('llm:query should invoke llmManager.query', async () => {
      const handler = handlers['llm:query'];
      const result = await handler({}, 'test prompt');
      expect(mockLlmManager.query).toHaveBeenCalledWith('test prompt', {});
    });

    it('llm:list-models should invoke llmManager.listModels', async () => {
      const handler = handlers['llm:list-models'];
      const result = await handler({});
      expect(mockLlmManager.listModels).toHaveBeenCalled();
    });

    it('llm:clear-context should invoke llmManager.clearContext', async () => {
      const handler = handlers['llm:clear-context'];
      await handler({}, 'conversation-123');
      expect(mockLlmManager.clearContext).toHaveBeenCalledWith('conversation-123');
    });

    it('llm:embeddings should invoke llmManager.embeddings', async () => {
      const handler = handlers['llm:embeddings'];
      const result = await handler({}, 'test text');
      expect(mockLlmManager.embeddings).toHaveBeenCalledWith('test text');
    });
  });

  // ============================================================
  // Handler 功能验证 - 聊天操作
  // ============================================================

  describe('Handler 功能验证 - 聊天操作', () => {
    it('llm:chat should handle messages without RAG', async () => {
      const handler = handlers['llm:chat'];
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = await handler({}, { messages, enableRAG: false });
      expect(mockLlmManager.chatWithMessages).toHaveBeenCalled();
    });

    it('llm:chat should handle messages with RAG', async () => {
      const handler = handlers['llm:chat'];
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = await handler({}, { messages, enableRAG: true });
      expect(mockLlmManager.chatWithMessages).toHaveBeenCalled();
      expect(mockRagManager.enhanceQuery).toHaveBeenCalled();
    });

    it('llm:chat-with-template should invoke promptTemplateManager', async () => {
      const handler = handlers['llm:chat-with-template'];
      const result = await handler({}, {
        templateId: 'template-123',
        variables: { name: 'John' },
      });
      expect(mockPromptTemplateManager.fillTemplate).toHaveBeenCalledWith('template-123', { name: 'John' });
    });
  });

  // ============================================================
  // Handler 功能验证 - 选择器操作
  // ============================================================

  describe('Handler 功能验证 - 选择器操作', () => {
    it('llm:get-selector-info should return selector info', async () => {
      const handler = handlers['llm:get-selector-info'];
      const result = await handler({});
      expect(mockLlmSelector.getAllCharacteristics).toHaveBeenCalled();
      expect(mockLlmSelector.getTaskTypes).toHaveBeenCalled();
    });

    it('llm:select-best should invoke llmSelector.selectBestLLM', async () => {
      const handler = handlers['llm:select-best'];
      const result = await handler({}, { speed: 'fast' });
      expect(mockLlmSelector.selectBestLLM).toHaveBeenCalledWith({ speed: 'fast' });
    });

    it('llm:generate-report should invoke llmSelector.generateSelectionReport', async () => {
      const handler = handlers['llm:generate-report'];
      const result = await handler({}, 'chat');
      expect(mockLlmSelector.generateSelectionReport).toHaveBeenCalledWith('chat');
    });
  });

  // ============================================================
  // 完整性验证
  // ============================================================

  describe('完整性验证', () => {
    it('should have no missing handlers from specification', () => {
      const missing = expectedChannels.filter((h) => !handlers[h]);
      expect(missing).toEqual([]);
    });

    it('should have no unexpected handlers beyond specification', () => {
      const registered = Object.keys(handlers);
      const unexpected = registered.filter((h) => !expectedChannels.includes(h));
      expect(unexpected).toEqual([]);
    });

    it('should maintain 1:1 mapping between specified and registered handlers', () => {
      expect(Object.keys(handlers).length).toBe(expectedChannels.length);
    });
  });

  // ============================================================
  // 特殊功能验证
  // ============================================================

  describe('特殊功能验证', () => {
    it('should have handlers for all 4 basic LLM service operations', () => {
      expect(handlers['llm:check-status']).toBeDefined();
      expect(handlers['llm:query']).toBeDefined();
      expect(handlers['llm:chat']).toBeDefined();
      expect(handlers['llm:query-stream']).toBeDefined();
    });

    it('should have handlers for configuration and model management', () => {
      expect(handlers['llm:get-config']).toBeDefined();
      expect(handlers['llm:set-config']).toBeDefined();
      expect(handlers['llm:list-models']).toBeDefined();
    });

    it('should have handlers for context and embeddings operations', () => {
      expect(handlers['llm:clear-context']).toBeDefined();
      expect(handlers['llm:embeddings']).toBeDefined();
    });

    it('should have handlers for intelligent LLM selection', () => {
      expect(handlers['llm:get-selector-info']).toBeDefined();
      expect(handlers['llm:select-best']).toBeDefined();
      expect(handlers['llm:generate-report']).toBeDefined();
      expect(handlers['llm:switch-provider']).toBeDefined();
    });

    it('should have handler for template-based chat', () => {
      expect(handlers['llm:chat-with-template']).toBeDefined();
    });
  });

  // ============================================================
  // 功能分类验证
  // ============================================================

  describe('功能分类验证', () => {
    it('read operations should include: check-status, get-config, list-models, get-selector-info', () => {
      const readOps = [
        'llm:check-status',
        'llm:get-config',
        'llm:list-models',
        'llm:get-selector-info',
      ];
      readOps.forEach((op) => {
        expect(handlers[op]).toBeDefined();
      });
    });

    it('write operations should include: set-config, clear-context, switch-provider', () => {
      const writeOps = [
        'llm:set-config',
        'llm:clear-context',
        'llm:switch-provider',
      ];
      writeOps.forEach((op) => {
        expect(handlers[op]).toBeDefined();
      });
    });

    it('compute operations should include: query, chat, chat-with-template, query-stream, embeddings, select-best, generate-report', () => {
      const computeOps = [
        'llm:query',
        'llm:chat',
        'llm:chat-with-template',
        'llm:query-stream',
        'llm:embeddings',
        'llm:select-best',
        'llm:generate-report',
      ];
      computeOps.forEach((op) => {
        expect(handlers[op]).toBeDefined();
      });
    });
  });
});
