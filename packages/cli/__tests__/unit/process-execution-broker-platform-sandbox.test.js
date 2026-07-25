import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySandbox,
  applyWindowsSandbox,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

function createChild(pid = 4102) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}

function appliedPlan(command, args, options, overrides = {}) {
  return {
    contractVersion: 1,
    applied: true,
    platform: "test",
    profile: "default",
    command,
    args,
    options,
    enforcement: "test-sandbox",
    reason: null,
    postSpawn: { required: false, mode: "none" },
    ...overrides,
  };
}

describe("platform sandbox adapter contract", () => {
  it("reports the implicit macOS profile unavailable without altering the invocation", () => {
    const options = { shell: true, cwd: "/workspace" };
    const plan = applySandbox("echo ready", [], options, "default", {
      platform: "darwin",
      fs: { existsSync: vi.fn(() => true) },
    });

    expect(plan).toMatchObject({
      applied: false,
      platform: "darwin",
      profile: "default",
      command: "echo ready",
      args: [],
      options,
      reason: "macos_default_profile_requires_explicit_policy",
    });
  });

  it("returns a macOS Seatbelt wrapper as the executable spawn plan", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };

    const plan = applySandbox("node", ["script.js"], options, "strict", {
      platform: "darwin",
      fs: fsRuntime,
      tmpdir: () => "/sandbox-tmp",
      randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "darwin",
      profile: "strict",
      command: "/usr/bin/sandbox-exec",
      enforcement: "macos-seatbelt",
      postSpawn: { required: false, mode: "none" },
    });
    expect(plan.args[0]).toBe("-f");
    expect(plan.args.slice(2)).toEqual(["node", "script.js"]);
    expect(plan.options).toEqual(options);
    expect(fsRuntime.writeFileSync).toHaveBeenCalledOnce();

    plan.cleanup();
    expect(fsRuntime.unlinkSync).toHaveBeenCalledOnce();
  });

  it("preserves shell command semantics behind an explicit macOS wrapper", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "network-only",
      {
        platform: "darwin",
        fs: fsRuntime,
        tmpdir: () => "/sandbox-tmp",
        randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
    plan.cleanup();
  });

  it("returns the Linux prlimit wrapper and marked child environment", () => {
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };
    const plan = applySandbox("node", ["script.js"], options, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => true) },
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "linux",
      profile: "default",
      command: "/usr/bin/prlimit",
      enforcement: "linux-prlimit",
    });
    expect(plan.args).toEqual([
      "--cpu=30",
      "--nofile=256",
      "--",
      "node",
      "script.js",
    ]);
    expect(plan.options.env).toEqual({
      PATH: "/usr/bin",
      CHAINLESS_SANDBOXED: "1",
    });
    expect(options.env).toEqual({ PATH: "/usr/bin" });
  });

  it("preserves shell command semantics behind the Linux wrapper", () => {
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "default",
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
  });

  it("does not claim Windows native isolation before it is implemented", () => {
    const options = { windowsHide: true, env: { PATH: "C:\\Windows" } };
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      options,
      { profileName: "strict" },
      { platform: "win32" },
    );

    expect(plan).toMatchObject({
      applied: false,
      platform: "win32",
      profile: "strict",
      command: "tool.exe",
      args: ["run"],
      reason: "windows_native_job_object_unavailable",
      postSpawn: { required: false, mode: "none" },
    });
    expect(plan.options).toEqual(options);
    expect(options).toEqual({
      windowsHide: true,
      env: { PATH: "C:\\Windows" },
    });
  });

  it("reports Linux unavailable when the wrapper is missing", () => {
    const plan = applySandbox("node", [], {}, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => false) },
    });

    expect(plan).toMatchObject({
      applied: false,
      command: "node",
      args: [],
      reason: "linux_prlimit_unavailable",
    });
  });
});

