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

  // 设置固定的 userData 路径，确保配置文件能被读取（跨平台兼容）
  const os = require('os');
  let userDataPath: string;
  switch (process.platform) {
    case 'darwin':
      userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'chainlesschain');
      break;
    case 'win32':
      userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'chainlesschain');
      break;
    default: // Linux and others
      userDataPath = path.join(os.homedir(), '.config', 'chainlesschain');
  }

  // 启动Electron（增加超时时间，指定 userData 路径，添加测试环境参数）
  const app = await electron.launch({
    args: [
      mainPath,
      `--user-data-dir=${userDataPath}`,
      // 测试环境下禁用 GPU 加速以避免 GPU 进程崩溃
      '--disable-gpu',
      '--disable-gpu-compositing',
      // 在 CI 环境或无头模式下需要禁用沙箱
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // 禁用硬件加速
      '--disable-software-rasterizer',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 120000, // 120秒启动超时（应用初始化需要较长时间）
  });

  // 等待并获取第一个窗口（增加超时以适应较慢的初始化）
  const window = await app.firstWindow({
    timeout: 90000, // 90秒窗口创建超时
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
 *
 * 支持两种格式：
 * - 点分格式：'system.getSystemInfo' -> electronAPI.system.getSystemInfo()
 * - 冒号格式：'system:get-system-info' -> 转换为 electronAPI.system.getSystemInfo()
 */
export async function callIPC<T>(
  window: Page,
  channel: string,
  ...args: any[]
): Promise<T> {
  return await window.evaluate(
    async ({ channel, args }) => {
      // 优先使用 electronAPI 对象（推荐方式）
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

      // 备用：通过 window.api.invoke 调用（如果可用）
      if ((window as any).api && typeof (window as any).api.invoke === 'function') {
        return await (window as any).api.invoke(channel, ...args);
      }

      // 最后备用：通过 window.electron.ipcRenderer 直接调用
      // 注意：这种方式需要传入正确的 IPC 通道名（如 'system:get-system-info'）
      if ((window as any).electron && (window as any).electron.ipcRenderer) {
        return await (window as any).electron.ipcRenderer.invoke(channel, ...args);
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
