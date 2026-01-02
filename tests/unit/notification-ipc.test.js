/**
 * Notification IPC 单元测试
 * 测试5个通知管理API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain, Notification } from 'electron';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  Notification: vi.fn().mockImplementation((options) => ({
    show: vi.fn(),
    ...options,
  })),
}));

describe('Notification IPC', () => {
  let mockDatabase;
  let mockMainWindow;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    mockDatabase = {
      all: vi.fn(),
      get: vi.fn(),
      run: vi.fn(),
    };

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };

    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const { registerNotificationIPC } = require('../../src/main/notification/notification-ipc');
    registerNotificationIPC({ database: mockDatabase, mainWindow: mockMainWindow });
  });

  describe('Notification Query', () => {
    it('should get all notifications', async () => {
      const mockNotifications = [
        { id: 1, title: 'Notification 1', read: false },
        { id: 2, title: 'Notification 2', read: true },
      ];

      mockDatabase.all.mockResolvedValue(mockNotifications);

      const result = await handlers['notification:get-all'](null, { limit: 10 });

      expect(result.success).toBe(true);
      expect(result.notifications).toEqual(mockNotifications);
    });

    it('should filter unread notifications', async () => {
      const mockNotifications = [
        { id: 1, title: 'Unread', read: false },
      ];

      mockDatabase.all.mockResolvedValue(mockNotifications);

      const result = await handlers['notification:get-all'](null, { unreadOnly: true });

      expect(result.success).toBe(true);
      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining('read = 0'),
        expect.any(Array)
      );
    });

    it('should get unread count', async () => {
      mockDatabase.get.mockResolvedValue({ count: 5 });

      const result = await handlers['notification:get-unread-count']();

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
    });
  });

  describe('Notification Actions', () => {
    it('should mark notification as read', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['notification:mark-read'](null, 1);

      expect(result.success).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE notifications'),
        expect.arrayContaining([1])
      );
    });

    it('should mark all notifications as read', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 10 });

      const result = await handlers['notification:mark-all-read']();

      expect(result.success).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE notifications SET read = 1')
      );
    });

    it('should send desktop notification', async () => {
      const mockNotification = {
        show: vi.fn(),
      };
      Notification.mockReturnValue(mockNotification);

      const result = await handlers['notification:send-desktop'](null, 'Test Title', 'Test Body');

      expect(result.success).toBe(true);
      expect(Notification).toHaveBeenCalledWith({
        title: 'Test Title',
        body: 'Test Body',
      });
      expect(mockNotification.show).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors', async () => {
      mockDatabase.all.mockRejectedValue(new Error('Database error'));

      const result = await handlers['notification:get-all'](null, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should handle mark read errors', async () => {
      mockDatabase.run.mockRejectedValue(new Error('Update failed'));

      const result = await handlers['notification:mark-read'](null, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });

    it('should handle desktop notification errors', async () => {
      Notification.mockImplementation(() => {
        throw new Error('Notification failed');
      });

      const result = await handlers['notification:send-desktop'](null, 'Title', 'Body');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Notification failed');
    });
  });
});
