/**
 * logger-config 纯函数测试（先前零覆盖；logger.test.js 只测 Logger 主体）。
 *
 * 重点是 sanitizeData —— 安全关键的日志脱敏函数。其源码注释记录过一次真实泄漏
 * （apiKey / privateKey 因大小写不一致从未被脱敏），但该函数一直没有测试。这里
 * 把脱敏契约永久钉死，防回归；并覆盖 formatLogMessage / getStackTrace。
 */
import { describe, it, expect } from "vitest";
import {
  LOG_LEVELS,
  LOG_LEVEL_NAMES,
  DEFAULT_CONFIG,
  formatLogMessage,
  getStackTrace,
  sanitizeData,
} from "../lib/logger-config.js";

describe("logger-config constants", () => {
  it("LOG_LEVELS and LOG_LEVEL_NAMES are inverse mappings", () => {
    for (const [name, value] of Object.entries(LOG_LEVELS)) {
      expect(LOG_LEVEL_NAMES[value]).toBe(name);
    }
  });

  it("DEFAULT_CONFIG has sane file rotation defaults", () => {
    expect(DEFAULT_CONFIG.fileConfig.maxFiles).toBe(5);
    expect(DEFAULT_CONFIG.fileConfig.maxSize).toBe(10 * 1024 * 1024);
  });
});

describe("formatLogMessage", () => {
  it("includes an ISO timestamp when timestamp=true", () => {
    const out = formatLogMessage(LOG_LEVELS.INFO, "mod", "hi", null, true);
    expect(out).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]/);
  });

  it("omits timestamp when false", () => {
    const out = formatLogMessage(LOG_LEVELS.INFO, "mod", "hi", null, false);
    expect(out.startsWith("[")).toBe(true);
    expect(out).not.toMatch(/^\[\d{4}-/);
  });

  it("renders level name and module and message", () => {
    const out = formatLogMessage(LOG_LEVELS.ERROR, "auth", "boom", null, false);
    expect(out).toContain("[ERROR]");
    expect(out).toContain("[auth]");
    expect(out).toContain("boom");
  });

  it("omits module bracket when module falsy", () => {
    const out = formatLogMessage(LOG_LEVELS.WARN, "", "msg", null, false);
    expect(out).toBe("[WARN] msg");
  });

  it("appends JSON data only when non-empty", () => {
    expect(formatLogMessage(LOG_LEVELS.INFO, "m", "x", {}, false)).toBe(
      "[INFO] [m] x",
    );
    const withData = formatLogMessage(LOG_LEVELS.INFO, "m", "x", { a: 1 }, false);
    expect(withData).toContain('"a": 1');
  });
});

describe("getStackTrace", () => {
  it("returns a non-throwing string", () => {
    const trace = getStackTrace();
    expect(typeof trace).toBe("string");
  });
});

describe("sanitizeData — passthrough", () => {
  it("returns primitives and null unchanged", () => {
    expect(sanitizeData(null)).toBe(null);
    expect(sanitizeData("plain")).toBe("plain");
    expect(sanitizeData(42)).toBe(42);
    expect(sanitizeData(undefined)).toBe(undefined);
  });

  it("preserves non-sensitive keys", () => {
    expect(sanitizeData({ user: "alice", count: 3 })).toEqual({
      user: "alice",
      count: 3,
    });
  });
});

describe("sanitizeData — redaction", () => {
  const R = "***REDACTED***";

  it("redacts the documented sensitive keys", () => {
    const out = sanitizeData({
      password: "p",
      token: "t",
      secret: "s",
      pin: "1234",
    });
    expect(out).toEqual({ password: R, token: R, secret: R, pin: R });
  });

  it("REGRESSION: redacts camelCase apiKey and privateKey", () => {
    // 这正是源码注释记录过的泄漏：大小写不一致曾使这两个最敏感字段漏过脱敏。
    const out = sanitizeData({ apiKey: "sk-123", privateKey: "0xabc" });
    expect(out.apiKey).toBe(R);
    expect(out.privateKey).toBe(R);
  });

  it("matches case-insensitively and as substring", () => {
    const out = sanitizeData({
      PASSWORD: "x",
      userToken: "y",
      MySecretValue: "z",
    });
    expect(out.PASSWORD).toBe(R);
    expect(out.userToken).toBe(R);
    expect(out.MySecretValue).toBe(R);
  });

  it("recurses into nested objects", () => {
    const out = sanitizeData({ outer: { inner: { token: "t", keep: 1 } } });
    expect(out.outer.inner.token).toBe(R);
    expect(out.outer.inner.keep).toBe(1);
  });

  it("sanitizes objects inside arrays", () => {
    const out = sanitizeData([{ password: "x" }, { name: "ok" }]);
    expect(out[0].password).toBe(R);
    expect(out[1].name).toBe("ok");
  });

  it("does not mutate the original input", () => {
    const input = { password: "p", nested: { token: "t" } };
    sanitizeData(input);
    expect(input.password).toBe("p");
    expect(input.nested.token).toBe("t");
  });
});

describe("sanitizeData — cycles and Errors", () => {
  it("replaces circular references with a marker", () => {
    const a = { name: "x" };
    a.self = a;
    const out = sanitizeData(a);
    expect(out.name).toBe("x");
    expect(out.self).toBe("[Circular Reference]");
  });

  it("serializes Error to name/message/stack", () => {
    const out = sanitizeData(new Error("boom"));
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  it("redacts sensitive data nested inside an Error's own props", () => {
    const err = new Error("auth failed");
    err.details = { token: "leak-me", ok: 1 };
    const out = sanitizeData(err);
    expect(out.details.token).toBe("***REDACTED***");
    expect(out.details.ok).toBe(1);
  });

  it("redacts top-level SCALAR sensitive own-props on an Error", () => {
    // HTTP-client errors often hang an authorization/apiKey string directly off
    // the error object. The Error branch used to copy scalars verbatim → leak.
    const err = new Error("request failed");
    err.token = "sk-live-secret";
    err.apiKey = "ak-secret";
    err.password = "hunter2";
    err.status = 401; // non-sensitive scalar preserved
    const out = sanitizeData(err);
    expect(out.token).toBe("***REDACTED***");
    expect(out.apiKey).toBe("***REDACTED***");
    expect(out.password).toBe("***REDACTED***");
    expect(out.status).toBe(401);
  });

  it("handles a self-referencing Error without overflowing the stack", () => {
    const err = new Error("cyclic");
    err.self = err;
    // Pre-fix this recursed forever in the Error branch (no cycle guard).
    const out = sanitizeData(err);
    expect(out.message).toBe("cyclic");
    expect(out.self).toBe("[Circular Reference]");
  });

  it("handles two cross-referencing Errors without overflowing", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.peer = b;
    b.peer = a;
    const out = sanitizeData(a);
    expect(out.message).toBe("a");
    expect(out.peer.message).toBe("b");
    expect(out.peer.peer).toBe("[Circular Reference]");
  });
});
