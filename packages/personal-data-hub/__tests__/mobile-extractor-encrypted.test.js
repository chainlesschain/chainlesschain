"use strict";

import { describe, it, expect, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  parseKeybag,
  deriveBackupKey,
  aesUnwrap,
  aesWrap,
  unwrapClassKeys,
  unwrapEncryptionKey,
  decryptCBC,
  encryptCBC,
} = require("../lib/mobile-extractor/ios-backup-crypto");
const { parseBplist, unwrapNSKeyedArchiver, UID } = require("../lib/mobile-extractor/bplist");
const { iOSBackupReader } = require("../lib/mobile-extractor");

// ─── test helpers: keybag TLV + bplist00 encoder ─────────────────────────

function tlv(tag, value) {
  const header = Buffer.alloc(8);
  header.write(tag, 0, "ascii");
  header.writeUInt32BE(value.length, 4);
  return Buffer.concat([header, value]);
}

function beInt(n, len) {
  const b = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) { b[i] = n & 0xff; n = Math.floor(n / 256); }
  return b;
}

// Minimal bplist00 encoder — mirrors the subset our parser reads. UID
// instances encode as UID objects; Buffers as <data>; strings/ints/bools/
// arrays/dicts as expected. No dedup needed for fixtures.
function buildBplist(root) {
  const objects = [];
  const objIndex = new Map();   // identity for collections/buffers/UID
  const primIndex = new Map();  // value-key for primitives

  function assign(node) {
    if (node === null || typeof node === "boolean" || typeof node === "number" || typeof node === "string") {
      const k = `${typeof node}:${String(node)}`;
      if (primIndex.has(k)) return primIndex.get(k);
      const i = objects.length; objects.push(node); primIndex.set(k, i); return i;
    }
    if (objIndex.has(node)) return objIndex.get(node);
    const i = objects.length; objects.push(node); objIndex.set(node, i);
    if (Array.isArray(node)) { node.forEach(assign); }
    else if (node instanceof UID || Buffer.isBuffer(node)) { /* leaf */ }
    else if (typeof node === "object") { for (const [k, v] of Object.entries(node)) { assign(k); assign(v); } }
    return i;
  }
  assign(root);

  const refSize = objects.length < 256 ? 1 : 2;
  const encoded = [];
  for (const node of objects) encoded.push(encodeObj(node, refSize, assign));

  const header = Buffer.from("bplist00", "ascii");
  const body = Buffer.concat([header, ...encoded]);
  const offsets = [];
  let acc = header.length;
  for (const e of encoded) { offsets.push(acc); acc += e.length; }

  const offsetSize = body.length < 256 ? 1 : 2;
  const offsetTable = Buffer.concat(offsets.map((o) => beInt(o, offsetSize)));
  const offsetTableOffset = body.length;

  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(offsetSize, 6);
  trailer.writeUInt8(refSize, 7);
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(0), 16); // top object is index 0 (root)
  trailer.writeBigUInt64BE(BigInt(offsetTableOffset), 24);

  return Buffer.concat([body, offsetTable, trailer]);
}

function encodeObj(node, refSize, assign) {
  if (node === null) return Buffer.from([0x00]);
  if (node === false) return Buffer.from([0x08]);
  if (node === true) return Buffer.from([0x09]);
  if (typeof node === "number" && Number.isInteger(node)) {
    if (node >= 0 && node < 256) return Buffer.from([0x10, node]);
    if (node >= 0 && node < 65536) return Buffer.concat([Buffer.from([0x11]), beInt(node, 2)]);
    return Buffer.concat([Buffer.from([0x12]), beInt(node, 4)]);
  }
  if (typeof node === "string") {
    const buf = Buffer.from(node, "ascii");
    return Buffer.concat([marker(0x50, buf.length), buf]);
  }
  if (Buffer.isBuffer(node)) {
    return Buffer.concat([marker(0x40, node.length), node]);
  }
  if (node instanceof UID) {
    return Buffer.concat([Buffer.from([0x80]), beInt(node.UID, 1)]);
  }
  if (Array.isArray(node)) {
    const refs = Buffer.concat(node.map((c) => beInt(assign(c), refSize)));
    return Buffer.concat([marker(0xa0, node.length), refs]);
  }
  // dict
  const entries = Object.entries(node);
  const keyRefs = Buffer.concat(entries.map(([k]) => beInt(assign(k), refSize)));
  const valRefs = Buffer.concat(entries.map(([, v]) => beInt(assign(v), refSize)));
  return Buffer.concat([marker(0xd0, entries.length), keyRefs, valRefs]);
}

