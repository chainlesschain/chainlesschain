/**
 * Project AI IPC 单元测试
 * 测试 15 个项目 AI 功能 IPC 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { createMockDatabase, createMockLLMManager, createMockMainWindow, createTestData } from '../../utils/test-helpers.js';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
  post: vi.fn(),
}));

// Mock crypto module
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => 'test-hash-123'),
      })),
    })),
  },
  createHash: vi.fn(() => ({
    update: vi.fn(() => ({
      digest: vi.fn(() => 'test-hash-123'),
    })),
  })),
}));

describe('Project AI IPC', () => {
  let handlers = {};
  let mockDatabase;
  let mockLLMManager;
  let mockAIEngineManager;
  let mockChatSkillBridge;
  let mockMainWindow;
  let mockScanAndRegisterProjectFiles;
  let registerProjectAIIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock 依赖
    mockDatabase = {
      ...createMockDatabase(),
      saveToFile: vi.fn(),
      updateProject: vi.fn((id, updates) => ({ id, ...updates })),
      db: {
        prepare: vi.fn((sql) => ({
          get: vi.fn(() => {
            if (sql.includes('FROM projects')) {
              return createTestData('project', {
                id: 'project-1',
                root_path: '/mock/projects/project-1',
              });
            }
            if (sql.includes('FROM project_files')) {
              return null; // 文件不存在
            }
            return null;
          }),
          all: vi.fn(() => []),
          run: vi.fn(() => {}),
        })),
      },
    };

    mockLLMManager = {
      ...createMockLLMManager(),
      query: vi.fn(async (prompt, options) => ({
        text: 'Mock LLM response',
        content: 'Mock LLM response',
      })),
    };

    mockAIEngineManager = {
      initialize: vi.fn(async () => {}),
      getTaskPlanner: vi.fn(() => ({
        decomposeTask: vi.fn(async (request, context) => ({
          success: true,
          taskPlanId: 'task-plan-1',
          tasks: [
            { id: 'task-1', title: 'Task 1', description: 'Description 1' },
            { id: 'task-2', title: 'Task 2', description: 'Description 2' },
          ],
        })),
        executeTaskPlan: vi.fn(async (plan, context, progressCallback) => {
          progressCallback?.({ progress: 50, message: 'In progress' });
          return {
            success: true,
            results: [
              { taskId: 'task-1', success: true, projectPath: '/mock/path' },
            ],
          };
        }),
        getTaskPlan: vi.fn(async (id) => ({
          id,
          title: 'Test Task Plan',
          tasks: [],
        })),
        getTaskPlanHistory: vi.fn(async (projectId, limit) => ([
          { id: 'plan-1', title: 'Plan 1', created_at: Date.now() },
          { id: 'plan-2', title: 'Plan 2', created_at: Date.now() - 1000 },
        ])),
        cancelTaskPlan: vi.fn(async (id) => {}),
      })),
    };

    mockChatSkillBridge = {
      interceptAndProcess: vi.fn(async (userMessage, aiResponse, context) => ({
        shouldIntercept: false,
        enhancedResponse: aiResponse,
        toolCalls: [],
        executionResults: [],
        summary: 'No interception',
      })),
    };

    mockMainWindow = {
      ...createMockMainWindow(),
      isDestroyed: vi.fn(() => false),
    };

    mockScanAndRegisterProjectFiles = vi.fn(async (projectId, path) => 5);

    // Mock fs module
    vi.doMock('fs', () => ({
      default: {
        promises: {
          readdir: vi.fn(async (path, options) => [
            { name: 'file1.js', isDirectory: () => false, isFile: () => true },
            { name: 'file2.js', isDirectory: () => false, isFile: () => true },
            { name: 'folder', isDirectory: () => true, isFile: () => false },
          ]),
          readFile: vi.fn(async (path) => 'Mock file content'),
          stat: vi.fn(async (path) => ({
            size: 1024,
            isDirectory: () => false,
            isFile: () => true,
          })),
          mkdir: vi.fn(async () => {}),
        },
      },
      promises: {
        readdir: vi.fn(async (path, options) => [
          { name: 'file1.js', isDirectory: () => false, isFile: () => true },
          { name: 'file2.js', isDirectory: () => false, isFile: () => true },
          { name: 'folder', isDirectory: () => true, isFile: () => false },
        ]),
        readFile: vi.fn(async (path) => 'Mock file content'),
        stat: vi.fn(async (path) => ({
          size: 1024,
          isDirectory: () => false,
          isFile: () => true,
        })),
        mkdir: vi.fn(async () => {}),
      },
    }));

    // Mock path module
    vi.doMock('path', () => ({
      default: {
        join: vi.fn((...args) => args.join('/')),
        relative: vi.fn((from, to) => to.replace(from, '').replace(/^\//, '')),
        basename: vi.fn((path) => path.split('/').pop()),
        extname: vi.fn((path) => {
          const parts = path.split('.');
          return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
        }),
      },
      join: vi.fn((...args) => args.join('/')),
      relative: vi.fn((from, to) => to.replace(from, '').replace(/^\//, '')),
      basename: vi.fn((path) => path.split('/').pop()),
      extname: vi.fn((path) => {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
      }),
    }));

    // Mock response-parser
    vi.doMock('../../../desktop-app-vue/src/main/ai-engine/response-parser', () => ({
      parseAIResponse: vi.fn((response, operations) => ({
        hasFileOperations: operations?.length > 0,
        operations: operations || [],
        conversationText: response,
      })),
    }));

    // Mock conversation-executor
    vi.doMock('../../../desktop-app-vue/src/main/ai-engine/conversation-executor', () => ({
      executeOperations: vi.fn(async (operations, projectPath, database) =>
        operations.map(op => ({ ...op, status: 'success' }))
      ),
      ensureLogTable: vi.fn(async (database) => {}),
    }));

    // Mock project-config
    vi.doMock('../../../desktop-app-vue/src/main/project/project-config', () => ({
      getProjectConfig: vi.fn(() => ({
        getProjectsRootPath: vi.fn(() => '/mock/projects'),
      })),
    }));

    // Mock ai-engine-manager
    vi.doMock('../../../desktop-app-vue/src/main/ai-engine/ai-engine-manager', () => ({
      getAIEngineManager: vi.fn(() => mockAIEngineManager),
    }));

    // Mock code-api
    vi.doMock('../../../desktop-app-vue/src/main/project/code-api', () => ({
      default: {
        generate: vi.fn(async () => ({
          success: true,
          code: 'function test() { return true; }',
          explanation: 'Generated code',
        })),
        review: vi.fn(async () => ({
          success: true,
          issues: [{ severity: 'warning', message: 'Code smell detected' }],
          suggestions: ['Refactor this function'],
        })),
        refactor: vi.fn(async () => ({
          success: true,
          refactoredCode: 'const test = () => true;',
          changes: ['Converted to arrow function'],
        })),
        explain: vi.fn(async () => ({
          success: true,
          explanation: 'This code does X, Y, and Z',
        })),
        fixBug: vi.fn(async () => ({
          success: true,
          fixedCode: 'function test() { return false; }',
          explanation: 'Fixed the bug by changing return value',
        })),
        generateTests: vi.fn(async () => ({
          success: true,
          tests: 'describe("test", () => { it("should work", () => {}) });',
        })),
        optimize: vi.fn(async () => ({
          success: true,
          optimizedCode: 'const test = () => true;',
          improvements: ['Reduced complexity'],
        })),
      },
    }));

    // 动态导入，确保 mock 已设置
    const module = await import('../../../desktop-app-vue/src/main/project/project-ai-ipc.js');
    registerProjectAIIPC = module.registerProjectAIIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 Project AI IPC
    registerProjectAIIPC({
      database: mockDatabase,
      llmManager: mockLLMManager,
      aiEngineManager: mockAIEngineManager,
      chatSkillBridge: mockChatSkillBridge,
      mainWindow: mockMainWindow,
      scanAndRegisterProjectFiles: mockScanAndRegisterProjectFiles,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AI 对话功能', () => {
    it('should handle AI chat with file operations', async () => {
      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response with operations',
          operations: [
            { type: 'create', path: 'test.js', content: 'console.log("test");' },
          ],
          rag_sources: [{ title: 'Source 1', content: 'Content 1' }],
        },
      });

      const chatData = {
        projectId: 'project-1',
        userMessage: 'Create a test file',
        conversationHistory: [],
        contextMode: 'project',
      };

      const result = await handlers['project:aiChat'](null, chatData);

      expect(result.success).toBe(true);
      expect(result.conversationResponse).toBeDefined();
      expect(result.fileOperations).toBeDefined();
      expect(axios.default.post).toHaveBeenCalled();
    });

    it('should use ChatSkillBridge when available', async () => {
      mockChatSkillBridge.interceptAndProcess.mockResolvedValue({
        shouldIntercept: true,
        enhancedResponse: 'Enhanced AI response',
        toolCalls: [{ name: 'createFile', args: {} }],
        executionResults: [{ success: true }],
        summary: 'Used skill bridge',
      });

      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'Original AI response',
          operations: [],
          rag_sources: [],
        },
      });

      const chatData = {
        projectId: 'project-1',
        userMessage: 'Test message',
        conversationHistory: [],
      };

      const result = await handlers['project:aiChat'](null, chatData);

      expect(result.success).toBe(true);
      expect(result.usedBridge).toBe(true);
      expect(result.conversationResponse).toBe('Enhanced AI response');
      expect(mockChatSkillBridge.interceptAndProcess).toHaveBeenCalled();
    });

    it('should handle AI chat error when database not initialized', async () => {
      registerProjectAIIPC({
        database: null,
        llmManager: mockLLMManager,
        aiEngineManager: mockAIEngineManager,
        chatSkillBridge: mockChatSkillBridge,
        mainWindow: mockMainWindow,
        scanAndRegisterProjectFiles: mockScanAndRegisterProjectFiles,
      });

      await expect(
        handlers['project:aiChat'](null, { projectId: 'p1', userMessage: 'test' })
      ).rejects.toThrow('数据库未初始化');
    });

    it('should handle project not found error', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        get: vi.fn(() => null),
      });

      await expect(
        handlers['project:aiChat'](null, { projectId: 'non-existent', userMessage: 'test' })
      ).rejects.toThrow('项目不存在');
    });

    it('should handle project without root path', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        get: vi.fn(() => ({ id: 'project-1', root_path: null })),
      });

      await expect(
        handlers['project:aiChat'](null, { projectId: 'project-1', userMessage: 'test' })
      ).rejects.toThrow('项目路径未设置');
    });

    it('should handle AI service connection error', async () => {
      const axios = await import('axios');
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      axios.default.post.mockRejectedValue(error);

      await expect(
        handlers['project:aiChat'](null, {
          projectId: 'project-1',
          userMessage: 'test',
        })
      ).rejects.toThrow('AI服务连接失败');
    });

    it('should scan project files', async () => {
      const result = await handlers['project:scan-files'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.added).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it('should handle scan files error when project not found', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        get: vi.fn(() => null),
      });

      await expect(
        handlers['project:scan-files'](null, 'non-existent')
      ).rejects.toThrow('项目不存在');
    });

    it('should handle scan files error when no root path', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        get: vi.fn(() => ({ id: 'project-1', root_path: null, folder_path: null })),
      });

      await expect(
        handlers['project:scan-files'](null, 'project-1')
      ).rejects.toThrow('项目没有根路径');
    });
  });

  describe('AI 任务规划', () => {
    it('should decompose task', async () => {
      const result = await handlers['project:decompose-task'](
        null,
        'Create a web application',
        { projectId: 'project-1' }
      );

      expect(result.success).toBe(true);
      expect(result.taskPlanId).toBeDefined();
      expect(result.tasks).toHaveLength(2);
      expect(mockAIEngineManager.initialize).toHaveBeenCalled();
    });

    it('should execute task plan', async () => {
      const result = await handlers['project:execute-task-plan'](
        null,
        'task-plan-1',
        { projectId: 'project-1', root_path: '/mock/path' }
      );

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
      expect(mockScanAndRegisterProjectFiles).toHaveBeenCalled();
    });

    it('should create project directory if not exists', async () => {
      const fs = await import('fs');

      const result = await handlers['project:execute-task-plan'](
        null,
        'task-plan-1',
        { projectId: 'project-1', root_path: null }
      );

      expect(result.success).toBe(true);
      expect(fs.promises.mkdir).toHaveBeenCalled();
      expect(mockDatabase.updateProject).toHaveBeenCalled();
    });

    it('should handle task plan not found', async () => {
      mockAIEngineManager.getTaskPlanner.mockReturnValue({
        getTaskPlan: vi.fn(async () => null),
      });

      await expect(
        handlers['project:execute-task-plan'](null, 'non-existent', { projectId: 'p1' })
      ).rejects.toThrow('任务计划不存在');
    });

    it('should send progress updates to main window', async () => {
      await handlers['project:execute-task-plan'](
        null,
        'task-plan-1',
        { projectId: 'project-1', root_path: '/mock/path' }
      );

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'task:progress-update',
        expect.objectContaining({ progress: 50 })
      );
    });

    it('should get task plan', async () => {
      const result = await handlers['project:get-task-plan'](null, 'task-plan-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('task-plan-1');
      expect(result.title).toBe('Test Task Plan');
    });

    it('should get task plan history', async () => {
      const result = await handlers['project:get-task-plan-history'](null, 'project-1', 10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('plan-1');
      expect(result[1].id).toBe('plan-2');
    });

    it('should cancel task plan', async () => {
      const result = await handlers['project:cancel-task-plan'](null, 'task-plan-1');

      expect(result.success).toBe(true);
    });

    it('should handle decompose task without aiEngineManager', async () => {
      registerProjectAIIPC({
        database: mockDatabase,
        llmManager: mockLLMManager,
        aiEngineManager: null,
        chatSkillBridge: mockChatSkillBridge,
        mainWindow: mockMainWindow,
        scanAndRegisterProjectFiles: mockScanAndRegisterProjectFiles,
      });

      const result = await handlers['project:decompose-task'](
        null,
        'Create a web app',
        { projectId: 'project-1' }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('AI 内容处理', () => {
    it('should polish content', async () => {
      const params = {
        content: 'This is some content that needs polishing.',
        style: 'professional',
      };

      const result = await handlers['project:polishContent'](null, params);

      expect(result.success).toBe(true);
      expect(result.polished).toBeDefined();
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('should polish content without style', async () => {
      const params = {
        content: 'Content without style preference.',
      };

      const result = await handlers['project:polishContent'](null, params);

      expect(result.success).toBe(true);
      expect(result.polished).toBeDefined();
    });

    it('should expand content', async () => {
      const params = {
        content: 'Short content.',
        targetLength: 500,
      };

      const result = await handlers['project:expandContent'](null, params);

      expect(result.success).toBe(true);
      expect(result.expanded).toBeDefined();
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('should expand content without target length', async () => {
      const params = {
        content: 'Content to expand.',
      };

      const result = await handlers['project:expandContent'](null, params);

      expect(result.success).toBe(true);
      expect(result.expanded).toBeDefined();
    });

    it('should handle polish content error', async () => {
      mockLLMManager.query.mockRejectedValue(new Error('LLM error'));

      await expect(
        handlers['project:polishContent'](null, { content: 'test' })
      ).rejects.toThrow('LLM error');
    });
  });

  describe('AI 代码助手', () => {
    it('should generate code', async () => {
      const result = await handlers['project:code-generate'](
        null,
        'Create a function that adds two numbers',
        'javascript',
        { includeTests: true, includeComments: true }
      );

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('should review code', async () => {
      const result = await handlers['project:code-review'](
        null,
        'function test() { var x = 1; }',
        'javascript',
        ['performance', 'security']
      );

      expect(result.success).toBe(true);
      expect(result.issues).toBeDefined();
      expect(result.suggestions).toBeDefined();
    });

    it('should refactor code', async () => {
      const result = await handlers['project:code-refactor'](
        null,
        'function test() { return 1; }',
        'javascript',
        'modernize'
      );

      expect(result.success).toBe(true);
      expect(result.refactoredCode).toBeDefined();
      expect(result.changes).toBeDefined();
    });

    it('should explain code', async () => {
      const result = await handlers['project:code-explain'](
        null,
        'const add = (a, b) => a + b;',
        'javascript'
      );

      expect(result.success).toBe(true);
      expect(result.explanation).toBeDefined();
    });

    it('should fix bug in code', async () => {
      const result = await handlers['project:code-fix-bug'](
        null,
        'function divide(a, b) { return a / b; }',
        'javascript',
        'Does not handle division by zero'
      );

      expect(result.success).toBe(true);
      expect(result.fixedCode).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('should generate tests for code', async () => {
      const result = await handlers['project:code-generate-tests'](
        null,
        'function add(a, b) { return a + b; }',
        'javascript'
      );

      expect(result.success).toBe(true);
      expect(result.tests).toBeDefined();
    });

    it('should optimize code', async () => {
      const result = await handlers['project:code-optimize'](
        null,
        'for (var i = 0; i < arr.length; i++) { console.log(arr[i]); }',
        'javascript'
      );

      expect(result.success).toBe(true);
      expect(result.optimizedCode).toBeDefined();
      expect(result.improvements).toBeDefined();
    });

    it('should handle code generate error', async () => {
      const CodeAPI = await import('../../../desktop-app-vue/src/main/project/code-api');
      CodeAPI.default.generate.mockRejectedValue(new Error('Code generation failed'));

      const result = await handlers['project:code-generate'](
        null,
        'Test description',
        'javascript'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Code generation failed');
    });

    it('should handle code review error', async () => {
      const CodeAPI = await import('../../../desktop-app-vue/src/main/project/code-api');
      CodeAPI.default.review.mockRejectedValue(new Error('Review failed'));

      const result = await handlers['project:code-review'](
        null,
        'test code',
        'javascript'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Review failed');
    });
  });

  describe('错误处理', () => {
    it('should handle file operation execution error', async () => {
      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response',
          operations: [{ type: 'create', path: 'test.js' }],
          rag_sources: [],
        },
      });

      const executor = await import('../../../desktop-app-vue/src/main/ai-engine/conversation-executor');
      executor.executeOperations.mockRejectedValue(new Error('Operation failed'));

      const result = await handlers['project:aiChat'](null, {
        projectId: 'project-1',
        userMessage: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.fileOperations).toHaveLength(1);
      expect(result.fileOperations[0].status).toBe('error');
    });

    it('should handle ChatSkillBridge error gracefully', async () => {
      mockChatSkillBridge.interceptAndProcess.mockRejectedValue(
        new Error('Bridge error')
      );

      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response',
          operations: [],
          rag_sources: [],
        },
      });

      const result = await handlers['project:aiChat'](null, {
        projectId: 'project-1',
        userMessage: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.usedBridge).toBe(false);
    });

    it('should handle scan file read error', async () => {
      const fs = await import('fs');
      fs.promises.readFile.mockRejectedValue(new Error('Cannot read file'));

      const result = await handlers['project:scan-files'](null, 'project-1');

      expect(result.success).toBe(true);
      // 应该跳过无法读取的文件
    });
  });

  describe('边界情况', () => {
    it('should handle empty conversation history', async () => {
      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response',
          operations: [],
          rag_sources: [],
        },
      });

      const result = await handlers['project:aiChat'](null, {
        projectId: 'project-1',
        userMessage: 'test',
        conversationHistory: [],
      });

      expect(result.success).toBe(true);
    });

    it('should handle null file list', async () => {
      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response',
          operations: [],
          rag_sources: [],
        },
      });

      const result = await handlers['project:aiChat'](null, {
        projectId: 'project-1',
        userMessage: 'test',
        fileList: null,
      });

      expect(result.success).toBe(true);
    });

    it('should handle destroyed main window in execute task plan', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      const result = await handlers['project:execute-task-plan'](
        null,
        'task-plan-1',
        { projectId: 'project-1', root_path: '/mock/path' }
      );

      expect(result.success).toBe(true);
      // 不应该发送消息到已销毁的窗口
    });

    it('should handle large content in polish', async () => {
      const largeContent = 'a'.repeat(50000);

      const result = await handlers['project:polishContent'](null, {
        content: largeContent,
      });

      expect(result.success).toBe(true);
    });

    it('should handle code with special characters', async () => {
      const codeWithSpecialChars = 'const str = "\\n\\t\\r";';

      const result = await handlers['project:code-review'](
        null,
        codeWithSpecialChars,
        'javascript'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('性能测试', () => {
    it('should handle concurrent AI chat requests', async () => {
      const axios = await import('axios');
      axios.default.post.mockResolvedValue({
        data: {
          response: 'AI response',
          operations: [],
          rag_sources: [],
        },
      });

      const promises = Array.from({ length: 5 }, (_, i) =>
        handlers['project:aiChat'](null, {
          projectId: 'project-1',
          userMessage: `Message ${i}`,
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle concurrent code operations', async () => {
      const promises = [
        handlers['project:code-generate'](null, 'Function 1', 'js'),
        handlers['project:code-review'](null, 'code 1', 'js'),
        handlers['project:code-refactor'](null, 'code 2', 'js'),
        handlers['project:code-explain'](null, 'code 3', 'js'),
        handlers['project:code-optimize'](null, 'code 4', 'js'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });
});
