/**
 * db-encryption-realsafestorage.probe.js — B-layer (real-device) semi-automated probe.
 *
 * Purpose: close the ONE gap the L2 native suite cannot — it injects an in-memory
 * provider (`makeProvider()` with `isAvailable: () => true`) and never touches the
 * OS keychain. The pre-flip checklist section B exists almost entirely to prove the
 * REAL safeStorage (Windows DPAPI / mac Keychain / linux libsecret) path works:
 * managed passphrase mint → encrypt-to-disk → reuse-across-runs → drives a real
 * SQLCipher migration with that keychain-sourced key.
 *
 * It therefore runs under a REAL Electron main process (NOT ELECTRON_RUN_AS_NODE),
 * because `safeStorage` is only available after `app.whenReady()`. The same Electron
 * runtime still loads the bs3mc ABI-140 native module, so one process exercises BOTH
 * real keychain AND real SQLCipher.
 *
 * Run (cwd MUST be desktop-app-vue/ for sql.js WASM locateFile):
 *   npm run test:db-encryption-realstore
 *   # or: npx electron src/main/database/__tests__/native/db-encryption-realsafestorage.probe.js
 *
 * Covers checklist B: §2 (managed-new key drives real migration, data parity),
 * the real-keychain half of §3 (wrong key rejected), §7 (kill-switch flag resolution),
 * and proves db-secret.enc is genuine ciphertext (not echoed plaintext).
 *
 * NOT covered (genuinely GUI / human): install-old-build → upgrade user-data path,
 * real power-loss mid-migration. Those remain in the manual runbook.
 */

/* eslint-disable no-console */
const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const { app, safeStorage } = require("electron");
const D = require("better-sqlite3-multiple-ciphers");

const { createDbSecretProvider } = require("../../db-secret-provider");
const { KeyManager } = require("../../key-manager");
const { migratePlaintextToEncrypted } = require("../../encrypted-migration");
const { isDbEncryptionOptIn } = require("../../db-encryption-flag");

// SQLCipher pragmas mirrored from sqlcipher-wrapper SQLCIPHER_CONFIG (must match
// exactly so the wrapper-written DB interops with this raw reader).
function applyKey(db, keyHex) {
  db.pragma(`key = "x'${keyHex}'"`);
  db.pragma("cipher_page_size = 4096");
  db.pragma("kdf_iter = 256000");
  db.pragma("cipher_hmac_algorithm = 1");
  db.pragma("cipher_kdf_algorithm = 2");
}
function openRawEncrypted(p, keyHex) {
  const db = new D(p);
  applyKey(db, keyHex);
  return db;
}

let pass = 0;
let failCount = 0;
const failures = [];
async function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-enc-realstore-"));
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

// R0 — real keychain is actually available on this machine.
async function r0_keychain_available() {
  assert.strictEqual(
    typeof safeStorage.isEncryptionAvailable,
    "function",
    "safeStorage must be present in a real Electron main process",
  );
  assert.ok(
    safeStorage.isEncryptionAvailable(),
    "OS keychain (DPAPI/Keychain/libsecret) must report available — " +
      "if false on this box, B cannot be signed off here",
  );
}

// R1 — first run mints + persists a managed passphrase via REAL safeStorage.
async function r1_mint_persist(dir) {
  const secretPath = path.join(dir, "db-secret.enc");
  const provider = createDbSecretProvider({ secretPath }); // real electron.safeStorage
  assert.ok(provider.isAvailable(), "provider sees real keychain");
  assert.ok(
    !provider.hasManagedPassphrase(),
    "no managed passphrase before first use",
  );
  const pp = provider.getOrCreateManagedPassphrase();
  assert.ok(pp && pp.length >= 40, "minted passphrase is high-entropy base64");
  assert.ok(fs.existsSync(secretPath), "db-secret.enc written to disk");
  assert.ok(
    provider.hasManagedPassphrase(),
    "hasManagedPassphrase true after mint",
  );
}

