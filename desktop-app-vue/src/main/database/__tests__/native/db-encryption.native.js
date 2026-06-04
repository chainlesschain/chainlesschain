/**
 * db-encryption.native.js — L2 REAL-SQLCipher integration tests.
 *
 * Unlike the fake-fs unit tests (encrypted-migration.test.js / legacy-rekey.test.js),
 * this drives the ACTUAL production modules against the REAL
 * `better-sqlite3-multiple-ciphers` native module + real temp files, proving the
 * data-safety claims that the fakes cannot:
 *   G1  plaintext -> .encrypted migration preserves data (中文/emoji/NULL/BLOB/TEXT-number)
 *   G2  legacy("123456") -> managed rekey actually swaps the key (new opens, old fails)
 *   G3  fail-closed: an undecryptable target throws AND is deleted (no silent plaintext)
 *   G5  crash recovery on real files (drop-stale-backup / restored-legacy)
 *   G6  concurrency lock skips a second migration
 *
 * ABI NOTE: the prebuilt bs3mc `.node` targets Electron's NODE_MODULE_VERSION (140),
 * NOT plain Node (127). vitest runs under Node and CANNOT load it, so this file is
 * named WITHOUT `.test.` (excluded from the vitest glob) and is run via
 * Electron-as-Node:  npm run test:db-encryption-native
 * It is therefore NOT a CI gate today — coverage boundary is explicit, not silent.
 *
 * Run cwd MUST be desktop-app-vue/ (sql.js WASM is located relative to cwd).
 */

/* eslint-disable no-console */
const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const D = require("better-sqlite3-multiple-ciphers");
const {
  migratePlaintextToEncrypted,
  _acquireLock,
  _releaseLock,
} = require("../../encrypted-migration");
const {
  rekeyLegacyDbToManaged,
  recoverInterruptedRekey,
} = require("../../legacy-rekey");
const { createEncryptedDatabase } = require("../../sqlcipher-wrapper");

// ----- SQLCipher pragmas mirrored from sqlcipher-wrapper SQLCIPHER_CONFIG -----
// (must match exactly so raw-built fixtures interop with the wrapper)
function applyKey(db, keyHex) {
  db.pragma(`key = "x'${keyHex}'"`);
  db.pragma("cipher_page_size = 4096");
  db.pragma("kdf_iter = 256000");
  db.pragma("cipher_hmac_algorithm = 1");
  db.pragma("cipher_kdf_algorithm = 2");
}

const hex32 = () => crypto.randomBytes(32).toString("hex");

// Real PBKDF2 deriveKey (32-byte hex), the seam legacy-rekey injects.
function deriveKey(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const key = crypto
    .pbkdf2Sync(password, Buffer.from(salt, "hex"), 256000, 32, "sha512")
    .toString("hex");
  return { key, salt };
}

// In-memory safeStorage-like provider (real flow, no OS keychain dependency).
function makeProvider() {
  let stored = null;
  return {
    isAvailable: () => true,
    mintPassphrase: () => crypto.randomBytes(32).toString("base64"),
    persistPassphrase(p) {
      stored = p;
    },
    getStored: () => stored,
  };
}

function makeRawEncrypted(p, keyHex, values) {
  const db = new D(p);
  applyKey(db, keyHex);
  db.pragma("journal_mode = DELETE"); // single clean file, no WAL sidecar
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT INTO t(v) VALUES (?)");
  for (const v of values) {
    ins.run(v);
  }
  db.close();
}

function openRawEncrypted(p, keyHex) {
  const db = new D(p);
  applyKey(db, keyHex);
  return db;
}

// ---------------------------------------------------------------- harness ----
let pass = 0;
let failCount = 0;
const failures = [];
async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-enc-l2-"));
  try {
    await fn(dir);
    pass++;
    console.log("  ✓", name);
  } catch (e) {
    failCount++;
    failures.push([name, e]);
    console.log("  ✗", name, "\n      ", e.message);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      /* best-effort */
    }
  }
}