function marker(base, count) {
  if (count < 15) return Buffer.from([base | count]);
  return Buffer.concat([Buffer.from([base | 0x0f]), Buffer.from([0x11]), beInt(count, 2)]);
}

// ─── RFC 3394 AES key wrap/unwrap — official test vectors ────────────────

describe("ios-backup-crypto — RFC 3394 AES key wrap", () => {
  const kek256 = Buffer.from("000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F", "hex");

  it("unwraps the RFC 3394 §4.5 vector (256-bit KEK, 128-bit key)", () => {
    const wrapped = Buffer.from("64E8C3F9CE0F5BA263E9777905818A2A93C8191E7D6E8AE7", "hex");
    const key = aesUnwrap(kek256, wrapped);
    expect(key.toString("hex").toUpperCase()).toBe("00112233445566778899AABBCCDDEEFF");
  });

  it("unwraps the RFC 3394 §4.6 vector (256-bit KEK, 256-bit key)", () => {
    const wrapped = Buffer.from(
      "28C9F404C4B810F4CBCCB35CFB87F8263F5786E2D80ED326CBC7F0E71A99F43BFB988B9B7A02DD21",
      "hex",
    );
    const key = aesUnwrap(kek256, wrapped);
    expect(key.toString("hex").toUpperCase()).toBe(
      "00112233445566778899AABBCCDDEEFF000102030405060708090A0B0C0D0E0F",
    );
  });

  it("wrap is the exact inverse of unwrap (matches RFC ciphertext)", () => {
    const key = Buffer.from("00112233445566778899AABBCCDDEEFF", "hex");
    const wrapped = aesWrap(kek256, key);
    expect(wrapped.toString("hex").toUpperCase()).toBe("64E8C3F9CE0F5BA263E9777905818A2A93C8191E7D6E8AE7");
    expect(aesUnwrap(kek256, wrapped).equals(key)).toBe(true);
  });

  it("rejects a wrapped key tampered with the wrong KEK (integrity check)", () => {
    const wrapped = aesWrap(kek256, Buffer.alloc(32, 7));
    const wrongKek = Buffer.alloc(32, 9);
    expect(() => aesUnwrap(wrongKek, wrapped)).toThrow(/integrity check failed/);
  });
});

// ─── keybag parse + key derivation ───────────────────────────────────────