// R2 — the on-disk secret is genuine ciphertext, NOT the passphrase echoed.
async function r2_real_ciphertext(dir) {
  const secretPath = path.join(dir, "db-secret.enc");
  const provider = createDbSecretProvider({ secretPath });
  const pp = provider.getOrCreateManagedPassphrase();
  const raw = fs.readFileSync(secretPath);
  // The plaintext passphrase must NOT appear anywhere in the encrypted blob.
  assert.ok(
    !raw.toString("latin1").includes(pp),
    "passphrase plaintext must not be present in db-secret.enc (real encryption)",
  );
  assert.ok(
    !raw.toString("utf8").includes(pp),
    "passphrase plaintext must not be present (utf8 view)",
  );
  // Sanity: a wrong-format blob must not decrypt to the passphrase.
  assert.ok(raw.length > 0, "ciphertext non-empty");
}

// R3 — a SECOND provider instance reads back the SAME passphrase via real DPAPI
// decrypt (proves reuse-across-runs / "managed" path, not a fresh re-mint).
async function r3_reuse_across_runs(dir) {
  const secretPath = path.join(dir, "db-secret.enc");
  const p1 = createDbSecretProvider({ secretPath });
  const first = p1.getOrCreateManagedPassphrase();
  // Fresh instance == simulates a new app launch reading the persisted secret.
  const p2 = createDbSecretProvider({ secretPath });
  const second = p2.getOrCreateManagedPassphrase();
  assert.strictEqual(
    second,
    first,
    "second launch must decrypt the SAME managed passphrase (no re-mint)",
  );
}

// R4 — END-TO-END managed path with REAL keychain: keychain passphrase → real
// KeyManager PBKDF2 → real plaintext→encrypted migration → reopen → data parity.
// This is the §2 "managed-new" scenario the L2 in-memory provider can't prove.
async function r4_managed_key_drives_real_migration(dir) {
  const secretPath = path.join(dir, "db-secret.enc");
  const src = path.join(dir, "plain.db");
  const target = path.join(dir, "plain.encrypted.db");

  // 1) keychain-sourced managed passphrase
  const provider = createDbSecretProvider({ secretPath });
  const managedPass = provider.getOrCreateManagedPassphrase();

  // 2) derive the SQLCipher key with the REAL production KeyManager (PBKDF2)
  const km = new KeyManager({
    encryptionEnabled: true,
    configPath: path.join(dir, "db-key-config.json"),
  });
  const { key } = await km.deriveKeyFromPassword(managedPass, null);
  assert.ok(key && /^[0-9a-f]+$/i.test(key), "derived hex key");

  // 3) build a real plaintext SQLite source with tricky values
  const sdb = new D(src);
  sdb.pragma("journal_mode = DELETE");
  sdb.exec(
    "CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT, body TEXT, n TEXT, blob BLOB, maybe TEXT)",
  );
  const ins = sdb.prepare(
    "INSERT INTO notes(title, body, n, blob, maybe) VALUES (?, ?, ?, ?, ?)",
  );
  ins.run(
    "标题😀",
    "正文 emoji 🎉 中文",
    "00700",
    Buffer.from([0, 1, 2, 255]),
    null,
  );
  ins.run("ascii", "row2", "-42", Buffer.alloc(0), "present");
  const srcCount = sdb.prepare("SELECT count(*) c FROM notes").get().c;
  sdb.close();

  // 4) real migration using the keychain-derived key
  const res = await migratePlaintextToEncrypted({
    sourcePath: src,
    targetPath: target,
    encryptionKey: key,
  });
  assert.ok(res && res.success, "migration succeeds with managed key");
  assert.ok(fs.existsSync(target), ".encrypted target created");
  assert.ok(fs.existsSync(src + ".old"), "source renamed to .old");

  // 5) reopen the encrypted target with the managed-derived key → data parity
  const tdb = openRawEncrypted(target, key);
  assert.strictEqual(
    tdb.prepare("SELECT count(*) c FROM notes").get().c,
    srcCount,
    "row count preserved",
  );
  const row1 = tdb.prepare("SELECT * FROM notes WHERE id=1").get();
  assert.strictEqual(row1.title, "标题😀", "中文+emoji preserved");
  assert.strictEqual(row1.n, "00700", "TEXT number stays '00700'");
  assert.ok(
    Buffer.isBuffer(row1.blob) && row1.blob.equals(Buffer.from([0, 1, 2, 255])),
    "BLOB preserved",
  );
  assert.strictEqual(row1.maybe, null, "NULL preserved");
  tdb.close();

  // 6) the real §3 half: a different derived key must be REJECTED.
  const km2 = new KeyManager({
    encryptionEnabled: true,
    configPath: path.join(dir, "other.json"),
  });
  const { key: wrongKey } = await km2.deriveKeyFromPassword("123456", null);
  let rejected = false;
  try {
    const bad = openRawEncrypted(target, wrongKey);
    bad.prepare("SELECT count(*) FROM sqlite_master").get();
    bad.close();
  } catch (_e) {
    rejected = true;
  }
  assert.ok(rejected, "wrong key (legacy 123456-derived) must be rejected");
}

