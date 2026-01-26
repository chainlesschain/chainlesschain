/**
 * Planning Store 单元测试
 * 测试交互式任务规划的状态管理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePlanningStore } from '@renderer/stores/planning';

// Mock ant-design-vue message
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}));

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

      // executionProgress 是对象而不是 null
      expect(store.executionProgress).toEqual({
        currentStep: 0,
        totalSteps: 0,
        status: '',
        logs: []
      });

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
        success: true,
        sessionId: 'test-session-123',
        status: 'planning',
        plan: null
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.startPlanSession('创建一个PPT', { type: 'document' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:start-session', {
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });

      // 验证返回值
      expect(result).not.toBeNull();
      expect(result.success).toBe(true);

      // 验证状态更新
      expect(store.currentSession).toEqual({
        sessionId: 'test-session-123',
        userRequest: '创建一个PPT',
        projectContext: { type: 'document' }
      });
      expect(store.sessionStatus).toBe('planning');
    });

    it('应该处理启动会话失败的情况', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to start session'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.startPlanSession('测试', {});

      // 返回 null 而不是抛出错误
      expect(result).toBeNull();
      expect(store.sessionStatus).toBe('failed');
    });

    it('应该处理IPC调用异常', async () => {
      const error = new Error('Network error');
      window.ipc.invoke.mockRejectedValue(error);

      const result = await store.startPlanSession('测试', {});

      expect(result).toBeNull();
      expect(store.sessionStatus).toBe('failed');
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
        success: true,
        status: 'executing',
        totalSteps: 4
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.respondToPlan('confirm');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'confirm' }
      });

      expect(result).not.toBeNull();
      expect(result.success).toBe(true);
      expect(store.sessionStatus).toBe('executing');

      // 验证执行进度初始化
      expect(store.executionProgress).toMatchObject({
        currentStep: 0,
        totalSteps: 4,
        status: '准备执行...'
      });
    });

    it('应该支持调整计划参数', async () => {
      const mockResponse = {
        success: true,
        status: 'awaiting_confirmation',
        plan: { updated: true }
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const adjustments = {
        quality: 'high',
        creativity: 0.8
      };

      const result = await store.respondToPlan('adjust', adjustments);

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: {
          action: 'adjust',
          quality: 'high',
          creativity: 0.8
        }
      });

      expect(result).not.toBeNull();
      expect(store.taskPlan).toEqual({ updated: true });
    });

    it('应该支持应用推荐模板', async () => {
      const mockResponse = {
        success: true,
        status: 'awaiting_confirmation',
        plan: { templateId: 'template-456' }
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.respondToPlan('use_template', { templateId: 'template-456' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: {
          action: 'use_template',
          templateId: 'template-456'
        }
      });

      expect(result).not.toBeNull();
      expect(store.taskPlan).toEqual({ templateId: 'template-456' });
    });

    it('应该支持重新生成计划', async () => {
      const mockResponse = {
        success: true,
        status: 'planning'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.respondToPlan('regenerate');

      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:respond', {
        sessionId: 'test-session-123',
        userResponse: { action: 'regenerate' }
      });

      expect(result).not.toBeNull();
      expect(store.sessionStatus).toBe('planning');
    });

    it('应该处理响应失败的情况', async () => {
      const mockResponse = {
        success: false,
        error: '处理响应失败'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.respondToPlan('confirm');

      expect(result).toBeNull();
    });

    it('应该在无会话时返回null', async () => {
      store.currentSession = null;

      const result = await store.respondToPlan('confirm');

      expect(result).toBeNull();
      expect(window.ipc.invoke).not.toHaveBeenCalled();
    });
  });

  describe('submitFeedback', () => {
    beforeEach(() => {
      store.currentSession = {
        sessionId: 'test-session-123'
      };
    });

    it('应该成功提交反馈', async () => {
      const mockResponse = {
        success: true,
        feedbackId: 'feedback-456'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const feedback = {
        rating: 5,
        issues: [],
        comment: '很好用'
      };

      const result = await store.submitFeedback(feedback);

      expect(result).toBe(true);
      expect(window.ipc.invoke).toHaveBeenCalledWith('interactive-planning:submit-feedback', {
        sessionId: 'test-session-123',
        feedback: expect.objectContaining({
          rating: 5,
          comment: '很好用'
        })
      });
    });

    it('应该处理提交反馈失败的情况', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to submit feedback'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      const result = await store.submitFeedback({ rating: 3 });

      expect(result).toBe(false);
    });

    it('应该处理IPC调用异常', async () => {
      const error = new Error('Network error');
      window.ipc.invoke.mockRejectedValue(error);

      const result = await store.submitFeedback({ rating: 3 });

      expect(result).toBe(false);
    });

    it('应该在无会话时返回false', async () => {
      store.currentSession = null;

      const result = await store.submitFeedback({ rating: 3 });

      expect(result).toBe(false);
      expect(window.ipc.invoke).not.toHaveBeenCalled();
    });
  });

  describe('openPlanDialog', () => {
    it('应该打开对话框并启动会话', async () => {
      const mockResponse = {
        success: true,
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

    it('如果启动会话失败对话框仍然打开', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to start'
      };

      window.ipc.invoke.mockResolvedValue(mockResponse);

      await store.openPlanDialog('测试', {});

      // openPlanDialog只打开对话框，不管会话是否成功
      expect(store.dialogVisible).toBe(true);
      expect(store.sessionStatus).toBe('failed');
    });
  });

  describe('closePlanDialog', () => {
    it('应该只关闭对话框不重置其他状态', () => {
      // 设置一些状态
      store.dialogVisible = true;
      store.currentSession = { sessionId: 'test' };
      store.sessionStatus = 'planning';
      store.taskPlan = { steps: [] };

      // 关闭对话框
      store.closePlanDialog();

      // 验证只有 dialogVisible 被修改
      expect(store.dialogVisible).toBe(false);
      // 其他状态保持不变
      expect(store.currentSession).toEqual({ sessionId: 'test' });
      expect(store.sessionStatus).toBe('planning');
      expect(store.taskPlan).toEqual({ steps: [] });
    });
  });

  describe('reset', () => {
    it('应该重置所有状态', () => {
      // 设置一些状态
      store.dialogVisible = true;
      store.currentSession = { sessionId: 'test' };
      store.sessionStatus = 'planning';
      store.taskPlan = { steps: [] };
      store.recommendedTemplates = [{ id: 't1' }];
      store.executionResult = { files: [] };

      // 重置
      store.reset();

      // 验证所有状态被重置
      expect(store.dialogVisible).toBe(false);
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.recommendedTemplates).toEqual([]);
      expect(store.recommendedSkills).toEqual([]);
      expect(store.recommendedTools).toEqual([]);
      expect(store.executionResult).toBeNull();
      expect(store.qualityScore).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.executionProgress).toEqual({
        currentStep: 0,
        totalSteps: 0,
        status: '',
        logs: []
      });
    });
  });

  describe('状态流转', () => {
    it('应该按正确顺序流转状态', async () => {
      // 1. 启动会话 (planning)
      window.ipc.invoke.mockResolvedValue({
        success: true,
        sessionId: 'test',
        status: 'planning'
      });

      const startResult = await store.startPlanSession('测试', {});
      expect(startResult).not.toBeNull();
      expect(store.sessionStatus).toBe('planning');

      // 2. 计划生成 (awaiting_confirmation)
      store.sessionStatus = 'awaiting_confirmation';
      store.taskPlan = { steps: [] };
      expect(store.isAwaitingConfirmation).toBe(true);

      // 3. 确认执行 (executing)
      window.ipc.invoke.mockResolvedValue({
        success: true,
        status: 'executing',
        totalSteps: 4
      });

      const confirmResult = await store.respondToPlan('confirm');
      expect(confirmResult).not.toBeNull();
      expect(store.sessionStatus).toBe('executing');

      // 4. 执行完成 (completed)
      store.sessionStatus = 'completed';
      store.executionResult = { files: [] };
      expect(store.isCompleted).toBe(true);
    });
  });
});
