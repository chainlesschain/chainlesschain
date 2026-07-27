/**
 * Platform-specific sandbox enforcement for ProcessExecutionBroker (P0-1)
 *
 * Platform enforcement currently available:
 * - macOS: Seatbelt sandbox-exec profiles
 * - Linux: prlimit resource-limit wrapper, plus a narrow bubblewrap backend
 *   for an attested direct strict Plugin Node bin or static ELF native bin.
 *   Shells, dynamically linked binaries, broader working directories,
 *   host-writable paths, inherited descriptors, and network egress remain
 *   fail-closed.
 * - Windows: Win32 Job Object + restricted-token wrapper, with an attested
 *   zero-capability AppContainer for explicit filesystem/network boundaries
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

/**
 * Stable boundary identifiers shared by broker policies, platform plans, and
 * audit records. A guarantee means that the named restriction is enforced by
 * the selected backend; it does not merely describe a configured intent.
 */
export const SANDBOX_BOUNDARIES = Object.freeze({
  FILESYSTEM: "filesystem",
  NETWORK: "network",
  PROCESS_EXEC: "process-exec",
  PROCESS_TREE: "process-tree",
  RESOURCE_LIMITS: "resource-limits",
  PRIVILEGE_REDUCTION: "privilege-reduction",
});

/**
 * @typedef {typeof SANDBOX_BOUNDARIES[keyof typeof SANDBOX_BOUNDARIES]} SandboxBoundary
 *
 * @typedef {Object} SandboxGuaranteePlan
 * @property {1} contractVersion
 * @property {boolean} applied
 * @property {string} platform
 * @property {string} profile
 * @property {string} command
 * @property {readonly string[]} args
 * @property {Readonly<Object>} options
 * @property {string|null} enforcement
 * @property {string|null} backend
 * @property {readonly SandboxBoundary[]} guarantees
 * @property {string|null} reason
 * @property {{required: boolean, mode: "none"|"sync"|"async"}} postSpawn
 */

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WINDOWS_SANDBOX_HELPER_SOURCE = fs.readFileSync(
  path.join(MODULE_DIR, "windows-sandbox.cs"),
);
const WINDOWS_SANDBOX_HELPER_SOURCE_DIGEST = crypto
  .createHash("sha256")
  .update(WINDOWS_SANDBOX_HELPER_SOURCE)
  .digest("hex");
const WINDOWS_SANDBOX_HELPER_ASSEMBLY = fs.readFileSync(
  path.join(MODULE_DIR, "windows-sandbox-helper.dll"),
);
const WINDOWS_SANDBOX_HELPER_ASSEMBLY_DIGEST = crypto
  .createHash("sha256")
  .update(WINDOWS_SANDBOX_HELPER_ASSEMBLY)
  .digest("hex");
const WINDOWS_SANDBOX_HELPER_EXECUTABLE = fs.readFileSync(
  path.join(MODULE_DIR, "windows-sandbox-helper.exe"),
);
const WINDOWS_SANDBOX_HELPER_EXECUTABLE_DIGEST = crypto
  .createHash("sha256")
  .update(WINDOWS_SANDBOX_HELPER_EXECUTABLE)
  .digest("hex");
const WINDOWS_TRUSTED_SYSTEM_ROOT =
  os.platform() === "win32"
    ? (() => {
        try {
          const resolved = fs.realpathSync.native(
            String.raw`\\?\GLOBALROOT\SystemRoot`,
          );
          const normalized = path.win32.resolve(resolved);
          return /^[A-Za-z]:\\/.test(normalized) && !normalized.includes("\0")
            ? normalized
            : null;
        } catch {
          return null;
        }
      })()
    : "C:\\Windows";
const WINDOWS_IDENTITY_WAIT = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_RESTRICTED_TOKEN_BACKEND = "windows-job-restricted-token";
const WINDOWS_APPCONTAINER_BACKEND =
  "windows-appcontainer-job-restricted-token";
const WINDOWS_ADAPTER_IDLE_TTL_MS = 60_000;
// Every native helper operation starts a trusted System32 PowerShell host and
// byte-loads the checked-in assembly. Hosted Windows runners can spend well
// over ten seconds in that bootstrap before the managed operation begins.
const WINDOWS_SANDBOX_HELPER_OPERATION_TIMEOUT_MS = 120_000;
const WINDOWS_SANDBOX_HOST_ENV_DENYLIST = new Set([
  "APPDOMAIN_MANAGER_ASM",
  "APPDOMAIN_MANAGER_TYPE",
  "COMPLUS_APPLICATIONMIGRATIONRUNTIMEACTIVATIONCONFIGPATH",
  "COMPLUS_INSTALLROOT",
  "COMPLUS_STARTUPHOOK",
  "COMPLUS_VERSION",
  "CORECLR_ENABLE_PROFILING",
  "CORECLR_PROFILER",
  "CORECLR_PROFILER_PATH",
  "CORECLR_PROFILER_PATH_32",
  "CORECLR_PROFILER_PATH_64",
  "CORECLR_PROFILER_PATH_ARM32",
  "CORECLR_PROFILER_PATH_ARM64",
  "COR_ENABLE_PROFILING",
  "COR_PROFILER",
  "COR_PROFILER_PATH",
  "COR_PROFILER_PATH_32",
  "COR_PROFILER_PATH_64",
  "DOTNET_ENABLE_PROFILING",
  "DOTNET_PROFILER",
  "DOTNET_PROFILER_PATH",
  "DOTNET_PROFILER_PATH_32",
  "DOTNET_PROFILER_PATH_64",
  "DOTNET_PROFILER_PATH_ARM32",
  "DOTNET_PROFILER_PATH_ARM64",
  "DOTNET_STARTUP_HOOKS",
]);
const WINDOWS_PLUGIN_NODE_ENV_DENYLIST = new Set([
  "NODE_CHANNEL_FD",
  "NODE_OPTIONS",
  "OPENSSL_CONF",
  "OPENSSL_CONF_INCLUDE",
  "OPENSSL_ENGINES",
  "OPENSSL_MODULES",
]);
const LINUX_BWRAP_PATH = "/usr/bin/bwrap";
const LINUX_LDD_PATH = "/usr/bin/ldd";
const LINUX_BWRAP_BACKEND = "linux-bwrap";
const LINUX_BWRAP_NODE_PROBE_SENTINEL = "chainless-linux-bwrap-plugin-node-v1";
const LINUX_BWRAP_MAX_PLUGIN_ENTRIES = 512;
const LINUX_BWRAP_FIRST_MOUNT_FD = 3;
const LINUX_ATTESTED_FILE_MAX_BYTES = 256 * 1024 * 1024;
const LINUX_ATTESTATION_HASH_CHUNK_BYTES = 1024 * 1024;
const LINUX_ELF64_HEADER_BYTES = 64;
const LINUX_ELF64_PROGRAM_HEADER_BYTES = 56;
const LINUX_ELF_MAX_PROGRAM_HEADERS = 128;
const LINUX_ELF_MACHINES = Object.freeze({
  x64: 62,
  arm64: 183,
  riscv64: 243,
});
// Linux asm-generic: __O_TMPFILE (0x400000) | O_DIRECTORY (0x010000).
// x64, arm64, and riscv64 use this value; unsupported seccomp architectures
// already fail closed before the anonymous filter is created.
const LINUX_O_TMPFILE = 0x410000;
const LINUX_SECCOMP_FILTERS = Object.freeze({
  x64: Object.freeze({
    auditArch: 0xc000003e,
    socketSyscall: 41,
    socketpairSyscall: 53,
    ioUringSetupSyscall: 425,
    x32SyscallBit: 0x40000000,
  }),
  arm64: Object.freeze({
    auditArch: 0xc00000b7,
    socketSyscall: 198,
    socketpairSyscall: 199,
    ioUringSetupSyscall: 425,
  }),
  riscv64: Object.freeze({
    auditArch: 0xc00000f3,
    socketSyscall: 198,
    socketpairSyscall: 199,
    ioUringSetupSyscall: 425,
  }),
});
const LINUX_LOCAL_FILESYSTEM_TYPES = new Set([
  "btrfs",
  "erofs",
  "ext2",
  "ext3",
  "ext4",
  "overlay",
  "squashfs",
  "tmpfs",
  "xfs",
  "zfs",
]);
const DEFAULT_RUNTIME = Object.freeze({
  platform: os.platform(),
  arch: process.arch,
  fs,
  tmpdir: () => os.tmpdir(),
  homedir: () => os.homedir(),
  randomBytes: (size) => crypto.randomBytes(size),
  resolvePath: (value) => path.resolve(value),
  joinPath: (...parts) => path.join(...parts),
  // GLOBALROOT resolves the kernel-owned SystemRoot object rather than the
  // caller-controlled WINDIR/SystemRoot environment variables.
  windowsDir: () => WINDOWS_TRUSTED_SYSTEM_ROOT,
  moduleDir: MODULE_DIR,
  now: () => Date.now(),
  sleepSync: (milliseconds) =>
    Atomics.wait(WINDOWS_IDENTITY_WAIT, 0, 0, milliseconds),
  spawnSync: nativeSpawnSync,
  warn: (message) => process.emitWarning(message),
});

let windowsAdapterCache = null;
const windowsAdapterCacheEntries = new Set();
const windowsTemporaryCleanupBacklog = new Set();
let windowsTemporaryCleanupRetryTimer = null;
const windowsAppContainerCleanupBacklog = new Set();
// Each AppContainer retry starts a synchronous, digest-attested PowerShell
// helper. Bound automatic retries so a permanently unsupported Windows host
// cannot repeatedly block a long-lived CLI; explicit cleanup/reset and process
// teardown remain available after this backoff is exhausted.
const WINDOWS_APPCONTAINER_AUTOMATIC_CLEANUP_DELAYS_MS = Object.freeze([
  250, 1_000, 5_000,
]);
let windowsAdapterExitCleanupRegistered = false;

function resolveRuntime(overrides = {}) {
  return { ...DEFAULT_RUNTIME, ...overrides };
}

function normalizeSandboxRequest(profileOrRequest, explicitRequest) {
  const legacyRequest =
    profileOrRequest &&
    typeof profileOrRequest === "object" &&
    !Array.isArray(profileOrRequest)
      ? profileOrRequest
      : { profile: profileOrRequest };
  const request =
    explicitRequest &&
    typeof explicitRequest === "object" &&
    !Array.isArray(explicitRequest)
      ? explicitRequest
      : legacyRequest;
  const profile =
    typeof request.profile === "string"
      ? request.profile
      : typeof legacyRequest.profile === "string"
        ? legacyRequest.profile
        : "default";
  const requiredBoundaries = Array.isArray(request.requiredBoundaries)
    ? [
        ...new Set(
          request.requiredBoundaries.filter(
            (boundary) => typeof boundary === "string",
          ),
        ),
      ]
    : [];
  return {
    profile,
    requiredBoundaries,
    sync: request.sync === true,
    executionContract:
      request.executionContract &&
      typeof request.executionContract === "object" &&
      !Array.isArray(request.executionContract)
        ? request.executionContract
        : null,
  };
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
 *   backend: string|null,
 *   guarantees: readonly SandboxBoundary[],
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
    backend: null,
    reason: null,
    ...input,
    args: Object.freeze([...(input.args || [])]),
    options: Object.freeze({ ...(input.options || {}) }),
    guarantees: Object.freeze([...(input.guarantees || [])]),
    runtimeProbe: input.runtimeProbe
      ? Object.freeze({ ...input.runtimeProbe })
      : null,
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
    backend: "macos-seatbelt",
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
    guarantees: [
      SANDBOX_BOUNDARIES.FILESYSTEM,
      ...(sandboxOpts.allowNetwork ? [] : [SANDBOX_BOUNDARIES.NETWORK]),
      ...(sandboxOpts.allowExec ? [] : [SANDBOX_BOUNDARIES.PROCESS_EXEC]),
    ],
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

function cleanupWindowsTemporaryPath(
  runtime,
  targetPath,
  attempts = 100,
  delayMs = 10,
) {
  if (!targetPath) return true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      runtime.fs.unlinkSync(targetPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
    }
    if (attempt + 1 < attempts) runtime.sleepSync(delayMs);
  }
  return false;
}

function cleanupOrTrackWindowsTemporaryPath(
  runtime,
  targetPath,
  attempts = 100,
) {
  if (cleanupWindowsTemporaryPath(runtime, targetPath, attempts)) {
    for (const residual of [...windowsTemporaryCleanupBacklog]) {
      if (residual.runtime === runtime && residual.targetPath === targetPath) {
        windowsTemporaryCleanupBacklog.delete(residual);
      }
    }
    if (
      windowsTemporaryCleanupBacklog.size === 0 &&
      windowsTemporaryCleanupRetryTimer
    ) {
      clearTimeout(windowsTemporaryCleanupRetryTimer);
      windowsTemporaryCleanupRetryTimer = null;
    }
    return true;
  }
  if (
    ![...windowsTemporaryCleanupBacklog].some(
      (residual) =>
        residual.runtime === runtime && residual.targetPath === targetPath,
    )
  ) {
    windowsTemporaryCleanupBacklog.add({ runtime, targetPath });
  }
  registerWindowsAdapterExitCleanup();
  scheduleWindowsTemporaryCleanupRetry();
  return false;
}

function retryWindowsTemporaryCleanupBacklog(attempts = 100) {
  let cleaned = true;
  for (const residual of [...windowsTemporaryCleanupBacklog]) {
    if (
      cleanupWindowsTemporaryPath(
        residual.runtime,
        residual.targetPath,
        attempts,
      )
    ) {
      windowsTemporaryCleanupBacklog.delete(residual);
    } else {
      cleaned = false;
    }
  }
  if (
    windowsTemporaryCleanupBacklog.size === 0 &&
    windowsTemporaryCleanupRetryTimer
  ) {
    clearTimeout(windowsTemporaryCleanupRetryTimer);
    windowsTemporaryCleanupRetryTimer = null;
  }
  return cleaned;
}

function scheduleWindowsTemporaryCleanupRetry() {
  if (
    windowsTemporaryCleanupRetryTimer ||
    windowsTemporaryCleanupBacklog.size === 0
  ) {
    return;
  }
  windowsTemporaryCleanupRetryTimer = setTimeout(() => {
    windowsTemporaryCleanupRetryTimer = null;
    retryWindowsTemporaryCleanupBacklog(1);
    if (windowsTemporaryCleanupBacklog.size > 0) {
      scheduleWindowsTemporaryCleanupRetry();
    }
  }, 250);
  windowsTemporaryCleanupRetryTimer.unref?.();
}