// R5 — §7 kill-switch + gate resolution under the real flag module.
async function r5_killswitch_and_gate() {
  const ENV = "CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION";
  const saved = process.env[ENV];
  try {
    // env force-on / force-off
    process.env[ENV] = "1";
    assert.strictEqual(isDbEncryptionOptIn(), true, "env=1 forces ON");
    process.env[ENV] = "0";
    assert.strictEqual(isDbEncryptionOptIn(), false, "env=0 kill-switch OFF");
    // env=0 must override even an open gate + packaged build
    assert.strictEqual(
      isDbEncryptionOptIn({ defaultOn: true, isPackaged: true }),
      false,
      "env=0 overrides open gate (emergency off still works post-flip)",
    );
    delete process.env[ENV];
    // shipped gate today: default OFF everywhere
    assert.strictEqual(
      isDbEncryptionOptIn(),
      false,
      "shipped default (PHASE_1_5_DEFAULT_ON=false) → OFF",
    );
    // post-flip behaviour: open gate → ON only in packaged
    assert.strictEqual(
      isDbEncryptionOptIn({ defaultOn: true, isPackaged: true }),
      true,
      "open gate + packaged → ON (what the flip will do)",
    );
    assert.strictEqual(
      isDbEncryptionOptIn({ defaultOn: true, isPackaged: false }),
      false,
      "open gate + dev/test → still OFF",
    );
  } finally {
    if (saved === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = saved;
    }
  }
}

async function main() {
  console.log(
    "B-layer real-safeStorage probe (electron " +
      (process.versions.electron || "?") +
      " / abi " +
      process.versions.modules +
      " / " +
      process.platform +
      ")",
  );
  console.log(
    "  safeStorage.isEncryptionAvailable() = " +
      safeStorage.isEncryptionAvailable() +
      (process.platform === "linux" &&
      typeof safeStorage.getSelectedStorageBackend === "function"
        ? " [" + safeStorage.getSelectedStorageBackend() + "]"
        : ""),
  );

  await test("R0 real OS keychain available", r0_keychain_available);
  await test(
    "R1 first-run mint + persist via real safeStorage",
    r1_mint_persist,
  );
  await test(
    "R2 db-secret.enc is real ciphertext (no plaintext echo)",
    r2_real_ciphertext,
  );
  await test(
    "R3 reuse-across-runs decrypts same managed passphrase",
    r3_reuse_across_runs,
  );
  await test(
    "R4 keychain key drives real plaintext->encrypted migration (data parity + wrong-key rejected)",
    r4_managed_key_drives_real_migration,
  );
  await test("R5 kill-switch + gate resolution", r5_killswitch_and_gate);

  console.log(`\n${pass} passed, ${failCount} failed`);
  if (failCount > 0) {
    for (const [name, e] of failures) {
      console.log(`\nFAILED: ${name}\n${e.stack || e.message}`);
    }
  }
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(main)
  .then(() => {
    app.exit(failCount > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error("PROBE CRASH:", e && (e.stack || e.message));
    app.exit(2);
  });
