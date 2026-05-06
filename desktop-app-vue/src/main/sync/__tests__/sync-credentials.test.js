/**
 * sync-credentials.js 单元测试 — Phase 3c.1
 *
 * 路线：用 _setDepsForTest 注入 fake getSecureConfigStorage（不动 fs /
 * safeStorage / electron），sanitizeConfig 走真实实现以验证 mask 行为。
 *
 * 选择 _deps 注入而不是 vi.mock —— testing.md 明文指出 vitest fork pool 下
 * CJS destructure + vi.mock 的交互有 bug。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const {
  getCredentials,
  getCredentialsSanitized,
  hasCredentials,
  setCredentials,
  clearCredentials,
  ALLOWED_PROVIDER_IDS,
  _setDepsForTest,
} = require("../sync-credentials");

// 真实的 sanitizeConfig — 测 mask 行为时不要 mock 它
const { sanitizeConfig } = require("../../llm/secure-config-storage");

const memoryStore = { config: null };

function makeFakeStorage() {
  return {
    exists: () => memoryStore.config !== null,
    load: () => memoryStore.config,
    save: (cfg) => {
      memoryStore.config = JSON.parse(JSON.stringify(cfg));
      return true;
    },
  };
}

beforeEach(() => {
  memoryStore.config = null;
  _setDepsForTest({
    getSecureConfigStorage: () => makeFakeStorage(),
    sanitizeConfig,
  });
});

describe("sync-credentials", () => {
  describe("ALLOWED_PROVIDER_IDS", () => {
    it("includes webdav and oss", () => {
      expect(ALLOWED_PROVIDER_IDS).toContain("webdav");
      expect(ALLOWED_PROVIDER_IDS).toContain("oss");
    });
  });

  describe("getCredentials", () => {
    it("returns empty object when secure-config does not exist", () => {
      expect(getCredentials("webdav")).toEqual({});
    });

    it("returns empty object when sync namespace is missing", () => {
      memoryStore.config = { openai: { apiKey: "sk-x" } };
      expect(getCredentials("webdav")).toEqual({});
    });

    it("throws on unknown provider id", () => {
      expect(() => getCredentials("dropbox")).toThrow(/未知 sync provider id/);
    });
  });

  describe("setCredentials → getCredentials round-trip", () => {
    it("persists all fields verbatim", () => {
      const creds = {
        url: "https://nas.example.com/dav",
        username: "user1",
        password: "secret-pass-12345",
        remotePath: "/chainlesschain",
      };
      expect(setCredentials("webdav", creds)).toBe(true);
      expect(getCredentials("webdav")).toEqual(creds);
    });

    it("does not clobber other LLM config", () => {
      memoryStore.config = { openai: { apiKey: "sk-keep" } };
      setCredentials("webdav", { url: "u", password: "p" });
      expect(memoryStore.config.openai.apiKey).toBe("sk-keep");
      expect(memoryStore.config.sync.webdav).toEqual({
        url: "u",
        password: "p",
      });
    });

    it("isolates webdav and oss credentials", () => {
      setCredentials("webdav", { url: "u1", password: "p1" });
      setCredentials("oss", {
        endpoint: "https://oss.example.com",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
      });
      expect(getCredentials("webdav").password).toBe("p1");
      expect(getCredentials("oss").secretAccessKey).toBe("secret");
    });

    it("rejects non-object creds", () => {
      expect(() => setCredentials("webdav", null)).toThrow(/必须是对象/);
      expect(() => setCredentials("webdav", "string")).toThrow(/必须是对象/);
    });

    it("throws on unknown provider id", () => {
      expect(() => setCredentials("dropbox", {})).toThrow(
        /未知 sync provider id/,
      );
    });
  });

  describe("getCredentialsSanitized", () => {
    it("masks password but keeps url / username plain", () => {
      setCredentials("webdav", {
        url: "https://nas.example.com/dav",
        username: "user1",
        password: "secret-pass-12345",
        remotePath: "/chainlesschain",
      });
      const view = getCredentialsSanitized("webdav");
      expect(view.url).toBe("https://nas.example.com/dav");
      expect(view.username).toBe("user1");
      expect(view.remotePath).toBe("/chainlesschain");
      expect(view.password).not.toBe("secret-pass-12345");
      expect(view.password).toMatch(/\*+/);
    });

    it("masks oss secretAccessKey but keeps accessKeyId / endpoint", () => {
      setCredentials("oss", {
        endpoint: "https://oss.example.com",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        bucket: "mybucket",
      });
      const view = getCredentialsSanitized("oss");
      expect(view.endpoint).toBe("https://oss.example.com");
      expect(view.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(view.bucket).toBe("mybucket");
      expect(view.secretAccessKey).not.toBe(
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      );
      expect(view.secretAccessKey).toMatch(/\*+/);
    });

    it("returns empty object when not configured", () => {
      expect(getCredentialsSanitized("webdav")).toEqual({});
    });
  });

  describe("hasCredentials", () => {
    it("returns false when nothing stored", () => {
      expect(hasCredentials("webdav")).toBe(false);
    });

    it("returns false when stored object is empty", () => {
      setCredentials("webdav", {});
      expect(hasCredentials("webdav")).toBe(false);
    });

    it("returns false when all fields are empty strings", () => {
      setCredentials("webdav", { url: "", password: "" });
      expect(hasCredentials("webdav")).toBe(false);
    });

    it("returns true when at least one field has a value", () => {
      setCredentials("webdav", { url: "https://x", password: "" });
      expect(hasCredentials("webdav")).toBe(true);
    });
  });

  describe("clearCredentials", () => {
    it("removes the provider entry but leaves other config intact", () => {
      memoryStore.config = { openai: { apiKey: "sk-keep" } };
      setCredentials("webdav", { url: "u", password: "p" });
      setCredentials("oss", { accessKeyId: "AKIA", secretAccessKey: "s" });

      expect(clearCredentials("webdav")).toBe(true);
      expect(memoryStore.config.openai.apiKey).toBe("sk-keep");
      expect(memoryStore.config.sync.webdav).toBeUndefined();
      expect(memoryStore.config.sync.oss).toBeDefined();
    });

    it("is idempotent — clearing nothing returns true", () => {
      expect(clearCredentials("webdav")).toBe(true);
    });
  });
});
