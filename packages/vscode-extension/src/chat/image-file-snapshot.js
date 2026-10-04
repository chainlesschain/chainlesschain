const fs = require("fs/promises");
const { constants } = require("fs");

// Fixed allocation + one overflow byte. Reads, hash and validation consume the
// same snapshot; no unbounded readFile after a separate header/path check.
async function readImageSnapshot(
  file,
  expectedSize = null,
  { io = fs, signal, timeoutMs = 5000, now = () => performance.now() } = {},
) {
  const deadline = now() + timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new Error("Image reading cancelled");
    if (now() >= deadline)
      throw new Error("Image reading exceeded the time budget");
  };
  const same = (a, b) =>
    a.isFile() &&
    b.isFile() &&
    ["size", "dev", "ino", "mtimeMs", "ctimeMs"].every(
      (key) => a[key] === b[key],
    );
  check();
  const before = await io.lstat(file);
  check();
  if (
    !before.isFile() ||
    before.size <= 0 ||
    before.size > 20 * 1024 * 1024 ||
    (expectedSize !== null && before.size !== expectedSize)
  )
    throw new Error("Saved attachment is missing or changed; attach it again");
  const handle = await io.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    check();
    const opened = await handle.stat();
    if (!same(before, opened)) {
      // Record only filesystem metadata, never the path or attachment bytes.
      // This distinguishes an actual replacement from platform stat API bugs.
      const differences = ["size", "dev", "ino", "mtimeMs", "ctimeMs"]
        .filter((key) => before[key] !== opened[key])
        .map((key) => `${key}: ${before[key]} -> ${opened[key]}`);
      throw new Error(
        `Saved attachment changed while opening (${differences.join(", ")})`,
      );
    }
    const buffer = Buffer.alloc(opened.size + 1);
    let count = 0;
    while (count < buffer.length) {
      check();
      const { bytesRead } = await handle.read(
        buffer,
        count,
        Math.min(64 * 1024, buffer.length - count),
        count,
      );
      check();
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await handle.stat();
    const pathAfter = await io.lstat(file);
    check();
    if (
      count !== opened.size ||
      !same(opened, after) ||
      !same(opened, pathAfter)
    )
      throw new Error("Saved attachment changed while reading");
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}

module.exports = { readImageSnapshot };
