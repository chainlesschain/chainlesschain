/**
 * 简化的IPC API E2E测试
 * 快速验证核心API功能
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

test.describe('IPC API Quick E2E Tests', () => {
  test('should verify System APIs work in real Electron environment', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 测试 getSystemInfo
      const systemInfo = await callIPC(window, 'system.getSystemInfo');
      expect(systemInfo).toHaveProperty('success', true);
      expect(systemInfo).toHaveProperty('platform');
      expect(systemInfo).toHaveProperty('arch');
      console.log('✓ system.getSystemInfo works');

      // 测试 getPlatform
      const platform = await callIPC(window, 'system.getPlatform');
      expect(platform).toHaveProperty('success', true);
      expect(platform).toHaveProperty('platform');
      console.log('✓ system.getPlatform works');

      // 测试 getAppInfo
      const appInfo = await callIPC(window, 'system.getAppInfo');
      expect(appInfo).toHaveProperty('success', true);
      expect(appInfo).toHaveProperty('name');
      expect(appInfo).toHaveProperty('version');
      console.log('✓ system.getAppInfo works');

      console.log('\n✅ All System API tests passed!');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('should verify Git API works', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const syncStatus = await callIPC(window, 'git.getSyncStatus');
      expect(syncStatus).toBeDefined();
      expect(typeof syncStatus.enabled).toBe('boolean');
      expect(typeof syncStatus.autoCommit).toBe('boolean');
      console.log('✓ git.getSyncStatus works');

      console.log('\n✅ Git API test passed!');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('should verify Notification API works', async () => {
    const { app, window } = await launchElectronApp();

    try {
      const unreadCount = await callIPC(window, 'notification.getUnreadCount');
      expect(unreadCount).toHaveProperty('success', true);
      expect(typeof unreadCount.count).toBe('number');
      console.log('✓ notification.getUnreadCount works');

      console.log('\n✅ Notification API test passed!');
    } finally {
      await closeElectronApp(app);
    }
  });
});
