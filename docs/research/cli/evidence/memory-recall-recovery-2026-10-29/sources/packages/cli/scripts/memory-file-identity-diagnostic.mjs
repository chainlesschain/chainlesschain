// Read-only environment evidence apart from one owned, temporary fixture.
// This diagnoses path/handle projections; it does not relax the release tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isAffectedWindowsZeroDeviceStatRuntime,
  samePathHandleStableFileIdentity,
  withTrustedFileParentSync,
} from "../src/lib/secure-file-identity.js";

const parent = fs.realpathSync.native(os.tmpdir());
const prefix = "cc-memory-identity-";
const root = fs.mkdtempSync(path.join(parent, prefix));
const report = {
  schema: "chainlesschain.memory-file-identity-diagnostic/v1",
  node: process.version,
  uv: process.versions.uv,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  affectedDeviceProjectionRuntime: isAffectedWindowsZeroDeviceStatRuntime(),
  sourceSha256: Object.fromEntries(
    [
      import.meta.url,
      new URL("../src/lib/secure-file-identity.js", import.meta.url).href,
      new URL(
        "../src/lib/context-memory-kernel/memory-query-bundle.js",
        import.meta.url,
      ).href,
    ].map((url) => [
      path.basename(new URL(url).pathname),
      createHash("sha256")
        .update(fs.readFileSync(new URL(url)))
        .digest("hex"),
    ]),
  ),
  flags: {
    O_NOFOLLOW: fs.constants.O_NOFOLLOW ?? null,
    O_NONBLOCK: fs.constants.O_NONBLOCK ?? null,
  },
  observations: [],
};
function fields(stat) {
  return Object.fromEntries(
    [
      "dev",
      "ino",
      "mode",
      "nlink",
      "size",
      "mtimeMs",
      "ctimeMs",
      "mtimeNs",
      "ctimeNs",
    ].map((key) => [key, stat[key]]),
  );
}
function inspect(file, descriptor) {
  const pathStat = fs.lstatSync(file, { bigint: true });
  const handleStat = fs.fstatSync(descriptor, { bigint: true });
  const result = {
    pathNumber: fields(fs.lstatSync(file)),
    handleNumber: fields(fs.fstatSync(descriptor)),
    pathBigInt: fields(pathStat),
    handleBigInt: fields(handleStat),
  };
  try {
    result.parent = withTrustedFileParentSync(
      fs,
      file,
      ({ parentPath, parentDevice, parentDescriptor }) => ({
        trustedDevice: parentDevice,
        pathNumber: fields(fs.lstatSync(parentPath)),
        handleNumber: fields(fs.fstatSync(parentDescriptor)),
        pathBigInt: fields(fs.lstatSync(parentPath, { bigint: true })),
        handleBigInt: fields(fs.fstatSync(parentDescriptor, { bigint: true })),
        fileIdentityMatches: samePathHandleStableFileIdentity(
          pathStat,
          handleStat,
          parentDevice,
        ),
      }),
    );
  } catch (error) {
    // Keep raw path/handle evidence even if parent authentication itself fails.
    result.parentError = { code: error.code, message: error.message };
  }
  return result;
}
try {
  const file = path.join(root, "fixture.bin");
  fs.writeFileSync(file, "memory identity diagnostic fixture", {
    flag: "wx",
    mode: 0o600,
  });
  const operations = [
    ["read-string-flags", file, "r"],
    [
      "read-bundle-flags",
      file,
      fs.constants.O_RDONLY |
        (fs.constants.O_NOFOLLOW || 0) |
        (fs.constants.O_NONBLOCK || 0),
    ],
    [
      "write-bundle-flags",
      path.join(root, "temporary.bin"),
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
    ],
  ];
  for (const [operation, target, flags] of operations) {
    let descriptor;
    try {
      descriptor = fs.openSync(target, flags, 0o600);
      if (operation === "write-bundle-flags") {
        fs.writeFileSync(descriptor, "temporary identity diagnostic fixture");
        fs.fsyncSync(descriptor);
      }
      report.observations.push({
        operation,
        flags,
        ...inspect(target, descriptor),
      });
    } catch (error) {
      report.observations.push({
        operation,
        flags,
        error: { code: error.code, message: error.message },
      });
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
} finally {
  if (
    path.dirname(path.resolve(root)) !== parent ||
    !path.basename(root).startsWith(prefix) ||
    fs.realpathSync.native(root) !== path.resolve(root)
  )
    throw new Error("Unsafe memory identity diagnostic fixture cleanup");
  fs.rmSync(root, { recursive: true, force: true });
}
const output =
  JSON.stringify(
    report,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) + "\n";
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1) {
  if (!process.argv[outputIndex + 1])
    throw new Error("--output requires a path");
  fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), output, {
    flag: "wx",
  });
}
process.stdout.write(output);
