import { EventEmitter, once } from "node:events";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
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
    const profile = fsRuntime.writeFileSync.mock.calls[0][1];
    expect(profile).toContain('(import "system.sb")');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(allow file-read* (subpath "/usr/bin"))');
    expect(profile).toContain(
      '(allow file-read* file-write* (literal "/dev/null")',
    );

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

  it("returns the Windows Job Object + restricted-token wrapper plan", () => {
    let compiled = false;
    const fsRuntime = {
      existsSync: vi.fn(
        (value) =>
          !String(value).endsWith(".exe") ||
          String(value).endsWith("powershell.exe") ||
          (compiled && String(value).includes("chainless-win-sandbox-")),
      ),
      readFileSync: vi.fn(() => "param([string]$Payload)"),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const options = { windowsHide: true, env: { PATH: "C:\\Windows" } };
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      options,
      { profileName: "strict" },
      {
        platform: "win32",
        fs: fsRuntime,
        windowsDir: () => "C:\\Windows",
        moduleDir: "C:\\cli",
        tmpdir: () => "C:\\temp",
        randomBytes: () => Buffer.alloc(12, 7),
        joinPath: path.win32.join,
        spawnSync: vi.fn(() => {
          compiled = true;
          return { status: 0, stdout: "", stderr: "" };
        }),
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      platform: "win32",
      profile: "strict",
      command: expect.stringMatching(
        /^C:\\temp\\chainless-win-sandbox-[a-f0-9]+\.exe$/,
      ),
      enforcement: "windows-job-restricted-token",
      postSpawn: { required: false, mode: "none" },
    });
    const payload = JSON.parse(
      Buffer.from(plan.args.at(-1), "base64").toString("utf8"),
    );
    expect(payload).toEqual({
      cpuSeconds: 0,
      processMemoryBytes: 256 * 1024 * 1024,
      activeProcessLimit: 16,
      command: "tool.exe",
      args: ["run"],
      nodeIpcFd: -1,
      windowsHide: true,
    });
    expect(plan.options).toMatchObject({
      windowsHide: true,
      shell: false,
      env: {
        PATH: "C:\\Windows",
        CC_WINDOWS_SANDBOXED: "1",
        CC_WINDOWS_SANDBOX_PROFILE: "strict",
      },
    });
    expect(fsRuntime.writeFileSync).toHaveBeenCalledOnce();
    expect(fsRuntime.unlinkSync).toHaveBeenCalledOnce();
    expect(options).toEqual({
      windowsHide: true,
      env: { PATH: "C:\\Windows" },
    });
    plan.cleanup();
    expect(fsRuntime.unlinkSync).toHaveBeenCalledOnce();
  });

  it("reports Windows unavailable when its native host is missing", () => {
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict" },
      {
        platform: "win32",
        fs: {
          existsSync: vi.fn(() => false),
          writeFileSync: vi.fn(),
          unlinkSync: vi.fn(),
        },
        windowsDir: () => "C:\\Windows",
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: () => Buffer.alloc(12, 3),
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_powershell_host_unavailable",
    });
  });

  it("preserves Node IPC stdio in the Windows restricted-token plan", () => {
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      { profileName: "default" },
      {
        platform: "win32",
        fs: {
          existsSync: vi.fn(() => true),
          unlinkSync: vi.fn(),
        },
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 4),
        joinPath: path.win32.join,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      options: { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      postSpawn: { required: false, mode: "none" },
    });
  });

  it("fails closed for unsupported Windows descriptors above the IPC fd", () => {
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc", "pipe"] },
      { profileName: "strict" },
      {
        platform: "win32",
        fs: { existsSync: vi.fn(() => true) },
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      command: process.execPath,
      args: ["child.js"],
      reason: "windows_extra_descriptor_unsupported",
    });
  });

  it("resolves detached Windows launches to the target PID synchronously", () => {
    const unlinkSync = vi.fn();
    const readFileSync = vi.fn(() =>
      JSON.stringify({ targetPid: 5103, helperPid: 4102 }),
    );
    const plan = applyWindowsSandbox(
      process.execPath,
      ["worker.js"],
      { detached: true, stdio: "ignore" },
      { profileName: "default" },
      {
        platform: "win32",
        fs: {
          existsSync: vi.fn(() => true),
          readFileSync,
          unlinkSync,
        },
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 5),
        joinPath: path.win32.join,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      postSpawn: { required: true, mode: "sync" },
    });
    const child = createChild(4102);
    expect(plan.postSpawnWindows(child)).toEqual({
      targetPid: 5103,
      wrapperPid: 4102,
    });
    expect(child).toMatchObject({
      pid: 5103,
      sandboxTargetPid: 5103,
      sandboxWrapperPid: 4102,
    });
    expect(readFileSync).toHaveBeenCalledOnce();
    expect(unlinkSync).toHaveBeenCalledOnce();
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

describe.runIf(process.platform === "win32")(
  "Windows sandbox live enforcement",
  () => {
    it("starts a real child only after the native wrapper is active", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      try {
        const result = executionBroker.spawnSync(
          process.execPath,
          [
            "-e",
            [
              "const { spawn } = require('node:child_process');",
              "const grandchild = spawn(",
              "  process.execPath,",
              "  ['-e', 'setInterval(() => {}, 1000)'],",
              "  { detached: true, stdio: 'ignore' },",
              ");",
              "grandchild.unref();",
              "process.stdout.write(JSON.stringify({",
              "  sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "  profile: process.env.CC_WINDOWS_SANDBOX_PROFILE,",
              "  grandchildPid: grandchild.pid,",
              "}));",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const childReport = JSON.parse(result.stdout);
        expect(childReport).toMatchObject({
          sandboxed: "1",
          profile: "strict",
        });
        expect(childReport.grandchildPid).toBeGreaterThan(0);

        // Query the restricted token through a second direct adapter launch.
        // Starting whoami as a nested process is flaky on hosted Windows
        // runners (STATUS_DLL_INIT_FAILED) and tests the nested loader more
        // than the token assigned by this adapter.
        const privilegeResult = executionBroker.spawnSync(
          path.join(process.env.WINDIR, "System32", "whoami.exe"),
          ["/priv"],
          {
            origin: "test:windows-restricted-token-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(privilegeResult.error).toBeUndefined();
        expect(privilegeResult.status, privilegeResult.stderr).toBe(0);
        const privileges = [
          ...(privilegeResult.stdout || "").matchAll(
            /\bSe[A-Za-z]+Privilege\b/g,
          ),
        ].map((match) => match[0]);
        expect(
          privileges.every((name) => name === "SeChangeNotifyPrivilege"),
        ).toBe(true);
        expect(() => process.kill(childReport.grandchildPid, 0)).toThrow();
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const shellResult = executionBroker.spawnSync(
          "echo windows-shell-ok",
          [],
          {
            origin: "test:windows-native-sandbox-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(shellResult.status, shellResult.stderr).toBe(0);
        expect(shellResult.stdout.trim()).toBe("windows-shell-ok");

        const quotedShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('quoted-shell-ok')"`,
          [],
          {
            origin: "test:windows-native-sandbox-quoted-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(quotedShellResult.status, quotedShellResult.stderr).toBe(0);
        expect(quotedShellResult.stdout).toBe("quoted-shell-ok");

        const largeShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('x'.repeat(2*1024*1024))"`,
          [],
          {
            origin: "test:windows-native-sandbox-large-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(largeShellResult.status, largeShellResult.stderr).toBe(0);
        expect(largeShellResult.stdout).toHaveLength(2 * 1024 * 1024);
      } finally {
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
      }
    }, 45_000);

    it("preserves a real Node fd3 IPC channel through the native adapter", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      try {
        child = executionBroker.spawn(
          process.execPath,
          [
            "-e",
            [
              "process.on('message', (message) => {",
              "  process.send({",
              "    echo: message,",
              "    sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "    pid: process.pid,",
              "  }, () => {",
              "    process.disconnect();",
              "    setTimeout(() => process.exit(0), 500);",
              "  });",
              "});",
              "process.send({ ready: true });",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-ipc-live",
            policy: "allow",
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            timeout: 30_000,
            env: process.env,
          },
        );
        const stderr = [];
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        const disconnectPromise = once(child, "disconnect");
        const exitPromise = once(child, "exit");
        const report = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for sandbox IPC")),
            30_000,
          );
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            reject(
              new Error(
                `Sandbox IPC child exited before echo (${code}/${signal}): ${Buffer.concat(
                  stderr,
                ).toString()}`,
              ),
            );
          });
          child.on("message", (message) => {
            if (message?.ready) {
              child.send({ ping: "pong" }, (error) => {
                if (error) reject(error);
              });
              return;
            }
            clearTimeout(timeout);
            resolve(message);
          });
        });
        expect(report).toMatchObject({
          echo: { ping: "pong" },
          sandboxed: "1",
        });
        expect(report.pid).toBeGreaterThan(0);
        await disconnectPromise;
        expect(child.connected).toBe(false);
        expect(child.exitCode).toBeNull();
        const [code, signal] = await exitPromise;
        expect({
          code,
          signal,
          stderr: Buffer.concat(stderr).toString(),
        }).toEqual({
          code: 0,
          signal: null,
          stderr: "",
        });
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });
      } finally {
        try {
          child?.kill();
        } catch {
          // The child normally exits after its echo.
        }
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
      }
    }, 45_000);

    it("exposes and supervises the real detached target PID", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      let targetPid;
      try {
        child = executionBroker.spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          {
            origin: "test:windows-native-sandbox-detached-live",
            policy: "allow",
            detached: true,
            stdio: "ignore",
            timeout: 30_000,
            env: process.env,
          },
        );
        targetPid = child.pid;
        expect(child).toMatchObject({
          pid: targetPid,
          sandboxTargetPid: targetPid,
        });
        expect(child.sandboxWrapperPid).toBeGreaterThan(0);
        expect(child.sandboxWrapperPid).not.toBe(targetPid);
        expect(() => process.kill(targetPid, 0)).not.toThrow();
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          pid: targetPid,
          sandboxWrapperPid: child.sandboxWrapperPid,
          sandboxTargetPid: targetPid,
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const exitPromise = once(child, "exit");
        expect(child.kill()).toBe(true);
        await exitPromise;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          try {
            process.kill(targetPid, 0);
          } catch {
            targetPid = null;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(targetPid).toBeNull();
      } finally {
        try {
          child?.kill();
        } catch {
          // Best-effort cleanup for a failed assertion.
        }
        if (targetPid) {
          try {
            process.kill(targetPid);
          } catch {
            // The Job may already have reaped it.
          }
        }
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
      }
    }, 45_000);

    it("preserves detached file stdio through restricted target startup", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      const dir = mkdtempSync(path.join(os.tmpdir(), "cc-win-stdio-"));
      const script = path.join(dir, "detached-worker.mjs");
      const logFile = path.join(dir, "worker.log");
      let logFd;
      let child;
      try {
        writeFileSync(
          script,
          [
            'process.stdout.write("stdout-ok\\n");',
            'process.stderr.write("stderr-ok\\n");',
            "setTimeout(() => process.exit(0), 500);",
            "",
          ].join("\n"),
          "utf8",
        );
        logFd = openSync(logFile, "a");
        child = executionBroker.spawn(process.execPath, [script], {
          origin: "test:windows-native-sandbox-detached-file-stdio-live",
          policy: "allow",
          detached: true,
          stdio: ["ignore", logFd, logFd],
          windowsHide: true,
          timeout: 30_000,
          env: process.env,
        });
        closeSync(logFd);
        logFd = null;
        const [code, signal] = await once(child, "exit");
        expect({ code, signal }).toEqual({ code: 0, signal: null });
        const log = readFileSync(logFile, "utf8");
        expect(log).toContain("stdout-ok");
        expect(log).toContain("stderr-ok");
      } finally {
        if (Number.isInteger(logFd)) closeSync(logFd);
        try {
          child?.kill();
        } catch {
          // The child normally exits after writing both streams.
        }
        rmSync(dir, { recursive: true, force: true });
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
      }
    }, 45_000);
  },
);

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
    const apply = vi.fn((command, args, options, profile) => ({
      contractVersion: 1,
      applied: false,
      platform: "win32",
      profile,
      command,
      args,
      options,
      enforcement: null,
      reason: "windows_native_job_object_unavailable",
      postSpawn: { required: false, mode: "none" },
    }));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict",
        policy: "allow",
      }),
    ).toThrow(/windows_native_job_object_unavailable/);
    expect(apply).toHaveBeenCalledWith(
      "tool",
      [],
      expect.any(Object),
      "strict",
    );
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
