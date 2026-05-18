/**
 * WebAuthnPasskeyManager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  WebAuthnPasskeyManager,
  PASSKEY_STATUS,
  CEREMONY_TYPE,
  CEREMONY_STATUS,
} = require("../webauthn-passkey-manager");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ cnt: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("WebAuthnPasskeyManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new WebAuthnPasskeyManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (manager._cleanupTimer) {
      clearInterval(manager._cleanupTimer);
    }
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true and call db.exec", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should be idempotent (second call does not re-exec)", async () => {
      await manager.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await manager.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });

    it("should accept deps (ctap2Protocol, didManager)", async () => {
      const mockCtap2 = { connect: vi.fn() };
      const mockDid = { resolve: vi.fn() };
      await manager.initialize(db, {
        ctap2Protocol: mockCtap2,
        didManager: mockDid,
      });
      expect(manager._ctap2Protocol).toBe(mockCtap2);
      expect(manager._didManager).toBe(mockDid);
    });

    it("should start cleanup timer", async () => {
      await manager.initialize(db);
      expect(manager._cleanupTimer).not.toBeNull();
    });
  });

  // ============================================================
  // beginRegistration()
  // ============================================================

  describe("beginRegistration()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return ceremony options with challenge", async () => {
      const result = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      expect(result).toHaveProperty("ceremonyId");
      expect(result).toHaveProperty("challenge");
      expect(typeof result.ceremonyId).toBe("string");
      expect(typeof result.challenge).toBe("string");
      expect(result.challenge.length).toBeGreaterThan(0);
    });

    it("should include correct rp info", async () => {
      const result = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      expect(result.rp).toEqual({ id: "test.rp", name: "Test RP" });
    });

    it("should include user info", async () => {
      const result = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      expect(result.user).toHaveProperty("id", "user-1");
      expect(result.user).toHaveProperty("name", "testuser");
      expect(result.user).toHaveProperty("displayName");
    });

    it("should emit ceremony:started event", async () => {
      const listener = vi.fn();
      manager.on("ceremony:started", listener);
      await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.type).toBe(CEREMONY_TYPE.REGISTRATION);
      expect(payload).toHaveProperty("ceremonyId");
    });

    it("should throw if rpId or userId is missing", async () => {
      await expect(
        manager.beginRegistration("", "RP", "user-1", "testuser"),
      ).rejects.toThrow();
      await expect(
        manager.beginRegistration("test.rp", "RP", "", "testuser"),
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // completeRegistration()
  // ============================================================

  describe("completeRegistration()", () => {
    let regOptions;

    beforeEach(async () => {
      await manager.initialize(db);
      regOptions = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
    });

    it("should create passkey from attestation response", async () => {
      const passkey = await manager.completeRegistration(
        regOptions.ceremonyId,
        {
          credentialId: "cred-abc-123",
          publicKey: "mock-public-key-base64",
          algorithm: -7,
          transports: ["internal"],
        },
      );
      expect(passkey).toHaveProperty("credentialId", "cred-abc-123");
      expect(passkey).toHaveProperty("publicKey", "mock-public-key-base64");
      expect(passkey).toHaveProperty("signCount", 0);
      expect(passkey.status).toBe(PASSKEY_STATUS.ACTIVE);
    });

    it("should persist passkey to database", async () => {
      await manager.completeRegistration(regOptions.ceremonyId, {
        credentialId: "cred-abc-123",
        publicKey: "mock-public-key-base64",
        algorithm: -7,
        transports: ["internal"],
      });
      // The source uses db.prepare().run() for persistence
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should emit passkey:registered event", async () => {
      const listener = vi.fn();
      manager.on("passkey:registered", listener);
      await manager.completeRegistration(regOptions.ceremonyId, {
        credentialId: "cred-abc-123",
        publicKey: "mock-public-key-base64",
        algorithm: -7,
        transports: ["internal"],
      });
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload).toHaveProperty("credentialId", "cred-abc-123");
    });

    it("should throw for invalid ceremony ID", async () => {
      await expect(
        manager.completeRegistration("non-existent-id", {
          credentialId: "cred-abc-123",
          publicKey: "mock-public-key-base64",
        }),
      ).rejects.toThrow();
    });

    it("should throw for expired ceremony", async () => {
      // Manually expire the ceremony
      const ceremony = manager._ceremonies.get(regOptions.ceremonyId);
      ceremony.expiresAt = new Date(Date.now() - 10000).toISOString();

      await expect(
        manager.completeRegistration(regOptions.ceremonyId, {
          credentialId: "cred-abc-123",
          publicKey: "mock-public-key-base64",
        }),
      ).rejects.toThrow(/expired/i);
    });
  });

  // ============================================================
  // beginAuthentication()
  // ============================================================

  describe("beginAuthentication()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      // Register a passkey first
      const regOptions = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      await manager.completeRegistration(regOptions.ceremonyId, {
        credentialId: "cred-abc-123",
        publicKey: "mock-public-key-base64",
        algorithm: -7,
        transports: ["internal"],
      });
    });

    it("should return authentication options with challenge", async () => {
      const result = await manager.beginAuthentication("test.rp");
      expect(result).toHaveProperty("ceremonyId");
      expect(result).toHaveProperty("challenge");
      expect(typeof result.challenge).toBe("string");
      expect(result.challenge.length).toBeGreaterThan(0);
    });

    it("should include allowCredentials for rpId", async () => {
      const result = await manager.beginAuthentication("test.rp");
      expect(result).toHaveProperty("allowCredentials");
      expect(Array.isArray(result.allowCredentials)).toBe(true);
      expect(result.allowCredentials.length).toBeGreaterThanOrEqual(1);
      expect(result.allowCredentials[0]).toHaveProperty("id", "cred-abc-123");
    });

    it("should emit ceremony:started event", async () => {
      const listener = vi.fn();
      manager.on("ceremony:started", listener);
      await manager.beginAuthentication("test.rp");
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload.type).toBe(CEREMONY_TYPE.AUTHENTICATION);
    });

    it("should work only after initialization (no passkeys for uninitialized rpId)", async () => {
      // A fresh manager without initialization has no passkeys loaded,
      // so allowCredentials will be empty for any rpId
      const freshManager = new WebAuthnPasskeyManager();
      freshManager.initialized = true; // simulate partial init
      freshManager.db = db;
      const result = await freshManager.beginAuthentication("unknown.rp");
      expect(result.allowCredentials).toEqual([]);
      if (freshManager._cleanupTimer) {
        clearInterval(freshManager._cleanupTimer);
      }
    });
  });

  // ============================================================
  // completeAuthentication()
  // ============================================================

  describe("completeAuthentication()", () => {
    let passkey;

    beforeEach(async () => {
      await manager.initialize(db);
      // Register a passkey
      const regOptions = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      passkey = await manager.completeRegistration(regOptions.ceremonyId, {
        credentialId: "cred-abc-123",
        publicKey: "mock-public-key-base64",
        algorithm: -7,
        transports: ["internal"],
      });
    });

    it("should authenticate and return session", async () => {
      const authOptions = await manager.beginAuthentication("test.rp");
      const result = await manager.completeAuthentication(
        authOptions.ceremonyId,
        {
          credentialId: "cred-abc-123",
          authenticatorData: "mock-auth-data",
          signature: "mock-signature",
          signCount: 1,
        },
      );
      expect(result).toHaveProperty("authenticated", true);
      expect(result).toHaveProperty("session");
      expect(result.session).toHaveProperty("id");
      expect(result).toHaveProperty("passkey");
    });

    it("should update sign count", async () => {
      const authOptions = await manager.beginAuthentication("test.rp");
      const result = await manager.completeAuthentication(
        authOptions.ceremonyId,
        {
          credentialId: "cred-abc-123",
          authenticatorData: "mock-auth-data",
          signature: "mock-signature",
          signCount: 1,
        },
      );
      expect(result.passkey.signCount).toBe(1);
    });

    it("should emit passkey:authenticated event", async () => {
      const listener = vi.fn();
      manager.on("passkey:authenticated", listener);
      const authOptions = await manager.beginAuthentication("test.rp");
      await manager.completeAuthentication(authOptions.ceremonyId, {
        credentialId: "cred-abc-123",
        authenticatorData: "mock-auth-data",
        signature: "mock-signature",
        signCount: 1,
      });
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload).toHaveProperty("credentialId", "cred-abc-123");
      expect(payload).toHaveProperty("sessionId");
    });

    it("should throw for invalid ceremony", async () => {
      await expect(
        manager.completeAuthentication("non-existent-id", {
          credentialId: "cred-abc-123",
          signCount: 1,
        }),
      ).rejects.toThrow();
    });

    it("should throw for sign count mismatch (new count <= old count)", async () => {
      // First authentication to set signCount=1
      const authOptions1 = await manager.beginAuthentication("test.rp");
      await manager.completeAuthentication(authOptions1.ceremonyId, {
        credentialId: "cred-abc-123",
        authenticatorData: "mock-auth-data",
        signature: "mock-signature",
        signCount: 5,
      });

      // Second authentication with signCount <= 5 should fail
      const authOptions2 = await manager.beginAuthentication("test.rp");
      await expect(
        manager.completeAuthentication(authOptions2.ceremonyId, {
          credentialId: "cred-abc-123",
          authenticatorData: "mock-auth-data",
          signature: "mock-signature",
          signCount: 5,
        }),
      ).rejects.toThrow(/sign count/i);
    });
  });

  // ============================================================
  // listPasskeys / deletePasskey
  // ============================================================

  describe("listPasskeys / deletePasskey", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      // Register two passkeys under different RPs
      const reg1 = await manager.beginRegistration(
        "rp-a",
        "RP A",
        "user-1",
        "alice",
      );
      await manager.completeRegistration(reg1.ceremonyId, {
        credentialId: "cred-1",
        publicKey: "pk-1",
      });
      const reg2 = await manager.beginRegistration(
        "rp-b",
        "RP B",
        "user-2",
        "bob",
      );
      await manager.completeRegistration(reg2.ceremonyId, {
        credentialId: "cred-2",
        publicKey: "pk-2",
      });
    });

    it("should list all passkeys", () => {
      const passkeys = manager.listPasskeys();
      expect(passkeys.length).toBe(2);
    });

    it("should filter by rpId", () => {
      const passkeys = manager.listPasskeys({ rpId: "rp-a" });
      expect(passkeys.length).toBe(1);
      expect(passkeys[0].rpId).toBe("rp-a");
    });

    it("should filter by status", () => {
      // All are active
      const active = manager.listPasskeys({ status: PASSKEY_STATUS.ACTIVE });
      expect(active.length).toBe(2);
      const revoked = manager.listPasskeys({ status: PASSKEY_STATUS.REVOKED });
      expect(revoked.length).toBe(0);
    });

    it("should delete (revoke) a passkey and emit event", () => {
      const listener = vi.fn();
      manager.on("passkey:deleted", listener);
      const result = manager.deletePasskey("cred-1");
      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveProperty(
        "credentialId",
        "cred-1",
      );

      // After deletion, listing should not include it (it's removed from the map)
      const passkeys = manager.listPasskeys();
      expect(passkeys.length).toBe(1);
    });
  });

  // ============================================================
  // bindDID / unbindDID
  // ============================================================

  describe("bindDID / unbindDID", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      const reg = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      await manager.completeRegistration(reg.ceremonyId, {
        credentialId: "cred-abc-123",
        publicKey: "mock-public-key-base64",
        algorithm: -7,
        transports: ["internal"],
      });
    });

    it("should bind DID to passkey", () => {
      const result = manager.bindDID("cred-abc-123", "did:chainless:user-1");
      expect(result).toBe(true);
      const passkey = manager.listPasskeys({ rpId: "test.rp" })[0];
      expect(passkey.didBinding).toBe("did:chainless:user-1");
    });

    it("should emit passkey:did-bound event", () => {
      const listener = vi.fn();
      manager.on("passkey:did-bound", listener);
      manager.bindDID("cred-abc-123", "did:chainless:user-1");
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload).toHaveProperty("credentialId", "cred-abc-123");
      expect(payload).toHaveProperty("did", "did:chainless:user-1");
    });

    it("should unbind DID from passkey", () => {
      manager.bindDID("cred-abc-123", "did:chainless:user-1");
      const result = manager.unbindDID("cred-abc-123");
      expect(result).toBe(true);
      const passkey = manager.listPasskeys({ rpId: "test.rp" })[0];
      expect(passkey.didBinding).toBeNull();
    });

    it("should throw for non-existent passkey", () => {
      expect(() =>
        manager.bindDID("non-existent-cred", "did:chainless:user-1"),
      ).toThrow();
      expect(() => manager.unbindDID("non-existent-cred")).toThrow();
    });
  });

  // ============================================================
  // getStats
  // ============================================================

  describe("getStats()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return correct stats", async () => {
      const reg = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "testuser",
      );
      await manager.completeRegistration(reg.ceremonyId, {
        credentialId: "cred-1",
        publicKey: "pk-1",
      });

      const stats = manager.getStats();
      expect(stats).toHaveProperty("totalPasskeys");
      expect(stats).toHaveProperty("activePasskeys");
      expect(stats).toHaveProperty("revokedPasskeys");
      expect(stats.activePasskeys).toBeGreaterThanOrEqual(1);
    });

    it("should count active and revoked separately", async () => {
      const reg1 = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-1",
        "alice",
      );
      await manager.completeRegistration(reg1.ceremonyId, {
        credentialId: "cred-1",
        publicKey: "pk-1",
      });
      const reg2 = await manager.beginRegistration(
        "test.rp",
        "Test RP",
        "user-2",
        "bob",
      );
      await manager.completeRegistration(reg2.ceremonyId, {
        credentialId: "cred-2",
        publicKey: "pk-2",
      });

      // Revoke one
      manager.deletePasskey("cred-1");

      const stats = manager.getStats();
      // After deletePasskey, cred-1 is removed from the in-memory map
      // activePasskeys counts ACTIVE status passkeys still in the map
      expect(stats.activePasskeys).toBe(1);
    });
  });

  // ============================================================
  // cleanup / destroy
  // ============================================================

  describe("cleanup / destroy", () => {
    it("should clear cleanup timer on destroy", async () => {
      await manager.initialize(db);
      expect(manager._cleanupTimer).not.toBeNull();
      manager.destroy();
      expect(manager._cleanupTimer).toBeNull();
    });

    it("should set initialized to false on destroy", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
      manager.destroy();
      expect(manager.initialized).toBe(false);
    });
  });
});
