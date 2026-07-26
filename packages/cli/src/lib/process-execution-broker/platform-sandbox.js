/**
 * Platform-specific sandbox enforcement for ProcessExecutionBroker (P0-1)
 *
 * Platform enforcement currently available:
 * - macOS: Seatbelt sandbox-exec profiles
 * - Linux: prlimit resource-limit wrapper
 * - Windows: Win32 Job Object + restricted-token wrapper
 *
 * Security model:
 * Adapters return a truthful spawn plan. An unavailable primitive is never
 * represented as applied; ProcessExecutionBroker decides whether to fail
 * closed (strict mode) or record the unavailable boundary.
 *
 * Part of Phase 1 Implementation - 2026-07-22
 */

import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WINDOWS_IDENTITY_WAIT = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_RUNTIME = Object.freeze({
  platform: os.platform(),
  fs,
  tmpdir: () => os.tmpdir(),
  homedir: () => os.homedir(),
  randomBytes: (size) => crypto.randomBytes(size),
  resolvePath: (value) => path.resolve(value),
  joinPath: (...parts) => path.join(...parts),
  windowsDir: () => process.env.WINDIR || "C:\\Windows",
  moduleDir: MODULE_DIR,
  now: () => Date.now(),
  sleepSync: (milliseconds) =>
    Atomics.wait(WINDOWS_IDENTITY_WAIT, 0, 0, milliseconds),
  spawnSync: nativeSpawnSync,
});

function resolveRuntime(overrides = {}) {
  return { ...DEFAULT_RUNTIME, ...overrides };
}

/**
 * A native `spawn(..., { shell: true })` asks Node to execute one command
 * string through the platform shell. Once a sandbox wrapper becomes the
 * executable, leaving `shell: true` makes the host shell parse the wrapper
 * argv instead, and the original command is no longer one atomic `-c`
 * payload. Linux `prlimit` then tries to exec a file literally named
 * "node script.js"; macOS Seatbelt has the same ambiguity.
 *
 * Materialize the requested POSIX shell before adding either wrapper. The
 * sandbox executable itself is always spawned directly.
 */
function normalizeWrappedInvocation(command, args, spawnOpts, platform) {
  if (!spawnOpts?.shell) {
    return {
      command,
      args: [...(args || [])],
      options: { ...(spawnOpts || {}) },
    };
  }

  if (platform === "win32") {
    const shell =
      typeof spawnOpts.shell === "string"
        ? spawnOpts.shell
        : process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    const shellCommand = [command, ...(args || [])].map(String).join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", shellCommand],
      options: { ...spawnOpts, shell: false },
    };
  }

  const shell =
    typeof spawnOpts.shell === "string" ? spawnOpts.shell : "/bin/sh";
  const shellCommand = [command, ...(args || [])].map(String).join(" ");
  return {
    command: shell,
    args: ["-c", shellCommand],
    options: { ...spawnOpts, shell: false },
  };
}

/**
 * Every platform adapter returns the same immutable spawn-plan shape. The
 * broker must consume `command`, `args`, and `options` from this object rather
 * than relying on adapters to mutate caller-owned values.
 *
 * A required post-spawn enforcement step must declare whether it is
 * synchronous. ProcessExecutionBroker.spawn() is synchronous, so strict mode
 * rejects an asynchronous required step before starting the child.
 *
 * @param {Object} input
 * @returns {{
 *   contractVersion: 1,
 *   applied: boolean,
 *   platform: string,
 *   profile: string,
 *   command: string,
 *   args: string[],
 *   options: Object,
 *   enforcement: string|null,
 *   reason: string|null,
 *   cleanup?: Function,
 *   postSpawn: {required: boolean, mode: "none"|"sync"|"async"}
 * }}
 */
function createSandboxPlan(input) {
  const postSpawn = Object.freeze({
    required: false,
    mode: "none",
    ...(input.postSpawn || {}),
  });
  return Object.freeze({
    contractVersion: 1,
    applied: false,
    enforcement: null,
    reason: null,
    ...input,
    args: Object.freeze([...(input.args || [])]),
    options: Object.freeze({ ...(input.options || {}) }),
    postSpawn,
  });
}

