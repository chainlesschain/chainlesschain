// Fixed-entry isolated worker. The host enforces a process-kill deadline for
// every request, including when this process is reused. It never accepts code.
const fs = require("node:fs");
const { executeRequest } = require("./private-storage-windows-native.cjs");
const { createWindowsApi } = require("./private-storage-windows-api.cjs");
const { assertSafeOwnerOnlyPath } = require("./private-storage.js");
const MAX_INPUT = 4 * 1024 * 1024;

let windowsApi;
function runRequest(request) {
  try {
    // Only DLL bindings are reused. executeRequest reads the current token and
    // reopens, checks and closes every path/ACL/mutex for each operation.
    windowsApi ??= createWindowsApi();
    const results = executeRequest(request, windowsApi, {
      guard: assertSafeOwnerOnlyPath,
    });
    const output = JSON.stringify(results);
    if (Buffer.byteLength(output) > MAX_INPUT)
      throw new Error("response too large");
    return {
      status: results.some((row) => row.ok !== true) ? 4 : 0,
      stdout: output,
      stderr: "",
    };
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
    let stdout = "";
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
      if (Buffer.byteLength(output) <= MAX_INPUT) stdout = output;
    }
    return { status: 4, stdout, stderr: `[windows-native-acl:${code}]\n` };
  }
}

function main() {
  const persistent =
    process.argv.length === 3 && process.argv[2] === "--persistent";
  if (
    process.platform !== "win32" ||
    process.versions.electron ||
    (!persistent && process.argv.length !== 2)
  )
    throw new Error("unsupported worker invocation");
  if (persistent) {
    let pending = Buffer.alloc(0);
    process.stdin.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_INPUT + 256) return process.exit(4);
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      // A host issues exactly one synchronous request at a time.
      if (newline !== pending.length - 1) return process.exit(4);
      let envelope;
      try {
        envelope = JSON.parse(pending.subarray(0, newline).toString("utf8"));
      } catch {
        return process.exit(4);
      }
      pending = Buffer.alloc(0);
      if (
        typeof envelope?.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(envelope.id) ||
        Object.keys(envelope).some((key) => !["id", "request"].includes(key))
      )
        return process.exit(4);
      fs.writeSync(
        1,
        `${JSON.stringify({ id: envelope.id, ...runRequest(envelope.request) })}\n`,
      );
    });
    process.stdin.on("end", () => process.exit(pending.length ? 4 : 0));
    return;
  }
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
  const result = runRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  fs.writeSync(1, result.stdout);
  fs.writeSync(2, result.stderr);
  process.exitCode = result.status;
}
if (require.main === module) {
  try {
    main();
  } catch {
    process.exitCode = 4;
  }
}
module.exports = { main };
