/**
 * Platform-specific sandbox enforcement for ProcessExecutionBroker (P0-1)
 *
 * Platform enforcement currently available:
 * - macOS: Seatbelt sandbox-exec profiles
 * - Linux: prlimit resource-limit wrapper, plus a non-promoting bubblewrap
 *   runtime probe for explicitly requested filesystem/network boundaries
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
const LINUX_BWRAP_RUNTIME_PROBE_ARGS = Object.freeze([
  "--die-with-parent",
  "--new-session",
  "--unshare-all",
  "--ro-bind",
  "/",
  "/",
  "--proc",
  "/proc",
  "--dev",
  "/dev",
  "--tmpfs",
  "/tmp",
  "--",
  "/bin/true",
]);
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
  return { profile, requiredBoundaries, sync: request.sync === true };
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

/**
 * Prove only that the installed bubblewrap binary can create the namespace and
 * mount primitives needed by a future policy backend. This deliberately does
 * not attest any filesystem/network policy and therefore must never promote a
 * sandbox guarantee.
 */
function probeLinuxBubblewrapRuntime(runtime) {
  let binaryPresent = false;
  try {
    binaryPresent = runtime.fs.existsSync(LINUX_BWRAP_PATH);
  } catch {
    return {
      kind: "linux-bwrap-runtime-smoke-v1",
      attempted: false,
      runnable: false,
      reason: "binary_probe_failed",
    };
  }
  if (!binaryPresent) {
    return {
      kind: "linux-bwrap-runtime-smoke-v1",
      attempted: false,
      runnable: false,
      reason: "binary_missing",
    };
  }

  let result;
  try {
    result = runtime.spawnSync(
      LINUX_BWRAP_PATH,
      [...LINUX_BWRAP_RUNTIME_PROBE_ARGS],
      {
        shell: false,
        stdio: "ignore",
        timeout: 5_000,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
        },
      },
    );
  } catch {
    return {
      kind: "linux-bwrap-runtime-smoke-v1",
      attempted: true,
      runnable: false,
      reason: "probe_spawn_failed",
    };
  }

  if (result?.error || result?.status !== 0) {
    return {
      kind: "linux-bwrap-runtime-smoke-v1",
      attempted: true,
      runnable: false,
      reason: result?.error ? "probe_spawn_failed" : "probe_failed",
    };
  }
  return {
    kind: "linux-bwrap-runtime-smoke-v1",
    attempted: true,
    runnable: true,
    reason: null,
  };
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
    const runtimeProbe = probeLinuxBubblewrapRuntime(runtime);
    return createSandboxPlan({
      ...base,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      runtimeProbe,
      reason: runtimeProbe.runnable
        ? "linux_bwrap_policy_unattested"
        : "linux_bwrap_unavailable",
      guarantees: [],
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
 * @param {{profile?: string, requiredBoundaries?: string[], sync?: boolean}|null} explicitRequest
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
