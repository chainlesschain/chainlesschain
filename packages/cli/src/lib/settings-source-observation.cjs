"use strict";

/**
 * Read-only settings observations for a future persistent authority protocol.
 * Only Node builtins: CJS readers must not materialize a require(ESM) bridge.
 *
 * These checks detect ordinary replacement and in-place edits. Path-based Node
 * APIs do not prevent an adversarial parent swap-and-restore between checks.
 * No observation is a generation, registration, or permission grant.
 */
const fsDefault = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");

const MAX_SETTINGS_SOURCE_BYTES = 1024 * 1024;
const MAX_SETTINGS_SOURCES = 64;
const FILE_FIELDS = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];

function failure(code, cause = null) {
  const error = new Error(
    "Settings source observation is unavailable",
    cause ? { cause } : undefined,
  );
  error.name = "SettingsSourceObservationError";
  error.code = code;
  return error;
}

function sameFields(left, right, fields) {
  return fields.every(
    (field) =>
      left[field] !== undefined &&
      right[field] !== undefined &&
      left[field] === right[field],
  );
}

function pathIdentity(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function lstatOrMissing(fs, file) {
  try {
    return fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    if (cause?.code === "ENOTDIR")
      throw failure("CC_SETTINGS_SOURCE_UNSAFE", cause);
    throw cause;
  }
}

function assertRegularFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    throw failure("CC_SETTINGS_SOURCE_UNSAFE");
  }
}

function freezeJson(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
}