function cleanupWindowsTemporaryDirectory(
  runtime,
  targetPath,
  attempts = 100,
  delayMs = 10,
) {
  if (!targetPath) return true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      runtime.fs.rmdirSync(targetPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
    }
    if (attempt + 1 < attempts) runtime.sleepSync(delayMs);
  }
  return false;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function windowsFileIdentity(stat) {
  const timestamp = (nanosecondsKey, millisecondsKey) => {
    if (stat[nanosecondsKey] !== undefined) {
      return String(stat[nanosecondsKey]);
    }
    return String(Math.trunc(Number(stat[millisecondsKey] || 0) * 1_000_000));
  };
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mode: String(stat.mode),
    birthtimeNs: timestamp("birthtimeNs", "birthtimeMs"),
    ctimeNs: timestamp("ctimeNs", "ctimeMs"),
    mtimeNs: timestamp("mtimeNs", "mtimeMs"),
  });
}

function sameWindowsFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.birthtimeNs === right.birthtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

function inspectWindowsAdapterAssembly(runtime, assemblyPath) {
  if (typeof runtime.fs.lstatSync === "function") {
    const linkStat = runtime.fs.lstatSync(assemblyPath, { bigint: true });
    if (
      linkStat.isSymbolicLink?.() ||
      (typeof linkStat.isFile === "function" && !linkStat.isFile())
    ) {
      throw new Error("Windows in-memory adapter is not a regular file");
    }
  }
  const before = runtime.fs.statSync(assemblyPath, { bigint: true });
  if (typeof before.isFile === "function" && !before.isFile()) {
    throw new Error("Windows in-memory adapter is not a regular file");
  }
  const beforeIdentity = windowsFileIdentity(before);
  const assemblyDigest = sha256(runtime.fs.readFileSync(assemblyPath));
  const afterIdentity = windowsFileIdentity(
    runtime.fs.statSync(assemblyPath, { bigint: true }),
  );
  if (!sameWindowsFileIdentity(beforeIdentity, afterIdentity)) {
    throw new Error("Windows in-memory adapter changed during attestation");
  }
  return { assemblyDigest, fileIdentity: afterIdentity };
}

function verifyWindowsAdapterEntry(entry, runtime, source) {
  if (
    entry.retired ||
    entry.cleaned ||
    entry.runtimeFs !== runtime.fs ||
    entry.tempDirectory !== source.tempDirectory ||
    entry.sourceDigest !== source.sourceDigest ||
    entry.sourceContractDigest !== source.sourceContractDigest ||
    entry.loaderMode !== source.loaderMode
  ) {
    return false;
  }
  try {
    const attestation = inspectWindowsAdapterAssembly(
      runtime,
      entry.assemblyPath,
    );
    return (
      attestation.assemblyDigest === entry.assemblyDigest &&
      sameWindowsFileIdentity(attestation.fileIdentity, entry.fileIdentity)
    );
  } catch {
    return false;
  }
}

function cleanupWindowsAdapterEntry(entry, attempts = 100) {
  if (entry.cleaned) return true;
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  const deleted = cleanupOrTrackWindowsTemporaryPath(
    entry.runtime,
    entry.assemblyPath,
    attempts,
  );
  const directoryDeleted =
    deleted &&
    cleanupWindowsTemporaryDirectory(
      entry.runtime,
      entry.adapterDirectory,
      attempts,
    );
  if (deleted && directoryDeleted) {
    entry.cleaned = true;
    windowsAdapterCacheEntries.delete(entry);
  }
  return deleted && directoryDeleted;
}

function retireWindowsAdapterEntry(entry) {
  if (!entry) return;
  entry.retired = true;
  if (windowsAdapterCache === entry) windowsAdapterCache = null;
  if (entry.refCount === 0) cleanupWindowsAdapterEntry(entry);
}

function cleanupAllWindowsAdapterEntries(attempts = 100) {
  retryWindowsAppContainerCleanupBacklog();
  windowsAdapterCache = null;
  for (const entry of [...windowsAdapterCacheEntries]) {
    entry.retired = true;
    entry.refCount = 0;
    cleanupWindowsAdapterEntry(entry, attempts);
  }
  retryWindowsTemporaryCleanupBacklog(attempts);
}

function registerWindowsAdapterExitCleanup() {
  if (windowsAdapterExitCleanupRegistered) return;
  windowsAdapterExitCleanupRegistered = true;
  process.on("beforeExit", () => {
    cleanupAllWindowsAdapterEntries();
  });
  process.once("exit", () => {
    cleanupAllWindowsAdapterEntries();
  });
}

/**
 * Explicitly discard the process-local Windows helper cache. Production keeps
 * an attested helper until process teardown; tests and embedding hosts may use
 * this hook at a known quiescent point to prove cleanup.
 */
export function resetWindowsSandboxAdapterCache() {
  let cleaned = retryWindowsAppContainerCleanupBacklog();
  windowsAdapterCache = null;
  for (const entry of [...windowsAdapterCacheEntries]) {
    entry.retired = true;
    entry.refCount = 0;
    if (!cleanupWindowsAdapterEntry(entry)) cleaned = false;
  }
  if (!retryWindowsTemporaryCleanupBacklog()) cleaned = false;
  return cleaned;
}

function scheduleWindowsAdapterIdleCleanup(entry) {
  if (
    entry.retired ||
    entry.cleaned ||
    entry.refCount !== 0 ||
    entry.idleTimer
  ) {
    return;
  }
  const configuredTtl = Number(entry.runtime.windowsAdapterIdleTtlMs);
  const idleTtlMs =
    Number.isFinite(configuredTtl) && configuredTtl >= 0
      ? configuredTtl
      : WINDOWS_ADAPTER_IDLE_TTL_MS;
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null;
    if (
      entry.refCount === 0 &&
      !entry.retired &&
      !entry.cleaned &&
      windowsAdapterCache === entry
    ) {
      retireWindowsAdapterEntry(entry);
    }
  }, idleTtlMs);
  entry.idleTimer.unref?.();
}

function loadWindowsAdapterSource(runtime, loaderMode) {
  const bundled = runtime.windowsAdapterContent === undefined;
  const content = bundled
    ? loaderMode === "managed-executable"
      ? WINDOWS_SANDBOX_HELPER_EXECUTABLE
      : WINDOWS_SANDBOX_HELPER_ASSEMBLY
    : Buffer.from(runtime.windowsAdapterContent);
  return {
    content,
    sourceDigest: bundled
      ? loaderMode === "managed-executable"
        ? WINDOWS_SANDBOX_HELPER_EXECUTABLE_DIGEST
        : WINDOWS_SANDBOX_HELPER_ASSEMBLY_DIGEST
      : sha256(content),
    sourceContractDigest: bundled ? WINDOWS_SANDBOX_HELPER_SOURCE_DIGEST : null,
    tempDirectory: runtime.tmpdir(),
    loaderMode,
  };
}

/**
 * Materialize the trusted in-process assembly bytes at a fresh path. The
 * managed image is never executed from this user-writable location. A fixed
 * System32 PowerShell host reads the bytes once, verifies the expected digest,
 * and loads those exact bytes with Assembly.Load(byte[]).
 */
function materializeWindowsAdapter(runtime, source) {
  const adapterBaseName = `chainless-win-sandbox-${runtime
    .randomBytes(24)
    .toString("hex")}`;
  const adapterDirectory =
    source.loaderMode === "managed-executable"
      ? runtime.joinPath(source.tempDirectory, adapterBaseName)
      : null;
  const assemblyPath = runtime.joinPath(
    adapterDirectory || source.tempDirectory,
    source.loaderMode === "managed-executable"
      ? "windows-sandbox-helper.exe"
      : `${adapterBaseName}.dll`,
  );
  if (
    (adapterDirectory && runtime.fs.existsSync(adapterDirectory)) ||
    runtime.fs.existsSync(assemblyPath)
  ) {
    return { reason: "windows_native_adapter_random_path_collision" };
  }
  try {
    if (adapterDirectory) {
      runtime.fs.mkdirSync(adapterDirectory, {
        mode: 0o700,
        recursive: false,
      });
    }
    runtime.fs.writeFileSync(assemblyPath, source.content, {
      mode: adapterDirectory ? 0o500 : 0o600,
      flag: "wx",
    });
  } catch (error) {
    const assemblyDeleted = cleanupOrTrackWindowsTemporaryPath(
      runtime,
      assemblyPath,
    );
    const directoryDeleted =
      assemblyDeleted &&
      cleanupWindowsTemporaryDirectory(runtime, adapterDirectory);
    if (!assemblyDeleted || !directoryDeleted) {
      return { reason: "windows_native_adapter_compile_cleanup_unverified" };
    }
    if (error?.code === "EEXIST") {
      return { reason: "windows_native_adapter_random_path_collision" };
    }
    return { reason: "windows_native_adapter_materialize_failed" };
  }
  return {
    adapterDirectory,
    assemblyPath,
    cleanupAssembly: () => {
      const assemblyDeleted = cleanupOrTrackWindowsTemporaryPath(
        runtime,
        assemblyPath,
      );
      return (
        assemblyDeleted &&
        cleanupWindowsTemporaryDirectory(runtime, adapterDirectory)
      );
    },
  };
}

function materializeWindowsAdapterInvocation(runtime, helperArgs) {
  const payloadPath = runtime.joinPath(
    runtime.tmpdir(),
    `chainless-win-sandbox-invocation-${runtime
      .randomBytes(24)
      .toString("hex")}.json`,
  );
  if (runtime.fs.existsSync(payloadPath)) {
    return { reason: "windows_adapter_invocation_random_path_collision" };
  }
  let content;
  try {
    content = Buffer.from(
      [
        "CC_WINDOWS_SANDBOX_INVOCATION_V1",
        ...Array.from(helperArgs || [], (value) =>
          Buffer.from(String(value), "utf8").toString("base64"),
        ),
        "",
      ].join("\n"),
      "utf8",
    );
  } catch {
    return { reason: "windows_adapter_invocation_encode_failed" };
  }
  if (content.length > 8 * 1024 * 1024) {
    return { reason: "windows_adapter_invocation_too_large" };
  }
  try {
    runtime.fs.writeFileSync(payloadPath, content, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      return { reason: "windows_adapter_invocation_random_path_collision" };
    }
    return {
      reason: cleanupOrTrackWindowsTemporaryPath(runtime, payloadPath)
        ? "windows_adapter_invocation_materialize_failed"
        : "windows_adapter_invocation_cleanup_unverified",
    };
  }
  return {
    payloadPath,
    payloadDigest: sha256(content),
    cleanup: () => cleanupOrTrackWindowsTemporaryPath(runtime, payloadPath),
  };
}

function windowsPowerShellBootstrap(entry, invocation) {
  const encodeUtf8 = (value) =>
    Buffer.from(String(value), "utf8").toString("base64");
  const assemblyPath = encodeUtf8(entry.assemblyPath);
  const payloadPath = encodeUtf8(invocation.payloadPath);
  const bootstrap = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "try {",
    `$ccAssemblyPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${assemblyPath}'))`,
    `$ccPayloadPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payloadPath}'))`,
    `$ccExpectedAssembly='${entry.assemblyDigest}'`,
    `$ccExpectedPayload='${invocation.payloadDigest}'`,
    "$ccPayloadBytes=[IO.File]::ReadAllBytes($ccPayloadPath)",
    "[IO.File]::Delete($ccPayloadPath)",
    "if([IO.File]::Exists($ccPayloadPath)){throw 'Windows sandbox adapter invocation cleanup failed'}",
    "$ccAssemblyBytes=[IO.File]::ReadAllBytes($ccAssemblyPath)",
    "if($ccAssemblyBytes.Length -gt 1048576 -or $ccPayloadBytes.Length -gt 8388608){throw 'Windows sandbox adapter input exceeds its limit'}",
    "$ccSha=[Security.Cryptography.SHA256]::Create()",
    "try{$ccAssemblyHash=([BitConverter]::ToString($ccSha.ComputeHash($ccAssemblyBytes))).Replace('-','').ToLowerInvariant();$ccSha.Initialize();$ccPayloadHash=([BitConverter]::ToString($ccSha.ComputeHash($ccPayloadBytes))).Replace('-','').ToLowerInvariant()}finally{$ccSha.Dispose()}",
    "if(![String]::Equals($ccAssemblyHash,$ccExpectedAssembly,[StringComparison]::Ordinal)-or ![String]::Equals($ccPayloadHash,$ccExpectedPayload,[StringComparison]::Ordinal)){throw 'Windows sandbox adapter input digest mismatch'}",
    "$ccUtf8=New-Object Text.UTF8Encoding($false,$true)",
    "$ccLines=$ccUtf8.GetString($ccPayloadBytes).Split([char]10)",
    "if($ccLines.Length -lt 2 -or $ccLines[0] -cne 'CC_WINDOWS_SANDBOX_INVOCATION_V1' -or $ccLines[$ccLines.Length-1] -cne ''){throw 'Windows sandbox adapter invocation is invalid'}",
    "$ccArgCount=$ccLines.Length-2",
    "$ccArgs=[Array]::CreateInstance([string],$ccArgCount)",
    "for($ccIndex=0;$ccIndex -lt $ccArgCount;$ccIndex++){$ccArgs[$ccIndex]=$ccUtf8.GetString([Convert]::FromBase64String($ccLines[$ccIndex+1]))}",
    "$ccAssembly=[Reflection.Assembly]::Load($ccAssemblyBytes)",
    "$ccProgram=$ccAssembly.GetType('ChainlessChain.WindowsSandbox.Program',$true)",
    "$ccMain=$ccProgram.GetMethod('Main',[Reflection.BindingFlags]'Public,Static')",
    "if($null -eq $ccMain){throw 'Windows sandbox adapter entry point is missing'}",
    "$ccExit=$ccMain.Invoke($null,[object[]]@(,[string[]]$ccArgs))",
    "exit [int]$ccExit",
    "} catch {",
    "[Console]::Error.WriteLine('CC_WINDOWS_SANDBOX_ERROR: '+$_.Exception.Message)",
    "exit 125",
    "}",
  ].join("\n");
  return Buffer.from(bootstrap, "utf16le").toString("base64");
}

function buildWindowsAdapterInvocation(entry, invocation) {
  if (entry.loaderMode === "managed-executable") {
    return {
      command: entry.assemblyPath,
      args: [
        "--adapter-path",
        entry.assemblyPath,
        "--invocation-file",
        invocation.payloadPath,
        invocation.payloadDigest,
      ],
      cleanup: invocation.cleanup,
    };
  }
  return {
    command: entry.powershellPath,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      windowsPowerShellBootstrap(entry, invocation),
    ],
    cleanup: invocation.cleanup,
  };
}

