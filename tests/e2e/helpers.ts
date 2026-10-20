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
const boardConfirmationQueues = new WeakMap<
  ElectronApplication,
  Promise<void>
>();

export function buildPmDurableEntrypoint(mainPath: string): string {
  const mainDirectory = path.dirname(mainPath);
  return `"use strict";
if (process.env.NODE_ENV !== "test" || process.env.CC_PM_E2E_DURABLE_SQLITE !== "1") {
  throw new Error("PM durable SQLite entrypoint requires its test-only environment");
}
const { app } = require("electron");
app.setAppPath(${JSON.stringify(mainDirectory)});
const { DatabaseManager, getDatabase } = require(${JSON.stringify(path.join(mainDirectory, "database.js"))});
const { assertStorage, databaseFile } = require(${JSON.stringify(path.join(mainDirectory, "task", "board-action-storage.js"))});
// initialize() tries the encrypted adapter before its sql.js fallback in test mode.
const initializeWithBetterSQLite = DatabaseManager.prototype.initializeWithBetterSQLite;
DatabaseManager.prototype.initializeWithAdapter = initializeWithBetterSQLite;
DatabaseManager.prototype.initializeWithSqlJs = initializeWithBetterSQLite;
// Playwright evaluates in a context without CommonJS require. Keep module
// access in this test-only closure and inspect the live database after startup.
globalThis[Symbol.for("cc.e2e.pm-storage-diagnostics")] = () => {
  const manager = getDatabase();
  const db = manager.getDatabase();
  assertStorage(manager, db);
  return {
    adapter: manager.adapter?.getEngine?.() ?? manager.adapter?.constructor?.name ?? "unknown",
    file: databaseFile(db),
    userDataPath: app.getPath("userData"),
    journalMode: db.prepare("PRAGMA journal_mode").get()?.journal_mode,
    synchronous: db.prepare("PRAGMA synchronous").get()?.synchronous,
    foreignKeys: db.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
  };
};
require(${JSON.stringify(mainPath)});
`;
}

export function readPmDurableDatabaseDiagnostics() {
  const probe = (globalThis as any)[
    Symbol.for("cc.e2e.pm-storage-diagnostics")
  ];
  if (typeof probe !== "function") {
    throw new Error("PM durable SQLite diagnostics entrypoint is unavailable");
  }
  return probe();
}

/**
 * 启动Electron应用
 */
