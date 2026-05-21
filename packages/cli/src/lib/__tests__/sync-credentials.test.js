/**
 * sync-credentials 单元测试 — Phase 3c follow-up CLI safeStorage.
 *
 * 用 tmp dir + _setCcDirForTest 避开真实 ~/.chainlesschain/，
 * 单测互不污染。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  ALLOWED_PROVIDER_IDS,
  SENSITIVE_FIELDS,
  MASK,
  getCredentials,
  getCredentialsSanitized,
  hasCredentials,
  setCredentials,
  clearCredentials,
  _setCcDirForTest,
  _resetCcDirForTest,
  _keyPath,
  _vaultPath,
} from "../sync-credentials.js";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sync-cred-test-"));
  _setCcDirForTest(tmpDir);
});

afterEach(() => {
  _resetCcDirForTest();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) {
    /* test cleanup best-effort */
  }
});

describe("sync-credentials · constants", () => {
  it("ALLOWED_PROVIDER_IDS includes webdav + oss", () => {
    expect(ALLOWED_PROVIDER_IDS).toEqual(
      expect.arrayContaining(["webdav", "oss"]),
    );
  });

  it("SENSITIVE_FIELDS includes password + secretAccessKey paths", () => {
    expect(SENSITIVE_FIELDS).toEqual(
      expect.arrayContaining([
        "sync.webdav.password",
        "sync.oss.secretAccessKey",
      ]),
    );
  });
});

describe("sync-credentials · master key auto-gen", () => {
  it("first setCredentials creates key + vault files", () => {
    expect(fs.existsSync(_keyPath())).toBe(false);
    expect(fs.existsSync(_vaultPath())).toBe(false);
    setCredentials("webdav", {
      url: "https://x",
      username: "u",
      password: "p",
    });
    expect(fs.existsSync(_keyPath())).toBe(true);
    expect(fs.existsSync(_vaultPath())).toBe(true);
  });

  it("key file is 32 bytes", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    const buf = fs.readFileSync(_keyPath());
    expect(buf.length).toBe(32);
  });

  it("vault file is encrypted (NOT plaintext JSON)", () => {
    // Use a randomly-generated value so security-check.js doesn't flag
    // this test file as committing a literal password.
    const probe = "probe-" + Math.random().toString(36).slice(2);
    setCredentials("webdav", { url: "https://x", password: probe });
    const buf = fs.readFileSync(_vaultPath());
    const text = buf.toString("utf-8");
    expect(text).not.toContain(probe);
    expect(() => JSON.parse(text)).toThrow();
  });

  it("reuses same key across calls (deterministic decrypt)", () => {
    setCredentials("webdav", { url: "https://x", password: "p1" });
    const keyBefore = fs.readFileSync(_keyPath());
    setCredentials("webdav", { url: "https://x", password: "p2" });
    const keyAfter = fs.readFileSync(_keyPath());
    expect(keyAfter.equals(keyBefore)).toBe(true);
  });
});

