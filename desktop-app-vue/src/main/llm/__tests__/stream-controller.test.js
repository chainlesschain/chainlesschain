/**
 * Stream Controller 单元测试
 *
 * 测试内容：
 * - StreamController 类的构造函数
 * - start 开始流式输出
 * - processChunk 处理数据块
 * - pause/resume 暂停/恢复
 * - cancel 取消
 * - complete 完成
 * - error 错误处理
 * - getStats 获取统计
 * - reset/destroy 重置/销毁
 * - StreamStatus 状态常量
 * - createStreamController 工厂函数
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const {
  StreamController,
  StreamStatus,
  createStreamController,
} = require('../stream-controller');

describe('StreamStatus', () => {
  it('should have all status constants', () => {
    expect(StreamStatus.IDLE).toBe('idle');
    expect(StreamStatus.RUNNING).toBe('running');
    expect(StreamStatus.PAUSED).toBe('paused');
    expect(StreamStatus.CANCELLED).toBe('cancelled');
    expect(StreamStatus.COMPLETED).toBe('completed');
    expect(StreamStatus.ERROR).toBe('error');
  });
});

describe('createStreamController', () => {
  it('should create a StreamController instance', () => {
    const controller = createStreamController();
    expect(controller).toBeInstanceOf(StreamController);
  });

  it('should pass options to StreamController', () => {
    const controller = createStreamController({ enableBuffering: true });
    expect(controller.options.enableBuffering).toBe(true);
  });
});

describe('StreamController', () => {
  let controller;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    controller = new StreamController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default state', () => {
      expect(controller.status).toBe(StreamStatus.IDLE);
      expect(controller.isPaused).toBe(false);
      expect(controller.totalChunks).toBe(0);
      expect(controller.processedChunks).toBe(0);
      expect(controller.buffer).toEqual([]);
      expect(controller.startTime).toBeNull();
      expect(controller.endTime).toBeNull();
      expect(controller.pauseResolvers).toEqual([]);
    });

    it('should accept options', () => {
      const controllerWithOptions = new StreamController({ enableBuffering: true });
      expect(controllerWithOptions.options.enableBuffering).toBe(true);
    });

    it('should be an EventEmitter', () => {
      expect(typeof controller.on).toBe('function');
      expect(typeof controller.emit).toBe('function');
      expect(typeof controller.removeAllListeners).toBe('function');
    });

    it('should have AbortController', () => {
      expect(controller.abortController).toBeInstanceOf(AbortController);
      expect(controller.signal).toBe(controller.abortController.signal);
    });
  });

  describe('signal getter', () => {
    it('should return AbortSignal', () => {
      expect(controller.signal).toBe(controller.abortController.signal);
      expect(controller.signal.aborted).toBe(false);
    });
  });

  describe('start', () => {
    it('should start stream and update status', () => {
      const startHandler = vi.fn();
      controller.on('start', startHandler);

      controller.start();

      expect(controller.status).toBe(StreamStatus.RUNNING);
      expect(controller.startTime).not.toBeNull();
      expect(startHandler).toHaveBeenCalledWith({ timestamp: controller.startTime });
    });

    it('should throw error if not in IDLE state', () => {
      controller.start();

      expect(() => controller.start()).toThrow('无法开始：当前状态为 running');
    });

    it('should throw error if in COMPLETED state', () => {
      controller.start();
      controller.complete();

      expect(() => controller.start()).toThrow('无法开始：当前状态为 completed');
    });
  });

  describe('processChunk', () => {
    beforeEach(() => {
      controller.start();
    });

    it('should process chunk and return true', async () => {
      const chunkHandler = vi.fn();
      controller.on('chunk', chunkHandler);

      const result = await controller.processChunk({ data: 'test' });

      expect(result).toBe(true);
      expect(controller.totalChunks).toBe(1);
      expect(controller.processedChunks).toBe(1);
      expect(chunkHandler).toHaveBeenCalledWith({
        chunk: { data: 'test' },
        index: 1,
        total: 1,
      });
    });

    it('should buffer chunks when buffering is enabled', async () => {
      const bufferingController = new StreamController({ enableBuffering: true });
      bufferingController.start();

      await bufferingController.processChunk({ data: 'chunk1' });
      await bufferingController.processChunk({ data: 'chunk2' });

      expect(bufferingController.buffer).toHaveLength(2);
      expect(bufferingController.buffer[0]).toEqual({ data: 'chunk1' });
    });

    it('should not buffer chunks when buffering is disabled', async () => {
      await controller.processChunk({ data: 'chunk1' });
      await controller.processChunk({ data: 'chunk2' });

      expect(controller.buffer).toHaveLength(0);
    });

    it('should return false when aborted', async () => {
      controller.abortController.abort();

      const result = await controller.processChunk({ data: 'test' });

      expect(result).toBe(false);
      expect(controller.status).toBe(StreamStatus.CANCELLED);
    });

    it('should wait for resume when paused', async () => {
      controller.pause();

      let resolved = false;
      const processPromise = controller.processChunk({ data: 'test' }).then((result) => {
        resolved = true;
        return result;
      });

      // 等待一段时间确认没有立即resolve
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      // 恢复后应该继续
      controller.resume();
      await vi.advanceTimersByTimeAsync(0);
      const result = await processPromise;

      expect(result).toBe(true);
    });
  });

  describe('pause', () => {
    it('should pause running stream', () => {
      controller.start();
      const pauseHandler = vi.fn();
      controller.on('pause', pauseHandler);

      controller.pause();

      expect(controller.status).toBe(StreamStatus.PAUSED);
      expect(controller.isPaused).toBe(true);
      expect(pauseHandler).toHaveBeenCalled();
    });

    it('should not pause if not running', () => {
      const pauseHandler = vi.fn();
      controller.on('pause', pauseHandler);

      controller.pause();

      expect(controller.status).toBe(StreamStatus.IDLE);
      expect(pauseHandler).not.toHaveBeenCalled();
    });

    it('should not pause if already paused', () => {
      controller.start();
      controller.pause();

      const pauseHandler = vi.fn();
      controller.on('pause', pauseHandler);

      controller.pause();

      expect(pauseHandler).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should resume paused stream', () => {
      controller.start();
      controller.pause();

      const resumeHandler = vi.fn();
      controller.on('resume', resumeHandler);

      controller.resume();

      expect(controller.status).toBe(StreamStatus.RUNNING);
      expect(controller.isPaused).toBe(false);
      expect(resumeHandler).toHaveBeenCalled();
    });

    it('should resolve waiting processes', async () => {
      controller.start();
      controller.pause();

      let resolved1 = false;
      let resolved2 = false;

      controller.processChunk({ data: 'test1' }).then(() => {
        resolved1 = true;
      });
      controller.processChunk({ data: 'test2' }).then(() => {
        resolved2 = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(resolved1).toBe(false);
      expect(resolved2).toBe(false);

      controller.resume();
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved1).toBe(true);
      expect(resolved2).toBe(true);
    });

    it('should not resume if not paused', () => {
      controller.start();

      const resumeHandler = vi.fn();
      controller.on('resume', resumeHandler);

      controller.resume();

      expect(resumeHandler).not.toHaveBeenCalled();
    });
  });

  describe('waitForResume', () => {
    it('should resolve immediately if not paused', async () => {
      controller.start();

      let resolved = false;
      controller.waitForResume().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });

    it('should wait until resume when paused', async () => {
      controller.start();
      controller.pause();

      let resolved = false;
      controller.waitForResume().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      controller.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should cancel running stream', () => {
      controller.start();

      const cancelHandler = vi.fn();
      controller.on('cancel', cancelHandler);

      controller.cancel('User cancelled');

      expect(controller.status).toBe(StreamStatus.CANCELLED);
      expect(controller.abortController.signal.aborted).toBe(true);
      expect(controller.endTime).not.toBeNull();
      expect(cancelHandler).toHaveBeenCalledWith({
        reason: 'User cancelled',
        timestamp: controller.endTime,
        processedChunks: 0,
      });
    });

    it('should use default reason', () => {
      controller.start();

      const cancelHandler = vi.fn();
      controller.on('cancel', cancelHandler);

      controller.cancel();

      expect(cancelHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: '用户取消' })
      );
    });

    it('should resolve all pause waiters', async () => {
      controller.start();
      controller.pause();

      let resolved = false;
      controller.waitForResume().then(() => {
        resolved = true;
      });

      controller.cancel();
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved).toBe(true);
    });

    it('should not cancel if already cancelled', () => {
      controller.start();
      controller.cancel();

      const cancelHandler = vi.fn();
      controller.on('cancel', cancelHandler);

      controller.cancel();

      expect(cancelHandler).not.toHaveBeenCalled();
    });

    it('should not cancel if already completed', () => {
      controller.start();
      controller.complete();

      const cancelHandler = vi.fn();
      controller.on('cancel', cancelHandler);

      controller.cancel();

      expect(cancelHandler).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('should complete running stream', () => {
      controller.start();

      const completeHandler = vi.fn();
      controller.on('complete', completeHandler);

      controller.complete({ finalResult: 'done' });

      expect(controller.status).toBe(StreamStatus.COMPLETED);
      expect(controller.endTime).not.toBeNull();
      expect(completeHandler).toHaveBeenCalledWith({
        result: { finalResult: 'done' },
        stats: expect.any(Object),
        timestamp: controller.endTime,
      });
    });

    it('should complete with empty result by default', () => {
      controller.start();

      const completeHandler = vi.fn();
      controller.on('complete', completeHandler);

      controller.complete();

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ result: {} })
      );
    });

    it('should not complete if already cancelled', () => {
      controller.start();
      controller.cancel();

      const completeHandler = vi.fn();
      controller.on('complete', completeHandler);

      controller.complete();

      expect(controller.status).toBe(StreamStatus.CANCELLED);
      expect(completeHandler).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should mark stream as error', () => {
      controller.start();

      const errorHandler = vi.fn();
      controller.on('error', errorHandler);

      const testError = new Error('Test error');
      controller.error(testError);

      expect(controller.status).toBe(StreamStatus.ERROR);
      expect(controller.endTime).not.toBeNull();
      expect(errorHandler).toHaveBeenCalledWith({
        error: testError,
        timestamp: controller.endTime,
        processedChunks: 0,
      });
    });

    it('should include processed chunks count in error event', async () => {
      controller.start();
      await controller.processChunk({ data: 'test1' });
      await controller.processChunk({ data: 'test2' });

      const errorHandler = vi.fn();
      controller.on('error', errorHandler);

      controller.error(new Error('Test'));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ processedChunks: 2 })
      );
    });
  });

  describe('getStats', () => {
    it('should return stats with all fields', () => {
      controller.start();

      const stats = controller.getStats();

      expect(stats).toEqual({
        status: StreamStatus.RUNNING,
        totalChunks: 0,
        processedChunks: 0,
        duration: expect.any(Number),
        throughput: 0,
        averageChunkTime: 0,
        startTime: controller.startTime,
        endTime: null,
        isPaused: false,
      });
    });

    it('should calculate duration correctly', async () => {
      controller.start();

      vi.advanceTimersByTime(1000);

      const stats = controller.getStats();
      expect(stats.duration).toBe(1000);
    });

    it('should calculate throughput correctly', async () => {
      controller.start();

      await controller.processChunk({ data: 'test1' });
      await controller.processChunk({ data: 'test2' });
      await controller.processChunk({ data: 'test3' });

      vi.advanceTimersByTime(1000);

      const stats = controller.getStats();
      expect(stats.throughput).toBe(3); // 3 chunks / 1 second
    });

    it('should calculate average chunk time', async () => {
      controller.start();

      await controller.processChunk({ data: 'test1' });
      await controller.processChunk({ data: 'test2' });

      vi.advanceTimersByTime(1000);

      const stats = controller.getStats();
      expect(stats.averageChunkTime).toBe(500); // 1000ms / 2 chunks
    });

    it('should use endTime for completed stream', () => {
      controller.start();
      vi.advanceTimersByTime(500);
      controller.complete();
      vi.advanceTimersByTime(1000);

      const stats = controller.getStats();
      expect(stats.duration).toBe(500);
    });

    it('should reflect paused state', () => {
      controller.start();
      controller.pause();

      const stats = controller.getStats();
      expect(stats.isPaused).toBe(true);
    });
  });

  describe('getBuffer', () => {
    it('should return copy of buffer', async () => {
      const bufferingController = new StreamController({ enableBuffering: true });
      bufferingController.start();

      await bufferingController.processChunk({ data: 'chunk1' });
      await bufferingController.processChunk({ data: 'chunk2' });

      const buffer = bufferingController.getBuffer();

      expect(buffer).toHaveLength(2);
      expect(buffer[0]).toEqual({ data: 'chunk1' });

      // 修改返回的 buffer 不应影响原始 buffer
      buffer.push({ data: 'chunk3' });
      expect(bufferingController.buffer).toHaveLength(2);
    });

    it('should return empty array when no buffering', () => {
      controller.start();

      const buffer = controller.getBuffer();
      expect(buffer).toEqual([]);
    });
  });

  describe('clearBuffer', () => {
    it('should clear buffer', async () => {
      const bufferingController = new StreamController({ enableBuffering: true });
      bufferingController.start();

      await bufferingController.processChunk({ data: 'chunk1' });
      await bufferingController.processChunk({ data: 'chunk2' });

      bufferingController.clearBuffer();

      expect(bufferingController.buffer).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      controller.start();
      await controller.processChunk({ data: 'test' });
      vi.advanceTimersByTime(1000);

      const resetHandler = vi.fn();
      controller.on('reset', resetHandler);

      controller.reset();

      expect(controller.status).toBe(StreamStatus.IDLE);
      expect(controller.isPaused).toBe(false);
      expect(controller.totalChunks).toBe(0);
      expect(controller.processedChunks).toBe(0);
      expect(controller.buffer).toEqual([]);
      expect(controller.startTime).toBeNull();
      expect(controller.endTime).toBeNull();
      expect(controller.pauseResolvers).toEqual([]);
      expect(resetHandler).toHaveBeenCalled();
    });

    it('should create new AbortController', () => {
      controller.start();
      const oldAbortController = controller.abortController;

      controller.reset();

      expect(controller.abortController).not.toBe(oldAbortController);
      expect(controller.abortController.signal.aborted).toBe(false);
    });

    it('should allow restart after reset', () => {
      controller.start();
      controller.complete();
      controller.reset();

      expect(() => controller.start()).not.toThrow();
      expect(controller.status).toBe(StreamStatus.RUNNING);
    });
  });

  describe('destroy', () => {
    it('should cancel and remove all listeners', () => {
      controller.start();

      const handler = vi.fn();
      controller.on('cancel', handler);

      controller.destroy();

      expect(controller.status).toBe(StreamStatus.CANCELLED);

      // 移除所有监听器后，不应再触发
      controller.emit('cancel', {});
      expect(handler).toHaveBeenCalledTimes(1); // 只有 destroy 时触发一次
    });

    it('should use destroy reason', () => {
      controller.start();

      const cancelHandler = vi.fn();
      controller.on('cancel', cancelHandler);

      controller.destroy();

      expect(cancelHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: '控制器销毁' })
      );
    });
  });
});
