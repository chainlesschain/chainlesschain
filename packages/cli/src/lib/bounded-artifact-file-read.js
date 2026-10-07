/** A bounded canonical-path read, not a persistent identity or authority grant. */
import fs from "node:fs";
import path from "node:path";
import { readBoundedDescriptor } from "./evolution/bounded-descriptor-read.js";
import { withEvolutionFileIdentity } from "./evolution/evolution-file-identity.js";
import { artifactPhysicalIdentity } from "./evolution/evolution-artifact-identity.js";

export const ARTIFACT_BOUNDED_READ_FAILED_CODE =
  "CC_ARTIFACT_BOUNDED_READ_FAILED";
const FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const MUTATION_FIELDS = Object.freeze(
  FIELDS.filter((name) => name !== "dev" && name !== "ino"),
);
const DIRECTORY_FS = Object.freeze({
  constants: fs.constants,
  realpathSync: fs.realpathSync,
  lstatSync: (...args) => fs.lstatSync(...args),
  fstatSync: (...args) => fs.fstatSync(...args),
  closeSync: (...args) => fs.closeSync(...args),
  openSync: (target, flags) =>
    fs.openSync(
      target,
      flags | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_DIRECTORY || 0),
    ),
});
const canonical = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
function fail(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = ARTIFACT_BOUNDED_READ_FAILED_CODE;
  throw error;
}
function safeStat(stat, expectedSize, maximumBytes, label) {
  if (FIELDS.some((name) => typeof stat?.[name] !== "bigint"))
    fail(`${label} requires full-precision stat fields`);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
    fail(`${label} must be a regular, non-symlink, single-link file`);
  if (
    stat.size < 0n ||
    stat.size > BigInt(maximumBytes) ||
    stat.size !== BigInt(expectedSize)
  )
    fail(`${label} differs from its bounded expected size`);
}
function sameMetadata(left, right) {
  return (
    MUTATION_FIELDS.every((name) => left[name] === right[name]) &&
    artifactPhysicalIdentity(left).birthtimeMs ===
      artifactPhysicalIdentity(right).birthtimeMs
  );
}
function sameStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    sameMetadata(left, right)
  );
}

/** Read one stable window only. Callers retain hash/signature and root checks. */
export function readBoundedArtifactFile(target, expectedSize, maximumBytes) {
  if (
    arguments.length !== 3 ||
    typeof target !== "string" ||
    !path.isAbsolute(target) ||
    path.resolve(target) !== target ||
    !Number.isSafeInteger(expectedSize) ||
    !Number.isSafeInteger(maximumBytes) ||
    expectedSize < 0 ||
    maximumBytes < 1 ||
    expectedSize > maximumBytes
  )
    throw new TypeError(
      "bounded artifact read requires a canonical path and finite size bounds",
    );
  try {
    return withEvolutionFileIdentity(DIRECTORY_FS, target, (samePathHandle) => {
      const before = fs.lstatSync(target, { bigint: true });
      safeStat(before, expectedSize, maximumBytes, "artifact path");
      if (canonical(fs.realpathSync.native(target)) !== canonical(target))
        fail("artifact path is not physically canonical");
      const fd = fs.openSync(
        target,
        fs.constants.O_RDONLY |
          (fs.constants.O_NOFOLLOW || 0) |
          (fs.constants.O_NONBLOCK || 0),
      );
      try {
        const opened = fs.fstatSync(fd, { bigint: true });
        safeStat(opened, expectedSize, maximumBytes, "artifact descriptor");
        if (!samePathHandle(before, opened) || !sameMetadata(before, opened))
          fail("artifact path and descriptor identities differ");
        const bytes = readBoundedDescriptor(
          fs,
          fd,
          Number(opened.size),
          maximumBytes,
        );
        const closed = fs.fstatSync(fd, { bigint: true });
        const after = fs.lstatSync(target, { bigint: true });
        safeStat(closed, expectedSize, maximumBytes, "artifact descriptor");
        safeStat(after, expectedSize, maximumBytes, "artifact path");
        if (!sameStat(opened, closed))
          fail("artifact descriptor changed during bounded read");
        if (
          !sameStat(before, after) ||
          !samePathHandle(after, closed) ||
          !sameMetadata(after, closed) ||
          canonical(fs.realpathSync.native(target)) !== canonical(target)
        )
          fail("artifact pathname changed during bounded read");
        return bytes;
      } finally {
        fs.closeSync(fd);
      }
    });
  } catch (cause) {
    if (cause?.code === ARTIFACT_BOUNDED_READ_FAILED_CODE) throw cause;
    fail("artifact bounded descriptor read failed", cause);
  }
}
