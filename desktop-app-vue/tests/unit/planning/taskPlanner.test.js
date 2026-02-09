/**
 * TaskPlanner 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskPlanner, PlanningSession, PlanningState } from '../../../src/renderer/utils/taskPlanner';

describe('PlanningState', () => {
  it('应该定义所有必要的状态', () => {
    expect(PlanningState.IDLE).toBe('idle');
    expect(PlanningState.ANALYZING).toBe('analyzing');
    expect(PlanningState.INTERVIEWING).toBe('interviewing');
    expect(PlanningState.PLANNING).toBe('planning');
    expect(PlanningState.CONFIRMING).toBe('confirming');
    expect(PlanningState.EXECUTING).toBe('executing');
    expect(PlanningState.COMPLETED).toBe('completed');
    expect(PlanningState.CANCELLED).toBe('cancelled');
  });
});

describe('PlanningSession', () => {
  let session;

  beforeEach(() => {
    session = new PlanningSession('做个新年致辞ppt', 'document');
  });

  describe('构造函数', () => {
    it('应该正确初始化会话', () => {
      expect(session.id).toMatch(/^plan_\d+$/);
      expect(session.state).toBe(PlanningState.IDLE);
      expect(session.userInput).toBe('做个新年致辞ppt');
      expect(session.projectType).toBe('document');
      expect(session.confirmed).toBe(false);
    });

    it('应该初始化空的分析结果', () => {
      expect(session.analysis.isComplete).toBe(false);
      expect(session.analysis.confidence).toBe(0);
      expect(session.analysis.missing).toEqual([]);
      expect(session.analysis.collected).toEqual({});
      expect(session.analysis.suggestions).toEqual([]);
    });

    it('应该初始化空的采访数据', () => {
      expect(session.interview.questions).toEqual([]);
      expect(session.interview.currentIndex).toBe(0);
      expect(session.interview.answers).toEqual({});
      expect(session.interview.completed).toBe(false);
    });

    it('应该初始化空的任务计划', () => {
      expect(session.plan.title).toBe('');
      expect(session.plan.summary).toBe('');
      expect(session.plan.tasks).toEqual([]);
      expect(session.plan.resources).toEqual([]);
      expect(session.plan.outputs).toEqual([]);
    });
  });

  describe('setState', () => {
    it('应该正确更新状态', () => {
      const beforeTime = session.updatedAt;

      // 等待一小段时间确保时间戳不同
      setTimeout(() => {
        session.setState(PlanningState.ANALYZING);
        expect(session.state).toBe(PlanningState.ANALYZING);
        expect(session.updatedAt).toBeGreaterThan(beforeTime);
      }, 10);
    });
  });

  describe('addCollectedInfo', () => {
    it('应该添加收集的信息', () => {
      session.addCollectedInfo('audience', '全体员工');
      expect(session.analysis.collected.audience).toBe('全体员工');
    });

    it('应该更新updatedAt时间戳', () => {
      const beforeTime = session.updatedAt;
      setTimeout(() => {
        session.addCollectedInfo('style', '正式');
        expect(session.updatedAt).toBeGreaterThan(beforeTime);
      }, 10);
    });
  });

  describe('addQuestion', () => {
    it('应该添加问题到列表', () => {
      session.addQuestion('目标受众是谁？', 'audience', true);

      expect(session.interview.questions).toHaveLength(1);
      expect(session.interview.questions[0]).toEqual({
        question: '目标受众是谁？',
        key: 'audience',
        required: true,
        answered: false,
      });
    });

    it('应该支持可选问题', () => {
      session.addQuestion('需要多少页？', 'pageCount', false);

      expect(session.interview.questions[0].required).toBe(false);
    });
  });

  describe('recordAnswer', () => {
    beforeEach(() => {
      session.addQuestion('目标受众是谁？', 'audience', true);
      session.addQuestion('风格是什么？', 'style', false);
    });

    it('应该记录答案并标记为已回答', () => {
      session.recordAnswer(0, '全体员工');

      expect(session.interview.questions[0].answered).toBe(true);
      expect(session.interview.answers.audience).toBe('全体员工');
      expect(session.analysis.collected.audience).toBe('全体员工');
    });

    it('应该处理无效的问题索引', () => {
      session.recordAnswer(999, '无效答案');

      expect(session.interview.answers).toEqual({});
    });
  });

  describe('hasMoreQuestions', () => {
    beforeEach(() => {
      session.addQuestion('问题1', 'q1', true);
      session.addQuestion('问题2', 'q2', true);
      session.addQuestion('问题3', 'q3', true);
    });

    it('当有未回答的问题时返回true', () => {
      expect(session.hasMoreQuestions()).toBe(true);
    });

    it('当所有问题已回答时返回false', () => {
      session.interview.currentIndex = 3;
      expect(session.hasMoreQuestions()).toBe(false);
    });
  });

  describe('getNextQuestion', () => {
    beforeEach(() => {
      session.addQuestion('问题1', 'q1', true);
      session.addQuestion('问题2', 'q2', true);
    });

    it('应该返回下一个问题并增加索引', () => {
      const q1 = session.getNextQuestion();
      expect(q1.question).toBe('问题1');
      expect(session.interview.currentIndex).toBe(1);

      const q2 = session.getNextQuestion();
      expect(q2.question).toBe('问题2');
      expect(session.interview.currentIndex).toBe(2);
    });

    it('当没有更多问题时返回null', () => {
      session.interview.currentIndex = 2;
      const result = session.getNextQuestion();
      expect(result).toBeNull();
    });
  });

  describe('setPlan', () => {
    it('应该更新任务计划', () => {
      const plan = {
        title: '新年致辞PPT',
        summary: '为全体员工准备的新年致辞',
        tasks: [
          { id: 1, name: '设计结构', description: '...' },
        ],
      };

      session.setPlan(plan);

      expect(session.plan.title).toBe('新年致辞PPT');
      expect(session.plan.summary).toBe('为全体员工准备的新年致辞');
      expect(session.plan.tasks).toHaveLength(1);
    });

    it('应该更新updatedAt时间戳', () => {
      const beforeTime = session.updatedAt;
      setTimeout(() => {
        session.setPlan({ title: '测试计划' });
        expect(session.updatedAt).toBeGreaterThan(beforeTime);
      }, 10);
    });
  });
});

describe('TaskPlanner', () => {
  describe('analyzeRequirements', () => {
    it('应该调用LLM分析需求完整性', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue(JSON.stringify({
          isComplete: false,
          confidence: 0.6,
          missing: ['目标受众', '风格'],
          collected: { 主题: 'PPT' },
          needsInterview: true,
          suggestedQuestions: [
            { key: 'audience', question: '目标受众是谁？', required: true },
          ],
        })),
      };

      const result = await TaskPlanner.analyzeRequirements(
        '做个ppt',
        'document',
        mockLLMService
      );

      expect(mockLLMService.chat).toHaveBeenCalled();
      expect(result.isComplete).toBe(false);
      expect(result.confidence).toBe(0.6);
      expect(result.missing).toContain('目标受众');
      expect(result.needsInterview).toBe(true);
      expect(result.suggestedQuestions).toHaveLength(1);
    });

    it('应该处理完整的需求', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue(JSON.stringify({
          isComplete: true,
          confidence: 0.95,
          missing: [],
          collected: {
            主题: '新年致辞',
            受众: '全体员工',
            风格: '正式',
          },
          needsInterview: false,
          suggestedQuestions: [],
        })),
      };

      const result = await TaskPlanner.analyzeRequirements(
        '生成一个8页的新年致辞PPT，正式风格，面向全体员工',
        'document',
        mockLLMService
      );

      expect(result.isComplete).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.needsInterview).toBe(false);
    });

    it('应该处理LLM返回非JSON格式的响应', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue('这是一段普通文本，没有JSON'),
      };

      const result = await TaskPlanner.analyzeRequirements(
        '做个ppt',
        'document',
        mockLLMService
      );

      // 应该返回默认值
      expect(result.isComplete).toBe(false);
      expect(result.needsInterview).toBe(true);
      expect(result.suggestedQuestions).toHaveLength(1);
    });

    it('应该处理LLM调用失败', async () => {
      const mockLLMService = {
        chat: vi.fn().mockRejectedValue(new Error('LLM服务不可用')),
      };

      // LLM失败时返回默认降级结果，不抛出异常
      const result = await TaskPlanner.analyzeRequirements('做个ppt', 'document', mockLLMService);
      expect(result.isComplete).toBe(false);
      expect(result.needsInterview).toBe(true);
      expect(result.suggestedQuestions.length).toBeGreaterThan(0);
    });
  });

  describe('generatePlan', () => {
    let session;

    beforeEach(() => {
      session = new PlanningSession('做个新年致辞ppt', 'document');
      session.analysis.collected = {
        主题: '新年致辞',
        受众: '全体员工',
        风格: '正式',
      };
      session.interview.answers = {
        pageCount: '8-10页',
      };
    });

    it('应该生成详细的任务计划', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue(JSON.stringify({
          title: '2026新年致辞PPT',
          summary: '为全体员工准备的新年致辞演示文稿',
          tasks: [
            {
              id: 1,
              name: '设计PPT结构',
              description: '规划PPT的整体框架',
              action: '创建标题页、目录、章节页',
              output: 'PPT基础结构（4页）',
            },
            {
              id: 2,
              name: '撰写致辞内容',
              description: '编写2025年回顾和2026年展望',
              action: '撰写正文内容',
              output: '内容页面（4-6页）',
            },
          ],
          outputs: ['2026新年致辞.pptx (8-10页)'],
          notes: ['确保数据准确性', '保持风格一致性'],
        })),
      };

      const plan = await TaskPlanner.generatePlan(session, mockLLMService);

      expect(plan.title).toBe('2026新年致辞PPT');
      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks[0].name).toBe('设计PPT结构');
      expect(plan.outputs).toContain('2026新年致辞.pptx (8-10页)');
      expect(plan.notes).toHaveLength(2);
    });

    it('应该处理LLM返回无效JSON', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue('无效的响应'),
      };

      // LLM返回无效JSON时返回默认降级计划，不抛出异常
      const plan = await TaskPlanner.generatePlan(session, mockLLMService);
      expect(plan.title).toContain('执行计划');
      expect(plan.tasks.length).toBeGreaterThan(0);
    });

    it('应该包含采访收集的信息', async () => {
      const mockLLMService = {
        chat: vi.fn().mockResolvedValue(JSON.stringify({
          title: '测试计划',
          summary: '测试摘要',
          tasks: [],
          outputs: [],
          notes: [],
        })),
      };

      await TaskPlanner.generatePlan(session, mockLLMService);

      const callArgs = mockLLMService.chat.mock.calls[0][0];
      expect(callArgs).toContain('主题: 新年致辞');
      expect(callArgs).toContain('受众: 全体员工');
      expect(callArgs).toContain('pageCount: 8-10页');
    });
  });

  describe('formatPlanAsMarkdown', () => {
    it('应该正确格式化计划为Markdown', () => {
      const plan = {
        title: '测试计划',
        summary: '这是一个测试计划的摘要',
        tasks: [
          {
            id: 1,
            name: '任务1',
            description: '第一个任务',
            action: '执行操作1',
            output: '输出1',
          },
          {
            id: 2,
            name: '任务2',
            description: '第二个任务',
            action: '执行操作2',
            output: '输出2',
          },
        ],
        outputs: ['最终输出1', '最终输出2'],
        notes: ['注意事项1', '注意事项2'],
      };

      const markdown = TaskPlanner.formatPlanAsMarkdown(plan);

      expect(markdown).toContain('# 测试计划');
      expect(markdown).toContain('这是一个测试计划的摘要');
      expect(markdown).toContain('## 📋 任务步骤');
      expect(markdown).toContain('### 1. 任务1');
      expect(markdown).toContain('**描述**: 第一个任务');
      expect(markdown).toContain('**操作**: 执行操作1');
      expect(markdown).toContain('**输出**: 输出1');
      expect(markdown).toContain('## 🎯 预期输出');
      expect(markdown).toContain('- 最终输出1');
      expect(markdown).toContain('## ⚠️ 注意事项');
      expect(markdown).toContain('- 注意事项1');
    });

    it('应该处理没有输出和注意事项的计划', () => {
      const plan = {
        title: '简单计划',
        summary: '摘要',
        tasks: [
          {
            id: 1,
            name: '任务1',
            description: '描述',
            action: '操作',
            output: '输出',
          },
        ],
        outputs: [],
        notes: [],
      };

      const markdown = TaskPlanner.formatPlanAsMarkdown(plan);

      expect(markdown).toContain('# 简单计划');
      expect(markdown).not.toContain('## 🎯 预期输出');
      expect(markdown).not.toContain('## ⚠️ 注意事项');
    });

    it('应该正确编号任务', () => {
      const plan = {
        title: '测试',
        summary: '测试',
        tasks: [
          { id: 1, name: 'A', description: '', action: '', output: '' },
          { id: 2, name: 'B', description: '', action: '', output: '' },
          { id: 3, name: 'C', description: '', action: '', output: '' },
        ],
      };

      const markdown = TaskPlanner.formatPlanAsMarkdown(plan);

      expect(markdown).toContain('### 1. A');
      expect(markdown).toContain('### 2. B');
      expect(markdown).toContain('### 3. C');
    });
  });
});