describe("ios-backup-crypto — keybag + derivation", () => {
  function buildKeybag({ salt, iter, dpsl, dpic, classNum, wpky }) {
    const parts = [
      tlv("VERS", beInt(4, 4)),
      tlv("TYPE", beInt(1, 4)),
      tlv("UUID", crypto.randomBytes(16)), // header uuid
      tlv("HMCK", crypto.randomBytes(40)),
      tlv("WRAP", beInt(0, 4)),
      tlv("SALT", salt),
      tlv("ITER", beInt(iter, 4)),
    ];
    if (dpsl) { parts.push(tlv("DPSL", dpsl)); parts.push(tlv("DPIC", beInt(dpic, 4))); }
    // class-key block
    parts.push(tlv("UUID", crypto.randomBytes(16)));
    parts.push(tlv("CLAS", beInt(classNum, 4)));
    parts.push(tlv("WRAP", beInt(2, 4))); // WRAP_PASSCODE
    parts.push(tlv("WPKY", wpky));
    parts.push(tlv("KTYP", beInt(0, 4)));
    return Buffer.concat(parts);
  }

  it("parses header attrs + a passcode-wrapped class key", () => {
    const salt = crypto.randomBytes(20);
    const blob = buildKeybag({ salt, iter: 1000, classNum: 4, wpky: Buffer.alloc(40, 1) });
    const { attrs, classKeys } = parseKeybag(blob);
    expect(attrs.ITER).toBe(1000);
    expect(Buffer.isBuffer(attrs.SALT)).toBe(true);
    expect(attrs.SALT.equals(salt)).toBe(true);
    expect(classKeys[4]).toBeDefined();
    expect(classKeys[4].WRAP).toBe(2);
    expect(classKeys[4].WPKY.length).toBe(40);
  });

  it("single-PBKDF2 derivation + class-key unwrap round-trips", () => {
    const salt = crypto.randomBytes(20);
    const classKey = crypto.randomBytes(32);
    // derive with the SAME params the keybag advertises
    const attrsForDerive = { SALT: salt, ITER: 1000 };
    const backupKey = deriveBackupKey("hunter2", attrsForDerive);
    const wpky = aesWrap(backupKey, classKey);
    const blob = buildKeybag({ salt, iter: 1000, classNum: 4, wpky });
    const { attrs, classKeys } = parseKeybag(blob);
    unwrapClassKeys(classKeys, deriveBackupKey("hunter2", attrs));
    expect(classKeys[4].KEY.equals(classKey)).toBe(true);
  });

  it("double-PBKDF2 (iOS 10.2+ DPSL/DPIC) derivation round-trips", () => {
    const salt = crypto.randomBytes(20);
    const dpsl = crypto.randomBytes(20);
    const classKey = crypto.randomBytes(32);
    const backupKey = deriveBackupKey("pw", { SALT: salt, ITER: 1000, DPSL: dpsl, DPIC: 2000 });
    const wpky = aesWrap(backupKey, classKey);
    const blob = buildKeybag({ salt, iter: 1000, dpsl, dpic: 2000, classNum: 4, wpky });
    const { attrs, classKeys } = parseKeybag(blob);
    unwrapClassKeys(classKeys, deriveBackupKey("pw", attrs));
    expect(classKeys[4].KEY.equals(classKey)).toBe(true);
  });

  it("wrong password fails the class-key integrity check", () => {
    const salt = crypto.randomBytes(20);
    const classKey = crypto.randomBytes(32);
    const backupKey = deriveBackupKey("right", { SALT: salt, ITER: 1000 });
    const blob = buildKeybag({ salt, iter: 1000, classNum: 4, wpky: aesWrap(backupKey, classKey) });
    const { attrs, classKeys } = parseKeybag(blob);
    expect(() => unwrapClassKeys(classKeys, deriveBackupKey("wrong", attrs))).toThrow(/integrity check/);
  });
});

// ─── AES-CBC decrypt + size truncation ───────────────────────────────────

describe("ios-backup-crypto — decryptCBC", () => {
  it("round-trips and truncates to the real size", () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from("hello world — 你好，世界", "utf-8");
    const cipher = encryptCBC(key, plaintext);
    expect(cipher.length % 16).toBe(0);
    const out = decryptCBC(key, cipher, plaintext.length);
    expect(out.equals(plaintext)).toBe(true);
  });

  it("unwrapEncryptionKey reads a 4-byte LE class prefix + wrapped key", () => {
    const classKey = crypto.randomBytes(32);
    const inner = crypto.randomBytes(32);
    const classKeys = { 7: { KEY: classKey } };
    const blob = Buffer.concat([beIntLE(7, 4), aesWrap(classKey, inner)]);
    expect(unwrapEncryptionKey(classKeys, blob).equals(inner)).toBe(true);
  });
});

function beIntLE(n, len) {
  const b = Buffer.alloc(len);
  b.writeUInt32LE(n, 0);
  return b;
}

// ─── bplist parser ───────────────────────────────────────────────────────

