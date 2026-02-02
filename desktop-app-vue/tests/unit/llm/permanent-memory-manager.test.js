/**
 * PermanentMemoryManager 单元测试
 *
 * 测试覆盖:
 * 1. Daily Notes 读写
 * 2. MEMORY.md 读写
 * 3. saveToMemory 分类保存
 * 4. extractFromConversation 对话提取
 * 5. getMemorySections 章节解析
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";

// Mock dependencies
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/main/rag/hybrid-search-engine.js", () => ({
  HybridSearchEngine: vi.fn().mockImplementation(() => ({
    indexDocuments: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    updateWeights: vi.fn(),
    clear: vi.fn(),
  })),
}));

vi.mock("../../../src/main/llm/memory-file-watcher.js", () => ({
  MemoryFileWatcher: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
    getIndexedFiles: vi.fn().mockReturnValue([]),
    on: vi.fn(),
  })),
}));

vi.mock("../../../src/main/rag/embedding-cache.js", () => ({
  EmbeddingCache: vi.fn().mockImplementation(() => ({
    startAutoCleanup: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
    clear: vi.fn().mockReturnValue(0),
    destroy: vi.fn(),
  })),
}));

// Import after mocks
const { PermanentMemoryManager } = await import(
  "../../../src/main/llm/permanent-memory-manager.js"
);

describe("PermanentMemoryManager", () => {
  let manager;
  let testDir;
  let mockDb;

  beforeEach(async () => {
    // Create temp directory
    testDir = path.join(os.tmpdir(), `pmm-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue({ count: 0 }),
        all: vi.fn().mockReturnValue([]),
      }),
    };

    // Create manager
    manager = new PermanentMemoryManager({
      memoryDir: testDir,
      database: mockDb,
      enableAutoIndexing: false,
      enableEmbeddingCache: false,
    });

    await manager.initialize();
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    // Cleanup temp directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Daily Notes", () => {
    it("should create daily notes directory on initialization", async () => {
      const dailyDir = path.join(testDir, "daily");
      const stat = await fs.stat(dailyDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should write a new daily note", async () => {
      const content = "测试内容";
      const filePath = await manager.writeDailyNote(content);

      expect(filePath).toContain(manager.getTodayDate());
      const savedContent = await manager.readDailyNote(manager.getTodayDate());
      expect(savedContent).toContain(content);
    });

    it("should append to existing daily note", async () => {
      await manager.writeDailyNote("第一条");
      await manager.writeDailyNote("第二条", { append: true });

      const content = await manager.readDailyNote(manager.getTodayDate());
      expect(content).toContain("第一条");
      expect(content).toContain("第二条");
    });

    it("should return null for non-existent daily note", async () => {
      const content = await manager.readDailyNote("1999-01-01");
      expect(content).toBeNull();
    });
  });

  describe("MEMORY.md", () => {
    it("should create MEMORY.md on initialization", async () => {
      const content = await manager.readMemory();
      expect(content).toContain("ChainlessChain 长期记忆");
    });

    it("should have default sections", async () => {
      const content = await manager.readMemory();
      expect(content).toContain("## 🧑 用户偏好");
      expect(content).toContain("## 🏗️ 架构决策");
      expect(content).toContain("## 🐛 常见问题解决方案");
      expect(content).toContain("## 📚 重要技术发现");
      expect(content).toContain("## 🔧 系统配置");
    });

    it("should append to a specific section", async () => {
      await manager.appendToMemory("新发现内容", {
        section: "📚 重要技术发现",
      });

      const content = await manager.readMemory();
      expect(content).toContain("新发现内容");
    });

    it("should create section if not exists", async () => {
      await manager.appendToMemory("自定义内容", {
        section: "🎯 自定义章节",
      });

      const content = await manager.readMemory();
      expect(content).toContain("## 🎯 自定义章节");
      expect(content).toContain("自定义内容");
    });
  });

  describe("saveToMemory", () => {
    it("should save to daily notes by default", async () => {
      const result = await manager.saveToMemory("测试消息", { type: "daily" });

      expect(result.savedTo).toBe("daily_notes");
      expect(result.type).toBe("daily");
    });

    it("should save discovery to MEMORY.md", async () => {
      const result = await manager.saveToMemory("技术发现", {
        type: "discovery",
      });

      expect(result.savedTo).toBe("memory_md");
      expect(result.section).toContain("技术发现");

      const content = await manager.readMemory();
      expect(content).toContain("技术发现");
    });

    it("should save solution to correct section", async () => {
      const result = await manager.saveToMemory("解决方案", {
        type: "solution",
      });

      expect(result.savedTo).toBe("memory_md");
      expect(result.section).toContain("常见问题解决方案");
    });

    it("should save preference to correct section", async () => {
      const result = await manager.saveToMemory("用户偏好", {
        type: "preference",
      });

      expect(result.savedTo).toBe("memory_md");
      expect(result.section).toContain("用户偏好");
    });
  });

  describe("extractFromConversation", () => {
    it("should extract conversation to daily notes", async () => {
      const messages = [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！有什么我可以帮助你的吗？" },
      ];

      const result = await manager.extractFromConversation(messages, "测试对话");

      expect(result.savedTo).toBe("daily_notes");
      expect(result.messageCount).toBe(2);
      expect(result.title).toBe("测试对话");
    });

    it("should throw on empty messages", async () => {
      await expect(manager.extractFromConversation([], "")).rejects.toThrow(
        "消息列表为空"
      );
    });

    it("should build conversation summary correctly", async () => {
      const messages = [
        { role: "user", content: "如何使用 Vue?" },
        { role: "assistant", content: "Vue 是一个渐进式框架..." },
      ];

      await manager.extractFromConversation(messages, "Vue 学习");

      const dailyContent = await manager.readDailyNote(manager.getTodayDate());
      expect(dailyContent).toContain("Vue 学习");
      expect(dailyContent).toContain("👤 用户");
      expect(dailyContent).toContain("🤖 AI");
    });
  });

  describe("getMemorySections", () => {
    it("should return all sections", async () => {
      const sections = await manager.getMemorySections();

      expect(sections.length).toBeGreaterThanOrEqual(5);
      const titles = sections.map((s) => s.title);
      expect(titles).toContain("🧑 用户偏好");
      expect(titles).toContain("📚 重要技术发现");
    });

    it("should track section item count", async () => {
      await manager.appendToMemory("- 发现1\n- 发现2", {
        section: "📚 重要技术发现",
      });

      const sections = await manager.getMemorySections();
      const discovery = sections.find((s) => s.title.includes("技术发现"));

      expect(discovery.itemCount).toBeGreaterThanOrEqual(2);
    });

    it("should not cause infinite loop", async () => {
      // This test ensures the regex fix works
      const start = Date.now();
      const sections = await manager.getMemorySections();
      const elapsed = Date.now() - start;

      // Should complete in less than 1 second
      expect(elapsed).toBeLessThan(1000);
      expect(sections.length).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should return stats object", async () => {
      await manager.writeDailyNote("测试");

      const stats = await manager.getStats();

      expect(stats).toHaveProperty("dailyNotesCount");
      expect(stats).toHaveProperty("memorySectionsCount");
      expect(stats.dailyNotesCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getTodayDate", () => {
    it("should return date in YYYY-MM-DD format", () => {
      const today = manager.getTodayDate();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
