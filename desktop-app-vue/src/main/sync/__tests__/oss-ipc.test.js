/**
 * oss-ipc 单元测试 — Phase 3c.3 task #3
 *
 * 注入 fake ipcMain + fake database + fake mainWindow + fake secure-config，
 * 验证：
 *   - registerOSSIPC 注册 5 个 handle channel
 *   - ipcGuard 防止重复注册
 *   - config-get / config-set / config-clear 与 sync-credentials 联动
 *   - test / run 无凭证时返错误不崩溃
 *   - config-get 视图含 mask 后 secretAccessKey
 *   - config-set 缺必填字段拒绝
 *   - config-set secretAccessKey 留空时沿用旧值
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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
const secureConfig = require("../../llm/secure-config-storage");
const { registerOSSIPC, PROVIDER_ID } = require("../oss-ipc");

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
    // 用真 sanitizeConfig 验证 mask 行为
    sanitizeConfig: (cfg) => secureConfig.sanitizeConfig(cfg),
  });
}

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
      return fn({}, ...args);
    },
  };
}

function makeFakeMainWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  ipcGuard.unregisterModule?.("oss-ipc");
  memoryStore.config = null;
  setupCredsFake();
});

describe("oss-ipc · registration", () => {
  it("registers 5 handlers", () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    expect(ipcMain.handle).toHaveBeenCalledTimes(5);
    const channels = [...ipcMain.handlers.keys()];
    expect(channels).toEqual(
      expect.arrayContaining([
        "sync:oss:test",
        "sync:oss:run",
        "sync:oss:config-get",
        "sync:oss:config-set",
        "sync:oss:config-clear",
      ]),
    );
  });

  it("does not re-register on second call (ipcGuard)", () => {
    const ipc1 = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain: ipc1 });
    const ipc2 = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain: ipc2 });
    expect(ipc2.handle).not.toHaveBeenCalled();
  });

  it("PROVIDER_ID is 'oss'", () => {
    expect(PROVIDER_ID).toBe("oss");
  });
});

describe("oss-ipc · config-get / config-set / config-clear", () => {
  it("config-get returns empty + configured=false initially", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:config-get");
    expect(res.success).toBe(true);
    expect(res.data.endpoint).toBe("");
    expect(res.data.configured).toBe(false);
    // secretAccessKey 应是空字符串，不是 undefined
    expect(res.data.secretAccessKey).toBe("");
  });

  it("config-set + get round-trip: secretAccessKey mask", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const setRes = await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      bucket: "my-bucket",
      accessKeyId: "AKIAxxxxxxxxxxxx",
      secretAccessKey: "supersecret123456",
      remotePath: "cc/",
    });
    expect(setRes.success).toBe(true);

    const getRes = await ipcMain.invoke("sync:oss:config-get");
    expect(getRes.data.endpoint).toBe("https://s3.amazonaws.com");
    expect(getRes.data.bucket).toBe("my-bucket");
    expect(getRes.data.accessKeyId).toBe("AKIAxxxxxxxxxxxx"); // 非敏感
    // secretAccessKey 被 mask（real sanitizeConfig 把 SENSITIVE_FIELDS 改成 ******）
    expect(getRes.data.secretAccessKey).not.toBe("supersecret123456");
    expect(getRes.data.secretAccessKey).toMatch(/\*+|hidden|sensitive/i);
    expect(getRes.data.configured).toBe(true);
  });

  it("config-set rejects missing endpoint", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:config-set", {
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/endpoint/);
  });

  it("config-set rejects missing bucket", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://x",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/bucket/);
  });

  it("config-set 留空 secretAccessKey 沿用旧值", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    // 1) 第一次 set
    await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://x",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "oldsecret",
      remotePath: "/",
    });
    // 2) 再 set 但 secretAccessKey 留空 (renderer 永不发 plain secret 二次)
    const res = await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://x",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "",
      remotePath: "/",
    });
    expect(res.success).toBe(true);
    // 验证旧 secret 保留
    const plain = credentials.getCredentials("oss");
    expect(plain.secretAccessKey).toBe("oldsecret");
  });

  it("config-set 首次缺 secretAccessKey 拒绝", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://x",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/secretAccessKey/);
  });

  it("config-clear removes credentials", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    await ipcMain.invoke("sync:oss:config-set", {
      endpoint: "https://x",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(credentials.hasCredentials("oss")).toBe(true);

    const res = await ipcMain.invoke("sync:oss:config-clear");
    expect(res.success).toBe(true);
    expect(credentials.hasCredentials("oss")).toBe(false);
  });
});

describe("oss-ipc · test handler", () => {
  it("returns error when no credentials", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:test");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/凭证未配置/);
  });
});

describe("oss-ipc · run handler", () => {
  it("returns error when database missing", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:run");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库|凭证/);
  });

  it("returns error when credentials missing (database present)", async () => {
    const ipcMain = makeFakeIpcMain();
    const fakeDb = { all: () => [], get: () => null, run: () => {} };
    registerOSSIPC({ database: fakeDb, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:run");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/凭证未配置/);
  });
});

describe("oss-ipc · graceful when mainWindow destroyed", () => {
  it("config-get works with null mainWindow", async () => {
    const ipcMain = makeFakeIpcMain();
    registerOSSIPC({ database: null, mainWindow: null, ipcMain });
    const res = await ipcMain.invoke("sync:oss:config-get");
    expect(res.success).toBe(true);
    // status is null because no database
    expect(res.data.status).toBe(null);
  });
});
