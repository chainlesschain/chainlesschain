/**
 * E2E测试辅助函数
 */

import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

/**
 * 启动Electron应用
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  // 启动Electron
  const app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  // 等待窗口打开
  const page = await app.firstWindow();

  // 等待应用加载完成
  await page.waitForLoadState('domcontentloaded');

  return { app, page };
}

/**
 * 关闭Electron应用
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close();
}

/**
 * 等待元素出现
 */
export async function waitForElement(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout });
}

/**
 * 点击并等待导航
 */
export async function clickAndWait(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click(selector),
  ]);
}

/**
 * 填写表单字段
 */
export async function fillForm(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [selector, value] of Object.entries(fields)) {
    await page.fill(selector, value);
  }
}

/**
 * 截图
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(__dirname, '../../test-results', `${name}.png`),
    fullPage: true,
  });
}

/**
 * 等待文本出现
 */
export async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(`text=${text}`, { timeout });
}

/**
 * 获取元素文本
 */
export async function getElementText(page: Page, selector: string): Promise<string> {
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return await element.textContent() || '';
}

/**
 * 检查元素是否可见
 */
export async function isVisible(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 等待API响应
 */
export async function waitForAPIResponse(
  page: Page,
  urlPattern: string | RegExp,
  action: () => Promise<void>
): Promise<any> {
  const [response] = await Promise.all([
    page.waitForResponse(urlPattern),
    action(),
  ]);

  return await response.json();
}

/**
 * 清除应用数据
 */
export async function clearAppData(app: ElectronApplication): Promise<void> {
  // 执行清除逻辑
  await app.evaluate(async ({ app }) => {
    const fs = require('fs');
    const path = require('path');
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'data', 'chainlesschain.db');

    // 删除数据库文件
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });
}
