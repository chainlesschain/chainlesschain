/**
 * Linux generic workspace-command sandbox contract and bubblewrap planner.
 *
 * This module is intentionally independent from platform-sandbox.js so the
 * Broker can adopt it without weakening the narrow Plugin-bin contract. A raw
 * manifest policy can request filesystem/network boundaries, but it cannot
 * nominate a writable root: only an exact object issued here is accepted, and
 * every contract is single-use.
 *
 * The planner starts from bubblewrap's empty root. It admits only:
 *   - one descriptor-bound writable workspace;
 *   - anonymous tmpfs scratch locations;
 *   - descriptor-bound, root-owned read-only system runtime directories; and
 *   - a small exact /etc file allowlist.
 *
 * It never maps the host root or HOME. Network isolation always combines a new
 * network namespace with the repository's deny-socket seccomp policy.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LINUX_GENERIC_BWRAP_BACKEND = "linux-bwrap-workspace";
export const LINUX_GENERIC_CONTRACT_KIND = "strict-workspace-command";

const SUPPORTED_BOUNDARIES = new Set(["filesystem", "network"]);
const SYSTEM_RUNTIME_DESTINATIONS = new Set([
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
]);
const SYSTEM_RUNTIME_SYMLINKS = new Map([
  ["/bin", new Set(["usr/bin"])],
  ["/sbin", new Set(["usr/sbin"])],
  ["/lib", new Set(["usr/lib"])],
  ["/lib32", new Set(["usr/lib32"])],
  ["/lib64", new Set(["usr/lib64"])],
]);
const ETC_FILE_ALLOWLIST = new Set([
  "/etc/group",
  "/etc/hosts",
  "/etc/ld.so.cache",
  "/etc/nsswitch.conf",
  "/etc/passwd",
]);
const FORBIDDEN_EXACT_WORKSPACE_ROOTS = new Set([
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
]);
const FORBIDDEN_WORKSPACE_SUBTREES = [
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
const ENV_DENYLIST = new Set([
  "BASH_ENV",
  "CDPATH",
  "ENV",
  "GCONV_PATH",
  "GLIBC_TUNABLES",
  "LD_AUDIT",
  "LD_DEBUG",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PERL5OPT",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYOPT",
  "SHELLOPTS",
]);
const CONTRACT_VERSION = 1;
const PLAN_VERSION = 1;
const SANDBOX_HOME = "/home/sandbox";
const SUPERVISOR_STAGING_PATH = "/run/.chainless-bwrap-supervisor";
const SCRATCH_MOUNTS = ["/tmp", "/run", "/var/tmp", SANDBOX_HOME];

const issuedContracts = new WeakMap();
const admittedContracts = new WeakMap();
const plannedPolicies = new WeakMap();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function freezeIdentity(identity) {
  return Object.freeze({
    realPath: identity.realPath,
    fileId: Object.freeze({
      dev: String(identity.fileId.dev),
      ino: String(identity.fileId.ino),
    }),
    mode: Number(identity.mode),
    uid: Number(identity.uid),
    gid: Number(identity.gid),
    attestation: identity.attestation || "canonical-directory-file-id",
  });
}

function sameIdentity(left, right) {
  return (
    left?.realPath === right?.realPath &&
    String(left?.fileId?.dev) === String(right?.fileId?.dev) &&
    String(left?.fileId?.ino) === String(right?.fileId?.ino) &&
    Number(left?.mode) === Number(right?.mode) &&
    Number(left?.uid) === Number(right?.uid) &&
    Number(left?.gid) === Number(right?.gid)
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

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) {
    throw new TypeError("args must be an array");
  }
  return Object.freeze(
    args.map((value, index) => assertString(String(value), `args[${index}]`)),
  );
}

function normalizeBoundaries(boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length === 0) {
    throw new TypeError("requiredBoundaries must be a non-empty array");
  }
  const normalized = [...new Set(boundaries)].sort();
  if (
    normalized.some(
      (boundary) =>
        typeof boundary !== "string" || !SUPPORTED_BOUNDARIES.has(boundary),
    )
  ) {
    throw new TypeError(
      "requiredBoundaries may contain only filesystem and network",
    );
  }
  return Object.freeze(normalized);
}

function normalizeShell(shell) {
  if (shell === undefined || shell === null || shell === false) return false;
  throw new TypeError("strong Linux workspace sandbox requires shell:false");
}

function normalizeStdio(stdio) {
  let entries;
  if (stdio === undefined || stdio === null || stdio === "pipe") {
    entries = ["pipe", "pipe", "pipe"];
  } else if (stdio === "ignore") {
    entries = ["ignore", "ignore", "ignore"];
  } else if (Array.isArray(stdio)) {
    entries = [...stdio];
    while (entries.length < 3) entries.push(undefined);
  } else {
    throw new TypeError(
      "strong Linux workspace sandbox requires pipe/ignore/array stdio",
    );
  }

  let ipcCount = 0;
  const normalized = entries.map((entry, index) => {
    if (entry === undefined || entry === null) {
      return index < 3 ? "pipe" : "ignore";
    }
    if (entry === "pipe" || entry === "ignore") return entry;
    if (entry === "ipc" && index >= 3) {
      ipcCount += 1;
      return entry;
    }
    throw new TypeError(
      `strong Linux workspace sandbox rejects inherited/numeric stdio at fd ${index}`,
    );
  });
  if (ipcCount > 1) {
    throw new TypeError("strong Linux workspace sandbox allows one IPC fd");
  }
  return Object.freeze(normalized);
}

function defaultWorkspaceAttestation(workspaceRoot, cwd) {
  const resolve = (value) => path.resolve(value);
  const canonical = (value) => fs.realpathSync.native(resolve(value));
  const requestedRoot = resolve(workspaceRoot);
  const canonicalRoot = canonical(requestedRoot);
  if (requestedRoot !== canonicalRoot) {
    throw new Error("workspace root must be canonical and symlink-free");
  }
  const requestedCwd = resolve(cwd);
  const canonicalCwd = canonical(requestedCwd);
  if (requestedCwd !== canonicalCwd) {
    throw new Error("working directory must be canonical and symlink-free");
  }
  const rootStat = fs.statSync(canonicalRoot);
  const cwdStat = fs.statSync(canonicalCwd);
  if (!rootStat.isDirectory() || !cwdStat.isDirectory()) {
    throw new Error("workspace root and cwd must be directories");
  }
  return {
    workspaceRoot: canonicalRoot.replaceAll("\\", "/"),
    workingDirectory: canonicalCwd.replaceAll("\\", "/"),
    rootIdentity: {
      realPath: canonicalRoot.replaceAll("\\", "/"),
      fileId: { dev: String(rootStat.dev), ino: String(rootStat.ino) },
      mode: rootStat.mode,
      uid: rootStat.uid,
      gid: rootStat.gid,
    },
    cwdIdentity: {
      realPath: canonicalCwd.replaceAll("\\", "/"),
      fileId: { dev: String(cwdStat.dev), ino: String(cwdStat.ino) },
      mode: cwdStat.mode,
      uid: cwdStat.uid,
      gid: cwdStat.gid,
    },
  };
}

function validateWorkspaceAttestation(attestation, homedir) {
  const root = assertString(attestation?.workspaceRoot, "workspaceRoot");
  const cwd = assertString(attestation?.workingDirectory, "workingDirectory");
  if (!path.posix.isAbsolute(root) || !path.posix.isAbsolute(cwd)) {
    throw new Error("workspace root and cwd must be absolute POSIX paths");
  }
  const canonicalHome =
    typeof homedir === "string" && path.posix.isAbsolute(homedir)
      ? path.posix.normalize(homedir)
      : null;
  if (
    FORBIDDEN_EXACT_WORKSPACE_ROOTS.has(root) ||
    root === canonicalHome ||
    FORBIDDEN_WORKSPACE_SUBTREES.some(
      (blocked) => root === blocked || isWithin(blocked, root),
    )
  ) {
    throw new Error(`unsafe writable workspace root: ${root}`);
  }
  if (!isWithin(root, cwd)) {
    throw new Error("working directory escapes the canonical workspace root");
  }
  for (const [label, identity, expectedPath] of [
    ["root", attestation.rootIdentity, root],
    ["cwd", attestation.cwdIdentity, cwd],
  ]) {
    if (
      identity?.realPath !== expectedPath ||
      identity.fileId?.dev === undefined ||
      identity.fileId?.ino === undefined ||
      !Number.isSafeInteger(Number(identity.mode)) ||
      (Number(identity.mode) & 0o170000) !== 0o040000
    ) {
      throw new Error(`invalid ${label} directory attestation`);
    }
  }
  return {
    workspaceRoot: root,
    workingDirectory: cwd,
    rootIdentity: freezeIdentity(attestation.rootIdentity),
    cwdIdentity: freezeIdentity(attestation.cwdIdentity),
  };
}

/**
 * Issue a one-launch authority contract. Callers must supply a trusted
 * workspace root; renderer/manifest values must not be forwarded here.
 */