// =============================================================== G1 ==========
async function g1_migration_parity(dir) {
  const src = path.join(dir, "plain.db");
  const target = path.join(dir, "plain.encrypted.db");
  const KEY = hex32();

  // Build a real plaintext SQLite source with tricky values.
  const sdb = new D(src);
  sdb.pragma("journal_mode = DELETE");
  sdb.exec(
    "CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT, body TEXT, n TEXT, blob BLOB, maybe TEXT)",
  );
  const ins = sdb.prepare(
    "INSERT INTO notes(title, body, n, blob, maybe) VALUES (?, ?, ?, ?, ?)",
  );
  const sample = [
    [
      "标题😀",
      "正文 with emoji 🎉 中文 mixed",
      "12345",
      Buffer.from([0, 1, 2, 255]),
      null,
    ],
    [
      "plain ascii",
      "second row",
      "00700",
      Buffer.from([10, 20, 30]),
      "present",
    ],
    ["空blob", "third", "-42", Buffer.alloc(0), null],
  ];
  for (const r of sample) {
    ins.run(r);
  }
  const srcCount = sdb.prepare("SELECT count(*) c FROM notes").get().c;
  sdb.close();

  // Real migration (real sql.js read + real SQLCipher write + reopen-verify).
  const res = await migratePlaintextToEncrypted({
    sourcePath: src,
    targetPath: target,
    encryptionKey: KEY,
  });
  assert.ok(res && res.success, "migration should report success");
  assert.ok(fs.existsSync(target), ".encrypted target should exist");
  assert.ok(fs.existsSync(src + ".old"), "source should be renamed to .old");

  // Reopen the REAL encrypted target and assert data parity.
  const tdb = openRawEncrypted(target, KEY);
  const tCount = tdb.prepare("SELECT count(*) c FROM notes").get().c;
  assert.strictEqual(tCount, srcCount, "row count must match source");

  const row1 = tdb.prepare("SELECT * FROM notes WHERE id=1").get();
  assert.strictEqual(row1.title, "标题😀", "中文+emoji title preserved");
  assert.strictEqual(
    row1.body,
    "正文 with emoji 🎉 中文 mixed",
    "emoji body preserved",
  );
  assert.strictEqual(
    row1.n,
    "12345",
    "TEXT-stored number stays string '12345' (not 12345.0)",
  );
  assert.ok(
    Buffer.isBuffer(row1.blob) && row1.blob.equals(Buffer.from([0, 1, 2, 255])),
    "BLOB bytes preserved",
  );
  assert.strictEqual(row1.maybe, null, "NULL preserved");

  const row3 = tdb.prepare("SELECT * FROM notes WHERE id=3").get();
  assert.strictEqual(row3.n, "-42", "negative TEXT number preserved");
  assert.ok(
    Buffer.isBuffer(row3.blob) && row3.blob.length === 0,
    "empty BLOB preserved",
  );
  tdb.close();

  // Wrong key must NOT open the target (proves it's really encrypted).
  let rejected = false;
  try {
    const bad = openRawEncrypted(target, hex32());
    bad.prepare("SELECT count(*) FROM sqlite_master").get();
    bad.close();
  } catch (_e) {
    rejected = true;
  }
  assert.ok(rejected, "a wrong key must be rejected by the encrypted target");
}

// =============================================================== G3 ==========
async function g3_fail_closed(dir) {
  const src = path.join(dir, "src.db");
  const target = path.join(dir, "src.encrypted.db");
  const KEY = hex32();
  fs.writeFileSync(src, "placeholder"); // presence only; migrate is faked

  // Inject a migrateDatabase that "succeeds" but writes garbage (undecryptable).
  const fakeMigrate = async ({ targetPath }) => {
    fs.writeFileSync(targetPath, crypto.randomBytes(4096));
    return { success: true, tablesCount: 0 };
  };

  let threw = false;
  try {
    await migratePlaintextToEncrypted(
      { sourcePath: src, targetPath: target, encryptionKey: KEY },
      { migrateDatabase: fakeMigrate }, // real createEncryptedDatabase -> real reopen-verify
    );
  } catch (_e) {
    threw = true;
  }
  assert.ok(
    threw,
    "undecryptable target must make migration throw (fail-closed)",
  );
  assert.ok(
    !fs.existsSync(target),
    "the suspect target must be DELETED, never left as plaintext",
  );
}