function inspect(file, fs, maxBytes) {
  const logicalPath = path.resolve(file);
  const entry = lstatOrMissing(fs, logicalPath);
  if (entry) assertRegularFile(entry);

  // Preserve absent candidates too, including a missing .claude directory.
  let logicalParent = path.dirname(logicalPath);
  const remaining = [path.basename(logicalPath)];
  while (!lstatOrMissing(fs, logicalParent)) {
    const next = path.dirname(logicalParent);
    if (next === logicalParent) throw failure("CC_SETTINGS_SOURCE_UNAVAILABLE");
    remaining.unshift(path.basename(logicalParent));
    logicalParent = next;
  }
  const canonicalParent = fs.realpathSync(logicalParent);
  const physicalPath = path.join(canonicalParent, ...remaining);
  const flags =
    (fs.constants?.O_RDONLY ?? fsDefault.constants.O_RDONLY) |
    (fs.constants?.O_NOFOLLOW ?? fsDefault.constants.O_NOFOLLOW ?? 0) |
    (fs.constants?.O_NONBLOCK ?? fsDefault.constants.O_NONBLOCK ?? 0);
  const descriptors = [];
  function open(filePath) {
    const fd = fs.openSync(filePath, flags);
    descriptors.push(fd);
    return fd;
  }
  function verifyParent(original) {
    if (
      pathIdentity(fs.realpathSync(logicalParent)) !==
      pathIdentity(canonicalParent)
    ) {
      throw failure("CC_SETTINGS_SOURCE_CHANGED");
    }
    const current = fs.fstatSync(open(canonicalParent), { bigint: true });
    if (
      !current.isDirectory() ||
      !sameFields(original, current, ["dev", "ino", "mode"])
    ) {
      throw failure("CC_SETTINGS_SOURCE_CHANGED");
    }
  }

  function readOpenedSource() {
    // Comparing opened handles avoids Node 22.12 Windows path-stat's projected
    // zero device; both identities come from the same API and real volume.
    const parent = fs.fstatSync(open(canonicalParent), { bigint: true });
    if (!parent.isDirectory()) throw failure("CC_SETTINGS_SOURCE_UNSAFE");
    const common = {
      logicalPath,
      physicalPath,
      nearestExistingParent: canonicalParent,
      remainingPath: path.join(...remaining),
      parentIdentity: Object.freeze({
        dev: String(parent.dev),
        ino: String(parent.ino),
      }),
    };
    if (!entry) {
      if (lstatOrMissing(fs, logicalPath))
        throw failure("CC_SETTINGS_SOURCE_CHANGED");
      verifyParent(parent);
      if (lstatOrMissing(fs, path.join(logicalParent, remaining[0])))
        throw failure("CC_SETTINGS_SOURCE_CHANGED");
      if (lstatOrMissing(fs, physicalPath))
        throw failure("CC_SETTINGS_SOURCE_CHANGED");
      return Object.freeze({
        ...common,
        exists: false,
        byteLength: 0,
        digest: null,
        settings: null,
      });
    }

    const fd = open(physicalPath);
    const before = fs.fstatSync(fd, { bigint: true });
    assertRegularFile(before);
    if (before.size > BigInt(maxBytes))
      throw failure("CC_SETTINGS_SOURCE_TOO_LARGE");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    for (;;) {
      const count = fs.readSync(
        fd,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!count) break;
      length += count;
      if (length > maxBytes) throw failure("CC_SETTINGS_SOURCE_TOO_LARGE");
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      !sameFields(before, after, FILE_FIELDS) ||
      BigInt(length) !== after.size
    ) {
      throw failure("CC_SETTINGS_SOURCE_CHANGED");
    }
    const finalEntry = lstatOrMissing(fs, logicalPath);
    if (!finalEntry) throw failure("CC_SETTINGS_SOURCE_CHANGED");
    assertRegularFile(finalEntry);
    const reopened = fs.fstatSync(open(physicalPath), { bigint: true });
    if (!sameFields(before, reopened, FILE_FIELDS))
      throw failure("CC_SETTINGS_SOURCE_CHANGED");
    verifyParent(parent);
    const bytes = buffer.subarray(0, length);
    let settings;
    try {
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      settings = JSON.parse(text);
      if (!settings || typeof settings !== "object" || Array.isArray(settings))
        throw new TypeError("Settings must be an object");
    } catch (cause) {
      throw failure("CC_SETTINGS_SOURCE_INVALID", cause);
    }
    return Object.freeze({
      ...common,
      exists: true,
      byteLength: length,
      digest: createHash("sha256").update(bytes).digest("hex"),
      settings: freezeJson(settings),
    });
  }
  let result;
  let bodyError = null;
  let bodyThrew = false;
  let closeError = null;
  try {
    result = readOpenedSource();
  } catch (cause) {
    bodyThrew = true;
    bodyError = cause;
  } finally {
    for (const fd of descriptors.reverse()) {
      try {
        fs.closeSync(fd);
      } catch (cause) {
        closeError ??= cause;
      }
    }
  }
  if (bodyThrew) throw bodyError;
  if (closeError) throw closeError;
  return result;
}

function observeSettingsSource(
  file,
  { fs = fsDefault, maxBytes = MAX_SETTINGS_SOURCE_BYTES } = {},
) {
  if (typeof file !== "string" || !file || file.includes("\0"))
    throw new TypeError("A settings source path is required");
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_SETTINGS_SOURCE_BYTES
  )
    throw new TypeError("Settings source byte limit is invalid");
  try {
    return inspect(file, fs, maxBytes);
  } catch (cause) {
    if (cause?.name === "SettingsSourceObservationError") throw cause;
    throw failure("CC_SETTINGS_SOURCE_UNAVAILABLE", cause);
  }
}

function observeSettingsSources(files, options = {}) {
  if (!Array.isArray(files) || files.length > MAX_SETTINGS_SOURCES)
    throw new TypeError("Settings source list must be bounded");
  // Resolve every input before the first filesystem operation; later chdir
  // cannot change where a remaining relative candidate is inspected.
  const resolved = files.map((file) => {
    if (typeof file !== "string" || !file || file.includes("\0"))
      throw new TypeError("A settings source path is required");
    return path.resolve(file);
  });
  return Object.freeze(
    resolved.map((file) => observeSettingsSource(file, options)),
  );
}

module.exports = {
  MAX_SETTINGS_SOURCE_BYTES,
  MAX_SETTINGS_SOURCES,
  observeSettingsSource,
  observeSettingsSources,
};
