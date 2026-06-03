/**
 * 项目创建事务测试
 *
 * 测试事务性项目创建流程，确保失败时正确回滚
 *
 * @version 0.27.0
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransactionManager } from '../../../src/main/utils/transaction-manager.js';
import {
  createProjectWithTransaction,
  createQuickProjectWithTransaction,
} from '../../../src/main/project/project-creation-transaction.js';
import fs from 'fs/promises';
import path from 'path';

describe('TransactionManager 单元测试', () => {
  let transaction;

  beforeEach(() => {
    transaction = new TransactionManager('test-transaction');
  });

  test('应该成功执行并提交事务', async () => {
    const result1 = await transaction.step('step1', async () => 'result1');
    const result2 = await transaction.step('step2', async () => 'result2');

    await transaction.commit();

    expect(result1).toBe('result1');
    expect(result2).toBe('result2');
    expect(transaction.status).toBe('committed');
  });

  test('应该在步骤失败时抛出错误', async () => {
    await expect(async () => {
      await transaction.step('failing-step', async () => {
        throw new Error('Step failed');
      });
    }).rejects.toThrow('Step failed');

    expect(transaction.status).toBe('running');
    expect(transaction.error).toBeTruthy();
  });

  test('应该按相反顺序回滚步骤', async () => {
    const rollbackOrder = [];

    await transaction.step(
      'step1',
      async () => 'result1',
      async () => rollbackOrder.push('step1')
    );

    await transaction.step(
      'step2',
      async () => 'result2',
      async () => rollbackOrder.push('step2')
    );

    await transaction.step(
      'step3',
      async () => 'result3',
      async () => rollbackOrder.push('step3')
    );

    await transaction.rollback();

    expect(rollbackOrder).toEqual(['step3', 'step2', 'step1']);
    expect(transaction.status).toBe('rolled_back');
  });

  test('应该跳过没有回滚函数的步骤', async () => {
    const rollbackCalls = [];

    await transaction.step('step1', async () => 'result1', null); // 无回滚

    await transaction.step(
      'step2',
      async () => 'result2',
      async () => rollbackCalls.push('step2')
    );

    await transaction.rollback();

    expect(rollbackCalls).toEqual(['step2']);
  });

  test('应该在回滚失败时记录错误但继续回滚其他步骤', async () => {
    const rollbackCalls = [];

    await transaction.step(
      'step1',
      async () => 'result1',
      async () => {
        rollbackCalls.push('step1');
      }
    );

    await transaction.step(
      'step2',
      async () => 'result2',
      async () => {
        rollbackCalls.push('step2-before-error');
        throw new Error('Rollback failed');
      }
    );

    await transaction.step(
      'step3',
      async () => 'result3',
      async () => {
        rollbackCalls.push('step3');
      }
    );

    await expect(transaction.rollback()).rejects.toThrow('事务回滚部分失败');

    // 应该尝试回滚所有步骤，即使某些失败
    expect(rollbackCalls).toContain('step3');
    expect(rollbackCalls).toContain('step2-before-error');
    expect(rollbackCalls).toContain('step1');
  });

  test('应该正确报告事务信息', async () => {
    await transaction.step('step1', async () => 'result1');
    await transaction.step('step2', async () => 'result2');
    await transaction.commit();

    const info = transaction.getInfo();

    expect(info.name).toBe('test-transaction');
    expect(info.status).toBe('committed');
    expect(info.stepCount).toBe(2);
    expect(info.completedSteps).toBe(2);
    expect(info.duration).toBeGreaterThanOrEqual(0);
  });

  test('应该能获取步骤结果', async () => {
    await transaction.step('generate-id', async () => 'test-id-123');
    await transaction.step('create-resource', async () => ({ id: 'test-id-123' }));

    expect(transaction.getStepResult('generate-id')).toBe('test-id-123');
    expect(transaction.getStepResult('create-resource')).toEqual({ id: 'test-id-123' });
    expect(transaction.getLastResult()).toEqual({ id: 'test-id-123' });
  });
});

describe('项目创建事务集成测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectsDir;

  beforeEach(async () => {
    // 创建临时测试目录
    testProjectsDir = path.join(process.cwd(), 'tests', 'temp', 'projects-' + Date.now());
    await fs.mkdir(testProjectsDir, { recursive: true });

    // Mock HTTP 客户端
    mockHttpClient = {
      createProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    // Mock 数据库
    mockDatabase = {
      saveProject: vi.fn(),
      deleteProject: vi.fn(),
      updateProject: vi.fn(),
      saveProjectFiles: vi.fn(),
      db: {
        run: vi.fn(),
      },
    };

    // Mock 项目配置
    mockProjectConfig = {
      getProjectsRootPath: () => testProjectsDir,
    };
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await fs.rm(testProjectsDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  test('应该成功创建项目', async () => {
    const createData = {
      name: 'Test Project',
      userId: 'user-123',
    };

    const mockBackendProject = {
      id: 'project-123',
      name: 'Test Project',
      project_type: 'web',
      files: [
        {
          path: 'index.html',
          content: Buffer.from('<html></html>').toString('base64'),
          content_encoding: 'base64',
        },
      ],
    };

    mockHttpClient.createProject.mockResolvedValue(mockBackendProject);

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.id).toBe('project-123');

    // 验证调用顺序
    expect(mockHttpClient.createProject).toHaveBeenCalledWith(createData);
    expect(mockDatabase.saveProject).toHaveBeenCalled();
    expect(mockDatabase.updateProject).toHaveBeenCalled();
    expect(mockDatabase.saveProjectFiles).toHaveBeenCalled();

    // 验证目录已创建
    const projectDir = path.join(testProjectsDir, 'project-123');
    const exists = await fs.access(projectDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('应该在后端创建失败时回滚', async () => {
    const createData = {
      name: 'Test Project',
      userId: 'user-123',
    };

    mockHttpClient.createProject.mockRejectedValue(new Error('Backend error'));

    await expect(
      createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      })
    ).rejects.toThrow('Backend error');

    // 验证数据库未被调用
    expect(mockDatabase.saveProject).not.toHaveBeenCalled();

    // 验证无残留目录
    const files = await fs.readdir(testProjectsDir);
    expect(files.length).toBe(0);
  });

  test('应该在数据库保存失败时回滚', async () => {
    const createData = {
      name: 'Test Project',
      userId: 'user-123',
    };

    const mockBackendProject = {
      id: 'project-123',
      name: 'Test Project',
      project_type: 'web',
      files: [],
    };

    mockHttpClient.createProject.mockResolvedValue(mockBackendProject);
    mockDatabase.saveProject.mockRejectedValue(new Error('Database error'));

    await expect(
      createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      })
    ).rejects.toThrow('Database error');

    // 验证后端项目已被删除
    expect(mockHttpClient.deleteProject).toHaveBeenCalledWith('project-123');

    // 验证无残留目录
    const files = await fs.readdir(testProjectsDir);
    expect(files.length).toBe(0);
  });

  test('应该在文件系统创建失败时回滚', async () => {
    const createData = {
      name: 'Test Project',
      userId: 'user-123',
    };

    const mockBackendProject = {
      id: 'project-123',
      name: 'Test Project',
      project_type: 'web',
      files: [],
    };

    mockHttpClient.createProject.mockResolvedValue(mockBackendProject);

    // Mock fs.mkdir 失败
    const originalMkdir = fs.mkdir;
    fs.mkdir = vi.fn().mockRejectedValue(new Error('Disk full'));

    await expect(
      createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      })
    ).rejects.toThrow('Disk full');

    // 恢复原始函数
    fs.mkdir = originalMkdir;

    // 验证回滚
    expect(mockHttpClient.deleteProject).toHaveBeenCalledWith('project-123');
    expect(mockDatabase.deleteProject).toHaveBeenCalledWith('project-123');
  });

  test('应该在文件保存失败时回滚', async () => {
    const createData = {
      name: 'Test Project',
      userId: 'user-123',
    };

    const mockBackendProject = {
      id: 'project-123',
      name: 'Test Project',
      project_type: 'web',
      files: [{ path: 'test.txt', content: 'test' }],
    };

    mockHttpClient.createProject.mockResolvedValue(mockBackendProject);
    mockDatabase.saveProjectFiles.mockRejectedValue(new Error('File save error'));

    await expect(
      createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      })
    ).rejects.toThrow('File save error');

    // 验证完整回滚
    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
    expect(mockDatabase.deleteProject).toHaveBeenCalled();

    // 验证目录已清理
    const files = await fs.readdir(testProjectsDir);
    expect(files.length).toBe(0);
  });
});

describe('快速创建项目事务测试', () => {
  let mockDatabase;
  let mockProjectConfig;
  let testProjectsDir;

  beforeEach(async () => {
    testProjectsDir = path.join(process.cwd(), 'tests', 'temp', 'quick-projects-' + Date.now());
    await fs.mkdir(testProjectsDir, { recursive: true });

    mockDatabase = {
      saveProject: vi.fn(),
      deleteProject: vi.fn(),
      saveProjectFiles: vi.fn(),
    };

    mockProjectConfig = {
      getProjectsRootPath: () => testProjectsDir,
    };
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectsDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('应该成功快速创建项目', async () => {
    const createData = {
      name: 'Quick Test Project',
      description: 'Test description',
      userId: 'user-123',
      projectType: 'document',
    };

    const result = await createQuickProjectWithTransaction({
      createData,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.id).toBeTruthy();
    expect(result.project.name).toBe('Quick Test Project');

    // 验证数据库调用
    expect(mockDatabase.saveProject).toHaveBeenCalled();
    expect(mockDatabase.saveProjectFiles).toHaveBeenCalled();

    // 验证目录和 README 创建
    const projectDir = path.join(testProjectsDir, result.project.id);
    const readmePath = path.join(projectDir, 'README.md');

    const dirExists = await fs.access(projectDir).then(() => true).catch(() => false);
    const readmeExists = await fs.access(readmePath).then(() => true).catch(() => false);

    expect(dirExists).toBe(true);
    expect(readmeExists).toBe(true);

    const readmeContent = await fs.readFile(readmePath, 'utf-8');
    expect(readmeContent).toContain('Quick Test Project');
    expect(readmeContent).toContain('Test description');
  });

  test('应该在数据库保存失败时回滚', async () => {
    const createData = {
      name: 'Quick Test Project',
      userId: 'user-123',
    };

    mockDatabase.saveProject.mockRejectedValue(new Error('Database error'));

    await expect(
      createQuickProjectWithTransaction({
        createData,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      })
    ).rejects.toThrow('Database error');

    // 验证目录已清理
    const files = await fs.readdir(testProjectsDir);
    expect(files.length).toBe(0);
  });
});

describe('并发创建测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectsDir;

  beforeEach(async () => {
    testProjectsDir = path.join(process.cwd(), 'tests', 'temp', 'concurrent-' + Date.now());
    await fs.mkdir(testProjectsDir, { recursive: true });

    mockHttpClient = {
      createProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    mockDatabase = {
      saveProject: vi.fn(),
      deleteProject: vi.fn(),
      updateProject: vi.fn(),
      saveProjectFiles: vi.fn(),
      db: { run: vi.fn() },
    };

    mockProjectConfig = {
      getProjectsRootPath: () => testProjectsDir,
    };
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectsDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('并发创建应该产生唯一的项目ID', async () => {
    const createData = {
      name: 'Concurrent Test',
      userId: 'user-123',
    };

    // Mock 后端返回唯一 ID
    let counter = 0;
    mockHttpClient.createProject.mockImplementation(async () => ({
      id: `project-${++counter}`,
      name: 'Test',
      project_type: 'web',
      files: [],
    }));

    // 并发创建10个项目
    const promises = Array(10)
      .fill(null)
      .map(() =>
        createProjectWithTransaction({
          createData,
          httpClient: mockHttpClient,
          database: mockDatabase,
          projectConfig: mockProjectConfig,
          replaceUndefinedWithNull: (obj) => obj,
        })
      );

    const results = await Promise.allSettled(promises);

    const successIds = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value.project.id);

    // 所有成功的 ID 应该唯一
    expect(new Set(successIds).size).toBe(successIds.length);
    expect(successIds.length).toBe(10);
  });
});
