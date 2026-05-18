import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('设备管理页面', () => {
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

  test('应该能够访问设备管理页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/device-management');
  });

  test('应该显示设备管理标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('设备管理') ||
        bodyText.includes('Device Management');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示当前设备信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCurrentDevice = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('当前设备') ||
        bodyText.includes('设备ID') ||
        bodyText.includes('设备名称') ||
        bodyText.includes('DID') ||
        document.querySelector('.current-device-card');
    });

    expect(hasCurrentDevice).toBeTruthy();
  });

  test('应该显示已配对设备列表', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPairedDevices = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('已配对设备') ||
        bodyText.includes('Paired') ||
        document.querySelector('.paired-devices-card') ||
        document.querySelector('.ant-table');
    });

    expect(hasPairedDevices).toBeTruthy();
  });

  test('应该显示设备状态标签', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasStatusTags = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const tags = document.querySelectorAll('.ant-tag');
      return tags.length > 0 ||
        bodyText.includes('在线') ||
        bodyText.includes('离线') ||
        bodyText.includes('已验证') ||
        bodyText.includes('未验证');
    });

    expect(hasStatusTags).toBeTruthy();
  });

  test('应该显示搜索功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSearch = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('搜索') ||
        bodyText.includes('Search') ||
        document.querySelector('.ant-input-search') ||
        document.querySelector('input[type="search"]');
    });

    expect(hasSearch).toBeTruthy();
  });

  test('应该显示刷新按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
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

  test('应该显示设备操作按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActionButtons = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(btn => btn.innerText);
      return buttonTexts.some(text =>
        text.includes('聊天') ||
        text.includes('验证') ||
        text.includes('详情') ||
        text.includes('重命名') ||
        text.includes('移除')
      );
    });

    expect(hasActionButtons).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-management?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
