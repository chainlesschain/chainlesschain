"use strict";

const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const HARD_MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

class SnapshotFileError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SnapshotFileError";
    this.code = code;
  }
}

function resolveMaxSnapshotBytes(value) {
  if (value == null) return DEFAULT_MAX_SNAPSHOT_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SnapshotFileError(
      "SNAPSHOT_LIMIT_INVALID",
      "maxSnapshotBytes must be a positive safe integer",
    );
  }
  if (value > HARD_MAX_SNAPSHOT_BYTES) {
    throw new SnapshotFileError(
      "SNAPSHOT_LIMIT_INVALID",
      `maxSnapshotBytes must not exceed ${HARD_MAX_SNAPSHOT_BYTES}`,
    );
  }
  return value;
}

function toSafeSnapshotError(error, fallbackCode = "INPUT_PATH_UNREADABLE") {
  if (error instanceof SnapshotFileError) return error;
  return new SnapshotFileError(
    fallbackCode,
    "snapshot file is unavailable or unreadable",
    { cause: error },
  );
}

function inspectSnapshotFile(fsMod, inputPath, opts = {}) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new SnapshotFileError(
      "INPUT_PATH_REQUIRED",
      "snapshot file path is required",
    );
  }
  const maxBytes = resolveMaxSnapshotBytes(opts.maxBytes);
  let linkStat;
  let stat;
  try {
    linkStat = fsMod.lstatSync(inputPath, { bigint: true });
    if (
      linkStat &&
      typeof linkStat.isSymbolicLink === "function" &&
      linkStat.isSymbolicLink()
    ) {
      throw new SnapshotFileError(
        "SNAPSHOT_SYMBOLIC_LINK",
        "snapshot source must not be a symbolic link",
      );
    }
    stat = fsMod.statSync(inputPath, { bigint: true });
  } catch (error) {
    throw toSafeSnapshotError(error);
  }
  if (!stat || typeof stat.isFile !== "function" || !stat.isFile()) {
    throw new SnapshotFileError(
      "SNAPSHOT_NOT_REGULAR_FILE",
      "snapshot source must be a regular file",
    );
  }
  const size = Number(stat.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new SnapshotFileError(
      "SNAPSHOT_SIZE_INVALID",
      "snapshot file size is invalid",
    );
  }
  if (size > maxBytes) {
    throw new SnapshotFileError(
      "SNAPSHOT_TOO_LARGE",
      `snapshot file exceeds the ${maxBytes}-byte import limit`,
    );
  }
  let realPath;
  try {
    realPath = fsMod.realpathSync(inputPath);
  } catch (error) {
    throw toSafeSnapshotError(error);
  }
  return { size, maxBytes, stat, linkStat, realPath };
}

function probeSnapshotFile(fsMod, inputPath, opts = {}) {
  try {
    const { size } = inspectSnapshotFile(fsMod, inputPath, opts);
    return { ok: true, mode: "snapshot-file", size };
  } catch (error) {
    const safeError = toSafeSnapshotError(error);
    return {
      ok: false,
      reason: safeError.code,
      message: safeError.message,
    };
  }
}

