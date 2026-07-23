"use strict";

import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const {
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  _internal,
} = require("../../lib/adapters/messaging-whatsapp/backup-decryptor");
const {
  WhatsAppAdapter,
} = require("../../lib/adapters/messaging-whatsapp");

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-wa-crypt-test-"));
  tempDirs.push(dir);
  return dir;
}

function varint(value) {
  let n = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n > 0n);
  return Buffer.from(bytes);
}

function bytesField(fieldNumber, value) {
  return Buffer.concat([
    varint((fieldNumber << 3) | 2),
    varint(value.length),
    value,
  ]);
}

function varintField(fieldNumber, value) {
  return Buffer.concat([varint(fieldNumber << 3), varint(value)]);
}

function makeHeader(format, iv, hasFeatureTable = true) {
  const cipher =
    format === "crypt15"
      ? bytesField(1, iv)
      : Buffer.concat([
          bytesField(1, Buffer.from([0x00, 0x01])),
          bytesField(2, Buffer.from([0x03])),
          bytesField(5, iv),
        ]);
  const top = Buffer.concat([
    varintField(1, format === "crypt15" ? 1 : 0),
    bytesField(format === "crypt15" ? 3 : 2, cipher),
  ]);
  return Buffer.concat([
    Buffer.from([top.length]),
    hasFeatureTable ? Buffer.from([0x01]) : Buffer.alloc(0),
    top,
  ]);
}

function makeCrypt14Key(aesKey = crypto.randomBytes(32)) {
  const googleIdSalt = crypto.randomBytes(16);
  return Buffer.concat([
    Buffer.from([0x00, 0x01, 0x03]),
    crypto.randomBytes(32),
    googleIdSalt,
    crypto.createHash("sha256").update(googleIdSalt).digest(),
    Buffer.alloc(16),
    aesKey,
  ]);
}

function javaSerializeByteArray(payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([
    Buffer.from([0xac, 0xed, 0x00, 0x05, 0x75, 0x72, 0x00, 0x02, 0x5b, 0x42]),
    Buffer.from("fixture-java-byte-array", "ascii"),
    length,
    payload,
  ]);
}

function sqliteFixture() {
  const page = Buffer.alloc(4096);
  Buffer.from("SQLite format 3\0", "ascii").copy(page);
  crypto.randomBytes(128).copy(page, 128);
  return page;
}

function writeEncryptedFixture({
  dir,
  format,
  key,
  hasFeatureTable = true,
  hasChecksum = true,
}) {
  const iv = crypto.randomBytes(16);
  const header = makeHeader(format, iv, hasFeatureTable);
  const plaintext = sqliteFixture();
  const compressed = zlib.deflateSync(plaintext);
  const aesKey =
    format === "crypt15"
      ? _internal.deriveCrypt15AesKey(key)
      : _internal.crypt14AesKey(key);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv, {
    authTagLength: 16,
  });
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([header, encrypted, tag]);
  const bytes = hasChecksum
    ? Buffer.concat([body, crypto.createHash("md5").update(body).digest()])
    : body;
  const inputPath = path.join(dir, `msgstore.db.${format}`);
  fs.writeFileSync(inputPath, bytes);
  return { inputPath, plaintext };
}

