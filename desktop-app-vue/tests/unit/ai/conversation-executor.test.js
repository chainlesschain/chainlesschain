/**
 * ConversationExecutor (文件操作执行器) 测试
 * 测试覆盖：
 * 1. 批量操作执行
 * 2. 单个文件操作（CREATE/UPDATE/DELETE/READ）
 * 3. 操作验证
 * 4. 错误处理
 * 5. 备份功能
 * 6. 数据库日志记录
 * 7. 路径安全性检查
 * 8. 边缘情况处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";

// Mock response-parser
const mockValidateOperations = vi.fn();
vi.mock("../../src/main/ai-engine/response-parser.js", () => ({
  validateOperations: mockValidateOperations,
}));

// Import after mocking
const {
  executeOperations,
  executeOperation,
  createFile,
  updateFile,
  deleteFile,
  readFile,
  ensureLogTable,
} = await import("../../src/main/ai-engine/conversation-executor.js");

describe("ConversationExecutor", () => {
  let testDir;
  let mockDatabase;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `conv-exec-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create mock database
    mockDatabase = {
      db: {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
        exec: vi.fn(),
      },
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  // ==================== executeOperations 批量操作测试 ====================
  describe("executeOperations", () => {
    it("should execute multiple operations successfully", async () => {
      const operations = [
        { type: "CREATE", path: "test1.txt", content: "Content 1" },
        { type: "CREATE", path: "test2.txt", content: "Content 2" },
      ];

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations(operations, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("success");

      // Verify files were created
      const file1Content = await fs.readFile(
        path.join(testDir, "test1.txt"),
        "utf8",
      );
      const file2Content = await fs.readFile(
        path.join(testDir, "test2.txt"),
        "utf8",
      );
      expect(file1Content).toBe("Content 1");
      expect(file2Content).toBe("Content 2");
    });

    it("should throw error if validation fails", async () => {
      const operations = [
        { type: "CREATE", path: "../outside.txt", content: "Bad path" },
      ];

      mockValidateOperations.mockReturnValue({
        valid: false,
        errors: ["操作验证失败: 路径超出范围"],
      });

      await expect(executeOperations(operations, testDir)).rejects.toThrow(
        "操作验证失败",
      );
    });

    it("should continue execution if one operation fails", async () => {
      const operations = [
        { type: "CREATE", path: "success.txt", content: "OK" },
        { type: "READ", path: "nonexistent.txt", content: "" }, // Will fail
        { type: "CREATE", path: "success2.txt", content: "OK 2" },
      ];

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations(operations, testDir);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("error");
      expect(results[2].status).toBe("success");
    });

    it("should handle empty operations array", async () => {
      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations([], testDir);

      expect(results).toHaveLength(0);
    });

    it("should work without database instance", async () => {
      const operations = [
        { type: "CREATE", path: "test.txt", content: "Content" },
      ];

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations(operations, testDir, null);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("success");
    });
  });

  // ==================== executeOperation 单个操作测试 ====================
  describe("executeOperation", () => {
    it("should route CREATE operation correctly", async () => {
      const operation = {
        type: "CREATE",
        path: "new.txt",
        content: "New file",
      };

      const result = await executeOperation(operation, testDir);

      expect(result.status).toBe("success");
      expect(result.message).toContain("创建成功");
      expect(await fs.readFile(path.join(testDir, "new.txt"), "utf8")).toBe(
        "New file",
      );
    });

    it("should route UPDATE operation correctly", async () => {
      // Create file first
      const filePath = path.join(testDir, "update.txt");
      await fs.writeFile(filePath, "Original", "utf8");

      const operation = {
        type: "UPDATE",
        path: "update.txt",
        content: "Updated",
      };

      const result = await executeOperation(operation, testDir);

      expect(result.status).toBe("success");
      expect(result.message).toContain("更新成功");
      expect(await fs.readFile(filePath, "utf8")).toBe("Updated");
    });

    it("should route DELETE operation correctly", async () => {
      // Create file first
      const filePath = path.join(testDir, "delete.txt");
      await fs.writeFile(filePath, "To delete", "utf8");

      const operation = { type: "DELETE", path: "delete.txt" };

      const result = await executeOperation(operation, testDir);

      expect(result.status).toBe("success");
      expect(result.message).toContain("删除成功");
      expect(result.backupPath).toBeDefined();

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it("should route READ operation correctly", async () => {
      // Create file first
      const filePath = path.join(testDir, "read.txt");
      const content = "Content to read";
      await fs.writeFile(filePath, content, "utf8");

      const operation = { type: "READ", path: "read.txt" };

      const result = await executeOperation(operation, testDir);

      expect(result.status).toBe("success");
      expect(result.content).toBe(content);
      expect(result.message).toContain("读取成功");
    });

    it("should throw error for unsupported operation type", async () => {
      const operation = { type: "INVALID", path: "test.txt" };

      await expect(executeOperation(operation, testDir)).rejects.toThrow(
        "不支持的操作类型",
      );
    });
  });

  // ==================== createFile 测试 ====================
  describe("createFile", () => {
    it("should create a new file with content", async () => {
      const filePath = path.join(testDir, "create.txt");
      const content = "New file content";
      const operation = { type: "CREATE", path: "create.txt", content };

      const result = await createFile(
        filePath,
        content,
        operation,
        mockDatabase,
      );

      expect(result.status).toBe("success");
      expect(result.message).toContain("创建成功");
      expect(result.filePath).toBe(filePath);
      expect(result.size).toBeGreaterThan(0);

      const savedContent = await fs.readFile(filePath, "utf8");
      expect(savedContent).toBe(content);
    });

    it("should create parent directories if they do not exist", async () => {
      const filePath = path.join(testDir, "nested", "dir", "file.txt");
      const content = "Nested file";
      const operation = {
        type: "CREATE",
        path: "nested/dir/file.txt",
        content,
      };

      const result = await createFile(
        filePath,
        content,
        operation,
        mockDatabase,
      );

      expect(result.status).toBe("success");
      expect(await fs.readFile(filePath, "utf8")).toBe(content);
    });

    it("should convert to UPDATE if file already exists", async () => {
      const filePath = path.join(testDir, "existing.txt");
      await fs.writeFile(filePath, "Original", "utf8");

      const operation = {
        type: "CREATE",
        path: "existing.txt",
        content: "New content",
      };

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await createFile(
        filePath,
        "New content",
        operation,
        mockDatabase,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("已存在"),
      );
      expect(result.message).toContain("更新成功");
      expect(await fs.readFile(filePath, "utf8")).toBe("New content");

      consoleSpy.mockRestore();
    });

    it("should record operation in database if provided", async () => {
      const filePath = path.join(testDir, "logged.txt");
      const operation = {
        type: "CREATE",
        path: "logged.txt",
        content: "Content",
      };

      await createFile(filePath, "Content", operation, mockDatabase);

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });

    it("should handle write errors", async () => {
      const invalidPath = path.join(testDir, "\x00invalid.txt"); // Invalid filename
      const operation = {
        type: "CREATE",
        path: "\x00invalid.txt",
        content: "Content",
      };

      await expect(
        createFile(invalidPath, "Content", operation, mockDatabase),
      ).rejects.toThrow();
    });
  });

  // ==================== updateFile 测试 ====================
  describe("updateFile", () => {
    it("should update existing file with new content", async () => {
      const filePath = path.join(testDir, "update.txt");
      await fs.writeFile(filePath, "Original content", "utf8");

      const operation = {
        type: "UPDATE",
        path: "update.txt",
        content: "Updated content",
      };

      const result = await updateFile(
        filePath,
        "Updated content",
        operation,
        mockDatabase,
      );

      expect(result.status).toBe("success");
      expect(result.message).toContain("更新成功");
      expect(await fs.readFile(filePath, "utf8")).toBe("Updated content");
    });

    it("should convert to CREATE if file does not exist", async () => {
      const filePath = path.join(testDir, "newfile.txt");
      const operation = {
        type: "UPDATE",
        path: "newfile.txt",
        content: "Content",
      };

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await updateFile(
        filePath,
        "Content",
        operation,
        mockDatabase,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("不存在"),
      );
      expect(result.message).toContain("创建成功");
      expect(await fs.readFile(filePath, "utf8")).toBe("Content");

      consoleSpy.mockRestore();
    });

    it("should update file size correctly", async () => {
      const filePath = path.join(testDir, "size.txt");
      await fs.writeFile(filePath, "Short", "utf8");

      const newContent = "This is a much longer content";
      const operation = {
        type: "UPDATE",
        path: "size.txt",
        content: newContent,
      };

      const result = await updateFile(
        filePath,
        newContent,
        operation,
        mockDatabase,
      );

      expect(result.size).toBe(newContent.length);
    });

    it("should record operation in database", async () => {
      const filePath = path.join(testDir, "logged.txt");
      await fs.writeFile(filePath, "Original", "utf8");

      const operation = {
        type: "UPDATE",
        path: "logged.txt",
        content: "Updated",
      };

      await updateFile(filePath, "Updated", operation, mockDatabase);

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });
  });

  // ==================== deleteFile 测试 ====================
  describe("deleteFile", () => {
    it("should delete existing file and create backup", async () => {
      const filePath = path.join(testDir, "delete.txt");
      const content = "To be deleted";
      await fs.writeFile(filePath, content, "utf8");

      const operation = { type: "DELETE", path: "delete.txt" };

      const result = await deleteFile(filePath, operation, mockDatabase);

      expect(result.status).toBe("success");
      expect(result.message).toContain("删除成功");
      expect(result.backupPath).toBeDefined();

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();

      // Verify backup exists
      const backupContent = await fs.readFile(result.backupPath, "utf8");
      expect(backupContent).toBe(content);
    });

    it("should skip deletion if file does not exist", async () => {
      const filePath = path.join(testDir, "nonexistent.txt");
      const operation = { type: "DELETE", path: "nonexistent.txt" };

      const result = await deleteFile(filePath, operation, mockDatabase);

      expect(result.status).toBe("skipped");
      expect(result.message).toContain("不存在");
    });

    it("should record operation in database", async () => {
      const filePath = path.join(testDir, "logged.txt");
      await fs.writeFile(filePath, "Content", "utf8");

      const operation = { type: "DELETE", path: "logged.txt" };

      await deleteFile(filePath, operation, mockDatabase);

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });

    it("should handle deletion errors gracefully", async () => {
      // Try to delete a directory instead of a file
      const dirPath = path.join(testDir, "subdir");
      await fs.mkdir(dirPath);
      await fs.writeFile(path.join(dirPath, "file.txt"), "content", "utf8");

      const operation = { type: "DELETE", path: "subdir" };

      await expect(
        deleteFile(dirPath, operation, mockDatabase),
      ).rejects.toThrow();
    });
  });

  // ==================== readFile 测试 ====================
  describe("readFile", () => {
    it("should read file content successfully", async () => {
      const filePath = path.join(testDir, "read.txt");
      const content = "File content to read";
      await fs.writeFile(filePath, content, "utf8");

      const operation = { type: "READ", path: "read.txt" };

      const result = await readFile(filePath, operation, mockDatabase);

      expect(result.status).toBe("success");
      expect(result.content).toBe(content);
      expect(result.message).toContain("读取成功");
      expect(result.size).toBe(content.length);
    });

    it("should throw error if file does not exist", async () => {
      const filePath = path.join(testDir, "nonexistent.txt");
      const operation = { type: "READ", path: "nonexistent.txt" };

      await expect(readFile(filePath, operation, mockDatabase)).rejects.toThrow(
        "文件不存在",
      );
    });

    it("should read empty file successfully", async () => {
      const filePath = path.join(testDir, "empty.txt");
      await fs.writeFile(filePath, "", "utf8");

      const operation = { type: "READ", path: "empty.txt" };

      const result = await readFile(filePath, operation, mockDatabase);

      expect(result.status).toBe("success");
      expect(result.content).toBe("");
      expect(result.size).toBe(0);
    });

    it("should read large file successfully", async () => {
      const filePath = path.join(testDir, "large.txt");
      const largeContent = "x".repeat(10000);
      await fs.writeFile(filePath, largeContent, "utf8");

      const operation = { type: "READ", path: "large.txt" };

      const result = await readFile(filePath, operation, mockDatabase);

      expect(result.content).toBe(largeContent);
      expect(result.size).toBe(10000);
    });

    it("should record operation in database", async () => {
      const filePath = path.join(testDir, "logged.txt");
      await fs.writeFile(filePath, "Content", "utf8");

      const operation = { type: "READ", path: "logged.txt" };

      await readFile(filePath, operation, mockDatabase);

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });
  });

  // ==================== ensureLogTable 测试 ====================
  describe("ensureLogTable", () => {
    it("should create log table in database", async () => {
      await ensureLogTable(mockDatabase);

      expect(mockDatabase.db.exec).toHaveBeenCalled();
      const createTableSQL = mockDatabase.db.exec.mock.calls[0][0];
      expect(createTableSQL).toContain(
        "CREATE TABLE IF NOT EXISTS file_operations_log",
      );
    });

    it("should handle null database gracefully", async () => {
      await expect(ensureLogTable(null)).resolves.not.toThrow();
    });

    it("should handle invalid database gracefully", async () => {
      await expect(ensureLogTable({})).resolves.not.toThrow();
    });

    it("should handle database errors gracefully", async () => {
      const errorDb = {
        db: {
          exec: vi.fn().mockImplementation(() => {
            throw new Error("Database error");
          }),
        },
      };

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await ensureLogTable(errorDb);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ==================== 边缘情况测试 ====================
  describe("边缘情况", () => {
    it("should handle operations with special characters in content", async () => {
      const specialContent = "Special chars: \n\t\r\"'`\\${}[]";
      const operation = {
        type: "CREATE",
        path: "special.txt",
        content: specialContent,
      };

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations([operation], testDir);

      expect(results[0].status).toBe("success");
      const saved = await fs.readFile(
        path.join(testDir, "special.txt"),
        "utf8",
      );
      expect(saved).toBe(specialContent);
    });

    it("should handle operations with unicode content", async () => {
      const unicodeContent = "中文内容 😀 Ελληνικά";
      const operation = {
        type: "CREATE",
        path: "unicode.txt",
        content: unicodeContent,
      };

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations([operation], testDir);

      expect(results[0].status).toBe("success");
      const saved = await fs.readFile(
        path.join(testDir, "unicode.txt"),
        "utf8",
      );
      expect(saved).toBe(unicodeContent);
    });

    it("should handle operations with very long file paths", async () => {
      const longPath = "a/".repeat(50) + "file.txt";
      const operation = {
        type: "CREATE",
        path: longPath,
        content: "Content",
      };

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations([operation], testDir);

      expect(results[0].status).toBe("success");
    });

    it("should handle concurrent operations on different files", async () => {
      const operations = Array.from({ length: 10 }, (_, i) => ({
        type: "CREATE",
        path: `file${i}.txt`,
        content: `Content ${i}`,
      }));

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations(operations, testDir);

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.status === "success")).toBe(true);
    });

    it("should handle operations without database logging", async () => {
      const operation = {
        type: "CREATE",
        path: "nolog.txt",
        content: "No logging",
      };

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const results = await executeOperations([operation], testDir, null);

      expect(results[0].status).toBe("success");
    });

    it("should preserve file content encoding", async () => {
      const filePath = path.join(testDir, "binary.txt");
      const binaryContent = Buffer.from([0xff, 0xfe, 0xfd]).toString("utf8");

      await fs.writeFile(filePath, binaryContent, "utf8");

      const operation = { type: "READ", path: "binary.txt" };

      const result = await readFile(filePath, operation, mockDatabase);

      expect(result.content).toBe(binaryContent);
    });
  });

  // ==================== 性能测试 ====================
  describe("性能", () => {
    it("should handle batch operations efficiently", async () => {
      const operations = Array.from({ length: 100 }, (_, i) => ({
        type: "CREATE",
        path: `perf${i}.txt`,
        content: `Content ${i}`,
      }));

      mockValidateOperations.mockReturnValue({ valid: true, errors: [] });

      const startTime = Date.now();
      const results = await executeOperations(operations, testDir);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.status === "success")).toBe(true);
      // Use generous timeout for CI environments and slower systems
      expect(duration).toBeLessThan(15000); // Should complete in < 15 seconds
    }, 20000); // Increase test timeout to 20 seconds for CI environments
  });
});
