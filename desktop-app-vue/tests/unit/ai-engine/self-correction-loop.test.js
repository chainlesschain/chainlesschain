import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SelfCorrectionLoop 单元测试
 *
 * 测试自我修正循环系统，包括:
 * - 执行计划并自动修正
 * - 失败诊断（模式匹配 + LLM）
 * - 修正方案生成（预定义策略 + LLM）
 * - 执行历史记录和统计
 * - 配置管理
 */

describe("SelfCorrectionLoop", () => {
  let SelfCorrectionLoop;
  let loop;
  let mockLLMService;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/ai-engine/self-correction-loop.js");
    SelfCorrectionLoop = module.default;

    // Mock LLM service
    mockLLMService = {
      complete: vi.fn()
    };

    // Mock database
    mockDatabase = {
      run: vi.fn(),
      get: vi.fn()
    };

    // Create instance
    loop = new SelfCorrectionLoop(mockLLMService, mockDatabase);
  });

  describe("初始化", () => {
    it("应该正确初始化", () => {
      expect(loop.llmService).toBe(mockLLMService);
      expect(loop.database).toBe(mockDatabase);
      expect(loop.config).toBeDefined();
      expect(loop.config.maxRetries).toBe(3);
      expect(loop.config.enableLearning).toBe(true);
      expect(loop.config.saveHistory).toBe(true);
    });

    it("应该包含8种失败模式", () => {
      const patterns = Object.keys(loop.failurePatterns);
      expect(patterns).toHaveLength(8);
      expect(patterns).toContain('missing_dependency');
      expect(patterns).toContain('invalid_params');
      expect(patterns).toContain('timeout');
      expect(patterns).toContain('permission_denied');
      expect(patterns).toContain('file_not_found');
      expect(patterns).toContain('network_error');
      expect(patterns).toContain('out_of_memory');
      expect(patterns).toContain('syntax_error');
    });

    it("应该包含失败模式的策略映射", () => {
      expect(loop.failurePatterns.missing_dependency.strategy).toBe('add_dependency');
      expect(loop.failurePatterns.invalid_params.strategy).toBe('regenerate_params');
      expect(loop.failurePatterns.timeout.strategy).toBe('increase_timeout');
      expect(loop.failurePatterns.file_not_found.strategy).toBe('create_missing_file');
      expect(loop.failurePatterns.network_error.strategy).toBe('retry_with_backoff');
      expect(loop.failurePatterns.out_of_memory.strategy).toBe('reduce_batch_size');
      expect(loop.failurePatterns.syntax_error.strategy).toBe('regenerate_code');
    });
  });

  describe("executePlan - 执行计划", () => {
    it("应该执行所有步骤并返回成功结果", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' },
          { title: '步骤2', tool: 'test2' }
        ]
      };

      const executor = vi.fn()
        .mockResolvedValueOnce({ data: 'result1' })
        .mockResolvedValueOnce({ data: 'result2' });

      const result = await loop.executePlan(plan, executor);

      expect(result.totalSteps).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.allSuccess).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.failedSteps).toHaveLength(0);
      expect(executor).toHaveBeenCalledTimes(2);
    });

    it("应该处理步骤执行失败", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' },
          { title: '步骤2', tool: 'test2' }
        ]
      };

      const executor = vi.fn()
        .mockResolvedValueOnce({ data: 'result1' })
        .mockRejectedValueOnce(new Error('Step 2 failed'));

      const result = await loop.executePlan(plan, executor);

      expect(result.totalSteps).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.allSuccess).toBe(false);
      expect(result.failedSteps).toHaveLength(1);
      expect(result.failedSteps[0].error).toBe('Step 2 failed');
      expect(result.failedSteps[0].stepIndex).toBe(1);
    });

    it("应该支持plan.steps作为备用字段", async () => {
      const plan = {
        steps: [  // 使用steps而不是subtasks
          { title: '步骤1', tool: 'test1' }
        ]
      };

      const executor = vi.fn().mockResolvedValue({ data: 'result' });

      const result = await loop.executePlan(plan, executor);

      expect(result.totalSteps).toBe(1);
      expect(result.allSuccess).toBe(true);
    });

    it("应该处理空计划", async () => {
      const plan = { subtasks: [] };
      const executor = vi.fn();

      const result = await loop.executePlan(plan, executor);

      expect(result.totalSteps).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.allSuccess).toBe(true);
      expect(executor).not.toHaveBeenCalled();
    });

    it("应该记录错误堆栈", async () => {
      const plan = {
        subtasks: [{ title: '步骤1', tool: 'test1' }]
      };

      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      const executor = vi.fn().mockRejectedValue(error);

      const result = await loop.executePlan(plan, executor);

      expect(result.failedSteps[0].errorStack).toBe('Error stack trace');
    });
  });

  describe("diagnoseFailure - 失败诊断", () => {
    it("应该识别缺少依赖错误", async () => {
      const result = {
        failedSteps: [
          {
            stepIndex: 0,
            step: { title: '步骤1' },
            error: 'Cannot find module "test-package"'
          }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('missing_dependency');
      expect(diagnosis.strategy).toBe('add_dependency');
      expect(diagnosis.name).toBe('缺少依赖');
    });

    it("应该识别参数无效错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'Invalid parameter: name' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('invalid_params');
      expect(diagnosis.strategy).toBe('regenerate_params');
    });

    it("应该识别超时错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'Operation timed out' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('timeout');
      expect(diagnosis.strategy).toBe('increase_timeout');
    });

    it("应该识别权限拒绝错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'EACCES: Permission denied' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('permission_denied');
      expect(diagnosis.strategy).toBe('request_permission');
    });

    it("应该识别文件未找到错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'ENOENT: No such file or directory' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('file_not_found');
      expect(diagnosis.strategy).toBe('create_missing_file');
    });

    it("应该识别网络错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'ECONNREFUSED: Connection refused' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('network_error');
      expect(diagnosis.strategy).toBe('retry_with_backoff');
    });

    it("应该识别内存不足错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'Out of memory heap allocation' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('out_of_memory');
      expect(diagnosis.strategy).toBe('reduce_batch_size');
    });

    it("应该识别语法错误", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'SyntaxError: Unexpected token' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('syntax_error');
      expect(diagnosis.strategy).toBe('regenerate_code');
    });

    it("应该处理无失败步骤的情况", async () => {
      const result = { failedSteps: [] };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('unknown');
      expect(diagnosis.reason).toBe('无失败步骤');
    });

    it("应该在未匹配已知模式时使用LLM诊断", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'Unknown error type' }
        ]
      };

      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          pattern: 'custom_error',
          reason: 'Custom error reason',
          strategy: 'custom_strategy'
        })
      });

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('custom_error');
      expect(diagnosis.llmDiagnosed).toBe(true);
      expect(mockLLMService.complete).toHaveBeenCalled();
    });

    it("应该在LLM诊断失败时降级到默认诊断", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'Unknown error' }
        ]
      };

      mockLLMService.complete.mockRejectedValue(new Error('LLM failed'));

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('unknown');
      expect(diagnosis.strategy).toBe('retry');
    });

    it("应该匹配关键词（不区分大小写）", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: 'module NOT found' }
        ]
      };

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('missing_dependency');
    });
  });

  describe("getCorrectionStrategy - 获取修正策略", () => {
    it("应该返回add_dependency策略函数", () => {
      const strategy = loop.getCorrectionStrategy('add_dependency');
      expect(strategy).toBe(loop.correctMissingDependency);
    });

    it("应该返回regenerate_params策略函数", () => {
      const strategy = loop.getCorrectionStrategy('regenerate_params');
      expect(strategy).toBe(loop.correctInvalidParams);
    });

    it("应该返回increase_timeout策略函数", () => {
      const strategy = loop.getCorrectionStrategy('increase_timeout');
      expect(strategy).toBe(loop.correctTimeout);
    });

    it("应该返回create_missing_file策略函数", () => {
      const strategy = loop.getCorrectionStrategy('create_missing_file');
      expect(strategy).toBe(loop.correctFileNotFound);
    });

    it("应该返回retry_with_backoff策略函数", () => {
      const strategy = loop.getCorrectionStrategy('retry_with_backoff');
      expect(strategy).toBe(loop.correctNetworkError);
    });

    it("应该返回reduce_batch_size策略函数", () => {
      const strategy = loop.getCorrectionStrategy('reduce_batch_size');
      expect(strategy).toBe(loop.correctOutOfMemory);
    });

    it("应该返回regenerate_code策略函数", () => {
      const strategy = loop.getCorrectionStrategy('regenerate_code');
      expect(strategy).toBe(loop.correctSyntaxError);
    });

    it("应该在未知策略时返回null", () => {
      const strategy = loop.getCorrectionStrategy('unknown_strategy');
      expect(strategy).toBeNull();
    });
  });

  describe("correctMissingDependency - 修正缺失依赖", () => {
    it("应该在失败步骤前插入依赖安装步骤", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' },
          { title: '步骤2', tool: 'test2' }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 1 }]
      };

      const correction = await loop.correctMissingDependency(plan, {}, diagnosis);

      expect(correction.strategy).toBe('添加依赖安装步骤');
      expect(correction.plan.subtasks).toHaveLength(3);
      expect(correction.plan.subtasks[1].tool).toBe('package_installer');
      expect(correction.changes).toHaveLength(1);
    });

    it("应该在找不到失败步骤时返回无法修正", async () => {
      const plan = { subtasks: [] };
      const diagnosis = { failedSteps: [] };

      const correction = await loop.correctMissingDependency(plan, {}, diagnosis);

      expect(correction.strategy).toContain('无法修正');
    });
  });

  describe("correctInvalidParams - 修正无效参数", () => {
    it("应该清空失败步骤的参数并标记重新生成", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1', params: { old: 'value' } }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctInvalidParams(plan, {}, diagnosis);

      expect(correction.strategy).toBe('重新生成参数');
      expect(correction.plan.subtasks[0].params).toEqual({});
      expect(correction.plan.subtasks[0].regenerateParams).toBe(true);
    });
  });

  describe("correctTimeout - 修正超时", () => {
    it("应该将超时时间翻倍", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1', timeout: 10000 }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctTimeout(plan, {}, diagnosis);

      expect(correction.strategy).toBe('增加超时时间');
      expect(correction.plan.subtasks[0].timeout).toBe(20000);
    });

    it("应该在没有timeout字段时使用默认值30000", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctTimeout(plan, {}, diagnosis);

      expect(correction.plan.subtasks[0].timeout).toBe(60000);  // 30000 * 2
    });
  });

  describe("correctFileNotFound - 修正文件未找到", () => {
    it("应该在失败步骤前插入文件创建步骤", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctFileNotFound(plan, {}, diagnosis);

      expect(correction.strategy).toBe('创建缺失文件');
      expect(correction.plan.subtasks).toHaveLength(2);
      expect(correction.plan.subtasks[0].tool).toBe('file_writer');
    });
  });

  describe("correctNetworkError - 修正网络错误", () => {
    it("应该添加重试配置", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctNetworkError(plan, {}, diagnosis);

      expect(correction.strategy).toBe('网络重试（指数退避）');
      expect(correction.plan.subtasks[0].retries).toBe(3);
      expect(correction.plan.subtasks[0].retryDelay).toBe(2000);
    });
  });

  describe("correctOutOfMemory - 修正内存不足", () => {
    it("应该将批处理大小减半", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1', params: { batchSize: 100 } }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctOutOfMemory(plan, {}, diagnosis);

      expect(correction.strategy).toBe('减少批处理大小');
      expect(correction.plan.subtasks[0].params.batchSize).toBe(50);
    });

    it("应该确保批处理大小不小于10", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1', params: { batchSize: 15 } }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctOutOfMemory(plan, {}, diagnosis);

      expect(correction.plan.subtasks[0].params.batchSize).toBe(10);
    });

    it("应该在没有batchSize时使用默认值100", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1', params: {} }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctOutOfMemory(plan, {}, diagnosis);

      expect(correction.plan.subtasks[0].params.batchSize).toBe(50);  // 100 / 2
    });
  });

  describe("correctSyntaxError - 修正语法错误", () => {
    it("应该标记需要重新生成代码", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1', tool: 'test1' }
        ]
      };

      const diagnosis = {
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.correctSyntaxError(plan, {}, diagnosis);

      expect(correction.strategy).toBe('重新生成代码');
      expect(correction.plan.subtasks[0].regenerateCode).toBe(true);
      expect(correction.plan.subtasks[0].strictSyntaxCheck).toBe(true);
    });
  });

  describe("generateCorrectionPlan - 生成修正计划", () => {
    it("应该使用预定义策略", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const result = {};
      const diagnosis = {
        strategy: 'add_dependency',
        failedSteps: [{ stepIndex: 0 }]
      };

      const correction = await loop.generateCorrectionPlan(plan, result, diagnosis);

      expect(correction.strategy).toBe('添加依赖安装步骤');
    });

    it("应该在未知策略时降级到LLM修正", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const result = {};
      const diagnosis = {
        strategy: 'unknown_strategy',
        failedSteps: []
      };

      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          strategy: 'LLM generated strategy',
          plan: { subtasks: [] },
          changes: []
        })
      });

      const correction = await loop.generateCorrectionPlan(plan, result, diagnosis);

      expect(correction.strategy).toBe('LLM generated strategy');
      expect(mockLLMService.complete).toHaveBeenCalled();
    });
  });

  describe("llmBasedCorrection - 基于LLM的修正", () => {
    it("应该使用LLM生成修正方案", async () => {
      const plan = { description: 'Test plan', subtasks: [] };
      const result = { totalSteps: 1, successCount: 0, failedCount: 1 };
      const diagnosis = {
        pattern: 'test_pattern',
        reason: 'Test reason',
        failedSteps: []
      };

      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          strategy: 'LLM strategy',
          plan: { subtasks: [{ new: 'step' }] },
          changes: ['Change 1']
        })
      });

      const correction = await loop.llmBasedCorrection(plan, result, diagnosis);

      expect(correction.strategy).toBe('LLM strategy');
      expect(correction.plan.subtasks).toHaveLength(1);
      expect(correction.changes).toContain('Change 1');
    });

    it("应该在LLM失败时降级到原计划", async () => {
      const plan = { description: 'Test plan', subtasks: [] };
      const result = { totalSteps: 1, successCount: 0, failedCount: 1 };
      const diagnosis = { pattern: 'test', reason: 'test', failedSteps: [] };

      mockLLMService.complete.mockRejectedValue(new Error('LLM failed'));

      const correction = await loop.llmBasedCorrection(plan, result, diagnosis);

      expect(correction.strategy).toContain('无法生成修正方案');
      expect(correction.plan).toBe(plan);
      expect(correction.changes).toEqual([]);
    });

    it("应该在LLM返回无效JSON时降级", async () => {
      const plan = { subtasks: [] };
      const result = { totalSteps: 1, successCount: 0, failedCount: 1 };
      const diagnosis = { pattern: 'test', reason: 'test', failedSteps: [] };

      mockLLMService.complete.mockResolvedValue({
        content: 'Invalid JSON'
      });

      const correction = await loop.llmBasedCorrection(plan, result, diagnosis);

      expect(correction.strategy).toContain('无法生成修正方案');
    });
  });

  describe("executeWithCorrection - 执行并自动修正", () => {
    it("应该在第一次尝试成功时立即返回", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockResolvedValue({ data: 'success' });

      const result = await loop.executeWithCorrection(plan, executor);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.corrections).toHaveLength(0);
    });

    it("应该在失败后重试并修正", async () => {
      const plan = { subtasks: [{ title: '步骤1', tool: 'test' }] };

      const executor = vi.fn()
        .mockRejectedValueOnce(new Error('Module not found'))
        .mockResolvedValueOnce({ data: 'success' });

      const result = await loop.executeWithCorrection(plan, executor);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0].diagnosis.pattern).toBe('missing_dependency');
    });

    it("应该在达到最大重试次数后返回失败", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockRejectedValue(new Error('Always fails'));

      const result = await loop.executeWithCorrection(plan, executor, { maxRetries: 2 });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.error).toContain('2次尝试仍然失败');
    });

    it("应该调用onProgress回调", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockResolvedValue({ data: 'success' });
      const onProgress = vi.fn();

      await loop.executeWithCorrection(plan, executor, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        phase: 'executing'
      }));
    });

    it("应该调用onCorrection回调", async () => {
      const plan = { subtasks: [{ title: '步骤1', tool: 'test' }] };

      const executor = vi.fn()
        .mockRejectedValueOnce(new Error('Module not found'))
        .mockResolvedValueOnce({ data: 'success' });

      const onCorrection = vi.fn();

      await loop.executeWithCorrection(plan, executor, { onCorrection });

      expect(onCorrection).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        diagnosis: expect.any(Object),
        strategy: expect.any(String)
      }));
    });

    it("应该保存成功的执行历史", async () => {
      loop.config.saveHistory = true;
      const plan = { description: 'Test plan', subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockResolvedValue({ data: 'success' });

      mockDatabase.run.mockResolvedValue();

      await loop.executeWithCorrection(plan, executor);

      expect(mockDatabase.run).toHaveBeenCalled();
      expect(mockDatabase.run.mock.calls[0][1][6]).toBe(1);  // final_success = 1
    });

    it("应该保存失败的执行历史", async () => {
      loop.config.saveHistory = true;
      const plan = { description: 'Test plan', subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockRejectedValue(new Error('Always fails'));

      mockDatabase.run.mockResolvedValue();

      await loop.executeWithCorrection(plan, executor, { maxRetries: 1 });

      expect(mockDatabase.run).toHaveBeenCalled();
      expect(mockDatabase.run.mock.calls[0][1][6]).toBe(0);  // final_success = 0
    });
  });

  describe("saveExecutionHistory - 保存执行历史", () => {
    it("应该保存执行历史到数据库", async () => {
      const plan = { description: 'Test plan' };
      const result = {
        totalSteps: 3,
        successCount: 2,
        failedCount: 1
      };
      const corrections = [
        { attempt: 1, diagnosis: {}, strategy: 'test', changes: [] }
      ];

      mockDatabase.run.mockResolvedValue();

      await loop.saveExecutionHistory(plan, result, corrections, true);

      expect(mockDatabase.run).toHaveBeenCalled();
      const args = mockDatabase.run.mock.calls[0][1];
      expect(args[0]).toBe('Test plan');
      expect(args[1]).toBe(3);
      expect(args[2]).toBe(2);
      expect(args[3]).toBe(1);
      expect(args[4]).toBe(2);  // attempts = corrections.length + 1
      expect(args[6]).toBe(1);  // success
    });

    it("应该在没有数据库时跳过保存", async () => {
      const loopWithoutDB = new SelfCorrectionLoop(mockLLMService, null);

      await loopWithoutDB.saveExecutionHistory({}, {}, [], true);

      expect(mockDatabase.run).not.toHaveBeenCalled();
    });

    it("应该在saveHistory配置为false时跳过保存", async () => {
      loop.config.saveHistory = false;

      await loop.saveExecutionHistory({}, {}, [], true);

      expect(mockDatabase.run).not.toHaveBeenCalled();
    });

    it("应该处理数据库保存错误", async () => {
      const plan = { description: 'Test' };
      const result = { totalSteps: 1, successCount: 1, failedCount: 0 };

      mockDatabase.run.mockRejectedValue(new Error('DB error'));

      // 不应该抛出错误
      await expect(
        loop.saveExecutionHistory(plan, result, [], true)
      ).resolves.toBeUndefined();
    });
  });

  describe("getCorrectionStats - 获取修正统计", () => {
    it("应该返回修正统计", async () => {
      mockDatabase.get.mockResolvedValue({
        total_executions: 100,
        final_successes: 80,
        total_attempts: 120,
        avg_attempts: 1.2,
        corrected_count: 20
      });

      const stats = await loop.getCorrectionStats(7);

      expect(stats.totalExecutions).toBe(100);
      expect(stats.finalSuccesses).toBe(80);
      expect(stats.successRate).toBe('80.00%');
      expect(stats.totalAttempts).toBe(120);
      expect(stats.avgAttempts).toBe('1.20');
      expect(stats.correctedCount).toBe(20);
      expect(stats.correctionRate).toBe('20.00%');
    });

    it("应该在没有数据库时返回null", async () => {
      const loopWithoutDB = new SelfCorrectionLoop(mockLLMService, null);

      const stats = await loopWithoutDB.getCorrectionStats();

      expect(stats).toBeNull();
    });

    it("应该处理查询错误", async () => {
      mockDatabase.get.mockRejectedValue(new Error('Query failed'));

      const stats = await loop.getCorrectionStats();

      expect(stats).toBeNull();
    });

    it("应该处理零执行次数", async () => {
      mockDatabase.get.mockResolvedValue({
        total_executions: 0,
        final_successes: 0,
        total_attempts: 0,
        avg_attempts: 0,
        corrected_count: 0
      });

      const stats = await loop.getCorrectionStats();

      expect(stats.successRate).toBe('N/A');
      expect(stats.correctionRate).toBe('N/A');
    });

    it("应该使用指定的天数计算截止时间", async () => {
      await loop.getCorrectionStats(30);

      expect(mockDatabase.get).toHaveBeenCalled();
      const cutoff = mockDatabase.get.mock.calls[0][1][0];
      const expectedCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeCloseTo(expectedCutoff, -3);  // 精确到秒级
    });
  });

  describe("parseJSON - JSON解析", () => {
    it("应该解析有效JSON", () => {
      const result = loop.parseJSON('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it("应该从文本中提取JSON", () => {
      const text = 'Some text before {"key": "value"} some text after';
      const result = loop.parseJSON(text);
      expect(result).toEqual({ key: 'value' });
    });

    it("应该处理包含换行的JSON", () => {
      const json = '{\n  "key": "value"\n}';
      const result = loop.parseJSON(json);
      expect(result).toEqual({ key: 'value' });
    });

    it("应该在无效JSON时返回null", () => {
      const result = loop.parseJSON('invalid json');
      expect(result).toBeNull();
    });

    it("应该处理嵌套JSON", () => {
      const json = '{"outer": {"inner": "value"}}';
      const result = loop.parseJSON(json);
      expect(result).toEqual({ outer: { inner: 'value' } });
    });
  });

  describe("setConfig - 设置配置", () => {
    it("应该更新配置", () => {
      loop.setConfig({ maxRetries: 5 });
      expect(loop.config.maxRetries).toBe(5);
    });

    it("应该只更新指定的配置项", () => {
      loop.setConfig({ maxRetries: 5 });
      expect(loop.config.enableLearning).toBe(true);  // 保持原值
    });

    it("应该支持更新多个配置项", () => {
      loop.setConfig({
        maxRetries: 5,
        enableLearning: false,
        saveHistory: false
      });

      expect(loop.config.maxRetries).toBe(5);
      expect(loop.config.enableLearning).toBe(false);
      expect(loop.config.saveHistory).toBe(false);
    });
  });

  describe("getConfig - 获取配置", () => {
    it("应该返回当前配置", () => {
      const config = loop.getConfig();
      expect(config.maxRetries).toBe(3);
      expect(config.enableLearning).toBe(true);
      expect(config.saveHistory).toBe(true);
    });

    it("应该返回配置的副本", () => {
      const config = loop.getConfig();
      config.maxRetries = 999;

      expect(loop.config.maxRetries).toBe(3);  // 原配置未改变
    });
  });

  describe("边界情况", () => {
    it("应该处理空错误消息", async () => {
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: '' }
        ]
      };

      mockLLMService.complete.mockRejectedValue(new Error('LLM failed'));

      const diagnosis = await loop.diagnoseFailure(result);

      expect(diagnosis.pattern).toBe('unknown');
    });

    it("应该处理多个失败步骤", async () => {
      const plan = {
        subtasks: [
          { title: '步骤1' },
          { title: '步骤2' },
          { title: '步骤3' }
        ]
      };

      const executor = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'));

      const result = await loop.executePlan(plan, executor);

      expect(result.failedSteps).toHaveLength(3);
      expect(result.successCount).toBe(0);
    });

    it("应该处理计划没有description字段", async () => {
      loop.config.saveHistory = true;
      const plan = { subtasks: [] };
      const result = { totalSteps: 0, successCount: 0, failedCount: 0 };

      mockDatabase.run.mockResolvedValue();

      await loop.saveExecutionHistory(plan, result, [], true);

      expect(mockDatabase.run.mock.calls[0][1][0]).toBe('Unknown task');
    });

    it("应该处理executor返回undefined", async () => {
      const plan = { subtasks: [{ title: '步骤1' }] };
      const executor = vi.fn().mockResolvedValue(undefined);

      const result = await loop.executePlan(plan, executor);

      expect(result.allSuccess).toBe(true);
      expect(result.steps[0].result).toBeUndefined();
    });

    it("应该处理超长错误消息", async () => {
      const longError = 'Error: ' + 'x'.repeat(10000);
      const result = {
        failedSteps: [
          { stepIndex: 0, step: { title: '步骤1' }, error: longError }
        ]
      };

      // 不应该崩溃
      const diagnosis = await loop.diagnoseFailure(result);
      expect(diagnosis).toBeDefined();
    });
  });
});