function createFreshWindowsAdapter(runtime, source, hostEnvironment) {
  const materialized = materializeWindowsAdapter(runtime, source);
  if (!materialized.assemblyPath) return materialized;

  const powershell =
    source.loaderMode === "powershell-byte-assembly"
      ? runtime.joinPath(
          runtime.windowsDir(),
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : null;
  if (powershell && !runtime.fs.existsSync(powershell)) {
    const assemblyDeleted = materialized.cleanupAssembly();
    return {
      reason: assemblyDeleted
        ? "windows_powershell_host_unavailable"
        : "windows_native_adapter_compile_cleanup_unverified",
    };
  }

  let attestation;
  try {
    attestation = inspectWindowsAdapterAssembly(
      runtime,
      materialized.assemblyPath,
    );
    if (attestation.assemblyDigest !== source.sourceDigest) {
      throw new Error("Materialized Windows adapter digest mismatch");
    }
  } catch {
    const assemblyDeleted = materialized.cleanupAssembly();
    return {
      reason: assemblyDeleted
        ? "windows_native_adapter_materialize_attestation_failed"
        : "windows_native_adapter_compile_cleanup_unverified",
    };
  }

  const entry = {
    runtime,
    runtimeFs: runtime.fs,
    tempDirectory: source.tempDirectory,
    sourceDigest: source.sourceDigest,
    sourceContractDigest: source.sourceContractDigest,
    loaderMode: source.loaderMode,
    powershellPath: powershell,
    adapterDirectory: materialized.adapterDirectory,
    assemblyPath: materialized.assemblyPath,
    assemblyDigest: attestation.assemblyDigest,
    fileIdentity: attestation.fileIdentity,
    refCount: 0,
    idleTimer: null,
    retired: false,
    cleaned: false,
  };
  const probePayload = materializeWindowsAdapterInvocation(runtime, [
    "--probe-helper",
  ]);
  if (!probePayload.payloadPath) {
    const assemblyDeleted = materialized.cleanupAssembly();
    return assemblyDeleted
      ? probePayload
      : { reason: "windows_native_adapter_compile_cleanup_unverified" };
  }
  const probeInvocation = buildWindowsAdapterInvocation(entry, probePayload);
  let probeResult;
  let probePayloadDeleted = false;
  try {
    probeResult = runtime.spawnSync(
      probeInvocation.command,
      probeInvocation.args,
      {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: WINDOWS_SANDBOX_HELPER_OPERATION_TIMEOUT_MS,
        cwd: runtime.joinPath(runtime.windowsDir(), "System32"),
        env: hostEnvironment,
      },
    );
  } catch (error) {
    probeResult = { error, status: null };
  } finally {
    probePayloadDeleted = probeInvocation.cleanup();
  }
  let probeReady = false;
  try {
    const probe = JSON.parse(String(probeResult?.stdout || "").trim());
    probeReady =
      probeResult?.status === 0 &&
      probe?.ready === true &&
      probe?.hostRuntime ===
        (source.loaderMode === "managed-executable"
          ? "managed-executable-v1"
          : "powershell-byte-assembly-v1") &&
      (source.sourceContractDigest === null ||
        probe?.sourceSha256 === source.sourceContractDigest);
  } catch {
    probeReady = false;
  }
  if (
    !probePayloadDeleted ||
    !probeReady ||
    !verifyWindowsAdapterEntry(entry, runtime, source)
  ) {
    const assemblyDeleted = materialized.cleanupAssembly();
    return {
      reason:
        !assemblyDeleted || !probePayloadDeleted
          ? "windows_native_adapter_compile_cleanup_unverified"
          : "windows_in_memory_adapter_probe_failed",
    };
  }

  windowsAdapterCacheEntries.add(entry);
  windowsAdapterCache = entry;
  registerWindowsAdapterExitCleanup();
  return { entry };
}

function acquireWindowsAdapterLease(runtime, source, hostEnvironment) {
  if (windowsAdapterCache) {
    if (verifyWindowsAdapterEntry(windowsAdapterCache, runtime, source)) {
      if (windowsAdapterCache.idleTimer) {
        clearTimeout(windowsAdapterCache.idleTimer);
        windowsAdapterCache.idleTimer = null;
      }
      windowsAdapterCache.refCount += 1;
      return {
        entry: windowsAdapterCache,
        released: false,
      };
    }
    retireWindowsAdapterEntry(windowsAdapterCache);
  }

  const compiled = createFreshWindowsAdapter(runtime, source, hostEnvironment);
  if (!compiled.entry) return compiled;
  compiled.entry.refCount += 1;
  return { entry: compiled.entry, released: false };
}

function releaseWindowsAdapterLease(lease) {
  if (!lease || lease.released) return;
  lease.released = true;
  lease.entry.refCount = Math.max(0, lease.entry.refCount - 1);
  if (lease.entry.retired && lease.entry.refCount === 0) {
    cleanupWindowsAdapterEntry(lease.entry);
  } else if (lease.entry.refCount === 0) {
    scheduleWindowsAdapterIdleCleanup(lease.entry);
  }
}

function createWindowsAdapterController(runtime, source, hostEnvironment) {
  const acquired = acquireWindowsAdapterLease(runtime, source, hostEnvironment);
  if (!acquired.entry) return acquired;
  let lease = acquired;
  let released = false;

  const ensureEntry = () => {
    if (released) {
      const error = new Error("Windows native adapter lease was released");
      error.adapterReason = "windows_native_adapter_lease_released";
      throw error;
    }
    if (!verifyWindowsAdapterEntry(lease.entry, runtime, source)) {
      retireWindowsAdapterEntry(lease.entry);
      releaseWindowsAdapterLease(lease);
      const refreshed = acquireWindowsAdapterLease(
        runtime,
        source,
        hostEnvironment,
      );
      if (!refreshed.entry) {
        const error = new Error(
          `Windows native adapter refresh failed: ${refreshed.reason}`,
        );
        error.adapterReason = refreshed.reason;
        throw error;
      }
      lease = refreshed;
    }
    return lease.entry;
  };

  const createInvocation = (helperArgs) => {
    const entry = ensureEntry();
    const payload = materializeWindowsAdapterInvocation(runtime, helperArgs);
    if (!payload.payloadPath) {
      const error = new Error(
        `Windows in-memory adapter invocation failed: ${payload.reason}`,
      );
      error.adapterReason = payload.reason;
      throw error;
    }
    return buildWindowsAdapterInvocation(entry, payload);
  };

  return {
    ensureExecutable: ensureEntry,
    createInvocation,
    spawnSync: (args, options) => {
      const invocation = createInvocation(args);
      let result;
      let failure;
      try {
        result = runtime.spawnSync(invocation.command, invocation.args, {
          ...options,
          cwd: runtime.joinPath(runtime.windowsDir(), "System32"),
          env: hostEnvironment,
        });
      } catch (error) {
        failure = error;
      }
      if (!invocation.cleanup()) {
        const cleanupError = new Error(
          "Windows sandbox adapter invocation cleanup could not be verified",
          failure ? { cause: failure } : undefined,
        );
        cleanupError.code = "ERR_WINDOWS_SANDBOX_INVOCATION_CLEANUP";
        throw cleanupError;
      }
      if (failure) throw failure;
      return result;
    },
    release: () => {
      if (released) return;
      released = true;
      releaseWindowsAdapterLease(lease);
    },
  };
}

function waitForWindowsTargetIdentity(
  proc,
  identityPath,
  runtime,
  expectedAppContainer = null,
  timeoutMs = 30_000,
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
      if (expectedAppContainer) {
        if (identity?.appContainer !== true) {
          throw new Error(
            "Windows sandbox identity did not attest an AppContainer target",
          );
        }
        if (
          identity?.appContainerSid !== expectedAppContainer.appContainerSid
        ) {
          throw new Error(
            "Windows sandbox identity named an unexpected AppContainer SID",
          );
        }
        if (identity?.capabilityCount !== 0) {
          throw new Error(
            "Windows sandbox identity did not attest zero capabilities",
          );
        }
      }

      const wrapperPid = proc.pid;
      proc.sandboxWrapperPid = wrapperPid;
      proc.sandboxTargetPid = targetPid;
      if (expectedAppContainer) {
        proc.sandboxAppContainerProfile =
          expectedAppContainer.appContainerProfileName;
        proc.sandboxAppContainerSid = expectedAppContainer.appContainerSid;
      }
      // ChildProcess.pid is a writable data property. The native ChildProcess
      // handle still points at the helper, so kill()/ref()/unref() retain Job
      // lifetime semantics while callers observe and persist the real target.
      proc.pid = targetPid;
      return {
        targetPid,
        wrapperPid,
        ...(expectedAppContainer
          ? {
              appContainerProfileName:
                expectedAppContainer.appContainerProfileName,
              appContainerSid: expectedAppContainer.appContainerSid,
              capabilityCount: 0,
            }
          : {}),
      };
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

function windowsNodeSnapshotProbeResult(result) {
  const runtimeProbe = {
    kind: "windows-plugin-node-entry-snapshot-v1",
    attempted: true,
    runnable: false,
    reason: "probe_failed",
    probeRuntime: "node",
    targetRuntime: "node",
  };
  if (result?.error || result?.status !== 0) {
    return {
      ...runtimeProbe,
      reason: windowsSandboxHelperFailureReason(result, "probe_failed"),
    };
  }

  try {
    const attestation = JSON.parse(String(result.stdout || "").trim());
    if (
      attestation?.ready !== true ||
      attestation?.targetRuntime !== "node" ||
      attestation?.contentSnapshot !== true
    ) {
      return { ...runtimeProbe, reason: "invalid_attestation" };
    }
  } catch {
    return { ...runtimeProbe, reason: "invalid_attestation" };
  }
  return { ...runtimeProbe, runnable: true, reason: null };
}

function windowsSandboxHelperFailureReason(result, fallback) {
  if (result?.error) {
    const errorCode = String(result.error.code || "").toLowerCase();
    if (
      errorCode === "etimedout" ||
      result.error.killed === true ||
      result.error.signal
    ) {
      return `${fallback}_timeout`;
    }
    if (/^[a-z0-9_]+$/.test(errorCode)) {
      return `${fallback}_spawn_${errorCode}`;
    }
    return `${fallback}_spawn_error`;
  }

  if (result?.status === 0) return fallback;
  const status = Number.isSafeInteger(result?.status)
    ? result.status
    : "unknown";
  const stderr = String(result?.stderr || "");
  const knownFailures = [
    [
      /CreateAppContainerProfile\(cleanup verification\)/i,
      "appcontainer_cleanup_verification_create",
    ],
    [/CreateAppContainerProfile/i, "appcontainer_profile_create"],
    [/DeleteAppContainerProfile/i, "appcontainer_profile_delete"],
    [/CreateProcessAsUser\(AppContainer\)/i, "appcontainer_process_create"],
    [/Target application contains a reparse component/i, "target_reparse"],
    [
      /Target working directory contains a reparse component/i,
      "working_directory_reparse",
    ],
    [
      /Target PATH directory contains a reparse component/i,
      "path_directory_reparse",
    ],
    [/Target application must use a local DOS drive/i, "target_nonlocal"],
    [
      /Target working directory must use a local DOS drive/i,
      "working_directory_nonlocal",
    ],
    [
      /Node entry snapshot probe returned a non-zero exit code/i,
      "node_snapshot_nonzero",
    ],
    [
      /Node entry snapshot probe did not execute its verified source/i,
      "node_snapshot_unverified",
    ],
    [
      /AppContainer readiness target returned a non-zero exit code/i,
      "appcontainer_readiness_nonzero",
    ],
    [
      /AppContainer SID changed during readiness attestation/i,
      "appcontainer_sid_changed",
    ],
  ];
  const classified = knownFailures.find(([pattern]) => pattern.test(stderr));
  const nativeCode = stderr.match(
    /\b(?:hresult|win32)=(0x[0-9a-f]+|\d+)\b/i,
  )?.[1];
  return [
    fallback,
    `helper_exit_${status}`,
    classified?.[1],
    nativeCode?.toLowerCase(),
  ]
    .filter(Boolean)
    .join("_");
}

function appContainerReadinessResult(
  result,
  profileName,
  targetRuntime = null,
) {
  const runtimeProbe = {
    kind: "windows-appcontainer-launch-attestation-v1",
    attempted: true,
    runnable: false,
    reason: "probe_failed",
  };
  if (result?.error || result?.status !== 0) {
    return {
      runtimeProbe: {
        ...runtimeProbe,
        reason: windowsSandboxHelperFailureReason(result, "probe_failed"),
      },
      readiness: null,
    };
  }

  let readiness;
  try {
    readiness = JSON.parse(String(result.stdout || "").trim());
  } catch {
    return {
      runtimeProbe: {
        ...runtimeProbe,
        reason: "invalid_attestation",
      },
      readiness: null,
    };
  }
  const sidPattern = /^S-1-15-2(?:-\d+){7}$/;
  if (
    readiness?.ready !== true ||
    readiness?.profileName !== profileName ||
    typeof readiness?.appContainerSid !== "string" ||
    !sidPattern.test(readiness.appContainerSid) ||
    readiness?.capabilityCount !== 0 ||
    readiness?.tokenAttested !== true ||
    readiness?.restrictedTokenAttested !== true ||
    (targetRuntime !== null &&
      (readiness?.probeRuntime !== targetRuntime ||
        readiness?.targetRuntime !== targetRuntime))
  ) {
    return {
      runtimeProbe: {
        ...runtimeProbe,
        reason: "invalid_attestation",
      },
      readiness: null,
    };
  }
  return {
    runtimeProbe: {
      ...runtimeProbe,
      runnable: true,
      reason: null,
      ...(targetRuntime
        ? {
            probeRuntime: targetRuntime,
            targetRuntime,
          }
        : {}),
    },
    readiness,
  };
}

function deleteWindowsAppContainerProfile(
  adapter,
  profileName,
  expectedSid = null,
  failure = null,
) {
  const helperArgs = ["--delete-appcontainer", profileName];
  if (expectedSid) helperArgs.push(expectedSid);
  try {
    const result = adapter.spawnSync(helperArgs, {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: WINDOWS_SANDBOX_HELPER_OPERATION_TIMEOUT_MS,
    });
    if (result?.error || result?.status !== 0) {
      if (failure) {
        failure.reason = windowsSandboxHelperFailureReason(
          result,
          "cleanup_failed",
        );
      }
      return false;
    }
    let deletion;
    try {
      deletion = JSON.parse(String(result.stdout || "").trim());
    } catch {
      if (failure) {
        failure.reason = "cleanup_failed_invalid_attestation";
      }
      return false;
    }
    const deleted =
      deletion?.deleted === true &&
      deletion?.absent === true &&
      deletion?.profileName === profileName;
    if (!deleted && failure) {
      failure.reason = "cleanup_failed_invalid_attestation";
    }
    return deleted;
  } catch (error) {
    if (failure) {
      failure.reason = windowsSandboxHelperFailureReason(
        { error, status: null },
        "cleanup_failed",
      );
    }
    return false;
  }
}

function appContainerCleanupFailureReason(readinessReason, cleanupReason) {
  const readiness =
    typeof readinessReason === "string" && readinessReason
      ? readinessReason
      : "unknown_readiness";
  const cleanup =
    typeof cleanupReason === "string" && cleanupReason
      ? cleanupReason
      : "unknown_cleanup";
  return `cleanup_unverified_after_${readiness}_because_${cleanup}`;
}

function retryWindowsAppContainerCleanup(record) {
  if (record.cleaned) return true;
  let adapter;
  try {
    adapter = createWindowsAdapterController(
      record.runtime,
      record.source,
      record.hostEnvironment,
    );
    if (!adapter.ensureExecutable) return false;
    if (
      !deleteWindowsAppContainerProfile(
        adapter,
        record.profileName,
        record.expectedSid,
      )
    ) {
      return false;
    }
    record.cleaned = true;
    if (record.automaticTimer) {
      clearTimeout(record.automaticTimer);
      record.automaticTimer = null;
    }
    windowsAppContainerCleanupBacklog.delete(record);
    return true;
  } catch {
    return false;
  } finally {
    adapter?.release?.();
  }
}

function retryWindowsAppContainerCleanupBacklog() {
  let cleaned = true;
  for (const record of [...windowsAppContainerCleanupBacklog]) {
    if (!retryWindowsAppContainerCleanup(record)) cleaned = false;
  }
  return cleaned;
}

function scheduleWindowsAppContainerCleanupRetry(record) {
  if (
    record.cleaned ||
    record.automaticTimer ||
    record.automaticAttempts >=
      WINDOWS_APPCONTAINER_AUTOMATIC_CLEANUP_DELAYS_MS.length
  ) {
    return;
  }
  record.automaticTimer = setTimeout(() => {
    record.automaticTimer = null;
    if (record.cleaned || !windowsAppContainerCleanupBacklog.has(record)) {
      return;
    }
    record.automaticAttempts += 1;
    if (!retryWindowsAppContainerCleanup(record)) {
      scheduleWindowsAppContainerCleanupRetry(record);
    }
  }, WINDOWS_APPCONTAINER_AUTOMATIC_CLEANUP_DELAYS_MS[record.automaticAttempts]);
  record.automaticTimer.unref?.();
}

function trackWindowsAppContainerCleanup(
  runtime,
  source,
  hostEnvironment,
  profileName,
  expectedSid,
) {
  let record = [...windowsAppContainerCleanupBacklog].find(
    (candidate) =>
      candidate.runtime === runtime && candidate.profileName === profileName,
  );
  if (!record) {
    record = {
      runtime,
      source,
      hostEnvironment,
      profileName,
      expectedSid,
      cleaned: false,
      automaticAttempts: 0,
      automaticTimer: null,
    };
    windowsAppContainerCleanupBacklog.add(record);
  } else if (!record.expectedSid && expectedSid) {
    record.expectedSid = expectedSid;
  }
  registerWindowsAdapterExitCleanup();
  scheduleWindowsAppContainerCleanupRetry(record);
  return record;
}

function windowsCanonicalPathKey(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return null;
  try {
    return path.win32.resolve(value).toLowerCase();
  } catch {
    return null;
  }
}

function sanitizeWindowsSandboxEnvironment(environment, pluginNodeSnapshot) {
  const sanitized = {};
  const normalizedKeys = new Map();
  for (const [key, value] of Object.entries(environment || process.env)) {
    const normalized = key.toUpperCase();
    if (
      WINDOWS_SANDBOX_HOST_ENV_DENYLIST.has(normalized) ||
      (pluginNodeSnapshot && WINDOWS_PLUGIN_NODE_ENV_DENYLIST.has(normalized))
    ) {
      continue;
    }
    const previousKey = normalizedKeys.get(normalized);
    if (previousKey !== undefined) delete sanitized[previousKey];
    normalizedKeys.set(normalized, key);
    sanitized[key] = String(value);
  }
  return sanitized;
}

function setWindowsEnvironmentValue(environment, name, value) {
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) delete environment[key];
  }
  environment[name] = String(value);
}

