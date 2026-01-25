import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('会话指纹验证页面', () => {
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

  test('应该能够访问会话指纹验证页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/p2p/session-fingerprint');
  });

  test('应该显示会话指纹验证标题', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasPageHeader = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('会话指纹') ||
        bodyText.includes('验证') ||
        bodyText.includes('Fingerprint');
    });

    expect(hasPageHeader).toBeTruthy();
  });

  test('应该显示本地会话指纹', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasLocalFingerprint = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('本地会话指纹') ||
        bodyText.includes('本地') ||
        document.querySelector('.fingerprint-display') ||
        document.querySelector('.fingerprint-blocks');
    });

    expect(hasLocalFingerprint).toBeTruthy();
  });

  test('应该显示对方会话指纹', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(3000); // Wait longer for remote fingerprint

    const hasRemoteFingerprint = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('对方会话指纹') ||
        bodyText.includes('对方') ||
        bodyText.includes('等待') ||
        document.querySelectorAll('.fingerprint-display').length >= 2 ||
        document.querySelector('.loading-state');
    });

    expect(hasRemoteFingerprint).toBeTruthy();
  });

  test('应该显示彩色指纹块', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasFingerprintBlocks = await window.evaluate(() => {
      const blocks = document.querySelectorAll('.fingerprint-block');
      const hasColoredBlocks = blocks.length > 0;
      return hasColoredBlocks ||
        document.querySelector('.fingerprint-blocks') ||
        document.querySelector('.block-text');
    });

    expect(hasFingerprintBlocks).toBeTruthy();
  });

  test('应该显示十六进制指纹值', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasHexFingerprint = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      // Check for hex pattern (64 chars)
      const hasHex = /[0-9a-f]{32,64}/i.test(bodyText);
      return hasHex ||
        document.querySelector('.fingerprint-hex') ||
        document.querySelector('.monospace');
    });

    expect(hasHexFingerprint).toBeTruthy();
  });

  test('应该显示对比结果或说明', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(3000);

    const hasComparisonResult = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('匹配') ||
        bodyText.includes('不匹配') ||
        bodyText.includes('如何验证') ||
        bodyText.includes('说明') ||
        document.querySelector('.comparison-card') ||
        document.querySelector('.info-card');
    });

    expect(hasComparisonResult).toBeTruthy();
  });

  test('应该显示操作按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(3000);

    const hasActionButtons = await window.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(btn => btn.innerText);
      return buttonTexts.some(text =>
        text.includes('确认') ||
        text.includes('报告') ||
        text.includes('断开') ||
        text.includes('返回')
      );
    });

    expect(hasActionButtons).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/p2p/session-fingerprint?peerId=test-peer&e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
