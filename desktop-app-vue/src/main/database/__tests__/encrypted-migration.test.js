/**
 * encrypted-migration tests — safe plaintext→.encrypted wrapper.
 *
 * Covers: success + reopen-verify, skipped passthrough, concurrency lock (held
 * vs stale), and reopen-verify failure → suspect target deleted. Uses an
 * in-memory fs + injected migrateDatabase/createEncryptedDatabase so no real
 * disk or SQLCipher is needed.
 */

const {
  migratePlaintextToEncrypted,
  STALE_LOCK_MS,
} = require("../encrypted-migration");

const TARGET = "/db/main.encrypted.db";
const LOCK = TARGET + ".migrating.lock";

/** In-memory fs supporting the lockfile + cleanup ops the module uses. */
function makeMemFs(seed = {}) {
  const files = new Map(Object.entries(seed)); // path -> { mtimeMs }
  let nextFd = 10;
  const fdToPath = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    openSync: (p, flag) => {
      if (flag === "wx" && files.has(p)) {
        const e = new Error("EEXIST: " + p);
        e.code = "EEXIST";
        throw e;
      }
      files.set(p, { mtimeMs: 0 });
      const fd = nextFd++;
      fdToPath.set(fd, p);
      return fd;
    },
    writeSync: (fd) => {
      const p = fdToPath.get(fd);
      if (p) {
        files.set(p, { mtimeMs: 0 });
      }
    },
    closeSync: (fd) => fdToPath.delete(fd),
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
  };
}

function okEncryptedDb() {
  return {
    open: () => {},
    prepare: () => ({ get: () => ({ c: 5 }), free: () => {} }),
    close: () => {},
  };
}

describe("migratePlaintextToEncrypted", () => {
  it("runs migration, reopen-verifies, and releases the lock", async () => {
    const fs = makeMemFs();
    let verified = false;
    const result = await migratePlaintextToEncrypted(
      { sourcePath: "/db/main.db", targetPath: TARGET, encryptionKey: "k" },
      {
        fs,
        now: () => 1000,
        migrateDatabase: async () => ({ success: true, tablesCount: 3 }),
        createEncryptedDatabase: () => {
          verified = true;
          return okEncryptedDb();
        },
      },
    );
    expect(result.success).toBe(true);
    expect(verified).toBe(true); // reopen-with-key check ran
    expect(fs.files.has(LOCK)).toBe(false); // lock released
  });

  it("passes through a skipped migration without reopen-verify", async () => {
    const fs = makeMemFs();
    let opened = false;
    const result = await migratePlaintextToEncrypted(
      { sourcePath: "/db/main.db", targetPath: TARGET, encryptionKey: "k" },
      {
        fs,
        now: () => 1000,
        migrateDatabase: async () => ({ success: true, skipped: true }),
        createEncryptedDatabase: () => {
          opened = true;
          return okEncryptedDb();
        },
      },
    );
    expect(result.skipped).toBe(true);
    expect(opened).toBe(false); // nothing migrated -> no file to verify
    expect(fs.files.has(LOCK)).toBe(false);
  });

  it("aborts (does not migrate) when a fresh lock is held", async () => {
    const now = 50_000;
    const fs = makeMemFs({ [LOCK]: { mtimeMs: now - 1000 } }); // 1s old, fresh
    let migrated = false;
    const result = await migratePlaintextToEncrypted(
      { sourcePath: "/db/main.db", targetPath: TARGET, encryptionKey: "k" },
      {
        fs,
        now: () => now,
        migrateDatabase: async () => {
          migrated = true;
          return { success: true };
        },
        createEncryptedDatabase: okEncryptedDb,
      },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("locked");
    expect(migrated).toBe(false);
    expect(fs.files.has(LOCK)).toBe(true); // someone else's lock left intact
  });

  it("reclaims a stale lock and proceeds", async () => {
    const now = 1_000_000;
    const fs = makeMemFs({ [LOCK]: { mtimeMs: now - STALE_LOCK_MS - 1 } });
    let migrated = false;
    const result = await migratePlaintextToEncrypted(
      { sourcePath: "/db/main.db", targetPath: TARGET, encryptionKey: "k" },
      {
        fs,
        now: () => now,
        migrateDatabase: async () => {
          migrated = true;
          return { success: true };
        },
        createEncryptedDatabase: okEncryptedDb,
      },
    );
    expect(migrated).toBe(true);
    expect(result.success).toBe(true);
    expect(fs.files.has(LOCK)).toBe(false);
  });

  it("deletes the suspect target and rethrows when reopen-verify fails", async () => {
    const fs = makeMemFs();
    const result = migratePlaintextToEncrypted(
      { sourcePath: "/db/main.db", targetPath: TARGET, encryptionKey: "wrong" },
      {
        fs,
        now: () => 1000,
        migrateDatabase: async () => {
          fs.files.set(TARGET, { mtimeMs: 0 }); // migration produced a file
          return { success: true, tablesCount: 1 };
        },
        createEncryptedDatabase: () => ({
          open: () => {
            throw new Error("file is not a database (bad key)");
          },
          close: () => {},
        }),
      },
    );
    await expect(result).rejects.toThrow(/bad key|not a database/);
    expect(fs.files.has(TARGET)).toBe(false); // suspect target removed
    expect(fs.files.has(LOCK)).toBe(false); // lock released
  });
});
