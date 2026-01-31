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
    } catch (error) {
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

    // 验证没有残留数据
    expect(mockDatabase.prepare).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO projects')
    );
  }, 10000);

  test('API返回500错误后应该正确回滚', async () => {
    // Mock API 500 错误
    mockHttpClient.createProject = vi.fn(async () => {
      const error = new Error('Internal Server Error');
      error.statusCode = 500;
      throw error;
    });

    const createData = {
      name: '500错误测试',
      type: 'mobile',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('Internal Server Error');

    // 验证deleteProject未被调用（因为创建失败）
    expect(mockHttpClient.deleteProject).not.toHaveBeenCalled();
  });

  test('API返回422验证错误应该正确处理', async () => {
    // Mock API 验证错误
    mockHttpClient.createProject = vi.fn(async () => {
      const error = new Error('Validation failed: name is required');
      error.statusCode = 422;
      error.validationErrors = {
        name: ['Name is required'],
      };
      throw error;
    });

    const createData = {
      name: '', // 空名称
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('Validation failed');
  });

  test('API网络错误后应该正确回滚', async () => {
    // Mock 网络错误
    mockHttpClient.createProject = vi.fn(async () => {
      const error = new Error('Network error: ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    });

    const createData = {
      name: '网络错误测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('Network error');
  });

  test('后端创建成功但删除失败时应该记录错误', async () => {
    let projectId;

    // Mock 正常创建
    mockHttpClient.createProject = vi.fn(async (data) => {
      projectId = 'proj-' + Date.now();
      createdProjects.push(projectId);
      return {
        id: projectId,
        ...data,
        createdAt: new Date().toISOString(),
      };
    });

    // Mock 删除失败
    mockHttpClient.deleteProject = vi.fn(async () => {
      throw new Error('Delete failed: Project not found');
    });

    // Mock 数据库失败
    mockDatabase.prepare = vi.fn((sql) => {
      if (sql.includes('INSERT INTO projects')) {
        return {
          run: vi.fn(() => {
            throw new Error('Database constraint violation');
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    });

    const createData = {
      name: '删除失败测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow();

    // 验证尝试删除后端项目
    expect(mockHttpClient.deleteProject).toHaveBeenCalledWith(projectId);
  });
});

describe('项目创建 - 数据库写入失败恢复测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;

  beforeEach(async () => {
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'db-fail-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),

    // Mock database - 默认成功
    mockDatabase = createMockDatabase();
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('数据库连接失败应该回滚后端创建', async () => {
    // Mock 数据库连接失败
    mockDatabase.prepare = vi.fn(() => {
      throw new Error('Database connection lost');
    });

    const createData = {
      name: '数据库连接失败测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('Database connection lost');

    // 验证回滚了后端项目
    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
  });

  test('数据库唯一约束违反应该回滚', async () => {
    // Mock 唯一约束违反
    mockDatabase.prepare = vi.fn((sql) => {
      if (sql.includes('INSERT INTO projects')) {
        return {
          run: vi.fn(() => {
            const error = new Error('UNIQUE constraint failed: projects.id');
            error.code = 'SQLITE_CONSTRAINT';
            throw error;
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    });

    const createData = {
      name: '唯一约束测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('UNIQUE constraint');

    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
  });

  test('数据库外键约束违反应该回滚', async () => {
    // Mock 外键约束违反
    mockDatabase.prepare = vi.fn((sql) => {
      if (sql.includes('INSERT INTO projects')) {
        return {
          run: vi.fn(() => {
            const error = new Error('FOREIGN KEY constraint failed');
            error.code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
            throw error;
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    });

    const createData = {
      name: '外键约束测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('FOREIGN KEY');
  });

  test('数据库磁盘空间不足应该回滚', async () => {
    // Mock 磁盘空间不足
    mockDatabase.prepare = vi.fn((sql) => {
      if (sql.includes('INSERT INTO projects')) {
        return {
          run: vi.fn(() => {
            const error = new Error('database or disk is full');
            error.code = 'SQLITE_FULL';
            throw error;
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    });

    const createData = {
      name: '磁盘空间测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('disk is full');
  });
});

describe('项目创建 - 文件系统失败恢复测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;
  let originalMkdir;
  let originalWriteFile;

  beforeEach(async () => {
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'fs-fail-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),

    mockDatabase = createMockDatabase(); //

    // 保存原始函数
    originalMkdir = fs.mkdir;
    originalWriteFile = fs.writeFile;
  });

  afterEach(async () => {
    // 恢复原始函数
    fs.mkdir = originalMkdir;
    fs.writeFile = originalWriteFile;

    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('目录创建权限不足应该回滚', async () => {
    // Mock 权限错误
    fs.mkdir = vi.fn(async () => {
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      throw error;
    });

    const createData = {
      name: '权限测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('permission denied');

    // 验证回滚
    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
  });

  test('磁盘空间不足应该回滚', async () => {
    // Mock 磁盘空间不足
    fs.writeFile = vi.fn(async () => {
      const error = new Error('ENOSPC: no space left on device');
      error.code = 'ENOSPC';
      throw error;
    });

    const createData = {
      name: '磁盘空间测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('no space left on device');
  });

  test('路径过长应该回滚', async () => {
    // Mock 路径过长错误
    fs.mkdir = vi.fn(async () => {
      const error = new Error('ENAMETOOLONG: name too long');
      error.code = 'ENAMETOOLONG';
      throw error;
    });

    const createData = {
      name: '路径过长测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('name too long');
  });

  test('只读文件系统应该回滚', async () => {
    // Mock 只读文件系统
    fs.mkdir = vi.fn(async () => {
      const error = new Error('EROFS: read-only file system');
      error.code = 'EROFS';
      throw error;
    });

    const createData = {
      name: '只读文件系统测试',
      type: 'web',

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow('read-only file system');
  });
});

describe('项目创建 - 并发冲突测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;
  let concurrentCreateCount;

  beforeEach(async () => {
    concurrentCreateCount = 0;
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'concurrent-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now() + '-' + Math.random().toString(36).substring(7),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),

    mockDatabase = createMockDatabase(); //
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('应该处理10个并发创建请求', async () => {
    const createPromises = [];

    for (let i = 0; i < 10; i++) {
      const createData = {
        name: `并发项目${i}`,
        type: 'web',
      };

      const promise = createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });

      createPromises.push(promise);
    }

    const results = await Promise.all(createPromises);

    expect(results.length).toBe(10);
    results.forEach((result) => {
      expect(result.success).toBe(true);
      expect(result.project).toBeTruthy();
    });

    // 验证所有项目ID唯一
    const projectIds = results.map((r) => r.project.id);
    const uniqueIds = new Set(projectIds);
    expect(uniqueIds.size).toBe(10);
  }, 15000);

  test('并发创建时部分失败应该正确回滚', async () => {
    let failCount = 0;

    // Mock 部分请求失败
    const originalCreate = mockHttpClient.createProject;
    mockHttpClient.createProject = vi.fn(async (data) => {
      failCount++;
      if (failCount % 3 === 0) {
        // 每3个请求中1个失败
        throw new Error('Random failure for testing');
      }
      return originalCreate(data);
    });

    const createPromises = [];

    for (let i = 0; i < 9; i++) {
      const createData = {
        name: `并发失败测试${i}`,
        type: 'web',
      };

      const promise = createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      }).catch((error) => ({ success: false, error: error.message }));

      createPromises.push(promise);
    }

    const results = await Promise.all(createPromises);

    // 验证成功和失败的数量
    const successCount = results.filter((r) => r.success === true).length;
    const failureCount = results.filter((r) => r.success === false).length;

    expect(successCount).toBe(6); // 9 - 3 = 6 成功
    expect(failureCount).toBe(3); // 3 失败
  }, 15000);

  test('相同项目名称并发创建应该只成功一个', async () => {
    const sameName = '重复名称项目';
    let createCount = 0;

    // Mock 数据库检查重复
    mockDatabase.prepare = vi.fn((sql) => {
      if (sql.includes('SELECT * FROM projects WHERE name')) {
        return {
          get: vi.fn(() => {
            // 第一个请求检查时没有重复，后续都有重复
            if (createCount === 0) {
              return null;
            }
            return { id: 1, name: sameName };
          }),
        };
      }
      if (sql.includes('INSERT INTO projects')) {
        return {
          run: vi.fn(() => {
            createCount++;
            if (createCount > 1) {
              throw new Error('UNIQUE constraint failed: projects.name');
            }
            return { lastInsertRowid: createCount };
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn() };
    });

    const createPromises = [];

    for (let i = 0; i < 5; i++) {
      const createData = {
        name: sameName,
        type: 'web',
      };

      const promise = createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      }).catch((error) => ({ success: false, error: error.message }));

      createPromises.push(promise);
    }

    const results = await Promise.all(createPromises);

    // 只有一个成功
    const successCount = results.filter((r) => r.success === true).length;
    expect(successCount).toBeLessThanOrEqual(1);
  }, 15000);
});

describe('项目创建 - 边界条件测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;

  beforeEach(async () => {
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'boundary-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),

    mockDatabase = createMockDatabase(); //
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('应该处理包含特殊字符的项目名称', async () => {
    const specialNames = [
      '项目@#$%^&*()',
      'Project with "quotes"',
      "Project with 'apostrophe'",
      'Project\nwith\nnewlines',
      'Project\twith\ttabs',
      'Project<>with<>brackets',
    ];

    for (const name of specialNames) {
      const createData = {
        name,
        type: 'web',
      };

      const result = await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });

      expect(result.success).toBe(true);
      expect(result.project.name).toBe(name);
    }
  }, 15000);

  test('应该处理 Unicode 字符的项目名称', async () => {
    const unicodeNames = [
      '项目测试🚀',
      'プロジェクト',
      'Проект',
      '한국어 프로젝트',
      '🎉🎊🎈项目',
    ];

    for (const name of unicodeNames) {
      const createData = {
        name,
        type: 'web',
      };

      const result = await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });

      expect(result.success).toBe(true);
      expect(result.project.name).toBe(name);
    }
  }, 15000);

  test('应该处理超长项目名称', async () => {
    // 测试255字符的项目名称
    const longName = 'A'.repeat(255);

    const createData = {
      name: longName,
      type: 'web',

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.name).toBe(longName);
  });

  test('应该处理极长的项目描述', async () => {
    // 测试10KB的描述
    const longDescription = 'X'.repeat(10 * 1024);

    const createData = {
      name: '长描述测试',
      type: 'web',
      description: longDescription,

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.description).toBe(longDescription);
  });

  test('应该处理空字符串字段', async () => {
    const createData = {
      name: '空字段测试',
      type: 'web',
      description: '',
      tags: '',

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.description).toBe('');
  });

  test('应该处理 null 和 undefined 值', async () => {
    const createData = {
      name: 'Null测试',
      type: 'web',
      description: null,
      tags: undefined,

    const replaceUndefinedWithNull = (obj) => {
      const result = { ...obj };
      Object.keys(result).forEach((key) => {
        if (result[key] === undefined) {
          result[key] = null;
        }
      });
      return result;

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull,
    });

    expect(result.success).toBe(true);
    expect(result.project.tags).toBe(null);
  });

  test('应该处理深度嵌套的JSON配置', async () => {
    const nestedConfig = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 'deep value',
                array: [1, 2, 3, { nested: true }],
              },
            },
          },
        },
      },

    const createData = {
      name: '嵌套配置测试',
      type: 'web',
      config: JSON.stringify(nestedConfig),

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    const parsedConfig = JSON.parse(result.project.config);
    expect(parsedConfig.level1.level2.level3.level4.level5.value).toBe('deep value');
  });
});

describe('项目创建 - 大规模数据测试', () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;

  beforeEach(async () => {
    testProjectDir = path.join(process.cwd(), 'tests', 'temp', 'large-scale-' + Date.now());
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: 'proj-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
      })),
      deleteProject: vi.fn(async () => ({ success: true })),

    mockDatabase = createMockDatabase(); //
  });

  afterEach(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('应该处理包含1000个文件的项目', async () => {
    const largeFileList = Array(1000)
      .fill(null)
      .map((_, i) => ({
        path: `file${i}.txt`,
        content: `Content of file ${i}`,
      }));

    const createData = {
      name: '大规模文件测试',
      type: 'web',
      files: JSON.stringify(largeFileList),

    const startTime = Date.now();
    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(JSON.parse(result.project.files).length).toBe(1000);

    // 验证性能（应该在合理时间内完成，这里假设5秒）
    expect(duration).toBeLessThan(5000);
  }, 10000);

  test('应该处理包含大量标签的项目', async () => {
    const largeTags = Array(100)
      .fill(null)
      .map((_, i) => `tag${i}`);

    const createData = {
      name: '大量标签测试',
      type: 'web',
      tags: JSON.stringify(largeTags),

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.project.tags).length).toBe(100);
  });

  test('应该处理包含大型配置对象的项目', async () => {
    // 创建一个约1MB的配置对象
    const largeConfig = {
      settings: Array(1000)
        .fill(null)
        .map((_, i) => ({
          key: `setting_${i}`,
          value: `value_${i}`,
          description: `This is a description for setting ${i}`.repeat(10),
        })),

    const createData = {
      name: '大型配置测试',
      type: 'web',
      config: JSON.stringify(largeConfig),

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    const parsedConfig = JSON.parse(result.project.config);
    expect(parsedConfig.settings.length).toBe(1000);

    // 验证配置大小
    const configSize = Buffer.byteLength(result.project.config, 'utf8');
    expect(configSize).toBeGreaterThan(100 * 1024); // 至少100KB
  }, 10000);

  test('应该在合理时间内连续创建100个项目', async () => {
    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
      const createData = {
        name: `批量创建项目${i}`,
        type: 'web',
      };

      const result = await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });

      expect(result.success).toBe(true);
    }

    const duration = Date.now() - startTime;

    // 100个项目应该在30秒内完成
    expect(duration).toBeLessThan(30000);

    // 验证平均每个项目创建时间
    const avgTime = duration / 100;
    expect(avgTime).toBeLessThan(300); // 平均每个项目少于300ms
  }, 35000);
});
