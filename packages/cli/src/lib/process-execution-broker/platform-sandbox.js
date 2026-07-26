/**
 * Platform-specific sandbox enforcement for ProcessExecutionBroker (P0-1)
 *
 * Platform enforcement currently available:
 * - macOS: Seatbelt sandbox-exec profiles
 * - Linux: prlimit resource-limit wrapper, plus a narrow bubblewrap backend
 *   for an attested direct strict Plugin Node bin. Shells, native binaries,
 *   broader working directories, host-writable paths, inherited descriptors,
 *   and network egress remain fail-closed.
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
const WINDOWS_IDENTITY_WAIT = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_RESTRICTED_TOKEN_BACKEND = "windows-job-restricted-token";
const WINDOWS_APPCONTAINER_BACKEND =
  "windows-appcontainer-job-restricted-token";
const WINDOWS_ADAPTER_IDLE_TTL_MS = 60_000;
const LINUX_BWRAP_PATH = "/usr/bin/bwrap";
const LINUX_LDD_PATH = "/usr/bin/ldd";
const LINUX_BWRAP_BACKEND = "linux-bwrap";
const LINUX_BWRAP_NODE_PROBE_SENTINEL = "chainless-linux-bwrap-plugin-node-v1";
const LINUX_BWRAP_MAX_PLUGIN_ENTRIES = 512;
const LINUX_BWRAP_FIRST_MOUNT_FD = 3;
const LINUX_ATTESTED_FILE_MAX_BYTES = 256 * 1024 * 1024;
const LINUX_ATTESTATION_HASH_CHUNK_BYTES = 1024 * 1024;
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
  windowsDir: () => process.env.WINDIR || "C:\\Windows",
  moduleDir: MODULE_DIR,
  now: () => Date.now(),
  sleepSync: (milliseconds) =>
    Atomics.wait(WINDOWS_IDENTITY_WAIT, 0, 0, milliseconds),
  spawnSync: nativeSpawnSync,
  warn: (message) => process.emitWarning(message),
});

let windowsAdapterCache = null;
const windowsAdapterCacheEntries = new Set();
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

function inspectWindowsAdapterExecutable(runtime, executablePath) {
  if (typeof runtime.fs.lstatSync === "function") {
    const linkStat = runtime.fs.lstatSync(executablePath, { bigint: true });
    if (
      linkStat.isSymbolicLink?.() ||
      (typeof linkStat.isFile === "function" && !linkStat.isFile())
    ) {
      throw new Error("Windows native adapter is not a regular file");
    }
  }
  const before = runtime.fs.statSync(executablePath, { bigint: true });
  if (typeof before.isFile === "function" && !before.isFile()) {
    throw new Error("Windows native adapter is not a regular file");
  }
  const beforeIdentity = windowsFileIdentity(before);
  const executableDigest = sha256(runtime.fs.readFileSync(executablePath));
  const afterIdentity = windowsFileIdentity(
    runtime.fs.statSync(executablePath, { bigint: true }),
  );
  if (!sameWindowsFileIdentity(beforeIdentity, afterIdentity)) {
    throw new Error("Windows native adapter changed during attestation");
  }
  return { executableDigest, fileIdentity: afterIdentity };
}

function verifyWindowsAdapterEntry(entry, runtime, source) {
  if (
    entry.retired ||
    entry.cleaned ||
    entry.runtimeFs !== runtime.fs ||
    entry.tempDirectory !== source.tempDirectory ||
    entry.sourceDigest !== source.sourceDigest
  ) {
    return false;
  }
  try {
    const attestation = inspectWindowsAdapterExecutable(
      runtime,
      entry.executablePath,
    );
    return (
      attestation.executableDigest === entry.executableDigest &&
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
  const deleted = cleanupWindowsTemporaryPath(
    entry.runtime,
    entry.executablePath,
    attempts,
  );
  if (deleted) {
    entry.cleaned = true;
    windowsAdapterCacheEntries.delete(entry);
  }
  return deleted;
}

function retireWindowsAdapterEntry(entry) {
  if (!entry) return;
  entry.retired = true;
  if (windowsAdapterCache === entry) windowsAdapterCache = null;
  if (entry.refCount === 0) cleanupWindowsAdapterEntry(entry);
}

function cleanupAllWindowsAdapterEntries(attempts = 100) {
  windowsAdapterCache = null;
  for (const entry of [...windowsAdapterCacheEntries]) {
    entry.retired = true;
    entry.refCount = 0;
    cleanupWindowsAdapterEntry(entry, attempts);
  }
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
  windowsAdapterCache = null;
  let cleaned = true;
  for (const entry of [...windowsAdapterCacheEntries]) {
    entry.retired = true;
    entry.refCount = 0;
    if (!cleanupWindowsAdapterEntry(entry)) cleaned = false;
  }
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

function loadWindowsAdapterSource(runtime) {
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
  content = String(content);
  return {
    content,
    sourceDigest: sha256(content),
    tempDirectory: runtime.tmpdir(),
  };
}

/**
 * Materialize a cache miss for the shipped PowerShell/Win32 adapter into
 * fresh, unpredictable temporary paths. This is required for pkg builds where
 * source assets live in a virtual snapshot that an external powershell.exe
 * process cannot open directly. A persistent executable discovered on disk is
 * never trusted.
 */
