/**
 * Regression test: SSOManager._getSession must not cache terminal (expired/
 * revoked) sessions. Previously every loaded session was cached unconditionally,
 * so a just-expired session lingered in _sessionCache forever (the explicit
 * deletes only fire on logout/refresh) — a slow memory leak — and a later cache
 * hit returned the stale expired session.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(),
}));

const { SSOManager } = require("../../../src/main/auth/sso-manager.js");

function makeManager(row) {
  const database = {
    get: vi.fn().mockResolvedValue(row),
    run: vi.fn().mockResolvedValue(undefined),
  };
  return new SSOManager({ database });
}

function row(overrides) {
  return {
    id: "s1",
    provider_id: "p1",
    user_did: "did:x",
    external_user_id: "u1",
    access_token: "a",
    refresh_token: "r",
    id_token: null,
    token_type: "Bearer",
    expires_at: Date.now() + 3600_000,
    scopes: "openid",
    user_info: null,
    state: "active",
    saml_session_index: null,
    saml_name_id: null,
    ip_address: null,
    user_agent: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

describe("SSOManager._getSession cache eviction", () => {
  it("does NOT cache a session detected as expired", async () => {
    const mgr = makeManager(row({ expires_at: Date.now() - 1000 }));
    const session = await mgr._getSession("s1");
    expect(session.state).toBe("expired"); // detected + marked
    expect(mgr._sessionCache.has("s1")).toBe(false); // not cached → no leak
  });

  it("does NOT cache an already-revoked session", async () => {
    const mgr = makeManager(row({ state: "revoked" }));
    await mgr._getSession("s1");
    expect(mgr._sessionCache.has("s1")).toBe(false);
  });

  it("caches an active, non-expired session", async () => {
    const mgr = makeManager(row({ state: "active" }));
    const session = await mgr._getSession("s1");
    expect(session.state).toBe("active");
    expect(mgr._sessionCache.has("s1")).toBe(true);
  });
});