export function issueLinuxGenericSandboxExecutionContract(
  spec,
  runtimeOverrides = {},
) {
  const origin = assertString(spec?.origin, "origin");
  const command = assertString(spec?.command, "command");
  const args = normalizeArgs(spec?.args || []);
  const shell = normalizeShell(spec?.shell);
  const sync = spec?.sync === true;
  const stdio = normalizeStdio(spec?.stdio);
  const requiredBoundaries = normalizeBoundaries(spec?.requiredBoundaries);
  if (
    spec?.detached === true ||
    spec?.uid !== undefined ||
    spec?.gid !== undefined ||
    spec?.argv0 !== undefined ||
    spec?.serialization !== undefined
  ) {
    throw new TypeError(
      "strong Linux workspace sandbox rejects detached/identity/argv0/serialization overrides",
    );
  }
  const attestWorkspace =
    runtimeOverrides.attestWorkspace || defaultWorkspaceAttestation;
  const attestation = validateWorkspaceAttestation(
    attestWorkspace(spec?.workspaceRoot, spec?.cwd || spec?.workspaceRoot),
    (runtimeOverrides.homedir || os.homedir)(),
  );
  const contractBinding = {
    contractVersion: CONTRACT_VERSION,
    kind: LINUX_GENERIC_CONTRACT_KIND,
    workspaceRoot: attestation.workspaceRoot,
    workingDirectory: attestation.workingDirectory,
    rootIdentity: attestation.rootIdentity,
    cwdIdentity: attestation.cwdIdentity,
    origin,
    command,
    args,
    shell,
    sync,
    stdio,
    requiredBoundaries,
  };
  const contractDigest = sha256(stableJson(contractBinding));
  const contract = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    kind: LINUX_GENERIC_CONTRACT_KIND,
    workspaceRoot: attestation.workspaceRoot,
    workingDirectory: attestation.workingDirectory,
    rootIdentity: attestation.rootIdentity,
    cwdIdentity: attestation.cwdIdentity,
    contractDigest,
  });
  issuedContracts.set(
    contract,
    Object.freeze({
      ...contractBinding,
      contractDigest,
    }),
  );
  return contract;
}

