import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * HierarchicalTaskPlanner 单元测试
 *
 * 测试分层任务规划系统，包括:
 * - 三层分解（业务→技术→工具）
 * - 粒度控制（coarse/medium/fine/auto）
 * - 复杂度评估
 * - 时间估算
 * - 降级策略
 * - 可视化输出
 */

describe("HierarchicalTaskPlanner", () => {
  let HierarchicalTaskPlanner;
  let planner;
  let mockLLMService;
  let mockTaskPlanner;
  let mockFunctionCaller;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/hierarchical-task-planner.js");
    HierarchicalTaskPlanner = module.default;

    // Mock services
    mockLLMService = {
      complete: vi.fn()
    };

    mockTaskPlanner = {
      quickDecompose: vi.fn()
    };

    mockFunctionCaller = {};

    // Create instance
    planner = new HierarchicalTaskPlanner(
      mockLLMService,
      mockTaskPlanner,
      mockFunctionCaller
    );
  });

  describe("初始化", () => {
    it("应该正确初始化", () => {
      expect(planner.llmService).toBe(mockLLMService);
      expect(planner.taskPlanner).toBe(mockTaskPlanner);
      expect(planner.functionCaller).toBe(mockFunctionCaller);
      expect(planner.granularityConfig).toBeDefined();
      expect(planner.toolDurationEstimates).toBeDefined();
    });

    it("应该包含4种粒度配置", () => {
      const granularities = Object.keys(planner.granularityConfig);
      expect(granularities).toHaveLength(4);
      expect(granularities).toContain('coarse');
      expect(granularities).toContain('medium');
      expect(granularities).toContain('fine');
      expect(granularities).toContain('auto');
    });

    it("应该包含粒度的具体配置", () => {
      expect(planner.granularityConfig.coarse.maxBusinessSteps).toBe(3);
      expect(planner.granularityConfig.coarse.maxTechnicalSteps).toBe(5);
      expect(planner.granularityConfig.medium.maxBusinessSteps).toBe(5);
      expect(planner.granularityConfig.medium.maxTechnicalSteps).toBe(10);
      expect(planner.granularityConfig.fine.maxBusinessSteps).toBe(8);
      expect(planner.granularityConfig.fine.maxTechnicalSteps).toBe(20);
    });

    it("应该包含工具执行时间估算", () => {
      expect(planner.toolDurationEstimates.html_generator).toBe(3);
      expect(planner.toolDurationEstimates.word_generator).toBe(5);
      expect(planner.toolDurationEstimates.default).toBe(5);
    });
  });

  describe("assessComplexity - 评估任务复杂度", () => {
    it("应该基于实体数量增加分数", () => {
      const intent = {
        intent: 'CREATE_FILE',
        entities: { fileType: 'HTML', theme: 'blog', layout: 'modern' }
      };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBeGreaterThanOrEqual(3);
    });

    it("应该基于文件数量增加分数", () => {
      const intent = { intent: 'CREATE_FILE', entities: {} };
      const context = {
        projectFiles: ['file1', 'file2', 'file3', 'file4']
      };

      const complexity = planner.assessComplexity(intent, context);

      expect(complexity).toBe(2);  // projectFiles > 3
    });

    it("应该识别复杂意图类型", () => {
      const intent = { intent: 'ANALYZE_DATA', entities: {} };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBe(3);  // 复杂意图
    });

    it("应该基于输入长度增加分数", () => {
      const intent = {
        intent: 'CREATE_FILE',
        description: 'x'.repeat(150),
        entities: {}
      };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBe(2);  // 长输入
    });

    it("应该将复杂度限制在10分以内", () => {
      const intent = {
        intent: 'ANALYZE_DATA',  // +3
        description: 'x'.repeat(150),  // +2
        entities: { a: 1, b: 2, c: 3, d: 4 }  // +3
      };
      const context = {
        projectFiles: ['1', '2', '3', '4']  // +2
      };

      const complexity = planner.assessComplexity(intent, context);

      expect(complexity).toBeLessThanOrEqual(10);
    });

    it("应该处理空实体", () => {
      const intent = { intent: 'CREATE_FILE' };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBe(0);
    });

    it("应该处理缺失的description", () => {
      const intent = { intent: 'CREATE_FILE', entities: {} };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBe(0);
    });
  });

  describe("determineGranularity - 确定实际粒度", () => {
    it("应该返回请求的粒度（非auto）", () => {
      const intent = { intent: 'CREATE_FILE', entities: {} };

      const granularity = planner.determineGranularity('coarse', intent, {});

      expect(granularity).toBe('coarse');
    });

    it("应该在auto模式下根据复杂度选择粒度 - 简单任务", () => {
      const intent = { intent: 'CREATE_FILE', entities: {} };  // complexity = 0

      const granularity = planner.determineGranularity('auto', intent, {});

      expect(granularity).toBe('coarse');
    });

    it("应该在auto模式下根据复杂度选择粒度 - 中等任务", () => {
      const intent = {
        intent: 'CREATE_FILE',
        entities: { a: 1, b: 2, c: 3 }  // +3
      };  // complexity = 3

      const granularity = planner.determineGranularity('auto', intent, {});

      expect(granularity).toBe('medium');
    });

    it("应该在auto模式下根据复杂度选择粒度 - 复杂任务", () => {
      const intent = {
        intent: 'ANALYZE_DATA',  // +3
        description: 'x'.repeat(150),  // +2
        entities: { a: 1, b: 2, c: 3 }  // +3
      };  // complexity = 8

      const granularity = planner.determineGranularity('auto', intent, {});

      expect(granularity).toBe('fine');
    });
  });

  describe("ruleBasedBusinessDecompose - 基于规则的业务分解", () => {
    it("应该分解CREATE_FILE意图", () => {
      const intent = { intent: 'CREATE_FILE', description: '创建网站' };

      const steps = planner.ruleBasedBusinessDecompose(intent, 5);

      expect(steps).toHaveLength(3);
      expect(steps[0]).toContain('设计');
      expect(steps[1]).toContain('生成');
      expect(steps[2]).toContain('保存');
    });

    it("应该分解DEPLOY_PROJECT意图", () => {
      const intent = { intent: 'DEPLOY_PROJECT', description: '部署项目' };

      const steps = planner.ruleBasedBusinessDecompose(intent, 5);

      expect(steps).toHaveLength(4);
      expect(steps).toContain('准备部署文件');
      expect(steps).toContain('上传到云端');
    });

    it("应该分解ANALYZE_DATA意图", () => {
      const intent = { intent: 'ANALYZE_DATA', description: '分析数据' };

      const steps = planner.ruleBasedBusinessDecompose(intent, 5);

      expect(steps).toHaveLength(4);
      expect(steps[0]).toContain('读取');
      expect(steps[1]).toContain('清洗');
    });

    it("应该处理未知意图类型", () => {
      const intent = { intent: 'UNKNOWN', description: '执行某任务' };

      const steps = planner.ruleBasedBusinessDecompose(intent, 5);

      expect(steps).toHaveLength(1);
      expect(steps[0]).toContain('执行某任务');
    });

    it("应该限制步骤数量", () => {
      const intent = { intent: 'DEPLOY_PROJECT', description: '部署' };

      const steps = planner.ruleBasedBusinessDecompose(intent, 2);

      expect(steps).toHaveLength(2);
    });
  });

  describe("decomposeBusinessLogic - 业务逻辑层分解", () => {
    it("应该使用LLM分解业务逻辑", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1', '步骤2', '步骤3'])
      });

      const intent = { intent: 'CREATE_FILE', description: '创建网站' };
      const steps = await planner.decomposeBusinessLogic(intent, {}, 'medium');

      expect(mockLLMService.complete).toHaveBeenCalled();
      expect(steps).toEqual(['步骤1', '步骤2', '步骤3']);
    });

    it("应该限制步骤数量", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1', '步骤2', '步骤3', '步骤4', '步骤5', '步骤6'])
      });

      const intent = { intent: 'CREATE_FILE', description: '创建网站' };
      const steps = await planner.decomposeBusinessLogic(intent, {}, 'coarse');

      expect(steps).toHaveLength(3);  // coarse maxBusinessSteps = 3
    });

    it("应该在LLM失败时降级到规则方法", async () => {
      mockLLMService.complete.mockRejectedValue(new Error('LLM failed'));

      const intent = { intent: 'CREATE_FILE', description: '创建网站' };
      const steps = await planner.decomposeBusinessLogic(intent, {}, 'medium');

      expect(steps).toHaveLength(3);
      expect(steps[0]).toContain('设计');
    });

    it("应该在LLM返回非数组时降级", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: '{ "invalid": "format" }'
      });

      const intent = { intent: 'CREATE_FILE', description: '创建网站' };
      const steps = await planner.decomposeBusinessLogic(intent, {}, 'medium');

      expect(steps).toHaveLength(3);
    });
  });

  describe("ruleBasedTechnicalDecompose - 基于规则的技术分解", () => {
    it("应该识别生成相关任务", () => {
      const tasks = planner.ruleBasedTechnicalDecompose('生成网页内容', 5);

      expect(tasks).toContain('调用生成器工具');
      expect(tasks).toContain('写入文件系统');
    });

    it("应该识别部署相关任务", () => {
      const tasks = planner.ruleBasedTechnicalDecompose('部署到云端', 5);

      expect(tasks).toContain('构建项目');
      expect(tasks).toContain('上传文件');
    });

    it("应该识别分析相关任务", () => {
      const tasks = planner.ruleBasedTechnicalDecompose('分析销售数据', 5);

      expect(tasks).toContain('读取数据源');
      expect(tasks).toContain('执行计算');
    });

    it("应该处理未匹配的任务", () => {
      const tasks = planner.ruleBasedTechnicalDecompose('未知任务', 5);

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBe('未知任务');
    });

    it("应该限制子任务数量", () => {
      const tasks = planner.ruleBasedTechnicalDecompose('部署到云端', 2);

      expect(tasks).toHaveLength(2);
    });
  });

  describe("decomposeSingleBusinessStep - 分解单个业务步骤", () => {
    it("应该使用LLM分解业务步骤", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['技术任务1', '技术任务2'])
      });

      const tasks = await planner.decomposeSingleBusinessStep('生成内容', {}, 3);

      expect(mockLLMService.complete).toHaveBeenCalled();
      expect(tasks).toEqual(['技术任务1', '技术任务2']);
    });

    it("应该在LLM失败时降级", async () => {
      mockLLMService.complete.mockRejectedValue(new Error('LLM failed'));

      const tasks = await planner.decomposeSingleBusinessStep('生成内容', {}, 3);

      expect(tasks.length).toBeGreaterThan(0);
    });
  });

  describe("ruleBasedToolMapping - 基于规则的工具映射", () => {
    it("应该映射HTML生成任务", () => {
      const tools = planner.ruleBasedToolMapping('生成HTML网页', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('html_generator');
      expect(tools[0].title).toBe('生成HTML');
    });

    it("应该映射CSS生成任务", () => {
      const tools = planner.ruleBasedToolMapping('生成CSS样式', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('css_generator');
    });

    it("应该映射Word生成任务", () => {
      const tools = planner.ruleBasedToolMapping('生成Word文档', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('word_generator');
    });

    it("应该映射文件读取任务", () => {
      const tools = planner.ruleBasedToolMapping('读取文件', { filePath: 'test.txt' });

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('file_reader');
    });

    it("应该映射文件写入任务", () => {
      const tools = planner.ruleBasedToolMapping('保存文件', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('file_writer');
    });

    it("应该映射数据分析任务", () => {
      const tools = planner.ruleBasedToolMapping('分析数据', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('data_analyzer');
    });

    it("应该映射Git提交任务", () => {
      const tools = planner.ruleBasedToolMapping('提交代码', {});

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('git_commit');
    });

    it("应该支持多个工具映射", () => {
      const tools = planner.ruleBasedToolMapping('生成HTML网页和CSS样式', {});

      expect(tools.length).toBeGreaterThanOrEqual(2);
    });

    it("应该返回空数组当没有匹配时", () => {
      const tools = planner.ruleBasedToolMapping('未知任务', {});

      expect(tools).toEqual([]);
    });
  });

  describe("taskToTools - 将技术任务转换为工具调用", () => {
    it("应该使用TaskPlanner的quickDecompose方法", async () => {
      mockTaskPlanner.quickDecompose.mockResolvedValue({
        subtasks: [
          { tool: 'html_generator', title: '生成HTML' }
        ]
      });

      const tools = await planner.taskToTools('生成网页', {});

      expect(mockTaskPlanner.quickDecompose).toHaveBeenCalled();
      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('html_generator');
    });

    it("应该在TaskPlanner失败时降级到规则映射", async () => {
      mockTaskPlanner.quickDecompose.mockRejectedValue(new Error('Failed'));

      const tools = await planner.taskToTools('生成HTML网页', {});

      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].tool).toBe('html_generator');
    });

    it("应该在没有TaskPlanner时使用规则映射", async () => {
      const plannerWithoutTaskPlanner = new HierarchicalTaskPlanner(
        mockLLMService,
        null,
        mockFunctionCaller
      );

      const tools = await plannerWithoutTaskPlanner.taskToTools('生成HTML网页', {});

      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe("estimateDuration - 估算执行时间", () => {
    it("应该根据工具类型估算时间", () => {
      const executionPlan = [
        { tool: 'html_generator' },
        { tool: 'css_generator' },
        { tool: 'file_writer' }
      ];

      const duration = planner.estimateDuration(executionPlan);

      expect(duration).toBe(3 + 2 + 1);  // 6秒
    });

    it("应该使用默认时间估算未知工具", () => {
      const executionPlan = [
        { tool: 'unknown_tool' }
      ];

      const duration = planner.estimateDuration(executionPlan);

      expect(duration).toBe(5);  // default
    });

    it("应该处理空执行计划", () => {
      const duration = planner.estimateDuration([]);

      expect(duration).toBe(0);
    });

    it("应该累加多个工具的时间", () => {
      const executionPlan = [
        { tool: 'word_generator' },  // 5
        { tool: 'pdf_generator' },   // 8
        { tool: 'deploy_to_cloud' }  // 20
      ];

      const duration = planner.estimateDuration(executionPlan);

      expect(duration).toBe(33);
    });
  });

  describe("generatePlanSummary - 生成计划摘要", () => {
    it("应该统计各层级步骤数", () => {
      const plan = {
        granularity: 'medium',
        layers: {
          business: ['步骤1', '步骤2'],
          technical: ['任务1', '任务2', '任务3'],
          execution: [{ tool: 'html_generator' }]
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.layerCounts.business).toBe(2);
      expect(summary.layerCounts.technical).toBe(3);
      expect(summary.layerCounts.execution).toBe(1);
      expect(summary.totalSteps).toBe(6);
    });

    it("应该估算执行时间", () => {
      const plan = {
        granularity: 'medium',
        layers: {
          execution: [
            { tool: 'html_generator' },
            { tool: 'file_writer' }
          ]
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.estimatedDuration).toBe(4);  // 3 + 1
    });

    it("应该评估复杂度 - 简单", () => {
      const plan = {
        granularity: 'coarse',
        layers: {
          business: ['步骤1', '步骤2'],
          technical: ['任务1']
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.complexity).toBe('simple');
    });

    it("应该评估复杂度 - 中等", () => {
      const plan = {
        granularity: 'medium',
        layers: {
          business: ['步骤1', '步骤2', '步骤3'],
          technical: ['任务1', '任务2', '任务3', '任务4']
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.complexity).toBe('medium');
    });

    it("应该评估复杂度 - 复杂", () => {
      const plan = {
        granularity: 'fine',
        layers: {
          business: ['步骤1', '步骤2', '步骤3', '步骤4', '步骤5'],
          technical: Array(12).fill('任务')
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.complexity).toBe('complex');
    });

    it("应该包含粒度描述", () => {
      const plan = {
        granularity: 'medium',
        layers: {}
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.granularityDescription).toContain('中粒度');
    });

    it("应该处理缺失的层级", () => {
      const plan = {
        granularity: 'coarse',
        layers: {
          business: ['步骤1']
        }
      };

      const summary = planner.generatePlanSummary(plan);

      expect(summary.totalSteps).toBe(1);
      expect(summary.layerCounts.technical).toBeUndefined();
    });
  });

  describe("parseJSON - JSON解析", () => {
    it("应该解析有效JSON", () => {
      const result = planner.parseJSON('["步骤1", "步骤2"]');

      expect(result).toEqual(['步骤1', '步骤2']);
    });

    it("应该从文本中提取JSON数组", () => {
      const text = 'Some text before ["步骤1", "步骤2"] some text after';

      const result = planner.parseJSON(text);

      expect(result).toEqual(['步骤1', '步骤2']);
    });

    it("应该从文本中提取JSON对象", () => {
      const text = 'Some text before {"key": "value"} some text after';

      const result = planner.parseJSON(text);

      expect(result).toEqual({ key: 'value' });
    });

    it("应该在无效JSON时返回null", () => {
      const result = planner.parseJSON('invalid json');

      expect(result).toBeNull();
    });

    it("应该处理包含换行的JSON", () => {
      const json = '[\n  "步骤1",\n  "步骤2"\n]';

      const result = planner.parseJSON(json);

      expect(result).toEqual(['步骤1', '步骤2']);
    });
  });

  describe("visualize - 生成可视化文本", () => {
    it("应该生成完整的可视化文本", () => {
      const plan = {
        granularity: 'medium',
        summary: {
          granularityDescription: '中粒度（平衡，5-10步）',
          totalSteps: 6,
          estimatedDuration: 10,
          complexity: 'medium'
        },
        layers: {
          business: ['设计界面', '生成内容'],
          technical: ['调用生成器', '写入文件'],
          execution: [
            { tool: 'html_generator', title: '生成HTML' },
            { tool: 'file_writer', title: '保存文件' }
          ]
        }
      };

      const visualization = planner.visualize(plan);

      expect(visualization).toContain('分层任务规划');
      expect(visualization).toContain('粒度: 中粒度');
      expect(visualization).toContain('总步骤数: 6');
      expect(visualization).toContain('预计耗时: 10秒');
      expect(visualization).toContain('复杂度: medium');
      expect(visualization).toContain('业务逻辑层');
      expect(visualization).toContain('技术任务层');
      expect(visualization).toContain('工具调用层');
      expect(visualization).toContain('设计界面');
      expect(visualization).toContain('html_generator');
    });

    it("应该处理缺失的层级", () => {
      const plan = {
        granularity: 'coarse',
        summary: {
          granularityDescription: '粗粒度',
          totalSteps: 2,
          estimatedDuration: 5,
          complexity: 'simple'
        },
        layers: {
          business: ['执行任务']
        }
      };

      const visualization = planner.visualize(plan);

      expect(visualization).toContain('业务逻辑层');
      expect(visualization).not.toContain('技术任务层');
      expect(visualization).not.toContain('工具调用层');
    });

    it("应该处理工具没有title的情况", () => {
      const plan = {
        granularity: 'coarse',
        summary: {
          granularityDescription: '粗粒度',
          totalSteps: 1,
          estimatedDuration: 5,
          complexity: 'simple'
        },
        layers: {
          execution: [{ tool: 'unknown_tool' }]
        }
      };

      const visualization = planner.visualize(plan);

      expect(visualization).toContain('unknown_tool - 未命名');
    });
  });

  describe("plan - 分层规划（集成测试）", () => {
    it("应该生成完整的三层计划", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1', '步骤2'])
      });

      mockTaskPlanner.quickDecompose.mockResolvedValue({
        subtasks: [{ tool: 'html_generator', title: '生成HTML' }]
      });

      const intent = {
        intent: 'CREATE_FILE',
        description: '创建网站',
        entities: {}
      };

      const plan = await planner.plan(intent, {});

      expect(plan.layers.business).toBeDefined();
      expect(plan.layers.technical).toBeDefined();
      expect(plan.layers.execution).toBeDefined();
      expect(plan.summary).toBeDefined();
    });

    it("应该支持禁用特定层级", async () => {
      const intent = {
        intent: 'CREATE_FILE',
        description: '创建网站',
        entities: {}
      };

      const plan = await planner.plan(intent, {}, {
        includeBusinessLayer: true,
        includeTechnicalLayer: false,
        includeExecutionLayer: false
      });

      expect(plan.layers.business).toBeDefined();
      expect(plan.layers.technical).toBeUndefined();
      expect(plan.layers.execution).toBeUndefined();
    });

    it("应该使用指定的粒度", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1'])
      });

      const intent = {
        intent: 'CREATE_FILE',
        description: '创建网站',
        entities: {}
      };

      const plan = await planner.plan(intent, {}, { granularity: 'coarse' });

      expect(plan.granularity).toBe('coarse');
    });

    it("应该在auto模式下自动选择粒度", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1'])
      });

      const intent = {
        intent: 'ANALYZE_DATA',  // 复杂意图
        description: 'x'.repeat(150),  // 长描述
        entities: { a: 1, b: 2, c: 3 }  // 多个实体
      };

      const plan = await planner.plan(intent, {}, { granularity: 'auto' });

      expect(plan.granularity).toBe('fine');  // 应该选择细粒度
    });
  });

  describe("边界情况", () => {
    it("应该处理空实体对象", () => {
      const intent = { intent: 'CREATE_FILE' };
      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBe(0);
    });

    it("应该处理未知粒度配置", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify(['步骤1'])
      });

      const intent = { intent: 'CREATE_FILE', description: '创建' };

      // 使用不存在的粒度，应该降级到medium
      await planner.decomposeBusinessLogic(intent, {}, 'unknown_granularity');

      expect(mockLLMService.complete).toHaveBeenCalled();
    });

    it("应该处理空技术任务列表", async () => {
      const tools = await planner.decomposeToTools([], {}, 'medium');

      expect(tools).toEqual([]);
    });

    it("应该处理空业务步骤列表", async () => {
      const tasks = await planner.decomposeTechnical([], {}, 'medium');

      expect(tasks).toEqual([]);
    });

    it("应该处理TaskPlanner返回空subtasks", async () => {
      mockTaskPlanner.quickDecompose.mockResolvedValue({
        subtasks: null
      });

      const tools = await planner.taskToTools('生成网页', {});

      expect(Array.isArray(tools)).toBe(true);
    });

    it("应该处理超长输入", async () => {
      const intent = {
        intent: 'CREATE_FILE',
        description: 'x'.repeat(10000),
        entities: {}
      };

      const complexity = planner.assessComplexity(intent, {});

      expect(complexity).toBeGreaterThan(0);
      expect(complexity).toBeLessThanOrEqual(10);
    });

    it("应该处理LLM返回空字符串", async () => {
      mockLLMService.complete.mockResolvedValue({ content: '' });

      const intent = { intent: 'CREATE_FILE', description: '创建' };
      const steps = await planner.decomposeBusinessLogic(intent, {}, 'medium');

      expect(steps.length).toBeGreaterThan(0);  // 应该降级
    });
  });
});