export async function launchElectronApp(
  options: { durableDatabase?: boolean } = {},
): Promise<ElectronTestContext> {
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
  // PM controlled writes require real file-backed SQLite transactions. Keep
  // NODE_ENV=test and disable encryption only for this disposable profile;
  // the generated entrypoint then maps the sql.js fallback to Better SQLite.
  let entryPath = mainPath;
  if (options.durableDatabase) {
    // Do not let an inherited CI encryption opt-in select the SQLCipher
    // wrapper, which does not expose the transaction API used by this gate.
    fs.writeFileSync(
      path.join(userDataPath, "encryption-config.json"),
      JSON.stringify(
        {
          encryptionEnabled: false,
          encryptionMethod: "password",
          autoMigrate: true,
          firstTimeSetup: false,
          developmentMode: false,
        },
        null,
        2,
      ),
      "utf8",
    );
    entryPath = path.join(userDataPath, "pm-durable-main.cjs");
    fs.writeFileSync(entryPath, buildPmDurableEntrypoint(mainPath), "utf8");
  }

  const app = await electron.launch({
    args: [
      entryPath,
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
      CHAINLESSCHAIN_DISABLE_NATIVE_DB: options.durableDatabase ? "0" : "1",
      // The serial PM journeys share one sql.js process. Avoid exporting the
      // full fixture database after every INSERT; production is unaffected
      // because DatabaseManager honours this flag only in NODE_ENV=test.
      CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: options.durableDatabase
        ? "0"
        : "1",
      ...(options.durableDatabase
        ? {
            CC_PM_E2E_DURABLE_SQLITE: "1",
            CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION: "0",
          }
        : {}),
      // These journeys include synthetic secondary-member DIDs. Actor/RBAC
      // enforcement has dedicated security tests; board reads still require
      // the authenticated owner created by createPmOrganizationFixture().
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

  // Wait for the exact typed capabilities this bootstrap path needs.
  // Previously this catch+warn'd-and-continued, masking the only signal that
  // preload didn't load. Now we throw with a snapshot of what *is* on window
  // so CI tells us whether the preload script ran at all.
  try {
    await window.waitForFunction(
      () => {
        const api = (window as any).electronAPI;
        return (
          typeof api?.initialSetup?.getStatus === "function" &&
          typeof api?.initialSetup?.complete === "function" &&
          typeof api?.team?.getTeams === "function"
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
        hasInitialSetupGetStatus: typeof w.electronAPI?.initialSetup?.getStatus,
        hasInitialSetupComplete: typeof w.electronAPI?.initialSetup?.complete,
        hasTeamGetTeams: typeof w.electronAPI?.team?.getTeams,
        hasElectron: typeof w.electron,
        hasApi: typeof w.api,
        userAgent: w.navigator?.userAgent,
      };
    });
    throw new Error(
      `Typed preload bridge never exposed initialSetup/team capabilities after 60s. ` +
        `Renderer state: ${JSON.stringify(diagnostics, null, 2)}. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const setupCompletedDuringLaunch = await ensureInitialSetup(
    window,
    userDataPath,
  );
  if (setupCompletedDuringLaunch) {
    await app.close();
    return launchElectronApp(options);
  }
  await loginIfNeeded(window);
  await waitForTeamIpcReady(window);

  if (options.durableDatabase) {
    const diagnostics = await app.evaluate(readPmDurableDatabaseDiagnostics);
    const relativeDatabasePath = path.relative(
      diagnostics.userDataPath,
      diagnostics.file,
    );
    if (
      !relativeDatabasePath ||
      relativeDatabasePath === "." ||
      relativeDatabasePath === ".." ||
      relativeDatabasePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDatabasePath)
    ) {
      throw new Error(
        `PM durable SQLite database escaped its isolated userData profile: ${JSON.stringify(diagnostics)}`,
      );
    }
    console.info(`[PM E2E durable SQLite] ${JSON.stringify(diagnostics)}`);
  }

  return { app, window };
}

async function ensureInitialSetup(
  window: Page,
  userDataPath: string,
): Promise<boolean> {
  const setupStatus = await window.evaluate(async () => {
    const getStatus = (window as any).electronAPI?.initialSetup?.getStatus;
    if (typeof getStatus !== "function") {
      throw new Error("Typed initialSetup.getStatus capability is unavailable");
    }
    return await getStatus();
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
    const complete = (window as any).electronAPI?.initialSetup?.complete;
    if (typeof complete !== "function") {
      throw new Error("Typed initialSetup.complete capability is unavailable");
    }
    return await complete(setupConfig);
  }, config);

  if (!result?.success) {
    throw new Error(
      `Initial setup failed: ${result?.error || "unknown error"}`,
    );
  }

  return true;
}

async function loginIfNeeded(window: Page): Promise<void> {
  const loginContainer = window.locator('[data-testid="login-container"]');
  const hasVisibleLogin = await loginContainer.isVisible().catch(() => false);
  if (!hasVisibleLogin) {
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

  try {
    await window.locator('[data-testid="login-container"]').waitFor({
      state: "hidden",
      timeout: 15000,
    });
  } catch {
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

/** Establish a real owner session and organization for authorized board reads. */
export async function createPmOrganizationFixture(
  window: Page,
  name: string,
): Promise<{ actorDid: string; orgId: string }> {
  const identity = await callIPC<{ did: string }>(
    window,
    "did:create-identity",
    { nickname: name },
    { setAsDefault: true },
  );
  if (!identity?.did?.startsWith("did:")) {
    throw new Error("PM fixture did not create a current DID");
  }

  // Authentication captures the current DID, so it must follow identity
  // creation even if launchElectronApp already completed the login screen.
  const authentication = await callIPC<{ success: boolean }>(
    window,
    "auth:verify-password",
    process.env.DEFAULT_USERNAME || "admin",
    process.env.DEFAULT_PASSWORD || "123456",
  );
  if (!authentication?.success) {
    throw new Error("PM fixture password authentication failed");
  }

  const result = await callIPC<{
    success: boolean;
    error?: string;
    organization?: { org_id: string; owner_did: string };
  }>(window, "organization.create", { name, enableInviteCode: false });
  const organization = result?.organization;
  if (
    !result?.success ||
    !organization?.org_id ||
    organization.owner_did !== identity.did
  ) {
    throw new Error(
      `PM fixture organization creation failed: ${result?.error || "invalid owner or organization"}`,
    );
  }

  // Exercise the production read guard now: password success alone does not
  // prove a session exists, and team membership is not organization membership.
  const boards = await callIPC<{ success: boolean }>(
    window,
    "task:get-boards",
    {
      orgId: organization.org_id,
    },
  );
  if (!boards?.success) {
    throw new Error("PM fixture authorized board read failed");
  }
  return { actorDid: identity.did, orgId: organization.org_id };
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

/** Create through the same preview/execute capability used by the board UI. */
export async function createControlledBoardTask(
  app: ElectronApplication,
  window: Page,
  boardId: string,
  taskData: {
    columnId: string;
    title: string;
    description?: string;
    priority?: string;
    estimatedHours?: number;
  },
): Promise<{ success: true; taskId: string }> {
  const idempotencyKey = await window.evaluate(() => crypto.randomUUID());
  const preview: any = await callIPC(window, "task.previewBoardCreate", {
    boardId,
    taskData,
    idempotencyKey,
  });
  if (
    preview?.success !== true ||
    !preview.taskId ||
    preview.request?.actionType !== "board-task.create" ||
    preview.request?.idempotencyKey !== idempotencyKey ||
    preview.request?.input?.boardId !== boardId
  ) {
    throw new Error(
      `Controlled task preview failed: ${JSON.stringify(preview)}`,
    );
  }
  const result = await executeConfirmedBoardAction(app, window, {
    request: preview.request,
    taskId: preview.taskId,
    create: true,
  });
  if (
    result?.success !== true ||
    result.run?.status !== "succeeded" ||
    result.run?.id !== preview.runId ||
    result.run?.target?.id !== preview.taskId
  ) {
    throw new Error(
      `Controlled task creation failed: ${JSON.stringify(result)}`,
    );
  }
  const stored: any = await callIPC(window, "task:get-task", {
    taskId: preview.taskId,
  });
  if (
    stored?.success !== true ||
    stored.task?.id !== preview.taskId ||
    stored.task?.boardId !== boardId ||
    stored.task?.title !== taskData.title
  ) {
    throw new Error(
      `Controlled task readback failed: ${JSON.stringify(stored)}`,
    );
  }
  return { success: true, taskId: preview.taskId };
}

/** Update fields or move a task through the board's governed capability. */
export async function updateControlledBoardTask(
  app: ElectronApplication,
  window: Page,
  taskId: string,
  updates: {
    status?: string;
    priority?: string;
    assigneeDid?: string;
    dueDate?: number;
    actualHours?: number;
    columnId?: string;
    position?: number;
  },
): Promise<{ success: true; taskId: string }> {
  const idempotencyKey = await window.evaluate(() => crypto.randomUUID());
  const preview: any = await callIPC(window, "task.previewBoardUpdate", {
    taskId,
    updates,
    idempotencyKey,
  });
  const actionType = Object.hasOwn(updates, "columnId")
    ? "board-task.move"
    : "board-task.update-fields";
  if (
    preview?.success !== true ||
    preview.request?.actionType !== actionType ||
    preview.request?.target?.id !== taskId ||
    preview.request?.idempotencyKey !== idempotencyKey ||
    !preview.request?.input?.updates ||
    Object.keys(preview.request.input.updates).length !==
      Object.keys(updates).length ||
    Object.entries(updates).some(
      ([key, value]) => preview.request.input.updates[key] !== value,
    )
  ) {
    throw new Error(
      `Controlled task update preview failed: ${JSON.stringify(preview)}`,
    );
  }
  const result = await executeConfirmedBoardAction(app, window, {
    request: preview.request,
    taskId,
    create: false,
  });
  if (
    result?.success !== true ||
    result.run?.status !== "succeeded" ||
    result.run?.id !== preview.runId ||
    result.run?.target?.id !== taskId
  ) {
    throw new Error(`Controlled task update failed: ${JSON.stringify(result)}`);
  }
  const stored: any = await callIPC(window, "task.getBoardEditSource", {
    taskId,
  });
  if (
    stored?.success !== true ||
    stored.task?.id !== taskId ||
    Object.entries(updates).some(
      ([key, value]) =>
        (actionType === "board-task.move"
          ? stored.movement?.[key]
          : stored.task[key]) !== value,
    )
  ) {
    throw new Error(
      `Controlled task update readback failed: ${JSON.stringify(stored)}`,
    );
  }
  return { success: true, taskId };
}

function executeConfirmedBoardAction(
  app: ElectronApplication,
  window: Page,
  action: { request: any; taskId: string; create: boolean },
): Promise<any> {
  // Concurrent submissions can prepare together, but native reviews are
  // single-flight. Queue these simulated user confirmations per app without
  // retrying requests or changing the host's busy/unknown-outcome guards.
  const previous = boardConfirmationQueues.get(app) || Promise.resolve();
  const operation = previous.then(() =>
    confirmBoardAction(app, window, action),
  );
  const completed = operation.then(
    () => {},
    () => {},
  );
  boardConfirmationQueues.set(app, completed);
  void completed.then(() => {
    if (boardConfirmationQueues.get(app) === completed)
      boardConfirmationQueues.delete(app);
  });
  return operation;
}

async function confirmBoardAction(
  app: ElectronApplication,
  window: Page,
  action: { request: any; taskId: string; create: boolean },
): Promise<any> {
  // Automate only the native confirmation for this exact preview. The host
  // still performs its real sender, membership, capability and SQLite checks.
  await app.evaluate(
    ({ dialog }, expected) => {
      const host = dialog as any;
      const key = Symbol.for("cc.e2e.board-action-confirmations");
      if (!host[key]) {
        const original = host.showMessageBox;
        const allowed = new Map<
          string,
          { taskId: string; title: string; button: string; taskLabel: string }
        >();
        host[key] = { original, allowed };
        host.showMessageBox = async (...args: any[]) => {
          const options = args.at(-1);
          for (const [digest, confirmation] of allowed) {
            if (
              options?.title === confirmation.title &&
              options?.buttons?.[1] === confirmation.button &&
              options?.detail?.includes(`操作摘要：${digest}`) &&
              options?.detail?.includes(
                `${confirmation.taskLabel}${JSON.stringify(confirmation.taskId)}`,
              )
            ) {
              allowed.delete(digest);
              return { response: 1, checkboxChecked: false };
            }
          }
          return original.apply(host, args);
        };
      }
      host[key].allowed.set(expected.digest, {
        taskId: expected.taskId,
        title: expected.create ? "确认创建看板任务" : "确认修改看板任务",
        button: expected.create ? "确认创建" : "确认保存",
        taskLabel: expected.create ? "任务ID：" : "任务：",
      });
    },
    {
      digest: action.request.actionDigest,
      taskId: action.taskId,
      create: action.create,
    },
  );
  let result: any;
  try {
    result = await callIPC(
      window,
      action.create ? "task.executeBoardCreate" : "task.executeBoardUpdate",
      { request: action.request },
    );
  } finally {
    await app.evaluate(({ dialog }, digest) => {
      const host = dialog as any;
      const key = Symbol.for("cc.e2e.board-action-confirmations");
      const registered = host[key];
      if (!registered) return;
      registered.allowed.delete(digest);
      if (registered.allowed.size === 0) {
        host.showMessageBox = registered.original;
        delete host[key];
      }
    }, action.request.actionDigest);
  }
  return result;
}
