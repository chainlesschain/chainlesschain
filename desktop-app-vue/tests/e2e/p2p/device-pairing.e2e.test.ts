import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('P2P设备配对页面', () => {
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

  test('应该能够访问设备配对页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/device-pairing');
  });

  test('应该显示设备配对标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('设备配对') ||
        bodyText.includes('Device') ||
        bodyText.includes('Pairing');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示配对状态信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPairingState = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('扫描') ||
        bodyText.includes('验证') ||
        bodyText.includes('配对') ||
        bodyText.includes('成功') ||
        bodyText.includes('失败') ||
        document.querySelector('.pairing-steps') ||
        document.querySelector('.step-container');
    });

    expect(hasPairingState).toBeTruthy();
  });

  test('应该显示取消按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasCancelButton = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(btn =>
        btn.innerText.includes('取消') ||
        btn.innerText.includes('返回')
      );
    });

    expect(hasCancelButton).toBeTruthy();
  });

  test('应该显示配对进度或验证码', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasVerificationCode = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasNumbers = /\d{6}/.test(bodyText);
      return hasNumbers ||
        bodyText.includes('验证码') ||
        bodyText.includes('安全码') ||
        document.querySelector('.verification-code') ||
        document.querySelector('.code-digit') ||
        document.querySelector('.ant-spin');
    });

    expect(hasVerificationCode).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/device-pairing?deviceId=test-device&deviceName=测试设备&e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