function windowsSandboxHostEnvironment(runtime) {
  const windowsDirectory = path.win32.resolve(runtime.windowsDir());
  const systemDirectory = runtime.joinPath(windowsDirectory, "System32");
  const temporaryDirectory = runtime.joinPath(windowsDirectory, "Temp");
  return {
    SystemRoot: windowsDirectory,
    WINDIR: windowsDirectory,
    ComSpec: runtime.joinPath(systemDirectory, "cmd.exe"),
    PATH: `${systemDirectory};${windowsDirectory}`,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
  };
}

function windowsPluginNodeEntrySnapshot(invocation, sandboxOpts, spawnOpts) {
  const contract = sandboxOpts.executionContract;
  if (!contract) return { locks: null, reason: null };
  if (contract.kind !== "strict-plugin-node-bin") {
    return {
      locks: null,
      reason: "windows_plugin_execution_contract_unsupported",
    };
  }
  if (sandboxOpts.sync !== true || spawnOpts?.detached === true) {
    return {
      locks: null,
      reason: "windows_plugin_launch_path_lock_requires_sync_foreground",
    };
  }

  const runtimeIdentity = contract.runtimeIdentity;
  const entryIdentity = contract.entryIdentity;
  const validIdentity = (identity, maxBytes) =>
    identity &&
    typeof identity === "object" &&
    typeof identity.realPath === "string" &&
    path.win32.isAbsolute(identity.realPath) &&
    typeof identity.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(identity.sha256) &&
    identity.fileId &&
    typeof identity.fileId === "object" &&
    typeof identity.fileId.dev === "string" &&
    typeof identity.fileId.ino === "string" &&
    /^\d+$/.test(identity.fileId.dev) &&
    /^\d+$/.test(identity.fileId.ino) &&
    Number.isSafeInteger(identity.bytes) &&
    identity.bytes >= 0 &&
    identity.bytes <= maxBytes;
  if (
    !validIdentity(runtimeIdentity, 256 * 1024 * 1024) ||
    !validIdentity(entryIdentity, 64 * 1024 * 1024)
  ) {
    return {
      locks: null,
      reason: "windows_plugin_launch_path_identity_invalid",
    };
  }

  const runtimePath = windowsCanonicalPathKey(runtimeIdentity.realPath);
  const entryPath = windowsCanonicalPathKey(entryIdentity.realPath);
  if (
    !runtimePath ||
    !entryPath ||
    runtimePath !== windowsCanonicalPathKey(contract.runtimePath) ||
    runtimePath !== windowsCanonicalPathKey(invocation.command) ||
    entryPath !== windowsCanonicalPathKey(invocation.args?.[0])
  ) {
    return {
      locks: null,
      reason: "windows_plugin_launch_path_identity_mismatch",
    };
  }
  if (path.win32.extname(entryIdentity.realPath).toLowerCase() !== ".cjs") {
    return {
      locks: null,
      reason: "windows_plugin_entry_snapshot_format_unsupported",
    };
  }

  return {
    locks: [
      {
        role: "runtime",
        path: runtimeIdentity.realPath,
        sha256: runtimeIdentity.sha256,
        bytes: runtimeIdentity.bytes,
        dev: runtimeIdentity.fileId.dev,
        ino: runtimeIdentity.fileId.ino,
      },
      {
        role: "entry",
        path: entryIdentity.realPath,
        sha256: entryIdentity.sha256,
        bytes: entryIdentity.bytes,
        dev: entryIdentity.fileId.dev,
        ino: entryIdentity.fileId.ino,
      },
    ],
    reason: null,
  };
}

