/**
 * db-secret-provider U-Key escrow tests — Phase 3 (Method B), gated default OFF.
 *
 * Covers the U-Key wrapping layer that lets the U-Key gate the managed DB
 * passphrase WITHOUT ever re-keying the database:
 *   - wrap/unwrap round-trip + on-disk ciphertext
 *   - dual-escrow: prefer U-Key, fall back to safeStorage, opportunistic escrow,
 *     stable passphrase across boots, corrupt-unwrap fallback
 *   - hardware-only: first-setup guards (U-Key + backup code), reuse existing
 *     passphrase (no rekey), drop the safeStorage copy, fail-closed reads,
 *     backup-code recovery (incl. wrong-code rejection)
 *   - getUKeyEscrowMode() three-state gate + createUKeyEscrowAdapter()
 *
 * Pure unit test: in-memory fs + fake safeStorage + fake U-Key seam, so it runs
 * on Windows with no real SIMKey hardware (real-device E2E is deferred).
 */

const {
  createDbSecretProvider,
  createUKeyEscrowAdapter,
} = require("../db-secret-provider");
const { getUKeyEscrowMode } = require("../db-encryption-flag");

function makeFakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from("SS::" + s, "utf8"),
    decryptString: (buf) =>
      Buffer.from(buf).toString("utf8").replace(/^SS::/, ""),
  };
}

function makeMemFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) {
        const e = new Error("ENOENT: " + p);
        e.code = "ENOENT";
        throw e;
      }
      return files.get(p);
    },
    writeFileSync: (p, data) => {
      files.set(p, Buffer.from(data));
    },
    mkdirSync: () => {},
    rmSync: (p) => {
      files.delete(p);
    },
  };
}

/**
 * Reversible fake U-Key seam: wrap prefixes "UK::", unwrap strips it. `available`
 * is mutable so tests can simulate plug/unplug; `failUnwrap` simulates corruption.
 */
function makeFakeUKey(opts = {}) {
  const state = { available: opts.available !== false, failUnwrap: false };
  return {
    state,
    isAvailable: () => state.available,
    wrap: async (buf) => Buffer.from("UK::" + buf.toString("utf8"), "utf8"),
    unwrap: async (buf) => {
      if (state.failUnwrap) {
        throw new Error("simulated U-Key unwrap failure");
      }
      return Buffer.from(buf.toString("utf8").replace(/^UK::/, ""), "utf8");
    },
  };
}

const SECRET = "/fake/userData/db-secret.enc";

describe("db-secret-provider U-Key escrow — primitives", () => {
  it("wrap → unwrap round-trips the passphrase and stores ciphertext", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });

    expect(provider.hasUKeyEscrow()).toBe(false);
    const p = provider.getOrCreateManagedPassphrase();
    await provider.wrapPassphraseWithUKey(p);

    expect(provider.hasUKeyEscrow()).toBe(true);
    const onDisk = fs.files.get(provider.uKeySecretPath).toString("utf8");
    expect(onDisk.startsWith("UK::")).toBe(true);
    expect(onDisk).not.toBe(p);

    const back = await provider.unwrapPassphraseFromUKey();
    expect(back).toBe(p);
  });

  it("wrap throws when the U-Key is unavailable", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey({ available: false }),
    });
    await expect(provider.wrapPassphraseWithUKey("x")).rejects.toThrow(
      /U-Key 不可用/,
    );
  });

  it("unwrap throws when no escrow exists", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    await expect(provider.unwrapPassphraseFromUKey()).rejects.toThrow(
      /无 U-Key 托管口令/,
    );
  });

  it("isUKeyAvailable reflects the seam and a null seam", () => {
    const withKey = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey({ available: true }),
    });
    expect(withKey.isUKeyAvailable()).toBe(true);

    const noKey = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
    });
    expect(noKey.isUKeyAvailable()).toBe(false);
  });
});

