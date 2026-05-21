/**
 * webdav-ipc 单元测试 — Phase 3c.2 task #5（IPC 部分）
 *
 * 注入 fake ipcMain + fake database (sql.js) + fake mainWindow，验证：
 *   - registerWebDAVIPC 注册 5 个 handle channel
 *   - ipcGuard 防止重复注册
 *   - config-get / config-set / config-clear 与 sync-credentials 联动
 *   - test / run 在无凭证时返回错误（不崩溃）
 *   - run 触发 engine 后通过 mainWindow.webContents.send 推 progress
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const ipcGuard = require("../../ipc/ipc-guard");
const credentials = require("../sync-credentials");
const { registerWebDAVIPC, PROVIDER_ID } = require("../webdav-ipc");

// ── 内存 secure-config，注入 sync-credentials ──────────────────
const memoryStore = { config: null };
function setupCredsFake() {
  credentials._setDepsForTest({
    getSecureConfigStorage: () => ({
      exists: () => memoryStore.config !== null,
      load: () => memoryStore.config,
      save: (cfg) => {
        memoryStore.config = JSON.parse(JSON.stringify(cfg));
        return true;
      },
    }),
  });
}

// ── fake ipcMain ─────────────────────────────────────────────
function makeFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
    invoke: async (channel, ...args) => {
      const fn = handlers.get(channel);
      if (!fn) {
        throw new Error(`channel not registered: ${channel}`);
      }
      return fn({}, ...args); // event obj 用空对象代
    },
  };
}

// ── fake mainWindow ──────────────────────────────────────────
function makeFakeMainWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(),
    },
  };
}

beforeEach(() => {
  // 重置 ipcGuard 防止跨测试污染
  ipcGuard.unregisterModule?.("webdav-ipc");
  memoryStore.config = null;
  setupCredsFake();
});

describe("webdav-ipc · registration", () => {
  it("registers 7 handlers via injected ipcMain (incl. Phase 3c.D7 orphan cleanup)", () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    expect(ipcMain.handle).toHaveBeenCalledTimes(7);
    const channels = [...ipcMain.handlers.keys()];
    expect(channels).toEqual(
      expect.arrayContaining([
        "sync:webdav:test",
        "sync:webdav:run",
        "sync:webdav:config-get",
        "sync:webdav:config-set",
        "sync:webdav:config-clear",
        "sync:webdav:list-orphans",
        "sync:webdav:delete-orphans",
      ]),
    );
  });

  it("does not re-register when called twice (ipcGuard)", () => {
    const ipcMain1 = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain: ipcMain1 });
    const ipcMain2 = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain: ipcMain2 });
    expect(ipcMain2.handle).not.toHaveBeenCalled();
  });

  it("PROVIDER_ID is 'webdav'", () => {
    expect(PROVIDER_ID).toBe("webdav");
  });
});

describe("webdav-ipc · config CRUD", () => {
  it("config-get returns sanitized empty config when not configured", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:config-get");
    expect(res).toEqual({
      success: true,
      data: expect.objectContaining({
        url: "",
        username: "",
        password: "",
        configured: false,
        status: null,
      }),
    });
  });

  it("config-set persists then config-get returns masked password", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const setRes = await ipcMain.invoke("sync:webdav:config-set", {
      url: "https://nas.example.com/dav",
      username: "alice",
      password: "secret-pass-12345",
      remotePath: "/cc",
    });
    expect(setRes).toEqual({ success: true });

    const getRes = await ipcMain.invoke("sync:webdav:config-get");
    expect(getRes.data.url).toBe("https://nas.example.com/dav");
    expect(getRes.data.username).toBe("alice");
    expect(getRes.data.configured).toBe(true);
    expect(getRes.data.password).not.toBe("secret-pass-12345");
    expect(getRes.data.password).toMatch(/\*+/);
  });

  it("config-set with empty password preserves existing one", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    await ipcMain.invoke("sync:webdav:config-set", {
      url: "https://x",
      username: "u",
      password: "original-pass",
      remotePath: "/",
    });
    // 二次 set 时 password 留空（renderer 不回传 mask 后的值）
    await ipcMain.invoke("sync:webdav:config-set", {
      url: "https://y",
      username: "u",
      password: "",
      remotePath: "/",
    });
    expect(memoryStore.config.sync.webdav.password).toBe("original-pass");
    expect(memoryStore.config.sync.webdav.url).toBe("https://y");
  });

  it("config-set rejects missing url", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:config-set", {
      username: "u",
      password: "p",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/url 必填/);
  });

  it("config-set rejects non-object payload", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:config-set", null);
    expect(res.success).toBe(false);
  });

  it("config-clear removes credentials", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    await ipcMain.invoke("sync:webdav:config-set", {
      url: "https://x",
      username: "u",
      password: "p",
    });
    expect(memoryStore.config.sync.webdav).toBeDefined();
    await ipcMain.invoke("sync:webdav:config-clear");
    expect(memoryStore.config.sync?.webdav).toBeUndefined();
  });
});

describe("webdav-ipc · test/run guards", () => {
  it("test returns error when credentials missing", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:test");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("run returns error when database missing", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    await ipcMain.invoke("sync:webdav:config-set", {
      url: "https://x",
      username: "u",
      password: "p",
    });
    const res = await ipcMain.invoke("sync:webdav:run");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库未初始化/);
  });

  it("run returns error when credentials missing (with database present)", async () => {
    const ipcMain = makeFakeIpcMain();
    const fakeDb = { db: {}, all: () => [], get: () => null, run: () => {} };
    registerWebDAVIPC({ database: fakeDb, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:run");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});

// ── Phase 3c.D7 orphan handlers ────────────────────────────────────

describe("webdav-ipc · list-orphans / delete-orphans handler error paths", () => {
  it("list-orphans returns error when no database", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:list-orphans");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库/);
  });

  it("list-orphans returns error when no credentials", async () => {
    const ipcMain = makeFakeIpcMain();
    const fakeDb = { all: () => [], get: () => null, run: () => {} };
    registerWebDAVIPC({ database: fakeDb, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:list-orphans");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("delete-orphans rejects missing payload.orphans", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:delete-orphans", {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/orphans/);
  });

  it("delete-orphans rejects when payload.orphans not array", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:delete-orphans", {
      orphans: "not-an-array",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/orphans/);
  });

  it("delete-orphans returns error when no credentials", async () => {
    const ipcMain = makeFakeIpcMain();
    registerWebDAVIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:webdav:delete-orphans", {
      orphans: [{ filename: "x.md" }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});