// =============================================================== G6 ==========
async function g6_concurrency_lock(dir) {
  const src = path.join(dir, "p.db");
  const target = path.join(dir, "p.encrypted.db");
  const KEY = hex32();
  const sdb = new D(src);
  sdb.pragma("journal_mode = DELETE");
  sdb.exec("CREATE TABLE t(id INTEGER PRIMARY KEY)");
  sdb.close();

  const lockPath = `${target}.migrating.lock`;
  assert.ok(_acquireLock(lockPath), "test should hold the lock first");
  try {
    const res = await migratePlaintextToEncrypted({
      sourcePath: src,
      targetPath: target,
      encryptionKey: KEY,
    });
    assert.ok(
      res.skipped && res.reason === "locked",
      "must skip when lock is held",
    );
    assert.ok(!fs.existsSync(target), "no target written while locked out");
  } finally {
    _releaseLock(lockPath);
  }
}

// =============================================================== G2 ==========
async function g2_real_rekey(dir) {
  const dbPath = path.join(dir, "legacy.encrypted.db");
  const oldSalt = crypto.randomBytes(16).toString("hex");
  const oldKey = deriveKey("123456", oldSalt).key;

  // Build a real legacy("123456"-derived) encrypted DB with data.
  makeRawEncrypted(dbPath, oldKey, ["legacy-row-中文", "row2"]);

  const provider = makeProvider();
  let savedSalt = null;
  const res = await rekeyLegacyDbToManaged(
    { encryptedDbPath: dbPath, legacyPassword: "123456" },
    {
      provider,
      deriveKey,
      loadMetadata: async () => ({ salt: oldSalt }),
      saveMetadata: async (m) => {
        savedSalt = m.salt;
      },
      createEncryptedDatabase, // REAL wrapper -> real PRAGMA rekey
    },
  );
  assert.ok(res && res.success, "rekey should succeed");
  assert.ok(provider.getStored(), "managed passphrase should be persisted");
  assert.ok(savedSalt, "new salt should be saved");
  assert.ok(
    !fs.existsSync(dbPath + ".rekey-bak"),
    "backup dropped after commit",
  );

  // New managed key (managed pass + new salt) must open with data intact.
  const newKey = deriveKey(provider.getStored(), savedSalt).key;
  const ndb = openRawEncrypted(dbPath, newKey);
  const cnt = ndb.prepare("SELECT count(*) c FROM t").get().c;
  assert.strictEqual(cnt, 2, "data preserved across rekey");
  assert.strictEqual(
    ndb.prepare("SELECT v FROM t WHERE id=1").get().v,
    "legacy-row-中文",
    "row content intact",
  );
  ndb.close();

  // The OLD "123456"-derived key must now FAIL.
  let oldRejected = false;
  try {
    const odb = openRawEncrypted(dbPath, oldKey);
    odb.prepare("SELECT count(*) FROM sqlite_master").get();
    odb.close();
  } catch (_e) {
    oldRejected = true;
  }
  assert.ok(oldRejected, "old legacy key must be rejected after rekey");
}

// =============================================================== G5 ==========
async function g5a_recover_drop_stale_backup(dir) {
  const dbPath = path.join(dir, "main.encrypted.db");
  const bak = dbPath + ".rekey-bak";
  const managedKey = hex32();
  // Commit finished: target opens with managed key, but a stale backup lingers.
  makeRawEncrypted(dbPath, managedKey, ["committed"]);
  fs.writeFileSync(bak, "stale backup contents");

  const out = await recoverInterruptedRekey(
    { encryptedDbPath: dbPath, managedKeyResolver: async () => managedKey },
    { fs, createEncryptedDatabase },
  );
  assert.deepStrictEqual(out, { recovered: true, action: "drop-stale-backup" });
  assert.ok(!fs.existsSync(bak), "stale backup removed");
  const db = openRawEncrypted(dbPath, managedKey);
  assert.strictEqual(
    db.prepare("SELECT v FROM t").get().v,
    "committed",
    "target intact",
  );
  db.close();
}

async function g5b_recover_restored_legacy(dir) {
  const dbPath = path.join(dir, "main.encrypted.db");
  const bak = dbPath + ".rekey-bak";
  const legacyKey = hex32();
  const newKey = hex32();
  // Commit incomplete: target was rekeyed (newKey) but managed secret absent;
  // the backup still holds the openable legacy DB.
  makeRawEncrypted(dbPath, newKey, ["partial-new"]);
  makeRawEncrypted(bak, legacyKey, ["legacy-data-中文"]);

  const out = await recoverInterruptedRekey(
    { encryptedDbPath: dbPath, managedKeyResolver: async () => null },
    { fs, createEncryptedDatabase },
  );
  assert.deepStrictEqual(out, { recovered: true, action: "restored-legacy" });
  assert.ok(!fs.existsSync(bak), "backup consumed by restore");
  // Target should now be the legacy DB, openable with the legacy key.
  const db = openRawEncrypted(dbPath, legacyKey);
  assert.strictEqual(
    db.prepare("SELECT v FROM t").get().v,
    "legacy-data-中文",
    "reverted to legacy data",
  );
  db.close();
}

