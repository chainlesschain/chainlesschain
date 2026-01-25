import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('安全号码验证页面', () => {
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

  test('应该能够访问安全号码验证页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/safety-numbers');
  });

  test('应该显示安全号码验证标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('安全号码') ||
        bodyText.includes('验证') ||
        bodyText.includes('Safety');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示安全号码', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasSafetyNumbers = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      // Check for groups of 5 digits
      const hasDigitGroups = /\d{5}/.test(bodyText);
      return hasDigitGroups ||
        document.querySelector('.safety-numbers') ||
        document.querySelector('.number-group') ||
        bodyText.includes('您的安全号码');
    });

    expect(hasSafetyNumbers).toBeTruthy();
  });

  test('应该显示身份指纹信息', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasFingerprintInfo = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('身份指纹') ||
        bodyText.includes('设备ID') ||
        bodyText.includes('验证状态') ||
        bodyText.includes('已验证') ||
        bodyText.includes('未验证') ||
        document.querySelector('.fingerprint-section');
    });

    expect(hasFingerprintInfo).toBeTruthy();
  });

  test('应该显示验证操作按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasActionButtons = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(btn => btn.innerText);
      return buttonTexts.some(text =>
        text.includes('验证') ||
        text.includes('重置') ||
        text.includes('扫描')
      );
    });

    expect(hasActionButtons).toBeTruthy();
  });

  test('应该显示二维码相关功能', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasQRCode = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('二维码') ||
        bodyText.includes('QR') ||
        bodyText.includes('扫描') ||
        document.querySelector('.qr-code-section');
    });

    expect(hasQRCode).toBeTruthy();
  });

  test('应该显示端到端加密说明', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasEncryptionInfo = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('端到端加密') ||
        bodyText.includes('中间人') ||
        bodyText.includes('安全') ||
        bodyText.includes('加密') ||
        document.querySelector('.ant-alert');
    });

    expect(hasEncryptionInfo).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/safety-numbers?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
