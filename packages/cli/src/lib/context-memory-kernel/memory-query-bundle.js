import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { corruptStore, syncDirectory } from "./durable-memory-port.js";

const CHUNK_BYTES = 64 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAGIC = "chainlesschain.memory-query-bundle/v1\n";
const NAME_DOMAIN = "chainlesschain.memory-query-bundle/name/v1\0";
const noop = () => {};

function corruptBundle(file, reason) {
  return Object.assign(
    new Error(`Context/Memory query bundle is invalid: ${reason}`),
    {
      code: "CONTEXT_MEMORY_QUERY_BUNDLE_CORRUPT",
      filePath: file,
    },
  );
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function regular(stat, file) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw corruptStore(file, "query bundle must be an unlinked regular file");
  return stat;
}

function targetStat(file) {
  try {
    return regular(lstatSync(file), file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sameFile(file, expected) {
  const current = targetStat(file);
  if (!current || !sameIdentity(current, expected))
    throw corruptStore(file, "query bundle file identity changed");
  return current;
}

function sameDirectory(directory, expected) {
  const current = lstatSync(directory);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameIdentity(current, expected)
  )
    throw corruptStore(directory, "query bundle directory identity changed");
}

/** A derived representation; only the caller's verified manifest supplies lengths and hashes. */
export function createQueryBundlePlan(
  manifest,
  { maxFrameBytes = 64 * 1024 * 1024, maxBundleBytes = 0 } = {},
) {
  if (
    !DIGEST.test(manifest?.digest) ||
    !manifest.shards ||
    !Number.isSafeInteger(maxFrameBytes) ||
    maxFrameBytes < 1 ||
    !Number.isSafeInteger(maxBundleBytes) ||
    maxBundleBytes < 1
  )
    return null;
  const buckets = Object.keys(manifest.shards).sort();
  if (!buckets.length || buckets.length > 256) return null;
  const key = createHash("sha256")
    .update(NAME_DOMAIN)
    .update(manifest.digest)
    .digest("hex");
  const name = `query-00-${key}.json`;
  const frames = [];
  let payloadBytes = 0;
  for (const bucket of buckets) {
    const entry = manifest.shards[bucket];
    if (
      !/^[a-f0-9]{2}$/u.test(bucket) ||
      !DIGEST.test(entry?.queryDigest) ||
      !Number.isSafeInteger(entry.queryBytes) ||
      entry.queryBytes < 1 ||
      entry.queryBytes > maxFrameBytes
    )
      return null;
    if (`query-${bucket}-${entry.queryDigest.slice(7)}.json` === name)
      return null;
    payloadBytes += entry.queryBytes;
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes > maxBundleBytes)
      return null;
    frames.push(
      Object.freeze({
        bucket,
        byteLength: entry.queryBytes,
        digest: entry.queryDigest,
      }),
    );
  }
  const header = Buffer.from(
    `${MAGIC}${JSON.stringify({ manifestDigest: manifest.digest, frames })}\n`,
  );
  const byteLength = header.length + payloadBytes;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBundleBytes)
    return null;
  return Object.freeze({
    name,
    manifestDigest: manifest.digest,
    frames: Object.freeze(frames),
    header,
    byteLength,
  });
}

/**
 * onFrame receives verified bytes; withhold results until the entire read succeeds.
 * reuseFrameBuffer borrows storage only until onFrame settles. Opted-in callers
 * must finish decoding before returning and must not retain the bytes or views.
 * The default gives each callback its own independently retainable Buffer.
 */