describe("db-secret-provider U-Key escrow — dual-escrow mode", () => {
  it("mints via safeStorage and opportunistically creates the U-Key escrow", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });

    const p = await provider.resolvePassphrase({ mode: "dual-escrow" });
    expect(typeof p).toBe("string");
    expect(fs.files.has(SECRET)).toBe(true); // safeStorage copy
    expect(provider.hasUKeyEscrow()).toBe(true); // U-Key copy
    // both escrows decode to the same passphrase
    expect(await provider.unwrapPassphraseFromUKey()).toBe(p);
  });

  it("prefers the U-Key copy on a second boot (same passphrase)", async () => {
    const fs = makeMemFs();
    const ss = makeFakeSafeStorage(true);
    const uKey = makeFakeUKey();

    const boot1 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p1 = await boot1.resolvePassphrase({ mode: "dual-escrow" });

    const boot2 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p2 = await boot2.resolvePassphrase({ mode: "dual-escrow" });
    expect(p2).toBe(p1);
  });

  it("falls back to safeStorage when the U-Key is absent (no lockout)", async () => {
    const fs = makeMemFs();
    const ss = makeFakeSafeStorage(true);

    // First boot WITH U-Key creates both escrows.
    const uKey = makeFakeUKey();
    const boot1 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p1 = await boot1.resolvePassphrase({ mode: "dual-escrow" });

    // Second boot the U-Key is unplugged → still resolves via safeStorage.
    uKey.state.available = false;
    const boot2 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p2 = await boot2.resolvePassphrase({ mode: "dual-escrow" });
    expect(p2).toBe(p1);
  });

  it("falls back to safeStorage when U-Key unwrap fails (corrupt escrow)", async () => {
    const fs = makeMemFs();
    const ss = makeFakeSafeStorage(true);
    const uKey = makeFakeUKey();

    const boot1 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p1 = await boot1.resolvePassphrase({ mode: "dual-escrow" });

    uKey.state.failUnwrap = true; // U-Key present but unwrap blows up
    const boot2 = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
      uKey,
    });
    const p2 = await boot2.resolvePassphrase({ mode: "dual-escrow" });
    expect(p2).toBe(p1); // recovered via safeStorage
  });

  it("works safeStorage-only when no U-Key seam is configured", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      // no uKey
    });
    const p = await provider.resolvePassphrase({ mode: "dual-escrow" });
    expect(typeof p).toBe("string");
    expect(provider.hasUKeyEscrow()).toBe(false);
  });
});

describe("db-secret-provider U-Key escrow — hardware-only mode", () => {
  const BACKUP = "correct-horse-battery";

  it("first setup requires an available U-Key", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey({ available: false }),
    });
    await expect(
      provider.resolvePassphrase({ mode: "hardware-only", backupCode: BACKUP }),
    ).rejects.toThrow(/需要可用的 U-Key/);
  });

  it("first setup requires a backup code (anti-lockout)", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    await expect(
      provider.resolvePassphrase({ mode: "hardware-only" }),
    ).rejects.toThrow(/备份码/);
  });

  it("first setup wraps with U-Key + backup and drops the safeStorage copy", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    // Pre-existing safeStorage copy (e.g. migrating from dual) — should be removed.
    fs.files.set(SECRET, Buffer.from("SS::pre-existing-passphrase"));

    const p = await provider.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });
    // reused the existing passphrase (no rekey)
    expect(p).toBe("pre-existing-passphrase");
    expect(provider.hasUKeyEscrow()).toBe(true);
    expect(provider.hasBackupEscrow()).toBe(true);
    expect(fs.files.has(SECRET)).toBe(false); // software copy gone
  });

  it("mints a fresh passphrase for a brand-new DB (no prior secret)", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    const p = await provider.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });
    expect(Buffer.from(p, "base64").length).toBe(32);
    expect(fs.files.has(SECRET)).toBe(false);
  });

  it("established escrow reads via the U-Key", async () => {
    const fs = makeMemFs();
    const uKey = makeFakeUKey();
    const setup = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    const p1 = await setup.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });

    const boot = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    const p2 = await boot.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });
    expect(p2).toBe(p1);
  });

  it("fail-closed when the U-Key is absent and no backup code is supplied", async () => {
    const fs = makeMemFs();
    const uKey = makeFakeUKey();
    const setup = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    await setup.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });

    uKey.state.available = false;
    const boot = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    await expect(
      boot.resolvePassphrase({ mode: "hardware-only" }),
    ).rejects.toThrow(/fail-closed/);
  });

  it("recovers via the backup code when the U-Key is absent", async () => {
    const fs = makeMemFs();
    const uKey = makeFakeUKey();
    const setup = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    const p1 = await setup.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });

    uKey.state.available = false;
    const boot = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey,
    });
    const p2 = await boot.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });
    expect(p2).toBe(p1);
  });

  it("rejects a wrong backup code (AES-GCM auth-tag mismatch)", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    await provider.resolvePassphrase({
      mode: "hardware-only",
      backupCode: BACKUP,
    });
    expect(() => provider.recoverFromBackupEscrow("wrong-code-xxx")).toThrow();
  });

  it("export rejects a too-short backup code", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    expect(() => provider.exportBackupEscrow("p", "12345")).toThrow(
      /备份码过短/,
    );
  });
});

