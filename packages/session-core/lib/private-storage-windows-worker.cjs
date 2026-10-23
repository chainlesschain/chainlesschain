// Fixed-entry worker for spawnSync's existing process timeout. It never starts
// another process and does not accept code, module names or command arguments.
const fs = require("node:fs");
const { executeRequest } = require("./private-storage-windows-native.cjs");
const { createWindowsApi } = require("./private-storage-windows-api.cjs");
const { assertSafeOwnerOnlyPath } = require("./private-storage.js");
const MAX_INPUT = 4 * 1024 * 1024;

function main() {
  let request;
  try {
    if (
      process.platform !== "win32" ||
      process.versions.electron ||
      process.argv.length !== 2
    )
      throw new Error("unsupported worker invocation");
    const chunks = [];
    let bytes = 0;
    const buffer = Buffer.alloc(16384);
    for (;;) {
      const size = fs.readSync(
        0,
        buffer,
        0,
        Math.min(buffer.length, MAX_INPUT + 1 - bytes),
        null,
      );
      if (!size) break;
      bytes += size;
      if (bytes > MAX_INPUT) throw new Error("request too large");
      chunks.push(Buffer.from(buffer.subarray(0, size)));
    }
    request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const results = executeRequest(request, createWindowsApi(), {
      guard: assertSafeOwnerOnlyPath,
    });
    const output = JSON.stringify(results);
    if (Buffer.byteLength(output) > MAX_INPUT)
      throw new Error("response too large");
    fs.writeSync(1, output);
    process.exitCode = results.some((row) => row.ok !== true) ? 4 : 0;
  } catch (error) {
    const codes = [
      "INVALID_REQUEST",
      "UNSAFE_PATH",
      "PATH_PREFLIGHT_FAILED",
      "EXPECTED_KIND_MISMATCH",
      "PATH_IDENTITY_CHANGED",
      "FOREIGN_OWNER",
      "OWNER_CHANGED",
      "MUTEX_TIMEOUT",
      "DEADLINE_EXCEEDED",
      "HANDLE_CLOSE_FAILED",
      "OPEN_FAILED",
      "WIN32_FAILURE",
    ];
    const code = codes.includes(error?.code) ? error.code : "NATIVE_ACL_FAILED";
    // No exception message/stack, request values, identity or path in errors.
    fs.writeSync(2, `[windows-native-acl:${code}]\n`);
    if (
      Array.isArray(request?.targets) &&
      request.targets.length <= 500 &&
      request.targets.every((v) => typeof v === "string" && v.length <= 32760)
    ) {
      const output = JSON.stringify(
        request.targets.map((target) => ({
          target,
          exists: true,
          isDirectory: null,
          ok: false,
          error: `[windows-native-acl:${code}]`,
          errorCode: code,
        })),
      );
      if (Buffer.byteLength(output) <= MAX_INPUT) fs.writeSync(1, output);
    }
    process.exitCode = 4;
  }
}
if (require.main === module) {
  try {
    main();
  } catch {
    process.exitCode = 4;
  }
}
module.exports = { main };