describe("sync-credentials · round-trip", () => {
  it("setCredentials → getCredentials returns plain values", () => {
    setCredentials("webdav", {
      url: "https://nas",
      username: "alice",
      password: "secret",
      remotePath: "/cc",
    });
    const got = getCredentials("webdav");
    expect(got).toEqual({
      url: "https://nas",
      username: "alice",
      password: "secret",
      remotePath: "/cc",
    });
  });

  it("OSS round-trip preserves all 7 fields", () => {
    const oss = {
      endpoint: "https://oss.example.com",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "AKI",
      secretAccessKey: "SK",
      remotePath: "cc/",
      forcePathStyle: true,
    };
    setCredentials("oss", oss);
    expect(getCredentials("oss")).toEqual(oss);
  });

  it("multi-provider isolation", () => {
    setCredentials("webdav", { url: "https://x", password: "p1" });
    setCredentials("oss", {
      endpoint: "https://o",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(getCredentials("webdav").password).toBe("p1");
    expect(getCredentials("oss").secretAccessKey).toBe("s");
    // Crossover check
    expect(getCredentials("webdav").secretAccessKey).toBeUndefined();
    expect(getCredentials("oss").password).toBeUndefined();
  });

  it("getCredentials before any set returns {}", () => {
    expect(getCredentials("webdav")).toEqual({});
  });
});

describe("sync-credentials · sanitize", () => {
  it("getCredentialsSanitized masks password field", () => {
    // Probe value is random to avoid security-check.js pattern hits
    const probe = "probe-" + Math.random().toString(36).slice(2);
    setCredentials("webdav", {
      url: "https://x",
      username: "u",
      password: probe,
      remotePath: "/",
    });
    const masked = getCredentialsSanitized("webdav");
    expect(masked.password).toBe(MASK);
    expect(masked.url).toBe("https://x"); // unmasked
    expect(masked.username).toBe("u");
  });

  it("getCredentialsSanitized masks secretAccessKey", () => {
    setCredentials("oss", {
      endpoint: "https://o",
      bucket: "b",
      accessKeyId: "AKI",
      secretAccessKey: "SUPERSECRET",
    });
    const masked = getCredentialsSanitized("oss");
    expect(masked.secretAccessKey).toBe(MASK);
    expect(masked.accessKeyId).toBe("AKI"); // unmasked
  });

  it("empty/missing sensitive field not masked", () => {
    setCredentials("webdav", { url: "https://x", password: "" });
    const masked = getCredentialsSanitized("webdav");
    expect(masked.password).toBe(""); // empty stays empty, no mask
  });
});

describe("sync-credentials · hasCredentials", () => {
  it("false before configuration", () => {
    expect(hasCredentials("webdav")).toBe(false);
  });

  it("true after any non-empty field saved", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    expect(hasCredentials("webdav")).toBe(true);
  });

  it("true even when only sensitive field set", () => {
    setCredentials("oss", {
      endpoint: "",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "s",
    });
    expect(hasCredentials("oss")).toBe(true);
  });
});

describe("sync-credentials · clearCredentials", () => {
  it("removes provider creds; other providers untouched", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    setCredentials("oss", {
      endpoint: "https://o",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    clearCredentials("webdav");
    expect(hasCredentials("webdav")).toBe(false);
    expect(hasCredentials("oss")).toBe(true);
  });

  it("clearing non-configured provider is a no-op (returns true)", () => {
    expect(clearCredentials("webdav")).toBe(true);
  });
});

describe("sync-credentials · validation", () => {
  it("setCredentials rejects unknown provider", () => {
    expect(() => setCredentials("dropbox", { token: "t" })).toThrow(
      /unknown provider id 'dropbox'/,
    );
  });

  it("setCredentials rejects null creds", () => {
    expect(() => setCredentials("webdav", null)).toThrow(/must be an object/);
  });

  it("getCredentials rejects unknown provider", () => {
    expect(() => getCredentials("dropbox")).toThrow(/unknown provider id/);
  });
});

describe("sync-credentials · corruption recovery", () => {
  it("wrong-length key file → helpful error", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    // Corrupt: truncate key file to 16 bytes
    fs.writeFileSync(_keyPath(), Buffer.alloc(16));
    expect(() => getCredentials("webdav")).toThrow(/wrong length/);
  });

  it("corrupt vault → helpful error", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    // Write garbage that's at least the min size (12 + 16 + 1 = 29 bytes)
    fs.writeFileSync(
      _vaultPath(),
      Buffer.from("garbage-data-that-is-not-valid-aes-blob-content"),
    );
    expect(() => getCredentials("webdav")).toThrow(/decrypt failed/);
  });

  it("truncated vault (smaller than iv+tag header) → helpful error", () => {
    setCredentials("webdav", { url: "https://x", password: "p" });
    fs.writeFileSync(_vaultPath(), Buffer.alloc(10));
    expect(() => getCredentials("webdav")).toThrow(/too small or invalid/);
  });
});
