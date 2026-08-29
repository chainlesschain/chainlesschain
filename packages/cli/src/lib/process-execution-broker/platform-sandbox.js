/**
 * Platform-specific sandbox enforcement for ProcessExecutionBroker (P0-1)
 *
 * Platform enforcement currently available:
 * - macOS: Seatbelt sandbox-exec profiles
 * - Linux: prlimit resource-limit wrapper, plus a narrow bubblewrap backend
 *   for an attested direct strict Plugin Node bin or a narrow static/dynamic
 *   ELF native bin. Dynamic acceptance recursively parses PT_INTERP and every
 *   startup DT_NEEDED edge against the exact descriptor-bound system graph.
 *   Dynamic native launches additionally use a read-only final mount namespace
 *   with no procfs, devfs, or writable scratch: every pathname-visible regular
 *   file is descriptor-pinned, hashed, and policy-bound. This closes the ELF
 *   loader/dlopen pathname surface, but deliberately does not claim to prevent
 *   anonymous JIT code or a custom in-process ELF loader.
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
import {
  applyLinuxGenericWorkspaceSandbox,
  isLinuxGenericWorkspaceContract,
} from "./linux-generic-bwrap-runtime.js";
import {
  buildLinuxBwrapDescriptorScrubbedLaunch,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
  linuxBwrapDescriptorScrubberPolicyBinding,
} from "./linux-bwrap-descriptor-launch.js";
import {
  MCP_STDIO_FD_ENTRY_BOOTSTRAP,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
} from "./mcp-fd-entry-bootstrap.js";
import {
  MACOS_MCP_LAUNCHER_INPUTS,
  macosMcpLauncherPolicyDigest,
  verifyMacosMcpLauncherInstallContract,
} from "./macos-mcp-launcher-contract.js";
import {
  isMcpStdioCapsuleNativeCodePolicy,
  mcpStdioCapsuleNativeCodeEvidence,
  mcpStdioCapsuleNativeCodePolicyDigest,
} from "../mcp-stdio-native-code-policy.js";
import {
  applyLinuxCgroupV2ToPlan,
  normalizeLinuxCgroupPolicy,
} from "./linux-cgroup-v2.js";

export {
  MCP_STDIO_FD_ENTRY_BOOTSTRAP,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
} from "./mcp-fd-entry-bootstrap.js";

/**
 * Stable boundary identifiers shared by broker policies, platform plans, and
 * audit records. A guarantee means that the named restriction is enforced by
 * the selected backend; it does not merely describe a configured intent.
 */
