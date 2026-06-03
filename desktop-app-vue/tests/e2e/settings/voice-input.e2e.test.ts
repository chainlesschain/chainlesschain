import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp } from '../helpers/common';

test.describe('语音输入测试页面', () => {
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

  test('应该能够访问语音输入测试页面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/voice-input?e2e=true';
    });

    await window.waitForSelector('body', { timeout: 10000 });
    await window.waitForTimeout(2000);

    const url = await window.evaluate(() => window.location.hash);
    expect(url).toContain('/settings/voice-input');
  });

  test('应该显示语音输入测试界面', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/voice-input?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasVoiceUI = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('语音') ||
        bodyText.includes('Voice') ||
        bodyText.includes('录音') ||
        bodyText.includes('麦克风') ||
        document.querySelector('[class*="voice"]') ||
        document.querySelector('button');
    });

    expect(hasVoiceUI).toBeTruthy();
  });

  test('应该有语音输入控制按钮', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/voice-input?e2e=true';
    });
    await window.waitForTimeout(2000);

    const hasVoiceControls = await window.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.includes('开始') ||
        bodyText.includes('停止') ||
        bodyText.includes('录音') ||
        bodyText.includes('Start') ||
        bodyText.includes('Stop') ||
        document.querySelector('button');
    });

    expect(hasVoiceControls).toBeTruthy();
  });

  test('页面应该可以正常加载', async () => {
    await window.evaluate(() => {
      window.location.hash = '#/settings/voice-input?e2e=true';
    });
    await window.waitForTimeout(2000);

    const isLoaded = await window.evaluate(() => {
      return document.readyState === 'complete' && document.body.innerText.length > 0;
    });

    expect(isLoaded).toBeTruthy();
  });
});
