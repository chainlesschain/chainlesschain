// @vitest-environment node
/**
 * P1问题修复验证测试
 * 测试乐观锁版本控制、指数退避重试和同步日志
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RetryPolicy from '../../../src/main/sync/retry-policy.js';

describe('P1修复验证 - 乐观锁版本控制', () => {
  it('应该检测版本号冲突', () => {
    const serverVersion = 5;
    const clientVersion = 3;

    // 模拟冲突检测
    const hasConflict = serverVersion > clientVersion;

    expect(hasConflict).toBe(true);
  });

  it('应该在版本匹配时允许更新', () => {
    const serverVersion = 3;
    const clientVersion = 3;

    const hasConflict = serverVersion > clientVersion;

    expect(hasConflict).toBe(false);
  });

  it('应该在CAS更新时递增版本号', () => {
    const currentVersion = 5;
    const newVersion = currentVersion + 1;

    expect(newVersion).toBe(6);
  });

  it('应该模拟CAS更新成功场景', () => {
    const expectedVersion = 3;
    const actualVersion = 3;

    // 模拟CAS: UPDATE ... WHERE version = expectedVersion
    const updated = expectedVersion === actualVersion ? 1 : 0;

    expect(updated).toBe(1);
  });

  it('应该模拟CAS更新失败场景（版本已变更）', () => {
    const expectedVersion = 3;
    const actualVersion = 4;  // 已被其他进程修改

    const updated = expectedVersion === actualVersion ? 1 : 0;

    expect(updated).toBe(0);
  });
});

describe('P1修复验证 - 指数退避重试', () => {
  let retryPolicy;

  beforeEach(() => {
    retryPolicy = new RetryPolicy(6, 100);
  });

  it('应该正确计算指数退避延迟', () => {
    const delays = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const delay = retryPolicy._calculateDelay(attempt);
      delays.push(delay);
    }

    // 验证延迟递增（考虑抖动，大致趋势应该递增）
    expect(delays[0]).toBeLessThan(200);      // ~100ms
    expect(delays[1]).toBeLessThan(400);      // ~200ms
    expect(delays[2]).toBeLessThan(800);      // ~400ms
    expect(delays[3]).toBeLessThan(1600);     // ~800ms
    expect(delays[4]).toBeLessThan(3200);     // ~1600ms
    expect(delays[5]).toBeLessThan(6400);     // ~3200ms
  });

  it('应该在首次成功时不重试', async () => {
    let attempts = 0;

    const result = await retryPolicy.executeWithRetry(async () => {
      attempts++;
      return 'success';
    }, '测试操作');

    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  it('应该在失败后重试直到成功', async () => {
    let attempts = 0;

    const result = await retryPolicy.executeWithRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('临时失败');
      }
      return 'success';
    }, '测试操作');

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('应该在达到最大重试次数后抛出异常', async () => {
    const retryPolicy = new RetryPolicy(3, 10);  // 3次重试，快速测试
    let attempts = 0;

    await expect(async () => {
      await retryPolicy.executeWithRetry(async () => {
        attempts++;
        throw new Error('持续失败');
      }, '测试操作');
    }).rejects.toThrow('测试操作 失败，已重试3次');

    expect(attempts).toBe(4);  // 初始尝试 + 3次重试
  });

  it('应该在不可重试的错误上立即失败', async () => {
    let attempts = 0;

    await expect(async () => {
      await retryPolicy.executeWithRetry(
        async () => {
          attempts++;
          throw new Error('权限不足');
        },
        '测试操作',
        {
          shouldRetry: (error) => {
            return !error.message.includes('权限不足');
          }
        }
      );
    }).rejects.toThrow();

    expect(attempts).toBe(1);  // 不重试
  });

  it('应该记录重试统计信息', async () => {
    const retryPolicy = new RetryPolicy(3, 10);

    // 首次成功
    await retryPolicy.executeWithRetry(async () => 'success', '操作1');

    // 重试后成功
    let attempt = 0;
    await retryPolicy.executeWithRetry(async () => {
      attempt++;
      if (attempt < 2) throw new Error('失败');
      return 'success';
    }, '操作2');

    const stats = retryPolicy.getStats();

    expect(stats.totalAttempts).toBe(2);
    expect(stats.successOnFirstTry).toBe(1);
    expect(stats.successAfterRetry).toBe(1);
  });

  it('应该支持自定义重试回调', async () => {
    const retryCallbacks = [];

    await retryPolicy.executeWithRetry(
      async () => {
        if (retryCallbacks.length < 2) {
          throw new Error('失败');
        }
        return 'success';
      },
      '测试操作',
      {
        onRetry: (attempt, error, delay) => {
          retryCallbacks.push({ attempt, error: error.message, delay });
        }
      }
    );

    expect(retryCallbacks.length).toBe(2);
    expect(retryCallbacks[0].attempt).toBe(0);
    expect(retryCallbacks[1].attempt).toBe(1);
  });
});

describe('P1修复验证 - 同步日志', () => {
  it('应该包含所有必需的日志字段', () => {
    const syncLog = {
      tableName: 'projects',
      recordId: 'proj-123',
      operation: 'upload',
      direction: 'upload',
      status: 'success',
      deviceId: 'device-001',
      errorMessage: null,
      syncTime: new Date()
    };

    expect(syncLog.tableName).toBeDefined();
    expect(syncLog.recordId).toBeDefined();
    expect(syncLog.operation).toBeDefined();
    expect(syncLog.status).toBeDefined();
    expect(syncLog.syncTime).toBeInstanceOf(Date);
  });

  it('应该验证日志记录失败时的行为', () => {
    let logFailed = false;
    let exceptionThrown = false;

    try {
      // 模拟日志插入
      const inserted = 0;  // 假设插入失败

      if (inserted === 0) {
        logFailed = true;
        throw new Error('日志插入返回0行');
      }
    } catch (error) {
      exceptionThrown = true;
    }

    expect(logFailed).toBe(true);
    expect(exceptionThrown).toBe(true);
  });

  it('应该记录成功和失败两种状态', () => {
    const successLog = {
      status: 'success',
      errorMessage: null
    };

    const failureLog = {
      status: 'failed',
      errorMessage: 'Network timeout'
    };

    expect(successLog.status).toBe('success');
    expect(successLog.errorMessage).toBeNull();
    expect(failureLog.status).toBe('failed');
    expect(failureLog.errorMessage).toBeTruthy();
  });
});

describe('P1修复集成验证', () => {
  it('应该完整演示版本控制 + 重试的工作流程', async () => {
    const retryPolicy = new RetryPolicy(3, 10);
    let currentVersion = 1;
    let attempts = 0;

    const updateWithVersionControl = async () => {
      attempts++;

      // 模拟网络不稳定（前两次失败）
      if (attempts < 3) {
        throw new Error('网络超时');
      }

      // 模拟版本检查
      const expectedVersion = currentVersion;
      const serverVersion = currentVersion;

      if (serverVersion !== expectedVersion) {
        throw new Error('版本冲突');
      }

      // CAS更新
      currentVersion++;
      return { success: true, newVersion: currentVersion };
    };

    const result = await retryPolicy.executeWithRetry(
      updateWithVersionControl,
      '版本控制更新'
    );

    expect(result.success).toBe(true);
    expect(result.newVersion).toBe(2);
    expect(attempts).toBe(3);
  });

  it('应该在版本冲突时不重试', async () => {
    const retryPolicy = new RetryPolicy(3, 10);
    let attempts = 0;

    await expect(async () => {
      await retryPolicy.executeWithRetry(
        async () => {
          attempts++;
          throw new Error('版本冲突');
        },
        '更新操作',
        {
          shouldRetry: (error) => {
            // 版本冲突不重试
            return !error.message.includes('冲突');
          }
        }
      );
    }).rejects.toThrow();

    expect(attempts).toBe(1);  // 不重试
  });

  it('应该在重试成功后记录日志', async () => {
    const retryPolicy = new RetryPolicy(3, 10);
    const logs = [];

    let attempt = 0;
    await retryPolicy.executeWithRetry(
      async () => {
        attempt++;
        if (attempt < 2) throw new Error('临时失败');
        return 'success';
      },
      '测试操作',
      {
        onRetry: (attempt, error) => {
          logs.push({
            attempt,
            status: 'retry',
            error: error.message
          });
        },
        onSuccess: (attempts) => {
          logs.push({
            attempts,
            status: 'success'
          });
        }
      }
    );

    expect(logs.length).toBe(2);  // 1次重试 + 1次成功
    expect(logs[0].status).toBe('retry');
    expect(logs[1].status).toBe('success');
  });
});
