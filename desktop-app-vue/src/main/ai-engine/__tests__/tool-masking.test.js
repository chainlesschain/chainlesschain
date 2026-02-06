/**
 * ToolMaskingSystem 单元测试
 *
 * 测试内容：
 * - ToolMaskingSystem 类构造函数
 * - registerTool/registerTools 工具注册
 * - setToolAvailability 工具可用性控制
 * - setToolsByPrefix 按前缀批量控制
 * - setMask 掩码设置
 * - enableAll/disableAll 全局控制
 * - setOnlyAvailable 排他性启用
 * - isToolAvailable 可用性查询
 * - getAllToolDefinitions/getAvailableToolDefinitions 工具定义获取
 * - validateCall 工具调用验证
 * - executeWithMask 带掩码执行
 * - configureStateMachine 状态机配置
 * - transitionTo 状态转换
 * - getStats 统计信息
 * - exportConfig 配置导出
 * - reset 系统重置
 * - getToolMaskingSystem 单例
 * - TASK_PHASE_STATE_MACHINE 预定义状态机
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mock
const { logger } = require('../../utils/logger.js');

const {
  ToolMaskingSystem,
  getToolMaskingSystem,
  TASK_PHASE_STATE_MACHINE,
} = require('../tool-masking');

describe('ToolMaskingSystem', () => {
  let system;

  beforeEach(() => {
    vi.clearAllMocks();
    system = new ToolMaskingSystem();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(system.allTools).toBeInstanceOf(Map);
      expect(system.availableMask).toBeInstanceOf(Set);
      expect(system.toolGroups).toBeInstanceOf(Map);
      expect(system.stateMachine).toBeNull();
      expect(system.currentState).toBeNull();
    });

    it('should initialize with default config', () => {
      expect(system.config.enableStateMachine).toBe(false);
      expect(system.config.logMaskChanges).toBe(true);
      expect(system.config.defaultAvailable).toBe(true);
    });

    it('should initialize with custom options', () => {
      const customSystem = new ToolMaskingSystem({
        enableStateMachine: true,
        logMaskChanges: false,
        defaultAvailable: false,
      });

      expect(customSystem.config.enableStateMachine).toBe(true);
      expect(customSystem.config.logMaskChanges).toBe(false);
      expect(customSystem.config.defaultAvailable).toBe(false);
    });

    it('should initialize stats', () => {
      expect(system.stats.totalTools).toBe(0);
      expect(system.stats.availableTools).toBe(0);
      expect(system.stats.blockedCalls).toBe(0);
      expect(system.stats.maskChanges).toBe(0);
    });

    it('should be an EventEmitter', () => {
      expect(typeof system.on).toBe('function');
      expect(typeof system.emit).toBe('function');
    });
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {},
        handler: vi.fn(),
      };

      system.registerTool(tool);

      expect(system.allTools.has('test_tool')).toBe(true);
      expect(system.stats.totalTools).toBe(1);
    });

    it('should throw error when tool has no name', () => {
      expect(() => system.registerTool({ description: 'No name' })).toThrow(
        'Tool must have a name'
      );
    });

    it('should set default availability when defaultAvailable is true', () => {
      system.registerTool({ name: 'my_tool', handler: vi.fn() });

      expect(system.availableMask.has('my_tool')).toBe(true);
    });

    it('should not set default availability when defaultAvailable is false', () => {
      const noDefaultSystem = new ToolMaskingSystem({ defaultAvailable: false });
      noDefaultSystem.registerTool({ name: 'my_tool', handler: vi.fn() });

      expect(noDefaultSystem.availableMask.has('my_tool')).toBe(false);
    });

    it('should extract and group by snake_case prefix', () => {
      system.registerTool({ name: 'file_reader', handler: vi.fn() });
      system.registerTool({ name: 'file_writer', handler: vi.fn() });

      expect(system.toolGroups.has('file')).toBe(true);
      expect(system.toolGroups.get('file').size).toBe(2);
    });

    it('should extract and group by camelCase prefix', () => {
      system.registerTool({ name: 'browserNavigate', handler: vi.fn() });
      system.registerTool({ name: 'browserClick', handler: vi.fn() });

      expect(system.toolGroups.has('browser')).toBe(true);
      expect(system.toolGroups.get('browser').size).toBe(2);
    });

    it('should store registeredAt timestamp', () => {
      const before = Date.now();
      system.registerTool({ name: 'test', handler: vi.fn() });
      const after = Date.now();

      const tool = system.allTools.get('test');
      expect(tool.registeredAt).toBeGreaterThanOrEqual(before);
      expect(tool.registeredAt).toBeLessThanOrEqual(after);
    });
  });

  describe('registerTools', () => {
    it('should register multiple tools', () => {
      const tools = [
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
        { name: 'tool3', handler: vi.fn() },
      ];

      system.registerTools(tools);

      expect(system.stats.totalTools).toBe(3);
      expect(system.allTools.has('tool1')).toBe(true);
      expect(system.allTools.has('tool2')).toBe(true);
      expect(system.allTools.has('tool3')).toBe(true);
    });
  });

  describe('setToolAvailability', () => {
    beforeEach(() => {
      system.registerTool({ name: 'test_tool', handler: vi.fn() });
    });

    it('should disable a tool', () => {
      system.setToolAvailability('test_tool', false);

      expect(system.availableMask.has('test_tool')).toBe(false);
    });

    it('should enable a tool', () => {
      system.setToolAvailability('test_tool', false);
      system.setToolAvailability('test_tool', true);

      expect(system.availableMask.has('test_tool')).toBe(true);
    });

    it('should increment maskChanges when availability changes', () => {
      expect(system.stats.maskChanges).toBe(0);

      system.setToolAvailability('test_tool', false);
      expect(system.stats.maskChanges).toBe(1);

      system.setToolAvailability('test_tool', true);
      expect(system.stats.maskChanges).toBe(2);
    });

    it('should not increment maskChanges when no change', () => {
      system.setToolAvailability('test_tool', true); // Already true
      expect(system.stats.maskChanges).toBe(0);
    });

    it('should emit mask-changed event', () => {
      const handler = vi.fn();
      system.on('mask-changed', handler);

      system.setToolAvailability('test_tool', false);

      expect(handler).toHaveBeenCalledWith({
        tool: 'test_tool',
        available: false,
        timestamp: expect.any(Number),
      });
    });

    it('should not modify mask for unknown tool', () => {
      const initialMaskSize = system.availableMask.size;
      system.setToolAvailability('unknown_tool', true);

      // Mask should remain unchanged for unknown tool
      expect(system.availableMask.size).toBe(initialMaskSize);
      expect(system.availableMask.has('unknown_tool')).toBe(false);
    });
  });

  describe('setToolsByPrefix', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'file_reader', handler: vi.fn() },
        { name: 'file_writer', handler: vi.fn() },
        { name: 'git_commit', handler: vi.fn() },
      ]);
    });

    it('should disable all tools with prefix', () => {
      system.setToolsByPrefix('file', false);

      expect(system.availableMask.has('file_reader')).toBe(false);
      expect(system.availableMask.has('file_writer')).toBe(false);
      expect(system.availableMask.has('git_commit')).toBe(true);
    });

    it('should enable all tools with prefix', () => {
      system.disableAll();
      system.setToolsByPrefix('file', true);

      expect(system.availableMask.has('file_reader')).toBe(true);
      expect(system.availableMask.has('file_writer')).toBe(true);
      expect(system.availableMask.has('git_commit')).toBe(false);
    });

    it('should not modify mask for unknown prefix', () => {
      const initialMaskSize = system.availableMask.size;
      system.setToolsByPrefix('unknown', true);

      // Mask should remain unchanged for unknown prefix
      expect(system.availableMask.size).toBe(initialMaskSize);
    });
  });

  describe('setMask', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
        { name: 'tool3', handler: vi.fn() },
      ]);
    });

    it('should set multiple tool availabilities', () => {
      system.setMask({
        tool1: false,
        tool2: true,
        tool3: false,
      });

      expect(system.availableMask.has('tool1')).toBe(false);
      expect(system.availableMask.has('tool2')).toBe(true);
      expect(system.availableMask.has('tool3')).toBe(false);
    });
  });

  describe('enableAll', () => {
    it('should enable all tools', () => {
      system.registerTools([
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
      ]);
      system.disableAll();

      system.enableAll();

      expect(system.availableMask.size).toBe(2);
      expect(system.stats.availableTools).toBe(2);
    });
  });

  describe('disableAll', () => {
    it('should disable all tools', () => {
      system.registerTools([
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
      ]);

      system.disableAll();

      expect(system.availableMask.size).toBe(0);
      expect(system.stats.availableTools).toBe(0);
    });
  });

  describe('setOnlyAvailable', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
        { name: 'tool3', handler: vi.fn() },
      ]);
    });

    it('should only enable specified tools', () => {
      system.setOnlyAvailable(['tool1', 'tool3']);

      expect(system.availableMask.has('tool1')).toBe(true);
      expect(system.availableMask.has('tool2')).toBe(false);
      expect(system.availableMask.has('tool3')).toBe(true);
    });

    it('should ignore unknown tools', () => {
      system.setOnlyAvailable(['tool1', 'unknown']);

      expect(system.availableMask.size).toBe(1);
      expect(system.availableMask.has('tool1')).toBe(true);
    });
  });

  describe('isToolAvailable', () => {
    beforeEach(() => {
      system.registerTool({ name: 'test_tool', handler: vi.fn() });
    });

    it('should return true for available tool', () => {
      expect(system.isToolAvailable('test_tool')).toBe(true);
    });

    it('should return false for unavailable tool', () => {
      system.setToolAvailability('test_tool', false);
      expect(system.isToolAvailable('test_tool')).toBe(false);
    });

    it('should return false for unknown tool', () => {
      expect(system.isToolAvailable('unknown')).toBe(false);
    });
  });

  describe('getAllToolDefinitions', () => {
    it('should return all tool definitions', () => {
      system.registerTools([
        { name: 'tool1', description: 'Tool 1', parameters: { type: 'object' }, handler: vi.fn() },
        { name: 'tool2', description: 'Tool 2', parameters: { type: 'string' }, handler: vi.fn() },
      ]);

      const definitions = system.getAllToolDefinitions();

      expect(definitions).toHaveLength(2);
      expect(definitions[0]).toHaveProperty('name');
      expect(definitions[0]).toHaveProperty('description');
      expect(definitions[0]).toHaveProperty('parameters');
      expect(definitions[0]).not.toHaveProperty('handler');
      expect(definitions[0]).not.toHaveProperty('registeredAt');
    });
  });

  describe('getAvailableToolDefinitions', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'tool1', description: 'Tool 1', parameters: {}, handler: vi.fn() },
        { name: 'tool2', description: 'Tool 2', parameters: {}, handler: vi.fn() },
      ]);
    });

    it('should return only available tool definitions', () => {
      system.setToolAvailability('tool2', false);

      const definitions = system.getAvailableToolDefinitions();

      expect(definitions).toHaveLength(1);
      expect(definitions[0].name).toBe('tool1');
    });
  });

  describe('getAvailabilityMask', () => {
    it('should return a copy of the mask', () => {
      system.registerTool({ name: 'tool1', handler: vi.fn() });

      const mask = system.getAvailabilityMask();

      expect(mask).toBeInstanceOf(Set);
      expect(mask.has('tool1')).toBe(true);

      // Modifying returned set should not affect original
      mask.delete('tool1');
      expect(system.availableMask.has('tool1')).toBe(true);
    });
  });

  describe('getToolGroups', () => {
    it('should return tool groups info', () => {
      system.registerTools([
        { name: 'file_reader', handler: vi.fn() },
        { name: 'file_writer', handler: vi.fn() },
        { name: 'git_commit', handler: vi.fn() },
      ]);
      system.setToolAvailability('file_writer', false);

      const groups = system.getToolGroups();

      expect(groups.file).toBeDefined();
      expect(groups.file.count).toBe(2);
      expect(groups.file.availableCount).toBe(1);
      expect(groups.file.tools).toContain('file_reader');
      expect(groups.file.tools).toContain('file_writer');
    });
  });

  describe('validateCall', () => {
    beforeEach(() => {
      system.registerTool({ name: 'test_tool', handler: vi.fn() });
    });

    it('should allow call for available tool', () => {
      const result = system.validateCall('test_tool');

      expect(result.allowed).toBe(true);
      expect(result.tool).toBeDefined();
    });

    it('should deny call for unavailable tool', () => {
      system.setToolAvailability('test_tool', false);

      const result = system.validateCall('test_tool');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tool_masked');
      expect(result.message).toContain('test_tool');
    });

    it('should deny call for unknown tool', () => {
      const result = system.validateCall('unknown_tool');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tool_not_found');
    });

    it('should increment blockedCalls for masked tools', () => {
      system.setToolAvailability('test_tool', false);

      system.validateCall('test_tool');
      system.validateCall('test_tool');

      expect(system.stats.blockedCalls).toBe(2);
    });
  });

  describe('executeWithMask', () => {
    it('should execute tool handler when available', async () => {
      const handler = vi.fn().mockResolvedValue('result');
      system.registerTool({ name: 'test_tool', handler });

      const result = await system.executeWithMask('test_tool', { arg: 1 }, { ctx: 'test' });

      expect(handler).toHaveBeenCalledWith({ arg: 1 }, { ctx: 'test' });
      expect(result).toBe('result');
    });

    it('should throw error when tool is not available', async () => {
      system.registerTool({ name: 'test_tool', handler: vi.fn() });
      system.setToolAvailability('test_tool', false);

      await expect(
        system.executeWithMask('test_tool', {}, {})
      ).rejects.toThrow('当前被禁用');
    });

    it('should throw error for unknown tool', async () => {
      await expect(
        system.executeWithMask('unknown', {}, {})
      ).rejects.toThrow('不存在');
    });
  });

  describe('configureStateMachine', () => {
    it('should configure state machine', () => {
      const config = {
        states: {
          planning: { availableTools: ['read'] },
          executing: { availableTools: ['write'] },
        },
        transitions: {
          planning: ['executing'],
          executing: ['planning'],
        },
      };

      system.configureStateMachine(config);

      expect(system.stateMachine).toEqual(config);
      expect(system.config.enableStateMachine).toBe(true);
    });
  });

  describe('transitionTo', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'file_reader', handler: vi.fn() },
        { name: 'file_writer', handler: vi.fn() },
        { name: 'search_web', handler: vi.fn() },
      ]);

      system.configureStateMachine({
        states: {
          planning: {
            availableTools: ['file_reader'],
            availablePrefixes: ['search'],
          },
          executing: {
            availableTools: ['file_reader', 'file_writer'],
          },
        },
        transitions: {
          planning: ['executing'],
          executing: ['planning'],
        },
      });
    });

    it('should transition to initial state', () => {
      const result = system.transitionTo('planning');

      expect(result).toBe(true);
      expect(system.currentState).toBe('planning');
    });

    it('should apply state tool configuration', () => {
      system.transitionTo('planning');

      expect(system.isToolAvailable('file_reader')).toBe(true);
      expect(system.isToolAvailable('file_writer')).toBe(false);
      expect(system.isToolAvailable('search_web')).toBe(true);
    });

    it('should allow valid transitions', () => {
      system.transitionTo('planning');
      const result = system.transitionTo('executing');

      expect(result).toBe(true);
      expect(system.currentState).toBe('executing');
    });

    it('should reject invalid transitions', () => {
      system.transitionTo('planning');
      const stateBefore = system.getCurrentState();

      // Try to transition to planning again (not in allowed list)
      const result = system.transitionTo('planning');

      expect(result).toBe(false);
      // State should remain unchanged
      expect(system.getCurrentState()).toBe(stateBefore);
    });

    it('should emit state-changed event', () => {
      const handler = vi.fn();
      system.on('state-changed', handler);

      system.transitionTo('planning');

      expect(handler).toHaveBeenCalledWith({
        from: null,
        to: 'planning',
        availableTools: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('should return false when state machine not configured', () => {
      const noStateMachine = new ToolMaskingSystem();

      const result = noStateMachine.transitionTo('planning');

      expect(result).toBe(false);
    });

    it('should return false for unknown state', () => {
      const result = system.transitionTo('unknown_state');

      expect(result).toBe(false);
    });
  });

  describe('getCurrentState', () => {
    it('should return null initially', () => {
      expect(system.getCurrentState()).toBeNull();
    });

    it('should return current state after transition', () => {
      system.configureStateMachine({
        states: { planning: { availableTools: [] } },
        transitions: {},
      });
      system.transitionTo('planning');

      expect(system.getCurrentState()).toBe('planning');
    });
  });

  describe('getAvailableTransitions', () => {
    beforeEach(() => {
      system.configureStateMachine({
        states: {
          planning: { availableTools: [] },
          executing: { availableTools: [] },
          reviewing: { availableTools: [] },
        },
        transitions: {
          planning: ['executing'],
          executing: ['reviewing', 'planning'],
          reviewing: ['executing'],
        },
      });
    });

    it('should return empty array when no state machine', () => {
      const noStateMachine = new ToolMaskingSystem();
      expect(noStateMachine.getAvailableTransitions()).toEqual([]);
    });

    it('should return empty array when no current state', () => {
      expect(system.getAvailableTransitions()).toEqual([]);
    });

    it('should return available transitions for current state', () => {
      system.transitionTo('executing');

      expect(system.getAvailableTransitions()).toEqual(['reviewing', 'planning']);
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      system.registerTool({ name: 'tool1', handler: vi.fn() });
      system.registerTool({ name: 'tool2', handler: vi.fn() });
      system.setToolAvailability('tool2', false);

      const stats = system.getStats();

      expect(stats.totalTools).toBe(2);
      expect(stats.availableTools).toBe(1);
      expect(stats.maskChanges).toBe(1);
      expect(stats.currentState).toBeNull();
      expect(stats.availableRatio).toBe('0.50');
    });

    it('should handle zero total tools', () => {
      const stats = system.getStats();

      expect(stats.availableRatio).toBe(0);
    });
  });

  describe('exportConfig', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'file_reader', handler: vi.fn() },
        { name: 'file_writer', handler: vi.fn() },
      ]);
      system.setToolAvailability('file_writer', false);
    });

    it('should export complete configuration', () => {
      const config = system.exportConfig();

      expect(config.tools).toHaveLength(2);
      expect(config.groups).toBeDefined();
      expect(config.stateMachine).toBeNull();
      expect(config.currentState).toBeNull();
      expect(config.stats).toBeDefined();
    });

    it('should include tool availability', () => {
      const config = system.exportConfig();

      const readerTool = config.tools.find((t) => t.name === 'file_reader');
      const writerTool = config.tools.find((t) => t.name === 'file_writer');

      expect(readerTool.available).toBe(true);
      expect(writerTool.available).toBe(false);
    });

    it('should include prefix info', () => {
      const config = system.exportConfig();

      config.tools.forEach((tool) => {
        expect(tool.prefix).toBe('file');
      });
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      system.registerTools([
        { name: 'tool1', handler: vi.fn() },
        { name: 'tool2', handler: vi.fn() },
      ]);
      system.configureStateMachine({
        states: { planning: { availableTools: [] } },
        transitions: {},
      });
      system.transitionTo('planning');
      system.stats.blockedCalls = 5;
      system.stats.maskChanges = 10;
    });

    it('should clear current state', () => {
      system.reset();

      expect(system.currentState).toBeNull();
    });

    it('should reset blockedCalls and maskChanges', () => {
      system.reset();

      expect(system.stats.blockedCalls).toBe(0);
      expect(system.stats.maskChanges).toBe(0);
    });

    it('should restore default availability when defaultAvailable is true', () => {
      system.reset();

      expect(system.availableMask.size).toBe(2);
    });

    it('should not restore availability when defaultAvailable is false', () => {
      const noDefaultSystem = new ToolMaskingSystem({ defaultAvailable: false });
      noDefaultSystem.registerTool({ name: 'tool1', handler: vi.fn() });

      noDefaultSystem.reset();

      expect(noDefaultSystem.availableMask.size).toBe(0);
    });
  });

  describe('_extractPrefix', () => {
    it('should extract snake_case prefix', () => {
      expect(system._extractPrefix('file_reader')).toBe('file');
      expect(system._extractPrefix('browser_navigate')).toBe('browser');
    });

    it('should extract camelCase prefix', () => {
      expect(system._extractPrefix('fileReader')).toBe('file');
      expect(system._extractPrefix('browserNavigate')).toBe('browser');
    });

    it('should return null for no prefix', () => {
      expect(system._extractPrefix('tool')).toBeNull();
      expect(system._extractPrefix('TOOL')).toBeNull();
    });
  });
});

describe('getToolMaskingSystem', () => {
  it('should return singleton instance', () => {
    const instance1 = getToolMaskingSystem();
    const instance2 = getToolMaskingSystem();

    expect(instance1).toBe(instance2);
  });
});

describe('TASK_PHASE_STATE_MACHINE', () => {
  it('should have required states', () => {
    expect(TASK_PHASE_STATE_MACHINE.states).toBeDefined();
    expect(TASK_PHASE_STATE_MACHINE.states.planning).toBeDefined();
    expect(TASK_PHASE_STATE_MACHINE.states.executing).toBeDefined();
    expect(TASK_PHASE_STATE_MACHINE.states.validating).toBeDefined();
    expect(TASK_PHASE_STATE_MACHINE.states.committing).toBeDefined();
  });

  it('should have required transitions', () => {
    expect(TASK_PHASE_STATE_MACHINE.transitions).toBeDefined();
    expect(TASK_PHASE_STATE_MACHINE.transitions.planning).toContain('executing');
    expect(TASK_PHASE_STATE_MACHINE.transitions.executing).toContain('validating');
    expect(TASK_PHASE_STATE_MACHINE.transitions.validating).toContain('committing');
    expect(TASK_PHASE_STATE_MACHINE.transitions.committing).toContain('planning');
  });

  it('should have availableTools in each state', () => {
    Object.values(TASK_PHASE_STATE_MACHINE.states).forEach((state) => {
      expect(state.availableTools).toBeInstanceOf(Array);
    });
  });

  it('should work with ToolMaskingSystem', () => {
    const system = new ToolMaskingSystem();

    // Register tools mentioned in the state machine
    system.registerTools([
      { name: 'file_reader', handler: vi.fn() },
      { name: 'file_writer', handler: vi.fn() },
      { name: 'git_commit', handler: vi.fn() },
    ]);

    system.configureStateMachine(TASK_PHASE_STATE_MACHINE);

    // Transition through states
    expect(system.transitionTo('planning')).toBe(true);
    expect(system.transitionTo('executing')).toBe(true);
    expect(system.transitionTo('validating')).toBe(true);
    expect(system.transitionTo('committing')).toBe(true);
    expect(system.transitionTo('planning')).toBe(true);
  });
});
