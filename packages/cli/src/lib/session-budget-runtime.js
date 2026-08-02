/**
 * Process-local sharing and a revisioned sidecar for SessionResourceBudget.
 *
 * Callers in one CLI process can reuse the same budget object. Cooperating
 * processes detect stale writes through a file lock and revision CAS. This
 * sidecar is not a machine-wide authority or an anti-rollback mechanism.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sessionPath } from "../harness/jsonl-session-store.js";
import {
  normalizeSessionResourceBudgetSnapshot,
  SessionResourceBudget,
} from "./session-resource-budget.js";
import {
  sameFileStatIdentity,
  samePathHandleDirectoryIdentity,
  samePathHandleFileIdentity,
} from "./secure-file-identity.js";
import { withFileLock } from "./with-file-lock.js";

export const SESSION_BUDGET_SIDECAR_VERSION = 1;

const DEFAULT_REGISTRY = new Map();
const MAX_SIDECAR_BYTES = 1024 * 1024;
const MAX_IN_FLIGHT_RESOURCES = 1024;
const USAGE_UNKNOWN_SUFFIX = ".usage-unknown.json";
const BIGINT_STAT_OPTIONS = Object.freeze({ bigint: true });
const OPAQUE_AUTHORITY_ID_PATTERNS = Object.freeze({
  work: /^work-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  tool: /^tool-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  usage:
    /^usage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
});

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function runtimeError(operation, filePath, cause, code = null) {
  const detail = cause?.message || String(cause || "unknown error");
  const error = new Error(
    `Session budget ${operation} failed (${filePath}): ${detail}`,
    { cause },
  );
  error.name = "SessionBudgetPersistenceError";
  error.code = code || `ERR_SESSION_BUDGET_${operation.toUpperCase()}`;
  error.filePath = filePath;
  return error;
}

function hasTypedOpaqueAuthorityIds(inFlight) {
  return (
    inFlight.work.every(
      (entry) =>
        typeof entry?.id === "string" &&
        (OPAQUE_AUTHORITY_ID_PATTERNS.work.test(entry.id) ||
          OPAQUE_AUTHORITY_ID_PATTERNS.usage.test(entry.id)),
    ) &&
    inFlight.tools.every(
      (entry) =>
        typeof entry?.id === "string" &&
        OPAQUE_AUTHORITY_ID_PATTERNS.tool.test(entry.id),
    )
  );
}

function canonicalizeSnapshot(snapshot, filePath, operation = "snapshot") {
  if (
    !isRecord(snapshot?.inFlight) ||
    !Array.isArray(snapshot.inFlight.work) ||
    !Array.isArray(snapshot.inFlight.tools) ||
    snapshot.inFlight.work.length + snapshot.inFlight.tools.length >
      MAX_IN_FLIGHT_RESOURCES
  ) {
    throw runtimeError(
      operation,
      filePath,
      new TypeError(
        `in-flight resource count exceeds ${MAX_IN_FLIGHT_RESOURCES}`,
      ),
      "ERR_SESSION_BUDGET_IN_FLIGHT_LIMIT",
    );
  }
  if (!hasTypedOpaqueAuthorityIds(snapshot.inFlight)) {
    throw runtimeError(
      operation,
      filePath,
      new TypeError("in-flight authority ids must be typed opaque ids"),
      "ERR_SESSION_BUDGET_NON_OPAQUE_AUTHORITY",
    );
  }
  let canonical;
  try {
    canonical = normalizeSessionResourceBudgetSnapshot(snapshot);
  } catch (cause) {
    throw runtimeError(operation, filePath, cause);
  }
  if (!hasTypedOpaqueAuthorityIds(canonical.inFlight)) {
    throw runtimeError(
      operation,
      filePath,
      new TypeError("in-flight authority ids must be typed opaque ids"),
      "ERR_SESSION_BUDGET_NON_OPAQUE_AUTHORITY",
    );
  }
  return canonical;
}

function validateRecord(value, sessionId, filePath) {
  if (
    !isRecord(value) ||
    value.version !== SESSION_BUDGET_SIDECAR_VERSION ||
    value.sessionId !== sessionId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !isRecord(value.snapshot)
  ) {
    throw runtimeError(
      "corrupt",
      filePath,
      new TypeError("invalid sidecar envelope"),
    );
  }
  const snapshot = canonicalizeSnapshot(value.snapshot, filePath, "corrupt");
  const writerPid = Number(value.writer?.pid);
  return {
    version: SESSION_BUDGET_SIDECAR_VERSION,
    sessionId,
    revision: value.revision,
    storedAt: typeof value.storedAt === "string" ? value.storedAt : null,
    writer:
      Number.isSafeInteger(writerPid) && writerPid > 0
        ? { pid: writerPid }
        : null,
    snapshot,
  };
}

function usageSettlementEntries(snapshot) {
  return snapshot.inFlight.work.filter(
    (entry) => entry.kind === "usage-settlement",
  );
}

function usageUnknownMarkerIdentity(record) {
  if (!record) return null;
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: record.version,
        sessionId: record.sessionId,
        revision: record.revision,
        storedAt: record.storedAt,
        writer: record.writer,
        snapshot: record.snapshot,
      }),
    )
    .digest("hex");
  return { revision: record.revision, digest };
}

function normalizeUsageUnknownMarkerIdentity(value, filePath) {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    throw runtimeError(
      "marker",
      filePath,
      new TypeError("invalid usage-unknown marker identity"),
      "ERR_SESSION_BUDGET_MARKER_IDENTITY",
    );
  }
  return { revision: value.revision, digest: value.digest };
}

function sameUsageUnknownMarkerIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.revision === right.revision &&
    left.digest === right.digest,
  );
}

function mergeUsageUnknownSnapshot(baseSnapshot, markerSnapshot, filePath) {
  const base = canonicalizeSnapshot(baseSnapshot, filePath, "corrupt");
  const marker = canonicalizeSnapshot(markerSnapshot, filePath, "corrupt");
  const markerEntries = usageSettlementEntries(marker);
  if (markerEntries.length === 0) {
    throw runtimeError(
      "corrupt",
      filePath,
      new TypeError("usage-unknown marker has no pending settlement"),
    );
  }
  const work = new Map(base.inFlight.work.map((entry) => [entry.id, entry]));
  for (const entry of markerEntries) {
    const existing = work.get(entry.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw runtimeError(
        "corrupt",
        filePath,
        new TypeError("conflicting usage-unknown settlement identity"),
      );
    }
    work.set(entry.id, { ...entry });
    if (work.size + base.inFlight.tools.length > MAX_IN_FLIGHT_RESOURCES) {
      throw runtimeError(
        "corrupt",
        filePath,
        new TypeError(
          `in-flight resource count exceeds ${MAX_IN_FLIGHT_RESOURCES}`,
        ),
        "ERR_SESSION_BUDGET_IN_FLIGHT_LIMIT",
      );
    }
  }
  return canonicalizeSnapshot(
    {
      ...base,
      inFlight: {
        work: [...work.values()],
        tools: base.inFlight.tools,
      },
    },
    filePath,
    "corrupt",
  );
}

function hasPreciseIdentity(stat) {
  if (!stat) return false;
  if (typeof stat.dev === "bigint" && typeof stat.ino === "bigint") {
    return stat.dev >= 0n && stat.ino > 0n;
  }
  return (
    Number.isSafeInteger(stat.dev) &&
    stat.dev >= 0 &&
    Number.isSafeInteger(stat.ino) &&
    stat.ino > 0
  );
}

function sameIdentity(left, right) {
  return Boolean(
    hasPreciseIdentity(left) &&
    hasPreciseIdentity(right) &&
    typeof left.dev === typeof right.dev &&
    typeof left.ino === typeof right.ino &&
    left.dev === right.dev &&
    left.ino === right.ino,
  );
}

function sameOpenedIdentity(left, right) {
  return Boolean(
    hasPreciseIdentity(left) &&
    hasPreciseIdentity(right) &&
    sameFileStatIdentity(left, right),
  );
}

function samePathHandleIdentity(pathStat, handleStat, expectedDevice, runtime) {
  return Boolean(
    hasPreciseIdentity(pathStat) &&
    hasPreciseIdentity(handleStat) &&
    samePathHandleFileIdentity(pathStat, handleStat, expectedDevice, runtime),
  );
}

function samePathHandleParentIdentity(
  pathStat,
  handleStat,
  expectedDevice,
  runtime,
) {
  return Boolean(
    hasPreciseIdentity(pathStat) &&
    hasPreciseIdentity(handleStat) &&
    samePathHandleDirectoryIdentity(
      pathStat,
      handleStat,
      expectedDevice,
      runtime,
    ),
  );
}

function lstatIdentity(fileSystem, target) {
  return fileSystem.lstatSync(target, BIGINT_STAT_OPTIONS);
}

function statIdentity(fileSystem, target) {
  return fileSystem.statSync(target, BIGINT_STAT_OPTIONS);
}

function fstatIdentity(fileSystem, descriptor) {
  return fileSystem.fstatSync(descriptor, BIGINT_STAT_OPTIONS);
}

function statSizeExceedsLimit(stat, limit) {
  if (typeof stat?.size === "bigint") {
    return stat.size < 0n || stat.size > BigInt(limit);
  }
  return (
    !Number.isSafeInteger(stat?.size) || stat.size < 0 || stat.size > limit
  );
}

function ensurePrivateOwnership(filePath, stat, kind) {
  const predicate = kind === "directory" ? stat.isDirectory : stat.isFile;
  if (
    typeof predicate !== "function" ||
    !predicate.call(stat) ||
    stat.isSymbolicLink?.()
  ) {
    throw runtimeError(
      "read",
      filePath,
      new Error(`${kind} must be a regular non-symlink ${kind}`),
    );
  }
  const insecureMode =
    typeof stat.mode === "bigint"
      ? (stat.mode & 0o077n) !== 0n
      : !Number.isSafeInteger(stat.mode) || (stat.mode & 0o077) !== 0;
  if (process.platform !== "win32" && insecureMode) {
    throw runtimeError(
      "read",
      filePath,
      new Error(`${kind} permissions must not grant group/other access`),
    );
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    (typeof stat.uid === "bigint"
      ? stat.uid !== BigInt(process.getuid())
      : !Number.isSafeInteger(stat.uid) || stat.uid !== process.getuid())
  ) {
    throw runtimeError("read", filePath, new Error(`${kind} owner mismatch`));
  }
}

function openVerifiedParent(
  filePath,
  fileSystem,
  {
    platform = process.platform,
    uvVersion = process.versions.uv,
    allowUnsupportedPlatformForTests = false,
  } = {},
) {
  const directory = path.dirname(filePath);
  const runtime = { platform, uvVersion };
  let before;
  try {
    before = lstatIdentity(fileSystem, directory);
    ensurePrivateOwnership(directory, before, "directory");
  } catch (cause) {
    if (cause?.name === "SessionBudgetPersistenceError") throw cause;
    throw runtimeError("read", directory, cause);
  }

  let authorityDescriptor = null;
  let descriptor = null;
  let descriptorRoot = null;
  let trustedDevice = before.dev;
  if (
    platform === "linux" ||
    (platform === "win32" && allowUnsupportedPlatformForTests)
  ) {
    try {
      const flags =
        fs.constants.O_RDONLY |
        (platform === "linux" ? fs.constants.O_DIRECTORY || 0 : 0) |
        (fs.constants.O_NOFOLLOW || 0);
      if (platform === "win32") {
        const authorityPath = path.parse(path.resolve(directory)).root;
        authorityDescriptor = fileSystem.openSync(
          authorityPath,
          fs.constants.O_RDONLY,
        );
        const authority = fstatIdentity(fileSystem, authorityDescriptor);
        if (
          !authority.isDirectory() ||
          !hasPreciseIdentity(authority) ||
          authority.dev === 0n
        ) {
          throw new Error("parent volume identity is unavailable");
        }
        trustedDevice = authority.dev;
      }
      descriptor = fileSystem.openSync(directory, flags);
      const opened = fstatIdentity(fileSystem, descriptor);
      ensurePrivateOwnership(directory, opened, "directory");
      if (
        !samePathHandleParentIdentity(before, opened, trustedDevice, runtime)
      ) {
        throw new Error("parent directory identity changed during open");
      }
      trustedDevice = opened.dev;
      if (platform === "linux") {
        descriptorRoot = `/proc/self/fd/${descriptor}`;
        const projected = statIdentity(fileSystem, descriptorRoot);
        if (
          !samePathHandleParentIdentity(
            projected,
            opened,
            trustedDevice,
            runtime,
          )
        ) {
          throw new Error("could not bind parent directory through its dirfd");
        }
      }
    } catch (cause) {
      if (descriptor !== null) {
        try {
          fileSystem.closeSync(descriptor);
        } catch {
          // Preserve the identity failure.
        }
      }
      if (authorityDescriptor !== null) {
        try {
          fileSystem.closeSync(authorityDescriptor);
        } catch {
          // Preserve the identity failure.
        }
      }
      if (cause?.name === "SessionBudgetPersistenceError") throw cause;
      throw runtimeError("read", directory, cause);
    }
  }

  return {
    resolve(childPath) {
      const resolved = path.resolve(childPath);
      if (path.dirname(resolved) !== path.resolve(directory)) {
        throw runtimeError(
          "path",
          childPath,
          new Error("sidecar child escaped its verified parent"),
        );
      }
      if (descriptorRoot !== null) {
        return path.posix.join(descriptorRoot, path.basename(resolved));
      }
      if (allowUnsupportedPlatformForTests) return resolved;
      throw runtimeError(
        "unsupported",
        childPath,
        new Error(`durable sidecars are unsupported on ${platform}`),
        "ERR_SESSION_BUDGET_DURABLE_STORE_UNSUPPORTED",
      );
    },
    verify() {
      let current;
      try {
        current = lstatIdentity(fileSystem, directory);
        ensurePrivateOwnership(directory, current, "directory");
        if (descriptor !== null) {
          const opened = fstatIdentity(fileSystem, descriptor);
          if (
            !samePathHandleParentIdentity(
              current,
              opened,
              trustedDevice,
              runtime,
            )
          ) {
            throw new Error("opened parent directory identity changed");
          }
        } else if (!sameIdentity(before, current)) {
          throw new Error("parent directory identity changed");
        }
      } catch (cause) {
        if (cause?.name === "SessionBudgetPersistenceError") throw cause;
        throw runtimeError("read", directory, cause);
      }
    },
    sync() {
      if (descriptor !== null && platform === "linux") {
        fileSystem.fsyncSync(descriptor);
      }
    },
    trustedDevice,
    runtime,
    close() {
      try {
        if (descriptor !== null) {
          fileSystem.closeSync(descriptor);
          descriptor = null;
        }
      } finally {
        if (authorityDescriptor !== null) {
          fileSystem.closeSync(authorityDescriptor);
          authorityDescriptor = null;
        }
      }
    },
  };
}

function readRecordAt(filePath, sessionId, fileSystem = fs, ioOptions = {}) {
  let parent;
  try {
    parent = openVerifiedParent(filePath, fileSystem, ioOptions);
  } catch (error) {
    if (error?.cause?.code === "ENOENT") return null;
    throw error;
  }
  let descriptor = null;
  let serialized;
  try {
    const physicalPath = parent.resolve(filePath);
    let before;
    try {
      before = lstatIdentity(fileSystem, physicalPath);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        parent.verify();
        return null;
      }
      throw cause;
    }
    ensurePrivateOwnership(filePath, before, "file");
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fileSystem.openSync(physicalPath, flags);
    const opened = fstatIdentity(fileSystem, descriptor);
    ensurePrivateOwnership(filePath, opened, "file");
    if (
      !samePathHandleIdentity(
        before,
        opened,
        parent.trustedDevice,
        parent.runtime,
      )
    ) {
      throw new Error("sidecar identity changed during open");
    }
    if (statSizeExceedsLimit(opened, MAX_SIDECAR_BYTES)) {
      throw new Error("sidecar exceeds maximum size");
    }
    const pathAfterOpen = lstatIdentity(fileSystem, physicalPath);
    ensurePrivateOwnership(filePath, pathAfterOpen, "file");
    if (
      !samePathHandleIdentity(
        pathAfterOpen,
        opened,
        parent.trustedDevice,
        parent.runtime,
      )
    ) {
      throw new Error("sidecar path changed after open");
    }
    serialized = fileSystem.readFileSync(descriptor, "utf8");
    const openedAfterRead = fstatIdentity(fileSystem, descriptor);
    if (
      statSizeExceedsLimit(openedAfterRead, MAX_SIDECAR_BYTES) ||
      Buffer.byteLength(serialized, "utf8") > MAX_SIDECAR_BYTES
    ) {
      throw new Error("sidecar exceeds maximum UTF-8 byte size");
    }
    const pathAfterRead = lstatIdentity(fileSystem, physicalPath);
    ensurePrivateOwnership(filePath, pathAfterRead, "file");
    if (
      !sameOpenedIdentity(opened, openedAfterRead) ||
      !samePathHandleIdentity(
        pathAfterRead,
        openedAfterRead,
        parent.trustedDevice,
        parent.runtime,
      )
    ) {
      throw new Error("sidecar identity changed during read");
    }
    parent.verify();
  } catch (cause) {
    if (cause?.name === "SessionBudgetPersistenceError") throw cause;
    throw runtimeError("read", filePath, cause);
  } finally {
    if (descriptor !== null) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // The read/identity result remains authoritative.
      }
    }
    parent.close();
  }
  try {
    return validateRecord(JSON.parse(serialized), sessionId, filePath);
  } catch (cause) {
    if (cause?.name === "SessionBudgetPersistenceError") throw cause;
    throw runtimeError("corrupt", filePath, cause);
  }
}

function writeRecordAt(filePath, value, fileSystem = fs, ioOptions = {}) {
  let serialized;
  try {
    serialized = `${JSON.stringify(value, null, 2)}\n`;
  } catch (cause) {
    throw runtimeError("write", filePath, cause);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SIDECAR_BYTES) {
    throw runtimeError(
      "write",
      filePath,
      new Error("sidecar exceeds maximum UTF-8 byte size"),
      "ERR_SESSION_BUDGET_SIDECAR_TOO_LARGE",
    );
  }
  const directory = path.dirname(filePath);
  const parent = openVerifiedParent(filePath, fileSystem, ioOptions);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const physicalTemporary = parent.resolve(temporary);
  const physicalFilePath = parent.resolve(filePath);
  let descriptor = null;
  let renamed = false;
  let temporaryIdentity = null;
  let temporaryPathIdentity = null;
  try {
    descriptor = fileSystem.openSync(physicalTemporary, "wx", 0o600);
    fileSystem.writeFileSync(descriptor, serialized, "utf8");
    fileSystem.fsyncSync(descriptor);
    temporaryIdentity = fstatIdentity(fileSystem, descriptor);
    ensurePrivateOwnership(temporary, temporaryIdentity, "file");
    temporaryPathIdentity = lstatIdentity(fileSystem, physicalTemporary);
    ensurePrivateOwnership(temporary, temporaryPathIdentity, "file");
    if (
      !samePathHandleIdentity(
        temporaryPathIdentity,
        temporaryIdentity,
        parent.trustedDevice,
        parent.runtime,
      )
    ) {
      throw new Error("temporary sidecar identity changed before commit");
    }
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(physicalTemporary, physicalFilePath);
    renamed = true;
    const committed = lstatIdentity(fileSystem, physicalFilePath);
    ensurePrivateOwnership(filePath, committed, "file");
    // Rename may legitimately change ctime. Both samples come from the path
    // API, so exact BigInt dev+ino continuity is the stable commit identity.
    if (!sameIdentity(temporaryPathIdentity, committed)) {
      throw new Error("committed sidecar identity mismatch");
    }
    parent.verify();

    parent.sync();
    parent.verify();
  } catch (cause) {
    if (descriptor !== null) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // Preserve the original write failure.
      }
    }
    if (!renamed) {
      try {
        fileSystem.unlinkSync(physicalTemporary);
      } catch {
        // Best-effort orphan cleanup only.
      }
    }
    throw runtimeError("write", filePath, cause);
  } finally {
    parent.close();
  }
}

export function sessionBudgetPath(sessionId) {
  return `${sessionPath(sessionId)}.budget.json`;
}

export class SessionBudgetSidecarStore {
  constructor({
    resolvePath = sessionBudgetPath,
    fileSystem = fs,
    lock = withFileLock,
    lockOptions = {},
    now = () => Date.now(),
    platform = process.platform,
    uvVersion = process.versions.uv,
    allowUnsupportedPlatformForTests = false,
  } = {}) {
    this._resolvePath = resolvePath;
    this._fs = fileSystem;
    this._lock = lock;
    this._lockOptions = lockOptions;
    this._now = now;
    this._platform = String(platform);
    this._allowUnsupportedPlatformForTests =
      allowUnsupportedPlatformForTests === true;
    this._ioOptions = {
      platform: this._platform,
      uvVersion: String(uvVersion || ""),
      allowUnsupportedPlatformForTests: this._allowUnsupportedPlatformForTests,
    };
  }

  _assertSupported(filePath) {
    if (this._platform !== "linux" && !this._allowUnsupportedPlatformForTests) {
      throw runtimeError(
        "unsupported",
        filePath,
        new Error(
          `durable session budget sidecars require Linux dirfd-relative I/O; ${this._platform} is unsupported`,
        ),
        "ERR_SESSION_BUDGET_DURABLE_STORE_UNSUPPORTED",
      );
    }
  }

  pathForSession(sessionId) {
    return this._resolvePath(String(sessionId));
  }

  usageUnknownPathForSession(sessionId) {
    return `${this.pathForSession(sessionId)}${USAGE_UNKNOWN_SUFFIX}`;
  }

  read(sessionId) {
    const id = String(sessionId);
    const filePath = this.pathForSession(id);
    this._assertSupported(filePath);
    const markerPath = this.usageUnknownPathForSession(id);
    try {
      lstatIdentity(this._fs, path.dirname(filePath));
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      throw runtimeError("read", path.dirname(filePath), cause);
    }
    return this._lock(
      filePath,
      () => {
        const current = readRecordAt(filePath, id, this._fs, this._ioOptions);
        const marker = readRecordAt(markerPath, id, this._fs, this._ioOptions);
        if (!marker) return current;
        const snapshot = mergeUsageUnknownSnapshot(
          current?.snapshot ?? marker.snapshot,
          marker.snapshot,
          markerPath,
        );
        return {
          ...(current || marker),
          // A marker can survive the first canonical intent write. In that
          // case the main sidecar is absent and its CAS authority is null.
          revision: current?.revision ?? null,
          snapshot,
          usageUnknown: true,
          usageUnknownMarker: usageUnknownMarkerIdentity(marker),
        };
      },
      {
        timeoutMs: 2000,
        staleMs: 30_000,
        failIfUnavailable: true,
        ...this._lockOptions,
      },
    );
  }

  write(sessionId, snapshot, { expectedRevision = null } = {}) {
    return this._write(sessionId, snapshot, { expectedRevision });
  }

  finalizeUsageUnknown(
    sessionId,
    snapshot,
    { expectedRevision = null, expectedUsageUnknownMarker = null } = {},
  ) {
    return this._write(
      sessionId,
      snapshot,
      { expectedRevision },
      { resolveUsageUnknown: true, expectedUsageUnknownMarker },
    );
  }

  _write(
    sessionId,
    snapshot,
    { expectedRevision = null } = {},
    { resolveUsageUnknown = false, expectedUsageUnknownMarker = null } = {},
  ) {
    const id = String(sessionId);
    const filePath = this.pathForSession(id);
    this._assertSupported(filePath);
    if (
      expectedRevision !== null &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    ) {
      throw runtimeError(
        "revision",
        filePath,
        new TypeError(
          "expected revision must be null or a positive safe integer",
        ),
        "ERR_SESSION_BUDGET_UNSAFE_REVISION",
      );
    }
    const canonicalSnapshot = canonicalizeSnapshot(
      snapshot,
      filePath,
      "snapshot",
    );
    const expectedMarker = resolveUsageUnknown
      ? normalizeUsageUnknownMarkerIdentity(
          expectedUsageUnknownMarker,
          this.usageUnknownPathForSession(id),
        )
      : null;
    try {
      this._fs.mkdirSync(path.dirname(filePath), {
        recursive: true,
        mode: 0o700,
      });
    } catch (cause) {
      throw runtimeError("prepare", filePath, cause);
    }

    const result = this._lock(
      filePath,
      () => {
        const current = readRecordAt(filePath, id, this._fs, this._ioOptions);
        const marker = readRecordAt(
          this.usageUnknownPathForSession(id),
          id,
          this._fs,
          this._ioOptions,
        );
        const actualMarker = usageUnknownMarkerIdentity(marker);
        const clean = usageSettlementEntries(canonicalSnapshot).length === 0;
        if (marker && clean && !resolveUsageUnknown) {
          throw runtimeError(
            "recovery",
            filePath,
            new Error("unknown usage must be adjudicated before a clean write"),
            "ERR_SESSION_BUDGET_RECOVERY_REQUIRED",
          );
        }
        if (resolveUsageUnknown && !marker) {
          throw runtimeError(
            "recovery",
            filePath,
            new Error("usage-unknown marker is required for finalization"),
            "ERR_SESSION_BUDGET_RECOVERY_REQUIRED",
          );
        }
        if (
          resolveUsageUnknown &&
          !sameUsageUnknownMarkerIdentity(expectedMarker, actualMarker)
        ) {
          throw runtimeError(
            "conflict",
            this.usageUnknownPathForSession(id),
            new Error("usage-unknown marker changed after it was observed"),
            "ERR_SESSION_BUDGET_MARKER_CONFLICT",
          );
        }
        if (resolveUsageUnknown && !clean) {
          throw runtimeError(
            "recovery",
            filePath,
            new Error("usage finalization snapshot must be clean"),
            "ERR_SESSION_BUDGET_RECOVERY_REQUIRED",
          );
        }
        const actualRevision = current?.revision ?? null;
        if (actualRevision !== expectedRevision) {
          throw runtimeError(
            "conflict",
            filePath,
            new Error(
              `expected revision ${String(expectedRevision)}, found ${String(actualRevision)}`,
            ),
            "ERR_SESSION_BUDGET_CONFLICT",
          );
        }
        if (actualRevision === Number.MAX_SAFE_INTEGER) {
          throw runtimeError(
            "revision",
            filePath,
            new Error("sidecar revision is exhausted"),
            "ERR_SESSION_BUDGET_UNSAFE_REVISION",
          );
        }
        const revision = (actualRevision || 0) + 1;
        const record = {
          version: SESSION_BUDGET_SIDECAR_VERSION,
          sessionId: id,
          revision,
          storedAt: new Date(this._now()).toISOString(),
          writer: { pid: process.pid },
          snapshot: canonicalSnapshot,
        };
        writeRecordAt(filePath, record, this._fs, this._ioOptions);
        if (resolveUsageUnknown) {
          this._clearUsageUnknownLocked(id, expectedMarker);
        }
        return {
          revision,
          filePath,
          ...(resolveUsageUnknown ? { usageUnknownMarker: null } : {}),
        };
      },
      {
        timeoutMs: 2000,
        staleMs: 30_000,
        failIfUnavailable: true,
        ...this._lockOptions,
      },
    );
    return result;
  }

  markUsageUnknown(sessionId, snapshot) {
    const id = String(sessionId);
    const filePath = this.pathForSession(id);
    this._assertSupported(filePath);
    const markerPath = this.usageUnknownPathForSession(id);
    const canonicalSnapshot = canonicalizeSnapshot(
      snapshot,
      markerPath,
      "snapshot",
    );
    if (usageSettlementEntries(canonicalSnapshot).length === 0) {
      throw runtimeError(
        "marker",
        markerPath,
        new TypeError("usage-unknown marker requires a pending settlement"),
      );
    }
    try {
      this._fs.mkdirSync(path.dirname(markerPath), {
        recursive: true,
        mode: 0o700,
      });
    } catch (cause) {
      throw runtimeError("prepare", markerPath, cause);
    }

    return this._lock(
      filePath,
      () => {
        const current = readRecordAt(markerPath, id, this._fs, this._ioOptions);
        if (current?.revision === Number.MAX_SAFE_INTEGER) {
          throw runtimeError(
            "revision",
            markerPath,
            new Error("usage-unknown marker revision is exhausted"),
            "ERR_SESSION_BUDGET_UNSAFE_REVISION",
          );
        }
        const merged = current
          ? mergeUsageUnknownSnapshot(
              canonicalSnapshot,
              current.snapshot,
              markerPath,
            )
          : canonicalSnapshot;
        const revision = (current?.revision || 0) + 1;
        const record = {
          version: SESSION_BUDGET_SIDECAR_VERSION,
          sessionId: id,
          revision,
          storedAt: new Date(this._now()).toISOString(),
          writer: { pid: process.pid },
          snapshot: merged,
        };
        writeRecordAt(markerPath, record, this._fs, this._ioOptions);
        const committed = readRecordAt(
          markerPath,
          id,
          this._fs,
          this._ioOptions,
        );
        const usageUnknownMarker = usageUnknownMarkerIdentity(committed);
        if (current) {
          // Preserve the newly reported settlement, but do not let a runtime
          // that did not observe the prior marker later finalize both. The
          // caller fails closed and a fresh recovery host must see the union.
          throw runtimeError(
            "conflict",
            markerPath,
            new Error("usage-unknown marker changed after it was observed"),
            "ERR_SESSION_BUDGET_MARKER_CONFLICT",
          );
        }
        return { revision, filePath: markerPath, usageUnknownMarker };
      },
      {
        timeoutMs: 2000,
        staleMs: 30_000,
        failIfUnavailable: true,
        ...this._lockOptions,
      },
    );
  }

  clearUsageUnknown(sessionId, { expectedUsageUnknownMarker = null } = {}) {
    const id = String(sessionId);
    const filePath = this.pathForSession(id);
    this._assertSupported(filePath);
    const markerPath = this.usageUnknownPathForSession(id);
    const expectedMarker = normalizeUsageUnknownMarkerIdentity(
      expectedUsageUnknownMarker,
      markerPath,
    );
    return this._lock(
      filePath,
      () => this._clearUsageUnknownLocked(id, expectedMarker),
      {
        timeoutMs: 2000,
        staleMs: 30_000,
        failIfUnavailable: true,
        ...this._lockOptions,
      },
    );
  }

  _clearUsageUnknownLocked(sessionId, expectedUsageUnknownMarker) {
    const id = String(sessionId);
    const markerPath = this.usageUnknownPathForSession(id);
    const marker = readRecordAt(markerPath, id, this._fs, this._ioOptions);
    const actualMarker = usageUnknownMarkerIdentity(marker);
    if (
      !sameUsageUnknownMarkerIdentity(expectedUsageUnknownMarker, actualMarker)
    ) {
      throw runtimeError(
        "conflict",
        markerPath,
        new Error("usage-unknown marker changed before clear"),
        "ERR_SESSION_BUDGET_MARKER_CONFLICT",
      );
    }
    const parent = openVerifiedParent(markerPath, this._fs, this._ioOptions);
    const tombstone = `${markerPath}.${process.pid}.${crypto.randomUUID()}.clear`;
    const physicalMarkerPath = parent.resolve(markerPath);
    const physicalTombstone = parent.resolve(tombstone);
    try {
      const before = lstatIdentity(this._fs, physicalMarkerPath);
      ensurePrivateOwnership(markerPath, before, "file");
      this._fs.renameSync(physicalMarkerPath, physicalTombstone);
      const moved = lstatIdentity(this._fs, physicalTombstone);
      ensurePrivateOwnership(tombstone, moved, "file");
      if (!sameIdentity(before, moved)) {
        throw new Error("usage-unknown marker identity changed during clear");
      }
      this._fs.unlinkSync(physicalTombstone);
      parent.verify();
      parent.sync();
      parent.verify();
      return true;
    } catch (cause) {
      throw runtimeError("clear", markerPath, cause);
    } finally {
      parent.close();
    }
  }
}

class SharedSessionBudgetRuntime {
  constructor({
    sessionId,
    key,
    store,
    budget,
    revision,
    usageUnknownMarker,
    registry,
  }) {
    this.sessionId = sessionId;
    this.key = key;
    this.store = store;
    this.budget = budget;
    this.revision = revision;
    this.usageUnknownMarker = usageUnknownMarker || null;
    this.registry = registry;
    this.references = 0;
    this.observers = new Set();
    this.persistenceError = null;
    this._persisting = false;
  }

  observe(callback) {
    if (typeof callback !== "function") return () => false;
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  onBudgetEvent(event) {
    for (const observer of this.observers) {
      try {
        const pending = observer(event);
        void Promise.resolve(pending).catch(() => {});
      } catch {
        // Observability never weakens the budget authority.
      }
    }
  }

  assertMutationAllowed() {
    this.budget._assertAuthorityMutationAllowed?.();
  }

  _persistTransaction(write) {
    this.assertMutationAllowed();
    if (this.persistenceError) throw this.persistenceError;
    if (this._persisting) {
      const error = runtimeError(
        "reentrant",
        this.store.pathForSession(this.sessionId),
        new Error("authority persistence cannot re-enter"),
        "ERR_SESSION_BUDGET_REENTRANT_PERSISTENCE",
      );
      this.persistenceError = error;
      throw error;
    }
    this._persisting = true;
    try {
      const result = write();
      if (this.persistenceError) throw this.persistenceError;
      if (!Number.isSafeInteger(result?.revision) || result.revision < 1) {
        throw runtimeError(
          "write",
          this.store.pathForSession(this.sessionId),
          new TypeError("store returned an invalid revision"),
        );
      }
      this.revision = result.revision;
      if (Object.hasOwn(result, "usageUnknownMarker")) {
        this.usageUnknownMarker = result.usageUnknownMarker
          ? normalizeUsageUnknownMarkerIdentity(
              result.usageUnknownMarker,
              this.store.pathForSession(this.sessionId),
            )
          : null;
      }
      return this.revision;
    } catch (error) {
      this.persistenceError = error;
      throw error;
    } finally {
      this._persisting = false;
    }
  }

  persistSnapshot(snapshot) {
    return this._persistTransaction(() =>
      this.store.write(this.sessionId, snapshot, {
        expectedRevision: this.revision,
      }),
    );
  }

  persist() {
    this.assertMutationAllowed();
    return this.persistSnapshot(this.budget.snapshot());
  }

  persistAuthority(change) {
    if (change.type === "budget:usage-settlement-started") {
      return this._persistTransaction(() => {
        if (typeof this.store.markUsageUnknown !== "function") {
          throw runtimeError(
            "marker",
            this.store.pathForSession(this.sessionId),
            new Error("store cannot persist unknown usage intent"),
            "ERR_SESSION_BUDGET_MARKER_UNAVAILABLE",
          );
        }
        const marker = this.store.markUsageUnknown(
          this.sessionId,
          change.snapshot,
        );
        const usageUnknownMarker = normalizeUsageUnknownMarkerIdentity(
          marker?.usageUnknownMarker,
          this.store.pathForSession(this.sessionId),
        );
        const result = this.store.write(this.sessionId, change.snapshot, {
          expectedRevision: this.revision,
        });
        return {
          ...result,
          usageUnknownMarker,
        };
      });
    }

    if (change.type === "budget:usage-recorded") {
      return this._persistTransaction(() => {
        if (typeof this.store.finalizeUsageUnknown !== "function") {
          throw runtimeError(
            "finalize",
            this.store.pathForSession(this.sessionId),
            new Error("store cannot durably finalize unknown usage"),
            "ERR_SESSION_BUDGET_MARKER_UNAVAILABLE",
          );
        }
        return this.store.finalizeUsageUnknown(
          this.sessionId,
          change.snapshot,
          {
            expectedRevision: this.revision,
            expectedUsageUnknownMarker: this.usageUnknownMarker,
          },
        );
      });
    }

    if (change.type === "budget:recovery-adjudicated") {
      return this._persistTransaction(() => {
        if (this.usageUnknownMarker) {
          if (typeof this.store.finalizeUsageUnknown !== "function") {
            throw runtimeError(
              "finalize",
              this.store.pathForSession(this.sessionId),
              new Error("store cannot durably adjudicate unknown usage"),
              "ERR_SESSION_BUDGET_MARKER_UNAVAILABLE",
            );
          }
          return this.store.finalizeUsageUnknown(
            this.sessionId,
            change.snapshot,
            {
              expectedRevision: this.revision,
              expectedUsageUnknownMarker: this.usageUnknownMarker,
            },
          );
        }
        return this.store.write(this.sessionId, change.snapshot, {
          expectedRevision: this.revision,
        });
      });
    }

    return this.persistSnapshot(change.snapshot);
  }

  retain({ limits = {}, onEvent = null, signal = null } = {}) {
    this.budget.tightenLimits?.(limits);
    let unlinkSignal = () => {};
    let signalFailure = null;
    let retaining = true;
    if (signal) {
      const abort = () => {
        try {
          this.budget.abort(signal.reason || "host-aborted", {
            reason: "host-aborted",
          });
        } catch (error) {
          signalFailure = error;
          // Once a handle exists, the budget has already failed closed and its
          // status exposes the durable error. Do not turn a later EventTarget
          // callback into an uncaught process exception.
          if (!retaining) return;
        }
      };
      if (signal.aborted) abort();
      else {
        unlinkSignal = () => {
          try {
            signal.removeEventListener?.("abort", abort);
          } catch {
            // Listener cleanup must not retain the shared runtime forever.
          }
        };
        try {
          signal.addEventListener?.("abort", abort, { once: true });
        } catch (error) {
          // A custom EventTarget may register and then throw. Best-effort
          // unlink closes that leak before openSessionBudget unwinds.
          unlinkSignal();
          throw error;
        }
        // Custom signals need not provide the browser's atomic add/check
        // behavior. Close the narrow race before retaining process state.
        if (signal.aborted) abort();
      }
    }
    retaining = false;
    if (signalFailure) {
      unlinkSignal();
      throw signalFailure;
    }
    const unobserve = this.observe(onEvent);
    this.references += 1;
    let closed = false;
    return new SessionBudgetRuntimeHandle(this, () => {
      if (closed) return false;
      this.assertMutationAllowed();
      const released = this.release();
      // A failed final persist leaves this handle live and the runtime
      // registered but poisoned. Only successful release may detach the
      // handle's observer/signal capabilities.
      closed = true;
      unlinkSignal();
      unobserve();
      return released;
    });
  }

  release() {
    this.assertMutationAllowed();
    if (this.references <= 0) return false;
    if (this.references > 1) {
      this.references -= 1;
      return true;
    }

    try {
      this.persist();
    } catch (error) {
      this.budget._failClosedAuthorityPersistence(error, "runtime-close");
      throw error;
    }

    this.references = 0;
    this.budget._revokeRuntimeAuthority();
    if (this.registry.get(this.key) === this) this.registry.delete(this.key);
    return true;
  }
}

export class SessionBudgetRuntimeHandle {
  constructor(runtime, close) {
    this.sessionId = runtime.sessionId;
    this.budget = runtime.budget;
    this.filePath = runtime.store.pathForSession(runtime.sessionId);
    this._runtime = runtime;
    this._close = close;
  }

  persist() {
    return this._runtime.persist();
  }

  status() {
    return {
      ...this.budget.status(),
      persistenceRevision: this._runtime.revision,
      persistenceError: this._runtime.persistenceError?.message || null,
    };
  }

  close() {
    return this._close();
  }
}

function registryKey(store, sessionId) {
  const filePath = path.resolve(store.pathForSession(sessionId));
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

/**
 * Open (or reuse) one process-local budget instance for a logical session.
 * Restored dirty snapshots remain blocked until the caller explicitly invokes
 * `budget.adjudicateRecovery({ abandoned: exactIds })`.
 */
