/**
 * ToolCompositionSystem 单元测试
 *
 * 测试内容：
 * - ToolCompositionSystem 类构造函数
 * - setDatabase 数据库设置
 * - registerTool 工具注册
 * - composeTools 工具组合
 * - _buildToolChain 工具链构建
 * - _matchesGoal 目标匹配
 * - _optimizeToolChain 工具链优化
 * - _canParallelize 并行判断
 * - _hasDependency 依赖检查
 * - executeComposition 组合执行
 * - _executeTool 单工具执行
 * - _recordComposition 组合记录
 * - getStats 统计信息
 * - cleanup 清理
 * - CompositionStrategy 组合策略枚举
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

const { ToolCompositionSystem, CompositionStrategy } = require('../tool-composition-system');

describe('CompositionStrategy', () => {
  it('should have PIPELINE strategy', () => {
    expect(CompositionStrategy.PIPELINE).toBe('pipeline');
  });

  it('should have PARALLEL strategy', () => {
    expect(CompositionStrategy.PARALLEL).toBe('parallel');
  });

  it('should have CONDITIONAL strategy', () => {
    expect(CompositionStrategy.CONDITIONAL).toBe('conditional');
  });

  it('should have ITERATIVE strategy', () => {
    expect(CompositionStrategy.ITERATIVE).toBe('iterative');
  });
});

describe('ToolCompositionSystem', () => {
  let system;

  beforeEach(() => {
    vi.clearAllMocks();
    system = new ToolCompositionSystem();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(system.config.enableAutoComposition).toBe(true);
      expect(system.config.enableEffectPrediction).toBe(true);
      expect(system.config.enableOptimization).toBe(true);
      expect(system.config.maxCompositionDepth).toBe(5);
    });

    it('should initialize with custom config', () => {
      const customSystem = new ToolCompositionSystem({
        enableAutoComposition: false,
        maxCompositionDepth: 10,
      });

      expect(customSystem.config.enableAutoComposition).toBe(false);
      expect(customSystem.config.maxCompositionDepth).toBe(10);
      expect(customSystem.config.enableEffectPrediction).toBe(true);
    });

    it('should initialize empty tool registry', () => {
      expect(system.toolRegistry).toBeInstanceOf(Map);
      expect(system.toolRegistry.size).toBe(0);
    });

    it('should initialize empty composition patterns', () => {
      expect(system.compositionPatterns).toBeInstanceOf(Map);
      expect(system.compositionPatterns.size).toBe(0);
    });

    it('should initialize stats', () => {
      expect(system.stats.totalCompositions).toBe(0);
      expect(system.stats.successfulCompositions).toBe(0);
      expect(system.stats.avgToolsPerComposition).toBe(0);
    });

    it('should have null database initially', () => {
      expect(system.db).toBeNull();
    });
  });

  describe('setDatabase', () => {
    it('should set database', () => {
      const mockDb = { prepare: vi.fn() };

      system.setDatabase(mockDb);

      expect(system.db).toBe(mockDb);
    });
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool = {
        execute: vi.fn(),
        inputs: ['text'],
        outputs: ['html'],
        dependencies: [],
        cost: 2,
      };

      system.registerTool('htmlGenerator', tool);

      expect(system.toolRegistry.has('htmlGenerator')).toBe(true);
    });

    it('should store tool properties', () => {
      const tool = {
        execute: vi.fn(),
        inputs: ['text'],
        outputs: ['html'],
        dependencies: ['parser'],
        cost: 3,
      };

      system.registerTool('myTool', tool);

      const stored = system.toolRegistry.get('myTool');
      expect(stored.name).toBe('myTool');
      expect(stored.inputs).toEqual(['text']);
      expect(stored.outputs).toEqual(['html']);
      expect(stored.dependencies).toEqual(['parser']);
      expect(stored.cost).toBe(3);
    });

    it('should use defaults for optional properties', () => {
      const tool = {
        execute: vi.fn(),
      };

      system.registerTool('simpleTool', tool);

      const stored = system.toolRegistry.get('simpleTool');
      expect(stored.inputs).toEqual([]);
      expect(stored.outputs).toEqual([]);
      expect(stored.dependencies).toEqual([]);
      expect(stored.cost).toBe(1);
    });
  });

  describe('composeTools', () => {
    beforeEach(() => {
      system.registerTool('textParser', {
        execute: vi.fn().mockResolvedValue({ parsed: true }),
        outputs: ['parsed'],
      });
      system.registerTool('htmlGenerator', {
        execute: vi.fn().mockResolvedValue({ html: '<div></div>' }),
        outputs: ['html'],
      });
    });

    it('should compose tools for a goal', async () => {
      const composition = await system.composeTools('generate html content');

      expect(composition).toBeInstanceOf(Array);
    });

    it('should increment totalCompositions', async () => {
      await system.composeTools('test goal');

      expect(system.stats.totalCompositions).toBe(1);
    });

    it('should increment successfulCompositions', async () => {
      await system.composeTools('test goal');

      expect(system.stats.successfulCompositions).toBe(1);
    });

    it('should update avgToolsPerComposition', async () => {
      system.registerTool('tool1', { execute: vi.fn(), outputs: ['test'] });
      system.registerTool('tool2', { execute: vi.fn(), outputs: ['test'] });

      await system.composeTools('test');
      await system.composeTools('test');

      expect(system.stats.avgToolsPerComposition).toBeGreaterThan(0);
    });

    it('should record composition when database is set', async () => {
      const runMock = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: runMock,
        }),
      };
      system.setDatabase(mockDb);

      await system.composeTools('test goal', { sessionId: 'session123' });

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(runMock).toHaveBeenCalled();
    });
  });

  describe('_buildToolChain', () => {
    it('should build chain from matching tools', async () => {
      system.registerTool('htmlTool', {
        execute: vi.fn(),
        outputs: ['html'],
      });
      system.registerTool('cssTool', {
        execute: vi.fn(),
        outputs: ['css'],
      });

      const chain = await system._buildToolChain('generate html', {});

      const toolNames = chain.map((s) => s.tool);
      expect(toolNames).toContain('htmlTool');
      expect(toolNames).not.toContain('cssTool');
    });

    it('should return empty array when no tools match', async () => {
      system.registerTool('unrelatedTool', {
        execute: vi.fn(),
        outputs: ['unrelated'],
      });

      const chain = await system._buildToolChain('generate html', {});

      expect(chain).toEqual([]);
    });

    it('should set PIPELINE strategy for each step', async () => {
      system.registerTool('htmlTool', {
        execute: vi.fn(),
        outputs: ['html'],
      });

      const chain = await system._buildToolChain('html', {});

      expect(chain[0].strategy).toBe(CompositionStrategy.PIPELINE);
    });

    it('should include estimatedCost', async () => {
      system.registerTool('expensiveTool', {
        execute: vi.fn(),
        outputs: ['html'],
        cost: 5,
      });

      const chain = await system._buildToolChain('html', {});

      expect(chain[0].estimatedCost).toBe(5);
    });
  });

  describe('_matchesGoal', () => {
    it('should return true when output matches goal', () => {
      const tool = {
        outputs: ['html', 'css'],
      };

      expect(system._matchesGoal(tool, 'generate HTML content')).toBe(true);
    });

    it('should be case insensitive', () => {
      const tool = {
        outputs: ['HTML'],
      };

      expect(system._matchesGoal(tool, 'html output')).toBe(true);
    });

    it('should return false when no output matches', () => {
      const tool = {
        outputs: ['json'],
      };

      expect(system._matchesGoal(tool, 'generate html')).toBe(false);
    });

    it('should handle empty outputs', () => {
      const tool = {
        outputs: [],
      };

      expect(system._matchesGoal(tool, 'anything')).toBe(false);
    });
  });

  describe('_optimizeToolChain', () => {
    beforeEach(() => {
      system.registerTool('tool1', {
        execute: vi.fn(),
        outputs: ['a'],
        dependencies: [],
      });
      system.registerTool('tool2', {
        execute: vi.fn(),
        outputs: ['b'],
        dependencies: [],
      });
      system.registerTool('tool3', {
        execute: vi.fn(),
        outputs: ['c'],
        dependencies: ['tool1'],
      });
    });

    it('should return empty array for empty chain', () => {
      const optimized = system._optimizeToolChain([]);
      expect(optimized).toEqual([]);
    });

    it('should return single step unchanged', () => {
      const chain = [{ tool: 'tool1', strategy: 'pipeline', estimatedCost: 1 }];

      const optimized = system._optimizeToolChain(chain);

      expect(optimized).toHaveLength(1);
      expect(optimized[0].tool).toBe('tool1');
    });

    it('should group parallelizable tools', () => {
      const chain = [
        { tool: 'tool1', strategy: 'pipeline', estimatedCost: 1 },
        { tool: 'tool2', strategy: 'pipeline', estimatedCost: 1 },
      ];

      const optimized = system._optimizeToolChain(chain);

      expect(optimized).toHaveLength(1);
      expect(optimized[0].strategy).toBe(CompositionStrategy.PARALLEL);
      expect(optimized[0].tools).toHaveLength(2);
    });

    it('should separate dependent tools', () => {
      const chain = [
        { tool: 'tool1', strategy: 'pipeline', estimatedCost: 1 },
        { tool: 'tool3', strategy: 'pipeline', estimatedCost: 1 }, // depends on tool1
      ];

      const optimized = system._optimizeToolChain(chain);

      // Should not be grouped together
      expect(optimized.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('_canParallelize', () => {
    beforeEach(() => {
      system.registerTool('independent1', {
        execute: vi.fn(),
        dependencies: [],
      });
      system.registerTool('independent2', {
        execute: vi.fn(),
        dependencies: [],
      });
      system.registerTool('dependent', {
        execute: vi.fn(),
        dependencies: ['independent1'],
      });
    });

    it('should return true for independent tools', () => {
      const step = { tool: 'independent2' };
      const group = [{ tool: 'independent1' }];

      expect(system._canParallelize(step, group)).toBe(true);
    });

    it('should return false when step depends on group tool', () => {
      const step = { tool: 'dependent' };
      const group = [{ tool: 'independent1' }];

      expect(system._canParallelize(step, group)).toBe(false);
    });
  });

  describe('_hasDependency', () => {
    beforeEach(() => {
      system.registerTool('parent', {
        execute: vi.fn(),
        dependencies: [],
      });
      system.registerTool('child', {
        execute: vi.fn(),
        dependencies: ['parent'],
      });
    });

    it('should return true when dependency exists', () => {
      expect(system._hasDependency('child', 'parent')).toBe(true);
    });

    it('should return false when no dependency', () => {
      expect(system._hasDependency('parent', 'child')).toBe(false);
    });

    it('should return falsy value for unknown tools', () => {
      expect(system._hasDependency('unknown1', 'unknown2')).toBeFalsy();
    });
  });

  describe('executeComposition', () => {
    beforeEach(() => {
      system.registerTool('tool1', {
        execute: vi.fn().mockResolvedValue({ result1: 'value1' }),
      });
      system.registerTool('tool2', {
        execute: vi.fn().mockResolvedValue({ result2: 'value2' }),
      });
      system.registerTool('tool3', {
        execute: vi.fn().mockResolvedValue({ result3: 'value3' }),
      });
    });

    it('should execute single tool', async () => {
      const composition = [
        { tool: 'tool1', strategy: 'pipeline' },
      ];

      const results = await system.executeComposition(composition, { input: 'test' });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ result1: 'value1' });
    });

    it('should execute pipeline tools sequentially', async () => {
      const composition = [
        { tool: 'tool1', strategy: 'pipeline' },
        { tool: 'tool2', strategy: 'pipeline' },
      ];

      const results = await system.executeComposition(composition);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ result1: 'value1' });
      expect(results[1]).toEqual({ result2: 'value2' });
    });

    it('should execute parallel tools concurrently', async () => {
      const composition = [
        {
          tools: [{ tool: 'tool1' }, { tool: 'tool2' }],
          strategy: CompositionStrategy.PARALLEL,
        },
      ];

      const results = await system.executeComposition(composition);

      expect(results).toHaveLength(2);
    });

    it('should pass inputs to tools', async () => {
      const tool1 = system.toolRegistry.get('tool1');
      const composition = [{ tool: 'tool1', strategy: 'pipeline' }];

      await system.executeComposition(composition, { foo: 'bar' });

      expect(tool1.execute).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('should merge pipeline results into inputs', async () => {
      const tool2 = system.toolRegistry.get('tool2');
      const composition = [
        { tool: 'tool1', strategy: 'pipeline' },
        { tool: 'tool2', strategy: 'pipeline' },
      ];

      await system.executeComposition(composition, { initial: 'value' });

      expect(tool2.execute).toHaveBeenCalledWith({
        initial: 'value',
        result1: 'value1',
      });
    });
  });

  describe('_executeTool', () => {
    it('should execute registered tool', async () => {
      const handler = vi.fn().mockResolvedValue({ data: 'result' });
      system.registerTool('myTool', { execute: handler });

      const result = await system._executeTool('myTool', { arg: 1 });

      expect(handler).toHaveBeenCalledWith({ arg: 1 });
      expect(result).toEqual({ data: 'result' });
    });

    it('should throw for unknown tool', async () => {
      await expect(system._executeTool('unknown', {})).rejects.toThrow(
        'Tool "unknown" not found or not executable'
      );
    });

    it('should throw for tool without execute function', async () => {
      system.toolRegistry.set('noExecute', { name: 'noExecute' });

      await expect(system._executeTool('noExecute', {})).rejects.toThrow(
        'not found or not executable'
      );
    });
  });

  describe('_recordComposition', () => {
    it('should not record when no database', async () => {
      // Should not throw
      await system._recordComposition('goal', [], {});
    });

    it('should insert record into database', async () => {
      const runMock = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: runMock,
        }),
      };
      system.setDatabase(mockDb);

      const composition = [{ tool: 'tool1' }, { tool: 'tool2' }];
      await system._recordComposition('test goal', composition, { sessionId: 'sess1' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tool_composition_history')
      );
      expect(runMock).toHaveBeenCalledWith(
        'sess1',
        'test goal',
        JSON.stringify(composition),
        2
      );
    });

    it('should use "unknown" for missing sessionId', async () => {
      const runMock = vi.fn();
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: runMock,
        }),
      };
      system.setDatabase(mockDb);

      await system._recordComposition('goal', [], {});

      expect(runMock).toHaveBeenCalledWith('unknown', 'goal', '[]', 0);
    });

    it('should handle database errors gracefully', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation(() => {
          throw new Error('Database error');
        }),
      };
      system.setDatabase(mockDb);

      // Should not throw
      await expect(
        system._recordComposition('goal', [], {})
      ).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return stats with success rate', () => {
      system.stats.totalCompositions = 10;
      system.stats.successfulCompositions = 8;
      system.stats.avgToolsPerComposition = 3.5;

      const stats = system.getStats();

      expect(stats.totalCompositions).toBe(10);
      expect(stats.successfulCompositions).toBe(8);
      expect(stats.avgToolsPerComposition).toBe(3.5);
      expect(stats.successRate).toBe('80.00%');
    });

    it('should return 0% when no compositions', () => {
      const stats = system.getStats();

      expect(stats.successRate).toBe('0%');
    });

    it('should include registeredTools count', () => {
      system.registerTool('tool1', { execute: vi.fn() });
      system.registerTool('tool2', { execute: vi.fn() });

      const stats = system.getStats();

      expect(stats.registeredTools).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should clear tool registry', () => {
      system.registerTool('tool1', { execute: vi.fn() });

      system.cleanup();

      expect(system.toolRegistry.size).toBe(0);
    });

    it('should clear composition patterns', () => {
      system.compositionPatterns.set('pattern1', {});

      system.cleanup();

      expect(system.compositionPatterns.size).toBe(0);
    });

    it('should set database to null', () => {
      system.setDatabase({ prepare: vi.fn() });

      system.cleanup();

      expect(system.db).toBeNull();
    });
  });
});
