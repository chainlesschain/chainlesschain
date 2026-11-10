import fs from "node:fs";
import { atomicWriteJson } from "../../../scripts/diagnostics/bounded-atomic-json.mjs";

// Synthetic host only. Keep the durable temp and the previous whole checkpoint
// while the shared Windows publication helper retries a reader's brief lock.
export function publishSyntheticCheckpoint(
  file,
  heads,
  { io = fs, ...options } = {},
) {
  return atomicWriteJson(file, heads, {
    ...options,
    // Never print the fixture's private paths in a worker's public diagnostics.
    onRetry: () => {},
    io: {
      ...io,
      writeFileSync(temporary, bytes, writeOptions) {
        const fd = io.openSync(temporary, writeOptions.flag, writeOptions.mode);
        try {
          io.writeFileSync(fd, bytes, { encoding: writeOptions.encoding });
          io.fsyncSync(fd);
        } finally {
          io.closeSync(fd);
        }
      },
    },
  });
}

const IO_CODES = new Set([
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOENT",
  "ENOSPC",
  "EIO",
  "EROFS",
]);
const IO_SYSCALLS = new Set([
  "open",
  "read",
  "write",
  "fsync",
  "close",
  "rename",
]);

export function checkpointWorkerFailure(error) {
  const code = /^CC_BUDGET_[A-Z_]{1,80}$/u.test(error?.code || "")
    ? error.code
    : "Error";
  const result = { ok: false, code };
  if (code === "CC_BUDGET_LINEAGE_HOST_UNAVAILABLE") {
    if (IO_CODES.has(error.cause?.code)) result.causeCode = error.cause.code;
    if (IO_SYSCALLS.has(error.cause?.syscall))
      result.syscall = error.cause.syscall;
  }
  return result;
}
