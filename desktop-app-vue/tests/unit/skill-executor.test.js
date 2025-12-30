/**
 * SkillExecutor 单元测试
 *
 * 测试技能执行器的核心功能：
 * - 技能执行（顺序、并行、智能）
 * - 工具调度
 * - 执行历史记录
 * - 工作流管理
 * - 定时任务
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ===================== MOCK SETUP =====================

// Mock node-cron
const mockCron = {
  schedule: vi.fn((schedule, callback) => ({
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  })),
  validate: vi.fn((schedule) => {
    // Basic cron validation
    return typeof schedule === 'string' && schedule.split(' ').length === 5;
  }),
};

vi.mock('node-cron', () => ({
  default: mockCron,
  schedule: mockCron.schedule,
  validate: mockCron.validate,
}));

// Import after mocks
const SkillExecutor = require('../../src/main/skill-tool-system/skill-executor');

// ===================== MOCK FACTORIES =====================

const createMockSkillManager = () => ({
  getSkillById: vi.fn().mockResolvedValue({
    id: 'skill-1',
    name: 'test_skill',
    display_name: 'Test Skill',
    enabled: true,
    config: {},
  }),
  getSkillTools: vi.fn().mockResolvedValue([
    {
      id: 'tool-1',
      name: 'file_reader',
      role: 'primary',
      priority: 10,
      required: false,
    },
    {
      id: 'tool-2',
      name: 'file_writer',
      role: 'secondary',
      priority: 5,
      required: false,
    },
  ]),
  recordExecution: vi.fn().mockResolvedValue(true),
});

const createMockToolManager = () => ({
  getToolByName: vi.fn().mockResolvedValue({
    id: 'tool-1',
    name: 'file_reader',
    enabled: true,
    parameters_schema: { type: 'object', properties: {} },
  }),
  executeTool: vi.fn().mockResolvedValue({
    success: true,
    result: { data: 'test result' },
    executionTime: 100,
  }),
});

// ===================== TESTS =====================

describe('SkillExecutor', () => {
  let executor;
  let mockSkillMgr;
  let mockToolMgr;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillMgr = createMockSkillManager();
    mockToolMgr = createMockToolManager();

    executor = new SkillExecutor(mockSkillMgr, mockToolMgr);
  });

  afterEach(() => {
    if (executor) {
      executor.removeAllListeners();
    }
  });

  describe('构造函数', () => {
    it('should create instance with managers', () => {
      expect(executor).toBeInstanceOf(SkillExecutor);
      expect(executor).toBeInstanceOf(EventEmitter);
      expect(executor.skillManager).toBe(mockSkillMgr);
      expect(executor.toolManager).toBe(mockToolMgr);
    });

    it('should initialize execution queue', () => {
      expect(executor.executionQueue).toEqual([]);
      expect(executor.isProcessing).toBe(false);
    });

    it('should initialize execution history', () => {
      expect(executor.executionHistory).toEqual([]);
    });

    it('should initialize scheduled tasks', () => {
      expect(executor.scheduledTasks).toBeInstanceOf(Map);
      expect(executor.scheduledTasks.size).toBe(0);
    });
  });

  describe('executeSkill()', () => {
    it('should execute skill successfully', async () => {
      const params = { input: 'test' };
      const result = await executor.executeSkill('skill-1', params);

      expect(result.success).toBe(true);
      expect(result.executionId).toBeTruthy();
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(mockSkillMgr.getSkillById).toHaveBeenCalledWith('skill-1');
      expect(mockSkillMgr.getSkillTools).toHaveBeenCalledWith('skill-1');
      expect(mockSkillMgr.recordExecution).toHaveBeenCalled();
    });

    it('should throw error if skill does not exist', async () => {
      mockSkillMgr.getSkillById.mockResolvedValueOnce(null);

      await expect(executor.executeSkill('nonexistent')).rejects.toThrow('技能不存在');
    });

    it('should throw error if skill is disabled', async () => {
      mockSkillMgr.getSkillById.mockResolvedValueOnce({
        id: 'skill-1',
        name: 'disabled_skill',
        enabled: false,
      });

      await expect(executor.executeSkill('skill-1')).rejects.toThrow('技能已禁用');
    });

    it('should emit execution:start event', async () => {
      const startSpy = vi.fn();
      executor.on('execution:start', startSpy);

      await executor.executeSkill('skill-1', { input: 'test' });

      expect(startSpy).toHaveBeenCalled();
      expect(startSpy.mock.calls[0][0]).toHaveProperty('executionId');
      expect(startSpy.mock.calls[0][0]).toHaveProperty('skillId', 'skill-1');
    });

    it('should emit execution:end event', async () => {
      const endSpy = vi.fn();
      executor.on('execution:end', endSpy);

      await executor.executeSkill('skill-1', { input: 'test' });

      expect(endSpy).toHaveBeenCalled();
      expect(endSpy.mock.calls[0][0]).toHaveProperty('executionId');
      expect(endSpy.mock.calls[0][0]).toHaveProperty('success');
    });

    it('should execute tools sequentially when sequential option is true', async () => {
      const params = { input: 'test' };
      const options = { sequential: true };

      const result = await executor.executeSkill('skill-1', params, options);

      expect(result.success).toBe(true);
      // Sequential execution should be called
    });

    it('should execute tools in parallel when parallel option is true', async () => {
      const params = { input: 'test' };
      const options = { parallel: true };

      const result = await executor.executeSkill('skill-1', params, options);

      expect(result.success).toBe(true);
      // Parallel execution should be called
    });

    it('should execute tools intelligently by default', async () => {
      const params = { input: 'test' };

      const result = await executor.executeSkill('skill-1', params);

      expect(result.success).toBe(true);
      // Intelligent execution should be called
    });

    it('should record execution in history', async () => {
      await executor.executeSkill('skill-1', { input: 'test' });

      expect(executor.executionHistory.length).toBe(1);
      expect(executor.executionHistory[0]).toHaveProperty('executionId');
      expect(executor.executionHistory[0]).toHaveProperty('skillId', 'skill-1');
    });
  });

  describe('executeToolsSequentially()', () => {
    it('should execute tools in sequence', async () => {
      const tools = [
        { id: 'tool-1', name: 'tool_1', required: false },
        { id: 'tool-2', name: 'tool_2', required: false },
      ];
      const params = { input: 'test' };

      // Mock toolRunner execution
      const mockToolRunner = {
        executeTool: vi.fn()
          .mockResolvedValueOnce({ success: true, result: { data: 'result1' } })
          .mockResolvedValueOnce({ success: true, result: { data: 'result2' } }),
      };
      executor.toolRunner = mockToolRunner;

      const result = await executor.executeToolsSequentially(tools, params, 'exec-1');

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('should stop on required tool failure', async () => {
      const tools = [
        { id: 'tool-1', name: 'tool_1', required: true },
        { id: 'tool-2', name: 'tool_2', required: false },
      ];
      const params = { input: 'test' };

      const mockToolRunner = {
        executeTool: vi.fn()
          .mockResolvedValueOnce({ success: false, error: 'Tool failed' }),
      };
      executor.toolRunner = mockToolRunner;

      const result = await executor.executeToolsSequentially(tools, params, 'exec-1');

      expect(result.success).toBe(false);
      expect(mockToolRunner.executeTool).toHaveBeenCalledTimes(1); // Only first tool
    });

    it('should continue on optional tool failure', async () => {
      const tools = [
        { id: 'tool-1', name: 'tool_1', required: false },
        { id: 'tool-2', name: 'tool_2', required: false },
      ];
      const params = { input: 'test' };

      const mockToolRunner = {
        executeTool: vi.fn()
          .mockResolvedValueOnce({ success: false, error: 'Tool failed' })
          .mockResolvedValueOnce({ success: true, result: { data: 'result2' } }),
      };
      executor.toolRunner = mockToolRunner;

      const result = await executor.executeToolsSequentially(tools, params, 'exec-1');

      expect(result.success).toBe(true);
      expect(mockToolRunner.executeTool).toHaveBeenCalledTimes(2); // Both tools
    });
  });

  describe('executeToolsInParallel()', () => {
    it('should execute all tools in parallel', async () => {
      const tools = [
        { id: 'tool-1', name: 'tool_1' },
        { id: 'tool-2', name: 'tool_2' },
        { id: 'tool-3', name: 'tool_3' },
      ];
      const params = { input: 'test' };

      const mockToolRunner = {
        executeTool: vi.fn().mockResolvedValue({
          success: true,
          result: { data: 'result' },
        }),
      };
      executor.toolRunner = mockToolRunner;

      const result = await executor.executeToolsInParallel(tools, params, 'exec-1');

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(mockToolRunner.executeTool).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure', async () => {
      const tools = [
        { id: 'tool-1', name: 'tool_1' },
        { id: 'tool-2', name: 'tool_2' },
      ];
      const params = { input: 'test' };

      const mockToolRunner = {
        executeTool: vi.fn()
          .mockResolvedValueOnce({ success: true, result: { data: 'result1' } })
          .mockResolvedValueOnce({ success: false, error: 'Failed' }),
      };
      executor.toolRunner = mockToolRunner;

      const result = await executor.executeToolsInParallel(tools, params, 'exec-1');

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
    });
  });

  describe('prepareToolParams()', () => {
    it('should extract params from context', () => {
      const tool = {
        parameters_schema: {
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
          },
        },
      };
      const context = {
        filePath: '/test/file.txt',
        content: 'test content',
        extra: 'ignored',
      };

      const params = executor.prepareToolParams(tool, context);

      expect(params).toEqual({
        filePath: '/test/file.txt',
        content: 'test content',
      });
    });

    it('should return empty object if no schema', () => {
      const tool = {};
      const context = { data: 'test' };

      const params = executor.prepareToolParams(tool, context);

      expect(params).toEqual({});
    });
  });

  describe('generateExecutionId()', () => {
    it('should generate unique execution ID', () => {
      const id1 = executor.generateExecutionId();
      const id2 = executor.generateExecutionId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should start with exec_ prefix', () => {
      const id = executor.generateExecutionId();

      expect(id).toMatch(/^exec_/);
    });
  });

  describe('generateWorkflowId()', () => {
    it('should generate unique workflow ID', () => {
      const id1 = executor.generateWorkflowId();
      const id2 = executor.generateWorkflowId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should start with workflow_ prefix', () => {
      const id = executor.generateWorkflowId();

      expect(id).toMatch(/^workflow_/);
    });
  });

  describe('getExecutionHistory()', () => {
    beforeEach(async () => {
      // Execute some skills to populate history
      await executor.executeSkill('skill-1', { input: 'test1' });
      await executor.executeSkill('skill-1', { input: 'test2' });
      await executor.executeSkill('skill-1', { input: 'test3' });
    });

    it('should return all execution history', () => {
      const history = executor.getExecutionHistory();

      expect(history.length).toBe(3);
      expect(history[0]).toHaveProperty('executionId');
      expect(history[0]).toHaveProperty('skillId');
    });

    it('should limit history by parameter', () => {
      const history = executor.getExecutionHistory(2);

      expect(history.length).toBe(2);
    });

    it('should return most recent executions', () => {
      const history = executor.getExecutionHistory(1);

      expect(history[0].params.input).toBe('test3'); // Most recent
    });
  });

  describe('getExecutionStats()', () => {
    beforeEach(async () => {
      // Populate with some executions
      await executor.executeSkill('skill-1', { input: 'test1' });
      await executor.executeSkill('skill-1', { input: 'test2' });
    });

    it('should return execution statistics', () => {
      const stats = executor.getExecutionStats();

      expect(stats).toHaveProperty('totalExecutions', 2);
      expect(stats).toHaveProperty('successCount');
      expect(stats).toHaveProperty('failureCount');
      expect(stats).toHaveProperty('averageExecutionTime');
    });

    it('should calculate average execution time', () => {
      const stats = executor.getExecutionStats();

      expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createWorkflow()', () => {
    it('should create workflow successfully', async () => {
      const workflowDef = {
        name: 'test_workflow',
        skills: [
          { skillId: 'skill-1', params: { input: 'test' } },
          { skillId: 'skill-2', params: { input: 'test2' } },
        ],
      };

      const workflow = await executor.createWorkflow(workflowDef);

      expect(workflow).toHaveProperty('id');
      expect(workflow).toHaveProperty('name', 'test_workflow');
      expect(workflow.skills).toHaveLength(2);
    });

    it('should generate workflow ID if not provided', async () => {
      const workflowDef = {
        name: 'test_workflow',
        skills: [],
      };

      const workflow = await executor.createWorkflow(workflowDef);

      expect(workflow.id).toMatch(/^workflow_/);
    });
  });

  describe('scheduleWorkflow()', () => {
    it('should schedule workflow with valid cron', () => {
      const workflow = {
        name: 'scheduled_task',
        schedule: '0 0 * * *', // Daily at midnight
        skillId: 'skill-1',
      };

      const task = executor.scheduleWorkflow(workflow);

      expect(task).toBeDefined();
      expect(mockCron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
      expect(executor.scheduledTasks.has('scheduled_task')).toBe(true);
    });

    it('should throw error for invalid cron expression', () => {
      const workflow = {
        name: 'invalid_task',
        schedule: 'invalid cron',
        skillId: 'skill-1',
      };

      mockCron.validate.mockReturnValueOnce(false);

      expect(() => executor.scheduleWorkflow(workflow)).toThrow('无效的Cron表达式');
    });

    it('should throw error if missing required fields', () => {
      expect(() => executor.scheduleWorkflow({})).toThrow();
    });
  });

  describe('executeBatch()', () => {
    it('should execute batch of tasks', async () => {
      const tasks = [
        { skillId: 'skill-1', params: { input: 'test1' } },
        { skillId: 'skill-1', params: { input: 'test2' } },
        { skillId: 'skill-1', params: { input: 'test3' } },
      ];

      const results = await executor.executeBatch(tasks);

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('success');
      expect(mockSkillMgr.getSkillById).toHaveBeenCalledTimes(3);
    });

    it('should handle batch with failures', async () => {
      mockSkillMgr.getSkillById
        .mockResolvedValueOnce({ id: 'skill-1', name: 'test', enabled: true })
        .mockResolvedValueOnce(null); // Fail second

      const tasks = [
        { skillId: 'skill-1', params: { input: 'test1' } },
        { skillId: 'invalid', params: { input: 'test2' } },
      ];

      const results = await executor.executeBatch(tasks);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe('analyzeToolDependencies()', () => {
    it('should analyze tool dependencies', () => {
      const tools = [
        { name: 'file_reader', dependencies: [] },
        { name: 'file_writer', dependencies: ['file_reader'] },
        { name: 'git_commit', dependencies: ['file_writer'] },
      ];

      const dependencies = executor.analyzeToolDependencies(tools);

      expect(dependencies).toBeInstanceOf(Map);
      expect(dependencies.size).toBe(3);
      expect(dependencies.get('file_reader')).toEqual([]);
      expect(dependencies.get('file_writer')).toContain('file_reader');
    });
  });

  describe('buildExecutionPlan()', () => {
    it('should build execution plan from dependencies', () => {
      const dependencies = new Map([
        ['tool_a', []],
        ['tool_b', ['tool_a']],
        ['tool_c', ['tool_a']],
        ['tool_d', ['tool_b', 'tool_c']],
      ]);

      const plan = executor.buildExecutionPlan(dependencies);

      expect(plan).toBeInstanceOf(Array);
      expect(plan.length).toBeGreaterThan(0);
      // tool_a should be in first stage
      expect(plan[0]).toContain('tool_a');
    });

    it('should handle tools with no dependencies', () => {
      const dependencies = new Map([
        ['tool_a', []],
        ['tool_b', []],
      ]);

      const plan = executor.buildExecutionPlan(dependencies);

      expect(plan.length).toBe(1);
      expect(plan[0]).toContain('tool_a');
      expect(plan[0]).toContain('tool_b');
    });
  });
});
