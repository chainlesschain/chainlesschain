/**
 * Process Execution Broker — P0-1 生产化
 * 对应文档 §2.1 四层架构 Layer 1
 *
 * 统一拦截所有子进程执行：
 * - M1: 所有子进程唯一入口，权限检查
 * - **P0-1**: 可审计的平台执行计划（macOS Seatbelt / Linux prlimit /
 *   Windows Job Object + Restricted Token）
 * - **P0-1**: 凭据代理 default-on（secrets 永远不裸传给子进程）
 * - M3: 集成W3C trace context自动传播
 * - M4: 自动写入Runtime Provenance Ledger (RPL)
 * - M5: Hooks v2事件发射
 */

// 直接导入原生child_process，避免递归
import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
  exec as nativeExec,
  execSync as nativeExecSync,
  execFile as nativeExecFile,
  execFileSync as nativeExecFileSync,
  fork as nativeFork,
} from "node:child_process";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";
import * as tty from "node:tty";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// P0-1: 平台沙箱 + 凭据代理
// platform-sandbox.js exports: applySandbox, postSpawnSandbox
import {
  applySandbox as _applySandbox,
  consumeMacMcpCodeSnapshotPlanBinding,
  consumeWindowsMcpCodeSnapshotPlanBinding,
  postSpawnSandbox as _postSpawnSandbox,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
  MACOS_PKG_EXECPATH_MAGIC,
  SANDBOX_BOUNDARIES,
} from "./platform-sandbox.js";
import {
  MACOS_MCP_LAUNCHER_INPUTS,
  isMacosMcpLauncherPackageVersion,
} from "./macos-mcp-launcher-contract.js";
import {
  admitLinuxGenericSandboxExecutionContract,
  issueLinuxGenericSandboxExecutionContract,
  LINUX_GENERIC_CONTRACT_KIND,
  verifyLinuxGenericBubblewrapPlan,
} from "./linux-generic-bwrap.js";
import {
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_KIND,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_MECHANISM,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256,
  parseLinuxBwrapDescriptorScrubbedLaunch,
} from "./linux-bwrap-descriptor-launch.js";
import { consumeIssuedPluginSandboxExecutionContract } from "../plugin-runtime/bin.js";
import runtimeProvenanceLedger from "../runtime-provenance-ledger.js";
import { credentialAgent } from "./credential-agent.js";
import { WorkspaceTransactionManager } from "./workspace-transaction.js";
import {
  consumeMcpStdioCapsuleSandboxExecutionContract,
  consumeMcpStdioExecutableIdentityAuthority,
  MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
} from "../mcp-stdio-executable-identity.js";
import {
  isMcpStdioCapsuleNativeCodePolicy,
  mcpStdioCapsuleNativeCodePolicyDigest,
} from "../mcp-stdio-native-code-policy.js";

const SUPPORTED_SANDBOX_BOUNDARIES = new Set(Object.values(SANDBOX_BOUNDARIES));
const SUPPORTED_SANDBOX_PROFILES = new Set([
  "default",
  "strict",
  "network-only",
]);
// Broker-private admission state. Public runtime-probe fields are audit
// evidence, not authority to invoke a privileged post-spawn closure.
const admittedWindowsMcpCodeSnapshotPlans = new WeakSet();
const admittedMacMcpCodeSnapshotPlans = new WeakSet();

const LINUX_RUNTIME_PATHNAME_POLICY_PREFIX = Object.freeze([
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
]);
const LINUX_RUNTIME_PATHNAME_POLICY_DIRECTORIES = Object.freeze([
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
]);
const LINUX_RUNTIME_PATHNAME_POLICY_ENVIRONMENT = Object.freeze([
  ["CHAINLESS_SANDBOXED", "1"],
  ["HOME", "/home/sandbox"],
  ["LANG", "C.UTF-8"],
  ["LC_ALL", "C.UTF-8"],
  ["OPENSSL_CONF", "/dev/null"],
  ["PATH", "/opt/chainless/runtime"],
  ["TMPDIR", "/tmp"],
  ["TZ", "UTC"],
]);

function denseOwnDataArraySnapshot(value) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(descriptors).length !== length + 1
  ) {
    return null;
  }
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return null;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function exactOwnDataDescriptors(value, expectedKeys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !("value" in (descriptors[key] || {})))
  ) {
    return null;
  }
  return descriptors;
}

