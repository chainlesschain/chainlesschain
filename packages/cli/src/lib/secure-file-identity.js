/**
 * Cross-API filesystem identity checks for secure path reads.
 *
 * Node 22.12 ships libuv 1.49.1. On Windows hosts that expose
 * GetFileInformationByName, libuv 1.49/1.50 can project a path stat's device as
 * zero while fstat on the same opened file reports the real volume serial.
 * libuv 1.51 fixed the structure layout and device projection.
 *
 * Keep this compatibility deliberately narrow: only the affected Windows
 * libuv range may ignore the path API's projected device, the handle device
 * must match a separately opened parent/volume-root directory handle, and
 * every other identity or mutation field remains exact.
 *
 * Holding a parent descriptor does not give Node's path-based fs APIs openat
 * semantics. Callers must keep the canonical parent authority outside the
 * control of untrusted concurrent writers. The checks below detect ordinary
 * path/handle replacement, but a complete rename-away/replace/restore ABA can
 * happen between checks and is deliberately not represented as prevented.
 */

import fs from "node:fs";
import path from "node:path";

const IDENTITY_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const IDENTITY_FIELDS_EXCEPT_DEVICE = Object.freeze(
  IDENTITY_FIELDS.filter((field) => field !== "dev"),
);
const DIRECTORY_IDENTITY_FIELDS = Object.freeze(["dev", "ino", "mode"]);
const DIRECTORY_IDENTITY_FIELDS_EXCEPT_DEVICE = Object.freeze(
  DIRECTORY_IDENTITY_FIELDS.filter((field) => field !== "dev"),
);

export const SECURE_FILE_IDENTITY_ERROR = Object.freeze({
  INVALID_PARENT: "SECURE_FILE_IDENTITY_INVALID_PARENT",
  PARENT_RACE: "SECURE_FILE_IDENTITY_PARENT_RACE",
});

export class SecureFileIdentityError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "SecureFileIdentityError";
    this.code = code;
    Object.assign(this, details);
  }
}

function identityError(code, message, details = {}, cause = null) {
  return new SecureFileIdentityError(code, message, details, cause);
}

function timestampValue(stat, nanosecondsKey, millisecondsKey) {
  if (stat?.[nanosecondsKey] !== undefined && stat?.[nanosecondsKey] !== null) {
    return String(stat[nanosecondsKey]);
  }
  if (stat?.[millisecondsKey] !== undefined) {
    const value = Number(stat[millisecondsKey]);
    return Number.isFinite(value)
      ? String(Math.trunc(value * 1_000_000))
      : null;
  }
  return null;
}

function scalarValue(stat, field) {
  return stat?.[field] === undefined || stat?.[field] === null
    ? null
    : String(stat[field]);
}

/**
 * Normalize either an fs.Stats/fs.BigIntStats object or an already normalized
 * identity. Nanosecond fields are preferred so BigInt stat callers retain the
 * exact timestamps returned by the kernel.
 */
export function fileStatIdentity(stat) {
  return {
    dev: scalarValue(stat, "dev"),
    ino: scalarValue(stat, "ino"),
    mode: scalarValue(stat, "mode"),
    nlink: scalarValue(stat, "nlink"),
    size: scalarValue(stat, "size"),
    mtimeNs: timestampValue(stat, "mtimeNs", "mtimeMs"),
    ctimeNs: timestampValue(stat, "ctimeNs", "ctimeMs"),
  };
}

function hasCompleteIdentity(identity) {
  return IDENTITY_FIELDS.every((field) => identity[field] !== null);
}

function hasFields(identity, fields) {
  return fields.every((field) => identity[field] !== null);
}

function sameFields(left, right, fields) {
  return fields.every((field) => left[field] === right[field]);
}

function runtimePlatform(runtime) {
  return String(runtime?.platform || process.platform);
}

function windowsVolumeOrShareRoot(canonicalPath) {
  const normalized = path.win32.normalize(String(canonicalPath));
  const extendedUnc = /^\\\\\?\\UNC\\([^\\]+)\\([^\\]+)(?:\\|$)/iu.exec(
    normalized,
  );
  if (extendedUnc) {
    return `\\\\?\\UNC\\${extendedUnc[1]}\\${extendedUnc[2]}\\`;
  }
  return path.win32.parse(normalized).root || path.parse(normalized).root;
}

