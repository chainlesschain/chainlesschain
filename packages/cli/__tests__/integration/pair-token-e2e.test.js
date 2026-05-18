/**
 * E2E for `cc pair token` subcommands (#21 A.1 PR2).
 *
 * Spawns the real CLI subprocess to verify:
 *   - generate produces a 6-digit code + matches qrData shape
 *   - list reads previously issued tokens
 *   - show looks up by code
 *   - revoke transitions pending → revoked
 *   - HOME override redirects token store to tmp dir
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

describe("cc pair token — E2E (#21 A.1 PR2)", () => {
  let tmpHome;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    });
  }

  function extractJson(text) {
    const lines = text.split(/\r?\n/);
    for (let s = 0; s < lines.length; s++) {
      const t = lines[s].trimStart();
      if (t.startsWith("{") || t.startsWith("[")) {
        for (let e = lines.length; e > s; e--) {
          try {
            return JSON.parse(lines.slice(s, e).join("\n"));
          } catch (_err) {
            /* try shorter */
          }
        }
      }
    }
    throw new Error(`No JSON in: ${text.slice(0, 300)}`);
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pair-token-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("generate: issues a 6-digit token + qrData matches device-pairing schema", () => {
    const r = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:alice",
      "--name",
      "test-box",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);
    const t = extractJson(r.stdout);
    expect(t.code).toMatch(/^\d{6}$/);
    expect(t.qrData.type).toBe("device-pairing");
    expect(t.qrData.did).toBe("did:cc:alice");
    expect(t.qrData.code).toBe(t.code);
    expect(t.qrData.deviceInfo.name).toBe("test-box");
    expect(t.status).toBe("pending");
    expect(t.expiresAtMs).toBeGreaterThan(t.createdAtMs);
  });

  it("list: returns previously issued tokens, newest-first", async () => {
    runCli(["pair", "token", "generate", "--did", "did:cc:a", "--json"]);
    // Small delay so timestamps differ.
    await new Promise((r) => setTimeout(r, 20));
    runCli(["pair", "token", "generate", "--did", "did:cc:b", "--json"]);
    const r = runCli(["pair", "token", "list", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const { tokens } = extractJson(r.stdout);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    // Newest-first
    expect(tokens[0].qrData.did).toBe("did:cc:b");
  });

  it("list --status pending: filters out revoked", () => {
    const gen = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:x",
      "--json",
    ]);
    const t = extractJson(gen.stdout);
    runCli(["pair", "token", "revoke", t.code, "--json"]);
    const after = runCli([
      "pair",
      "token",
      "list",
      "--status",
      "pending",
      "--json",
    ]);
    const { tokens } = extractJson(after.stdout);
    expect(tokens.every((tk) => tk.status === "pending")).toBe(true);
    expect(tokens.find((tk) => tk.code === t.code)).toBeUndefined();
  });

  it("show: returns the same token by code", () => {
    const gen = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:y",
      "--json",
    ]);
    const t = extractJson(gen.stdout);
    const show = runCli(["pair", "token", "show", t.code, "--json"]);
    expect(show.status, show.stderr).toBe(0);
    const back = extractJson(show.stdout);
    expect(back.code).toBe(t.code);
    expect(back.qrData.did).toBe("did:cc:y");
  });

  it("show: returns exit 2 for unknown code", () => {
    const r = runCli(["pair", "token", "show", "000000", "--json"]);
    expect(r.status).toBe(2);
  });

  it("revoke: transitions pending → revoked", () => {
    const gen = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:z",
      "--json",
    ]);
    const t = extractJson(gen.stdout);
    const rev = runCli(["pair", "token", "revoke", t.code, "--json"]);
    expect(rev.status, rev.stderr).toBe(0);
    const out = extractJson(rev.stdout);
    expect(out.revoked).toBe(true);
    expect(out.token.status).toBe("revoked");
  });

  it("revoke: exit 2 when code not found", () => {
    const r = runCli(["pair", "token", "revoke", "000000", "--json"]);
    expect(r.status).toBe(2);
  });

  it("generate twice for same DID: first becomes revoked (one-active invariant)", async () => {
    const a = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:dupe",
      "--json",
    ]);
    const ta = extractJson(a.stdout);
    await new Promise((r) => setTimeout(r, 10));
    const b = runCli([
      "pair",
      "token",
      "generate",
      "--did",
      "did:cc:dupe",
      "--json",
    ]);
    const tb = extractJson(b.stdout);
    expect(tb.code).not.toBe(ta.code);
    // Inspect prior token
    const show = runCli(["pair", "token", "show", ta.code, "--json"]);
    const back = extractJson(show.stdout);
    expect(back.status).toBe("revoked");
  });

  it("--help: pair token lists 4 subcommands", () => {
    const r = runCli(["pair", "token", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("generate");
    expect(r.stdout).toContain("list");
    expect(r.stdout).toContain("show");
    expect(r.stdout).toContain("revoke");
  });
});
