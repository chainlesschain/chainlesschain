"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");
const JAVA_STREAM_MAGIC = Buffer.from([0xac, 0xed, 0x00, 0x05]);
const CRYPT14_KEY_BYTES = 131;
const RAW_KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const CHECKSUM_BYTES = 16;
const MAX_PREFIX_BYTES = 258;

class WhatsAppBackupError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "WhatsAppBackupError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new WhatsAppBackupError(code, message, cause ? { cause } : undefined);
}

function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buffer.length && shift <= 63n) {
    const byte = buffer[offset];
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  fail("WHATSAPP_BACKUP_BAD_PROTOBUF", "invalid or truncated protobuf varint in backup header");
}

function parseProtobuf(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber <= 0) {
      fail("WHATSAPP_BACKUP_BAD_PROTOBUF", "protobuf header contains an invalid field number");
    }

    let value;
    if (wireType === 0) {
      const item = readVarint(buffer, offset);
      value = item.value;
      offset = item.offset;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        fail("WHATSAPP_BACKUP_BAD_PROTOBUF", "truncated fixed64 field in backup header");
      }
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const size = Number(length.value);
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.length) {
        fail("WHATSAPP_BACKUP_BAD_PROTOBUF", "invalid length-delimited field in backup header");
      }
      value = buffer.subarray(offset, offset + size);
      offset += size;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        fail("WHATSAPP_BACKUP_BAD_PROTOBUF", "truncated fixed32 field in backup header");
      }
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      fail(
        "WHATSAPP_BACKUP_BAD_PROTOBUF",
        `unsupported protobuf wire type ${wireType} in backup header`,
      );
    }

    const values = fields.get(fieldNumber) || [];
    values.push({ wireType, value });
    fields.set(fieldNumber, values);
  }
  return fields;
}

function bytesField(fields, fieldNumber) {
  const item = (fields.get(fieldNumber) || []).find((entry) => entry.wireType === 2);
  return item ? item.value : null;
}

function inspectWhatsAppBackupPrefix(prefix) {
  if (!Buffer.isBuffer(prefix) || prefix.length < 2) {
    fail("WHATSAPP_BACKUP_BAD_HEADER", "WhatsApp backup prefix is too short");
  }

  const protobufSize = prefix[0];
  if (protobufSize === 0) {
    fail("WHATSAPP_BACKUP_BAD_HEADER", "WhatsApp backup protobuf header is empty");
  }

  let protobufStart = 1;
  let hasFeatureTable = false;
  if (prefix[protobufStart] === 0x01) {
    hasFeatureTable = true;
    protobufStart += 1;
  }
  const headerEnd = protobufStart + protobufSize;
  if (headerEnd > prefix.length) {
    fail("WHATSAPP_BACKUP_BAD_HEADER", "WhatsApp backup protobuf header is truncated");
  }

  const top = parseProtobuf(prefix.subarray(protobufStart, headerEnd));
  const c14 = bytesField(top, 2);
  const c15 = bytesField(top, 3);
  let format;
  let iv;

  if (c15) {
    format = "crypt15";
    iv = bytesField(parseProtobuf(c15), 1);
  } else if (c14) {
    format = "crypt14";
    iv = bytesField(parseProtobuf(c14), 5);
  } else {
    fail(
      "WHATSAPP_BACKUP_UNSUPPORTED_FORMAT",
      "backup header contains neither crypt14 nor crypt15 cipher metadata",
    );
  }

  if (!iv || iv.length !== 16) {
    fail("WHATSAPP_BACKUP_BAD_IV", `${format} backup header must contain a 16-byte IV`);
  }

  return {
    format,
    iv: Buffer.from(iv),
    headerEnd,
    protobufSize,
    hasFeatureTable,
  };
}