// =============================================================== G7 ==========
// True two-process race: spawn TWO Electron-as-Node workers migrating the SAME
// plaintext DB to the SAME target simultaneously. The cross-process file lock
// (or the target-exists guard, depending on interleaving) must ensure EXACTLY
// ONE real migration, no double-write/corruption, and a cleaned-up lock.
function runMigrateWorker(workerPath, src, target, key) {
  const { spawn } = require("child_process");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerPath, src, target, key], {
      cwd: process.cwd(), // desktop-app-vue (sql.js WASM locateFile)
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", () => {});
    child.on("close", () => {
      const line = out.split("\n").find((l) => l.startsWith("WORKER_RESULT "));
      let parsed = { outcome: "no-output", raw: out.slice(0, 200) };
      if (line) {
        try {
          parsed = JSON.parse(line.slice("WORKER_RESULT ".length));
        } catch (_e) {
          /* keep no-output */
        }
      }
      resolve(parsed);
    });
  });
}

async function g7_two_process_concurrent_migration(dir) {
  const src = path.join(dir, "p.db");
  const target = path.join(dir, "p.encrypted.db");
  const KEY = hex32();

  const sdb = new D(src);
  sdb.pragma("journal_mode = DELETE");
  sdb.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const ins = sdb.prepare("INSERT INTO t(v) VALUES (?)");
  for (let i = 0; i < 50; i++) {
    ins.run("row-" + i);
  }
  sdb.close();

  const worker = path.join(__dirname, "db-encryption-migrate-worker.js");
  const [a, b] = await Promise.all([
    runMigrateWorker(worker, src, target, KEY),
    runMigrateWorker(worker, src, target, KEY),
  ]);

  const both = [a, b];
  const migrated = both.filter((x) => x.outcome === "migrated").length;
  assert.strictEqual(
    migrated,
    1,
    `exactly one process must migrate, got ${JSON.stringify(both)}`,
  );
  assert.ok(
    both.every((x) =>
      ["migrated", "locked", "skipped-exists"].includes(x.outcome),
    ),
    `no errors / corruption from the race: ${JSON.stringify(both)}`,
  );

  // The single resulting target must be valid + all rows present exactly once.
  assert.ok(fs.existsSync(target), "target exists after the race");
  const tdb = openRawEncrypted(target, KEY);
  assert.strictEqual(
    tdb.prepare("SELECT count(*) c FROM t").get().c,
    50,
    "all 50 rows migrated exactly once (no double-write)",
  );
  tdb.close();

  // Lock must be released regardless of which process won.
  assert.ok(
    !fs.existsSync(target + ".migrating.lock"),
    "migrating lock cleaned up",
  );
}

// ----------------------------------------------------------------- main ------
(async () => {
  console.log(
    "L2 real-SQLCipher integration (bs3mc ABI " +
      process.versions.modules +
      (process.versions.electron
        ? " / electron " + process.versions.electron
        : "") +
      ")",
  );
  await test(
    "G1 plaintext->encrypted migration preserves data",
    g1_migration_parity,
  );
  await test(
    "G3 fail-closed: undecryptable target throws + deleted",
    g3_fail_closed,
  );
  await test("G6 concurrency lock skips second migration", g6_concurrency_lock);
  await test(
    "G2 legacy->managed rekey swaps key (new opens, old fails)",
    g2_real_rekey,
  );
  await test(
    "G5a recovery drops stale backup when commit finished",
    g5a_recover_drop_stale_backup,
  );
  await test(
    "G5b recovery restores legacy backup when commit incomplete",
    g5b_recover_restored_legacy,
  );
  await test(
    "G7 two-process concurrent migration: exactly one wins, no corruption",
    g7_two_process_concurrent_migration,
  );

  console.log(`\n${pass} passed, ${failCount} failed`);
  if (failCount > 0) {
    for (const [name, e] of failures) {
      console.log(`\nFAILED: ${name}\n${e.stack || e.message}`);
    }
    process.exit(1);
  }
})();
