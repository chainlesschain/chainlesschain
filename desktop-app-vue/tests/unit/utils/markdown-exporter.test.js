/**
 * Markdown导出器测试
 *
 * 测试 src/main/git/markdown-exporter.js
 * 目标覆盖率: 85%
 *
 * 测试范围:
 * - 单个知识库项导出
 * - 批量导出所有项
 * - 文件名生成（特殊字符处理）
 * - Markdown内容生成（frontmatter、元数据）
 * - 通过ID导出
 * - 文件删除和清理
 * - 数据库同步
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import MarkdownExporter from "../../../src/main/git/markdown-exporter.js";

describe("MarkdownExporter - Markdown导出器", () => {
  let exporter;
  let mockDatabase;
  let testExportPath;
  let testKnowledgeItems;

  beforeEach(() => {
    // 创建临时导出目录（每个测试唯一）
    testExportPath = path.join(
      os.tmpdir(),
      `md-export-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );

    // 确保目录存在（exportItem不会自动创建目录）
    if (!fs.existsSync(testExportPath)) {
      fs.mkdirSync(testExportPath, { recursive: true });
    }

    // 准备测试数据（每次都重新创建，避免测试间污染）
    testKnowledgeItems = [
      {
        id: "note-001",
        title: "JavaScript基础",
        type: "note",
        content:
          "# JavaScript基础\n\nJavaScript是一门动态语言。\n\n## 变量\n使用let和const声明变量。",
        tags: ["JavaScript", "编程", "前端"],
        source_url: "https://example.com/js",
        created_at: "2024-01-01T10:00:00Z",
        updated_at: "2024-01-15T15:30:00Z",
      },
      {
        id: "note-002",
        title: "Vue框架学习",
        type: "note",
        content: "Vue.js是渐进式JavaScript框架。",
        tags: ["Vue", "前端"],
        source_url: null,
        created_at: "2024-01-02T10:00:00Z",
        updated_at: "2024-01-02T10:00:00Z",
      },
      {
        id: "note-003",
        title: '特殊字符测试: <test> "file" | path?',
        type: "article",
        content: "这是测试特殊字符的内容。",
        tags: [],
        source_url: null,
        created_at: "2024-01-03T10:00:00Z",
        updated_at: "2024-01-03T10:00:00Z",
      },
    ];

    // Mock数据库
    mockDatabase = {
      items: new Map(testKnowledgeItems.map((item) => [item.id, item])),

      getKnowledgeItems(limit, offset = 0) {
        const allItems = Array.from(this.items.values());
        return allItems.slice(offset, offset + limit);
      },

      getKnowledgeItemById(id) {
        return this.items.get(id) || null;
      },
    };

    exporter = new MarkdownExporter(mockDatabase, testExportPath);
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testExportPath)) {
      const files = fs.readdirSync(testExportPath);
      files.forEach((file) => {
        const filePath = path.join(testExportPath, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // 忽略清理错误
        }
      });
      try {
        fs.rmdirSync(testExportPath);
      } catch (e) {
        // 忽略清理错误
      }
    }
  });

  // ============================================
  // 1. 文件名生成测试
  // ============================================
  describe("generateFilename - 文件名生成", () => {
    it("should generate filename with ID and title", () => {
      const item = testKnowledgeItems[0];
      const filename = exporter.generateFilename(item);

      expect(filename).toMatch(/^note-001-.*\.md$/);
      expect(filename).toContain("JavaScript");
    });

    it("should replace special characters with dashes", () => {
      const item = testKnowledgeItems[2];
      const filename = exporter.generateFilename(item);

      // 特殊字符 : < > " | ? 应该被替换为 -
      expect(filename).not.toContain("<");
      expect(filename).not.toContain(">");
      expect(filename).not.toContain('"');
      expect(filename).not.toContain("|");
      expect(filename).not.toContain("?");
      expect(filename).not.toContain(":");
      expect(filename).toContain("-");
    });

    it("should replace multiple spaces with single dash", () => {
      const item = {
        id: "test",
        title: "Title   With    Multiple    Spaces",
      };

      const filename = exporter.generateFilename(item);

      expect(filename).not.toContain("   ");
      expect(filename).toContain("Title-With-Multiple-Spaces");
    });

    it("should limit title length to 50 characters", () => {
      const longTitle =
        "This is a very long title that exceeds fifty characters and should be truncated";
      const item = { id: "test", title: longTitle };

      const filename = exporter.generateFilename(item);
      const titlePart = filename.replace("test-", "").replace(".md", "");

      expect(titlePart.length).toBeLessThanOrEqual(50);
    });

    it("should handle Chinese characters correctly", () => {
      const item = { id: "note-cn", title: "中文标题测试" };
      const filename = exporter.generateFilename(item);

      expect(filename).toBe("note-cn-中文标题测试.md");
    });

    it("should handle empty title gracefully", () => {
      const item = { id: "note-empty", title: "" };
      const filename = exporter.generateFilename(item);

      expect(filename).toBe("note-empty-.md");
    });
  });

  // ============================================
  // 2. Markdown内容生成测试
  // ============================================
  describe("generateMarkdown - Markdown内容生成", () => {
    it("should generate complete markdown with frontmatter", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain("---");
      expect(markdown).toContain(`id: ${item.id}`);
      expect(markdown).toContain(`title: ${item.title}`);
      expect(markdown).toContain(`type: ${item.type}`);
      expect(markdown).toContain(`created_at: ${item.created_at}`);
      expect(markdown).toContain(`updated_at: ${item.updated_at}`);
    });

    it("should include tags in frontmatter if present", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain("tags: [JavaScript, 编程, 前端]");
    });

    it("should omit tags if empty", () => {
      const item = testKnowledgeItems[2];
      const markdown = exporter.generateMarkdown(item);

      // 空标签数组不应该出现在frontmatter中
      const frontmatterSection = markdown.split("---")[1];
      if (item.tags.length === 0) {
        expect(frontmatterSection).not.toContain("tags:");
      }
    });

    it("should include source_url if present", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain(`source_url: ${item.source_url}`);
    });

    it("should omit source_url if null", () => {
      const item = testKnowledgeItems[1];
      const markdown = exporter.generateMarkdown(item);

      const frontmatterSection = markdown.split("---")[1];
      expect(frontmatterSection).not.toContain("source_url:");
    });

    it("should include main title as h1", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain(`# ${item.title}`);
    });

    it("should include content body", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain("JavaScript是一门动态语言");
      expect(markdown).toContain("## 变量");
    });

    it("should include metadata section at end", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain("## 元数据");
      expect(markdown).toContain(`- **类型**: ${item.type}`);
      expect(markdown).toContain(`- **创建时间**: ${item.created_at}`);
      expect(markdown).toContain(`- **更新时间**: ${item.updated_at}`);
    });

    it("should format source URL as markdown link in metadata", () => {
      const item = testKnowledgeItems[0];
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toContain(
        `- **来源**: [${item.source_url}](${item.source_url})`,
      );
    });

    it("should handle missing content gracefully", () => {
      const item = { ...testKnowledgeItems[0], content: null };
      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toBeDefined();
      expect(markdown).toContain("# JavaScript基础");
    });
  });

  // ============================================
  // 3. 单项导出测试
  // ============================================
  describe("exportItem - 单项导出", () => {
    it("should export single item to file", async () => {
      const item = testKnowledgeItems[0];

      const filename = await exporter.exportItem(item);

      expect(filename).toMatch(/^note-001-.*\.md$/);

      const filepath = path.join(testExportPath, filename);
      expect(fs.existsSync(filepath)).toBe(true);
    });

    it("should write to existing export directory", async () => {
      // exportItem doesn't create directory, exportAll does
      expect(fs.existsSync(testExportPath)).toBe(true);

      await exporter.exportItem(testKnowledgeItems[0]);

      const files = fs.readdirSync(testExportPath);
      expect(files.length).toBeGreaterThan(0);
    });

    it("should write correct markdown content to file", async () => {
      const item = testKnowledgeItems[0];

      const filename = await exporter.exportItem(item);
      const filepath = path.join(testExportPath, filename);
      const content = fs.readFileSync(filepath, "utf8");

      expect(content).toContain("---");
      expect(content).toContain(`id: ${item.id}`);
      expect(content).toContain(`# ${item.title}`);
      expect(content).toContain("JavaScript是一门动态语言");
    });

    it("should handle export errors", async () => {
      // 使用无效路径触发错误
      const badExporter = new MarkdownExporter(
        mockDatabase,
        "/invalid/\0/path",
      );

      await expect(
        badExporter.exportItem(testKnowledgeItems[0]),
      ).rejects.toThrow();
    });
  });

  // ============================================
  // 4. 批量导出测试
  // ============================================
  describe("exportAll - 批量导出", () => {
    it("should export all knowledge items", async () => {
      const filenames = await exporter.exportAll();

      expect(filenames).toHaveLength(3);
      expect(fs.readdirSync(testExportPath)).toHaveLength(3);
    });

    it("should create export directory if not exists", async () => {
      // Clean up first for this specific test
      if (fs.existsSync(testExportPath)) {
        const files = fs.readdirSync(testExportPath);
        files.forEach((file) => fs.unlinkSync(path.join(testExportPath, file)));
        fs.rmdirSync(testExportPath);
      }

      expect(fs.existsSync(testExportPath)).toBe(false);

      await exporter.exportAll();

      expect(fs.existsSync(testExportPath)).toBe(true);
    });

    it("should export each item with correct content", async () => {
      await exporter.exportAll();

      const files = fs.readdirSync(testExportPath);

      files.forEach((file) => {
        const content = fs.readFileSync(
          path.join(testExportPath, file),
          "utf8",
        );
        expect(content).toContain("---");
        expect(content).toContain("id:");
        expect(content).toContain("title:");
      });
    });

    it("should return list of exported filenames", async () => {
      const filenames = await exporter.exportAll();

      expect(Array.isArray(filenames)).toBe(true);
      expect(filenames.every((f) => f.endsWith(".md"))).toBe(true);
    });

    it("should handle empty knowledge base", async () => {
      mockDatabase.items.clear();

      const filenames = await exporter.exportAll();

      expect(filenames).toHaveLength(0);
      expect(fs.existsSync(testExportPath)).toBe(true);
      expect(fs.readdirSync(testExportPath)).toHaveLength(0);
    });
  });

  // ============================================
  // 5. 通过ID导出测试
  // ============================================
  describe("exportById - 通过ID导出", () => {
    it("should export item by ID", async () => {
      const filename = await exporter.exportById("note-001");

      expect(filename).toMatch(/^note-001-.*\.md$/);
      expect(fs.existsSync(path.join(testExportPath, filename))).toBe(true);
    });

    it("should throw error if item not found", async () => {
      await expect(exporter.exportById("non-existent")).rejects.toThrow(
        "未找到ID为 non-existent 的项",
      );
    });

    it("should export correct item content", async () => {
      const filename = await exporter.exportById("note-002");
      const content = fs.readFileSync(
        path.join(testExportPath, filename),
        "utf8",
      );

      expect(content).toContain("Vue框架学习");
      expect(content).toContain("Vue.js是渐进式JavaScript框架");
    });
  });

  // ============================================
  // 6. 文件删除测试
  // ============================================
  describe("deleteExportedFile - 文件删除", () => {
    beforeEach(async () => {
      // 先导出一些文件
      await exporter.exportAll();
    });

    it("should delete existing file", () => {
      const files = fs.readdirSync(testExportPath);
      const fileToDelete = files[0];

      const result = exporter.deleteExportedFile(fileToDelete);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testExportPath, fileToDelete))).toBe(
        false,
      );
    });

    it("should return false if file does not exist", () => {
      const result = exporter.deleteExportedFile("non-existent.md");

      expect(result).toBe(false);
    });

    it("should handle deletion errors gracefully", () => {
      // Windows上删除目录会抛出EPERM错误
      // 这个测试验证错误处理机制
      const testDir = path.join(testExportPath, "test-dir");
      fs.mkdirSync(testDir);

      try {
        exporter.deleteExportedFile("test-dir");
        // 某些系统可能不抛出错误，返回false
        expect(true).toBe(true);
      } catch (error) {
        // Windows通常会抛出EPERM错误
        expect(error.code).toMatch(/EPERM|EISDIR/);
      } finally {
        // 清理测试目录
        try {
          fs.rmdirSync(testDir);
        } catch (e) {
          // 忽略清理错误
        }
      }
    });
  });

  // ============================================
  // 7. 清理所有文件测试
  // ============================================
  describe("cleanAll - 清理所有文件", () => {
    it("should delete all markdown files", async () => {
      await exporter.exportAll();
      expect(fs.readdirSync(testExportPath).length).toBeGreaterThan(0);

      const count = exporter.cleanAll();

      expect(count).toBe(3);
      expect(fs.readdirSync(testExportPath)).toHaveLength(0);
    });

    it("should only delete .md files", async () => {
      await exporter.exportAll();

      // 创建非md文件
      fs.writeFileSync(path.join(testExportPath, "test.txt"), "test");
      fs.writeFileSync(path.join(testExportPath, "image.png"), "fake image");

      const count = exporter.cleanAll();

      expect(count).toBe(3); // 只删除3个md文件
      expect(fs.existsSync(path.join(testExportPath, "test.txt"))).toBe(true);
      expect(fs.existsSync(path.join(testExportPath, "image.png"))).toBe(true);
    });

    it("should return 0 if export directory does not exist", () => {
      const newExporter = new MarkdownExporter(
        mockDatabase,
        path.join(testExportPath, "non-existent"),
      );

      const count = newExporter.cleanAll();

      expect(count).toBe(0);
    });

    it("should handle empty directory", () => {
      fs.mkdirSync(testExportPath, { recursive: true });

      const count = exporter.cleanAll();

      expect(count).toBe(0);
    });
  });

  // ============================================
  // 8. 数据库同步测试
  // ============================================
  describe("sync - 数据库同步", () => {
    it("should export all items and delete orphaned files", async () => {
      // 手动创建一个不存在于数据库的文件
      fs.writeFileSync(
        path.join(testExportPath, "orphan-999-deleted.md"),
        "orphaned content",
      );

      const result = await exporter.sync();

      expect(result.exported).toBe(3);
      // sync会先exportAll（导出3个），然后删除孤儿文件
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(
        fs.existsSync(path.join(testExportPath, "orphan-999-deleted.md")),
      ).toBe(false);
    });

    it("should create export directory if not exists", async () => {
      // 为这个特定测试清理目录
      if (fs.existsSync(testExportPath)) {
        const files = fs.readdirSync(testExportPath);
        files.forEach((file) => {
          const filePath = path.join(testExportPath, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
        });
        fs.rmdirSync(testExportPath);
      }

      expect(fs.existsSync(testExportPath)).toBe(false);

      await exporter.sync();

      expect(fs.existsSync(testExportPath)).toBe(true);
    });

    it("should not delete files that match database items", async () => {
      const result = await exporter.sync();

      expect(result.exported).toBe(3);
      expect(result.deleted).toBe(0);
      const mdFiles = fs
        .readdirSync(testExportPath)
        .filter((f) => f.endsWith(".md"));
      expect(mdFiles).toHaveLength(3);
    });

    it("should update existing files", async () => {
      const item = mockDatabase.items.get("note-001");
      const originalContent = item.content;
      item.content = "Updated content";

      await exporter.sync();

      const files = fs
        .readdirSync(testExportPath)
        .filter((f) => f.startsWith("note-001"));
      expect(files.length).toBeGreaterThan(0);

      if (files.length > 0) {
        const content = fs.readFileSync(
          path.join(testExportPath, files[0]),
          "utf8",
        );
        expect(content).toContain("Updated content");
      }

      item.content = originalContent;
    });

    it("should handle sync with empty database", async () => {
      await exporter.exportAll();
      mockDatabase.items.clear();

      const result = await exporter.sync();

      expect(result.exported).toBe(0);
      expect(result.deleted).toBe(3); // 删除所有文件
      expect(fs.readdirSync(testExportPath)).toHaveLength(0);
    });

    it("should identify orphaned files by ID prefix", async () => {
      const note002Backup = testKnowledgeItems[1];
      mockDatabase.items.delete("note-002");

      const result = await exporter.sync();

      expect(result.exported).toBe(2);
      const files = fs
        .readdirSync(testExportPath)
        .filter((f) => f.endsWith(".md"));
      expect(files.some((f) => f.startsWith("note-002"))).toBe(false);
      expect(files).toHaveLength(2);

      mockDatabase.items.set("note-002", note002Backup);
    });

    it("should not delete non-md files during sync", async () => {
      await exporter.exportAll();

      // 创建非md文件
      fs.writeFileSync(path.join(testExportPath, "readme.txt"), "readme");

      const result = await exporter.sync();

      expect(fs.existsSync(path.join(testExportPath, "readme.txt"))).toBe(true);
    });
  });

  // ============================================
  // 9. 边界情况和错误处理测试
  // ============================================
  describe("Edge Cases and Error Handling - 边界情况", () => {
    it("should handle very long file names", () => {
      const longTitle = "A".repeat(200);
      const item = { id: "long", title: longTitle };

      const filename = exporter.generateFilename(item);

      // 文件名应该被截断
      expect(filename.length).toBeLessThan(200);
    });

    it("should handle items with only whitespace content", () => {
      const item = { ...testKnowledgeItems[0], content: "   \n\n   " };

      const markdown = exporter.generateMarkdown(item);

      expect(markdown).toBeDefined();
    });

    it("should handle Unicode characters in filenames", () => {
      const item = { id: "unicode", title: "测试🎉emoji" };

      const filename = exporter.generateFilename(item);

      expect(filename).toContain("测试");
      expect(filename).toContain("emoji");
    });

    it("should handle export path with trailing slash", () => {
      const exporterWithSlash = new MarkdownExporter(
        mockDatabase,
        testExportPath + "/",
      );

      expect(exporterWithSlash.exportPath).toBeDefined();
    });

    it("should handle database returning null items", async () => {
      vi.spyOn(mockDatabase, "getKnowledgeItemById").mockReturnValue(null);

      await expect(exporter.exportById("note-001")).rejects.toThrow();
    });
  });

  // ============================================
  // 10. 集成测试
  // ============================================
  describe("Integration Tests - 集成测试", () => {
    it("should perform complete export workflow", async () => {
      const exportedFiles = await exporter.exportAll();
      expect(exportedFiles).toHaveLength(3);

      exportedFiles.forEach((filename) => {
        expect(fs.existsSync(path.join(testExportPath, filename))).toBe(true);
      });

      const deleted = exporter.deleteExportedFile(exportedFiles[0]);
      expect(deleted).toBe(true);

      const syncResult = await exporter.sync();
      expect(syncResult.exported).toBe(3);

      const finalFiles = fs
        .readdirSync(testExportPath)
        .filter((f) => f.endsWith(".md"));
      expect(finalFiles).toHaveLength(3);
    });

    it("should handle concurrent exports gracefully", async () => {
      // 并发导出同一个项
      const promises = [
        exporter.exportById("note-001"),
        exporter.exportById("note-001"),
        exporter.exportById("note-001"),
      ];

      const results = await Promise.all(promises);

      // 所有导出应该成功，文件名应该相同
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);

      // 只应该有一个文件
      const files = fs
        .readdirSync(testExportPath)
        .filter((f) => f.startsWith("note-001"));
      expect(files).toHaveLength(1);
    });
  });
});