function readBoundedSnapshotBuffer(fsMod, inputPath, opts = {}) {
  const inspected = inspectSnapshotFile(fsMod, inputPath, opts);
  let descriptor;
  try {
    const noFollow = Number(fsMod.constants && fsMod.constants.O_NOFOLLOW) || 0;
    const readOnly = Number(fsMod.constants && fsMod.constants.O_RDONLY) || 0;
    descriptor = fsMod.openSync(inputPath, readOnly | noFollow);
    const before = fsMod.fstatSync(descriptor, { bigint: true });
    if (
      !before ||
      typeof before.isFile !== "function" ||
      !before.isFile() ||
      Number(before.size) !== inspected.size ||
      !sameFileIdentity(before, inspected.stat)
    ) {
      throw new SnapshotFileError(
        "SNAPSHOT_CHANGED",
        "snapshot file changed before it could be read",
      );
    }

    const buffer = Buffer.allocUnsafe(inspected.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fsMod.readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fsMod.fstatSync(descriptor, { bigint: true });
    const afterLinkStat = fsMod.lstatSync(inputPath, { bigint: true });
    const afterRealPath = fsMod.realpathSync(inputPath);
    if (
      offset !== inspected.size ||
      Number(after.size) !== inspected.size ||
      !sameFileRevision(after, before) ||
      (typeof afterLinkStat.isSymbolicLink === "function" &&
        afterLinkStat.isSymbolicLink()) ||
      !sameFileIdentity(after, before) ||
      !sameFileIdentity(afterLinkStat, inspected.linkStat) ||
      afterRealPath !== inspected.realPath
    ) {
      throw new SnapshotFileError(
        "SNAPSHOT_CHANGED",
        "snapshot file changed while it was being read",
      );
    }
    return buffer.subarray(0, offset);
  } catch (error) {
    throw toSafeSnapshotError(error);
  } finally {
    if (descriptor !== undefined) {
      try {
        fsMod.closeSync(descriptor);
      } catch {
        // Preserve the primary read result/error.
      }
    }
  }
}

function readBoundedSnapshot(fsMod, inputPath, opts = {}) {
  return readBoundedSnapshotBuffer(fsMod, inputPath, opts).toString("utf8");
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  const leftDev = exactStatInteger(left.dev);
  const rightDev = exactStatInteger(right.dev);
  const leftIno = exactStatInteger(left.ino);
  const rightIno = exactStatInteger(right.ino);
  if (
    leftDev !== null &&
    rightDev !== null &&
    leftIno !== null &&
    rightIno !== null &&
    (leftDev !== 0n || leftIno !== 0n || rightDev !== 0n || rightIno !== 0n)
  ) {
    return leftDev === rightDev && leftIno === rightIno;
  }
  return (
    Number(left.size) === Number(right.size) && sameFileRevision(left, right)
  );
}

function exactStatInteger(value) {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

function sameStatTimestamp(left, right, nsField, msField) {
  const leftNs = exactStatInteger(left && left[nsField]);
  const rightNs = exactStatInteger(right && right[nsField]);
  if (leftNs !== null && rightNs !== null) return leftNs === rightNs;
  const leftMs = Number(left && left[msField]);
  const rightMs = Number(right && right[msField]);
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function sameOptionalStatTimestamp(left, right, nsField, msField) {
  const leftHas =
    (left && left[nsField] != null) || (left && left[msField] != null);
  const rightHas =
    (right && right[nsField] != null) || (right && right[msField] != null);
  if (!leftHas && !rightHas) return true;
  if (!leftHas || !rightHas) return false;
  return sameStatTimestamp(left, right, nsField, msField);
}

function sameFileRevision(left, right) {
  return (
    sameStatTimestamp(left, right, "mtimeNs", "mtimeMs") &&
    sameOptionalStatTimestamp(left, right, "ctimeNs", "ctimeMs") &&
    sameOptionalStatTimestamp(left, right, "birthtimeNs", "birthtimeMs")
  );
}

function validateJsonSnapshot(snapshot, opts = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new SnapshotFileError(
      "SNAPSHOT_SHAPE_INVALID",
      "snapshot JSON root must be an object",
    );
  }
  if (
    opts.expectedSchemaVersion !== undefined &&
    snapshot.schemaVersion !== opts.expectedSchemaVersion
  ) {
    throw new SnapshotFileError(
      "SNAPSHOT_SCHEMA_MISMATCH",
      `snapshot schemaVersion mismatch (got ${String(snapshot.schemaVersion)}, expected ${String(opts.expectedSchemaVersion)})`,
    );
  }
  const arrayFields = Array.isArray(opts.requiredArrayFields)
    ? opts.requiredArrayFields
    : [];
  for (const field of arrayFields) {
    if (typeof field !== "string" || !Array.isArray(snapshot[field])) {
      throw new SnapshotFileError(
        "SNAPSHOT_SHAPE_INVALID",
        `snapshot ${String(field)} must be an array`,
      );
    }
  }
  if (Array.isArray(opts.allowedEventKinds)) {
    const allowedKinds = new Set(opts.allowedEventKinds);
    for (const event of snapshot.events || []) {
      if (
        !event ||
        typeof event !== "object" ||
        Array.isArray(event) ||
        typeof event.kind !== "string" ||
        !allowedKinds.has(event.kind)
      ) {
        throw new SnapshotFileError(
          "SNAPSHOT_SHAPE_INVALID",
          "snapshot events must be objects with a recognized kind",
        );
      }
    }
  }
  return snapshot;
}

function readJsonSnapshot(fsMod, inputPath, opts = {}) {
  const raw = readBoundedSnapshot(fsMod, inputPath, opts);
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_JSON_INVALID",
      "snapshot file must contain valid JSON",
      { cause: error },
    );
  }
  return validateJsonSnapshot(snapshot, opts);
}

function probeJsonSnapshotFile(fsMod, inputPath, opts = {}) {
  try {
    readJsonSnapshot(fsMod, inputPath, opts);
    return { ok: true, mode: "snapshot-file" };
  } catch (error) {
    const safeError = toSafeSnapshotError(error);
    return {
      ok: false,
      reason: safeError.code,
      message: safeError.message,
    };
  }
}

module.exports = {
  DEFAULT_MAX_SNAPSHOT_BYTES,
  HARD_MAX_SNAPSHOT_BYTES,
  SnapshotFileError,
  inspectSnapshotFile,
  probeJsonSnapshotFile,
  probeSnapshotFile,
  readBoundedSnapshot,
  readBoundedSnapshotBuffer,
  readJsonSnapshot,
  resolveMaxSnapshotBytes,
  validateJsonSnapshot,
};