describe("bplist parser", () => {
  it("round-trips ints, strings, data, arrays, dicts", () => {
    const data = crypto.randomBytes(20);
    const src = { name: "secret.txt", size: 12345, flags: 1, blob: data, list: [1, 2, "three"] };
    const parsed = parseBplist(buildBplist(src));
    expect(parsed.name).toBe("secret.txt");
    expect(parsed.size).toBe(12345);
    expect(parsed.flags).toBe(1);
    expect(Buffer.isBuffer(parsed.blob) && parsed.blob.equals(data)).toBe(true);
    expect(parsed.list).toEqual([1, 2, "three"]);
  });

  it("decodes UID refs and unwraps an NSKeyedArchiver MBFile", () => {
    const encKey = crypto.randomBytes(44);
    // $objects[0]=$null, [1]=MBFile dict, [2]=relativePath, [3]=protClass,
    // [4]=encKey NSData, [5]=size, [6]=class marker
    const archive = {
      $version: 100000,
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: [
        "$null",
        {
          $class: new UID(6),
          RelativePath: new UID(2),
          ProtectionClass: new UID(3),
          EncryptionKey: new UID(4),
          Size: new UID(5),
        },
        "Documents/secret.txt",
        4,
        { $class: new UID(6), "NS.data": encKey },
        9999,
        { $classname: "MBFile" },
      ],
    };
    const obj = unwrapNSKeyedArchiver(parseBplist(buildBplist(archive)));
    expect(obj.RelativePath).toBe("Documents/secret.txt");
    expect(obj.ProtectionClass).toBe(4);
    expect(obj.Size).toBe(9999);
    expect(Buffer.isBuffer(obj.EncryptionKey["NS.data"])).toBe(true);
    expect(obj.EncryptionKey["NS.data"].equals(encKey)).toBe(true);
  });
});

// ─── end-to-end: encrypted backup decryption via iOSBackupReader ─────────