export function sameFileStatIdentity(leftStat, rightStat) {
  const left = fileStatIdentity(leftStat);
  const right = fileStatIdentity(rightStat);
  return (
    hasCompleteIdentity(left) &&
    hasCompleteIdentity(right) &&
    sameFields(left, right, IDENTITY_FIELDS)
  );
}

export function sameDirectoryStatIdentity(leftStat, rightStat) {
  const left = fileStatIdentity(leftStat);
  const right = fileStatIdentity(rightStat);
  return (
    hasFields(left, DIRECTORY_IDENTITY_FIELDS) &&
    hasFields(right, DIRECTORY_IDENTITY_FIELDS) &&
    sameFields(left, right, DIRECTORY_IDENTITY_FIELDS)
  );
}

export function isAffectedWindowsZeroDeviceStatRuntime({
  platform = process.platform,
  uvVersion = process.versions.uv,
} = {}) {
  if (platform !== "win32") return false;
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(String(uvVersion || ""));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 1 && (minor === 49 || minor === 50);
}

/**
 * Compare a path stat with an opened-handle stat (or a previously normalized
 * handle identity) while binding the file to a trusted directory device.
 */
export function samePathHandleFileIdentity(
  pathStat,
  handleStat,
  expectedDevice,
  runtime = undefined,
) {
  const pathIdentity = fileStatIdentity(pathStat);
  const handleIdentity = fileStatIdentity(handleStat);
  const trustedDevice =
    expectedDevice === undefined || expectedDevice === null
      ? null
      : String(expectedDevice);
  if (
    !hasCompleteIdentity(pathIdentity) ||
    !hasCompleteIdentity(handleIdentity) ||
    trustedDevice === null ||
    handleIdentity.dev !== trustedDevice
  ) {
    return false;
  }
  if (sameFields(pathIdentity, handleIdentity, IDENTITY_FIELDS)) return true;
  return (
    isAffectedWindowsZeroDeviceStatRuntime(runtime) &&
    pathIdentity.dev !== handleIdentity.dev &&
    handleIdentity.dev !== "0" &&
    sameFields(pathIdentity, handleIdentity, IDENTITY_FIELDS_EXCEPT_DEVICE)
  );
}

/**
 * Directory contents can legitimately change while a child is written, so a
 * parent recheck excludes content-derived metadata and the directory link
 * count, retaining only stable identity/type/permission fields.
 */
export function samePathHandleDirectoryIdentity(
  pathStat,
  handleStat,
  expectedDevice,
  runtime = undefined,
) {
  const pathIdentity = fileStatIdentity(pathStat);
  const handleIdentity = fileStatIdentity(handleStat);
  const trustedDevice =
    expectedDevice === undefined || expectedDevice === null
      ? null
      : String(expectedDevice);
  if (
    !hasFields(pathIdentity, DIRECTORY_IDENTITY_FIELDS) ||
    !hasFields(handleIdentity, DIRECTORY_IDENTITY_FIELDS) ||
    trustedDevice === null ||
    handleIdentity.dev !== trustedDevice
  ) {
    return false;
  }
  if (sameDirectoryStatIdentity(pathIdentity, handleIdentity)) {
    return true;
  }
  return (
    isAffectedWindowsZeroDeviceStatRuntime(runtime) &&
    pathIdentity.dev !== handleIdentity.dev &&
    handleIdentity.dev !== "0" &&
    sameFields(
      pathIdentity,
      handleIdentity,
      DIRECTORY_IDENTITY_FIELDS_EXCEPT_DEVICE,
    )
  );
}

function canonicalRealpath(runtimeFs, target) {
  const realpathSync = runtimeFs?.realpathSync;
  if (typeof realpathSync?.native === "function") {
    return realpathSync.native(target);
  }
  if (typeof realpathSync === "function") {
    return realpathSync.call(runtimeFs, target);
  }
  throw new TypeError("runtime fs does not provide realpathSync");
}

/**
 * Open and retain the canonical parent directory while a caller inspects and
 * opens a child. On Windows, a separately opened canonical volume/share root
 * supplies the independently trusted device used by the identity comparators.
 *
 * Security precondition: the caller must ensure that an untrusted concurrent
 * writer cannot rename the canonical parent (or one of its ancestors) during
 * the callback. Node does not expose the handle-relative open/rename primitives
 * required to make this helper an openat-style authority boundary.
 */