function inspectWhatsAppBackupFile(inputPath) {
  const fd = fs.openSync(inputPath, "r");
  try {
    const prefix = Buffer.alloc(MAX_PREFIX_BYTES);
    const bytesRead = fs.readSync(fd, prefix, 0, prefix.length, 0);
    return inspectWhatsAppBackupPrefix(prefix.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

function extractJavaByteArray(buffer, expectedSizes) {
  if (!buffer.subarray(0, JAVA_STREAM_MAGIC.length).equals(JAVA_STREAM_MAGIC)) return null;
  for (let offset = buffer.length - 4; offset >= JAVA_STREAM_MAGIC.length; offset -= 1) {
    const size = buffer.readUInt32BE(offset);
    if (expectedSizes.includes(size) && offset + 4 + size === buffer.length) {
      return buffer.subarray(offset + 4);
    }
  }
  return null;
}

function normalizeKeyInput(input) {
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (/^[0-9a-f]{64}$/iu.test(trimmed)) return Buffer.from(trimmed, "hex");
    if (!fs.existsSync(input)) {
      fail(
        "WHATSAPP_BACKUP_KEY_NOT_FOUND",
        "WhatsApp backup key must be a readable file path, 32-byte buffer, or 64-character hex value",
      );
    }
    const bytes = fs.readFileSync(input);
    const ascii = bytes.toString("utf8").trim();
    if (/^[0-9a-f]{64}$/iu.test(ascii)) return Buffer.from(ascii, "hex");
    return bytes;
  }
  if (input && typeof input === "object") {
    for (const key of ["key", "value", "bytes", "keyPath", "path"]) {
      if (input[key] != null) return normalizeKeyInput(input[key]);
    }
  }
  fail(
    "WHATSAPP_BACKUP_KEY_REQUIRED",
    "WhatsApp crypt14/crypt15 decryption requires the user's backup key",
  );
}

function crypt14AesKey(input) {
  const serialized = extractJavaByteArray(input, [CRYPT14_KEY_BYTES]);
  const keyArray = serialized || input;
  if (keyArray.length !== CRYPT14_KEY_BYTES) {
    fail(
      "WHATSAPP_BACKUP_BAD_CRYPT14_KEY",
      `crypt14 key payload must be ${CRYPT14_KEY_BYTES} bytes`,
    );
  }
  if (keyArray[0] !== 0x00 || keyArray[1] !== 0x01 || ![1, 2, 3].includes(keyArray[2])) {
    fail("WHATSAPP_BACKUP_BAD_CRYPT14_KEY", "crypt14 key has an unsupported cipher/key version");
  }
  const googleIdSalt = keyArray.subarray(35, 51);
  const expectedHash = crypto.createHash("sha256").update(googleIdSalt).digest();
  if (!crypto.timingSafeEqual(expectedHash, keyArray.subarray(51, 83))) {
    fail("WHATSAPP_BACKUP_BAD_CRYPT14_KEY", "crypt14 key integrity check failed");
  }
  if (!keyArray.subarray(83, 99).equals(Buffer.alloc(16))) {
    fail("WHATSAPP_BACKUP_BAD_CRYPT14_KEY", "crypt14 key IV padding is invalid");
  }
  return Buffer.from(keyArray.subarray(99, 131));
}

function deriveCrypt15AesKey(input) {
  const serialized = extractJavaByteArray(input, [RAW_KEY_BYTES]);
  const rootKey = serialized || input;
  if (rootKey.length !== RAW_KEY_BYTES) {
    fail("WHATSAPP_BACKUP_BAD_CRYPT15_KEY", "crypt15 root key must be exactly 32 bytes");
  }
  const privateKey = crypto
    .createHmac("sha256", Buffer.alloc(32))
    .update(rootKey)
    .digest();
  return crypto
    .createHmac("sha256", privateKey)
    .update(Buffer.from("backup encryption", "utf8"))
    .update(Buffer.from([0x01]))
    .digest();
}

async function resolveKeySource(keyProvider, context) {
  let value = keyProvider;
  if (typeof value === "function") {
    value = await value(context);
  } else if (value && typeof value.getKey === "function") {
    value = await value.getKey(context);
  }
  return normalizeKeyInput(value);
}

async function md5Range(inputPath, endExclusive) {
  const hash = crypto.createHash("md5");
  const stream = fs.createReadStream(inputPath, { start: 0, end: endExclusive - 1 });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest();
}

async function readRange(inputPath, start, length) {
  const handle = await fs.promises.open(inputPath, "r");
  try {
    const out = Buffer.alloc(length);
    const { bytesRead } = await handle.read(out, 0, length, start);
    if (bytesRead !== length) {
      fail("WHATSAPP_BACKUP_TRUNCATED", "WhatsApp backup footer is truncated");
    }
    return out;
  } finally {
    await handle.close();
  }
}

async function resolvePayloadLayout(inputPath, headerEnd) {
  const { size } = await fs.promises.stat(inputPath);
  if (size <= headerEnd + AUTH_TAG_BYTES) {
    fail("WHATSAPP_BACKUP_TRUNCATED", "WhatsApp backup has no encrypted payload");
  }

  if (size >= headerEnd + AUTH_TAG_BYTES + CHECKSUM_BYTES) {
    const footer = await readRange(
      inputPath,
      size - AUTH_TAG_BYTES - CHECKSUM_BYTES,
      AUTH_TAG_BYTES + CHECKSUM_BYTES,
    );
    const computed = await md5Range(inputPath, size - CHECKSUM_BYTES);
    const checksum = footer.subarray(AUTH_TAG_BYTES);
    if (crypto.timingSafeEqual(computed, checksum)) {
      return {
        ciphertextEnd: size - AUTH_TAG_BYTES - CHECKSUM_BYTES,
        authTag: Buffer.from(footer.subarray(0, AUTH_TAG_BYTES)),
        hasChecksum: true,
      };
    }
  }

  return {
    ciphertextEnd: size - AUTH_TAG_BYTES,
    authTag: await readRange(inputPath, size - AUTH_TAG_BYTES, AUTH_TAG_BYTES),
    hasChecksum: false,
  };
}

async function assertSqliteOutput(outputPath) {
  const handle = await fs.promises.open(outputPath, "r");
  try {
    const magic = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    if (bytesRead !== magic.length || !magic.equals(SQLITE_MAGIC)) {
      fail(
        "WHATSAPP_BACKUP_NOT_SQLITE",
        "decryption succeeded but the decompressed payload is not a SQLite database",
      );
    }
  } finally {
    await handle.close();
  }
}

async function decryptWhatsAppBackupToFile({ inputPath, outputPath, keyProvider }) {
  if (!inputPath || !outputPath) {
    fail("WHATSAPP_BACKUP_PATH_REQUIRED", "inputPath and outputPath are required");
  }
  const header = inspectWhatsAppBackupFile(inputPath);
  const keyInput = await resolveKeySource(keyProvider, {
    format: header.format,
    inputPath,
  });
  const aesKey =
    header.format === "crypt15"
      ? deriveCrypt15AesKey(keyInput)
      : crypt14AesKey(keyInput);
  const layout = await resolvePayloadLayout(inputPath, header.headerEnd);
  if (layout.ciphertextEnd <= header.headerEnd) {
    fail("WHATSAPP_BACKUP_TRUNCATED", "WhatsApp backup encrypted payload is empty");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, header.iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(layout.authTag);

  try {
    await pipeline(
      fs.createReadStream(inputPath, {
        start: header.headerEnd,
        end: layout.ciphertextEnd - 1,
      }),
      decipher,
      zlib.createUnzip(),
      fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
    await assertSqliteOutput(outputPath);
  } catch (error) {
    try {
      fs.rmSync(outputPath, { force: true });
    } catch (_cleanupError) {
      // Best effort: never hide the authenticated-decryption failure.
    }
    if (error instanceof WhatsAppBackupError) throw error;
    fail(
      "WHATSAPP_BACKUP_DECRYPT_FAILED",
      "WhatsApp backup authentication, decryption, or decompression failed",
      error,
    );
  }

  return {
    ok: true,
    format: header.format,
    outputPath,
    hasChecksum: layout.hasChecksum,
  };
}

function isEncryptedWhatsAppBackup(inputPath) {
  return typeof inputPath === "string" && /\.crypt(?:14|15)$/iu.test(inputPath);
}

module.exports = {
  WhatsAppBackupError,
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  inspectWhatsAppBackupPrefix,
  isEncryptedWhatsAppBackup,
  _internal: {
    crypt14AesKey,
    deriveCrypt15AesKey,
    extractJavaByteArray,
    parseProtobuf,
    resolvePayloadLayout,
  },
};
