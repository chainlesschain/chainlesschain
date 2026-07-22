import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  selfUpdateCli,
  updateExecutableNames,
} from "../../src/commands/update.js";

describe("CLI self-update process broker boundary", () => {
  let originalSpawnSync;
  let originalPlatform;

  beforeEach(() => {
    originalSpawnSync = _deps.spawnSync;
    originalPlatform = _deps.platform;
    _deps.platform = "linux";
  });

  afterEach(() => {
    _deps.spawnSync = originalSpawnSync;
    _deps.platform = originalPlatform;
  });

  it("selects executable shims without invoking a shell", () => {
    expect(updateExecutableNames("linux")).toEqual({
      npm: "npm",
      chainlesschain: "chainlesschain",
    });
    expect(updateExecutableNames("win32")).toEqual({
      npm: "npm.cmd",
      chainlesschain: "chainlesschain.cmd",
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
      "chainlesschain",
      ["--version"],
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