function issuedBindingMatches(issued, provenance = {}) {
  if (!issued) return false;
  let args;
  let boundaries;
  let shell;
  let stdio;
  try {
    args = normalizeArgs(provenance.args || []);
    boundaries = normalizeBoundaries(provenance.requiredBoundaries);
    shell = normalizeShell(provenance.shell);
    stdio = normalizeStdio(provenance.stdio);
  } catch {
    return false;
  }
  return (
    provenance.origin === issued.origin &&
    provenance.command === issued.command &&
    provenance.cwd === issued.workingDirectory &&
    provenance.sync === issued.sync &&
    shell === issued.shell &&
    args.length === issued.args.length &&
    args.every((value, index) => value === issued.args[index]) &&
    stdio.length === issued.stdio.length &&
    stdio.every((value, index) => value === issued.stdio[index]) &&
    issued.requiredBoundaries.every((boundary) =>
      boundaries.includes(boundary),
    ) &&
    boundaries.every((boundary) => SUPPORTED_BOUNDARIES.has(boundary))
  );
}

export function verifyIssuedLinuxGenericSandboxExecutionContract(
  contract,
  provenance = {},
) {
  return issuedBindingMatches(issuedContracts.get(contract), provenance);
}

export function consumeIssuedLinuxGenericSandboxExecutionContract(
  contract,
  provenance = {},
) {
  const issued = issuedContracts.get(contract);
  if (!issuedBindingMatches(issued, provenance)) return null;
  issuedContracts.delete(contract);
  return issued;
}

/**
 * Broker admission consumes the public one-launch object before permission or
 * credential processing can return early. The platform adapter receives only
 * this second opaque object, which is also single-use.
 */
export function admitLinuxGenericSandboxExecutionContract(
  contract,
  provenance = {},
) {
  const issued = consumeIssuedLinuxGenericSandboxExecutionContract(
    contract,
    provenance,
  );
  if (!issued) return null;
  const admitted = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    kind: LINUX_GENERIC_CONTRACT_KIND,
    contractDigest: issued.contractDigest,
    workspaceRoot: issued.workspaceRoot,
    workingDirectory: issued.workingDirectory,
  });
  admittedContracts.set(admitted, issued);
  return admitted;
}

function consumePlanningAuthority(contract, provenance) {
  const admitted = admittedContracts.get(contract);
  if (admitted) {
    admittedContracts.delete(contract);
    return issuedBindingMatches(admitted, provenance) ? admitted : null;
  }
  return consumeIssuedLinuxGenericSandboxExecutionContract(
    contract,
    provenance,
  );
}

