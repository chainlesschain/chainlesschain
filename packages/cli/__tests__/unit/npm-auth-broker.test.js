import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  getCurrentUser,
  isLoggedIn,
  login,
  logout,
} from "../../src/auth/npm-auth.js";

describe("npm auth process broker boundary", () => {
  let originalExecFileSync;
  let originalPlatform;
  let originalExecPath;

  beforeEach(() => {
    originalExecFileSync = _deps.execFileSync;
    originalPlatform = _deps.platform;
    originalExecPath = _deps.execPath;
    _deps.platform = "linux";
    _deps.execPath = "/usr/bin/node";
  });

  afterEach(() => {
    _deps.execFileSync = originalExecFileSync;
    _deps.platform = originalPlatform;
    _deps.execPath = originalExecPath;
  });

  it("checks login state and username through the injected execution seam", () => {
    _deps.execFileSync = vi.fn((_command, _args, options) =>
      options.encoding ? "alice\n" : "",
    );

    expect(isLoggedIn()).toBe(true);
    expect(getCurrentUser()).toBe("alice");
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["whoami"],
      expect.objectContaining({
        stdio: "ignore",
        origin: "auth:npm",
        policy: "allow",
        scope: "auth",
        shell: false,
      }),
    );
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["whoami"],
      expect.objectContaining({
        encoding: "utf8",
        origin: "auth:npm",
        shell: false,
      }),
    );
  });

  it("uses node.exe plus npm-cli.js on Windows", () => {
    _deps.platform = "win32";
    _deps.execPath = "C:\\node\\node.exe";
    _deps.execFileSync = vi.fn(() => "alice\n");

    expect(getCurrentUser()).toBe("alice");
    expect(_deps.execFileSync).toHaveBeenCalledWith(
      "C:\\node\\node.exe",
      ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js", "whoami"],
      expect.objectContaining({
        origin: "auth:npm",
        scope: "auth",
        shell: false,
      }),
    );
  });

  it("runs login and verifies the resulting identity", async () => {
    _deps.execFileSync = vi.fn(() => "");

    await expect(login()).resolves.toBe(true);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["login"],
      expect.objectContaining({ stdio: "inherit", shell: false }),
    );
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["whoami"],
      expect.objectContaining({ stdio: "ignore", shell: false }),
    );
  });

  it("runs logout and verifies the identity is gone", async () => {
    _deps.execFileSync = vi
      .fn()
      .mockReturnValueOnce("")
      .mockImplementationOnce(() => {
        throw new Error("not logged in");
      });

    await expect(logout()).resolves.toBe(true);
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["logout"],
      expect.objectContaining({ stdio: "inherit", shell: false }),
    );
    expect(_deps.execFileSync).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["whoami"],
      expect.objectContaining({ stdio: "ignore", shell: false }),
    );
  });

  it("fails closed when the execution seam rejects auth commands", async () => {
    _deps.execFileSync = vi.fn(() => {
      throw new Error("broker denied");
    });

    expect(isLoggedIn()).toBe(false);
    expect(getCurrentUser()).toBeNull();
    await expect(login()).resolves.toBe(false);
    await expect(logout()).resolves.toBe(false);
  });
});