/**
 * Wrap a target with the built-in Windows PowerShell host. The shipped
 * byte-loaded helper P/Invokes Win32 to create a restricted primary token,
 * starts the target
 * suspended, assigns it to a kill-on-close Job Object, then resumes it.
 * Filesystem/network requests additionally require a synchronous real-launch
 * AppContainer probe and suspended-target token/SID attestation.
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
  let runtime = resolveRuntime(runtimeOverrides);
  const requiredBoundaries = Array.isArray(sandboxOpts.requiredBoundaries)
    ? sandboxOpts.requiredBoundaries
    : [];
  const requiresAppContainer = requiredBoundaries.some(
    (boundary) =>
      boundary === SANDBOX_BOUNDARIES.FILESYSTEM ||
      boundary === SANDBOX_BOUNDARIES.NETWORK,
  );
  const backend = requiresAppContainer
    ? WINDOWS_APPCONTAINER_BACKEND
    : WINDOWS_RESTRICTED_TOKEN_BACKEND;
  const appContainerGuarantees = [
    SANDBOX_BOUNDARIES.FILESYSTEM,
    SANDBOX_BOUNDARIES.NETWORK,
    SANDBOX_BOUNDARIES.PROCESS_TREE,
    SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
    SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
  ];
  const base = {
    platform: runtime.platform,
    profile: sandboxOpts.profileName || "default",
    backend,
    command,
    args,
    options: spawnOpts,
  };
  const unavailablePlan = (reason, extra = {}) =>
    createSandboxPlan({
      ...base,
      ...(requiresAppContainer
        ? {
            backend: null,
            candidateBackend: WINDOWS_APPCONTAINER_BACKEND,
            policyAttested: false,
          }
        : {}),
      reason,
      ...extra,
    });
  if (runtime.platform !== "win32") {
    return unavailablePlan("platform_mismatch");
  }
  let windowsDirectory;
  try {
    windowsDirectory = path.win32.resolve(runtime.windowsDir());
  } catch {
    windowsDirectory = null;
  }
  if (
    typeof windowsDirectory !== "string" ||
    !/^[A-Za-z]:\\/.test(windowsDirectory) ||
    windowsDirectory.includes("\0")
  ) {
    return unavailablePlan("windows_trusted_system_root_unavailable");
  }
  // Resolve once per plan so even trusted embedding hooks cannot redirect the
  // host executable, cwd, and environment between individual launch steps.
  runtime = { ...runtime, windowsDir: () => windowsDirectory };

  if (
    requiresAppContainer &&
    requiredBoundaries.some(
      (boundary) => !appContainerGuarantees.includes(boundary),
    )
  ) {
    return unavailablePlan("windows_appcontainer_boundary_unsupported");
  }

  // The hosted Windows restricted-token path cannot reliably preserve file
  // descriptor backed stdout/stderr when its helper is itself detached. Mark
  // that combination unavailable before launch: strict/required callers fail
  // closed, while ordinary trusted control-plane callers retain the broker's
  // explicit audited fallback instead of receiving a phantom target PID.
  if (
    spawnOpts?.detached === true &&
    Array.isArray(spawnOpts?.stdio) &&
    spawnOpts.stdio.slice(0, 3).some((entry) => Number.isInteger(entry))
  ) {
    return unavailablePlan("windows_detached_file_stdio_unsupported");
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
    return unavailablePlan("windows_extra_descriptor_unsupported");
  }

  const invocation = normalizeWrappedInvocation(
    command,
    args,
    spawnOpts,
    runtime.platform,
  );
  const entrySnapshot = windowsPluginNodeEntrySnapshot(
    invocation,
    sandboxOpts,
    spawnOpts,
  );
  if (entrySnapshot.reason) {
    return unavailablePlan(entrySnapshot.reason);
  }
  if (entrySnapshot.locks && nodeIpcFd >= 0) {
    return unavailablePlan("windows_plugin_entry_snapshot_ipc_unsupported");
  }
  const snapshotTestGate = entrySnapshot.locks
    ? runtime.windowsSnapshotTestGate
    : null;
  if (
    snapshotTestGate !== null &&
    snapshotTestGate !== undefined &&
    (typeof snapshotTestGate !== "object" ||
      typeof snapshotTestGate.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(snapshotTestGate.token) ||
      typeof snapshotTestGate.releasePath !== "string" ||
      !path.win32.isAbsolute(snapshotTestGate.releasePath) ||
      snapshotTestGate.releasePath.includes("\0"))
  ) {
    return unavailablePlan("windows_plugin_entry_snapshot_test_gate_invalid");
  }
  const profile = sandboxOpts.profileName || "default";
  const executableName = path.win32
    .basename(String(invocation.command))
    .toLowerCase();
  if (
    profile === "default" &&
    requiredBoundaries.length === 0 &&
    !entrySnapshot.locks &&
    (executableName === "git" || executableName === "git.exe")
  ) {
    return unavailablePlan("windows_git_nested_process_compatibility");
  }
  const loaderMode =
    profile !== "strict" && !requiresAppContainer && !entrySnapshot.locks
      ? "managed-executable"
      : "powershell-byte-assembly";
  const adapterSource = loadWindowsAdapterSource(runtime, loaderMode);
  if (!adapterSource.content) {
    return unavailablePlan(adapterSource.reason);
  }
  const targetEnvironment = sanitizeWindowsSandboxEnvironment(
    invocation.options.env,
    Boolean(entrySnapshot.locks),
  );
  setWindowsEnvironmentValue(targetEnvironment, "CC_WINDOWS_SANDBOXED", "1");
  setWindowsEnvironmentValue(
    targetEnvironment,
    "CC_WINDOWS_SANDBOX_PROFILE",
    profile,
  );
  if (nodeIpcFd >= 0) {
    setWindowsEnvironmentValue(
      targetEnvironment,
      "NODE_CHANNEL_FD",
      String(nodeIpcFd),
    );
    setWindowsEnvironmentValue(
      targetEnvironment,
      "NODE_CHANNEL_SERIALIZATION_MODE",
      invocation.options.serialization === "advanced" ? "advanced" : "json",
    );
  }
  const hostEnvironment = windowsSandboxHostEnvironment(runtime);
  const helperWorkingDirectory = runtime.joinPath(
    runtime.windowsDir(),
    "System32",
  );
  const limits = sandboxOpts.limits || {};
  const targetWorkingDirectory = runtime.resolvePath(
    invocation.options.cwd || process.cwd(),
  );
  const identityPath =
    spawnOpts?.detached === true ||
    (requiresAppContainer && sandboxOpts.sync !== true)
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
    allowReparsePaths: loaderMode === "managed-executable",
    disableAdministratorSids:
      profile === "strict" ||
      requiresAppContainer ||
      Boolean(entrySnapshot.locks),
    command: invocation.command,
    args: invocation.args,
    nodeIpcFd,
    detached: invocation.options.detached === true,
    windowsHide: invocation.options.windowsHide === true,
    workingDirectory: targetWorkingDirectory,
    environment: targetEnvironment,
  };
  if (entrySnapshot.locks) {
    launchSpec.launchPathLocks = entrySnapshot.locks;
    if (snapshotTestGate) {
      launchSpec.snapshotTestGateToken = snapshotTestGate.token;
      launchSpec.snapshotTestGateReleasePath = snapshotTestGate.releasePath;
    }
  }
  if (identityPath) launchSpec.identityPath = identityPath;
  const cleanupIdentity = () => {
    if (!identityPath) return true;
    return cleanupOrTrackWindowsTemporaryPath(runtime, identityPath);
  };
  const appContainerProfileName = requiresAppContainer
    ? `ChainlessChain.CliSandbox.${runtime.randomBytes(12).toString("hex")}`
    : null;
  const adapter = createWindowsAdapterController(
    runtime,
    adapterSource,
    hostEnvironment,
  );
  if (!adapter.ensureExecutable) {
    cleanupIdentity();
    return unavailablePlan(adapter.reason);
  }

  let appContainer = null;
  let appContainerRuntimeProbe = null;
  let nodeSnapshotRuntimeProbe = null;
  if (entrySnapshot.locks && !requiresAppContainer) {
    let probeResult;
    try {
      probeResult = adapter.spawnSync(
        ["--probe-node-snapshot", entrySnapshot.locks[0].path],
        {
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: WINDOWS_SANDBOX_HELPER_OPERATION_TIMEOUT_MS,
        },
      );
    } catch (error) {
      probeResult = { error, status: null };
    }
    nodeSnapshotRuntimeProbe = windowsNodeSnapshotProbeResult(probeResult);
    if (!nodeSnapshotRuntimeProbe.runnable) {
      adapter.release();
      cleanupIdentity();
      return unavailablePlan("windows_plugin_entry_snapshot_probe_failed", {
        runtimeProbe: nodeSnapshotRuntimeProbe,
      });
    }
  }
  if (requiresAppContainer) {
    let readinessResult;
    try {
      const readinessArgs = ["--prepare-appcontainer", appContainerProfileName];
      if (entrySnapshot.locks) {
        readinessArgs.push(entrySnapshot.locks[0].path);
      }
      readinessResult = adapter.spawnSync(readinessArgs, {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: WINDOWS_SANDBOX_HELPER_OPERATION_TIMEOUT_MS,
      });
    } catch (error) {
      readinessResult = { error, status: null };
    }
    const readiness = appContainerReadinessResult(
      readinessResult,
      appContainerProfileName,
      entrySnapshot.locks ? "node" : null,
    );
    appContainerRuntimeProbe = readiness.runtimeProbe;
    if (!readiness.readiness) {
      const cleanupFailure = {};
      const deleted = deleteWindowsAppContainerProfile(
        adapter,
        appContainerProfileName,
        null,
        cleanupFailure,
      );
      if (!deleted) {
        trackWindowsAppContainerCleanup(
          runtime,
          adapterSource,
          hostEnvironment,
          appContainerProfileName,
          null,
        );
      }
      adapter.release();
      if (!deleted) {
        appContainerRuntimeProbe = {
          ...appContainerRuntimeProbe,
          reason: appContainerCleanupFailureReason(
            appContainerRuntimeProbe.reason,
            cleanupFailure.reason,
          ),
        };
        cleanupIdentity();
        return unavailablePlan(
          "windows_appcontainer_readiness_cleanup_unverified",
          {
            runtimeProbe: appContainerRuntimeProbe,
          },
        );
      }
      cleanupIdentity();
      return unavailablePlan("windows_appcontainer_readiness_failed", {
        runtimeProbe: appContainerRuntimeProbe,
      });
    }
    appContainer = {
      appContainerProfileName,
      appContainerSid: readiness.readiness.appContainerSid,
    };
    launchSpec.appContainerProfileName = appContainer.appContainerProfileName;
    launchSpec.appContainerSid = appContainer.appContainerSid;
    setWindowsEnvironmentValue(
      targetEnvironment,
      "CC_WINDOWS_APPCONTAINER",
      "1",
    );
    setWindowsEnvironmentValue(
      targetEnvironment,
      "CC_WINDOWS_APPCONTAINER_PROFILE",
      appContainer.appContainerProfileName,
    );
    setWindowsEnvironmentValue(
      targetEnvironment,
      "CC_WINDOWS_APPCONTAINER_SID",
      appContainer.appContainerSid,
    );
  }

  let helperInvocation;
  try {
    const payload = Buffer.from(JSON.stringify(launchSpec), "utf8").toString(
      "base64",
    );
    // This is the final synchronous operation before the broker consumes the
    // plan and spawns the helper. Internal readiness/deletion invocations also
    // pass through the same digest + file-identity attestation.
    helperInvocation = adapter.createInvocation([payload]);
  } catch (error) {
    const cleanupFailure = {};
    const deleted = appContainer
      ? deleteWindowsAppContainerProfile(
          adapter,
          appContainer.appContainerProfileName,
          appContainer.appContainerSid,
          cleanupFailure,
        )
      : true;
    if (!deleted) {
      trackWindowsAppContainerCleanup(
        runtime,
        adapterSource,
        hostEnvironment,
        appContainer.appContainerProfileName,
        appContainer.appContainerSid,
      );
    }
    adapter.release();
    cleanupIdentity();
    if (!deleted) {
      return unavailablePlan(
        "windows_appcontainer_readiness_cleanup_unverified",
        {
          runtimeProbe: appContainerRuntimeProbe
            ? {
                ...appContainerRuntimeProbe,
                runnable: false,
                reason: appContainerCleanupFailureReason(
                  appContainerRuntimeProbe.reason || "ready",
                  cleanupFailure.reason,
                ),
              }
            : null,
        },
      );
    }
    return unavailablePlan(
      error?.adapterReason || "windows_native_adapter_attestation_failed",
      { runtimeProbe: appContainerRuntimeProbe },
    );
  }

  const options = {
    ...invocation.options,
    // The managed helper is the lifetime supervisor and must stay attached to
    // the broker so its bootstrap can reliably publish the target identity.
    // The payload still carries `detached: true`, so the helper creates the
    // actual target with DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP. Detaching
    // the outer PowerShell host as well caused it to stall before writing the
    // identity file on Windows.
    detached: false,
    shell: false,
    cwd: helperWorkingDirectory,
    env: hostEnvironment,
  };
  let appContainerCleanupVerified = false;
  let appContainerCleanupRecord = null;
  const cleanupAppContainer = () => {
    if (!appContainer || appContainerCleanupVerified) return true;
    if (appContainerCleanupRecord) {
      if (!retryWindowsAppContainerCleanup(appContainerCleanupRecord)) {
        return false;
      }
      appContainerCleanupRecord = null;
      appContainerCleanupVerified = true;
      return true;
    }
    // Native.Run deletes the profile on every ordinary target exit. This
    // second, intentionally idempotent path covers a failed spawn or a helper
    // that was forcibly terminated before its finally block ran. The helper
    // re-derives and compares the expected SID, then proves absence by
    // creating and deleting a fresh verification profile with the same name.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const deleted = deleteWindowsAppContainerProfile(
        adapter,
        appContainer.appContainerProfileName,
        appContainer.appContainerSid,
      );
      if (deleted) {
        appContainerCleanupVerified = true;
        return true;
      }
      if (attempt < 3) runtime.sleepSync(25);
    }
    appContainerCleanupRecord = trackWindowsAppContainerCleanup(
      runtime,
      adapterSource,
      hostEnvironment,
      appContainer.appContainerProfileName,
      appContainer.appContainerSid,
    );
    return false;
  };
  const cleanup = () => {
    const failures = [];
    const attempt = (label, action) => {
      try {
        if (action() === false) failures.push(label);
      } catch (error) {
        failures.push(`${label}: ${error?.message || error}`);
      }
    };
    try {
      attempt("target identity", cleanupIdentity);
      attempt("invocation payload", helperInvocation.cleanup);
      attempt("AppContainer profile", cleanupAppContainer);
    } finally {
      adapter.release();
    }
    if (failures.length > 0) {
      const message =
        "Windows sandbox cleanup could not be verified for " +
        failures.join(", ");
      if (sandboxOpts.sync === true) throw new Error(message);
      runtime.warn(message);
      return false;
    }
    return true;
  };
  const identityContract = identityPath
    ? {
        postSpawn: { required: true, mode: "sync" },
        postSpawnWindows: (proc) => {
          try {
            const identity = waitForWindowsTargetIdentity(
              proc,
              identityPath,
              runtime,
              appContainer,
            );
            if (!cleanupIdentity()) {
              throw new Error(
                "Windows sandbox target identity cleanup could not be verified",
              );
            }
            return identity;
          } catch (error) {
            try {
              proc.kill?.();
            } catch {
              // Closing the helper is best-effort; the thrown failure remains
              // authoritative and strict mode will fail closed.
            }
            if (!cleanupIdentity()) {
              throw new Error(
                "Windows sandbox target identity cleanup could not be verified",
                { cause: error },
              );
            }
            throw error;
          }
        },
      }
    : {};
  const entrySnapshotRuntimeProbe = entrySnapshot.locks
    ? {
        ...(appContainerRuntimeProbe || nodeSnapshotRuntimeProbe),
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-handle-inherited-pipe-module-compile-v1",
        handleAtomic: false,
      }
    : appContainerRuntimeProbe;

  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: backend,
    policyAttested: requiresAppContainer ? true : null,
    runtimeProbe: entrySnapshotRuntimeProbe,
    guarantees: requiresAppContainer
      ? appContainerGuarantees
      : [
          SANDBOX_BOUNDARIES.PROCESS_TREE,
          SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
          SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
        ],
    command: helperInvocation.command,
    args: helperInvocation.args,
    options,
    ...identityContract,
    cleanup,
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

function linuxBubblewrapProbe(
  attempted,
  runnable,
  reason,
  targetRuntime = "node",
) {
  const native = targetRuntime === "native-static-elf";
  return {
    kind: native
      ? "linux-bwrap-plugin-native-static-elf-policy-v1"
      : "linux-bwrap-plugin-node-policy-v1",
    attempted,
    runnable,
    reason,
    probeRuntime: "node",
    targetRuntime,
    contentSnapshot: false,
    handleAtomic: false,
  };
}

function linuxRealpath(runtime, value) {
  const realpathSync = runtime.fs?.realpathSync;
  if (typeof realpathSync !== "function") {
    throw new Error("realpath_unavailable");
  }
  return typeof realpathSync.native === "function"
    ? realpathSync.native(value)
    : realpathSync(value);
}

function linuxPathWithin(root, target) {
  const relative = path.posix.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.posix.isAbsolute(relative)
  );
}

function linuxIdentityMatches(runtime, identity, { executable = false } = {}) {
  if (
    !identity ||
    typeof identity.realPath !== "string" ||
    !path.posix.isAbsolute(identity.realPath) ||
    typeof identity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.sha256) ||
    !identity.fileId ||
    !Number.isSafeInteger(identity.bytes) ||
    identity.bytes < 0 ||
    identity.bytes > LINUX_ATTESTED_FILE_MAX_BYTES ||
    identity.mtimeMs === null
  ) {
    return false;
  }
  let fd;
  try {
    if (linuxRealpath(runtime, identity.realPath) !== identity.realPath) {
      return false;
    }
    const lst = runtime.fs.lstatSync(identity.realPath);
    if (lst.isSymbolicLink() || !lst.isFile()) return false;
    if (executable && (Number(lst.mode) & 0o111) === 0) return false;
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(identity.realPath, flags);
    const before = runtime.fs.fstatSync(fd);
    if (
      !before.isFile() ||
      String(before.dev) !== String(identity.fileId.dev) ||
      String(before.ino) !== String(identity.fileId.ino) ||
      Number(before.size) !== Number(identity.bytes) ||
      Number(before.mtimeMs) !== Number(identity.mtimeMs)
    ) {
      return false;
    }
    const digest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(
      Math.max(1, Math.min(LINUX_ATTESTATION_HASH_CHUNK_BYTES, identity.bytes)),
    );
    let offset = 0;
    while (offset < identity.bytes) {
      const read = runtime.fs.readSync(
        fd,
        chunk,
        0,
        Math.min(chunk.length, identity.bytes - offset),
        offset,
      );
      if (read <= 0) return false;
      digest.update(chunk.subarray(0, read));
      offset += read;
    }
    const after = runtime.fs.fstatSync(fd);
    const stable =
      String(before.dev) === String(after.dev) &&
      String(before.ino) === String(after.ino) &&
      Number(before.size) === Number(after.size) &&
      Number(before.mtimeMs) === Number(after.mtimeMs);
    if (!stable) return false;
    return digest.digest("hex") === identity.sha256;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // best effort
      }
    }
  }
}

function linuxDirectoryIdentityMatches(runtime, identity) {
  if (
    !identity ||
    typeof identity.realPath !== "string" ||
    !path.posix.isAbsolute(identity.realPath) ||
    !identity.fileId
  ) {
    return false;
  }
  try {
    const stat = runtime.fs.lstatSync(identity.realPath);
    return (
      !stat.isSymbolicLink() &&
      stat.isDirectory() &&
      String(stat.dev) === String(identity.fileId.dev) &&
      String(stat.ino) === String(identity.fileId.ino)
    );
  } catch {
    return false;
  }
}

function validateLinuxPluginTree(runtime, pluginRoot) {
  try {
    const rootStat = runtime.fs.lstatSync(pluginRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return false;
    const rootDevice = String(rootStat.dev);
    const pending = [pluginRoot];
    let entries = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      const children = runtime.fs.readdirSync(current, {
        withFileTypes: true,
      });
      for (const child of children) {
        entries += 1;
        if (entries > LINUX_BWRAP_MAX_PLUGIN_ENTRIES) return false;
        const childPath = path.posix.join(current, child.name);
        const stat = runtime.fs.lstatSync(childPath);
        if (
          stat.isSymbolicLink() ||
          String(stat.dev) !== rootDevice ||
          stat.isSocket?.() ||
          stat.isFIFO?.() ||
          stat.isBlockDevice?.() ||
          stat.isCharacterDevice?.()
        ) {
          return false;
        }
        if (stat.isDirectory()) {
          pending.push(childPath);
        } else if (!stat.isFile() || Number(stat.nlink) !== 1) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function decodeLinuxMountInfoPath(value) {
  return value.replace(/\\(040|011|012|134)/g, (_match, escaped) => {
    const decoded = {
      "040": " ",
      "011": "\t",
      "012": "\n",
      134: "\\",
    };
    return decoded[escaped];
  });
}

function linuxPluginMountTreeIsNarrow(runtime, pluginRoot) {
  try {
    const contents = String(
      runtime.fs.readFileSync("/proc/self/mountinfo", "utf8"),
    );
    let parsed = 0;
    let coveringMount = null;
    for (const line of contents.split(/\r?\n/)) {
      if (!line) continue;
      const fields = line.split(" ");
      const separator = fields.indexOf("-");
      if (
        fields.length < 10 ||
        separator < 6 ||
        separator + 2 >= fields.length
      ) {
        return false;
      }
      parsed += 1;
      const mountPoint = decodeLinuxMountInfoPath(fields[4]);
      const filesystemType = fields[separator + 1];
      if (mountPoint === pluginRoot) return false;
      if (linuxPathWithin(pluginRoot, mountPoint)) {
        return false;
      }
      if (linuxPathWithin(mountPoint, pluginRoot)) {
        if (
          !coveringMount ||
          mountPoint.length > coveringMount.mountPoint.length
        ) {
          coveringMount = { mountPoint, filesystemType };
        }
      }
    }
    return (
      parsed > 0 &&
      coveringMount !== null &&
      LINUX_LOCAL_FILESYSTEM_TYPES.has(coveringMount.filesystemType)
    );
  } catch {
    return false;
  }
}

function linuxStdioIsNarrow(stdio) {
  if (stdio === undefined || stdio === null) return true;
  if (stdio === "pipe" || stdio === "ignore") return true;
  if (!Array.isArray(stdio) || stdio.length > 3) return false;
  return stdio.every(
    (entry) =>
      entry === undefined ||
      entry === null ||
      entry === "pipe" ||
      entry === "ignore",
  );
}

function assignLinuxMountChildFds(mounts) {
  return mounts.map((mount, index) => ({
    ...mount,
    childFd: LINUX_BWRAP_FIRST_MOUNT_FD + index,
  }));
}

function linuxStdioWithPinnedMounts(
  stdio,
  descriptors,
  { probe = false } = {},
) {
  let standard;
  if (probe) {
    standard = ["ignore", "pipe", "pipe"];
  } else if (Array.isArray(stdio)) {
    standard = [...stdio];
  } else if (stdio === "ignore") {
    standard = ["ignore", "ignore", "ignore"];
  } else {
    standard = ["pipe", "pipe", "pipe"];
  }
  while (standard.length < 3) standard.push(undefined);
  return [
    ...standard.slice(0, 3),
    ...descriptors.map((descriptor) => descriptor.fd),
  ];
}

function validateLinuxPluginContract(
  command,
  args,
  spawnOpts,
  contract,
  runtime,
  sync,
) {
  const nodeContract = contract?.kind === "strict-plugin-node-bin";
  const nativeContract =
    contract?.kind === "strict-plugin-native-static-elf-bin";
  if (
    !contract ||
    contract.contractVersion !== 1 ||
    (!nodeContract && !nativeContract)
  ) {
    return { ok: false, reason: "execution_contract_missing" };
  }
  if (
    sync !== true ||
    spawnOpts?.shell !== false ||
    spawnOpts?.detached === true ||
    !linuxStdioIsNarrow(spawnOpts?.stdio) ||
    spawnOpts?.serialization !== undefined ||
    spawnOpts?.argv0 !== undefined ||
    spawnOpts?.uid !== undefined ||
    spawnOpts?.gid !== undefined
  ) {
    return { ok: false, reason: "unsupported_launch_options" };
  }
  const invalidArgs =
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0"));
  const invalidNodeLaunch =
    nodeContract &&
    (!Array.isArray(args) ||
      command !== contract.runtimePath ||
      command !== contract.runtimeIdentity?.realPath ||
      args.length < 1 ||
      args[0] !== contract.entryIdentity?.realPath);
  const invalidNativeLaunch =
    nativeContract && command !== contract.entryIdentity?.realPath;
  if (
    typeof command !== "string" ||
    !path.posix.isAbsolute(command) ||
    invalidArgs ||
    invalidNodeLaunch ||
    invalidNativeLaunch
  ) {
    return { ok: false, reason: "launch_identity_mismatch" };
  }
  if (
    nodeContract &&
    ![".js", ".cjs", ".mjs"].includes(
      path.posix.extname(contract.entryIdentity.realPath).toLowerCase(),
    )
  ) {
    return { ok: false, reason: "unsupported_plugin_entry" };
  }
  for (const value of [
    contract.pluginRoot,
    contract.workingDirectory,
    contract.rootIdentity?.realPath,
    contract.entryIdentity.realPath,
    contract.runtimeIdentity.realPath,
  ]) {
    if (
      typeof value !== "string" ||
      !path.posix.isAbsolute(value) ||
      value.includes("\0")
    ) {
      return { ok: false, reason: "noncanonical_contract_path" };
    }
  }
  try {
    if (
      linuxRealpath(runtime, contract.pluginRoot) !== contract.pluginRoot ||
      linuxRealpath(runtime, contract.workingDirectory) !==
        contract.workingDirectory ||
      contract.workingDirectory !== contract.pluginRoot ||
      linuxRealpath(runtime, spawnOpts.cwd) !== contract.pluginRoot ||
      contract.rootIdentity?.realPath !== contract.pluginRoot ||
      !linuxPathWithin(contract.pluginRoot, contract.entryIdentity.realPath)
    ) {
      return { ok: false, reason: "noncanonical_contract_path" };
    }
  } catch {
    return { ok: false, reason: "contract_path_unavailable" };
  }
  const forbiddenRoots = new Set([
    "/",
    "/bin",
    "/dev",
    "/etc",
    "/home",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sys",
    "/tmp",
    "/usr",
    "/var",
    path.posix.resolve(runtime.homedir()),
  ]);
  if (
    forbiddenRoots.has(contract.pluginRoot) ||
    ["/dev", "/proc", "/run", "/sys"].some(
      (root) =>
        contract.pluginRoot === root ||
        contract.pluginRoot.startsWith(`${root}/`),
    )
  ) {
    return { ok: false, reason: "broad_plugin_root_disallowed" };
  }
  if (
    !linuxDirectoryIdentityMatches(runtime, contract.rootIdentity) ||
    !linuxIdentityMatches(runtime, contract.entryIdentity, {
      executable: nativeContract,
    }) ||
    !linuxIdentityMatches(runtime, contract.runtimeIdentity, {
      executable: true,
    })
  ) {
    return { ok: false, reason: "execution_identity_changed" };
  }
  let entryFormat = null;
  if (nativeContract) {
    try {
      entryFormat = inspectLinuxStaticNativePath(
        runtime,
        contract.entryIdentity,
      );
    } catch (error) {
      return {
        ok: false,
        reason: error.message || "native_entry_unattested",
      };
    }
  }
  if (
    !validateLinuxPluginTree(runtime, contract.pluginRoot) ||
    !linuxPluginMountTreeIsNarrow(runtime, contract.pluginRoot)
  ) {
    return { ok: false, reason: "plugin_tree_unattested" };
  }
  return {
    ok: true,
    contract,
    entryRuntime: nativeContract ? "native-static-elf" : "node",
    entryFormat,
  };
}

function linuxStatMatches(left, right) {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    Number(left.size) === Number(right.size) &&
    Number(left.mtimeMs) === Number(right.mtimeMs)
  );
}

function linuxOpenStatMatches(left, right) {
  const timestamp = (stat, nanosecondsKey, millisecondsKey) =>
    stat[nanosecondsKey] !== undefined
      ? String(stat[nanosecondsKey])
      : String(Math.trunc(Number(stat[millisecondsKey] || 0) * 1_000_000));
  return (
    linuxStatMatches(left, right) &&
    String(left.mode) === String(right.mode) &&
    String(left.nlink) === String(right.nlink) &&
    timestamp(left, "ctimeNs", "ctimeMs") ===
      timestamp(right, "ctimeNs", "ctimeMs") &&
    timestamp(left, "mtimeNs", "mtimeMs") ===
      timestamp(right, "mtimeNs", "mtimeMs")
  );
}

function readLinuxFdExactly(runtime, fd, bytes, position) {
  const result = Buffer.allocUnsafe(bytes);
  let offset = 0;
  while (offset < bytes) {
    const read = runtime.fs.readSync(
      fd,
      result,
      offset,
      bytes - offset,
      position + offset,
    );
    if (read <= 0) throw new Error("elf_file_ended_early");
    offset += read;
  }
  return result;
}

function hashLinuxOpenFile(runtime, fd, bytes) {
  const digest = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(
    Math.max(1, Math.min(LINUX_ATTESTATION_HASH_CHUNK_BYTES, bytes)),
  );
  let offset = 0;
  while (offset < bytes) {
    const read = runtime.fs.readSync(
      fd,
      chunk,
      0,
      Math.min(chunk.length, bytes - offset),
      offset,
    );
    if (read <= 0) throw new Error("elf_file_ended_early");
    digest.update(chunk.subarray(0, read));
    offset += read;
  }
  return digest.digest("hex");
}

/**
 * Classify one already-pinned plugin entry without invoking it or any host
 * inspection utility. The initial native slice accepts only conventional
 * fully static ELF64 ET_EXEC images for the current architecture.
 */