function unavailablePlan(reason, requiredBoundaries = [], cleanup) {
  cleanup?.();
  return Object.freeze({
    contractVersion: PLAN_VERSION,
    applied: false,
    platform: "linux",
    profile: "strict",
    command: "",
    args: Object.freeze([]),
    options: Object.freeze({}),
    enforcement: null,
    backend: null,
    candidateBackend: LINUX_GENERIC_BWRAP_BACKEND,
    guarantees: Object.freeze([]),
    requiredBoundaries: Object.freeze([...requiredBoundaries]),
    policyAttested: false,
    policyDigest: null,
    reason,
    postSpawn: Object.freeze({ required: false, mode: "none" }),
  });
}

function validateRootOwnedIdentity(identity, { directory }) {
  const expectedType = directory ? 0o040000 : 0o100000;
  return (
    identity &&
    identity.fileId?.dev !== undefined &&
    identity.fileId?.ino !== undefined &&
    Number(identity.uid) === 0 &&
    Number.isSafeInteger(Number(identity.mode)) &&
    (Number(identity.mode) & 0o170000) === expectedType &&
    (Number(identity.mode) & 0o022) === 0
  );
}

function expectedTargetInvocation(issued) {
  return {
    requestedCommand: issued.command,
    args: issued.args,
  };
}

function validateWorkspaceMountTopology(value, issued) {
  if (
    !value ||
    value.version !== 1 ||
    value.source !== "proc-self-mountinfo" ||
    value.workspaceRoot !== issued.workspaceRoot ||
    !/^[a-f0-9]{64}$/.test(value.digest || "") ||
    !Number.isSafeInteger(value.lineageEntryCount) ||
    value.lineageEntryCount < 1 ||
    !Number.isSafeInteger(value.filesystemEntryCount) ||
    value.filesystemEntryCount < 1 ||
    !Number.isSafeInteger(value.aliasCount) ||
    value.aliasCount < 1 ||
    !Number.isSafeInteger(value.forbiddenIdentityCount) ||
    value.forbiddenIdentityCount < 1 ||
    value.strictDescendantMountsAtAttestation !== 0 ||
    value.rootAliasAttested !== true ||
    value.recursiveBind !== true ||
    value.mountTopologyAtomic !== false
  ) {
    throw new Error(
      "workspace mount topology is missing or permits host aliases",
    );
  }
  return Object.freeze({
    version: value.version,
    source: value.source,
    workspaceRoot: value.workspaceRoot,
    digest: value.digest,
    lineageEntryCount: value.lineageEntryCount,
    filesystemEntryCount: value.filesystemEntryCount,
    aliasCount: value.aliasCount,
    forbiddenIdentityCount: value.forbiddenIdentityCount,
    strictDescendantMountsAtAttestation:
      value.strictDescendantMountsAtAttestation,
    rootAliasAttested: value.rootAliasAttested,
    recursiveBind: value.recursiveBind,
    mountTopologyAtomic: value.mountTopologyAtomic,
  });
}