// ---------------------------------------------------------------------------
// macOS Seatbelt Sandbox
// ---------------------------------------------------------------------------

/**
 * Generate a minimal Seatbelt sandbox profile that denies everything by default
 * and only allows whitelisted paths + basic operations.
 *
 * @param {Object} opts
 * @param {string[]} opts.allowRead - Paths allowed for read
 * @param {string[]} opts.allowWrite - Paths allowed for write (includes read)
 * @param {boolean} [opts.allowNetwork=false] - Allow network access
 * @param {boolean} [opts.allowExec=true] - Allow process exec (subprocess spawning)
 * @returns {string} sandbox profile content
 */
export function generateMacSeatbeltProfile(opts = {}, runtimeOverrides = {}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const {
    allowRead = [],
    allowWrite = [],
    allowNetwork = false,
    allowExec = true,
  } = opts;

  const lines = [
    "(version 1)",
    "(deny default)",
    // Apple's system baseline supplies the loader/device primitives required
    // for ordinary command startup. Our explicit rules below still own
    // process, filesystem write, and network policy.
    '(import "system.sb")',
    // Basic system operations always allowed
    "(allow signal (target self))",
    '(allow process-exec (literal "/usr/bin/env"))',
    '(allow process-exec (literal "/bin/sh"))',
    '(allow process-exec (literal "/bin/bash"))',
    "(allow sysctl-read)",
    "(allow mach-lookup)",
  ];

  if (allowExec) {
    lines.push("(allow process-fork)");
    lines.push("(allow process-exec)");
  }

  if (allowNetwork) {
    lines.push("(allow network*)");
  } else {
    // Keep the imported system baseline from widening the caller's explicit
    // no-network policy.
    lines.push("(deny network*)");
  }

  // Allow read/write to specific paths
  for (const p of allowRead) {
    const abs = runtime.resolvePath(p);
    lines.push(`(allow file-read* (subpath "${abs}"))`);
  }

  for (const p of allowWrite) {
    const abs = runtime.resolvePath(p);
    lines.push(`(allow file-read* file-write* (subpath "${abs}"))`);
  }

  // Always allow read access to system paths needed for basic execution
  lines.push('(allow file-read* (subpath "/bin"))');
  lines.push('(allow file-read* (subpath "/usr/bin"))');
  lines.push('(allow file-read* (subpath "/usr/lib"))');
  lines.push('(allow file-read* (subpath "/usr/libexec"))');
  lines.push('(allow file-read* (subpath "/System/Library"))');
  lines.push('(allow file-read* (subpath "/Library/Frameworks"))');
  lines.push('(allow file-read* (subpath "/usr/local/lib"))');
  lines.push(
    '(allow file-read* file-write* (literal "/dev/null") (literal "/dev/stdin") (literal "/dev/stdout") (literal "/dev/stderr"))',
  );
  lines.push('(allow file-read* (literal "/dev/urandom"))');
  lines.push('(allow file-read* (literal "/etc/passwd"))');

  return lines.join("\n");
}

/**
 * Apply macOS sandbox via SBWritableProfile or sandbox-exec wrapper.
 *
 * For spawned processes, the preferred approach is to launch with sandbox-exec
 * as the wrapper binary, passing the profile as an argument. This avoids needing
 * to call sandbox_init from the child.
 *
 * @param {string} command - Original command
 * @param {string[]} args - Original args
 * @param {Object} spawnOpts - Original spawn options
 * @param {Object} sandboxOpts - Sandbox options
 */