describe("ProcessExecutionBroker sandbox-plan consumption", () => {
  let originalNative;
  let originalAdapter;
  let originalSandboxEnabled;
  let originalPlatformSandboxEnabled;
  let originalCredentialFiltering;
  let originalCredentialAgentEnabled;
  let originalDisable;
  let originalStrict;
  let emitWarning;

  beforeEach(() => {
    originalNative = executionBroker._native;
    originalAdapter = executionBroker._sandboxAdapter;
    originalSandboxEnabled = executionBroker._sandboxEnabled;
    originalPlatformSandboxEnabled = executionBroker._platformSandboxEnabled;
    originalCredentialFiltering = executionBroker._credentialFilteringEnabled;
    originalCredentialAgentEnabled = executionBroker._credentialAgentEnabled;
    originalDisable = process.env.CC_SANDBOX_DISABLE;
    originalStrict = process.env.CC_SANDBOX_STRICT;

    delete process.env.CC_SANDBOX_DISABLE;
    delete process.env.CC_SANDBOX_STRICT;
    executionBroker._sandboxEnabled = true;
    executionBroker._platformSandboxEnabled = true;
    executionBroker._credentialFilteringEnabled = false;
    executionBroker._credentialAgentEnabled = false;
    executionBroker.flushAuditLog();
    emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
  });

  afterEach(() => {
    executionBroker._native = originalNative;
    executionBroker._sandboxAdapter = originalAdapter;
    executionBroker._sandboxEnabled = originalSandboxEnabled;
    executionBroker._platformSandboxEnabled = originalPlatformSandboxEnabled;
    executionBroker._credentialFilteringEnabled = originalCredentialFiltering;
    executionBroker._credentialAgentEnabled = originalCredentialAgentEnabled;
    if (originalDisable === undefined) {
      delete process.env.CC_SANDBOX_DISABLE;
    } else {
      process.env.CC_SANDBOX_DISABLE = originalDisable;
    }
    if (originalStrict === undefined) {
      delete process.env.CC_SANDBOX_STRICT;
    } else {
      process.env.CC_SANDBOX_STRICT = originalStrict;
    }
    executionBroker.flushAuditLog();
    emitWarning.mockRestore();
  });

  it("passes adapter command, args, and options to async native spawn", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], {
        ...options,
        sandboxOption: true,
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    const returned = executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-plan",
      policy: "allow",
      env: { PATH: "safe" },
    });

    expect(returned).toBe(child);
    expect(nativeSpawn).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({
        sandboxOption: true,
        env: { PATH: "safe" },
      }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxProfile: "default",
      sandboxEnforcement: "test-sandbox",
      sandboxState: "ready",
    });
  });

  it("passes adapter command, args, and options to native spawnSync", () => {
    const nativeSpawnSync = vi.fn(() => ({ status: 0 }));
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan("sandbox-wrapper", ["--", command, ...args], {
          ...options,
          sandboxOption: true,
        }),
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawnSync("tool", ["run"], {
      origin: "test:sandbox-plan-sync",
      policy: "allow",
    });

    expect(nativeSpawnSync).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({ sandboxOption: true }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxEnforcement: "test-sandbox",
    });
  });

  it("honors CC_SANDBOX_DISABLE without calling the adapter", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-disabled",
      policy: "allow",
    });

    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).toHaveBeenCalledWith(
      "tool",
      ["run"],
      expect.any(Object),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "unavailable",
      sandboxReason: "disabled_by_environment",
    });
  });

  it("does not let CC_SANDBOX_DISABLE bypass strict mode", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-disabled-strict",
        policy: "allow",
      }),
    ).toThrow(/disabled_by_environment/);
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects an unavailable platform before spawn in strict mode", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) => ({
        contractVersion: 1,
        applied: false,
        platform: "win32",
        profile: "default",
        command,
        args,
        options,
        enforcement: null,
        reason: "windows_native_job_object_unavailable",
        postSpawn: { required: false, mode: "none" },
      }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict",
        policy: "allow",
      }),
    ).toThrow(/windows_native_job_object_unavailable/);
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "windows_native_job_object_unavailable",
    });
  });

  it("rejects the legacy newCommand/newArgs adapter shape", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: () => ({
        applied: true,
        newCommand: "legacy-wrapper",
        newArgs: ["tool"],
      }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-legacy-plan",
        policy: "allow",
      }),
    ).toThrow(/contractVersion must be 1/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects required async post-spawn enforcement before strict spawn", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
        }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict-async",
        policy: "allow",
      }),
    ).toThrow(/synchronous post-spawn enforcement/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("kills the child and throws when strict synchronous post-spawn fails", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "sync" },
        }),
      postSpawnSandbox: () => {
        throw new Error("job association failed");
      },
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-post-spawn",
        policy: "allow",
      }),
    ).toThrow(/Post-spawn sandbox setup failed/);
    expect(nativeSpawn).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "post_spawn_failed",
    });
  });

  it("exposes non-strict asynchronous post-spawn failure on sandboxReady", async () => {
    const child = createChild();
    executionBroker._native = { spawn: vi.fn(() => child) };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
        }),
      postSpawnSandbox: () => Promise.reject(new Error("late failure")),
    };

    executionBroker.spawn("tool", [], {
      origin: "test:sandbox-async-observable",
      policy: "allow",
    });

    await expect(child.sandboxReady).rejects.toThrow("late failure");
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "failed",
      sandboxReason: "post_spawn_failed: late failure",
    });
    expect(emitWarning).toHaveBeenCalled();
  });
});
