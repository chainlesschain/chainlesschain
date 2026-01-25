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
  let userDataPath;

  // 根据操作系统选择正确的路径
  if (process.platform === 'win32') {
    userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'chainlesschain-desktop-vue');
  } else if (process.platform === 'darwin') {
    userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'chainlesschain-desktop-vue');
  } else {
    // Linux
    userDataPath = path.join(os.homedir(), '.config', 'chainlesschain-desktop-vue');
  }

  // 查找Electron可执行文件路径（优先使用根目录的node_modules）
  const electronPath = require('electron') as string;

  console.log('[Test Helper] Electron path:', electronPath);
  console.log('[Test Helper] Main path:', mainPath);
  console.log('[Test Helper] User data path:', userDataPath);

  // 启动Electron（增加超时时间，指定 userData 路径）
  const app = await electron.launch({
    executablePath: electronPath,
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
  try {
    await window.screenshot({
      path: `test-results/screenshots/${name}.png`,
      timeout: 5000, // 减少超时时间
    });
  } catch (error) {
    console.warn(`[Helper] 截图失败 (${name}):`, error.message);
    // 不抛出错误，继续执行测试
  }
}

/**
 * 执行登录
 *
 * @param window - Playwright Page对象
 * @param options - 登录选项
 * @returns Promise<void>
 */
export async function login(
  window: Page,
  options: {
    username?: string;
    password?: string;
    pin?: string;
    timeout?: number;
  } = {}
): Promise<void> {
  const {
    username = 'admin',
    password = '123456',
    pin = '123456',
    timeout = 10000
  } = options;

  console.log('[Test Helper] 开始登录流程...');

  try {
    // 等待页面完全加载
    await window.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('[Test Helper] networkidle超时，继续...');
    });
    await window.waitForTimeout(2000); // 额外等待Vue渲染

    // 等待登录页面加载
    const isLoginPage = await window.evaluate(() => {
      return window.location.hash.includes('/login');
    });

    if (!isLoginPage) {
      console.log('[Test Helper] 当前不在登录页面，跳过登录');
      return;
    }

    console.log('[Test Helper] 当前在登录页面，等待登录容器...');

    // 等待登录容器出现（增加超时时间）
    await window.waitForSelector('[data-testid="login-container"]', { timeout: 20000 });
    console.log('[Test Helper] 登录页面已加载');

    // 检查是否是U盾登录模式
    const pinInput = await window.$('[data-testid="pin-input"]');

    if (pinInput) {
      // U盾登录模式
      console.log('[Test Helper] 检测到U盾登录模式，使用PIN码登录');
      await pinInput.fill(pin);
      await window.waitForTimeout(300);
    } else {
      // 密码登录模式
      console.log('[Test Helper] 使用用户名密码登录');

      // 填写用户名
      const usernameInput = await window.$('[data-testid="username-input"]');
      if (!usernameInput) {
        throw new Error('未找到用户名输入框');
      }
      await usernameInput.fill(username);
      await window.waitForTimeout(300);

      // 填写密码
      const passwordInput = await window.$('[data-testid="password-input"]');
      if (!passwordInput) {
        throw new Error('未找到密码输入框');
      }
      await passwordInput.fill(password);
      await window.waitForTimeout(300);
    }

    // 点击登录按钮或按Enter键登录
    console.log('[Test Helper] 触发登录...');

    // 尝试按Enter键（更可靠）
    try {
      if (pinInput) {
        await pinInput.press('Enter');
      } else {
        const passwordInput = await window.$('[data-testid="password-input"]');
        if (passwordInput) {
          await passwordInput.press('Enter');
        }
      }
    } catch (error) {
      console.log('[Test Helper] Enter键登录失败，尝试点击按钮');

      // 如果Enter键失败，尝试force点击按钮
      const loginButton = await window.$('[data-testid="login-button"]');
      if (!loginButton) {
        throw new Error('未找到登录按钮');
      }
      await loginButton.click({ force: true });
    }

    // 等待登录完成（URL改变）
    await window.waitForTimeout(2000);

    // 检查是否登录成功（不再是登录页面）
    const currentUrl = await window.evaluate(() => window.location.hash);

    if (currentUrl.includes('/login')) {
      // 可能登录失败，检查错误提示
      const errorMessage = await window.$('.ant-message-error');
      if (errorMessage) {
        const errorText = await errorMessage.textContent();
        throw new Error(`登录失败: ${errorText}`);
      }
      throw new Error('登录未成功，仍在登录页面');
    }

    console.log('[Test Helper] ✅ 登录成功！当前URL:', currentUrl);
  } catch (error) {
    console.error('[Test Helper] ❌ 登录失败:', error);
    await takeScreenshot(window, 'login-error');
    throw error;
  }
}