describe("WhatsApp crypt14/crypt15 backup decryption", () => {
  it("stream-decrypts crypt14 with a Java-serialized key and verifies MD5", async () => {
    const dir = tempDir();
    const rawKey = makeCrypt14Key();
    const { inputPath, plaintext } = writeEncryptedFixture({
      dir,
      format: "crypt14",
      key: rawKey,
    });
    const outputPath = path.join(dir, "decrypted.db");

    expect(inspectWhatsAppBackupFile(inputPath)).toMatchObject({
      format: "crypt14",
      hasFeatureTable: true,
    });
    const result = await decryptWhatsAppBackupToFile({
      inputPath,
      outputPath,
      keyProvider: { getKey: async () => javaSerializeByteArray(rawKey) },
    });

    expect(result).toMatchObject({ ok: true, format: "crypt14", hasChecksum: true });
    expect(fs.readFileSync(outputPath)).toEqual(plaintext);
  });

  it("stream-decrypts checksum-less crypt15 with a user-visible hex root key", async () => {
    const dir = tempDir();
    const rootKey = crypto.randomBytes(32);
    const { inputPath, plaintext } = writeEncryptedFixture({
      dir,
      format: "crypt15",
      key: rootKey,
      hasFeatureTable: false,
      hasChecksum: false,
    });
    const outputPath = path.join(dir, "decrypted.db");

    expect(inspectWhatsAppBackupFile(inputPath)).toMatchObject({
      format: "crypt15",
      hasFeatureTable: false,
    });
    const result = await decryptWhatsAppBackupToFile({
      inputPath,
      outputPath,
      keyProvider: rootKey.toString("hex"),
    });

    expect(result.hasChecksum).toBe(false);
    expect(fs.readFileSync(outputPath)).toEqual(plaintext);
  });

  it("rejects a wrong key and removes the partial plaintext output", async () => {
    const dir = tempDir();
    const rootKey = crypto.randomBytes(32);
    const { inputPath } = writeEncryptedFixture({
      dir,
      format: "crypt15",
      key: rootKey,
    });
    const outputPath = path.join(dir, "decrypted.db");

    await expect(
      decryptWhatsAppBackupToFile({
        inputPath,
        outputPath,
        keyProvider: crypto.randomBytes(32),
      }),
    ).rejects.toMatchObject({ code: "WHATSAPP_BACKUP_DECRYPT_FAILED" });
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("feeds a crypt15 backup into the adapter and deletes its temporary DB", async () => {
    const dir = tempDir();
    const rootKey = crypto.randomBytes(32);
    const { inputPath } = writeEncryptedFixture({
      dir,
      format: "crypt15",
      key: rootKey,
    });
    const opened = [];
    const Driver = class FakeDb {
      constructor(dbPath) {
        opened.push(dbPath);
        expect(fs.readFileSync(dbPath, { encoding: null }).subarray(0, 16)).toEqual(
          Buffer.from("SQLite format 3\0", "ascii"),
        );
      }
      prepare() {
        return { all: () => [] };
      }
      close() {}
    };
    const adapter = new WhatsAppAdapter({
      inputPath,
      keyProvider: javaSerializeByteArray(rootKey),
      dbDriverFactory: () => Driver,
    });

    expect(await adapter.authenticate()).toMatchObject({ ok: true, mode: "crypt15" });
    const rows = [];
    for await (const row of adapter.sync()) rows.push(row);
    expect(rows).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(fs.existsSync(opened[0])).toBe(false);
  });

  it("deletes the temporary DB when the SQLite driver cannot open it", async () => {
    const dir = tempDir();
    const rootKey = crypto.randomBytes(32);
    const { inputPath } = writeEncryptedFixture({
      dir,
      format: "crypt15",
      key: rootKey,
    });
    let openedPath;
    const Driver = class BrokenDb {
      constructor(dbPath) {
        openedPath = dbPath;
        throw new Error("driver could not open database");
      }
    };
    const adapter = new WhatsAppAdapter({
      inputPath,
      keyProvider: rootKey,
      dbDriverFactory: () => Driver,
    });

    await expect((async () => {
      for await (const _row of adapter.sync()) {
        // The driver fails before any row can be emitted.
      }
    })()).rejects.toThrow("driver could not open database");
    expect(openedPath).toBeTruthy();
    expect(fs.existsSync(openedPath)).toBe(false);
  });

  it("pulls through the ADB bridge, decrypts, and removes both temporary directories", async () => {
    const sourceDir = tempDir();
    const rootKey = crypto.randomBytes(32);
    const { inputPath } = writeEncryptedFixture({
      dir: sourceDir,
      format: "crypt15",
      key: rootKey,
    });
    const calls = [];
    const bridge = {
      invoke: async (method, params) => {
        calls.push({ method, params });
        return {
          localPath: inputPath,
          tempDir: sourceDir,
          format: "crypt15",
          cleanup: () => fs.rmSync(sourceDir, { recursive: true, force: true }),
        };
      },
    };
    const opened = [];
    const Driver = class FakeDb {
      constructor(dbPath) {
        opened.push(dbPath);
      }
      prepare() {
        return { all: () => [] };
      }
      close() {}
    };
    const adapter = new WhatsAppAdapter({
      bridgeProvider: () => bridge,
      dbDriverFactory: () => Driver,
    });

    const rows = [];
    for await (const row of adapter.sync({ key: rootKey, serial: "PHONE-1" })) rows.push(row);
    expect(rows).toEqual([]);
    expect(calls).toEqual([{ method: "whatsapp.backup", params: {
      serial: "PHONE-1",
      business: false,
      remotePath: undefined,
      timeoutMs: undefined,
    } }]);
    expect(opened).toHaveLength(1);
    expect(fs.existsSync(opened[0])).toBe(false);
    expect(fs.existsSync(sourceDir)).toBe(false);
  });
});
