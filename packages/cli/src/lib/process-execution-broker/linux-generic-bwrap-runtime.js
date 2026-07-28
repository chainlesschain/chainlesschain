/**
 * Production resource acquisition for the generic Linux bubblewrap backend.
 *
 * Caller-supplied callbacks never cross this boundary. Every mount, the
 * bubblewrap executable, and the seccomp program is opened by this module and
 * independently re-attested before the final spawn plan is returned.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import {
  LINUX_GENERIC_BWRAP_BACKEND,
  LINUX_GENERIC_CONTRACT_KIND,
  planLinuxGenericBubblewrap,
} from "./linux-generic-bwrap.js";

const BWRAP_PATH = "/usr/bin/bwrap";
const MAX_ATTESTED_FILE_BYTES = 256 * 1024 * 1024;
const MAX_MOUNTINFO_BYTES = 4 * 1024 * 1024;
const MOUNTINFO_PATH = "/proc/self/mountinfo";
const MOUNT_TOPOLOGY_VERSION = 1;
const O_TMPFILE = 0x410000;
const SYSTEM_DESTINATIONS = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
];
const SYSTEM_ROOTS = new Set(SYSTEM_DESTINATIONS);
const SYSTEM_SYMLINKS = new Map([
  ["/bin", "usr/bin"],
  ["/sbin", "usr/sbin"],
  ["/lib", "usr/lib"],
  ["/lib32", "usr/lib32"],
  ["/lib64", "usr/lib64"],
]);
const ETC_ALLOWLIST = [
  "/etc/group",
  "/etc/hosts",
  "/etc/ld.so.cache",
  "/etc/nsswitch.conf",
  "/etc/passwd",
];
const FORBIDDEN_EXACT_WORKSPACE_ALIASES = [
  "/",
  "/home",
  "/home/sandbox",
  "/media",
  "/mnt",
  "/opt",
  "/root",
  "/run",
  "/srv",
  "/tmp",
  "/var",
  "/var/tmp",
];
const FORBIDDEN_WORKSPACE_ALIAS_SUBTREES = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/proc",
  "/sbin",
  "/sys",
  "/usr",
];
const OPAQUE_NON_ROOT_FILESYSTEMS = new Set([
  "9p",
  "aufs",
  "ceph",
  "cifs",
  "ecryptfs",
  "glusterfs",
  "nfs",
  "nfs4",
  "overlay",
  "smb3",
  "virtiofs",
]);
const REQUIRED_BWRAP_OPTIONS = [
  "--assert-userns-disabled",
  "--bind-fd",
  "--disable-userns",
  "--file",
  "--perms",
  "--remount-ro",
  "--ro-bind-fd",
  "--seccomp",
];
const SECCOMP_ARCHITECTURES = Object.freeze({
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

const DEFAULT_RUNTIME = Object.freeze({
  platform: os.platform(),
  arch: process.arch,
  execPath: process.execPath,
  fs,
  homedir: () => os.homedir(),
  tmpdir: () => os.tmpdir(),
  randomBytes: (size) => crypto.randomBytes(size),
  spawnSync: nativeSpawnSync,
});

function runtimeFor(overrides = {}) {
  return { ...DEFAULT_RUNTIME, ...overrides };
}

function realpath(runtime, value) {
  const implementation =
    runtime.fs.realpathSync?.native || runtime.fs.realpathSync;
  if (typeof implementation !== "function") {
    throw new Error("realpath_unavailable");
  }
  return implementation.call(runtime.fs.realpathSync, value);
}

function fileId(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function identity(realPath, stat) {
  return Object.freeze({
    realPath,
    fileId: Object.freeze(fileId(stat)),
    mode: Number(stat.mode),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
  });
}

function identityMatches(left, right) {
  return (
    left?.realPath === right?.realPath &&
    String(left?.fileId?.dev) === String(right?.fileId?.dev) &&
    String(left?.fileId?.ino) === String(right?.fileId?.ino) &&
    Number(left?.mode) === Number(right?.mode) &&
    Number(left?.uid) === Number(right?.uid) &&
    Number(left?.gid) === Number(right?.gid)
  );
}

function statMatchesIdentity(stat, expected, { directory }) {
  const expectedType = directory ? 0o040000 : 0o100000;
  return (
    String(stat?.dev) === String(expected?.fileId?.dev) &&
    String(stat?.ino) === String(expected?.fileId?.ino) &&
    Number(stat?.mode) === Number(expected?.mode) &&
    Number(stat?.uid) === Number(expected?.uid) &&
    Number(stat?.gid) === Number(expected?.gid) &&
    (Number(stat?.mode) & 0o170000) === expectedType
  );
}

function isWithin(root, target) {
  const relative = path.posix.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith("../") &&
      !path.posix.isAbsolute(relative))
  );
}

function rootOwned(stat, { directory, executable = false }) {
  const expectedType = directory ? 0o040000 : 0o100000;
  return (
    (Number(stat?.mode) & 0o170000) === expectedType &&
    Number(stat?.uid) === 0 &&
    (Number(stat?.mode) & 0o022) === 0 &&
    (!executable || (Number(stat?.mode) & 0o111) !== 0)
  );
}

function hashOpenFile(runtime, fd, bytes) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > MAX_ATTESTED_FILE_BYTES
  ) {
    throw new Error("attested_file_size_invalid");
  }
  const digest = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, bytes));
  let offset = 0;
  while (offset < bytes) {
    const requested = Math.min(buffer.length, bytes - offset);
    const read = runtime.fs.readSync(fd, buffer, 0, requested, offset);
    if (read <= 0) throw new Error("attested_file_read_failed");
    digest.update(buffer.subarray(0, read));
    offset += read;
  }
  return digest.digest("hex");
}

function buildNetworkSeccompFilter(arch) {
  const selected = SECCOMP_ARCHITECTURES[arch];
  if (!selected) {
    throw new Error(`unsupported_seccomp_architecture:${String(arch)}`);
  }
  const instructions = [
    [0x20, 0, 0, 4],
    [0x15, 1, 0, selected.auditArch],
    [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0],
  ];
  if (selected.x32SyscallBit) {
    instructions.push([0x54, 0, 0, ~selected.x32SyscallBit]);
  }
  instructions.push(
    [0x15, 0, 1, selected.socketSyscall],
    [0x06, 0, 0, 0x00050001],
    [0x15, 0, 1, selected.socketpairSyscall],
    [0x06, 0, 0, 0x00050001],
    [0x15, 0, 1, selected.ioUringSetupSyscall],
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
  return Object.freeze({
    arch,
    buffer,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function decodeMountInfoPath(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("mountinfo_path_invalid");
  }
  const decoded = [];
  const escapes = new Map([
    ["040", " "],
    ["011", "\t"],
    ["012", "\n"],
    ["134", "\\"],
  ]);
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") {
      decoded.push(value[index]);
      continue;
    }
    const octal = value.slice(index + 1, index + 4);
    if (!escapes.has(octal)) {
      throw new Error("mountinfo_path_escape_invalid");
    }
    decoded.push(escapes.get(octal));
    index += 3;
  }
  const result = decoded.join("");
  if (
    result.includes("\0") ||
    !path.posix.isAbsolute(result) ||
    path.posix.normalize(result) !== result
  ) {
    throw new Error("mountinfo_path_invalid");
  }
  return result;
}

function encodeMountInfoPath(value) {
  return String(value)
    .replaceAll("\\", "\\134")
    .replaceAll(" ", "\\040")
    .replaceAll("\t", "\\011")
    .replaceAll("\n", "\\012");
}

function parseMountInfo(runtime) {
  const raw = String(runtime.fs.readFileSync(MOUNTINFO_PATH, "utf8"));
  if (
    Buffer.byteLength(raw, "utf8") < 1 ||
    Buffer.byteLength(raw, "utf8") > MAX_MOUNTINFO_BYTES
  ) {
    throw new Error("mountinfo_size_invalid");
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (
      separator < 6 ||
      fields.length < separator + 4 ||
      !/^\d+$/.test(fields[0] || "") ||
      !/^\d+$/.test(fields[1] || "") ||
      !/^\d+:\d+$/.test(fields[2] || "")
    ) {
      throw new Error("mountinfo_entry_invalid");
    }
    const root = decodeMountInfoPath(fields[3]);
    const mountPoint = decodeMountInfoPath(fields[4]);
    const fsType = fields[separator + 1];
    if (
      !fsType ||
      fsType.includes("\0") ||
      fields.slice(separator + 1).some((field) => !field)
    ) {
      throw new Error("mountinfo_entry_invalid");
    }
    entries.push(
      Object.freeze({
        mountId: fields[0],
        parentId: fields[1],
        majorMinor: fields[2],
        root,
        mountPoint,
        fsType,
        lineDigest: sha256(line),
      }),
    );
  }
  if (entries.length === 0) throw new Error("mountinfo_empty");
  return entries;
}

function mountDepth(value) {
  return value === "/" ? 0 : value.split("/").filter(Boolean).length;
}

function containingMount(entries, target) {
  const candidates = entries.filter((entry) =>
    isWithin(entry.mountPoint, target),
  );
  if (candidates.length === 0) throw new Error("mountinfo_root_unavailable");
  const deepest = Math.max(
    ...candidates.map((entry) => mountDepth(entry.mountPoint)),
  );
  const matches = candidates.filter(
    (entry) => mountDepth(entry.mountPoint) === deepest,
  );
  if (matches.length !== 1) {
    throw new Error("mountinfo_workspace_mount_ambiguous");
  }
  return matches[0];
}

function sameDirectoryIdentity(left, right) {
  return (
    String(left?.dev ?? left?.fileId?.dev) ===
      String(right?.dev ?? right?.fileId?.dev) &&
    String(left?.ino ?? left?.fileId?.ino) ===
      String(right?.ino ?? right?.fileId?.ino)
  );
}

function workspaceMountTopology(runtime, workspaceRoot, workspaceIdentity) {
  const entries = parseMountInfo(runtime);
  const descendants = entries.filter(
    (entry) =>
      entry.mountPoint !== workspaceRoot &&
      isWithin(workspaceRoot, entry.mountPoint),
  );
  if (descendants.length > 0) {
    throw new Error("workspace_descendant_mount_detected");
  }

  const mountedBy = containingMount(entries, workspaceRoot);
  const rootMount = containingMount(entries, "/");
  const workspaceRelative = path.posix.relative(
    mountedBy.mountPoint,
    workspaceRoot,
  );
  const filesystemPath = path.posix.join(mountedBy.root, workspaceRelative);
  const sameFilesystem = entries.filter(
    (entry) => entry.majorMinor === mountedBy.majorMinor,
  );
  const aliases = new Set();
  for (const entry of sameFilesystem) {
    if (!isWithin(entry.root, filesystemPath)) continue;
    aliases.add(
      path.posix.join(
        entry.mountPoint,
        path.posix.relative(entry.root, filesystemPath),
      ),
    );
  }
  if (aliases.size === 0) {
    throw new Error("workspace_mount_provenance_unavailable");
  }
  if (
    mountedBy.mountPoint !== "/" &&
    mountedBy.root !== "/" &&
    mountedBy.mountPoint === workspaceRoot
  ) {
    throw new Error("workspace_root_bind_alias_forbidden");
  }
  if ([...aliases].some((alias) => alias !== workspaceRoot)) {
    throw new Error("workspace_root_alias_forbidden");
  }

  let home;
  try {
    home = realpath(runtime, runtime.homedir());
  } catch {
    throw new Error("workspace_home_identity_unavailable");
  }
  const forbiddenExact = new Set([
    ...FORBIDDEN_EXACT_WORKSPACE_ALIASES,
    ...FORBIDDEN_WORKSPACE_ALIAS_SUBTREES,
    home,
  ]);
  for (const alias of aliases) {
    if (
      forbiddenExact.has(alias) ||
      FORBIDDEN_WORKSPACE_ALIAS_SUBTREES.some((root) => isWithin(root, alias))
    ) {
      throw new Error("workspace_root_alias_forbidden");
    }
  }

  const forbiddenIdentities = [];
  for (const candidate of forbiddenExact) {
    try {
      const canonical = realpath(runtime, candidate);
      const stat = runtime.fs.statSync(canonical);
      if (!stat.isDirectory?.()) continue;
      const observed = {
        path: candidate,
        canonical,
        dev: String(stat.dev),
        ino: String(stat.ino),
      };
      forbiddenIdentities.push(observed);
      if (sameDirectoryIdentity(stat, workspaceIdentity)) {
        throw new Error("workspace_root_identity_alias_forbidden");
      }
    } catch (error) {
      if (error?.message === "workspace_root_identity_alias_forbidden") {
        throw error;
      }
      // Missing optional system roots do not weaken the paths that exist.
    }
  }

  const opaqueFilesystem =
    mountedBy.fsType.startsWith("fuse") ||
    OPAQUE_NON_ROOT_FILESYSTEMS.has(mountedBy.fsType);
  if (mountedBy.mountPoint !== "/" && opaqueFilesystem) {
    throw new Error("workspace_mount_provenance_opaque");
  }

  const lineage = entries.filter((entry) =>
    isWithin(entry.mountPoint, workspaceRoot),
  );
  const binding = {
    version: MOUNT_TOPOLOGY_VERSION,
    source: "proc-self-mountinfo",
    workspaceRoot,
    containingMount: mountedBy.lineDigest,
    rootMount: rootMount.lineDigest,
    lineageEntryDigests: lineage.map((entry) => entry.lineDigest).sort(),
    filesystemEntryDigests: sameFilesystem
      .map((entry) => entry.lineDigest)
      .sort(),
    aliasDigests: [...aliases].map(sha256).sort(),
    forbiddenIdentityDigests: forbiddenIdentities
      .map((entry) => sha256(stableJson(entry)))
      .sort(),
    strictDescendantMountsAtAttestation: 0,
    recursiveBind: true,
    mountTopologyAtomic: false,
  };
  return Object.freeze({
    version: binding.version,
    source: binding.source,
    workspaceRoot: binding.workspaceRoot,
    digest: sha256(stableJson(binding)),
    lineageEntryCount: binding.lineageEntryDigests.length,
    filesystemEntryCount: binding.filesystemEntryDigests.length,
    aliasCount: binding.aliasDigests.length,
    forbiddenIdentityCount: binding.forbiddenIdentityDigests.length,
    strictDescendantMountsAtAttestation:
      binding.strictDescendantMountsAtAttestation,
    rootAliasAttested: true,
    recursiveBind: binding.recursiveBind,
    mountTopologyAtomic: binding.mountTopologyAtomic,
  });
}

function normalizedStdio(stdio) {
  if (stdio === undefined || stdio === null || stdio === "pipe") {
    return ["pipe", "pipe", "pipe"];
  }
  if (stdio === "ignore") return ["ignore", "ignore", "ignore"];
  if (!Array.isArray(stdio)) return null;
  const result = [...stdio];
  while (result.length < 3) result.push(undefined);
  return result.map((entry, index) => {
    if (entry === undefined || entry === null) {
      return index < 3 ? "pipe" : "ignore";
    }
    return entry;
  });
}

function resolveExecutable(runtime, requested, cwd, environment) {
  if (typeof requested !== "string" || !requested || requested.includes("\0")) {
    throw new Error("generic_target_invalid");
  }
  const candidates = [];
  if (requested.includes("/")) {
    candidates.push(
      path.posix.isAbsolute(requested)
        ? requested
        : path.posix.resolve(cwd, requested),
    );
  } else {
    for (const entry of String(
      environment?.PATH || "/usr/local/bin:/usr/bin:/bin",
    ).split(":")) {
      if (!entry) continue;
      const directory = path.posix.isAbsolute(entry)
        ? entry
        : path.posix.resolve(cwd, entry);
      candidates.push(path.posix.join(directory, requested));
    }
  }
  for (const candidate of candidates) {
    try {
      runtime.fs.accessSync(
        candidate,
        runtime.fs.constants?.X_OK ?? fs.constants.X_OK,
      );
      const canonical = realpath(runtime, candidate);
      const stat = runtime.fs.statSync(canonical);
      if (!stat.isFile() || (Number(stat.mode) & 0o111) === 0) continue;
      return { canonical, stat };
    } catch {
      // Continue PATH resolution exactly as child_process would.
    }
  }
  throw new Error("generic_target_unavailable");
}

function systemTarget(canonical) {
  return [...SYSTEM_ROOTS].some((root) => isWithin(root, canonical));
}

function createTrustedResources(
  contract,
  command,
  args,
  spawnOpts,
  sandboxOpts,
  runtime,
) {
  const ownedFds = new Set();
  const probeFds = new Set();
  const finalFds = new Set();
  const closeFd = (fd) => {
    if (!Number.isInteger(fd) || !ownedFds.delete(fd)) return;
    probeFds.delete(fd);
    finalFds.delete(fd);
    try {
      runtime.fs.closeSync(fd);
    } catch {
      // Cleanup must preserve the fail-closed boundary result.
    }
  };
  const closeSet = (set) => {
    for (const fd of [...set]) closeFd(fd);
  };
  const cleanup = () => closeSet(ownedFds);
  const track = (fd, phase) => {
    ownedFds.add(fd);
    (phase === "probe" ? probeFds : finalFds).add(fd);
    return fd;
  };
  const openFlags = ({ directory, readWrite = false }) => {
    const constants = runtime.fs.constants || fs.constants;
    return (
      Number(readWrite ? constants.O_RDWR : constants.O_RDONLY) |
      Number(directory ? constants.O_DIRECTORY || 0 : 0) |
      Number(constants.O_NOFOLLOW || 0) |
      Number(constants.O_NONBLOCK || 0)
    );
  };
  const openPair = (
    source,
    { directory, rootRequired = false, executable = false },
  ) => {
    const canonical = realpath(runtime, source);
    if (canonical !== source) throw new Error("resource_path_not_canonical");
    const pathStat = runtime.fs.lstatSync(source);
    if (
      pathStat.isSymbolicLink?.() ||
      (directory ? !pathStat.isDirectory() : !pathStat.isFile()) ||
      (rootRequired && !rootOwned(pathStat, { directory, executable }))
    ) {
      throw new Error("resource_path_unattested");
    }
    const probeFd = track(
      runtime.fs.openSync(source, openFlags({ directory })),
      "probe",
    );
    const finalFd = track(
      runtime.fs.openSync(source, openFlags({ directory })),
      "final",
    );
    const probeStat = runtime.fs.fstatSync(probeFd);
    const finalStat = runtime.fs.fstatSync(finalFd);
    const observedIdentity = identity(source, pathStat);
    if (
      !statMatchesIdentity(probeStat, observedIdentity, { directory }) ||
      !statMatchesIdentity(finalStat, observedIdentity, { directory })
    ) {
      throw new Error("resource_descriptor_identity_changed");
    }
    return {
      source,
      probeFd,
      finalFd,
      identity: observedIdentity,
    };
  };

  try {
    if (
      runtime.platform !== "linux" ||
      contract?.kind !== LINUX_GENERIC_CONTRACT_KIND ||
      spawnOpts?.shell === true ||
      typeof spawnOpts?.shell === "string" ||
      spawnOpts?.detached === true ||
      spawnOpts?.uid !== undefined ||
      spawnOpts?.gid !== undefined ||
      spawnOpts?.argv0 !== undefined ||
      spawnOpts?.serialization !== undefined
    ) {
      throw new Error("generic_launch_options_unsupported");
    }
    const hostNetworkNamespace = String(
      runtime.fs.readlinkSync("/proc/self/ns/net"),
    );
    if (!/^net:\[\d+\]$/.test(hostNetworkNamespace)) {
      throw new Error("host_network_namespace_identity_unavailable");
    }

    const workspace = openPair(contract.workspaceRoot, {
      directory: true,
    });
    const cwdPins = openPair(contract.workingDirectory, {
      directory: true,
    });
    const initialWorkspaceMountTopology = workspaceMountTopology(
      runtime,
      contract.workspaceRoot,
      workspace.identity,
    );

    const supervisor = openPair(BWRAP_PATH, {
      directory: false,
      rootRequired: true,
      executable: true,
    });
    const supervisorBytes = Number(
      runtime.fs.fstatSync(supervisor.probeFd).size,
    );
    const supervisorProbeDigest = hashOpenFile(
      runtime,
      supervisor.probeFd,
      supervisorBytes,
    );
    const supervisorFinalDigest = hashOpenFile(
      runtime,
      supervisor.finalFd,
      supervisorBytes,
    );
    if (supervisorProbeDigest !== supervisorFinalDigest) {
      throw new Error("bubblewrap_supervisor_digest_mismatch");
    }
    supervisor.identity = Object.freeze({
      ...supervisor.identity,
      sha256: supervisorFinalDigest,
      bytes: supervisorBytes,
    });

    const capabilityFd = runtime.fs.openSync(
      BWRAP_PATH,
      openFlags({ directory: false }),
    );
    ownedFds.add(capabilityFd);
    const capabilityStat = runtime.fs.fstatSync(capabilityFd);
    if (
      !statMatchesIdentity(capabilityStat, supervisor.identity, {
        directory: false,
      }) ||
      hashOpenFile(runtime, capabilityFd, supervisorBytes) !==
        supervisorFinalDigest
    ) {
      throw new Error("bubblewrap_capability_reader_unattested");
    }
    const capabilityResult = runtime.spawnSync("/proc/self/fd/3", ["--help"], {
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe", capabilityFd],
      timeout: 10_000,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    });
    closeFd(capabilityFd);
    if (capabilityResult?.error || capabilityResult?.status !== 0) {
      const error = new Error("bubblewrap_capability_probe_failed");
      error.code = "LINUX_GENERIC_BWRAP_UNAVAILABLE";
      throw error;
    }
    const supported = new Set(
      `${String(capabilityResult.stdout || "")}\n${String(
        capabilityResult.stderr || "",
      )}`
        .split(/\s+/)
        .filter(Boolean),
    );
    if (REQUIRED_BWRAP_OPTIONS.some((option) => !supported.has(option))) {
      const error = new Error("bubblewrap_required_option_missing");
      error.code = "LINUX_GENERIC_BWRAP_UNAVAILABLE";
      throw error;
    }

    const system = [];
    const systemSymlinks = [];
    for (const destination of SYSTEM_DESTINATIONS) {
      if (!runtime.fs.existsSync(destination)) continue;
      const entryStat = runtime.fs.lstatSync(destination);
      if (entryStat.isSymbolicLink?.()) {
        const expectedTarget = SYSTEM_SYMLINKS.get(destination);
        const observedTarget = runtime.fs.readlinkSync(destination);
        const normalizedTarget = observedTarget.startsWith("/")
          ? observedTarget.slice(1)
          : observedTarget;
        if (
          !expectedTarget ||
          normalizedTarget !== expectedTarget ||
          !runtime.fs.existsSync(`/${expectedTarget}`)
        ) {
          throw new Error("system_runtime_symlink_unattested");
        }
        systemSymlinks.push({
          destination,
          target: expectedTarget,
        });
        continue;
      }
      const pair = openPair(destination, {
        directory: true,
        rootRequired: true,
      });
      system.push({
        destination,
        probeFd: pair.probeFd,
        finalFd: pair.finalFd,
        identity: pair.identity,
      });
    }
    if (!system.some((entry) => entry.destination === "/usr")) {
      throw new Error("system_usr_runtime_unavailable");
    }

    const etc = [];
    for (const destination of ETC_ALLOWLIST) {
      if (!runtime.fs.existsSync(destination)) continue;
      const pair = openPair(destination, {
        directory: false,
        rootRequired: true,
      });
      etc.push({
        destination,
        probeFd: pair.probeFd,
        finalFd: pair.finalFd,
        identity: pair.identity,
      });
    }

    const filter = buildNetworkSeccompFilter(runtime.arch);
    const openSeccomp = (phase) => {
      const constants = runtime.fs.constants || fs.constants;
      const flags =
        Number(constants.O_RDWR) |
        Number(constants.O_EXCL) |
        Number(constants.O_TMPFILE ?? O_TMPFILE) |
        Number(constants.O_NOFOLLOW || 0) |
        Number(constants.O_NONBLOCK || 0);
      const fd = track(runtime.fs.openSync("/tmp", flags, 0o400), phase);
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
      const stat = runtime.fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        Number(stat.size) !== filter.buffer.length ||
        hashOpenFile(runtime, fd, filter.buffer.length) !== filter.sha256
      ) {
        throw new Error("seccomp_filter_unattested");
      }
      return fd;
    };
    const seccomp = {
      probeFd: openSeccomp("probe"),
      finalFd: openSeccomp("final"),
      sha256: filter.sha256,
      policy: "deny-network-creation",
    };

    const environment = spawnOpts?.env || process.env;
    const resolvedTarget = resolveExecutable(
      runtime,
      command,
      contract.workingDirectory,
      environment,
    );
    let targetScope;
    if (isWithin(contract.workspaceRoot, resolvedTarget.canonical)) {
      targetScope = "workspace";
    } else if (
      systemTarget(resolvedTarget.canonical) &&
      rootOwned(resolvedTarget.stat, {
        directory: false,
        executable: true,
      })
    ) {
      targetScope = "system";
    } else {
      throw new Error("generic_target_outside_trusted_runtime");
    }
    const target = {
      attestedContractDigest: contract.contractDigest,
      requestedCommand: command,
      resolvedCommand: resolvedTarget.canonical,
      args: [...(args || [])],
      scope: targetScope,
      ...(targetScope === "system"
        ? {
            identity: identity(resolvedTarget.canonical, resolvedTarget.stat),
          }
        : {}),
    };

    const socketProbeCandidates = [
      { command: runtime.execPath, kind: "node" },
      { command: "/usr/local/bin/node", kind: "node" },
      { command: "/usr/bin/node", kind: "node" },
      { command: "/usr/bin/python3", kind: "python" },
      { command: "/usr/bin/python", kind: "python" },
    ];
    let socketProbeRuntime = null;
    for (const candidate of socketProbeCandidates) {
      if (typeof candidate.command !== "string" || !candidate.command) continue;
      try {
        const resolved = resolveExecutable(
          runtime,
          candidate.command,
          contract.workingDirectory,
          environment,
        );
        if (
          systemTarget(resolved.canonical) &&
          rootOwned(resolved.stat, {
            directory: false,
            executable: true,
          })
        ) {
          socketProbeRuntime = Object.freeze({
            command: resolved.canonical,
            kind: candidate.kind,
          });
          break;
        }
      } catch {
        // Try the next root-owned Node runtime.
      }
    }
    if (!socketProbeRuntime) {
      throw new Error("socket_probe_runtime_unavailable");
    }

    const descriptorAttested = (fd, expected, directory) => {
      if (!ownedFds.has(fd)) return false;
      try {
        return statMatchesIdentity(runtime.fs.fstatSync(fd), expected, {
          directory,
        });
      } catch {
        return false;
      }
    };
    const pathAttested = (source, expected, directory) => {
      try {
        return (
          realpath(runtime, source) === source &&
          statMatchesIdentity(runtime.fs.lstatSync(source), expected, {
            directory,
          })
        );
      } catch {
        return false;
      }
    };
    const launchStaysBound = (issued) => {
      const stdio = normalizedStdio(spawnOpts?.stdio);
      return (
        issued?.contractDigest === contract.contractDigest &&
        issued.workspaceRoot === contract.workspaceRoot &&
        issued.workingDirectory === contract.workingDirectory &&
        issued.origin === (spawnOpts?.origin || "unknown") &&
        issued.command === command &&
        issued.sync === (sandboxOpts?.sync === true) &&
        issued.shell === false &&
        Array.isArray(stdio) &&
        issued.stdio.length === stdio.length &&
        issued.stdio.every((value, index) => value === stdio[index]) &&
        issued.args.length === (args || []).length &&
        issued.args.every((value, index) => value === args[index]) &&
        identityMatches(issued.rootIdentity, workspace.identity) &&
        identityMatches(issued.cwdIdentity, cwdPins.identity)
      );
    };
    const attestFinal = (issued) => {
      let finalWorkspaceMountTopology;
      try {
        finalWorkspaceMountTopology = workspaceMountTopology(
          runtime,
          contract.workspaceRoot,
          workspace.identity,
        );
      } catch {
        return false;
      }
      if (
        !launchStaysBound(issued) ||
        finalWorkspaceMountTopology.digest !==
          initialWorkspaceMountTopology.digest ||
        !pathAttested(contract.workspaceRoot, workspace.identity, true) ||
        !pathAttested(contract.workingDirectory, cwdPins.identity, true) ||
        !descriptorAttested(workspace.finalFd, workspace.identity, true) ||
        !descriptorAttested(cwdPins.finalFd, cwdPins.identity, true) ||
        !descriptorAttested(supervisor.finalFd, supervisor.identity, false) ||
        hashOpenFile(runtime, supervisor.finalFd, supervisorBytes) !==
          supervisorFinalDigest ||
        hashOpenFile(runtime, seccomp.finalFd, filter.buffer.length) !==
          filter.sha256
      ) {
        return false;
      }
      for (const entry of [...system, ...etc]) {
        if (
          !descriptorAttested(
            entry.finalFd,
            entry.identity,
            system.includes(entry),
          )
        ) {
          return false;
        }
      }
      try {
        const currentTarget = resolveExecutable(
          runtime,
          command,
          contract.workingDirectory,
          environment,
        );
        return (
          currentTarget.canonical === target.resolvedCommand &&
          (target.scope === "workspace"
            ? isWithin(contract.workspaceRoot, currentTarget.canonical)
            : rootOwned(currentTarget.stat, {
                directory: false,
                executable: true,
              }) &&
              statMatchesIdentity(currentTarget.stat, target.identity, {
                directory: false,
              }))
        );
      } catch {
        return false;
      }
    };

    const probe = (call) => {
      const nonce = runtime.randomBytes(12).toString("hex");
      const workspaceMarker = path.posix.join(
        contract.workspaceRoot,
        `.chainless-bwrap-probe-${nonce}`,
      );
      const outsideMarker = path.posix.join(
        runtime.tmpdir(),
        `.chainless-bwrap-outside-${nonce}`,
      );
      const homeMarker = path.posix.join(
        runtime.homedir(),
        `.chainless-bwrap-home-${nonce}`,
      );
      const workspaceHomeAliasMarker = path.posix.join(
        contract.workspaceRoot,
        path.posix.basename(homeMarker),
      );
      const devShmMarker = path.posix.join(
        "/dev/shm",
        `.chainless-bwrap-dev-shm-${nonce}`,
      );
      const outsideContents = `host-only-${nonce}`;
      const homeContents = `home-only-${nonce}`;
      let outsideCreated = false;
      let homeCreated = false;
      let devShmCreated = false;
      try {
        runtime.fs.writeFileSync(outsideMarker, outsideContents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        outsideCreated = true;
        runtime.fs.writeFileSync(homeMarker, homeContents, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        homeCreated = true;
        runtime.fs.writeFileSync(devShmMarker, `host-dev-shm-${nonce}`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        devShmCreated = true;
        const socketProbe =
          socketProbeRuntime.kind === "node"
            ? {
                args: [
                  "-e",
                  [
                    'const net = require("node:net");',
                    'const socket = net.connect({host:"127.0.0.1",port:9});',
                    "const timer = setTimeout(() => process.exit(4), 1000);",
                    'socket.once("connect", () => { clearTimeout(timer); process.exit(5); });',
                    'socket.once("error", (error) => {',
                    "  clearTimeout(timer);",
                    '  process.exit(error?.code === "EPERM" ? 0 : 6);',
                    "});",
                  ].join(""),
                ],
              }
            : {
                args: [
                  "-I",
                  "-S",
                  "-c",
                  [
                    "import errno,socket,sys",
                    "try:",
                    " s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)",
                    "except OSError as e:",
                    " sys.exit(0 if e.errno==errno.EPERM else 6)",
                    "else:",
                    " s.close()",
                    " sys.exit(5)",
                  ].join("\n"),
                ],
              };
        const socketProbeCommand = [
          shellQuote(socketProbeRuntime.command),
          ...socketProbe.args.map(shellQuote),
        ].join(" ");
        const script = [
          "set -eu",
          "mount_is_read_only() {",
          '  want="$1"',
          "  seen=0",
          "  while IFS=' ' read -r _ _ _ _ mountpoint mountopts _; do",
          '    [ "$mountpoint" = "$want" ] || continue',
          "    seen=1",
          '    case ",$mountopts," in',
          "      *,ro,*) ;;",
          "      *) return 1 ;;",
          "    esac",
          "  done < /proc/self/mountinfo",
          '  [ "$seen" = 1 ]',
          "}",
          "workspace_mount_topology_is_attested() {",
          `  want=${shellQuote(encodeMountInfoPath(contract.workspaceRoot))}`,
          '  prefix="${want}/"',
          "  seen=0",
          "  while IFS=' ' read -r _ _ _ _ mountpoint _; do",
          '    [ "$mountpoint" = "$want" ] && seen=1',
          '    case "$mountpoint" in',
          '      "$prefix"*) return 1 ;;',
          "    esac",
          `  done < ${MOUNTINFO_PATH}`,
          '  [ "$seen" = 1 ]',
          "}",
          "mount_is_read_only /",
          "mount_is_read_only /usr",
          "workspace_mount_topology_is_attested",
          `test ! -e ${shellQuote("/etc/shadow")}`,
          `test ! -e ${shellQuote(homeMarker)}`,
          `test ! -e ${shellQuote(workspaceHomeAliasMarker)}`,
          `test ! -e ${shellQuote(outsideMarker)}`,
          `test ! -e ${shellQuote(devShmMarker)}`,
          `printf %s ${shellQuote(nonce)} > ${shellQuote(devShmMarker)}`,
          `test "$(cat ${shellQuote(devShmMarker)})" = ${shellQuote(nonce)}`,
          `rm -f ${shellQuote(devShmMarker)}`,
          "if printf x > /chainless-undeclared-root 2>/dev/null; then exit 12; fi",
          "test ! -e /chainless-undeclared-root",
          "if printf x > /usr/.chainless-system-write 2>/dev/null; then exit 13; fi",
          "test ! -e /usr/.chainless-system-write",
          `test "$(readlink /proc/self/ns/net)" != ${shellQuote(
            hostNetworkNamespace,
          )}`,
          `printf %s ${shellQuote(nonce)} > ${shellQuote(workspaceMarker)}`,
          `test "$(cat ${shellQuote(workspaceMarker)})" = ${shellQuote(nonce)}`,
          `rm -f ${shellQuote(workspaceMarker)}`,
          socketProbeCommand,
          `printf '%s\\n%s\\n' ${shellQuote(call.policyDigest)} ${shellQuote(
            call.contractDigest,
          )}`,
        ].join("\n");
        const result = runtime.spawnSync(
          call.command,
          [...call.args, "--", "/bin/sh", "-c", script],
          call.options,
        );
        const outsideUnchanged =
          outsideCreated &&
          String(runtime.fs.readFileSync(outsideMarker, "utf8")) ===
            outsideContents;
        const homeUnchanged =
          homeCreated &&
          String(runtime.fs.readFileSync(homeMarker, "utf8")) === homeContents;
        const devShmUnchanged =
          devShmCreated &&
          String(runtime.fs.readFileSync(devShmMarker, "utf8")) ===
            `host-dev-shm-${nonce}`;
        const expectedOutput = `${call.policyDigest}\n${call.contractDigest}\n`;
        const runnable =
          !result?.error &&
          result?.status === 0 &&
          String(result.stdout) === expectedOutput &&
          outsideUnchanged &&
          homeUnchanged &&
          devShmUnchanged;
        return {
          runnable,
          policyDigest: runnable ? call.policyDigest : null,
          contractDigest: runnable ? call.contractDigest : null,
          emptyRoot: runnable,
          undeclaredRootReadOnly: runnable,
          workspaceReadWrite: runnable,
          workspaceMountTopologyAttested: runnable,
          anonymousDevWritable: runnable,
          systemReadOnly: runnable,
          hostHomeHidden: runnable,
          outsideMarkerHidden: runnable,
          networkNamespace: runnable,
          networkNamespaceChanged: runnable,
          socketCreationDenied: runnable,
        };
      } catch {
        return { runnable: false };
      } finally {
        for (const marker of [
          workspaceMarker,
          outsideMarker,
          homeMarker,
          devShmMarker,
        ]) {
          try {
            runtime.fs.unlinkSync(marker);
          } catch {
            // Probe cleanup is best effort; a failed probe stays fail-closed.
          }
        }
      }
    };

    return {
      attestedContractDigest: contract.contractDigest,
      attestContract: launchStaysBound,
      attestFinal,
      closeProbe: () => closeSet(probeFds),
      cleanup,
      supervisor: {
        probeFd: supervisor.probeFd,
        finalFd: supervisor.finalFd,
        identity: supervisor.identity,
        sha256: supervisorFinalDigest,
        bytes: supervisorBytes,
      },
      workspace: {
        probeFd: workspace.probeFd,
        finalFd: workspace.finalFd,
        identity: workspace.identity,
        mountTopology: initialWorkspaceMountTopology,
      },
      system,
      systemSymlinks,
      etc,
      seccomp,
      target,
      probe,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Apply the generic strong backend. This function is called only by the Linux
 * branch in platform-sandbox; all runtime overrides are internal test seams.
 */