export async function readQueryBundle(
  file,
  plan,
  { checkpoint = noop, onFrame = noop, reuseFrameBuffer = false } = {},
) {
  await checkpoint();
  const before = regular(lstatSync(file), file);
  let fd;
  try {
    try {
      fd = openSync(
        file,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW || 0) |
          (constants.O_NONBLOCK || 0),
      );
    } catch (error) {
      if (["ELOOP", "ENOENT", "ENOTDIR"].includes(error.code))
        throw corruptStore(
          file,
          "query bundle path changed while opening",
          error,
        );
      throw error;
    }
    const opened = regular(fstatSync(fd), file);
    if (!sameIdentity(before, opened))
      throw corruptStore(file, "query bundle changed while opening");
    if (opened.size !== plan.byteLength)
      throw corruptBundle(file, "byte length does not match manifest plan");
    async function readBytes(bytes, hash) {
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(
          fd,
          bytes,
          offset,
          Math.min(CHUNK_BYTES, bytes.length - offset),
          null,
        );
        if (!count) throw corruptBundle(file, "unexpected end of file");
        hash?.update(bytes.subarray(offset, offset + count));
        offset += count;
        await checkpoint();
      }
    }
    const header = Buffer.allocUnsafe(plan.header.length);
    await readBytes(header);
    if (!header.equals(plan.header))
      throw corruptBundle(file, "header does not match current manifest");
    const reusable = reuseFrameBuffer
      ? Buffer.allocUnsafe(
          Math.max(...plan.frames.map((frame) => frame.byteLength)),
        )
      : null;
    for (const frame of plan.frames) {
      const bytes = reusable
        ? reusable.subarray(0, frame.byteLength)
        : Buffer.allocUnsafe(frame.byteLength);
      const hash = createHash("sha256");
      await readBytes(bytes, hash);
      if (`sha256:${hash.digest("hex")}` !== frame.digest)
        throw corruptBundle(
          file,
          `frame digest does not match bucket ${frame.bucket}`,
        );
      await onFrame(frame.bucket, bytes);
    }
    if (readSync(fd, Buffer.allocUnsafe(1), 0, 1, null) !== 0)
      throw corruptBundle(file, "trailing data");
    await checkpoint();
    const after = regular(fstatSync(fd), file);
    if (!sameIdentity(opened, after))
      throw corruptStore(file, "query bundle descriptor identity changed");
    sameFile(file, opened);
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw corruptBundle(file, "file changed while reading");
  } catch (error) {
    if (fd !== undefined) {
      // Content errors are repairable only while the pathname still names the
      // inode we opened. Otherwise a failed read could authorize replacing an
      // unrelated file that appeared during a cooperative checkpoint.
      regular(fstatSync(fd), file);
      sameFile(file, before);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Caller holds the authority lock throughout construction, publication, and cleanup. */
export async function writeQueryBundle(
  file,
  plan,
  { checkpoint = noop, getFrame, checkDirectories } = {},
) {
  if (typeof getFrame !== "function" || typeof checkDirectories !== "function")
    throw new TypeError(
      "query bundle write requires getFrame and checkDirectories",
    );
  if (basename(file) !== plan.name)
    throw corruptStore(file, "query bundle target does not match its plan");
  await checkpoint();
  await checkDirectories();
  const directory = dirname(file);
  const parent = lstatSync(directory);
  sameDirectory(directory, parent);
  const originalTarget = targetStat(file);
  const temporary = join(directory, `query-rebuild-${randomUUID()}.tmp`);
  let fd, created;
  let published = false;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o600,
    );
    created = regular(fstatSync(fd), temporary);
    async function writeBytes(bytes, hash) {
      let offset = 0;
      while (offset < bytes.length) {
        const count = writeSync(
          fd,
          bytes,
          offset,
          Math.min(CHUNK_BYTES, bytes.length - offset),
        );
        if (!count)
          throw Object.assign(
            new Error("query bundle write made no progress"),
            { code: "EIO" },
          );
        hash?.update(bytes.subarray(offset, offset + count));
        offset += count;
        await checkpoint();
      }
    }
    await writeBytes(plan.header);
    for (const frame of plan.frames) {
      const bytes = await getFrame(frame.bucket);
      if (!Buffer.isBuffer(bytes) || bytes.length !== frame.byteLength)
        throw corruptBundle(
          file,
          `source frame does not match bucket ${frame.bucket}`,
        );
      const sourceHash = createHash("sha256");
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        sourceHash.update(bytes.subarray(offset, offset + CHUNK_BYTES));
        await checkpoint();
      }
      if (`sha256:${sourceHash.digest("hex")}` !== frame.digest)
        throw corruptBundle(
          file,
          `source frame does not match bucket ${frame.bucket}`,
        );
      const writtenHash = createHash("sha256");
      await writeBytes(bytes, writtenHash);
      if (`sha256:${writtenHash.digest("hex")}` !== frame.digest)
        throw corruptBundle(
          file,
          `source frame changed while writing bucket ${frame.bucket}`,
        );
    }
    const written = regular(fstatSync(fd), temporary);
    if (!sameIdentity(created, written))
      throw corruptStore(temporary, "query bundle temporary identity changed");
    if (written.size !== plan.byteLength)
      throw corruptBundle(file, "written byte length does not match plan");
    fsyncSync(fd);
    await checkpoint();
    closeSync(fd);
    fd = undefined;
    await checkDirectories();
    sameDirectory(directory, parent);
    sameFile(temporary, created);
    const currentTarget = targetStat(file);
    if (
      Boolean(originalTarget) !== Boolean(currentTarget) ||
      (originalTarget && !sameIdentity(originalTarget, currentTarget))
    )
      throw corruptStore(
        file,
        "query bundle target identity changed before publication",
      );
    renameSync(temporary, file);
    published = true;
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!published && created) {
      // An unsafe directory or a replaced temp path is not ours to delete.
      // Preserve the original failure rather than hiding it with cleanup errors.
      try {
        await checkDirectories();
        sameDirectory(directory, parent);
        sameFile(temporary, created);
        unlinkSync(temporary);
      } catch {
        /* Leave an untrusted/redirected temporary path untouched. */
      }
    }
  }
}
