/**
 * TaskPlanner 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
const mockLLMService = {
  complete: vi.fn()
};

const mockRAGManager = {
  initialize: vi.fn(),
  enhancedQuery: vi.fn()
};

vi.mock('../../src/main/llm/llm-manager', () => ({
  getLLMService: vi.fn(() => mockLLMService)
}));

vi.mock('../../src/main/project/project-rag', () => ({
  getProjectRAGManager: vi.fn(() => mockRAGManager)
}));

describe('TaskPlanner', () => {
  let TaskPlanner;
  let getTaskPlanner;
  let taskPlanner;

  beforeEach(async () => {
    // 清除模块缓存
    vi.resetModules();
    vi.clearAllMocks();

    // 重新导入模块
    const TaskPlannerModule = await import('../../src/main/ai-engine/task-planner.js');
    TaskPlanner = TaskPlannerModule.TaskPlanner;
    getTaskPlanner = TaskPlannerModule.getTaskPlanner;

    taskPlanner = new TaskPlanner();

    // 重置 mock 状态
    mockRAGManager.initialize.mockResolvedValue(undefined);
    mockRAGManager.enhancedQuery.mockResolvedValue({
      context: []
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default values', () => {
      const planner = new TaskPlanner();

      expect(planner.llmService).toBeNull();
      expect(planner.ragManager).toBeNull();
      expect(planner.initialized).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize services successfully', async () => {
      await taskPlanner.initialize();

      expect(taskPlanner.initialized).toBe(true);
      expect(taskPlanner.llmService).toBe(mockLLMService);
      expect(taskPlanner.ragManager).toBe(mockRAGManager);
      expect(mockRAGManager.initialize).toHaveBeenCalledTimes(1);
    });

    it('should not initialize twice', async () => {
      await taskPlanner.initialize();
      await taskPlanner.initialize();

      expect(mockRAGManager.initialize).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization errors gracefully', async () => {
      mockRAGManager.initialize.mockRejectedValueOnce(new Error('Init failed'));

      await taskPlanner.initialize();

      // 应该不会抛出错误，只是记录警告
      expect(taskPlanner.initialized).toBe(true);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return system prompt with tool engines', () => {
      const prompt = taskPlanner.getSystemPrompt();

      expect(prompt).toContain('ChainlessChain');
      expect(prompt).toContain('web-engine');
      expect(prompt).toContain('document-engine');
      expect(prompt).toContain('data-engine');
      expect(prompt).toContain('ppt-engine');
      expect(prompt).toContain('code-engine');
      expect(prompt).toContain('image-engine');
      expect(prompt).toContain('video-engine');
    });

    it('should include JSON format requirements', () => {
      const prompt = taskPlanner.getSystemPrompt();

      expect(prompt).toContain('JSON');
      expect(prompt).toContain('task_title');
      expect(prompt).toContain('subtasks');
      expect(prompt).toContain('estimated_duration');
    });
  });

  describe('buildDecompositionPrompt', () => {
    it('should build prompt with user request', () => {
      const userRequest = '创建一个网页';
      const projectContext = { type: 'web' };

      const prompt = taskPlanner.buildDecompositionPrompt(userRequest, projectContext, '');

      expect(prompt).toContain(userRequest);
      expect(prompt).toContain('用户需求');
    });

    it('should include project information', () => {
      const userRequest = '测试';
      const projectContext = {
        type: 'web',
        description: '测试项目',
        existingFiles: ['index.html', 'style.css']
      };

      const prompt = taskPlanner.buildDecompositionPrompt(userRequest, projectContext, '');

      expect(prompt).toContain('web');
      expect(prompt).toContain('测试项目');
      expect(prompt).toContain('index.html');
      expect(prompt).toContain('style.css');
    });

    it('should handle many existing files', () => {
      const userRequest = '测试';
      const projectContext = {
        type: 'web',
        existingFiles: Array.from({ length: 20 }, (_, i) => `file${i}.js`)
      };

      const prompt = taskPlanner.buildDecompositionPrompt(userRequest, projectContext, '');

      expect(prompt).toContain('共20个文件');
    });

    it('should include enhanced context', () => {
      const userRequest = '测试';
      const projectContext = { type: 'web' };
      const enhancedContext = '\n\n## 相关知识:\n1. 文档1';

      const prompt = taskPlanner.buildDecompositionPrompt(userRequest, projectContext, enhancedContext);

      expect(prompt).toContain('相关知识');
      expect(prompt).toContain('文档1');
    });
  });

  describe('decomposeTask', () => {
    const mockValidResponse = JSON.stringify({
      task_title: '创建网页',
      task_type: 'web',
      estimated_duration: 30,
      subtasks: [
        {
          step: 1,
          title: '创建HTML结构',
          description: '创建基本的HTML页面结构',
          tool: 'web-engine',
          estimated_tokens: 1000,
          dependencies: [],
          output_files: ['index.html']
        }
      ],
      final_deliverables: ['index.html']
    });

    beforeEach(() => {
      mockLLMService.complete.mockResolvedValue(mockValidResponse);
      mockRAGManager.enhancedQuery.mockResolvedValue({
        context: []
      });
    });

    it('should decompose task successfully', async () => {
      const userRequest = '创建一个简单的网页';
      const projectContext = {
        projectId: 'test-123',
        projectName: '测试项目',
        type: 'web'
      };

      const result = await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(result.task_title).toBe('创建网页');
      expect(result.task_type).toBe('web');
      expect(result.subtasks).toHaveLength(1);
      expect(result.id).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.project_id).toBe('test-123');
    });

    it('should call RAG for enhanced context', async () => {
      const userRequest = '创建网页';
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      mockRAGManager.enhancedQuery.mockResolvedValue({
        context: [
          {
            content: '相关文档内容',
            metadata: { fileName: 'doc1.md' }
          }
        ]
      });

      await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(mockRAGManager.enhancedQuery).toHaveBeenCalledWith(
        'test-123',
        userRequest,
        {
          projectLimit: 3,
          knowledgeLimit: 2,
          conversationLimit: 2
        }
      );
    });

    it('should handle RAG errors gracefully', async () => {
      const userRequest = '创建网页';
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      mockRAGManager.enhancedQuery.mockRejectedValueOnce(new Error('RAG failed'));

      const result = await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(result).toBeDefined();
      expect(result.task_title).toBe('创建网页');
    });

    it('should parse JSON from markdown code block', async () => {
      const markdownResponse = '```json\n' + mockValidResponse + '\n```';
      mockLLMService.complete.mockResolvedValue(markdownResponse);

      const userRequest = '创建网页';
      const projectContext = { projectId: 'test-123', type: 'web' };

      const result = await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(result.task_title).toBe('创建网页');
    });

    it('should fallback to quickDecompose on JSON parse error', async () => {
      mockLLMService.complete.mockResolvedValue('Invalid JSON response');

      const userRequest = '创建网页';
      const projectContext = {
        projectId: 'test-123',
        projectName: '测试项目',
        type: 'web'
      };

      const result = await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(result).toBeDefined();
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].title).toBe(userRequest);
    });

    it('should fallback to quickDecompose on LLM error', async () => {
      mockLLMService.complete.mockRejectedValueOnce(new Error('LLM failed'));

      const userRequest = '创建网页';
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      const result = await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(result).toBeDefined();
      expect(result.subtasks).toHaveLength(1);
    });

    it('should call LLM with correct parameters', async () => {
      const userRequest = '创建网页';
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      await taskPlanner.decomposeTask(userRequest, projectContext);

      expect(mockLLMService.complete).toHaveBeenCalledWith({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' })
        ]),
        temperature: 0.3,
        max_tokens: 2000
      });
    });
  });

  describe('validateAndEnhancePlan', () => {
    it('should add required fields to task plan', () => {
      const taskPlan = {
        task_title: '测试任务',
        task_type: 'web',
        subtasks: [
          {
            step: 1,
            title: '子任务1',
            tool: 'web-engine'
          }
        ]
      };

      const projectContext = {
        projectId: 'test-123',
        projectName: '测试项目'
      };

      const result = taskPlanner.validateAndEnhancePlan(taskPlan, projectContext);

      expect(result.id).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.progress_percentage).toBe(0);
      expect(result.current_step).toBe(0);
      expect(result.total_steps).toBe(1);
      expect(result.created_at).toBeDefined();
      expect(result.project_id).toBe('test-123');
      expect(result.project_name).toBe('测试项目');
    });

    it('should enhance subtasks with IDs and status', () => {
      const taskPlan = {
        task_title: '测试任务',
        task_type: 'web',
        subtasks: [
          { step: 1, title: '子任务1', tool: 'web-engine' },
          { step: 2, title: '子任务2', tool: 'code-engine' }
        ]
      };

      const projectContext = { projectId: 'test-123' };

      const result = taskPlanner.validateAndEnhancePlan(taskPlan, projectContext);

      expect(result.subtasks[0].id).toBeDefined();
      expect(result.subtasks[0].status).toBe('pending');
      expect(result.subtasks[0].step).toBe(1);
      expect(result.subtasks[1].step).toBe(2);
    });

    it('should add default task_title if missing', () => {
      const taskPlan = {
        subtasks: [{ step: 1, title: '子任务' }]
      };

      const projectContext = { projectId: 'test-123' };

      const result = taskPlanner.validateAndEnhancePlan(taskPlan, projectContext);

      expect(result.task_title).toBe('未命名任务');
    });

    it('should add default task_type if missing', () => {
      const taskPlan = {
        task_title: '测试',
        subtasks: [{ step: 1, title: '子任务' }]
      };

      const projectContext = { projectId: 'test-123' };

      const result = taskPlanner.validateAndEnhancePlan(taskPlan, projectContext);

      expect(result.task_type).toBe('mixed');
    });

    it('should throw error if no subtasks', () => {
      const taskPlan = {
        task_title: '测试',
        task_type: 'web',
        subtasks: []
      };

      const projectContext = { projectId: 'test-123' };

      expect(() => {
        taskPlanner.validateAndEnhancePlan(taskPlan, projectContext);
      }).toThrow('任务计划必须包含至少一个子任务');
    });
  });

  describe('recommendTool', () => {
    it('should recommend web-engine for web tasks', () => {
      expect(taskPlanner.recommendTool('创建一个网页')).toBe('web-engine');
      expect(taskPlanner.recommendTool('制作HTML页面')).toBe('web-engine');
      expect(taskPlanner.recommendTool('build a website')).toBe('web-engine');
    });

    it('should recommend ppt-engine for presentation tasks', () => {
      expect(taskPlanner.recommendTool('制作PPT')).toBe('ppt-engine');
      expect(taskPlanner.recommendTool('创建演示文稿')).toBe('ppt-engine');
      expect(taskPlanner.recommendTool('做一个幻灯片')).toBe('ppt-engine');
    });

    it('should recommend data-engine for data tasks', () => {
      expect(taskPlanner.recommendTool('创建Excel表格')).toBe('data-engine');
      expect(taskPlanner.recommendTool('数据分析')).toBe('data-engine');
      expect(taskPlanner.recommendTool('生成图表')).toBe('data-engine');
    });

    it('should recommend document-engine for document tasks', () => {
      expect(taskPlanner.recommendTool('写一篇Word文档')).toBe('document-engine');
      expect(taskPlanner.recommendTool('生成PDF报告')).toBe('document-engine');
    });

    it('should recommend code-engine for coding tasks', () => {
      expect(taskPlanner.recommendTool('写一个函数')).toBe('code-engine');
      expect(taskPlanner.recommendTool('创建一个程序')).toBe('code-engine');
      expect(taskPlanner.recommendTool('create a class')).toBe('code-engine');
    });

    it('should recommend image-engine for image tasks', () => {
      expect(taskPlanner.recommendTool('设计logo')).toBe('image-engine');
      expect(taskPlanner.recommendTool('处理图片')).toBe('image-engine');
      expect(taskPlanner.recommendTool('创建图像')).toBe('image-engine');
    });

    it('should recommend video-engine for video tasks', () => {
      expect(taskPlanner.recommendTool('编辑视频')).toBe('video-engine');
      expect(taskPlanner.recommendTool('create a video')).toBe('video-engine');
    });

    it('should default to code-engine for unknown tasks', () => {
      expect(taskPlanner.recommendTool('做点什么')).toBe('code-engine');
      expect(taskPlanner.recommendTool('unknown task')).toBe('code-engine');
    });

    it('should be case insensitive', () => {
      expect(taskPlanner.recommendTool('创建PPT')).toBe('ppt-engine');
      expect(taskPlanner.recommendTool('创建ppt')).toBe('ppt-engine');
      expect(taskPlanner.recommendTool('CREATE PPT')).toBe('ppt-engine');
    });
  });

  describe('assessComplexity', () => {
    it('should assess simple tasks', () => {
      const result = taskPlanner.assessComplexity('简单任务');

      expect(result.complexity).toBe('simple');
      expect(result.estimatedTokens).toBe(1000);
      expect(result.estimatedDuration).toBe(20);
    });

    it('should assess medium complexity tasks', () => {
      const longTask = 'a'.repeat(150);
      const result = taskPlanner.assessComplexity(longTask);

      expect(result.complexity).toBe('medium');
      expect(result.estimatedTokens).toBe(2000);
      expect(result.estimatedDuration).toBe(40);
    });

    it('should assess complex tasks', () => {
      const veryLongTask = 'a'.repeat(250);
      const result = taskPlanner.assessComplexity(veryLongTask);

      expect(result.complexity).toBe('complex');
      expect(result.estimatedTokens).toBe(4000);
      expect(result.estimatedDuration).toBe(80);
    });

    it('should calculate duration based on tokens', () => {
      const result = taskPlanner.assessComplexity('test');

      expect(result.estimatedDuration).toBe(Math.ceil(result.estimatedTokens / 50));
    });
  });

  describe('quickDecompose', () => {
    it('should create simple task plan', () => {
      const userRequest = '创建一个网页';
      const projectContext = {
        projectId: 'test-123',
        projectName: '测试项目',
        type: 'web'
      };

      const result = taskPlanner.quickDecompose(userRequest, projectContext);

      expect(result.id).toBeDefined();
      expect(result.task_title).toContain('创建一个网页');
      expect(result.status).toBe('pending');
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].title).toBe(userRequest);
      expect(result.project_id).toBe('test-123');
    });

    it('should truncate long task titles', () => {
      const longRequest = 'a'.repeat(100);
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      const result = taskPlanner.quickDecompose(longRequest, projectContext);

      expect(result.task_title.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(result.task_title).toContain('...');
    });

    it('should use recommended tool', () => {
      const userRequest = '创建Excel表格';
      const projectContext = {
        projectId: 'test-123',
        type: 'data'
      };

      const result = taskPlanner.quickDecompose(userRequest, projectContext);

      expect(result.subtasks[0].tool).toBe('data-engine');
      expect(result.task_type).toBe('data');
    });

    it('should include complexity assessment', () => {
      const userRequest = 'a'.repeat(150);
      const projectContext = {
        projectId: 'test-123',
        type: 'web'
      };

      const result = taskPlanner.quickDecompose(userRequest, projectContext);

      expect(result.estimated_duration).toBe(40); // medium complexity
      expect(result.subtasks[0].estimated_tokens).toBe(2000);
    });
  });

  describe('getTaskTypeFromTool', () => {
    it('should map tools to task types correctly', () => {
      expect(taskPlanner.getTaskTypeFromTool('web-engine')).toBe('web');
      expect(taskPlanner.getTaskTypeFromTool('document-engine')).toBe('document');
      expect(taskPlanner.getTaskTypeFromTool('data-engine')).toBe('data');
      expect(taskPlanner.getTaskTypeFromTool('ppt-engine')).toBe('ppt');
      expect(taskPlanner.getTaskTypeFromTool('code-engine')).toBe('code');
      expect(taskPlanner.getTaskTypeFromTool('image-engine')).toBe('image');
      expect(taskPlanner.getTaskTypeFromTool('video-engine')).toBe('video');
    });

    it('should default to mixed for unknown tools', () => {
      expect(taskPlanner.getTaskTypeFromTool('unknown-engine')).toBe('mixed');
      expect(taskPlanner.getTaskTypeFromTool('')).toBe('mixed');
    });
  });

  describe('getTaskPlanner singleton', () => {
    it('should return same instance', () => {
      const instance1 = getTaskPlanner();
      const instance2 = getTaskPlanner();

      expect(instance1).toBe(instance2);
    });

    it('should return TaskPlanner instance', () => {
      const instance = getTaskPlanner();

      expect(instance).toBeInstanceOf(TaskPlanner);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty user request', async () => {
      mockLLMService.complete.mockResolvedValue(JSON.stringify({
        task_title: '未命名任务',
        task_type: 'mixed',
        subtasks: [{ step: 1, title: '默认任务', tool: 'code-engine' }]
      }));

      const result = await taskPlanner.decomposeTask('', {
        projectId: 'test-123'
      });

      expect(result).toBeDefined();
      expect(result.subtasks.length).toBeGreaterThan(0);
    });

    it('should handle very long user request', async () => {
      const longRequest = 'a'.repeat(10000);

      mockLLMService.complete.mockResolvedValue(JSON.stringify({
        task_title: '长任务',
        task_type: 'mixed',
        subtasks: [{ step: 1, title: '处理长文本', tool: 'code-engine' }]
      }));

      const result = await taskPlanner.decomposeTask(longRequest, {
        projectId: 'test-123'
      });

      expect(result).toBeDefined();
    });

    it('should handle special characters in task description', async () => {
      const specialRequest = '创建<script>alert("test")</script>页面';

      mockLLMService.complete.mockResolvedValue(JSON.stringify({
        task_title: '特殊任务',
        task_type: 'web',
        subtasks: [{ step: 1, title: '处理特殊字符', tool: 'web-engine' }]
      }));

      const result = await taskPlanner.decomposeTask(specialRequest, {
        projectId: 'test-123'
      });

      expect(result).toBeDefined();
    });

    it('should handle missing projectContext fields', async () => {
      mockLLMService.complete.mockResolvedValue(JSON.stringify({
        task_title: '任务',
        task_type: 'mixed',
        subtasks: [{ step: 1, title: '子任务', tool: 'code-engine' }]
      }));

      const result = await taskPlanner.decomposeTask('测试', {});

      expect(result).toBeDefined();
      expect(result.project_id).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should handle multiple simultaneous decompositions', async () => {
      mockLLMService.complete.mockResolvedValue(JSON.stringify({
        task_title: '任务',
        task_type: 'mixed',
        subtasks: [{ step: 1, title: '子任务', tool: 'code-engine' }]
      }));

      const promises = Array.from({ length: 10 }, (_, i) =>
        taskPlanner.decomposeTask(`任务${i}`, {
          projectId: `test-${i}`
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result).toBeDefined();
        expect(result.project_id).toBe(`test-${i}`);
      });
    });
  });
});
