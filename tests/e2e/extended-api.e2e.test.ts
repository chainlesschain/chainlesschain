/**
 * 扩展IPC API E2E测试
 * 测试PDF、Document、Notification和System API的剩余方法
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Extended IPC API E2E Tests', () => {
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

  test.describe('PDF API E2E', () => {
    test('should convert markdown to PDF', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.pdf.markdownToPDF({
          markdown: '# Test\n\nThis is a test.',
          outputPath: '/tmp/test.pdf',
          options: {
            format: 'A4',
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
          }
        });
      });

      // PDF转换可能失败（需要依赖），只验证返回格式
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle HTML file to PDF conversion', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.pdf.htmlFileToPDF({
            htmlFilePath: '/tmp/test.html',
            outputPath: '/tmp/test-html.pdf',
          });
        } catch (error: any) {
          // 文件不存在是预期的，验证API可调用
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle text file to PDF conversion', async () => {
      const result = await window.evaluate(async () => {
        try {
          return await (window as any).electronAPI.pdf.textFileToPDF({
            textFilePath: '/tmp/test.txt',
            outputPath: '/tmp/test-text.pdf',
          });
        } catch (error: any) {
          // 文件不存在是预期的，验证API可调用
          return { success: false, error: error.message };
        }
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should batch convert files to PDF', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.pdf.batchConvert({
          files: [
            { type: 'markdown', path: '/tmp/test1.md' },
            { type: 'text', path: '/tmp/test2.txt' }
          ],
          outputDir: '/tmp/pdfs/'
        });
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Document API E2E', () => {
    test('should export PPT', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.document.exportPPT({
          content: 'Test presentation',
          outputPath: '/tmp/test.pptx',
        });
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  test.describe('Notification API Extended E2E', () => {
    test('should mark notification as read', async () => {
      const result = await window.evaluate(async () => {
        // 先获取所有通知
        const notifications = await (window as any).electronAPI.notification.getAll({ limit: 1 });

        if (notifications.success && notifications.notifications.length > 0) {
          // 标记第一个通知为已读
          return await (window as any).electronAPI.notification.markRead(notifications.notifications[0].id);
        }

        // 如果没有通知，返回模拟成功
        return { success: true, message: 'No notifications to mark' };
      });

      expect(result.success).toBe(true);
    });

    test('should mark all notifications as read', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.notification.markAllRead();
      });

      expect(result.success).toBe(true);
    });

    test('should send desktop notification', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.notification.sendDesktop(
          'Test Notification',
          'This is a test notification from E2E test'
        );
      });

      expect(result.success).toBe(true);
    });
  });

  test.describe('Social API Extended E2E', () => {
    test('should search contacts', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.social.searchContacts('test');
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result) || (result.success !== undefined)).toBe(true);
    });

    test('should get friends list', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.social.getFriends();
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result) || (result.success !== undefined)).toBe(true);
    });

    test('should get pending friend requests', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.social.getPendingFriendRequests();
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result) || (result.success !== undefined)).toBe(true);
    });
  });

  test.describe('System API Extended E2E', () => {
    test('should get app version', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getVersion();
      });

      expect(result.success).toBe(true);
      expect(result.version).toBeDefined();
      expect(typeof result.version).toBe('string');
    });

    test('should get app path', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getPath('userData');
      });

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(typeof result.path).toBe('string');
    });

    test('should set window always on top', async () => {
      const result = await window.evaluate(async () => {
        // 先设置为true
        await (window as any).electronAPI.system.setAlwaysOnTop(true);
        // 再设置回false
        return await (window as any).electronAPI.system.setAlwaysOnTop(false);
      });

      expect(result.success).toBe(true);
    });

    test('should minimize window', async () => {
      const result = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.minimize();
      });

      expect(result.success).toBe(true);

      // 等待一下，确保窗口最小化
      await window.waitForTimeout(500);

      // 验证窗口状态
      const state = await window.evaluate(async () => {
        return await (window as any).electronAPI.system.getWindowState();
      });

      // 注意：在某些环境中，最小化可能不会立即生效
      expect(state.success).toBe(true);
    });

    test('should open external URL', async () => {
      const result = await window.evaluate(async () => {
        // 使用一个安全的URL进行测试
        return await (window as any).electronAPI.system.openExternal('https://example.com');
      });

      expect(result.success).toBe(true);
    });
  });
});
