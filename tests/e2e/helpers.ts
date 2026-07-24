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
    `worker-${process.pid}`,
  );
  if (!hasResetTestProfile) {
    fs.rmSync(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    hasResetTestProfile = true;
  }

  // Pre-write app-config.json with `ui.useWebShellExperimental: false` BEFORE
  // launching. Background: the Phase 1.6 hard-flip in database-config.js made
  // useWebShellExperimental default to TRUE; AppConfig writes that default to
  // app-config.json on every fresh launch. shouldRunWebShell() then sees
  // `persisted === true` and short-circuits to web-shell mode IGNORING our
  // --no-web-shell argv and CHAINLESSCHAIN_WEB_SHELL=0 env (settings are
  // authoritative ahead of CLI flags by design — see
  // web-shell-bootstrap.js:344). Run-25596369685 confirmed this: helper had
  // both CLI signals and main still booted into WebShell. Pre-writing the
  // file flips persisted to false before AppConfig.loadAsync gets a chance.
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, "app-config.json"),
    JSON.stringify(
      { ui: { useWebShellExperimental: false, useV6ShellByDefault: false } },
      null,
      2,
    ),
    "utf8",
  );

  // These suites validate project-management IPC, not onboarding. Seed the
  // isolated profile before Electron starts so launchElectronApp() does not
  // need to complete setup, close the app, and recursively launch it again.
  fs.writeFileSync(
    path.join(userDataPath, "initial-setup-config.json"),
    JSON.stringify(
      {
        setupCompleted: true,
        completedAt: "2026-01-01T00:00:00.000Z",
        edition: "personal",
      },
      null,
      2,
    ),
    "utf8",
  );

  // 启动Electron（增加超时时间，指定 userData 路径，添加测试环境参数）
  // Belt-and-braces: settings pre-write above is the load-bearing fix; argv
  // + env below are the secondary opt-out paths shouldRunWebShell honours
  // when settings is unset (kept for defence-in-depth).
  const app = await electron.launch({
    args: [
      mainPath,
      `--user-data-dir=${userDataPath}`,
      // Force V5/V6 desktop renderer (NOT web-shell HTTP server). Both the
      // env and the flag are checked; we set both for belt-and-braces.
      "--no-web-shell",
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
      // The serial PM journeys share one sql.js process. Avoid exporting the
      // full fixture database after every INSERT; production is unaffected
      // because DatabaseManager honours this flag only in NODE_ENV=test.
      CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "1",
      // These journeys exercise permission/team business flows with generated
      // fixture DIDs. Actor/RBAC enforcement has dedicated security tests and
      // requires an unlocked real DID, which this isolated profile omits.
      CC_IPC_ACTOR_GUARD: "off",
      CC_IPC_RBAC_GUARD: "off",
      // Pair with --no-web-shell argv: shouldRunWebShell() honours either.
      CHAINLESSCHAIN_WEB_SHELL: "0",
      // Linux: 强制使用软件 OpenGL
      ...(process.platform === "linux" ? { LIBGL_ALWAYS_SOFTWARE: "1" } : {}),
    },
    timeout: 120000, // 120秒启动超时（应用初始化需要较长时间）
  });

  // Pipe main-process stdout/stderr so a preload throw (which is reported on
  // the main process) is visible in CI logs.
  app.process().stdout?.on("data", (chunk) => {
    process.stdout.write(`[electron-main:stdout] ${chunk}`);
  });
  app.process().stderr?.on("data", (chunk) => {
    process.stderr.write(`[electron-main:stderr] ${chunk}`);
  });

  // 等待并获取第一个窗口（增加超时以适应较慢的初始化）
  const window = await app.firstWindow({
    timeout: 90000, // 90秒窗口创建超时
  });

  // Pipe renderer console + uncaught errors so we can see preload failures.
  window.on("console", (msg) => {
    process.stdout.write(`[renderer:${msg.type()}] ${msg.text()}\n`);
  });
  window.on("pageerror", (err) => {
    process.stderr.write(`[renderer:pageerror] ${err.stack || err.message}\n`);
  });
  window.on("crash", () => {
    process.stderr.write("[renderer:crash]\n");
  });

  // 等待加载完成
  await window.waitForLoadState("domcontentloaded", {
    timeout: 30000,
  });

  // Wait for preload to expose at least one bridge object. Previously this
  // catch+warn'd-and-continued, masking the only signal that preload didn't
  // load. Now we throw with a snapshot of what *is* on window so CI tells us
  // whether the preload script ran at all.
  try {
    await window.waitForFunction(
      () => {
        return (
          typeof (window as any).electronAPI !== "undefined" ||
          typeof (window as any).electron !== "undefined" ||
          typeof (window as any).api !== "undefined"
        );
      },
      undefined,
      { timeout: 60000 },
    );
  } catch (error) {
    const diagnostics = await window.evaluate(() => {
      const w = window as any;
      const keys = Object.keys(w).sort();
      return {
        url: w.location?.href,
        readyState: w.document?.readyState,
        title: w.document?.title,
        // Truncate so we don't blow the CI log buffer.
        windowKeys: keys.slice(0, 80),
        windowKeyCount: keys.length,
        hasElectronAPI: typeof w.electronAPI,
        hasElectron: typeof w.electron,
        hasApi: typeof w.api,
        userAgent: w.navigator?.userAgent,
      };
    });
    throw new Error(
      `Preload bridge never exposed (electronAPI/electron/api all undefined after 60s). ` +
        `Renderer state: ${JSON.stringify(diagnostics, null, 2)}. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
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