function validateResourceContract(resources, issued) {
  if (
    !resources ||
    typeof resources !== "object" ||
    resources.attestedContractDigest !== issued.contractDigest ||
    typeof resources.attestContract !== "function" ||
    resources.attestContract(issued) !== true
  ) {
    throw new Error("generic workspace resource attestation is missing");
  }
  if (
    !sameIdentity(resources.workspace?.identity, issued.rootIdentity) ||
    !Number.isInteger(resources.workspace?.probeFd) ||
    !Number.isInteger(resources.workspace?.finalFd)
  ) {
    throw new Error("workspace descriptor does not match contract authority");
  }
  const workspaceMountTopology = validateWorkspaceMountTopology(
    resources.workspace.mountTopology,
    issued,
  );
  if (
    !validateRootOwnedIdentity(resources.supervisor?.identity, {
      directory: false,
    }) ||
    !/^[a-f0-9]{64}$/.test(resources.supervisor?.sha256 || "") ||
    !Number.isSafeInteger(resources.supervisor?.bytes) ||
    resources.supervisor.bytes <= 0 ||
    !Number.isInteger(resources.supervisor?.probeFd) ||
    !Number.isInteger(resources.supervisor?.finalFd)
  ) {
    throw new Error("bubblewrap supervisor is not root-owned and pinned");
  }
  const system = Array.isArray(resources.system) ? resources.system : [];
  if (!system.some((entry) => entry.destination === "/usr")) {
    throw new Error("root-owned /usr runtime mount is required");
  }
  for (const entry of system) {
    if (
      !SYSTEM_RUNTIME_DESTINATIONS.has(entry.destination) ||
      !validateRootOwnedIdentity(entry.identity, { directory: true }) ||
      !Number.isInteger(entry.probeFd) ||
      !Number.isInteger(entry.finalFd)
    ) {
      throw new Error("invalid root-owned system runtime descriptor");
    }
  }
  const symlinks = Array.isArray(resources.systemSymlinks)
    ? resources.systemSymlinks
    : [];
  for (const entry of symlinks) {
    if (!SYSTEM_RUNTIME_SYMLINKS.get(entry.destination)?.has(entry.target)) {
      throw new Error("invalid system runtime symlink");
    }
  }
  const etc = Array.isArray(resources.etc) ? resources.etc : [];
  for (const entry of etc) {
    if (
      !ETC_FILE_ALLOWLIST.has(entry.destination) ||
      !validateRootOwnedIdentity(entry.identity, { directory: false }) ||
      !Number.isInteger(entry.probeFd) ||
      !Number.isInteger(entry.finalFd)
    ) {
      throw new Error("invalid exact /etc runtime file descriptor");
    }
  }
  if (
    resources.seccomp?.policy !== "deny-network-creation" ||
    !/^[a-f0-9]{64}$/.test(resources.seccomp?.sha256 || "") ||
    !Number.isInteger(resources.seccomp?.probeFd) ||
    !Number.isInteger(resources.seccomp?.finalFd)
  ) {
    throw new Error("network seccomp descriptor is missing or unattested");
  }
  const target = resources.target;
  const expectedInvocation = expectedTargetInvocation(issued);
  if (
    !target ||
    target.attestedContractDigest !== issued.contractDigest ||
    target.requestedCommand !== expectedInvocation.requestedCommand ||
    typeof target.resolvedCommand !== "string" ||
    !path.posix.isAbsolute(target.resolvedCommand) ||
    !Array.isArray(target.args) ||
    target.args.length !== expectedInvocation.args.length ||
    !target.args.every(
      (value, index) =>
        typeof value === "string" && value === expectedInvocation.args[index],
    )
  ) {
    throw new Error("resolved target is not bound to the command contract");
  }
  if (target.scope === "workspace") {
    if (!isWithin(issued.workspaceRoot, target.resolvedCommand)) {
      throw new Error("workspace target escapes the authorized root");
    }
  } else if (
    target.scope !== "system" ||
    !validateRootOwnedIdentity(target.identity, { directory: false }) ||
    (Number(target.identity.mode) & 0o111) === 0 ||
    ![...SYSTEM_RUNTIME_DESTINATIONS].some((root) =>
      isWithin(root, target.resolvedCommand),
    )
  ) {
    throw new Error("target must be workspace-bound or root-owned system code");
  }
  return {
    supervisor: {
      identity: resources.supervisor.identity,
      sha256: resources.supervisor.sha256,
      bytes: resources.supervisor.bytes,
    },
    system,
    symlinks,
    etc,
    seccomp: {
      policy: resources.seccomp.policy,
      sha256: resources.seccomp.sha256,
    },
    workspaceMountTopology,
    target,
  };
}

function sanitizedEnvironment(environment, stdio) {
  const out = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      ENV_DENYLIST.has(key) ||
      value === undefined ||
      value === null ||
      String(value).includes("\0")
    ) {
      continue;
    }
    out[key] = String(value);
  }
  out.HOME = SANDBOX_HOME;
  out.TMPDIR = "/tmp";
  out.PATH = "/usr/local/bin:/usr/bin:/bin";
  out.OPENSSL_CONF = "/dev/null";
  out.CHAINLESS_SANDBOXED = "1";
  const ipcIndex = stdio.indexOf("ipc");
  if (ipcIndex >= 3) {
    out.NODE_CHANNEL_FD = String(ipcIndex);
    out.NODE_CHANNEL_SERIALIZATION_MODE = "json";
  }
  return out;
}

function passthroughSpawnOptions(options) {
  const out = {};
  for (const key of [
    "encoding",
    "input",
    "killSignal",
    "maxBuffer",
    "signal",
    "timeout",
    "windowsHide",
    "windowsVerbatimArguments",
  ]) {
    if (options?.[key] !== undefined) out[key] = options[key];
  }
  return out;
}

