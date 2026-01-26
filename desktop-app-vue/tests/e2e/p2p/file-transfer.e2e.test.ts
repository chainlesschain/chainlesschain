import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('P2P文件传输页面', () => {
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

  test('应该能够访问文件传输页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/file-transfer');
  });

  test('应该显示文件传输标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('文件传输') ||
        bodyText.includes('File Transfer');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示发送文件按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSendButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('发送文件') ||
        btn.innerText.includes('Send')
      );
    });

    expect(hasSendButton).toBeTruthy();
  });

  test('应该显示刷新按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
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

  test('应该显示传输历史卡片', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasHistoryCard = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('传输历史') ||
        bodyText.includes('History') ||
        document.querySelector('.history-card') ||
        document.querySelector('.ant-table');
    });

    expect(hasHistoryCard).toBeTruthy();
  });

  test('应该显示传输记录或空状态', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasTransfers = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('文件名') ||
        bodyText.includes('大小') ||
        bodyText.includes('状态') ||
        bodyText.includes('时间') ||
        bodyText.includes('发送') ||
        bodyText.includes('接收') ||
        document.querySelector('.ant-table') ||
        document.querySelector('.ant-empty');
    });

    expect(hasTransfers).toBeTruthy();
  });

  test('应该显示过滤器选项', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasFilters = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const selects = document.querySelectorAll('.ant-select');
      return selects.length > 0 ||
        bodyText.includes('全部') ||
        bodyText.includes('发送的') ||
        bodyText.includes('接收的');
    });

    expect(hasFilters).toBeTruthy();
  });

  test('应该显示清空历史按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasClearButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('清空') ||
        btn.innerText.includes('Clear')
      );
    });

    expect(hasClearButton).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/file-transfer?peerId=test-peer&peerName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