function inspectLinuxStaticNativeElf(runtime, fd, identity) {
  const expectedMachine = LINUX_ELF_MACHINES[runtime.arch];
  if (!expectedMachine) {
    throw new Error(`unsupported_elf_architecture:${String(runtime.arch)}`);
  }
  const before = runtime.fs.fstatSync(fd);
  if (
    !before.isFile() ||
    Number(before.nlink) !== 1 ||
    (Number(before.mode) & 0o111) === 0 ||
    (Number(before.mode) & 0o6000) !== 0 ||
    String(before.dev) !== String(identity?.fileId?.dev) ||
    String(before.ino) !== String(identity?.fileId?.ino) ||
    Number(before.size) !== Number(identity?.bytes) ||
    Number(before.mtimeMs) !== Number(identity?.mtimeMs) ||
    Number(before.size) < LINUX_ELF64_HEADER_BYTES
  ) {
    throw new Error("native_entry_identity_changed");
  }

  const header = readLinuxFdExactly(runtime, fd, LINUX_ELF64_HEADER_BYTES, 0);
  if (
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46
  ) {
    throw new Error("native_entry_not_elf");
  }
  if (header[4] !== 2) throw new Error("native_entry_not_elf64");
  if (header[5] !== 1) throw new Error("native_entry_not_little_endian");
  if (header[6] !== 1 || header.readUInt32LE(20) !== 1) {
    throw new Error("native_entry_invalid_elf_version");
  }
  if (header.readUInt16LE(16) !== 2) {
    throw new Error("native_entry_not_static_et_exec");
  }
  if (header.readUInt16LE(18) !== expectedMachine) {
    throw new Error("native_entry_architecture_mismatch");
  }
  if (header.readUInt16LE(52) !== LINUX_ELF64_HEADER_BYTES) {
    throw new Error("native_entry_invalid_elf_header");
  }
  const programHeaderBytes = header.readUInt16LE(54);
  const programHeaderCount = header.readUInt16LE(56);
  if (
    programHeaderBytes !== LINUX_ELF64_PROGRAM_HEADER_BYTES ||
    programHeaderCount < 1 ||
    programHeaderCount > LINUX_ELF_MAX_PROGRAM_HEADERS ||
    programHeaderCount === 0xffff
  ) {
    throw new Error("native_entry_invalid_program_headers");
  }
  const programHeaderOffset = header.readBigUInt64LE(32);
  const tableBytes = BigInt(programHeaderBytes) * BigInt(programHeaderCount);
  const fileBytes = BigInt(before.size);
  if (
    programHeaderOffset > fileBytes ||
    tableBytes > fileBytes - programHeaderOffset ||
    programHeaderOffset > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("native_entry_program_headers_out_of_bounds");
  }

  const entryAddress = header.readBigUInt64LE(24);
  let executableLoad = false;
  let entryInExecutableLoad = false;
  let nonExecutableStack = false;
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset =
      Number(programHeaderOffset) + index * LINUX_ELF64_PROGRAM_HEADER_BYTES;
    const program = readLinuxFdExactly(
      runtime,
      fd,
      LINUX_ELF64_PROGRAM_HEADER_BYTES,
      offset,
    );
    const type = program.readUInt32LE(0);
    const flags = program.readUInt32LE(4);
    const fileOffset = program.readBigUInt64LE(8);
    const virtualAddress = program.readBigUInt64LE(16);
    const fileSize = program.readBigUInt64LE(32);
    const memorySize = program.readBigUInt64LE(40);
    if (fileOffset > fileBytes || fileSize > fileBytes - fileOffset) {
      throw new Error("native_entry_segment_out_of_bounds");
    }
    if (type === 1 && fileSize > memorySize) {
      throw new Error("native_entry_segment_out_of_bounds");
    }
    if (type === 2) throw new Error("native_entry_dynamic_elf_unsupported");
    if (type === 3) throw new Error("native_entry_interpreter_unsupported");
    if (type === 0x6474e551) {
      if ((flags & 0x1) !== 0) {
        throw new Error("native_entry_executable_stack_unsupported");
      }
      nonExecutableStack = true;
    }
    if (type === 1 && (flags & 0x1) !== 0) {
      if ((flags & 0x2) !== 0) {
        throw new Error("native_entry_writable_executable_segment");
      }
      executableLoad = true;
      if (
        entryAddress >= virtualAddress &&
        entryAddress - virtualAddress < memorySize
      ) {
        entryInExecutableLoad = true;
      }
    }
  }
  if (!executableLoad || !entryInExecutableLoad) {
    throw new Error("native_entry_has_no_executable_entry_segment");
  }
  if (!nonExecutableStack) {
    throw new Error("native_entry_nonexecutable_stack_unattested");
  }

  const sha256 = hashLinuxOpenFile(runtime, fd, Number(before.size));
  const after = runtime.fs.fstatSync(fd);
  if (!linuxOpenStatMatches(before, after) || sha256 !== identity.sha256) {
    throw new Error("native_entry_changed_during_elf_attestation");
  }
  return Object.freeze({
    format: "elf64-static-et-exec",
    architecture: runtime.arch,
    machine: expectedMachine,
    programHeaders: programHeaderCount,
  });
}

function inspectLinuxStaticNativePath(runtime, identity) {
  let fd;
  try {
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(identity.realPath, flags);
    return inspectLinuxStaticNativeElf(runtime, fd, identity);
  } finally {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // best effort
      }
    }
  }
}

