/**
 * Durable byte identity for MCP stdio launchers and interpreter entrypoints.
 *
 * A trusted config names code; it does not prove which bytes PATH or an
 * interpreter will open. This module resolves those paths, attests regular
 * files through open descriptors, persists the first explicitly trusted
 * identity in OS user security state outside CHAINLESSCHAIN_HOME, and issues a
 * one-shot broker token for the final pre-spawn check. Restoring the CLI home
 * therefore cannot silently restore an older executable trust decision.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMachineSecurityAnchorDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import {
  readSecurityStore,
  writeSecurityStore,
} from "./durable-security-store.js";
import { resolveMcpStdioExecutionApproval } from "./mcp-stdio-execution-authority.js";
import {
  MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED_CODE,
  reattestMcpStdioPackageMaterialization,
  resolveMcpStdioPackageMaterialization,
} from "./mcp-stdio-package-materialization.js";
import {
  isMcpStdioCodeInjectionEnvironmentKey,
  sanitizeMcpStdioHostEnvironment,
} from "./mcp-stdio-environment.js";

export const MCP_STDIO_EXECUTABLE_TRUST_REQUIRED_CODE =
  "CC_MCP_STDIO_EXECUTABLE_TRUST_REQUIRED";
export const MCP_STDIO_EXECUTABLE_CHANGED_CODE =
  "CC_MCP_STDIO_EXECUTABLE_CHANGED";
export const MCP_STDIO_EXECUTABLE_UNATTESTED_CODE =
  "CC_MCP_STDIO_EXECUTABLE_UNATTESTED";
export const MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE =
  "CC_MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED";
export const MCP_STDIO_EXECUTABLE_AUTHORITY_REPLAYED_CODE =
  "CC_MCP_STDIO_EXECUTABLE_AUTHORITY_REPLAYED";
export const MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK_CODE =
  "CC_MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK";
export const MCP_STDIO_RUNTIME_KIND_REQUIRED_CODE =
  "CC_MCP_STDIO_RUNTIME_KIND_REQUIRED";
export const MCP_STDIO_RUNTIME_KIND_INVALID_CODE =
  "CC_MCP_STDIO_RUNTIME_KIND_INVALID";
export const MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND =
  "strict-mcp-node-capsule";
export const MCP_STDIO_CAPSULE_CODE_SNAPSHOT_BOUNDARY = "code-snapshot";

const STORE_LABEL = "MCP stdio executable identity";
const WITNESS_LABEL = "MCP stdio executable identity anti-rollback witness";
const WITNESS_VERSION = 1;
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRYPOINT_BYTES = 64 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const issuedLaunchAuthorities = new WeakMap();
const issuedCapsuleSandboxContracts = new WeakMap();

export const MCP_STDIO_RUNTIME_KINDS = Object.freeze([
  "native",
  "node",
  "python",
  "posix-shell",
  "powershell",
  "java",
  "dotnet",
]);
const MCP_STDIO_RUNTIME_KIND_SET = new Set(MCP_STDIO_RUNTIME_KINDS);

const DYNAMIC_LAUNCHERS = new Set([
  "bunx",
  "corepack",
  "npm",
  "npx",
  "pipx",
  "pnpm",
  "pnpx",
  "uvx",
  "yarn",
  "yarnpkg",
]);

export const _deps = {
  fs,
  withFileLock,
};

function identityError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "McpStdioExecutableIdentityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function getMcpStdioExecutableTrustStorePath(options = {}) {
  return (
    options.storePath ||
    process.env.CC_MCP_EXECUTABLE_TRUST_STORE ||
    path.join(
      getMachineSecurityAnchorDir(),
      "mcp-stdio-executable-identities-v1.json",
    )
  );
}

export function getMcpStdioExecutableTrustWitnessPath(options = {}) {
  return (
    options.witnessPath ||
    process.env.CC_MCP_EXECUTABLE_TRUST_WITNESS ||
    `${getMcpStdioExecutableTrustStorePath(options)}.anti-rollback-v1.json`
  );
}

function storeDigest(store) {
  return sha256(JSON.stringify(store));
}

function parseWitnessGeneration(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical non-negative integer`);
  }
  return BigInt(value);
}

function validateStoreDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function validateWitnessTransition(value, expectedPrevious, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const generation = parseWitnessGeneration(
    value.generation,
    `${label}.generation`,
  );
  const previousGeneration = parseWitnessGeneration(
    value.previousGeneration,
    `${label}.previousGeneration`,
  );
  if (
    previousGeneration !== expectedPrevious.generation ||
    generation !== previousGeneration + 1n
  ) {
    throw new TypeError(`${label} breaks the generation chain`);
  }
  const previousStoreDigest = validateStoreDigest(
    value.previousStoreDigest,
    `${label}.previousStoreDigest`,
  );
  if (previousStoreDigest !== expectedPrevious.storeDigest) {
    throw new TypeError(`${label} breaks the store digest chain`);
  }
  const nextStoreDigest = validateStoreDigest(
    value.storeDigest,
    `${label}.storeDigest`,
  );
  if (nextStoreDigest === previousStoreDigest) {
    throw new TypeError(`${label} does not advance the store digest`);
  }
  if (
    typeof value.mutationId !== "string" ||
    !/^[a-f0-9-]{16,64}$/i.test(value.mutationId)
  ) {
    throw new TypeError(`${label}.mutationId is invalid`);
  }
  if (
    typeof value.preparedAt !== "string" ||
    !Number.isFinite(Date.parse(value.preparedAt))
  ) {
    throw new TypeError(`${label}.preparedAt is invalid`);
  }
  if (
    value.committedAt !== undefined &&
    (typeof value.committedAt !== "string" ||
      !Number.isFinite(Date.parse(value.committedAt)))
  ) {
    throw new TypeError(`${label}.committedAt is invalid`);
  }
  return Object.freeze({
    generation,
    previousGeneration,
    previousStoreDigest,
    storeDigest: nextStoreDigest,
    mutationId: value.mutationId,
    preparedAt: value.preparedAt,
    ...(value.committedAt ? { committedAt: value.committedAt } : {}),
  });
}

function validateWitness(witness) {
  if (witness.version !== WITNESS_VERSION) {
    throw new TypeError(
      `unsupported MCP executable trust witness version: ${String(witness.version)}`,
    );
  }
  const generation = parseWitnessGeneration(
    witness.generation,
    "witness.generation",
  );
  const initialStoreDigest = validateStoreDigest(
    witness.initialStoreDigest,
    "witness.initialStoreDigest",
  );
  if (!Array.isArray(witness.events)) {
    throw new TypeError("witness.events must be an array");
  }
  let previous = Object.freeze({
    generation: 0n,
    storeDigest: initialStoreDigest,
  });
  for (const [index, event] of witness.events.entries()) {
    const transition = validateWitnessTransition(
      event,
      previous,
      `witness.events[${index}]`,
    );
    if (!transition.committedAt) {
      throw new TypeError(`witness.events[${index}] is not committed`);
    }
    previous = Object.freeze({
      generation: transition.generation,
      storeDigest: transition.storeDigest,
    });
  }
  if (generation !== previous.generation) {
    throw new TypeError("witness generation does not match its event chain");
  }
  const committedStoreDigest = validateStoreDigest(
    witness.storeDigest,
    "witness.storeDigest",
  );
  if (committedStoreDigest !== previous.storeDigest) {
    throw new TypeError("witness store digest does not match its event chain");
  }
  const pending =
    witness.pending == null
      ? null
      : validateWitnessTransition(witness.pending, previous, "witness.pending");
  if (pending?.committedAt) {
    throw new TypeError("witness.pending must not already be committed");
  }
  return Object.freeze({
    generation,
    initialStoreDigest,
    storeDigest: committedStoreDigest,
    events: Object.freeze([...witness.events]),
    pending,
  });
}

function initialWitness(digest) {
  return {
    version: WITNESS_VERSION,
    generation: "0",
    initialStoreDigest: digest,
    storeDigest: digest,
    events: [],
    pending: null,
  };
}

function rollbackError(message, details = {}) {
  return identityError(
    MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK_CODE,
    `MCP stdio executable trust rollback detected: ${message}`,
    details,
  );
}

function recoverWitness(witnessPath, witness, currentStoreDigest) {
  const snapshot = validateWitness(witness);
  if (!snapshot.pending) {
    if (currentStoreDigest !== snapshot.storeDigest) {
      throw rollbackError(
        "the trust store does not match its committed witness",
        {
          expectedStoreDigest: snapshot.storeDigest,
          observedStoreDigest: currentStoreDigest,
        },
      );
    }
    return snapshot;
  }

  if (currentStoreDigest === snapshot.storeDigest) {
    witness.pending = null;
    writeSecurityStore(witnessPath, WITNESS_LABEL, witness);
    return validateWitness(witness);
  }
  if (currentStoreDigest !== snapshot.pending.storeDigest) {
    throw rollbackError(
      "the trust store matches neither side of a pending mutation",
      {
        previousStoreDigest: snapshot.storeDigest,
        pendingStoreDigest: snapshot.pending.storeDigest,
        observedStoreDigest: currentStoreDigest,
      },
    );
  }

  const committed = {
    ...witness.pending,
    committedAt: new Date().toISOString(),
  };
  witness.generation = committed.generation;
  witness.storeDigest = committed.storeDigest;
  witness.events = [...witness.events, committed];
  witness.pending = null;
  writeSecurityStore(witnessPath, WITNESS_LABEL, witness);
  return validateWitness(witness);
}

function mutateExecutableTrustStore(target, mutator, options = {}) {
  const witnessPath = getMcpStdioExecutableTrustWitnessPath({
    ...options,
    storePath: target,
  });
  if (path.resolve(witnessPath) === path.resolve(target)) {
    throw new TypeError(
      "MCP stdio executable trust store and witness must use different paths",
    );
  }
  try {
    _deps.fs.mkdirSync(path.dirname(witnessPath), {
      recursive: true,
      mode: 0o700,
    });
  } catch (cause) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      "MCP stdio executable trust witness could not be prepared",
      { cause, witnessPath },
    );
  }

  return _deps.withFileLock(
    witnessPath,
    () => {
      const store = readSecurityStore(target, STORE_LABEL);
      const currentStoreDigest = storeDigest(store);
      const witnessExists = _deps.fs.existsSync(witnessPath);
      const witness = witnessExists
        ? readSecurityStore(witnessPath, WITNESS_LABEL)
        : initialWitness(currentStoreDigest);
      const snapshot = witnessExists
        ? recoverWitness(witnessPath, witness, currentStoreDigest)
        : validateWitness(witness);
      const draft = structuredClone(store);
      const result = mutator(draft);
      const nextStoreDigest = storeDigest(draft);

      if (nextStoreDigest === currentStoreDigest) {
        if (!witnessExists) {
          writeSecurityStore(witnessPath, WITNESS_LABEL, witness);
        }
        return result;
      }

      const transition = {
        generation: String(snapshot.generation + 1n),
        previousGeneration: String(snapshot.generation),
        previousStoreDigest: currentStoreDigest,
        storeDigest: nextStoreDigest,
        mutationId: crypto.randomUUID(),
        preparedAt: new Date().toISOString(),
      };
      witness.pending = transition;
      writeSecurityStore(witnessPath, WITNESS_LABEL, witness);
      writeSecurityStore(target, STORE_LABEL, draft);

      const committed = {
        ...transition,
        committedAt: new Date().toISOString(),
      };
      witness.generation = committed.generation;
      witness.storeDigest = committed.storeDigest;
      witness.events = [...witness.events, committed];
      witness.pending = null;
      writeSecurityStore(witnessPath, WITNESS_LABEL, witness);
      return result;
    },
    { timeoutMs: 2000, staleMs: 30000, failIfUnavailable: true },
  );
}

function retrustRequested(env = process.env) {
  const value = String(env.CC_MCP_EXECUTABLE_TRUST || "").toLowerCase();
  return value === "1" || value === "true";
}

function executableBasename(value) {
  return path
    .basename(String(value || ""))
    .replace(/\.(?:exe|com|cmd|bat)$/i, "")
    .toLowerCase();
}

function inferredRuntimeKind(commandPath) {
  const name = executableBasename(commandPath);
  if (["node", "nodejs"].includes(name)) return "node";
  if (/^python(?:w)?(?:\d+(?:\.\d+)*)?$/.test(name)) return "python";
  if (["bash", "dash", "ksh", "sh", "zsh"].includes(name)) {
    return "posix-shell";
  }
  if (["powershell", "pwsh"].includes(name)) return "powershell";
  if (name === "java") return "java";
  if (name === "dotnet") return "dotnet";
  return null;
}

export function resolveMcpStdioRuntimeKind(commandPath, requestedKind = null) {
  const inferred = inferredRuntimeKind(commandPath);
  if (requestedKind != null) {
    if (
      typeof requestedKind !== "string" ||
      !MCP_STDIO_RUNTIME_KIND_SET.has(requestedKind)
    ) {
      throw identityError(
        MCP_STDIO_RUNTIME_KIND_INVALID_CODE,
        `MCP stdio runtimeKind must be one of: ${MCP_STDIO_RUNTIME_KINDS.join(", ")}`,
      );
    }
    if (inferred && requestedKind !== inferred) {
      throw identityError(
        MCP_STDIO_RUNTIME_KIND_INVALID_CODE,
        `MCP stdio runtimeKind "${requestedKind}" conflicts with recognized ${inferred} executable "${executableBasename(commandPath)}"`,
      );
    }
    return requestedKind;
  }
  if (inferred) return inferred;
  throw identityError(
    MCP_STDIO_RUNTIME_KIND_REQUIRED_CODE,
    `MCP stdio executable "${executableBasename(commandPath)}" has no recognized runtime semantics; set runtimeKind explicitly before trusting it`,
  );
}

function materializeLaunchEnvironment(hostEnv, configEnv) {
  const launch = sanitizeMcpStdioHostEnvironment(hostEnv);
  for (const [key, value] of Object.entries(configEnv || {})) {
    if (isMcpStdioCodeInjectionEnvironmentKey(key)) {
      throw identityError(
        MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
        `MCP stdio config environment may load unattested code through ${key}`,
      );
    }
    if (typeof value !== "string") {
      throw identityError(
        MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
        `MCP stdio config environment value must be a string: ${key}`,
      );
    }
    launch[key] = value;
  }
  return Object.freeze(launch);
}

export function assertMcpStdioExecutableEnvironmentSafe(env) {
  for (const key of Object.keys(env || {})) {
    if (isMcpStdioCodeInjectionEnvironmentKey(key)) {
      throw identityError(
        MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
        `MCP stdio launch environment may load unattested code through ${key}`,
      );
    }
  }
  return true;
}

function candidateFiles(command, cwd, env, platform) {
  const value = String(command || "");
  if (!value || value.includes("\0")) return [];
  if (path.isAbsolute(value)) return [path.resolve(value)];
  if (value.includes("/") || value.includes("\\")) {
    return [path.resolve(cwd, value)];
  }
  const searchPath = String(env.PATH || env.Path || env.path || "");
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  if (platform !== "win32") {
    return directories.map((directory) => path.resolve(directory, value));
  }
  const extensions = String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const hasExtension = path.extname(value) !== "";
  return directories.flatMap((directory) =>
    (hasExtension ? [""] : extensions).map((extension) =>
      path.resolve(directory, `${value}${extension}`),
    ),
  );
}

function resolveExecutable(command, cwd, env, platform) {
  for (const candidate of candidateFiles(command, cwd, env, platform)) {
    try {
      const candidateStat = _deps.fs.statSync(candidate);
      if (!candidateStat.isFile()) continue;
      if (platform !== "win32") {
        _deps.fs.accessSync(candidate, _deps.fs.constants.X_OK);
      }
      const realPath =
        _deps.fs.realpathSync.native?.(candidate) ||
        _deps.fs.realpathSync(candidate);
      if (
        platform === "win32" &&
        ![".exe", ".com"].includes(path.extname(realPath).toLowerCase())
      ) {
        continue;
      }
      return realPath;
    } catch {
      // Keep searching PATH/PATHEXT.
    }
  }
  throw identityError(
    MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
    `MCP stdio command could not be resolved to an executable file: ${String(command)}`,
  );
}

function statIdentity(stat) {
  const time = (ns, ms) =>
    stat[ns] !== undefined
      ? String(stat[ns])
      : String(Math.trunc(Number(stat[ms] || 0) * 1_000_000));
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    bytes: Number(stat.size),
    mode: Number(stat.mode),
    nlink: Number(stat.nlink),
    ctimeNs: time("ctimeNs", "ctimeMs"),
    mtimeNs: time("mtimeNs", "mtimeMs"),
  };
}

function sameOpenIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.bytes === right.bytes &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

function hashOpenFile(fd, bytes) {
  const digest = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(
    Math.max(1, Math.min(bytes, HASH_CHUNK_BYTES)),
  );
  let offset = 0;
  while (offset < bytes) {
    const read = _deps.fs.readSync(
      fd,
      chunk,
      0,
      Math.min(chunk.length, bytes - offset),
      offset,
    );
    if (read <= 0) throw new Error("file ended before its attested size");
    digest.update(chunk.subarray(0, read));
    offset += read;
  }
  return digest.digest("hex");
}

function attestFile(file, maxBytes, role, platform, observation = null) {
  let fd;
  try {
    const realPath =
      _deps.fs.realpathSync.native?.(path.resolve(file)) ||
      _deps.fs.realpathSync(path.resolve(file));
    const lst = _deps.fs.lstatSync(realPath);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("path is not a regular non-symlink file");
    }
    fd = _deps.fs.openSync(
      realPath,
      Number(_deps.fs.constants.O_RDONLY) |
        Number(_deps.fs.constants.O_NOFOLLOW || 0) |
        Number(_deps.fs.constants.O_NONBLOCK || 0),
    );
    const before = _deps.fs.fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 0n ||
      before.size > BigInt(maxBytes)
    ) {
      throw new Error("file exceeds the attestation size limit");
    }
    const beforeIdentity = statIdentity(before);
    if (observation) {
      const header = Buffer.allocUnsafe(
        Math.max(1, Math.min(Number(before.size), 4096)),
      );
      const headerBytes =
        before.size > 0n
          ? _deps.fs.readSync(fd, header, 0, header.length, 0)
          : 0;
      observation.hasShebang =
        headerBytes >= 2 && header[0] === 0x23 && header[1] === 0x21;
    }
    const digest = hashOpenFile(fd, Number(before.size));
    const afterIdentity = statIdentity(
      _deps.fs.fstatSync(fd, { bigint: true }),
    );
    if (!sameOpenIdentity(beforeIdentity, afterIdentity)) {
      throw new Error("file changed while it was being hashed");
    }
    const pathIdentity = statIdentity(
      _deps.fs.statSync(realPath, { bigint: true }),
    );
    if (
      platform !== "win32" &&
      (pathIdentity.dev !== afterIdentity.dev ||
        pathIdentity.ino !== afterIdentity.ino)
    ) {
      throw new Error("path no longer names the opened file");
    }
    return Object.freeze({
      role,
      realPath,
      sha256: digest,
      ...afterIdentity,
    });
  } catch (cause) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      `MCP stdio ${role} identity could not be attested: ${cause.message}`,
      { cause },
    );
  } finally {
    if (fd !== undefined) {
      try {
        _deps.fs.closeSync(fd);
      } catch {
        // Preserve the attestation result.
      }
    }
  }
}

function localEntrypoint(value, cwd, label) {
  if (typeof value !== "string" || !value || value === "-") {
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      `MCP stdio ${label} must name a local file`,
    );
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw identityError(
      MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
      `MCP stdio ${label} cannot be a remote URL`,
    );
  }
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(cwd, value);
}

function interpreterEntrypoints(runtimeKind, args, cwd) {
  const values = [...args];
  const entry = (index, role = "entrypoint") => [
    {
      argIndex: index,
      path: localEntrypoint(values[index], cwd, role),
      role,
    },
  ];
  if (runtimeKind === "node") {
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (["-e", "--eval", "-p", "--print"].includes(value)) return [];
      if (
        value === "-r" ||
        value === "--require" ||
        value === "--import" ||
        value === "--loader" ||
        value === "--experimental-loader" ||
        value.startsWith("--require=") ||
        value.startsWith("--import=") ||
        value.startsWith("--loader=") ||
        value.startsWith("--experimental-loader=")
      ) {
        throw identityError(
          MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
          "MCP stdio Node preload/import flags require a transitive code lock and are not supported",
        );
      }
      if (value === "--") return entry(index + 1);
      if (!value.startsWith("-")) return entry(index);
    }
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      "MCP stdio Node launch must provide a script or inline program",
    );
  }
  if (runtimeKind === "python") {
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === "-c") return [];
      if (value === "-m") {
        throw identityError(
          MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
          "MCP stdio Python -m modules are not bound to one entrypoint file",
        );
      }
      if (value === "--") return entry(index + 1);
      if (!value.startsWith("-")) return entry(index);
    }
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      "MCP stdio Python launch must provide a script or inline program",
    );
  }
  if (runtimeKind === "posix-shell") {
    const inline = values.findIndex((value) => value === "-c");
    if (inline >= 0) return [];
    const index = values.findIndex((value) => !value.startsWith("-"));
    if (index >= 0) return entry(index, "shell-script");
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      "MCP stdio shell launch must provide a script or inline command",
    );
  }
  if (runtimeKind === "powershell") {
    const fileIndex = values.findIndex((value) => /^-file$/i.test(value));
    if (fileIndex >= 0) return entry(fileIndex + 1, "powershell-script");
    if (values.some((value) => /^-(?:command|encodedcommand)$/i.test(value))) {
      return [];
    }
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      "MCP stdio PowerShell launch must use -File or an inline command",
    );
  }
  if (runtimeKind === "java") {
    const jarIndex = values.findIndex((value) => value === "-jar");
    if (jarIndex >= 0) return entry(jarIndex + 1, "java-jar");
    throw identityError(
      MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
      "MCP stdio Java classpath launches are not bound to one entrypoint file",
    );
  }
  if (runtimeKind === "dotnet") {
    const index = values.findIndex((value) => !value.startsWith("-"));
    if (index >= 0 && /\.dll$/i.test(values[index])) {
      return entry(index, "dotnet-assembly");
    }
    throw identityError(
      MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
      "MCP stdio dotnet tool/project launches are not bound to one assembly file",
    );
  }
  return [];
}

function comparableIdentity(identity) {
  return {
    command: identity.command,
    entrypoints: identity.entrypoints,
    ...(identity.materialization
      ? { materialization: identity.materialization }
      : {}),
  };
}

function identityDigest(identity) {
  return sha256(JSON.stringify(comparableIdentity(identity)));
}

function capsuleSandboxFileIdentity(identity, requestedPath) {
  return Object.freeze({
    ...(requestedPath ? { requestedPath } : {}),
    realPath: identity.realPath,
    sha256: identity.sha256,
    bytes: identity.bytes,
    dev: identity.dev,
    ino: identity.ino,
    mtimeMs: Number(identity.mtimeNs) / 1_000_000,
    mode: identity.mode,
  });
}

function attestCapsuleRoot(capsuleRoot) {
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const root = realpath(path.resolve(capsuleRoot));
  const before = _deps.fs.lstatSync(root, { bigint: true });
  const after = _deps.fs.statSync(root, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    !after.isDirectory() ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    throw new Error("MCP capsule root identity changed during attestation");
  }
  return Object.freeze({
    realPath: root,
    dev: String(after.dev),
    ino: String(after.ino),
  });
}

function issueCapsuleSandboxExecutionContract({
  serverName,
  config,
  attestation,
  materialization,
}) {
  if (!materialization) return null;
  const capsuleRoot = attestCapsuleRoot(materialization.capsuleRoot);
  const entryIdentity = attestation.identity.entrypoints.find(
    (entry) => entry.argIndex === 0,
  );
  if (
    attestation.identity.entrypoints.length !== 1 ||
    !entryIdentity ||
    path.dirname(entryIdentity.realPath) !== capsuleRoot.realPath ||
    entryIdentity.realPath !== attestation.launchArgs[0]
  ) {
    throw new Error(
      "MCP materialized capsule launch is not one direct Node entrypoint",
    );
  }
  const contract = Object.freeze({
    contractVersion: 1,
    kind: MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND,
    pluginRoot: capsuleRoot.realPath,
    workingDirectory: capsuleRoot.realPath,
    runtimePath: attestation.identity.command.realPath,
    rootIdentity: capsuleRoot,
    entryIdentity: capsuleSandboxFileIdentity(entryIdentity),
    runtimeIdentity: capsuleSandboxFileIdentity(
      attestation.identity.command,
      path.resolve(process.execPath),
    ),
  });
  issuedCapsuleSandboxContracts.set(
    contract,
    Object.freeze({
      origin: config.origin || `mcp:server:${serverName}`,
      command: attestation.launchCommand,
      args: Object.freeze([...attestation.launchArgs]),
      cwd: capsuleRoot.realPath,
      identityDigest: attestation.identityDigest,
    }),
  );
  return contract;
}

export function consumeMcpStdioCapsuleSandboxExecutionContract(
  contract,
  provenance = {},
) {
  const issued =
    contract && typeof contract === "object"
      ? issuedCapsuleSandboxContracts.get(contract)
      : null;
  if (!issued) return false;
  issuedCapsuleSandboxContracts.delete(contract);
  const args = Array.isArray(provenance.args) ? provenance.args : [];
  const requiredBoundaries = Array.isArray(provenance.requiredBoundaries)
    ? provenance.requiredBoundaries
    : [];
  return (
    contract.kind === MCP_STDIO_CAPSULE_SANDBOX_CONTRACT_KIND &&
    provenance.origin === issued.origin &&
    provenance.command === issued.command &&
    provenance.cwd === issued.cwd &&
    provenance.shell === false &&
    provenance.sync === false &&
    provenance.identityDigest === issued.identityDigest &&
    requiredBoundaries.includes(MCP_STDIO_CAPSULE_CODE_SNAPSHOT_BOUNDARY) &&
    args.length === issued.args.length &&
    args.every((value, index) => value === issued.args[index])
  );
}

export function attestMcpStdioExecutableIdentity({
  command,
  args = [],
  env = {},
  cwd = process.cwd(),
  platform = process.platform,
  runtimeKind: requestedRuntimeKind = null,
}) {
  const name = executableBasename(command);
  if (DYNAMIC_LAUNCHERS.has(name)) {
    throw identityError(
      MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
      `MCP stdio dynamic launcher "${name}" can execute code not identified by its own bytes`,
    );
  }
  const launchEnv = { ...process.env, ...env };
  const commandPath = resolveExecutable(command, cwd, launchEnv, platform);
  const commandObservation = {};
  const commandIdentity = attestFile(
    commandPath,
    MAX_EXECUTABLE_BYTES,
    "command",
    platform,
    commandObservation,
  );
  if (commandObservation.hasShebang) {
    throw identityError(
      MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
      "MCP stdio direct shebang commands do not bind the interpreter bytes; configure the interpreter and script as command + args",
    );
  }
  const runtimeKind = resolveMcpStdioRuntimeKind(
    commandIdentity.realPath,
    requestedRuntimeKind,
  );
  const launchArgs = [...args];
  const entrypoints = interpreterEntrypoints(runtimeKind, launchArgs, cwd).map(
    ({ argIndex, path: entryPath, role }) => {
      const identity = attestFile(
        entryPath,
        MAX_ENTRYPOINT_BYTES,
        role,
        platform,
      );
      launchArgs[argIndex] = identity.realPath;
      return Object.freeze({ argIndex, ...identity });
    },
  );
  const identity = Object.freeze({
    version: 2,
    runtimeKind,
    command: commandIdentity,
    entrypoints: Object.freeze(entrypoints),
  });
  return Object.freeze({
    launchCommand: commandIdentity.realPath,
    launchArgs: Object.freeze(launchArgs),
    identity,
    identityDigest: identityDigest(identity),
  });
}

function trustKey(approvalRecord) {
  return sha256(
    `${approvalRecord.approvalKind}\0${approvalRecord.approvalSource}\0${approvalRecord.fingerprint}`,
  );
}

function trustMessage(serverName, attestation, status) {
  const entrypoints = attestation.identity.entrypoints
    .map((entry) => `${entry.realPath} sha256:${entry.sha256}`)
    .join(", ");
  const materialization = attestation.identity.materialization;
  return (
    `MCP stdio executable identity ${status} for "${serverName}": ` +
    `${attestation.identity.command.realPath} sha256:${attestation.identity.command.sha256}` +
    (entrypoints ? `; ${entrypoints}` : "") +
    (materialization
      ? `; npm ${materialization.package.name}@${materialization.package.version} closure sha256:${materialization.closureDigest}`
      : "") +
    ". Review these bytes, then run 'cc mcp trust-executable <name>' or set CC_MCP_EXECUTABLE_TRUST=1 for this run"
  );
}

function materializedAttestation(attestation, materialization) {
  if (!materialization) return attestation;
  const identity = Object.freeze({
    version: 3,
    runtimeKind: attestation.identity.runtimeKind,
    command: attestation.identity.command,
    entrypoints: attestation.identity.entrypoints,
    materialization: materialization.identity,
  });
  return Object.freeze({
    launchCommand: attestation.launchCommand,
    launchArgs: attestation.launchArgs,
    identity,
    identityDigest: identityDigest(identity),
  });
}

function checkOrRecordTrust(
  serverName,
  approvalRecord,
  attestation,
  options = {},
) {
  const target = getMcpStdioExecutableTrustStorePath(options);
  const key = trustKey(approvalRecord);
  const requested =
    options.retrust === true || retrustRequested(options.env || process.env);
  return mutateExecutableTrustStore(
    target,
    (store) => {
      const existing = store[key] || null;
      if (
        existing?.identityDigest === attestation.identityDigest &&
        !requested
      ) {
        return { status: "trusted", key };
      }
      if (!requested) {
        const changed = Boolean(existing);
        throw identityError(
          changed
            ? MCP_STDIO_EXECUTABLE_CHANGED_CODE
            : MCP_STDIO_EXECUTABLE_TRUST_REQUIRED_CODE,
          trustMessage(
            serverName,
            attestation,
            changed ? "changed" : "requires trust",
          ),
          {
            executableIdentityDigest: attestation.identityDigest,
            previousExecutableIdentityDigest: existing?.identityDigest || null,
          },
        );
      }
      store[key] = {
        approvalKind: approvalRecord.approvalKind,
        approvalSource: approvalRecord.approvalSource,
        invocationFingerprint: approvalRecord.fingerprint,
        identityDigest: attestation.identityDigest,
        identity: comparableIdentity(attestation.identity),
        trustedAt: new Date(
          typeof options.now === "number" ? options.now : Date.now(),
        ).toISOString(),
      };
      return {
        status: existing ? "retrusted" : "trusted-first-use",
        key,
      };
    },
    options,
  );
}

export function prepareMcpStdioExecutableIdentity({
  serverName,
  config,
  approval,
  cwd = process.cwd(),
  env = process.env,
  retrust = false,
  storePath: explicitStorePath,
  witnessPath: explicitWitnessPath,
  materializationRoot,
  materializationIndexPath,
}) {
  const approvalRecord = resolveMcpStdioExecutionApproval(approval);
  if (!approvalRecord) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_UNATTESTED_CODE,
      `MCP stdio executable identity for "${serverName}" requires a valid execution approval`,
    );
  }
  let materialization = null;
  let effectiveCommand = config.command;
  let effectiveArgs = config.args || [];
  if (DYNAMIC_LAUNCHERS.has(executableBasename(config.command))) {
    try {
      materialization = resolveMcpStdioPackageMaterialization({
        approvalRecord,
        ...(materializationRoot ? { root: materializationRoot } : {}),
        ...(materializationIndexPath
          ? { indexPath: materializationIndexPath }
          : {}),
      });
      effectiveCommand = materialization.command;
      effectiveArgs = [...materialization.args];
    } catch (cause) {
      if (cause?.code === MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED_CODE) {
        throw identityError(
          MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED_CODE,
          cause.message,
          { cause },
        );
      }
      throw cause;
    }
  }
  const attestation = materializedAttestation(
    attestMcpStdioExecutableIdentity({
      command: effectiveCommand,
      args: effectiveArgs,
      env: config.env || {},
      cwd,
      runtimeKind: materialization ? "node" : config.runtimeKind,
    }),
    materialization,
  );
  const launchEnv = materializeLaunchEnvironment(env, config.env || {});
  const trust = checkOrRecordTrust(serverName, approvalRecord, attestation, {
    env,
    retrust,
    ...(explicitStorePath ? { storePath: explicitStorePath } : {}),
    ...(explicitWitnessPath ? { witnessPath: explicitWitnessPath } : {}),
  });
  const sandboxExecutionContract = issueCapsuleSandboxExecutionContract({
    serverName,
    config,
    attestation,
    materialization,
  });
  const authority = Object.freeze({});
  issuedLaunchAuthorities.set(
    authority,
    Object.freeze({
      command: attestation.launchCommand,
      args: Object.freeze([...attestation.launchArgs]),
      identity: attestation.identity,
      identityDigest: attestation.identityDigest,
      materialization,
      runtimeKind: attestation.identity.runtimeKind,
    }),
  );
  return Object.freeze({
    command: attestation.launchCommand,
    args: Object.freeze([...attestation.launchArgs]),
    identity: attestation.identity,
    identityDigest: attestation.identityDigest,
    env: launchEnv,
    workingDirectory:
      sandboxExecutionContract?.workingDirectory ||
      materialization?.capsuleRoot ||
      cwd,
    ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
    authority,
    trustStatus: trust.status,
  });
}

export function consumeMcpStdioExecutableIdentityAuthority(
  authority,
  { command, args = [], env = {} },
) {
  const issued = issuedLaunchAuthorities.get(authority);
  if (!issued) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_AUTHORITY_REPLAYED_CODE,
      "MCP stdio executable identity authority is invalid or already consumed",
    );
  }
  issuedLaunchAuthorities.delete(authority);
  assertMcpStdioExecutableEnvironmentSafe(env);
  if (
    command !== issued.command ||
    JSON.stringify(args) !== JSON.stringify(issued.args)
  ) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_CHANGED_CODE,
      "MCP stdio launch changed after executable identity approval",
    );
  }
  let current = attestMcpStdioExecutableIdentity({
    command,
    args,
    cwd: process.cwd(),
    runtimeKind: issued.runtimeKind,
  });
  if (issued.materialization) {
    const verified = reattestMcpStdioPackageMaterialization(
      issued.materialization,
    );
    if (
      JSON.stringify(verified.identity) !==
      JSON.stringify(issued.materialization.identity)
    ) {
      throw identityError(
        MCP_STDIO_EXECUTABLE_CHANGED_CODE,
        "MCP stdio materialized package identity changed before spawn",
      );
    }
    current = materializedAttestation(current, issued.materialization);
  }
  if (current.identityDigest !== issued.identityDigest) {
    throw identityError(
      MCP_STDIO_EXECUTABLE_CHANGED_CODE,
      "MCP stdio executable or entrypoint bytes changed before spawn",
    );
  }
  return Object.freeze({ identityDigest: issued.identityDigest });
}
