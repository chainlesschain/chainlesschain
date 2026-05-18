/**
 * Review System IPC 单元测试
 * 测试10个评价反馈系统 IPC handlers 的注册
 *
 * JSDoc 注释 - CommonJS Mock 限制：
 * =====================================
 * 本测试文件采用轻量级方式验证 IPC handlers 的存在和注册。
 *
 * CommonJS 模块系统的限制：
 * 1. CommonJS require() 会在模块加载时立即执行，不受 Vitest 的 vi.mock() 影响
 * 2. 模块缓存导致无法在运行时切换 mock 的依赖
 * 3. 因此无法直接测试 registerReviewIPC() 函数的执行逻辑
 *
 * 解决方案：
 * 1. 通过静态分析源代码来验证 IPC handlers 的注册
 * 2. 验证所有声明的 handler channel 名称和数量
 * 3. 确保命名规范一致（kebab-case）
 * 4. 验证处理器函数的文档注释完整性
 *
 * 动态执行逻辑的测试应该在对应的业务模块单元测试中进行。
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 获取源文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REVIEW_IPC_PATH = path.resolve(
  __dirname,
  "../../../src/main/code-tools/review-ipc.js",
);

/**
 * 从源文件中提取 ipcMain.handle() 调用
 * 识别所有 handler 注册的 channel 名称
 */
function extractIPCHandlers(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

  // 匹配 ipcMain.handle('channel-name', ...) 的模式
  // 支持多行格式（channel名称可能在下一行）
  const handlerPattern = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;

  const handlers = [];
  let match;
  while ((match = handlerPattern.exec(content)) !== null) {
    handlers.push(match[1]);
  }

  return handlers;
}

/**
 * 从源文件中提取每个 handler 的注释
 */
function extractHandlerComments(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const comments = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 查找 handler 注册行（支持多行格式）
    let handlerMatch = line.match(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/);
    // 如果当前行只有 ipcMain.handle(，检查下一行
    if (!handlerMatch && line.includes("ipcMain.handle(") && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      handlerMatch = nextLine.match(/^\s*['"]([^'"]+)['"]/);
    }
    if (handlerMatch) {
      const channelName = handlerMatch[1];
      // 向上查找注释（通常在前一行或两行）
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const commentLine = lines[j].trim();
        if (commentLine.startsWith("//")) {
          comments[channelName] = commentLine;
          break;
        }
      }
    }
  }

  return comments;
}

/**
 * 辅助函数：在源代码中查找 handler 的位置
 * 支持单引号和双引号格式
 */
function findHandlerIndex(content, channel) {
  let index = content.indexOf(`"${channel}"`);
  if (index === -1) {
    index = content.indexOf(`'${channel}'`);
  }
  return index;
}

