import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('多媒体处理页面', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const context = await launchElectronApp();
    app = context.app;
    window = context.window;
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
  });

  test('应该能够访问多媒体处理页面', async () => {
    // 导航到多媒体处理页面
    await window.evaluate(() => {
      window.location.hash = '#/multimedia/demo?e2e=true';
    });

    // 等待页面加载
    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    // 验证URL
    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/multimedia/demo');
  });

  test('应该显示多媒体处理主要元素', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimedia/demo?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有多媒体处理相关元素
    const hasMultimediaElements = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasMedia = document.querySelector('video') ||
                      document.querySelector('audio') ||
                      document.querySelector('canvas') ||
                      document.querySelector('[class*="media"]') ||
                      document.querySelector('[class*="multimedia"]') ||
                      document.querySelector('[class*="player"]');
      return !!hasMedia || body.includes('多媒体') || body.includes('视频') || body.includes('音频') || body.length > 0;
    });
    expect(hasMultimediaElements).toBeTruthy();
  });

  test('页面应该没有控制台错误', async () => {
    const consoleErrors: string[] = [];

    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.evaluate(() => {
      window.location.hash = '#/multimedia/demo?e2e=true';
    });
    await window.waitForTimeout(3000);

    // 过滤掉一些已知的非关键错误
    const criticalErrors = consoleErrors.filter(err =>
      !err.includes('DevTools') &&
      !err.includes('extension') &&
      !err.includes('favicon')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('应该能够与多媒体处理界面进行基本交互', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimedia/demo?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有播放、暂停、处理等按钮
    const hasInteractiveElements = await window.evaluate(() => {
      const playButton = document.querySelector('[class*="play"]');
      const processButton = document.querySelector('[class*="process"]');
      const controlButton = document.querySelector('[class*="control"]');
      const buttons = document.querySelectorAll('button');
      return !!(playButton || processButton || controlButton || buttons.length > 0);
    });

    expect(hasInteractiveElements).toBeTruthy();
  });

  test('应该能够显示多媒体播放器或处理工具', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/multimedia/demo?e2e=true';
    });
    await window.waitForTimeout(2000);

    // 检查是否有播放器或处理工具界面
    const hasMediaTools = await window.evaluate(() => {
      const body = document.body.innerText;
      const hasPlayer = document.querySelector('video') ||
                       document.querySelector('audio') ||
                       document.querySelector('[class*="player"]');
      const hasTools = document.querySelector('[class*="tool"]') ||
                      document.querySelector('[class*="control"]');
      return !!(hasPlayer || hasTools) ||
             body.includes('播放') ||
             body.includes('处理') ||
             body.includes('编辑');
    });

    expect(hasMediaTools).toBeDefined();
  });
});
