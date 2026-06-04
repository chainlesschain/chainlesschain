/**
 * L3 — resolveDbPassword selection matrix (db-master-key-hardening design §4.2 / test-plan §5).
 *
 * Asserts WHICH passphrase source bootstrap picks for every disk/safeStorage
 * combination, the part that decides whether an existing user's DB opens with a
 * managed key, the legacy "123456", or fails closed. Pure logic via injected
 * seams — no electron app / safeStorage / native module, so this is a normal
 * vitest CI test (unlike the L2 real-SQLCipher suite).
 *
 * The gate three-state resolution (env force-on/off + PHASE_1_5_DEFAULT_ON) is
 * covered separately in database/__tests__/db-encryption-flag.test.js; here we
 * test the password-source branch that runs once encryption is on.
 */

// describe/it/expect are vitest globals (globals: true in vitest.config).
const { resolveDbPassword } = require("../core-initializer");

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

// Common seams so app.getPath()/legacyEncryptedDbExists() never run.
const base = {
  userDataPath: "/tmp/userData",
  legacyEncryptedDbExists: () => false,
  legacyPassword: "123456",
};

describe("resolveDbPassword — passphrase source selection matrix", () => {
  it("safeStorage unavailable → legacy-no-safestorage (legacy password, not weaker)", () => {
    const r = resolveDbPassword({
      ...base,
      provider: fakeProvider({ available: false }),
    });
    expect(r).toEqual({ password: "123456", source: "legacy-no-safestorage" });
  });

  it("managed passphrase already exists → managed (uses the stored random key)", () => {
    const r = resolveDbPassword({
      ...base,
      provider: fakeProvider({ hasManaged: true, managedPass: "RND-1" }),
    });
    expect(r).toEqual({ password: "RND-1", source: "managed" });
  });

  it("no managed key + a legacy .encrypted DB exists → legacy-pending-rekey (rekey gate off path)", () => {
    const r = resolveDbPassword({
      ...base,
      legacyEncryptedDbExists: () => true,
      provider: fakeProvider({ hasManaged: false }),
    });
    expect(r).toEqual({ password: "123456", source: "legacy-pending-rekey" });
  });

  it("fresh install (no managed key, no legacy DB) → managed-new (mints a random key)", () => {
    const r = resolveDbPassword({
      ...base,
      provider: fakeProvider({ hasManaged: false, managedPass: "RND-NEW" }),
    });
    expect(r).toEqual({ password: "RND-NEW", source: "managed-new" });
  });

  it("provider throws → legacy-error (falls back to legacy, never weaker, never throws)", () => {
    const throwing = {
      isAvailable: () => {
        throw new Error("safeStorage boom");
      },
    };
    const r = resolveDbPassword({ ...base, provider: throwing });
    expect(r).toEqual({ password: "123456", source: "legacy-error" });
  });
});

describe("resolveDbPassword — legacy password resolution", () => {
  it("DEFAULT_PASSWORD override flows into every legacy branch", () => {
    const r = resolveDbPassword({
      ...base,
      legacyPassword: "env-override-pass",
      provider: fakeProvider({ available: false }),
    });
    expect(r.source).toBe("legacy-no-safestorage");
    expect(r.password).toBe("env-override-pass");
  });

  it("post-rekey state is observable as 'managed' (db-secret.enc now present)", () => {
    // After a successful Phase 2 rekey, db-secret.enc exists → hasManagedPassphrase
    // true → resolveDbPassword returns the managed key even though a .encrypted
    // legacy DB file is still on disk. This is the rekey-gate-ON outcome.
    const r = resolveDbPassword({
      ...base,
      legacyEncryptedDbExists: () => true,
      provider: fakeProvider({ hasManaged: true, managedPass: "REKEYED" }),
    });
    expect(r).toEqual({ password: "REKEYED", source: "managed" });
  });
});

describe("resolveDbPassword — default provider seam", () => {
  it("builds a provider via createDbSecretProvider with a db-secret.enc path when none injected", () => {
    let secretPathSeen = null;
    const r = resolveDbPassword({
      userDataPath: "/tmp/ud",
      legacyEncryptedDbExists: () => false,
      createDbSecretProvider: (opts) => {
        secretPathSeen = opts.secretPath;
        return fakeProvider({ hasManaged: true, managedPass: "FROM-FACTORY" });
      },
    });
    expect(r).toEqual({ password: "FROM-FACTORY", source: "managed" });
    expect(secretPathSeen).toContain("db-secret.enc");
  });
});
