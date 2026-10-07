/** Verify compressed npm artifact integrity and installed content without
 * extraction, package execution, lifecycle scripts or native addon loading.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const MAX_COMPRESSED = 32 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const MAX_ENTRIES = 20000;
const digest = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Registry content verification: ${message}`);
};
function utf8(bytes) {
  const value = bytes.toString("utf8");
  requireCondition(Buffer.from(value, "utf8").equals(bytes), "invalid UTF-8 archive metadata");
  return value;
}
function field(header, start, size) {
  const bytes = header.subarray(start, start + size);
  const end = bytes.indexOf(0);
  return utf8(end < 0 ? bytes : bytes.subarray(0, end));
}
function octal(header, start, size) {
  const value = field(header, start, size).trim();
  requireCondition(/^[0-7]+$/u.test(value), "invalid tar numeric field");
  const parsed = Number.parseInt(value, 8);
  requireCondition(Number.isSafeInteger(parsed) && parsed >= 0, "tar number exceeds bound");
  return parsed;
}
function relative(name) {
  requireCondition(typeof name === "string" && name.length <= 4096 &&
    !/[\\:*?<>|"\u0000]/u.test(name) &&
    name.split("/").every((part) => part && part !== "." && part !== ".." &&
      !/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part)),
    "unsafe package path");
  return name;
}
function pax(bytes) {
  requireCondition(bytes.length <= 64 * 1024, "PAX metadata exceeds bound");
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    requireCondition(space > offset && space - offset < 10, "invalid PAX record length");
    const lengthText = utf8(bytes.subarray(offset, space));
    requireCondition(/^[1-9][0-9]*$/u.test(lengthText), "invalid PAX record length");
    const length = Number(lengthText), end = offset + length;
    requireCondition(end <= bytes.length && end > space + 2 && bytes[end - 1] === 10, "truncated PAX record");
    const body = utf8(bytes.subarray(space + 1, end - 1)), equals = body.indexOf("=");
    requireCondition(equals > 0, "invalid PAX field");
    const key = body.slice(0, equals), value = body.slice(equals + 1);
    requireCondition(["path", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname"].includes(key) &&
      !Object.hasOwn(values, key), "unsupported or duplicated PAX field");
    values[key] = value;
    offset = end;
  }
  return values;
}

/** installedFiles are snapshot descriptors relative to one installed package.
 * The caller binds the integrity to the frozen package-lock Git blob, rather
 * than trusting tarball metadata or a self-declared checksum.
 */
export function verifyRegistryPackageContent({ tarball, integrity, installedFiles, packageName, packageVersion } = {}) {
  requireCondition(Buffer.isBuffer(tarball) && tarball.length > 0 && tarball.length <= MAX_COMPRESSED,
    "compressed artifact exceeds bound or is missing");
  requireCondition(typeof integrity === "string" && /^sha512-[A-Za-z0-9+/]{86}==$/u.test(integrity),
    "canonical locked sha512 integrity required");
  const locked = integrity.slice(7);
  requireCondition(Buffer.from(locked, "base64").toString("base64") === locked &&
    createHash("sha512").update(tarball).digest("base64") === locked, "tarball integrity differs from frozen lock");
  requireCondition(Array.isArray(installedFiles) && installedFiles.length > 0 && installedFiles.length <= MAX_ENTRIES,
    "installed file snapshot required");
  const installed = new Map(), installedNames = new Set();
  for (const entry of installedFiles) {
    relative(entry.path);
    requireCondition(!installedNames.has(entry.path.toLowerCase()) &&
      /^sha256:[a-f0-9]{64}$/u.test(entry.digest ?? "") && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0,
      "installed snapshot duplicates a path or lacks byte binding");
    installedNames.add(entry.path.toLowerCase());
    installed.set(entry.path, entry);
  }
  let expanded;
  try { expanded = gunzipSync(tarball, { maxOutputLength: MAX_EXPANDED }); }
  catch (cause) { throw new Error("Registry content verification: invalid or oversized gzip artifact", { cause }); }
  const files = [], names = new Set();
  let offset = 0, entries = 0, pending = null, ended = false;
  while (offset + 512 <= expanded.length) {
    const header = expanded.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      requireCondition(pending === null && expanded.length - offset >= 1024 &&
        expanded.subarray(offset).every((byte) => byte === 0), "tar end markers or trailing bytes invalid");
      ended = true;
      break;
    }
    requireCondition(++entries <= MAX_ENTRIES, "archive entry count exceeds bound");
    const expectedChecksum = octal(header, 148, 8);
    const actualChecksum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    requireCondition(expectedChecksum === actualChecksum, "tar header checksum differs");
    requireCondition(field(header, 257, 6).startsWith("ustar"), "unsupported tar format");
    const size = octal(header, 124, 12), type = header[156], start = offset + 512;
    const end = start + size, next = start + Math.ceil(size / 512) * 512;
    requireCondition(size <= MAX_EXPANDED && end <= expanded.length && next <= expanded.length,
      "truncated or oversized tar entry");
    const content = expanded.subarray(start, end);
    if (type === 120) {
      requireCondition(pending === null, "stacked PAX headers forbidden");
      pending = pax(content);
      offset = next;
      continue;
    }
    requireCondition(type === 0 || type === 48 || type === 53,
      "archive links, special files and unsupported extensions forbidden");
    const prefix = field(header, 345, 155);
    let name = pending?.path ?? ((prefix ? `${prefix}/` : "") + field(header, 0, 100));
    pending = null;
    if (type === 53 && name.endsWith("/")) name = name.slice(0, -1);
    requireCondition(name === "package" || name.startsWith("package/"), "archive entry is outside package root");
    relative(name);
    requireCondition(!names.has(name.toLowerCase()), "duplicate or case-alias archive entry");
    names.add(name.toLowerCase());
    if (type === 53) requireCondition(size === 0, "directory entry has content");
    else {
      requireCondition(name !== "package", "package root is not a directory");
      const file = { path: name.slice(8), bytes: size, digest: digest(content) };
      const counterpart = installed.get(file.path);
      requireCondition(counterpart && counterpart.bytes === file.bytes && counterpart.digest === file.digest,
        "installed file is missing or differs from registry artifact");
      if (file.path === "package.json") {
        const metadata = JSON.parse(utf8(content));
        requireCondition(metadata.name === packageName && metadata.version === packageVersion,
          "registry package identity differs from frozen lock");
      }
      files.push(file);
    }
    offset = next;
  }
  requireCondition(ended && files.length === installed.size && files.some((file) => file.path === "package.json"),
    "archive is incomplete or installed tree has additional files");
  return { artifactDigest: digest(tarball), integrity, registryContentVerified: true,
    fileCount: files.length, contentBytes: files.reduce((total, file) => total + file.bytes, 0) };
}
