/**
 * resolveDbPasswordWithEscrow — Phase 3 U-Key escrow routing at bootstrap.
 *
 * Proves the gate routing on the DB-key resolution path:
 *   - gate OFF (safestorage-only) → byte-for-byte the existing resolveDbPassword
 *   - dual-escrow → routes through provider.resolvePassphrase, no-lockout
 *     fallback to safeStorage when the escrow blows up
 *   - hardware-only → routes through, FAIL-CLOSED (no safeStorage fallback)
 *   - buildUKeyAdapter seam returns the injected uKey, null otherwise
 *
 * Pure logic via injected seams — no electron app / safeStorage / U-Key hardware,
 * so this runs as a normal vitest CI test. Real-device E2E is deferred.
 */

const {
  resolveDbPasswordWithEscrow,
  buildUKeyAdapter,
} = require("../core-initializer");

// safeStorage-only provider seam (mirrors resolveDbPassword's expectations).
function fakeProvider({
  available = true,
  hasManaged = false,
  managedPass = "MANAGED-PASS",
} = {}) {
  return {
    isAvailable: () => available,
    hasManagedPassphrase: () => hasManaged,
    getOrCreateManagedPassphrase: () => managedPass,
  };
}

// Escrow-capable provider seam (adds resolvePassphrase).
function fakeEscrowProvider({ resolved, throws } = {}) {
  return {
    isAvailable: () => false, // so a fallback to resolveDbPassword is observable
    hasManagedPassphrase: () => false,
    getOrCreateManagedPassphrase: () => {
      throw new Error("safeStorage unavailable");
    },
    resolvePassphrase: async () => {
      if (throws) {
        throw new Error(throws);
      }
      return resolved;
    },
  };
}

const base = {
  userDataPath: "/tmp/userData",
  legacyEncryptedDbExists: () => false,
  legacyPassword: "123456",
};

describe("resolveDbPasswordWithEscrow — gate OFF (safestorage-only)", () => {
  it("delegates byte-for-byte to resolveDbPassword (managed)", async () => {
    const r = await resolveDbPasswordWithEscrow({
      ...base,
      escrowMode: "safestorage-only",
      provider: fakeProvider({ hasManaged: true, managedPass: "RND-1" }),
    });
    expect(r).toEqual({ password: "RND-1", source: "managed" });
  });

  it("delegates the legacy/no-safestorage branch unchanged", async () => {
    const r = await resolveDbPasswordWithEscrow({
      ...base,
      escrowMode: "safestorage-only",
      provider: fakeProvider({ available: false }),
    });
    expect(r).toEqual({ password: "123456", source: "legacy-no-safestorage" });
  });
});

describe("resolveDbPasswordWithEscrow — dual-escrow", () => {
  it("routes through provider.resolvePassphrase and tags the source", async () => {
    const r = await resolveDbPasswordWithEscrow({
      ...base,
      escrowMode: "dual-escrow",
      uKey: { isAvailable: () => true },
      provider: fakeEscrowProvider({ resolved: "DUAL-PASS" }),
    });
    expect(r).toEqual({ password: "DUAL-PASS", source: "ukey-dual-escrow" });
  });

  it("falls back to safeStorage-only resolution when escrow throws (no lockout)", async () => {
    // resolvePassphrase throws AND the provider's safeStorage is unavailable →
    // the fallback resolveDbPassword path returns the legacy source.
    const r = await resolveDbPasswordWithEscrow({
      ...base,
      escrowMode: "dual-escrow",
      uKey: { isAvailable: () => true },
      provider: fakeEscrowProvider({ throws: "escrow exploded" }),
    });
    expect(r).toEqual({ password: "123456", source: "legacy-no-safestorage" });
  });
});

describe("resolveDbPasswordWithEscrow — hardware-only (fail-closed)", () => {
  it("routes through and tags the source on success", async () => {
    const r = await resolveDbPasswordWithEscrow({
      ...base,
      escrowMode: "hardware-only",
      uKey: { isAvailable: () => true },
      provider: fakeEscrowProvider({ resolved: "HW-PASS" }),
    });
    expect(r).toEqual({ password: "HW-PASS", source: "ukey-hardware-only" });
  });

  it("propagates the error (fail-closed, NO safeStorage fallback)", async () => {
    await expect(
      resolveDbPasswordWithEscrow({
        ...base,
        escrowMode: "hardware-only",
        uKey: { isAvailable: () => false },
        provider: fakeEscrowProvider({ throws: "U-Key absent, fail-closed" }),
      }),
    ).rejects.toThrow(/fail-closed/);
  });
});

describe("buildUKeyAdapter", () => {
  it("returns the injected uKey seam", () => {
    const seam = { isAvailable: () => true };
    expect(buildUKeyAdapter({ uKey: seam })).toBe(seam);
  });

  it("returns null when no seam is injected (real adapter deferred)", () => {
    expect(buildUKeyAdapter({})).toBe(null);
    expect(buildUKeyAdapter()).toBe(null);
  });

  it("honors an explicit null seam", () => {
    expect(buildUKeyAdapter({ uKey: null })).toBe(null);
  });
});