export function applyMacSandbox(
  command,
  args,
  spawnOpts,
  sandboxOpts = {},
  runtimeOverrides = {},
) {
  const runtime = resolveRuntime(runtimeOverrides);
  const invocation = normalizeWrappedInvocation(
    command,
    args,
    spawnOpts,
    runtime.platform,
  );
  const base = {
    platform: runtime.platform,
    profile: sandboxOpts.profileName || "default",
    command,
    args,
    options: { ...(spawnOpts || {}) },
  };
  if (runtime.platform !== "darwin") {
    return createSandboxPlan({
      ...base,
      reason: "platform_mismatch",
    });
  }

  // A deny-by-default Seatbelt profile cannot safely infer the filesystem,
  // IPC, and inherited-descriptor access required by an arbitrary command.
  // Keep the boundary truthful for the broker's implicit default profile:
  // non-strict mode records the unavailable primitive and executes the
  // original invocation, while strict mode fails closed. Explicit strict or
  // network-only profiles still opt in to the sandbox-exec wrapper below.
  if ((sandboxOpts.profileName || "default") === "default") {
    return createSandboxPlan({
      ...base,
      reason: "macos_default_profile_requires_explicit_policy",
    });
  }

  const sandboxExecutable = "/usr/bin/sandbox-exec";
  if (!runtime.fs.existsSync(sandboxExecutable)) {
    return createSandboxPlan({
      ...base,
      reason: "macos_sandbox_exec_unavailable",
    });
  }

  // Generate temporary profile file
  const profileContent = generateMacSeatbeltProfile(
    sandboxOpts,
    runtimeOverrides,
  );
  const profilePath = runtime.joinPath(
    runtime.tmpdir(),
    `chainless-sb-${runtime.randomBytes(8).toString("hex")}.sb`,
  );

  runtime.fs.writeFileSync(profilePath, profileContent, { mode: 0o600 });

  // Wrap command with sandbox-exec
  const newArgs = ["-f", profilePath, invocation.command, ...invocation.args];

  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: "macos-seatbelt",
    command: sandboxExecutable,
    args: newArgs,
    options: invocation.options,
    cleanup: () => {
      try {
        runtime.fs.unlinkSync(profilePath);
      } catch {
        // ignore cleanup errors
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Windows Job Object + Restricted Token
// ---------------------------------------------------------------------------

/**
 * Materialize the shipped PowerShell/Win32 adapter into a physical temporary
 * file. This is required for pkg builds where source assets live in a virtual
 * snapshot that an external powershell.exe process cannot open directly.
 */
function materializeWindowsAdapter(runtime) {
  const sourcePath =
    runtime.windowsAdapterScriptPath ||
    runtime.joinPath(runtime.moduleDir, "windows-sandbox.ps1");
  let content = runtime.windowsAdapterContent;
  if (content === undefined) {
    if (!runtime.fs.existsSync(sourcePath)) {
      return { reason: "windows_native_adapter_missing" };
    }
    try {
      content = runtime.fs.readFileSync(sourcePath, "utf8");
    } catch {
      return { reason: "windows_native_adapter_unreadable" };
    }
  }
  const adapterHash = crypto
    .createHash("sha256")
    .update(String(content))
    .digest("hex")
    .slice(0, 24);
  const cacheExecutable = runtime.joinPath(
    runtime.tmpdir(),
    `chainless-win-sandbox-${adapterHash}.exe`,
  );
  if (runtime.fs.existsSync(cacheExecutable)) {
    return {
      cacheExecutable,
      bootstrapRequired: false,
    };
  }
  const scriptPath = runtime.joinPath(
    runtime.tmpdir(),
    `chainless-win-sandbox-${runtime.randomBytes(12).toString("hex")}.ps1`,
  );
  try {
    runtime.fs.writeFileSync(scriptPath, content, { mode: 0o600 });
  } catch {
    return { reason: "windows_native_adapter_materialize_failed" };
  }
  return {
    scriptPath,
    cacheExecutable,
    bootstrapRequired: true,
    cleanup: () => {
      try {
        runtime.fs.unlinkSync(scriptPath);
      } catch {
        // The temporary adapter may already have been removed.
      }
    },
  };
}

function waitForWindowsTargetIdentity(
  proc,
  identityPath,
  runtime,
  timeoutMs = 10_000,
) {
  const deadline = runtime.now() + timeoutMs;
  let lastError;
  while (runtime.now() < deadline) {
    try {
      const identity = JSON.parse(
        runtime.fs.readFileSync(identityPath, "utf8"),
      );
      if (identity?.error) {
        throw new Error(
          `Windows sandbox helper rejected the target: ${identity.error}`,
        );
      }
      const targetPid = Number(identity?.targetPid);
      const helperPid = Number(identity?.helperPid);
      if (!Number.isSafeInteger(targetPid) || targetPid <= 0) {
        throw new Error("Windows sandbox identity omitted a valid target PID");
      }
      if (
        Number.isSafeInteger(helperPid) &&
        helperPid > 0 &&
        helperPid !== proc.pid
      ) {
        throw new Error(
          `Windows sandbox identity named unexpected helper PID ${helperPid}`,
        );
      }
      if (targetPid === proc.pid) {
        throw new Error(
          "Windows sandbox target PID unexpectedly equals its helper PID",
        );
      }

      const wrapperPid = proc.pid;
      proc.sandboxWrapperPid = wrapperPid;
      proc.sandboxTargetPid = targetPid;
      // ChildProcess.pid is a writable data property. The native ChildProcess
      // handle still points at the helper, so kill()/ref()/unref() retain Job
      // lifetime semantics while callers observe and persist the real target.
      proc.pid = targetPid;
      return { targetPid, wrapperPid };
    } catch (error) {
      lastError = error;
      if (
        error?.code !== "ENOENT" &&
        !(error instanceof SyntaxError) &&
        !String(error?.message || "").includes("omitted a valid target PID")
      ) {
        throw error;
      }
    }
    runtime.sleepSync(10);
  }
  throw new Error(
    `Timed out waiting for Windows sandbox target identity${
      lastError?.message ? `: ${lastError.message}` : ""
    }`,
  );
}

/**
 * Wrap a target with the built-in Windows PowerShell host. The shipped script
 * P/Invokes Win32 to create a restricted primary token, starts the target
 * suspended, assigns it to a kill-on-close Job Object, then resumes it. The
 * target therefore cannot run before both native boundaries are active.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Object} spawnOpts
 * @param {Object} sandboxOpts
 */
export function applyWindowsSandbox(
  command,
  args,
  spawnOpts,
  sandboxOpts = {},
  runtimeOverrides = {},
) {
  const runtime = resolveRuntime(runtimeOverrides);
  const base = {
    platform: runtime.platform,
    profile: sandboxOpts.profileName || "default",
    command,
    args,
    options: spawnOpts,
  };
  if (runtime.platform !== "win32") {
    return createSandboxPlan({
      ...base,
      reason: "platform_mismatch",
    });
  }

  const nodeIpcFd = Array.isArray(spawnOpts?.stdio)
    ? spawnOpts.stdio.findIndex((entry) => entry === "ipc")
    : -1;
  if (
    Array.isArray(spawnOpts?.stdio) &&
    spawnOpts.stdio
      .slice(3)
      .some(
        (entry, offset) =>
          offset + 3 !== nodeIpcFd &&
          entry !== "ignore" &&
          entry !== null &&
          entry !== undefined,
      )
  ) {
    return createSandboxPlan({
      ...base,
      reason: "windows_extra_descriptor_unsupported",
    });
  }

  const adapter = materializeWindowsAdapter(runtime);
  if (!adapter.cacheExecutable) {
    return createSandboxPlan({
      ...base,
      reason: adapter.reason,
    });
  }

  const invocation = normalizeWrappedInvocation(
    command,
    args,
    spawnOpts,
    runtime.platform,
  );
  const profile = sandboxOpts.profileName || "default";
  const limits = sandboxOpts.limits || {};
  const identityPath =
    spawnOpts?.detached === true
      ? runtime.joinPath(
          runtime.tmpdir(),
          `chainless-win-sandbox-identity-${runtime
            .randomBytes(24)
            .toString("hex")}.json`,
        )
      : null;
  const launchSpec = {
    cpuSeconds: Number(limits.cpu || 0),
    processMemoryBytes: Number(
      limits.as || (profile === "strict" ? 256 * 1024 * 1024 : 0),
    ),
    activeProcessLimit: profile === "strict" ? 16 : 64,
    command: invocation.command,
    args: invocation.args,
    nodeIpcFd,
    windowsHide: invocation.options.windowsHide === true,
  };
  if (identityPath) launchSpec.identityPath = identityPath;
  const payload = Buffer.from(JSON.stringify(launchSpec), "utf8").toString(
    "base64",
  );
  const helperArgs = [payload];
  const options = {
    ...invocation.options,
    shell: false,
    env: {
      ...(invocation.options.env || process.env),
      CC_WINDOWS_SANDBOXED: "1",
      CC_WINDOWS_SANDBOX_PROFILE: profile,
    },
  };
  const cleanupIdentity = () => {
    if (!identityPath) return;
    try {
      runtime.fs.unlinkSync(identityPath);
    } catch {
      // The post-spawn handshake normally removes this file first.
    }
  };
  const identityContract = identityPath
    ? {
        postSpawn: { required: true, mode: "sync" },
        postSpawnWindows: (proc) => {
          try {
            return waitForWindowsTargetIdentity(proc, identityPath, runtime);
          } catch (error) {
            try {
              proc.kill?.();
            } catch {
              // Closing the helper is best-effort; the thrown failure remains
              // authoritative and strict mode will fail closed.
            }
            throw error;
          } finally {
            cleanupIdentity();
          }
        },
      }
    : {};

  if (adapter.bootstrapRequired) {
    const powershell = runtime.joinPath(
      runtime.windowsDir(),
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (!runtime.fs.existsSync(powershell)) {
      adapter.cleanup?.();
      cleanupIdentity();
      return createSandboxPlan({
        ...base,
        reason: "windows_powershell_host_unavailable",
      });
    }
    const compileResult = runtime.spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        adapter.scriptPath,
        "-CacheExecutable",
        adapter.cacheExecutable,
        "-CompileOnly",
      ],
      {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000,
        env: invocation.options.env || process.env,
      },
    );
    adapter.cleanup?.();
    if (
      compileResult?.error ||
      compileResult?.status !== 0 ||
      !runtime.fs.existsSync(adapter.cacheExecutable)
    ) {
      cleanupIdentity();
      return createSandboxPlan({
        ...base,
        reason: "windows_native_adapter_compile_failed",
      });
    }
  }

  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: "windows-job-restricted-token",
    command: adapter.cacheExecutable,
    args: helperArgs,
    options,
    ...identityContract,
    cleanup: cleanupIdentity,
  });
}

