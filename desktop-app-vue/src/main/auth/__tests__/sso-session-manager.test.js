/**
 * sso-session-manager 单元测试 —— AES-256-GCM token 加密落盘往返、篡改检测(GCM)、
 * IV 随机性、机器派生密钥缓存，以及 create/get/limit-eviction/expiry/invalidate/
 * isValid/info 流程(注入轻量内存假 DB，避开 better-sqlite3 原生 ABI)。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { SSOSessionManager } = require("../sso-session-manager.js");

// Minimal in-memory stand-in for the better-sqlite3 statements the manager uses.
function makeFakeDb() {
  let rows = [];
  const stmt = (sql) => ({
    run: (...a) => {
      if (sql.includes("INSERT INTO sso_sessions")) {
        const [id, user_did, provider_id, encrypted_tokens, expires_at, last_activity, created_at, updated_at] = a;
        rows.push({ id, user_did, provider_id, encrypted_tokens, expires_at, last_activity, created_at, updated_at });
        return { changes: 1 };
      }
      if (sql.includes("DELETE FROM sso_sessions WHERE id = ?")) {
        const before = rows.length;
        rows = rows.filter((r) => r.id !== a[0]);
        return { changes: before - rows.length };
      }
      if (sql.includes("DELETE FROM sso_sessions WHERE user_did = ?")) {
        const before = rows.length;
        rows = rows.filter((r) => r.user_did !== a[0]);
        return { changes: before - rows.length };
      }
      if (sql.includes("DELETE FROM sso_sessions WHERE expires_at IS NOT NULL")) {
        const now = a[0];
        const before = rows.length;
        rows = rows.filter((r) => !(r.expires_at != null && r.expires_at < now));
        return { changes: before - rows.length };
      }
      if (sql.includes("UPDATE sso_sessions") && sql.includes("encrypted_tokens = ?")) {
        const [encrypted_tokens, expires_at, last_activity, updated_at, id] = a;
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, { encrypted_tokens, expires_at, last_activity, updated_at });
        return { changes: row ? 1 : 0 };
      }
      if (sql.includes("UPDATE sso_sessions SET last_activity = ?")) {
        const [last_activity, id] = a;
        const row = rows.find((r) => r.id === id);
        if (row) row.last_activity = last_activity;
        return { changes: row ? 1 : 0 };
      }
      return { changes: 0 };
    },
    get: (...a) => {
      if (sql.includes("COUNT(*)") && sql.includes("user_did = ? AND provider_id = ?")) {
        const [u, p] = a;
        return { count: rows.filter((r) => r.user_did === u && r.provider_id === p).length };
      }
      if (sql.includes("SELECT id FROM sso_sessions") && sql.includes("ORDER BY created_at ASC")) {
        const [u, p] = a;
        const m = rows.filter((r) => r.user_did === u && r.provider_id === p)
          .sort((x, y) => x.created_at - y.created_at);
        return m[0] ? { id: m[0].id } : undefined;
      }
      if (sql.includes("SELECT * FROM sso_sessions WHERE id = ?")) {
        return rows.find((r) => r.id === a[0]);
      }
      if (sql.includes("SELECT id, expires_at FROM sso_sessions WHERE id = ?")) {
        const r = rows.find((x) => x.id === a[0]);
        return r ? { id: r.id, expires_at: r.expires_at } : undefined;
      }
      if (sql.includes("SELECT id, user_did, provider_id, expires_at")) {
        return rows.find((r) => r.id === a[0]);
      }
      return undefined;
    },
    all: () => [],
  });
  return { __rows: () => rows, getDatabase: () => ({ prepare: stmt }) };
}

const mkManager = () => {
  const db = makeFakeDb();
  return { mgr: new SSOSessionManager({ database: db }), db };
};

describe("SSOSessionManager construction", () => {
  it("requires a database", () => {
    expect(() => new SSOSessionManager({})).toThrow(/database parameter is required/);
  });
});

describe("SSOSessionManager encryption layer", () => {
  it("round-trips plaintext through _encrypt/_decrypt", () => {
    const { mgr } = mkManager();
    const secret = JSON.stringify({ accessToken: "ya29.abc", n: 1 });
    const enc = mgr._encrypt(secret);
    expect(enc).not.toContain("ya29.abc"); // not stored in the clear
    expect(mgr._decrypt(enc)).toBe(secret);
  });

  it("uses a random IV so the same plaintext encrypts differently", () => {
    const { mgr } = mkManager();
    const a = mgr._encrypt("same");
    const b = mgr._encrypt("same");
    expect(a).not.toBe(b);
    expect(mgr._decrypt(a)).toBe("same");
    expect(mgr._decrypt(b)).toBe("same");
  });

  it("rejects tampered ciphertext via the GCM auth tag", () => {
    const { mgr } = mkManager();
    const enc = mgr._encrypt("payload");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => mgr._decrypt(buf.toString("base64"))).toThrow(/Failed to decrypt/);
  });

  it("derives a cached 32-byte key + salt", () => {
    const { mgr } = mkManager();
    const k1 = mgr._getEncryptionKey();
    const k2 = mgr._getEncryptionKey();
    expect(k1.key).toBe(k2.key); // cached
    expect(k1.key).toHaveLength(32);
    expect(k1.salt).toHaveLength(32);
  });
});

describe("SSOSessionManager session lifecycle", () => {
  it("stores tokens encrypted at rest and returns them decrypted", async () => {
    const { mgr, db } = mkManager();
    const created = await mgr.createSession("did:cc:a", "google", {
      accessToken: "AT-123",
      refreshToken: "RT-456",
      expiresIn: 3600,
    });
    expect(created.success).toBe(true);
    // stored ciphertext must not contain the raw tokens
    const stored = db.__rows()[0].encrypted_tokens;
    expect(stored).not.toContain("AT-123");
    expect(stored).not.toContain("RT-456");
    // getSession decrypts back to the originals
    const got = await mgr.getSession(created.sessionId);
    expect(got.tokens.accessToken).toBe("AT-123");
    expect(got.tokens.refreshToken).toBe("RT-456");
    expect(got.userDid).toBe("did:cc:a");
  });

  it("evicts the oldest session when the per-user limit is exceeded", async () => {
    const { mgr, db } = mkManager();
    for (let i = 0; i < 10; i++) {
      await mgr.createSession("did:cc:a", "google", {
        accessToken: `AT-${i}`,
        expiresIn: 3600,
      });
    }
    expect(db.__rows()).toHaveLength(10);
    await mgr.createSession("did:cc:a", "google", { accessToken: "AT-new" });
    // still capped at 10 (oldest evicted before insert)
    expect(db.__rows()).toHaveLength(10);
  });

  it("removes and returns null for an expired session on get", async () => {
    const { mgr, db } = mkManager();
    const { sessionId } = await mgr.createSession("did:cc:a", "google", {
      accessToken: "AT",
      expiresIn: 3600,
    });
    // force expiry in the stored row
    db.__rows()[0].expires_at = Date.now() - 1000;
    expect(await mgr.getSession(sessionId)).toBeNull();
    expect(db.__rows()).toHaveLength(0); // cleaned up
  });

  it("getSessionInfo returns metadata without tokens", async () => {
    const { mgr } = mkManager();
    const { sessionId } = await mgr.createSession("did:cc:a", "google", {
      accessToken: "AT",
      expiresIn: 3600,
    });
    const info = await mgr.getSessionInfo(sessionId);
    expect(info.tokens).toBeUndefined();
    expect(info.isExpired).toBe(false);
    expect(info.remainingMinutes).toBeGreaterThan(0);
  });

  it("isSessionValid is true for live, false for missing/expired", async () => {
    const { mgr, db } = mkManager();
    const { sessionId } = await mgr.createSession("did:cc:a", "google", {
      accessToken: "AT",
      expiresIn: 3600,
    });
    expect(await mgr.isSessionValid(sessionId)).toBe(true);
    expect(await mgr.isSessionValid("nope")).toBe(false);
    db.__rows()[0].expires_at = Date.now() - 1;
    expect(await mgr.isSessionValid(sessionId)).toBe(false);
  });

  it("invalidateSession deletes the row", async () => {
    const { mgr, db } = mkManager();
    const { sessionId } = await mgr.createSession("did:cc:a", "google", {
      accessToken: "AT",
    });
    const res = await mgr.invalidateSession(sessionId);
    expect(res.deleted).toBe(true);
    expect(db.__rows()).toHaveLength(0);
  });
});
