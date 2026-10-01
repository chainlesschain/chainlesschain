import { describe, expect, it } from "vitest";
import {
  captureStorageAuthorityEnvironment,
  restoreStorageAuthorityEnvironment,
  isPluginAuthorityEnvironmentKey,
  isValidEnvironmentKey,
} from "../../src/lib/authority-launch-environment.js";
import {
  captureClaudeStorageLaunchEnvironment,
  restoreClaudeStorageLaunchEnvironment,
} from "../../src/lib/claude-project-auto-memory.js";

describe("launcher storage authority environment", () => {
  it("rejects names that native process.env cannot represent without truncation", () => {
    for (const key of ["", "HOME\0suffix", "BAD=NAME", null, 42]) {
      expect(isValidEnvironmentKey(key)).toBe(false);
    }
    for (const key of ["TOOL_DEFAULT", "home", "MY.TOOL-HOME"]) {
      expect(isValidEnvironmentKey(key)).toBe(true);
    }
  });

  it("restores explicit and derived anchor locations and removes an introduced override", () => {
    const env = {
      HOME: "/launcher/home",
      USERPROFILE: "C:/launcher/profile",
      LOCALAPPDATA: "C:/launcher/local",
      XDG_STATE_HOME: "/launcher/state",
      CHAINLESSCHAIN_HOME: "/launcher/cli",
      TOOL_DEFAULT: "launcher",
    };
    const before = captureClaudeStorageLaunchEnvironment(env);
    expect(Object.isFrozen(before)).toBe(true);
    Object.assign(env, {
      HOME: "/workspace/home",
      USERPROFILE: "C:/workspace/profile",
      LOCALAPPDATA: "C:/workspace/local",
      XDG_STATE_HOME: "/workspace/state",
      CHAINLESSCHAIN_HOME: "/workspace/cli",
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: "/workspace/anchor",
      TOOL_DEFAULT: "settings",
    });
    restoreClaudeStorageLaunchEnvironment(before, env);
    expect(env).toEqual({
      ...before,
      TOOL_DEFAULT: "settings",
    });
    expect(env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME).toBeUndefined();
  });

  it("keeps the launcher anchor override immutable", () => {
    const env = { CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: "/launcher/anchor" };
    const before = captureClaudeStorageLaunchEnvironment(env);
    env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = "/workspace/anchor";
    restoreClaudeStorageLaunchEnvironment(before, env);
    expect(env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME).toBe("/launcher/anchor");
  });

  it("normalizes Windows aliases, including worker env objects, before capture and restore", () => {
    const options = { platform: "win32" };
    const env = { home: "trusted", ProgramData: "managed", Tool: "keep" };
    const before = captureStorageAuthorityEnvironment(env, options);
    expect(before).toEqual({ HOME: "trusted", PROGRAMDATA: "managed" });
    env.HOME = "redirected";
    env.chainLessChain_security_anchor_home = "workspace-anchor";
    env.programdata = "workspace-managed";
    restoreStorageAuthorityEnvironment(before, env, options);
    expect(env).toEqual({
      HOME: "trusted",
      PROGRAMDATA: "managed",
      Tool: "keep",
    });
    expect(isPluginAuthorityEnvironmentKey("home", options)).toBe(true);
    expect(
      isPluginAuthorityEnvironmentKey("cC_pErMiSsIoNs_AlLoW", options),
    ).toBe(true);
  });

  it("rejects conflicting Windows launch aliases before changing the target env", () => {
    const options = { platform: "win32" };
    const ambiguous = { HOME: "trusted", home: "redirected" };
    expect(() =>
      captureStorageAuthorityEnvironment(ambiguous, options),
    ).toThrow(
      expect.objectContaining({ code: "CC_STORAGE_AUTHORITY_ENV_AMBIGUOUS" }),
    );
    const target = { HOME: "keep", TOOL_DEFAULT: "keep" };
    expect(() =>
      restoreStorageAuthorityEnvironment(ambiguous, target, options),
    ).toThrow();
    expect(target).toEqual({ HOME: "keep", TOOL_DEFAULT: "keep" });
  });

  it("retains case-sensitive POSIX tool env without treating it as HOME", () => {
    const options = { platform: "linux" };
    const env = { HOME: "trusted", home: "tool-default" };
    const before = captureStorageAuthorityEnvironment(env, options);
    env.HOME = "redirected";
    restoreStorageAuthorityEnvironment(before, env, options);
    expect(env).toEqual({ HOME: "trusted", home: "tool-default" });
    expect(isPluginAuthorityEnvironmentKey("home", options)).toBe(false);
  });
});