function materializeWindowsAdapter(runtime, source) {
  const adapterBaseName = `chainless-win-sandbox-${runtime
    .randomBytes(24)
    .toString("hex")}`;
  const scriptPath = runtime.joinPath(
    source.tempDirectory,
    `${adapterBaseName}.ps1`,
  );
  const cacheExecutable = runtime.joinPath(
    source.tempDirectory,
    `${adapterBaseName}.exe`,
  );
  if (
    runtime.fs.existsSync(scriptPath) ||
    runtime.fs.existsSync(cacheExecutable)
  ) {
    return { reason: "windows_native_adapter_random_path_collision" };
  }
  try {
    runtime.fs.writeFileSync(scriptPath, source.content, {
      mode: 0o600,
      flag: "wx",
    });
  } catch {
    return { reason: "windows_native_adapter_materialize_failed" };
  }
  return {
    scriptPath,
    cacheExecutable,
    cleanupScript: () => cleanupWindowsTemporaryPath(runtime, scriptPath),
    cleanupExecutable: () =>
      cleanupWindowsTemporaryPath(runtime, cacheExecutable),
  };
}

function compileFreshWindowsAdapter(runtime, source, compileEnv) {
  const materialized = materializeWindowsAdapter(runtime, source);
  if (!materialized.cacheExecutable) return materialized;

  const powershell = runtime.joinPath(
    runtime.windowsDir(),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!runtime.fs.existsSync(powershell)) {
    materialized.cleanupScript();
    materialized.cleanupExecutable();
    return { reason: "windows_powershell_host_unavailable" };
  }

  let compileResult;
  try {
    compileResult = runtime.spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        materialized.scriptPath,
        "-CacheExecutable",
        materialized.cacheExecutable,
        "-CompileOnly",
      ],
      {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000,
        env: compileEnv,
      },
    );
  } catch (error) {
    compileResult = { error, status: null };
  }

  const scriptDeleted = materialized.cleanupScript();
  if (compileResult?.error || compileResult?.status !== 0 || !scriptDeleted) {
    const executableDeleted = materialized.cleanupExecutable();
    return {
      reason:
        !scriptDeleted || !executableDeleted
          ? "windows_native_adapter_compile_cleanup_unverified"
          : "windows_native_adapter_compile_failed",
    };
  }

  let attestation;
  try {
    attestation = inspectWindowsAdapterExecutable(
      runtime,
      materialized.cacheExecutable,
    );
  } catch {
    const executableDeleted = materialized.cleanupExecutable();
    return {
      reason: executableDeleted
        ? "windows_native_adapter_compile_attestation_failed"
        : "windows_native_adapter_compile_cleanup_unverified",
    };
  }

  const entry = {
    runtime,
    runtimeFs: runtime.fs,
    tempDirectory: source.tempDirectory,
    sourceDigest: source.sourceDigest,
    executablePath: materialized.cacheExecutable,
    executableDigest: attestation.executableDigest,
    fileIdentity: attestation.fileIdentity,
    refCount: 0,
    idleTimer: null,
    retired: false,
    cleaned: false,
  };
  windowsAdapterCacheEntries.add(entry);
  windowsAdapterCache = entry;
  registerWindowsAdapterExitCleanup();
  return { entry };
}

