import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  buildWindowsProcessProof,
  byteDigest,
} from "../diagnostics/build-windows-process-proof.mjs";
import {
  digest,
  readWindowsNativeProcessProof,
  validateProcessProof,
} from "../verify01-long-engineering-watch.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-native-process-proof-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "helper.exe");
  fs.writeFileSync(executable, "fixture-only bytes; never executed");
  const pin = {
    executable,
    executableDigest: byteDigest(fs.readFileSync(executable)),
    sourceDigest: `sha256:${"a".repeat(64)}`,
  };
  const binding = { platform: "win32", processId: 42 };
  const report = {
    schema: "chainlesschain.windows-process-proof/v1",
    sourceDigest: pin.sourceDigest,
    processId: 42,
    startIdentity: "639274654190715226",
    executable: process.execPath,
    commandLine: '"node" "path with spaces" "你好"',
    bootIdentity: "windows-process-start",
    aliveBefore: true,
    aliveAfter: true,
  };
  return { root, pin, binding, report };
}
test("native proof keeps the original identity tuple and hashes exact command bytes", (t) => {
  const f = fixture(t);
  let calls = 0;
  const proof = readWindowsNativeProcessProof(f.binding, f.pin, {
    query(executable, args, options) {
      calls++;
      assert.equal(executable, f.pin.executable);
      assert.deepEqual(args, ["42"]);
      assert.equal(options.kind, "windows-native-single-handle");
      return f.report;
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(proof, {
    processId: 42,
    startIdentity: f.report.startIdentity,
    executable: f.report.executable,
    commandDigest: digest(f.report.commandLine),
    bootIdentity: "windows-process-start",
  });
  assert.equal(Object.hasOwn(proof, "commandLine"), false);
  validateProcessProof(proof, proof);
});
test("unpinned or tampered binaries are rejected before execution", (t) => {
  const f = fixture(t);
  const query = () => {
    throw new Error("must not execute");
  };
  for (const field of ["sourceDigest", "executableDigest"])
    assert.throws(
      () =>
        readWindowsNativeProcessProof(
          f.binding,
          { ...f.pin, [field]: undefined },
          { query },
        ),
      { code: "NATIVE_PROOF_PIN_REQUIRED" },
    );
  fs.appendFileSync(f.pin.executable, "changed");
  assert.throws(
    () => readWindowsNativeProcessProof(f.binding, f.pin, { query }),
    { code: "NATIVE_PROOF_BINARY_CHANGED" },
  );
});
test("binary changes during the native query reject the returned process facts", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      readWindowsNativeProcessProof(f.binding, f.pin, {
        query() {
          fs.appendFileSync(f.pin.executable, "changed");
          return f.report;
        },
      }),
    { code: "NATIVE_PROOF_BINARY_CHANGED" },
  );
});
for (const [field, changed] of [
  ["schema", "foreign"],
  ["sourceDigest", `sha256:${"b".repeat(64)}`],
  ["processId", 43],
  ["aliveBefore", false],
  ["aliveAfter", false],
  ["startIdentity", "invalid"],
  ["commandLine", ""],
  ["bootIdentity", "foreign"],
])
  test(`native query cannot legitimize invalid ${field}`, (t) => {
    const f = fixture(t);
    assert.throws(
      () =>
        readWindowsNativeProcessProof(f.binding, f.pin, {
          query: () => ({ ...f.report, [field]: changed }),
        }),
      { code: "NATIVE_PROOF_REPORT_INVALID" },
    );
  });
test("hard-link and symbolic-link aliases cannot supply a proof binary", (t) => {
  const f = fixture(t);
  const hardlink = path.join(f.root, "alias.exe");
  fs.linkSync(f.pin.executable, hardlink);
  assert.throws(
    () =>
      readWindowsNativeProcessProof(f.binding, f.pin, {
        query: () => f.report,
      }),
    { code: "NATIVE_PROOF_FILE_INVALID" },
  );
  // File symlink creation is not normally available to unprivileged Windows users.
  if (process.platform !== "win32") {
    const link = path.join(f.root, "symlink.exe");
    fs.symlinkSync(f.pin.executable, link);
    assert.throws(
      () =>
        readWindowsNativeProcessProof(
          f.binding,
          { ...f.pin, executable: link },
          { query: () => f.report },
        ),
      { code: "NATIVE_PROOF_FILE_INVALID" },
    );
  }
});

if (process.platform === "win32")
  test(
    "real same-handle query observes an own child and refuses it after exit",
    { timeout: 60_000 },
    async (t) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-process-proof-live-"),
      );
      // Avoid recursive deletion on Windows: retain build evidence for review.
      const pin = buildWindowsProcessProof(path.join(root, "build"));
      const target = path.join(root, "target.mjs");
      fs.writeFileSync(
        target,
        'process.stdout.write("ready\\n");setInterval(()=>{},1000);\n',
      );
      const child = spawn(process.execPath, [target, "quoted spaces", "你好"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      await Promise.race([
        once(child.stdout, "data", { signal: AbortSignal.timeout(15_000) }),
        once(child, "exit").then(() => {
          throw new Error("Target exited before readiness");
        }),
      ]);
      const identity = { platform: "win32", processId: child.pid };
      const proof = readWindowsNativeProcessProof(identity, pin);
      assert.equal(proof.processId, child.pid);
      assert.equal(proof.executable, process.execPath);
      assert.match(proof.startIdentity, /^\d+$/u);
      const second = readWindowsNativeProcessProof(identity, pin);
      validateProcessProof(proof, second);
      assert.throws(
        () => validateProcessProof({ ...proof, startIdentity: "1" }, second),
        { code: "PROCESS_IDENTITY_INVALID" },
      );
      const exited = once(child, "exit");
      child.kill();
      await exited;
      assert.throws(() => readWindowsNativeProcessProof(identity, pin), {
        code: "PROCESS_PROOF_UNAVAILABLE",
      });
      assert.throws(() => buildWindowsProcessProof(path.join(root, "build")), {
        code: "EEXIST",
      });
    },
  );