function linuxFdMountId(runtime, fd) {
  const contents = String(
    runtime.fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"),
  );
  const match = contents.match(/^mnt_id:\s*(\d+)\s*$/m);
  if (!match) throw new Error("fd_mount_identity_unavailable");
  return match[1];
}

function closeLinuxPinnedMounts(runtime, mounts) {
  for (const mount of mounts || []) {
    if (!Number.isInteger(mount?.fd)) continue;
    try {
      runtime.fs.closeSync(mount.fd);
    } catch {
      // Best effort. The process is already fail-closed if a pin cannot be
      // created; cleanup must not replace the original boundary error.
    }
  }
}

function pinLinuxRegularFile(
  runtime,
  source,
  destination,
  expectedStat,
  {
    requireSingleLink = false,
    openPath = source,
    verifyCurrentPath = true,
    expectedMountId = null,
  } = {},
) {
  let fd;
  try {
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(openPath, flags);
    const opened = runtime.fs.fstatSync(fd);
    const current = verifyCurrentPath ? runtime.fs.statSync(source) : opened;
    if (
      !opened.isFile() ||
      !linuxStatMatches(opened, current) ||
      (expectedStat && !linuxStatMatches(opened, expectedStat)) ||
      (requireSingleLink && Number(opened.nlink) !== 1) ||
      (expectedMountId !== null &&
        linuxFdMountId(runtime, fd) !== expectedMountId)
    ) {
      throw new Error("pinned_file_identity_changed");
    }
    return {
      source,
      destination,
      fd,
      fileId: {
        dev: String(opened.dev),
        ino: String(opened.ino),
      },
      bytes: Number(opened.size),
      mtimeMs: Number(opened.mtimeMs),
    };
  } catch (error) {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // best effort
      }
    }
    throw error;
  }
}

/**
 * Build a synthetic plugin tree from individually pinned regular files.
 * Never bind the mutable source directory itself: files added, hard-linked,
 * symlinked, or mount-injected after this scan cannot appear in the sandbox.
 */
function pinLinuxPluginTree(runtime, pluginRoot, rootIdentity) {
  const mounts = [];
  const directoryPins = [];
  try {
    const constants = runtime.fs.constants || fs.constants;
    const directoryFlags =
      Number(constants.O_RDONLY) |
      Number(constants.O_DIRECTORY || 0) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    const rootFd = runtime.fs.openSync(pluginRoot, directoryFlags);
    directoryPins.push({ fd: rootFd });
    const rootStat = runtime.fs.fstatSync(rootFd);
    const rootPathStat = runtime.fs.lstatSync(pluginRoot);
    if (
      rootPathStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      !linuxStatMatches(rootStat, rootPathStat) ||
      String(rootStat.dev) !== String(rootIdentity?.fileId?.dev) ||
      String(rootStat.ino) !== String(rootIdentity?.fileId?.ino)
    ) {
      throw new Error("plugin_root_not_directory");
    }
    const rootMountId = linuxFdMountId(runtime, rootFd);
    const rootDevice = String(rootStat.dev);
    const directories = new Set(["/opt/chainless/plugin"]);
    const pending = [{ fd: rootFd, source: pluginRoot, relative: "" }];
    let entries = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      const currentHandlePath = `/proc/self/fd/${current.fd}`;
      const children = runtime.fs
        .readdirSync(currentHandlePath, { withFileTypes: true })
        .map((child) => child.name)
        .sort((left, right) => left.localeCompare(right));
      for (const name of children) {
        if (
          typeof name !== "string" ||
          !name ||
          name === "." ||
          name === ".." ||
          name.includes("/") ||
          name.includes("\0")
        ) {
          throw new Error("plugin_tree_entry_invalid");
        }
        entries += 1;
        if (entries > LINUX_BWRAP_MAX_PLUGIN_ENTRIES) {
          throw new Error("plugin_tree_too_large");
        }
        const source = path.posix.join(current.source, name);
        const sourceHandlePath = `${currentHandlePath}/${name}`;
        const relative = current.relative
          ? path.posix.join(current.relative, name)
          : name;
        const destination = path.posix.join("/opt/chainless/plugin", relative);
        const stat = runtime.fs.lstatSync(sourceHandlePath);
        if (
          stat.isSymbolicLink() ||
          String(stat.dev) !== rootDevice ||
          stat.isSocket?.() ||
          stat.isFIFO?.() ||
          stat.isBlockDevice?.() ||
          stat.isCharacterDevice?.()
        ) {
          throw new Error("plugin_tree_entry_unattested");
        }
        if (stat.isDirectory()) {
          const fd = runtime.fs.openSync(sourceHandlePath, directoryFlags);
          const opened = runtime.fs.fstatSync(fd);
          directoryPins.push({ fd });
          if (
            !opened.isDirectory() ||
            !linuxStatMatches(opened, stat) ||
            linuxFdMountId(runtime, fd) !== rootMountId
          ) {
            throw new Error("plugin_tree_directory_changed");
          }
          directories.add(destination);
          pending.push({ fd, source, relative });
        } else if (stat.isFile() && Number(stat.nlink) === 1) {
          mounts.push(
            pinLinuxRegularFile(runtime, source, destination, stat, {
              openPath: sourceHandlePath,
              verifyCurrentPath: false,
              requireSingleLink: true,
              expectedMountId: rootMountId,
            }),
          );
        } else {
          throw new Error("plugin_tree_entry_unattested");
        }
      }
    }
    closeLinuxPinnedMounts(runtime, directoryPins);
    return {
      directories: [...directories].sort((left, right) => {
        const depth =
          left.split("/").filter(Boolean).length -
          right.split("/").filter(Boolean).length;
        return depth || left.localeCompare(right);
      }),
      mounts,
    };
  } catch (error) {
    closeLinuxPinnedMounts(runtime, directoryPins);
    closeLinuxPinnedMounts(runtime, mounts);
    throw error;
  }
}

function buildLinuxNetworkSeccompFilter(arch) {
  const architecture = LINUX_SECCOMP_FILTERS[arch];
  if (!architecture) {
    throw new Error(`unsupported_seccomp_architecture:${String(arch)}`);
  }
  const instructions = [
    // Reject a different syscall ABI instead of interpreting overlapping
    // syscall numbers under the wrong architecture.
    [0x20, 0, 0, 4],
    [0x15, 1, 0, architecture.auditArch],
    [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0],
  ];
  if (architecture.x32SyscallBit) {
    instructions.push([0x54, 0, 0, ~architecture.x32SyscallBit]);
  }
  instructions.push(
    // No socket family is needed by this direct foreground Plugin Node route.
    // Blocking creation rather than relying only on CLONE_NEWNET also closes
    // non-network-namespaced transports such as AF_VSOCK.
    [0x15, 0, 1, architecture.socketSyscall],
    [0x06, 0, 0, 0x00050001],
    [0x15, 0, 1, architecture.socketpairSyscall],
    [0x06, 0, 0, 0x00050001],
    // A new io_uring can create and connect sockets without the socket(2)
    // syscall. No ring descriptor is inherited by this narrow launch route.
    [0x15, 0, 1, architecture.ioUringSetupSyscall],
    [0x06, 0, 0, 0x00050001],
    [0x06, 0, 0, 0x7fff0000],
  );
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jumpTrue, jumpFalse, value], index) => {
    const offset = index * 8;
    buffer.writeUInt16LE(code, offset);
    buffer.writeUInt8(jumpTrue, offset + 2);
    buffer.writeUInt8(jumpFalse, offset + 3);
    buffer.writeUInt32LE(value >>> 0, offset + 4);
  });
  return {
    arch,
    buffer,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function pinLinuxNetworkSeccompFilter(runtime) {
  const filter = buildLinuxNetworkSeccompFilter(runtime.arch);
  let fd;
  try {
    for (const method of [
      "openSync",
      "writeSync",
      "readSync",
      "fchmodSync",
      "fsyncSync",
      "fstatSync",
    ]) {
      if (typeof runtime.fs[method] !== "function") {
        throw new Error(`seccomp_filter_${method}_unavailable`);
      }
    }
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDWR) |
      Number(constants.O_EXCL) |
      Number(constants.O_TMPFILE ?? LINUX_O_TMPFILE) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    // An anonymous inode avoids a same-UID process opening the filter by path.
    // Mode 0400 applies from creation; this process can still write through
    // the already-open O_RDWR descriptor, but no new writable open is allowed.
    fd = runtime.fs.openSync("/tmp", flags, 0o400);
    runtime.fs.fchmodSync(fd, 0o400);
    let offset = 0;
    while (offset < filter.buffer.length) {
      const written = runtime.fs.writeSync(
        fd,
        filter.buffer,
        offset,
        filter.buffer.length - offset,
        offset,
      );
      if (written <= 0) throw new Error("seccomp_filter_write_failed");
      offset += written;
    }
    runtime.fs.fsyncSync(fd);
    const before = runtime.fs.fstatSync(fd);
    if (!before.isFile() || Number(before.size) !== filter.buffer.length) {
      throw new Error("seccomp_filter_identity_changed");
    }
    const observed = Buffer.allocUnsafe(filter.buffer.length);
    offset = 0;
    while (offset < observed.length) {
      const read = runtime.fs.readSync(
        fd,
        observed,
        offset,
        observed.length - offset,
        offset,
      );
      if (read <= 0) throw new Error("seccomp_filter_read_failed");
      offset += read;
    }
    const after = runtime.fs.fstatSync(fd);
    const observedSha256 = crypto
      .createHash("sha256")
      .update(observed)
      .digest("hex");
    if (!linuxStatMatches(before, after) || observedSha256 !== filter.sha256) {
      throw new Error("seccomp_filter_identity_changed");
    }
    return {
      fd,
      childFd: null,
      arch: filter.arch,
      sha256: filter.sha256,
      policy: "deny-network-creation",
    };
  } catch (error) {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // best effort
      }
    }
    throw error;
  }
}

function attestLinuxRootOwnedFile(
  runtime,
  filePath,
  { executable = false } = {},
) {
  try {
    if (!runtime.fs.existsSync(filePath)) return null;
    const source = linuxRealpath(runtime, filePath);
    const before = runtime.fs.lstatSync(source);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      Number(before.uid) !== 0 ||
      (Number(before.mode) & 0o022) !== 0 ||
      (executable && (Number(before.mode) & 0o111) === 0)
    ) {
      return null;
    }
    const after = runtime.fs.statSync(source);
    if (
      String(before.dev) !== String(after.dev) ||
      String(before.ino) !== String(after.ino) ||
      Number(before.size) !== Number(after.size) ||
      Number(before.mtimeMs) !== Number(after.mtimeMs)
    ) {
      return null;
    }
    return source;
  } catch {
    return null;
  }
}

function attestLinuxBubblewrapBinary(runtime) {
  return (
    attestLinuxRootOwnedFile(runtime, LINUX_BWRAP_PATH, {
      executable: true,
    }) === LINUX_BWRAP_PATH
  );
}

