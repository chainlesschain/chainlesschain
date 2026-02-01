/**
 * 项目创建错误恢复集成测试
 *
 * 测试项目创建流程在各种错误场景下的恢复能力：
 * - 后端API失败场景
 * - 数据库写入失败场景
 * - 文件系统写入失败场景
 * - 并发创建冲突场景
 * - 边界条件（特殊字符、超长路径等）
 * - 大规模数据测试
 *
 * @version 0.27.0
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createProjectWithTransaction,
  createQuickProjectWithTransaction,
} from '../../src/main/project/project-creation-transaction.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 创建标准的mock数据库对象
 */
function createMockDatabase() {
  return {
    prepare: vi.fn((sql) => ({
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
      get: vi.fn(() => null),
    })),
    saveProject: vi.fn(async () => ({ success: true })),
    saveProjectFiles: vi.fn(async () => ({ success: true })),
    deleteProject: vi.fn(async () => ({ success: true })),
  };
}

describe('项目创建 - 后端API失败恢复测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;
  let createdProjects;

  beforeEach(async () => {
    createdProjects = [];
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'api-fail-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    // Mock project config
    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    // Mock database
    mockDatabase = createMockDatabase();

    // Mock HTTP client - 默认成功
    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async (id) => {
        createdProjects = createdProjects.filter((p) => p !== id);
        return { success: true };
      }),
  });

  afterEach(async () => {
    // 清理测试数据
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (_error) {
      // 忽略清理错误
    }
  });

  test('API超时后应该正确回滚', async () => {
    // Mock API 超时
    mockHttpClient.createProject = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new Error('API timeout: Request timed out after 5000ms');
    });

    const createData = {
      name: '超时测试项目',
      type: 'web',
      description: 'API超时测试',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('API timeout');


describe('项目创建错误恢复 - 核心场景总结', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;

  beforeEach(async () => {
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'error-recovery-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),
    };

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),
    };

    mockDatabase = createMockDatabase();
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (_error) {
      // 忽略
    }
  });

  test('【关键】API失败后应该正确回滚', async () => {
    mockHttpClient.createProject = vi.fn(async () => {
      throw new Error('API Error: Internal Server Error');
    });

    const createData = { name: 'API失败测试', type: 'web' };

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('API Error');

    expect(mockHttpClient.deleteProject).not.toHaveBeenCalled();
  });

  test('【关键】数据库失败应该回滚后端项目', async () => {
    mockDatabase.saveProject = vi.fn(async () => {
      throw new Error('Database error: Connection lost');
    });

    const createData = { name: '数据库失败测试', type: 'web' };

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('Database error');

    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
  });

  test('【关键】处理特殊字符项目名', async () => {
    const specialName = '项目@#$%^&*()_测试';
    const createData = { name: specialName, type: 'web' };

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.name).toBe(specialName);
  });

  test('【关键】处理并发创建请求', async () => {
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        createProjectWithTransaction({
          createData: { name: `并发项目${i}`, type: 'web' },
          httpClient: mockHttpClient,
          database: mockDatabase,
          projectConfig: mockProjectConfig,
          replaceUndefinedWithNull: (obj) => obj,
        })
      );

    const results = await Promise.all(promises);
    
    expect(results.length).toBe(5);
    results.forEach((r) => expect(r.success).toBe(true));
    
    const ids = results.map((r) => r.project.id);
    expect(new Set(ids).size).toBe(5);
  }, 10000);
});