export function applyLinuxGenericWorkspaceSandbox(
  command,
  args,
  spawnOpts,
  sandboxOpts,
  runtimeOverrides = {},
) {
  const runtime = runtimeFor(runtimeOverrides);
  const contract = sandboxOpts?.executionContract;
  const requiredBoundaries = Array.isArray(sandboxOpts?.requiredBoundaries)
    ? sandboxOpts.requiredBoundaries
    : [];
  const provenance = {
    origin: spawnOpts?.origin || "unknown",
    command,
    args: [...(args || [])],
    cwd: spawnOpts?.cwd || process.cwd(),
    shell: spawnOpts?.shell,
    sync: sandboxOpts?.sync === true,
    stdio: spawnOpts?.stdio,
    requiredBoundaries,
  };
  let resources;
  try {
    resources = createTrustedResources(
      contract,
      command,
      args || [],
      spawnOpts || {},
      sandboxOpts || {},
      runtime,
    );
  } catch (error) {
    const preflightFailure =
      error?.code === "LINUX_GENERIC_BWRAP_UNAVAILABLE"
        ? "linux_generic_bwrap_unavailable"
        : "linux_generic_resources_unattested";
    return planLinuxGenericBubblewrap(
      {
        contract,
        provenance,
        resources: null,
        environment: spawnOpts?.env || process.env,
        spawnOptions: spawnOpts,
        preflightFailure,
      },
      { platform: runtime.platform },
    );
  }
  return planLinuxGenericBubblewrap(
    {
      contract,
      provenance,
      resources,
      environment: spawnOpts?.env || process.env,
      spawnOptions: spawnOpts,
      probe: resources.probe,
    },
    { platform: runtime.platform },
  );
}

export function isLinuxGenericWorkspaceContract(contract) {
  return (
    contract?.contractVersion === 1 &&
    contract?.kind === LINUX_GENERIC_CONTRACT_KIND &&
    typeof contract?.contractDigest === "string" &&
    contract?.workspaceRoot?.startsWith("/") &&
    contract?.workingDirectory?.startsWith("/")
  );
}

export { LINUX_GENERIC_BWRAP_BACKEND };