function ownDataObjectSnapshot(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key])) {
      return null;
    }
    Object.defineProperty(snapshot, key, {
      value: descriptors[key].value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(snapshot);
}

const LINUX_DESCRIPTOR_SCRUBBER_EVIDENCE_KEYS = Object.freeze([
  "kind",
  "mechanism",
  "scriptSha256",
  "executableIdentity",
  "executablePinned",
  "argvFixed",
  "callerEnvironmentFixed",
  "nodeRuntimeEnvironmentInjection",
  "nodeIpcChildFd",
  "nodeIpcSerializationMode",
  "procSelfFdPasses",
  "closesUnknownInheritedDescriptors",
  "verificationPassesFailClosed",
  "policyBound",
  "scrubberChildFd",
  "preservedMaxFd",
  "activeStdioThrough",
  "executableChildFd",
]);
const LINUX_DESCRIPTOR_SCRUBBER_IDENTITY_KEYS = Object.freeze([
  "path",
  "fileId",
  "sha256",
  "bytes",
  "mtimeMs",
  "mode",
  "uid",
  "gid",
]);

function sanitizeLinuxDescriptorScrubberEvidence(value, launch) {
  const descriptors = exactOwnDataDescriptors(
    value,
    LINUX_DESCRIPTOR_SCRUBBER_EVIDENCE_KEYS,
  );
  const identity = descriptors?.executableIdentity?.value;
  const identityDescriptors = exactOwnDataDescriptors(
    identity,
    LINUX_DESCRIPTOR_SCRUBBER_IDENTITY_KEYS,
  );
  const fileId = identityDescriptors?.fileId?.value;
  const fileIdDescriptors = exactOwnDataDescriptors(fileId, ["dev", "ino"]);
  const nodeIpcChildFd = launch?.nodeIpcChildFd ?? null;
  const expectedInjection =
    nodeIpcChildFd === null ? "none" : "node-child-process-exact-ipc-v1";
  const expectedSerialization = nodeIpcChildFd === null ? null : "json";
  if (
    !descriptors ||
    !launch ||
    !identityDescriptors ||
    !fileIdDescriptors ||
    descriptors.kind.value !== LINUX_BWRAP_DESCRIPTOR_SCRUBBER_KIND ||
    descriptors.mechanism.value !== LINUX_BWRAP_DESCRIPTOR_SCRUBBER_MECHANISM ||
    descriptors.scriptSha256.value !==
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256 ||
    descriptors.executablePinned.value !== true ||
    descriptors.argvFixed.value !== true ||
    descriptors.callerEnvironmentFixed.value !== true ||
    descriptors.nodeRuntimeEnvironmentInjection.value !== expectedInjection ||
    descriptors.nodeIpcChildFd.value !== nodeIpcChildFd ||
    descriptors.nodeIpcSerializationMode.value !== expectedSerialization ||
    descriptors.procSelfFdPasses.value !==
      LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES ||
    descriptors.closesUnknownInheritedDescriptors.value !== true ||
    descriptors.verificationPassesFailClosed.value !== true ||
    descriptors.policyBound.value !== true ||
    descriptors.scrubberChildFd.value !== launch.scrubberChildFd ||
    descriptors.preservedMaxFd.value !== launch.preservedMaxFd ||
    descriptors.activeStdioThrough.value !== launch.activeStdioThrough ||
    descriptors.executableChildFd.value !== launch.executableChildFd ||
    identityDescriptors.path.value !== LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH ||
    typeof fileIdDescriptors.dev.value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(fileIdDescriptors.dev.value) ||
    typeof fileIdDescriptors.ino.value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(fileIdDescriptors.ino.value) ||
    typeof identityDescriptors.sha256.value !== "string" ||
    !/^[a-f0-9]{64}$/.test(identityDescriptors.sha256.value) ||
    !Number.isSafeInteger(identityDescriptors.bytes.value) ||
    identityDescriptors.bytes.value <= 0 ||
    identityDescriptors.bytes.value > 256 * 1024 * 1024 ||
    !Number.isFinite(identityDescriptors.mtimeMs.value) ||
    !Number.isSafeInteger(identityDescriptors.mode.value) ||
    (identityDescriptors.mode.value & 0o170000) !== 0o100000 ||
    (identityDescriptors.mode.value & 0o111) === 0 ||
    (identityDescriptors.mode.value & 0o022) !== 0 ||
    identityDescriptors.uid.value !== 0 ||
    !Number.isSafeInteger(identityDescriptors.gid.value) ||
    identityDescriptors.gid.value < 0
  ) {
    return null;
  }
  const sanitizedIdentity = Object.freeze({
    path: identityDescriptors.path.value,
    fileId: Object.freeze({
      dev: fileIdDescriptors.dev.value,
      ino: fileIdDescriptors.ino.value,
    }),
    sha256: identityDescriptors.sha256.value,
    bytes: identityDescriptors.bytes.value,
    mtimeMs: identityDescriptors.mtimeMs.value,
    mode: identityDescriptors.mode.value,
    uid: identityDescriptors.uid.value,
    gid: identityDescriptors.gid.value,
  });
  return Object.freeze({
    kind: descriptors.kind.value,
    mechanism: descriptors.mechanism.value,
    scriptSha256: descriptors.scriptSha256.value,
    executableIdentity: sanitizedIdentity,
    executablePinned: true,
    argvFixed: true,
    callerEnvironmentFixed: true,
    nodeRuntimeEnvironmentInjection: expectedInjection,
    nodeIpcChildFd,
    nodeIpcSerializationMode: expectedSerialization,
    procSelfFdPasses: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES,
    closesUnknownInheritedDescriptors: true,
    verificationPassesFailClosed: true,
    policyBound: true,
    scrubberChildFd: launch.scrubberChildFd,
    preservedMaxFd: launch.preservedMaxFd,
    activeStdioThrough: launch.activeStdioThrough,
    executableChildFd: launch.executableChildFd,
  });
}

function parseLinuxRuntimePathnameClosurePolicyArgs(
  args,
  expectedLoadSetFiles,
) {
  if (
    !Array.isArray(args) ||
    !Number.isSafeInteger(expectedLoadSetFiles) ||
    expectedLoadSetFiles < 1 ||
    expectedLoadSetFiles > 512
  ) {
    return null;
  }
  const targetSeparator = args.indexOf("--");
  if (targetSeparator < 1) return null;
  const policyArgs = args.slice(0, targetSeparator);
  let index = 0;
  const consume = (...expected) => {
    if (
      expected.some(
        (expectedValue, offset) => policyArgs[index + offset] !== expectedValue,
      )
    ) {
      return false;
    }
    index += expected.length;
    return true;
  };
  if (!consume(...LINUX_RUNTIME_PATHNAME_POLICY_PREFIX)) return null;

  const directories = [];
  while (policyArgs[index] === "--dir") {
    const directory = policyArgs[index + 1];
    if (
      typeof directory !== "string" ||
      !path.posix.isAbsolute(directory) ||
      path.posix.normalize(directory) !== directory ||
      directory === "/"
    ) {
      return null;
    }
    directories.push(directory);
    index += 2;
  }
  const orderedDirectories = [...directories].sort((left, right) => {
    const depth =
      left.split("/").filter(Boolean).length -
      right.split("/").filter(Boolean).length;
    return depth || left.localeCompare(right);
  });
  if (
    directories.length < LINUX_RUNTIME_PATHNAME_POLICY_DIRECTORIES.length ||
    new Set(directories).size !== directories.length ||
    JSON.stringify(directories) !== JSON.stringify(orderedDirectories) ||
    !LINUX_RUNTIME_PATHNAME_POLICY_DIRECTORIES.every((directory) =>
      directories.includes(directory),
    )
  ) {
    return null;
  }

  if (
    !consume(
      "--perms",
      "0000",
      "--file",
      "3",
      "/run/.chainless-bwrap-supervisor",
    )
  ) {
    return null;
  }
  const permittedLoadDestination = (destination) =>
    typeof destination === "string" &&
    path.posix.isAbsolute(destination) &&
    path.posix.normalize(destination) === destination &&
    (destination === "/opt/chainless/runtime/node" ||
      destination === "/etc/ld.so.cache" ||
      destination.startsWith("/opt/chainless/plugin/") ||
      ["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some((prefix) =>
        destination.startsWith(prefix),
      ));
  const loadDestinations = [];
  for (let mountIndex = 0; mountIndex < expectedLoadSetFiles; mountIndex += 1) {
    const expectedChildFd = String(4 + mountIndex);
    let destination;
    let mountMode;
    let permissions = null;
    if (policyArgs[index] === "--ro-bind-fd") {
      if (policyArgs[index + 1] !== expectedChildFd) return null;
      mountMode = "ro-bind-fd";
      destination = policyArgs[index + 2];
      index += 3;
    } else if (policyArgs[index] === "--perms") {
      permissions = policyArgs[index + 1];
      if (
        (permissions !== "0400" && permissions !== "0500") ||
        policyArgs[index + 2] !== "--ro-bind-data" ||
        policyArgs[index + 3] !== expectedChildFd
      ) {
        return null;
      }
      mountMode = "ro-bind-data";
      destination = policyArgs[index + 4];
      index += 5;
    } else {
      return null;
    }
    if (!permittedLoadDestination(destination)) return null;
    const runtimeSnapshotDestination =
      destination === "/opt/chainless/runtime/node";
    const pluginSnapshotDestination = destination.startsWith(
      "/opt/chainless/plugin/",
    );
    if (
      (runtimeSnapshotDestination &&
        (mountMode !== "ro-bind-data" || permissions !== "0500")) ||
      (pluginSnapshotDestination && mountMode !== "ro-bind-data") ||
      (!runtimeSnapshotDestination &&
        !pluginSnapshotDestination &&
        mountMode !== "ro-bind-fd")
    ) {
      return null;
    }
    loadDestinations.push(destination);
  }
  if (new Set(loadDestinations).size !== loadDestinations.length) return null;

  const requiredDirectories = new Set(
    LINUX_RUNTIME_PATHNAME_POLICY_DIRECTORIES,
  );
  for (const destination of loadDestinations) {
    let parent = path.posix.dirname(destination);
    while (parent !== "/") {
      requiredDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  if (
    ![...requiredDirectories].every((directory) =>
      directories.includes(directory),
    ) ||
    directories.some(
      (directory) =>
        !requiredDirectories.has(directory) &&
        !directory.startsWith("/opt/chainless/plugin/"),
    )
  ) {
    return null;
  }

  if (
    !consume("--seccomp", String(4 + expectedLoadSetFiles)) ||
    !consume("--remount-ro", "/") ||
    !consume(
      "--perms",
      "0755",
      "--size",
      String(16 * 1024 * 1024),
      "--tmpfs",
      "/run",
      "--remount-ro",
      "/run",
    )
  ) {
    return null;
  }
  for (const [key, value] of LINUX_RUNTIME_PATHNAME_POLICY_ENVIRONMENT) {
    if (!consume("--setenv", key, value)) return null;
  }
  if (!consume("--chdir", "/opt/chainless/plugin")) return null;
  if (index !== policyArgs.length) return null;
  return Object.freeze({
    targetSeparator,
    loadDestinations: Object.freeze(loadDestinations),
  });
}

// Keep the broker on the shared CommonJS trace singleton so CommonJS and ESM
// consumers observe the same AsyncLocalStorage without loader warnings.
let _traceCtx = null;
const _ipcBus = null;

function getTraceCtx() {
  if (!_traceCtx) {
    try {
      _traceCtx = require("../execution-trace/trace-context.cjs");
    } catch {
      _traceCtx = null;
    }
  }
  return _traceCtx;
}

function getRpl() {
  return runtimeProvenanceLedger;
}

function createNativePtyAdapter() {
  const MAX_PENDING_WRITE_BYTES = 1024 * 1024;
  const terminalStates = new WeakMap();
  const blockingSlaveOwners = new Map();
  const closeStream = (stream) => {
    try {
      stream?.destroy?.();
    } catch {
      // PTY cleanup is best-effort after the owning process has terminated.
    }
  };
  const terminalState = (terminal) => {
    const state = terminalStates.get(terminal);
    if (!state) {
      throw new Error("pty_terminal_state_unavailable");
    }
    return state;
  };
  const invalidateMasterState = (state) => {
    state.disposed = true;
    state.fd = null;
    state.writeQueue.length = 0;
    state.pendingWriteBytes = 0;
    if (state.writeImmediate) {
      clearImmediate(state.writeImmediate);
      state.writeImmediate = null;
    }
  };
  const hasLiveMaster = (state) =>
    !state.disposed &&
    Number.isInteger(state.fd) &&
    state.master?.destroyed !== true &&
    state.master?.closed !== true;
  const processWriteQueue = (state) => {
    if (!hasLiveMaster(state)) {
      invalidateMasterState(state);
      return;
    }
    if (state.writeQueue.length === 0) {
      return;
    }
    const task = state.writeQueue[0];
    let written = 0;
    try {
      // The node-pty master is non-blocking. Keep the syscall synchronous so
      // releaseTerminal() can never close and recycle this numeric fd while a
      // libuv fs.write request still refers to it. Bound each turn for event
      // loop fairness; EAGAIN is retried from the next turn.
      written = fs.writeSync(
        state.fd,
        task.buffer,
        task.offset,
        Math.min(task.buffer.byteLength - task.offset, 64 * 1024),
        null,
      );
    } catch (error) {
      if (error.code !== "EAGAIN" && error.code !== "EWOULDBLOCK") {
        invalidateMasterState(state);
      }
    }
    if (written > 0) {
      task.offset += written;
      state.pendingWriteBytes -= written;
      if (task.offset >= task.buffer.byteLength) {
        state.writeQueue.shift();
      }
    }
    if (
      !state.disposed &&
      state.writeQueue.length > 0 &&
      !state.writeImmediate
    ) {
      state.writeImmediate = setImmediate(() => {
        state.writeImmediate = null;
        processWriteQueue(state);
      });
    }
  };
  return {
    allocate(ptyModule, options) {
      if (
        typeof ptyModule?.native?.open !== "function" ||
        typeof ptyModule.native.resize !== "function"
      ) {
        throw new TypeError("pty_module_native_open_unavailable");
      }
      const cols = options?.cols || 80;
      const rows = options?.rows || 24;
      if (
        !Number.isInteger(cols) ||
        cols <= 0 ||
        cols > 65_535 ||
        !Number.isInteger(rows) ||
        rows <= 0 ||
        rows > 65_535
      ) {
        throw new TypeError("pty_dimensions_invalid");
      }
      let opened;
      let master = null;
      try {
        opened = ptyModule.native.open(cols, rows);
        if (
          !Number.isInteger(opened?.master) ||
          opened.master < 0 ||
          !Number.isInteger(opened?.slave) ||
          opened.slave < 0 ||
          opened.master === opened.slave ||
          typeof opened?.pty !== "string" ||
          !/^\/dev\/pts\/\d+$/.test(opened.pty)
        ) {
          throw new Error("pty_native_identity_unavailable");
        }
        const masterStat = fs.fstatSync(opened.master);
        const slaveStat = fs.fstatSync(opened.slave);
        const ptmxStat = fs.statSync("/dev/ptmx");
        const pathStat = fs.statSync(opened.pty);
        if (
          !masterStat.isCharacterDevice() ||
          !slaveStat.isCharacterDevice() ||
          !ptmxStat.isCharacterDevice() ||
          !pathStat.isCharacterDevice() ||
          String(masterStat.dev) !== String(ptmxStat.dev) ||
          String(masterStat.rdev) !== String(ptmxStat.rdev) ||
          String(pathStat.dev) !== String(slaveStat.dev) ||
          String(pathStat.rdev) !== String(slaveStat.rdev)
        ) {
          throw new Error("pty_native_identity_invalid");
        }
        master = new tty.ReadStream(opened.master);
        const encoding =
          options?.encoding === null
            ? null
            : typeof options?.encoding === "string"
              ? options.encoding
              : "utf8";
        if (encoding !== null) {
          master.setEncoding(encoding);
        }
        const terminal = {
          master,
          ptsName: opened.pty,
        };
        const state = {
          fd: opened.master,
          rawSlaveFd: opened.slave,
          blockingSlaveFd: null,
          native: ptyModule.native,
          cols,
          rows,
          encoding: encoding || "utf8",
          writeQueue: [],
          pendingWriteBytes: 0,
          writeImmediate: null,
          disposed: false,
          readError: null,
          master,
        };
        terminalStates.set(terminal, state);
        master.on("error", (error) => {
          state.readError = error;
          invalidateMasterState(state);
        });
        master.once("close", () => invalidateMasterState(state));
        return terminal;
      } catch (error) {
        if (master) {
          closeStream(master);
        } else if (Number.isInteger(opened?.master)) {
          try {
            fs.closeSync(opened.master);
          } catch {
            // Preserve the allocation failure.
          }
        }
        if (Number.isInteger(opened?.slave)) {
          try {
            fs.closeSync(opened.slave);
          } catch {
            // Preserve the allocation failure.
          }
        }
        throw error;
      }
    },
    openBlockingSlave(terminal) {
      const ptsName = terminal?.ptsName;
      const state = terminalState(terminal);
      const originalFd = state.rawSlaveFd;
      if (
        typeof ptsName !== "string" ||
        !/^\/dev\/pts\/\d+$/.test(ptsName) ||
        !Number.isInteger(originalFd)
      ) {
        throw new Error("pty_slave_identity_unavailable");
      }
      const originalStat = fs.fstatSync(originalFd);
      if (!originalStat.isCharacterDevice()) {
        throw new Error("pty_slave_not_character_device");
      }
      const flags =
        Number(fs.constants.O_RDWR) |
        Number(fs.constants.O_NOCTTY || 0) |
        Number(fs.constants.O_CLOEXEC || 0);
      const fd = fs.openSync(ptsName, flags);
      try {
        const openedStat = fs.fstatSync(fd);
        const pathStat = fs.statSync(ptsName);
        if (
          !openedStat.isCharacterDevice() ||
          !pathStat.isCharacterDevice() ||
          String(openedStat.dev) !== String(originalStat.dev) ||
          String(openedStat.rdev) !== String(originalStat.rdev) ||
          String(pathStat.dev) !== String(originalStat.dev) ||
          String(pathStat.rdev) !== String(originalStat.rdev)
        ) {
          throw new Error("pty_slave_identity_changed");
        }
        fs.closeSync(originalFd);
        state.rawSlaveFd = null;
        state.blockingSlaveFd = fd;
        blockingSlaveOwners.set(fd, state);
        return fd;
      } catch (error) {
        fs.closeSync(fd);
        throw error;
      }
    },
    closeFd(fd) {
      fs.closeSync(fd);
      const state = blockingSlaveOwners.get(fd);
      if (state) {
        state.blockingSlaveFd = null;
        blockingSlaveOwners.delete(fd);
      }
    },
    getCols(terminal) {
      return terminalState(terminal).cols;
    },
    getRows(terminal) {
      return terminalState(terminal).rows;
    },
    onData(terminal, listener) {
      const master = terminal?.master;
      if (typeof master?.on !== "function") {
        throw new Error("pty_master_stream_unavailable");
      }
      master.on("data", listener);
      return {
        dispose() {
          if (typeof master.off === "function") {
            master.off("data", listener);
          } else {
            master.removeListener?.("data", listener);
          }
        },
      };
    },
    write(terminal, data) {
      const state = terminalState(terminal);
      if (!hasLiveMaster(state)) {
        invalidateMasterState(state);
        return;
      }
      const buffer =
        typeof data === "string"
          ? Buffer.from(data, state.encoding)
          : Buffer.from(data);
      if (buffer.byteLength === 0) return;
      if (
        buffer.byteLength > MAX_PENDING_WRITE_BYTES ||
        state.pendingWriteBytes > MAX_PENDING_WRITE_BYTES - buffer.byteLength
      ) {
        const error = new Error("pty_write_queue_limit_exceeded");
        error.code = "ERR_PTY_WRITE_BACKPRESSURE";
        throw error;
      }
      state.writeQueue.push({ buffer, offset: 0 });
      state.pendingWriteBytes += buffer.byteLength;
      processWriteQueue(state);
    },
    resize(terminal, cols, rows) {
      const state = terminalState(terminal);
      if (!hasLiveMaster(state)) {
        invalidateMasterState(state);
        const error = new Error("pty_terminal_closed");
        error.code = "ERR_PTY_TERMINAL_CLOSED";
        throw error;
      }
      if (
        !Number.isInteger(cols) ||
        cols <= 0 ||
        cols > 65_535 ||
        !Number.isInteger(rows) ||
        rows <= 0 ||
        rows > 65_535
      ) {
        throw new TypeError("pty_dimensions_invalid");
      }
      try {
        state.native.resize(state.fd, cols, rows);
      } catch (error) {
        invalidateMasterState(state);
        throw error;
      }
      state.cols = cols;
      state.rows = rows;
    },
    clear() {},
    pause(terminal) {
      return terminal?.master?.pause?.();
    },
    resume(terminal) {
      return terminal?.master?.resume?.();
    },
    setEncoding(terminal, encoding) {
      const master = terminal?.master;
      if (master?._decoder) {
        delete master._decoder;
      }
      if (encoding) {
        master?.setEncoding?.(encoding);
      }
    },
    releaseTerminal(terminal) {
      const state = terminalStates.get(terminal);
      if (state) {
        invalidateMasterState(state);
        if (Number.isInteger(state.rawSlaveFd)) {
          try {
            fs.closeSync(state.rawSlaveFd);
          } catch {
            // Closing the master below remains authoritative.
          }
          state.rawSlaveFd = null;
        }
        if (Number.isInteger(state.blockingSlaveFd)) {
          try {
            fs.closeSync(state.blockingSlaveFd);
          } catch {
            // The descriptor may already have been closed by the launch path.
          }
          blockingSlaveOwners.delete(state.blockingSlaveFd);
          state.blockingSlaveFd = null;
        }
      }
      closeStream(terminal?.master);
    },
  };
}

function wrapSandboxedPty(terminal, child, command, ptyAdapter) {
  const exitEmitter = new EventEmitter();
  let exitState = null;
  let closed = false;
  const finish = (exitCode, signal) => {
    if (closed) return;
    closed = true;
    exitState = {
      exitCode: Number.isInteger(exitCode) ? exitCode : 1,
      signal: signal ?? null,
    };
    exitEmitter.emit("exit", exitState);
  };
  child.once("exit", finish);
  child.once("error", () => finish(1, null));

  return {
    pid: child.pid,
    process: command,
    childProcess: child,
    get cols() {
      return ptyAdapter.getCols(terminal);
    },
    get rows() {
      return ptyAdapter.getRows(terminal);
    },
    onData(listener) {
      return ptyAdapter.onData(terminal, listener);
    },
    onExit(listener) {
      if (exitState) {
        queueMicrotask(() => listener(exitState));
        return { dispose() {} };
      }
      exitEmitter.once("exit", listener);
      return {
        dispose() {
          exitEmitter.off("exit", listener);
        },
      };
    },
    write(data) {
      return ptyAdapter.write(terminal, data);
    },
    resize(cols, rows) {
      if (closed) {
        const error = new Error("pty_terminal_closed");
        error.code = "ERR_PTY_TERMINAL_CLOSED";
        throw error;
      }
      return ptyAdapter.resize(terminal, cols, rows);
    },
    clear() {
      return ptyAdapter.clear(terminal);
    },
    pause() {
      return ptyAdapter.pause(terminal);
    },
    resume() {
      return ptyAdapter.resume(terminal);
    },
    setEncoding(encoding) {
      return ptyAdapter.setEncoding(terminal, encoding);
    },
    kill(signal = "SIGHUP") {
      return child.kill(signal);
    },
    destroy() {
      return child.kill("SIGHUP");
    },
  };
}

class ProcessExecutionBroker extends EventEmitter {
  constructor() {
    super();
    this._auditLog = [];
    this._permissionState = new Map();
    this._defaultTimeout = 300000;
    this._blocked = new Set(["rm -rf /", "format c:", "del /f /s /q *"]);
    this._stats = {
      totalSpawned: 0,
      allowed: 0,
      denied: 0,
      byOrigin: {},
      sandboxed: 0,
      credFiltered: 0,
    };
    this._logPath = path.join(
      os.homedir(),
      ".chainlesschain",
      "logs",
      "process-audit.log",
    );

    // P0-1: Platform sandbox functions (applySandbox/postSpawnSandbox imported above)
    // No instance needed — stateless functional API per platform

    // P0-1: Credential filtering is default-on
    this._credentialAgent = credentialAgent;
    this._credentialFilteringEnabled = true;
    this._sandboxEnabled = true;
    // Keep the legacy aliases used by older call sites and make the strict
    // plugin path use the same switches as the general broker path.
    this._credentialAgentEnabled = true;
    this._platformSandboxEnabled = true;
    this._sandboxAdapter = {
      applySandbox: _applySandbox,
      postSpawnSandbox: _postSpawnSandbox,
    };
    this._ptyAdapter = createNativePtyAdapter();
    this._hooksEventSink = null;
    this._workspaceTransactionManagers = new Map();

    this._ensureLogDir();
    this._loadPermissions();
  }

  _ensureLogDir() {
    try {
      fs.mkdirSync(path.dirname(this._logPath), { recursive: true });
    } catch {
      // Audit persistence is best-effort; in-memory audit remains available.
    }
  }

  _loadPermissions() {
    this._permissionState.set("shell:default", "prompt");
    this._permissionState.set("background:default", "allow");
    this._permissionState.set("plugin:default", "deny");
    this._permissionState.set("mcp:default", "prompt");
    this._permissionState.set("agent:default", "prompt");
    this._permissionState.set("installer:default", "allow");
    this._permissionState.set("lsp:default", "allow");
  }

  _checkPermission(origin, command) {
    const key = `${origin}:${command}`;
    if (this._permissionState.has(key)) return this._permissionState.get(key);
    const wildcard = `${origin}:default`;
    if (this._permissionState.has(wildcard))
      return this._permissionState.get(wildcard);
    return "prompt";
  }

  _isDangerousCommand(command) {
    if (typeof command !== "string") return false;
    const lower = command.toLowerCase();
    for (const blocked of this._blocked) {
      if (lower.includes(blocked)) return true;
    }
    if (/rm\s+-rf\s+~/.test(lower)) return true;
    if (/del\s+\/[fsq].*windows/i.test(lower)) return true;
    return false;
  }

  _recordAudit(entry) {
    this._auditLog.push(entry);
    if (this._auditLog.length > 10000) this._auditLog.shift();
    this._stats.totalSpawned++;
    if (
      entry.permissionDecision === "allow" ||
      entry.permissionDecision === "elevated"
    ) {
      this._stats.allowed++;
    } else {
      this._stats.denied++;
    }
    this._stats.byOrigin[entry.origin] =
      (this._stats.byOrigin[entry.origin] || 0) + 1;
    try {
      fs.appendFileSync(this._logPath, JSON.stringify(entry) + "\n");
    } catch {
      // Audit persistence is best-effort; the in-memory entry is retained.
    }
    this.emit("spawn", entry);
  }

  _sanitizeOptions(options) {
    if (!options) return {};
    const safe = { ...options };
    if (process.platform === "win32" && safe.shell === true) {
      safe.windowsHide = true;
    }
    return safe;
  }

  _normalizePluginExecutableIdentity(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const realPath =
      typeof raw.realPath === "string" && raw.realPath ? raw.realPath : null;
    const sha256 =
      typeof raw.sha256 === "string" && /^[a-f0-9]{64}$/i.test(raw.sha256)
        ? raw.sha256.toLowerCase()
        : null;
    if (!realPath || !sha256) return null;
    return {
      contractVersion: 1,
      realPath,
      sha256,
      bytes:
        Number.isSafeInteger(raw.bytes) && raw.bytes >= 0 ? raw.bytes : null,
      fileId:
        raw.dev !== undefined && raw.ino !== undefined
          ? {
              dev: String(raw.dev),
              ino: String(raw.ino),
            }
          : null,
      mtimeMs: Number.isFinite(raw.mtimeMs) ? raw.mtimeMs : null,
      attestation: "realpath-file-id-sha256",
    };
  }

  _freezeExecutableIdentity(identity) {
    if (!identity) return null;
    return Object.freeze({
      ...identity,
      fileId: identity.fileId ? Object.freeze({ ...identity.fileId }) : null,
    });
  }

  _normalizePluginRootIdentity(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (
      typeof raw.realPath !== "string" ||
      !raw.realPath ||
      raw.dev === undefined ||
      raw.ino === undefined
    ) {
      return null;
    }
    return Object.freeze({
      realPath: raw.realPath,
      fileId: Object.freeze({
        dev: String(raw.dev),
        ino: String(raw.ino),
      }),
      attestation: "realpath-directory-file-id",
    });
  }

  /**
   * Normalize the private execution contract produced by agent-core for one
   * direct, already-attested strict Plugin Node or static-native bin. Plugin
   * manifests cannot provide this top-level option; they can only add
   * required boundaries.
   */
  _normalizeSandboxExecutionContract(raw, options, requiredBoundaries, launch) {
    if (raw === undefined) return null;
    const invalid = (message) => {
      throw this._sandboxBoundaryError(
        "invalid_sandbox_execution_contract",
        message,
        {
          requiredBoundaries,
          missingBoundaries: requiredBoundaries,
        },
      );
    };
    if (raw?.kind === LINUX_GENERIC_CONTRACT_KIND) {
      const admitted = admitLinuxGenericSandboxExecutionContract(raw, {
        origin: options.origin || "unknown",
        command: launch?.command,
        args: launch?.args,
        cwd: options.cwd || process.cwd(),
        shell: options.shell,
        sync: launch?.sync === true,
        pty: launch?.pty === true,
        stdio: options.stdio,
        requiredBoundaries,
      });
      if (!admitted) {
        return invalid(
          "sandboxExecutionContract was not issued for this workspace launch provenance",
        );
      }
      return admitted;
    }
    const mcpCapsule = raw?.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND;
    const consumed = mcpCapsule
      ? consumeMcpStdioCapsuleSandboxExecutionContract(raw, {
          origin: options.origin,
          command: launch?.command,
          args: launch?.args,
          cwd: options.cwd,
          shell: options.shell,
          requiredBoundaries,
          sync: launch?.sync === true,
          identityDigest: options.mcpStdioExecutableIdentityDigest,
        })
      : consumeIssuedPluginSandboxExecutionContract(raw, {
          origin: options.origin,
          command: launch?.command,
          args: launch?.args,
          cwd: options.cwd,
          pluginId: options.pluginId,
          pluginVersion: options.pluginVersion,
          pluginSource: options.pluginSource,
          pluginExecutableIdentity: options.pluginExecutableIdentity,
          requiredBoundaries,
          sync: launch?.sync === true,
        });
    if (!consumed) {
      return invalid(
        mcpCapsule
          ? "sandboxExecutionContract was not issued for this MCP capsule launch provenance"
          : "sandboxExecutionContract was not issued for this plugin launch provenance",
      );
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return invalid("sandboxExecutionContract must be an object");
    }
    const supportedKeys = new Set([
      "contractVersion",
      "kind",
      "pluginRoot",
      "workingDirectory",
      "runtimePath",
      "rootIdentity",
      "entryIdentity",
      "runtimeIdentity",
      "nativeCodePolicy",
    ]);
    const unsupportedKey = Object.keys(raw).find(
      (key) => !supportedKeys.has(key),
    );
    if (unsupportedKey) {
      return invalid(
        `sandboxExecutionContract contains unsupported field: ${unsupportedKey}`,
      );
    }
    if (
      raw.contractVersion !== 1 ||
      ![
        "strict-plugin-node-bin",
        "strict-plugin-native-static-elf-bin",
        "strict-plugin-native-elf-bin",
        MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
      ].includes(raw.kind)
    ) {
      return invalid("unsupported sandboxExecutionContract kind or version");
    }
    if (
      (mcpCapsule &&
        !isMcpStdioCapsuleNativeCodePolicy(raw.nativeCodePolicy)) ||
      (!mcpCapsule && raw.nativeCodePolicy !== undefined)
    ) {
      return invalid(
        "sandboxExecutionContract native-code policy is invalid for this contract kind",
      );
    }
    if (
      options.shell !== false ||
      (!mcpCapsule &&
        (options.origin !== "plugin:bin" ||
          typeof options.pluginId !== "string" ||
          !options.pluginId))
    ) {
      return invalid(
        mcpCapsule
          ? "sandboxExecutionContract is restricted to direct MCP capsule shell:false launches"
          : "sandboxExecutionContract is restricted to direct plugin:bin shell:false launches",
      );
    }

    for (const [label, value] of [
      ["pluginRoot", raw.pluginRoot],
      ["workingDirectory", raw.workingDirectory],
      ["runtimePath", raw.runtimePath],
    ]) {
      if (
        typeof value !== "string" ||
        !value ||
        value.includes("\0") ||
        !path.isAbsolute(value)
      ) {
        return invalid(`sandboxExecutionContract.${label} must be absolute`);
      }
    }
    const entryIdentity = this._normalizePluginExecutableIdentity(
      raw.entryIdentity,
    );
    const runtimeIdentity = this._normalizePluginExecutableIdentity(
      raw.runtimeIdentity,
    );
    const rootIdentity = this._normalizePluginRootIdentity(raw.rootIdentity);
    if (!rootIdentity || !entryIdentity || !runtimeIdentity) {
      return invalid(
        "sandboxExecutionContract requires attested root, entry, and runtime identities",
      );
    }
    if (
      rootIdentity.realPath !== raw.pluginRoot ||
      raw.runtimeIdentity?.requestedPath !== path.resolve(process.execPath) ||
      raw.runtimePath !== runtimeIdentity.realPath ||
      !path.isAbsolute(entryIdentity.realPath) ||
      !path.isAbsolute(runtimeIdentity.realPath)
    ) {
      return invalid(
        "sandboxExecutionContract identity paths do not match the launch contract",
      );
    }

    if (!mcpCapsule) {
      const provenanceIdentity = this._normalizePluginExecutableIdentity(
        options.pluginExecutableIdentity,
      );
      if (
        !provenanceIdentity ||
        provenanceIdentity.realPath !== entryIdentity.realPath ||
        provenanceIdentity.sha256 !== entryIdentity.sha256
      ) {
        return invalid(
          "sandboxExecutionContract entry identity does not match plugin provenance",
        );
      }
    }
    const entryRelative = path.relative(
      path.resolve(raw.pluginRoot),
      path.resolve(entryIdentity.realPath),
    );
    if (
      entryRelative === "" ||
      entryRelative === ".." ||
      entryRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(entryRelative)
    ) {
      return invalid(
        "sandboxExecutionContract entry must be inside pluginRoot",
      );
    }

    return Object.freeze({
      contractVersion: 1,
      kind: raw.kind,
      pluginRoot: raw.pluginRoot,
      workingDirectory: raw.workingDirectory,
      runtimePath: raw.runtimePath,
      rootIdentity,
      entryIdentity: this._freezeExecutableIdentity(entryIdentity),
      runtimeIdentity: this._freezeExecutableIdentity(runtimeIdentity),
      ...(mcpCapsule
        ? {
            nativeCodePolicy: Object.freeze({ ...raw.nativeCodePolicy }),
          }
        : {}),
    });
  }

  /**
   * Issue a private one-launch Linux workspace authority for trusted host
   * call-sites. The writable root is a positional host value, never read from
   * a manifest/spawn option. Unsupported platforms and mixed boundary sets
   * return null so the normal fail-closed adapter path remains authoritative.
   */
  issueLinuxWorkspaceSandboxExecutionContract(
    command,
    args = [],
    options = {},
    trustedWorkspaceRoot = process.cwd(),
    { sync = false, pty = false } = {},
  ) {
    const requiredBoundaries = [
      ...new Set([
        ...(options.requiredBoundaries || []),
        ...(options.sandboxPolicy?.requiredBoundaries || []),
      ]),
    ];
    if (
      process.platform !== "linux" ||
      requiredBoundaries.length === 0 ||
      (options.shell !== undefined &&
        options.shell !== null &&
        options.shell !== false) ||
      requiredBoundaries.some(
        (boundary) =>
          boundary !== SANDBOX_BOUNDARIES.FILESYSTEM &&
          boundary !== SANDBOX_BOUNDARIES.NETWORK &&
          boundary !== SANDBOX_BOUNDARIES.PROCESS_TREE,
      )
    ) {
      return null;
    }
    return issueLinuxGenericSandboxExecutionContract({
      origin: options.origin || "unknown",
      command,
      args,
      cwd: options.cwd || trustedWorkspaceRoot,
      workspaceRoot: trustedWorkspaceRoot,
      shell: options.shell,
      sync,
      pty,
      stdio: options.stdio,
      requiredBoundaries,
      detached: options.detached,
      uid: options.uid,
      gid: options.gid,
      argv0: options.argv0,
      serialization: options.serialization,
    });
  }

  _stripPluginControlOptions(options) {
    delete options.pluginId;
    delete options.pluginVersion;
    delete options.pluginSource;
    delete options.pluginExecutableIdentity;
  }

  _sandboxStrictEnabled() {
    return process.env.CC_SANDBOX_STRICT === "1";
  }

  _sandboxDisabledByEnvironment() {
    return process.env.CC_SANDBOX_DISABLE === "1";
  }

  /**
   * Normalize the public per-spawn boundary contract. `requiredBoundaries` is
   * retained as a top-level alias so callers can adopt the contract without
   * migrating all spawn options to `sandboxPolicy` in one change.
   *
   * @param {Object} options
   * @returns {{profile: "default"|"strict"|"network-only"|null, requiredBoundaries: string[]}}
   */
  _normalizeSandboxPolicy(options = {}, launch = {}) {
    const rawPolicy = options.sandboxPolicy;
    if (
      rawPolicy !== undefined &&
      (rawPolicy === null ||
        typeof rawPolicy !== "object" ||
        Array.isArray(rawPolicy))
    ) {
      throw this._sandboxBoundaryError(
        "invalid_sandbox_policy",
        "sandboxPolicy must be an object",
      );
    }

    const direct = options.requiredBoundaries;
    const nested = rawPolicy?.requiredBoundaries;
    for (const [name, value] of [
      ["requiredBoundaries", direct],
      ["sandboxPolicy.requiredBoundaries", nested],
    ]) {
      if (value !== undefined && !Array.isArray(value)) {
        throw this._sandboxBoundaryError(
          "invalid_required_boundaries",
          `${name} must be an array`,
        );
      }
    }

    const requiredBoundaries = [];
    for (const boundary of [...(direct || []), ...(nested || [])]) {
      if (
        typeof boundary !== "string" ||
        !SUPPORTED_SANDBOX_BOUNDARIES.has(boundary)
      ) {
        throw this._sandboxBoundaryError(
          "invalid_required_boundary",
          `Unsupported sandbox boundary: ${String(boundary)}`,
          {
            requiredBoundaries,
            missingBoundaries: [String(boundary)],
          },
        );
      }
      if (!requiredBoundaries.includes(boundary)) {
        requiredBoundaries.push(boundary);
      }
    }

    const profile = rawPolicy?.profile ?? null;
    if (profile !== null && !SUPPORTED_SANDBOX_PROFILES.has(profile)) {
      throw this._sandboxBoundaryError(
        "invalid_sandbox_profile",
        `Unsupported sandbox profile: ${String(profile)}`,
        { requiredBoundaries },
      );
    }
    const executionContract = this._normalizeSandboxExecutionContract(
      options.sandboxExecutionContract,
      options,
      requiredBoundaries,
      launch,
    );
    return { profile, requiredBoundaries, executionContract };
  }

  _stripSandboxControlOptions(options) {
    delete options.sandboxPolicy;
    delete options.requiredBoundaries;
    delete options.sandboxExecutionContract;
  }

  _stripWorkspaceTransactionOptions(options) {
    delete options.workspaceTransactionId;
    delete options.workspaceTransactionStateDir;
    delete options.workspaceTransactionCapture;
  }

  _sandboxUnavailablePlan(command, args, options, reason, sandboxPolicy = {}) {
    return {
      contractVersion: 1,
      applied: false,
      platform: process.platform,
      profile: sandboxPolicy.profile || "default",
      command,
      args: [...(args || [])],
      options: { ...options },
      enforcement: null,
      backend: null,
      guarantees: [],
      requiredBoundaries: [...(sandboxPolicy.requiredBoundaries || [])],
      reason,
      postSpawn: { required: false, mode: "none" },
    };
  }

  _sandboxError(reason, message = reason) {
    const error = new Error(message);
    error.code = "ERR_PROCESS_SANDBOX";
    error.sandboxReason = reason;
    return error;
  }

  _sandboxBoundaryError(reason, message = reason, metadata = {}) {
    const error = this._sandboxError(reason, message);
    error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
    error.sandboxFailClosed = true;
    error.requiredBoundaries = [...(metadata.requiredBoundaries || [])];
    error.actualGuarantees = [...(metadata.actualGuarantees || [])];
    error.missingBoundaries = [...(metadata.missingBoundaries || [])];
    error.sandboxBackend = metadata.sandboxBackend || null;
    error.sandboxCandidateBackend = metadata.sandboxCandidateBackend || null;
    error.sandboxRuntimeProbe = metadata.sandboxRuntimeProbe
      ? { ...metadata.sandboxRuntimeProbe }
      : null;
    error.sandboxPolicyAttested =
      typeof metadata.sandboxPolicyAttested === "boolean"
        ? metadata.sandboxPolicyAttested
        : null;
    error.sandboxPolicyDigest = metadata.sandboxPolicyDigest || null;
    error.sandboxCandidateReason = metadata.sandboxCandidateReason || null;
    return error;
  }

  _validateSandboxPlan(plan, launchContext = {}) {
    if (!plan || typeof plan !== "object") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox adapter returned no spawn plan",
      );
    }
    const authorityPlan = plan;
    const planSnapshot = ownDataObjectSnapshot(plan);
    if (!planSnapshot) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan must use own data properties",
      );
    }
    plan = planSnapshot;
    if (plan.contractVersion !== 1) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan contractVersion must be 1",
      );
    }
    if (typeof plan.applied !== "boolean") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan is missing applied:boolean",
      );
    }
    let planCommand = null;
    try {
      const commandDescriptor = Object.getOwnPropertyDescriptor(
        plan,
        "command",
      );
      if (
        commandDescriptor &&
        "value" in commandDescriptor &&
        typeof commandDescriptor.value === "string"
      ) {
        planCommand = commandDescriptor.value;
      }
    } catch {
      planCommand = null;
    }
    const planArgsSnapshot = denseOwnDataArraySnapshot(plan.args);
    if (planCommand === null || !planArgsSnapshot) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan must provide command and dense data-property args",
      );
    }
    const planOptionsSnapshot = ownDataObjectSnapshot(plan.options);
    if (!planOptionsSnapshot) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan must provide data-property options",
      );
    }
    if (plan.applied && typeof plan.enforcement !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Applied sandbox spawn plan must name its enforcement",
      );
    }
    if (!plan.applied && typeof plan.reason !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Unavailable sandbox spawn plan must provide a reason",
      );
    }
    const backend = plan.backend ?? plan.enforcement ?? null;
    if (plan.applied && typeof backend !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Applied sandbox spawn plan must name its backend",
      );
    }
    const guarantees = plan.guarantees ?? [];
    if (
      !Array.isArray(guarantees) ||
      guarantees.some(
        (boundary) =>
          typeof boundary !== "string" ||
          !SUPPORTED_SANDBOX_BOUNDARIES.has(boundary),
      )
    ) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox spawn plan guarantees must use supported boundary identifiers",
      );
    }
    const candidateBackend = plan.candidateBackend ?? null;
    if (candidateBackend !== null && typeof candidateBackend !== "string") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox candidate backend must be a string",
      );
    }
    const policyAttested = plan.policyAttested ?? null;
    if (policyAttested !== null && typeof policyAttested !== "boolean") {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox policy attestation must be boolean",
      );
    }
    const policyDigest = plan.policyDigest ?? null;
    if (
      policyDigest !== null &&
      (typeof policyDigest !== "string" || !/^[a-f0-9]{64}$/.test(policyDigest))
    ) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Sandbox policy digest must be a lowercase SHA-256 value",
      );
    }
    const linuxDescriptorBackend =
      plan.applied === true &&
      (backend === "linux-bwrap" || backend === "linux-bwrap-workspace");
    const linuxFdCodeSnapshotBackend =
      plan.applied === true &&
      (backend === "linux-fd-code-snapshot" ||
        plan.enforcement === "linux-fd-code-snapshot");
    let linuxDescriptorLaunch = null;
    let linuxDescriptorPtyLaunch = false;
    let linuxBubblewrapExecutableArgs = planArgsSnapshot;
    let sanitizedDescriptorScrubber = null;
    if (linuxFdCodeSnapshotBackend) {
      if (plan.platform !== "linux") {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Reserved Linux FD code snapshot backend requires platform linux",
        );
      }
      if (
        plan.backend !== "linux-fd-code-snapshot" ||
        plan.enforcement !== "linux-fd-code-snapshot"
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Reserved Linux FD code snapshot backend requires exact backend and enforcement names",
        );
      }
      if (launchContext.builtInSandboxAdapter !== true) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Applied Linux FD code snapshot plans require the built-in sandbox adapter",
        );
      }
      if (!guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT)) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Reserved Linux FD code snapshot backend requires the code-snapshot guarantee",
        );
      }
    }
    if (linuxDescriptorBackend) {
      if (plan.platform !== "linux") {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Reserved Linux bubblewrap backends require platform linux",
        );
      }
      if (launchContext.builtInSandboxAdapter !== true) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Applied Linux bubblewrap plans require the built-in sandbox adapter",
        );
      }
      const descriptorEvidence = plan.runtimeProbe?.descriptorScrubber;
      const descriptorEvidenceDescriptors = exactOwnDataDescriptors(
        descriptorEvidence,
        LINUX_DESCRIPTOR_SCRUBBER_EVIDENCE_KEYS,
      );
      const activeStdioThrough =
        backend === "linux-bwrap-workspace"
          ? descriptorEvidenceDescriptors?.activeStdioThrough?.value
          : 2;
      linuxDescriptorPtyLaunch =
        backend === "linux-bwrap-workspace" &&
        plan.ptyPolicy !== null &&
        plan.ptyPolicy !== undefined;
      if (linuxDescriptorPtyLaunch) {
        const innerArgs = Object.freeze([...planArgsSnapshot.slice(2)]);
        linuxDescriptorLaunch =
          planArgsSnapshot[0] === "--ctty" &&
          typeof planArgsSnapshot[1] === "string"
            ? parseLinuxBwrapDescriptorScrubbedLaunch(
                planArgsSnapshot[1],
                innerArgs,
                planOptionsSnapshot,
                { activeStdioThrough },
              )
            : null;
      } else {
        linuxDescriptorLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
          planCommand,
          planArgsSnapshot,
          planOptionsSnapshot,
          { activeStdioThrough },
        );
      }
      sanitizedDescriptorScrubber = sanitizeLinuxDescriptorScrubberEvidence(
        descriptorEvidence,
        linuxDescriptorLaunch,
      );
      const expectedExecutableChildFd = linuxDescriptorPtyLaunch
        ? activeStdioThrough + 2
        : backend === "linux-bwrap-workspace"
          ? activeStdioThrough + 1
          : 3;
      const outerPtyDescriptorValid =
        !linuxDescriptorPtyLaunch ||
        (planCommand === `/proc/self/fd/${activeStdioThrough + 1}` &&
          Number.isSafeInteger(
            linuxDescriptorLaunch?.stdio?.[activeStdioThrough + 1],
          ));
      if (
        !linuxDescriptorLaunch ||
        !sanitizedDescriptorScrubber ||
        linuxDescriptorLaunch.executableChildFd !== expectedExecutableChildFd ||
        !outerPtyDescriptorValid ||
        (backend === "linux-bwrap" &&
          (linuxDescriptorLaunch.activeStdioThrough !== 2 ||
            linuxDescriptorLaunch.nodeIpcChildFd !== null ||
            (plan.ptyPolicy !== null && plan.ptyPolicy !== undefined)))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Applied Linux bubblewrap plans require the exact typed descriptor scrubber launch contract",
        );
      }
      linuxBubblewrapExecutableArgs = linuxDescriptorLaunch.executableArgs;
    } else if (plan.runtimeProbe?.descriptorScrubber !== undefined) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Linux descriptor scrubber evidence requires an applied bubblewrap backend",
      );
    }
    let runtimeProbe = null;
    let genericWorkspaceProbe = false;
    let sanitizedFilesystemPolicy = null;
    let sanitizedNetworkPolicy = null;
    let sanitizedProcessTreePolicy = null;
    let sanitizedPtyPolicy = null;
    let windowsPlanBindingConsumed = false;
    let macPlanBindingConsumed = false;
    if (plan.runtimeProbe !== null && plan.runtimeProbe !== undefined) {
      if (
        typeof plan.runtimeProbe !== "object" ||
        Array.isArray(plan.runtimeProbe) ||
        typeof plan.runtimeProbe.kind !== "string" ||
        typeof plan.runtimeProbe.attempted !== "boolean" ||
        typeof plan.runtimeProbe.runnable !== "boolean" ||
        (plan.runtimeProbe.reason !== null &&
          typeof plan.runtimeProbe.reason !== "string")
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe must use the typed probe contract",
        );
      }
      for (const field of [
        "probeRuntime",
        "targetRuntime",
        "contentSnapshotScope",
        "contentSnapshotMechanism",
        "runtimeLaunchMechanism",
        "planBindingMechanism",
        "runtimeLaunchPath",
        "entrySnapshotPath",
        "pluginTreeContentSnapshotScope",
        "pluginTreeContentSnapshotMechanism",
        "pluginTreeSnapshotConsistency",
        "initialDynamicLoadClosureScope",
        "initialDynamicLoadClosureMechanism",
        "initialDynamicInterpreter",
        "runtimeSharedLibraryPathnameClosureExcludes",
        "runtimeSharedLibraryClosureScope",
        "runtimeSharedLibraryClosureMechanism",
        "targetDescriptorAllowlist",
        "targetRuntimeInvocationMode",
        "helperTeamIdentifier",
        "helperPackageIdentifier",
        "helperPackageVersion",
        "nativeCodePolicySchema",
        "nativeCodePolicyMode",
        "capsuleNativeCodeFormat",
        "nativeAddonLoading",
        "nativeAddonDenialMechanism",
        "hostRuntimeSharedLibraries",
        "anonymousExecutableMemory",
      ]) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          (typeof plan.runtimeProbe[field] !== "string" ||
            !plan.runtimeProbe[field])
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be a non-empty string`,
          );
        }
      }
      for (const field of [
        "contentSnapshot",
        "handleAtomic",
        "pluginTreeContentSnapshot",
        "pluginTreeSnapshotContractBound",
        "pluginTreeSnapshotAtomic",
        "initialDynamicLoadClosureDescriptorBound",
        "sharedLibraryClosure",
        "entrySnapshotAtomic",
        "runtimeLaunchAtomic",
        "mcpCapsuleCodeSnapshot",
        "runtimeDetachedChildSpawnVerified",
        "runtimeSharedLibraryPathnameClosure",
        "runtimeLoadSetPolicyBound",
        "runtimeWritableFilesystems",
        "runtimeProcfsMounted",
        "runtimeDevfsMounted",
        "runtimeScratchWritable",
        "runtimeDescriptorReopenPaths",
        "rootProtectedRuntimeSnapshot",
        "entryRootOwnedAnonymousSnapshot",
        "entrySourcePrePostStat",
        "entryWriterClosedBeforeReadonlyReopen",
        "entryReadonlyIdentityRechecked",
        "entryUnlinkedAndDirectoryFsyncedBeforeTarget",
        "targetInheritedEntrySnapshotOnly",
        "runtimeAndCapsuleSlotsNullBeforeExec",
        "bootstrapClosesNullAndReadyDescriptors",
        "actualRuntimeReadyHandshake",
        "runtimeSnapshotUnlinkedBeforeEntryRelease",
        "callerCredentialDropIrreversible",
        "relayParentCredentialsDropped",
        "callerLifelineWatched",
        "signalRelayNonblocking",
        "pkgExecPathMagicBound",
        "capsuleRootDescriptorBound",
        "capsulePathObjectAtomic",
        "sandboxProfileFixedAndDigestBound",
        "processForkExplicitlyDenied",
        "sandboxExecLiveGateContract",
        "globalLaunchSerialization",
        "nativeCodePolicyBound",
      ]) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          typeof plan.runtimeProbe[field] !== "boolean"
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be boolean`,
          );
        }
      }
      for (const field of [
        "pluginTreeContentSnapshotFiles",
        "pluginTreeContentSnapshotBytes",
        "initialDynamicDependencyCount",
        "initialDynamicRuntimeFileCount",
        "initialDynamicRuntimeBytes",
        "runtimeSharedLibraryLoadSetFiles",
        "runtimeSharedLibraryLoadSetBytes",
        "runtimeSnapshotBytes",
        "runtimeAttestedBytes",
        "entrySnapshotBytes",
        "capabilityCount",
        "maximumStaleSnapshots",
      ]) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          (!Number.isSafeInteger(plan.runtimeProbe[field]) ||
            plan.runtimeProbe[field] < 0)
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be a non-negative safe integer`,
          );
        }
      }
      for (const field of [
        "runtimeSnapshotSha256",
        "runtimeAttestedSha256",
        "entrySnapshotSha256",
        "entrySnapshotBootstrapSha256",
        "helperSha256",
        "helperSourceSha256",
        "helperProtocolSha256",
        "helperInstallContractSha256",
        "helperDesignatedRequirementSha256",
        "installAttestationDigest",
        "planBindingDigest",
        "nativeCodePolicyDigest",
      ]) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          (typeof plan.runtimeProbe[field] !== "string" ||
            !/^[a-f0-9]{64}$/.test(plan.runtimeProbe[field]))
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be a lowercase SHA-256 value`,
          );
        }
      }
      const planBindingDeclared =
        plan.runtimeProbe.planBindingMechanism !== undefined ||
        plan.runtimeProbe.planBindingDigest !== undefined;
      const typedCodeSnapshotPlanBinding =
        (plan.platform === "win32" &&
          plan.runtimeProbe.planBindingMechanism ===
            "windows-mcp-code-snapshot-plan-binding-v1") ||
        (plan.platform === "darwin" &&
          plan.runtimeProbe.planBindingMechanism ===
            "macos-mcp-code-snapshot-plan-binding-v1");
      if (
        planBindingDeclared &&
        (!typedCodeSnapshotPlanBinding ||
          !guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) ||
          !/^[a-f0-9]{64}$/.test(plan.runtimeProbe.planBindingDigest || ""))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe plan binding must use a typed platform MCP code-snapshot contract",
        );
      }
      if (
        plan.runtimeProbe.pluginTreeContentSnapshotDigest !== undefined &&
        (typeof plan.runtimeProbe.pluginTreeContentSnapshotDigest !==
          "string" ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.pluginTreeContentSnapshotDigest,
          ))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe pluginTreeContentSnapshotDigest must be a lowercase SHA-256 value",
        );
      }
      if (
        plan.runtimeProbe.initialDynamicLoadClosureDigest !== undefined &&
        (typeof plan.runtimeProbe.initialDynamicLoadClosureDigest !==
          "string" ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.initialDynamicLoadClosureDigest,
          ))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe initialDynamicLoadClosureDigest must be a lowercase SHA-256 value",
        );
      }
      if (
        plan.runtimeProbe.runtimeSharedLibraryLoadSetDigest !== undefined &&
        (typeof plan.runtimeProbe.runtimeSharedLibraryLoadSetDigest !==
          "string" ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.runtimeSharedLibraryLoadSetDigest,
          ))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe runtimeSharedLibraryLoadSetDigest must be a lowercase SHA-256 value",
        );
      }
      const pluginTreeSnapshot =
        plan.runtimeProbe.pluginTreeContentSnapshot === true;
      const pluginTreeEvidenceFields = [
        "pluginTreeContentSnapshotScope",
        "pluginTreeContentSnapshotMechanism",
        "pluginTreeContentSnapshotFiles",
        "pluginTreeContentSnapshotBytes",
        "pluginTreeContentSnapshotDigest",
        "pluginTreeSnapshotConsistency",
        "pluginTreeSnapshotContractBound",
        "pluginTreeSnapshotAtomic",
      ];
      const nodePluginTreeSnapshotEvidence =
        plan.runtimeProbe.kind === "linux-bwrap-plugin-node-policy-v1" &&
        plan.runtimeProbe.targetRuntime === "node" &&
        plan.runtimeProbe.contentSnapshotScope === "plugin-entry-source";
      const nativePluginRuntimeEvidence =
        (plan.runtimeProbe.kind ===
          "linux-bwrap-plugin-native-static-elf-policy-v1" &&
          plan.runtimeProbe.targetRuntime === "native-static-elf") ||
        (plan.runtimeProbe.kind ===
          "linux-bwrap-plugin-native-dynamic-elf-policy-v1" &&
          plan.runtimeProbe.targetRuntime === "native-dynamic-elf");
      const nativePluginTreeSnapshotEvidence =
        nativePluginRuntimeEvidence &&
        plan.runtimeProbe.contentSnapshotScope === "plugin-entry-executable";
      if (
        pluginTreeSnapshot &&
        (plan.applied !== true ||
          plan.platform !== "linux" ||
          plan.enforcement !== "linux-bwrap" ||
          backend !== "linux-bwrap" ||
          candidateBackend !== null ||
          policyAttested !== true ||
          policyDigest === null ||
          !guarantees.includes(SANDBOX_BOUNDARIES.FILESYSTEM) ||
          !guarantees.includes(SANDBOX_BOUNDARIES.NETWORK) ||
          plan.runtimeProbe.attempted !== true ||
          plan.runtimeProbe.runnable !== true ||
          plan.runtimeProbe.reason !== null ||
          (!nodePluginTreeSnapshotEvidence &&
            !nativePluginTreeSnapshotEvidence) ||
          plan.runtimeProbe.probeRuntime !== "node" ||
          plan.runtimeProbe.contentSnapshot !== true ||
          plan.runtimeProbe.contentSnapshotMechanism !==
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1" ||
          plan.runtimeProbe.handleAtomic !== false ||
          plan.runtimeProbe.supervisorDescriptorBound !== true ||
          plan.runtimeProbe.pluginTreeContentSnapshotScope !==
            "all-pinned-plugin-regular-files" ||
          plan.runtimeProbe.pluginTreeContentSnapshotMechanism !==
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1" ||
          !Number.isSafeInteger(
            plan.runtimeProbe.pluginTreeContentSnapshotFiles,
          ) ||
          plan.runtimeProbe.pluginTreeContentSnapshotFiles < 1 ||
          plan.runtimeProbe.pluginTreeContentSnapshotFiles > 256 ||
          !Number.isSafeInteger(
            plan.runtimeProbe.pluginTreeContentSnapshotBytes,
          ) ||
          plan.runtimeProbe.pluginTreeContentSnapshotBytes < 0 ||
          plan.runtimeProbe.pluginTreeContentSnapshotBytes >
            256 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.pluginTreeContentSnapshotDigest || "",
          ) ||
          plan.runtimeProbe.pluginTreeSnapshotConsistency !==
            "per-file-pin-to-launch" ||
          plan.runtimeProbe.pluginTreeSnapshotContractBound !== false ||
          plan.runtimeProbe.pluginTreeSnapshotAtomic !== false)
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe plugin tree snapshot evidence must use the typed complete-tree contract",
        );
      }
      if (
        !pluginTreeSnapshot &&
        pluginTreeEvidenceFields.some(
          (field) => plan.runtimeProbe[field] !== undefined,
        )
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe plugin tree snapshot evidence requires pluginTreeContentSnapshot",
        );
      }
      const successfulNativeProbe =
        plan.applied === true &&
        plan.runtimeProbe.attempted === true &&
        plan.runtimeProbe.runnable === true &&
        plan.runtimeProbe.reason === null &&
        nativePluginRuntimeEvidence;
      if (successfulNativeProbe && !pluginTreeSnapshot) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Successful Linux native plugin evidence requires a complete plugin tree snapshot",
        );
      }
      const supervisorStringFields = [
        "supervisorBindingScope",
        "supervisorDescriptorBindingMechanism",
        "supervisorPid1ExecutableExposure",
      ];
      const supervisorBooleanFields = [
        "supervisorDescriptorBound",
        "supervisorExecutablePinned",
        "supervisorDescriptorContained",
        "supervisorDescriptorConsumedBeforeTarget",
        "supervisorStagingPathHidden",
        "supervisorTemporaryCopyObscured",
      ];
      for (const field of supervisorStringFields) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          (typeof plan.runtimeProbe[field] !== "string" ||
            !plan.runtimeProbe[field])
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be a non-empty string`,
          );
        }
      }
      for (const field of supervisorBooleanFields) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          typeof plan.runtimeProbe[field] !== "boolean"
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be boolean`,
          );
        }
      }
      const supervisorIdentity = plan.runtimeProbe.supervisorExecutableIdentity;
      if (supervisorIdentity !== undefined) {
        const fileId = supervisorIdentity?.fileId;
        if (
          !supervisorIdentity ||
          typeof supervisorIdentity !== "object" ||
          Array.isArray(supervisorIdentity) ||
          typeof supervisorIdentity.path !== "string" ||
          !supervisorIdentity.path.startsWith("/") ||
          !fileId ||
          typeof fileId !== "object" ||
          Array.isArray(fileId) ||
          typeof fileId.dev !== "string" ||
          !/^\d+$/.test(fileId.dev) ||
          typeof fileId.ino !== "string" ||
          !/^\d+$/.test(fileId.ino) ||
          typeof supervisorIdentity.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(supervisorIdentity.sha256) ||
          !Number.isSafeInteger(supervisorIdentity.bytes) ||
          supervisorIdentity.bytes <= 0 ||
          supervisorIdentity.bytes > 256 * 1024 * 1024 ||
          !Number.isFinite(supervisorIdentity.mtimeMs) ||
          !Number.isSafeInteger(supervisorIdentity.mode) ||
          supervisorIdentity.mode <= 0 ||
          (supervisorIdentity.mode & 0o170000) !== 0o100000 ||
          (supervisorIdentity.mode & 0o111) === 0 ||
          (supervisorIdentity.mode & 0o022) !== 0 ||
          !Number.isSafeInteger(supervisorIdentity.uid) ||
          supervisorIdentity.uid !== 0 ||
          !Number.isSafeInteger(supervisorIdentity.gid) ||
          supervisorIdentity.gid < 0
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            "Sandbox runtime probe supervisorExecutableIdentity must use the typed executable identity contract",
          );
        }
      }
      const supervisorBound =
        plan.runtimeProbe.supervisorDescriptorBound === true;
      const runtimeSharedLibraryPathnameClosure =
        plan.runtimeProbe.runtimeSharedLibraryPathnameClosure === true;
      if (
        supervisorBound &&
        (plan.runtimeProbe.supervisorExecutablePinned !== true ||
          supervisorIdentity === undefined ||
          plan.runtimeProbe.supervisorBindingScope !==
            "host-path-replacement" ||
          plan.runtimeProbe.supervisorDescriptorBindingMechanism !==
            "pinned-child-fd3-file-consume-run-overmount-v1" ||
          plan.runtimeProbe.supervisorPid1ExecutableExposure !==
            (runtimeSharedLibraryPathnameClosure
              ? "procfs-not-mounted"
              : "procfs"))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe bound supervisor evidence must include its typed identity and binding contract",
        );
      }
      for (const field of [
        "supervisorDescriptorContained",
        "supervisorDescriptorConsumedBeforeTarget",
        "supervisorStagingPathHidden",
        "supervisorTemporaryCopyObscured",
      ]) {
        if (
          (plan.runtimeProbe[field] === true &&
            (!supervisorBound || plan.runtimeProbe.runnable !== true)) ||
          (supervisorBound &&
            plan.runtimeProbe[field] !== plan.runtimeProbe.runnable)
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} requires a runnable bound supervisor`,
          );
        }
      }
      const initialDynamicLoadClosureBound =
        plan.runtimeProbe.initialDynamicLoadClosureDescriptorBound === true;
      const initialDynamicEvidenceFields = [
        "initialDynamicLoadClosureScope",
        "initialDynamicLoadClosureMechanism",
        "initialDynamicInterpreter",
        "initialDynamicDependencyCount",
        "initialDynamicRuntimeFileCount",
        "initialDynamicRuntimeBytes",
        "initialDynamicLoadClosureDigest",
      ];
      const initialDynamicInterpreter =
        plan.runtimeProbe.initialDynamicInterpreter;
      const initialDynamicDependencyCount =
        plan.runtimeProbe.initialDynamicDependencyCount;
      const initialDynamicRuntimeFileCount =
        plan.runtimeProbe.initialDynamicRuntimeFileCount;
      const initialDynamicRuntimeBytes =
        plan.runtimeProbe.initialDynamicRuntimeBytes;
      const successfulDynamicProbe =
        plan.applied === true &&
        plan.runtimeProbe.kind ===
          "linux-bwrap-plugin-native-dynamic-elf-policy-v1" &&
        plan.runtimeProbe.runnable === true;
      if (
        initialDynamicLoadClosureBound &&
        (plan.applied !== true ||
          plan.platform !== "linux" ||
          plan.enforcement !== "linux-bwrap" ||
          backend !== "linux-bwrap" ||
          candidateBackend !== null ||
          policyAttested !== true ||
          policyDigest === null ||
          !guarantees.includes(SANDBOX_BOUNDARIES.FILESYSTEM) ||
          !guarantees.includes(SANDBOX_BOUNDARIES.NETWORK) ||
          plan.runtimeProbe.attempted !== true ||
          plan.runtimeProbe.runnable !== true ||
          plan.runtimeProbe.reason !== null ||
          plan.runtimeProbe.kind !==
            "linux-bwrap-plugin-native-dynamic-elf-policy-v1" ||
          plan.runtimeProbe.probeRuntime !== "node" ||
          plan.runtimeProbe.targetRuntime !== "native-dynamic-elf" ||
          plan.runtimeProbe.contentSnapshot !== true ||
          plan.runtimeProbe.contentSnapshotScope !==
            "plugin-entry-executable" ||
          plan.runtimeProbe.contentSnapshotMechanism !==
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1" ||
          plan.runtimeProbe.handleAtomic !== false ||
          plan.runtimeProbe.sharedLibraryClosure !== false ||
          !supervisorBound ||
          plan.runtimeProbe.initialDynamicLoadClosureScope !==
            "initial-pt_interp-and-recursive-dt_needed-attested-system-graph" ||
          plan.runtimeProbe.initialDynamicLoadClosureMechanism !==
            "recursive-parsed-elf-system-graph-to-attested-runtime-fds-v1" ||
          typeof initialDynamicInterpreter !== "string" ||
          !path.posix.isAbsolute(initialDynamicInterpreter) ||
          path.posix.normalize(initialDynamicInterpreter) !==
            initialDynamicInterpreter ||
          !["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some((prefix) =>
            initialDynamicInterpreter.startsWith(prefix),
          ) ||
          !Number.isSafeInteger(initialDynamicDependencyCount) ||
          initialDynamicDependencyCount < 0 ||
          initialDynamicDependencyCount > 1024 ||
          !Number.isSafeInteger(initialDynamicRuntimeFileCount) ||
          initialDynamicRuntimeFileCount < 1 ||
          initialDynamicRuntimeFileCount > 256 ||
          !Number.isSafeInteger(initialDynamicRuntimeBytes) ||
          initialDynamicRuntimeBytes < 1 ||
          initialDynamicRuntimeBytes > 512 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.initialDynamicLoadClosureDigest || "",
          ))
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe initial recursive dynamic system graph evidence must use the typed descriptor-bound contract",
        );
      }
      if (
        !initialDynamicLoadClosureBound &&
        initialDynamicEvidenceFields.some(
          (field) => plan.runtimeProbe[field] !== undefined,
        )
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe initial recursive dynamic system graph evidence requires initialDynamicLoadClosureDescriptorBound",
        );
      }
      if (successfulDynamicProbe && !initialDynamicLoadClosureBound) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe successful dynamic ELF evidence requires a descriptor-bound initial recursive system graph",
        );
      }
      const runtimePathnameClosureEvidenceFields = [
        "runtimeSharedLibraryPathnameClosureExcludes",
        "runtimeSharedLibraryClosureScope",
        "runtimeSharedLibraryClosureMechanism",
        "runtimeSharedLibraryLoadSetFiles",
        "runtimeSharedLibraryLoadSetBytes",
        "runtimeSharedLibraryLoadSetDigest",
        "runtimeLoadSetPolicyBound",
        "runtimeWritableFilesystems",
        "runtimeProcfsMounted",
        "runtimeDevfsMounted",
        "runtimeScratchWritable",
        "runtimeDescriptorReopenPaths",
      ];
      const runtimePathnameMountPolicy =
        parseLinuxRuntimePathnameClosurePolicyArgs(
          linuxBubblewrapExecutableArgs,
          plan.runtimeProbe.runtimeSharedLibraryLoadSetFiles,
        ) !== null;
      if (
        runtimeSharedLibraryPathnameClosure &&
        (!successfulDynamicProbe ||
          !initialDynamicLoadClosureBound ||
          plan.runtimeProbe.sharedLibraryClosure !== false ||
          plan.runtimeProbe.runtimeSharedLibraryPathnameClosureExcludes !==
            "anonymous-jit-and-custom-in-process-loader" ||
          plan.runtimeProbe.runtimeSharedLibraryClosureScope !==
            "all-pathname-visible-regular-files-in-read-only-bwrap-namespace" ||
          plan.runtimeProbe.runtimeSharedLibraryClosureMechanism !==
            "descriptor-pinned-hashed-ro-mount-set-plus-loader-fd-and-namespace-mutation-seccomp-v2" ||
          !Number.isSafeInteger(
            plan.runtimeProbe.runtimeSharedLibraryLoadSetFiles,
          ) ||
          plan.runtimeProbe.runtimeSharedLibraryLoadSetFiles < 1 ||
          plan.runtimeProbe.runtimeSharedLibraryLoadSetFiles > 512 ||
          !Number.isSafeInteger(
            plan.runtimeProbe.runtimeSharedLibraryLoadSetBytes,
          ) ||
          plan.runtimeProbe.runtimeSharedLibraryLoadSetBytes < 1 ||
          plan.runtimeProbe.runtimeSharedLibraryLoadSetBytes >
            1024 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.runtimeSharedLibraryLoadSetDigest || "",
          ) ||
          plan.runtimeProbe.runtimeLoadSetPolicyBound !== true ||
          plan.runtimeProbe.runtimeWritableFilesystems !== false ||
          plan.runtimeProbe.runtimeProcfsMounted !== false ||
          plan.runtimeProbe.runtimeDevfsMounted !== false ||
          plan.runtimeProbe.runtimeScratchWritable !== false ||
          plan.runtimeProbe.runtimeDescriptorReopenPaths !== false ||
          plan.runtimeProbe.supervisorPid1ExecutableExposure !==
            "procfs-not-mounted" ||
          !runtimePathnameMountPolicy)
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe pathname shared-library closure must use the typed read-only no-proc bwrap contract",
        );
      }
      if (
        !runtimeSharedLibraryPathnameClosure &&
        runtimePathnameClosureEvidenceFields.some(
          (field) => plan.runtimeProbe[field] !== undefined,
        )
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Sandbox runtime probe pathname shared-library evidence requires runtimeSharedLibraryPathnameClosure",
        );
      }
      if (successfulDynamicProbe && !runtimeSharedLibraryPathnameClosure) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Successful dynamic ELF evidence requires a runtime pathname shared-library closure",
        );
      }
      const nativeCodeEvidenceFields = [
        "nativeCodePolicyBound",
        "nativeCodePolicySchema",
        "nativeCodePolicyDigest",
        "nativeCodePolicyMode",
        "capsuleNativeCodeFormat",
        "nativeAddonLoading",
        "nativeAddonDenialMechanism",
        "hostRuntimeSharedLibraries",
        "anonymousExecutableMemory",
      ];
      const nativeAddonLoadingGuaranteed = guarantees.includes(
        SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
      );
      const capsuleExecutionContract = launchContext.executionContract;
      const expectedNativeCodePolicy =
        capsuleExecutionContract?.nativeCodePolicy;
      const nativeCodePolicyEvidenceValid =
        nativeAddonLoadingGuaranteed &&
        guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) &&
        capsuleExecutionContract?.kind ===
          MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND &&
        isMcpStdioCapsuleNativeCodePolicy(expectedNativeCodePolicy) &&
        plan.runtimeProbe.nativeCodePolicyBound === true &&
        plan.runtimeProbe.nativeCodePolicySchema ===
          expectedNativeCodePolicy.schema &&
        plan.runtimeProbe.nativeCodePolicyDigest ===
          mcpStdioCapsuleNativeCodePolicyDigest(expectedNativeCodePolicy) &&
        plan.runtimeProbe.nativeCodePolicyMode ===
          expectedNativeCodePolicy.mode &&
        plan.runtimeProbe.capsuleNativeCodeFormat ===
          expectedNativeCodePolicy.capsuleFormat &&
        plan.runtimeProbe.nativeAddonLoading ===
          expectedNativeCodePolicy.nativeAddonLoading &&
        plan.runtimeProbe.nativeAddonDenialMechanism ===
          expectedNativeCodePolicy.nativeAddonDenialMechanism &&
        plan.runtimeProbe.hostRuntimeSharedLibraries ===
          expectedNativeCodePolicy.hostRuntimeSharedLibraries &&
        plan.runtimeProbe.anonymousExecutableMemory ===
          expectedNativeCodePolicy.anonymousExecutableMemory &&
        plan.runtimeProbe.sharedLibraryClosure === false;
      if (nativeAddonLoadingGuaranteed && !nativeCodePolicyEvidenceValid) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Native-addon loading guarantee requires the exact deny-native-addons capsule policy",
        );
      }
      if (
        !nativeAddonLoadingGuaranteed &&
        nativeCodeEvidenceFields.some(
          (field) => plan.runtimeProbe[field] !== undefined,
        )
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Native-addon policy evidence requires its sandbox guarantee",
        );
      }
      if (
        capsuleExecutionContract?.kind ===
          MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND &&
        guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) &&
        !nativeCodePolicyEvidenceValid
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "MCP capsule code snapshots require a bound native-addon denial policy",
        );
      }
      const codeSnapshotGuaranteed = guarantees.includes(
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      );
      if (codeSnapshotGuaranteed) {
        const executionContract = launchContext.executionContract;
        const launchArgs = Array.isArray(launchContext.args)
          ? launchContext.args
          : [];
        const windowsPlanBindingDeclared =
          plan.platform === "win32" &&
          (plan.runtimeProbe.planBindingMechanism !== undefined ||
            plan.runtimeProbe.planBindingDigest !== undefined);
        const macPlanBindingDeclared =
          plan.platform === "darwin" &&
          (plan.runtimeProbe.planBindingMechanism !== undefined ||
            plan.runtimeProbe.planBindingDigest !== undefined);
        // Consume before evaluating any other privileged-helper evidence. A genuine
        // one-launch plan is therefore burned by its first admission attempt,
        // including an attempt with a mismatched command or contract.
        windowsPlanBindingConsumed = windowsPlanBindingDeclared
          ? consumeWindowsMcpCodeSnapshotPlanBinding(authorityPlan, {
              command: launchContext.command,
              args: launchArgs,
              cwd: launchContext.cwd,
              shell: launchContext.shell,
              detached: launchContext.detached,
              executionContract,
              profile: launchContext.profile,
              requiredBoundaries: launchContext.requiredBoundaries,
              sync: launchContext.sync,
            })
          : false;
        macPlanBindingConsumed = macPlanBindingDeclared
          ? consumeMacMcpCodeSnapshotPlanBinding(authorityPlan, {
              command: launchContext.command,
              args: launchArgs,
              cwd: launchContext.cwd,
              shell: launchContext.shell,
              detached: launchContext.detached,
              executionContract,
              profile: launchContext.profile,
              requiredBoundaries: launchContext.requiredBoundaries,
              sync: launchContext.sync,
            })
          : false;
        const passthroughArgsMatch = (candidateArgs) =>
          candidateArgs.length === Math.max(0, launchArgs.length - 1) &&
          candidateArgs.every(
            (candidateArg, index) => candidateArg === launchArgs[index + 1],
          );
        const contractBoundSnapshotEvidence =
          executionContract?.contractVersion === 1 &&
          executionContract.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND &&
          typeof launchContext.command === "string" &&
          launchContext.command === executionContract.runtimePath &&
          launchContext.command ===
            executionContract.runtimeIdentity?.realPath &&
          launchArgs.length >= 1 &&
          launchArgs[0] === executionContract.entryIdentity?.realPath &&
          /^[a-f0-9]{64}$/.test(
            executionContract.runtimeIdentity?.sha256 || "",
          ) &&
          Number.isSafeInteger(executionContract.runtimeIdentity?.bytes) &&
          executionContract.runtimeIdentity.bytes > 0 &&
          /^[a-f0-9]{64}$/.test(
            executionContract.entryIdentity?.sha256 || "",
          ) &&
          Number.isSafeInteger(executionContract.entryIdentity?.bytes) &&
          executionContract.entryIdentity.bytes >= 0 &&
          plan.runtimeProbe.entrySnapshotSha256 ===
            executionContract.entryIdentity.sha256 &&
          plan.runtimeProbe.entrySnapshotBytes ===
            executionContract.entryIdentity.bytes;
        const linuxRuntimeSnapshotContractBound =
          plan.runtimeProbe.runtimeSnapshotSha256 ===
            executionContract?.runtimeIdentity?.sha256 &&
          plan.runtimeProbe.runtimeSnapshotBytes ===
            executionContract?.runtimeIdentity?.bytes &&
          plan.runtimeProbe.runtimeAttestedSha256 === undefined &&
          plan.runtimeProbe.runtimeAttestedBytes === undefined;
        const macRuntimeSnapshotContractBound =
          linuxRuntimeSnapshotContractBound;
        const windowsRuntimeAttestationContractBound =
          plan.runtimeProbe.runtimeAttestedSha256 ===
            executionContract?.runtimeIdentity?.sha256 &&
          plan.runtimeProbe.runtimeAttestedBytes ===
            executionContract?.runtimeIdentity?.bytes &&
          plan.runtimeProbe.runtimeSnapshotSha256 === undefined &&
          plan.runtimeProbe.runtimeSnapshotBytes === undefined;
        const contractEntryRelative = executionContract
          ? path.posix.relative(
              executionContract.pluginRoot,
              executionContract.entryIdentity.realPath,
            )
          : null;
        const expectedLinuxBubblewrapEntry =
          contractEntryRelative &&
          contractEntryRelative !== ".." &&
          !contractEntryRelative.startsWith("../") &&
          !path.posix.isAbsolute(contractEntryRelative)
            ? path.posix.join("/opt/chainless/plugin", contractEntryRelative)
            : null;
        const exactSnapshotEvidence =
          plan.applied === true &&
          candidateBackend === null &&
          contractBoundSnapshotEvidence &&
          plan.runtimeProbe.attempted === true &&
          plan.runtimeProbe.runnable === true &&
          plan.runtimeProbe.reason === null &&
          plan.runtimeProbe.probeRuntime === "node" &&
          plan.runtimeProbe.targetRuntime === "node" &&
          plan.runtimeProbe.contentSnapshot === true &&
          plan.runtimeProbe.entrySnapshotAtomic === true &&
          plan.runtimeProbe.runtimeLaunchAtomic === true &&
          plan.runtimeProbe.sharedLibraryClosure === false &&
          /^[a-f0-9]{64}$/.test(plan.runtimeProbe.entrySnapshotSha256 || "") &&
          Number.isSafeInteger(plan.runtimeProbe.entrySnapshotBytes) &&
          plan.runtimeProbe.entrySnapshotBytes >= 0 &&
          plan.runtimeProbe.entrySnapshotBytes <= 64 * 1024 * 1024;
        const linuxSnapshotEvidence =
          launchContext.builtInSandboxAdapter === true &&
          plan.platform === "linux" &&
          backend === "linux-fd-code-snapshot" &&
          plan.enforcement === "linux-fd-code-snapshot" &&
          policyAttested === true &&
          policyDigest !== null &&
          plan.runtimeProbe.kind === "linux-mcp-capsule-code-snapshot-v1" &&
          plan.runtimeProbe.contentSnapshotScope ===
            "mcp-capsule-entry-and-node-runtime" &&
          plan.runtimeProbe.contentSnapshotMechanism ===
            "verified-o_tmpfile-copy-inherited-fd-module-compile-v1" &&
          plan.runtimeProbe.handleAtomic === true &&
          plan.runtimeProbe.entrySnapshotAtomic === true &&
          plan.runtimeProbe.runtimeLaunchAtomic === true &&
          plan.runtimeProbe.runtimeLaunchMechanism ===
            "inherited-executable-fd-v1" &&
          plan.runtimeProbe.entrySnapshotBootstrapSha256 ===
            MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256 &&
          linuxRuntimeSnapshotContractBound &&
          /^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.runtimeSnapshotSha256 || "",
          ) &&
          Number.isSafeInteger(plan.runtimeProbe.runtimeSnapshotBytes) &&
          plan.runtimeProbe.runtimeSnapshotBytes > 0 &&
          plan.runtimeProbe.runtimeSnapshotBytes <= 256 * 1024 * 1024 &&
          /^\/proc\/self\/fd\/\d+$/.test(planCommand) &&
          planArgsSnapshot[0] === "-e" &&
          crypto
            .createHash("sha256")
            .update(planArgsSnapshot[1] || "")
            .digest("hex") === MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256 &&
          planArgsSnapshot[2] === "--" &&
          passthroughArgsMatch(planArgsSnapshot.slice(3));
        const linuxBubblewrapTargetSeparator =
          linuxBubblewrapExecutableArgs.indexOf("--");
        const linuxBubblewrapSnapshotEvidence =
          launchContext.builtInSandboxAdapter === true &&
          plan.platform === "linux" &&
          backend === "linux-bwrap" &&
          plan.enforcement === "linux-bwrap" &&
          policyAttested === true &&
          policyDigest !== null &&
          plan.runtimeProbe.kind === "linux-bwrap-plugin-node-policy-v1" &&
          plan.runtimeProbe.mcpCapsuleCodeSnapshot === true &&
          plan.runtimeProbe.contentSnapshotScope === "plugin-entry-source" &&
          plan.runtimeProbe.contentSnapshotMechanism ===
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1" &&
          plan.runtimeProbe.handleAtomic === false &&
          plan.runtimeProbe.entrySnapshotAtomic === true &&
          plan.runtimeProbe.runtimeLaunchAtomic === true &&
          plan.runtimeProbe.runtimeLaunchMechanism ===
            "bwrap-descriptor-mount-node-runtime-exec-v1" &&
          plan.runtimeProbe.runtimeDetachedChildSpawnVerified === true &&
          plan.runtimeProbe.supervisorDescriptorBound === true &&
          plan.runtimeProbe.pluginTreeContentSnapshot === true &&
          plan.runtimeProbe.runtimeLaunchPath ===
            "/opt/chainless/runtime/node" &&
          expectedLinuxBubblewrapEntry !== null &&
          plan.runtimeProbe.entrySnapshotPath ===
            expectedLinuxBubblewrapEntry &&
          linuxRuntimeSnapshotContractBound &&
          /^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.runtimeSnapshotSha256 || "",
          ) &&
          Number.isSafeInteger(plan.runtimeProbe.runtimeSnapshotBytes) &&
          plan.runtimeProbe.runtimeSnapshotBytes > 0 &&
          plan.runtimeProbe.runtimeSnapshotBytes <= 256 * 1024 * 1024 &&
          /^\/proc\/self\/fd\/\d+$/.test(planCommand) &&
          linuxBubblewrapTargetSeparator >= 0 &&
          linuxBubblewrapExecutableArgs[linuxBubblewrapTargetSeparator + 1] ===
            plan.runtimeProbe.runtimeLaunchPath &&
          linuxBubblewrapExecutableArgs[linuxBubblewrapTargetSeparator + 2] ===
            plan.runtimeProbe.entrySnapshotPath &&
          passthroughArgsMatch(
            linuxBubblewrapExecutableArgs.slice(
              linuxBubblewrapTargetSeparator + 3,
            ),
          );
        const macProtocol = MACOS_MCP_LAUNCHER_INPUTS.protocol;
        const macStdio = planOptionsSnapshot.stdio;
        const macSnapshotPath = path.posix.join(
          macProtocol.snapshotRoot,
          planArgsSnapshot[1] || "invalid",
          "node",
        );
        const macSnapshotEvidence =
          plan.platform === "darwin" &&
          backend === macProtocol.backend &&
          plan.enforcement === macProtocol.backend &&
          policyAttested === true &&
          policyDigest !== null &&
          plan.runtimeProbe.kind === "darwin-mcp-capsule-code-snapshot-v2" &&
          plan.runtimeProbe.contentSnapshotScope ===
            "mcp-capsule-entry-and-node-runtime" &&
          plan.runtimeProbe.contentSnapshotMechanism ===
            "signed-root-runtime-path-and-anonymous-entry-fd-snapshots-v1" &&
          plan.runtimeProbe.handleAtomic === true &&
          plan.runtimeProbe.entrySnapshotAtomic === true &&
          plan.runtimeProbe.runtimeLaunchAtomic === true &&
          plan.runtimeProbe.runtimeLaunchMechanism ===
            "signed-root-helper-fd-copy-protected-path-ready-gate-v1" &&
          plan.runtimeProbe.entrySnapshotBootstrapSha256 ===
            MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256 &&
          macRuntimeSnapshotContractBound &&
          plan.runtimeProbe.runtimeSnapshotBytes > 0 &&
          plan.runtimeProbe.runtimeSnapshotBytes <= 256 * 1024 * 1024 &&
          plan.runtimeProbe.entrySnapshotBytes <= 64 * 1024 * 1024 &&
          plan.runtimeProbe.rootProtectedRuntimeSnapshot === true &&
          plan.runtimeProbe.entryRootOwnedAnonymousSnapshot === true &&
          plan.runtimeProbe.entrySourcePrePostStat === true &&
          plan.runtimeProbe.entryWriterClosedBeforeReadonlyReopen === true &&
          plan.runtimeProbe.entryReadonlyIdentityRechecked === true &&
          plan.runtimeProbe.entryUnlinkedAndDirectoryFsyncedBeforeTarget ===
            true &&
          plan.runtimeProbe.targetInheritedEntrySnapshotOnly === true &&
          plan.runtimeProbe.runtimeAndCapsuleSlotsNullBeforeExec === true &&
          plan.runtimeProbe.bootstrapClosesNullAndReadyDescriptors === true &&
          plan.runtimeProbe.actualRuntimeReadyHandshake === true &&
          plan.runtimeProbe.runtimeSnapshotUnlinkedBeforeEntryRelease ===
            true &&
          plan.runtimeProbe.callerCredentialDropIrreversible === true &&
          plan.runtimeProbe.relayParentCredentialsDropped === true &&
          plan.runtimeProbe.callerLifelineWatched === true &&
          plan.runtimeProbe.signalRelayNonblocking === true &&
          ((plan.runtimeProbe.targetRuntimeInvocationMode ===
            "node-executable-eval-v1" &&
            plan.runtimeProbe.pkgExecPathMagicBound === false) ||
            (plan.runtimeProbe.targetRuntimeInvocationMode ===
              "pkg-copied-executable-eval-v1" &&
              plan.runtimeProbe.pkgExecPathMagicBound === true &&
              planOptionsSnapshot.env?.PKG_EXECPATH ===
                MACOS_PKG_EXECPATH_MAGIC)) &&
          plan.runtimeProbe.targetDescriptorAllowlist ===
            "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready" &&
          plan.runtimeProbe.capsuleRootDescriptorBound === true &&
          plan.runtimeProbe.capsulePathObjectAtomic === false &&
          plan.runtimeProbe.sandboxProfileFixedAndDigestBound === true &&
          plan.runtimeProbe.processForkExplicitlyDenied === true &&
          plan.runtimeProbe.sandboxExecLiveGateContract === true &&
          plan.runtimeProbe.globalLaunchSerialization === true &&
          plan.runtimeProbe.maximumStaleSnapshots === 8 &&
          plan.runtimeProbe.helperSourceSha256 ===
            MACOS_MCP_LAUNCHER_INPUTS.sourceSha256 &&
          plan.runtimeProbe.helperProtocolSha256 ===
            MACOS_MCP_LAUNCHER_INPUTS.protocolSha256 &&
          [
            "helperSha256",
            "helperInstallContractSha256",
            "helperDesignatedRequirementSha256",
            "installAttestationDigest",
            "planBindingDigest",
          ].every((field) =>
            /^[a-f0-9]{64}$/.test(plan.runtimeProbe[field] || ""),
          ) &&
          /^[A-Z0-9]{10}$/.test(plan.runtimeProbe.helperTeamIdentifier || "") &&
          plan.runtimeProbe.helperPackageIdentifier ===
            macProtocol.packageIdentifier &&
          isMacosMcpLauncherPackageVersion(
            plan.runtimeProbe.helperPackageVersion,
          ) &&
          plan.runtimeProbe.planBindingMechanism ===
            "macos-mcp-code-snapshot-plan-binding-v1" &&
          plan.runtimeProbe.runtimeLaunchPath === macSnapshotPath &&
          plan.runtimeProbe.entrySnapshotPath === "anonymous-root-owned-fd4" &&
          planCommand === macProtocol.helperInstallPath &&
          planArgsSnapshot.length >= 10 &&
          planArgsSnapshot[0] === "--launch-v1" &&
          /^[a-f0-9]{64}$/.test(planArgsSnapshot[1] || "") &&
          planArgsSnapshot[2] === MACOS_MCP_LAUNCHER_INPUTS.protocolSha256 &&
          planArgsSnapshot[3] === executionContract.runtimeIdentity.sha256 &&
          planArgsSnapshot[4] ===
            String(executionContract.runtimeIdentity.bytes) &&
          planArgsSnapshot[5] === executionContract.entryIdentity.sha256 &&
          planArgsSnapshot[6] ===
            String(executionContract.entryIdentity.bytes) &&
          /^[1-9]\d*$/.test(planArgsSnapshot[7] || "") &&
          /^[1-9]\d*$/.test(planArgsSnapshot[8] || "") &&
          planArgsSnapshot[9] === policyDigest &&
          passthroughArgsMatch(planArgsSnapshot.slice(10)) &&
          planOptionsSnapshot.cwd === "/" &&
          planOptionsSnapshot.shell === false &&
          planOptionsSnapshot.detached === false &&
          Array.isArray(macStdio) &&
          macStdio.length === 9 &&
          macStdio
            .slice(0, 3)
            .every((value) => ["pipe", "ignore"].includes(value)) &&
          macStdio.slice(3, 6).every(Number.isInteger) &&
          macStdio[6] === "ignore" &&
          macStdio[7] === "ignore" &&
          macStdio[8] === "pipe" &&
          launchContext.builtInSandboxAdapter === true &&
          macPlanBindingConsumed &&
          guarantees.includes(SANDBOX_BOUNDARIES.FILESYSTEM) &&
          guarantees.includes(SANDBOX_BOUNDARIES.NETWORK) &&
          guarantees.includes(SANDBOX_BOUNDARIES.PROCESS_EXEC) &&
          guarantees.includes(SANDBOX_BOUNDARIES.PROCESS_TREE) &&
          guarantees.includes(SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION);
        const windowsSnapshotEvidence =
          plan.platform === "win32" &&
          [
            "windows-job-restricted-token",
            "windows-appcontainer-job-restricted-token",
          ].includes(backend) &&
          plan.enforcement === backend &&
          ((backend === "windows-job-restricted-token" &&
            plan.runtimeProbe.kind ===
              "windows-plugin-node-entry-snapshot-v1") ||
            (backend === "windows-appcontainer-job-restricted-token" &&
              plan.runtimeProbe.kind ===
                "windows-appcontainer-launch-attestation-v1" &&
              plan.runtimeProbe.capabilityCount === 0 &&
              policyAttested === true &&
              policyDigest !== null)) &&
          plan.runtimeProbe.contentSnapshotScope ===
            "mcp-capsule-entry-source" &&
          plan.runtimeProbe.contentSnapshotMechanism ===
            "verified-handle-inherited-pipe-module-compile-v1" &&
          plan.runtimeProbe.handleAtomic === false &&
          plan.runtimeProbe.entrySnapshotAtomic === true &&
          plan.runtimeProbe.runtimeLaunchAtomic === true &&
          plan.runtimeProbe.runtimeLaunchMechanism ===
            "filter-oplock-locked-createprocess-suspended-image-v1" &&
          plan.runtimeProbe.planBindingMechanism ===
            "windows-mcp-code-snapshot-plan-binding-v1" &&
          /^[a-f0-9]{64}$/.test(plan.runtimeProbe.planBindingDigest || "") &&
          windowsRuntimeAttestationContractBound &&
          /^[a-f0-9]{64}$/.test(
            plan.runtimeProbe.runtimeAttestedSha256 || "",
          ) &&
          Number.isSafeInteger(plan.runtimeProbe.runtimeAttestedBytes) &&
          plan.runtimeProbe.runtimeAttestedBytes > 0 &&
          plan.runtimeProbe.runtimeAttestedBytes <= 256 * 1024 * 1024 &&
          launchContext.builtInSandboxAdapter === true &&
          windowsPlanBindingConsumed;
        if (
          !exactSnapshotEvidence ||
          (!linuxSnapshotEvidence &&
            !linuxBubblewrapSnapshotEvidence &&
            !macSnapshotEvidence &&
            !windowsSnapshotEvidence)
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            "Code snapshot guarantee requires typed atomic MCP capsule evidence",
          );
        }
      }
      if (
        plan.runtimeProbe.kind ===
          "windows-appcontainer-launch-attestation-v1" &&
        plan.runtimeProbe.runnable === true &&
        plan.runtimeProbe.capabilityCount !== 0
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Windows AppContainer runtime evidence must attest zero capabilities",
        );
      }
      const genericWorkspaceEvidenceFields = [
        "contractDigest",
        "policyDigest",
        "mountTopologyDigest",
        "sourceMountSetDigest",
        "emptyRoot",
        "undeclaredRootReadOnly",
        "workspaceReadWrite",
        "workspaceMountTopologyAttested",
        "workspaceRootAliasAttested",
        "anonymousDevWritable",
        "systemReadOnly",
        "hostHomeHidden",
        "outsideMarkerHidden",
        "networkNamespace",
        "networkNamespaceChanged",
        "pidNamespace",
        "pidNamespaceChanged",
        "processTreeCloseProbe",
        "bubblewrapPid1Reaper",
        "dieWithParent",
        "closeImpliesProcessTreeClosed",
        "socketCreationDenied",
        "descriptorMounts",
        "mountTopologyAtomic",
        "sourceMountPropagationPrivateAtAttestation",
      ];
      for (const field of [
        "contractDigest",
        "policyDigest",
        "mountTopologyDigest",
        "sourceMountSetDigest",
      ]) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          (typeof plan.runtimeProbe[field] !== "string" ||
            !/^[a-f0-9]{64}$/.test(plan.runtimeProbe[field]))
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be a lowercase SHA-256 value`,
          );
        }
      }
      for (const field of genericWorkspaceEvidenceFields.slice(4)) {
        if (
          plan.runtimeProbe[field] !== undefined &&
          typeof plan.runtimeProbe[field] !== "boolean"
        ) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            `Sandbox runtime probe ${field} must be boolean`,
          );
        }
      }
      const genericWorkspaceKind =
        plan.runtimeProbe.kind === "linux-bwrap-generic-workspace-policy-v1";
      if (
        !genericWorkspaceKind &&
        genericWorkspaceEvidenceFields.some(
          (field) => plan.runtimeProbe[field] !== undefined,
        )
      ) {
        throw this._sandboxError(
          "invalid_sandbox_plan",
          "Linux generic workspace evidence requires its typed runtime probe kind",
        );
      }
      if (genericWorkspaceKind) {
        const filesystemPolicy = plan.filesystemPolicy;
        const networkPolicy = plan.networkPolicy;
        const processTreePolicy = plan.processTreePolicy;
        const ptyPolicy = plan.ptyPolicy ?? null;
        const ptyPlan =
          ptyPolicy !== null &&
          typeof ptyPolicy === "object" &&
          !Array.isArray(ptyPolicy);
        const ptyPlanValid = ptyPlan
          ? ptyPolicy.mode === "dedicated-controlling-terminal" &&
            ptyPolicy.launcherPath === "/usr/bin/setsid" &&
            typeof ptyPolicy.launcherSha256 === "string" &&
            /^[a-f0-9]{64}$/.test(ptyPolicy.launcherSha256) &&
            Number.isSafeInteger(ptyPolicy.launcherBytes) &&
            ptyPolicy.launcherBytes > 0 &&
            ptyPolicy.launcherBytes <= 256 * 1024 * 1024 &&
            ptyPolicy.launcherDescriptorBound === true &&
            ptyPolicy.launcherExecutablePinned === true &&
            ptyPolicy.launcherDescriptorConsumedBeforeTarget === true &&
            ptyPolicy.launcherStagingPathHidden === true &&
            ptyPolicy.bwrapNewSession === false &&
            planArgsSnapshot[0] === "--ctty" &&
            /^\/proc\/self\/fd\/\d+$/.test(planArgsSnapshot[1] || "") &&
            !linuxBubblewrapExecutableArgs.includes("--new-session")
          : ptyPolicy === null &&
            planArgsSnapshot[0] !== "--ctty" &&
            linuxBubblewrapExecutableArgs.includes("--new-session");
        const workspaceRoot = filesystemPolicy?.workspaceRoot;
        const workingDirectory = filesystemPolicy?.workingDirectory;
        const workspaceRelative =
          typeof workspaceRoot === "string" &&
          typeof workingDirectory === "string"
            ? path.posix.relative(workspaceRoot, workingDirectory)
            : "..";
        const genericExecutionContract = launchContext.executionContract;
        const genericExecutionContractBound =
          launchContext.builtInSandboxAdapter === true &&
          verifyLinuxGenericBubblewrapPlan(authorityPlan) &&
          genericExecutionContract?.contractVersion === 1 &&
          genericExecutionContract.kind === LINUX_GENERIC_CONTRACT_KIND &&
          genericExecutionContract.contractDigest ===
            plan.runtimeProbe.contractDigest &&
          genericExecutionContract.workspaceRoot === workspaceRoot &&
          genericExecutionContract.workingDirectory === workingDirectory &&
          launchContext.cwd === workingDirectory;
        genericWorkspaceProbe =
          genericExecutionContractBound &&
          plan.applied === true &&
          plan.platform === "linux" &&
          plan.enforcement === "linux-bwrap-workspace" &&
          backend === "linux-bwrap-workspace" &&
          candidateBackend === null &&
          policyAttested === true &&
          policyDigest !== null &&
          plan.runtimeProbe.policyDigest === policyDigest &&
          /^[a-f0-9]{64}$/.test(plan.runtimeProbe.contractDigest || "") &&
          guarantees.includes(SANDBOX_BOUNDARIES.FILESYSTEM) &&
          guarantees.includes(SANDBOX_BOUNDARIES.NETWORK) &&
          guarantees.includes(SANDBOX_BOUNDARIES.PROCESS_TREE) &&
          plan.runtimeProbe.attempted === true &&
          plan.runtimeProbe.runnable === true &&
          plan.runtimeProbe.reason === null &&
          plan.runtimeProbe.probeRuntime === "posix-sh" &&
          plan.runtimeProbe.targetRuntime === "generic-command" &&
          plan.runtimeProbe.contentSnapshot === false &&
          plan.runtimeProbe.handleAtomic === false &&
          plan.runtimeProbe.mountTopologyAtomic === false &&
          plan.runtimeProbe.mountTopologyDigest ===
            filesystemPolicy?.mountTopologyDigest &&
          plan.runtimeProbe.sourceMountSetDigest ===
            filesystemPolicy?.sourceMountSetDigest &&
          plan.runtimeProbe.sourceMountPropagationPrivateAtAttestation ===
            true &&
          [
            "emptyRoot",
            "undeclaredRootReadOnly",
            "workspaceReadWrite",
            "workspaceMountTopologyAttested",
            "workspaceRootAliasAttested",
            "anonymousDevWritable",
            "systemReadOnly",
            "hostHomeHidden",
            "outsideMarkerHidden",
            "networkNamespace",
            "networkNamespaceChanged",
            "pidNamespace",
            "pidNamespaceChanged",
            "processTreeCloseProbe",
            "bubblewrapPid1Reaper",
            "dieWithParent",
            "closeImpliesProcessTreeClosed",
            "socketCreationDenied",
            "descriptorMounts",
          ].every((field) => plan.runtimeProbe[field] === true) &&
          typeof workspaceRoot === "string" &&
          path.posix.isAbsolute(workspaceRoot) &&
          workspaceRoot !== "/" &&
          typeof workingDirectory === "string" &&
          path.posix.isAbsolute(workingDirectory) &&
          workspaceRelative !== ".." &&
          !workspaceRelative.startsWith("../") &&
          !path.posix.isAbsolute(workspaceRelative) &&
          filesystemPolicy.workspaceAccess === "read-write" &&
          filesystemPolicy.systemAccess === "read-only" &&
          filesystemPolicy.undeclaredRootAccess === "read-only" &&
          filesystemPolicy.hostRootMapped === false &&
          filesystemPolicy.hostHomeMapped === false &&
          filesystemPolicy.workspaceDescriptorBound === true &&
          filesystemPolicy.systemDescriptorBound === true &&
          filesystemPolicy.exactEtcFileDescriptors === true &&
          filesystemPolicy.workspaceRecursiveBind === true &&
          filesystemPolicy.workspaceMountTopology ===
            "no-strict-descendants-or-forbidden-root-aliases-at-attestation" &&
          filesystemPolicy.mountTopologySource === "proc-self-mountinfo" &&
          /^[a-f0-9]{64}$/.test(filesystemPolicy.mountTopologyDigest || "") &&
          /^[a-f0-9]{64}$/.test(filesystemPolicy.sourceMountSetDigest || "") &&
          filesystemPolicy.sourceMountPropagationPrivateAtAttestation ===
            true &&
          filesystemPolicy.mountTopologyAtomic === false &&
          Array.isArray(filesystemPolicy.anonymousWritablePaths) &&
          filesystemPolicy.anonymousWritablePaths.length === 5 &&
          ["/home/sandbox", "/dev", "/run", "/tmp", "/var/tmp"].every(
            (value, index) =>
              filesystemPolicy.anonymousWritablePaths[index] === value,
          ) &&
          networkPolicy?.namespace === "new" &&
          networkPolicy?.namespaceIdentityChanged === true &&
          networkPolicy?.seccomp === "deny-network-creation" &&
          processTreePolicy?.namespace === "new" &&
          processTreePolicy?.namespaceIdentityChanged === true &&
          processTreePolicy?.init === "bubblewrap-pid1-reaper" &&
          processTreePolicy?.parentDeathSignal === "SIGKILL" &&
          processTreePolicy?.asPid1 === false &&
          processTreePolicy?.closeFence === "pid-namespace-empty-or-killed" &&
          planCommand.startsWith("/proc/self/fd/") &&
          linuxDescriptorLaunch.options.cwd === "/" &&
          linuxDescriptorLaunch.options.shell === false &&
          linuxDescriptorLaunch.options.detached === false &&
          Array.isArray(linuxDescriptorLaunch.stdio) &&
          linuxBubblewrapExecutableArgs.includes("--bind-fd") &&
          linuxBubblewrapExecutableArgs.includes("--ro-bind-fd") &&
          linuxBubblewrapExecutableArgs.includes("--remount-ro") &&
          linuxBubblewrapExecutableArgs.includes("--unshare-net") &&
          linuxBubblewrapExecutableArgs.includes("--unshare-pid") &&
          linuxBubblewrapExecutableArgs.includes("--die-with-parent") &&
          !linuxBubblewrapExecutableArgs.includes("--as-pid-1") &&
          linuxBubblewrapExecutableArgs.includes("--seccomp") &&
          !linuxBubblewrapExecutableArgs.includes("--ro-bind") &&
          ptyPlanValid;
        if (!genericWorkspaceProbe) {
          throw this._sandboxError(
            "invalid_sandbox_plan",
            "Linux generic workspace evidence must use the typed descriptor-bound empty-root contract",
          );
        }
        sanitizedFilesystemPolicy = Object.freeze({
          workspaceRoot,
          workingDirectory,
          workspaceAccess: filesystemPolicy.workspaceAccess,
          systemAccess: filesystemPolicy.systemAccess,
          undeclaredRootAccess: filesystemPolicy.undeclaredRootAccess,
          anonymousWritablePaths: Object.freeze([
            ...filesystemPolicy.anonymousWritablePaths,
          ]),
          hostRootMapped: filesystemPolicy.hostRootMapped,
          hostHomeMapped: filesystemPolicy.hostHomeMapped,
          workspaceDescriptorBound: filesystemPolicy.workspaceDescriptorBound,
          systemDescriptorBound: filesystemPolicy.systemDescriptorBound,
          exactEtcFileDescriptors: filesystemPolicy.exactEtcFileDescriptors,
          workspaceRecursiveBind: filesystemPolicy.workspaceRecursiveBind,
          workspaceMountTopology: filesystemPolicy.workspaceMountTopology,
          mountTopologySource: filesystemPolicy.mountTopologySource,
          mountTopologyDigest: filesystemPolicy.mountTopologyDigest,
          sourceMountSetDigest: filesystemPolicy.sourceMountSetDigest,
          sourceMountPropagationPrivateAtAttestation:
            filesystemPolicy.sourceMountPropagationPrivateAtAttestation,
          mountTopologyAtomic: filesystemPolicy.mountTopologyAtomic,
        });
        sanitizedNetworkPolicy = Object.freeze({
          namespace: networkPolicy.namespace,
          namespaceIdentityChanged: networkPolicy.namespaceIdentityChanged,
          seccomp: networkPolicy.seccomp,
        });
        sanitizedProcessTreePolicy = Object.freeze({
          namespace: processTreePolicy.namespace,
          namespaceIdentityChanged: processTreePolicy.namespaceIdentityChanged,
          init: processTreePolicy.init,
          parentDeathSignal: processTreePolicy.parentDeathSignal,
          asPid1: processTreePolicy.asPid1,
          closeFence: processTreePolicy.closeFence,
        });
        sanitizedPtyPolicy = ptyPlan
          ? Object.freeze({
              mode: ptyPolicy.mode,
              launcherPath: ptyPolicy.launcherPath,
              launcherSha256: ptyPolicy.launcherSha256,
              launcherBytes: ptyPolicy.launcherBytes,
              launcherDescriptorBound: ptyPolicy.launcherDescriptorBound,
              launcherExecutablePinned: ptyPolicy.launcherExecutablePinned,
              launcherDescriptorConsumedBeforeTarget:
                ptyPolicy.launcherDescriptorConsumedBeforeTarget,
              launcherStagingPathHidden: ptyPolicy.launcherStagingPathHidden,
              bwrapNewSession: ptyPolicy.bwrapNewSession,
            })
          : null;
      }
      runtimeProbe = {
        kind: plan.runtimeProbe.kind,
        attempted: plan.runtimeProbe.attempted,
        runnable: plan.runtimeProbe.runnable,
        reason: plan.runtimeProbe.reason,
        ...(plan.runtimeProbe.probeRuntime !== undefined
          ? { probeRuntime: plan.runtimeProbe.probeRuntime }
          : {}),
        ...(plan.runtimeProbe.targetRuntime !== undefined
          ? { targetRuntime: plan.runtimeProbe.targetRuntime }
          : {}),
        ...(plan.runtimeProbe.capabilityCount !== undefined
          ? { capabilityCount: plan.runtimeProbe.capabilityCount }
          : {}),
        ...(plan.runtimeProbe.contentSnapshot !== undefined
          ? { contentSnapshot: plan.runtimeProbe.contentSnapshot }
          : {}),
        ...(plan.runtimeProbe.handleAtomic !== undefined
          ? { handleAtomic: plan.runtimeProbe.handleAtomic }
          : {}),
        ...(plan.runtimeProbe.entrySnapshotAtomic !== undefined
          ? { entrySnapshotAtomic: plan.runtimeProbe.entrySnapshotAtomic }
          : {}),
        ...(plan.runtimeProbe.runtimeLaunchAtomic !== undefined
          ? { runtimeLaunchAtomic: plan.runtimeProbe.runtimeLaunchAtomic }
          : {}),
        ...(plan.runtimeProbe.runtimeDetachedChildSpawnVerified !== undefined
          ? {
              runtimeDetachedChildSpawnVerified:
                plan.runtimeProbe.runtimeDetachedChildSpawnVerified,
            }
          : {}),
        ...(plan.runtimeProbe.runtimeLaunchMechanism !== undefined
          ? {
              runtimeLaunchMechanism: plan.runtimeProbe.runtimeLaunchMechanism,
            }
          : {}),
        ...(plan.runtimeProbe.sharedLibraryClosure !== undefined
          ? {
              sharedLibraryClosure: plan.runtimeProbe.sharedLibraryClosure,
            }
          : {}),
        ...(plan.runtimeProbe.contentSnapshotScope !== undefined
          ? {
              contentSnapshotScope: plan.runtimeProbe.contentSnapshotScope,
            }
          : {}),
        ...(plan.runtimeProbe.contentSnapshotMechanism !== undefined
          ? {
              contentSnapshotMechanism:
                plan.runtimeProbe.contentSnapshotMechanism,
            }
          : {}),
        ...(plan.runtimeProbe.planBindingMechanism !== undefined
          ? {
              planBindingMechanism: plan.runtimeProbe.planBindingMechanism,
              planBindingDigest: plan.runtimeProbe.planBindingDigest,
            }
          : {}),
        ...(plan.runtimeProbe.runtimeSnapshotSha256 !== undefined
          ? {
              runtimeSnapshotSha256: plan.runtimeProbe.runtimeSnapshotSha256,
              runtimeSnapshotBytes: plan.runtimeProbe.runtimeSnapshotBytes,
              entrySnapshotSha256: plan.runtimeProbe.entrySnapshotSha256,
              entrySnapshotBytes: plan.runtimeProbe.entrySnapshotBytes,
              entrySnapshotAtomic: plan.runtimeProbe.entrySnapshotAtomic,
              runtimeLaunchAtomic: plan.runtimeProbe.runtimeLaunchAtomic,
              runtimeLaunchMechanism: plan.runtimeProbe.runtimeLaunchMechanism,
              ...(plan.runtimeProbe.runtimeLaunchPath !== undefined
                ? { runtimeLaunchPath: plan.runtimeProbe.runtimeLaunchPath }
                : {}),
              ...(plan.runtimeProbe.entrySnapshotPath !== undefined
                ? { entrySnapshotPath: plan.runtimeProbe.entrySnapshotPath }
                : {}),
              ...(plan.runtimeProbe.mcpCapsuleCodeSnapshot !== undefined
                ? {
                    mcpCapsuleCodeSnapshot:
                      plan.runtimeProbe.mcpCapsuleCodeSnapshot,
                  }
                : {}),
              entrySnapshotBootstrapSha256:
                plan.runtimeProbe.entrySnapshotBootstrapSha256,
              sharedLibraryClosure: plan.runtimeProbe.sharedLibraryClosure,
            }
          : {}),
        ...(plan.runtimeProbe.runtimeAttestedSha256 !== undefined
          ? {
              runtimeAttestedSha256: plan.runtimeProbe.runtimeAttestedSha256,
              runtimeAttestedBytes: plan.runtimeProbe.runtimeAttestedBytes,
              entrySnapshotSha256: plan.runtimeProbe.entrySnapshotSha256,
              entrySnapshotBytes: plan.runtimeProbe.entrySnapshotBytes,
              entrySnapshotAtomic: plan.runtimeProbe.entrySnapshotAtomic,
              runtimeLaunchAtomic: plan.runtimeProbe.runtimeLaunchAtomic,
              runtimeLaunchMechanism: plan.runtimeProbe.runtimeLaunchMechanism,
              sharedLibraryClosure: plan.runtimeProbe.sharedLibraryClosure,
            }
          : {}),
      };
      for (const field of [
        "nativeCodePolicyBound",
        "nativeCodePolicySchema",
        "nativeCodePolicyDigest",
        "nativeCodePolicyMode",
        "capsuleNativeCodeFormat",
        "nativeAddonLoading",
        "nativeAddonDenialMechanism",
        "hostRuntimeSharedLibraries",
        "anonymousExecutableMemory",
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of [
        "pluginTreeContentSnapshot",
        ...pluginTreeEvidenceFields,
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of [
        ...supervisorStringFields,
        ...supervisorBooleanFields,
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of [
        "initialDynamicLoadClosureDescriptorBound",
        ...initialDynamicEvidenceFields,
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of [
        "runtimeSharedLibraryPathnameClosure",
        ...runtimePathnameClosureEvidenceFields,
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of [
        "rootProtectedRuntimeSnapshot",
        "entryRootOwnedAnonymousSnapshot",
        "entrySourcePrePostStat",
        "entryWriterClosedBeforeReadonlyReopen",
        "entryReadonlyIdentityRechecked",
        "entryUnlinkedAndDirectoryFsyncedBeforeTarget",
        "targetInheritedEntrySnapshotOnly",
        "runtimeAndCapsuleSlotsNullBeforeExec",
        "bootstrapClosesNullAndReadyDescriptors",
        "actualRuntimeReadyHandshake",
        "runtimeSnapshotUnlinkedBeforeEntryRelease",
        "callerCredentialDropIrreversible",
        "relayParentCredentialsDropped",
        "callerLifelineWatched",
        "signalRelayNonblocking",
        "targetRuntimeInvocationMode",
        "pkgExecPathMagicBound",
        "targetDescriptorAllowlist",
        "capsuleRootDescriptorBound",
        "capsulePathObjectAtomic",
        "sandboxProfileFixedAndDigestBound",
        "processForkExplicitlyDenied",
        "sandboxExecLiveGateContract",
        "globalLaunchSerialization",
        "maximumStaleSnapshots",
        "helperSha256",
        "helperSourceSha256",
        "helperProtocolSha256",
        "helperInstallContractSha256",
        "helperDesignatedRequirementSha256",
        "helperTeamIdentifier",
        "helperPackageIdentifier",
        "helperPackageVersion",
        "installAttestationDigest",
      ]) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      for (const field of genericWorkspaceEvidenceFields) {
        if (plan.runtimeProbe[field] !== undefined) {
          runtimeProbe[field] = plan.runtimeProbe[field];
        }
      }
      if (sanitizedDescriptorScrubber !== null) {
        runtimeProbe.descriptorScrubber = sanitizedDescriptorScrubber;
      }
      if (supervisorIdentity !== undefined) {
        runtimeProbe.supervisorExecutableIdentity = {
          path: supervisorIdentity.path,
          fileId: {
            dev: supervisorIdentity.fileId.dev,
            ino: supervisorIdentity.fileId.ino,
          },
          sha256: supervisorIdentity.sha256,
          bytes: supervisorIdentity.bytes,
          mtimeMs: supervisorIdentity.mtimeMs,
          mode: supervisorIdentity.mode,
          uid: supervisorIdentity.uid,
          gid: supervisorIdentity.gid,
        };
      }
    }
    if (
      guarantees.includes(SANDBOX_BOUNDARIES.CODE_SNAPSHOT) &&
      runtimeProbe === null
    ) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Code snapshot guarantee requires typed atomic MCP capsule evidence",
      );
    }
    if (backend === "linux-bwrap-workspace" && !genericWorkspaceProbe) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Applied Linux generic workspace plans require typed runtime evidence",
      );
    }
    const postSpawn = plan.postSpawn || { required: false, mode: "none" };
    if (
      postSpawn.required &&
      postSpawn.mode !== "sync" &&
      postSpawn.mode !== "async"
    ) {
      throw this._sandboxError(
        "invalid_sandbox_plan",
        "Required post-spawn enforcement must declare sync or async mode",
      );
    }
    const validatedArgs = linuxDescriptorLaunch
      ? linuxDescriptorPtyLaunch
        ? Object.freeze([
            "--ctty",
            `/proc/self/fd/${linuxDescriptorLaunch.scrubberChildFd}`,
            ...linuxDescriptorLaunch.launchArgs,
          ])
        : linuxDescriptorLaunch.launchArgs
      : planArgsSnapshot;
    const validatedOptions = linuxDescriptorLaunch
      ? Object.freeze({
          ...linuxDescriptorLaunch.options,
          stdio: Object.freeze([...linuxDescriptorLaunch.stdio]),
          env: Object.freeze({
            ...linuxDescriptorLaunch.callerEnvironment,
          }),
        })
      : planOptionsSnapshot;
    const validatedPlan = {
      ...plan,
      command: planCommand,
      args: [...validatedArgs],
      options: { ...validatedOptions },
      backend,
      guarantees: [...new Set(guarantees)],
      candidateBackend,
      policyAttested,
      policyDigest,
      runtimeProbe,
      ...(sanitizedFilesystemPolicy
        ? {
            filesystemPolicy: sanitizedFilesystemPolicy,
            networkPolicy: sanitizedNetworkPolicy,
            processTreePolicy: sanitizedProcessTreePolicy,
            ptyPolicy: sanitizedPtyPolicy,
          }
        : {}),
      postSpawn: { ...postSpawn },
    };
    if (windowsPlanBindingConsumed) {
      const upstreamCleanup = validatedPlan.cleanup;
      validatedPlan.cleanup = (...args) => {
        admittedWindowsMcpCodeSnapshotPlans.delete(validatedPlan);
        return upstreamCleanup?.(...args);
      };
      admittedWindowsMcpCodeSnapshotPlans.add(validatedPlan);
    }
    if (macPlanBindingConsumed) {
      const upstreamCleanup = validatedPlan.cleanup;
      validatedPlan.cleanup = (...args) => {
        admittedMacMcpCodeSnapshotPlans.delete(validatedPlan);
        return upstreamCleanup?.(...args);
      };
      admittedMacMcpCodeSnapshotPlans.add(validatedPlan);
    }
    return validatedPlan;
  }

  _assertRequiredSandboxBoundaries(plan, requiredBoundaries) {
    const actualGuarantees = plan.applied ? plan.guarantees : [];
    const guaranteed = new Set(actualGuarantees);
    const missingBoundaries = requiredBoundaries.filter(
      (boundary) => !guaranteed.has(boundary),
    );
    if (missingBoundaries.length > 0) {
      const candidateReason =
        typeof plan.reason === "string" && plan.reason
          ? `; reason=${plan.reason}${
              typeof plan.runtimeProbe?.reason === "string" &&
              plan.runtimeProbe.reason
                ? `:${plan.runtimeProbe.reason}`
                : ""
            }`
          : "";
      throw this._sandboxBoundaryError(
        "required_boundaries_unsatisfied",
        `Sandbox backend ${plan.backend || plan.candidateBackend || "unavailable"} cannot satisfy required boundaries: ${missingBoundaries.join(", ")}${candidateReason}`,
        {
          requiredBoundaries,
          actualGuarantees,
          missingBoundaries,
          sandboxBackend: plan.backend,
          sandboxCandidateBackend: plan.candidateBackend,
          sandboxRuntimeProbe: plan.runtimeProbe,
          sandboxPolicyAttested: plan.policyAttested,
          sandboxPolicyDigest: plan.policyDigest,
          sandboxCandidateReason: plan.candidateBackend ? plan.reason : null,
        },
      );
    }
    const assertedPlan = {
      ...plan,
      requiredBoundaries: [...requiredBoundaries],
    };
    if (admittedWindowsMcpCodeSnapshotPlans.has(plan)) {
      admittedWindowsMcpCodeSnapshotPlans.delete(plan);
      const upstreamCleanup = assertedPlan.cleanup;
      assertedPlan.cleanup = (...args) => {
        admittedWindowsMcpCodeSnapshotPlans.delete(assertedPlan);
        return upstreamCleanup?.(...args);
      };
      admittedWindowsMcpCodeSnapshotPlans.add(assertedPlan);
    }
    if (admittedMacMcpCodeSnapshotPlans.has(plan)) {
      admittedMacMcpCodeSnapshotPlans.delete(plan);
      const upstreamCleanup = assertedPlan.cleanup;
      assertedPlan.cleanup = (...args) => {
        admittedMacMcpCodeSnapshotPlans.delete(assertedPlan);
        return upstreamCleanup?.(...args);
      };
      admittedMacMcpCodeSnapshotPlans.add(assertedPlan);
    }
    return assertedPlan;
  }

  _prepareSandboxPlan(
    command,
    args,
    options,
    { sync = false, pty = false, sandboxPolicy = {} } = {},
  ) {
    const strict = this._sandboxStrictEnabled();
    const requiredBoundaries = sandboxPolicy.requiredBoundaries || [];
    const profile = strict ? "strict" : sandboxPolicy.profile || "default";
    let disabledReason = null;
    if (this._sandboxDisabledByEnvironment()) {
      disabledReason = "disabled_by_environment";
    } else if (
      this._sandboxEnabled === false ||
      this._platformSandboxEnabled === false
    ) {
      disabledReason = "disabled_by_broker";
    }

    if (disabledReason) {
      if (strict) {
        throw this._sandboxError(
          disabledReason,
          `Sandbox is unavailable in strict mode: ${disabledReason}`,
        );
      }
      const unavailablePlan = this._sandboxUnavailablePlan(
        command,
        args,
        options,
        disabledReason,
        { ...sandboxPolicy, profile },
      );
      return this._assertRequiredSandboxBoundaries(
        unavailablePlan,
        requiredBoundaries,
      );
    }

    const adapterRequest = Object.freeze({
      profile,
      requiredBoundaries: Object.freeze([...requiredBoundaries]),
      sync,
      ...(pty ? { pty: true } : {}),
      ...(sandboxPolicy.executionContract
        ? { executionContract: sandboxPolicy.executionContract }
        : {}),
    });
    // Keep the legacy string profile in argument four. The built-in adapter
    // reserves argument five for runtime injection, so the typed request is
    // additive in argument six and legacy injected adapters can ignore it.
    const sandboxAdapter = this._sandboxAdapter;
    const applySandboxAdapter = sandboxAdapter.applySandbox;
    const builtInSandboxAdapter = applySandboxAdapter === _applySandbox;
    // Never dispatch the built-in through a mutable Function property or a
    // global reflective helper after consulting an injected adapter getter.
    // The lexical import is the identity we checked and the implementation we
    // invoke. Legacy adapters retain their historical `this` receiver.
    const rawPlan = builtInSandboxAdapter
      ? _applySandbox(
          command,
          args || [],
          options,
          profile,
          undefined,
          adapterRequest,
        )
      : Reflect.apply(applySandboxAdapter, sandboxAdapter, [
          command,
          args || [],
          options,
          profile,
          undefined,
          adapterRequest,
        ]);
    let plan;
    try {
      plan = this._validateSandboxPlan(rawPlan, {
        command,
        args: Object.freeze([...(args || [])]),
        cwd: options.cwd,
        shell: options.shell,
        detached: options.detached,
        executionContract: sandboxPolicy.executionContract || null,
        profile,
        requiredBoundaries: Object.freeze([...requiredBoundaries]),
        sync,
        builtInSandboxAdapter,
      });
      plan = this._assertRequiredSandboxBoundaries(plan, requiredBoundaries);

      if (!plan.applied && strict) {
        throw this._sandboxError(
          plan.reason || "sandbox_unavailable",
          `Sandbox is unavailable in strict mode: ${
            plan.reason || "unknown reason"
          }`,
        );
      }

      if (plan.applied && plan.postSpawn.required) {
        const builtInWindowsMcpPostSpawn =
          admittedWindowsMcpCodeSnapshotPlans.has(plan);
        if (
          !builtInWindowsMcpPostSpawn &&
          typeof this._sandboxAdapter.postSpawnSandbox !== "function"
        ) {
          throw this._sandboxError(
            "post_spawn_adapter_unavailable",
            "Required post-spawn sandbox adapter is unavailable",
          );
        }
        if (sync) {
          throw this._sandboxError(
            "post_spawn_unavailable_for_sync",
            "spawnSync cannot satisfy required post-spawn sandbox enforcement",
          );
        }
        if (
          (strict || requiredBoundaries.length > 0) &&
          plan.postSpawn.mode !== "sync"
        ) {
          throw this._sandboxError(
            "async_post_spawn_disallowed_in_strict_mode",
            "Fail-closed sandbox enforcement requires synchronous post-spawn enforcement",
          );
        }
      }
      return plan;
    } catch (error) {
      if (typeof rawPlan?.cleanup === "function") {
        try {
          rawPlan.cleanup();
        } catch {
          // Preserve the boundary/contract failure that prevented execution.
        }
      }
      throw error;
    }
  }

  _applySandboxAudit(auditEntry, plan, applied) {
    auditEntry.sandboxed = applied;
    auditEntry.sandboxProfile = plan?.profile || null;
    auditEntry.sandboxRequired = [...(plan?.requiredBoundaries || [])];
    auditEntry.sandboxGuarantees = applied ? [...(plan?.guarantees || [])] : [];
    auditEntry.sandboxBackend = plan?.backend || null;
    auditEntry.sandboxCandidateBackend = plan?.candidateBackend || null;
    auditEntry.sandboxRuntimeProbe = plan?.runtimeProbe
      ? { ...plan.runtimeProbe }
      : null;
    auditEntry.sandboxPolicyAttested =
      typeof plan?.policyAttested === "boolean" ? plan.policyAttested : null;
    auditEntry.sandboxPolicyDigest = plan?.policyDigest || null;
    const genericPolicy =
      applied === true && plan?.backend === "linux-bwrap-workspace";
    auditEntry.sandboxFilesystemPolicy = genericPolicy
      ? {
          workspaceRoot: plan.filesystemPolicy.workspaceRoot,
          workingDirectory: plan.filesystemPolicy.workingDirectory,
          workspaceAccess: plan.filesystemPolicy.workspaceAccess,
          systemAccess: plan.filesystemPolicy.systemAccess,
          undeclaredRootAccess: plan.filesystemPolicy.undeclaredRootAccess,
          anonymousWritablePaths: [
            ...plan.filesystemPolicy.anonymousWritablePaths,
          ],
          hostRootMapped: plan.filesystemPolicy.hostRootMapped,
          hostHomeMapped: plan.filesystemPolicy.hostHomeMapped,
          workspaceDescriptorBound:
            plan.filesystemPolicy.workspaceDescriptorBound,
          systemDescriptorBound: plan.filesystemPolicy.systemDescriptorBound,
          exactEtcFileDescriptors:
            plan.filesystemPolicy.exactEtcFileDescriptors,
          workspaceRecursiveBind: plan.filesystemPolicy.workspaceRecursiveBind,
          workspaceMountTopology: plan.filesystemPolicy.workspaceMountTopology,
          mountTopologySource: plan.filesystemPolicy.mountTopologySource,
          mountTopologyDigest: plan.filesystemPolicy.mountTopologyDigest,
          sourceMountSetDigest: plan.filesystemPolicy.sourceMountSetDigest,
          sourceMountPropagationPrivateAtAttestation:
            plan.filesystemPolicy.sourceMountPropagationPrivateAtAttestation,
          mountTopologyAtomic: plan.filesystemPolicy.mountTopologyAtomic,
        }
      : null;
    auditEntry.sandboxNetworkPolicy = genericPolicy
      ? {
          namespace: plan.networkPolicy.namespace,
          namespaceIdentityChanged: plan.networkPolicy.namespaceIdentityChanged,
          seccomp: plan.networkPolicy.seccomp,
        }
      : null;
    auditEntry.sandboxProcessTreePolicy = genericPolicy
      ? {
          namespace: plan.processTreePolicy.namespace,
          namespaceIdentityChanged:
            plan.processTreePolicy.namespaceIdentityChanged,
          init: plan.processTreePolicy.init,
          parentDeathSignal: plan.processTreePolicy.parentDeathSignal,
          asPid1: plan.processTreePolicy.asPid1,
          closeFence: plan.processTreePolicy.closeFence,
        }
      : null;
    auditEntry.sandboxPtyPolicy =
      genericPolicy && plan.ptyPolicy
        ? {
            mode: plan.ptyPolicy.mode,
            launcherPath: plan.ptyPolicy.launcherPath,
            launcherSha256: plan.ptyPolicy.launcherSha256,
            launcherBytes: plan.ptyPolicy.launcherBytes,
            launcherDescriptorBound: plan.ptyPolicy.launcherDescriptorBound,
            launcherExecutablePinned: plan.ptyPolicy.launcherExecutablePinned,
            launcherDescriptorConsumedBeforeTarget:
              plan.ptyPolicy.launcherDescriptorConsumedBeforeTarget,
            launcherStagingPathHidden: plan.ptyPolicy.launcherStagingPathHidden,
            bwrapNewSession: plan.ptyPolicy.bwrapNewSession,
          }
        : null;
    auditEntry.sandboxCandidateReason = plan?.candidateBackend
      ? plan?.reason || null
      : null;
    auditEntry.sandboxEnforcement = applied
      ? plan?.enforcement || "platform"
      : null;
    auditEntry.sandboxReason = applied ? null : plan?.reason || null;
    auditEntry.sandboxState = applied ? "ready" : "unavailable";
  }

  _recordSandboxDenial(auditEntry, error, startTime) {
    auditEntry.permissionDecision = "deny";
    auditEntry.sandboxed = false;
    auditEntry.sandboxState = "denied";
    auditEntry.sandboxReason =
      error.sandboxReason || "sandbox_initialization_failed";
    auditEntry.sandboxRequired = [
      ...(error.requiredBoundaries || auditEntry.sandboxRequired || []),
    ];
    auditEntry.sandboxGuarantees = [
      ...(error.actualGuarantees || auditEntry.sandboxGuarantees || []),
    ];
    auditEntry.sandboxMissing = [...(error.missingBoundaries || [])];
    auditEntry.sandboxBackend =
      error.sandboxBackend || auditEntry.sandboxBackend || null;
    auditEntry.sandboxCandidateBackend =
      error.sandboxCandidateBackend ||
      auditEntry.sandboxCandidateBackend ||
      null;
    auditEntry.sandboxRuntimeProbe = error.sandboxRuntimeProbe
      ? { ...error.sandboxRuntimeProbe }
      : auditEntry.sandboxRuntimeProbe || null;
    auditEntry.sandboxPolicyAttested =
      typeof error.sandboxPolicyAttested === "boolean"
        ? error.sandboxPolicyAttested
        : (auditEntry.sandboxPolicyAttested ?? null);
    auditEntry.sandboxPolicyDigest =
      error.sandboxPolicyDigest || auditEntry.sandboxPolicyDigest || null;
    auditEntry.sandboxCandidateReason =
      error.sandboxCandidateReason || auditEntry.sandboxCandidateReason || null;
    auditEntry.deniedReason = `sandbox-init-failed: ${error.message}`;
    auditEntry.endTime = Date.now();
    auditEntry.durationMs = auditEntry.endTime - startTime;
    this._recordAudit(auditEntry);
    this._writeRplEntry(auditEntry, "denied", error);
  }

  _scheduleSandboxCleanup(proc, cleanup) {
    if (typeof cleanup !== "function") return () => {};
    let cleaned = false;
    const run = () => {
      if (cleaned) return;
      cleaned = true;
      cleanup();
    };
    if (proc && typeof proc.once === "function") {
      proc.once("error", run);
      proc.once("exit", run);
    }
    return run;
  }

  _createWorkspaceProcessCloseFence(auditEntry, proc) {
    return new Promise((resolve) => {
      if (typeof proc?.once === "function") {
        proc.once("close", (exitCode, signal) => {
          resolve({ observed: true, exitCode, signal });
        });
        return;
      }
      if (typeof proc?.onExit === "function") {
        proc.onExit((event = {}) => {
          resolve({
            observed: true,
            exitCode: event.exitCode ?? null,
            signal: event.signal ?? null,
          });
        });
        return;
      }
      resolve({ observed: false, exitCode: null, signal: null });
    });
  }

  _postSpawnOwnershipError(
    error,
    { proc, auditEntry, workspaceProcessClosed, cleanup },
  ) {
    let failure =
      error instanceof Error
        ? error
        : new Error(String(error || "spawn failed"));
    if (
      failure.processTerminationRequested !== true &&
      failure.workspaceTerminationRequested !== true
    ) {
      try {
        if (typeof proc?.once === "function") proc.once("error", () => {});
      } catch {
        // Listener installation failure is itself post-spawn evidence.
      }
      try {
        proc?.kill?.("SIGKILL");
      } catch {
        // The close fence remains the only settlement authority.
      }
    }
    try {
      cleanup?.();
    } catch {
      // Ownership evidence must survive cleanup reporting failures.
    }
    const attach = (target) => {
      target.auditEntry = auditEntry;
      target.spawnedProcess = proc;
      target.workspaceProcessClosed = workspaceProcessClosed;
      target.workspaceTerminationRequested = true;
      return target;
    };
    try {
      return attach(failure);
    } catch {
      const wrapped = new Error(failure.message || "post-spawn failure", {
        cause: failure,
      });
      wrapped.name = failure.name || wrapped.name;
      if (failure.code !== undefined) wrapped.code = failure.code;
      failure = wrapped;
      return attach(failure);
    }
  }

  _runPostSpawnSandbox(proc, plan, auditEntry) {
    if (!plan.applied || !plan.postSpawn.required) {
      this._applySandboxAudit(auditEntry, plan, plan.applied);
      if (plan.applied) this._stats.sandboxed++;
      const ready = Promise.resolve({
        applied: plan.applied,
        backend: plan.backend,
        guarantees: plan.applied ? [...plan.guarantees] : [],
      });
      proc.sandboxReady = ready;
      return;
    }

    let postSpawnResult;
    try {
      const windowsMcpPlanBindingDeclared =
        plan.platform === "win32" &&
        plan.runtimeProbe?.planBindingMechanism ===
          "windows-mcp-code-snapshot-plan-binding-v1";
      const builtInWindowsMcpPlan =
        admittedWindowsMcpCodeSnapshotPlans.has(plan);
      if (windowsMcpPlanBindingDeclared && !builtInWindowsMcpPlan) {
        throw this._sandboxError(
          "windows_mcp_plan_binding_consumed",
          "Windows MCP sandbox plan binding is unavailable or already consumed",
        );
      }
      if (builtInWindowsMcpPlan) {
        // Burn the one-launch post-spawn authority before invoking untrusted
        // process-facing code. Success, failure, cleanup, and reentry all
        // observe the capability as consumed.
        admittedWindowsMcpCodeSnapshotPlans.delete(plan);
      }
      const postSpawnAdapter = builtInWindowsMcpPlan
        ? (child, boundPlan) => boundPlan.postSpawnWindows(child)
        : this._sandboxAdapter.postSpawnSandbox;
      postSpawnResult = postSpawnAdapter(proc, plan);
    } catch (error) {
      this._applySandboxAudit(auditEntry, plan, false);
      auditEntry.sandboxState = "failed";
      auditEntry.sandboxReason = `post_spawn_failed: ${error.message}`;
      if (this._sandboxStrictEnabled() || plan.requiredBoundaries.length > 0) {
        if (typeof proc.once === "function") proc.once("error", () => {});
        try {
          proc.kill?.();
        } catch {
          // The sandbox failure remains fatal even if the child already exited.
        }
        const failure = this._sandboxError(
          "post_spawn_failed",
          `Post-spawn sandbox setup failed: ${error.message}`,
        );
        failure.processTerminationRequested = true;
        throw failure;
      }
      process.emitWarning(
        `Post-spawn sandbox setup failed (continuing without): ${error.message}`,
      );
      proc.sandboxReady = Promise.resolve({ applied: false, error });
      return;
    }

    if (postSpawnResult && typeof postSpawnResult.then === "function") {
      if (this._sandboxStrictEnabled() || plan.requiredBoundaries.length > 0) {
        Promise.resolve(postSpawnResult).catch(() => {});
        if (typeof proc.once === "function") proc.once("error", () => {});
        try {
          proc.kill?.();
        } catch {
          // The sandbox failure remains fatal even if the child already exited.
        }
        const failure = this._sandboxError(
          "async_post_spawn_contract_violation",
          "Strict sandbox adapter returned an asynchronous post-spawn result",
        );
        failure.processTerminationRequested = true;
        throw failure;
      }
      auditEntry.sandboxed = false;
      auditEntry.sandboxState = "pending";
      const ready = Promise.resolve(postSpawnResult).then(
        () => {
          this._applySandboxAudit(auditEntry, plan, true);
          this._stats.sandboxed++;
          return {
            applied: true,
            backend: plan.backend,
            guarantees: [...plan.guarantees],
          };
        },
        (error) => {
          this._applySandboxAudit(auditEntry, plan, false);
          auditEntry.sandboxState = "failed";
          auditEntry.sandboxReason = `post_spawn_failed: ${error.message}`;
          process.emitWarning(
            `Post-spawn sandbox setup failed (continuing without): ${error.message}`,
          );
          throw error;
        },
      );
      // Keep failures observable to callers without creating an unhandled
      // rejection when a legacy caller does not inspect sandboxReady.
      ready.catch(() => {});
      proc.sandboxReady = ready;
      return;
    }

    this._applySandboxAudit(auditEntry, plan, true);
    this._stats.sandboxed++;
    proc.sandboxReady = Promise.resolve({
      applied: true,
      backend: plan.backend,
      guarantees: [...plan.guarantees],
    });
  }

  _credentialBoundaryEnabled() {
    return (
      this._credentialFilteringEnabled !== false &&
      this._credentialAgentEnabled !== false
    );
  }

  _sanitizeAuditArgs(args) {
    const values = Array.isArray(args) ? args : [];
    try {
      return this._credentialAgent.sanitizeArgs(values).sanitizedArgs;
    } catch {
      return values.map(() => "***REDACTION_FAILED***");
    }
  }

  _normalizeAuditRedactArgIndexes(value, argCount) {
    if (value === undefined) return new Set();
    if (!Array.isArray(value)) {
      throw new TypeError("auditRedactArgIndexes must be an array");
    }
    const indexes = new Set();
    for (const index of value) {
      if (!Number.isInteger(index) || index < 0 || index >= argCount) {
        throw new TypeError("auditRedactArgIndexes contains an invalid index");
      }
      indexes.add(index);
    }
    return indexes;
  }

  _auditArgs(args, redactIndexes = new Set()) {
    const sanitized = this._sanitizeAuditArgs(args);
    for (const index of redactIndexes) {
      sanitized[index] = "***REDACTED***";
    }
    return sanitized;
  }

  _stripAuditControlOptions(options) {
    delete options.auditRedactArgIndexes;
  }

  _applyCredentialBoundary(command, args, spawnOptions, origin) {
    const originalArgs = Array.isArray(args) ? [...args] : [];
    const originalEnv = spawnOptions.env || process.env;
    const input = {
      ...spawnOptions,
      env: originalEnv,
      args: originalArgs,
      file: command,
      origin,
    };
    let filtered;
    let report = null;
    if (typeof this._credentialAgent.applyWithReport === "function") {
      const result = this._credentialAgent.applyWithReport(input);
      filtered = result.spawnOptions;
      report = result.report;
    } else {
      filtered = this._credentialAgent.apply(input);
    }
    const filteredArgs = Array.isArray(filtered?.args)
      ? filtered.args
      : originalArgs;
    const filteredEnv = filtered?.env || {};
    const inferredEnvCount = Object.keys(originalEnv).filter(
      (key) =>
        this._credentialAgent.isSensitiveKey?.(key) &&
        !Object.prototype.hasOwnProperty.call(filteredEnv, key),
    ).length;
    const inferredArgCount = originalArgs.reduce(
      (count, value, index) =>
        count + (String(value) === String(filteredArgs[index]) ? 0 : 1),
      0,
    );
    const credentialReport = report || {
      envCount: inferredEnvCount,
      argCount: inferredArgCount,
      filtered: inferredEnvCount > 0 || inferredArgCount > 0,
    };
    return {
      args: filteredArgs,
      env: filteredEnv,
      report: credentialReport,
    };
  }

  _createCredentialContext(command, options, executionId, decision) {
    if (typeof this._credentialAgent.createBrokerContext !== "function") {
      return options.credentialContext;
    }
    const supplied = options.credentialContext || {};
    return this._credentialAgent.createBrokerContext({
      approvalId: `${executionId}:${decision}`,
      process: command,
      host:
        supplied.target?.host ??
        supplied.host ??
        options.credentialTarget?.host ??
        options.credentialTargetHost ??
        null,
      ttlMs: supplied.ttlMs ?? options.credentialTtlMs,
      maxUses: supplied.maxUses ?? options.credentialMaxUses,
    });
  }

  _stripCredentialControlOptions(options) {
    delete options.credentialContext;
    delete options.credentialApproved;
    delete options.credentialApprovalId;
    delete options.credentialTarget;
    delete options.credentialTargetHost;
    delete options.credentialTtlMs;
    delete options.credentialMaxUses;
  }

  _recordCredentialReport(auditEntry, report) {
    const filtered = report?.filtered === true;
    auditEntry.credentialFiltered = filtered;
    auditEntry.credentialEnvCount = Number(report?.envCount || 0);
    auditEntry.credentialArgCount = Number(report?.argCount || 0);
    if (filtered) this._stats.credFiltered++;
  }

  _getTraceContext() {
    const traceCtx = getTraceCtx();
    const activeContext = traceCtx?.traceContext?.getCurrentContext?.() || null;
    if (!activeContext) return null;
    return {
      ...activeContext,
      traceparent: traceCtx.traceContext.formatTraceparent(
        activeContext.traceId,
        activeContext.spanId,
      ),
    };
  }

  _writeRplEntry(auditEntry, status = "started", error = null) {
    const rpl = getRpl();
    if (!rpl) return;
    try {
      const traceCtx = this._getTraceContext();
      if (typeof rpl.record !== "function") return;
      rpl.record(
        "process.execution",
        {
          component: auditEntry.origin,
          action: "spawn",
          artifactId: auditEntry.executionId,
          artifactType: "subprocess",
          inputs: {
            command: auditEntry.command,
            args: auditEntry.args,
            cwd: auditEntry.cwd,
          },
          outputs:
            status === "completed"
              ? { exitCode: auditEntry.exitCode || 0 }
              : error
                ? { error: error.message }
                : {},
          permissions: {
            decision: auditEntry.permissionDecision,
            policy: auditEntry.policy,
            scope: auditEntry.scope,
          },
          sandbox: {
            applied: auditEntry.sandboxed === true,
            backend: auditEntry.sandboxBackend || null,
            guarantees: [...(auditEntry.sandboxGuarantees || [])],
            policyAttested: auditEntry.sandboxPolicyAttested === true,
            policyDigest: auditEntry.sandboxPolicyDigest || null,
            filesystemPolicy: auditEntry.sandboxFilesystemPolicy || null,
            networkPolicy: auditEntry.sandboxNetworkPolicy || null,
            processTreePolicy: auditEntry.sandboxProcessTreePolicy || null,
          },
          traceId:
            traceCtx?.traceId || auditEntry.traceId || `trace-${Date.now()}`,
          parentSpanId: traceCtx?.spanId || null,
          trustLevel:
            auditEntry.permissionDecision === "deny" ? "untrusted" : "trusted",
        },
        auditEntry.origin,
      );
    } catch {
      // Provenance reporting must not hide the process execution result.
    }
  }

  _emitHooksEvent(event, data) {
    const hooks = this._hooksEventSink;
    if (!hooks) return;
    try {
      hooks.emit(event, data);
    } catch {
      // Hook reporting must not hide the process execution result.
    }
  }

  _setHooksEventSink(hooks) {
    if (hooks !== null && typeof hooks?.emit !== "function") {
      throw new TypeError("hooks event sink must expose emit()");
    }
    this._hooksEventSink = hooks;
  }

  _workspaceTransactionManager(stateDir, _lockDir) {
    const stateKey =
      typeof stateDir === "string" && stateDir.trim()
        ? path.resolve(stateDir)
        : "<default>";
    // Lock authority is intentionally not caller-selectable. Keep accepting
    // legacy lockDir-bearing option objects at the Broker boundary, but route
    // every one of them to the same canonical manager.
    const key = `${stateKey}\0<default>`;
    let manager = this._workspaceTransactionManagers.get(key);
    if (!manager) {
      manager = new WorkspaceTransactionManager({
        ...(stateKey === "<default>" ? {} : { stateDir: stateKey }),
      });
      this._workspaceTransactionManagers.set(key, manager);
    }
    return manager;
  }

  _workspaceTransactionMembershipForCwd(cwd) {
    const memberships = [];
    for (const manager of this._workspaceTransactionManagers.values()) {
      const membership = manager.activeWorkspaceMembershipForCwd(cwd);
      if (!membership) continue;
      const key =
        process.platform === "win32"
          ? path.resolve(membership.workspaceRoot).toLowerCase()
          : path.resolve(membership.workspaceRoot);
      if (!memberships.some((entry) => entry.key === key)) {
        memberships.push({ key, ...membership });
      }
    }
    if (memberships.length > 1) {
      const error = new Error(
        "multiple workspace transactions claim the same process cwd",
      );
      error.code = "WORKSPACE_TRANSACTION_OVERLAPPING_WORKSPACE";
      error.workspaceRoots = memberships.map((entry) => entry.workspaceRoot);
      throw error;
    }
    return memberships[0] || null;
  }

  _workspaceTransactionRequiredBoundaries(cwd, membership = undefined) {
    const resolved =
      membership === undefined
        ? this._workspaceTransactionMembershipForCwd(cwd)
        : membership;
    return resolved ? [SANDBOX_BOUNDARIES.PROCESS_TREE] : [];
  }

  _workspaceTransactionRootForCwd(cwd, membership = undefined) {
    const resolved =
      membership === undefined
        ? this._workspaceTransactionMembershipForCwd(cwd)
        : membership;
    return resolved?.workspaceRoot || null;
  }

  _withWorkspaceTransactionBoundaries(
    options,
    cwd,
    { command, args = [], sync = false, pty = false } = {},
  ) {
    const membership = this._workspaceTransactionMembershipForCwd(cwd);
    const required = this._workspaceTransactionRequiredBoundaries(
      cwd,
      membership,
    );
    if (required.length === 0) return options;
    if (
      options.requiredBoundaries !== undefined &&
      !Array.isArray(options.requiredBoundaries)
    ) {
      // Preserve the invalid value so normal policy validation rejects it.
      return options;
    }
    const nextOptions = {
      ...options,
      ...(membership?.cwd ? { cwd: membership.cwd } : {}),
      requiredBoundaries: [
        ...new Set([...(options.requiredBoundaries || []), ...required]),
      ],
    };
    const workspaceRoot = this._workspaceTransactionRootForCwd(cwd, membership);
    // Transaction preflight always rejects detached writers. Do not let a
    // platform contract fail first and hide that stable, typed denial.
    if (
      workspaceRoot &&
      nextOptions.detached !== true &&
      nextOptions.sandboxExecutionContract === undefined
    ) {
      const contract = this.issueLinuxWorkspaceSandboxExecutionContract(
        command,
        args,
        nextOptions,
        workspaceRoot,
        { sync, pty },
      );
      if (contract) nextOptions.sandboxExecutionContract = contract;
    }
    return nextOptions;
  }

  _requiresExplicitLinuxWorkspaceShell(cwd) {
    return (
      process.platform === "linux" &&
      this._workspaceTransactionRequiredBoundaries(cwd).length > 0
    );
  }

  _explicitLinuxShellInvocation(command, options = {}) {
    return {
      command:
        typeof options.shell === "string" && options.shell.trim()
          ? options.shell
          : "/bin/sh",
      args: ["-c", String(command)],
    };
  }

  /**
   * Start a fail-closed, content-addressed workspace checkpoint transaction.
   *
   * Active transactions automatically bind every Broker spawn whose canonical
   * cwd is inside their workspace. The transaction itself owns accept/rollback
   * and durable evidence APIs.
   */
  beginWorkspaceTransaction(options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).begin(options);
  }

  recoverWorkspaceTransactions(options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).recoverPending(options);
  }

  inspectWorkspaceTransaction(id, options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).inspect(id);
  }

  listWorkspaceTransactions(options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).list(options);
  }

  restoreWorkspaceTransaction(id, options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).restore(id, options);
  }

  undoWorkspaceTransactionRestore(id, options = {}) {
    return this._workspaceTransactionManager(
      options.stateDir,
      options.lockDir,
    ).undoRestore(id, options);
  }

  getWorkspaceTransaction(id) {
    for (const manager of this._workspaceTransactionManagers.values()) {
      const transaction = manager.get(id);
      if (transaction) return transaction;
    }
    return null;
  }

  _prepareWorkspaceTransactionAudit(auditEntry) {
    const transactionIds = [];
    for (const manager of this._workspaceTransactionManagers.values()) {
      transactionIds.push(...manager.prepareSpawn(auditEntry));
    }
    auditEntry.workspaceTransactionIds = [...new Set(transactionIds)].sort();
    return auditEntry.workspaceTransactionIds;
  }

  _preflightWorkspaceTransactionAudit(auditEntry) {
    const transactionIds = [];
    try {
      for (const manager of this._workspaceTransactionManagers.values()) {
        transactionIds.push(...manager.preflightSpawn(auditEntry));
      }
    } catch (error) {
      error.auditEntry = auditEntry;
      throw error;
    }
    return [...new Set(transactionIds)].sort();
  }

  _bindWorkspaceTransactionProcess(auditEntry, proc) {
    for (const manager of this._workspaceTransactionManagers.values()) {
      manager.bindProcess(auditEntry, proc);
    }
  }

  _updateWorkspaceTransactionProcessGuarantees(auditEntry) {
    for (const manager of this._workspaceTransactionManagers.values()) {
      manager.updateProcessGuarantees(auditEntry);
    }
  }

  _settleWorkspaceTransactionSpawn(auditEntry, outcome = {}) {
    for (const manager of this._workspaceTransactionManagers.values()) {
      manager.settleSpawn(auditEntry, outcome);
    }
  }

  spawn(command, args, options = {}) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "unknown";
    const requestedCwd = options.cwd || process.cwd();
    const mcpStdioExecutableIdentityAuthority =
      options.mcpStdioExecutableIdentityAuthority;
    const identityCommand = command;
    const identityArgs = [...(args || [])];
    options = this._withWorkspaceTransactionBoundaries(options, requestedCwd, {
      command,
      args,
      sync: false,
    });
    const cwd = options.cwd || requestedCwd;
    const scope = options.scope || "default";
    const policy = options.policy || this._checkPermission(origin, command);
    const isDangerous = this._isDangerousCommand(
      typeof command === "string" ? command : command?.toString?.() || "",
    );
    let decision = policy;
    if (isDangerous && policy !== "deny") decision = "deny";
    if (options.forceAllow) decision = "elevated";
    const auditRedactArgIndexes = this._normalizeAuditRedactArgIndexes(
      options.auditRedactArgIndexes,
      Array.isArray(args) ? args.length : 0,
    );

    const traceCtx = this._getTraceContext();
    const auditEntry = {
      executionId,
      traceId: traceCtx?.traceId || null,
      origin,
      scope,
      command,
      args: this._auditArgs(args, auditRedactArgIndexes),
      cwd,
      startTime,
      permissionDecision: decision,
      policy,
      isDangerous,
      shell: !!options.shell,
      detached: options.detached === true,
      pid: null,
      exitCode: null,
      endTime: null,
      durationMs: null,
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
      pluginExecutableIdentity: this._normalizePluginExecutableIdentity(
        options.pluginExecutableIdentity,
      ),
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxBackend: null,
      mcpStdioExecutableIdentityDigest: null,
    };

    let sandboxPolicy;
    try {
      sandboxPolicy = this._normalizeSandboxPolicy(options, {
        command,
        args,
        sync: false,
      });
      auditEntry.sandboxRequired = [...sandboxPolicy.requiredBoundaries];
    } catch (sandboxPolicyError) {
      this._recordSandboxDenial(auditEntry, sandboxPolicyError, startTime);
      sandboxPolicyError.auditEntry = auditEntry;
      throw sandboxPolicyError;
    }

    if (decision === "deny" || decision === "prompt") {
      auditEntry.deniedReason = isDangerous
        ? "dangerous_command"
        : `policy_${decision}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      this._emitHooksEvent("tool:end", {
        executionId,
        success: false,
        error: auditEntry.deniedReason,
        component: origin,
      });
      const err = new Error(
        `Process spawn denied: ${auditEntry.deniedReason} (origin=${origin}, command=${command})`,
      );
      err.auditEntry = auditEntry;
      throw err;
    }

    // 传播traceparent环境变量
    this._preflightWorkspaceTransactionAudit(auditEntry);

    const spawnOpts = this._sanitizeOptions(options);
    this._stripSandboxControlOptions(spawnOpts);
    this._stripPluginControlOptions(spawnOpts);
    this._stripWorkspaceTransactionOptions(spawnOpts);
    this._stripAuditControlOptions(spawnOpts);
    delete spawnOpts.mcpStdioExecutableIdentityAuthority;
    delete spawnOpts.mcpStdioExecutableIdentityDigest;
    if (traceCtx) {
      spawnOpts.env = { ...(spawnOpts.env || process.env) };
      Object.assign(
        spawnOpts.env,
        getTraceCtx()?.traceContext?.getPropagationEnv?.() || {
          TRACEPARENT: traceCtx.traceparent,
        },
      );
    }

    // P0-1: Credential filtering (default-on) — strip secrets from env/args
    if (this._credentialBoundaryEnabled()) {
      spawnOpts.credentialContext = this._createCredentialContext(
        command,
        spawnOpts,
        executionId,
        decision,
      );
      const credentialBoundary = this._applyCredentialBoundary(
        command,
        args,
        spawnOpts,
        origin,
      );
      spawnOpts.env = credentialBoundary.env;
      args = credentialBoundary.args;
      auditEntry.args = this._auditArgs(args, auditRedactArgIndexes);
      this._recordCredentialReport(auditEntry, credentialBoundary.report);
      this._stripCredentialControlOptions(spawnOpts);
    }

    // P0-1: Platform sandbox wrapping — apply macOS/Windows/Linux sandbox
    let sandboxPlan;
    try {
      sandboxPlan = this._prepareSandboxPlan(command, args || [], spawnOpts, {
        sandboxPolicy,
      });
    } catch (sandboxErr) {
      if (
        this._sandboxStrictEnabled() ||
        sandboxErr.sandboxFailClosed ||
        sandboxPolicy.requiredBoundaries.length > 0
      ) {
        this._recordSandboxDenial(auditEntry, sandboxErr, startTime);
        sandboxErr.auditEntry = auditEntry;
        throw sandboxErr;
      }
      process.emitWarning(
        `Sandbox init failed (continuing without): ${sandboxErr.message}`,
      );
      sandboxPlan = this._sandboxUnavailablePlan(
        command,
        args || [],
        spawnOpts,
        `sandbox_init_failed: ${sandboxErr.message}`,
        sandboxPolicy,
      );
    }
    command = sandboxPlan.command;
    args = [...sandboxPlan.args];
    const optsForSpawn = { ...sandboxPlan.options };
    this._applySandboxAudit(
      auditEntry,
      sandboxPlan,
      sandboxPlan.applied && !sandboxPlan.postSpawn.required,
    );
    try {
      this._prepareWorkspaceTransactionAudit(auditEntry);
    } catch (transactionError) {
      sandboxPlan.cleanup?.();
      transactionError.auditEntry = auditEntry;
      throw transactionError;
    }

    // Use native spawn from _native (set by patch-child-process.js)
    const nativeSpawnFn = this._native?.spawn || nativeSpawn;
    let proc;
    let workspaceProcessClosed = null;
    try {
      const macPlanBindingDeclared =
        sandboxPlan.platform === "darwin" &&
        sandboxPlan.runtimeProbe?.planBindingMechanism ===
          "macos-mcp-code-snapshot-plan-binding-v1";
      const builtInMacMcpPlan =
        admittedMacMcpCodeSnapshotPlans.has(sandboxPlan);
      if (macPlanBindingDeclared && !builtInMacMcpPlan) {
        throw this._sandboxError(
          "macos_mcp_plan_binding_consumed",
          "macOS MCP sandbox plan binding is unavailable or already consumed",
        );
      }
      if (builtInMacMcpPlan) {
        admittedMacMcpCodeSnapshotPlans.delete(sandboxPlan);
      }
      if (mcpStdioExecutableIdentityAuthority !== undefined) {
        const admitted = consumeMcpStdioExecutableIdentityAuthority(
          mcpStdioExecutableIdentityAuthority,
          {
            command: identityCommand,
            args: identityArgs,
            env: optsForSpawn.env || {},
          },
        );
        auditEntry.mcpStdioExecutableIdentityDigest = admitted.identityDigest;
      }
      proc = nativeSpawnFn(command, args, optsForSpawn);
      if (builtInMacMcpPlan) {
        const callerLifeline = proc?.stdio?.[8];
        if (
          !callerLifeline ||
          typeof callerLifeline !== "object" ||
          callerLifeline.destroyed === true ||
          typeof callerLifeline.destroy !== "function"
        ) {
          try {
            proc?.kill?.("SIGKILL");
          } catch {
            // The missing lifeline is already a fail-closed launch failure.
          }
          throw this._sandboxError(
            "macos_mcp_caller_lifeline_unavailable",
            "macOS MCP launch did not retain its Broker-side caller lifeline",
          );
        }
        Object.defineProperty(proc, "macosMcpCallerLifeline", {
          configurable: false,
          enumerable: false,
          writable: false,
          value: callerLifeline,
        });
      }
      workspaceProcessClosed = this._createWorkspaceProcessCloseFence(
        auditEntry,
        proc,
      );
      this._bindWorkspaceTransactionProcess(auditEntry, proc);
    } catch (spawnError) {
      if (proc) {
        throw this._postSpawnOwnershipError(spawnError, {
          proc,
          auditEntry,
          workspaceProcessClosed,
          cleanup: sandboxPlan.cleanup,
        });
      } else {
        try {
          this._settleWorkspaceTransactionSpawn(auditEntry, {
            error: spawnError.message,
          });
        } catch {
          // An unsettled durable execution keeps the transaction fail-closed.
        }
      }
      sandboxPlan.cleanup?.();
      throw spawnError;
    }
    auditEntry.pid = proc.pid;
    let cleanupSandbox = sandboxPlan.cleanup;
    try {
      cleanupSandbox = this._scheduleSandboxCleanup(proc, sandboxPlan.cleanup);
      if (
        sandboxPlan.applied === true &&
        (sandboxPlan.backend === "linux-bwrap-workspace" ||
          sandboxPlan.backend === "linux-bwrap" ||
          sandboxPlan.backend === "linux-fd-code-snapshot" ||
          sandboxPlan.backend === "macos-signed-root-fd-launcher") &&
        sandboxPlan.postSpawn.required === false
      ) {
        // child_process.spawn() has synchronously duplicated every stdio entry
        // into the launched process before returning. The generic/direct bwrap
        // backends and the MCP code-snapshot backends are complete pre-spawn
        // plans. macOS retains its independently created stdio[8] lifeline on
        // ChildProcess for the full process lifetime; cleanup closes only the
        // three already-duplicated source pins.
        cleanupSandbox();
      }
      try {
        this._runPostSpawnSandbox(proc, sandboxPlan, auditEntry);
        this._updateWorkspaceTransactionProcessGuarantees(auditEntry);
        auditEntry.pid = proc.pid;
        if (Number.isSafeInteger(proc.sandboxWrapperPid)) {
          auditEntry.sandboxWrapperPid = proc.sandboxWrapperPid;
        }
        if (Number.isSafeInteger(proc.sandboxTargetPid)) {
          auditEntry.sandboxTargetPid = proc.sandboxTargetPid;
        }
      } catch (postSpawnError) {
        if (postSpawnError.processTerminationRequested !== true) {
          try {
            proc.kill?.("SIGKILL");
          } catch {
            // The close fence remains pending and recovery stays fail-closed.
          }
        }
        cleanupSandbox();
        this._recordSandboxDenial(auditEntry, postSpawnError, startTime);
        postSpawnError.auditEntry = auditEntry;
        postSpawnError.spawnedProcess = proc;
        postSpawnError.workspaceProcessClosed = workspaceProcessClosed;
        postSpawnError.workspaceTerminationRequested = true;
        throw postSpawnError;
      }

      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "started");
      this._emitHooksEvent("tool:start", {
        executionId,
        toolName: origin,
        command,
        args: [...auditEntry.args],
        cwd,
        pid: proc.pid,
        component: origin,
      });

      proc.on("exit", (code, signal) => {
        const endTime = Date.now();
        auditEntry.exitCode = code;
        auditEntry.signal = signal;
        auditEntry.endTime = endTime;
        auditEntry.durationMs = endTime - startTime;
        this._writeRplEntry(auditEntry, "completed");
        this._emitHooksEvent("tool:end", {
          executionId,
          success: code === 0,
          exitCode: code,
          signal,
          durationMs: auditEntry.durationMs,
          component: origin,
        });
        this.emit("exit", auditEntry);
      });
      proc.on("error", (err) => {
        auditEntry.error = err.message;
        auditEntry.endTime = Date.now();
        auditEntry.durationMs = auditEntry.endTime - startTime;
        this._writeRplEntry(auditEntry, "error", err);
        this._emitHooksEvent("tool:end", {
          executionId,
          success: false,
          error: err.message,
          component: origin,
        });
        // EventEmitter treats an unhandled `error` event as an exception. A
        // process ENOENT must reach the child-process listener/callback instead
        // of crashing callers that did not subscribe to broker diagnostics.
        if (this.listenerCount("error") > 0) this.emit("error", auditEntry);
      });
      return proc;
    } catch (postNativeError) {
      throw this._postSpawnOwnershipError(postNativeError, {
        proc,
        auditEntry,
        workspaceProcessClosed,
        cleanup: cleanupSandbox,
      });
    }
  }

  spawnSync(command, args, options = {}) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "unknown";
    const requestedCwd = options.cwd || process.cwd();
    options = this._withWorkspaceTransactionBoundaries(options, requestedCwd, {
      command,
      args,
      sync: true,
    });
    const cwd = options.cwd || requestedCwd;
    const scope = options.scope || "default";
    const policy = options.policy || this._checkPermission(origin, command);
    const isDangerous = this._isDangerousCommand(
      typeof command === "string" ? command : command?.toString?.() || "",
    );
    let decision = policy;
    if (isDangerous && policy !== "deny") decision = "deny";
    if (options.forceAllow) decision = "elevated";
    const auditRedactArgIndexes = this._normalizeAuditRedactArgIndexes(
      options.auditRedactArgIndexes,
      Array.isArray(args) ? args.length : 0,
    );

    const traceCtx = this._getTraceContext();
    const auditEntry = {
      executionId,
      traceId: traceCtx?.traceId || null,
      origin,
      scope,
      command,
      args: this._auditArgs(args, auditRedactArgIndexes),
      cwd,
      startTime,
      permissionDecision: decision,
      policy,
      isDangerous,
      shell: !!options.shell,
      detached: options.detached === true,
      sync: true,
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
      pluginExecutableIdentity: this._normalizePluginExecutableIdentity(
        options.pluginExecutableIdentity,
      ),
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxBackend: null,
    };

    let sandboxPolicy;
    try {
      sandboxPolicy = this._normalizeSandboxPolicy(options, {
        command,
        args,
        sync: true,
      });
      auditEntry.sandboxRequired = [...sandboxPolicy.requiredBoundaries];
    } catch (sandboxPolicyError) {
      this._recordSandboxDenial(auditEntry, sandboxPolicyError, startTime);
      sandboxPolicyError.auditEntry = auditEntry;
      throw sandboxPolicyError;
    }

    if (decision === "deny" || decision === "prompt") {
      auditEntry.deniedReason = isDangerous
        ? "dangerous_command"
        : `policy_${decision}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      const err = new Error(
        `Process spawnSync denied: ${auditEntry.deniedReason}`,
      );
      err.auditEntry = auditEntry;
      throw err;
    }

    this._preflightWorkspaceTransactionAudit(auditEntry);

    const spawnOpts = this._sanitizeOptions(options);
    this._stripSandboxControlOptions(spawnOpts);
    this._stripPluginControlOptions(spawnOpts);
    this._stripWorkspaceTransactionOptions(spawnOpts);
    this._stripAuditControlOptions(spawnOpts);
    if (traceCtx) {
      spawnOpts.env = { ...(spawnOpts.env || process.env) };
      Object.assign(
        spawnOpts.env,
        getTraceCtx()?.traceContext?.getPropagationEnv?.() || {
          TRACEPARENT: traceCtx.traceparent,
        },
      );
    }

    // P0-1: Credential filtering agent — strip secrets from env/args before spawn
    if (this._credentialBoundaryEnabled()) {
      spawnOpts.credentialContext = this._createCredentialContext(
        command,
        spawnOpts,
        executionId,
        decision,
      );
      const credentialBoundary = this._applyCredentialBoundary(
        command,
        args,
        spawnOpts,
        origin,
      );
      spawnOpts.env = credentialBoundary.env;
      args = credentialBoundary.args;
      auditEntry.args = this._auditArgs(args, auditRedactArgIndexes);
      this._recordCredentialReport(auditEntry, credentialBoundary.report);
      this._stripCredentialControlOptions(spawnOpts);
    }

    // P0-1: Platform sandbox wrapping (sync path)
    let sandboxPlan;
    try {
      sandboxPlan = this._prepareSandboxPlan(command, args || [], spawnOpts, {
        sync: true,
        sandboxPolicy,
      });
    } catch (sandboxErr) {
      if (
        this._sandboxStrictEnabled() ||
        sandboxErr.sandboxFailClosed ||
        sandboxPolicy.requiredBoundaries.length > 0
      ) {
        this._recordSandboxDenial(auditEntry, sandboxErr, startTime);
        sandboxErr.auditEntry = auditEntry;
        throw sandboxErr;
      }
      process.emitWarning(
        `Sandbox init failed (sync, continuing without): ${sandboxErr.message}`,
      );
      sandboxPlan = this._sandboxUnavailablePlan(
        command,
        args || [],
        spawnOpts,
        `sandbox_init_failed: ${sandboxErr.message}`,
        sandboxPolicy,
      );
    }
    command = sandboxPlan.command;
    args = [...sandboxPlan.args];
    const optsForSync = { ...sandboxPlan.options };
    this._applySandboxAudit(auditEntry, sandboxPlan, sandboxPlan.applied);
    try {
      this._prepareWorkspaceTransactionAudit(auditEntry);
    } catch (transactionError) {
      sandboxPlan.cleanup?.();
      transactionError.auditEntry = auditEntry;
      throw transactionError;
    }

    const nativeSpawnSyncFn = this._native?.spawnSync || nativeSpawnSync;
    try {
      const macPlanBindingDeclared =
        sandboxPlan.platform === "darwin" &&
        sandboxPlan.runtimeProbe?.planBindingMechanism ===
          "macos-mcp-code-snapshot-plan-binding-v1";
      const builtInMacMcpPlan =
        admittedMacMcpCodeSnapshotPlans.has(sandboxPlan);
      if (macPlanBindingDeclared && !builtInMacMcpPlan) {
        throw this._sandboxError(
          "macos_mcp_plan_binding_consumed",
          "macOS MCP sandbox plan binding is unavailable or already consumed",
        );
      }
      if (builtInMacMcpPlan) {
        // spawnSync owns the parent endpoint for stdio[8] until the helper
        // exits; burning before entry prevents replay on every outcome.
        admittedMacMcpCodeSnapshotPlans.delete(sandboxPlan);
      }
      const result = nativeSpawnSyncFn(command, args, optsForSync);
      this._settleWorkspaceTransactionSpawn(auditEntry, {
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message || null,
      });
      if (sandboxPlan.applied) this._stats.sandboxed++;
      auditEntry.exitCode = result.status;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "completed");
      return result;
    } catch (err) {
      try {
        this._settleWorkspaceTransactionSpawn(auditEntry, {
          error: err.message,
        });
      } catch {
        // Preserve the primary spawn failure; transaction settlement remains
        // fail-closed and blocks accept/rollback.
      }
      auditEntry.error = err.message;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "error", err);
      throw err;
    } finally {
      sandboxPlan.cleanup?.();
    }
  }

  /**
   * Route a node-pty session through the same provenance and credential
   * boundary as child_process execution. Policy-free sessions retain native
   * node-pty semantics. A policy-bearing Linux session uses node-pty only to
   * allocate a dedicated terminal; child_process then duplicates its slave
   * together with the descriptor-pinned generic bwrap plan.
   */
  spawnPty(ptyModule, command, args = [], options = {}) {
    if (!ptyModule || typeof ptyModule.spawn !== "function") {
      throw new TypeError("pty_module_spawn_unavailable");
    }
    options = this._withWorkspaceTransactionBoundaries(
      options,
      options.cwd || process.cwd(),
      { command, args, sync: false, pty: true },
    );
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const origin = options.origin || "terminal:pty";
    const scope = options.scope || "terminal";
    const policy = options.policy || "allow";
    const auditRedactArgIndexes = this._normalizeAuditRedactArgIndexes(
      options.auditRedactArgIndexes,
      Array.isArray(args) ? args.length : 0,
    );
    const auditEntry = {
      executionId,
      traceId: this._getTraceContext()?.traceId || null,
      origin,
      scope,
      command,
      args: this._auditArgs(args, auditRedactArgIndexes),
      cwd: options.cwd || process.cwd(),
      startTime,
      permissionDecision: policy,
      policy,
      operation: "pty.spawn",
      pty: true,
      detached: options.detached === true,
      sandboxed: false,
      sandboxReason: "native_pty_host_boundary",
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxBackend: null,
      pluginId: options.pluginId || null,
      pluginVersion: options.pluginVersion || null,
      pluginSource: options.pluginSource || null,
      pluginExecutableIdentity: this._normalizePluginExecutableIdentity(
        options.pluginExecutableIdentity,
      ),
    };
    let sandboxPolicy;
    try {
      sandboxPolicy = this._normalizeSandboxPolicy(options, {
        command,
        args,
        sync: false,
        pty: true,
      });
      auditEntry.sandboxRequired = [...sandboxPolicy.requiredBoundaries];
    } catch (sandboxPolicyError) {
      this._recordSandboxDenial(auditEntry, sandboxPolicyError, startTime);
      sandboxPolicyError.auditEntry = auditEntry;
      throw sandboxPolicyError;
    }
    if (policy === "deny" || policy === "prompt") {
      auditEntry.deniedReason = `policy_${policy}`;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = 0;
      this._recordAudit(auditEntry);
      this._writeRplEntry(
        auditEntry,
        "denied",
        new Error(auditEntry.deniedReason),
      );
      const error = new Error(`PTY spawn denied: ${auditEntry.deniedReason}`);
      error.auditEntry = auditEntry;
      throw error;
    }

    const spawnOptions = { ...options, args: [...args] };
    this._stripSandboxControlOptions(spawnOptions);
    this._stripPluginControlOptions(spawnOptions);
    this._stripWorkspaceTransactionOptions(spawnOptions);
    this._stripAuditControlOptions(spawnOptions);
    try {
      const terminalName =
        typeof options.name === "string" && options.name
          ? options.name
          : "xterm";
      spawnOptions.env = {
        ...(spawnOptions.env || process.env),
        TERM: terminalName,
      };
      if (this._credentialBoundaryEnabled()) {
        spawnOptions.credentialContext = this._createCredentialContext(
          command,
          spawnOptions,
          executionId,
          policy,
        );
        const credentialBoundary = this._applyCredentialBoundary(
          command,
          args,
          spawnOptions,
          origin,
        );
        spawnOptions.env = credentialBoundary.env;
        spawnOptions.args = credentialBoundary.args;
        auditEntry.args = this._auditArgs(
          credentialBoundary.args,
          auditRedactArgIndexes,
        );
        this._recordCredentialReport(auditEntry, credentialBoundary.report);
        this._stripCredentialControlOptions(spawnOptions);
      }
      const filteredArgs = spawnOptions.args || [];
      delete spawnOptions.args;
      this._prepareWorkspaceTransactionAudit(auditEntry);

      if (sandboxPolicy.requiredBoundaries.length === 0) {
        delete spawnOptions.origin;
        delete spawnOptions.policy;
        delete spawnOptions.scope;
        const proc = ptyModule.spawn(command, filteredArgs, spawnOptions);
        try {
          this._bindWorkspaceTransactionProcess(auditEntry, proc);
        } catch (transactionError) {
          try {
            proc.kill?.();
          } catch {
            // The durable execution remains unsettled and blocks recovery.
          }
          throw transactionError;
        }
        auditEntry.pid = proc?.pid ?? null;
        auditEntry.endTime = Date.now();
        auditEntry.durationMs = auditEntry.endTime - startTime;
        this._recordAudit(auditEntry);
        this._writeRplEntry(auditEntry, "started");
        return proc;
      }

      let sandboxPlan;
      try {
        sandboxPlan = this._prepareSandboxPlan(
          command,
          filteredArgs,
          spawnOptions,
          {
            pty: true,
            sandboxPolicy,
          },
        );
        if (
          sandboxPlan.applied !== true ||
          sandboxPlan.backend !== "linux-bwrap-workspace" ||
          sandboxPlan.ptyPolicy?.mode !== "dedicated-controlling-terminal"
        ) {
          throw this._sandboxBoundaryError(
            "required_boundaries_unsatisfied",
            `PTY backend ${sandboxPlan.backend || sandboxPlan.candidateBackend || "unavailable"} cannot satisfy the dedicated terminal contract`,
            {
              requiredBoundaries: sandboxPolicy.requiredBoundaries,
              actualGuarantees: sandboxPlan.guarantees,
              missingBoundaries: sandboxPolicy.requiredBoundaries.filter(
                (boundary) => !sandboxPlan.guarantees.includes(boundary),
              ),
              sandboxBackend: sandboxPlan.backend,
              sandboxCandidateBackend: sandboxPlan.candidateBackend,
              sandboxRuntimeProbe: sandboxPlan.runtimeProbe,
              sandboxPolicyAttested: sandboxPlan.policyAttested,
              sandboxPolicyDigest: sandboxPlan.policyDigest,
            },
          );
        }
      } catch (sandboxError) {
        sandboxPlan?.cleanup?.();
        this._recordSandboxDenial(auditEntry, sandboxError, startTime);
        sandboxError.auditEntry = auditEntry;
        throw sandboxError;
      }

      let terminal;
      let slaveFd = null;
      let child;
      let proc;
      let terminalReleased = false;
      const releaseTerminal = () => {
        if (terminalReleased) return;
        terminalReleased = true;
        try {
          this._ptyAdapter.releaseTerminal(terminal);
        } catch {
          // The sandbox process exit remains authoritative.
        }
      };
      try {
        terminal = this._ptyAdapter.allocate(ptyModule, {
          cols: options.cols,
          rows: options.rows,
          encoding: options.encoding,
        });
        slaveFd = this._ptyAdapter.openBlockingSlave(terminal);
        const nativeSpawnFn = this._native?.spawn || nativeSpawn;
        child = nativeSpawnFn(sandboxPlan.command, sandboxPlan.args, {
          ...sandboxPlan.options,
          stdio: [
            slaveFd,
            slaveFd,
            slaveFd,
            ...sandboxPlan.options.stdio.slice(3),
          ],
        });
        proc = wrapSandboxedPty(terminal, child, command, this._ptyAdapter);
        this._bindWorkspaceTransactionProcess(auditEntry, proc);
      } catch (ptyError) {
        if (child && typeof child.kill === "function") {
          try {
            child.kill();
          } catch {
            // Continue fail-closed cleanup after a partial child launch.
          }
        }
        if (Number.isInteger(slaveFd)) {
          try {
            this._ptyAdapter.closeFd(slaveFd);
          } catch {
            // Preserve the allocation/spawn failure.
          }
        }
        sandboxPlan.cleanup?.();
        releaseTerminal();
        const sandboxError = this._sandboxBoundaryError(
          "pty_allocation_or_spawn_failed",
          `Strong Linux PTY launch failed: ${ptyError.message}`,
          {
            requiredBoundaries: sandboxPolicy.requiredBoundaries,
            actualGuarantees: [],
            missingBoundaries: sandboxPolicy.requiredBoundaries,
            sandboxBackend: sandboxPlan.backend,
            sandboxRuntimeProbe: sandboxPlan.runtimeProbe,
            sandboxPolicyAttested: sandboxPlan.policyAttested,
            sandboxPolicyDigest: sandboxPlan.policyDigest,
          },
        );
        this._recordSandboxDenial(auditEntry, sandboxError, startTime);
        sandboxError.auditEntry = auditEntry;
        throw sandboxError;
      }
      try {
        this._ptyAdapter.closeFd(slaveFd);
      } catch {
        try {
          child.kill();
        } catch {
          // Continue fail-closed cleanup even if the partial child already died.
        }
        sandboxPlan.cleanup?.();
        releaseTerminal();
        const sandboxError = this._sandboxBoundaryError(
          "pty_parent_slave_cleanup_failed",
          "Strong Linux PTY could not close its parent-side slave descriptor",
          {
            requiredBoundaries: sandboxPolicy.requiredBoundaries,
            missingBoundaries: sandboxPolicy.requiredBoundaries,
            sandboxBackend: sandboxPlan.backend,
          },
        );
        this._recordSandboxDenial(auditEntry, sandboxError, startTime);
        sandboxError.auditEntry = auditEntry;
        throw sandboxError;
      }
      sandboxPlan.cleanup?.();
      this._applySandboxAudit(auditEntry, sandboxPlan, true);
      this._updateWorkspaceTransactionProcessGuarantees(auditEntry);
      this._stats.sandboxed++;

      child.once("exit", (code, signal) => {
        releaseTerminal();
        auditEntry.exitCode = code;
        auditEntry.signal = signal;
        auditEntry.endTime = Date.now();
        auditEntry.durationMs = auditEntry.endTime - startTime;
        this._writeRplEntry(auditEntry, "completed");
        this.emit("exit", auditEntry);
      });
      child.once("error", (error) => {
        releaseTerminal();
        auditEntry.error = error.message;
        auditEntry.endTime = Date.now();
        auditEntry.durationMs = auditEntry.endTime - startTime;
        this._writeRplEntry(auditEntry, "error", error);
        if (this.listenerCount("error") > 0) this.emit("error", auditEntry);
      });
      auditEntry.pid = proc?.pid ?? null;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "started");
      return proc;
    } catch (error) {
      if (error.auditEntry === auditEntry) throw error;
      auditEntry.error = error.message;
      auditEntry.endTime = Date.now();
      auditEntry.durationMs = auditEntry.endTime - startTime;
      this._recordAudit(auditEntry);
      this._writeRplEntry(auditEntry, "error", error);
      throw error;
    }
  }

  exec(command, options, callback) {
    const opts = typeof options === "function" ? {} : options;
    const cb = typeof options === "function" ? options : callback;
    if (this._requiresExplicitLinuxWorkspaceShell(opts.cwd || process.cwd())) {
      const invocation = this._explicitLinuxShellInvocation(command, opts);
      return this.spawn(invocation.command, invocation.args, {
        ...opts,
        shell: false,
        origin: opts.origin || "shell:exec",
      });
    }
    return this.spawn(command, [], {
      ...opts,
      shell: true,
      origin: opts.origin || "shell:exec",
    });
  }

  execSync(command, options = {}) {
    if (
      this._requiresExplicitLinuxWorkspaceShell(options.cwd || process.cwd())
    ) {
      const invocation = this._explicitLinuxShellInvocation(command, options);
      const result = this.spawnSync(invocation.command, invocation.args, {
        ...options,
        shell: false,
        origin: options.origin || "shell:execSync",
      });
      if (result?.error) throw result.error;
      if (result?.status != null && result.status !== 0) {
        const error = new Error(
          `Command failed (exit ${result.status}): ${command}`,
        );
        error.status = result.status;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        throw error;
      }
      return result?.stdout ?? "";
    }
    const spawnOpts = {
      ...options,
      shell: true,
      origin: options.origin || "shell:execSync",
    };
    const result = this.spawnSync(command, [], spawnOpts);
    if (result?.error) throw result.error;
    if (result?.status != null && result.status !== 0) {
      const error = new Error(
        `Command failed (exit ${result.status}): ${command}`,
      );
      error.status = result.status;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }
    return result?.stdout ?? "";
  }

  execFile(file, args, options, callback) {
    if (typeof args === "function") {
      callback = args;
      args = [];
      options = {};
    } else if (!Array.isArray(args)) {
      callback = typeof options === "function" ? options : callback;
      options = args || {};
      args = [];
    } else if (typeof options === "function") {
      callback = options;
      options = {};
    }

    options = options || {};
    const proc = this.spawn(file, args, options);
    if (typeof callback !== "function") return proc;

    const stdoutChunks = [];
    const stderrChunks = [];
    const outputEncoding = options.encoding ?? "utf8";
    const returnBuffers =
      outputEncoding === "buffer" || outputEncoding === null;
    const configuredMaxBuffer = options.maxBuffer;
    const maxBuffer =
      configuredMaxBuffer === Infinity
        ? Infinity
        : Number.isFinite(configuredMaxBuffer) && configuredMaxBuffer >= 0
          ? configuredMaxBuffer
          : 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let completionError = null;
    let completed = false;

    const asBuffer = (chunk) =>
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const render = (chunks) => {
      const value = Buffer.concat(chunks);
      return returnBuffers ? value : value.toString(outputEncoding);
    };
    const finish = (error, code = null, signal = null) => {
      if (completed) return;
      completed = true;
      const stdout = render(stdoutChunks);
      const stderr = render(stderrChunks);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        if (error.status === undefined) error.status = code;
        if (error.signal === undefined) error.signal = signal;
      }
      callback(error, stdout, stderr);
    };
    const collect = (stream, chunks, streamName) => {
      if (!stream || typeof stream.on !== "function") return;
      stream.on("data", (chunk) => {
        const value = asBuffer(chunk);
        chunks.push(value);
        if (streamName === "stdout") stdoutBytes += value.length;
        else stderrBytes += value.length;
        const streamBytes = streamName === "stdout" ? stdoutBytes : stderrBytes;
        if (!completionError && streamBytes > maxBuffer) {
          completionError = new Error(`${streamName} maxBuffer exceeded`);
          completionError.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          completionError.stream = streamName;
          try {
            proc.kill(options.killSignal || "SIGTERM");
          } catch {
            // The maxBuffer error remains authoritative if the child exited.
          }
        }
      });
    };

    collect(proc.stdout, stdoutChunks, "stdout");
    collect(proc.stderr, stderrChunks, "stderr");
    proc.once("error", (error) => finish(error));
    proc.once("close", (code, signal) => {
      if (completionError) return finish(completionError, code, signal);
      if (code === 0) return finish(null, code, signal);
      const error = new Error(
        `Command failed (exit ${code ?? "unknown"}): ${file}`,
      );
      error.code = code;
      error.killed = Boolean(proc.killed);
      error.signal = signal;
      error.status = code;
      return finish(error, code, signal);
    });
    return proc;
  }

  execFileSync(file, args, options = {}) {
    if (!Array.isArray(args)) {
      options = args || {};
      args = [];
    }
    const result = this.spawnSync(file, args, options);
    if (result?.error) throw result.error;
    if (result?.status !== 0) {
      const error = new Error(
        `Command failed (exit ${result?.status ?? "unknown"}): ${file}`,
      );
      error.status = result?.status ?? null;
      error.signal = result?.signal ?? null;
      error.stdout = result?.stdout;
      error.stderr = result?.stderr;
      throw error;
    }
    return result?.stdout ?? "";
  }

  fork(modulePath, args, options = {}) {
    return this.spawn(process.execPath, [modulePath, ...(args || [])], {
      ...options,
      origin: options.origin || "fork",
    });
  }

  setPermission(origin, command, decision) {
    const key = command ? `${origin}:${command}` : `${origin}:default`;
    this._permissionState.set(key, decision);
  }

  getStats() {
    return { ...this._stats };
  }
  getAuditLog(limit = 100) {
    return this._auditLog.slice(-limit);
  }
  flushAuditLog() {
    const log = [...this._auditLog];
    this._auditLog = [];
    return log;
  }
}

const broker = new ProcessExecutionBroker();
export { broker as executionBroker, SANDBOX_BOUNDARIES };
export default broker;
