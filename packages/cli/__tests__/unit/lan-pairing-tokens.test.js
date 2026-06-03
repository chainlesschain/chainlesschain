/**
 * Unit tests for #21 A.1 PR2 — lan-pairing-tokens.js.
 *
 * Token issuance + persistent store + lifecycle. Tests cover:
 *   - generatePairingCode produces 6-digit strings
 *   - buildToken shape matches device-pairing-handler.js QR format
 *   - addToken persists + invalidates prior pending tokens for same DID
 *   - listTokens filters by status/did + newest-first
 *   - findToken / revokeToken / markConsumed lifecycle
 *   - sweepExpired marks aged pending tokens as expired
 *   - readTokens tolerates missing / malformed files
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generatePairingCode,
  buildToken,
  readTokens,
  writeTokens,
  addToken,
  listTokens,
  findToken,
  revokeToken,
  markConsumed,
  sweepExpired,
  STATUS,
  QR_TYPE,
  DEFAULT_TTL_MS,
} from "../../src/lib/lan-pairing-tokens.js";

let tmpDir;
let store;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pair-tokens-"));
  store = path.join(tmpDir, "tokens.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── generatePairingCode ──────────────────────────────────────

describe("generatePairingCode", () => {
  it("produces a 6-digit numeric string", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(/^\d{6}$/);
      const n = parseInt(code, 10);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThan(1000000);
    }
  });
});

// ─── buildToken ──────────────────────────────────────────────

describe("buildToken", () => {
  it("matches device-pairing-handler.js QR format", () => {
    const t = buildToken({ did: "did:cc:alice" });
    expect(t.qrData.type).toBe(QR_TYPE);
    expect(t.qrData.type).toBe("device-pairing");
    expect(t.qrData.code).toBe(t.code);
    expect(t.qrData.did).toBe("did:cc:alice");
    expect(t.qrData.deviceInfo).toBeDefined();
    expect(typeof t.qrData.timestamp).toBe("number");
    expect(t.status).toBe(STATUS.PENDING);
    expect(t.expiresAtMs).toBe(t.createdAtMs + DEFAULT_TTL_MS);
  });

  it("accepts custom deviceInfo override", () => {
    const t = buildToken({
      did: "did:cc:bob",
      deviceInfo: { name: "test-box", deviceId: "abc-123" },
    });
    expect(t.qrData.deviceInfo.name).toBe("test-box");
    expect(t.qrData.deviceInfo.deviceId).toBe("abc-123");
  });

  it("rejects missing did", () => {
    expect(() => buildToken({})).toThrowError(/did required/);
    expect(() => buildToken({ did: "" })).toThrowError(/did required/);
    expect(() => buildToken({ did: null })).toThrowError(/did required/);
  });
});

// ─── readTokens / writeTokens ─────────────────────────────────

describe("readTokens / writeTokens", () => {
  it("returns empty store when file missing", () => {
    const r = readTokens(store);
    expect(r.tokens).toEqual([]);
    expect(r.schema).toBe("cc-pairing-tokens/v1");
  });

  it("round-trips a token list", () => {
    const t1 = buildToken({ did: "did:cc:a" });
    const t2 = buildToken({ did: "did:cc:b" });
    writeTokens({ tokens: [t1, t2] }, store);
    const r = readTokens(store);
    expect(r.tokens).toHaveLength(2);
    expect(r.tokens[0].code).toBe(t1.code);
  });

  it("returns empty store on malformed JSON", () => {
    fs.writeFileSync(store, "not json at all", "utf-8");
    const r = readTokens(store);
    expect(r.tokens).toEqual([]);
  });

  it("returns empty store when file has no tokens array", () => {
    fs.writeFileSync(store, JSON.stringify({ schema: "v1" }), "utf-8");
    const r = readTokens(store);
    expect(r.tokens).toEqual([]);
  });

  it("creates parent dir on write", () => {
    const nested = path.join(tmpDir, "nested", "dir", "tokens.json");
    writeTokens({ tokens: [buildToken({ did: "did:cc:x" })] }, nested);
    expect(fs.existsSync(nested)).toBe(true);
  });
});

// ─── addToken ────────────────────────────────────────────────

describe("addToken", () => {
  it("persists new token", () => {
    const t = addToken({ did: "did:cc:alice" }, store);
    expect(t.status).toBe(STATUS.PENDING);
    const r = readTokens(store);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0].code).toBe(t.code);
  });

  it("revokes prior pending tokens for same DID (one-active invariant)", () => {
    addToken({ did: "did:cc:alice" }, store);
    addToken({ did: "did:cc:alice" }, store);
    const tokens = readTokens(store).tokens;
    expect(tokens).toHaveLength(2);
    expect(tokens[0].status).toBe(STATUS.REVOKED);
    expect(tokens[1].status).toBe(STATUS.PENDING);
  });

  it("does NOT revoke prior tokens for a DIFFERENT DID", () => {
    addToken({ did: "did:cc:alice" }, store);
    addToken({ did: "did:cc:bob" }, store);
    const tokens = readTokens(store).tokens;
    expect(tokens.every((t) => t.status === STATUS.PENDING)).toBe(true);
  });

  it("does NOT revoke a non-pending prior token (consumed stays consumed)", () => {
    const t1 = addToken({ did: "did:cc:alice" }, store);
    markConsumed(t1.code, store);
    addToken({ did: "did:cc:alice" }, store);
    const tokens = readTokens(store).tokens;
    const t1After = tokens.find((t) => t.code === t1.code);
    expect(t1After.status).toBe(STATUS.CONSUMED);
  });
});

// ─── listTokens / findToken ──────────────────────────────────

describe("listTokens / findToken", () => {
  it("listTokens returns newest-first", async () => {
    addToken({ did: "did:cc:a" }, store);
    // Small delay so createdAtMs differ.
    await new Promise((r) => setTimeout(r, 5));
    const t2 = addToken({ did: "did:cc:b" }, store);
    const tokens = listTokens({}, store);
    expect(tokens[0].code).toBe(t2.code);
  });

  it("listTokens filters by status", () => {
    const t1 = addToken({ did: "did:cc:a" }, store);
    revokeToken(t1.code, store);
    addToken({ did: "did:cc:b" }, store);
    const pending = listTokens({ status: STATUS.PENDING }, store);
    expect(pending).toHaveLength(1);
    expect(pending[0].qrData.did).toBe("did:cc:b");
    const revoked = listTokens({ status: STATUS.REVOKED }, store);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].code).toBe(t1.code);
  });

  it("listTokens filters by did", () => {
    addToken({ did: "did:cc:a" }, store);
    addToken({ did: "did:cc:b" }, store);
    const a = listTokens({ did: "did:cc:a" }, store);
    expect(a).toHaveLength(1);
  });

  it("findToken returns token by code", () => {
    const t = addToken({ did: "did:cc:x" }, store);
    expect(findToken(t.code, store)).toBeTruthy();
    expect(findToken(t.code, store).code).toBe(t.code);
  });

  it("findToken returns null when not found / invalid input", () => {
    expect(findToken("000000", store)).toBeNull();
    expect(findToken("", store)).toBeNull();
    expect(findToken(null, store)).toBeNull();
  });
});

// ─── revokeToken ─────────────────────────────────────────────

describe("revokeToken", () => {
  it("revokes a pending token", () => {
    const t = addToken({ did: "did:cc:x" }, store);
    const r = revokeToken(t.code, store);
    expect(r.revoked).toBe(true);
    expect(r.token.status).toBe(STATUS.REVOKED);
  });

  it("returns not_found for missing code", () => {
    const r = revokeToken("000000", store);
    expect(r.revoked).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("returns not_pending when token already non-pending", () => {
    const t = addToken({ did: "did:cc:x" }, store);
    revokeToken(t.code, store);
    const r = revokeToken(t.code, store);
    expect(r.revoked).toBe(false);
    expect(r.reason).toMatch(/^not_pending/);
  });
});

// ─── markConsumed ────────────────────────────────────────────

describe("markConsumed", () => {
  it("marks a pending token consumed", () => {
    const t = addToken({ did: "did:cc:x" }, store);
    const r = markConsumed(t.code, store);
    expect(r.consumed).toBe(true);
    expect(r.token.status).toBe(STATUS.CONSUMED);
    expect(r.token.consumedAtMs).toBeDefined();
  });

  it("cannot consume an already-revoked token", () => {
    const t = addToken({ did: "did:cc:x" }, store);
    revokeToken(t.code, store);
    const r = markConsumed(t.code, store);
    expect(r.consumed).toBe(false);
    expect(r.reason).toMatch(/^not_pending/);
  });
});

// ─── sweepExpired ────────────────────────────────────────────

describe("sweepExpired", () => {
  it("marks pending tokens whose expiresAtMs <= now", () => {
    // Write a token manually with expiresAtMs in the past.
    const t = buildToken({ did: "did:cc:x" });
    const stale = { ...t, expiresAtMs: Date.now() - 1000 };
    writeTokens({ tokens: [stale] }, store);
    const touched = sweepExpired(store);
    expect(touched).toBe(1);
    const tokens = readTokens(store).tokens;
    expect(tokens[0].status).toBe(STATUS.EXPIRED);
    expect(tokens[0].expiredAtMs).toBeDefined();
  });

  it("returns 0 when no pending tokens have expired", () => {
    addToken({ did: "did:cc:x" }, store);
    expect(sweepExpired(store)).toBe(0);
  });

  it("does not re-expire already-expired tokens", () => {
    const t = buildToken({ did: "did:cc:x" });
    const stale = { ...t, expiresAtMs: Date.now() - 1000 };
    writeTokens({ tokens: [stale] }, store);
    sweepExpired(store);
    const second = sweepExpired(store);
    expect(second).toBe(0);
  });
});
