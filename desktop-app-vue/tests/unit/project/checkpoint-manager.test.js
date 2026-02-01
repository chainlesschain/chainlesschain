/**
 * CheckpointManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CheckpointManager from '../../../src/main/project/checkpoint-manager.js';

describe('CheckpointManager', () => {
  let checkpointManager;
  let mockDatabase;

  beforeEach(() => {
    // Mock Database
    mockDatabase = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn().mockReturnValue(null),
          all: vi.fn().mockReturnValue([])
        }))
      }
    };

    checkpointManager = new CheckpointManager(mockDatabase);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('初始化', () => {
    it('应该创建 project_checkpoints 表', () => {
      expect(mockDatabase.db.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS project_checkpoints')
      );
    });

    it('应该创建索引', () => {
      expect(mockDatabase.db.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX')
      );
    });
  });

  describe('createCheckpoint', () => {
    it('应该成功创建检查点', () => {
      const checkpoint = checkpointManager.createCheckpoint({
        projectId: 'test-project-123',
        operation: 'create-stream',
        currentStage: 'analysis',
        completedStages: ['init'],
        completedFiles: ['README.md'],
        accumulatedData: { files: [], metadata: {} }
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toBeTruthy();
      expect(checkpoint.project_id).toBe('test-project-123');
      expect(checkpoint.operation).toBe('create-stream');
      expect(checkpoint.status).toBe('in_progress');
      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });

    it('应该设置默认 TTL 为 24 小时', () => {
      const now = Date.now();
      const checkpoint = checkpointManager.createCheckpoint({
        operation: 'create-stream'
      });

      const expectedExpiry = now + 24 * 60 * 60 * 1000;
      expect(checkpoint.expires_at).toBeGreaterThan(now);
      expect(checkpoint.expires_at).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    it('应该支持自定义 TTL', () => {
      const customTTL = 60 * 60 * 1000; // 1小时
      const checkpoint = checkpointManager.createCheckpoint({
        operation: 'create-stream',
        ttl: customTTL
      });

      expect(checkpoint.expires_at).toBeLessThan(Date.now() + 2 * customTTL);
    });
  });

  describe('updateCheckpoint', () => {
    it('应该更新检查点状态', () => {
      checkpointManager.updateCheckpoint('checkpoint-123', {
        currentStage: 'implementation',
        completedStages: ['init', 'analysis'],
        status: 'in_progress'
      });

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE project_checkpoints')
      );
    });

    it('应该更新累积数据', () => {
      checkpointManager.updateCheckpoint('checkpoint-123', {
        accumulatedData: {
          files: ['file1.js', 'file2.js'],
          metadata: { version: '1.0' }
        }
      });

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });
  });

  describe('markAsFailed', () => {
    it('应该标记检查点为失败', () => {
      checkpointManager.markAsFailed('checkpoint-123', 'Network error');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'failed'")
      );
    });

    it('应该递增重试计数', () => {
      checkpointManager.markAsFailed('checkpoint-123', 'Error');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('retry_count = retry_count + 1')
      );
    });
  });

  describe('markAsCompleted', () => {
    it('应该标记检查点为完成', () => {
      checkpointManager.markAsCompleted('checkpoint-123');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'completed'")
      );
    });
  });

  describe('getCheckpoint', () => {
    it('应该返回检查点并解析 JSON 字段', () => {
      const mockCheckpoint = {
        id: 'checkpoint-123',
        status: 'in_progress',
        completed_stages: '["init", "analysis"]',
        completed_files: '["file1.js"]',
        accumulated_data: '{"files": []}'
      };

      mockDatabase.db.prepare = vi.fn(() => ({
        get: vi.fn().mockReturnValue(mockCheckpoint)
      }));

      const checkpoint = checkpointManager.getCheckpoint('checkpoint-123');

      expect(checkpoint).toBeDefined();
      expect(checkpoint.completed_stages).toEqual(['init', 'analysis']);
      expect(checkpoint.completed_files).toEqual(['file1.js']);
      expect(checkpoint.accumulated_data).toEqual({ files: [] });
    });

    it('检查点不存在时应返回 null', () => {
      mockDatabase.db.prepare = vi.fn(() => ({
        get: vi.fn().mockReturnValue(null)
      }));

      const checkpoint = checkpointManager.getCheckpoint('nonexistent');
      expect(checkpoint).toBeNull();
    });
  });

  describe('findLatestCheckpoint', () => {
    it('应该找到最新的进行中检查点', () => {
      const mockCheckpoint = {
        id: 'checkpoint-latest',
        operation: 'create-stream',
        status: 'in_progress',
        expires_at: Date.now() + 60000,
        completed_stages: '[]',
        completed_files: '[]',
        accumulated_data: '{}'
      };

      mockDatabase.db.prepare = vi.fn(() => ({
        get: vi.fn().mockReturnValue(mockCheckpoint)
      }));

      const checkpoint = checkpointManager.findLatestCheckpoint(
        'project-123',
        'create-stream'
      );

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toBe('checkpoint-latest');
    });

    it('过期检查点应返回 null', () => {
      const expiredCheckpoint = {
        id: 'checkpoint-expired',
        operation: 'create-stream',
        status: 'in_progress',
        expires_at: Date.now() - 1000, // 已过期
        completed_stages: '[]',
        completed_files: '[]',
        accumulated_data: '{}'
      };

      mockDatabase.db.prepare = vi.fn(() => ({
        get: vi.fn().mockReturnValue(expiredCheckpoint),
        run: vi.fn()
      }));

      const checkpoint = checkpointManager.findLatestCheckpoint(
        'project-123',
        'create-stream'
      );

      expect(checkpoint).toBeNull();
    });
  });

  describe('deleteCheckpoint', () => {
    it('应该删除检查点', () => {
      checkpointManager.deleteCheckpoint('checkpoint-123');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM project_checkpoints')
      );
    });
  });

  describe('cleanupExpired', () => {
    it('应该清理过期的检查点', () => {
      mockDatabase.db.prepare = vi.fn(() => ({
        run: vi.fn().mockReturnValue({ changes: 5 })
      }));

      const deletedCount = checkpointManager.cleanupExpired();

      expect(deletedCount).toBe(5);
      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM project_checkpoints')
      );
    });

    it('应该清理已完成的旧检查点', () => {
      checkpointManager.cleanupExpired(24 * 60 * 60 * 1000);

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'")
      );
    });
  });

  describe('getStats', () => {
    it('应该返回检查点统计信息', () => {
      mockDatabase.db.prepare = vi.fn(() => ({
        all: vi.fn().mockReturnValue([
          { status: 'in_progress', count: 3 },
          { status: 'completed', count: 10 },
          { status: 'failed', count: 2 }
        ])
      }));

      const stats = checkpointManager.getStats();

      expect(stats.total).toBe(15);
      expect(stats.in_progress).toBe(3);
      expect(stats.completed).toBe(10);
      expect(stats.failed).toBe(2);
    });

    it('没有检查点时应返回零统计', () => {
      mockDatabase.db.prepare = vi.fn(() => ({
        all: vi.fn().mockReturnValue([])
      }));

      const stats = checkpointManager.getStats();

      expect(stats.total).toBe(0);
      expect(stats.in_progress).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });
});
