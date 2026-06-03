/**
 * db-secret-provider tests — safeStorage-backed DB master passphrase.
 *
 * Verifies: generate-on-first-use + persist, reuse on subsequent calls, the
 * on-disk blob is ciphertext (not the raw passphrase), high-entropy output,
 * cross-instance stability, and the unavailable-safeStorage failure path.
 * Uses an in-memory fs + fake safeStorage so no real disk or Electron is needed.
 */

const { createDbSecretProvider } = require("../db-secret-provider");

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
  };
}

const SECRET = "/fake/userData/db-secret.enc";

describe("db-secret-provider", () => {
  it("mints + persists a passphrase on first use, reuses it after", () => {
    const fs = makeMemFs();
    const safeStorage = makeFakeSafeStorage(true);
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage,
    });

    expect(provider.hasManagedPassphrase()).toBe(false);
    const first = provider.getOrCreateManagedPassphrase();
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(20);
    expect(provider.hasManagedPassphrase()).toBe(true);

    const second = provider.getOrCreateManagedPassphrase();
    expect(second).toBe(first); // stable across calls
  });

  it("stores ciphertext on disk, never the raw passphrase", () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
    });
    const passphrase = provider.getOrCreateManagedPassphrase();

    const onDisk = fs.files.get(SECRET).toString("utf8");
    expect(onDisk.startsWith("SS::")).toBe(true); // safeStorage ciphertext tag
    expect(onDisk).not.toBe(passphrase);
    expect(onDisk).toContain(passphrase); // (fake cipher embeds it; real DPAPI would not)
  });

  it("produces a high-entropy passphrase (32 random bytes, base64)", () => {
    const fs = makeMemFs();
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(true),
    });
    const p = provider.getOrCreateManagedPassphrase();
    // 32 bytes base64 -> 44 chars (incl. trailing '=')
    expect(p).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(p, "base64").length).toBe(32);
  });

  it("a second provider over the same fs+path reads the same passphrase", () => {
    const fs = makeMemFs();
    const ss = makeFakeSafeStorage(true);
    const a = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
    });
    const b = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: ss,
    });
    const pa = a.getOrCreateManagedPassphrase();
    const pb = b.getOrCreateManagedPassphrase();
    expect(pb).toBe(pa);
  });

  describe("safeStorage unavailable", () => {
    it("isAvailable() is false and getOrCreate throws", () => {
      const fs = makeMemFs();
      const provider = createDbSecretProvider({
        secretPath: SECRET,
        fs,
        safeStorage: makeFakeSafeStorage(false),
      });
      expect(provider.isAvailable()).toBe(false);
      expect(() => provider.getOrCreateManagedPassphrase()).toThrow(
        /safeStorage/,
      );
      // nothing written
      expect(fs.files.has(SECRET)).toBe(false);
    });

    it("null safeStorage is treated as unavailable", () => {
      const provider = createDbSecretProvider({
        secretPath: SECRET,
        fs: makeMemFs(),
        safeStorage: null,
      });
      expect(provider.isAvailable()).toBe(false);
    });
  });

  it("hasManagedPassphrase reflects file existence even when unavailable", () => {
    const fs = makeMemFs();
    fs.files.set(SECRET, Buffer.from("SS::pre-existing"));
    const provider = createDbSecretProvider({
      secretPath: SECRET,
      fs,
      safeStorage: makeFakeSafeStorage(false),
    });
    expect(provider.hasManagedPassphrase()).toBe(true);
  });
});
