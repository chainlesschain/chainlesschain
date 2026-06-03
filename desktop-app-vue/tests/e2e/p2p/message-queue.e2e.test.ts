import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('消息队列管理页面', () => {
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

  test('应该能够访问消息队列管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/message-queue');
  });

  test('应该显示消息队列管理标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('消息队列') ||
        bodyText.includes('Message Queue');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示刷新按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasRefreshButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('刷新') ||
        btn.innerText.includes('Refresh')
      );
    });

    expect(hasRefreshButton).toBeTruthy();
  });

  test('应该显示重试全部按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasRetryButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('重试') ||
        btn.innerText.includes('Retry')
      );
    });

    expect(hasRetryButton).toBeTruthy();
  });

  test('应该显示待发送消息卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasOutgoingCard = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('待发送消息') ||
        bodyText.includes('Outgoing') ||
        bodyText.includes('发送');
    });

    expect(hasOutgoingCard).toBeTruthy();
  });

  test('应该显示待接收消息卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasIncomingCard = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('待接收消息') ||
        bodyText.includes('Incoming') ||
        bodyText.includes('接收');
    });

    expect(hasIncomingCard).toBeTruthy();
  });

  test('应该显示队列统计', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasStatistics = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('队列统计') ||
        bodyText.includes('Statistics') ||
        bodyText.includes('总计') ||
        document.querySelector('.ant-statistic') ||
        document.querySelector('.stats-card');
    });

    expect(hasStatistics).toBeTruthy();
  });

  test('应该显示消息状态标签', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasStatusTags = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const tags = document.querySelectorAll('.ant-tag');
      return tags.length > 0 ||
        bodyText.includes('等待') ||
        bodyText.includes('发送中') ||
        bodyText.includes('已完成') ||
        bodyText.includes('失败');
    });

    expect(hasStatusTags).toBeTruthy();
  });

  test('应该显示清空已完成按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasClearButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('清空已完成') ||
        btn.innerText.includes('清空')
      );
    });

    expect(hasClearButton).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/message-queue?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