/**
 * Retained for injected adapters that elect to perform synchronous post-spawn
 * enforcement. The built-in wrapper completes enforcement before target resume
 * and therefore does not require this path.
 *
 * @param {ChildProcess} proc - The spawned child process
 * @param {Object} sandboxResult - Result from applyWindowsSandbox
 */
export function postSpawnWindowsSandbox(
  proc,
  sandboxResult,
  runtimeOverrides = {},
) {
  const runtime = resolveRuntime(runtimeOverrides);
  if (runtime.platform !== "win32" || !sandboxResult?.postSpawn?.required) {
    return;
  }
  if (typeof sandboxResult.postSpawnWindows === "function") {
    return sandboxResult.postSpawnWindows(proc);
  }
}

// ---------------------------------------------------------------------------
// Linux resource-limit enforcement
// ---------------------------------------------------------------------------

/**
 * Apply Linux resource limits through the util-linux `prlimit` wrapper.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Object} spawnOpts
 * @param {Object} sandboxOpts
 */
export function applyLinuxSandbox(
  command,
  args,
  spawnOpts,
  sandboxOpts = {},
  runtimeOverrides = {},
) {
  const runtime = resolveRuntime(runtimeOverrides);
  const invocation = normalizeWrappedInvocation(
    command,
    args,
    spawnOpts,
    runtime.platform,
  );
  const base = {
    platform: runtime.platform,
    profile: sandboxOpts.profileName || "default",
    command,
    args,
    options: { ...(spawnOpts || {}) },
  };
  if (runtime.platform !== "linux") {
    return createSandboxPlan({
      ...base,
      reason: "platform_mismatch",
    });
  }

  const { limits = {} } = sandboxOpts;

  const prlimitParts = [];
  if (limits.cpu) prlimitParts.push(`--cpu=${limits.cpu}`);
  if (limits.as) prlimitParts.push(`--as=${limits.as}`);
  if (limits.nofile) prlimitParts.push(`--nofile=${limits.nofile}`);
  if (limits.nproc) prlimitParts.push(`--nproc=${limits.nproc}`);

  if (prlimitParts.length === 0) {
    return createSandboxPlan({
      ...base,
      reason: "linux_resource_limits_not_configured",
    });
  }
  if (!runtime.fs.existsSync("/usr/bin/prlimit")) {
    return createSandboxPlan({
      ...base,
      reason: "linux_prlimit_unavailable",
    });
  }

  const options = {
    ...invocation.options,
    env: {
      ...(invocation.options.env || process.env),
      CHAINLESS_SANDBOXED: "1",
    },
  };

  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: "linux-prlimit",
    command: "/usr/bin/prlimit",
    args: [...prlimitParts, "--", invocation.command, ...invocation.args],
    options,
  });
}

