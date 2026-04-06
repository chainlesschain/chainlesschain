/**
 * E2E测试辅助工具
 * 提供Electron应用启动、窗口管理等工具函数
 */

import {
  _electron as electron,
  ElectronApplication,
  Page,
} from "@playwright/test";
import fs from "fs";
import path from "path";

export interface ElectronTestContext {
  app: ElectronApplication;
  window: Page;
}

let hasResetTestProfile = false;

/**
 * 启动Electron应用
 */
export async function launchElectronApp(): Promise<ElectronTestContext> {
  // 确定主进程入口文件路径
  const mainPath = path.join(
    __dirname,
    "../../desktop-app-vue/dist/main/index.js",
  );

  const os = require("os");
  const userDataPath = path.join(
    os.tmpdir(),
    "chainlesschain-e2e",
    "desktop-vue",
  );
  if (!hasResetTestProfile) {
    fs.rmSync(userDataPath, { recursive: true, force: true });
    hasResetTestProfile = true;
  }

  // 启动Electron（增加超时时间，指定 userData 路径，添加测试环境参数）
  const app = await electron.launch({
    args: [
      mainPath,
      `--user-data-dir=${userDataPath}`,
      // 测试环境下禁用 GPU 加速以避免 GPU 进程崩溃
      "--disable-gpu",
      "--disable-gpu-compositing",
      // 在 CI 环境或无头模式下需要禁用沙箱
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Linux CI: /dev/shm 分区可能太小，使用 /tmp 代替
      "--disable-dev-shm-usage",
      // 禁用扩展和不必要的后台功能以加速启动
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      SKIP_SLOW_INIT: "true",
      MOCK_HARDWARE: "true",
      MOCK_LLM: "true",
      CHAINLESSCHAIN_DISABLE_NATIVE_DB: "1",
      // Linux: 强制使用软件 OpenGL
      ...(process.platform === "linux" ? { LIBGL_ALWAYS_SOFTWARE: "1" } : {}),
    },
    timeout: 120000, // 120秒启动超时（应用初始化需要较长时间）
  });

  // 等待并获取第一个窗口（增加超时以适应较慢的初始化）
  const window = await app.firstWindow({
    timeout: 90000, // 90秒窗口创建超时
  });

  // 等待加载完成
  await window.waitForLoadState("domcontentloaded", {
    timeout: 30000,
  });

  // 等待IPC API准备就绪（可选，某些应用可能不需要electronAPI）
  try {
    await window.waitForFunction(
      () => {
        return (
          typeof (window as any).electronAPI !== "undefined" ||
          typeof (window as any).electron !== "undefined" ||
          typeof (window as any).api !== "undefined"
        );
      },
      { timeout: 10000 },
    );
  } catch (error) {
    console.warn("Warning: electronAPI not found, but continuing anyway");
  }

  const setupCompletedDuringLaunch = await ensureInitialSetup(window, userDataPath);
  if (setupCompletedDuringLaunch) {
    await app.close();
    return launchElectronApp();
  }
  await loginIfNeeded(window);
  await waitForTeamIpcReady(window);

  return { app, window };
}

async function ensureInitialSetup(window: Page, userDataPath: string): Promise<boolean> {
  const setupStatus = await window.evaluate(async () => {
    if ((window as any).electronAPI?.initialSetup?.getStatus) {
      return await (window as any).electronAPI.initialSetup.getStatus();
    }

    if ((window as any).electron?.ipcRenderer) {
      return await (window as any).electron.ipcRenderer.invoke(
        "initial-setup:get-status",
      );
    }

    return null;
  });

  if (!setupStatus || setupStatus.completed) {
    return false;
  }

  const config = {
    edition: "personal",
    paths: {
      projectRoot: path.join(userDataPath, "projects"),
      database: path.join(userDataPath, "data", "chainlesschain.db"),
    },
    llm: {
      provider: "ollama",
      apiKey: "",
      baseUrl: "",
      model: "",
    },
    enterprise: {
      serverUrl: "",
      apiKey: "",
      tenantId: "",
    },
  };

  const result = await window.evaluate(async (setupConfig) => {
    if ((window as any).electronAPI?.initialSetup?.complete) {
      return await (window as any).electronAPI.initialSetup.complete(
        setupConfig,
      );
    }

    if ((window as any).electron?.ipcRenderer) {
      return await (window as any).electron.ipcRenderer.invoke(
        "initial-setup:complete",
        setupConfig,
      );
    }

    throw new Error("No initial setup IPC interface found");
  }, config);

  if (!result?.success) {
    throw new Error(`Initial setup failed: ${result?.error || "unknown error"}`);
  }

  return true;
}

