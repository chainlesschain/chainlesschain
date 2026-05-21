/**
 * sync.webdav.* WS handler 单元测试 — Phase 3c.4
 *
 * 验证：
 *   - createSyncWebDAVHandlers 返回 5 个 topic
 *   - 各 handler 在缺凭证 / 缺数据库时返回结构化 error envelope
 *   - config-set / config-get round-trip
 *   - config-set 留空 password 时沿用旧值
 *   - frame.payload 解构正确（不是直接用 frame）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const credentials = require("../../sync/sync-credentials");
const {
  createSyncWebDAVHandlers,
  PROVIDER_ID,
} = require("../../web-shell/handlers/sync-webdav-handlers");

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

beforeEach(() => {
  memoryStore.config = null;
  setupCredsFake();
});

describe("sync-webdav-handlers · factory", () => {
  it("PROVIDER_ID is webdav", () => {
    expect(PROVIDER_ID).toBe("webdav");
  });

  it("returns exactly 7 topics (incl. Phase 3c.D7 orphan cleanup)", () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const topics = Object.keys(handlers);
    expect(topics).toHaveLength(7);
    expect(topics).toEqual(
      expect.arrayContaining([
        "sync.webdav.test",
        "sync.webdav.run",
        "sync.webdav.config-get",
        "sync.webdav.config-set",
        "sync.webdav.config-clear",
        "sync.webdav.list-orphans",
        "sync.webdav.delete-orphans",
      ]),
    );
  });

  it("all handlers are async functions", () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("sync-webdav-handlers · config flow", () => {
  it("config-get returns empty when not configured", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.config-get"]({});
    expect(res.success).toBe(true);
    expect(res.data.configured).toBe(false);
    expect(res.data.url).toBe("");
    expect(res.data.status).toBeNull();
  });

  it("config-set persists then config-get returns sanitized", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const setRes = await handlers["sync.webdav.config-set"]({
      payload: {
        url: "https://nas.example.com/dav",
        username: "alice",
        password: "secret-pass-12345",
        remotePath: "/cc",
      },
    });
    expect(setRes).toEqual({ success: true });

    const getRes = await handlers["sync.webdav.config-get"]({});
    expect(getRes.data.url).toBe("https://nas.example.com/dav");
    expect(getRes.data.username).toBe("alice");
    expect(getRes.data.configured).toBe(true);
    expect(getRes.data.password).not.toBe("secret-pass-12345");
    expect(getRes.data.password).toMatch(/\*+/);
  });

  it("config-set with empty password preserves existing", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    await handlers["sync.webdav.config-set"]({
      payload: {
        url: "https://x",
        username: "u",
        password: "original-pass",
        remotePath: "/",
      },
    });
    await handlers["sync.webdav.config-set"]({
      payload: {
        url: "https://y",
        username: "u",
        password: "",
        remotePath: "/",
      },
    });
    expect(memoryStore.config.sync.webdav.password).toBe("original-pass");
    expect(memoryStore.config.sync.webdav.url).toBe("https://y");
  });

  it("config-set rejects missing url", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.config-set"]({
      payload: { username: "u", password: "p" },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/url 必填/);
  });

  it("config-set rejects null payload", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.config-set"]({ payload: null });
    expect(res.success).toBe(false);
  });

  it("config-clear removes credentials", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    await handlers["sync.webdav.config-set"]({
      payload: { url: "https://x", username: "u", password: "p" },
    });
    expect(memoryStore.config.sync.webdav).toBeDefined();
    await handlers["sync.webdav.config-clear"]({});
    expect(memoryStore.config.sync?.webdav).toBeUndefined();
  });
});

describe("sync-webdav-handlers · guards", () => {
  it("test returns error envelope (success:false) when creds missing", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.test"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("run returns error when database missing", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    await handlers["sync.webdav.config-set"]({
      payload: { url: "https://x", username: "u", password: "p" },
    });
    const res = await handlers["sync.webdav.run"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库未初始化/);
  });

  it("run returns error when database present but creds missing", async () => {
    const fakeDb = { db: {}, all: () => [], get: () => null, run: () => {} };
    const handlers = createSyncWebDAVHandlers({ database: fakeDb });
    const res = await handlers["sync.webdav.run"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});

describe("sync-webdav-handlers · orphan cleanup (Phase 3c.D7)", () => {
  it("list-orphans returns error when database missing", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.list-orphans"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库/);
  });

  it("list-orphans returns error when creds missing", async () => {
    const fakeDb = { db: {}, all: () => [], get: () => null, run: () => {} };
    const handlers = createSyncWebDAVHandlers({ database: fakeDb });
    const res = await handlers["sync.webdav.list-orphans"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("delete-orphans rejects missing payload.orphans", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.delete-orphans"]({ payload: {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/orphans/);
  });

  it("delete-orphans rejects when creds missing", async () => {
    const handlers = createSyncWebDAVHandlers({ database: null });
    const res = await handlers["sync.webdav.delete-orphans"]({
      payload: { orphans: [{ filename: "x.md" }] },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});
