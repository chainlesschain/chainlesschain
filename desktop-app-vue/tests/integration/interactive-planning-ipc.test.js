/**
 * Interactive Planning IPC 集成测试
 * 测试主进程与渲染进程之间的交互式任务规划通信
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// vi.mock 会被提升到文件顶部，创建共享的 mock 状态
const sharedMockState = {
  handlers: new Map(),
  windows: []
};

vi.mock('electron', () => {
  return {
    ipcMain: {
      handlers: sharedMockState.handlers,
      handle: vi.fn((channel, handler) => {
        sharedMockState.handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel) => {
        sharedMockState.handlers.delete(channel);
      })
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => sharedMockState.windows),
      _mockWindows: sharedMockState.windows
    }
  };
});

describe('InteractivePlanningIPC', () => {
  let InteractivePlanningIPC;
  let ipcHandler;
  let mockPlanner;
  let mockEvent;
  let electronMock;

  beforeEach(async () => {
    // 清除之前的 handlers
    sharedMockState.handlers.clear();
    sharedMockState.windows.length = 0;

    // 获取 electron mock 模块
    electronMock = await import('electron');

    // 重置所有 mock
    vi.clearAllMocks();

    // 动态导入 (在mock之后)
    const module = await import('../../src/main/ai-engine/interactive-planning-ipc.js');
    InteractivePlanningIPC = module.default || module;

    // 创建mock planner
    mockPlanner = new EventEmitter();
    mockPlanner.startPlanSession = vi.fn();
    mockPlanner.handleUserResponse = vi.fn();
    mockPlanner.submitUserFeedback = vi.fn();
    mockPlanner.getSession = vi.fn();
    mockPlanner.cleanupExpiredSessions = vi.fn();

    // 创建mock event
    mockEvent = {
      sender: {
        send: vi.fn()
      }
    };

    // 创建IPC处理器
    ipcHandler = new InteractivePlanningIPC(mockPlanner);
  });

  afterEach(() => {
    sharedMockState.handlers.clear();
    sharedMockState.windows.length = 0;
  });

  describe('IPC处理器注册', () => {
    it('应该注册所有必需的IPC处理器', () => {
      expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
        'interactive-planning:start-session',
        expect.any(Function)
      );
      expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
        'interactive-planning:respond',
        expect.any(Function)
      );
      expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
        'interactive-planning:submit-feedback',
        expect.any(Function)
      );
      expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
        'interactive-planning:get-session',
        expect.any(Function)
      );
      expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
        'interactive-planning:cleanup',
        expect.any(Function)
      );
    });
  });

  describe('start-session 处理器', () => {
    it('应该成功启动会话', async () => {
      const mockResult = {
        sessionId: 'session-123',
        status: 'planning'
      };

      mockPlanner.startPlanSession.mockResolvedValue(mockResult);

      const handler = sharedMockState.handlers.get('interactive-planning:start-session');
      const result = await handler(mockEvent, {
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });

      expect(mockPlanner.startPlanSession).toHaveBeenCalledWith(
        '创建一个PPT',
        { type: 'document' }
      );

      expect(result).toEqual({
        success: true,
        sessionId: 'session-123',
        status: 'planning'
      });
    });

    it('应该处理启动失败的情况', async () => {
      const error = new Error('启动失败');
      mockPlanner.startPlanSession.mockRejectedValue(error);

      const handler = sharedMockState.handlers.get('interactive-planning:start-session');
      const result = await handler(mockEvent, {
        userRequest: '测试',
        projectContext: {}
      });

      expect(result).toEqual({
        success: false,
        error: '启动失败'
      });
    });
  });

  describe('respond 处理器', () => {
    it('应该成功处理用户确认', async () => {
      const mockResult = {
        status: 'executing'
      };

      mockPlanner.handleUserResponse.mockResolvedValue(mockResult);

      const handler = sharedMockState.handlers.get('interactive-planning:respond');
      const result = await handler(mockEvent, {
        sessionId: 'session-123',
        userResponse: { action: 'confirm' }
      });

      expect(mockPlanner.handleUserResponse).toHaveBeenCalledWith(
        'session-123',
        { action: 'confirm' }
      );

      expect(result).toEqual({
        success: true,
        status: 'executing'
      });
    });

    it('应该支持调整参数', async () => {
      const mockResult = {
        status: 'awaiting_confirmation',
        plan: { updated: true }
      };

      mockPlanner.handleUserResponse.mockResolvedValue(mockResult);

      const handler = sharedMockState.handlers.get('interactive-planning:respond');
      const result = await handler(mockEvent, {
        sessionId: 'session-123',
        userResponse: {
          action: 'adjust',
          quality: 'high',
          creativity: 0.8
        }
      });

      expect(mockPlanner.handleUserResponse).toHaveBeenCalledWith(
        'session-123',
        { action: 'adjust', quality: 'high', creativity: 0.8 }
      );

      expect(result.success).toBe(true);
      expect(result.plan).toEqual({ updated: true });
    });

    it('应该处理响应失败的情况', async () => {
      const error = new Error('处理响应失败');
      mockPlanner.handleUserResponse.mockRejectedValue(error);

      const handler = sharedMockState.handlers.get('interactive-planning:respond');
      const result = await handler(mockEvent, {
        sessionId: 'session-123',
        userResponse: { action: 'confirm' }
      });

      expect(result).toEqual({
        success: false,
        error: '处理响应失败'
      });
    });
  });

  describe('submit-feedback 处理器', () => {
    it('应该成功提交反馈', async () => {
      const mockResult = {
        feedbackId: 'feedback-456'
      };

      mockPlanner.submitUserFeedback.mockResolvedValue(mockResult);

      const handler = sharedMockState.handlers.get('interactive-planning:submit-feedback');
      const result = await handler(mockEvent, {
        sessionId: 'session-123',
        feedback: {
          rating: 5,
          issues: [],
          comment: '很好用'
        }
      });

      expect(mockPlanner.submitUserFeedback).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          rating: 5,
          comment: '很好用'
        })
      );

      expect(result).toEqual({
        success: true,
        feedbackId: 'feedback-456'
      });
    });

    it('应该处理提交失败的情况', async () => {
      const error = new Error('提交失败');
      mockPlanner.submitUserFeedback.mockRejectedValue(error);

      const handler = sharedMockState.handlers.get('interactive-planning:submit-feedback');
      const result = await handler(mockEvent, {
        sessionId: 'session-123',
        feedback: { rating: 3 }
      });

      expect(result).toEqual({
        success: false,
        error: '提交失败'
      });
    });
  });

  describe('get-session 处理器', () => {
    it('应该成功获取会话信息', async () => {
      const mockSession = {
        id: 'session-123',
        status: 'completed',
        userRequest: '创建PPT',
        createdAt: Date.now(),
        taskPlan: { steps: [] },
        executionResult: { files: [] },
        qualityScore: { percentage: 92 },
        userFeedback: null
      };

      mockPlanner.getSession.mockReturnValue(mockSession);

      const handler = sharedMockState.handlers.get('interactive-planning:get-session');
      const result = await handler(mockEvent, {
        sessionId: 'session-123'
      });

      expect(mockPlanner.getSession).toHaveBeenCalledWith('session-123');

      expect(result).toEqual({
        success: true,
        session: mockSession
      });
    });

    it('应该处理会话不存在的情况', async () => {
      mockPlanner.getSession.mockReturnValue(null);

      const handler = sharedMockState.handlers.get('interactive-planning:get-session');
      const result = await handler(mockEvent, {
        sessionId: 'non-existent'
      });

      expect(result).toEqual({
        success: false,
        error: '会话不存在'
      });
    });

    it('应该处理获取失败的情况', async () => {
      const error = new Error('获取失败');
      mockPlanner.getSession.mockImplementation(() => {
        throw error;
      });

      const handler = sharedMockState.handlers.get('interactive-planning:get-session');
      const result = await handler(mockEvent, {
        sessionId: 'session-123'
      });

      expect(result).toEqual({
        success: false,
        error: '获取失败'
      });
    });
  });

  describe('cleanup 处理器', () => {
    it('应该成功清理过期会话', async () => {
      mockPlanner.cleanupExpiredSessions.mockReturnValue(5);

      const handler = sharedMockState.handlers.get('interactive-planning:cleanup');
      const result = await handler(mockEvent, {
        maxAge: 3600000 // 1小时
      });

      expect(mockPlanner.cleanupExpiredSessions).toHaveBeenCalledWith(3600000);

      expect(result).toEqual({
        success: true,
        cleanedCount: 5
      });
    });

    it('应该处理清理失败的情况', async () => {
      const error = new Error('清理失败');
      mockPlanner.cleanupExpiredSessions.mockImplementation(() => {
        throw error;
      });

      const handler = sharedMockState.handlers.get('interactive-planning:cleanup');
      const result = await handler(mockEvent, {
        maxAge: 3600000
      });

      expect(result).toEqual({
        success: false,
        error: '清理失败'
      });
    });
  });

  describe('事件转发', () => {
    let mockWindow;

    beforeEach(() => {
      mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          send: vi.fn()
        }
      };

      // 使用 sharedMockState.windows 数组设置窗口
      sharedMockState.windows.length = 0;
      sharedMockState.windows.push(mockWindow);
    });

    it('应该转发plan-generated事件', () => {
      const eventData = {
        sessionId: 'session-123',
        plan: { steps: [] }
      };

      mockPlanner.emit('plan-generated', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:plan-generated',
        eventData
      );
    });

    it('应该转发execution-started事件', () => {
      const eventData = {
        sessionId: 'session-123'
      };

      mockPlanner.emit('execution-started', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-started',
        eventData
      );
    });

    it('应该转发execution-progress事件', () => {
      const eventData = {
        sessionId: 'session-123',
        progress: { currentStep: 2, totalSteps: 4 }
      };

      mockPlanner.emit('execution-progress', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-progress',
        eventData
      );
    });

    it('应该转发execution-completed事件', () => {
      const eventData = {
        sessionId: 'session-123',
        result: { files: [] }
      };

      mockPlanner.emit('execution-completed', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-completed',
        eventData
      );
    });

    it('应该转发execution-failed事件', () => {
      const eventData = {
        sessionId: 'session-123',
        error: 'Execution failed'
      };

      mockPlanner.emit('execution-failed', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-failed',
        eventData
      );
    });

    it('应该转发feedback-submitted事件', () => {
      const eventData = {
        sessionId: 'session-123',
        feedback: { rating: 5 }
      };

      mockPlanner.emit('feedback-submitted', eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:feedback-submitted',
        eventData
      );
    });

    it('应该跳过已销毁的窗口', () => {
      const destroyedWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: {
          send: vi.fn()
        }
      };

      const activeWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: {
          send: vi.fn()
        }
      };

      // 更新 sharedMockState.windows 数组
      sharedMockState.windows.length = 0;
      sharedMockState.windows.push(destroyedWindow, activeWindow);

      const eventData = { sessionId: 'session-123' };
      mockPlanner.emit('plan-generated', eventData);

      expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
      expect(activeWindow.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:plan-generated',
        eventData
      );
    });

    it('应该广播到所有活动窗口', () => {
      const window1 = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() }
      };

      const window2 = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: vi.fn() }
      };

      // 更新 sharedMockState.windows 数组
      sharedMockState.windows.length = 0;
      sharedMockState.windows.push(window1, window2);

      const eventData = { sessionId: 'session-123' };
      mockPlanner.emit('execution-started', eventData);

      expect(window1.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-started',
        eventData
      );

      expect(window2.webContents.send).toHaveBeenCalledWith(
        'interactive-planning:execution-started',
        eventData
      );
    });
  });
});
