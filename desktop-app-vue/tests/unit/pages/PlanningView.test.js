/**
 * PlanningView 组件单元测试（简化版）
 *
 * 注意：由于Ant Design Vue组件的复杂性，这里只测试核心逻辑和状态变化
 * 完整的UI交互测试请使用E2E测试（tests/e2e/task-planning.spec.js）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PlanningView from '../../../src/renderer/components/projects/PlanningView.vue';
import { PlanningState, PlanningSession } from '../../../src/renderer/utils/taskPlanner';

describe('PlanningView', () => {
  let wrapper;
  let mockSession;

  beforeEach(() => {
    mockSession = new PlanningSession('做个新年致辞ppt', 'document');
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('状态渲染', () => {
    it('应该渲染ANALYZING状态', () => {
      mockSession.setState(PlanningState.ANALYZING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.ANALYZING,
          session: mockSession,
        },
      });

      expect(wrapper.html()).toContain('analyzing');
    });

    it('应该渲染INTERVIEWING状态', () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      mockSession.addQuestion('问题1', 'q1', true);

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      expect(wrapper.html()).toContain('interviewing');
    });

    it('应该渲染PLANNING状态', () => {
      mockSession.setState(PlanningState.PLANNING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.PLANNING,
          session: mockSession,
        },
      });

      expect(wrapper.html()).toContain('planning');
    });

    it('应该渲染CONFIRMING状态', () => {
      mockSession.setState(PlanningState.CONFIRMING);
      mockSession.setPlan({
        title: '测试计划',
        summary: '测试摘要',
        tasks: [{ id: 1, name: '任务1', description: '描述', action: '操作', output: '输出' }],
        outputs: ['输出1'],
        notes: ['注意1'],
      });

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.CONFIRMING,
          session: mockSession,
        },
      });

      expect(wrapper.html()).toContain('confirming');
    });

    it('应该渲染EXECUTING状态', () => {
      mockSession.setState(PlanningState.EXECUTING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.EXECUTING,
          session: mockSession,
        },
      });

      expect(wrapper.html()).toContain('executing');
    });
  });

  describe('事件触发', () => {
    it('应该在用户提交答案时触发answer-submitted事件', async () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      mockSession.addQuestion('问题1', 'q1', true);

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      // 模拟提交答案
      await wrapper.vm.handleAnswerSubmitted({ questionIndex: 0, answer: '答案1' });

      expect(wrapper.emitted('answer-submitted')).toBeTruthy();
      expect(wrapper.emitted('answer-submitted')[0][0]).toEqual({
        questionIndex: 0,
        answer: '答案1',
      });
    });

    it('应该在用户跳过问题时触发question-skipped事件', async () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      await wrapper.vm.handleSkipQuestion(0);

      expect(wrapper.emitted('question-skipped')).toBeTruthy();
      expect(wrapper.emitted('question-skipped')[0][0]).toBe(0);
    });

    it('应该在用户确认计划时触发plan-confirmed事件', async () => {
      mockSession.setState(PlanningState.CONFIRMING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.CONFIRMING,
          session: mockSession,
        },
      });

      await wrapper.vm.handleConfirmPlan();

      expect(wrapper.emitted('plan-confirmed')).toBeTruthy();
    });

    it('应该在用户取消计划时触发plan-cancelled事件', async () => {
      mockSession.setState(PlanningState.CONFIRMING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.CONFIRMING,
          session: mockSession,
        },
      });

      await wrapper.vm.handleCancelPlan();

      expect(wrapper.emitted('plan-cancelled')).toBeTruthy();
    });

    it('应该在用户修改计划时触发plan-modify事件', async () => {
      mockSession.setState(PlanningState.CONFIRMING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.CONFIRMING,
          session: mockSession,
        },
      });

      await wrapper.vm.handleModifyPlan();

      expect(wrapper.emitted('plan-modify')).toBeTruthy();
    });
  });

  describe('computed properties', () => {
    it('应该正确计算currentQuestion', () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      mockSession.addQuestion('问题1', 'q1', true);
      mockSession.addQuestion('问题2', 'q2', false);

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      expect(wrapper.vm.currentQuestion).toEqual({
        question: '问题1',
        key: 'q1',
        required: true,
        answered: false,
      });
    });

    it('应该正确计算currentQuestionIndex', () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      mockSession.addQuestion('问题1', 'q1', true);
      mockSession.interview.currentIndex = 0;

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      expect(wrapper.vm.currentQuestionIndex).toBe(0);
    });

    it('应该正确计算totalQuestions', () => {
      mockSession.setState(PlanningState.INTERVIEWING);
      mockSession.addQuestion('问题1', 'q1', true);
      mockSession.addQuestion('问题2', 'q2', true);
      mockSession.addQuestion('问题3', 'q3', false);

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.INTERVIEWING,
          session: mockSession,
        },
      });

      expect(wrapper.vm.totalQuestions).toBe(3);
    });

    it('应该正确计算plan', () => {
      mockSession.setState(PlanningState.CONFIRMING);
      const testPlan = {
        title: '测试计划',
        summary: '测试摘要',
        tasks: [],
      };
      mockSession.setPlan(testPlan);

      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.CONFIRMING,
          session: mockSession,
        },
      });

      expect(wrapper.vm.plan.title).toBe('测试计划');
      expect(wrapper.vm.plan.summary).toBe('测试摘要');
    });
  });

  describe('setExecutionProgress方法', () => {
    it('应该能够设置执行进度', async () => {
      mockSession.setState(PlanningState.EXECUTING);
      wrapper = mount(PlanningView, {
        props: {
          state: PlanningState.EXECUTING,
          session: mockSession,
        },
      });

      wrapper.vm.setExecutionProgress('测试任务', 50);

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.executingTask).toBe('测试任务');
      expect(wrapper.vm.executionProgress).toBe(50);
    });
  });
});
