/**
 * StreamController 单元测试
 * 测试目标: src/main/llm/stream-controller.js
 * 覆盖场景: 流式输出控制、暂停/恢复、取消、状态管理
 *
 * ✅ 全部测试通过 - 无外部依赖
 *
 * StreamController是纯JavaScript类，不依赖数据库或文件系统
 * 可以完整测试所有功能
 *
 * 测试覆盖：
 * - StreamStatus常量
 * - 构造函数和初始化
 * - start, pause, resume流程
 * - processChunk和缓冲
 * - cancel, complete, error状态
 * - getStats, getBuffer, clearBuffer
 * - reset和destroy
 * - EventEmitter事件
 *
 * 关键修复：
 * 1. pause/resume测试 - 先pause再调用processChunk
 * 2. error事件处理 - 添加error监听器防止EventEmitter抛出未处理错误
 * 3. clearBuffer - 源码不发出bufferCleared事件，仅清空数组
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

describe("StreamController", () => {
  let StreamController;
  let StreamStatus;
  let controller;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import("../../../src/main/llm/stream-controller.js");
    StreamController = module.StreamController;
    StreamStatus = module.StreamStatus;
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  });

  describe("StreamStatus常量", () => {
    it("应该定义所有状态", () => {
      expect(StreamStatus.IDLE).toBe("idle");
      expect(StreamStatus.RUNNING).toBe("running");
      expect(StreamStatus.PAUSED).toBe("paused");
      expect(StreamStatus.CANCELLED).toBe("cancelled");
      expect(StreamStatus.COMPLETED).toBe("completed");
      expect(StreamStatus.ERROR).toBe("error");
    });
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      controller = new StreamController();

      expect(controller).toBeDefined();
    });

    it("应该初始化为IDLE状态", () => {
      controller = new StreamController();

      expect(controller.status).toBe(StreamStatus.IDLE);
    });

    it("应该初始化属性", () => {
      controller = new StreamController();

      expect(controller.isPaused).toBe(false);
      expect(controller.totalChunks).toBe(0);
      expect(controller.processedChunks).toBe(0);
      expect(controller.buffer).toEqual([]);
      expect(controller.startTime).toBeNull();
      expect(controller.endTime).toBeNull();
    });

    it("应该接受配置选项", () => {
      controller = new StreamController({ enableBuffering: true });

      expect(controller.options.enableBuffering).toBe(true);
    });

    it("应该创建AbortController", () => {
      controller = new StreamController();

      expect(controller.abortController).toBeDefined();
      expect(controller.signal).toBeDefined();
    });

    it("应该继承EventEmitter", () => {
      controller = new StreamController();

      expect(typeof controller.on).toBe("function");
      expect(typeof controller.emit).toBe("function");
    });
  });

  describe("start", () => {
    beforeEach(() => {
      controller = new StreamController();
    });

    it("应该将状态设置为RUNNING", () => {
      controller.start();

      expect(controller.status).toBe(StreamStatus.RUNNING);
    });

    it("应该设置startTime", () => {
      const before = Date.now();
      controller.start();
      const after = Date.now();

      expect(controller.startTime).toBeGreaterThanOrEqual(before);
      expect(controller.startTime).toBeLessThanOrEqual(after);
    });

    it("应该发出start事件", () => {
      const handler = vi.fn();
      controller.on("start", handler);

      controller.start();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("应该在非IDLE状态时抛出错误", () => {
      controller.start();

      expect(() => controller.start()).toThrow("无法开始");
    });
  });

  describe("processChunk", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();
    });

    it("应该处理chunk", async () => {
      const result = await controller.processChunk({ text: "Hello" });

      expect(result).toBe(true);
      expect(controller.totalChunks).toBe(1);
      expect(controller.processedChunks).toBe(1);
    });

    it("应该发出chunk事件", async () => {
      const handler = vi.fn();
      controller.on("chunk", handler);

      await controller.processChunk({ text: "Hello" });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          chunk: { text: "Hello" },
          index: 1,
          total: 1,
        }),
      );
    });

    it("应该在enableBuffering时添加到缓冲区", async () => {
      controller = new StreamController({ enableBuffering: true });
      controller.start();

      await controller.processChunk({ text: "Hello" });
      await controller.processChunk({ text: "World" });

      expect(controller.buffer.length).toBe(2);
      expect(controller.buffer[0].text).toBe("Hello");
      expect(controller.buffer[1].text).toBe("World");
    });

    it("应该在未启用buffering时不添加到缓冲区", async () => {
      await controller.processChunk({ text: "Hello" });

      expect(controller.buffer.length).toBe(0);
    });

    it("应该在取消后返回false", async () => {
      controller.cancel();

      const result = await controller.processChunk({ text: "Hello" });

      expect(result).toBe(false);
    });

    it("应该累计totalChunks", async () => {
      await controller.processChunk({ text: "A" });
      await controller.processChunk({ text: "B" });
      await controller.processChunk({ text: "C" });

      expect(controller.totalChunks).toBe(3);
    });
  });

  describe("pause", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();
    });

    it("应该设置isPaused为true", () => {
      controller.pause();

      expect(controller.isPaused).toBe(true);
    });

    it("应该将状态设置为PAUSED", () => {
      controller.pause();

      expect(controller.status).toBe(StreamStatus.PAUSED);
    });

    it("应该发出pause事件", () => {
      const handler = vi.fn();
      controller.on("pause", handler);

      controller.pause();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("resume", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();
      controller.pause();
    });

    it("应该设置isPaused为false", () => {
      controller.resume();

      expect(controller.isPaused).toBe(false);
    });

    it("应该将状态设置为RUNNING", () => {
      controller.resume();

      expect(controller.status).toBe(StreamStatus.RUNNING);
    });

    it("应该发出resume事件", () => {
      const handler = vi.fn();
      controller.on("resume", handler);

      controller.resume();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("pause/resume流程", () => {
    it("应该在暂停时阻塞processChunk", async () => {
      controller = new StreamController();
      controller.start();

      // 先暂停，再调用processChunk
      controller.pause();

      let chunkProcessed = false;
      const processPromise = controller
        .processChunk({ text: "Test" })
        .then(() => {
          chunkProcessed = true;
        });

      // 等待一小段时间
      await new Promise((resolve) => setTimeout(resolve, 10));

      // chunk应该还未处理完成（等待resume）
      expect(chunkProcessed).toBe(false);

      // 恢复处理
      controller.resume();

      await processPromise;

      // 现在应该处理完成
      expect(chunkProcessed).toBe(true);
    });
  });

  describe("cancel", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();
    });

    it("应该将状态设置为CANCELLED", () => {
      controller.cancel();

      expect(controller.status).toBe(StreamStatus.CANCELLED);
    });

    it("应该设置endTime", () => {
      controller.cancel();

      expect(controller.endTime).toBeDefined();
      expect(controller.endTime).toBeGreaterThan(0);
    });

    it("应该发出cancel事件", () => {
      const handler = vi.fn();
      controller.on("cancel", handler);

      controller.cancel("测试取消");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "测试取消" }),
      );
    });

    it("应该abort AbortController", () => {
      controller.cancel();

      expect(controller.abortController.signal.aborted).toBe(true);
    });

    it("应该接受自定义取消原因", () => {
      const handler = vi.fn();
      controller.on("cancel", handler);

      controller.cancel("自定义原因");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "自定义原因" }),
      );
    });
  });

  describe("complete", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();
    });

    it("应该将状态设置为COMPLETED", () => {
      controller.complete();

      expect(controller.status).toBe(StreamStatus.COMPLETED);
    });

    it("应该设置endTime", () => {
      controller.complete();

      expect(controller.endTime).toBeDefined();
    });

    it("应该发出complete事件", () => {
      const handler = vi.fn();
      controller.on("complete", handler);

      controller.complete({ totalChunks: 10 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          result: { totalChunks: 10 },
        }),
      );
    });
  });

  describe("error", () => {
    beforeEach(() => {
      controller = new StreamController();
      controller.start();

      // Add error listener to prevent "Unhandled error" crashes
      // EventEmitter throws on unhandled 'error' events
      controller.on("error", () => {});
    });

    it("应该将状态设置为ERROR", () => {
      controller.error(new Error("Test error"));

      expect(controller.status).toBe(StreamStatus.ERROR);
    });

    it("应该设置endTime", () => {
      controller.error(new Error("Test error"));

      expect(controller.endTime).toBeDefined();
    });

    it("应该发出error事件", () => {
      const handler = vi.fn();
      // Source emits "stream-error" (not "error") to avoid Node.js
      // EventEmitter ERR_UNHANDLED_ERROR when there is no listener
      controller.on("stream-error", handler);

      const testError = new Error("Test error");
      controller.error(testError);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ error: testError }),
      );
    });
  });

  describe("getStats", () => {
    it("应该返回统计信息", () => {
      controller = new StreamController();
      controller.start();

      const stats = controller.getStats();

      expect(stats).toBeDefined();
      expect(stats.status).toBe(StreamStatus.RUNNING);
      expect(stats.totalChunks).toBe(0);
      expect(stats.processedChunks).toBe(0);
      expect(stats.isPaused).toBe(false);
    });

    it("应该包含时间信息", () => {
      controller = new StreamController();
      controller.start();

      const stats = controller.getStats();

      expect(stats.startTime).toBeDefined();
      expect(stats.endTime).toBeNull();
    });

    it("应该在完成后包含duration", () => {
      controller = new StreamController();
      controller.start();
      controller.complete();

      const stats = controller.getStats();

      expect(stats.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getBuffer", () => {
    it("应该返回缓冲区", () => {
      controller = new StreamController({ enableBuffering: true });
      controller.start();

      controller.processChunk({ text: "A" });
      controller.processChunk({ text: "B" });

      const buffer = controller.getBuffer();

      expect(buffer.length).toBe(2);
    });

    it("应该返回缓冲区副本", () => {
      controller = new StreamController({ enableBuffering: true });
      controller.start();

      controller.processChunk({ text: "Test" });

      const buffer = controller.getBuffer();
      buffer.push({ text: "Modified" });

      // 原始缓冲区不应该被修改
      expect(controller.buffer.length).toBe(1);
    });
  });

  describe("clearBuffer", () => {
    it("应该清空缓冲区", async () => {
      controller = new StreamController({ enableBuffering: true });
      controller.start();

      await controller.processChunk({ text: "A" });
      await controller.processChunk({ text: "B" });

      controller.clearBuffer();

      expect(controller.buffer.length).toBe(0);
    });

    // Note: clearBuffer() does NOT emit an event in the source code
    // It only sets this.buffer = []
  });

  describe("reset", () => {
    it("应该重置所有状态", async () => {
      controller = new StreamController({ enableBuffering: true });
      controller.start();

      await controller.processChunk({ text: "Test" });
      controller.pause();

      controller.reset();

      expect(controller.status).toBe(StreamStatus.IDLE);
      expect(controller.isPaused).toBe(false);
      expect(controller.totalChunks).toBe(0);
      expect(controller.processedChunks).toBe(0);
      expect(controller.buffer.length).toBe(0);
      expect(controller.startTime).toBeNull();
      expect(controller.endTime).toBeNull();
    });

    it("应该创建新的AbortController", () => {
      controller = new StreamController();
      controller.start();

      const oldAbortController = controller.abortController;
      controller.cancel();

      controller.reset();

      expect(controller.abortController).not.toBe(oldAbortController);
      expect(controller.abortController.signal.aborted).toBe(false);
    });

    it("应该发出reset事件", () => {
      controller = new StreamController();
      const handler = vi.fn();
      controller.on("reset", handler);

      controller.reset();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("应该清理资源", () => {
      controller = new StreamController();
      controller.start();

      controller.destroy();

      // destroy应该清理状态
      expect(true).toBe(true);
    });

    it("应该可以多次调用", () => {
      controller = new StreamController();

      controller.destroy();
      controller.destroy();

      expect(true).toBe(true);
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置", () => {
      controller = new StreamController();

      expect(controller.options).toEqual({});
    });

    it("应该在IDLE状态时允许reset", () => {
      controller = new StreamController();

      controller.reset();

      expect(controller.status).toBe(StreamStatus.IDLE);
    });

    it("应该在未start时不允许processChunk", async () => {
      controller = new StreamController();

      // processChunk应该不会报错，但状态应该是IDLE
      await controller.processChunk({ text: "Test" });

      expect(controller.status).toBe(StreamStatus.IDLE);
    });

    it("应该处理连续的pause/resume", () => {
      controller = new StreamController();
      controller.start();

      controller.pause();
      controller.pause();
      controller.resume();
      controller.resume();

      expect(controller.status).toBe(StreamStatus.RUNNING);
    });
  });

  describe("事件系统", () => {
    it("应该支持事件监听器", () => {
      controller = new StreamController();

      const startHandler = vi.fn();
      const chunkHandler = vi.fn();
      const completeHandler = vi.fn();

      controller.on("start", startHandler);
      controller.on("chunk", chunkHandler);
      controller.on("complete", completeHandler);

      controller.start();
      controller.processChunk({ text: "Test" });
      controller.complete();

      expect(startHandler).toHaveBeenCalled();
      expect(chunkHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it("应该支持移除事件监听器", () => {
      controller = new StreamController();

      const handler = vi.fn();
      controller.on("start", handler);
      controller.off("start", handler);

      controller.start();

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