/**
 * Retry operation with exponential backoff
 * Improves reliability for flaky operations
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    exponentialBackoff?: boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 5000,
    exponentialBackoff = true
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries - 1) {
        console.error(`[RetryOperation] All ${maxRetries} attempts failed`);
        throw error;
      }

      const delay = exponentialBackoff
        ? Math.min(initialDelay * Math.pow(2, attempt), maxDelay)
        : initialDelay;

      console.warn(`[RetryOperation] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Operation failed');
}

/**
 * Screenshot on test failure
 * Automatically attaches screenshot to test report
 */
export async function screenshotOnFailure(
  window: Page,
  testName: string,
  testInfo: any
): Promise<void> {
  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      const screenshot = await window.screenshot({
        fullPage: true,
        timeout: 5000
      });

      const fileName = `failure-${testName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;

      await testInfo.attach(fileName, {
        body: screenshot,
        contentType: 'image/png'
      });

      console.log(`[Screenshot] Saved failure screenshot: ${fileName}`);
    } catch (error) {
      console.warn(`[Screenshot] Failed to capture screenshot:`, error);
    }
  }
}

/**
 * Wait for network idle state
 */
export async function waitForNetworkIdle(
  window: Page,
  timeout: number = 5000
): Promise<void> {
  try {
    await window.waitForLoadState('networkidle', { timeout });
  } catch (error) {
    console.warn('[NetworkIdle] Timeout waiting for network idle, continuing...');
  }
}

/**
 * Force close all modals (can be called independently)
 */
export async function forceCloseAllModals(window: Page): Promise<void> {
  console.log('[Helper] Forcing modal closure...');

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const hasModal = await window.evaluate(() => {
        const modals = document.querySelectorAll('.ant-modal-wrap, .ant-drawer-open');
        return Array.from(modals).some((m) => {
          const el = m as HTMLElement;
          return el.style.display !== 'none' && el.offsetParent !== null;
        });
      });

      if (!hasModal) {
        if (attempt > 0) {
          console.log('[Helper] ✅ All modals closed');
        }
        break;
      }

      // Method 1: Click close buttons
      await window.evaluate(() => {
        const closeBtns = document.querySelectorAll('.ant-modal-close, .ant-drawer-close');
        closeBtns.forEach((btn) => {
          const el = btn as HTMLElement;
          if (el.offsetParent !== null) el.click();
        });
      });

      await window.waitForTimeout(300);

      // Method 2: Press Escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);

      // Method 3: Force hide (last resort)
      if (attempt >= 1) {
        await window.evaluate(() => {
          const modals = document.querySelectorAll('.ant-modal-wrap, .ant-drawer-open');
          modals.forEach((modal) => {
            const el = modal as HTMLElement;
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
          });
        });
        await window.waitForTimeout(300);
      }
    } catch (e) {
      console.log(`[Helper] Modal close attempt ${attempt + 1} failed:`, e);
    }
  }
}

/**
 * Custom assertion: expect element to be visible
 */
export async function expectElementVisible(
  window: Page,
  selector: string,
  options?: { timeout?: number }
): Promise<void> {
  const timeout = options?.timeout || 5000;

  try {
    const element = await window.waitForSelector(selector, { timeout, state: 'visible' });

    if (!element) {
      throw new Error(`Element ${selector} not found`);
    }

    const isVisible = await element.isVisible();

    if (!isVisible) {
      throw new Error(`Element ${selector} is not visible`);
    }
  } catch (error) {
    console.error(`[Assertion] Element visibility check failed for: ${selector}`);
    throw error;
  }
}

/**
 * Custom assertion: expect text content
 */
export async function expectTextContent(
  window: Page,
  selector: string,
  expectedText: string | RegExp,
  options?: { timeout?: number }
): Promise<void> {
  const timeout = options?.timeout || 5000;

  try {
    const element = await window.waitForSelector(selector, { timeout });

    if (!element) {
      throw new Error(`Element ${selector} not found`);
    }

    const actualText = await element.textContent();

    if (typeof expectedText === 'string') {
      if (!actualText?.includes(expectedText)) {
        throw new Error(
          `Expected text "${expectedText}" not found. Actual: "${actualText}"`
        );
      }
    } else {
      if (!expectedText.test(actualText || '')) {
        throw new Error(
          `Text does not match pattern ${expectedText}. Actual: "${actualText}"`
        );
      }
    }
  } catch (error) {
    console.error(`[Assertion] Text content check failed for: ${selector}`);
    throw error;
  }
}
