/**
 * L3 (cont.) — maybeRunLegacyRekey end-to-end gate/recover/rekey selection.
 *
 * Phase 2 orchestration: it must (a) no-op unless BOTH encryption- and rekey-opt-in
 * gates are on, (b) no-op when there's no legacy .encrypted DB, (c) run interrupted-
 * rekey recovery BEFORE attempting a rekey, (d) skip the rekey when already-managed
 * or safeStorage unavailable, (e) otherwise rekey with the legacy password, and
 * (f) swallow any error (keep legacy, never block startup).
 *
 * Pure logic via injected seams — no electron app / safeStorage / KeyManager /
 * native module — so this is a normal vitest CI test. The legacy-rekey internals
 * themselves are covered by database/__tests__/legacy-rekey.test.js + the L2
 * real-SQLCipher suite; here we only assert WHICH branch bootstrap takes.
 */

// describe/it/expect are vitest globals (globals: true in vitest.config).
const { maybeRunLegacyRekey } = require("../core-initializer");

function fakeProvider({ hasManaged = false, available = true } = {}) {
  return {
    hasManagedPassphrase: () => hasManaged,
    isAvailable: () => available,
    getOrCreateManagedPassphrase: () => "MANAGED",
  };
}

// Build deps with spies that record call order; sensible defaults for the
// "happy path reaches rekey" case, overridable per test.
function makeDeps(over = {}) {
  const calls = [];
  const deps = {
    flags: {
      isDbEncryptionOptIn: () => true,
      isDbRekeyOptIn: () => true,
    },
    fs: { existsSync: () => true },
    getAppConfig: () => ({ getDatabasePath: () => "/data/cc.db" }),
    userDataPath: "/tmp/ud",
    provider: fakeProvider({ hasManaged: false, available: true }),
    deriveKey: async (p, s) => ({ key: `K(${p},${s})`, salt: s || "S" }),
    loadMetadata: async () => ({ salt: "OLDSALT" }),
    saveMetadata: async () => {},
    recoverInterruptedRekey: async (args) => {
      calls.push(["recover", args.encryptedDbPath]);
      return { recovered: false };
    },
    rekeyLegacyDbToManaged: async (args) => {
      calls.push(["rekey", args.encryptedDbPath, args.legacyPassword]);
      return { success: true };
    },
    ...over,
  };
  return { deps, calls };
}

describe("maybeRunLegacyRekey — gate", () => {
  it("no-ops when encryption opt-in is off (gate-off, nothing runs)", async () => {
    const { deps, calls } = makeDeps({
      flags: { isDbEncryptionOptIn: () => false, isDbRekeyOptIn: () => true },
    });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ skipped: "gate-off" });
    expect(calls).toEqual([]);
  });

  it("no-ops when rekey opt-in is off (gate-off)", async () => {
    const { deps, calls } = makeDeps({
      flags: { isDbEncryptionOptIn: () => true, isDbRekeyOptIn: () => false },
    });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ skipped: "gate-off" });
    expect(calls).toEqual([]);
  });
});

describe("maybeRunLegacyRekey — no legacy DB", () => {
  it("no-ops when there is no .encrypted DB (plaintext→encrypted is Phase 1's job)", async () => {
    const { deps, calls } = makeDeps({ fs: { existsSync: () => false } });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ skipped: "no-encrypted-db" });
    expect(calls).toEqual([]); // recovery/rekey never reached
  });
});

describe("maybeRunLegacyRekey — recover-then-skip", () => {
  it("runs recovery, then skips rekey when a managed passphrase already exists", async () => {
    const { deps, calls } = makeDeps({
      provider: fakeProvider({ hasManaged: true, available: true }),
    });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ skipped: "already-managed-or-unavailable" });
    expect(calls).toEqual([["recover", "/data/cc.encrypted.db"]]); // recovered, no rekey
  });

  it("runs recovery, then skips rekey when safeStorage is unavailable", async () => {
    const { deps, calls } = makeDeps({
      provider: fakeProvider({ hasManaged: false, available: false }),
    });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ skipped: "already-managed-or-unavailable" });
    expect(calls).toEqual([["recover", "/data/cc.encrypted.db"]]);
  });
});

describe("maybeRunLegacyRekey — rekey path", () => {
  it("recovers BEFORE rekeying, and rekeys with the derived encrypted path + legacy password", async () => {
    const { deps, calls } = makeDeps({ legacyPassword: "123456" });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ rekeyed: true, result: { success: true } });
    // ordering matters: recovery must precede rekey
    expect(calls).toEqual([
      ["recover", "/data/cc.encrypted.db"],
      ["rekey", "/data/cc.encrypted.db", "123456"],
    ]);
  });

  it("passes the DEFAULT_PASSWORD override through to rekey", async () => {
    const { deps, calls } = makeDeps({ legacyPassword: "env-pass" });
    await maybeRunLegacyRekey(deps);
    expect(calls.find((c) => c[0] === "rekey")[2]).toBe("env-pass");
  });
});

describe("maybeRunLegacyRekey — fail-safe", () => {
  it("swallows errors and keeps legacy (never throws, returns {error})", async () => {
    const { deps } = makeDeps({
      recoverInterruptedRekey: async () => {
        throw new Error("recover boom");
      },
    });
    const r = await maybeRunLegacyRekey(deps);
    expect(r).toEqual({ error: "recover boom" });
  });
});