function acquireWindowsAdapterLease(runtime, source, compileEnv) {
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

  const compiled = compileFreshWindowsAdapter(runtime, source, compileEnv);
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

function createWindowsAdapterController(runtime, source, compileEnv) {
  const acquired = acquireWindowsAdapterLease(runtime, source, compileEnv);
  if (!acquired.entry) return acquired;
  let lease = acquired;
  let released = false;

  const ensureExecutable = () => {
    if (released) {
      const error = new Error("Windows native adapter lease was released");
      error.adapterReason = "windows_native_adapter_lease_released";
      throw error;
    }
    if (!verifyWindowsAdapterEntry(lease.entry, runtime, source)) {
      retireWindowsAdapterEntry(lease.entry);
      releaseWindowsAdapterLease(lease);
      const refreshed = acquireWindowsAdapterLease(runtime, source, compileEnv);
      if (!refreshed.entry) {
        const error = new Error(
          `Windows native adapter refresh failed: ${refreshed.reason}`,
        );
        error.adapterReason = refreshed.reason;
        throw error;
      }
      lease = refreshed;
    }
    return lease.entry.executablePath;
  };

  return {
    ensureExecutable,
    spawnSync: (args, options) =>
      runtime.spawnSync(ensureExecutable(), args, options),
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

function appContainerReadinessResult(result, profileName) {
  const runtimeProbe = {
    kind: "windows-appcontainer-launch-attestation-v1",
    attempted: true,
    runnable: false,
    reason: "probe_failed",
  };
  if (result?.error || result?.status !== 0) {
    return { runtimeProbe, readiness: null };
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
    readiness?.restrictedTokenAttested !== true
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
    },
    readiness,
  };
}

function deleteWindowsAppContainerProfile(
  adapter,
  profileName,
  expectedSid = null,
) {
  const helperArgs = ["--delete-appcontainer", profileName];
  if (expectedSid) helperArgs.push(expectedSid);
  try {
    const result = adapter.spawnSync(helperArgs, {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result?.error || result?.status !== 0) return false;
    const deletion = JSON.parse(String(result.stdout || "").trim());
    return (
      deletion?.deleted === true &&
      deletion?.absent === true &&
      deletion?.profileName === profileName
    );
  } catch {
    return false;
  }
}

/**
 * Wrap a target with the built-in Windows PowerShell host. The shipped script
 * P/Invokes Win32 to create a restricted primary token, starts the target
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
  const runtime = resolveRuntime(runtimeOverrides);
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
  const adapterSource = loadWindowsAdapterSource(runtime);
  if (!adapterSource.content) {
    return unavailablePlan(adapterSource.reason);
  }
  const adapter = createWindowsAdapterController(
    runtime,
    adapterSource,
    invocation.options.env || process.env,
  );
  if (!adapter.ensureExecutable) {
    return unavailablePlan(adapter.reason);
  }

  const profile = sandboxOpts.profileName || "default";
  const limits = sandboxOpts.limits || {};
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
    command: invocation.command,
    args: invocation.args,
    nodeIpcFd,
    detached: invocation.options.detached === true,
    windowsHide: invocation.options.windowsHide === true,
  };
  if (identityPath) launchSpec.identityPath = identityPath;
  const cleanupIdentity = () => {
    if (!identityPath) return;
    cleanupWindowsTemporaryPath(runtime, identityPath);
  };

  let appContainer = null;
  let appContainerRuntimeProbe = null;
  if (requiresAppContainer) {
    const appContainerProfileName = `ChainlessChain.CliSandbox.${runtime
      .randomBytes(12)
      .toString("hex")}`;
    let readinessResult;
    try {
      readinessResult = adapter.spawnSync(
        ["--prepare-appcontainer", appContainerProfileName],
        {
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: 30_000,
          env: invocation.options.env || process.env,
        },
      );
    } catch (error) {
      readinessResult = { error, status: null };
    }
    const readiness = appContainerReadinessResult(
      readinessResult,
      appContainerProfileName,
    );
    appContainerRuntimeProbe = readiness.runtimeProbe;
    if (!readiness.readiness) {
      const deleted = deleteWindowsAppContainerProfile(
        adapter,
        appContainerProfileName,
      );
      adapter.release();
      if (!deleted) {
        appContainerRuntimeProbe = {
          ...appContainerRuntimeProbe,
          reason: "cleanup_unverified",
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
  }

  let helperExecutable;
  try {
    // This is the final synchronous operation before the broker consumes the
    // plan and spawns the helper. Internal readiness/deletion invocations also
    // pass through the same digest + file-identity attestation.
    helperExecutable = adapter.ensureExecutable();
  } catch (error) {
    const deleted = appContainer
      ? deleteWindowsAppContainerProfile(
          adapter,
          appContainer.appContainerProfileName,
          appContainer.appContainerSid,
        )
      : true;
    adapter.release();
    cleanupIdentity();
    if (!deleted) {
      return unavailablePlan(
        "windows_appcontainer_readiness_cleanup_unverified",
        {
          runtimeProbe: appContainerRuntimeProbe
            ? { ...appContainerRuntimeProbe, reason: "cleanup_unverified" }
            : null,
        },
      );
    }
    return unavailablePlan(
      error?.adapterReason || "windows_native_adapter_attestation_failed",
      { runtimeProbe: appContainerRuntimeProbe },
    );
  }

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
      ...(appContainer
        ? {
            CC_WINDOWS_APPCONTAINER: "1",
            CC_WINDOWS_APPCONTAINER_PROFILE:
              appContainer.appContainerProfileName,
            CC_WINDOWS_APPCONTAINER_SID: appContainer.appContainerSid,
          }
        : {}),
    },
  };
  let appContainerCleanupAttempted = false;
  const cleanupAppContainer = () => {
    if (!appContainer || appContainerCleanupAttempted) return;
    appContainerCleanupAttempted = true;
    // Native.Run deletes the profile on every ordinary target exit. This
    // second, intentionally idempotent path covers a failed spawn or a helper
    // that was forcibly terminated before its finally block ran. The helper
    // re-derives and compares the expected SID, then proves absence by
    // creating and deleting a fresh verification profile with the same name.
    const deleted = deleteWindowsAppContainerProfile(
      adapter,
      appContainer.appContainerProfileName,
      appContainer.appContainerSid,
    );
    if (!deleted) {
      const message =
        `Windows sandbox could not verify deletion of AppContainer profile ` +
        appContainer.appContainerProfileName;
      if (sandboxOpts.sync === true) {
        throw new Error(message);
      }
      runtime.warn(message);
    }
  };
  const cleanup = () => {
    cleanupIdentity();
    try {
      cleanupAppContainer();
    } finally {
      adapter.release();
    }
  };
  const identityContract = identityPath
    ? {
        postSpawn: { required: true, mode: "sync" },
        postSpawnWindows: (proc) => {
          try {
            return waitForWindowsTargetIdentity(
              proc,
              identityPath,
              runtime,
              appContainer,
            );
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

  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: backend,
    policyAttested: requiresAppContainer ? true : null,
    runtimeProbe: appContainerRuntimeProbe,
    guarantees: requiresAppContainer
      ? appContainerGuarantees
      : [
          SANDBOX_BOUNDARIES.PROCESS_TREE,
          SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
          SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
        ],
    command: helperExecutable,
    args: helperArgs,
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

function linuxBubblewrapProbe(attempted, runnable, reason) {
  return {
    kind: "linux-bwrap-plugin-node-policy-v1",
    attempted,
    runnable,
    reason,
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

function validateLinuxPluginNodeContract(
  command,
  args,
  spawnOpts,
  contract,
  runtime,
  sync,
) {
  if (
    !contract ||
    contract.contractVersion !== 1 ||
    contract.kind !== "strict-plugin-node-bin"
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
  if (
    typeof command !== "string" ||
    !path.posix.isAbsolute(command) ||
    command !== contract.runtimePath ||
    command !== contract.runtimeIdentity?.realPath ||
    !Array.isArray(args) ||
    args.length < 1 ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    args[0] !== contract.entryIdentity?.realPath
  ) {
    return { ok: false, reason: "launch_identity_mismatch" };
  }
  if (
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
    !linuxIdentityMatches(runtime, contract.entryIdentity) ||
    !linuxIdentityMatches(runtime, contract.runtimeIdentity, {
      executable: true,
    })
  ) {
    return { ok: false, reason: "execution_identity_changed" };
  }
  if (
    !validateLinuxPluginTree(runtime, contract.pluginRoot) ||
    !linuxPluginMountTreeIsNarrow(runtime, contract.pluginRoot)
  ) {
    return { ok: false, reason: "plugin_tree_unattested" };
  }
  return { ok: true, contract };
}

function linuxStatMatches(left, right) {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    Number(left.size) === Number(right.size) &&
    Number(left.mtimeMs) === Number(right.mtimeMs)
  );
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

function probeLinuxBubblewrapPolicy(runtime, policyArgs, pinnedDescriptors) {
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
    return linuxBubblewrapProbe(true, false, "probe_spawn_failed");
  }
  if (result?.error || result?.status !== 0) {
    return linuxBubblewrapProbe(
      true,
      false,
      result?.error ? "probe_spawn_failed" : "probe_failed",
    );
  }
  if (String(result.stdout) !== LINUX_BWRAP_NODE_PROBE_SENTINEL) {
    return linuxBubblewrapProbe(true, false, "node_runtime_probe_failed");
  }
  return linuxBubblewrapProbe(true, true, null);
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
    const validation = validateLinuxPluginNodeContract(
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
        runtimeProbe: linuxBubblewrapProbe(false, false, validation.reason),
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
        runtimeProbe: linuxBubblewrapProbe(true, false, capabilities.reason),
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
        ),
        reason: "linux_bwrap_runtime_unattested",
        guarantees: [],
      });
    }

    let pinnedMounts = [];
    let pluginTree;
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
      const entryMount = pinnedMounts.find(
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
    const targetArgs = [
      "/opt/chainless/runtime/node",
      sandboxEntry,
      ...args.slice(1),
    ];
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
          target: targetArgs.slice(0, 2),
        }),
      )
      .digest("hex");
    const runtimeProbe = probeLinuxBubblewrapPolicy(
      runtime,
      policyArgs,
      probeDescriptors,
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
    const finalValidation = validateLinuxPluginNodeContract(
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
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
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