function attestLinuxBubblewrapCapabilities(runtime) {
  let result;
  try {
    result = runtime.spawnSync(LINUX_BWRAP_PATH, ["--help"], {
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
  } catch {
    return { ok: false, reason: "capability_probe_spawn_failed" };
  }
  if (result?.error || result?.status !== 0) {
    return { ok: false, reason: "capability_probe_failed" };
  }
  const help = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
  for (const option of [
    "--ro-bind-fd",
    "--disable-userns",
    "--assert-userns-disabled",
    "--seccomp",
  ]) {
    if (!help.includes(option)) {
      return {
        ok: false,
        reason: `required_option_missing:${option.slice(2)}`,
      };
    }
  }
  return { ok: true, reason: null };
}

function parseLinuxLddPaths(output) {
  const paths = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    if (line.includes("=> not found")) {
      throw new Error("runtime_dependency_missing");
    }
    const resolved = line.match(/=>\s+(\/[^\s(]+)\s+\(/)?.[1];
    const loader = line.match(/^\s*(\/[^\s(]+)\s+\(/)?.[1];
    if (resolved) paths.add(resolved);
    if (loader) paths.add(loader);
  }
  return [...paths];
}

function collectLinuxNodeRuntimeMounts(runtime, runtimeIdentity) {
  if (
    attestLinuxRootOwnedFile(runtime, LINUX_LDD_PATH, {
      executable: true,
    }) !== LINUX_LDD_PATH
  ) {
    throw new Error("ldd_unavailable");
  }
  const runtimeExpected = {
    dev: runtimeIdentity.fileId.dev,
    ino: runtimeIdentity.fileId.ino,
    size: runtimeIdentity.bytes,
    mtimeMs: runtimeIdentity.mtimeMs,
  };
  const inspectionPin = pinLinuxRegularFile(
    runtime,
    runtimeIdentity.realPath,
    "/opt/chainless/runtime/node",
    runtimeExpected,
  );
  let result;
  try {
    result = runtime.spawnSync(LINUX_LDD_PATH, ["/proc/self/fd/3"], {
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe", inspectionPin.fd],
      timeout: 10_000,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
  } finally {
    closeLinuxPinnedMounts(runtime, [inspectionPin]);
  }
  if (result?.error || result?.status !== 0) {
    throw new Error("runtime_dependency_probe_failed");
  }
  const mounts = [
    {
      source: runtimeIdentity.realPath,
      destination: "/opt/chainless/runtime/node",
    },
  ];
  for (const destination of parseLinuxLddPaths(result.stdout)) {
    if (
      path.posix.normalize(destination) !== destination ||
      !["/lib/", "/lib64/", "/usr/lib/"].some((prefix) =>
        destination.startsWith(prefix),
      )
    ) {
      throw new Error("runtime_dependency_outside_system_library_roots");
    }
    const source = attestLinuxRootOwnedFile(runtime, destination);
    if (!source) {
      throw new Error("runtime_dependency_unattested");
    }
    mounts.push({ source, destination });
  }
  if (runtime.fs.existsSync("/etc/ld.so.cache")) {
    const source = attestLinuxRootOwnedFile(runtime, "/etc/ld.so.cache");
    if (!source) {
      throw new Error("loader_cache_unattested");
    }
    mounts.push({ source, destination: "/etc/ld.so.cache" });
  }
  const byDestination = new Map();
  for (const mount of mounts) {
    const existing = byDestination.get(mount.destination);
    if (existing && existing.source !== mount.source) {
      throw new Error("runtime_mount_collision");
    }
    byDestination.set(mount.destination, mount);
  }
  return [...byDestination.values()].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
}

function pinLinuxRuntimeMounts(runtime, runtimeMounts, runtimeIdentity) {
  const mounts = [];
  try {
    for (const mount of runtimeMounts) {
      const expected =
        mount.source === runtimeIdentity.realPath
          ? {
              dev: runtimeIdentity.fileId.dev,
              ino: runtimeIdentity.fileId.ino,
              size: runtimeIdentity.bytes,
              mtimeMs: runtimeIdentity.mtimeMs,
            }
          : runtime.fs.statSync(mount.source);
      mounts.push(
        pinLinuxRegularFile(runtime, mount.source, mount.destination, expected),
      );
    }
    return mounts;
  } catch (error) {
    closeLinuxPinnedMounts(runtime, mounts);
    throw error;
  }
}

function linuxSandboxEnvironment() {
  return {
    HOME: "/home/sandbox",
    TMPDIR: "/tmp",
    PATH: "/opt/chainless/runtime",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    OPENSSL_CONF: "/dev/null",
    CHAINLESS_SANDBOXED: "1",
  };
}

function buildLinuxBubblewrapPolicyArgs(
  pluginDirectories,
  pinnedMounts,
  environment,
  seccompFilter,
) {
  const directories = new Set([
    "/opt",
    "/opt/chainless",
    "/opt/chainless/runtime",
    "/opt/chainless/plugin",
    "/home",
    "/home/sandbox",
    "/tmp",
    "/run",
    "/var",
    "/var/tmp",
    "/proc",
    "/dev",
    ...(pluginDirectories || []),
  ]);
  for (const mount of pinnedMounts) {
    let parent = path.posix.dirname(mount.destination);
    while (parent !== "/") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const orderedDirectories = [...directories].sort((left, right) => {
    const depth =
      left.split("/").filter(Boolean).length -
      right.split("/").filter(Boolean).length;
    return depth || left.localeCompare(right);
  });
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--disable-userns",
    "--assert-userns-disabled",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-net",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--cap-drop",
    "ALL",
    "--hostname",
    "chainless-sandbox",
    "--clearenv",
  ];
  for (const directory of orderedDirectories) {
    args.push("--dir", directory);
  }
  for (const mount of pinnedMounts) {
    args.push("--ro-bind-fd", String(mount.childFd), mount.destination);
  }
  args.push(
    "--seccomp",
    String(seccompFilter.childFd),
    "--remount-ro",
    "/",
    "--perms",
    "1777",
    "--size",
    String(64 * 1024 * 1024),
    "--tmpfs",
    "/tmp",
    "--perms",
    "0755",
    "--size",
    String(16 * 1024 * 1024),
    "--tmpfs",
    "/run",
    "--perms",
    "1777",
    "--size",
    String(32 * 1024 * 1024),
    "--tmpfs",
    "/var/tmp",
    "--perms",
    "0700",
    "--size",
    String(16 * 1024 * 1024),
    "--tmpfs",
    "/home/sandbox",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  );
  for (const key of Object.keys(environment).sort()) {
    args.push("--setenv", key, environment[key]);
  }
  args.push("--chdir", "/opt/chainless/plugin");
  return args;
}

function probeLinuxBubblewrapPolicy(
  runtime,
  policyArgs,
  pinnedDescriptors,
  targetRuntime,
) {
  let result;
  try {
    result = runtime.spawnSync(
      LINUX_BWRAP_PATH,
      [
        ...policyArgs,
        "--",
        "/opt/chainless/runtime/node",
        "-e",
        `process.stdout.write(${JSON.stringify(
          LINUX_BWRAP_NODE_PROBE_SENTINEL,
        )})`,
      ],
      {
        cwd: "/",
        shell: false,
        encoding: "utf8",
        stdio: linuxStdioWithPinnedMounts(null, pinnedDescriptors, {
          probe: true,
        }),
        timeout: 15_000,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
        },
      },
    );
  } catch {
    return linuxBubblewrapProbe(
      true,
      false,
      "probe_spawn_failed",
      targetRuntime,
    );
  }
  if (result?.error || result?.status !== 0) {
    return linuxBubblewrapProbe(
      true,
      false,
      result?.error ? "probe_spawn_failed" : "probe_failed",
      targetRuntime,
    );
  }
  if (String(result.stdout) !== LINUX_BWRAP_NODE_PROBE_SENTINEL) {
    return linuxBubblewrapProbe(
      true,
      false,
      "node_runtime_probe_failed",
      targetRuntime,
    );
  }
  return linuxBubblewrapProbe(true, true, null, targetRuntime);
}

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
    backend: "linux-prlimit",
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
  const requiredBoundaries = Array.isArray(sandboxOpts.requiredBoundaries)
    ? sandboxOpts.requiredBoundaries
    : [];
  const requiresStrongLinuxBoundary = requiredBoundaries.some(
    (boundary) =>
      boundary === SANDBOX_BOUNDARIES.FILESYSTEM ||
      boundary === SANDBOX_BOUNDARIES.NETWORK,
  );

  if (requiresStrongLinuxBoundary) {
    const requestedEntryRuntime =
      sandboxOpts.executionContract?.kind ===
      "strict-plugin-native-static-elf-bin"
        ? "native-static-elf"
        : "node";
    const validation = validateLinuxPluginContract(
      command,
      args,
      spawnOpts,
      sandboxOpts.executionContract,
      runtime,
      sandboxOpts.sync,
    );
    if (!validation.ok) {
      const missing = validation.reason === "execution_contract_missing";
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          validation.reason,
          requestedEntryRuntime,
        ),
        reason: missing
          ? "linux_bwrap_execution_contract_missing"
          : "linux_bwrap_execution_contract_invalid",
        guarantees: [],
      });
    }
    if (!attestLinuxBubblewrapBinary(runtime)) {
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          "binary_missing_or_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_unavailable",
        guarantees: [],
      });
    }
    const capabilities = attestLinuxBubblewrapCapabilities(runtime);
    if (!capabilities.ok) {
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          capabilities.reason,
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_unavailable",
        guarantees: [],
      });
    }

    let runtimeMounts;
    let pinnedRuntimeMounts = [];
    try {
      runtimeMounts = collectLinuxNodeRuntimeMounts(
        runtime,
        validation.contract.runtimeIdentity,
      );
      pinnedRuntimeMounts = pinLinuxRuntimeMounts(
        runtime,
        runtimeMounts,
        validation.contract.runtimeIdentity,
      );
    } catch (error) {
      closeLinuxPinnedMounts(runtime, pinnedRuntimeMounts);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          error.message || "runtime_mounts_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_runtime_unattested",
        guarantees: [],
      });
    }

    let pinnedMounts = [];
    let pluginTree;
    let entryFormat = null;
    let entryMount;
    try {
      pluginTree = pinLinuxPluginTree(
        runtime,
        validation.contract.pluginRoot,
        validation.contract.rootIdentity,
      );
      pinnedMounts = assignLinuxMountChildFds([
        ...pinnedRuntimeMounts,
        ...pluginTree.mounts,
      ]);
      entryMount = pinnedMounts.find(
        (mount) => mount.source === validation.contract.entryIdentity.realPath,
      );
      if (
        !entryMount ||
        String(entryMount.fileId.dev) !==
          String(validation.contract.entryIdentity.fileId.dev) ||
        String(entryMount.fileId.ino) !==
          String(validation.contract.entryIdentity.fileId.ino) ||
        entryMount.bytes !== Number(validation.contract.entryIdentity.bytes) ||
        entryMount.mtimeMs !== Number(validation.contract.entryIdentity.mtimeMs)
      ) {
        throw new Error("plugin_entry_pin_mismatch");
      }
      if (validation.entryRuntime === "native-static-elf") {
        entryFormat = inspectLinuxStaticNativeElf(
          runtime,
          entryMount.fd,
          validation.contract.entryIdentity,
        );
        if (
          JSON.stringify(entryFormat) !== JSON.stringify(validation.entryFormat)
        ) {
          throw new Error("native_entry_format_changed_before_pin");
        }
      }
    } catch (error) {
      if (pinnedMounts.length > 0) {
        closeLinuxPinnedMounts(runtime, pinnedMounts);
      } else {
        closeLinuxPinnedMounts(runtime, pinnedRuntimeMounts);
        closeLinuxPinnedMounts(runtime, pluginTree?.mounts);
      }
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          error.message || "plugin_tree_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_plugin_tree_unattested",
        guarantees: [],
      });
    }

    let probeSeccompFilter;
    let seccompFilter;
    try {
      probeSeccompFilter = pinLinuxNetworkSeccompFilter(runtime);
      seccompFilter = pinLinuxNetworkSeccompFilter(runtime);
      const seccompChildFd = LINUX_BWRAP_FIRST_MOUNT_FD + pinnedMounts.length;
      probeSeccompFilter.childFd = seccompChildFd;
      seccompFilter.childFd = seccompChildFd;
      if (probeSeccompFilter.sha256 !== seccompFilter.sha256) {
        throw new Error("seccomp_filter_digest_mismatch");
      }
    } catch (error) {
      closeLinuxPinnedMounts(runtime, pinnedMounts);
      closeLinuxPinnedMounts(
        runtime,
        [probeSeccompFilter, seccompFilter].filter(Boolean),
      );
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          error.message || "seccomp_filter_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_seccomp_unattested",
        guarantees: [],
      });
    }
    const pinnedDescriptors = [...pinnedMounts, seccompFilter];
    const probeDescriptors = [...pinnedMounts, probeSeccompFilter];
    const environment = linuxSandboxEnvironment();
    const policyArgs = buildLinuxBubblewrapPolicyArgs(
      pluginTree.directories,
      pinnedMounts,
      environment,
      seccompFilter,
    );
    const entryRelative = path.posix.relative(
      validation.contract.pluginRoot,
      validation.contract.entryIdentity.realPath,
    );
    const sandboxEntry = path.posix.join(
      "/opt/chainless/plugin",
      entryRelative,
    );
    const targetArgs =
      validation.entryRuntime === "native-static-elf"
        ? [sandboxEntry, ...args]
        : ["/opt/chainless/runtime/node", sandboxEntry, ...args.slice(1)];
    const policyDigest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          backend: LINUX_BWRAP_BACKEND,
          contract: {
            kind: validation.contract.kind,
            pluginRoot: validation.contract.pluginRoot,
            root: validation.contract.rootIdentity,
            entry: validation.contract.entryIdentity,
            runtime: validation.contract.runtimeIdentity,
            entryRuntime: validation.entryRuntime,
            entryFormat,
          },
          mounts: pinnedMounts.map((mount) => ({
            destination: mount.destination,
            fileId: mount.fileId,
            bytes: mount.bytes,
            mtimeMs: mount.mtimeMs,
          })),
          seccomp: {
            arch: seccompFilter.arch,
            policy: seccompFilter.policy,
            sha256: seccompFilter.sha256,
          },
          policyArgs,
          target:
            validation.entryRuntime === "native-static-elf"
              ? targetArgs.slice(0, 1)
              : targetArgs.slice(0, 2),
        }),
      )
      .digest("hex");
    const runtimeProbe = Object.freeze(
      probeLinuxBubblewrapPolicy(
        runtime,
        policyArgs,
        probeDescriptors,
        validation.entryRuntime,
      ),
    );
    closeLinuxPinnedMounts(runtime, [probeSeccompFilter]);
    if (!runtimeProbe.runnable) {
      closeLinuxPinnedMounts(runtime, pinnedDescriptors);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe,
        reason: "linux_bwrap_policy_probe_failed",
        guarantees: [],
      });
    }
    const finalValidation = validateLinuxPluginContract(
      command,
      args,
      spawnOpts,
      validation.contract,
      runtime,
      sandboxOpts.sync,
    );
    if (!finalValidation.ok) {
      closeLinuxPinnedMounts(runtime, pinnedDescriptors);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${finalValidation.reason}`,
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
    if (validation.entryRuntime === "native-static-elf") {
      try {
        const finalEntryFormat = inspectLinuxStaticNativeElf(
          runtime,
          entryMount.fd,
          validation.contract.entryIdentity,
        );
        if (JSON.stringify(finalEntryFormat) !== JSON.stringify(entryFormat)) {
          throw new Error("native_entry_format_changed");
        }
        if (
          JSON.stringify(finalValidation.entryFormat) !==
          JSON.stringify(entryFormat)
        ) {
          throw new Error("native_entry_path_format_changed");
        }
      } catch (error) {
        closeLinuxPinnedMounts(runtime, pinnedDescriptors);
        return createSandboxPlan({
          ...base,
          backend: null,
          candidateBackend: LINUX_BWRAP_BACKEND,
          policyAttested: false,
          policyDigest,
          runtimeProbe: linuxBubblewrapProbe(
            true,
            false,
            `post_probe_${error.message || "native_entry_changed"}`,
            validation.entryRuntime,
          ),
          reason: "linux_bwrap_execution_contract_changed",
          guarantees: [],
        });
      }
    }
    const options = {
      ...spawnOpts,
      cwd: "/",
      shell: false,
      detached: false,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
      stdio: Object.freeze(
        linuxStdioWithPinnedMounts(spawnOpts?.stdio, pinnedDescriptors),
      ),
    };
    let pinsClosed = false;
    const cleanup = () => {
      if (pinsClosed) return;
      pinsClosed = true;
      closeLinuxPinnedMounts(runtime, pinnedDescriptors);
    };
    return createSandboxPlan({
      ...base,
      applied: true,
      enforcement: LINUX_BWRAP_BACKEND,
      backend: LINUX_BWRAP_BACKEND,
      candidateBackend: null,
      policyAttested: true,
      policyDigest,
      runtimeProbe,
      reason: null,
      guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
      command: LINUX_BWRAP_PATH,
      args: [...policyArgs, "--", ...targetArgs],
      options,
      cleanup,
    });
  }

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
    guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
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
 * @param {"default"|"strict"|"network-only"|{
 *   profile?: "default"|"strict"|"network-only",
 *   requiredBoundaries?: string[]
 * }} profileOrRequest
 * @param {Object} runtimeOverrides
 * @param {{
 *   profile?: string,
 *   requiredBoundaries?: string[],
 *   sync?: boolean,
 *   executionContract?: Readonly<Object>|null
 * }|null} explicitRequest
 * @returns {ReturnType<typeof createSandboxPlan>}
 */
export function applySandbox(
  command,
  args,
  spawnOpts,
  profileOrRequest = "default",
  runtimeOverrides = {},
  explicitRequest = null,
) {
  const runtime = resolveRuntime(runtimeOverrides);
  const sandboxRequest = normalizeSandboxRequest(
    profileOrRequest,
    explicitRequest,
  );
  const profileName = sandboxRequest.profile;
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
    requiredBoundaries: sandboxRequest.requiredBoundaries,
    sync: sandboxRequest.sync,
    executionContract: sandboxRequest.executionContract,
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
