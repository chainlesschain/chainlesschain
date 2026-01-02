/**
 * IPC API E2E测试
 * 测试新增的62个API在实际Electron环境中的功能
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('IPC API E2E Tests', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    // 启动Electron应用
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../desktop-app-vue/dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    // 获取第一个窗口
    window = await electronApp.firstWindow();

    // 等待应用加载完成
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    // 关闭应用
    await electronApp.close();
  });

  test.describe('System API E2E', () => {
    test('should get system info', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getSystemInfo();
      });

      expect(result.success).toBe(true);
      expect(result.platform).toBeDefined();
      expect(result.arch).toBeDefined();
      expect(result.appVersion).toBeDefined();
    });

    test('should get platform', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getPlatform();
      });

      expect(result.success).toBe(true);
      expect(result.platform).toMatch(/darwin|win32|linux/);
    });

    test('should get app info', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getAppInfo();
      });

      expect(result.success).toBe(true);
      expect(result.name).toBeDefined();
      expect(result.version).toBeDefined();
      expect(result.path).toBeDefined();
    });
  });

  test.describe('Git Sync API E2E', () => {
    test('should get sync status', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.git.getSyncStatus();
      });

      expect(result).toBeDefined();
      expect(typeof result.enabled).toBe('boolean');
      expect(typeof result.autoCommit).toBe('boolean');
      expect(typeof result.autoSync).toBe('boolean');
    });
  });

  test.describe('Notification API E2E', () => {
    test('should get unread count', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.notification.getUnreadCount();
      });

      expect(result.success).toBe(true);
      expect(typeof result.count).toBe('number');
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    test('should get all notifications', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.notification.getAll({ limit: 10 });
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.notifications)).toBe(true);
    });
  });

  test.describe('Knowledge API E2E', () => {
    test('should get tags', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.knowledge.getTags();
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.tags)).toBe(true);
    });

    test('should list contents', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.knowledge.listContents({ limit: 5 });
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.contents)).toBe(true);
    });
  });

  test.describe('Social API E2E', () => {
    test('should get all contacts', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.social.getAllContacts();
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.contacts)).toBe(true);
    });

    test('should get contact statistics', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.social.getContactStatistics();
      });

      expect(result.success).toBe(true);
      expect(result.statistics).toBeDefined();
    });
  });

  test.describe('Window Control E2E', () => {
    test('should get window state', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getWindowState();
      });

      expect(result.success).toBe(true);
      expect(result.state).toBeDefined();
      expect(typeof result.state.isMaximized).toBe('boolean');
      expect(typeof result.state.isMinimized).toBe('boolean');
    });

    test('should toggle maximize window', async () => {
      // 获取初始状态
      const initialState = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getWindowState();
      });

      // 切换最大化
      const toggleResult = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.maximize();
      });

      expect(toggleResult.success).toBe(true);

      // 验证状态改变
      const newState = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getWindowState();
      });

      expect(newState.state.isMaximized).not.toBe(initialState.state.isMaximized);
    });
  });
});