export function openSessionBudget(
  sessionId,
  {
    limits = {},
    table = undefined,
    signal = null,
    onEvent = null,
    recoverUnsettled = "require-adjudication",
    store = new SessionBudgetSidecarStore(),
    registry = DEFAULT_REGISTRY,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (timer) => clearTimeout(timer),
  } = {},
) {
  const id = String(sessionId || "");
  if (recoverUnsettled !== "require-adjudication") {
    throw new TypeError(
      "session budget runtime requires explicit recovery adjudication",
    );
  }
  // sessionBudgetPath/sessionPath performs the canonical segment validation.
  const key = registryKey(store, id);
  const existing = registry.get(key);
  if (existing) return existing.retain({ limits, onEvent, signal });

  const stored = store.read(id);
  let runtime = null;
  const dispatch = (event) => runtime?.onBudgetEvent(event);
  const persistAuthority = (change) => runtime?.persistAuthority(change);
  const common = {
    table,
    now,
    setTimer,
    clearTimer,
    onEvent: dispatch,
    onAuthorityChange: persistAuthority,
  };
  const budget = stored
    ? SessionResourceBudget.restore(stored.snapshot, {
        ...common,
        overrides: limits,
        recoverUnsettled: "require-adjudication",
      })
    : new SessionResourceBudget({ ...limits, ...common });
  runtime = new SharedSessionBudgetRuntime({
    sessionId: id,
    key,
    store,
    budget,
    revision: stored?.revision ?? null,
    usageUnknownMarker: stored?.usageUnknownMarker ?? null,
    registry,
  });
  registry.set(key, runtime);
  try {
    // Persist creation, restore/tightening and an exact clean/dirty snapshot
    // before returning a handle.
    runtime.persist();
    return runtime.retain({ onEvent, signal });
  } catch (error) {
    registry.delete(key);
    budget.dispose();
    throw error;
  }
}

export function sessionBudgetRuntimeCount(registry = DEFAULT_REGISTRY) {
  return registry.size;
}
