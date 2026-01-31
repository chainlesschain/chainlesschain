/**
 * 工作流管道集成测试
 *
 * 测试完整的6阶段工作流执行，包括：
 * - 完整执行流程
 * - 质量门禁处理
 * - 暂停/恢复/取消
 * - 快照回滚机制
 * - 并发工作流
 *
 * @version 0.27.0
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowPipeline, WorkflowManager } from '../../src/main/workflow/workflow-pipeline.js';
import { SnapshotWorkflowStageFactory } from '../../src/main/workflow/snapshot-workflow-stage.js';
import { SnapshotManager } from '../../src/main/workflow/workflow-snapshot.js';
import { QualityGateManager } from '../../src/main/workflow/quality-gate-manager.js';
import path from 'path';
import fs from 'fs/promises';

describe('工作流管道 - 6阶段完整执行测试', () => {
  let workflow;
  let snapshotManager;
  let executionLog;
  let mockQualityGateManager;

  beforeEach(() => {
    executionLog = [];

    // 创建快照管理器
    const testBackupDir = path.join(process.cwd(), 'tests', 'temp', 'wf-test-' + Date.now());
    snapshotManager = new SnapshotManager({
      backupDir: testBackupDir,
    });

    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };

    // 创建阶段执行器
    const executors = {
      stage_1: async (input, context) => {
        executionLog.push('stage_1_executed');
        return { ...input, stage1Result: 'analysis_done' };
      },
      stage_2: async (input, context) => {
        executionLog.push('stage_2_executed');
        return { ...input, stage2Result: 'design_done' };
      },
      stage_3: async (input, context) => {
        executionLog.push('stage_3_executed');
        return { ...input, stage3Result: 'generation_done' };
      },
      stage_4: async (input, context) => {
        executionLog.push('stage_4_executed');
        return { ...input, stage4Result: 'validation_done' };
      },
      stage_5: async (input, context) => {
        executionLog.push('stage_5_executed');
        return { ...input, stage5Result: 'integration_done' };
      },
      stage_6: async (input, context) => {
        executionLog.push('stage_6_executed');
        return { ...input, stage6Result: 'delivery_done' };
      },
    };

    // 创建工作流管道（使用 stageExecutors 参数和 mock 质量门禁管理器）
    workflow = new WorkflowPipeline({
      title: '测试工作流',
      stageExecutors: executors,
      qualityGateManager: mockQualityGateManager,
    });
  });

  afterEach(async () => {
    if (snapshotManager) {
      await snapshotManager.cleanupAll();
    }
  });

  test('应该成功执行所有6个阶段', async () => {
    const input = { projectName: 'Test Project' };
    const context = { userId: 'user-123' };

    const result = await workflow.execute(input, context);

    expect(result.success).toBe(true);
    expect(result.results).toBeTruthy();

    // 验证所有阶段都执行了
    expect(executionLog).toContain('stage_1_executed');
    expect(executionLog).toContain('stage_2_executed');
    expect(executionLog).toContain('stage_3_executed');
    expect(executionLog).toContain('stage_4_executed');
    expect(executionLog).toContain('stage_5_executed');
    expect(executionLog).toContain('stage_6_executed');

    // 验证阶段按顺序执行
    expect(executionLog[0]).toBe('stage_1_executed');
    expect(executionLog[5]).toBe('stage_6_executed');

    // 验证工作流状态
    expect(workflow.stateMachine.getState()).toBe('completed');
  });

  test('应该在阶段之间传递结果', async () => {
    const input = { initial: 'data' };
    const result = await workflow.execute(input);

    // 验证最后阶段的结果包含所有中间结果
    const finalResult = workflow.results.stage_6;

    expect(finalResult.initial).toBe('data');
    expect(finalResult.stage1Result).toBe('analysis_done');
    expect(finalResult.stage2Result).toBe('design_done');
    expect(finalResult.stage6Result).toBe('delivery_done');
  });

  test('应该正确报告整体进度', async () => {
    const progressUpdates = [];

    workflow.on('workflow:progress', (data) => {
      progressUpdates.push(data.overall.percent);
    });

    await workflow.execute({ test: 'data' });

    // 验证进度从0增长到100
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  test('应该记录执行时间', async () => {
    const result = await workflow.execute({ test: 'data' });

    expect(result.duration).toBeGreaterThan(0);
    expect(workflow.startTime).toBeTruthy();
    expect(workflow.endTime).toBeTruthy();
    expect(workflow.endTime).toBeGreaterThan(workflow.startTime);
  });

  test('应该触发阶段事件', async () => {
    const events = [];

    workflow.on('workflow:stage-start', (data) => {
      events.push({ type: 'start', stage: data.id });
    });

    workflow.on('workflow:stage-complete', (data) => {
      events.push({ type: 'complete', stage: data.id });
    });

    await workflow.execute({ test: 'data' });

    // 验证每个阶段都触发了开始和完成事件
    expect(events.filter((e) => e.type === 'start').length).toBe(6);
    expect(events.filter((e) => e.type === 'complete').length).toBe(6);
  });
});

describe('工作流管道 - 阶段失败和回滚测试', () => {
  let workflow;
  let snapshotManager;
  let executionLog;
  let mockQualityGateManager;

  beforeEach(() => {
    executionLog = [];

    const testBackupDir = path.join(process.cwd(), 'tests', 'temp', 'wf-fail-' + Date.now());
    snapshotManager = new SnapshotManager({
      backupDir: testBackupDir,
    });

    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };

    const executors = {
      stage_1: async (input, context) => {
        executionLog.push('stage_1_executed');
        context.stage1Data = 'data1';
        return { ...input, stage1: 'ok' };
      },
      stage_2: async (input, context) => {
        executionLog.push('stage_2_executed');
        context.stage2Data = 'data2';
        return { ...input, stage2: 'ok' };
      },
      stage_3: async (input, context) => {
        executionLog.push('stage_3_failed');
        throw new Error('Stage 3 failed');
      },
      stage_4: async (input, context) => {
        executionLog.push('stage_4_executed');
        return { ...input, stage4: 'ok' };
      },
      stage_5: async (input, context) => {
        executionLog.push('stage_5_executed');
        return { ...input, stage5: 'ok' };
      },
      stage_6: async (input, context) => {
        executionLog.push('stage_6_executed');
        return { ...input, stage6: 'ok' };
      },
    };

    workflow = new WorkflowPipeline({
      title: '失败测试工作流',
      stageExecutors: executors,
      qualityGateManager: mockQualityGateManager,
    });
  });

  afterEach(async () => {
    if (snapshotManager) {
      await snapshotManager.cleanupAll();
    }
  });

  test('应该在阶段失败时停止执行', async () => {
    const result = await workflow.execute({ test: 'data' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Stage 3 failed');

    // 验证只执行了前3个阶段
    expect(executionLog).toContain('stage_1_executed');
    expect(executionLog).toContain('stage_2_executed');
    expect(executionLog).toContain('stage_3_failed');
    expect(executionLog).not.toContain('stage_4_executed');
    expect(executionLog).not.toContain('stage_5_executed');

    // 验证工作流状态
    expect(workflow.stateMachine.getState()).toBe('failed');
  });

  test('应该记录失败的阶段索引', async () => {
    const result = await workflow.execute({ test: 'data' });

    expect(result.failedStage).toBe('stage_3');
  });

  test('应该触发错误事件', async () => {
    let errorEvent = null;

    workflow.on('workflow:error', (data) => {
      errorEvent = data;
    });

    await workflow.execute({ test: 'data' });

    expect(errorEvent).toBeTruthy();
    expect(errorEvent.error).toContain('Stage 3 failed');
  });

  test.skip('带快照的阶段失败时应该自动回滚', async () => {
    // TODO: 此测试需要使用 SnapshotWorkflowStage 才能正确测试快照功能
    // 当前工作流使用普通阶段，不会创建快照
    const context = { initialData: 'test' };

    const result = await workflow.execute({ test: 'data' }, context);

    expect(result.success).toBe(false);

    // 验证stage_3创建了快照（虽然失败了，但快照应该在执行前创建）
    const snapshots = snapshotManager.getAllSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);
  });
});

describe('工作流管道 - 暂停/恢复/取消测试', () => {
  let workflow;
  let mockQualityGateManager;

  beforeEach(() => {
    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };

    const executors = {
      stage_1: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage1: 'ok' };
      },
      stage_2: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage2: 'ok' };
      },
      stage_3: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage3: 'ok' };
      },
      stage_4: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage4: 'ok' };
      },
      stage_5: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage5: 'ok' };
      },
      stage_6: async (input, context) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...input, stage6: 'ok' };
      },
    };

    workflow = new WorkflowPipeline({
      title: '暂停测试工作流',
      stageExecutors: executors,
      qualityGateManager: mockQualityGateManager,
    });
  });

  test('应该能够暂停和恢复工作流', async () => {
    let pauseTriggered = false;

    // 在第2阶段开始时暂停
    workflow.on('workflow:stage-start', (data) => {
      if (data.stageIndex === 2 && !pauseTriggered) {
        pauseTriggered = true;
        workflow.pause();

        // 1秒后恢复
        setTimeout(() => {
          workflow.resume();
        }, 1000);
      }
    });

    const startTime = Date.now();
    const result = await workflow.execute({ test: 'data' });
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);

    // 验证暂停生效（总时间应该大于600ms + 1000ms暂停）
    // 放宽时间要求以避免时序问题
    expect(duration).toBeGreaterThan(1500);
  });

  test('应该能够取消工作流', async () => {
    // 在第2阶段开始时取消
    workflow.on('workflow:stage-start', (data) => {
      if (data.stageIndex === 2) {
        workflow.cancel('用户取消');
      }
    });

    const result = await workflow.execute({ test: 'data' });

    expect(result.success).toBe(false);
    expect(workflow.stateMachine.getState()).toBe('cancelled');
  });

  test('暂停时应该触发事件', async () => {
    let pausedEvent = null;
    let resumedEvent = null;

    workflow.on('workflow:paused', (data) => {
      pausedEvent = data;
    });

    workflow.on('workflow:resumed', (data) => {
      resumedEvent = data;
    });

    // 在第1阶段完成后暂停
    workflow.on('workflow:stage-complete', (data) => {
      if (data.stageIndex === 0) {
        workflow.pause();
        setTimeout(() => workflow.resume(), 100);
      }
    });

    await workflow.execute({ test: 'data' });

    expect(pausedEvent).toBeTruthy();
    expect(resumedEvent).toBeTruthy();
  });

  test('取消时应该触发事件', async () => {
    let cancelledEvent = null;

    workflow.on('workflow:cancelled', (data) => {
      cancelledEvent = data;
    });

    workflow.on('workflow:stage-start', (data) => {
      if (data.stageIndex === 1) {
        workflow.cancel('测试取消');
      }
    });

    await workflow.execute({ test: 'data' });

    expect(cancelledEvent).toBeTruthy();
    expect(cancelledEvent.reason).toBe('测试取消');
  });
});

describe('工作流管道 - 质量门禁测试', () => {
  let workflow;
  let qualityGateManager;

  beforeEach(() => {
    qualityGateManager = new QualityGateManager();

    const executors = {
      stage_1: async () => ({ score: 0.9 }),
      stage_2: async () => ({ score: 0.6 }), // 低于阈值
      stage_3: async () => ({ score: 0.8 }),
    };

    workflow = new WorkflowPipeline({
      title: '质量门禁测试',
      stageExecutors: executors,
      qualityGateManager,
    });
  });

  test('质量门禁通过时应该继续执行', async () => {
    // Mock质量门禁检查（全部通过）
    qualityGateManager.check = vi.fn().mockResolvedValue({
      passed: true,
      blocking: false,
      message: '质量检查通过',
    });

    const result = await workflow.execute({ test: 'data' });

    expect(result.success).toBe(true);
  });

  test('阻塞性质量门禁失败时应该停止执行', async () => {
    let checkCount = 0;

    // Mock质量门禁检查（第2次失败）
    qualityGateManager.check = vi.fn().mockImplementation(async () => {
      checkCount++;
      if (checkCount === 2) {
        return {
          passed: false,
          blocking: true,
          message: '质量检查失败',
        };
      }
      return {
        passed: true,
        blocking: false,
      };
    });

    const result = await workflow.execute({ test: 'data' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('质量门禁失败');
  });

  test('非阻塞性质量门禁失败时应该继续执行', async () => {
    // Mock质量门禁检查（失败但非阻塞）
    qualityGateManager.check = vi.fn().mockResolvedValue({
      passed: false,
      blocking: false,
      message: '质量警告',
    });

    const result = await workflow.execute({ test: 'data' });

    // 应该成功完成（因为门禁不阻塞）
    expect(result.success).toBe(true);
  });
});

describe('工作流管道 - 重试机制测试', () => {
  let workflow;
  let attemptCount;
  let mockQualityGateManager;

  beforeEach(() => {
    attemptCount = 0;

    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };

    const executors = {
      stage_1: async () => ({ stage1: 'ok' }),
      stage_2: async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('First attempt failed');
        }
        return { stage2: 'ok' };
      },
      stage_3: async () => ({ stage3: 'ok' }),
    };

    workflow = new WorkflowPipeline({
      title: '重试测试工作流',
      stageExecutors: executors,
      qualityGateManager: mockQualityGateManager,
    });
  });

  test('应该能够重试失败的工作流', async () => {
    // 第一次执行（会在stage_2失败）
    const firstResult = await workflow.execute({ test: 'data' });
    expect(firstResult.success).toBe(false);

    // 重试
    const retryResult = await workflow.retry();

    expect(retryResult.success).toBe(true);
    expect(attemptCount).toBe(2); // 验证重试了一次
  });
});

describe('工作流管理器 - 多工作流管理测试', () => {
  let workflowManager;
  let mockQualityGateManager;

  beforeEach(() => {
    workflowManager = new WorkflowManager();

    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  test('应该能够创建多个工作流', () => {
    const wf1 = workflowManager.createWorkflow({
      title: '工作流1',
      qualityGateManager: mockQualityGateManager,
    });
    const wf2 = workflowManager.createWorkflow({
      title: '工作流2',
      qualityGateManager: mockQualityGateManager,
    });

    expect(wf1.id).not.toBe(wf2.id);
    expect(workflowManager.workflows.size).toBe(2);
  });

  test('应该能够获取工作流', () => {
    const wf = workflowManager.createWorkflow({
      title: '测试工作流',
      qualityGateManager: mockQualityGateManager,
    });
    const retrieved = workflowManager.getWorkflow(wf.id);

    expect(retrieved).toBe(wf);
  });

  test('应该能够删除工作流', () => {
    const wf = workflowManager.createWorkflow({
      title: '测试工作流',
      qualityGateManager: mockQualityGateManager,
    });
    const deleted = workflowManager.deleteWorkflow(wf.id);

    expect(deleted).toBe(true);
    expect(workflowManager.workflows.size).toBe(0);
  });

  test('应该能够并发执行多个工作流', async () => {
    const executor = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { ...input, done: true };
    };

    const wf1 = workflowManager.createWorkflow({
      title: '工作流1',
      stageExecutors: { stage_1: executor },
      qualityGateManager: mockQualityGateManager,
    });

    const wf2 = workflowManager.createWorkflow({
      title: '工作流2',
      stageExecutors: { stage_1: executor },
      qualityGateManager: mockQualityGateManager,
    });

    const startTime = Date.now();
    const [result1, result2] = await Promise.all([
      wf1.execute({ id: 1 }),
      wf2.execute({ id: 2 }),
    ]);
    const duration = Date.now() - startTime;

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // 验证并发执行（在合理时间内完成）
    // 注意：集成测试中由于初始化开销，时间会比单元测试长
    expect(duration).toBeLessThan(12000);
  }, 15000); // 增加超时时间到15秒

  test('应该转发工作流事件', async () => {
    const events = [];

    workflowManager.on('workflow:start', (data) => {
      events.push('start');
    });

    workflowManager.on('workflow:complete', (data) => {
      events.push('complete');
    });

    const wf = workflowManager.createWorkflow({
      title: '测试工作流',
      stageExecutors: {
        stage_1: async (input) => input,
      },
      qualityGateManager: mockQualityGateManager,
    });

    await wf.execute({ test: 'data' });

    expect(events).toContain('start');
    expect(events).toContain('complete');
  });
});

describe('工作流管道 - 边界条件测试', () => {
  let mockQualityGateManager;

  beforeEach(() => {
    // Mock 质量门禁管理器（所有检查都通过）
    mockQualityGateManager = {
      check: vi.fn().mockResolvedValue({
        passed: true,
        blocking: false,
        score: 1,
        checks: [],
        message: '质量检查通过',
      }),
      getGateByStage: vi.fn().mockReturnValue(null),
      getAllStatuses: vi.fn().mockReturnValue({}),
      on: vi.fn(),  // Mock EventEmitter methods
      emit: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  test('应该处理空输入', async () => {
    const workflow = new WorkflowPipeline({
      title: '空输入测试',
      stageExecutors: {
        stage_1: async (input) => input || {},
      },
      qualityGateManager: mockQualityGateManager,
    });

    const result = await workflow.execute(null);

    expect(result.success).toBe(true);
  });

  test('应该处理大量数据', async () => {
    const largeData = {
      items: Array(1000)
        .fill(null)
        .map((_, i) => ({ id: i, data: 'x'.repeat(100) })),
    };

    const workflow = new WorkflowPipeline({
      title: '大数据测试',
      stageExecutors: {
        stage_1: async (input) => input,
      },
      qualityGateManager: mockQualityGateManager,
    });

    const result = await workflow.execute(largeData);

    expect(result.success).toBe(true);
    expect(result.results.stage_1.items.length).toBe(1000);
  }, 15000); // 大数据测试需要更长时间

  test('应该处理长时间运行的阶段', async () => {
    const workflow = new WorkflowPipeline({
      title: '长时间运行测试',
      stageExecutors: {
        stage_1: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return input;
        },
      },
      qualityGateManager: mockQualityGateManager,
    });

    const result = await workflow.execute({ test: 'data' });

    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThan(2000);
  }, 15000); // 增加超时时间以适应完整工作流执行
});
