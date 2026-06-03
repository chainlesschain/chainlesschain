/**
 * legacy-rekey tests — Phase 2 legacy("123456")→managed rekey (gated, default off).
 *
 * In-memory fs models a per-file encryption key so we can assert rekey, rollback,
 * the retained-backup commit contract, the orchestrator's commit ordering, and
 * boot recovery — without real SQLCipher.
 */

const {
  rekeyEncryptedDb,
  rekeyLegacyDbToManaged,
  recoverInterruptedRekey,
} = require("../legacy-rekey");

const DB = "/db/main.encrypted.db";
const BAK = DB + ".rekey-bak";
const LOCK = DB + ".rekeying.lock";

/** fs whose "files" map stores { key } per path (key = current encryption key). */
function makeFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  let fd = 1;
  const fdPath = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    openSync: (p, flag) => {
      if (flag === "wx" && files.has(p)) {
        const e = new Error("EEXIST");
        e.code = "EEXIST";
        throw e;
      }
      files.set(p, { mtimeMs: 0 });
      const h = fd++;
      fdPath.set(h, p);
      return h;
    },
    writeSync: () => {},
    closeSync: (h) => fdPath.delete(h),
    statSync: (p) => {
      if (!files.has(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      return files.get(p);
    },
    unlinkSync: (p) => {
      if (!files.delete(p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
    },
    copyFileSync: (src, dst) => {
      files.set(dst, { ...files.get(src) });
    },
    renameSync: (src, dst) => {
      files.set(dst, files.get(src));
      files.delete(src);
    },
  };
}

/** Fake SQLCipher db factory bound to an fs; get() throws on key mismatch. */
function makeDbFactory(fs, hooks = {}) {
  let opens = 0;
  return (path, key) => {
    const idx = ++opens;
    return {
      open: () => {
        if (hooks.failOpenAt === idx) {
          throw new Error("cannot open (forced)");
        }
      },
      prepare: () => ({
        get: () => {
          const f = fs.files.get(path);
          if (!f || f.key !== key) {
            throw new Error("file is not a database (bad key)");
          }
          return { c: 1 };
        },
        free: () => {},
      }),
      rekey: (newKey) => {
        fs.files.get(path).key = newKey;
      },
      close: () => {},
    };
  };
}

describe("rekeyEncryptedDb (core)", () => {
  it("rekeys in place, verifies, and RETAINS the backup for the caller", async () => {
    const fs = makeFs({ [DB]: { key: "OLD" } });
    const res = await rekeyEncryptedDb(
      { encryptedDbPath: DB, oldKey: "OLD", newKey: "NEW" },
      { fs, now: () => 1, createEncryptedDatabase: makeDbFactory(fs) },
    );
    expect(res.success).toBe(true);
    expect(res.backupPath).toBe(BAK);
    expect(fs.files.get(DB).key).toBe("NEW"); // rekeyed
    expect(fs.files.has(BAK)).toBe(true); // backup retained (caller commits then deletes)
    expect(fs.files.has(LOCK)).toBe(false); // lock released
  });

  it("rolls back to the legacy DB when the old key is wrong", async () => {
    const fs = makeFs({ [DB]: { key: "ACTUAL_OLD" } });
    await expect(
      rekeyEncryptedDb(
        { encryptedDbPath: DB, oldKey: "WRONG", newKey: "NEW" },
        { fs, now: () => 1, createEncryptedDatabase: makeDbFactory(fs) },
      ),
    ).rejects.toThrow(/bad key|not a database/);
    expect(fs.files.get(DB).key).toBe("ACTUAL_OLD"); // restored from backup
    expect(fs.files.has(BAK)).toBe(false); // backup consumed by rollback
    expect(fs.files.has(LOCK)).toBe(false);
  });

  it("rolls back when the reopen-with-new-key verify fails", async () => {
    const fs = makeFs({ [DB]: { key: "OLD" } });
    // 1st db (rekey phase) ok; 2nd db (verify) fails to open.
    const factory = makeDbFactory(fs, { failOpenAt: 2 });
    await expect(
      rekeyEncryptedDb(
        { encryptedDbPath: DB, oldKey: "OLD", newKey: "NEW" },
        { fs, now: () => 1, createEncryptedDatabase: factory },
      ),
    ).rejects.toThrow(/cannot open/);
    expect(fs.files.has(DB)).toBe(true);
    expect(fs.files.get(DB).key).toBe("OLD"); // restored
    expect(fs.files.has(BAK)).toBe(false);
  });

  it("skips when the lock is held by another process", async () => {
    const fs = makeFs({ [DB]: { key: "OLD" }, [LOCK]: { mtimeMs: 999 } });
    const res = await rekeyEncryptedDb(
      { encryptedDbPath: DB, oldKey: "OLD", newKey: "NEW" },
      { fs, now: () => 1000, createEncryptedDatabase: makeDbFactory(fs) },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("locked");
    expect(fs.files.get(DB).key).toBe("OLD"); // untouched
    expect(fs.files.has(BAK)).toBe(false);
  });
});

describe("rekeyLegacyDbToManaged (orchestrator)", () => {
  function fakeProvider(available = true) {
    return {
      isAvailable: () => available,
      mintPassphrase: () => "MANAGED_PASS",
      persisted: null,
      persistPassphrase(p) {
        this.persisted = p;
      },
    };
  }
  // deriveKey(password, salt) -> deterministic {key, salt}
  const deriveKey = async (password, salt) => ({
    key: `K(${password},${salt || "NEWSALT"})`,
    salt: salt || "NEWSALT",
  });

  it("commits in order (rekey → persist secret → save salt → drop backup)", async () => {
    const fs = makeFs({ [BAK]: { key: "OLD" } });
    const provider = fakeProvider(true);
    const order = [];
    const res = await rekeyLegacyDbToManaged(
      { encryptedDbPath: DB, legacyPassword: "123456" },
      {
        fs,
        provider: {
          ...provider,
          persistPassphrase: (p) => {
            order.push("persist:" + p);
            provider.persisted = p;
          },
        },
        deriveKey,
        loadMetadata: async () => ({ salt: "OLDSALT" }),
        saveMetadata: async (m) => order.push("saveMeta:" + m.salt),
        rekeyEncryptedDb: async ({ oldKey, newKey }) => {
          order.push(`rekey:${oldKey}->${newKey}`);
          return { success: true, backupPath: BAK };
        },
      },
    );
    expect(res.success).toBe(true);
    expect(order).toEqual([
      "rekey:K(123456,OLDSALT)->K(MANAGED_PASS,NEWSALT)",
      "persist:MANAGED_PASS",
      "saveMeta:NEWSALT",
    ]);
    expect(fs.files.has(BAK)).toBe(false); // backup dropped only after commit
  });

  it("skips when safeStorage is unavailable", async () => {
    const res = await rekeyLegacyDbToManaged(
      { encryptedDbPath: DB, legacyPassword: "123456" },
      {
        provider: fakeProvider(false),
        deriveKey,
        loadMetadata: async () => ({ salt: "S" }),
        saveMetadata: async () => {},
      },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("no-safestorage");
  });

  it("skips when there is no legacy salt to derive the old key", async () => {
    const res = await rekeyLegacyDbToManaged(
      { encryptedDbPath: DB, legacyPassword: "123456" },
      {
        provider: fakeProvider(true),
        deriveKey,
        loadMetadata: async () => ({}),
        saveMetadata: async () => {},
      },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("no-legacy-salt");
  });
});

describe("recoverInterruptedRekey", () => {
  it("no-ops when there is no leftover backup", async () => {
    const fs = makeFs({ [DB]: { key: "NEW" } });
    const res = await recoverInterruptedRekey(
      { encryptedDbPath: DB, managedKeyResolver: async () => "NEW" },
      { fs, createEncryptedDatabase: makeDbFactory(fs) },
    );
    expect(res.recovered).toBe(false);
  });

  it("drops the stale backup when commit had finished (target opens with managed key)", async () => {
    const fs = makeFs({ [DB]: { key: "NEW" }, [BAK]: { key: "OLD" } });
    const res = await recoverInterruptedRekey(
      { encryptedDbPath: DB, managedKeyResolver: async () => "NEW" },
      { fs, createEncryptedDatabase: makeDbFactory(fs) },
    );
    expect(res).toEqual({ recovered: true, action: "drop-stale-backup" });
    expect(fs.files.has(BAK)).toBe(false);
    expect(fs.files.get(DB).key).toBe("NEW");
  });

  it("restores legacy backup when commit was incomplete (managed key absent/bad)", async () => {
    const fs = makeFs({ [DB]: { key: "NEW" }, [BAK]: { key: "OLD" } });
    const res = await recoverInterruptedRekey(
      { encryptedDbPath: DB, managedKeyResolver: async () => null },
      { fs, createEncryptedDatabase: makeDbFactory(fs) },
    );
    expect(res).toEqual({ recovered: true, action: "restored-legacy" });
    expect(fs.files.has(BAK)).toBe(false);
    expect(fs.files.get(DB).key).toBe("OLD"); // reverted to legacy
  });
});
