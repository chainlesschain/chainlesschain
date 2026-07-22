import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  getCurrentUser,
  isLoggedIn,
  login,
  logout,
} from "../../src/auth/npm-auth.js";

describe("npm auth process broker boundary", () => {
  let originalExecSync;

  beforeEach(() => {
    originalExecSync = _deps.execSync;
  });

  afterEach(() => {
    _deps.execSync = originalExecSync;
  });

  it("checks login state and username through the injected execution seam", () => {
    _deps.execSync = vi.fn((_command, options) =>
      options.encoding ? "alice\n" : "",
    );

    expect(isLoggedIn()).toBe(true);
    expect(getCurrentUser()).toBe("alice");
    expect(_deps.execSync).toHaveBeenNthCalledWith(1, "npm whoami", {
      stdio: "ignore",
    });
    expect(_deps.execSync).toHaveBeenNthCalledWith(2, "npm whoami", {
      encoding: "utf8",
    });
  });

  it("runs login and verifies the resulting identity", async () => {
    _deps.execSync = vi.fn(() => "");

    await expect(login()).resolves.toBe(true);
    expect(_deps.execSync.mock.calls).toEqual([
      ["npm login", { stdio: "inherit" }],
      ["npm whoami", { stdio: "ignore" }],
    ]);
  });

  it("runs logout and verifies the identity is gone", async () => {
    _deps.execSync = vi
      .fn()
      .mockReturnValueOnce("")
      .mockImplementationOnce(() => {
        throw new Error("not logged in");
      });

    await expect(logout()).resolves.toBe(true);
    expect(_deps.execSync.mock.calls).toEqual([
      ["npm logout", { stdio: "inherit" }],
      ["npm whoami", { stdio: "ignore" }],
    ]);
  });

  it("fails closed when the execution seam rejects auth commands", async () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("broker denied");
    });

    expect(isLoggedIn()).toBe(false);
    expect(getCurrentUser()).toBeNull();
    await expect(login()).resolves.toBe(false);
    await expect(logout()).resolves.toBe(false);
  });
});