async function loginIfNeeded(window: Page): Promise<void> {
  const hasLogin = await window.locator('[data-testid="login-container"]').count();
  if (!hasLogin) {
    return;
  }

  await performLogin(window);
}

async function waitForTeamIpcReady(window: Page): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastError = "team IPC not ready";

  while (Date.now() < deadline) {
    try {
      const result = await window.evaluate(async () => {
        if ((window as any).electron?.ipcRenderer) {
          return await (window as any).electron.ipcRenderer.invoke(
            "team:get-teams",
            {
              orgId: "__e2e_probe__",
              options: {},
            },
          );
        }

        if ((window as any).electronAPI?.team?.getTeams) {
          return await (window as any).electronAPI.team.getTeams({
            orgId: "__e2e_probe__",
            options: {},
          });
        }

        throw new Error("No team IPC interface found");
      });

      if (result && typeof result.success === "boolean") {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await window.waitForTimeout(1000);
  }

  throw new Error(`Timed out waiting for team IPC readiness: ${lastError}`);
}

async function performLogin(window: Page): Promise<void> {
  await window.waitForSelector('[data-testid="login-container"]', {
    timeout: 20000,
  });

  const usernameInput = window.locator('[data-testid="username-input"]');
  const passwordInput = window.locator('[data-testid="password-input"]');
  const loginButton = window.locator('[data-testid="login-button"]');

  if (await usernameInput.count()) {
    await usernameInput.fill("admin");
  }

  if (await passwordInput.count()) {
    await passwordInput.fill("123456");
    await passwordInput.press("Enter");
  } else {
    await loginButton.click();
  }

  await window.waitForTimeout(1500);

  const stillOnLogin = await window.locator('[data-testid="login-container"]').count();
  if (stillOnLogin) {
    throw new Error("Login did not complete successfully");
  }
}

/**
 * 关闭Electron应用
 */
export async function closeElectronApp(
  app: ElectronApplication,
): Promise<void> {
  if (!app) {
    return;
  }
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
        if (channel.includes(":")) {
          // 将 'project:get-all' 转换为 'project.getAll'
          // 将 'project:stats:start' 转换为 'project.stats.start'
          const parts = channel.split(":");
          const convertedParts = parts.map((part, index) => {
            // 第一部分保持不变（模块名）
            if (index === 0) return part;
            // 其他部分将 kebab-case 转换为 camelCase
            return part.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          });
          apiPath = convertedParts.join(".");
        }

        const pathParts = apiPath.split(".");
        let api: any = (window as any).electronAPI;

        for (const part of pathParts) {
          api = api[part];
          if (!api) {
            throw new Error(
              `API path not found: ${apiPath} (original: ${channel})`,
            );
          }
        }

        if (typeof api !== "function") {
          throw new Error(`API is not a function: ${apiPath}`);
        }

        return await api(...args);
      }

      // 备用：通过 window.api.invoke 调用（如果可用）
      if (
        (window as any).api &&
        typeof (window as any).api.invoke === "function"
      ) {
        return await (window as any).api.invoke(channel, ...args);
      }

      // 最后备用：通过 window.electron.ipcRenderer 直接调用
      // 注意：这种方式需要传入正确的 IPC 通道名（如 'system:get-system-info'）
      if ((window as any).electron && (window as any).electron.ipcRenderer) {
        return await (window as any).electron.ipcRenderer.invoke(
          channel,
          ...args,
        );
      }

      throw new Error("No IPC interface found in window object");
    },
    { channel, args },
  );
}

/**
 * 等待IPC响应
 */
export async function waitForIPC(
  window: Page,
  timeout: number = 5000,
): Promise<void> {
  await window.waitForTimeout(timeout);
}

/**
 * 截图保存
 */
export async function takeScreenshot(
  window: Page,
  name: string,
): Promise<void> {
  await window.screenshot({
    path: `test-results/screenshots/${name}.png`,
  });
}
