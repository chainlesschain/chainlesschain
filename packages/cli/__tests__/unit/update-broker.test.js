import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  selfUpdateCli,
  updateProcessInvocations,
} from "../../src/commands/update.js";

describe("CLI self-update process broker boundary", () => {
  let originalSpawnSync;
  let originalPlatform;
  let originalExecPath;
  let originalCliEntryPath;

  beforeEach(() => {
    originalSpawnSync = _deps.spawnSync;
    originalPlatform = _deps.platform;
    originalExecPath = _deps.execPath;
    originalCliEntryPath = _deps.cliEntryPath;
    _deps.platform = "linux";
    _deps.execPath = "/usr/bin/node";
    _deps.cliEntryPath = "/opt/cc/bin/chainlesschain.js";
  });

  afterEach(() => {
    _deps.spawnSync = originalSpawnSync;
    _deps.platform = originalPlatform;
    _deps.execPath = originalExecPath;
    _deps.cliEntryPath = originalCliEntryPath;
  });

  it("selects process invocations without a shell", () => {
    expect(
      updateProcessInvocations(
        "linux",
        "/usr/bin/node",
        "/opt/cc/bin/chainlesschain.js",
      ),
    ).toEqual({
      npm: { command: "npm", prefixArgs: [] },
      chainlesschain: {
        command: "/usr/bin/node",
        prefixArgs: ["/opt/cc/bin/chainlesschain.js"],
      },
    });
    expect(
      updateProcessInvocations(
        "win32",
        "C:\\node\\node.exe",
        "C:\\npm\\node_modules\\chainlesschain\\bin\\chainlesschain.js",
      ),
    ).toEqual({
      npm: {
        command: "C:\\node\\node.exe",
        prefixArgs: ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js"],
      },
      chainlesschain: {
        command: "C:\\node\\node.exe",
        prefixArgs: [
          "C:\\npm\\node_modules\\chainlesschain\\bin\\chainlesschain.js",
        ],
      },
    });
  });

  it("passes package/version values as argv through scoped Broker calls", async () => {
    _deps.spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "9.9.9\n", stderr: "" });

    await expect(selfUpdateCli("9.9.9")).resolves.toBe(true);
    expect(_deps.spawnSync).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "-g", "chainlesschain@9.9.9"],
      {
        encoding: "utf-8",
        stdio: "pipe",
        origin: "update:npm-install",
        policy: "allow",
        scope: "update",
        shell: false,
      },
    );
    expect(_deps.spawnSync).toHaveBeenNthCalledWith(
      2,
      "/usr/bin/node",
      ["/opt/cc/bin/chainlesschain.js", "--version"],
      expect.objectContaining({
        origin: "update:version-check",
        policy: "allow",
        scope: "update",
        shell: false,
      }),
    );
  });

  it("fails the update when npm exits non-zero", async () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: "permission denied",
    }));

    await expect(selfUpdateCli("9.9.8")).resolves.toBe(false);
    expect(_deps.spawnSync).toHaveBeenCalledOnce();
  });

  it("preserves the existing best-effort success when verification fails", async () => {
    _deps.spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "missing" });

    await expect(selfUpdateCli("9.9.7")).resolves.toBe(true);
  });
});
