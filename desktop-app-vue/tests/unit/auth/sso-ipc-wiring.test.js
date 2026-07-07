/**
 * sso-ipc handler wiring (deferred fix 2026-07-07).
 *
 * The auth IPC layer straddled TWO session stores and called SSOManager with
 * the wrong argument shapes:
 *  - refresh-token read the parallel sso-session-manager store (never
 *    populated on the SSO login path → always SESSION_NOT_FOUND) and then
 *    called manager.refreshToken(providerId, refreshToken) against a
 *    (sessionId) signature — the whole IPC was unusable end to end;
 *  - logout required providerId (which the renderer never sends) and passed
 *    it AS the sessionId → provider-side revocation never ran;
 *  - handle-callback waited for authResult.tokens (never returned) so the
 *    renderer never learned the sessionId, and wrapped manager failures as
 *    success;
 *  - get-sessions listed the never-populated parallel store → always [].
 *
 * These tests pin the corrected contracts against stubbed managers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Injected via registerSSOIPC's test seams (same pattern as browser-ipc) —
// the CJS `require('electron')` / lazy manager requires are not vi.mock-able.
const managerStub = {
  handleCallback: vi.fn(),
  refreshToken: vi.fn(),
  logout: vi.fn(),
  getActiveSessions: vi.fn(),
};
const sessionMgrStub = {
  invalidateSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
};

let handlers;

beforeEach(async () => {
  vi.clearAllMocks();
  handlers = new Map();
  const captureIpcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: () => {},
  };
  const { registerSSOIPC } = await import("../../../src/main/auth/sso-ipc.js");
  registerSSOIPC({
    database: {},
    ipcMain: captureIpcMain,
    ssoManager: managerStub,
    ssoSessionManager: sessionMgrStub,
    identityBridge: {},
  });
});

const invoke = (channel, payload) => handlers.get(channel)(null, payload);

describe("sso:refresh-token — routes to the authoritative SSOManager", () => {
  it("calls manager.refreshToken(sessionId) single-arg and returns its result", async () => {
    managerStub.refreshToken.mockResolvedValue({
      success: true,
      expiresAt: 12345,
      tokenType: "Bearer",
    });
    const res = await invoke("sso:refresh-token", { sessionId: "sess-1" });
    expect(managerStub.refreshToken).toHaveBeenCalledWith("sess-1");
    expect(res).toMatchObject({ success: true, data: { expiresAt: 12345 } });
  });

  it("surfaces a manager failure as failure (not wrapped success)", async () => {
    managerStub.refreshToken.mockResolvedValue({
      success: false,
      error: "Session not found",
    });
    const res = await invoke("sso:refresh-token", { sessionId: "nope" });
    expect(res).toEqual({ success: false, error: "Session not found" });
  });
});

describe("sso:logout — sessionId alone suffices (renderer contract)", () => {
  it("revokes via manager.logout(sessionId) without requiring providerId", async () => {
    managerStub.logout.mockResolvedValue({ success: true });
    const res = await invoke("sso:logout", { sessionId: "sess-2" });
    expect(managerStub.logout).toHaveBeenCalledWith("sess-2");
    expect(res.success).toBe(true);
    // Parallel store invalidation is best-effort.
    expect(sessionMgrStub.invalidateSession).toHaveBeenCalledWith("sess-2");
  });

  it("userDid-only logout revokes every active manager session", async () => {
    managerStub.getActiveSessions.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    managerStub.logout.mockResolvedValue({ success: true });
    const res = await invoke("sso:logout", { userDid: "did:example:1" });
    expect(managerStub.logout).toHaveBeenCalledTimes(2);
    expect(res.data).toEqual({ revoked: 2, total: 2 });
    expect(sessionMgrStub.invalidateAllSessions).toHaveBeenCalledWith(
      "did:example:1",
    );
  });

  it("still rejects a call with neither sessionId nor userDid", async () => {
    const res = await invoke("sso:logout", {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId or userDid/);
  });
});

describe("sso:handle-callback — session flattened, failures surfaced", () => {
  it("returns the manager session top-level for the renderer store", async () => {
    const session = { id: "sess-3", providerId: "p1" };
    managerStub.handleCallback.mockResolvedValue({
      success: true,
      session,
      userInfo: { sub: "u" },
    });
    const res = await invoke("sso:handle-callback", {
      providerId: "p1",
      callbackData: { code: "x" },
    });
    expect(res.success).toBe(true);
    expect(res.session).toEqual(session); // renderer reads result.session
  });

  it("propagates a manager {success:false} as an IPC failure", async () => {
    managerStub.handleCallback.mockResolvedValue({
      success: false,
      error: "Invalid or expired state parameter",
    });
    const res = await invoke("sso:handle-callback", {
      providerId: "p1",
      callbackData: { code: "x" },
    });
    expect(res).toEqual({
      success: false,
      error: "Invalid or expired state parameter",
    });
  });
});

describe("sso:get-sessions — reads the authoritative store", () => {
  it("lists manager.getActiveSessions with top-level `sessions`", async () => {
    const rows = [{ id: "s1", providerId: "p1", state: "active" }];
    managerStub.getActiveSessions.mockResolvedValue(rows);
    const res = await invoke("sso:get-sessions", { userDid: "did:example:1" });
    expect(managerStub.getActiveSessions).toHaveBeenCalledWith("did:example:1");
    expect(res.sessions).toEqual(rows); // renderer reads result.sessions
    expect(res.data).toEqual(rows);
  });
});