describe("iOSBackupReader — encrypted backup (Phase 7.5b)", () => {
  let dir;
  afterEach(() => {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {} }
    dir = null;
  });

  function buildKeybagBlob({ salt, iter, classNum, wpky }) {
    return Buffer.concat([
      tlv("VERS", beInt(4, 4)),
      tlv("TYPE", beInt(1, 4)),
      tlv("UUID", crypto.randomBytes(16)),
      tlv("SALT", salt),
      tlv("ITER", beInt(iter, 4)),
      tlv("UUID", crypto.randomBytes(16)),
      tlv("CLAS", beInt(classNum, 4)),
      tlv("WRAP", beInt(2, 4)),
      tlv("WPKY", wpky),
      tlv("KTYP", beInt(0, 4)),
    ]);
  }

  function makeEncryptedBackup({ password = "backup-pw" } = {}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-enc-"));
    const CLASS = 4;
    const salt = crypto.randomBytes(20);
    const classKey = crypto.randomBytes(32);
    const backupKey = deriveBackupKey(password, { SALT: salt, ITER: 1000 });
    const keybag = buildKeybagBlob({ salt, iter: 1000, classNum: CLASS, wpky: aesWrap(backupKey, classKey) });

    // ManifestKey: class(4 LE) + wrap(classKey, manifestKey)
    const manifestKey = crypto.randomBytes(32);
    const manifestKeyBlob = Buffer.concat([beIntLE(CLASS, 4), aesWrap(classKey, manifestKey)]);

    // Manifest.db (encrypted)
    const manifestPlain = Buffer.from("SQLite format 3\0THIS-IS-THE-DECRYPTED-MANIFEST", "utf-8");
    fs.writeFileSync(path.join(dir, "Manifest.db"), encryptCBC(manifestKey, manifestPlain));

    fs.writeFileSync(
      path.join(dir, "Manifest.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>IsEncrypted</key><true/>
<key>BackupKeyBag</key><data>${keybag.toString("base64")}</data>
<key>ManifestKey</key><data>${manifestKeyBlob.toString("base64")}</data>
</dict></plist>`,
    );
    fs.writeFileSync(
      path.join(dir, "Info.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>Device Name</key><string>Crypto iPhone</string>
</dict></plist>`,
    );

    // One encrypted data file.
    const fileID = "ab".padEnd(40, "f");
    const filePlain = Buffer.from("Hello encrypted iOS file! — 机密文件内容", "utf-8");
    const fileKey = crypto.randomBytes(32);
    const encKeyBlob = Buffer.concat([Buffer.from([0x28, 0, 0, 0]), aesWrap(classKey, fileKey)]);
    const shard = path.join(dir, fileID.slice(0, 2));
    fs.mkdirSync(shard, { recursive: true });
    fs.writeFileSync(path.join(shard, fileID), encryptCBC(fileKey, filePlain));

    const fileBplist = buildBplist({
      $version: 100000,
      $archiver: "NSKeyedArchiver",
      $top: { root: new UID(1) },
      $objects: [
        "$null",
        {
          $class: new UID(6),
          RelativePath: new UID(2),
          ProtectionClass: new UID(3),
          EncryptionKey: new UID(4),
          Size: new UID(5),
        },
        "Documents/secret.txt",
        CLASS,
        { $class: new UID(6), "NS.data": encKeyBlob },
        filePlain.length,
        { $classname: "MBFile" },
      ],
    });

    return { password, fileID, filePlain, manifestPlain, fileBplist };
  }

  // Mock SQLite driver returning the fixture rows; also lets us read the
  // decrypted Manifest.db temp file the reader hands it.
  function mockDriver(fixture, capture) {
    return (dbPath) => {
      capture.dbPath = dbPath;
      return {
        prepare: (sql) => ({
          all: () => [{
            fileID: fixture.fileID,
            domain: "AppDomain-com.example.app",
            relativePath: "Documents/secret.txt",
            flags: 1,
          }],
          get: (id) => (id === fixture.fileID ? { file: fixture.fileBplist } : undefined),
        }),
        close: () => {},
      };
    };
  }

  it("rejects an encrypted backup with no password", async () => {
    const fx = makeEncryptedBackup();
    const reader = new iOSBackupReader({ backupDir: dir, dbDriverFn: () => { throw new Error("nope"); } });
    await expect(reader.open()).rejects.toThrow(/requires opts\.password/);
  });

  it("decrypts Manifest.db with the correct password", async () => {
    const fx = makeEncryptedBackup({ password: "s3cret" });
    const capture = {};
    const reader = new iOSBackupReader({ backupDir: dir, password: "s3cret", dbDriverFn: mockDriver(fx, capture) });
    const r = await reader.open();
    expect(r.encrypted).toBe(true);
    expect(r.info["Device Name"]).toBe("Crypto iPhone");
    // The temp file handed to the driver holds the decrypted SQLite bytes.
    // (Manifest.db isn't size-truncated — real ones are page-aligned and
    // SQLite ignores any trailing zero pad; compare the meaningful prefix.)
    const decrypted = fs.readFileSync(capture.dbPath);
    expect(decrypted.subarray(0, fx.manifestPlain.length).equals(fx.manifestPlain)).toBe(true);
    reader.close();
    // Temp file cleaned up on close.
    expect(fs.existsSync(capture.dbPath)).toBe(false);
  });

  it("fails to decrypt Manifest.db with the wrong password", async () => {
    makeEncryptedBackup({ password: "right-pw" });
    const reader = new iOSBackupReader({ backupDir: dir, password: "WRONG", dbDriverFn: () => ({ prepare: () => ({}), close: () => {} }) });
    await expect(reader.open()).rejects.toThrow(/integrity check/);
  });

  it("copyOut transparently decrypts a per-file-encrypted file", async () => {
    const fx = makeEncryptedBackup({ password: "pw" });
    const capture = {};
    const reader = new iOSBackupReader({ backupDir: dir, password: "pw", dbDriverFn: mockDriver(fx, capture) });
    await reader.open();
    const out = path.join(dir, "out", "secret.txt");
    reader.copyOut(fx.fileID, out);
    expect(fs.readFileSync(out).equals(fx.filePlain)).toBe(true);
    reader.close();
  });

  it("pullDomain decrypts every file under the domain", async () => {
    const fx = makeEncryptedBackup({ password: "pw" });
    const capture = {};
    const reader = new iOSBackupReader({ backupDir: dir, password: "pw", dbDriverFn: mockDriver(fx, capture) });
    await reader.open();
    const outDir = path.join(dir, "pulled");
    const summary = reader.pullDomain("AppDomain-com.example.app", outDir);
    expect(summary.copied).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(fs.readFileSync(path.join(outDir, "Documents/secret.txt")).equals(fx.filePlain)).toBe(true);
    reader.close();
  });
});
