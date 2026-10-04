const fs = require("fs/promises");
const { constants } = require("fs");

// Fixed allocation + one overflow byte. Reads, hash and validation consume the
// same snapshot; no unbounded readFile after a separate header/path check.
async function readImageSnapshot(
  file,
  expectedSize = null,
  {
    io = fs,
    signal,
    timeoutMs = 5000,
    now = () => performance.now(),
    platform = process.platform,
  } = {},
) {
  const deadline = now() + timeoutMs;
  const check = () => {
    if (signal?.aborted) throw new Error("Image reading cancelled");
    if (now() >= deadline)
      throw new Error("Image reading exceeded the time budget");
  };
  // Node 22.12's Windows lstat fast path reports a 64-bit volume serial,
  // while fstat reports its low 32 bits (libuv #4698). Normalize only across
  // those APIs; each path/handle must still retain its full device identity.
  // BigInt stats also retain large inode IDs and nanosecond modification times.
  const device = (stat, crossApi) =>
    platform === "win32" && crossApi ? BigInt.asUintN(32, stat.dev) : stat.dev;
  const fields = ["size", "ino", "mtimeNs", "ctimeNs"];
  const same = (a, b, crossApi = false) =>
    a.isFile() &&
    b.isFile() &&
    ((platform === "win32" && crossApi && a.dev === 0n) ||
      device(a, crossApi) === device(b, crossApi)) &&
    fields.every((key) => a[key] === b[key]);
  check();
  const before = await io.lstat(file, { bigint: true });
  check();
  if (
    !before.isFile() ||
    before.size <= 0n ||
    before.size > 20n * 1024n * 1024n ||
    (expectedSize !== null && Number(before.size) !== expectedSize)
  )
    throw new Error("Saved attachment is missing or changed; attach it again");
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
  const handle = await io.open(file, flags);
  try {
    check();
    const opened = await handle.stat({ bigint: true });
    if (!same(before, opened, true)) {
      // Record only filesystem metadata, never the path or attachment bytes.
      // This distinguishes an actual replacement from platform stat API bugs.
      const differences = ["dev", ...fields]
        .filter((key) => before[key] !== opened[key])
        .map((key) => `${key}: ${before[key]} -> ${opened[key]}`);
      throw new Error(
        `Saved attachment changed while opening (${differences.join(", ")})`,
      );
    }
    // Some Windows path stat APIs report no volume identity at all (dev=0).
    // The first fstat is then the identity baseline. Verify that the path still
    // opens that exact file before/after reading, including its full device ID;
    // ignoring dev alone would accept a same-inode replacement on another disk.
    // Only the original descriptor supplies bytes. Probe descriptors are closed
    // even when metadata, cancellation or the elapsed budget rejects the read.
    const verifyPathHandle = async (phase) => {
      if (platform !== "win32" || before.dev !== 0n) return;
      check();
      const probe = await io.open(file, flags);
      try {
        check();
        const stat = await probe.stat({ bigint: true });
        check();
        if (!same(opened, stat))
          throw new Error(`Saved attachment changed while ${phase}`);
      } finally {
        await probe.close();
      }
      check();
    };
    await verifyPathHandle("opening");
    const size = Number(opened.size);
    const buffer = Buffer.alloc(size + 1);
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
    const after = await handle.stat({ bigint: true });
    const pathAfter = await io.lstat(file, { bigint: true });
    check();
    if (count !== size || !same(opened, after) || !same(before, pathAfter))
      throw new Error("Saved attachment changed while reading");
    await verifyPathHandle("reading");
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}

module.exports = { readImageSnapshot };
