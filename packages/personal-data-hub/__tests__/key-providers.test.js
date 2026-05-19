"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  generateKeyHex,
  isValidKeyHex,
  InMemoryKeyProvider,
  FileKeyProvider,
  KEY_HEX_LEN,
} = require("../lib/key-providers");

describe("generateKeyHex / isValidKeyHex", () => {
  it("generateKeyHex returns 64 hex chars", () => {
    const k = generateKeyHex();
    expect(typeof k).toBe("string");
    expect(k.length).toBe(KEY_HEX_LEN);
    expect(/^[0-9a-f]+$/.test(k)).toBe(true);
  });

  it("generateKeyHex returns unique keys", () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) set.add(generateKeyHex());
    expect(set.size).toBe(50);
  });

  it("isValidKeyHex accepts valid 64-hex strings", () => {
    expect(isValidKeyHex(generateKeyHex())).toBe(true);
    expect(isValidKeyHex("A".repeat(64))).toBe(true);
  });

  it("isValidKeyHex rejects wrong length, non-hex, non-string", () => {
    expect(isValidKeyHex("a".repeat(63))).toBe(false);
    expect(isValidKeyHex("a".repeat(65))).toBe(false);
    expect(isValidKeyHex("z".repeat(64))).toBe(false);
    expect(isValidKeyHex(null)).toBe(false);
    expect(isValidKeyHex(undefined)).toBe(false);
    expect(isValidKeyHex(Buffer.alloc(32))).toBe(false);
  });
});

describe("InMemoryKeyProvider", () => {
  it("get returns null for unknown name", async () => {
    const p = new InMemoryKeyProvider();
    expect(await p.get("missing")).toBeNull();
    expect(await p.has("missing")).toBe(false);
  });

  it("set then get round-trip", async () => {
    const p = new InMemoryKeyProvider();
    const k = generateKeyHex();
    await p.set("vault:abc", k);
    expect(await p.has("vault:abc")).toBe(true);
    expect(await p.get("vault:abc")).toBe(k);
  });

  it("set validates hex shape", async () => {
    const p = new InMemoryKeyProvider();
    await expect(p.set("bad", "notatall")).rejects.toThrow(/hex/);
  });

  it("del removes the entry", async () => {
    const p = new InMemoryKeyProvider();
    await p.set("vault:abc", generateKeyHex());
    await p.del("vault:abc");
    expect(await p.has("vault:abc")).toBe(false);
    expect(await p.get("vault:abc")).toBeNull();
  });
});

describe("FileKeyProvider", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-keytest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("set creates a file under dir; get reads it back", async () => {
    const p = new FileKeyProvider(tmpDir);
    const k = generateKeyHex();
    await p.set("vault:test", k);
    expect(await p.has("vault:test")).toBe(true);
    expect(await p.get("vault:test")).toBe(k);
    // colons get sanitized to underscores in filename
    expect(fs.existsSync(path.join(tmpDir, "vault_test.key"))).toBe(true);
  });

  it("get returns null for unknown name (does not create file)", async () => {
    const p = new FileKeyProvider(tmpDir);
    expect(await p.get("never-set")).toBeNull();
    expect(fs.readdirSync(tmpDir).length).toBe(0);
  });

  it("get throws on corrupted stored file", async () => {
    const p = new FileKeyProvider(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "vault_corrupt.key"), "not-real-hex");
    await expect(p.get("vault:corrupt")).rejects.toThrow(/valid hex/);
  });

  it("del removes the file", async () => {
    const p = new FileKeyProvider(tmpDir);
    await p.set("vault:bye", generateKeyHex());
    await p.del("vault:bye");
    expect(await p.has("vault:bye")).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "vault_bye.key"))).toBe(false);
  });

  it("constructor creates missing dir recursively", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    const p = new FileKeyProvider(nested);
    expect(p.dir).toBe(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("set validates hex shape", async () => {
    const p = new FileKeyProvider(tmpDir);
    await expect(p.set("bad", "xx")).rejects.toThrow(/hex/);
  });
});
