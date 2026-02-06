/**
 * BrowserEngine 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserEngine } from '../../../src/main/browser/browser-engine.js';

// Mock playwright-core
vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockReturnValue('https://example.com'),
          title: vi.fn().mockResolvedValue('Example Page'),
          screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
          bringToFront: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
          context: vi.fn().mockReturnValue({})
        }),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined)
      }),
      close: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockReturnValue({ pid: 12345 })
    })
  }
}));

describe('BrowserEngine', () => {
  let browserEngine;

  beforeEach(() => {
    browserEngine = new BrowserEngine({
      headless: false,
      cdpPort: 18800,
      profileDir: '/tmp/.browser-profiles'
    });
  });

  afterEach(async () => {
    if (browserEngine && browserEngine.isRunning) {
      await browserEngine.cleanup();
    }
  });

  describe('构造函数', () => {
    it('应该正确初始化配置', () => {
      expect(browserEngine.config.headless).toBe(false);
      expect(browserEngine.config.cdpPort).toBe(18800);
      expect(browserEngine.config.profileDir).toBe('/tmp/.browser-profiles');
    });

    it('应该初始化空的上下文和页面映射', () => {
      expect(browserEngine.contexts.size).toBe(0);
      expect(browserEngine.pages.size).toBe(0);
    });

    it('应该初始化为未运行状态', () => {
      expect(browserEngine.isRunning).toBe(false);
    });
  });

  describe('start()', () => {
    it('应该成功启动浏览器', async () => {
      const result = await browserEngine.start();

      expect(result.success).toBe(true);
      expect(result.cdpPort).toBe(18800);
      expect(result.pid).toBe(12345);
      expect(browserEngine.isRunning).toBe(true);
    });

    it('如果浏览器已运行，应该抛出错误', async () => {
      await browserEngine.start();

      await expect(browserEngine.start()).rejects.toThrow('Browser is already running');
    });

    it('应该触发 browser:started 事件', async () => {
      const handler = vi.fn();
      browserEngine.on('browser:started', handler);

      await browserEngine.start();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          cdpPort: 18800,
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('stop()', () => {
    beforeEach(async () => {
      await browserEngine.start();
    });

    it('应该成功停止浏览器', async () => {
      const result = await browserEngine.stop();

      expect(result.success).toBe(true);
      expect(result.uptime).toBeGreaterThan(0);
      expect(browserEngine.isRunning).toBe(false);
    });

    it('如果浏览器未运行，应该抛出错误', async () => {
      await browserEngine.stop();

      await expect(browserEngine.stop()).rejects.toThrow('Browser is not running');
    });

    it('应该触发 browser:stopped 事件', async () => {
      const handler = vi.fn();
      browserEngine.on('browser:stopped', handler);

      await browserEngine.stop();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          uptime: expect.any(Number)
        })
      );
    });

    it('应该清理所有上下文和页面', async () => {
      await browserEngine.createContext('test');
      await browserEngine.stop();

      expect(browserEngine.contexts.size).toBe(0);
      expect(browserEngine.pages.size).toBe(0);
    });
  });

  describe('createContext()', () => {
    beforeEach(async () => {
      await browserEngine.start();
    });

    it('应该成功创建新上下文', async () => {
      const result = await browserEngine.createContext('test-profile');

      expect(result.success).toBe(true);
      expect(result.profileName).toBe('test-profile');
      expect(result.exists).toBe(false);
      expect(browserEngine.contexts.has('test-profile')).toBe(true);
    });

    it('如果上下文已存在，应该返回 exists: true', async () => {
      await browserEngine.createContext('test-profile');
      const result = await browserEngine.createContext('test-profile');

      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
    });

    it('如果浏览器未运行，应该抛出错误', async () => {
      await browserEngine.stop();

      await expect(browserEngine.createContext('test')).rejects.toThrow(
        'Browser is not running'
      );
    });

    it('应该触发 context:created 事件', async () => {
      const handler = vi.fn();
      browserEngine.on('context:created', handler);

      await browserEngine.createContext('test-profile');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          profileName: 'test-profile'
        })
      );
    });
  });

  describe('openTab()', () => {
    beforeEach(async () => {
      await browserEngine.start();
      await browserEngine.createContext('default');
    });

    it('应该成功打开新标签页', async () => {
      const result = await browserEngine.openTab('default', 'https://example.com');

      expect(result.success).toBe(true);
      expect(result.targetId).toMatch(/^tab-\d+$/);
      expect(result.url).toBe('https://example.com');
      expect(browserEngine.pages.size).toBe(1);
    });

    it('应该为每个标签页生成唯一 ID', async () => {
      const result1 = await browserEngine.openTab('default', 'https://example.com');
      const result2 = await browserEngine.openTab('default', 'https://example.org');

      expect(result1.targetId).not.toBe(result2.targetId);
      expect(browserEngine.pages.size).toBe(2);
    });

    it('应该触发 tab:opened 事件', async () => {
      const handler = vi.fn();
      browserEngine.on('tab:opened', handler);

      await browserEngine.openTab('default', 'https://example.com');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: expect.stringMatching(/^tab-\d+$/),
          url: 'https://example.com',
          profileName: 'default'
        })
      );
    });
  });

  describe('closeTab()', () => {
    let targetId;

    beforeEach(async () => {
      await browserEngine.start();
      await browserEngine.createContext('default');
      const result = await browserEngine.openTab('default', 'https://example.com');
      targetId = result.targetId;
    });

    it('应该成功关闭标签页', async () => {
      const result = await browserEngine.closeTab(targetId);

      expect(result.success).toBe(true);
      expect(result.targetId).toBe(targetId);
      expect(browserEngine.pages.has(targetId)).toBe(false);
    });

    it('如果标签页不存在，应该抛出错误', async () => {
      await expect(browserEngine.closeTab('invalid-id')).rejects.toThrow(
        "Tab 'invalid-id' not found"
      );
    });
  });

  describe('getStatus()', () => {
    it('浏览器未运行时应该返回正确状态', () => {
      const status = browserEngine.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.uptime).toBe(0);
      expect(status.cdpPort).toBe(18800);
      expect(status.contextsCount).toBe(0);
      expect(status.tabsCount).toBe(0);
    });

    it('浏览器运行时应该返回正确状态', async () => {
      await browserEngine.start();
      await browserEngine.createContext('default');
      await browserEngine.openTab('default', 'https://example.com');

      const status = browserEngine.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.uptime).toBeGreaterThan(0);
      expect(status.contextsCount).toBe(1);
      expect(status.tabsCount).toBe(1);
      expect(status.pid).toBe(12345);
    });
  });

  describe('screenshot()', () => {
    let targetId;

    beforeEach(async () => {
      await browserEngine.start();
      await browserEngine.createContext('default');
      const result = await browserEngine.openTab('default', 'https://example.com');
      targetId = result.targetId;
    });

    it('应该成功截图', async () => {
      const buffer = await browserEngine.screenshot(targetId);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('应该触发 tab:screenshot 事件', async () => {
      const handler = vi.fn();
      browserEngine.on('tab:screenshot', handler);

      await browserEngine.screenshot(targetId);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId,
          size: expect.any(Number)
        })
      );
    });
  });

  describe('listTabs()', () => {
    beforeEach(async () => {
      await browserEngine.start();
      await browserEngine.createContext('profile1');
      await browserEngine.createContext('profile2');
    });

    it('应该列出所有标签页', async () => {
      await browserEngine.openTab('profile1', 'https://example.com');
      await browserEngine.openTab('profile2', 'https://example.org');

      const tabs = await browserEngine.listTabs();

      expect(tabs.length).toBe(2);
      expect(tabs[0]).toHaveProperty('targetId');
      expect(tabs[0]).toHaveProperty('url');
      expect(tabs[0]).toHaveProperty('title');
      expect(tabs[0]).toHaveProperty('profileName');
    });

    it('应该支持按 profileName 过滤', async () => {
      await browserEngine.openTab('profile1', 'https://example.com');
      await browserEngine.openTab('profile2', 'https://example.org');

      const tabs = await browserEngine.listTabs('profile1');

      expect(tabs.length).toBe(1);
      expect(tabs[0].profileName).toBe('profile1');
    });
  });
});
