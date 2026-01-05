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
  const mainPath = path.join(__dirname, '../../dist/main/index.js');

  // 设置固定的 userData 路径，确保配置文件能被读取
  const os = require('os');
  const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'chainlesschain');

  // 启动Electron（增加超时时间，指定 userData 路径）
  const app = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataPath}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      // 测试模式：跳过慢速初始化
      SKIP_SLOW_INIT: 'true',
      // Mock硬件设备（U-Key等）
      MOCK_HARDWARE: 'true',
      // Mock LLM服务
      MOCK_LLM: 'true',
    },
    timeout: 120000, // 120秒启动超时（从60秒增加）
  });

  // 等待并获取第一个窗口（增加超时）
  const window = await app.firstWindow({
    timeout: 60000, // 60秒窗口创建超时（从30秒增加）
  });

  // 等待加载完成
  await window.waitForLoadState('domcontentloaded', {
    timeout: 30000,
  });

  // 等待IPC API准备就绪（可选，某些应用可能不需要electronAPI）
  try {
    await window.waitForFunction(
      () => {
        return (
          typeof (window as any).electronAPI !== 'undefined' ||
          typeof (window as any).electron !== 'undefined' ||
          typeof (window as any).api !== 'undefined'
        );
      },
      { timeout: 10000 }
    );
  } catch (error) {
    console.warn('Warning: electronAPI not found, but continuing anyway');
  }

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
 * 使用electronAPI暴露的接口调用IPC
 * IPC通道格式如 'project:get-all' 会被转换为 electronAPI的方法调用
 */
export async function callIPC<T>(
  window: Page,
  channel: string,
  ...args: any[]
): Promise<T> {
  return await window.evaluate(
    async ({ channel, args }) => {
      // 通过window.electron对象调用IPC（如果可用）
      if ((window as any).electron && (window as any).electron.ipcRenderer) {
        return await (window as any).electron.ipcRenderer.invoke(channel, ...args);
      }

      // 或者通过preload暴露的API
      if ((window as any).api && typeof (window as any).api.invoke === 'function') {
        return await (window as any).api.invoke(channel, ...args);
      }

      // 最后尝试使用electronAPI对象（如果是嵌套路径格式）
      // 例如：'project.getAll' -> electronAPI.project.getAll()
      if ((window as any).electronAPI) {
        // 如果是IPC通道格式（如 'project:get-all'），转换为对象路径
        let apiPath = channel;
        if (channel.includes(':')) {
          // 将 'project:get-all' 转换为 'project.getAll'
          const [module, method] = channel.split(':');
          // 将 kebab-case 转换为 camelCase
          const camelMethod = method.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          apiPath = `${module}.${camelMethod}`;
        }

        const pathParts = apiPath.split('.');
        let api: any = (window as any).electronAPI;

        for (const part of pathParts) {
          api = api[part];
          if (!api) {
            throw new Error(`API path not found: ${apiPath} (original: ${channel})`);
          }
        }

        if (typeof api !== 'function') {
          throw new Error(`API is not a function: ${apiPath}`);
        }

        return await api(...args);
      }

      throw new Error('No IPC interface found in window object');
    },
    { channel, args }
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
