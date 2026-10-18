import test from "node:test";
import assert from "node:assert/strict";
import storage from "../../session-core/lib/private-storage.js";
import { diagnosticAclCommandArgs } from "../scripts/windows-acl-diagnostic-mode.mjs";
import {
  readExecutionLocationStorageFailure,
  readExecutionLocationStorageLaunchFailure,
} from "../src/lib/execution-location-failure-site.js";

const stages = [
  "repair-wait",
  "repair-traversal",
  "repair-read",
  "repair-owner",
  "repair-protect",
  "repair-rules",
  "repair-persist",
  "repair-unlock",
  "verify",
  "verify-read",
  "verify-rules",
  "serialize",
  "output-complete",
];
function failure(stderr) {
  let calls = 0;
  const [result] = storage.inspectPrivatePaths(["C:\\private-secret"], {
    platform: "win32",
    deps: {
      spawnSync: () => {
        calls++;
        return {
          status: 0,
          stdout: JSON.stringify([{ target: "C:\\private-secret", ok: true }]),
          stderr,
          error: Object.assign(new Error("private-secret"), {
            code: "ETIMEDOUT",
            errno: -4039,
            syscall: "spawnSync powershell.exe",
          }),
        };
      },
    },
  });
  assert.equal(calls, 1, "no automatic retry");
  assert.equal(result.ok, false, "complete stdout cannot override timeout");
  assert.equal(result.error.includes("private-secret"), false);
  return result;
}

for (const stage of stages) {
  test(`timeout at ${stage} retains bounded timing through CLI sanitization`, () => {
    const result = failure(
      `private-secret\nCC_WINDOWS_ACL_STAGE=initialize\nCC_WINDOWS_ACL_ELAPSED_MS=initialize:0\nCC_WINDOWS_ACL_STAGE=${stage}\nCC_WINDOWS_ACL_ELAPSED_MS=${stage}:60000\n`,
    );
    assert.equal(result.launchFailure.progressStage, stage);
    assert.equal(result.launchFailure.elapsedMs, 60000);
    assert.equal(
      readExecutionLocationStorageFailure(result.error),
      `timeout-${stage}`,
    );
    assert.deepEqual(
      readExecutionLocationStorageLaunchFailure(result.error),
      result.launchFailure,
    );
  });
}

test("legacy markers preserve the old diagnostic shape", () => {
  const result = failure("CC_WINDOWS_ACL_STAGE=verify\n");
  assert.equal(Object.hasOwn(result.launchFailure, "elapsedMs"), false);
  assert.deepEqual(
    readExecutionLocationStorageLaunchFailure(result.error),
    result.launchFailure,
  );
});

test("single-path native failures retain fine stages and never admit or retry", () => {
  for (const stage of stages) {
    let calls = 0;
    assert.throws(
      () =>
        storage.ensurePrivateDirectory("C:\\acl-diagnostic-fixture", {
          platform: "win32",
          applyWindowsAcl: true,
          failIfUnavailable: true,
          deps: {
            fs: {
              existsSync: () => true,
              lstatSync: () => ({
                isSymbolicLink: () => false,
                isDirectory: () => true,
                mode: 0o700,
              }),
              mkdirSync: () => {},
            },
            spawnSync: () => {
              calls++;
              return {
                status: 5,
                stdout: JSON.stringify({
                  ownerOnly: false,
                  failureStage: stage,
                  hresult: "0x80070522",
                }),
                stderr: "private-native-error",
              };
            },
          },
        }),
      (error) => {
        assert.equal(error.message.includes("private-native-error"), false);
        assert.equal(
          readExecutionLocationStorageFailure(error.message),
          `${stage}:0x80070522`,
        );
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

for (const timing of [
  "-1",
  "300001",
  "1.5",
  "NaN",
  "Infinity",
  "0001",
  "private-secret",
  "999999999",
]) {
  test(`rejects invalid elapsed ${timing}`, () => {
    const result = failure(
      `CC_WINDOWS_ACL_STAGE=verify-read\nCC_WINDOWS_ACL_ELAPSED_MS=verify-read:${timing}\n`,
    );
    assert.equal(Object.hasOwn(result.launchFailure, "elapsedMs"), false);
    const parsed = readExecutionLocationStorageLaunchFailure(
      `${result.error} [windows-acl-elapsed:verify-read:${timing}]`,
    );
    assert.equal(Object.hasOwn(parsed, "elapsedMs"), false);
  });
}

test("ignores decreasing or mismatched timing and bounded-out diagnostics", () => {
  for (const stderr of [
    "CC_WINDOWS_ACL_STAGE=verify-read\nCC_WINDOWS_ACL_ELAPSED_MS=initialize:10\nCC_WINDOWS_ACL_ELAPSED_MS=verify-read:9\n",
    "CC_WINDOWS_ACL_STAGE=verify-read\nCC_WINDOWS_ACL_ELAPSED_MS=serialize:15\n",
    "CC_WINDOWS_ACL_STAGE=verify-read\n" +
      "x".repeat(8192) +
      "\nCC_WINDOWS_ACL_ELAPSED_MS=verify-read:15\n",
  ])
    assert.equal(
      Object.hasOwn(failure(stderr).launchFailure, "elapsedMs"),
      false,
    );
});

test("unknown stages and native failure payloads stay excluded", () => {
  const result = failure(
    "CC_WINDOWS_ACL_STAGE=private-secret\nCC_WINDOWS_ACL_ELAPSED_MS=private-secret:1\n",
  );
  assert.equal(result.launchFailure.progressStage, "startup");
  assert.equal(Object.hasOwn(result.launchFailure, "elapsedMs"), false);
  assert.equal(
    readExecutionLocationStorageLaunchFailure(
      "[windows-acl-launch:repair:timeout:private-secret:ETIMEDOUT:-4039:spawnSync]",
    ),
    null,
  );
  assert.equal(
    readExecutionLocationStorageFailure(
      "[windows-acl:verify-read:private-secret]",
    ),
    null,
  );
});

test("diagnostic module-path comparison changes only the declared initialization", () => {
  const source =
    "& { param([string]$target)\n$ErrorActionPreference = 'Stop'\n[Console]::Error.WriteLine('CC_WINDOWS_ACL_STAGE=initialize')\nGet-Item -LiteralPath $target }";
  const args = ["-NoProfile", "-Command", source, "C:\\private-fixture"];
  const baseline = diagnosticAclCommandArgs(args, "inherited");
  assert.deepEqual(baseline.args, args);
  assert.equal(baseline.originalScriptSha256, baseline.executedScriptSha256);
  const candidate = diagnosticAclCommandArgs(args, "builtin");
  assert.notEqual(
    candidate.originalScriptSha256,
    candidate.executedScriptSha256,
  );
  assert.equal(candidate.originalScriptSha256, baseline.originalScriptSha256);
  assert.equal(
    candidate.args[2].replace(
      "\n$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')",
      "",
    ),
    source,
  );
  assert.equal(args[2], source, "input command remains unmodified");
  assert.equal(candidate.args[3], args[3]);
});

test("diagnostic overlay rejects ambiguous commands and arbitrary modes", () => {
  for (const args of [
    [],
    ["-Command", "Get-Item"],
    [
      "-Command",
      "$ErrorActionPreference = 'Stop'\n$ErrorActionPreference = 'Stop'\nCC_WINDOWS_ACL_STAGE=",
    ],
  ])
    assert.throws(() => diagnosticAclCommandArgs(args, "builtin"));
  assert.throws(() =>
    diagnosticAclCommandArgs(["-Command", "unused"], "arbitrary"),
  );
});
