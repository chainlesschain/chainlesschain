/**
 * Sync IPC 单元测试
 * 测试所有数据同步相关的 IPC handlers
 *
 * 测试覆盖:
 * - sync:start (启动同步)
 * - sync:get-status (获取同步状态)
 * - sync:incremental (增量同步)
 * - sync:resolve-conflict (冲突解决)
 *
 * 测试场景:
 * - 成功场景
 * - 失败场景 (错误处理)
 * - 未初始化管理器的错误处理
 * - 参数验证
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Sync IPC', () => {
  let handlers = {};
  let mockSyncManager;
  let registerSyncIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules(); // 清除模块缓存
    handlers = {};

    // Mock electron BEFORE importing sync-ipc
    vi.doMock('electron', () => ({
      ipcMain: {
        handle: (channel, handler) => {
          handlers[channel] = handler;
        },
      },
    }));

    // Mock sync manager
    mockSyncManager = {
      deviceId: 'test-device-123',
      initialize: vi.fn(),
      syncAfterLogin: vi.fn(),
      syncIncremental: vi.fn(),
      resolveConflict: vi.fn(),
      httpClient: {
        getSyncStatus: vi.fn(),
      },
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/sync/sync-ipc.js');
    registerSyncIPC = module.registerSyncIPC;

    // 注册 Sync IPC - handlers 会自动填充
    registerSyncIPC({ syncManager: mockSyncManager });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // 基本功能测试
  // ============================================================

  describe('基本功能测试', () => {
    it('should register all 4 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(4);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        'sync:start',
        'sync:get-status',
        'sync:incremental',
        'sync:resolve-conflict',
      ];

      expectedChannels.forEach(channel => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  // ============================================================
  // sync:start - 启动数据同步
  // ============================================================

  describe('sync:start', () => {
    it('should start sync with provided device ID', async () => {
      const deviceId = 'custom-device-456';
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);

      const result = await handlers['sync:start'](null, deviceId);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.initialize).toHaveBeenCalledWith(deviceId);
      expect(mockSyncManager.syncAfterLogin).toHaveBeenCalled();
    });

    it('should start sync with auto-generated device ID when not provided', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);

      const result = await handlers['sync:start'](null, null);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.initialize).toHaveBeenCalled();

      // 检查是否使用了自动生成的 device ID (格式: device-{timestamp})
      const calledDeviceId = mockSyncManager.initialize.mock.calls[0][0];
      expect(calledDeviceId).toMatch(/^device-\d+$/);

      expect(mockSyncManager.syncAfterLogin).toHaveBeenCalled();
    });

    it('should start sync with auto-generated device ID when undefined is passed', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);

      const result = await handlers['sync:start'](null, undefined);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.initialize).toHaveBeenCalled();

      // 检查是否使用了自动生成的 device ID
      const calledDeviceId = mockSyncManager.initialize.mock.calls[0][0];
      expect(calledDeviceId).toMatch(/^device-\d+$/);
    });

    it('should return error when syncManager is not initialized', async () => {
      // 使用 null syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerSyncIPC({ syncManager: null });

      const result = await handlers['sync:start'](null, 'test-device');

      expect(result).toEqual({
        success: false,
        error: '同步管理器未初始化',
      });
    });

    it('should return error when initialize fails', async () => {
      const error = new Error('初始化失败');
      mockSyncManager.initialize.mockRejectedValue(error);

      const result = await handlers['sync:start'](null, 'test-device');

      expect(result).toEqual({
        success: false,
        error: '初始化失败',
      });
    });

    it('should return error when syncAfterLogin fails', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      const error = new Error('同步失败');
      mockSyncManager.syncAfterLogin.mockRejectedValue(error);

      const result = await handlers['sync:start'](null, 'test-device');

      expect(result).toEqual({
        success: false,
        error: '同步失败',
      });
    });
  });

  // ============================================================
  // sync:get-status - 获取同步状态
  // ============================================================

  describe('sync:get-status', () => {
    it('should get sync status successfully', async () => {
      const mockStatus = {
        deviceId: 'test-device-123',
        lastSyncTime: '2025-01-03T12:00:00Z',
        syncCount: 42,
        status: 'synced',
      };
      mockSyncManager.httpClient.getSyncStatus.mockResolvedValue(mockStatus);

      const result = await handlers['sync:get-status'](null);

      expect(result).toEqual({
        success: true,
        data: mockStatus,
      });
      expect(mockSyncManager.httpClient.getSyncStatus).toHaveBeenCalledWith('test-device-123');
    });

    it('should return error when syncManager is not initialized', async () => {
      // 使用 null syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerSyncIPC({ syncManager: null });

      const result = await handlers['sync:get-status'](null);

      expect(result).toEqual({
        success: false,
        error: '同步管理器未初始化',
      });
    });

    it('should return error when httpClient is not initialized', async () => {
      // 使用没有 httpClient 的 syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerSyncIPC({ syncManager: { deviceId: 'test' } });

      const result = await handlers['sync:get-status'](null);

      expect(result).toEqual({
        success: false,
        error: '同步管理器未初始化',
      });
    });

    it('should return error when getSyncStatus fails', async () => {
      const error = new Error('网络错误');
      mockSyncManager.httpClient.getSyncStatus.mockRejectedValue(error);

      const result = await handlers['sync:get-status'](null);

      expect(result).toEqual({
        success: false,
        error: '网络错误',
      });
    });

    it('should handle empty status data', async () => {
      mockSyncManager.httpClient.getSyncStatus.mockResolvedValue({});

      const result = await handlers['sync:get-status'](null);

      expect(result).toEqual({
        success: true,
        data: {},
      });
    });
  });

  // ============================================================
  // sync:incremental - 增量同步
  // ============================================================

  describe('sync:incremental', () => {
    it('should perform incremental sync successfully', async () => {
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);

      const result = await handlers['sync:incremental'](null);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.syncIncremental).toHaveBeenCalled();
    });

    it('should return error when syncManager is not initialized', async () => {
      // 使用 null syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerSyncIPC({ syncManager: null });

      const result = await handlers['sync:incremental'](null);

      expect(result).toEqual({
        success: false,
        error: '同步管理器未初始化',
      });
    });

    it('should return error when syncIncremental fails', async () => {
      const error = new Error('增量同步失败');
      mockSyncManager.syncIncremental.mockRejectedValue(error);

      const result = await handlers['sync:incremental'](null);

      expect(result).toEqual({
        success: false,
        error: '增量同步失败',
      });
    });

    it('should handle network timeout error', async () => {
      const error = new Error('ETIMEDOUT');
      mockSyncManager.syncIncremental.mockRejectedValue(error);

      const result = await handlers['sync:incremental'](null);

      expect(result).toEqual({
        success: false,
        error: 'ETIMEDOUT',
      });
    });

    it('should handle multiple concurrent sync requests', async () => {
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);

      // 模拟多个并发请求
      const results = await Promise.all([
        handlers['sync:incremental'](null),
        handlers['sync:incremental'](null),
        handlers['sync:incremental'](null),
      ]);

      results.forEach(result => {
        expect(result).toEqual({ success: true });
      });
      expect(mockSyncManager.syncIncremental).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================
  // sync:resolve-conflict - 冲突解决
  // ============================================================

  describe('sync:resolve-conflict', () => {
    it('should resolve conflict with local resolution', async () => {
      const conflictId = 'conflict-123';
      const resolution = 'local';
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, conflictId, resolution);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith(conflictId, resolution);
    });

    it('should resolve conflict with remote resolution', async () => {
      const conflictId = 'conflict-456';
      const resolution = 'remote';
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, conflictId, resolution);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith(conflictId, resolution);
    });

    it('should resolve conflict with merge resolution', async () => {
      const conflictId = 'conflict-789';
      const resolution = 'merge';
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, conflictId, resolution);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith(conflictId, resolution);
    });

    it('should return error when syncManager is not initialized', async () => {
      // 使用 null syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      registerSyncIPC({ syncManager: null });

      const result = await handlers['sync:resolve-conflict'](null, 'conflict-123', 'local');

      expect(result).toEqual({
        success: false,
        error: '同步管理器未初始化',
      });
    });

    it('should return error when resolveConflict fails', async () => {
      const error = new Error('冲突解决失败');
      mockSyncManager.resolveConflict.mockRejectedValue(error);

      const result = await handlers['sync:resolve-conflict'](null, 'conflict-123', 'local');

      expect(result).toEqual({
        success: false,
        error: '冲突解决失败',
      });
    });

    it('should handle invalid conflict ID', async () => {
      const error = new Error('冲突ID不存在');
      mockSyncManager.resolveConflict.mockRejectedValue(error);

      const result = await handlers['sync:resolve-conflict'](null, 'invalid-id', 'local');

      expect(result).toEqual({
        success: false,
        error: '冲突ID不存在',
      });
    });

    it('should handle conflict with null conflictId', async () => {
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, null, 'local');

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith(null, 'local');
    });

    it('should handle conflict with undefined resolution', async () => {
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, 'conflict-123', undefined);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith('conflict-123', undefined);
    });

    it('should handle multiple conflicts resolution', async () => {
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const conflicts = [
        { id: 'conflict-1', resolution: 'local' },
        { id: 'conflict-2', resolution: 'remote' },
        { id: 'conflict-3', resolution: 'merge' },
      ];

      for (const conflict of conflicts) {
        const result = await handlers['sync:resolve-conflict'](null, conflict.id, conflict.resolution);
        expect(result).toEqual({ success: true });
      }

      expect(mockSyncManager.resolveConflict).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================
  // 边界情况和错误处理
  // ============================================================

  describe('边界情况和错误处理', () => {
    it('should handle sync manager with missing methods gracefully', async () => {
      // 使用不完整的 syncManager 重新注册
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });
      const incompleteSyncManager = {
        deviceId: 'test-device',
        // 缺少其他方法
      };
      registerSyncIPC({ syncManager: incompleteSyncManager });

      // 测试每个 handler 是否能正确处理缺失的方法
      try {
        await handlers['sync:start'](null, 'test-device');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle undefined syncManager parameter', () => {
      handlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        handlers[channel] = handler;
      });

      // 不传递 syncManager
      expect(() => {
        registerSyncIPC({});
      }).not.toThrow();

      // 所有 handlers 仍然应该被注册
      expect(handlers['sync:start']).toBeDefined();
      expect(handlers['sync:get-status']).toBeDefined();
      expect(handlers['sync:incremental']).toBeDefined();
      expect(handlers['sync:resolve-conflict']).toBeDefined();
    });

    it('should handle very long device IDs', async () => {
      const longDeviceId = 'device-' + 'a'.repeat(1000);
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);

      const result = await handlers['sync:start'](null, longDeviceId);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.initialize).toHaveBeenCalledWith(longDeviceId);
    });

    it('should handle special characters in device ID', async () => {
      const specialDeviceId = 'device-!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);

      const result = await handlers['sync:start'](null, specialDeviceId);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.initialize).toHaveBeenCalledWith(specialDeviceId);
    });

    it('should handle special characters in conflict ID', async () => {
      const specialConflictId = 'conflict-<script>alert("xss")</script>';
      const resolution = 'local';
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      const result = await handlers['sync:resolve-conflict'](null, specialConflictId, resolution);

      expect(result).toEqual({ success: true });
      expect(mockSyncManager.resolveConflict).toHaveBeenCalledWith(specialConflictId, resolution);
    });
  });

  // ============================================================
  // 集成测试场景
  // ============================================================

  describe('集成测试场景', () => {
    it('should handle complete sync workflow', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);
      mockSyncManager.httpClient.getSyncStatus.mockResolvedValue({
        status: 'synced',
        lastSyncTime: '2025-01-03T12:00:00Z',
      });
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);

      // 1. 启动同步
      const startResult = await handlers['sync:start'](null, 'test-device');
      expect(startResult.success).toBe(true);

      // 2. 获取同步状态
      const statusResult = await handlers['sync:get-status'](null);
      expect(statusResult.success).toBe(true);
      expect(statusResult.data.status).toBe('synced');

      // 3. 执行增量同步
      const incrementalResult = await handlers['sync:incremental'](null);
      expect(incrementalResult.success).toBe(true);
    });

    it('should handle sync with conflict resolution workflow', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);

      // 1. 启动同步
      await handlers['sync:start'](null, 'test-device');

      // 2. 解决冲突
      const conflictResult = await handlers['sync:resolve-conflict'](null, 'conflict-1', 'merge');
      expect(conflictResult.success).toBe(true);

      // 3. 继续增量同步
      const incrementalResult = await handlers['sync:incremental'](null);
      expect(incrementalResult.success).toBe(true);
    });

    it('should handle rapid sequential sync operations', async () => {
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);

      // 连续快速调用增量同步
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await handlers['sync:incremental'](null));
      }

      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      expect(mockSyncManager.syncIncremental).toHaveBeenCalledTimes(10);
    });
  });

  // ============================================================
  // 性能和并发测试
  // ============================================================

  describe('性能和并发测试', () => {
    it('should handle concurrent status checks', async () => {
      const mockStatus = { status: 'synced', deviceId: 'test-device-123' };
      mockSyncManager.httpClient.getSyncStatus.mockResolvedValue(mockStatus);

      // 并发 20 次状态查询
      const promises = Array(20)
        .fill(null)
        .map(() => handlers['sync:get-status'](null));

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockStatus);
      });
      expect(mockSyncManager.httpClient.getSyncStatus).toHaveBeenCalledTimes(20);
    });

    it('should handle mixed concurrent operations', async () => {
      mockSyncManager.initialize.mockResolvedValue(undefined);
      mockSyncManager.syncAfterLogin.mockResolvedValue(undefined);
      mockSyncManager.syncIncremental.mockResolvedValue(undefined);
      mockSyncManager.httpClient.getSyncStatus.mockResolvedValue({ status: 'synced' });
      mockSyncManager.resolveConflict.mockResolvedValue(undefined);

      // 混合并发操作
      const operations = [
        handlers['sync:get-status'](null),
        handlers['sync:incremental'](null),
        handlers['sync:resolve-conflict'](null, 'conflict-1', 'local'),
        handlers['sync:get-status'](null),
        handlers['sync:incremental'](null),
      ];

      const results = await Promise.all(operations);

      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });
});
