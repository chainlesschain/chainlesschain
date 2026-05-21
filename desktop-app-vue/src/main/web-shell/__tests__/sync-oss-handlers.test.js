/**
 * sync.oss.* WS handler 单元测试 — Phase 3c.3 web-shell parity (D7 + D10 included)
 *
 * 镜像 sync-webdav-handlers.test.js 模式，覆盖：
 *   - createSyncOSSHandlers 返回 7 个 topic (含 D7 orphan)
 *   - 缺凭证 / 缺数据库返结构化 error envelope
 *   - config-set / config-get round-trip + secret mask
 *   - config-set secretAccessKey 留空时沿用旧值
 *   - frame.payload 解构
 *   - D7 orphan handler error paths
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const credentials = require("../../sync/sync-credentials");
const secureConfig = require("../../llm/secure-config-storage");
const {
  createSyncOSSHandlers,
  PROVIDER_ID,
} = require("../../web-shell/handlers/sync-oss-handlers");

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
    sanitizeConfig: (cfg) => secureConfig.sanitizeConfig(cfg),
  });
}

beforeEach(() => {
  memoryStore.config = null;
  setupCredsFake();
});

describe("sync-oss-handlers · factory", () => {
  it("PROVIDER_ID is oss", () => {
    expect(PROVIDER_ID).toBe("oss");
  });

  it("returns exactly 7 topics (incl. Phase 3c.D7 orphan)", () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const topics = Object.keys(handlers);
    expect(topics).toHaveLength(7);
    expect(topics).toEqual(
      expect.arrayContaining([
        "sync.oss.test",
        "sync.oss.run",
        "sync.oss.config-get",
        "sync.oss.config-set",
        "sync.oss.config-clear",
        "sync.oss.list-orphans",
        "sync.oss.delete-orphans",
      ]),
    );
  });

  it("all handlers are async functions", () => {
    const handlers = createSyncOSSHandlers({ database: null });
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("sync-oss-handlers · config flow", () => {
  it("config-get returns empty when not configured", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.config-get"]({});
    expect(res.success).toBe(true);
    expect(res.data.configured).toBe(false);
    expect(res.data.endpoint).toBe("");
    expect(res.data.secretAccessKey).toBe("");
    expect(res.data.status).toBeNull();
  });

  it("config-set persists then config-get returns secret mask", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const setRes = await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
        region: "oss-cn-hangzhou",
        bucket: "my-bucket",
        accessKeyId: "AKIAxxxxxxxxxxxx",
        secretAccessKey: "supersecret123",
        remotePath: "cc/",
      },
    });
    expect(setRes).toEqual({ success: true });

    const getRes = await handlers["sync.oss.config-get"]({});
    expect(getRes.data.endpoint).toBe("https://oss-cn-hangzhou.aliyuncs.com");
    expect(getRes.data.bucket).toBe("my-bucket");
    expect(getRes.data.accessKeyId).toBe("AKIAxxxxxxxxxxxx");
    expect(getRes.data.secretAccessKey).not.toBe("supersecret123");
    expect(getRes.data.secretAccessKey).toMatch(/\*+|hidden|sensitive/i);
    expect(getRes.data.configured).toBe(true);
  });

  it("config-set with empty secretAccessKey preserves existing", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://x",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "original-secret",
        remotePath: "/",
      },
    });
    await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://y",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "",
        remotePath: "/",
      },
    });
    expect(memoryStore.config.sync.oss.secretAccessKey).toBe("original-secret");
    expect(memoryStore.config.sync.oss.endpoint).toBe("https://y");
  });

  it("config-set rejects missing endpoint", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.config-set"]({
      payload: { bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/endpoint/);
  });

  it("config-set rejects missing bucket", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://x",
        accessKeyId: "k",
        secretAccessKey: "s",
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/bucket/);
  });

  it("config-set rejects null payload", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.config-set"]({ payload: null });
    expect(res.success).toBe(false);
  });

  it("config-set 首次缺 secretAccessKey 拒绝", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://x",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "",
      },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/secretAccessKey/);
  });

  it("config-clear removes credentials", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://x",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "s",
      },
    });
    expect(memoryStore.config.sync.oss).toBeDefined();
    await handlers["sync.oss.config-clear"]({});
    expect(memoryStore.config.sync?.oss).toBeUndefined();
  });
});

describe("sync-oss-handlers · guards", () => {
  it("test returns error envelope when creds missing", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.test"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("run returns error when database missing", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    await handlers["sync.oss.config-set"]({
      payload: {
        endpoint: "https://x",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "s",
      },
    });
    const res = await handlers["sync.oss.run"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库/);
  });

  it("run returns error when database present but creds missing", async () => {
    const fakeDb = { db: {}, all: () => [], get: () => null, run: () => {} };
    const handlers = createSyncOSSHandlers({ database: fakeDb });
    const res = await handlers["sync.oss.run"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});

describe("sync-oss-handlers · orphan cleanup (Phase 3c.D7)", () => {
  it("list-orphans returns error when database missing", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.list-orphans"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/数据库/);
  });

  it("list-orphans returns error when creds missing", async () => {
    const fakeDb = { db: {}, all: () => [], get: () => null, run: () => {} };
    const handlers = createSyncOSSHandlers({ database: fakeDb });
    const res = await handlers["sync.oss.list-orphans"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });

  it("delete-orphans rejects missing payload.orphans", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.delete-orphans"]({ payload: {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/orphans/);
  });

  it("delete-orphans rejects non-array orphans", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.delete-orphans"]({
      payload: { orphans: "not-array" },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/orphans/);
  });

  it("delete-orphans rejects when creds missing", async () => {
    const handlers = createSyncOSSHandlers({ database: null });
    const res = await handlers["sync.oss.delete-orphans"]({
      payload: { orphans: [{ filename: "x.md" }] },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未配置/);
  });
});
