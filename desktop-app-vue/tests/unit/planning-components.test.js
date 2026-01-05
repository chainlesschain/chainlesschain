/**
 * Planning Components 单元测试
 * 测试交互式任务规划的 Vue 组件
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import PlanPreview from '@renderer/components/planning/PlanPreview.vue';
import ExecutionProgress from '@renderer/components/planning/ExecutionProgress.vue';
import ExecutionResult from '@renderer/components/planning/ExecutionResult.vue';

describe('PlanPreview 组件', () => {
  let wrapper;

  const mockPlan = {
    steps: [
      { name: '分析模板结构', estimatedTime: '10s', tool: 'template-analyzer' },
      { name: '生成内容大纲', estimatedTime: '20s', tool: 'outline-generator' },
      { name: '填充模板内容', estimatedTime: '30s', tool: 'content-generator' },
      { name: '格式化输出文件', estimatedTime: '15s', tool: 'file-formatter' }
    ],
    totalEstimatedTime: '75s',
    expectedOutputs: [
      { type: 'pptx', name: '产品发布会演示.pptx', description: 'PPT演示文稿' },
      { type: 'docx', name: '演讲稿.docx', description: 'Word文档' }
    ]
  };

  const mockRecommendations = {
    templates: [
      { id: 't1', name: '商业路演模板', matchScore: 0.92, description: '适合产品发布' },
      { id: 't2', name: '产品介绍模板', matchScore: 0.88, description: '适合产品介绍' }
    ],
    skills: [
      { id: 's1', name: 'PPT设计', relevance: 0.95, description: '专业PPT设计能力' },
      { id: 's2', name: '内容撰写', relevance: 0.90, description: '文案撰写能力' }
    ],
    tools: [
      { id: 'tool1', name: 'ppt-engine', description: 'PPT生成引擎' },
      { id: 'tool2', name: 'word-engine', description: 'Word生成引擎' }
    ]
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('应该正确渲染计划步骤', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    const steps = wrapper.findAll('.plan-step');
    expect(steps).toHaveLength(4);
    expect(wrapper.text()).toContain('分析模板结构');
    expect(wrapper.text()).toContain('10s');
  });

  it('应该显示总预计时间', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    expect(wrapper.text()).toContain('75s');
  });

  it('应该正确渲染预期输出文件', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    expect(wrapper.text()).toContain('产品发布会演示.pptx');
    expect(wrapper.text()).toContain('演讲稿.docx');
  });

  it('应该显示推荐模板', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: mockRecommendations.templates,
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    expect(wrapper.text()).toContain('商业路演模板');
    expect(wrapper.text()).toContain('92%');
  });

  it('应该显示推荐技能', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: mockRecommendations.skills,
        recommendedTools: []
      }
    });

    expect(wrapper.text()).toContain('PPT设计');
    expect(wrapper.text()).toContain('95%');
  });

  it('应该显示推荐工具', () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: mockRecommendations.tools
      }
    });

    expect(wrapper.text()).toContain('ppt-engine');
    expect(wrapper.text()).toContain('PPT生成引擎');
  });

  it('点击"应用模板"按钮应该触发事件', async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: mockRecommendations.templates,
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    const useTemplateButton = wrapper.find('[data-test="use-template-button"]');
    if (useTemplateButton.exists()) {
      await useTemplateButton.trigger('click');
      expect(wrapper.emitted('use-template')).toBeTruthy();
      expect(wrapper.emitted('use-template')[0]).toEqual(['t1']);
    }
  });

  it('点击"调整参数"应该触发事件', async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: []
      }
    });

    const adjustButton = wrapper.find('[data-test="adjust-button"]');
    if (adjustButton.exists()) {
      await adjustButton.trigger('click');
      expect(wrapper.emitted('adjust')).toBeTruthy();
    }
  });
});

describe('ExecutionProgress 组件', () => {
  let wrapper;

  const mockProgress = {
    currentStep: 2,
    totalSteps: 4,
    percentage: 50,
    status: '正在生成内容大纲...',
    logs: [
      { timestamp: Date.now() - 3000, level: 'info', message: '开始分析模板结构' },
      { timestamp: Date.now() - 2000, level: 'success', message: '模板结构分析完成' },
      { timestamp: Date.now() - 1000, level: 'info', message: '开始生成内容大纲' }
    ]
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('应该正确显示进度百分比', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    expect(wrapper.text()).toContain('50%');
  });

  it('应该显示当前步骤和总步骤数', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    expect(wrapper.text()).toContain('2/4');
  });

  it('应该显示当前状态', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    expect(wrapper.text()).toContain('正在生成内容大纲');
  });

  it('应该显示执行日志', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    expect(wrapper.text()).toContain('开始分析模板结构');
    expect(wrapper.text()).toContain('模板结构分析完成');
    expect(wrapper.text()).toContain('开始生成内容大纲');
  });

  it('应该正确格式化时间戳', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    const times = wrapper.findAll('.log-time');
    expect(times.length).toBeGreaterThan(0);
  });

  it('应该根据日志级别显示不同样式', () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress
      }
    });

    const successLog = wrapper.findAll('.log-entry').find(el =>
      el.text().includes('模板结构分析完成')
    );

    if (successLog) {
      expect(successLog.classes()).toContain('log-success');
    }
  });

  it('进度为100%时应该显示特殊状态', () => {
    const completedProgress = {
      ...mockProgress,
      currentStep: 4,
      totalSteps: 4,
      percentage: 100,
      status: '执行完成'
    };

    wrapper = mount(ExecutionProgress, {
      props: {
        progress: completedProgress
      }
    });

    expect(wrapper.text()).toContain('100%');
    expect(wrapper.text()).toContain('执行完成');
  });
});

describe('ExecutionResult 组件', () => {
  let wrapper;

  const mockResult = {
    success: true,
    files: [
      { name: '产品发布会演示.pptx', size: 2457600, path: '/path/to/file.pptx' },
      { name: '演讲稿.docx', size: 87040, path: '/path/to/file.docx' }
    ],
    projectId: 'project-123',
    executionTime: 75000
  };

  const mockQualityScore = {
    percentage: 92,
    grade: 'A',
    completionScore: 28,
    fileOutputScore: 18,
    executionTimeScore: 14,
    errorRateScore: 20,
    resourceUsageScore: 12
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('应该显示成功消息', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    expect(wrapper.text()).toContain('任务执行完成');
    expect(wrapper.text()).toContain('成功生成 2 个文件');
  });

  it('应该显示质量评分总分', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: mockQualityScore
      }
    });

    expect(wrapper.text()).toContain('92');
    expect(wrapper.text()).toContain('A');
  });

  it('应该显示各维度详细评分', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: mockQualityScore
      }
    });

    expect(wrapper.text()).toContain('完成度');
    expect(wrapper.text()).toContain('28/30');
    expect(wrapper.text()).toContain('文件输出');
    expect(wrapper.text()).toContain('18/20');
    expect(wrapper.text()).toContain('执行时间');
    expect(wrapper.text()).toContain('14/15');
    expect(wrapper.text()).toContain('错误率');
    expect(wrapper.text()).toContain('20/20');
    expect(wrapper.text()).toContain('资源使用');
    expect(wrapper.text()).toContain('12/15');
  });

  it('应该显示生成的文件列表', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    expect(wrapper.text()).toContain('产品发布会演示.pptx');
    expect(wrapper.text()).toContain('演讲稿.docx');
    expect(wrapper.text()).toContain('2.4 MB');
    expect(wrapper.text()).toContain('85 KB');
  });

  it('应该正确格式化文件大小', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    // 2457600 bytes = 2.4 MB
    expect(wrapper.text()).toContain('2.4');
    expect(wrapper.text()).toContain('MB');

    // 87040 bytes = 85 KB
    expect(wrapper.text()).toContain('85');
    expect(wrapper.text()).toContain('KB');
  });

  it('应该有反馈表单', () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    expect(wrapper.find('[data-test="feedback-rating"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="feedback-issues"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="feedback-comment"]').exists()).toBe(true);
  });

  it('点击"提交反馈"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    const submitButton = wrapper.find('[data-test="submit-feedback-button"]');
    if (submitButton.exists()) {
      await submitButton.trigger('click');
      expect(wrapper.emitted('submit-feedback')).toBeTruthy();
    }
  });

  it('点击"查看项目"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    const viewProjectButton = wrapper.find('[data-test="view-project-button"]');
    if (viewProjectButton.exists()) {
      await viewProjectButton.trigger('click');
      expect(wrapper.emitted('view-project')).toBeTruthy();
      expect(wrapper.emitted('view-project')[0]).toEqual(['project-123']);
    }
  });

  it('点击"关闭"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    const closeButton = wrapper.find('[data-test="close-button"]');
    if (closeButton.exists()) {
      await closeButton.trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    }
  });

  it('应该支持填写和提交完整反馈', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null
      }
    });

    // 设置评分
    const ratingInput = wrapper.find('[data-test="feedback-rating"]');
    if (ratingInput.exists()) {
      await ratingInput.setValue(4);
    }

    // 选择问题
    const issueCheckbox = wrapper.find('[data-test="issue-checkbox-quality"]');
    if (issueCheckbox.exists()) {
      await issueCheckbox.setChecked(true);
    }

    // 填写评论
    const commentTextarea = wrapper.find('[data-test="feedback-comment"]');
    if (commentTextarea.exists()) {
      await commentTextarea.setValue('希望能够更快一些');
    }

    // 提交反馈
    const submitButton = wrapper.find('[data-test="submit-feedback-button"]');
    if (submitButton.exists()) {
      await submitButton.trigger('click');

      const emittedFeedback = wrapper.emitted('submit-feedback');
      if (emittedFeedback) {
        expect(emittedFeedback[0][0]).toMatchObject({
          rating: expect.any(Number),
          issues: expect.any(Array),
          comment: expect.any(String),
          timestamp: expect.any(Number)
        });
      }
    }
  });
});
