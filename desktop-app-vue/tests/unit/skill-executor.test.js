/**
 * SkillExecutor 单元测试 (简化版)
 *
 * 专注于核心功能测试，避免过度依赖内部实现细节
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===================== MOCK SETUP =====================

// Mock node-cron
const mockCron = {
  schedule: vi.fn((schedule, callback) => ({
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  })),
  validate: vi.fn((schedule) => {
    return typeof schedule === 'string' && schedule.split(' ').length >= 5;
  }),
};

vi.mock('node-cron', () => ({
  default: mockCron,
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
    },
  ]),
  recordExecution: vi.fn().mockResolvedValue(true),
});

const createMockToolManager = () => ({
  getToolByName: vi.fn().mockResolvedValue({
    id: 'tool-1',
    name: 'file_reader',
    enabled: true,
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
    if (executor && executor.removeAllListeners) {
      executor.removeAllListeners();
    }
  });

  describe('构造函数', () => {
    it('should create instance with managers', () => {
      expect(executor).toBeInstanceOf(SkillExecutor);
      expect(executor.skillManager).toBe(mockSkillMgr);
      expect(executor.toolManager).toBe(mockToolMgr);
    });

    it('should initialize execution queue', () => {
      expect(executor.executionQueue).toBeDefined();
      expect(Array.isArray(executor.executionQueue)).toBe(true);
    });

    it('should initialize execution history', () => {
      expect(executor.executionHistory).toBeDefined();
      expect(Array.isArray(executor.executionHistory)).toBe(true);
    });

    it('should initialize scheduled tasks', () => {
      expect(executor.scheduledTasks).toBeDefined();
      expect(executor.scheduledTasks instanceof Map).toBe(true);
    });
  });

  describe('executeSkill()', () => {
    it('should execute skill successfully', async () => {
      const params = { input: 'test' };
      const result = await executor.executeSkill('skill-1', params);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.executionId).toBeTruthy();
      expect(mockSkillMgr.getSkillById).toHaveBeenCalledWith('skill-1');
      expect(mockSkillMgr.recordExecution).toHaveBeenCalled();
    });

    it('should handle non-existent skill', async () => {
      mockSkillMgr.getSkillById.mockResolvedValueOnce(null);

      const result = await executor.executeSkill('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle disabled skill', async () => {
      mockSkillMgr.getSkillById.mockResolvedValueOnce({
        id: 'skill-1',
        name: 'disabled_skill',
        enabled: false,
      });

      const result = await executor.executeSkill('skill-1');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should emit execution:start event', (done) => {
      executor.on('execution:start', (data) => {
        expect(data).toHaveProperty('executionId');
        expect(data).toHaveProperty('skillId', 'skill-1');
        done();
      });

      executor.executeSkill('skill-1', { input: 'test' });
    });

    it('should record execution in history', async () => {
      const initialLength = executor.executionHistory.length;
      await executor.executeSkill('skill-1', { input: 'test' });

      expect(executor.executionHistory.length).toBe(initialLength + 1);
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
      await executor.executeSkill('skill-1', { input: 'test1' });
      await executor.executeSkill('skill-1', { input: 'test2' });
      await executor.executeSkill('skill-1', { input: 'test3' });
    });

    it('should return execution history', () => {
      const history = executor.getExecutionHistory();

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(3);
    });

    it('should limit history by parameter', () => {
      const history = executor.getExecutionHistory(2);

      expect(history.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getExecutionStats()', () => {
    beforeEach(async () => {
      await executor.executeSkill('skill-1', { input: 'test1' });
      await executor.executeSkill('skill-1', { input: 'test2' });
    });

    it('should return execution statistics', () => {
      const stats = executor.getExecutionStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalExecutions');
      expect(stats.totalExecutions).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createWorkflow()', () => {
    it('should create workflow successfully', async () => {
      const workflowDef = {
        name: 'test_workflow',
        skills: [
          { skillId: 'skill-1', params: { input: 'test' } },
        ],
      };

      const workflow = await executor.createWorkflow(workflowDef);

      expect(workflow).toHaveProperty('id');
      expect(workflow).toHaveProperty('name', 'test_workflow');
    });
  });

  describe('scheduleWorkflow()', () => {
    it('should schedule workflow with valid cron', () => {
      const workflow = {
        name: 'scheduled_task',
        schedule: '0 0 * * *',
        skillId: 'skill-1',
      };

      const result = executor.scheduleWorkflow(workflow);

      expect(result).toBeDefined();
      expect(executor.scheduledTasks.has('scheduled_task')).toBe(true);
    });

    it('should reject invalid cron expression', () => {
      const workflow = {
        name: 'invalid_task',
        schedule: 'invalid',
        skillId: 'skill-1',
      };

      mockCron.validate.mockReturnValueOnce(false);

      expect(() => executor.scheduleWorkflow(workflow)).toThrow();
    });
  });

  describe('prepareToolParams()', () => {
    it('should extract params from context', () => {
      const tool = {
        parameters_schema: {
          properties: {
            filePath: { type: 'string' },
          },
        },
      };
      const context = {
        filePath: '/test/file.txt',
        extra: 'ignored',
      };

      const params = executor.prepareToolParams(tool, context);

      expect(params).toHaveProperty('filePath', '/test/file.txt');
    });

    it('should handle missing schema', () => {
      const tool = {};
      const context = { data: 'test' };

      const params = executor.prepareToolParams(tool, context);

      expect(params).toBeDefined();
    });
  });

  describe('analyzeToolDependencies()', () => {
    it('should analyze tool dependencies', () => {
      const tools = [
        { name: 'file_reader' },
        { name: 'file_writer' },
      ];

      const dependencies = executor.analyzeToolDependencies(tools);

      expect(dependencies).toBeDefined();
    });
  });

  describe('buildExecutionPlan()', () => {
    it('should build execution plan', () => {
      const dependencies = new Map([
        ['tool_a', []],
        ['tool_b', ['tool_a']],
      ]);

      const plan = executor.buildExecutionPlan(dependencies);

      expect(Array.isArray(plan)).toBe(true);
    });
  });
});
