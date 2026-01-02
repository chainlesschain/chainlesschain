/**
 * E2E测试辅助工具
 * 提供Electron应用启动、窗口管理等工具函数
 */

import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

export interface ElectronTestContext {
  app: ElectronApplication;
  window: Page;
}

/**
 * 启动Electron应用
 */
export async function launchElectronApp(): Promise<ElectronTestContext> {
  // 确定主进程入口文件路径
  const mainPath = path.join(__dirname, '../../desktop-app-vue/dist/main/index.js');

  // 启动Electron
  const app = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  // 等待并获取第一个窗口
  const window = await app.firstWindow();

  // 等待加载完成
  await window.waitForLoadState('domcontentloaded');

  // 等待IPC API准备就绪
  await window.waitForFunction(() => {
    return typeof (window as any).electronAPI !== 'undefined';
  });

  return { app, window };
}

/**
 * 关闭Electron应用
 */
export async function closeElectronApp(app: ElectronApplication): Promise<void> {
  await app.close();
}

/**
 * 调用IPC API
 */
export async function callIPC<T>(
  window: Page,
  apiPath: string,
  ...args: any[]
): Promise<T> {
  return await window.evaluate(
    async ({ path, args }) => {
      const pathParts = path.split('.');
      let api: any = (window as any).electronAPI;

      for (const part of pathParts) {
        api = api[part];
        if (!api) {
          throw new Error(`API path not found: ${path}`);
        }
      }

      if (typeof api !== 'function') {
        throw new Error(`API is not a function: ${path}`);
      }

      return await api(...args);
    },
    { path: apiPath, args }
  );
}

/**
 * 等待IPC响应
 */
export async function waitForIPC(
  window: Page,
  timeout: number = 5000
): Promise<void> {
  await window.waitForTimeout(timeout);
}

/**
 * 截图保存
 */
export async function takeScreenshot(
  window: Page,
  name: string
): Promise<void> {
  await window.screenshot({
    path: `test-results/screenshots/${name}.png`,
  });
}