function directoryArguments(directoryDestinations, fileDestinations) {
  const directories = new Set([
    "/dev",
    "/etc",
    "/home",
    SANDBOX_HOME,
    "/proc",
    "/run",
    "/tmp",
    "/var",
    "/var/tmp",
  ]);
  for (const destination of directoryDestinations) {
    let current = destination;
    while (current !== "/") {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }
  for (const destination of fileDestinations) {
    let current = path.posix.dirname(destination);
    while (current !== "/") {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }
  return [...directories].sort((left, right) => {
    const depth =
      left.split("/").filter(Boolean).length -
      right.split("/").filter(Boolean).length;
    return depth || left.localeCompare(right);
  });
}

function descriptorLayout(stdio, resources, validated, workspaceRoot, phase) {
  const descriptors = [
    {
      kind: "supervisor",
      fd: resources.supervisor[`${phase}Fd`],
      destination: SUPERVISOR_STAGING_PATH,
    },
    {
      kind: "workspace",
      fd: resources.workspace[`${phase}Fd`],
      destination: workspaceRoot,
    },
    ...validated.system.map((entry) => ({
      kind: "system",
      fd: entry[`${phase}Fd`],
      destination: entry.destination,
    })),
    ...validated.etc.map((entry) => ({
      kind: "etc",
      fd: entry[`${phase}Fd`],
      destination: entry.destination,
    })),
    {
      kind: "seccomp",
      fd: resources.seccomp[`${phase}Fd`],
      destination: null,
    },
  ];
  const seen = new Set();
  for (const descriptor of descriptors) {
    if (!Number.isInteger(descriptor.fd) || seen.has(descriptor.fd)) {
      throw new Error("sandbox descriptor ownership is ambiguous");
    }
    seen.add(descriptor.fd);
  }
  return descriptors.map((descriptor, index) => ({
    ...descriptor,
    childFd: stdio.length + index,
  }));
}

function buildPolicyArgs({ issued, validated, descriptors, environment }) {
  const byKind = (kind) =>
    descriptors.filter((descriptor) => descriptor.kind === kind);
  const supervisor = byKind("supervisor")[0];
  const workspace = byKind("workspace")[0];
  const seccomp = byKind("seccomp")[0];
  const directoryDestinations = [
    issued.workspaceRoot,
    ...validated.system.map((entry) => entry.destination),
  ];
  const fileDestinations = validated.etc.map((entry) => entry.destination);
  const directories = directoryArguments(
    directoryDestinations,
    fileDestinations,
  );
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
  for (const directory of directories) {
    args.push("--dir", directory);
  }
  args.push(
    "--perms",
    "0000",
    "--file",
    String(supervisor.childFd),
    SUPERVISOR_STAGING_PATH,
    // Consuming the executable descriptor into a mode-0000 staging file keeps
    // it out of the target descriptor table. The following /run tmpfs then
    // deliberately hides that copy; bwrap itself was already execve'd through
    // /proc/self/fd/N by the Broker.
  );
  for (const descriptor of byKind("system")) {
    args.push(
      "--ro-bind-fd",
      String(descriptor.childFd),
      descriptor.destination,
    );
  }
  // Merged-/usr links must be created while the synthetic root is writable.
  // Root is remounted read-only immediately after all declared system and
  // exact-file mounts are installed.
  for (const link of validated.symlinks) {
    args.push("--symlink", link.target, link.destination);
  }
  for (const descriptor of byKind("etc")) {
    args.push(
      "--ro-bind-fd",
      String(descriptor.childFd),
      descriptor.destination,
    );
  }
  args.push(
    "--seccomp",
    String(seccomp.childFd),
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
    SANDBOX_HOME,
  );
  // A project may be a proper subtree of /tmp, /run, /var/tmp, or the
  // anonymous HOME. Those tmpfs mounts replaced their pre-created children, so
  // recreate only the authorized destination chain before binding the pinned
  // workspace descriptor.
  for (const directory of directories) {
    if (
      SCRATCH_MOUNTS.some(
        (scratch) => directory !== scratch && isWithin(scratch, directory),
      )
    ) {
      args.push("--dir", directory);
    }
  }
  args.push("--bind-fd", String(workspace.childFd), issued.workspaceRoot);
  args.push("--proc", "/proc", "--dev", "/dev");
  for (const key of Object.keys(environment).sort()) {
    args.push("--setenv", key, environment[key]);
  }
  args.push("--chdir", issued.workingDirectory);
  return args;
}

function policyBinding({
  issued,
  validated,
  environment,
  requiredBoundaries,
  policyArgs,
}) {
  return {
    version: PLAN_VERSION,
    backend: LINUX_GENERIC_BWRAP_BACKEND,
    contractDigest: issued.contractDigest,
    supervisor: validated.supervisor,
    workspace: {
      root: issued.workspaceRoot,
      cwd: issued.workingDirectory,
      rootIdentity: issued.rootIdentity,
      cwdIdentity: issued.cwdIdentity,
      access: "read-write",
      descriptorBound: true,
      mountTopology: validated.workspaceMountTopology,
    },
    system: validated.system.map((entry) => ({
      destination: entry.destination,
      identity: entry.identity,
      access: "read-only",
    })),
    systemSymlinks: validated.symlinks,
    etc: validated.etc.map((entry) => ({
      destination: entry.destination,
      identity: entry.identity,
      access: "read-only",
    })),
    network: {
      namespace: "new",
      seccomp: validated.seccomp,
    },
    target: {
      requestedCommand: validated.target.requestedCommand,
      command: validated.target.resolvedCommand,
      args: validated.target.args,
      scope: validated.target.scope,
      ...(validated.target.scope === "system"
        ? { identity: validated.target.identity }
        : {}),
    },
    requiredBoundaries: [...requiredBoundaries].sort(),
    environmentDigest: sha256(stableJson(environment)),
    policyArgs,
    hostRootMapped: false,
    hostHomeMapped: false,
  };
}

/**
 * Build an exact descriptor-backed bubblewrap plan.
 *
 * `resources` is supplied by the platform adapter and must include an
 * `attestContract()` callback plus independent probe/final descriptors. This is
 * the seam used by unit tests; production callers receive resources only from
 * the trusted platform adapter.
 */
export function planLinuxGenericBubblewrap(
  {
    contract,
    provenance,
    resources,
    environment = process.env,
    spawnOptions = {},
    probe,
    preflightFailure = null,
  },
  runtimeOverrides = {},
) {
  const requiredBoundaries = provenance?.requiredBoundaries || [];
  if ((runtimeOverrides.platform || os.platform()) !== "linux") {
    return unavailablePlan("platform_mismatch", requiredBoundaries);
  }
  const issued = consumePlanningAuthority(contract, provenance);
  if (!issued) {
    return unavailablePlan(
      "linux_generic_execution_contract_invalid",
      requiredBoundaries,
      resources?.cleanup,
    );
  }
  if (typeof preflightFailure === "string" && preflightFailure) {
    return unavailablePlan(
      preflightFailure,
      requiredBoundaries,
      resources?.cleanup,
    );
  }

  const cleanup = () => {
    try {
      resources?.closeProbe?.();
    } catch {
      // Preserve the original fail-closed result.
    }
    try {
      resources?.cleanup?.();
    } catch {
      // Preserve the original fail-closed result.
    }
  };
  let validated;
  let finalDescriptors;
  let probeDescriptors;
  let policyArgs;
  let targetEnvironment;
  try {
    validated = validateResourceContract(resources, issued);
    finalDescriptors = descriptorLayout(
      issued.stdio,
      resources,
      validated,
      issued.workspaceRoot,
      "final",
    );
    probeDescriptors = descriptorLayout(
      issued.stdio,
      resources,
      validated,
      issued.workspaceRoot,
      "probe",
    );
    targetEnvironment = sanitizedEnvironment(environment, issued.stdio);
    policyArgs = buildPolicyArgs({
      issued,
      validated,
      descriptors: finalDescriptors,
      environment: targetEnvironment,
    });
  } catch {
    return unavailablePlan(
      "linux_generic_resources_unattested",
      requiredBoundaries,
      cleanup,
    );
  }
  const binding = policyBinding({
    issued,
    validated,
    environment: targetEnvironment,
    requiredBoundaries,
    policyArgs,
  });
  const policyDigest = sha256(stableJson(binding));
  const probePolicyArgs = buildPolicyArgs({
    issued,
    validated,
    descriptors: probeDescriptors,
    environment: targetEnvironment,
  });
  const probeCommand = `/proc/self/fd/${
    probeDescriptors.find((entry) => entry.kind === "supervisor").childFd
  }`;
  const probeOptions = {
    cwd: "/",
    shell: false,
    encoding: "utf8",
    stdio: [
      ...issued.stdio.map((_, index) =>
        index === 1 || index === 2 ? "pipe" : "ignore",
      ),
      ...probeDescriptors.map((descriptor) => descriptor.fd),
    ],
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  };
  let probeResult;
  try {
    probeResult =
      typeof probe === "function"
        ? probe({
            command: probeCommand,
            args: probePolicyArgs,
            options: probeOptions,
            policyDigest,
            contractDigest: issued.contractDigest,
          })
        : null;
  } catch {
    probeResult = null;
  }
  try {
    resources.closeProbe?.();
  } catch {
    return unavailablePlan(
      "linux_generic_probe_cleanup_failed",
      requiredBoundaries,
      cleanup,
    );
  }
  if (
    probeResult?.runnable !== true ||
    probeResult.policyDigest !== policyDigest ||
    probeResult.contractDigest !== issued.contractDigest ||
    probeResult.emptyRoot !== true ||
    probeResult.undeclaredRootReadOnly !== true ||
    probeResult.workspaceReadWrite !== true ||
    probeResult.workspaceMountTopologyAttested !== true ||
    probeResult.anonymousDevWritable !== true ||
    probeResult.systemReadOnly !== true ||
    probeResult.hostHomeHidden !== true ||
    probeResult.outsideMarkerHidden !== true ||
    probeResult.networkNamespace !== true ||
    probeResult.networkNamespaceChanged !== true ||
    probeResult.socketCreationDenied !== true
  ) {
    return unavailablePlan(
      "linux_generic_policy_probe_failed",
      requiredBoundaries,
      cleanup,
    );
  }
  let finalAttested = false;
  try {
    finalAttested = resources.attestFinal?.(issued) === true;
  } catch {
    finalAttested = false;
  }
  if (!finalAttested) {
    return unavailablePlan(
      "linux_generic_execution_contract_changed",
      requiredBoundaries,
      cleanup,
    );
  }

  const supervisor = finalDescriptors.find(
    (entry) => entry.kind === "supervisor",
  );
  const command = `/proc/self/fd/${supervisor.childFd}`;
  const args = Object.freeze([
    ...policyArgs,
    "--",
    validated.target.resolvedCommand,
    ...validated.target.args,
  ]);
  const options = Object.freeze({
    ...passthroughSpawnOptions(spawnOptions),
    cwd: "/",
    shell: false,
    detached: false,
    env: Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }),
    stdio: Object.freeze([
      ...issued.stdio,
      ...finalDescriptors.map((descriptor) => descriptor.fd),
    ]),
  });
  let cleaned = false;
  const finalCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    resources.cleanup?.();
  };
  const plan = Object.freeze({
    contractVersion: PLAN_VERSION,
    applied: true,
    platform: "linux",
    profile: "strict",
    command,
    args,
    options,
    enforcement: LINUX_GENERIC_BWRAP_BACKEND,
    backend: LINUX_GENERIC_BWRAP_BACKEND,
    candidateBackend: null,
    guarantees: Object.freeze(["filesystem", "network"]),
    requiredBoundaries: Object.freeze([...requiredBoundaries]),
    policyAttested: true,
    policyDigest,
    reason: null,
    runtimeProbe: Object.freeze({
      kind: "linux-bwrap-generic-workspace-policy-v1",
      attempted: true,
      runnable: true,
      reason: null,
      probeRuntime: "posix-sh",
      targetRuntime: "generic-command",
      contentSnapshot: false,
      handleAtomic: false,
      mountTopologyAtomic: false,
      contractDigest: issued.contractDigest,
      policyDigest,
      mountTopologyDigest: validated.workspaceMountTopology.digest,
      emptyRoot: true,
      undeclaredRootReadOnly: true,
      workspaceReadWrite: true,
      workspaceMountTopologyAttested: true,
      workspaceRootAliasAttested: true,
      anonymousDevWritable: true,
      systemReadOnly: true,
      hostHomeHidden: true,
      outsideMarkerHidden: true,
      networkNamespace: true,
      networkNamespaceChanged: true,
      socketCreationDenied: true,
      descriptorMounts: true,
    }),
    filesystemPolicy: Object.freeze({
      workspaceRoot: issued.workspaceRoot,
      workingDirectory: issued.workingDirectory,
      workspaceAccess: "read-write",
      systemAccess: "read-only",
      undeclaredRootAccess: "read-only",
      anonymousWritablePaths: Object.freeze([
        SANDBOX_HOME,
        "/dev",
        "/run",
        "/tmp",
        "/var/tmp",
      ]),
      hostRootMapped: false,
      hostHomeMapped: false,
      workspaceDescriptorBound: true,
      systemDescriptorBound: true,
      exactEtcFileDescriptors: true,
      workspaceRecursiveBind: true,
      workspaceMountTopology:
        "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
      mountTopologySource: validated.workspaceMountTopology.source,
      mountTopologyDigest: validated.workspaceMountTopology.digest,
      mountTopologyAtomic: false,
    }),
    networkPolicy: Object.freeze({
      namespace: "new",
      namespaceIdentityChanged: true,
      seccomp: "deny-network-creation",
    }),
    postSpawn: Object.freeze({ required: false, mode: "none" }),
    cleanup: finalCleanup,
  });
  plannedPolicies.set(plan, policyDigest);
  return plan;
}

export function verifyLinuxGenericBubblewrapPlan(plan) {
  return (
    plannedPolicies.get(plan) === plan?.policyDigest &&
    Object.isFrozen(plan) &&
    Object.isFrozen(plan.args) &&
    Object.isFrozen(plan.options) &&
    Object.isFrozen(plan.options.stdio)
  );
}

export function _resetLinuxGenericSandboxContractsForTest() {
  // WeakMaps cannot be cleared without replacing module-level authority. Tests
  // use fresh contract objects, so this hook exists only as an explicit marker
  // that no enumerable/global token registry is involved.
  return true;
}
