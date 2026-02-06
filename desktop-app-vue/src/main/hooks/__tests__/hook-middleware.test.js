/**
 * Hook Middleware 单元测试
 *
 * 测试内容：
 * - createIPCHookMiddleware IPC中间件
 * - createToolHookMiddleware 工具中间件
 * - createSessionHookMiddleware 会话中间件
 * - createFileHookMiddleware 文件中间件
 * - createAgentHookMiddleware Agent中间件
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock hook-executor
vi.mock('../hook-executor', () => ({
  HookResult: {
    CONTINUE: 'continue',
    PREVENT: 'prevent',
    MODIFY: 'modify',
  },
}));

const {
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
  createFileHookMiddleware,
  createAgentHookMiddleware,
} = require('../hook-middleware');

// Helper to create mock hook system
function createMockHookSystem() {
  return {
    trigger: vi.fn().mockResolvedValue({
      prevented: false,
      preventReason: null,
      modifications: null,
    }),
  };
}

describe('createIPCHookMiddleware', () => {
  let hookSystem;
  let middleware;

  beforeEach(() => {
    vi.clearAllMocks();
    hookSystem = createMockHookSystem();
    middleware = createIPCHookMiddleware(hookSystem);
  });

  describe('wrap', () => {
    it('should wrap handler and call it', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler);

      const result = await wrappedHandler({}, 'arg1', 'arg2');

      expect(handler).toHaveBeenCalledWith({}, 'arg1', 'arg2');
      expect(result).toBe('result');
    });

    it('should trigger PreIPCCall hook', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler);

      await wrappedHandler({}, 'arg1');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreIPCCall',
        { channel: 'test-channel', args: ['arg1'] },
        expect.objectContaining({ channel: 'test-channel' })
      );
    });

    it('should trigger PostIPCCall hook', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler);

      await wrappedHandler({}, 'arg1');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PostIPCCall',
        expect.objectContaining({
          channel: 'test-channel',
          result: 'result',
        }),
        expect.any(Object)
      );
    });

    it('should prevent execution when PreIPCCall hook prevents', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: true,
        preventReason: 'Access denied',
      });
      const handler = vi.fn();
      const wrappedHandler = middleware.wrap('test-channel', handler);

      await expect(wrappedHandler({}, 'arg1')).rejects.toThrow('IPC call prevented');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should modify args when PreIPCCall hook modifies', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: false,
        modifications: { args: ['modified-arg'] },
      });
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler);

      await wrappedHandler({}, 'original-arg');

      expect(handler).toHaveBeenCalledWith({}, 'modified-arg');
    });

    it('should modify result when PostIPCCall hook modifies', async () => {
      hookSystem.trigger
        .mockResolvedValueOnce({ prevented: false })
        .mockResolvedValueOnce({
          modifications: { result: 'modified-result' },
        });
      const handler = vi.fn().mockResolvedValue('original-result');
      const wrappedHandler = middleware.wrap('test-channel', handler);

      const result = await wrappedHandler({});

      expect(result).toBe('modified-result');
    });

    it('should trigger IPCError hook on error', async () => {
      const error = new Error('Handler error');
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = middleware.wrap('test-channel', handler);

      await expect(wrappedHandler({})).rejects.toThrow('Handler error');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'IPCError',
        expect.objectContaining({
          channel: 'test-channel',
          error: expect.objectContaining({ message: 'Handler error' }),
        }),
        expect.any(Object)
      );
    });

    it('should skip PreHook when skipPreHook is true', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler, { skipPreHook: true });

      await wrappedHandler({});

      expect(hookSystem.trigger).not.toHaveBeenCalledWith(
        'PreIPCCall',
        expect.anything(),
        expect.anything()
      );
    });

    it('should skip PostHook when skipPostHook is true', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const wrappedHandler = middleware.wrap('test-channel', handler, { skipPostHook: true });

      await wrappedHandler({});

      expect(hookSystem.trigger).not.toHaveBeenCalledWith(
        'PostIPCCall',
        expect.anything(),
        expect.anything()
      );
    });

    it('should use contextExtractor when provided', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      const contextExtractor = vi.fn().mockReturnValue({ custom: 'data' });
      const wrappedHandler = middleware.wrap('test-channel', handler, { contextExtractor });

      await wrappedHandler({ sender: { id: 1 } }, 'arg1');

      expect(contextExtractor).toHaveBeenCalled();
      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreIPCCall',
        expect.anything(),
        expect.objectContaining({ custom: 'data' })
      );
    });
  });

  describe('wrapAll', () => {
    it('should wrap all handlers', () => {
      const handlers = {
        channel1: vi.fn(),
        channel2: vi.fn(),
      };

      const wrapped = middleware.wrapAll(handlers);

      expect(typeof wrapped.channel1).toBe('function');
      expect(typeof wrapped.channel2).toBe('function');
    });
  });

  describe('createWrappedHandle', () => {
    it('should create wrapped handle function', () => {
      const mockIpcMain = {
        handle: vi.fn(),
      };

      const wrappedHandle = middleware.createWrappedHandle(mockIpcMain);

      expect(typeof wrappedHandle).toBe('function');
    });

    it('should call ipcMain.handle with wrapped handler', () => {
      const mockIpcMain = {
        handle: vi.fn(),
      };
      const handler = vi.fn();
      const wrappedHandle = middleware.createWrappedHandle(mockIpcMain);

      wrappedHandle('test-channel', handler);

      expect(mockIpcMain.handle).toHaveBeenCalledWith('test-channel', expect.any(Function));
    });
  });
});

describe('createToolHookMiddleware', () => {
  let hookSystem;
  let middleware;

  beforeEach(() => {
    vi.clearAllMocks();
    hookSystem = createMockHookSystem();
    middleware = createToolHookMiddleware(hookSystem);
  });

  describe('wrap', () => {
    it('should wrap tool handler and call it', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = middleware.wrap('test-tool', handler);

      const result = await wrappedHandler({ param: 'value' });

      expect(handler).toHaveBeenCalledWith({ param: 'value' }, {});
      expect(result).toEqual({ success: true });
    });

    it('should trigger PreToolUse hook', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = middleware.wrap('test-tool', handler);

      await wrappedHandler({ param: 'value' });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreToolUse',
        { toolName: 'test-tool', params: { param: 'value' } },
        expect.objectContaining({ toolName: 'test-tool' })
      );
    });

    it('should trigger PostToolUse hook', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = middleware.wrap('test-tool', handler);

      await wrappedHandler({ param: 'value' });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PostToolUse',
        expect.objectContaining({
          toolName: 'test-tool',
          result: { success: true },
        }),
        expect.any(Object)
      );
    });

    it('should return prevented result when PreToolUse prevents', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: true,
        preventReason: 'Tool blocked',
      });
      const handler = vi.fn();
      const wrappedHandler = middleware.wrap('test-tool', handler);

      const result = await wrappedHandler({});

      expect(result).toEqual({
        success: false,
        error: 'Tool use prevented: Tool blocked',
        prevented: true,
        preventReason: 'Tool blocked',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should modify params when PreToolUse modifies', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: false,
        modifications: { params: { added: 'value' } },
      });
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = middleware.wrap('test-tool', handler);

      await wrappedHandler({ original: 'param' });

      expect(handler).toHaveBeenCalledWith(
        { original: 'param', added: 'value' },
        expect.any(Object)
      );
    });

    it('should modify result when PostToolUse modifies', async () => {
      hookSystem.trigger
        .mockResolvedValueOnce({ prevented: false })
        .mockResolvedValueOnce({
          modifications: { result: { modified: true } },
        });
      const handler = vi.fn().mockResolvedValue({ original: true });
      const wrappedHandler = middleware.wrap('test-tool', handler);

      const result = await wrappedHandler({});

      expect(result).toEqual({ modified: true });
    });

    it('should trigger ToolError on error', async () => {
      const error = new Error('Tool failed');
      const handler = vi.fn().mockRejectedValue(error);
      const wrappedHandler = middleware.wrap('test-tool', handler);

      await expect(wrappedHandler({})).rejects.toThrow('Tool failed');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'ToolError',
        expect.objectContaining({
          toolName: 'test-tool',
          error: expect.objectContaining({ message: 'Tool failed' }),
        }),
        expect.any(Object)
      );
    });

    it('should skip hooks when options specified', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = middleware.wrap('test-tool', handler, {
        skipPreHook: true,
        skipPostHook: true,
      });

      await wrappedHandler({});

      expect(hookSystem.trigger).not.toHaveBeenCalled();
    });
  });

  describe('wrapAll', () => {
    it('should wrap Map of tools', () => {
      const tools = new Map([
        ['tool1', { handler: vi.fn() }],
        ['tool2', { handler: vi.fn() }],
      ]);

      const wrapped = middleware.wrapAll(tools);

      expect(wrapped).toBeInstanceOf(Map);
      expect(typeof wrapped.get('tool1').handler).toBe('function');
      expect(typeof wrapped.get('tool2').handler).toBe('function');
    });

    it('should wrap Object of tools', () => {
      const tools = {
        tool1: vi.fn(),
        tool2: vi.fn(),
      };

      const wrapped = middleware.wrapAll(tools);

      expect(typeof wrapped.tool1).toBe('function');
      expect(typeof wrapped.tool2).toBe('function');
    });

    it('should preserve tool without handler in Map', () => {
      const tools = new Map([
        ['tool1', { name: 'tool1', noHandler: true }],
      ]);

      const wrapped = middleware.wrapAll(tools);

      expect(wrapped.get('tool1').noHandler).toBe(true);
    });
  });
});

describe('createSessionHookMiddleware', () => {
  let hookSystem;
  let middleware;

  beforeEach(() => {
    vi.clearAllMocks();
    hookSystem = createMockHookSystem();
    middleware = createSessionHookMiddleware(hookSystem);
  });

  describe('bindToSessionManager', () => {
    it('should handle null session manager', () => {
      // Should not throw
      middleware.bindToSessionManager(null);
    });

    it('should bind to session-created event', async () => {
      const sessionManager = {
        on: vi.fn(),
      };

      middleware.bindToSessionManager(sessionManager);

      expect(sessionManager.on).toHaveBeenCalledWith('session-created', expect.any(Function));
    });

    it('should bind to session-ended event', async () => {
      const sessionManager = {
        on: vi.fn(),
      };

      middleware.bindToSessionManager(sessionManager);

      expect(sessionManager.on).toHaveBeenCalledWith('session-ended', expect.any(Function));
    });

    it('should trigger SessionStart on session-created', async () => {
      let createdHandler;
      const sessionManager = {
        on: vi.fn((event, handler) => {
          if (event === 'session-created') createdHandler = handler;
        }),
      };

      middleware.bindToSessionManager(sessionManager);
      await createdHandler({ sessionId: 'sess123', metadata: { key: 'value' } });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'SessionStart',
        expect.objectContaining({ sessionId: 'sess123' }),
        expect.any(Object)
      );
    });

    it('should trigger SessionEnd on session-ended', async () => {
      let endedHandler;
      const sessionManager = {
        on: vi.fn((event, handler) => {
          if (event === 'session-ended') endedHandler = handler;
        }),
      };

      middleware.bindToSessionManager(sessionManager);
      await endedHandler({ sessionId: 'sess123', reason: 'user_closed' });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'SessionEnd',
        expect.objectContaining({ sessionId: 'sess123', reason: 'user_closed' }),
        expect.any(Object)
      );
    });

    it('should wrap compressContext method', async () => {
      const originalCompress = vi.fn().mockResolvedValue({ compressionRatio: 0.5 });
      const sessionManager = {
        on: vi.fn(),
        compressContext: originalCompress,
        currentSessionId: 'sess123',
        messages: [1, 2, 3],
      };

      middleware.bindToSessionManager(sessionManager);
      const result = await sessionManager.compressContext();

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreCompact',
        expect.objectContaining({ sessionId: 'sess123' }),
        expect.any(Object)
      );
      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PostCompact',
        expect.objectContaining({ compressionRatio: 0.5 }),
        expect.any(Object)
      );
    });

    it('should prevent compression when PreCompact prevents', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: true,
        preventReason: 'Not allowed',
      });
      const originalCompress = vi.fn();
      const sessionManager = {
        on: vi.fn(),
        compressContext: originalCompress,
        currentSessionId: 'sess123',
      };

      middleware.bindToSessionManager(sessionManager);
      const result = await sessionManager.compressContext();

      expect(result).toBeNull();
      expect(originalCompress).not.toHaveBeenCalled();
    });
  });
});

describe('createFileHookMiddleware', () => {
  let hookSystem;
  let middleware;

  beforeEach(() => {
    vi.clearAllMocks();
    hookSystem = createMockHookSystem();
    middleware = createFileHookMiddleware(hookSystem);
  });

  describe('wrapRead', () => {
    it('should wrap read function', async () => {
      const readFn = vi.fn().mockResolvedValue('file content');
      const wrappedRead = middleware.wrapRead(readFn);

      const result = await wrappedRead('/path/to/file.txt');

      expect(readFn).toHaveBeenCalledWith('/path/to/file.txt', {});
      expect(result).toBe('file content');
    });

    it('should trigger PreFileAccess hook', async () => {
      const readFn = vi.fn().mockResolvedValue('content');
      const wrappedRead = middleware.wrapRead(readFn);

      await wrappedRead('/path/to/file.txt');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreFileAccess',
        { filePath: '/path/to/file.txt', operation: 'read' },
        expect.any(Object)
      );
    });

    it('should trigger PostFileAccess hook', async () => {
      const readFn = vi.fn().mockResolvedValue('content');
      const wrappedRead = middleware.wrapRead(readFn);

      await wrappedRead('/path/to/file.txt');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PostFileAccess',
        expect.objectContaining({
          filePath: '/path/to/file.txt',
          operation: 'read',
          success: true,
        }),
        expect.any(Object)
      );
    });

    it('should prevent read when PreFileAccess prevents', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: true,
        preventReason: 'Access denied',
      });
      const readFn = vi.fn();
      const wrappedRead = middleware.wrapRead(readFn);

      await expect(wrappedRead('/secret/file.txt')).rejects.toThrow('File access prevented');
      expect(readFn).not.toHaveBeenCalled();
    });
  });

  describe('wrapWrite', () => {
    it('should wrap write function', async () => {
      const writeFn = vi.fn().mockResolvedValue(true);
      const wrappedWrite = middleware.wrapWrite(writeFn);

      const result = await wrappedWrite('/path/to/file.txt', 'content');

      expect(writeFn).toHaveBeenCalledWith('/path/to/file.txt', 'content', {});
      expect(result).toBe(true);
    });

    it('should trigger PreFileAccess hook with contentSize', async () => {
      const writeFn = vi.fn().mockResolvedValue(true);
      const wrappedWrite = middleware.wrapWrite(writeFn);

      await wrappedWrite('/path/to/file.txt', 'hello');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'PreFileAccess',
        expect.objectContaining({
          operation: 'write',
          contentSize: 5,
        }),
        expect.any(Object)
      );
    });

    it('should trigger FileModified hook after write', async () => {
      const writeFn = vi.fn().mockResolvedValue(true);
      const wrappedWrite = middleware.wrapWrite(writeFn);

      await wrappedWrite('/path/to/file.txt', 'content');

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'FileModified',
        expect.objectContaining({
          filePath: '/path/to/file.txt',
          operation: 'write',
        }),
        expect.any(Object)
      );
    });

    it('should prevent write when PreFileAccess prevents', async () => {
      hookSystem.trigger.mockResolvedValueOnce({
        prevented: true,
        preventReason: 'Write not allowed',
      });
      const writeFn = vi.fn();
      const wrappedWrite = middleware.wrapWrite(writeFn);

      await expect(wrappedWrite('/readonly/file.txt', 'data')).rejects.toThrow('File access prevented');
      expect(writeFn).not.toHaveBeenCalled();
    });
  });
});

describe('createAgentHookMiddleware', () => {
  let hookSystem;
  let middleware;

  beforeEach(() => {
    vi.clearAllMocks();
    hookSystem = createMockHookSystem();
    middleware = createAgentHookMiddleware(hookSystem);
  });

  describe('bindToOrchestrator', () => {
    it('should handle null orchestrator', () => {
      // Should not throw
      middleware.bindToOrchestrator(null);
    });

    it('should bind to agent-started event', () => {
      const orchestrator = { on: vi.fn() };

      middleware.bindToOrchestrator(orchestrator);

      expect(orchestrator.on).toHaveBeenCalledWith('agent-started', expect.any(Function));
    });

    it('should bind to agent-stopped event', () => {
      const orchestrator = { on: vi.fn() };

      middleware.bindToOrchestrator(orchestrator);

      expect(orchestrator.on).toHaveBeenCalledWith('agent-stopped', expect.any(Function));
    });

    it('should bind to task-assigned event', () => {
      const orchestrator = { on: vi.fn() };

      middleware.bindToOrchestrator(orchestrator);

      expect(orchestrator.on).toHaveBeenCalledWith('task-assigned', expect.any(Function));
    });

    it('should bind to task-completed event', () => {
      const orchestrator = { on: vi.fn() };

      middleware.bindToOrchestrator(orchestrator);

      expect(orchestrator.on).toHaveBeenCalledWith('task-completed', expect.any(Function));
    });

    it('should trigger AgentStart on agent-started', async () => {
      let startHandler;
      const orchestrator = {
        on: vi.fn((event, handler) => {
          if (event === 'agent-started') startHandler = handler;
        }),
      };

      middleware.bindToOrchestrator(orchestrator);
      await startHandler({ agentId: 'agent1', type: 'worker', capabilities: ['code'] });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'AgentStart',
        expect.objectContaining({
          agentId: 'agent1',
          agentType: 'worker',
        }),
        expect.any(Object)
      );
    });

    it('should trigger AgentStop on agent-stopped', async () => {
      let stopHandler;
      const orchestrator = {
        on: vi.fn((event, handler) => {
          if (event === 'agent-stopped') stopHandler = handler;
        }),
      };

      middleware.bindToOrchestrator(orchestrator);
      await stopHandler({ agentId: 'agent1', reason: 'completed', result: 'success' });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'AgentStop',
        expect.objectContaining({
          agentId: 'agent1',
          reason: 'completed',
        }),
        expect.any(Object)
      );
    });

    it('should trigger TaskAssigned on task-assigned', async () => {
      let taskHandler;
      const orchestrator = {
        on: vi.fn((event, handler) => {
          if (event === 'task-assigned') taskHandler = handler;
        }),
      };

      middleware.bindToOrchestrator(orchestrator);
      await taskHandler({
        taskId: 'task1',
        agentId: 'agent1',
        type: 'code-review',
        description: 'Review PR',
      });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'TaskAssigned',
        expect.objectContaining({
          taskId: 'task1',
          agentId: 'agent1',
        }),
        expect.any(Object)
      );
    });

    it('should trigger TaskCompleted on task-completed', async () => {
      let completedHandler;
      const orchestrator = {
        on: vi.fn((event, handler) => {
          if (event === 'task-completed') completedHandler = handler;
        }),
      };

      middleware.bindToOrchestrator(orchestrator);
      await completedHandler({
        taskId: 'task1',
        agentId: 'agent1',
        success: true,
        executionTime: 1000,
      });

      expect(hookSystem.trigger).toHaveBeenCalledWith(
        'TaskCompleted',
        expect.objectContaining({
          taskId: 'task1',
          success: true,
        }),
        expect.any(Object)
      );
    });
  });
});