describe("Review System IPC", () => {
  let handlers;
  let handlerComments;

  const expectedChannels = [
    "review:create",
    "review:update",
    "review:delete",
    "review:get",
    "review:get-by-target",
    "review:reply",
    "review:mark-helpful",
    "review:report",
    "review:get-statistics",
    "review:get-my-reviews",
  ];

  beforeEach(() => {
    // 从源文件提取 handlers
    handlers = extractIPCHandlers(REVIEW_IPC_PATH);
    handlerComments = extractHandlerComments(REVIEW_IPC_PATH);
  });

  // ============================================================
  // 基础验证 - Handler 数量和命名
  // ============================================================

  describe("Handler 注册验证", () => {
    it("should have exactly 10 handlers registered", () => {
      expect(handlers.length).toBe(10);
    });

    it("should match all expected handler channels", () => {
      const sortedHandlers = handlers.sort();
      const sortedExpected = expectedChannels.sort();
      expect(sortedHandlers).toEqual(sortedExpected);
    });

    it("should have no duplicate handler channels", () => {
      const uniqueHandlers = new Set(handlers);
      expect(uniqueHandlers.size).toBe(handlers.length);
    });

    it("should contain all documented handlers", () => {
      expectedChannels.forEach((channel) => {
        expect(handlers).toContain(channel);
      });
    });
  });

  // ============================================================
  // 基础评价操作 Handlers (4个)
  // ============================================================

  describe("基础评价操作 Handlers", () => {
    const basicHandlers = [
      "review:create",
      "review:update",
      "review:delete",
      "review:get",
    ];

    it("should have 4 basic review operation handlers", () => {
      const count = basicHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(4);
    });

    basicHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });
    });

    it("should have create handler for creating reviews", () => {
      expect(handlers).toContain("review:create");
    });

    it("should have update handler for updating reviews", () => {
      expect(handlers).toContain("review:update");
    });

    it("should have delete handler for deleting reviews", () => {
      expect(handlers).toContain("review:delete");
    });

    it("should have get handler for fetching single review", () => {
      expect(handlers).toContain("review:get");
    });
  });

  // ============================================================
  // 评价查询操作 Handlers (2个)
  // ============================================================

  describe("评价查询操作 Handlers", () => {
    const queryHandlers = ["review:get-by-target", "review:get-my-reviews"];

    it("should have 2 query operation handlers", () => {
      const count = queryHandlers.filter((h) => handlers.includes(h)).length;
      expect(count).toBe(2);
    });

    queryHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });
    });

    it("should have get-by-target handler for fetching reviews by target", () => {
      expect(handlers).toContain("review:get-by-target");
    });

    it("should have get-my-reviews handler for fetching user reviews", () => {
      expect(handlers).toContain("review:get-my-reviews");
    });
  });

  // ============================================================
  // 评价互动操作 Handlers (2个)
  // ============================================================

  describe("评价互动操作 Handlers", () => {
    const interactionHandlers = ["review:reply", "review:mark-helpful"];

    it("should have 2 interaction operation handlers", () => {
      const count = interactionHandlers.filter((h) =>
        handlers.includes(h),
      ).length;
      expect(count).toBe(2);
    });

    interactionHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });
    });

    it("should have reply handler for replying to reviews", () => {
      expect(handlers).toContain("review:reply");
    });

    it("should have mark-helpful handler for marking reviews as helpful", () => {
      expect(handlers).toContain("review:mark-helpful");
    });
  });

  // ============================================================
  // 评价管理操作 Handlers (2个)
  // ============================================================

  describe("评价管理操作 Handlers", () => {
    const managementHandlers = ["review:report", "review:get-statistics"];

    it("should have 2 management operation handlers", () => {
      const count = managementHandlers.filter((h) =>
        handlers.includes(h),
      ).length;
      expect(count).toBe(2);
    });

    managementHandlers.forEach((channel) => {
      it(`should register ${channel} handler`, () => {
        expect(handlers).toContain(channel);
      });
    });

    it("should have report handler for reporting inappropriate reviews", () => {
      expect(handlers).toContain("review:report");
    });

    it("should have get-statistics handler for fetching review statistics", () => {
      expect(handlers).toContain("review:get-statistics");
    });
  });

  // ============================================================
  // 按功能域分组验证
  // ============================================================

  describe("按功能域分类验证", () => {
    it("should have 4 + 2 + 2 + 2 = 10 total handlers", () => {
      expect(handlers.length).toBe(10);
    });

    it("should group handlers correctly by functional domain", () => {
      const basicCount = handlers.filter((h) =>
        [
          "review:create",
          "review:update",
          "review:delete",
          "review:get",
        ].includes(h),
      ).length;
      const queryCount = handlers.filter((h) =>
        ["review:get-by-target", "review:get-my-reviews"].includes(h),
      ).length;
      const interactionCount = handlers.filter((h) =>
        ["review:reply", "review:mark-helpful"].includes(h),
      ).length;
      const managementCount = handlers.filter((h) =>
        ["review:report", "review:get-statistics"].includes(h),
      ).length;

      expect(basicCount).toBe(4);
      expect(queryCount).toBe(2);
      expect(interactionCount).toBe(2);
      expect(managementCount).toBe(2);
    });
  });

  // ============================================================
  // Handler 命名约定验证
  // ============================================================

  describe("Handler 命名约定", () => {
    it('all handlers should start with "review:" prefix', () => {
      handlers.forEach((channel) => {
        expect(channel.startsWith("review:")).toBe(true);
      });
    });

    it("all handlers should use kebab-case naming convention", () => {
      const validPattern = /^review:[a-z]+(-[a-z]+)*$/;
      handlers.forEach((channel) => {
        expect(validPattern.test(channel)).toBe(true);
      });
    });

    it("no handler should use underscores in channel name", () => {
      handlers.forEach((channel) => {
        expect(channel).not.toContain("_");
      });
    });

    it("no handler should use uppercase letters in channel name", () => {
      handlers.forEach((channel) => {
        expect(channel).toMatch(/^[a-z0-9:_-]+$/);
      });
    });
  });

  // ============================================================
  // 完整性验证
  // ============================================================

  describe("完整性验证", () => {
    it("should have no missing handlers from specification", () => {
      const missing = expectedChannels.filter((h) => !handlers.includes(h));
      expect(missing).toEqual([]);
    });

    it("should have no unexpected handlers beyond specification", () => {
      const unexpected = handlers.filter((h) => !expectedChannels.includes(h));
      expect(unexpected).toEqual([]);
    });

    it("should maintain 1:1 mapping between specified and registered handlers", () => {
      expect(handlers.length).toBe(expectedChannels.length);
    });
  });

  // ============================================================
  // 特殊功能验证
  // ============================================================

  describe("特殊功能验证", () => {
    it("should have handlers for all CRUD operations", () => {
      expect(handlers).toContain("review:create");
      expect(handlers).toContain("review:get");
      expect(handlers).toContain("review:update");
      expect(handlers).toContain("review:delete");
    });

    it("should have handlers for review interaction features", () => {
      expect(handlers).toContain("review:reply");
      expect(handlers).toContain("review:mark-helpful");
      expect(handlers).toContain("review:report");
    });

    it("should have handlers for review querying and statistics", () => {
      expect(handlers).toContain("review:get-by-target");
      expect(handlers).toContain("review:get-my-reviews");
      expect(handlers).toContain("review:get-statistics");
    });
  });

  // ============================================================
  // 功能分类验证
  // ============================================================

  describe("功能分类验证", () => {
    it("read operations should include: get, get-by-target, get-my-reviews, get-statistics", () => {
      const readOps = [
        "review:get",
        "review:get-by-target",
        "review:get-my-reviews",
        "review:get-statistics",
      ];
      readOps.forEach((op) => expect(handlers).toContain(op));
    });

    it("write operations should include: create, update, delete, reply, mark-helpful, report", () => {
      const writeOps = [
        "review:create",
        "review:update",
        "review:delete",
        "review:reply",
        "review:mark-helpful",
        "review:report",
      ];
      writeOps.forEach((op) => expect(handlers).toContain(op));
    });
  });

  // ============================================================
  // 错误处理验证（通过静态分析）
  // ============================================================

  describe("错误处理验证", () => {
    it("source file should contain error handling for uninitialized manager", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("评价管理器未初始化");
    });

    it("source file should contain try-catch blocks for error handling", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      const tryCount = (content.match(/try\s*{/g) || []).length;
      const catchCount = (content.match(/catch\s*\(/g) || []).length;

      // 应该有10个try-catch对
      expect(tryCount).toBe(10);
      expect(catchCount).toBe(10);
    });

    it("source file should log errors to console", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      // Implementation uses logger.error instead of console.error
      expect(content.includes("console.error") || content.includes("logger.error")).toBe(true);
    });
  });

  // ============================================================
  // 源代码质量验证
  // ============================================================

  describe("源代码质量验证", () => {
    it("source file should have proper JSDoc header comment", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("Review System IPC Handlers");
      expect(content).toContain("评价反馈系统相关的 IPC 处理函数");
    });

    it("source file should export registerReviewIPC function", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("module.exports");
      expect(content).toContain("registerReviewIPC");
    });

    it("source file should accept context parameter with reviewManager", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("function registerReviewIPC(context)");
      expect(content).toContain("reviewManager");
    });

    it("source file should log successful registration", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("评价系统IPC handlers已注册");
      expect(content).toContain("10个");
    });
  });

  // ============================================================
  // Handler 参数验证（通过静态分析）
  // ============================================================

  describe("Handler 参数验证", () => {
    it("create handler should accept options parameter", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:create");
      expect(content).toContain("createReview(options)");
    });

    it("update handler should accept reviewId and updates parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:update");
      expect(content).toContain("updateReview(reviewId, updates)");
    });

    it("delete handler should accept reviewId parameter", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:delete");
      expect(content).toContain("deleteReview(reviewId)");
    });

    it("get handler should accept reviewId parameter", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:get");
      expect(content).toContain("getReview(reviewId)");
    });

    it("get-by-target handler should accept targetId, targetType, and filters parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:get-by-target");
      // 验证方法调用包含必要的参数（支持多行格式）
      expect(content).toContain("getReviewsByTarget");
      expect(content).toMatch(/getReviewsByTarget\s*\([^)]*targetId[^)]*targetType[^)]*filters/s);
    });

    it("reply handler should accept reviewId and content parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:reply");
      expect(content).toContain("replyToReview(reviewId, content)");
    });

    it("mark-helpful handler should accept reviewId and helpful parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:mark-helpful");
      expect(content).toContain("markHelpful(reviewId, helpful)");
    });

    it("report handler should accept reviewId, reason, and description parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:report");
      expect(content).toContain("reportReview(reviewId, reason, description)");
    });

    it("get-statistics handler should accept targetId and targetType parameters", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:get-statistics");
      expect(content).toContain("getStatistics(targetId, targetType)");
    });

    it("get-my-reviews handler should accept userDid parameter", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      expect(content).toContain("review:get-my-reviews");
      expect(content).toContain("getMyReviews(userDid)");
    });
  });

  // ============================================================
  // 返回值验证（通过静态分析）
  // ============================================================

  describe("返回值验证", () => {
    it("handlers that throw errors should propagate them", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      const errorThrowingHandlers = [
        "review:create",
        "review:update",
        "review:delete",
        "review:reply",
        "review:mark-helpful",
        "review:report",
      ];

      errorThrowingHandlers.forEach((handler) => {
        const startIndex = findHandlerIndex(content, handler);
        const handlerSection = content.substring(startIndex, startIndex + 500);
        expect(handlerSection).toContain("throw error");
      });
    });

    it("get handler should return null on error or when manager not initialized", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      const startIndex = findHandlerIndex(content, "review:get");
      const getHandlerSection = content.substring(startIndex, startIndex + 500);
      expect(getHandlerSection).toContain("return null");
    });

    it("list handlers should return empty array on error or when manager not initialized", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      const listHandlers = ["review:get-by-target", "review:get-my-reviews"];

      listHandlers.forEach((handler) => {
        const startIndex = findHandlerIndex(content, handler);
        const handlerSection = content.substring(startIndex, startIndex + 500);
        expect(handlerSection).toContain("return []");
      });
    });

    it("get-statistics handler should return null on error or when manager not initialized", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");
      const startIndex = findHandlerIndex(content, "review:get-statistics");
      const statsHandlerSection = content.substring(startIndex, startIndex + 500);
      expect(statsHandlerSection).toContain("return null");
    });
  });

  // ============================================================
  // 综合测试
  // ============================================================

  describe("综合测试", () => {
    it("should have complete CRUD functionality", () => {
      expect(handlers).toContain("review:create");
      expect(handlers).toContain("review:get");
      expect(handlers).toContain("review:update");
      expect(handlers).toContain("review:delete");
    });

    it("should have complete query functionality", () => {
      expect(handlers).toContain("review:get");
      expect(handlers).toContain("review:get-by-target");
      expect(handlers).toContain("review:get-my-reviews");
      expect(handlers).toContain("review:get-statistics");
    });

    it("should have complete interaction functionality", () => {
      expect(handlers).toContain("review:reply");
      expect(handlers).toContain("review:mark-helpful");
      expect(handlers).toContain("review:report");
    });

    it("all handlers should follow consistent error handling pattern", () => {
      const content = fs.readFileSync(REVIEW_IPC_PATH, "utf-8");

      // 验证所有handler都有错误处理
      expectedChannels.forEach((channel) => {
        // 支持单引号和双引号
        let channelIndex = content.indexOf(`"${channel}"`);
        if (channelIndex === -1) {
          channelIndex = content.indexOf(`'${channel}'`);
        }
        expect(channelIndex).toBeGreaterThan(-1);

        // 检查该handler后面是否有try-catch
        const handlerContent = content.substring(
          channelIndex,
          content.indexOf("});", channelIndex) + 3,
        );
        expect(handlerContent).toContain("try");
        expect(handlerContent).toContain("catch");
      });
    });
  });
});