// ---------------------------------------------------------------------------
// Unified sandbox apply
// ---------------------------------------------------------------------------

/**
 * Apply platform-appropriate sandbox for a child process.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Object} spawnOpts - Original spawn options
 * @param {"default"|"strict"|"network-only"} profileName
 * @returns {ReturnType<typeof createSandboxPlan>}
 */
export function applySandbox(
  command,
  args,
  spawnOpts,
  profileName = "default",
  runtimeOverrides = {},
) {
  const runtime = resolveRuntime(runtimeOverrides);
  const profiles = {
    default: {
      allowNetwork: false,
      allowExec: true,
      allowRead: [runtime.homedir(), "/tmp"],
      allowWrite: [runtime.tmpdir()],
      limits: {
        // RLIMIT_NPROC is intentionally omitted. Linux applies it per real
        // user ID rather than to this child tree, so it can starve unrelated
        // CI workers and prevent Node from creating its own helper threads.
        cpu: 30, // seconds
        nofile: 256,
      },
    },
    strict: {
      allowNetwork: false,
      allowExec: false,
      allowRead: [],
      allowWrite: [runtime.tmpdir()],
      limits: {
        cpu: 10,
        as: 256 * 1024 * 1024, // 256MB address space
        nofile: 64,
      },
    },
    "network-only": {
      allowNetwork: true,
      allowExec: true,
      allowRead: [runtime.homedir()],
      allowWrite: [runtime.tmpdir()],
      limits: {
        cpu: 60,
        nofile: 512,
      },
    },
  };

  const profile = {
    ...(profiles[profileName] || profiles.default),
    profileName: profiles[profileName] ? profileName : "default",
  };

  // Dispatch to platform handler
  if (runtime.platform === "darwin") {
    return applyMacSandbox(command, args, spawnOpts, profile, runtimeOverrides);
  }
  if (runtime.platform === "win32") {
    return applyWindowsSandbox(
      command,
      args,
      spawnOpts,
      profile,
      runtimeOverrides,
    );
  }
  if (runtime.platform === "linux") {
    return applyLinuxSandbox(
      command,
      args,
      spawnOpts,
      profile,
      runtimeOverrides,
    );
  }

  // Unknown platform - no sandbox applied
  return createSandboxPlan({
    platform: runtime.platform,
    profile: profile.profileName,
    command,
    args,
    options: spawnOpts,
    reason: "unsupported_platform",
  });
}

/**
 * Post-spawn sandbox setup (called after child process starts).
 * Reserved for adapters that require a synchronous native association step.
 *
 * @param {ChildProcess} proc
 * @param {Object} sandboxResult
 */
export function postSpawnSandbox(proc, sandboxResult, runtimeOverrides = {}) {
  const runtime = resolveRuntime(runtimeOverrides);
  if (runtime.platform === "win32" && sandboxResult?.postSpawn?.required) {
    return postSpawnWindowsSandbox(proc, sandboxResult, runtimeOverrides);
  }
}

export default {
  applySandbox,
  postSpawnSandbox,
  generateMacSeatbeltProfile,
  applyMacSandbox,
  applyWindowsSandbox,
  applyLinuxSandbox,
};