export const SANDBOX_BOUNDARIES = Object.freeze({
  CODE_SNAPSHOT: "code-snapshot",
  FILESYSTEM: "filesystem",
  NETWORK: "network",
  PROCESS_EXEC: "process-exec",
  PROCESS_TREE: "process-tree",
  RESOURCE_LIMITS: "resource-limits",
  PRIVILEGE_REDUCTION: "privilege-reduction",
  NATIVE_ADDON_LOADING: "native-addon-loading",
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
const MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND = "strict-mcp-node-capsule";
const WINDOWS_ADAPTER_IDLE_TTL_MS = 60_000;
const WINDOWS_ADAPTER_HELPER_NAME = "windows-sandbox-helper.exe";
const WINDOWS_ADAPTER_IDLE_TTL_ENV = "CC_WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_MS";
const WINDOWS_ADAPTER_TEMP_ROOT_ENV = "CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT";
const WINDOWS_ADAPTER_TEMP_ROOT_UNTRUSTED_REASON =
  "windows_adapter_temp_root_untrusted";
const WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON =
  "windows_adapter_temp_root_changed";
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
const LINUX_BWRAP_CHILD_RUNTIME_PROBE_SENTINEL =
  "chainless-linux-bwrap-child-runtime-v1";
const LINUX_BWRAP_NATIVE_RUNTIME_CLOSURE_PROBE_SENTINEL =
  "chainless-linux-bwrap-native-runtime-pathname-closure-v1";
const LINUX_BWRAP_CHILD_RUNTIME_PROBE_FAILURE_STATUS = 86;
const LINUX_BWRAP_MAX_PLUGIN_ENTRIES = 512;
const LINUX_PLUGIN_TREE_SNAPSHOT_MAX_FILES = 256;
const LINUX_PLUGIN_TREE_SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;
const LINUX_BWRAP_SUPERVISOR_CHILD_FD = 3;
const LINUX_BWRAP_FIRST_MOUNT_FD = 4;
const LINUX_BWRAP_SUPERVISOR_HIDDEN_PATH = "/run/.chainless-bwrap-supervisor";
const LINUX_BWRAP_SUPERVISOR_BINDING_MECHANISM =
  "pinned-child-fd3-file-consume-run-overmount-v1";
const LINUX_ATTESTED_FILE_MAX_BYTES = 256 * 1024 * 1024;
const LINUX_ATTESTATION_HASH_CHUNK_BYTES = 1024 * 1024;
const LINUX_ENTRY_SNAPSHOT_MECHANISM =
  "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1";
const LINUX_ENTRY_SNAPSHOT_SOURCE_MODE = 0o400;
const LINUX_EXECUTABLE_SNAPSHOT_SOURCE_MODE = 0o500;
const LINUX_MCP_CAPSULE_BACKEND = "linux-fd-code-snapshot";
const LINUX_MCP_RUNTIME_SNAPSHOT_SCOPE = "mcp-node-runtime-executable";
const LINUX_PLUGIN_RUNTIME_SNAPSHOT_SCOPE =
  "plugin-probe-node-runtime-executable";
const LINUX_MCP_CAPSULE_SNAPSHOT_MECHANISM =
  "verified-o_tmpfile-copy-inherited-fd-module-compile-v1";
const MACOS_MCP_CAPSULE_CANDIDATE_BACKEND = "macos-fd-code-snapshot";
const MACOS_MCP_CAPSULE_BACKEND = MACOS_MCP_LAUNCHER_INPUTS.protocol.backend;
const LINUX_NODE_ENTRY_SNAPSHOT_SCOPE = "plugin-entry-source";
const LINUX_NATIVE_ENTRY_SNAPSHOT_SCOPE = "plugin-entry-executable";
const LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE = "all-pinned-plugin-regular-files";
const LINUX_PLUGIN_TREE_SNAPSHOT_CONSISTENCY = "per-file-pin-to-launch";
const LINUX_NODE_ENTRY_SNAPSHOT_TARGET_MODE = "0400";
const LINUX_NATIVE_ENTRY_SNAPSHOT_TARGET_MODE = "0500";
const LINUX_ELF64_HEADER_BYTES = 64;
const LINUX_ELF64_PROGRAM_HEADER_BYTES = 56;
const LINUX_ELF64_DYNAMIC_ENTRY_BYTES = 16;
const LINUX_ELF_MAX_PROGRAM_HEADERS = 128;
const LINUX_ELF_MAX_DYNAMIC_ENTRIES = 4096;
const LINUX_ELF_MAX_NEEDED_ENTRIES = 128;
const LINUX_ELF_MAX_INITIAL_CLOSURE_FILES = 256;
const LINUX_ELF_MAX_INITIAL_CLOSURE_EDGES = 1024;
const LINUX_ELF_MAX_INITIAL_CLOSURE_BYTES = 512 * 1024 * 1024;
const LINUX_ELF_MAX_INTERPRETER_BYTES = 4096;
const LINUX_ELF_MAX_STRING_TABLE_BYTES = 1024 * 1024;
const LINUX_AUXV_ENTRY_BYTES = 16;
const LINUX_AUXV_MAX_BYTES = 64 * 1024;
const LINUX_AUXV_PAGE_SIZE = 6n;
const LINUX_MIN_RUNTIME_PAGE_BYTES = 4096;
const LINUX_MAX_RUNTIME_PAGE_BYTES = 1024 * 1024;
const LINUX_ELF_MAX_UINT64 = (1n << 64n) - 1n;
const LINUX_ELF_TYPE_EXEC = 2;
const LINUX_ELF_TYPE_DYN = 3;
const LINUX_ELF_PROGRAM_LOAD = 1;
const LINUX_ELF_PROGRAM_DYNAMIC = 2;
const LINUX_ELF_PROGRAM_INTERP = 3;
const LINUX_ELF_PROGRAM_GNU_STACK = 0x6474e551;
const LINUX_ELF_DYNAMIC_NULL = 0n;
const LINUX_ELF_DYNAMIC_NEEDED = 1n;
const LINUX_ELF_DYNAMIC_STRTAB = 5n;
const LINUX_ELF_DYNAMIC_STRSZ = 10n;
const LINUX_ELF_DYNAMIC_SONAME = 14n;
const LINUX_ELF_DYNAMIC_RPATH = 15n;
const LINUX_ELF_DYNAMIC_TEXTREL = 22n;
const LINUX_ELF_DYNAMIC_FLAGS = 30n;
const LINUX_ELF_DYNAMIC_RUNPATH = 29n;
const LINUX_ELF_DYNAMIC_CONFIG = 0x6ffffefan;
const LINUX_ELF_DYNAMIC_DEPAUDIT = 0x6ffffefbn;
const LINUX_ELF_DYNAMIC_AUDIT = 0x6ffffefcn;
const LINUX_ELF_DYNAMIC_FLAGS_1 = 0x6ffffffbn;
const LINUX_ELF_DYNAMIC_AUXILIARY = 0x7ffffffdn;
const LINUX_ELF_DYNAMIC_FILTER = 0x7fffffffn;
const LINUX_ELF_DYNAMIC_FLAG_TEXTREL = 0x4n;
const LINUX_ELF_DYNAMIC_FLAG_PIE = 0x08000000n;
const LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_SCOPE =
  "initial-pt_interp-and-recursive-dt_needed-attested-system-graph";
const LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_MECHANISM =
  "recursive-parsed-elf-system-graph-to-attested-runtime-fds-v1";
const LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_SCOPE =
  "all-pathname-visible-regular-files-in-read-only-bwrap-namespace";
// In addition to the immutable mount set, the dynamic-only seccomp program
// blocks every descriptor-acquisition syscall that could import a loader input
// through SCM_RIGHTS, another process, or a filesystem handle. It also blocks
// mount/user namespace mutation: otherwise an untrusted target could create a
// nested user namespace, mount a writable tmpfs over /run, and dlopen a drop-in.
// This remains a pathname-loader claim: anonymous JIT/custom in-process loaders
// are excluded.
const LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MECHANISM =
  "descriptor-pinned-hashed-ro-mount-set-plus-loader-fd-and-namespace-mutation-seccomp-v2";
const LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_FILES = 512;
const LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_BYTES = 1024 * 1024 * 1024;
const LINUX_ELF_MACHINES = Object.freeze({
  x64: 62,
  arm64: 183,
  riscv64: 243,
});
// Linux asm-generic: __O_TMPFILE (0x400000) | O_DIRECTORY (0x010000).
// x64, arm64, and riscv64 use this value; unsupported seccomp architectures
// already fail closed before the anonymous filter is created.
const LINUX_O_TMPFILE = 0x410000;
const LINUX_CLONE_NEWNS = 0x00020000;
const LINUX_CLONE_NEWUSER = 0x10000000;
const LINUX_NAMESPACE_CLONE_FLAGS = LINUX_CLONE_NEWNS | LINUX_CLONE_NEWUSER;
const LINUX_SECCOMP_FILTERS = Object.freeze({
  x64: Object.freeze({
    auditArch: 0xc000003e,
    socketSyscall: 41,
    socketpairSyscall: 53,
    recvmsgSyscall: 47,
    recvmmsgSyscall: 299,
    openByHandleAtSyscall: 304,
    pidfdGetfdSyscall: 438,
    cloneSyscall: 56,
    clone3Syscall: 435,
    unshareSyscall: 272,
    setnsSyscall: 308,
    mountSyscall: 165,
    umount2Syscall: 166,
    pivotRootSyscall: 155,
    openTreeSyscall: 428,
    moveMountSyscall: 429,
    fsopenSyscall: 430,
    fsconfigSyscall: 431,
    fsmountSyscall: 432,
    fspickSyscall: 433,
    mountSetattrSyscall: 442,
    ioUringSetupSyscall: 425,
    x32SyscallBit: 0x40000000,
  }),
  arm64: Object.freeze({
    auditArch: 0xc00000b7,
    socketSyscall: 198,
    socketpairSyscall: 199,
    recvmsgSyscall: 212,
    recvmmsgSyscall: 243,
    openByHandleAtSyscall: 265,
    pidfdGetfdSyscall: 438,
    cloneSyscall: 220,
    clone3Syscall: 435,
    unshareSyscall: 97,
    setnsSyscall: 268,
    mountSyscall: 40,
    umount2Syscall: 39,
    pivotRootSyscall: 41,
    openTreeSyscall: 428,
    moveMountSyscall: 429,
    fsopenSyscall: 430,
    fsconfigSyscall: 431,
    fsmountSyscall: 432,
    fspickSyscall: 433,
    mountSetattrSyscall: 442,
    ioUringSetupSyscall: 425,
  }),
  riscv64: Object.freeze({
    auditArch: 0xc00000f3,
    socketSyscall: 198,
    socketpairSyscall: 199,
    recvmsgSyscall: 212,
    recvmmsgSyscall: 243,
    openByHandleAtSyscall: 265,
    pidfdGetfdSyscall: 438,
    cloneSyscall: 220,
    clone3Syscall: 435,
    unshareSyscall: 97,
    setnsSyscall: 268,
    mountSyscall: 40,
    umount2Syscall: 39,
    pivotRootSyscall: 41,
    openTreeSyscall: 428,
    moveMountSyscall: 429,
    fsopenSyscall: 430,
    fsconfigSyscall: 431,
    fsmountSyscall: 432,
    fspickSyscall: 433,
    mountSetattrSyscall: 442,
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
  pkg: process.pkg || null,
  env: process.env,
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
  getuid: () => process.getuid?.() ?? null,
  getgid: () => process.getgid?.() ?? null,
  warn: (message) => process.emitWarning(message),
});

let windowsAdapterCache = null;
const windowsAdapterCacheEntries = new Set();
const windowsTemporaryCleanupBacklog = new Set();
let windowsTemporaryCleanupRetryTimer = null;
const windowsAppContainerCleanupBacklog = new Set();
const issuedWindowsMcpCodeSnapshotPlans = new WeakMap();
const issuedMacMcpCodeSnapshotPlans = new WeakMap();
// Only the unified production adapter can register a Windows MCP launch
// capability. Direct callers of the exported platform-specific helper (and
// callers that inject a test/runtime facade into applySandbox) may exercise
// plan construction, but cannot mint a Broker-admissible capability.
const WINDOWS_MCP_CODE_SNAPSHOT_ISSUER = Symbol(
  "windows-mcp-code-snapshot-issuer",
);
const MACOS_MCP_CODE_SNAPSHOT_ISSUER = Symbol("macos-mcp-code-snapshot-issuer");
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

function windowsNativeRealpath(runtime, candidate) {
  const nativeRealpath = runtime.fs.realpathSync?.native;
  if (typeof nativeRealpath !== "function") {
    throw new Error("Native Windows realpath is unavailable");
  }
  const nativePath = nativeRealpath.call(runtime.fs, candidate);
  const withoutExtendedPrefix = String(nativePath).replace(
    /^\\\\\?\\(?=[A-Za-z]:\\)/,
    "",
  );
  return path.win32.resolve(withoutExtendedPrefix);
}

function windowsPathHasReparseSemantics(stat) {
  return (
    stat.isSymbolicLink?.() ||
    stat.isReparsePoint?.() ||
    stat.reparsePoint === true
  );
}

function windowsLocalPathAncestors(candidate) {
  const resolved = path.win32.resolve(candidate);
  const volumeRoot = path.win32.parse(resolved).root;
  if (!/^[A-Za-z]:\\$/.test(volumeRoot)) return null;
  const relative = path.win32.relative(volumeRoot, resolved);
  if (
    path.win32.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.win32.sep}`)
  ) {
    return null;
  }
  const ancestors = [volumeRoot];
  let current = volumeRoot;
  for (const segment of relative.split(path.win32.sep).filter(Boolean)) {
    current = path.win32.join(current, segment);
    ancestors.push(current);
  }
  return ancestors;
}

function windowsDirectoryIdentity(stat) {
  const birthtimeNs =
    stat.birthtimeNs !== undefined
      ? String(stat.birthtimeNs)
      : String(Math.trunc(Number(stat.birthtimeMs || 0) * 1_000_000));
  if (
    stat.dev === undefined ||
    stat.ino === undefined ||
    stat.mode === undefined
  ) {
    throw new Error("Windows directory identity is unavailable");
  }
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    birthtimeNs,
  });
}

function sameWindowsDirectoryIdentity(left, right) {
  return (
    left?.dev === right?.dev &&
    left?.ino === right?.ino &&
    left?.mode === right?.mode &&
    left?.birthtimeNs === right?.birthtimeNs
  );
}

function inspectWindowsAdapterTempRoot(runtime, candidate) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.includes("\0") ||
    !path.win32.isAbsolute(candidate)
  ) {
    return null;
  }
  const sourcePath = path.win32.resolve(candidate);
  const sourceAncestors = windowsLocalPathAncestors(sourcePath);
  if (!sourceAncestors) return null;

  try {
    // Keep the caller-visible path in the trust decision even when Windows
    // exposes it through a legitimate 8.3 alias (for example RUNNER~1 on a
    // hosted runner). Every raw ancestor must be a plain directory before the
    // native real path is accepted as the path used for mutations.
    let sourceRootStat = null;
    for (const ancestor of sourceAncestors) {
      const stat = runtime.fs.lstatSync(ancestor, { bigint: true });
      if (windowsPathHasReparseSemantics(stat) || !stat.isDirectory?.()) {
        return null;
      }
      sourceRootStat = stat;
    }

    const rootPath = windowsNativeRealpath(runtime, sourcePath);
    const rootAncestors = windowsLocalPathAncestors(rootPath);
    if (!rootAncestors) return null;
    let canonicalRootStat = null;
    for (const ancestor of rootAncestors) {
      const stat = runtime.fs.lstatSync(ancestor, { bigint: true });
      if (windowsPathHasReparseSemantics(stat) || !stat.isDirectory?.()) {
        return null;
      }
      canonicalRootStat = stat;
    }

    const sourceIdentity = windowsDirectoryIdentity(sourceRootStat);
    const identity = windowsDirectoryIdentity(canonicalRootStat);
    if (!sameWindowsDirectoryIdentity(sourceIdentity, identity)) return null;

    const sourceAfter = runtime.fs.lstatSync(sourcePath, { bigint: true });
    const rootAfter = runtime.fs.lstatSync(rootPath, { bigint: true });
    if (
      windowsPathHasReparseSemantics(sourceAfter) ||
      !sourceAfter.isDirectory?.() ||
      windowsPathHasReparseSemantics(rootAfter) ||
      !rootAfter.isDirectory?.() ||
      windowsCanonicalPathKey(windowsNativeRealpath(runtime, sourcePath)) !==
        windowsCanonicalPathKey(rootPath) ||
      windowsCanonicalPathKey(windowsNativeRealpath(runtime, rootPath)) !==
        windowsCanonicalPathKey(rootPath) ||
      !sameWindowsDirectoryIdentity(
        sourceIdentity,
        windowsDirectoryIdentity(sourceAfter),
      ) ||
      !sameWindowsDirectoryIdentity(
        identity,
        windowsDirectoryIdentity(rootAfter),
      )
    ) {
      return null;
    }
    return Object.freeze({
      sourcePath,
      sourceCanonicalPathKey: windowsCanonicalPathKey(sourcePath),
      rootPath,
      canonicalPathKey: windowsCanonicalPathKey(rootPath),
      volumeRoot: path.win32.parse(rootPath).root.toLowerCase(),
      identity,
      attestation: Object.freeze({
        kind: "windows-adapter-temp-root-path-reattestation-v1",
        localVolume: true,
        nativeRealpathMatched: true,
        sourceAliasCanonicalized:
          windowsCanonicalPathKey(sourcePath) !==
          windowsCanonicalPathKey(rootPath),
        ancestorReparsePointsRejected: true,
        rootIdentityBound: true,
        criticalOperationReattestation: true,
        descriptorRelativeOperations: false,
        handleAtomic: false,
        residualRace:
          "same-principal-path-swap-between-reattestation-and-filesystem-call",
        residualHandling: "fail-closed-on-detected-path-or-identity-change",
      }),
    });
  } catch {
    return null;
  }
}

function sameWindowsAdapterTempRootBinding(left, right) {
  return (
    left?.sourceCanonicalPathKey === right?.sourceCanonicalPathKey &&
    left?.canonicalPathKey === right?.canonicalPathKey &&
    left?.volumeRoot === right?.volumeRoot &&
    sameWindowsDirectoryIdentity(left?.identity, right?.identity)
  );
}

function verifyWindowsAdapterTempRootBinding(runtime, binding) {
  const current = inspectWindowsAdapterTempRoot(
    runtime,
    binding?.sourcePath || binding?.rootPath,
  );
  return Boolean(
    current && sameWindowsAdapterTempRootBinding(binding, current),
  );
}

function windowsAdapterTempRootChangedError() {
  const error = new Error(
    "Windows sandbox adapter temp root changed after attestation",
  );
  error.code = "ERR_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_CHANGED";
  error.adapterReason = WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON;
  return error;
}

function assertWindowsAdapterTempRoot(runtime) {
  const binding = runtime.windowsAdapterTempRootBinding;
  if (!binding || !verifyWindowsAdapterTempRootBinding(runtime, binding)) {
    throw windowsAdapterTempRootChangedError();
  }
  return binding;
}

function inspectWindowsAdapterBoundPath(
  runtime,
  targetPath,
  expectedKind,
  { allowMissing = false } = {},
) {
  const binding = assertWindowsAdapterTempRoot(runtime);
  if (
    typeof targetPath !== "string" ||
    targetPath.includes("\0") ||
    !path.win32.isAbsolute(targetPath)
  ) {
    throw windowsAdapterTempRootChangedError();
  }
  const resolved = path.win32.resolve(targetPath);
  const relative = path.win32.relative(binding.rootPath, resolved);
  if (
    !relative ||
    path.win32.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.win32.sep}`)
  ) {
    throw windowsAdapterTempRootChangedError();
  }

  const segments = relative.split(path.win32.sep).filter(Boolean);
  let current = binding.rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.win32.join(current, segments[index]);
    const isTarget = index === segments.length - 1;
    let stat;
    try {
      stat = runtime.fs.lstatSync(current, { bigint: true });
    } catch (error) {
      if (isTarget && allowMissing && error?.code === "ENOENT") {
        return Object.freeze({ exists: false, resolvedPath: resolved });
      }
      throw error;
    }
    if (
      windowsPathHasReparseSemantics(stat) ||
      windowsCanonicalPathKey(windowsNativeRealpath(runtime, current)) !==
        windowsCanonicalPathKey(current)
    ) {
      throw windowsAdapterTempRootChangedError();
    }
    if (!isTarget && !stat.isDirectory?.()) {
      throw windowsAdapterTempRootChangedError();
    }
    if (isTarget) {
      if (
        (expectedKind === "file" && !stat.isFile?.()) ||
        (expectedKind === "directory" && !stat.isDirectory?.())
      ) {
        throw windowsAdapterTempRootChangedError();
      }
      return Object.freeze({
        exists: true,
        resolvedPath: resolved,
        identity:
          expectedKind === "directory"
            ? windowsDirectoryIdentity(stat)
            : windowsFileIdentity(stat),
      });
    }
  }
  throw windowsAdapterTempRootChangedError();
}

function assertWindowsAdapterBoundPathIdentity(
  runtime,
  targetPath,
  expectedKind,
  expectedIdentity,
) {
  const inspected = inspectWindowsAdapterBoundPath(
    runtime,
    targetPath,
    expectedKind,
  );
  const matches =
    expectedKind === "directory"
      ? sameWindowsDirectoryIdentity(inspected.identity, expectedIdentity)
      : sameWindowsFileIdentity(inspected.identity, expectedIdentity);
  if (!matches) throw windowsAdapterTempRootChangedError();
  return inspected;
}

function resolveWindowsAdapterTempRoot(runtime, runtimeOverrides = {}) {
  const hasExplicitTmpdir = Object.prototype.hasOwnProperty.call(
    runtimeOverrides,
    "tmpdir",
  );
  const hasExplicitAdapterRoot = Object.prototype.hasOwnProperty.call(
    runtimeOverrides,
    "windowsAdapterTempRoot",
  );
  let candidate;
  try {
    if (hasExplicitTmpdir) {
      if (typeof runtime.tmpdir !== "function") return null;
      candidate = runtime.tmpdir();
    } else if (hasExplicitAdapterRoot) {
      candidate = runtimeOverrides.windowsAdapterTempRoot;
    } else {
      const environmentRoot =
        runtime.env?.[WINDOWS_ADAPTER_TEMP_ROOT_ENV] ??
        process.env[WINDOWS_ADAPTER_TEMP_ROOT_ENV];
      candidate =
        environmentRoot === undefined ? runtime.tmpdir() : environmentRoot;
    }
  } catch {
    return null;
  }

  return inspectWindowsAdapterTempRoot(runtime, candidate);
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
    pty: request.pty === true,
    linuxCgroup: normalizeLinuxCgroupPolicy(request.linuxCgroup),
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
function snapshotWrappedInvocationArgs(args) {
  if (args === null || args === undefined) return Object.freeze([]);
  try {
    if (
      !Array.isArray(args) ||
      Object.getPrototypeOf(args) !== Array.prototype
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(args);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
    ) {
      return null;
    }
    const snapshot = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor)) return null;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function normalizeWrappedInvocation(command, args, spawnOpts, platform) {
  const argsSnapshot = snapshotWrappedInvocationArgs(args);
  if (!argsSnapshot) {
    return {
      command,
      args: [],
      inputArgs: [],
      argumentsValid: false,
      options: { ...(spawnOpts || {}) },
    };
  }
  if (!spawnOpts?.shell) {
    return {
      command,
      args: [...argsSnapshot],
      inputArgs: argsSnapshot,
      argumentsValid: true,
      options: { ...(spawnOpts || {}) },
    };
  }

  if (platform === "win32") {
    const shell =
      typeof spawnOpts.shell === "string"
        ? spawnOpts.shell
        : process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    const shellCommand = [command, ...argsSnapshot].map(String).join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", shellCommand],
      inputArgs: argsSnapshot,
      argumentsValid: true,
      options: { ...spawnOpts, shell: false },
    };
  }

  const shell =
    typeof spawnOpts.shell === "string" ? spawnOpts.shell : "/bin/sh";
  const shellCommand = [command, ...argsSnapshot].map(String).join(" ");
  return {
    command: shell,
    args: ["-c", shellCommand],
    inputArgs: argsSnapshot,
    argumentsValid: true,
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
  const seatbeltLiteral = (value) =>
    String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

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
    const abs = seatbeltLiteral(runtime.resolvePath(p));
    lines.push(`(allow file-read* (subpath "${abs}"))`);
  }

  for (const p of allowWrite) {
    const abs = seatbeltLiteral(runtime.resolvePath(p));
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

function macMode(stat) {
  return Number(stat.mode) & 0o7777;
}

function macSameOpenIdentity(left, right) {
  return (
    linuxOpenStatMatches(left, right) &&
    String(left.uid) === String(right.uid) &&
    String(left.gid) === String(right.gid)
  );
}

function macFixedPathStat(runtime, candidate, options) {
  const resolved = linuxRealpath(runtime, candidate);
  const stat = runtime.fs.lstatSync(candidate);
  const kindMatches =
    options.kind === "directory" ? stat.isDirectory() : stat.isFile();
  if (
    resolved !== candidate ||
    stat.isSymbolicLink?.() ||
    !kindMatches ||
    Number(stat.uid) !== 0 ||
    Number(stat.gid) !== 0 ||
    (options.mode !== undefined && macMode(stat) !== options.mode) ||
    (options.mode === undefined && (macMode(stat) & 0o022) !== 0) ||
    (options.nlink !== undefined && Number(stat.nlink) !== options.nlink)
  ) {
    throw new Error(options.reason || "macos_fixed_path_untrusted");
  }
  return stat;
}

function macOpenPinnedFile(runtime, candidate, options = {}) {
  let fd;
  try {
    const namedBefore = macFixedPathStat(runtime, candidate, {
      kind: "file",
      mode: options.mode,
      nlink: options.nlink,
      reason: options.reason,
    });
    const constants = runtime.fs.constants || fs.constants;
    fd = runtime.fs.openSync(
      candidate,
      Number(constants.O_RDONLY) |
        Number(constants.O_NOFOLLOW || 0) |
        Number(constants.O_CLOEXEC || 0) |
        Number(constants.O_NONBLOCK || 0),
    );
    const before = runtime.fs.fstatSync(fd);
    const bytes = Number(before.size);
    if (
      !before.isFile() ||
      !macSameOpenIdentity(namedBefore, before) ||
      (options.executable === true && (Number(before.mode) & 0o111) === 0) ||
      !Number.isSafeInteger(bytes) ||
      bytes < (options.minimumBytes ?? 1) ||
      bytes > (options.maximumBytes ?? 16 * 1024 * 1024) ||
      (options.expectedBytes !== undefined && bytes !== options.expectedBytes)
    ) {
      throw new Error(options.reason || "macos_fixed_file_untrusted");
    }
    const digest = hashLinuxOpenFile(runtime, fd, bytes);
    const after = runtime.fs.fstatSync(fd);
    const namedAfter = runtime.fs.lstatSync(candidate);
    if (
      !macSameOpenIdentity(before, after) ||
      !macSameOpenIdentity(after, namedAfter) ||
      linuxRealpath(runtime, candidate) !== candidate ||
      (options.expectedSha256 !== undefined &&
        digest !== options.expectedSha256)
    ) {
      throw new Error(options.reason || "macos_fixed_file_changed");
    }
    return {
      fd,
      stat: after,
      sha256: digest,
      bytes,
      fileId: { dev: String(after.dev), ino: String(after.ino) },
      mtimeMs: Number(after.mtimeMs),
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

function macReadPinnedUtf8(runtime, pin, maximumBytes) {
  if (pin.bytes > maximumBytes) throw new Error("macos_contract_too_large");
  const buffer = Buffer.alloc(pin.bytes);
  let offset = 0;
  while (offset < buffer.length) {
    const read = runtime.fs.readSync(
      pin.fd,
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (read <= 0) throw new Error("macos_contract_ended_early");
    offset += read;
  }
  return buffer.toString("utf8");
}

function macSpawnAttestation(runtime, command, args) {
  const result = runtime.spawnSync(command, args, {
    cwd: "/",
    shell: false,
    encoding: "utf8",
    timeout: 15_000,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  if (result?.error || result?.signal || result?.status !== 0) {
    throw new Error("macos_helper_attestation_command_failed");
  }
  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function macExactObjectKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function verifyMacHelperProbe(probe, nonce, contract, runtime) {
  const keys = [
    "schema",
    "nonce",
    "protocolVersion",
    "protocolSha256",
    "sourceSha256",
    "gateBootstrapSha256",
    "selfSha256",
    "realUid",
    "effectiveUid",
    "realGid",
    "effectiveGid",
    "installedMode",
    "snapshotRootMode",
    "readyGate",
    "rootWatchdog",
    "staleCleanupBounded",
    "maximumStaleSnapshots",
    "globalLaunchLock",
    "callerLifelineFd",
    "callerLifelineWatched",
    "signalRelayNonblocking",
    "relayParentCredentialsDropped",
    "entryRootOwnedAnonymousSnapshot",
    "entrySourcePrePostStat",
    "entryWriterClosedBeforeReadonlyReopen",
    "entryReadonlyIdentityRechecked",
    "entryUnlinkedAndDirectoryFsyncedBeforeTarget",
    "targetInheritedEntrySnapshotOnly",
    "runtimeAndCapsuleSlotsNullBeforeExec",
    "bootstrapClosesNullAndReadyDescriptors",
    "processForkExplicitlyDenied",
  ];
  const callerUid = runtime.getuid();
  const callerGid = runtime.getgid();
  if (
    !macExactObjectKeys(probe, keys) ||
    !Number.isSafeInteger(callerUid) ||
    callerUid <= 0 ||
    !Number.isSafeInteger(callerGid) ||
    callerGid <= 0 ||
    probe.schema !== "chainlesschain.macos-mcp-launcher-probe.v1" ||
    probe.nonce !== nonce ||
    probe.protocolVersion !== 1 ||
    probe.protocolSha256 !== MACOS_MCP_LAUNCHER_INPUTS.protocolSha256 ||
    probe.sourceSha256 !== MACOS_MCP_LAUNCHER_INPUTS.sourceSha256 ||
    probe.gateBootstrapSha256 !==
      MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256 ||
    probe.selfSha256 !== contract.helperSha256 ||
    probe.realUid !== callerUid ||
    probe.effectiveUid !== 0 ||
    probe.realGid !== callerGid ||
    probe.effectiveGid !== callerGid ||
    probe.installedMode !== "4555" ||
    probe.snapshotRootMode !== "0711" ||
    probe.readyGate !== true ||
    probe.rootWatchdog !== true ||
    probe.staleCleanupBounded !== true ||
    probe.maximumStaleSnapshots !==
      MACOS_MCP_LAUNCHER_INPUTS.protocol.maximumStaleSnapshots ||
    probe.globalLaunchLock !== true ||
    probe.callerLifelineFd !==
      MACOS_MCP_LAUNCHER_INPUTS.protocol.callerLifelineFd ||
    probe.callerLifelineWatched !== true ||
    probe.signalRelayNonblocking !== true ||
    probe.relayParentCredentialsDropped !== true ||
    probe.entryRootOwnedAnonymousSnapshot !== true ||
    probe.entrySourcePrePostStat !== true ||
    probe.entryWriterClosedBeforeReadonlyReopen !== true ||
    probe.entryReadonlyIdentityRechecked !== true ||
    probe.entryUnlinkedAndDirectoryFsyncedBeforeTarget !== true ||
    probe.targetInheritedEntrySnapshotOnly !== true ||
    probe.runtimeAndCapsuleSlotsNullBeforeExec !== true ||
    probe.bootstrapClosesNullAndReadyDescriptors !== true ||
    probe.processForkExplicitlyDenied !== true
  ) {
    throw new Error("macos_helper_probe_contract_mismatch");
  }
  return probe;
}

function attestInstalledMacMcpLauncher(runtime) {
  const protocol = MACOS_MCP_LAUNCHER_INPUTS.protocol;
  let contractPin;
  let helperPin;
  try {
    for (const directory of [
      "/Library",
      "/Library/PrivilegedHelperTools",
      "/Library/Application Support",
      "/Library/Application Support/ChainlessChain",
      "/Library/Application Support/ChainlessChain/McpLauncher",
    ]) {
      macFixedPathStat(runtime, directory, {
        kind: "directory",
        mode: 0o755,
        reason: "macos_helper_install_directory_untrusted",
      });
    }
    macFixedPathStat(runtime, protocol.snapshotRoot, {
      kind: "directory",
      mode: 0o711,
      reason: "macos_helper_snapshot_root_untrusted",
    });
    macFixedPathStat(
      runtime,
      path.posix.join(protocol.snapshotRoot, protocol.snapshotLockName),
      {
        kind: "file",
        mode: 0o600,
        nlink: 1,
        reason: "macos_helper_snapshot_lock_untrusted",
      },
    );
    macFixedPathStat(runtime, protocol.sandboxExecutable, {
      kind: "file",
      reason: "macos_sandbox_exec_untrusted",
    });
    for (const tool of [
      "/usr/bin/codesign",
      "/usr/sbin/pkgutil",
      "/usr/sbin/spctl",
    ]) {
      macFixedPathStat(runtime, tool, {
        kind: "file",
        reason: "macos_signature_tool_untrusted",
      });
    }
    contractPin = macOpenPinnedFile(runtime, protocol.installContractPath, {
      mode: 0o444,
      nlink: 1,
      maximumBytes: 64 * 1024,
      reason: "macos_helper_install_contract_untrusted",
    });
    const contractText = macReadPinnedUtf8(runtime, contractPin, 64 * 1024);
    const contract = verifyMacosMcpLauncherInstallContract(
      JSON.parse(contractText),
    );
    const receiptResult = macSpawnAttestation(runtime, "/usr/sbin/pkgutil", [
      "--pkg-info",
      contract.packageIdentifier,
    ]);
    const receipt = Object.fromEntries(
      receiptResult.stdout
        .split(/\r?\n/u)
        .map((line) => line.match(/^([^:]+):\s*(.*)$/u))
        .filter(Boolean)
        .map((match) => [match[1], match[2]]),
    );
    if (
      receipt["package-id"] !== contract.packageIdentifier ||
      receipt.version !== contract.packageVersion ||
      receipt.volume !== "/"
    ) {
      throw new Error("macos_helper_package_receipt_mismatch");
    }
    helperPin = macOpenPinnedFile(runtime, protocol.helperInstallPath, {
      mode: 0o4555,
      nlink: 1,
      executable: true,
      expectedBytes: contract.helperBytes,
      expectedSha256: contract.helperSha256,
      reason: "macos_helper_binary_untrusted",
    });
    macSpawnAttestation(runtime, "/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--verbose=4",
      `-R=${contract.designatedRequirement}`,
      protocol.helperInstallPath,
    ]);
    const description = macSpawnAttestation(runtime, "/usr/bin/codesign", [
      "-dvvv",
      protocol.helperInstallPath,
    ]);
    const details = `${description.stdout}\n${description.stderr}`;
    const teamIdentifier = details.match(/^TeamIdentifier=(.+)$/mu)?.[1];
    const signingIdentifier = details.match(/^Identifier=(.+)$/mu)?.[1];
    if (
      teamIdentifier !== contract.teamIdentifier ||
      signingIdentifier !== contract.signingIdentifier ||
      !/^CodeDirectory .+ flags=.+\(runtime\)/mu.test(details)
    ) {
      throw new Error("macos_helper_signature_identity_mismatch");
    }
    const requirementOutput = macSpawnAttestation(
      runtime,
      "/usr/bin/codesign",
      ["-dr", "-", protocol.helperInstallPath],
    );
    const designatedRequirement =
      `${requirementOutput.stdout}\n${requirementOutput.stderr}`.match(
        /^designated => (.+)$/mu,
      )?.[1];
    if (designatedRequirement !== contract.designatedRequirement) {
      throw new Error("macos_helper_designated_requirement_mismatch");
    }
    const gatekeeper = macSpawnAttestation(runtime, "/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      protocol.helperInstallPath,
    ]);
    const gatekeeperEvidence = `${gatekeeper.stdout}\n${gatekeeper.stderr}`;
    if (
      !/\baccepted\b/iu.test(gatekeeperEvidence) ||
      !/source=Notarized Developer ID/iu.test(gatekeeperEvidence)
    ) {
      throw new Error("macos_helper_notarization_unattested");
    }
    const nonce = runtime.randomBytes(32).toString("hex");
    const probeResult = macSpawnAttestation(
      runtime,
      protocol.helperInstallPath,
      ["--probe-v1", nonce],
    );
    if (probeResult.stderr.trim() !== "") {
      throw new Error("macos_helper_probe_stderr");
    }
    const probe = verifyMacHelperProbe(
      JSON.parse(probeResult.stdout),
      nonce,
      contract,
      runtime,
    );
    if (
      hashLinuxOpenFile(runtime, helperPin.fd, helperPin.bytes) !==
        helperPin.sha256 ||
      !macSameOpenIdentity(
        helperPin.stat,
        runtime.fs.fstatSync(helperPin.fd),
      ) ||
      !macSameOpenIdentity(
        helperPin.stat,
        macFixedPathStat(runtime, protocol.helperInstallPath, {
          kind: "file",
          mode: 0o4555,
          nlink: 1,
          reason: "macos_helper_binary_changed",
        }),
      ) ||
      !macSameOpenIdentity(
        contractPin.stat,
        macFixedPathStat(runtime, protocol.installContractPath, {
          kind: "file",
          mode: 0o444,
          nlink: 1,
          reason: "macos_helper_install_contract_changed",
        }),
      )
    ) {
      throw new Error("macos_helper_installation_changed_during_attestation");
    }
    const installContractSha256 = crypto
      .createHash("sha256")
      .update(contractText)
      .digest("hex");
    return Object.freeze({
      contract,
      probe,
      helper: Object.freeze({
        path: protocol.helperInstallPath,
        sha256: helperPin.sha256,
        bytes: helperPin.bytes,
        fileId: Object.freeze({ ...helperPin.fileId }),
        mode: macMode(helperPin.stat),
        uid: Number(helperPin.stat.uid),
        gid: Number(helperPin.stat.gid),
        signingIdentifier,
        teamIdentifier,
        packageIdentifier: contract.packageIdentifier,
        packageVersion: contract.packageVersion,
        designatedRequirementSha256: crypto
          .createHash("sha256")
          .update(designatedRequirement)
          .digest("hex"),
      }),
      installContractSha256,
    });
  } finally {
    for (const pin of [helperPin, contractPin]) {
      if (pin?.fd !== undefined) {
        try {
          runtime.fs.closeSync(pin.fd);
        } catch {
          // best effort; launch admission still fails if later pinning fails
        }
      }
    }
  }
}

function macPinContractFile(runtime, identity, options = {}) {
  let fd;
  try {
    if (
      !identity ||
      typeof identity.realPath !== "string" ||
      !path.posix.isAbsolute(identity.realPath) ||
      !/^[a-f0-9]{64}$/u.test(identity.sha256 || "") ||
      !identity.fileId ||
      !Number.isSafeInteger(identity.bytes) ||
      identity.bytes < (options.minimumBytes ?? 0) ||
      identity.bytes > options.maximumBytes ||
      linuxRealpath(runtime, identity.realPath) !== identity.realPath
    ) {
      throw new Error("macos_contract_file_identity_invalid");
    }
    const namedBefore = runtime.fs.lstatSync(identity.realPath);
    const constants = runtime.fs.constants || fs.constants;
    if (namedBefore.isSymbolicLink?.() || !namedBefore.isFile()) {
      throw new Error("macos_contract_file_identity_invalid");
    }
    fd = runtime.fs.openSync(
      identity.realPath,
      Number(constants.O_RDONLY) |
        Number(constants.O_NOFOLLOW || 0) |
        Number(constants.O_CLOEXEC || 0) |
        Number(constants.O_NONBLOCK || 0),
    );
    const before = runtime.fs.fstatSync(fd);
    if (
      !before.isFile() ||
      !macSameOpenIdentity(namedBefore, before) ||
      String(before.dev) !== String(identity.fileId.dev) ||
      String(before.ino) !== String(identity.fileId.ino) ||
      Number(before.size) !== identity.bytes ||
      Number(before.mtimeMs) !== Number(identity.mtimeMs) ||
      (options.executable === true && (Number(before.mode) & 0o111) === 0)
    ) {
      throw new Error("macos_contract_file_identity_changed");
    }
    const sha256 = hashLinuxOpenFile(runtime, fd, identity.bytes);
    const after = runtime.fs.fstatSync(fd);
    const namedAfter = runtime.fs.lstatSync(identity.realPath);
    if (
      sha256 !== identity.sha256 ||
      !macSameOpenIdentity(before, after) ||
      !macSameOpenIdentity(after, namedAfter) ||
      linuxRealpath(runtime, identity.realPath) !== identity.realPath
    ) {
      throw new Error("macos_contract_file_identity_changed");
    }
    return {
      fd,
      sha256,
      bytes: identity.bytes,
      fileId: { dev: String(after.dev), ino: String(after.ino) },
      mtimeMs: Number(after.mtimeMs),
      mode: Number(after.mode),
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

function macPinCapsuleDirectory(runtime, contract, callerUid) {
  let fd;
  try {
    const root = contract.pluginRoot;
    const identity = contract.rootIdentity;
    if (
      typeof root !== "string" ||
      linuxRealpath(runtime, root) !== root ||
      !identity?.fileId ||
      identity.realPath !== root
    ) {
      throw new Error("macos_capsule_root_identity_invalid");
    }
    const namedBefore = runtime.fs.lstatSync(root);
    const constants = runtime.fs.constants || fs.constants;
    if (
      namedBefore.isSymbolicLink?.() ||
      !namedBefore.isDirectory() ||
      Number(namedBefore.uid) !== callerUid ||
      (Number(namedBefore.mode) & 0o022) !== 0
    ) {
      throw new Error("macos_capsule_root_identity_invalid");
    }
    fd = runtime.fs.openSync(
      root,
      Number(constants.O_RDONLY) |
        Number(constants.O_DIRECTORY || 0) |
        Number(constants.O_NOFOLLOW || 0) |
        Number(constants.O_CLOEXEC || 0) |
        Number(constants.O_NONBLOCK || 0),
    );
    const before = runtime.fs.fstatSync(fd);
    const namedAfter = runtime.fs.lstatSync(root);
    if (
      !before.isDirectory() ||
      !macSameOpenIdentity(namedBefore, before) ||
      !macSameOpenIdentity(before, namedAfter) ||
      String(before.dev) !== String(identity.fileId.dev) ||
      String(before.ino) !== String(identity.fileId.ino) ||
      linuxRealpath(runtime, root) !== root
    ) {
      throw new Error("macos_capsule_root_identity_changed");
    }
    return {
      fd,
      fileId: { dev: String(before.dev), ino: String(before.ino) },
      mode: Number(before.mode),
      uid: Number(before.uid),
      gid: Number(before.gid),
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

function macStandardStdio(stdio) {
  if (Array.isArray(stdio)) {
    return [stdio[0] ?? "pipe", stdio[1] ?? "pipe", stdio[2] ?? "pipe"];
  }
  const value = stdio ?? "pipe";
  return [value, value, value];
}

function macEnvironmentDigest(environment) {
  const normalized = Object.fromEntries(
    Object.entries(environment || {})
      .map(([key, value]) => [key, String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export const MACOS_PKG_EXECPATH_MAGIC = "PKG_INVOKE_NODEJS";

export function macMcpTargetEnvironment(
  environment,
  { packaged = false, inheritedEnvironment = process.env } = {},
) {
  if (!packaged) return environment;
  const base = environment ?? inheritedEnvironment;
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    throw new TypeError("packaged macOS MCP environment must be an object");
  }
  return {
    ...base,
    PKG_EXECPATH: MACOS_PKG_EXECPATH_MAGIC,
  };
}

function sameMacStdio(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === 9 &&
    right.length === 9 &&
    left.every((value, index) => value === right[index])
  );
}

export function consumeMacMcpCodeSnapshotPlanBinding(plan, expected = {}) {
  const issued = issuedMacMcpCodeSnapshotPlans.get(plan);
  if (!issued) return false;
  issuedMacMcpCodeSnapshotPlans.delete(plan);
  return (
    issued.executionContract === expected.executionContract &&
    issued.originalCommand === expected.command &&
    sameStringArray(issued.originalArgs, expected.args) &&
    issued.originalCwd === (expected.cwd ?? null) &&
    issued.originalShell === (expected.shell ?? null) &&
    issued.originalDetached === (expected.detached ?? null) &&
    issued.profile === expected.profile &&
    sameStringArray(issued.requiredBoundaries, expected.requiredBoundaries) &&
    issued.sync === (expected.sync === true) &&
    plan.backend === MACOS_MCP_CAPSULE_BACKEND &&
    plan.enforcement === MACOS_MCP_CAPSULE_BACKEND &&
    plan.policyAttested === true &&
    plan.policyDigest === issued.policyDigest &&
    plan.command === issued.helperCommand &&
    sameStringArray(plan.args, issued.helperArgs) &&
    plan.options?.cwd === "/" &&
    plan.options?.shell === false &&
    plan.options?.detached !== true &&
    macEnvironmentDigest(plan.options?.env) === issued.environmentDigest &&
    sameMacStdio(issued.stdio, plan.options?.stdio) &&
    plan.postSpawn?.required === false &&
    plan.postSpawn?.mode === "none" &&
    plan.runtimeProbe?.planBindingDigest === issued.planBindingDigest
  );
}

function validateMacMcpCapsuleContract(
  command,
  args,
  spawnOpts,
  contract,
  runtime,
  sync,
) {
  if (
    contract?.kind !== MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND ||
    contract.contractVersion !== 1 ||
    !isMcpStdioCapsuleNativeCodePolicy(contract.nativeCodePolicy) ||
    (sync !== true && sync !== false) ||
    spawnOpts?.shell !== false ||
    !linuxStdioIsNarrow(spawnOpts?.stdio) ||
    spawnOpts?.serialization !== undefined ||
    spawnOpts?.argv0 !== undefined ||
    spawnOpts?.detached === true ||
    spawnOpts?.uid !== undefined ||
    spawnOpts?.gid !== undefined ||
    !Array.isArray(args) ||
    args.length < 1 ||
    args.some((value) => typeof value !== "string" || value.includes("\0")) ||
    command !== contract.runtimePath ||
    command !== contract.runtimeIdentity?.realPath ||
    args[0] !== contract.entryIdentity?.realPath ||
    ![".js", ".cjs", ".mjs"].includes(
      path.posix.extname(contract.entryIdentity?.realPath || "").toLowerCase(),
    )
  ) {
    return { ok: false, reason: "launch_identity_mismatch" };
  }
  for (const value of [
    contract.pluginRoot,
    contract.workingDirectory,
    contract.rootIdentity?.realPath,
    contract.entryIdentity?.realPath,
    contract.runtimeIdentity?.realPath,
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
      linuxRealpath(runtime, spawnOpts.cwd) !== contract.pluginRoot ||
      contract.workingDirectory !== contract.pluginRoot ||
      contract.rootIdentity?.realPath !== contract.pluginRoot ||
      !linuxPathWithin(contract.pluginRoot, contract.entryIdentity.realPath)
    ) {
      return { ok: false, reason: "noncanonical_contract_path" };
    }
  } catch {
    return { ok: false, reason: "contract_path_unavailable" };
  }
  if (
    !linuxDirectoryIdentityMatches(runtime, contract.rootIdentity) ||
    !linuxIdentityMatches(runtime, contract.runtimeIdentity, {
      executable: true,
    }) ||
    !linuxIdentityMatches(runtime, contract.entryIdentity)
  ) {
    return { ok: false, reason: "execution_identity_changed" };
  }
  return { ok: true };
}

function applyMacMcpCapsuleCodeSnapshot(
  command,
  args,
  spawnOpts,
  sandboxOpts,
  runtime,
  base,
  planBindingAuthority = null,
) {
  const contract = sandboxOpts.executionContract;
  const validation = validateMacMcpCapsuleContract(
    command,
    args,
    spawnOpts,
    contract,
    runtime,
    sandboxOpts.sync,
  );
  const unavailable = (reason, runtimeProbe = null) =>
    createSandboxPlan({
      ...base,
      backend: null,
      candidateBackend: MACOS_MCP_CAPSULE_CANDIDATE_BACKEND,
      policyAttested: false,
      runtimeProbe: runtimeProbe
        ? {
            kind: "darwin-mcp-capsule-code-snapshot-v1",
            attempted: runtimeProbe.attempted !== false,
            probeRuntime: "node",
            targetRuntime: "node",
            ...runtimeProbe,
          }
        : null,
      reason,
      guarantees: [],
    });
  if (!validation.ok) {
    return unavailable("macos_mcp_capsule_execution_contract_invalid", {
      attempted: false,
      runnable: false,
      reason: validation.reason,
      contentSnapshot: false,
      handleAtomic: false,
      entrySnapshotAtomic: false,
      runtimeLaunchAtomic: false,
      sharedLibraryClosure: false,
    });
  }

  const nativeCodeEvidence = mcpStdioCapsuleNativeCodeEvidence(
    contract.nativeCodePolicy,
  );
  const protocol = MACOS_MCP_LAUNCHER_INPUTS.protocol;
  const legacyUnavailable = () =>
    unavailable("macos_atomic_runtime_exec_unavailable", {
      attempted: true,
      runnable: false,
      reason: "public_api_has_no_descriptor_bound_exec",
      contentSnapshot: false,
      handleAtomic: false,
      entrySnapshotAtomic: false,
      runtimeLaunchAtomic: false,
      runtimeLaunchMechanism: "darwin-public-api-pathname-exec-only-v1",
      sharedLibraryClosure: false,
    });
  if (
    typeof runtime.fs.existsSync !== "function" ||
    !runtime.fs.existsSync(protocol.helperInstallPath) ||
    !runtime.fs.existsSync(protocol.installContractPath)
  ) {
    // Darwin public APIs still provide no descriptor-bound exec. Production is
    // enabled only by the separately signed, root-installed release contract.
    return legacyUnavailable();
  }

  let runtimePin;
  let entryPin;
  let capsulePin;
  try {
    const callerUid = runtime.getuid();
    const callerGid = runtime.getgid();
    if (
      !Number.isSafeInteger(callerUid) ||
      callerUid <= 0 ||
      !Number.isSafeInteger(callerGid) ||
      callerGid <= 0
    ) {
      throw new Error("macos_helper_caller_credentials_invalid");
    }
    const installation = attestInstalledMacMcpLauncher(runtime);
    runtimePin = macPinContractFile(runtime, contract.runtimeIdentity, {
      executable: true,
      minimumBytes: 1,
      maximumBytes: protocol.maximumRuntimeBytes,
    });
    entryPin = macPinContractFile(runtime, contract.entryIdentity, {
      minimumBytes: 0,
      maximumBytes: protocol.maximumEntryBytes,
    });
    capsulePin = macPinCapsuleDirectory(runtime, contract, callerUid);
    const nonce = runtime.randomBytes(32).toString("hex");
    if (!/^[a-f0-9]{64}$/u.test(nonce)) {
      throw new Error("macos_helper_nonce_generation_failed");
    }
    const snapshotPath = path.posix.join(protocol.snapshotRoot, nonce, "node");
    const policyDigest = macosMcpLauncherPolicyDigest({
      snapshotPath,
      capsulePath: contract.pluginRoot,
    });
    const helperArgs = [
      "--launch-v1",
      nonce,
      MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
      runtimePin.sha256,
      String(runtimePin.bytes),
      entryPin.sha256,
      String(entryPin.bytes),
      String(callerUid),
      String(callerGid),
      policyDigest,
      ...args.slice(1),
    ];
    const stdio = [
      ...macStandardStdio(spawnOpts?.stdio),
      runtimePin.fd,
      entryPin.fd,
      capsulePin.fd,
      "ignore",
      "ignore",
      "pipe",
    ];
    const packagedRuntime = Boolean(runtime.pkg);
    const targetEnvironment = macMcpTargetEnvironment(spawnOpts?.env, {
      packaged: packagedRuntime,
      inheritedEnvironment: runtime.env,
    });
    const options = {
      ...(spawnOpts || {}),
      cwd: "/",
      shell: false,
      detached: false,
      stdio,
      ...(targetEnvironment === undefined ? {} : { env: targetEnvironment }),
    };
    const installAttestationDigest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          protocolSha256: MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
          sourceSha256: MACOS_MCP_LAUNCHER_INPUTS.sourceSha256,
          gateBootstrapSha256: MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
          helper: installation.helper,
          installContractSha256: installation.installContractSha256,
        }),
      )
      .digest("hex");
    const environmentDigest = macEnvironmentDigest(options.env);
    const planBindingDigest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          backend: MACOS_MCP_CAPSULE_BACKEND,
          helperArgs,
          policyDigest,
          installAttestationDigest,
          environmentDigest,
          runtimeFd: runtimePin.fd,
          entryFd: entryPin.fd,
          capsuleRootFd: capsulePin.fd,
          callerLifelineFd: protocol.callerLifelineFd,
          nativeCodePolicyDigest: nativeCodeEvidence.nativeCodePolicyDigest,
        }),
      )
      .digest("hex");
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      for (const pin of [runtimePin, entryPin, capsulePin]) {
        if (pin?.fd !== undefined) {
          try {
            runtime.fs.closeSync(pin.fd);
          } catch {
            // Closing an already-duplicated parent descriptor is best effort.
          }
        }
      }
    };
    const runtimeProbe = {
      kind: "darwin-mcp-capsule-code-snapshot-v2",
      attempted: true,
      runnable: true,
      reason: null,
      probeRuntime: "node",
      targetRuntime: "node",
      targetRuntimeInvocationMode: packagedRuntime
        ? "pkg-copied-executable-eval-v1"
        : "node-executable-eval-v1",
      pkgExecPathMagicBound: packagedRuntime,
      contentSnapshot: true,
      contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
      contentSnapshotMechanism:
        "signed-root-runtime-path-and-anonymous-entry-fd-snapshots-v1",
      handleAtomic: true,
      entrySnapshotAtomic: true,
      runtimeLaunchAtomic: true,
      runtimeLaunchMechanism:
        "signed-root-helper-fd-copy-protected-path-ready-gate-v1",
      runtimeLaunchPath: snapshotPath,
      entrySnapshotPath: "anonymous-root-owned-fd4",
      runtimeSnapshotSha256: runtimePin.sha256,
      runtimeSnapshotBytes: runtimePin.bytes,
      entrySnapshotSha256: entryPin.sha256,
      entrySnapshotBytes: entryPin.bytes,
      entrySnapshotBootstrapSha256:
        MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
      sharedLibraryClosure: false,
      ...nativeCodeEvidence,
      rootProtectedRuntimeSnapshot: true,
      entryRootOwnedAnonymousSnapshot: true,
      entrySourcePrePostStat: true,
      entryWriterClosedBeforeReadonlyReopen: true,
      entryReadonlyIdentityRechecked: true,
      entryUnlinkedAndDirectoryFsyncedBeforeTarget: true,
      targetInheritedEntrySnapshotOnly: true,
      runtimeAndCapsuleSlotsNullBeforeExec: true,
      bootstrapClosesNullAndReadyDescriptors: true,
      actualRuntimeReadyHandshake: true,
      runtimeSnapshotUnlinkedBeforeEntryRelease: true,
      callerCredentialDropIrreversible: true,
      relayParentCredentialsDropped: true,
      callerLifelineWatched: true,
      signalRelayNonblocking: true,
      targetDescriptorAllowlist:
        "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready",
      capsuleRootDescriptorBound: true,
      capsulePathObjectAtomic: false,
      sandboxProfileFixedAndDigestBound: true,
      processForkExplicitlyDenied: true,
      sandboxExecLiveGateContract: true,
      globalLaunchSerialization: true,
      maximumStaleSnapshots: protocol.maximumStaleSnapshots,
      helperSha256: installation.helper.sha256,
      helperSourceSha256: MACOS_MCP_LAUNCHER_INPUTS.sourceSha256,
      helperProtocolSha256: MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
      helperInstallContractSha256: installation.installContractSha256,
      helperDesignatedRequirementSha256:
        installation.helper.designatedRequirementSha256,
      helperTeamIdentifier: installation.helper.teamIdentifier,
      helperPackageIdentifier: installation.helper.packageIdentifier,
      helperPackageVersion: installation.helper.packageVersion,
      installAttestationDigest,
      planBindingMechanism: "macos-mcp-code-snapshot-plan-binding-v1",
      planBindingDigest,
    };
    const plan = createSandboxPlan({
      ...base,
      applied: true,
      enforcement: MACOS_MCP_CAPSULE_BACKEND,
      backend: MACOS_MCP_CAPSULE_BACKEND,
      candidateBackend: null,
      policyAttested: true,
      policyDigest,
      command: protocol.helperInstallPath,
      args: helperArgs,
      options,
      runtimeProbe,
      guarantees: [
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_EXEC,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
        SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
      ],
      cleanup,
    });
    if (planBindingAuthority === MACOS_MCP_CODE_SNAPSHOT_ISSUER) {
      issuedMacMcpCodeSnapshotPlans.set(
        plan,
        Object.freeze({
          executionContract: contract,
          originalCommand: command,
          originalArgs: Object.freeze([...args]),
          originalCwd: spawnOpts?.cwd ?? null,
          originalShell: spawnOpts?.shell ?? null,
          originalDetached: spawnOpts?.detached ?? null,
          profile: base.profile,
          requiredBoundaries: Object.freeze([
            ...(sandboxOpts.requiredBoundaries || []),
          ]),
          sync: sandboxOpts.sync === true,
          policyDigest,
          helperCommand: protocol.helperInstallPath,
          helperArgs: Object.freeze([...helperArgs]),
          environmentDigest,
          stdio: Object.freeze([...stdio]),
          planBindingDigest,
        }),
      );
    }
    return plan;
  } catch (error) {
    for (const pin of [runtimePin, entryPin, capsulePin]) {
      if (pin?.fd !== undefined) {
        try {
          runtime.fs.closeSync(pin.fd);
        } catch {
          // best effort
        }
      }
    }
    return unavailable("macos_atomic_runtime_exec_unavailable", {
      kind: "darwin-mcp-capsule-code-snapshot-v2",
      attempted: true,
      runnable: false,
      reason: error?.message || "signed_root_helper_unattested",
      contentSnapshot: false,
      handleAtomic: false,
      entrySnapshotAtomic: false,
      runtimeLaunchAtomic: false,
      runtimeLaunchMechanism: "signed-root-helper-unattested-v1",
      sharedLibraryClosure: false,
    });
  }
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
  planBindingAuthority = null,
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

  if (
    Array.isArray(sandboxOpts.requiredBoundaries) &&
    sandboxOpts.requiredBoundaries.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT)
  ) {
    return applyMacMcpCapsuleCodeSnapshot(
      command,
      args,
      spawnOpts,
      sandboxOpts,
      runtime,
      base,
      planBindingAuthority,
    );
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
  expectedIdentity = null,
) {
  if (!targetPath) return true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const inspected = inspectWindowsAdapterBoundPath(
        runtime,
        targetPath,
        "file",
        { allowMissing: true },
      );
      if (!inspected.exists) {
        assertWindowsAdapterTempRoot(runtime);
        return true;
      }
      if (
        !expectedIdentity ||
        !sameWindowsFileObjectIdentity(inspected.identity, expectedIdentity)
      ) {
        return false;
      }
      runtime.fs.unlinkSync(targetPath);
      assertWindowsAdapterTempRoot(runtime);
      return true;
    } catch (error) {
      if (error?.adapterReason === WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON) {
        return false;
      }
      if (error?.code === "ENOENT") {
        try {
          assertWindowsAdapterTempRoot(runtime);
          return true;
        } catch {
          return false;
        }
      }
    }
    if (attempt + 1 < attempts) runtime.sleepSync(delayMs);
  }
  return false;
}

function cleanupOrTrackWindowsTemporaryPath(
  runtime,
  targetPath,
  attempts = 100,
  entry = null,
  expectedIdentity = null,
) {
  if (
    cleanupWindowsTemporaryPath(
      runtime,
      targetPath,
      attempts,
      10,
      expectedIdentity,
    )
  ) {
    const residualEntries = new Set();
    for (const residual of [...windowsTemporaryCleanupBacklog]) {
      if (
        residual.kind === "file" &&
        residual.runtime === runtime &&
        residual.targetPath === targetPath
      ) {
        windowsTemporaryCleanupBacklog.delete(residual);
        if (residual.entry) residualEntries.add(residual.entry);
      }
    }
    for (const residualEntry of residualEntries) {
      finalizeWindowsTemporaryCleanupEntry(residualEntry);
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
  const existing = [...windowsTemporaryCleanupBacklog].find(
    (residual) =>
      residual.kind === "file" &&
      residual.runtime === runtime &&
      residual.targetPath === targetPath,
  );
  if (existing) {
    if (entry) existing.entry = entry;
    if (!existing.expectedIdentity && expectedIdentity) {
      existing.expectedIdentity = expectedIdentity;
    }
  } else {
    windowsTemporaryCleanupBacklog.add({
      kind: "file",
      runtime,
      targetPath,
      entry,
      expectedIdentity,
    });
  }
  registerWindowsAdapterExitCleanup();
  scheduleWindowsTemporaryCleanupRetry();
  return false;
}

function retryWindowsTemporaryCleanupBacklog(attempts = 100) {
  let cleaned = true;
  for (const residual of [...windowsTemporaryCleanupBacklog]) {
    const residualCleaned =
      residual.kind === "directory"
        ? cleanupWindowsTemporaryDirectory(
            residual.runtime,
            residual.targetPath,
            attempts,
            10,
            residual.expectedIdentity,
          )
        : cleanupWindowsTemporaryPath(
            residual.runtime,
            residual.targetPath,
            attempts,
            10,
            residual.expectedIdentity,
          );
    if (residualCleaned) {
      windowsTemporaryCleanupBacklog.delete(residual);
      if (residual.entry) finalizeWindowsTemporaryCleanupEntry(residual.entry);
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

function finalizeWindowsTemporaryCleanupEntry(entry) {
  if (
    [...windowsTemporaryCleanupBacklog].some(
      (residual) => residual.entry === entry,
    )
  ) {
    return;
  }
  entry.cleaned = true;
  windowsAdapterCacheEntries.delete(entry);
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
  expectedIdentity = null,
) {
  if (!targetPath) return true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const inspected = inspectWindowsAdapterBoundPath(
        runtime,
        targetPath,
        "directory",
        { allowMissing: true },
      );
      if (!inspected.exists) {
        assertWindowsAdapterTempRoot(runtime);
        return true;
      }
      if (
        !expectedIdentity ||
        !sameWindowsDirectoryIdentity(inspected.identity, expectedIdentity)
      ) {
        return false;
      }
      runtime.fs.rmdirSync(targetPath);
      assertWindowsAdapterTempRoot(runtime);
      return true;
    } catch (error) {
      if (error?.adapterReason === WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON) {
        return false;
      }
      if (error?.code === "ENOENT") {
        try {
          assertWindowsAdapterTempRoot(runtime);
          return true;
        } catch {
          return false;
        }
      }
    }
    if (attempt + 1 < attempts) runtime.sleepSync(delayMs);
  }
  return false;
}

function cleanupOrTrackWindowsTemporaryDirectory(
  runtime,
  targetPath,
  attempts = 100,
  entry = null,
  expectedIdentity = null,
) {
  if (
    cleanupWindowsTemporaryDirectory(
      runtime,
      targetPath,
      attempts,
      10,
      expectedIdentity,
    )
  ) {
    const residualEntries = new Set();
    for (const residual of [...windowsTemporaryCleanupBacklog]) {
      if (
        residual.kind === "directory" &&
        residual.runtime === runtime &&
        residual.targetPath === targetPath
      ) {
        windowsTemporaryCleanupBacklog.delete(residual);
        if (residual.entry) residualEntries.add(residual.entry);
      }
    }
    for (const residualEntry of residualEntries) {
      finalizeWindowsTemporaryCleanupEntry(residualEntry);
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
  const existing = [...windowsTemporaryCleanupBacklog].find(
    (residual) =>
      residual.kind === "directory" &&
      residual.runtime === runtime &&
      residual.targetPath === targetPath,
  );
  if (existing) {
    if (entry) existing.entry = entry;
    if (!existing.expectedIdentity && expectedIdentity) {
      existing.expectedIdentity = expectedIdentity;
    }
  } else {
    windowsTemporaryCleanupBacklog.add({
      kind: "directory",
      runtime,
      targetPath,
      entry,
      expectedIdentity,
    });
  }
  registerWindowsAdapterExitCleanup();
  scheduleWindowsTemporaryCleanupRetry();
  return false;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function captureWindowsStdio(stdio) {
  if (Array.isArray(stdio)) return Object.freeze([...stdio]);
  return stdio ?? null;
}

function sameWindowsStdio(left, right) {
  const normalizedRight = right ?? null;
  if (Array.isArray(left) || Array.isArray(normalizedRight)) {
    return (
      Array.isArray(left) &&
      Array.isArray(normalizedRight) &&
      left.length === normalizedRight.length &&
      left.every((entry, index) => Object.is(entry, normalizedRight[index]))
    );
  }
  return Object.is(left, normalizedRight);
}

function windowsStdioDigestContract(stdio) {
  const normalizeEntry = (entry) => {
    if (entry === null || entry === undefined) return ["null"];
    if (typeof entry === "string") return ["string", entry];
    if (Number.isInteger(entry)) return ["fd", entry];
    return [typeof entry];
  };
  return Array.isArray(stdio)
    ? ["array", ...stdio.map(normalizeEntry)]
    : ["scalar", ...normalizeEntry(stdio)];
}

function windowsEnvironmentDigest(env) {
  const entries = Object.entries(env || {})
    .map(([key, value]) => [key, String(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    });
  return sha256(JSON.stringify(entries));
}

function windowsMcpBindingIdentity(identity) {
  if (!identity) return null;
  return {
    contractVersion: identity.contractVersion ?? null,
    realPath: identity.realPath ?? null,
    sha256: identity.sha256 ?? null,
    bytes: identity.bytes ?? null,
    fileId: identity.fileId
      ? {
          dev: identity.fileId.dev ?? null,
          ino: identity.fileId.ino ?? null,
        }
      : null,
    mtimeMs: identity.mtimeMs ?? null,
    attestation: identity.attestation ?? null,
  };
}

function windowsMcpBindingContract(contract) {
  return {
    contractVersion: contract?.contractVersion ?? null,
    kind: contract?.kind ?? null,
    pluginRoot: contract?.pluginRoot ?? null,
    workingDirectory: contract?.workingDirectory ?? null,
    runtimePath: contract?.runtimePath ?? null,
    rootIdentity: contract?.rootIdentity
      ? {
          realPath: contract.rootIdentity.realPath ?? null,
          fileId: contract.rootIdentity.fileId
            ? {
                dev: contract.rootIdentity.fileId.dev ?? null,
                ino: contract.rootIdentity.fileId.ino ?? null,
              }
            : null,
          attestation: contract.rootIdentity.attestation ?? null,
        }
      : null,
    entryIdentity: windowsMcpBindingIdentity(contract?.entryIdentity),
    runtimeIdentity: windowsMcpBindingIdentity(contract?.runtimeIdentity),
  };
}

function createWindowsMcpCodeSnapshotPlanBinding({
  executionContract,
  command,
  args,
  spawnOpts,
  profile,
  requiredBoundaries,
  sync,
  backend,
  policyAttested,
  policyDigest,
  adapterSource,
  helperInvocation,
  helperOptions,
  postSpawn,
  postSpawnWindows,
}) {
  const helperEnvDigest = windowsEnvironmentDigest(helperOptions.env);
  const helperStdio = captureWindowsStdio(helperOptions.stdio);
  const originalArgs = Object.freeze([...(args || [])]);
  const helperArgs = Object.freeze([...(helperInvocation.args || [])]);
  const normalizedPostSpawn = Object.freeze({
    required: postSpawn?.required === true,
    mode: postSpawn?.mode || "none",
  });
  const digestPayload = {
    version: 1,
    kind: "windows-mcp-code-snapshot-plan-binding-v1",
    executionContract: windowsMcpBindingContract(executionContract),
    originalLaunch: {
      command,
      args: originalArgs,
      cwd: spawnOpts?.cwd ?? null,
      shell: spawnOpts?.shell ?? null,
      detached: spawnOpts?.detached ?? null,
      profile,
      requiredBoundaries: [...requiredBoundaries],
      sync,
    },
    policy: { backend, policyAttested, policyDigest },
    adapter: {
      loaderMode: adapterSource.loaderMode,
      sourceDigest: adapterSource.sourceDigest,
      sourceContractDigest: adapterSource.sourceContractDigest,
    },
    helperInvocation: {
      command: helperInvocation.command,
      args: helperArgs,
      cwd: helperOptions.cwd ?? null,
      shell: helperOptions.shell ?? null,
      detached: helperOptions.detached ?? null,
      envDigest: helperEnvDigest,
      stdio: windowsStdioDigestContract(helperStdio),
    },
    postSpawn: normalizedPostSpawn,
  };
  return Object.freeze({
    executionContract,
    originalCommand: command,
    originalArgs,
    originalCwd: spawnOpts?.cwd ?? null,
    originalShell: spawnOpts?.shell ?? null,
    originalDetached: spawnOpts?.detached ?? null,
    profile,
    requiredBoundaries: Object.freeze([...requiredBoundaries]),
    sync,
    backend,
    policyAttested,
    policyDigest,
    helperCommand: helperInvocation.command,
    helperArgs,
    helperCwd: helperOptions.cwd ?? null,
    helperShell: helperOptions.shell ?? null,
    helperDetached: helperOptions.detached ?? null,
    helperEnvDigest,
    helperStdio,
    postSpawn: normalizedPostSpawn,
    postSpawnWindows: postSpawnWindows || null,
    planBindingDigest: sha256(JSON.stringify(digestPayload)),
  });
}

/**
 * Consume the one-launch capability attached to a real built-in Windows MCP
 * code-snapshot plan. The issuer stays module-private so an injected adapter
 * cannot make a structurally similar helper payload authoritative.
 */
export function consumeWindowsMcpCodeSnapshotPlanBinding(plan, expected = {}) {
  const issued = issuedWindowsMcpCodeSnapshotPlans.get(plan);
  if (!issued) return false;
  issuedWindowsMcpCodeSnapshotPlans.delete(plan);
  return (
    issued.executionContract === expected.executionContract &&
    issued.originalCommand === expected.command &&
    sameStringArray(issued.originalArgs, expected.args) &&
    issued.originalCwd === (expected.cwd ?? null) &&
    issued.originalShell === (expected.shell ?? null) &&
    issued.originalDetached === (expected.detached ?? null) &&
    issued.profile === expected.profile &&
    sameStringArray(issued.requiredBoundaries, expected.requiredBoundaries) &&
    issued.sync === (expected.sync === true) &&
    plan.backend === issued.backend &&
    plan.policyAttested === issued.policyAttested &&
    plan.policyDigest === issued.policyDigest &&
    plan.command === issued.helperCommand &&
    sameStringArray(plan.args, issued.helperArgs) &&
    plan.options?.cwd === issued.helperCwd &&
    plan.options?.shell === issued.helperShell &&
    plan.options?.detached === issued.helperDetached &&
    windowsEnvironmentDigest(plan.options?.env) === issued.helperEnvDigest &&
    sameWindowsStdio(issued.helperStdio, plan.options?.stdio) &&
    plan.postSpawn?.required === issued.postSpawn.required &&
    plan.postSpawn?.mode === issued.postSpawn.mode &&
    (plan.postSpawnWindows || null) === issued.postSpawnWindows &&
    plan.runtimeProbe?.planBindingMechanism ===
      "windows-mcp-code-snapshot-plan-binding-v1" &&
    plan.runtimeProbe?.planBindingDigest === issued.planBindingDigest
  );
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

// Cleanup is authorized by the stable file-object identity, not by metadata
// that Windows may settle after the helper closes its last write handle.  The
// strict identity above remains authoritative while content is read or
// attested; this cleanup-only comparison still rejects a same-path replacement
// because that changes the inode/birth identity.
function sameWindowsFileObjectIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function inspectWindowsAdapterAssembly(runtime, assemblyPath) {
  const boundBefore = inspectWindowsAdapterBoundPath(
    runtime,
    assemblyPath,
    "file",
  );
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
  const boundAfter = assertWindowsAdapterBoundPathIdentity(
    runtime,
    assemblyPath,
    "file",
    boundBefore.identity,
  );
  if (!sameWindowsFileIdentity(afterIdentity, boundAfter.identity)) {
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
    entry.idleTtlMs !== source.idleTtlMs ||
    !sameWindowsAdapterTempRootBinding(
      entry.tempRootBinding,
      source.tempRootBinding,
    ) ||
    entry.sourceDigest !== source.sourceDigest ||
    entry.sourceContractDigest !== source.sourceContractDigest ||
    entry.loaderMode !== source.loaderMode
  ) {
    return false;
  }
  try {
    assertWindowsAdapterTempRoot(runtime);
    if (entry.adapterDirectory) {
      assertWindowsAdapterBoundPathIdentity(
        runtime,
        entry.adapterDirectory,
        "directory",
        entry.adapterDirectoryIdentity,
      );
    }
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
    entry,
    entry.fileIdentity,
  );
  const directoryDeleted = entry.adapterDirectory
    ? cleanupOrTrackWindowsTemporaryDirectory(
        entry.runtime,
        entry.adapterDirectory,
        attempts,
        entry,
        entry.adapterDirectoryIdentity,
      )
    : true;
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
  const appContainerCleaned = retryWindowsAppContainerCleanupBacklog();
  windowsAdapterCache = null;
  for (const entry of [...windowsAdapterCacheEntries]) {
    entry.retired = true;
    entry.refCount = 0;
    cleanupWindowsAdapterEntry(entry);
  }
  retryWindowsTemporaryCleanupBacklog();
  return (
    appContainerCleaned &&
    windowsTemporaryCleanupBacklog.size === 0 &&
    windowsAdapterCacheEntries.size === 0
  );
}

function normalizeWindowsAdapterIdleTtlMs(runtime) {
  const explicitTtl = runtime.windowsAdapterIdleTtlMs;
  const environmentTtl =
    runtime.env?.[WINDOWS_ADAPTER_IDLE_TTL_ENV] ??
    process.env[WINDOWS_ADAPTER_IDLE_TTL_ENV];
  const configuredTtl =
    explicitTtl === undefined ? environmentTtl : explicitTtl;
  const numericTtl =
    configuredTtl === "" || configuredTtl === null
      ? Number.NaN
      : Number(configuredTtl);
  return Number.isFinite(numericTtl) && numericTtl >= 0
    ? numericTtl
    : WINDOWS_ADAPTER_IDLE_TTL_MS;
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
  const idleTtlMs = entry.idleTtlMs;
  if (idleTtlMs === 0) {
    retireWindowsAdapterEntry(entry);
    return;
  }
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
  const tempRootBinding = assertWindowsAdapterTempRoot(runtime);
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
    tempDirectory: tempRootBinding.rootPath,
    tempRootBinding,
    tempRootAttestation: tempRootBinding.attestation,
    idleTtlMs: runtime.windowsAdapterIdleTtlMs,
    loaderMode,
  };
}

/**
 * Materialize the trusted in-process assembly bytes at a fresh path. The
 * managed image is never executed from this user-writable location. A
 * protected PowerShell host reads the bytes once, verifies the expected
 * digest, and loads those exact bytes with Assembly.Load(byte[]).
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
      ? WINDOWS_ADAPTER_HELPER_NAME
      : `${adapterBaseName}.dll`,
  );
  let adapterDirectoryIdentity = null;
  let assemblyFileIdentity = null;
  try {
    assertWindowsAdapterTempRoot(runtime);
    if (adapterDirectory) {
      if (
        inspectWindowsAdapterBoundPath(runtime, adapterDirectory, "directory", {
          allowMissing: true,
        }).exists
      ) {
        return { reason: "windows_native_adapter_random_path_collision" };
      }
      runtime.fs.mkdirSync(adapterDirectory, {
        mode: 0o700,
        recursive: false,
      });
      adapterDirectoryIdentity = inspectWindowsAdapterBoundPath(
        runtime,
        adapterDirectory,
        "directory",
      ).identity;
    }
    if (
      inspectWindowsAdapterBoundPath(runtime, assemblyPath, "file", {
        allowMissing: true,
      }).exists
    ) {
      const collision = new Error(
        "Windows native adapter random path collision",
      );
      collision.code = "EEXIST";
      throw collision;
    }
    runtime.fs.writeFileSync(assemblyPath, source.content, {
      mode: adapterDirectory ? 0o500 : 0o600,
      flag: "wx",
    });
    assemblyFileIdentity = inspectWindowsAdapterAssembly(
      runtime,
      assemblyPath,
    ).fileIdentity;
  } catch (error) {
    if (error?.code === "EEXIST") {
      const directoryDeleted = cleanupOrTrackWindowsTemporaryDirectory(
        runtime,
        adapterDirectory,
        100,
        null,
        adapterDirectoryIdentity,
      );
      return {
        reason: directoryDeleted
          ? "windows_native_adapter_random_path_collision"
          : "windows_native_adapter_compile_cleanup_unverified",
      };
    }
    if (!assemblyFileIdentity) {
      try {
        const inspected = inspectWindowsAdapterBoundPath(
          runtime,
          assemblyPath,
          "file",
          { allowMissing: true },
        );
        assemblyFileIdentity = inspected.exists ? inspected.identity : null;
      } catch {
        assemblyFileIdentity = null;
      }
    }
    const assemblyDeleted = cleanupOrTrackWindowsTemporaryPath(
      runtime,
      assemblyPath,
      100,
      null,
      assemblyFileIdentity,
    );
    const directoryDeleted = cleanupOrTrackWindowsTemporaryDirectory(
      runtime,
      adapterDirectory,
      100,
      null,
      adapterDirectoryIdentity,
    );
    if (error?.adapterReason === WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON) {
      return { reason: WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON };
    }
    if (!assemblyDeleted || !directoryDeleted) {
      return { reason: "windows_native_adapter_compile_cleanup_unverified" };
    }
    return { reason: "windows_native_adapter_materialize_failed" };
  }
  return {
    adapterDirectory,
    adapterDirectoryIdentity,
    assemblyPath,
    assemblyFileIdentity,
    cleanupAssembly: () => {
      const assemblyDeleted = cleanupOrTrackWindowsTemporaryPath(
        runtime,
        assemblyPath,
        100,
        null,
        assemblyFileIdentity,
      );
      const directoryDeleted = cleanupOrTrackWindowsTemporaryDirectory(
        runtime,
        adapterDirectory,
        100,
        null,
        adapterDirectoryIdentity,
      );
      return assemblyDeleted && directoryDeleted;
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
  let fileIdentity = null;
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
    if (
      inspectWindowsAdapterBoundPath(runtime, payloadPath, "file", {
        allowMissing: true,
      }).exists
    ) {
      return { reason: "windows_adapter_invocation_random_path_collision" };
    }
    runtime.fs.writeFileSync(payloadPath, content, {
      mode: 0o600,
      flag: "wx",
    });
    const inspected = inspectWindowsAdapterAssembly(runtime, payloadPath);
    if (inspected.assemblyDigest !== sha256(content)) {
      throw new Error("Windows adapter invocation changed after creation");
    }
    fileIdentity = inspected.fileIdentity;
  } catch (error) {
    if (!fileIdentity) {
      try {
        const inspected = inspectWindowsAdapterBoundPath(
          runtime,
          payloadPath,
          "file",
          { allowMissing: true },
        );
        fileIdentity = inspected.exists ? inspected.identity : null;
      } catch {
        fileIdentity = null;
      }
    }
    if (error?.adapterReason === WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON) {
      cleanupOrTrackWindowsTemporaryPath(
        runtime,
        payloadPath,
        100,
        null,
        fileIdentity,
      );
      return { reason: WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON };
    }
    if (error?.code === "EEXIST") {
      return { reason: "windows_adapter_invocation_random_path_collision" };
    }
    return {
      reason: cleanupOrTrackWindowsTemporaryPath(
        runtime,
        payloadPath,
        100,
        null,
        fileIdentity,
      )
        ? "windows_adapter_invocation_materialize_failed"
        : "windows_adapter_invocation_cleanup_unverified",
    };
  }
  return {
    payloadPath,
    payloadDigest: sha256(content),
    fileIdentity,
    verify: () => {
      const inspected = assertWindowsAdapterBoundPathIdentity(
        runtime,
        payloadPath,
        "file",
        fileIdentity,
      );
      return inspected.exists;
    },
    cleanup: () =>
      cleanupOrTrackWindowsTemporaryPath(
        runtime,
        payloadPath,
        100,
        null,
        fileIdentity,
      ),
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
      verify: invocation.verify,
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
    verify: invocation.verify,
    cleanup: invocation.cleanup,
  };
}

function resolveWindowsPowerShellHosts(runtime, loaderMode) {
  if (loaderMode !== "powershell-byte-assembly") return [];
  const windowsDirectory = path.win32.resolve(runtime.windowsDir());
  const driveRoot = path.win32.parse(windowsDirectory).root;
  const modernHost = runtime.joinPath(
    driveRoot,
    "Program Files",
    "PowerShell",
    "7",
    "pwsh.exe",
  );
  const realpath =
    runtime.fs.realpathSync?.native || runtime.fs.realpathSync || null;
  const hosts = [];
  if (runtime.fs.existsSync(modernHost) && typeof realpath === "function") {
    try {
      if (
        windowsCanonicalPathKey(realpath.call(runtime.fs, modernHost)) ===
        windowsCanonicalPathKey(modernHost)
      ) {
        hosts.push(modernHost);
      }
    } catch {
      // Fall through to the protected in-box host.
    }
  }

  const inboxHost = runtime.joinPath(
    windowsDirectory,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (runtime.fs.existsSync(inboxHost) && !hosts.includes(inboxHost)) {
    hosts.push(inboxHost);
  }
  return hosts;
}

function createFreshWindowsAdapter(runtime, source, hostEnvironment) {
  const materialized = materializeWindowsAdapter(runtime, source);
  if (!materialized.assemblyPath) return materialized;

  const powershellHosts = resolveWindowsPowerShellHosts(
    runtime,
    source.loaderMode,
  );
  if (
    source.loaderMode === "powershell-byte-assembly" &&
    powershellHosts.length === 0
  ) {
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
    tempRootBinding: source.tempRootBinding,
    idleTtlMs: source.idleTtlMs,
    sourceDigest: source.sourceDigest,
    sourceContractDigest: source.sourceContractDigest,
    loaderMode: source.loaderMode,
    powershellPath: powershellHosts[0] || null,
    adapterDirectory: materialized.adapterDirectory,
    adapterDirectoryIdentity: materialized.adapterDirectoryIdentity,
    assemblyPath: materialized.assemblyPath,
    assemblyDigest: attestation.assemblyDigest,
    fileIdentity: attestation.fileIdentity,
    refCount: 0,
    idleTimer: null,
    retired: false,
    cleaned: false,
  };
  const probeHosts =
    source.loaderMode === "powershell-byte-assembly" ? powershellHosts : [null];
  for (const powershellPath of probeHosts) {
    entry.powershellPath = powershellPath;
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
    if (!probePayloadDeleted) {
      materialized.cleanupAssembly();
      return {
        reason: "windows_native_adapter_compile_cleanup_unverified",
      };
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
    if (!probeReady) continue;
    if (!verifyWindowsAdapterEntry(entry, runtime, source)) break;

    windowsAdapterCacheEntries.add(entry);
    windowsAdapterCache = entry;
    registerWindowsAdapterExitCleanup();
    return { entry };
  }

  const assemblyDeleted = materialized.cleanupAssembly();
  return {
    reason: assemblyDeleted
      ? "windows_in_memory_adapter_probe_failed"
      : "windows_native_adapter_compile_cleanup_unverified",
  };
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
    const invocation = buildWindowsAdapterInvocation(entry, payload);
    invocation.verify();
    return invocation;
  };

  return {
    ensureExecutable: ensureEntry,
    createInvocation,
    spawnSync: (args, options) => {
      const invocation = createInvocation(args);
      let result;
      let failure;
      try {
        invocation.verify();
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

function readWindowsAdapterBoundFile(runtime, filePath, encoding = null) {
  const before = inspectWindowsAdapterBoundPath(runtime, filePath, "file");
  const content = runtime.fs.readFileSync(filePath, encoding || undefined);
  const after = assertWindowsAdapterBoundPathIdentity(
    runtime,
    filePath,
    "file",
    before.identity,
  );
  if (!sameWindowsFileIdentity(before.identity, after.identity)) {
    throw windowsAdapterTempRootChangedError();
  }
  return { content, fileIdentity: after.identity };
}

function waitForWindowsTargetIdentity(
  proc,
  identityPath,
  runtime,
  expectedAppContainer = null,
  timeoutMs = 30_000,
  onIdentityFileAttested = null,
) {
  const deadline = runtime.now() + timeoutMs;
  let lastError;
  while (runtime.now() < deadline) {
    try {
      const identityFile = readWindowsAdapterBoundFile(
        runtime,
        identityPath,
        "utf8",
      );
      onIdentityFileAttested?.(identityFile.fileIdentity);
      const identity = JSON.parse(identityFile.content);
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
        proc.sandboxAppContainerCapabilityCount = identity.capabilityCount;
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
    [
      /CreateProcess(?:AsUser)?\(AppContainer\)/i,
      "appcontainer_process_create",
    ],
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
      capabilityCount: readiness.capabilityCount,
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
  const capsuleContract =
    contract.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND;
  if (contract.kind !== "strict-plugin-node-bin" && !capsuleContract) {
    return {
      locks: null,
      reason: "windows_plugin_execution_contract_unsupported",
    };
  }
  if (
    capsuleContract &&
    !isMcpStdioCapsuleNativeCodePolicy(contract.nativeCodePolicy)
  ) {
    return {
      locks: null,
      reason: "windows_mcp_native_code_policy_invalid",
    };
  }
  if (
    (!capsuleContract && sandboxOpts.sync !== true) ||
    spawnOpts?.detached === true
  ) {
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

function windowsAppContainerPolicyDigest({
  profile,
  requiredBoundaries,
  guarantees,
  adapterSource,
  launchSpec,
  entrySnapshot,
  executionContract,
}) {
  // Bind the effective enforcement policy and attested executable snapshot.
  // Transient profile names/SIDs and caller payload values are intentionally
  // excluded so identical policy identities remain stable across launches.
  const snapshotLocks = entrySnapshot.locks
    ? entrySnapshot.locks.map(
        ({ role, path: lockPath, sha256, bytes, dev, ino }) => ({
          role,
          path: lockPath,
          sha256,
          bytes,
          dev,
          ino,
        }),
      )
    : [];
  return sha256(
    JSON.stringify({
      version: 1,
      backend: WINDOWS_APPCONTAINER_BACKEND,
      profile,
      requiredBoundaries: [...new Set(requiredBoundaries)].sort(),
      guarantees: [...new Set(guarantees)].sort(),
      adapter: {
        loaderMode: adapterSource.loaderMode,
        sourceDigest: adapterSource.sourceDigest,
        sourceContractDigest: adapterSource.sourceContractDigest,
      },
      appContainer: {
        attestationKind: "windows-appcontainer-launch-attestation-v1",
        capabilities: [],
        token: "restricted-primary-lowbox",
        disableAdministratorSids: launchSpec.disableAdministratorSids,
        allowReparsePaths: launchSpec.allowReparsePaths,
        lifecycle: "ephemeral-delete-and-assert-absent",
      },
      job: {
        killOnClose: true,
        activeProcessLimit: launchSpec.activeProcessLimit,
        cpuSeconds: launchSpec.cpuSeconds,
        processMemoryBytes: launchSpec.processMemoryBytes,
      },
      execution: {
        contractKind: executionContract?.kind || null,
        contentSnapshot: snapshotLocks.length > 0,
        contentSnapshotScope:
          snapshotLocks.length > 0 ? "plugin-entry-source" : null,
        contentSnapshotMechanism:
          snapshotLocks.length > 0
            ? "verified-handle-inherited-pipe-module-compile-v1"
            : null,
        handleAtomic: false,
        ...(snapshotLocks.length > 0 &&
        executionContract?.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND
          ? {
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: true,
              runtimeLaunchMechanism:
                "filter-oplock-locked-createprocess-suspended-image-v1",
              sharedLibraryClosure: false,
              nativeCodePolicyDigest: mcpStdioCapsuleNativeCodePolicyDigest(
                executionContract.nativeCodePolicy,
              ),
            }
          : {}),
        launchPathLocks: snapshotLocks,
      },
    }),
  );
}

/**
 * Wrap a target with a protected Windows PowerShell host. PowerShell 7 is
 * preferred only when its canonical Program Files path is intact; otherwise
 * the in-box System32 host remains the fallback. The shipped byte-loaded helper
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
  planBindingAuthority = null,
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
  const appContainerSupportedBoundaries = [
    ...appContainerGuarantees,
    SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
    SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
  ];
  const base = {
    platform: runtime.platform,
    profile: sandboxOpts.profileName || "default",
    backend,
    command,
    args,
    options: spawnOpts,
  };
  let appContainerPolicyDigest = null;
  const unavailablePlan = (reason, extra = {}) =>
    createSandboxPlan({
      ...base,
      ...(requiresAppContainer
        ? {
            backend: null,
            candidateBackend: WINDOWS_APPCONTAINER_BACKEND,
            policyAttested: false,
            policyDigest: appContainerPolicyDigest,
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
      (boundary) => !appContainerSupportedBoundaries.includes(boundary),
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
  const windowsAdapterTempRootBinding = resolveWindowsAdapterTempRoot(
    runtime,
    runtimeOverrides,
  );
  if (!windowsAdapterTempRootBinding) {
    return unavailablePlan(WINDOWS_ADAPTER_TEMP_ROOT_UNTRUSTED_REASON);
  }
  const windowsAdapterIdleTtlMs = normalizeWindowsAdapterIdleTtlMs(runtime);
  runtime = {
    ...runtime,
    windowsAdapterTempRoot: windowsAdapterTempRootBinding.rootPath,
    windowsAdapterTempRootBinding,
    windowsAdapterIdleTtlMs,
    tmpdir: () => windowsAdapterTempRootBinding.rootPath,
  };
  const loaderMode =
    profile !== "strict" && !requiresAppContainer && !entrySnapshot.locks
      ? "managed-executable"
      : "powershell-byte-assembly";
  let adapterSource;
  try {
    adapterSource = loadWindowsAdapterSource(runtime, loaderMode);
  } catch (error) {
    return unavailablePlan(
      error?.adapterReason || WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON,
    );
  }
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
  let identityFileIdentity = null;
  if (identityPath) {
    try {
      if (
        inspectWindowsAdapterBoundPath(runtime, identityPath, "file", {
          allowMissing: true,
        }).exists
      ) {
        return unavailablePlan("windows_identity_random_path_collision");
      }
    } catch (error) {
      return unavailablePlan(
        error?.adapterReason || WINDOWS_ADAPTER_TEMP_ROOT_CHANGED_REASON,
      );
    }
  }
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
  if (requiresAppContainer) {
    appContainerPolicyDigest = windowsAppContainerPolicyDigest({
      profile,
      requiredBoundaries,
      guarantees: appContainerGuarantees,
      adapterSource,
      launchSpec,
      entrySnapshot,
      executionContract: sandboxOpts.executionContract,
    });
  }
  if (identityPath) launchSpec.identityPath = identityPath;
  const cleanupIdentity = () => {
    if (!identityPath) return true;
    return cleanupOrTrackWindowsTemporaryPath(
      runtime,
      identityPath,
      100,
      null,
      identityFileIdentity,
    );
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
    env: Object.freeze({ ...hostEnvironment }),
    stdio: Array.isArray(invocation.options.stdio)
      ? Object.freeze([...invocation.options.stdio])
      : invocation.options.stdio,
  };
  let appContainerCleanupVerified = false;
  let appContainerCleanupRecord = null;
  let issuedWindowsMcpPlan = null;
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
    if (issuedWindowsMcpPlan) {
      issuedWindowsMcpCodeSnapshotPlans.delete(issuedWindowsMcpPlan);
      issuedWindowsMcpPlan = null;
    }
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
              30_000,
              (fileIdentity) => {
                identityFileIdentity = fileIdentity;
              },
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
  const windowsMcpPlanBinding =
    entrySnapshot.locks &&
    sandboxOpts.executionContract?.kind ===
      MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND
      ? createWindowsMcpCodeSnapshotPlanBinding({
          executionContract: sandboxOpts.executionContract,
          command,
          args,
          spawnOpts,
          profile,
          requiredBoundaries,
          sync: sandboxOpts.sync === true,
          backend,
          policyAttested: requiresAppContainer ? true : null,
          policyDigest: appContainerPolicyDigest,
          adapterSource,
          helperInvocation,
          helperOptions: options,
          postSpawn: identityContract.postSpawn,
          postSpawnWindows: identityContract.postSpawnWindows,
        })
      : null;
  const entrySnapshotRuntimeProbe = entrySnapshot.locks
    ? {
        ...(appContainerRuntimeProbe || nodeSnapshotRuntimeProbe),
        contentSnapshot: true,
        contentSnapshotScope:
          sandboxOpts.executionContract?.kind ===
          MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND
            ? "mcp-capsule-entry-source"
            : "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-handle-inherited-pipe-module-compile-v1",
        handleAtomic: false,
        ...(sandboxOpts.executionContract?.kind ===
        MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND
          ? {
              runtimeAttestedSha256: entrySnapshot.locks.find(
                ({ role }) => role === "runtime",
              )?.sha256,
              runtimeAttestedBytes: entrySnapshot.locks.find(
                ({ role }) => role === "runtime",
              )?.bytes,
              entrySnapshotSha256: entrySnapshot.locks.find(
                ({ role }) => role === "entry",
              )?.sha256,
              entrySnapshotBytes: entrySnapshot.locks.find(
                ({ role }) => role === "entry",
              )?.bytes,
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: true,
              runtimeLaunchMechanism:
                "filter-oplock-locked-createprocess-suspended-image-v1",
              sharedLibraryClosure: false,
              ...mcpStdioCapsuleNativeCodeEvidence(
                sandboxOpts.executionContract.nativeCodePolicy,
              ),
              planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
              planBindingDigest: windowsMcpPlanBinding.planBindingDigest,
            }
          : {}),
      }
    : appContainerRuntimeProbe;
  const plan = createSandboxPlan({
    ...base,
    applied: true,
    enforcement: backend,
    policyAttested: requiresAppContainer ? true : null,
    policyDigest: appContainerPolicyDigest,
    adapterTempRootAttestation: adapterSource.tempRootAttestation,
    runtimeProbe: entrySnapshotRuntimeProbe,
    guarantees: [
      ...(requiresAppContainer
        ? appContainerGuarantees
        : [
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
          ]),
      ...(entrySnapshot.locks &&
      sandboxOpts.executionContract?.kind ===
        MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND
        ? [
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
          ]
        : []),
    ],
    command: helperInvocation.command,
    args: helperInvocation.args,
    options,
    ...identityContract,
    cleanup,
  });
  if (
    windowsMcpPlanBinding &&
    planBindingAuthority === WINDOWS_MCP_CODE_SNAPSHOT_ISSUER
  ) {
    issuedWindowsMcpPlan = plan;
    issuedWindowsMcpCodeSnapshotPlans.set(plan, windowsMcpPlanBinding);
  }
  return plan;
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
  contentSnapshot = null,
  supervisorBinding = null,
  pluginTreeSnapshot = null,
  nativeDynamicClosure = null,
  runtimeLoadSet = null,
  runtimeDetachedChildSpawnVerified = false,
) {
  const native =
    typeof targetRuntime === "string" && targetRuntime.startsWith("native-");
  const dynamicNative = targetRuntime === "native-dynamic-elf";
  const expectedSnapshotScope = native
    ? LINUX_NATIVE_ENTRY_SNAPSHOT_SCOPE
    : LINUX_NODE_ENTRY_SNAPSHOT_SCOPE;
  const snapshot =
    contentSnapshot?.scope === expectedSnapshotScope &&
    contentSnapshot?.mechanism === LINUX_ENTRY_SNAPSHOT_MECHANISM;
  const supervisorDescriptorBound =
    supervisorBinding?.mechanism === LINUX_BWRAP_SUPERVISOR_BINDING_MECHANISM;
  const pluginTreeContentSnapshot =
    attempted &&
    snapshot &&
    runnable &&
    reason === null &&
    supervisorDescriptorBound &&
    pluginTreeSnapshot?.scope === LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE &&
    pluginTreeSnapshot?.mechanism === LINUX_ENTRY_SNAPSHOT_MECHANISM &&
    Number.isSafeInteger(pluginTreeSnapshot?.files) &&
    pluginTreeSnapshot.files > 0 &&
    pluginTreeSnapshot.files <= LINUX_PLUGIN_TREE_SNAPSHOT_MAX_FILES &&
    Number.isSafeInteger(pluginTreeSnapshot?.bytes) &&
    pluginTreeSnapshot.bytes >= 0 &&
    pluginTreeSnapshot.bytes <= LINUX_PLUGIN_TREE_SNAPSHOT_MAX_BYTES &&
    typeof pluginTreeSnapshot?.digest === "string" &&
    /^[a-f0-9]{64}$/.test(pluginTreeSnapshot.digest) &&
    pluginTreeSnapshot?.consistency ===
      LINUX_PLUGIN_TREE_SNAPSHOT_CONSISTENCY &&
    pluginTreeSnapshot?.contractBound === false &&
    pluginTreeSnapshot?.atomic === false;
  const initialDynamicLoadClosureDescriptorBound =
    dynamicNative &&
    attempted &&
    snapshot &&
    runnable &&
    reason === null &&
    supervisorDescriptorBound &&
    nativeDynamicClosure?.mechanism ===
      LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_MECHANISM &&
    nativeDynamicClosure?.scope ===
      LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_SCOPE &&
    typeof nativeDynamicClosure?.interpreter === "string" &&
    path.posix.isAbsolute(nativeDynamicClosure.interpreter) &&
    Number.isSafeInteger(nativeDynamicClosure?.dependencies) &&
    nativeDynamicClosure.dependencies >= 0 &&
    nativeDynamicClosure.dependencies <= LINUX_ELF_MAX_INITIAL_CLOSURE_EDGES &&
    Number.isSafeInteger(nativeDynamicClosure?.files) &&
    nativeDynamicClosure.files >= 1 &&
    nativeDynamicClosure.files <= LINUX_ELF_MAX_INITIAL_CLOSURE_FILES &&
    Number.isSafeInteger(nativeDynamicClosure?.bytes) &&
    nativeDynamicClosure.bytes > 0 &&
    nativeDynamicClosure.bytes <= LINUX_ELF_MAX_INITIAL_CLOSURE_BYTES &&
    typeof nativeDynamicClosure?.digest === "string" &&
    /^[a-f0-9]{64}$/.test(nativeDynamicClosure.digest);
  const runtimeSharedLibraryPathnameClosure =
    initialDynamicLoadClosureDescriptorBound &&
    pluginTreeContentSnapshot &&
    runtimeLoadSet?.scope === LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_SCOPE &&
    runtimeLoadSet?.mechanism ===
      LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MECHANISM &&
    Number.isSafeInteger(runtimeLoadSet?.files) &&
    runtimeLoadSet.files > 0 &&
    runtimeLoadSet.files <= LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_FILES &&
    Number.isSafeInteger(runtimeLoadSet?.bytes) &&
    runtimeLoadSet.bytes > 0 &&
    runtimeLoadSet.bytes <= LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_BYTES &&
    typeof runtimeLoadSet?.digest === "string" &&
    /^[a-f0-9]{64}$/.test(runtimeLoadSet.digest) &&
    runtimeLoadSet.policyBound === true &&
    runtimeLoadSet.writableFilesystems === false &&
    runtimeLoadSet.procfsMounted === false &&
    runtimeLoadSet.devfsMounted === false &&
    runtimeLoadSet.scratchWritable === false &&
    runtimeLoadSet.descriptorReopenPaths === false;
  return {
    kind: dynamicNative
      ? "linux-bwrap-plugin-native-dynamic-elf-policy-v1"
      : targetRuntime === "native-static-elf"
        ? "linux-bwrap-plugin-native-static-elf-policy-v1"
        : native
          ? "linux-bwrap-plugin-native-elf-policy-v1"
          : "linux-bwrap-plugin-node-policy-v1",
    attempted,
    runnable,
    reason,
    probeRuntime: "node",
    targetRuntime,
    runtimeDetachedChildSpawnVerified,
    contentSnapshot: snapshot,
    ...(snapshot
      ? {
          contentSnapshotScope: contentSnapshot.scope,
          contentSnapshotMechanism: contentSnapshot.mechanism,
        }
      : {}),
    ...(pluginTreeContentSnapshot
      ? {
          pluginTreeContentSnapshot: true,
          pluginTreeContentSnapshotScope: pluginTreeSnapshot.scope,
          pluginTreeContentSnapshotMechanism: pluginTreeSnapshot.mechanism,
          pluginTreeContentSnapshotFiles: pluginTreeSnapshot.files,
          pluginTreeContentSnapshotBytes: pluginTreeSnapshot.bytes,
          pluginTreeContentSnapshotDigest: pluginTreeSnapshot.digest,
          pluginTreeSnapshotConsistency: pluginTreeSnapshot.consistency,
          pluginTreeSnapshotContractBound: pluginTreeSnapshot.contractBound,
          pluginTreeSnapshotAtomic: pluginTreeSnapshot.atomic,
        }
      : {}),
    ...(initialDynamicLoadClosureDescriptorBound
      ? {
          initialDynamicLoadClosureDescriptorBound: true,
          initialDynamicLoadClosureScope: nativeDynamicClosure.scope,
          initialDynamicLoadClosureMechanism: nativeDynamicClosure.mechanism,
          initialDynamicInterpreter: nativeDynamicClosure.interpreter,
          initialDynamicDependencyCount: nativeDynamicClosure.dependencies,
          initialDynamicRuntimeFileCount: nativeDynamicClosure.files,
          initialDynamicRuntimeBytes: nativeDynamicClosure.bytes,
          initialDynamicLoadClosureDigest: nativeDynamicClosure.digest,
          // The legacy aggregate field is intentionally kept false: this
          // production slice closes libc/ELF-loader pathname resolution, not
          // anonymous JIT mappings or a malicious custom in-process loader.
          sharedLibraryClosure: false,
          ...(runtimeSharedLibraryPathnameClosure
            ? {
                runtimeSharedLibraryPathnameClosure: true,
                runtimeSharedLibraryPathnameClosureExcludes:
                  "anonymous-jit-and-custom-in-process-loader",
                runtimeSharedLibraryClosureScope: runtimeLoadSet.scope,
                runtimeSharedLibraryClosureMechanism: runtimeLoadSet.mechanism,
                runtimeSharedLibraryLoadSetFiles: runtimeLoadSet.files,
                runtimeSharedLibraryLoadSetBytes: runtimeLoadSet.bytes,
                runtimeSharedLibraryLoadSetDigest: runtimeLoadSet.digest,
                runtimeLoadSetPolicyBound: runtimeLoadSet.policyBound,
                runtimeWritableFilesystems: runtimeLoadSet.writableFilesystems,
                runtimeProcfsMounted: runtimeLoadSet.procfsMounted,
                runtimeDevfsMounted: runtimeLoadSet.devfsMounted,
                runtimeScratchWritable: runtimeLoadSet.scratchWritable,
                runtimeDescriptorReopenPaths:
                  runtimeLoadSet.descriptorReopenPaths,
              }
            : {}),
        }
      : {}),
    supervisorDescriptorBound,
    ...(supervisorDescriptorBound
      ? {
          supervisorExecutablePinned: true,
          supervisorBindingScope: supervisorBinding.scope,
          supervisorDescriptorBindingMechanism: supervisorBinding.mechanism,
          supervisorDescriptorContained: runnable,
          supervisorDescriptorConsumedBeforeTarget: runnable,
          supervisorStagingPathHidden: runnable,
          supervisorTemporaryCopyObscured: runnable,
          supervisorPid1ExecutableExposure: runtimeSharedLibraryPathnameClosure
            ? "procfs-not-mounted"
            : supervisorBinding.pid1ExecutableExposure,
          supervisorExecutableIdentity: {
            path: supervisorBinding.path,
            fileId: supervisorBinding.fileId,
            sha256: supervisorBinding.sha256,
            bytes: supervisorBinding.bytes,
            mtimeMs: supervisorBinding.mtimeMs,
            mode: supervisorBinding.mode,
            uid: supervisorBinding.uid,
            gid: supervisorBinding.gid,
          },
        }
      : {}),
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
  { probe = false, supervisorFd = null, scrubberFd = null } = {},
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
  const supervisor = Number.isInteger(supervisorFd) ? [supervisorFd] : [];
  const scrubber = Number.isInteger(scrubberFd) ? [scrubberFd] : [];
  return [
    ...standard.slice(0, 3),
    ...supervisor,
    ...descriptors.map((descriptor) => descriptor.fd),
    ...scrubber,
  ];
}

function validateLinuxPluginContract(
  command,
  args,
  spawnOpts,
  contract,
  runtime,
  sync,
  { sealedEntry = false } = {},
) {
  const capsuleContract =
    contract?.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND;
  const nodeContract =
    contract?.kind === "strict-plugin-node-bin" || capsuleContract;
  const legacyStaticNativeContract =
    contract?.kind === "strict-plugin-native-static-elf-bin";
  const nativeContract =
    legacyStaticNativeContract ||
    contract?.kind === "strict-plugin-native-elf-bin";
  const entryIsSealed =
    (nodeContract || nativeContract) && sealedEntry === true;
  if (
    !contract ||
    contract.contractVersion !== 1 ||
    (!nodeContract && !nativeContract)
  ) {
    return { ok: false, reason: "execution_contract_missing" };
  }
  if (
    capsuleContract &&
    !isMcpStdioCapsuleNativeCodePolicy(contract.nativeCodePolicy)
  ) {
    return { ok: false, reason: "mcp_native_code_policy_invalid" };
  }
  if (
    (sync !== true && sync !== false) ||
    spawnOpts?.shell !== false ||
    (spawnOpts?.detached === true && !capsuleContract) ||
    !linuxStdioIsNarrow(spawnOpts?.stdio) ||
    spawnOpts?.serialization !== undefined ||
    spawnOpts?.argv0 !== undefined ||
    spawnOpts?.uid !== undefined ||
    spawnOpts?.gid !== undefined
  ) {
    return { ok: false, reason: "unsupported_launch_options" };
  }
  let argsSnapshot = null;
  try {
    if (
      Array.isArray(args) &&
      Object.getPrototypeOf(args) === Array.prototype
    ) {
      const descriptors = Object.getOwnPropertyDescriptors(args);
      const lengthDescriptor = descriptors.length;
      if (
        lengthDescriptor &&
        "value" in lengthDescriptor &&
        Number.isSafeInteger(lengthDescriptor.value) &&
        lengthDescriptor.value >= 0 &&
        Reflect.ownKeys(descriptors).length === lengthDescriptor.value + 1
      ) {
        const snapshot = [];
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            !descriptor ||
            !("value" in descriptor) ||
            typeof descriptor.value !== "string" ||
            descriptor.value.includes("\0")
          ) {
            argsSnapshot = null;
            break;
          }
          snapshot.push(descriptor.value);
        }
        if (snapshot.length === lengthDescriptor.value) {
          argsSnapshot = Object.freeze(snapshot);
        }
      }
    }
  } catch {
    argsSnapshot = null;
  }
  const invalidArgs = argsSnapshot === null;
  const invalidNodeLaunch =
    nodeContract &&
    (!argsSnapshot ||
      command !== contract.runtimePath ||
      command !== contract.runtimeIdentity?.realPath ||
      argsSnapshot.length < 1 ||
      argsSnapshot[0] !== contract.entryIdentity?.realPath);
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
    (!entryIsSealed &&
      !linuxIdentityMatches(runtime, contract.entryIdentity, {
        executable: nativeContract,
      })) ||
    !linuxIdentityMatches(runtime, contract.runtimeIdentity, {
      executable: true,
    })
  ) {
    return { ok: false, reason: "execution_identity_changed" };
  }
  let entryFormat = null;
  if (nativeContract && !entryIsSealed) {
    try {
      entryFormat = inspectLinuxNativePath(runtime, contract.entryIdentity);
    } catch (error) {
      return {
        ok: false,
        reason: error.message || "native_entry_unattested",
      };
    }
    if (
      legacyStaticNativeContract &&
      entryFormat.runtime !== "native-static-elf"
    ) {
      return {
        ok: false,
        reason: "native_entry_dynamic_contract_required",
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
    argsSnapshot,
    entryRuntime: nativeContract
      ? entryFormat?.runtime ||
        (legacyStaticNativeContract
          ? "native-static-elf"
          : "native-unclassified")
      : "node",
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

function linuxEntrySnapshotContract(targetRuntime) {
  if (targetRuntime?.startsWith("native-")) {
    return {
      scope: LINUX_NATIVE_ENTRY_SNAPSHOT_SCOPE,
      targetMode: LINUX_NATIVE_ENTRY_SNAPSHOT_TARGET_MODE,
      sourceMode: LINUX_ENTRY_SNAPSHOT_SOURCE_MODE,
      minimumBytes: LINUX_ELF64_HEADER_BYTES,
      errorPrefix: "native_entry_snapshot",
    };
  }
  if (targetRuntime === "node") {
    return {
      scope: LINUX_NODE_ENTRY_SNAPSHOT_SCOPE,
      targetMode: LINUX_NODE_ENTRY_SNAPSHOT_TARGET_MODE,
      sourceMode: LINUX_ENTRY_SNAPSHOT_SOURCE_MODE,
      minimumBytes: 0,
      errorPrefix: "node_entry_snapshot",
    };
  }
  throw new Error("entry_snapshot_runtime_unsupported");
}

function linuxPluginTreeFileSnapshotContract(sourceMode, targetRuntime) {
  const native = targetRuntime?.startsWith("native-");
  const errorPrefix = native
    ? "native_plugin_tree_snapshot"
    : "node_plugin_tree_snapshot";
  if (!Number.isSafeInteger(sourceMode) || sourceMode < 0) {
    throw new Error(`${errorPrefix}_source_mode_invalid`);
  }
  return {
    scope: LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE,
    targetMode: (sourceMode & 0o111) !== 0 ? "0500" : "0400",
    sourceMode: LINUX_ENTRY_SNAPSHOT_SOURCE_MODE,
    minimumBytes: 0,
    errorPrefix,
  };
}

function linuxMcpRuntimeSnapshotContract() {
  return {
    scope: LINUX_MCP_RUNTIME_SNAPSHOT_SCOPE,
    targetMode: "0500",
    sourceMode: LINUX_EXECUTABLE_SNAPSHOT_SOURCE_MODE,
    minimumBytes: 1,
    errorPrefix: "mcp_node_runtime_snapshot",
  };
}

function linuxPluginRuntimeSnapshotContract() {
  return {
    scope: LINUX_PLUGIN_RUNTIME_SNAPSHOT_SCOPE,
    targetMode: "0500",
    sourceMode: LINUX_EXECUTABLE_SNAPSHOT_SOURCE_MODE,
    minimumBytes: 1,
    errorPrefix: "plugin_node_runtime_snapshot",
  };
}

function createLinuxRegularFileSnapshot(
  runtime,
  entryMount,
  entryIdentity,
  snapshotContract,
) {
  let writerFd;
  let probeFd;
  let finalFd;
  try {
    const snapshotSourceMode = snapshotContract?.sourceMode;
    if (
      !snapshotContract ||
      typeof snapshotContract.scope !== "string" ||
      typeof snapshotContract.targetMode !== "string" ||
      !Number.isSafeInteger(snapshotSourceMode) ||
      ![
        LINUX_ENTRY_SNAPSHOT_SOURCE_MODE,
        LINUX_EXECUTABLE_SNAPSHOT_SOURCE_MODE,
      ].includes(snapshotSourceMode) ||
      !Number.isSafeInteger(snapshotContract.minimumBytes) ||
      typeof snapshotContract.errorPrefix !== "string"
    ) {
      throw new Error("file_snapshot_contract_invalid");
    }
    const snapshotError = (reason) =>
      new Error(`${snapshotContract.errorPrefix}_${reason}`);
    const expectedSha256 = entryIdentity?.sha256 ?? null;
    for (const method of [
      "openSync",
      "readSync",
      "writeSync",
      "fchmodSync",
      "fsyncSync",
      "fstatSync",
      "closeSync",
    ]) {
      if (typeof runtime.fs[method] !== "function") {
        throw snapshotError(`${method}_unavailable`);
      }
    }
    if (
      !Number.isInteger(entryMount?.fd) ||
      !entryIdentity ||
      (expectedSha256 !== null &&
        (typeof expectedSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(expectedSha256))) ||
      !Number.isSafeInteger(entryIdentity.bytes) ||
      entryIdentity.bytes < snapshotContract.minimumBytes ||
      entryIdentity.bytes > LINUX_ATTESTED_FILE_MAX_BYTES
    ) {
      throw snapshotError("identity_invalid");
    }

    const sourceBefore = runtime.fs.fstatSync(entryMount.fd);
    const sourceFileMode = Number(sourceBefore.mode) & 0o7777;
    if (
      !sourceBefore.isFile() ||
      Number(sourceBefore.nlink) !== 1 ||
      String(sourceBefore.dev) !== String(entryIdentity.fileId?.dev) ||
      String(sourceBefore.ino) !== String(entryIdentity.fileId?.ino) ||
      Number(sourceBefore.size) !== entryIdentity.bytes ||
      Number(sourceBefore.mtimeMs) !== Number(entryIdentity.mtimeMs)
    ) {
      throw snapshotError("source_changed");
    }
    if (
      snapshotContract.scope === LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE &&
      snapshotContract.targetMode !==
        ((sourceFileMode & 0o111) !== 0 ? "0500" : "0400")
    ) {
      throw snapshotError("source_mode_changed");
    }
    if (
      (snapshotContract.scope === LINUX_NATIVE_ENTRY_SNAPSHOT_SCOPE ||
        snapshotContract.scope === LINUX_MCP_RUNTIME_SNAPSHOT_SCOPE ||
        snapshotContract.scope === LINUX_PLUGIN_RUNTIME_SNAPSHOT_SCOPE) &&
      (sourceFileMode & 0o111) === 0
    ) {
      throw snapshotError("source_mode_changed");
    }

    const constants = runtime.fs.constants || fs.constants;
    const writerFlags =
      Number(constants.O_RDWR) |
      Number(constants.O_EXCL) |
      Number(constants.O_TMPFILE ?? LINUX_O_TMPFILE) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    writerFd = runtime.fs.openSync("/tmp", writerFlags, snapshotSourceMode);

    const sourceDigest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(
      Math.max(
        1,
        Math.min(LINUX_ATTESTATION_HASH_CHUNK_BYTES, entryIdentity.bytes),
      ),
    );
    let copied = 0;
    while (copied < entryIdentity.bytes) {
      const read = runtime.fs.readSync(
        entryMount.fd,
        chunk,
        0,
        Math.min(chunk.length, entryIdentity.bytes - copied),
        copied,
      );
      if (read <= 0) {
        throw snapshotError("source_ended_early");
      }
      sourceDigest.update(chunk.subarray(0, read));
      let written = 0;
      while (written < read) {
        const count = runtime.fs.writeSync(
          writerFd,
          chunk,
          written,
          read - written,
          copied + written,
        );
        if (count <= 0) {
          throw snapshotError("write_failed");
        }
        written += count;
      }
      copied += read;
    }
    const sourceAfter = runtime.fs.fstatSync(entryMount.fd);
    const sourceSha256 = sourceDigest.digest("hex");
    if (
      !linuxOpenStatMatches(sourceBefore, sourceAfter) ||
      (expectedSha256 !== null && sourceSha256 !== expectedSha256)
    ) {
      throw snapshotError("source_changed");
    }

    runtime.fs.fsyncSync(writerFd);
    const snapshotBeforeRead = runtime.fs.fstatSync(writerFd);
    if (
      !snapshotBeforeRead.isFile() ||
      Number(snapshotBeforeRead.nlink) !== 0 ||
      Number(snapshotBeforeRead.size) !== entryIdentity.bytes
    ) {
      throw snapshotError("identity_changed");
    }
    const snapshotSha256 = hashLinuxOpenFile(
      runtime,
      writerFd,
      entryIdentity.bytes,
    );
    const snapshotAfterRead = runtime.fs.fstatSync(writerFd);
    if (
      !linuxOpenStatMatches(snapshotBeforeRead, snapshotAfterRead) ||
      snapshotSha256 !== sourceSha256
    ) {
      throw snapshotError("identity_changed");
    }

    runtime.fs.fchmodSync(writerFd, snapshotSourceMode);
    runtime.fs.fsyncSync(writerFd);
    const sealedBeforeRead = runtime.fs.fstatSync(writerFd);
    if (
      !sealedBeforeRead.isFile() ||
      Number(sealedBeforeRead.nlink) !== 0 ||
      Number(sealedBeforeRead.size) !== entryIdentity.bytes ||
      (Number(sealedBeforeRead.mode) & 0o777) !== snapshotSourceMode
    ) {
      throw snapshotError("readonly_mode_unattested");
    }
    const sealedSha256 = hashLinuxOpenFile(
      runtime,
      writerFd,
      entryIdentity.bytes,
    );
    const sealed = runtime.fs.fstatSync(writerFd);
    if (
      !linuxOpenStatMatches(sealedBeforeRead, sealed) ||
      sealedSha256 !== sourceSha256
    ) {
      throw snapshotError("identity_changed");
    }

    const readerFlags =
      Number(constants.O_RDONLY) | Number(constants.O_NONBLOCK || 0);
    probeFd = runtime.fs.openSync(`/proc/self/fd/${writerFd}`, readerFlags);
    finalFd = runtime.fs.openSync(`/proc/self/fd/${writerFd}`, readerFlags);
    if (probeFd === finalFd) {
      throw snapshotError("readers_not_independent");
    }
    for (const fd of [probeFd, finalFd]) {
      const reader = runtime.fs.fstatSync(fd);
      if (!linuxOpenStatMatches(sealed, reader)) {
        throw snapshotError("reader_identity_changed");
      }
    }
    const ownedWriterFd = writerFd;
    writerFd = undefined;
    runtime.fs.closeSync(ownedWriterFd);

    const verifyClosedWriterSnapshot = runtime.fs.fstatSync(finalFd);
    if (!linuxOpenStatMatches(sealed, verifyClosedWriterSnapshot)) {
      throw snapshotError("reader_identity_changed");
    }

    const attestation = Object.freeze({
      scope: snapshotContract.scope,
      mechanism: LINUX_ENTRY_SNAPSHOT_MECHANISM,
      sha256: sourceSha256,
      bytes: entryIdentity.bytes,
      sourceFileId: Object.freeze({
        dev: String(entryIdentity.fileId.dev),
        ino: String(entryIdentity.fileId.ino),
      }),
      sourceMtimeMs: Number(entryIdentity.mtimeMs),
      sourceFileMode: sourceFileMode.toString(8).padStart(4, "0"),
      sourceMode: snapshotSourceMode.toString(8).padStart(4, "0"),
      targetMode: snapshotContract.targetMode,
    });
    const descriptor = (fd) => {
      const stat = runtime.fs.fstatSync(fd);
      return {
        ...entryMount,
        fd,
        fileId: {
          dev: String(stat.dev),
          ino: String(stat.ino),
        },
        bytes: Number(stat.size),
        mtimeMs: Number(stat.mtimeMs),
        mountMode: "ro-bind-data",
        mountPermissions: snapshotContract.targetMode,
        contentSnapshot: attestation,
        snapshotIdentity: Object.freeze({
          sha256: sourceSha256,
          bytes: entryIdentity.bytes,
          fileId: Object.freeze({
            dev: String(stat.dev),
            ino: String(stat.ino),
          }),
          mtimeMs: Number(stat.mtimeMs),
        }),
      };
    };
    const result = {
      attestation,
      probeMount: descriptor(probeFd),
      finalMount: descriptor(finalFd),
    };
    probeFd = undefined;
    finalFd = undefined;
    return result;
  } catch (error) {
    closeLinuxPinnedMounts(
      runtime,
      [probeFd, finalFd, writerFd]
        .filter(Number.isInteger)
        .map((fd) => ({ fd })),
    );
    throw error;
  }
}

function createLinuxEntrySnapshot(
  runtime,
  entryMount,
  entryIdentity,
  targetRuntime,
) {
  return createLinuxRegularFileSnapshot(
    runtime,
    entryMount,
    entryIdentity,
    linuxEntrySnapshotContract(targetRuntime),
  );
}

function attestLinuxRegularFileSnapshot(
  runtime,
  mount,
  attestation,
  snapshotContract,
) {
  const errorPrefix = snapshotContract.errorPrefix;
  const snapshotSourceMode = snapshotContract.sourceMode;
  const before = runtime.fs.fstatSync(mount?.fd);
  if (
    attestation?.scope !== snapshotContract.scope ||
    attestation?.mechanism !== LINUX_ENTRY_SNAPSHOT_MECHANISM ||
    attestation?.sourceMode !==
      snapshotSourceMode.toString(8).padStart(4, "0") ||
    typeof attestation?.sourceFileMode !== "string" ||
    !/^[0-7]{4}$/.test(attestation.sourceFileMode) ||
    attestation?.targetMode !== snapshotContract.targetMode ||
    mount?.mountMode !== "ro-bind-data" ||
    mount?.mountPermissions !== snapshotContract.targetMode ||
    mount?.contentSnapshot !== attestation ||
    !before.isFile() ||
    Number(before.nlink) !== 0 ||
    (Number(before.mode) & 0o777) !== snapshotSourceMode ||
    String(before.dev) !== String(mount?.snapshotIdentity?.fileId?.dev) ||
    String(before.ino) !== String(mount?.snapshotIdentity?.fileId?.ino) ||
    Number(before.size) !== Number(attestation?.bytes) ||
    Number(before.size) !== Number(mount?.snapshotIdentity?.bytes) ||
    Number(before.mtimeMs) !== Number(mount?.snapshotIdentity?.mtimeMs)
  ) {
    throw new Error(`${errorPrefix}_identity_changed`);
  }
  const sha256 = hashLinuxOpenFile(runtime, mount.fd, Number(before.size));
  const after = runtime.fs.fstatSync(mount.fd);
  if (
    !linuxOpenStatMatches(before, after) ||
    sha256 !== attestation?.sha256 ||
    sha256 !== mount.snapshotIdentity.sha256
  ) {
    throw new Error(`${errorPrefix}_identity_changed`);
  }
}

function attestLinuxEntrySnapshot(runtime, mount, attestation, targetRuntime) {
  attestLinuxRegularFileSnapshot(
    runtime,
    mount,
    attestation,
    linuxEntrySnapshotContract(targetRuntime),
  );
}

function linuxIdentityExpectedStat(identity) {
  return {
    dev: identity?.fileId?.dev,
    ino: identity?.fileId?.ino,
    size: identity?.bytes,
    mtimeMs: identity?.mtimeMs,
  };
}

function applyLinuxMcpCapsuleCodeSnapshot(
  command,
  args,
  spawnOpts,
  sandboxOpts,
  runtime,
  base,
) {
  const contract = sandboxOpts.executionContract;
  const validation = validateLinuxPluginContract(
    command,
    args,
    spawnOpts,
    contract,
    runtime,
    sandboxOpts.sync,
  );
  const unavailable = (reason, runtimeProbe = null) =>
    createSandboxPlan({
      ...base,
      backend: null,
      candidateBackend: LINUX_MCP_CAPSULE_BACKEND,
      policyAttested: false,
      runtimeProbe: runtimeProbe
        ? {
            kind: "linux-mcp-capsule-code-snapshot-v1",
            attempted: runtimeProbe.attempted !== false,
            probeRuntime: "node",
            targetRuntime: "node",
            ...runtimeProbe,
          }
        : null,
      reason,
      guarantees: [],
    });
  if (
    contract?.kind !== MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND ||
    !validation.ok
  ) {
    return unavailable("linux_mcp_capsule_execution_contract_invalid", {
      attempted: false,
      runnable: false,
      reason: validation.reason,
      contentSnapshot: false,
      handleAtomic: false,
    });
  }

  const invocation = normalizeWrappedInvocation(
    command,
    args,
    spawnOpts,
    runtime.platform,
  );
  let runtimePin;
  let entryPin;
  let runtimeSnapshot;
  let entrySnapshot;
  try {
    runtimePin = pinLinuxRegularFile(
      runtime,
      contract.runtimeIdentity.realPath,
      contract.runtimeIdentity.realPath,
      linuxIdentityExpectedStat(contract.runtimeIdentity),
      { requireSingleLink: true },
    );
    entryPin = pinLinuxRegularFile(
      runtime,
      contract.entryIdentity.realPath,
      contract.entryIdentity.realPath,
      linuxIdentityExpectedStat(contract.entryIdentity),
      { requireSingleLink: true },
    );
    runtimeSnapshot = createLinuxRegularFileSnapshot(
      runtime,
      runtimePin,
      contract.runtimeIdentity,
      linuxMcpRuntimeSnapshotContract(),
    );
    entrySnapshot = createLinuxEntrySnapshot(
      runtime,
      entryPin,
      contract.entryIdentity,
      "node",
    );
    attestLinuxRegularFileSnapshot(
      runtime,
      runtimeSnapshot.finalMount,
      runtimeSnapshot.attestation,
      linuxMcpRuntimeSnapshotContract(),
    );
    attestLinuxEntrySnapshot(
      runtime,
      entrySnapshot.finalMount,
      entrySnapshot.attestation,
      "node",
    );
  } catch (error) {
    closeLinuxPinnedMounts(runtime, [
      runtimePin,
      entryPin,
      runtimeSnapshot?.probeMount,
      runtimeSnapshot?.finalMount,
      entrySnapshot?.probeMount,
      entrySnapshot?.finalMount,
    ]);
    return unavailable("linux_mcp_capsule_code_snapshot_unavailable", {
      runnable: false,
      reason: error.message || "snapshot_unattested",
      contentSnapshot: false,
      handleAtomic: false,
    });
  }

  closeLinuxPinnedMounts(runtime, [
    runtimePin,
    entryPin,
    runtimeSnapshot.probeMount,
    entrySnapshot.probeMount,
  ]);
  const descriptors = [runtimeSnapshot.finalMount, entrySnapshot.finalMount];
  const runtimeFd = 3;
  const snapshotIdentity = Object.freeze({
    runtimeSnapshotSha256: runtimeSnapshot.attestation.sha256,
    runtimeSnapshotBytes: runtimeSnapshot.attestation.bytes,
    entrySnapshotSha256: entrySnapshot.attestation.sha256,
    entrySnapshotBytes: entrySnapshot.attestation.bytes,
  });
  const nativeCodeEvidence = mcpStdioCapsuleNativeCodeEvidence(
    contract.nativeCodePolicy,
  );
  const policyDigest = sha256(
    JSON.stringify({
      version: 1,
      backend: LINUX_MCP_CAPSULE_BACKEND,
      contractKind: contract.kind,
      requiredBoundaries: [
        ...new Set(sandboxOpts.requiredBoundaries || []),
      ].sort(),
      identity: snapshotIdentity,
      cwd: invocation.options.cwd,
      entrySnapshotBootstrapSha256: MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
      runtimeLaunchMechanism: "inherited-executable-fd-v1",
      passthroughArgsDigest: sha256(JSON.stringify(invocation.args.slice(1))),
      nativeCodePolicyDigest: nativeCodeEvidence.nativeCodePolicyDigest,
    }),
  );
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    closeLinuxPinnedMounts(runtime, descriptors);
  };
  return createSandboxPlan({
    ...base,
    applied: true,
    enforcement: LINUX_MCP_CAPSULE_BACKEND,
    backend: LINUX_MCP_CAPSULE_BACKEND,
    candidateBackend: null,
    policyAttested: true,
    policyDigest,
    runtimeProbe: {
      kind: "linux-mcp-capsule-code-snapshot-v1",
      attempted: true,
      runnable: true,
      reason: null,
      probeRuntime: "node",
      targetRuntime: "node",
      contentSnapshot: true,
      contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
      contentSnapshotMechanism: LINUX_MCP_CAPSULE_SNAPSHOT_MECHANISM,
      handleAtomic: true,
      entrySnapshotAtomic: true,
      runtimeLaunchAtomic: true,
      runtimeLaunchMechanism: "inherited-executable-fd-v1",
      entrySnapshotBootstrapSha256: MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
      sharedLibraryClosure: false,
      ...nativeCodeEvidence,
      ...snapshotIdentity,
    },
    reason: null,
    guarantees: [
      SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
    ],
    command: `/proc/self/fd/${runtimeFd}`,
    args: [
      "-e",
      MCP_STDIO_FD_ENTRY_BOOTSTRAP,
      "--",
      ...invocation.args.slice(1),
    ],
    options: {
      ...invocation.options,
      shell: false,
      stdio: Object.freeze(
        linuxStdioWithPinnedMounts(invocation.options.stdio, descriptors),
      ),
    },
    cleanup,
  });
}

/**
 * Bind the synthetic plugin tree to the anonymous content snapshots mounted
 * for launch. Directory membership is fixed by pinLinuxPluginTree; contents
 * are copied and sealed per file, so the evidence deliberately remains
 * `atomic: false` rather than claiming one filesystem-wide transaction.
 */
function buildLinuxPluginTreeSnapshotAttestation(
  mounts,
  entryDestination,
  targetRuntime,
) {
  const native = targetRuntime?.startsWith("native-");
  const errorPrefix = native
    ? "native_plugin_tree_snapshot"
    : "node_plugin_tree_snapshot";
  const members = [];
  const destinations = new Set();
  for (const mount of mounts || []) {
    if (!linuxPathWithin("/opt/chainless/plugin", mount?.destination)) continue;
    if (
      path.posix.normalize(mount.destination) !== mount.destination ||
      destinations.has(mount.destination)
    ) {
      throw new Error(`${errorPrefix}_destination_invalid`);
    }
    destinations.add(mount.destination);
    const snapshot = mount.contentSnapshot;
    const entry = mount.destination === entryDestination;
    const expectedScope = entry
      ? native
        ? LINUX_NATIVE_ENTRY_SNAPSHOT_SCOPE
        : LINUX_NODE_ENTRY_SNAPSHOT_SCOPE
      : LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE;
    const sourceMode = Number.parseInt(snapshot?.sourceFileMode, 8);
    const expectedTargetMode = entry
      ? native
        ? LINUX_NATIVE_ENTRY_SNAPSHOT_TARGET_MODE
        : LINUX_NODE_ENTRY_SNAPSHOT_TARGET_MODE
      : linuxPluginTreeFileSnapshotContract(sourceMode, targetRuntime)
          .targetMode;
    if (
      snapshot?.scope !== expectedScope ||
      snapshot?.mechanism !== LINUX_ENTRY_SNAPSHOT_MECHANISM ||
      typeof snapshot?.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
      typeof snapshot?.sourceFileId !== "object" ||
      typeof snapshot.sourceFileId?.dev !== "string" ||
      !/^\d+$/.test(snapshot.sourceFileId.dev) ||
      typeof snapshot.sourceFileId?.ino !== "string" ||
      !/^\d+$/.test(snapshot.sourceFileId.ino) ||
      !Number.isFinite(snapshot?.sourceMtimeMs) ||
      !Number.isSafeInteger(snapshot?.bytes) ||
      snapshot.bytes < 0 ||
      snapshot.bytes > LINUX_ATTESTED_FILE_MAX_BYTES ||
      typeof snapshot?.sourceFileMode !== "string" ||
      !/^[0-7]{4}$/.test(snapshot.sourceFileMode) ||
      snapshot.sourceMode !==
        LINUX_ENTRY_SNAPSHOT_SOURCE_MODE.toString(8).padStart(4, "0") ||
      snapshot.targetMode !== expectedTargetMode ||
      mount.mountMode !== "ro-bind-data" ||
      mount.mountPermissions !== expectedTargetMode
    ) {
      throw new Error(`${errorPrefix}_member_invalid`);
    }
    members.push({
      destination: mount.destination,
      sourceFileId: snapshot.sourceFileId,
      sourceMtimeMs: snapshot.sourceMtimeMs,
      sourceFileMode: snapshot.sourceFileMode,
      sha256: snapshot.sha256,
      bytes: snapshot.bytes,
      sourceMode: snapshot.sourceMode,
      targetMode: snapshot.targetMode,
      scope: snapshot.scope,
      mechanism: snapshot.mechanism,
    });
  }
  members.sort((left, right) =>
    left.destination < right.destination
      ? -1
      : left.destination > right.destination
        ? 1
        : 0,
  );
  if (
    members.length < 1 ||
    members.length > LINUX_PLUGIN_TREE_SNAPSHOT_MAX_FILES ||
    !members.some((member) => member.destination === entryDestination)
  ) {
    throw new Error(`${errorPrefix}_file_count_invalid`);
  }
  const bytes = members.reduce((total, member) => total + member.bytes, 0);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes > LINUX_PLUGIN_TREE_SNAPSHOT_MAX_BYTES
  ) {
    throw new Error(`${errorPrefix}_bytes_exceeded`);
  }
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        scope: LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE,
        ...(native ? { targetRuntime } : {}),
        consistency: LINUX_PLUGIN_TREE_SNAPSHOT_CONSISTENCY,
        members,
      }),
    )
    .digest("hex");
  return Object.freeze({
    scope: LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE,
    mechanism: LINUX_ENTRY_SNAPSHOT_MECHANISM,
    files: members.length,
    bytes,
    digest,
    consistency: LINUX_PLUGIN_TREE_SNAPSHOT_CONSISTENCY,
    contractBound: false,
    atomic: false,
  });
}

function attestLinuxPluginTreeSnapshot(
  runtime,
  mounts,
  entryDestination,
  targetRuntime,
  expected,
) {
  const native = targetRuntime?.startsWith("native-");
  const errorPrefix = native
    ? "native_plugin_tree_snapshot"
    : "node_plugin_tree_snapshot";
  for (const mount of mounts || []) {
    if (!linuxPathWithin("/opt/chainless/plugin", mount?.destination)) continue;
    const snapshot = mount.contentSnapshot;
    const contract =
      mount.destination === entryDestination
        ? linuxEntrySnapshotContract(targetRuntime)
        : linuxPluginTreeFileSnapshotContract(
            Number.parseInt(snapshot?.sourceFileMode, 8),
            targetRuntime,
          );
    attestLinuxRegularFileSnapshot(runtime, mount, snapshot, contract);
  }
  const actual = buildLinuxPluginTreeSnapshotAttestation(
    mounts,
    entryDestination,
    targetRuntime,
  );
  for (const field of [
    "scope",
    "mechanism",
    "files",
    "bytes",
    "digest",
    "consistency",
    "contractBound",
    "atomic",
  ]) {
    if (actual[field] !== expected?.[field]) {
      throw new Error(`${errorPrefix}_identity_changed`);
    }
  }
}

function validLinuxRuntimePageSize(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < LINUX_MIN_RUNTIME_PAGE_BYTES ||
    value > LINUX_MAX_RUNTIME_PAGE_BYTES
  ) {
    return false;
  }
  const size = BigInt(value);
  return (size & (size - 1n)) === 0n;
}

function readLinuxPageSizeFromAuxv(runtimeFs) {
  // AT_PAGESZ is emitted by the kernel for this exact process and matches the
  // page granularity used by the ELF loader. Avoid filesystem block sizes or
  // an external getconf binary, neither of which is the loader contract.
  const raw = runtimeFs.readFileSync("/proc/self/auxv");
  const auxv = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (
    auxv.length < LINUX_AUXV_ENTRY_BYTES ||
    auxv.length > LINUX_AUXV_MAX_BYTES ||
    auxv.length % LINUX_AUXV_ENTRY_BYTES !== 0
  ) {
    throw new Error("linux_runtime_auxv_invalid");
  }
  let pageSize = null;
  let terminated = false;
  for (let offset = 0; offset < auxv.length; offset += LINUX_AUXV_ENTRY_BYTES) {
    const tag = auxv.readBigUInt64LE(offset);
    const value = auxv.readBigUInt64LE(offset + 8);
    if (tag === 0n) {
      terminated = true;
      break;
    }
    if (tag !== LINUX_AUXV_PAGE_SIZE) continue;
    if (pageSize !== null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("linux_runtime_page_size_ambiguous");
    }
    pageSize = Number(value);
  }
  if (!terminated || !validLinuxRuntimePageSize(pageSize)) {
    throw new Error("linux_runtime_page_size_unattested");
  }
  return pageSize;
}

function linuxElfRuntimePageSize(runtime) {
  const pageSize =
    typeof runtime.linuxPageSize === "function"
      ? runtime.linuxPageSize()
      : readLinuxPageSizeFromAuxv(runtime.fs);
  if (!validLinuxRuntimePageSize(pageSize)) {
    throw new Error("linux_runtime_page_size_unattested");
  }
  return BigInt(pageSize);
}

function linuxElfAlignDown(value, alignment) {
  return value - (value % alignment);
}

function linuxElfAlignUp(value, alignment) {
  const remainder = value % alignment;
  return remainder === 0n ? value : value + alignment - remainder;
}

function attestLinuxElfLoadMappings(loadSegments, pageSize) {
  // Linux maps later PT_LOAD entries with MAP_FIXED. Even disjoint byte ranges
  // can therefore replace one another after the loader rounds them to pages.
  // A conservative no-overlap contract keeps our file-offset parser and the
  // in-memory dynamic-loader view identical.
  const ranges = [];
  for (const load of loadSegments) {
    if (
      load.fileOffset % pageSize !== load.virtualAddress % pageSize ||
      (load.alignment > 1n &&
        ((load.alignment & (load.alignment - 1n)) !== 0n ||
          load.fileOffset % load.alignment !==
            load.virtualAddress % load.alignment))
    ) {
      throw new Error("native_entry_load_segment_alignment_invalid");
    }
    if (
      load.virtualAddress > LINUX_ELF_MAX_UINT64 - load.memorySize ||
      load.virtualAddress + load.memorySize >
        LINUX_ELF_MAX_UINT64 - (pageSize - 1n)
    ) {
      throw new Error("native_entry_load_segment_virtual_range_overflow");
    }
    if (load.memorySize === 0n) continue;
    ranges.push({
      start: linuxElfAlignDown(load.virtualAddress, pageSize),
      end: linuxElfAlignUp(load.virtualAddress + load.memorySize, pageSize),
    });
  }
  ranges.sort((left, right) =>
    left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
  );
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new Error("native_entry_load_segment_page_overlap");
    }
  }
}

function linuxElfVirtualRangeFileMappings(loadSegments, address, bytes) {
  return loadSegments
    .filter((load) => {
      if (address < load.virtualAddress) return false;
      const delta = address - load.virtualAddress;
      return (
        delta <= load.fileSize &&
        bytes <= load.fileSize - delta &&
        delta <= load.memorySize &&
        bytes <= load.memorySize - delta
      );
    })
    .map((load) => ({
      load,
      fileOffset: load.fileOffset + (address - load.virtualAddress),
    }));
}

function readLinuxElfString(table, offset, label) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= table.length) {
    throw new Error(`native_entry_${label}_string_out_of_bounds`);
  }
  const end = table.indexOf(0, offset);
  if (end < 0) {
    throw new Error(`native_entry_${label}_string_unterminated`);
  }
  const bytes = table.subarray(offset, end);
  if (bytes.length < 1 || bytes.some((value) => value < 0x21 || value > 0x7e)) {
    throw new Error(`native_entry_${label}_string_invalid`);
  }
  return bytes.toString("ascii");
}

function linuxSystemDynamicPath(value) {
  return (
    typeof value === "string" &&
    path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.includes("\0") &&
    ["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some((prefix) =>
      value.startsWith(prefix),
    )
  );
}

/**
 * Classify one already-pinned plugin entry without invoking it or passing it
 * to a host inspection utility. Besides conventional fully static ET_EXEC and
 * static-PIE-shaped ET_DYN images, the parser can describe a narrow dynamic
 * executable. The caller must separately prove that its PT_INTERP and every
 * recursively reachable startup DT_NEEDED member resolve through a pinned,
 * attested system-file graph.
 */
function inspectLinuxNativeElf(runtime, fd, identity, { role = "entry" } = {}) {
  const dependencyObject = role === "dependency";
  if (!dependencyObject && role !== "entry") {
    throw new Error("native_elf_inspection_role_invalid");
  }
  const expectedMachine = LINUX_ELF_MACHINES[runtime.arch];
  if (!expectedMachine) {
    throw new Error(`unsupported_elf_architecture:${String(runtime.arch)}`);
  }
  const runtimePageSize = linuxElfRuntimePageSize(runtime);
  const before = runtime.fs.fstatSync(fd);
  if (
    !before.isFile() ||
    (dependencyObject
      ? Number(before.nlink) < 1 ||
        Number(before.uid) !== 0 ||
        (Number(before.mode) & 0o022) !== 0
      : Number(before.nlink) !== 1 || (Number(before.mode) & 0o111) === 0) ||
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
  const elfType = header.readUInt16LE(16);
  if (elfType !== LINUX_ELF_TYPE_EXEC && elfType !== LINUX_ELF_TYPE_DYN) {
    throw new Error("native_entry_unsupported_elf_type");
  }
  if (dependencyObject && elfType !== LINUX_ELF_TYPE_DYN) {
    throw new Error("native_dependency_not_shared_object");
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
  const loadSegments = [];
  const dynamicSegments = [];
  const interpreterSegments = [];
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
    const alignment = program.readBigUInt64LE(48);
    if (fileOffset > fileBytes || fileSize > fileBytes - fileOffset) {
      throw new Error("native_entry_segment_out_of_bounds");
    }
    if (type === LINUX_ELF_PROGRAM_LOAD && fileSize > memorySize) {
      throw new Error("native_entry_segment_out_of_bounds");
    }
    if (type === LINUX_ELF_PROGRAM_INTERP) {
      interpreterSegments.push({
        flags,
        fileOffset,
        fileSize,
        memorySize,
      });
    }
    if (type === LINUX_ELF_PROGRAM_DYNAMIC) {
      dynamicSegments.push({
        flags,
        fileOffset,
        virtualAddress,
        fileSize,
        memorySize,
        alignment,
      });
    }
    if (type === LINUX_ELF_PROGRAM_GNU_STACK) {
      if ((flags & 0x1) !== 0) {
        throw new Error("native_entry_executable_stack_unsupported");
      }
      nonExecutableStack = true;
    }
    if (type === LINUX_ELF_PROGRAM_LOAD) {
      loadSegments.push({
        flags,
        fileOffset,
        virtualAddress,
        fileSize,
        memorySize,
        alignment,
      });
    }
    if (type === LINUX_ELF_PROGRAM_LOAD && (flags & 0x1) !== 0) {
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
  attestLinuxElfLoadMappings(loadSegments, runtimePageSize);
  if (!executableLoad || (!dependencyObject && !entryInExecutableLoad)) {
    throw new Error("native_entry_has_no_executable_entry_segment");
  }
  if (!nonExecutableStack) {
    throw new Error("native_entry_nonexecutable_stack_unattested");
  }

  if (interpreterSegments.length > 1) {
    throw new Error("native_entry_interpreter_ambiguous");
  }
  // A shared object can itself be directly executable: Ubuntu 24.04's
  // libc.so.6, for example, carries PT_INTERP. The dynamic loader ignores
  // that segment when it maps the object as a dependency, so rejecting it
  // would exclude a legitimate recursive startup graph. Still parse and
  // validate the segment below; only an entry object's interpreter becomes
  // part of the kernel-exec contract and returned closure evidence.
  let interpreter = null;
  if (interpreterSegments.length === 1) {
    const segment = interpreterSegments[0];
    if (
      (segment.flags & 0x3) !== 0 ||
      segment.fileSize < 2n ||
      segment.fileSize > BigInt(LINUX_ELF_MAX_INTERPRETER_BYTES) ||
      segment.fileSize > segment.memorySize
    ) {
      throw new Error("native_entry_interpreter_invalid");
    }
    const contents = readLinuxFdExactly(
      runtime,
      fd,
      Number(segment.fileSize),
      Number(segment.fileOffset),
    );
    if (
      contents[contents.length - 1] !== 0 ||
      contents.indexOf(0) !== contents.length - 1
    ) {
      throw new Error("native_entry_interpreter_unterminated");
    }
    interpreter = readLinuxElfString(contents, 0, "interpreter");
    if (!linuxSystemDynamicPath(interpreter)) {
      throw new Error("native_entry_interpreter_outside_system_roots");
    }
  }

  const staticPie =
    !dependencyObject && elfType === LINUX_ELF_TYPE_DYN && interpreter === null;
  const dynamicExecutable = !dependencyObject && interpreter !== null;
  let dynamicMetadata = null;
  if (
    !dependencyObject &&
    elfType === LINUX_ELF_TYPE_EXEC &&
    !dynamicExecutable
  ) {
    if (dynamicSegments.length > 0) {
      throw new Error("native_entry_dynamic_elf_unsupported");
    }
  } else {
    const prefix = dependencyObject
      ? "native_dependency_dynamic"
      : staticPie
        ? "native_entry_static_pie"
        : "native_entry_dynamic";
    if (dynamicSegments.length === 0) {
      throw new Error(`${prefix}_dynamic_segment_missing`);
    }
    if (dynamicSegments.length !== 1) {
      throw new Error(`${prefix}_dynamic_segment_ambiguous`);
    }
    const dynamic = dynamicSegments[0];
    if ((dynamic.flags & 0x1) !== 0) {
      throw new Error(`${prefix}_dynamic_segment_executable`);
    }
    if (
      dynamic.fileSize < BigInt(LINUX_ELF64_DYNAMIC_ENTRY_BYTES) ||
      dynamic.fileSize % BigInt(LINUX_ELF64_DYNAMIC_ENTRY_BYTES) !== 0n ||
      dynamic.fileSize > dynamic.memorySize
    ) {
      throw new Error(`${prefix}_dynamic_segment_invalid`);
    }
    const dynamicEntries =
      dynamic.fileSize / BigInt(LINUX_ELF64_DYNAMIC_ENTRY_BYTES);
    if (
      dynamicEntries < 1n ||
      dynamicEntries > BigInt(LINUX_ELF_MAX_DYNAMIC_ENTRIES)
    ) {
      throw new Error(`${prefix}_dynamic_table_too_large`);
    }
    const containingLoads = loadSegments.filter((load) => {
      if (
        dynamic.fileOffset < load.fileOffset ||
        dynamic.virtualAddress < load.virtualAddress
      ) {
        return false;
      }
      const fileDelta = dynamic.fileOffset - load.fileOffset;
      const memoryDelta = dynamic.virtualAddress - load.virtualAddress;
      return (
        fileDelta === memoryDelta &&
        fileDelta <= load.fileSize &&
        dynamic.fileSize <= load.fileSize - fileDelta &&
        memoryDelta <= load.memorySize &&
        dynamic.memorySize <= load.memorySize - memoryDelta
      );
    });
    if (containingLoads.length === 0) {
      throw new Error(`${prefix}_dynamic_segment_unmapped`);
    }
    if (containingLoads.length !== 1) {
      throw new Error(`${prefix}_dynamic_segment_mapping_ambiguous`);
    }
    const dynamicLoaderMappings = linuxElfVirtualRangeFileMappings(
      loadSegments,
      dynamic.virtualAddress,
      dynamic.fileSize,
    );
    if (
      dynamicLoaderMappings.length !== 1 ||
      dynamicLoaderMappings[0].fileOffset !== dynamic.fileOffset
    ) {
      throw new Error(`${prefix}_dynamic_segment_loader_view_mismatch`);
    }

    const dynamicTable = readLinuxFdExactly(
      runtime,
      fd,
      Number(dynamic.fileSize),
      Number(dynamic.fileOffset),
    );
    const neededOffsets = [];
    let sonameOffset = null;
    const forbiddenDependencyTags = new Set([
      LINUX_ELF_DYNAMIC_RPATH,
      LINUX_ELF_DYNAMIC_RUNPATH,
      LINUX_ELF_DYNAMIC_CONFIG,
      LINUX_ELF_DYNAMIC_DEPAUDIT,
      LINUX_ELF_DYNAMIC_AUDIT,
      LINUX_ELF_DYNAMIC_AUXILIARY,
      LINUX_ELF_DYNAMIC_FILTER,
    ]);
    let terminated = false;
    let flags = null;
    let flags1 = null;
    let stringTableAddress = null;
    let stringTableBytes = null;
    for (
      let offset = 0;
      offset < dynamicTable.length;
      offset += LINUX_ELF64_DYNAMIC_ENTRY_BYTES
    ) {
      const tag = dynamicTable.readBigUInt64LE(offset);
      const value = dynamicTable.readBigUInt64LE(offset + 8);
      if (tag === LINUX_ELF_DYNAMIC_NULL) {
        terminated = true;
        break;
      }
      if (
        tag === LINUX_ELF_DYNAMIC_TEXTREL ||
        forbiddenDependencyTags.has(tag)
      ) {
        throw new Error(`${prefix}_loader_directive_unsupported`);
      }
      if (tag === LINUX_ELF_DYNAMIC_NEEDED) {
        neededOffsets.push(value);
        if (neededOffsets.length > LINUX_ELF_MAX_NEEDED_ENTRIES) {
          throw new Error(`${prefix}_dependency_count_exceeded`);
        }
      } else if (tag === LINUX_ELF_DYNAMIC_SONAME) {
        if (sonameOffset !== null) {
          throw new Error(`${prefix}_soname_ambiguous`);
        }
        sonameOffset = value;
      } else if (tag === LINUX_ELF_DYNAMIC_STRTAB) {
        if (stringTableAddress !== null) {
          throw new Error(`${prefix}_string_table_ambiguous`);
        }
        stringTableAddress = value;
      } else if (tag === LINUX_ELF_DYNAMIC_STRSZ) {
        if (stringTableBytes !== null) {
          throw new Error(`${prefix}_string_table_ambiguous`);
        }
        stringTableBytes = value;
      } else if (tag === LINUX_ELF_DYNAMIC_FLAGS) {
        if (flags !== null) {
          throw new Error(`${prefix}_flags_ambiguous`);
        }
        flags = value;
      } else if (tag === LINUX_ELF_DYNAMIC_FLAGS_1) {
        if (flags1 !== null) {
          throw new Error(`${prefix}_flags_ambiguous`);
        }
        flags1 = value;
      }
    }
    if (!terminated) {
      throw new Error(`${prefix}_dynamic_table_unterminated`);
    }
    if (flags !== null && (flags & LINUX_ELF_DYNAMIC_FLAG_TEXTREL) !== 0n) {
      throw new Error(`${prefix}_text_relocation_unsupported`);
    }
    if (
      !dependencyObject &&
      elfType === LINUX_ELF_TYPE_DYN &&
      (flags1 === null || (flags1 & LINUX_ELF_DYNAMIC_FLAG_PIE) === 0n)
    ) {
      throw new Error(`${prefix}_flag_missing`);
    }
    if (!dependencyObject && staticPie && neededOffsets.length > 0) {
      throw new Error("native_entry_static_pie_dependency_unsupported");
    }

    let needed = [];
    let soname = null;
    if (neededOffsets.length > 0 || sonameOffset !== null) {
      if (
        stringTableAddress === null ||
        stringTableBytes === null ||
        stringTableBytes < 1n ||
        stringTableBytes > BigInt(LINUX_ELF_MAX_STRING_TABLE_BYTES)
      ) {
        throw new Error(`${prefix}_string_table_invalid`);
      }
      const stringTableMappings = linuxElfVirtualRangeFileMappings(
        loadSegments,
        stringTableAddress,
        stringTableBytes,
      );
      if (stringTableMappings.length === 0) {
        throw new Error(`${prefix}_string_table_unmapped`);
      }
      if (stringTableMappings.length !== 1) {
        throw new Error(`${prefix}_string_table_mapping_ambiguous`);
      }
      const stringTableOffset = stringTableMappings[0].fileOffset;
      if (stringTableOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${prefix}_string_table_unmapped`);
      }
      const stringTable = readLinuxFdExactly(
        runtime,
        fd,
        Number(stringTableBytes),
        Number(stringTableOffset),
      );
      needed = neededOffsets.map((offset) => {
        if (offset > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error(`${prefix}_dependency_string_out_of_bounds`);
        }
        const name = readLinuxElfString(
          stringTable,
          Number(offset),
          "dynamic_dependency",
        );
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(name) ||
          path.posix.basename(name) !== name
        ) {
          throw new Error("native_entry_dynamic_dependency_name_invalid");
        }
        return name;
      });
      if (new Set(needed).size !== needed.length) {
        throw new Error("native_entry_dynamic_dependency_ambiguous");
      }
      if (sonameOffset !== null) {
        if (sonameOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error(`${prefix}_soname_string_out_of_bounds`);
        }
        soname = readLinuxElfString(
          stringTable,
          Number(sonameOffset),
          "dynamic_soname",
        );
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(soname) ||
          path.posix.basename(soname) !== soname
        ) {
          throw new Error(`${prefix}_soname_invalid`);
        }
      }
    }

    if (dynamicExecutable || dependencyObject) {
      dynamicMetadata = Object.freeze({
        ...(dynamicExecutable ? { interpreter } : {}),
        needed: Object.freeze(needed),
        soname,
      });
    }
  }

  const sha256 = hashLinuxOpenFile(runtime, fd, Number(before.size));
  const after = runtime.fs.fstatSync(fd);
  if (
    !linuxOpenStatMatches(before, after) ||
    (identity.sha256 !== undefined && sha256 !== identity.sha256)
  ) {
    throw new Error("native_entry_changed_during_elf_attestation");
  }
  return Object.freeze({
    runtime: dependencyObject
      ? "native-shared-object"
      : dynamicExecutable
        ? "native-dynamic-elf"
        : "native-static-elf",
    format: dependencyObject
      ? "elf64-shared-object-et-dyn"
      : dynamicExecutable
        ? elfType === LINUX_ELF_TYPE_DYN
          ? "elf64-dynamic-pie-et-dyn"
          : "elf64-dynamic-et-exec"
        : elfType === LINUX_ELF_TYPE_DYN
          ? "elf64-static-pie-shaped-et-dyn"
          : "elf64-static-et-exec",
    architecture: runtime.arch,
    machine: expectedMachine,
    loaderPageBytes: Number(runtimePageSize),
    programHeaders: programHeaderCount,
    sha256,
    ...(dynamicMetadata || {}),
  });
}

function inspectLinuxNativePath(runtime, identity) {
  let fd;
  try {
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(identity.realPath, flags);
    return inspectLinuxNativeElf(runtime, fd, identity);
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
  const closed = new Set();
  for (const mount of mounts || []) {
    for (const field of ["fd", "scrubberFd"]) {
      if (!Number.isInteger(mount?.[field])) continue;
      const fd = mount[field];
      // Clear ownership before close so repeated cleanup cannot close an
      // unrelated descriptor if the OS has already reused this number.
      mount[field] = null;
      if (closed.has(fd)) continue;
      closed.add(fd);
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // Best effort. The process is already fail-closed if a pin cannot be
        // created; cleanup must not replace the original boundary error.
      }
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

function buildLinuxNetworkSeccompFilter(
  arch,
  { runtimePathnameClosure = false } = {},
) {
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
    // No socket family is needed by this direct one-shot Plugin bin route,
    // whether the Broker call is synchronous or asynchronously supervised.
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
  );
  if (runtimePathnameClosure) {
    // clone3 receives a pointer to struct clone_args, which classic seccomp BPF
    // cannot safely dereference. Make the syscall unavailable so glibc can
    // fall back to classic clone for ordinary threads; the classic call below
    // rejects only namespace-producing flags.
    instructions.push(
      [0x15, 0, 1, architecture.clone3Syscall],
      [0x06, 0, 0, 0x00050026],
    );
    for (const syscall of [
      // recvmsg(2) and recvmmsg(2) are the two receive APIs capable of
      // importing SCM_RIGHTS descriptors. recvfrom/read cannot receive
      // ancillary descriptors, and sendmsg does not import one.
      architecture.recvmsgSyscall,
      architecture.recvmmsgSyscall,
      architecture.pidfdGetfdSyscall,
      architecture.openByHandleAtSyscall,
      // A read-only outer namespace is not a closure if the target can create
      // or join another namespace and mount writable bytes over a visible path.
      architecture.unshareSyscall,
      architecture.setnsSyscall,
      architecture.mountSyscall,
      architecture.umount2Syscall,
      architecture.pivotRootSyscall,
      architecture.openTreeSyscall,
      architecture.moveMountSyscall,
      architecture.fsopenSyscall,
      architecture.fsconfigSyscall,
      architecture.fsmountSyscall,
      architecture.fspickSyscall,
      architecture.mountSetattrSyscall,
    ]) {
      instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050001]);
    }
    instructions.push(
      // seccomp_data.args[0] starts at byte 16. All supported ABIs are
      // little-endian, so loading this word inspects the low classic-clone
      // flags. Preserve fork/pthread clone calls while rejecting NEWUSER/NEWNS.
      [0x15, 0, 5, architecture.cloneSyscall],
      [0x20, 0, 0, 16],
      [0x54, 0, 0, LINUX_NAMESPACE_CLONE_FLAGS],
      [0x15, 1, 0, 0],
      [0x06, 0, 0, 0x00050001],
      [0x06, 0, 0, 0x7fff0000],
    );
  }
  instructions.push([0x06, 0, 0, 0x7fff0000]);
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

function pinLinuxNetworkSeccompFilter(runtime, options = {}) {
  const filter = buildLinuxNetworkSeccompFilter(runtime.arch, options);
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
      policy: options.runtimePathnameClosure
        ? "deny-network-creation-loader-fd-acquisition-and-namespace-mutation"
        : "deny-network-creation",
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

function linuxBubblewrapSupervisorStatValid(
  stat,
  { allowUnlinked = false } = {},
) {
  const linkCount = Number(stat?.nlink);
  return (
    stat?.isFile?.() === true &&
    Number(stat.uid) === 0 &&
    (linkCount === 1 || (allowUnlinked && linkCount === 0)) &&
    Number(stat.size) > 0 &&
    Number(stat.size) <= LINUX_ATTESTED_FILE_MAX_BYTES &&
    (Number(stat.mode) & 0o111) !== 0 &&
    (Number(stat.mode) & 0o022) === 0
  );
}

function linuxBubblewrapPinnedStatMatches(expected, current) {
  return (
    linuxBubblewrapSupervisorStatValid(current, { allowUnlinked: true }) &&
    String(expected.dev) === String(current.dev) &&
    String(expected.ino) === String(current.ino) &&
    Number(expected.size) === Number(current.size) &&
    Number(expected.mtimeMs) === Number(current.mtimeMs) &&
    Number(expected.mode) === Number(current.mode) &&
    Number(expected.uid) === Number(current.uid) &&
    Number(expected.gid) === Number(current.gid)
  );
}

function pinLinuxBubblewrapSupervisor(runtime) {
  let fd;
  try {
    for (const method of [
      "openSync",
      "readSync",
      "fstatSync",
      "statSync",
      "lstatSync",
      "closeSync",
    ]) {
      if (typeof runtime.fs?.[method] !== "function") {
        throw new Error(`supervisor_${method}_unavailable`);
      }
    }
    if (linuxRealpath(runtime, LINUX_BWRAP_PATH) !== LINUX_BWRAP_PATH) {
      throw new Error("supervisor_realpath_changed");
    }
    const pathBefore = runtime.fs.lstatSync(LINUX_BWRAP_PATH, {
      bigint: true,
    });
    if (
      pathBefore.isSymbolicLink?.() === true ||
      !linuxBubblewrapSupervisorStatValid(pathBefore)
    ) {
      throw new Error("supervisor_path_unattested");
    }
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(LINUX_BWRAP_PATH, flags);
    const openedBefore = runtime.fs.fstatSync(fd, { bigint: true });
    const currentPath = runtime.fs.statSync(LINUX_BWRAP_PATH, {
      bigint: true,
    });
    if (
      !linuxBubblewrapSupervisorStatValid(openedBefore) ||
      !linuxOpenStatMatches(pathBefore, openedBefore) ||
      !linuxOpenStatMatches(openedBefore, currentPath)
    ) {
      throw new Error("supervisor_identity_changed");
    }
    const sha256 = hashLinuxOpenFile(runtime, fd, Number(openedBefore.size));
    const openedAfter = runtime.fs.fstatSync(fd, { bigint: true });
    const pathAfter = runtime.fs.statSync(LINUX_BWRAP_PATH, {
      bigint: true,
    });
    if (
      !linuxOpenStatMatches(openedBefore, openedAfter) ||
      !linuxOpenStatMatches(openedAfter, pathAfter)
    ) {
      throw new Error("supervisor_identity_changed");
    }
    const attestation = Object.freeze({
      path: LINUX_BWRAP_PATH,
      fileId: Object.freeze({
        dev: String(openedAfter.dev),
        ino: String(openedAfter.ino),
      }),
      sha256,
      bytes: Number(openedAfter.size),
      mtimeMs: Number(openedAfter.mtimeMs),
      mode: Number(openedAfter.mode),
      uid: Number(openedAfter.uid),
      gid: Number(openedAfter.gid),
      mechanism: LINUX_BWRAP_SUPERVISOR_BINDING_MECHANISM,
      scope: "host-path-replacement",
      childFd: LINUX_BWRAP_SUPERVISOR_CHILD_FD,
      consumeOperation: "file-copy-close",
      consumePath: LINUX_BWRAP_SUPERVISOR_HIDDEN_PATH,
      consumeMode: "0000",
      obscuredBy: "tmpfs:/run",
      pid1ExecutableExposure: "procfs",
    });
    return {
      fd,
      openedStat: openedAfter,
      attestation,
    };
  } catch (error) {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // Preserve the original attestation error.
      }
    }
    throw error;
  }
}

function pinLinuxBubblewrapDescriptorScrubber(runtime) {
  let fd;
  try {
    for (const method of [
      "openSync",
      "readSync",
      "fstatSync",
      "statSync",
      "lstatSync",
      "closeSync",
    ]) {
      if (typeof runtime.fs?.[method] !== "function") {
        throw new Error(`descriptor_scrubber_${method}_unavailable`);
      }
    }
    if (
      linuxRealpath(runtime, LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH) !==
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH
    ) {
      throw new Error("descriptor_scrubber_realpath_changed");
    }
    const pathBefore = runtime.fs.lstatSync(
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
      { bigint: true },
    );
    if (
      pathBefore.isSymbolicLink?.() === true ||
      !linuxBubblewrapSupervisorStatValid(pathBefore)
    ) {
      throw new Error("descriptor_scrubber_path_unattested");
    }
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH, flags);
    const openedBefore = runtime.fs.fstatSync(fd, { bigint: true });
    const currentPath = runtime.fs.statSync(
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
      { bigint: true },
    );
    if (
      !linuxBubblewrapSupervisorStatValid(openedBefore) ||
      !linuxOpenStatMatches(pathBefore, openedBefore) ||
      !linuxOpenStatMatches(openedBefore, currentPath)
    ) {
      throw new Error("descriptor_scrubber_identity_changed");
    }
    const sha256 = hashLinuxOpenFile(runtime, fd, Number(openedBefore.size));
    const openedAfter = runtime.fs.fstatSync(fd, { bigint: true });
    const pathAfter = runtime.fs.statSync(
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
      { bigint: true },
    );
    if (
      !linuxOpenStatMatches(openedBefore, openedAfter) ||
      !linuxOpenStatMatches(openedAfter, pathAfter)
    ) {
      throw new Error("descriptor_scrubber_identity_changed");
    }
    return {
      fd,
      openedStat: openedAfter,
      attestation: Object.freeze({
        path: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
        fileId: Object.freeze({
          dev: String(openedAfter.dev),
          ino: String(openedAfter.ino),
        }),
        sha256,
        bytes: Number(openedAfter.size),
        mtimeMs: Number(openedAfter.mtimeMs),
        mode: Number(openedAfter.mode),
        uid: Number(openedAfter.uid),
        gid: Number(openedAfter.gid),
      }),
    };
  } catch (error) {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // Preserve the original attestation error.
      }
    }
    throw error;
  }
}

function openLinuxBubblewrapPinnedExecutableReader(runtime, pin, label) {
  let fd;
  try {
    if (!Number.isInteger(pin?.fd) || !pin.openedStat || !pin.attestation) {
      throw new Error(`${label}_pin_missing`);
    }
    const constants = runtime.fs.constants || fs.constants;
    const flags =
      Number(constants.O_RDONLY) | Number(constants.O_NONBLOCK || 0);
    fd = runtime.fs.openSync(`/proc/self/fd/${pin.fd}`, flags);
    const openedBefore = runtime.fs.fstatSync(fd, { bigint: true });
    if (!linuxBubblewrapPinnedStatMatches(pin.openedStat, openedBefore)) {
      throw new Error(`${label}_launch_reader_identity_changed`);
    }
    const sha256 = hashLinuxOpenFile(runtime, fd, pin.attestation.bytes);
    const openedAfter = runtime.fs.fstatSync(fd, { bigint: true });
    if (
      !linuxOpenStatMatches(openedBefore, openedAfter) ||
      sha256 !== pin.attestation.sha256
    ) {
      throw new Error(`${label}_launch_reader_identity_changed`);
    }
    return fd;
  } catch (error) {
    if (fd !== undefined) {
      try {
        runtime.fs.closeSync(fd);
      } catch {
        // Preserve the original launch-reader error.
      }
    }
    throw error;
  }
}

function openLinuxBubblewrapSupervisorLaunch(
  runtime,
  supervisorPin,
  descriptorScrubberPin,
) {
  let fd;
  let scrubberFd;
  try {
    fd = openLinuxBubblewrapPinnedExecutableReader(
      runtime,
      supervisorPin,
      "supervisor",
    );
    scrubberFd = openLinuxBubblewrapPinnedExecutableReader(
      runtime,
      descriptorScrubberPin,
      "descriptor_scrubber",
    );
    return { fd, scrubberFd };
  } catch (error) {
    closeLinuxPinnedMounts(runtime, [{ fd }, { fd: scrubberFd }]);
    throw error;
  }
}

function attestLinuxBubblewrapSupervisorPin(
  runtime,
  supervisorPin,
  label = "supervisor",
) {
  if (
    !Number.isInteger(supervisorPin?.fd) ||
    !supervisorPin.openedStat ||
    !supervisorPin.attestation
  ) {
    throw new Error(`${label}_pin_missing`);
  }
  const before = runtime.fs.fstatSync(supervisorPin.fd, { bigint: true });
  if (!linuxBubblewrapPinnedStatMatches(supervisorPin.openedStat, before)) {
    throw new Error(`${label}_identity_changed`);
  }
  const sha256 = hashLinuxOpenFile(
    runtime,
    supervisorPin.fd,
    supervisorPin.attestation.bytes,
  );
  const after = runtime.fs.fstatSync(supervisorPin.fd, { bigint: true });
  if (
    !linuxOpenStatMatches(before, after) ||
    sha256 !== supervisorPin.attestation.sha256
  ) {
    throw new Error(`${label}_identity_changed`);
  }
}

function linuxBubblewrapScrubbedInvocation(
  supervisorLaunch,
  executableArgs,
  stdio,
) {
  const scrubberChildFd = stdio.length - 1;
  let explicitLayout = true;
  const parentFds = new Set();
  for (
    let index = LINUX_BWRAP_SUPERVISOR_CHILD_FD;
    index <= scrubberChildFd;
    index += 1
  ) {
    const parentFd = stdio[index];
    if (
      !Object.hasOwn(stdio, index) ||
      !Number.isSafeInteger(parentFd) ||
      parentFd < 0 ||
      parentFds.has(parentFd)
    ) {
      explicitLayout = false;
      break;
    }
    parentFds.add(parentFd);
  }
  if (
    !Number.isInteger(supervisorLaunch?.fd) ||
    !Number.isInteger(supervisorLaunch?.scrubberFd) ||
    stdio.length < 5 ||
    stdio[LINUX_BWRAP_SUPERVISOR_CHILD_FD] !== supervisorLaunch.fd ||
    stdio[scrubberChildFd] !== supervisorLaunch.scrubberFd ||
    !explicitLayout
  ) {
    throw new Error("descriptor_scrubber_launch_layout_invalid");
  }
  return buildLinuxBwrapDescriptorScrubbedLaunch({
    scrubberChildFd,
    preservedMaxFd: scrubberChildFd - 1,
    executableChildFd: LINUX_BWRAP_SUPERVISOR_CHILD_FD,
    executableArgs,
  });
}

function attestLinuxBubblewrapCapabilities(runtime, supervisorLaunch) {
  let result;
  try {
    const stdio = [
      "ignore",
      "pipe",
      "pipe",
      supervisorLaunch.fd,
      supervisorLaunch.scrubberFd,
    ];
    const invocation = linuxBubblewrapScrubbedInvocation(
      supervisorLaunch,
      ["--help"],
      stdio,
    );
    result = runtime.spawnSync(invocation.command, invocation.args, {
      shell: false,
      encoding: "utf8",
      stdio,
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
  const supportedOptions = new Set(help.split(/\s+/).filter(Boolean));
  const requiredOptions = [
    "--file",
    "--perms",
    "--ro-bind-fd",
    "--ro-bind-data",
    "--disable-userns",
    "--assert-userns-disabled",
    "--seccomp",
  ];
  for (const option of requiredOptions) {
    if (!supportedOptions.has(option)) {
      return {
        ok: false,
        reason: `required_option_missing:${option.slice(2)}`,
      };
    }
  }
  return { ok: true, reason: null };
}

function parseLinuxLddResolution(output) {
  const byDestination = new Map();
  const byLoaderName = new Map();
  const byBasename = new Map();
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.includes("=> not found")) {
      throw new Error("runtime_dependency_missing");
    }
    if (/^linux-vdso(?:\.so(?:\.\d+)?)?\s+\(/.test(line)) continue;
    const resolved = line.match(
      /^([A-Za-z0-9][A-Za-z0-9._+-]{0,254})\s+=>\s+(\/[^\s(]+)\s+\(/,
    );
    const direct = line.match(/^(\/[^\s(]+)\s+\(/);
    if (!resolved && !direct) {
      throw new Error("runtime_dependency_resolution_output_invalid");
    }
    const loaderName = resolved?.[1] || path.posix.basename(direct[1]);
    const destination = resolved?.[2] || direct[1];
    if (path.posix.normalize(destination) !== destination) {
      throw new Error("runtime_dependency_outside_system_library_roots");
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(loaderName) ||
      path.posix.basename(destination) !== loaderName
    ) {
      throw new Error("runtime_dependency_resolution_alias_unsupported");
    }
    const priorLoaderDestination = byLoaderName.get(loaderName);
    if (
      priorLoaderDestination !== undefined &&
      priorLoaderDestination !== destination
    ) {
      throw new Error("runtime_dependency_resolution_ambiguous");
    }
    const basename = path.posix.basename(destination);
    const priorBasenameDestination = byBasename.get(basename);
    if (
      priorBasenameDestination !== undefined &&
      priorBasenameDestination !== destination
    ) {
      throw new Error("runtime_dependency_resolution_ambiguous");
    }
    byLoaderName.set(loaderName, destination);
    byBasename.set(basename, destination);
    const existing = byDestination.get(destination) || new Set();
    existing.add(loaderName);
    byDestination.set(destination, existing);
  }
  if (byDestination.size === 0) {
    throw new Error("runtime_dependency_resolution_empty");
  }
  return [...byDestination.entries()]
    .map(([destination, loaderNames]) => ({
      destination,
      loaderNames: [...loaderNames].sort(),
    }))
    .sort((left, right) => left.destination.localeCompare(right.destination));
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
      loaderNames: [],
    },
  ];
  for (const { destination, loaderNames } of parseLinuxLddResolution(
    result.stdout,
  )) {
    if (
      path.posix.normalize(destination) !== destination ||
      !["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some((prefix) =>
        destination.startsWith(prefix),
      )
    ) {
      throw new Error("runtime_dependency_outside_system_library_roots");
    }
    const source = attestLinuxRootOwnedFile(runtime, destination);
    if (!source) {
      throw new Error("runtime_dependency_unattested");
    }
    mounts.push({ source, destination, loaderNames });
  }
  if (runtime.fs.existsSync("/etc/ld.so.cache")) {
    const source = attestLinuxRootOwnedFile(runtime, "/etc/ld.so.cache");
    if (!source) {
      throw new Error("loader_cache_unattested");
    }
    mounts.push({
      source,
      destination: "/etc/ld.so.cache",
      loaderNames: [],
    });
  }
  const byDestination = new Map();
  for (const mount of mounts) {
    const existing = byDestination.get(mount.destination);
    if (existing && existing.source !== mount.source) {
      throw new Error("runtime_mount_collision");
    }
    if (existing) {
      existing.loaderNames = [
        ...new Set([
          ...(existing.loaderNames || []),
          ...(mount.loaderNames || []),
        ]),
      ].sort();
    } else {
      byDestination.set(mount.destination, mount);
    }
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
      mounts.push({
        ...pinLinuxRegularFile(
          runtime,
          mount.source,
          mount.destination,
          expected,
        ),
        loaderNames: Object.freeze([...(mount.loaderNames || [])]),
      });
    }
    return mounts;
  } catch (error) {
    closeLinuxPinnedMounts(runtime, mounts);
    throw error;
  }
}

// Bind the kernel-selected interpreter and recursively parse every DT_NEEDED
// edge reachable from the entry through the exact root-owned descriptors that
// will be mounted into the sandbox. This proves only the loader's initial ELF
// graph. It deliberately does not claim runtime dlopen closure; writable
// scratch mounts and executable-created code remain outside this evidence.
function bindLinuxNativeDynamicRuntime(
  runtime,
  entryFormat,
  pinnedRuntimeMounts,
) {
  if (entryFormat?.runtime !== "native-dynamic-elf") return null;
  if (
    !linuxSystemDynamicPath(entryFormat.interpreter) ||
    !Array.isArray(entryFormat.needed) ||
    entryFormat.needed.length > LINUX_ELF_MAX_NEEDED_ENTRIES ||
    entryFormat.soname !== null
  ) {
    throw new Error("native_dynamic_metadata_invalid");
  }
  const systemMounts = (pinnedRuntimeMounts || []).filter(
    (mount) =>
      linuxSystemDynamicPath(mount?.destination) &&
      Number.isInteger(mount?.fd) &&
      typeof mount?.fileId?.dev === "string" &&
      typeof mount?.fileId?.ino === "string" &&
      Number.isSafeInteger(mount?.bytes) &&
      mount.bytes > 0 &&
      Number.isFinite(mount?.mtimeMs) &&
      Array.isArray(mount?.loaderNames) &&
      mount.loaderNames.every(
        (name) =>
          typeof name === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(name),
      ),
  );
  const resolveDependency = (dependency, { direct = false } = {}) => {
    if (
      typeof dependency !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/.test(dependency) ||
      path.posix.basename(dependency) !== dependency
    ) {
      throw new Error("native_dynamic_dependency_name_invalid");
    }
    const matches = systemMounts.filter(
      (mount) =>
        path.posix.basename(mount.destination) === dependency &&
        mount.loaderNames.includes(dependency),
    );
    if (matches.length === 0) {
      throw new Error(
        direct
          ? "native_dynamic_dependency_outside_direct_system_set"
          : "native_dynamic_recursive_dependency_outside_system_graph",
      );
    }
    if (matches.length !== 1) {
      throw new Error(
        direct
          ? "native_dynamic_dependency_runtime_ambiguous"
          : "native_dynamic_recursive_dependency_runtime_ambiguous",
      );
    }
    return matches[0];
  };
  const interpreterMount = systemMounts.find(
    (mount) => mount.destination === entryFormat.interpreter,
  );
  if (!interpreterMount) {
    throw new Error("native_dynamic_interpreter_outside_direct_system_set");
  }
  const selected = new Map();
  const pending = [];
  let selectedBytes = 0;
  const select = (mount) => {
    if (selected.has(mount.destination)) return;
    if (selected.size >= LINUX_ELF_MAX_INITIAL_CLOSURE_FILES) {
      throw new Error("native_dynamic_recursive_file_count_exceeded");
    }
    if (
      !Number.isSafeInteger(mount.bytes) ||
      mount.bytes <= 0 ||
      selectedBytes > LINUX_ELF_MAX_INITIAL_CLOSURE_BYTES - mount.bytes
    ) {
      throw new Error("native_dynamic_recursive_bytes_exceeded");
    }
    selectedBytes += mount.bytes;
    selected.set(mount.destination, mount);
    pending.push(mount);
  };
  select(interpreterMount);
  const edges = [];
  for (const dependency of entryFormat.needed) {
    const target = resolveDependency(dependency, { direct: true });
    edges.push({ from: "$entry", name: dependency, to: target.destination });
    select(target);
  }
  const parsed = new Map();
  for (let index = 0; index < pending.length; index += 1) {
    const mount = pending[index];
    const metadata = inspectLinuxNativeElf(runtime, mount.fd, mount, {
      role: "dependency",
    });
    if (
      metadata.soname !== null &&
      (metadata.soname !== path.posix.basename(mount.destination) ||
        !mount.loaderNames.includes(metadata.soname))
    ) {
      throw new Error("native_dependency_soname_alias_unsupported");
    }
    parsed.set(mount.destination, metadata);
    for (const dependency of metadata.needed || []) {
      if (edges.length >= LINUX_ELF_MAX_INITIAL_CLOSURE_EDGES) {
        throw new Error("native_dynamic_recursive_edge_count_exceeded");
      }
      const target = resolveDependency(dependency);
      edges.push({
        from: mount.destination,
        name: dependency,
        to: target.destination,
      });
      select(target);
    }
  }
  const members = [...selected.values()]
    .map((mount) => {
      const metadata = parsed.get(mount.destination);
      if (!metadata) {
        throw new Error("native_dynamic_recursive_member_unparsed");
      }
      return {
        destination: mount.destination,
        fileId: {
          dev: mount.fileId.dev,
          ino: mount.fileId.ino,
        },
        bytes: mount.bytes,
        mtimeMs: mount.mtimeMs,
        sha256: metadata.sha256,
        loaderNames: [...mount.loaderNames],
        needed: [...(metadata.needed || [])].sort(),
        soname: metadata.soname,
      };
    })
    .sort((left, right) => left.destination.localeCompare(right.destination));
  const orderedEdges = edges.sort((left, right) =>
    `${left.from}\0${left.name}\0${left.to}`.localeCompare(
      `${right.from}\0${right.name}\0${right.to}`,
    ),
  );
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        scope: LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_SCOPE,
        mechanism: LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_MECHANISM,
        interpreter: entryFormat.interpreter,
        directNeeded: [...entryFormat.needed].sort(),
        members,
        edges: orderedEdges,
      }),
    )
    .digest("hex");
  return Object.freeze({
    scope: LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_SCOPE,
    mechanism: LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_MECHANISM,
    interpreter: entryFormat.interpreter,
    dependencies: orderedEdges.length,
    files: members.length,
    bytes: selectedBytes,
    digest,
  });
}

/**
 * Hash every regular file that will remain pathname-visible to a dynamic
 * native target. The final namespace is built only from these descriptor
 * mounts and a read-only synthetic root, so this set is the complete input to
 * the kernel ELF loader and libc dlopen pathname resolution. Anonymous
 * executable memory and a malicious program's own ELF loader are intentionally
 * outside this narrower, enforceable claim.
 */
function buildLinuxRuntimePathnameLoadSet(
  runtime,
  pinnedMounts,
  pluginTreeSnapshot,
  nativeDynamicClosure,
) {
  if (
    nativeDynamicClosure?.scope !==
      LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_SCOPE ||
    nativeDynamicClosure?.mechanism !==
      LINUX_NATIVE_DYNAMIC_RECURSIVE_SYSTEM_GRAPH_MECHANISM ||
    pluginTreeSnapshot?.scope !== LINUX_PLUGIN_TREE_SNAPSHOT_SCOPE ||
    !Array.isArray(pinnedMounts) ||
    pinnedMounts.length < 1 ||
    pinnedMounts.length > LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_FILES
  ) {
    throw new Error("native_runtime_pathname_load_set_invalid");
  }
  const destinations = new Set();
  let totalBytes = 0;
  const members = pinnedMounts.map((mount) => {
    const destination = mount?.destination;
    const pluginFile =
      typeof destination === "string" &&
      linuxPathWithin("/opt/chainless/plugin", destination);
    const runtimeFile = destination === "/opt/chainless/runtime/node";
    const systemLibrary = linuxSystemDynamicPath(destination);
    const loaderCache = destination === "/etc/ld.so.cache";
    if (
      typeof destination !== "string" ||
      !path.posix.isAbsolute(destination) ||
      path.posix.normalize(destination) !== destination ||
      destinations.has(destination) ||
      (!pluginFile && !runtimeFile && !systemLibrary && !loaderCache) ||
      !Number.isInteger(mount?.fd)
    ) {
      throw new Error("native_runtime_pathname_load_set_member_invalid");
    }
    destinations.add(destination);
    const before = runtime.fs.fstatSync(mount.fd);
    const bytes = Number(before.size);
    if (
      !before.isFile() ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > LINUX_ATTESTED_FILE_MAX_BYTES ||
      String(before.dev) !== String(mount.fileId?.dev) ||
      String(before.ino) !== String(mount.fileId?.ino) ||
      bytes !== Number(mount.bytes) ||
      Number(before.mtimeMs) !== Number(mount.mtimeMs) ||
      totalBytes > LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MAX_BYTES - bytes
    ) {
      throw new Error("native_runtime_pathname_load_set_member_changed");
    }
    const sha256 = hashLinuxOpenFile(runtime, mount.fd, bytes);
    const after = runtime.fs.fstatSync(mount.fd);
    if (
      !linuxOpenStatMatches(before, after) ||
      ((pluginFile || runtimeFile) &&
        (mount.contentSnapshot?.mechanism !== LINUX_ENTRY_SNAPSHOT_MECHANISM ||
          mount.contentSnapshot?.sha256 !== sha256 ||
          (runtimeFile &&
            mount.contentSnapshot?.scope !==
              LINUX_PLUGIN_RUNTIME_SNAPSHOT_SCOPE)))
    ) {
      throw new Error("native_runtime_pathname_load_set_member_changed");
    }
    totalBytes += bytes;
    return {
      destination,
      sourceKind: pluginFile
        ? "plugin-content-snapshot"
        : runtimeFile
          ? "broker-node-runtime"
          : systemLibrary
            ? "root-owned-system-library"
            : "root-owned-loader-cache",
      fileId: {
        dev: String(after.dev),
        ino: String(after.ino),
      },
      sha256,
      bytes,
      mtimeMs: Number(after.mtimeMs),
      mountMode:
        mount.mountMode === "ro-bind-data" ? "ro-bind-data" : "ro-bind-fd",
    };
  });
  members.sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
  const loaderCacheVisible = members.some(
    ({ sourceKind }) => sourceKind === "root-owned-loader-cache",
  );
  if (
    totalBytes < 1 ||
    !members.some(
      ({ sourceKind }) => sourceKind === "plugin-content-snapshot",
    ) ||
    !members.some(({ sourceKind }) => sourceKind === "broker-node-runtime") ||
    loaderCacheVisible !== runtime.fs.existsSync("/etc/ld.so.cache")
  ) {
    throw new Error("native_runtime_pathname_load_set_incomplete");
  }
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        scope: LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_SCOPE,
        mechanism: LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MECHANISM,
        initialDynamicLoadClosureDigest: nativeDynamicClosure.digest,
        pluginTreeContentSnapshotDigest: pluginTreeSnapshot.digest,
        members,
      }),
    )
    .digest("hex");
  return Object.freeze({
    scope: LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_SCOPE,
    mechanism: LINUX_NATIVE_RUNTIME_PATHNAME_CLOSURE_MECHANISM,
    files: members.length,
    bytes: totalBytes,
    digest,
    policyBound: true,
    writableFilesystems: false,
    procfsMounted: false,
    devfsMounted: false,
    scratchWritable: false,
    descriptorReopenPaths: false,
  });
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
  { runtimePathnameClosure = false } = {},
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
  // FD 3 is also the descriptor-backed executable used to start bubblewrap.
  // Consume and close it during setup, then obscure this staging copy with the
  // later /run tmpfs. The ordinary profile can still observe bubblewrap itself
  // as the PID-namespace supervisor through procfs. The dynamic-native runtime
  // closure profile does not mount procfs at all.
  args.push(
    "--perms",
    "0000",
    "--file",
    String(LINUX_BWRAP_SUPERVISOR_CHILD_FD),
    LINUX_BWRAP_SUPERVISOR_HIDDEN_PATH,
  );
  for (const mount of pinnedMounts) {
    if (mount.mountMode === "ro-bind-data") {
      args.push(
        "--perms",
        mount.mountPermissions,
        "--ro-bind-data",
        String(mount.childFd),
        mount.destination,
      );
    } else {
      args.push("--ro-bind-fd", String(mount.childFd), mount.destination);
    }
  }
  args.push("--seccomp", String(seccompFilter.childFd), "--remount-ro", "/");
  if (runtimePathnameClosure) {
    // bubblewrap creates its root tmpfs with MS_NOSUID|MS_NODEV, not NOEXEC.
    // Keeping any writable tmpfs would therefore let an untrusted native write
    // a new .so and dlopen it. Only an empty /run overlay is retained to hide
    // the consumed supervisor staging copy, and it is remounted read-only
    // before the target starts. /tmp, /var/tmp, HOME, procfs, and devfs remain
    // empty directories on the read-only synthetic root.
    args.push(
      "--perms",
      "0755",
      "--size",
      String(16 * 1024 * 1024),
      "--tmpfs",
      "/run",
      "--remount-ro",
      "/run",
    );
  } else {
    args.push(
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
  }
  for (const key of Object.keys(environment).sort()) {
    args.push("--setenv", key, environment[key]);
  }
  args.push("--chdir", "/opt/chainless/plugin");
  return args;
}

function probeLinuxBubblewrapPolicy(
  runtime,
  supervisorLaunch,
  supervisorBinding,
  policyArgs,
  pinnedDescriptors,
  targetRuntime,
  contentSnapshot = null,
) {
  const supervisorIdentity = JSON.stringify({
    dev: supervisorBinding.fileId.dev,
    ino: supervisorBinding.fileId.ino,
    bytes: supervisorBinding.bytes,
  });
  const childProbeSource = [
    'const fs = require("node:fs");',
    "const sentinel = process.argv[1];",
    'const raw = fs.readFileSync("/proc/self/stat", "utf8");',
    'const close = raw.lastIndexOf(")");',
    'const pid = Number(raw.slice(0, raw.indexOf(" ")));',
    "const fields = raw.slice(close + 2).trim().split(/\\s+/);",
    "const processGroupPid = Number(fields[2]);",
    "const sessionPid = Number(fields[3]);",
    "fs.writeSync(1, JSON.stringify({ sentinel, pid, processGroupPid, sessionPid }));",
    "if (processGroupPid !== pid || sessionPid !== pid) process.exit(2);",
  ].join("\n");
  const probeSource = [
    'const fs = require("node:fs");',
    'const crypto = require("node:crypto");',
    'const { spawnSync } = require("node:child_process");',
    `const expected = ${supervisorIdentity};`,
    'for (const name of fs.readdirSync("/proc/self/fd")) {',
    "  let current;",
    "  try { current = fs.fstatSync(Number(name), { bigint: true }); } catch { continue; }",
    "  if (String(current.dev) === expected.dev &&",
    "      String(current.ino) === expected.ino &&",
    "      Number(current.size) === expected.bytes) {",
    '    throw new Error("bubblewrap supervisor descriptor leaked");',
    "  }",
    "}",
    "try {",
    `  fs.lstatSync(${JSON.stringify(LINUX_BWRAP_SUPERVISOR_HIDDEN_PATH)});`,
    '  throw new Error("bubblewrap supervisor staging path visible");',
    "} catch (error) {",
    '  if (error?.code !== "ENOENT") throw error;',
    "}",
    "// /tmp is a fresh private bwrap tmpfs; read the same O_EXCL inode by fd.",
    'const childReportPath = "/tmp/.chainless-runtime-child-probe.json";',
    `const expectedChildSentinel = ${JSON.stringify(
      `${LINUX_BWRAP_CHILD_RUNTIME_PROBE_SENTINEL}:`,
    )} + crypto.randomBytes(16).toString("hex");`,
    "let reportFd;",
    "let runtimeDetachedChildSpawnVerified = false;",
    "try {",
    '  reportFd = fs.openSync(childReportPath, "wx+", 0o600);',
    `  const child = spawnSync("/opt/chainless/runtime/node", ["-e", ${JSON.stringify(
      childProbeSource,
    )}, expectedChildSentinel], {`,
    '    cwd: "/",',
    "    detached: true,",
    "    env: process.env,",
    "    shell: false,",
    '    stdio: ["ignore", reportFd, "ignore"],',
    "    timeout: 5_000,",
    "  });",
    "  const reportStat = fs.fstatSync(reportFd);",
    "  const reportBytes = Number(reportStat.size);",
    "  if (!child.error && child.status === 0 && child.signal === null &&",
    "      Number.isSafeInteger(child.pid) && child.pid > 0 &&",
    "      reportStat.isFile() && Number.isSafeInteger(reportBytes) &&",
    "      reportBytes > 0 && reportBytes <= 1_024) {",
    "    const reportBuffer = Buffer.alloc(reportBytes);",
    "    const reportRead = fs.readSync(reportFd, reportBuffer, 0, reportBytes, 0);",
    "    if (reportRead === reportBytes) {",
    '      const reportText = reportBuffer.toString("utf8");',
    "      const report = JSON.parse(reportText);",
    "      const canonicalReport = JSON.stringify({ sentinel: report.sentinel,",
    "        pid: report.pid, processGroupPid: report.processGroupPid,",
    "        sessionPid: report.sessionPid });",
    "      runtimeDetachedChildSpawnVerified = reportText === canonicalReport &&",
    "        report.sentinel === expectedChildSentinel &&",
    "        Number.isSafeInteger(report.pid) && report.pid > 0 &&",
    "        report.pid === child.pid && report.processGroupPid === report.pid &&",
    "        report.sessionPid === report.pid;",
    "    }",
    "  }",
    "} catch {} finally {",
    "  try { if (Number.isInteger(reportFd)) fs.closeSync(reportFd); } catch {",
    "    runtimeDetachedChildSpawnVerified = false;",
    "  }",
    "  try { fs.unlinkSync(childReportPath); } catch {",
    "    runtimeDetachedChildSpawnVerified = false;",
    "  }",
    "}",
    `if (!runtimeDetachedChildSpawnVerified) process.exit(${LINUX_BWRAP_CHILD_RUNTIME_PROBE_FAILURE_STATUS});`,
    `process.stdout.write(${JSON.stringify(LINUX_BWRAP_NODE_PROBE_SENTINEL)});`,
  ].join("\n");
  let result;
  try {
    // These pipes connect the host Broker to bwrap and are created before
    // bwrap installs the target seccomp filter. The nested runtime probe above
    // inherits a regular-file descriptor and never requests UV_CREATE_PIPE.
    const stdio = linuxStdioWithPinnedMounts(null, pinnedDescriptors, {
      probe: true,
      supervisorFd: supervisorLaunch.fd,
      scrubberFd: supervisorLaunch.scrubberFd,
    });
    const invocation = linuxBubblewrapScrubbedInvocation(
      supervisorLaunch,
      [...policyArgs, "--", "/opt/chainless/runtime/node", "-e", probeSource],
      stdio,
    );
    result = runtime.spawnSync(invocation.command, invocation.args, {
      cwd: "/",
      shell: false,
      encoding: "utf8",
      stdio,
      timeout: 15_000,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
  } catch {
    return linuxBubblewrapProbe(
      true,
      false,
      "probe_spawn_failed",
      targetRuntime,
      contentSnapshot,
      supervisorBinding,
    );
  }
  if (result?.error || result?.status !== 0) {
    return linuxBubblewrapProbe(
      true,
      false,
      result?.error
        ? "probe_spawn_failed"
        : result?.status === LINUX_BWRAP_CHILD_RUNTIME_PROBE_FAILURE_STATUS
          ? "detached_child_runtime_probe_failed"
          : "probe_failed",
      targetRuntime,
      contentSnapshot,
      supervisorBinding,
    );
  }
  if (String(result.stdout) !== LINUX_BWRAP_NODE_PROBE_SENTINEL) {
    return linuxBubblewrapProbe(
      true,
      false,
      "node_runtime_probe_failed",
      targetRuntime,
      contentSnapshot,
      supervisorBinding,
    );
  }
  return linuxBubblewrapProbe(
    true,
    true,
    null,
    targetRuntime,
    contentSnapshot,
    supervisorBinding,
    null,
    null,
    null,
    true,
  );
}

function probeLinuxRuntimePathnameClosurePolicy(
  runtime,
  supervisorLaunch,
  supervisorBinding,
  policyArgs,
  pinnedDescriptors,
  targetRuntime,
  contentSnapshot = null,
) {
  const probeSource = [
    'const fs = require("node:fs");',
    `const sentinel = ${JSON.stringify(
      LINUX_BWRAP_NATIVE_RUNTIME_CLOSURE_PROBE_SENTINEL,
    )};`,
    "const writableCandidates = [",
    '  "/unapproved-runtime.so", "/tmp/unapproved-runtime.so",',
    '  "/run/unapproved-runtime.so", "/var/tmp/unapproved-runtime.so",',
    '  "/home/sandbox/unapproved-runtime.so",',
    '  "/opt/chainless/plugin/unapproved-runtime.so",',
    "];",
    "for (const candidate of writableCandidates) {",
    "  try {",
    '    fs.writeFileSync(candidate, "not-approved");',
    "    process.exit(71);",
    "  } catch {}",
    "}",
    "const absentPaths = [",
    '  "/proc/self/exe", "/proc/1/exe", "/proc/self/fd/0",',
    '  "/dev/null", "/dev/fd/0",',
    `  ${JSON.stringify(LINUX_BWRAP_SUPERVISOR_HIDDEN_PATH)},`,
    "];",
    "for (const candidate of absentPaths) {",
    "  try {",
    "    fs.lstatSync(candidate);",
    "    process.exit(72);",
    "  } catch (error) {",
    '    if (error?.code !== "ENOENT") process.exit(73);',
    "  }",
    "}",
    'if (fs.readdirSync("/proc").length !== 0) process.exit(74);',
    'if (fs.readdirSync("/dev").length !== 0) process.exit(75);',
    "process.stdout.write(sentinel);",
  ].join("\n");
  let result;
  try {
    const stdio = linuxStdioWithPinnedMounts(null, pinnedDescriptors, {
      probe: true,
      supervisorFd: supervisorLaunch.fd,
      scrubberFd: supervisorLaunch.scrubberFd,
    });
    const invocation = linuxBubblewrapScrubbedInvocation(
      supervisorLaunch,
      [...policyArgs, "--", "/opt/chainless/runtime/node", "-e", probeSource],
      stdio,
    );
    result = runtime.spawnSync(invocation.command, invocation.args, {
      cwd: "/",
      shell: false,
      encoding: "utf8",
      stdio,
      timeout: 15_000,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
  } catch {
    return linuxBubblewrapProbe(
      true,
      false,
      "runtime_pathname_closure_probe_spawn_failed",
      targetRuntime,
      contentSnapshot,
      supervisorBinding,
    );
  }
  const runnable =
    !result?.error &&
    result?.status === 0 &&
    String(result.stdout) === LINUX_BWRAP_NATIVE_RUNTIME_CLOSURE_PROBE_SENTINEL;
  return linuxBubblewrapProbe(
    true,
    runnable,
    runnable ? null : "runtime_pathname_closure_probe_failed",
    targetRuntime,
    contentSnapshot,
    supervisorBinding,
  );
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
    args: invocation.inputArgs,
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
      boundary === SANDBOX_BOUNDARIES.NETWORK ||
      boundary === SANDBOX_BOUNDARIES.PROCESS_TREE,
  );

  if (
    requiredBoundaries.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) &&
    !requiresStrongLinuxBoundary
  ) {
    return applyLinuxMcpCapsuleCodeSnapshot(
      command,
      args,
      spawnOpts,
      sandboxOpts,
      runtime,
      base,
    );
  }

  if (requiresStrongLinuxBoundary) {
    if (isLinuxGenericWorkspaceContract(sandboxOpts.executionContract)) {
      return applyLinuxGenericWorkspaceSandbox(
        command,
        args,
        spawnOpts,
        sandboxOpts,
        runtime,
      );
    }
    const requestedEntryRuntime =
      sandboxOpts.executionContract?.kind ===
      "strict-plugin-native-static-elf-bin"
        ? "native-static-elf"
        : sandboxOpts.executionContract?.kind === "strict-plugin-native-elf-bin"
          ? "native-unclassified"
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
    let nativeDynamicClosure = null;
    try {
      nativeDynamicClosure = bindLinuxNativeDynamicRuntime(
        runtime,
        validation.entryFormat,
        pinnedRuntimeMounts,
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
          error.message || "native_dynamic_recursive_system_graph_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_native_runtime_unattested",
        guarantees: [],
      });
    }

    let pinnedMounts = [];
    let pluginTree;
    let entryFormat = null;
    let entryMount;
    const entryRelative = path.posix.relative(
      validation.contract.pluginRoot,
      validation.contract.entryIdentity.realPath,
    );
    const sandboxEntry = path.posix.join(
      "/opt/chainless/plugin",
      entryRelative,
    );
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
      if (validation.entryRuntime.startsWith("native-")) {
        entryFormat = inspectLinuxNativeElf(
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

    let entrySnapshot = null;
    let runtimeFileSnapshot = null;
    let pluginTreeSnapshot = null;
    const pluginTreeFileSnapshots = [];
    let probePinnedMounts = pinnedMounts;
    try {
      const entryIndex = pinnedMounts.indexOf(entryMount);
      if (entryIndex < 0) {
        throw new Error("plugin_entry_pin_missing");
      }
      const pluginMountIndexes = pinnedMounts
        .map((mount, index) =>
          linuxPathWithin("/opt/chainless/plugin", mount.destination)
            ? index
            : -1,
        )
        .filter((index) => index >= 0);
      const rawPluginMounts = pluginMountIndexes.map(
        (index) => pinnedMounts[index],
      );
      const pluginSnapshotErrorPrefix = validation.entryRuntime.startsWith(
        "native-",
      )
        ? "native_plugin_tree_snapshot"
        : "node_plugin_tree_snapshot";
      if (
        pluginMountIndexes.length < 1 ||
        pluginMountIndexes.length > LINUX_PLUGIN_TREE_SNAPSHOT_MAX_FILES
      ) {
        throw new Error(`${pluginSnapshotErrorPrefix}_file_count_invalid`);
      }
      const pluginBytes = pluginMountIndexes.reduce((total, index) => {
        const bytes = pinnedMounts[index]?.bytes;
        if (
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          bytes > LINUX_ATTESTED_FILE_MAX_BYTES
        ) {
          throw new Error(`${pluginSnapshotErrorPrefix}_member_size_invalid`);
        }
        return total + bytes;
      }, 0);
      if (
        !Number.isSafeInteger(pluginBytes) ||
        pluginBytes > LINUX_PLUGIN_TREE_SNAPSHOT_MAX_BYTES
      ) {
        throw new Error(`${pluginSnapshotErrorPrefix}_bytes_exceeded`);
      }
      const rawEntryMount = entryMount;
      const snapshot = createLinuxEntrySnapshot(
        runtime,
        rawEntryMount,
        validation.contract.entryIdentity,
        validation.entryRuntime,
      );
      const finalMounts = [...pinnedMounts];
      const probeMounts = [...pinnedMounts];
      finalMounts[entryIndex] = snapshot.finalMount;
      probeMounts[entryIndex] = snapshot.probeMount;
      entrySnapshot = snapshot;
      for (const index of pluginMountIndexes) {
        if (index === entryIndex) continue;
        const rawMount = pinnedMounts[index];
        const source = runtime.fs.fstatSync(rawMount.fd);
        const fileSnapshot = createLinuxRegularFileSnapshot(
          runtime,
          rawMount,
          {
            fileId: rawMount.fileId,
            bytes: rawMount.bytes,
            mtimeMs: rawMount.mtimeMs,
          },
          linuxPluginTreeFileSnapshotContract(
            Number(source.mode),
            validation.entryRuntime,
          ),
        );
        pluginTreeFileSnapshots.push(fileSnapshot);
        finalMounts[index] = fileSnapshot.finalMount;
        probeMounts[index] = fileSnapshot.probeMount;
      }
      let rawRuntimeMount = null;
      if (validation.entryRuntime === "native-dynamic-elf") {
        const runtimeIndex = pinnedMounts.findIndex(
          (mount) => mount.destination === "/opt/chainless/runtime/node",
        );
        if (runtimeIndex < 0) {
          throw new Error("native_runtime_snapshot_mount_missing");
        }
        rawRuntimeMount = pinnedMounts[runtimeIndex];
        runtimeFileSnapshot = createLinuxRegularFileSnapshot(
          runtime,
          rawRuntimeMount,
          validation.contract.runtimeIdentity,
          linuxPluginRuntimeSnapshotContract(),
        );
        finalMounts[runtimeIndex] = runtimeFileSnapshot.finalMount;
        probeMounts[runtimeIndex] = runtimeFileSnapshot.probeMount;
      }
      pluginTreeSnapshot = buildLinuxPluginTreeSnapshotAttestation(
        finalMounts,
        sandboxEntry,
        validation.entryRuntime,
      );
      pinnedMounts = finalMounts;
      probePinnedMounts = probeMounts;
      entryMount = entrySnapshot.finalMount;
      closeLinuxPinnedMounts(runtime, [...rawPluginMounts, rawRuntimeMount]);
    } catch (error) {
      closeLinuxPinnedMounts(runtime, pinnedMounts);
      closeLinuxPinnedMounts(runtime, [
        entrySnapshot?.probeMount,
        entrySnapshot?.finalMount,
        runtimeFileSnapshot?.probeMount,
        runtimeFileSnapshot?.finalMount,
        ...pluginTreeFileSnapshots.flatMap((snapshot) => [
          snapshot.probeMount,
          snapshot.finalMount,
        ]),
      ]);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          error.message || "entry_snapshot_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_plugin_snapshot_unattested",
        guarantees: [],
      });
    }

    let runtimePathnameLoadSet = null;
    if (validation.entryRuntime === "native-dynamic-elf") {
      try {
        runtimePathnameLoadSet = buildLinuxRuntimePathnameLoadSet(
          runtime,
          pinnedMounts,
          pluginTreeSnapshot,
          nativeDynamicClosure,
        );
      } catch (error) {
        closeLinuxPinnedMounts(runtime, pinnedMounts);
        closeLinuxPinnedMounts(runtime, [
          entrySnapshot?.probeMount,
          runtimeFileSnapshot?.probeMount,
          ...pluginTreeFileSnapshots.map((snapshot) => snapshot.probeMount),
        ]);
        return createSandboxPlan({
          ...base,
          backend: null,
          candidateBackend: LINUX_BWRAP_BACKEND,
          policyAttested: false,
          runtimeProbe: linuxBubblewrapProbe(
            false,
            false,
            error.message || "native_runtime_pathname_load_set_unattested",
            validation.entryRuntime,
          ),
          reason: "linux_bwrap_native_runtime_load_set_unattested",
          guarantees: [],
        });
      }
    }

    let probeSeccompFilter;
    let seccompFilter;
    const pluginTreeProbeMounts = pluginTreeFileSnapshots.map(
      (snapshot) => snapshot.probeMount,
    );
    try {
      const runtimePathnameClosure =
        validation.entryRuntime === "native-dynamic-elf";
      probeSeccompFilter = pinLinuxNetworkSeccompFilter(runtime, {
        runtimePathnameClosure,
      });
      seccompFilter = pinLinuxNetworkSeccompFilter(runtime, {
        runtimePathnameClosure,
      });
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
        [
          entrySnapshot?.probeMount,
          runtimeFileSnapshot?.probeMount,
          ...pluginTreeProbeMounts,
          probeSeccompFilter,
          seccompFilter,
        ].filter(Boolean),
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
    const probeDescriptors = [...probePinnedMounts, probeSeccompFilter];
    let descriptorScrubberPin;
    const closeStrongLinuxResources = (...extra) => {
      closeLinuxPinnedMounts(runtime, [
        ...pinnedDescriptors,
        probeSeccompFilter,
        entrySnapshot?.probeMount,
        runtimeFileSnapshot?.probeMount,
        ...pluginTreeProbeMounts,
        descriptorScrubberPin,
        ...extra,
      ]);
    };
    let supervisorPin;
    let capabilityLaunch;
    let probeLaunch;
    let finalLaunch;
    try {
      supervisorPin = pinLinuxBubblewrapSupervisor(runtime);
      descriptorScrubberPin = pinLinuxBubblewrapDescriptorScrubber(runtime);
      capabilityLaunch = openLinuxBubblewrapSupervisorLaunch(
        runtime,
        supervisorPin,
        descriptorScrubberPin,
      );
    } catch (error) {
      closeStrongLinuxResources(supervisorPin);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          false,
          false,
          error.message || "supervisor_descriptor_unattested",
          validation.entryRuntime,
        ),
        reason: "linux_bwrap_unavailable",
        guarantees: [],
      });
    }
    const capabilities = attestLinuxBubblewrapCapabilities(
      runtime,
      capabilityLaunch,
    );
    closeLinuxPinnedMounts(runtime, [capabilityLaunch]);
    capabilityLaunch = null;
    if (!capabilities.ok) {
      closeStrongLinuxResources(supervisorPin);
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
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_unavailable",
        guarantees: [],
      });
    }
    try {
      probeLaunch = openLinuxBubblewrapSupervisorLaunch(
        runtime,
        supervisorPin,
        descriptorScrubberPin,
      );
    } catch (error) {
      closeStrongLinuxResources(supervisorPin, probeLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          error.message || "supervisor_launch_reader_unattested",
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_unavailable",
        guarantees: [],
      });
    }
    const environment = linuxSandboxEnvironment();
    const runtimePathnameClosure =
      validation.entryRuntime === "native-dynamic-elf" &&
      runtimePathnameLoadSet !== null;
    const policyArgs = buildLinuxBubblewrapPolicyArgs(
      pluginTree.directories,
      pinnedMounts,
      environment,
      seccompFilter,
      { runtimePathnameClosure },
    );
    const probePolicyArgs = buildLinuxBubblewrapPolicyArgs(
      pluginTree.directories,
      probePinnedMounts,
      environment,
      probeSeccompFilter,
      { runtimePathnameClosure },
    );
    // The closure probe must exercise the exact ordered mount policy later
    // used for the untrusted target. Only the backing parent descriptors,
    // stdio, and command differ between the two launches; their child FD
    // numbers and every bwrap policy option are identical.
    if (
      runtimePathnameClosure &&
      JSON.stringify(probePolicyArgs) !== JSON.stringify(policyArgs)
    ) {
      closeStrongLinuxResources(supervisorPin, probeLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          "runtime_pathname_closure_probe_policy_mismatch",
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_policy_probe_failed",
        guarantees: [],
      });
    }
    const targetArgs = validation.entryRuntime.startsWith("native-")
      ? [sandboxEntry, ...validation.argsSnapshot]
      : [
          "/opt/chainless/runtime/node",
          sandboxEntry,
          ...validation.argsSnapshot.slice(1),
        ];
    const snapshotPolicyBinding = entrySnapshot
      ? {
          scope: entrySnapshot.attestation.scope,
          mechanism: entrySnapshot.attestation.mechanism,
          sourceIdentity: validation.contract.entryIdentity,
          sha256: entrySnapshot.attestation.sha256,
          bytes: entrySnapshot.attestation.bytes,
          destination: sandboxEntry,
          ...(validation.entryRuntime === "node"
            ? { sourceFileMode: entrySnapshot.attestation.sourceFileMode }
            : {}),
          sourceMode: entrySnapshot.attestation.sourceMode,
          targetMode: entrySnapshot.attestation.targetMode,
        }
      : null;
    const descriptorScrubberPolicy = linuxBwrapDescriptorScrubberPolicyBinding(
      descriptorScrubberPin.attestation,
      {
        scrubberChildFd: LINUX_BWRAP_FIRST_MOUNT_FD + pinnedDescriptors.length,
        preservedMaxFd:
          LINUX_BWRAP_FIRST_MOUNT_FD + pinnedDescriptors.length - 1,
        executableChildFd: LINUX_BWRAP_SUPERVISOR_CHILD_FD,
      },
    );
    const policyDigest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          version: 6,
          backend: LINUX_BWRAP_BACKEND,
          supervisor: supervisorPin.attestation,
          descriptorScrubber: descriptorScrubberPolicy,
          contract: {
            kind: validation.contract.kind,
            pluginRoot: validation.contract.pluginRoot,
            root: validation.contract.rootIdentity,
            entry: validation.contract.entryIdentity,
            runtime: validation.contract.runtimeIdentity,
            entryRuntime: validation.entryRuntime,
            entryFormat,
          },
          mounts: pinnedMounts.map((mount) =>
            mount.contentSnapshot
              ? {
                  destination: mount.destination,
                  fileId: mount.contentSnapshot.sourceFileId,
                  bytes: mount.contentSnapshot.bytes,
                  mtimeMs: mount.contentSnapshot.sourceMtimeMs,
                  contentSnapshot: {
                    scope: mount.contentSnapshot.scope,
                    mechanism: mount.contentSnapshot.mechanism,
                    sha256: mount.contentSnapshot.sha256,
                    bytes: mount.contentSnapshot.bytes,
                    ...(validation.entryRuntime === "node"
                      ? {
                          sourceFileMode: mount.contentSnapshot.sourceFileMode,
                        }
                      : {}),
                    sourceMode: mount.contentSnapshot.sourceMode,
                    targetMode: mount.contentSnapshot.targetMode,
                  },
                }
              : {
                  destination: mount.destination,
                  fileId: mount.fileId,
                  bytes: mount.bytes,
                  mtimeMs: mount.mtimeMs,
                },
          ),
          contentSnapshot: snapshotPolicyBinding,
          ...(nativeDynamicClosure
            ? { initialDynamicLoadClosure: nativeDynamicClosure }
            : {}),
          ...(runtimePathnameLoadSet
            ? { runtimeSharedLibraryPathnameLoadSet: runtimePathnameLoadSet }
            : {}),
          pluginTreeContentSnapshot: pluginTreeSnapshot,
          seccomp: {
            arch: seccompFilter.arch,
            policy: seccompFilter.policy,
            sha256: seccompFilter.sha256,
          },
          policyArgs,
          target: validation.entryRuntime.startsWith("native-")
            ? targetArgs.slice(0, 1)
            : targetArgs.slice(0, 2),
        }),
      )
      .digest("hex");
    const policyProbe = Object.freeze(
      runtimePathnameClosure
        ? probeLinuxRuntimePathnameClosurePolicy(
            runtime,
            probeLaunch,
            supervisorPin.attestation,
            probePolicyArgs,
            probeDescriptors,
            validation.entryRuntime,
            entrySnapshot?.attestation,
          )
        : probeLinuxBubblewrapPolicy(
            runtime,
            probeLaunch,
            supervisorPin.attestation,
            probePolicyArgs,
            probeDescriptors,
            validation.entryRuntime,
          ),
    );
    closeLinuxPinnedMounts(runtime, [
      probeLaunch,
      probeSeccompFilter,
      entrySnapshot?.probeMount,
      runtimeFileSnapshot?.probeMount,
      ...pluginTreeProbeMounts,
    ]);
    probeLaunch = null;
    if (!policyProbe.runnable) {
      closeStrongLinuxResources(supervisorPin, finalLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: policyProbe,
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
      { sealedEntry: entrySnapshot !== null },
    );
    const launchArgumentsChanged =
      finalValidation.ok &&
      (finalValidation.argsSnapshot.length !== validation.argsSnapshot.length ||
        finalValidation.argsSnapshot.some(
          (value, index) => value !== validation.argsSnapshot[index],
        ));
    if (!finalValidation.ok || launchArgumentsChanged) {
      closeStrongLinuxResources(supervisorPin, finalLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${
            finalValidation.ok
              ? "launch_arguments_changed"
              : finalValidation.reason
          }`,
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
    try {
      if (runtimeFileSnapshot) {
        attestLinuxRegularFileSnapshot(
          runtime,
          runtimeFileSnapshot.finalMount,
          runtimeFileSnapshot.attestation,
          linuxPluginRuntimeSnapshotContract(),
        );
      }
      attestLinuxPluginTreeSnapshot(
        runtime,
        pinnedMounts,
        sandboxEntry,
        validation.entryRuntime,
        pluginTreeSnapshot,
      );
    } catch (error) {
      closeStrongLinuxResources(supervisorPin, finalLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${error.message || "entry_snapshot_changed"}`,
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
    try {
      attestLinuxBubblewrapSupervisorPin(runtime, supervisorPin);
      attestLinuxBubblewrapSupervisorPin(
        runtime,
        descriptorScrubberPin,
        "descriptor_scrubber",
      );
    } catch (error) {
      closeStrongLinuxResources(supervisorPin, finalLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${error.message || "supervisor_identity_changed"}`,
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
    try {
      finalLaunch = openLinuxBubblewrapSupervisorLaunch(
        runtime,
        supervisorPin,
        descriptorScrubberPin,
      );
    } catch (error) {
      closeStrongLinuxResources(supervisorPin, finalLaunch);
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${error.message || "supervisor_launch_reader_unattested"}`,
          validation.entryRuntime,
          null,
          supervisorPin.attestation,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
    const supervisorBinding = supervisorPin.attestation;
    closeLinuxPinnedMounts(runtime, [supervisorPin, descriptorScrubberPin]);
    supervisorPin = null;
    descriptorScrubberPin = null;
    const capsuleContract =
      validation.contract.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND;
    const baseRuntimeProbe = linuxBubblewrapProbe(
      true,
      true,
      null,
      validation.entryRuntime,
      entrySnapshot?.attestation,
      supervisorBinding,
      pluginTreeSnapshot,
      nativeDynamicClosure,
      runtimePathnameLoadSet,
      policyProbe.runtimeDetachedChildSpawnVerified === true,
    );
    const descriptorBoundRuntimeProbe = {
      ...baseRuntimeProbe,
      descriptorScrubber: descriptorScrubberPolicy,
    };
    const runtimeProbe = Object.freeze(
      capsuleContract
        ? {
            ...descriptorBoundRuntimeProbe,
            mcpCapsuleCodeSnapshot: true,
            entrySnapshotAtomic: true,
            runtimeLaunchAtomic: true,
            runtimeLaunchMechanism:
              "bwrap-descriptor-mount-node-runtime-exec-v1",
            sharedLibraryClosure: false,
            ...mcpStdioCapsuleNativeCodeEvidence(
              validation.contract.nativeCodePolicy,
            ),
            runtimeSnapshotSha256: validation.contract.runtimeIdentity.sha256,
            runtimeSnapshotBytes: validation.contract.runtimeIdentity.bytes,
            entrySnapshotSha256: entrySnapshot.attestation.sha256,
            entrySnapshotBytes: entrySnapshot.attestation.bytes,
            runtimeLaunchPath: "/opt/chainless/runtime/node",
            entrySnapshotPath: sandboxEntry,
          }
        : descriptorBoundRuntimeProbe,
    );
    let pinsClosed = false;
    const cleanup = () => {
      if (pinsClosed) return;
      pinsClosed = true;
      closeLinuxPinnedMounts(runtime, [...pinnedDescriptors, finalLaunch]);
    };
    try {
      const stdio = linuxStdioWithPinnedMounts(
        spawnOpts?.stdio,
        pinnedDescriptors,
        {
          supervisorFd: finalLaunch.fd,
          scrubberFd: finalLaunch.scrubberFd,
        },
      );
      const invocation = linuxBubblewrapScrubbedInvocation(
        finalLaunch,
        [...policyArgs, "--", ...targetArgs],
        stdio,
      );
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
        stdio: Object.freeze(stdio),
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
        guarantees: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
          SANDBOX_BOUNDARIES.PROCESS_TREE,
          ...(capsuleContract
            ? [
                SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
                SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
              ]
            : []),
        ],
        command: invocation.command,
        args: invocation.args,
        options,
        cleanup,
      });
    } catch (error) {
      cleanup();
      return createSandboxPlan({
        ...base,
        backend: null,
        candidateBackend: LINUX_BWRAP_BACKEND,
        policyAttested: false,
        policyDigest,
        runtimeProbe: linuxBubblewrapProbe(
          true,
          false,
          `post_probe_${error.message || "final_plan_construction_failed"}`,
          validation.entryRuntime,
          null,
          supervisorBinding,
        ),
        reason: "linux_bwrap_execution_contract_changed",
        guarantees: [],
      });
    }
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
 *   pty?: boolean,
 *   linuxCgroup?: Object|null,
 *   executionContract?: Readonly<Object>|null
 * }|null} explicitRequest
 * @returns {ReturnType<typeof createSandboxPlan>}
 */
export function applySandbox(
  command,
  args,
  spawnOpts,
  profileOrRequest = "default",
  runtimeOverrides = undefined,
  explicitRequest = null,
) {
  const runtimeInjected = runtimeOverrides !== undefined;
  const runtime = resolveRuntime(runtimeOverrides);
  const sandboxRequest = normalizeSandboxRequest(
    profileOrRequest,
    explicitRequest,
  );
  const profileName = sandboxRequest.profile;
  // Windows does not consume the POSIX allow-write lists. Avoid invoking an
  // embedding temp-directory hook while eagerly constructing three unused
  // profiles; applyWindowsSandbox resolves and pins that hook exactly once.
  const profileTempDirectory =
    runtime.platform === "win32" ? null : runtime.tmpdir();
  const profiles = {
    default: {
      allowNetwork: false,
      allowExec: true,
      allowRead: [runtime.homedir(), "/tmp"],
      allowWrite: profileTempDirectory ? [profileTempDirectory] : [],
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
      allowWrite: profileTempDirectory ? [profileTempDirectory] : [],
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
      allowWrite: profileTempDirectory ? [profileTempDirectory] : [],
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
    pty: sandboxRequest.pty,
    linuxCgroup: sandboxRequest.linuxCgroup,
    executionContract: sandboxRequest.executionContract,
  };

  const applyRequestedLinuxCgroup = (plan) =>
    applyLinuxCgroupV2ToPlan(plan, sandboxRequest.linuxCgroup, {
      platform: runtime.platform,
      fs: runtime.fs,
      sync: sandboxRequest.sync,
    });

  // Dispatch to platform handler
  if (runtime.platform === "darwin") {
    return applyRequestedLinuxCgroup(
      applyMacSandbox(
        command,
        args,
        spawnOpts,
        profile,
        runtimeOverrides,
        runtimeInjected ? null : MACOS_MCP_CODE_SNAPSHOT_ISSUER,
      ),
    );
  }
  if (runtime.platform === "win32") {
    return applyRequestedLinuxCgroup(
      applyWindowsSandbox(
        command,
        args,
        spawnOpts,
        profile,
        runtimeOverrides,
        runtimeInjected ? null : WINDOWS_MCP_CODE_SNAPSHOT_ISSUER,
      ),
    );
  }
  if (runtime.platform === "linux") {
    return applyRequestedLinuxCgroup(
      applyLinuxSandbox(command, args, spawnOpts, profile, runtimeOverrides),
    );
  }

  // Unknown platform - no sandbox applied
  return applyRequestedLinuxCgroup(
    createSandboxPlan({
      platform: runtime.platform,
      profile: profile.profileName,
      command,
      args,
      options: spawnOpts,
      reason: "unsupported_platform",
    }),
  );
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
  if (runtime.platform === "linux" && sandboxResult?.postSpawn?.required) {
    if (typeof sandboxResult.postSpawnLinux !== "function") {
      throw new Error("Linux post-spawn sandbox adapter is unavailable");
    }
    return sandboxResult.postSpawnLinux(proc);
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
