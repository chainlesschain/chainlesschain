import test from "node:test";
import assert from "node:assert/strict";
import storage from "../../session-core/lib/private-storage.js";
import {
  readExecutionLocationStorageFailure,
  readExecutionLocationStorageLaunchFailure,
} from "../src/lib/execution-location-failure-site.js";

const stages = [
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
