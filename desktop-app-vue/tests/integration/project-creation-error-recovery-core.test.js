/**
 * 项目创建错误恢复核心测试
 *
 * 测试项目创建的核心错误恢复场景
 *
 * @version 0.27.0
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createProjectWithTransaction } from "../../src/main/project/project-creation-transaction.js";
import fs from "fs/promises";
import path from "path";

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
    updateProject: vi.fn(() => ({ success: true })),
  };
}

describe("项目创建错误恢复 - 核心场景", () => {
  let mockHttpClient;
  let mockDatabase;
  let mockProjectConfig;
  let testProjectDir;

  beforeEach(async () => {
    testProjectDir = path.join(
      process.cwd(),
      "tests",
      "temp",
      "error-recovery-" + Date.now(),
    );
    await fs.mkdir(testProjectDir, { recursive: true });

    mockProjectConfig = {
      getProjectPath: (projectId) => path.join(testProjectDir, projectId),
      getProjectsRootPath: () => testProjectDir,
    };

    mockHttpClient = {
      createProject: vi.fn(async (data) => ({
        id: "proj-" + Date.now(),
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
    } catch (error) {
      // 忽略清理错误
    }
  });

  test("后端API失败后应该正确回滚", async () => {
    mockHttpClient.createProject = vi.fn(async () => {
      throw new Error("API Error: Internal Server Error");
    });

    const createData = { name: "API失败测试", type: "web" };

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow("API Error");

    // API失败时，后端项目未创建，所以不会调用删除
    expect(mockHttpClient.deleteProject).not.toHaveBeenCalled();
  });

  test("数据库保存失败应该回滚后端项目", async () => {
    mockDatabase.saveProject = vi.fn(async () => {
      throw new Error("Database error: Connection lost");
    });

    const createData = { name: "数据库失败测试", type: "web" };

    await expect(async () => {
      await createProjectWithTransaction({
        createData,
        httpClient: mockHttpClient,
        database: mockDatabase,
        projectConfig: mockProjectConfig,
        replaceUndefinedWithNull: (obj) => obj,
      });
    }).rejects.toThrow("Database error");

    // 数据库失败时，应该删除已创建的后端项目
    expect(mockHttpClient.deleteProject).toHaveBeenCalled();
  });

  test("应该处理包含特殊字符的项目名", async () => {
    const specialName = "项目@#$%^&*()_测试";
    const createData = { name: specialName, type: "web" };

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

  test("应该处理Unicode字符的项目名", async () => {
    const unicodeName = "项目测试🚀プロジェクト";
    const createData = { name: unicodeName, type: "web" };

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.name).toBe(unicodeName);
  });

  test("应该处理并发创建请求", async () => {
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        createProjectWithTransaction({
          createData: { name: `并发项目${i}`, type: "web" },
          httpClient: mockHttpClient,
          database: mockDatabase,
          projectConfig: mockProjectConfig,
          replaceUndefinedWithNull: (obj) => obj,
        }),
      );

    const results = await Promise.all(promises);

    expect(results.length).toBe(5);
    results.forEach((r) => expect(r.success).toBe(true));

    // 验证所有项目ID唯一
    const ids = results.map((r) => r.project.id);
    expect(new Set(ids).size).toBe(5);
  }, 10000);

  test("应该处理超长项目名称", async () => {
    const longName = "A".repeat(255);
    const createData = { name: longName, type: "web" };

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

  test("应该处理空字符串字段", async () => {
    const createData = {
      name: "空字段测试",
      type: "web",
      description: "",
      tags: "",
    };

    const result = await createProjectWithTransaction({
      createData,
      httpClient: mockHttpClient,
      database: mockDatabase,
      projectConfig: mockProjectConfig,
      replaceUndefinedWithNull: (obj) => obj,
    });

    expect(result.success).toBe(true);
    expect(result.project.description).toBe("");
  });

  test("应该处理null和undefined值", async () => {
    const createData = {
      name: "Null测试",
      type: "web",
      description: null,
      tags: undefined,
    };

    const replaceUndefinedWithNull = (obj) => {
      const result = { ...obj };
      Object.keys(result).forEach((key) => {
        if (result[key] === undefined) {
          result[key] = null;
        }
      });
      return result;
    };

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
});