describe("db-secret-provider U-Key escrow — misc", () => {
  it("safestorage-only mode is the unchanged legacy path", async () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
      uKey: makeFakeUKey(),
    });
    const p = await provider.resolvePassphrase({ mode: "safestorage-only" });
    expect(p).toBe(provider.getOrCreateManagedPassphrase());
    expect(provider.hasUKeyEscrow()).toBe(false);
  });

  it("unknown mode throws", async () => {
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs: makeMemFs(),
      safeStorage: makeFakeSafeStorage(true),
    });
    await expect(provider.resolvePassphrase({ mode: "bogus" })).rejects.toThrow(
      /未知 escrow 模式/,
    );
  });
});

describe("getUKeyEscrowMode — three-state gate", () => {
  const ENV_KEYS = [
    "CHAINLESSCHAIN_ENABLE_UKEY_WRAP",
    "CHAINLESSCHAIN_UKEY_HARDWARE_ONLY",
  ];
  let saved;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it("defaults to safestorage-only (gate OFF)", () => {
    expect(getUKeyEscrowMode()).toBe("safestorage-only");
  });

  it("env enable → dual-escrow", () => {
    process.env.CHAINLESSCHAIN_ENABLE_UKEY_WRAP = "1";
    expect(getUKeyEscrowMode()).toBe("dual-escrow");
  });

  it("env enable + hardware-only → hardware-only", () => {
    process.env.CHAINLESSCHAIN_ENABLE_UKEY_WRAP = "true";
    process.env.CHAINLESSCHAIN_UKEY_HARDWARE_ONLY = "1";
    expect(getUKeyEscrowMode()).toBe("hardware-only");
  });

  it("env force-off overrides a future default-on gate", () => {
    process.env.CHAINLESSCHAIN_ENABLE_UKEY_WRAP = "0";
    expect(getUKeyEscrowMode({ defaultOn: true })).toBe("safestorage-only");
  });

  it("gated default-on (no env) → dual-escrow", () => {
    expect(getUKeyEscrowMode({ defaultOn: true })).toBe("dual-escrow");
  });
});

describe("createUKeyEscrowAdapter", () => {
  it("adapts a ukeyManager's encrypt/decrypt into the escrow seam", async () => {
    const ukeyManager = {
      isInitialized: true,
      encrypt: async (buf) => Buffer.concat([Buffer.from("ENC:"), buf]),
      decrypt: async (buf) => buf.slice(4),
    };
    const adapter = createUKeyEscrowAdapter(ukeyManager);
    expect(adapter.isAvailable()).toBe(true);
    const wrapped = await adapter.wrap(Buffer.from("secret"));
    expect(wrapped.toString("utf8")).toBe("ENC:secret");
    expect((await adapter.unwrap(wrapped)).toString("utf8")).toBe("secret");
  });

  it("isAvailable() is false for an uninitialized / null ukeyManager", () => {
    expect(createUKeyEscrowAdapter(null).isAvailable()).toBe(false);
    expect(
      createUKeyEscrowAdapter({ isInitialized: false }).isAvailable(),
    ).toBe(false);
  });
});
