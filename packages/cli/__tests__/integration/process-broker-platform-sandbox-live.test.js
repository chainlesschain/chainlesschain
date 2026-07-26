/**
 * Real ProcessExecutionBroker platform-boundary smoke test.
 *
 * The dedicated CI matrix sets CC_SANDBOX_LIVE=1 on Linux, macOS, and
 * Windows. A missing native primitive must fail the test; it must never turn
 * into an always-green skip in that workflow.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const LIVE = process.env.CC_SANDBOX_LIVE === "1";
const SUPPORTED = ["linux", "darwin", "win32"].includes(process.platform);
const expectedEnforcement = {
  linux: "linux-prlimit",
  darwin: "macos-seatbelt",
  win32: "windows-job-restricted-token",
};

function quotePosix(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

describe.runIf(LIVE && SUPPORTED)(
  "live ProcessExecutionBroker strict platform boundary",
  () => {
    let previousStrict;
    let previousDisable;
    let previousSandboxEnabled;
    let previousPlatformEnabled;
    let forbiddenPath;

    beforeEach(() => {
      previousStrict = process.env.CC_SANDBOX_STRICT;
      previousDisable = process.env.CC_SANDBOX_DISABLE;
      previousSandboxEnabled = executionBroker._sandboxEnabled;
      previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker.flushAuditLog();
    });

    afterEach(() => {
      if (previousStrict === undefined) {
        delete process.env.CC_SANDBOX_STRICT;
      } else {
        process.env.CC_SANDBOX_STRICT = previousStrict;
      }
      if (previousDisable === undefined) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previousDisable;
      }
      executionBroker._sandboxEnabled = previousSandboxEnabled;
      executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      executionBroker.flushAuditLog();
      if (forbiddenPath) {
        fs.rmSync(forbiddenPath, { force: true });
      }
    });

    it("executes through the real strict adapter and records its enforcement", () => {
      let command;
      let args;
      if (process.platform === "win32") {
        command = process.execPath;
        args = [
          "-e",
          [
            'if (process.env.CC_WINDOWS_SANDBOX_PROFILE !== "strict") {',
            "  process.exit(70);",
            "}",
            'process.stdout.write("strict-ok");',
          ].join("\n"),
        ];
      } else if (process.platform === "darwin") {
        forbiddenPath = path.join(
          os.homedir(),
          `.cc-seatbelt-forbidden-${process.pid}-${Date.now()}`,
        );
        command = "/bin/sh";
        args = [
          "-c",
          `if printf blocked > ${quotePosix(
            forbiddenPath,
          )} 2>/dev/null; then exit 77; fi; printf strict-ok`,
        ];
      } else {
        command = "/bin/sh";
        args = [
          "-c",
          'test "$CHAINLESS_SANDBOXED" = "1" && test "$(ulimit -n)" -le 64 && printf strict-ok',
        ];
      }

      const result = executionBroker.spawnSync(command, args, {
        origin: "test:strict-platform-sandbox-live",
        scope: "sandbox-test",
        policy: "allow",
        encoding: "utf8",
        timeout: 30_000,
        env: process.env,
      });

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("strict-ok");
      if (forbiddenPath) {
        expect(fs.existsSync(forbiddenPath)).toBe(false);
      }
      expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
        sandboxed: true,
        sandboxState: "ready",
        sandboxProfile: "strict",
        sandboxEnforcement: expectedEnforcement[process.platform],
      });
    }, 45_000);
  },
);

describe.runIf(!LIVE || !SUPPORTED)(
  "live ProcessExecutionBroker strict platform boundary (gated off)",
  () => {
    it("requires CC_SANDBOX_LIVE=1 on a supported CI platform", () => {
      expect(LIVE && SUPPORTED).toBe(false);
    });
  },
);
