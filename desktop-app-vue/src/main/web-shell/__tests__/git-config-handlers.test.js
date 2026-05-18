/**
 * git.config-* WS handler 单元测试 — Phase 3c.5
 *
 * 注入 fake GitConfig 实例（包 in-memory 配置），验证：
 *   - createGitConfigHandlers 返回 3 个 topic
 *   - config-get sanitized 视图 mask password
 *   - config-set 字段级 patch + password 留空沿用旧值
 *   - config-set 拒绝非对象 payload
 *   - config-clear 关 enabled + 清 auth + 保留 remoteUrl
 *   - getConfig 返回 null 时返回结构化 error envelope（不抛）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createGitConfigHandlers,
  PROVIDER_ID,
} = require("../handlers/git-config-handlers");

function makeFakeConfig(seed = {}) {
  const state = {
    enabled: false,
    repoPath: null,
    remoteUrl: null,
    authorName: "ChainlessChain User",
    authorEmail: "user@chainlesschain.com",
    auth: null,
    autoSync: false,
    autoSyncInterval: 300000,
    exportPath: "knowledge",
    ...seed,
  };
  return {
    _state: state,
    getAll: () => ({ ...state }),
    setEnabled: (v) => {
      state.enabled = v;
    },
    setRepoPath: (v) => {
      state.repoPath = v;
    },
    setRemoteUrl: (v) => {
      state.remoteUrl = v;
    },
    getAuthor: () => ({ name: state.authorName, email: state.authorEmail }),
    setAuthor: (n, e) => {
      state.authorName = n;
      state.authorEmail = e;
    },
    getAuth: () => state.auth,
    setAuth: (a) => {
      state.auth = a;
    },
    setAutoSync: (enabled, interval) => {
      state.autoSync = enabled;
      if (interval != null) {
        state.autoSyncInterval = interval;
      }
    },
  };
}

let cfg;
let handlers;

beforeEach(() => {
  cfg = makeFakeConfig();
  handlers = createGitConfigHandlers({ getConfig: () => cfg });
});

describe("git-config-handlers · factory", () => {
  it("PROVIDER_ID is git", () => {
    expect(PROVIDER_ID).toBe("git");
  });

  it("returns exactly 3 topics", () => {
    const topics = Object.keys(handlers);
    expect(topics).toHaveLength(3);
    expect(topics).toEqual(
      expect.arrayContaining([
        "git.config-get",
        "git.config-set",
        "git.config-clear",
      ]),
    );
  });
});

describe("git-config-handlers · config-get", () => {
  it("returns empty defaults when not configured", async () => {
    const res = await handlers["git.config-get"]({});
    expect(res.success).toBe(true);
    expect(res.data.configured).toBe(false);
    expect(res.data.remoteUrl).toBe("");
    expect(res.data.auth.username).toBe("");
    expect(res.data.auth.password).toBe("");
  });

  it("masks password when present", async () => {
    cfg = makeFakeConfig({
      remoteUrl: "https://github.com/x/y.git",
      auth: { username: "alice", password: "ghp_secret123456" },
    });
    handlers = createGitConfigHandlers({ getConfig: () => cfg });
    const res = await handlers["git.config-get"]({});
    expect(res.data.auth.username).toBe("alice");
    expect(res.data.auth.password).not.toBe("ghp_secret123456");
    expect(res.data.auth.password).toMatch(/\*+/);
    expect(res.data.configured).toBe(true);
  });

  it("returns error when getConfig returns null", async () => {
    handlers = createGitConfigHandlers({ getConfig: () => null });
    const res = await handlers["git.config-get"]({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未初始化/);
  });
});

describe("git-config-handlers · config-set", () => {
  it("patches fields verbatim", async () => {
    const res = await handlers["git.config-set"]({
      payload: {
        enabled: true,
        remoteUrl: "https://gh.example/u/r.git",
        repoPath: "/tmp/repo",
        authorName: "Alice",
        authorEmail: "a@b.c",
        auth: { username: "alice", password: "secret-token-1234" },
      },
    });
    expect(res.success).toBe(true);
    expect(cfg._state.enabled).toBe(true);
    expect(cfg._state.remoteUrl).toBe("https://gh.example/u/r.git");
    expect(cfg._state.repoPath).toBe("/tmp/repo");
    expect(cfg._state.authorName).toBe("Alice");
    expect(cfg._state.authorEmail).toBe("a@b.c");
    expect(cfg._state.auth).toEqual({
      username: "alice",
      password: "secret-token-1234",
    });
  });

  it("preserves password when payload password is empty", async () => {
    cfg = makeFakeConfig({
      auth: { username: "alice", password: "original" },
    });
    handlers = createGitConfigHandlers({ getConfig: () => cfg });
    await handlers["git.config-set"]({
      payload: { auth: { username: "alice2", password: "" } },
    });
    expect(cfg._state.auth.username).toBe("alice2");
    expect(cfg._state.auth.password).toBe("original");
  });

  it("returns sanitized data after set", async () => {
    const res = await handlers["git.config-set"]({
      payload: {
        remoteUrl: "https://x",
        auth: { username: "u", password: "secret-1234567890" },
      },
    });
    expect(res.success).toBe(true);
    expect(res.data.remoteUrl).toBe("https://x");
    expect(res.data.auth.password).toMatch(/\*+/);
  });

  it("rejects null payload", async () => {
    const res = await handlers["git.config-set"]({ payload: null });
    expect(res.success).toBe(false);
  });

  it("ignores unknown fields", async () => {
    await handlers["git.config-set"]({
      payload: { unknownField: "x", remoteUrl: "https://y" },
    });
    expect(cfg._state.remoteUrl).toBe("https://y");
    expect(cfg._state.unknownField).toBeUndefined();
  });
});

describe("git-config-handlers · config-clear", () => {
  it("disables + clears auth, keeps remoteUrl", async () => {
    cfg = makeFakeConfig({
      enabled: true,
      remoteUrl: "https://x",
      auth: { username: "u", password: "p" },
    });
    handlers = createGitConfigHandlers({ getConfig: () => cfg });
    const res = await handlers["git.config-clear"]({});
    expect(res.success).toBe(true);
    expect(cfg._state.enabled).toBe(false);
    expect(cfg._state.auth).toBeNull();
    expect(cfg._state.remoteUrl).toBe("https://x"); // 保留
  });
});