export function withTrustedFileParentSync(
  runtimeFs,
  filePath,
  callback,
  { runtime = undefined } = {},
) {
  if (!runtimeFs || typeof callback !== "function") {
    throw new TypeError("runtime fs and callback are required");
  }
  if (callback.constructor?.name === "AsyncFunction") {
    throw new TypeError("secure file parent callback must be synchronous");
  }
  const requested = path.resolve(filePath);
  const requestedParent = path.dirname(requested);
  let canonicalParent;
  try {
    canonicalParent = canonicalRealpath(runtimeFs, requestedParent);
  } catch (cause) {
    throw identityError(
      SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
      `Could not canonicalize secure file parent: ${requestedParent}`,
      { filePath: requested, parentPath: requestedParent },
      cause,
    );
  }

  let authorityDescriptor = null;
  let descriptor = null;
  try {
    const flags =
      Number(runtimeFs.constants?.O_RDONLY ?? fs.constants.O_RDONLY) |
      Number(runtimeFs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0);
    let trustedDevice = null;
    if (runtimePlatform(runtime) === "win32") {
      const authorityPath = windowsVolumeOrShareRoot(canonicalParent);
      if (!authorityPath) {
        throw identityError(
          SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
          `Could not identify secure file parent volume/share root: ${canonicalParent}`,
          { filePath: requested, parentPath: canonicalParent },
        );
      }
      try {
        authorityDescriptor = runtimeFs.openSync(authorityPath, flags);
        const authority = runtimeFs.fstatSync(authorityDescriptor, {
          bigint: true,
        });
        if (!authority.isDirectory() || String(authority.dev) === "0") {
          throw identityError(
            SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
            `Secure file parent volume/share root is not a stable directory: ${authorityPath}`,
            {
              filePath: requested,
              parentPath: canonicalParent,
              authorityPath,
            },
          );
        }
        trustedDevice = String(authority.dev);
      } catch (cause) {
        if (cause instanceof SecureFileIdentityError) throw cause;
        throw identityError(
          SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
          `Could not open secure file parent volume/share root: ${authorityPath}`,
          {
            filePath: requested,
            parentPath: canonicalParent,
            authorityPath,
          },
          cause,
        );
      }
    }

    let before;
    try {
      before = runtimeFs.lstatSync(canonicalParent, { bigint: true });
    } catch (cause) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
        `Could not inspect secure file parent: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
        cause,
      );
    }
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
        `Secure file parent must be a real directory: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
      );
    }
    if (trustedDevice === null) {
      trustedDevice = scalarValue(before, "dev");
    }

    descriptor = runtimeFs.openSync(canonicalParent, flags);
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isDirectory() ||
      !samePathHandleDirectoryIdentity(before, opened, trustedDevice, runtime)
    ) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
        `Secure file parent changed while opening: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
      );
    }
    let result;
    let callbackFailure = null;
    try {
      result = callback({
        canonicalPath: path.join(canonicalParent, path.basename(requested)),
        parentPath: canonicalParent,
        parentDevice: String(opened.dev),
        parentDescriptor: descriptor,
      });
      if (result && typeof result.then === "function") {
        callbackFailure = new TypeError(
          "secure file parent callback must not return a promise",
        );
      }
    } catch (cause) {
      callbackFailure = cause;
    }

    let heldAfter;
    try {
      heldAfter = runtimeFs.fstatSync(descriptor, { bigint: true });
    } catch (cause) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
        `Secure file parent handle became unavailable: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
        cause,
      );
    }
    if (
      !heldAfter.isDirectory() ||
      !sameDirectoryStatIdentity(heldAfter, opened)
    ) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
        `Secure file parent handle changed during operation: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
        callbackFailure,
      );
    }

    let after;
    try {
      after = runtimeFs.lstatSync(canonicalParent, { bigint: true });
    } catch (cause) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
        `Secure file parent became unavailable: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
        cause,
      );
    }
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !samePathHandleDirectoryIdentity(after, heldAfter, opened.dev, runtime)
    ) {
      throw identityError(
        SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
        `Secure file parent changed during operation: ${canonicalParent}`,
        { filePath: requested, parentPath: canonicalParent },
        callbackFailure,
      );
    }
    if (callbackFailure) throw callbackFailure;
    return result;
  } finally {
    try {
      if (descriptor !== null) {
        runtimeFs.closeSync(descriptor);
      }
    } finally {
      if (authorityDescriptor !== null) {
        runtimeFs.closeSync(authorityDescriptor);
      }
    }
  }
}
