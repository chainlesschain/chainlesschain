/**
 * Planning Store 单元测试
 * 测试交互式任务规划的状态管理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePlanningStore } from '@renderer/stores/planning';

// Mock IPC
global.window = {
  ipc: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
};

describe('Planning Store', () => {
  let store;

  beforeEach(() => {
    // 为每个测试创建新的 Pinia 实例
    setActivePinia(createPinia());
    store = usePlanningStore();

    // 重置 mocks
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.recommendedTemplates).toEqual([]);
      expect(store.recommendedSkills).toEqual([]);
      expect(store.recommendedTools).toEqual([]);
      expect(store.executionProgress).toBeNull();
      expect(store.executionResult).toBeNull();
      expect(store.qualityScore).toBeNull();
      expect(store.dialogVisible).toBe(false);
    });
  });

  describe('计算属性', () => {
    it('isPlanning 应该正确返回规划状态', () => {
      expect(store.isPlanning).toBe(false);

      store.sessionStatus = 'planning';
      expect(store.isPlanning).toBe(true);

      store.sessionStatus = 'awaiting_confirmation';
      expect(store.isPlanning).toBe(false);
    });

    it('isAwaitingConfirmation 应该正确返回等待确认状态', () => {
      expect(store.isAwaitingConfirmation).toBe(false);

      store.sessionStatus = 'awaiting_confirmation';
      expect(store.isAwaitingConfirmation).toBe(true);

      store.sessionStatus = 'executing';
      expect(store.isAwaitingConfirmation).toBe(false);
    });

    it('isExecuting 应该正确返回执行状态', () => {
      expect(store.isExecuting).toBe(false);

      store.sessionStatus = 'executing';
      expect(store.isExecuting).toBe(true);

      store.sessionStatus = 'completed';
      expect(store.isExecuting).toBe(false);
    });

    it('isCompleted 应该正确返回完成状态', () => {
      expect(store.isCompleted).toBe(false);

      store.sessionStatus = 'completed';
      expect(store.isCompleted).toBe(true);

      store.sessionStatus = 'failed';
      expect(store.isCompleted).toBe(false);
    });

    it('isFailed 应该正确返回失败状态', () => {
      expect(store.isFailed).toBe(false);

      store.sessionStatus = 'failed';
      expect(store.isFailed).toBe(true);

      store.sessionStatus = 'completed';
      expect(store.isFailed).toBe(false);
    });
  });

  describe('startPlanSession', () => {
    it('应该成功启动规划会话', async () => {
      const mockResponse = {
        sessionId: 'test-session-123',
        status: 'planning',
        plan: null
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.startPlanSession('创建一个PPT', { type: 'document' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:start-session', {
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });

      expect(store.currentSession).toEqual({
        sessionId: 'test-session-123',
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });
      expect(store.sessionStatus).toBe('planning');
    });

    it('应该处理启动会话失败的情况', async () => {
      const error = new Error('Failed to start session');
      window.ipc.invoke.mockRejectedValue(error);

      await expect(store.startPlanSession('测试', {})).rejects.toThrow('Failed to start session');
    });
  });

  describe('respondToPlan', () => {
    beforeEach(() => {
      store.currentSession = {
        sessionId: 'test-session-123',
        userRequest: '创建PPT',
        projectContext: {}
      };
    });

    it('应该成功确认计划', async () => {
      const mockResponse = {
        status: 'executing',
        result: { message: 'Starting execution' }
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.respondToPlan('confirm');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'confirm' }
      });

      expect(store.sessionStatus).toBe('executing');
    });

    it('应该支持调整计划参数', async () => {
      const mockResponse = {
        status: 'awaiting_confirmation',
        plan: { updated: true }
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const adjustments = {
        quality: 'high',
        creativity: 0.8
      };

      await store.respondToPlan('adjust', adjustments);

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: {
          action: 'adjust',
          quality: 'high',
          creativity: 0.8
        }
      });
    });

    it('应该支持应用推荐模板', async () => {
      const mockResponse = {
        status: 'awaiting_confirmation',
        plan: { templateId: 'template-456' }
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.respondToPlan('use_template', { templateId: 'template-456' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: {
          action: 'use_template',
          templateId: 'template-456'
        }
      });
    });

    it('应该支持重新生成计划', async () => {
      const mockResponse = {
        status: 'planning'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.respondToPlan('regenerate');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'regenerate' }
      });

      expect(store.sessionStatus).toBe('planning');
    });

    it('应该支持取消计划', async () => {
      const mockResponse = {
        status: 'cancelled'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.respondToPlan('cancel');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'cancel' }
      });

      expect(store.sessionStatus).toBe('cancelled');
    });
  });

  describe('submitFeedback', () => {
    beforeEach(() => {
      store.currentSession = {
        sessionId: 'test-session-123'
      };
    });

    it('应该成功提交反馈', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true });

      const feedback = {
        rating: 5,
        issues: [],
        comment: '非常好用'
      };

      await store.submitFeedback(feedback);

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:submit-feedback', {
        sessionId: 'test-session-123',
        feedback: expect.objectContaining({
          rating: 5,
          issues: [],
          comment: '非常好用',
          timestamp: expect.any(Number)
        })
      });
    });

    it('应该处理提交反馈失败的情况', async () => {
      const error = new Error('Failed to submit feedback');
      window.ipc.invoke.mockRejectedValue(error);

      await expect(store.submitFeedback({ rating: 3 })).rejects.toThrow('Failed to submit feedback');
    });
  });

  describe('openPlanDialog', () => {
    it('应该打开对话框并启动会话', async () => {
      const mockResponse = {
        sessionId: 'test-session-456',
        status: 'planning',
        plan: null
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.openPlanDialog('创建文档', { type: 'document' });

      expect(store.dialogVisible).toBe(true);
      expect(store.currentSession).toBeTruthy();
      expect(store.sessionStatus).toBe('planning');
    });

    it('如果启动会话失败应该关闭对话框', async () => {
      const error = new Error('Failed to start');
      window.ipc.invoke.mockRejectedValue(error);

      await expect(store.openPlanDialog('测试', {})).rejects.toThrow();

      // 对话框应该被关闭
      expect(store.dialogVisible).toBe(false);
    });
  });

  describe('closePlanDialog', () => {
    it('应该关闭对话框并重置状态', () => {
      // 设置一些状态
      store.dialogVisible = true;
      store.currentSession = { sessionId: 'test' };
      store.sessionStatus = 'planning';
      store.taskPlan = { steps: [] };

      // 关闭对话框
      store.closePlanDialog();

      // 验证状态被重置
      expect(store.dialogVisible).toBe(false);
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
    });
  });

  describe('IPC 事件监听', () => {
    it('应该注册所有必要的IPC事件监听器', () => {
      // 验证事件监听器被注册
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:plan-generated', expect.any(Function));
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:execution-started', expect.any(Function));
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:progress-update', expect.any(Function));
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:execution-completed', expect.any(Function));
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:execution-failed', expect.any(Function));
      expect(window.ipc.on).toHaveBeenCalledWith('interactive-planning:quality-scored', expect.any(Function));
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的会话ID', async () => {
      store.currentSession = null;

      await expect(store.respondToPlan('confirm')).rejects.toThrow();
    });

    it('应该处理无效的用户响应动作', async () => {
      store.currentSession = { sessionId: 'test' };

      const mockResponse = { error: 'Invalid action' };
      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.respondToPlan('invalid_action');

      // 应该调用IPC但不修改状态
      expect(window.ipc.invoke).toHaveBeenCalled();
    });
  });

  describe('状态流转', () => {
    it('应该按正确顺序流转状态', async () => {
      // 1. 启动会话 (planning)
      window.ipc.invoke.mockResolvedValue({
        sessionId: 'test',
        status: 'planning'
      });
      await store.startPlanSession('测试', {});
      expect(store.sessionStatus).toBe('planning');

      // 2. 计划生成 (awaiting_confirmation)
      store.sessionStatus = 'awaiting_confirmation';
      store.taskPlan = { steps: [] };
      expect(store.isAwaitingConfirmation).toBe(true);

      // 3. 确认执行 (executing)
      window.ipc.invoke.mockResolvedValue({ status: 'executing' });
      await store.respondToPlan('confirm');
      expect(store.sessionStatus).toBe('executing');

      // 4. 执行完成 (completed)
      store.sessionStatus = 'completed';
      store.executionResult = { files: [] };
      expect(store.isCompleted).toBe(true);
    });
  });
});
