import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
  createExecutionLocationTargetAttestation,
  normalizeExecutionLocationBinding,
} from "./execution-location-contract.js";
import { containsSecret } from "./secret-scan.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { executionBroker } from "./process-execution-broker/index.js";
import { assertExecutionLocationRunnerLeaseAuthority } from "./execution-location-runner-lifecycle.js";
import { ensurePrivateDirectory, repairPrivatePaths } from "./secure-fs.js";
import { getSessionAntiRollbackDirectory } from "./session-anti-rollback-anchor.js";
import {
  MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
  normalizeExecutionLocationResultBundle,
  verifyExecutionLocationResultBundle,
} from "./execution-location-result.js";

export const EXECUTION_LOCATION_PROFILE_SCHEMA =
  "cc-execution-location-profile/v1";
export const EXECUTION_LOCATION_PROFILE_SCHEMA_V2 =
  "cc-execution-location-profile/v2";
export { EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA };
export const EXECUTION_LOCATION_TARGET_RESUME_SCHEMA =
  "cc-execution-location-target-resume/v1";
export const EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_SCHEMA =
  "cc-execution-location-target-result-collection/v1";
export const EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_REQUEST_SCHEMA =
  "cc-execution-location-target-result-collection-request/v1";

const SESSION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";
const SESSION_LOCATION_HANDOFF_INSTALL_SCHEMA =
  "chainlesschain.session-execution-location-handoff-install/v1";
const PROFILE_TARGETS = new Set(["local", "wsl", "ssh", "container"]);
const RUNNER_LIFECYCLE_STATES = new Set([
  "accepting",
  "draining",
  "parked",
  "reclaiming",
]);
const SESSION_STORE_MODES = new Set(["replicated", "shared"]);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_RE = /^[a-f0-9]{40,64}$/u;
const MAX_PROFILE_BYTES = 1024 * 1024;
const MAX_PROBE_BYTES = 1024 * 1024;
const MAX_REPLICA_BYTES = 64 * 1024 * 1024;
const DEFAULT_TARGET_COMMAND_TIMEOUT_MS = 30_000;
const MAX_TARGET_COMMAND_TIMEOUT_MS = 120_000;
const REPLICA_TRANSFER_TIMEOUT_MS = MAX_TARGET_COMMAND_TIMEOUT_MS;
const MAX_PROXY_AUTHORITY_AGE_MS = 5 * 60 * 1000;
const LOCAL_TARGET_SUPERVISOR = fileURLToPath(
  new URL("./execution-location-local-supervisor.mjs", import.meta.url),
);
const RESULT_MEDIA_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationTarget"), "utf8")
    .digest("hex")}`;
}

function safeString(value, field, max = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function safeName(value, field, max = 256) {
  const normalized = safeString(value, field, max);
  if (
    normalized.startsWith("-") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u.test(normalized)
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function safePath(value, field) {
  const normalized = safeString(value, field);
  if (normalized.startsWith("-") || normalized.includes("\0")) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function safeInteger(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function safeTimestamp(value, field) {
  const normalized = safeString(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function exactObject(value, fields, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new TypeError(`${field} has an invalid schema`);
  }
  return value;
}

function normalizeTools(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError("profile.expected.tools is invalid");
  }
  const tools = value.map((entry) => safeName(entry, "expected tool", 128));
  if (new Set(tools).size !== tools.length) {
    throw new TypeError("profile.expected.tools contains duplicates");
  }
  return tools.sort();
}

function normalizeSessionStore(value) {
  if (value == null) return null;
  const input = exactObject(
    value,
    ["mode", "targetSessionId", "headHash", "eventCount"],
    "profile.sessionStore",
  );
  const mode = safeName(input.mode, "profile.sessionStore.mode", 32);
  const targetSessionId = safeName(
    input.targetSessionId,
    "profile.sessionStore.targetSessionId",
  );
  const headHash = safeName(
    input.headHash,
    "profile.sessionStore.headHash",
    64,
  ).toLowerCase();
  const eventCount = Number(input.eventCount);
  if (
    !SESSION_STORE_MODES.has(mode) ||
    !/^[a-f0-9]{64}$/u.test(headHash) ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 1
  ) {
    throw new TypeError("profile.sessionStore is invalid");
  }
  return Object.freeze({ mode, targetSessionId, headHash, eventCount });
}

function normalizeRunnerLifecycle(value, profileCwd) {
  const input = exactObject(
    value,
    [
      "runnerId",
      "authorityFile",
      "state",
      "generation",
      "lease",
      "proxyAuthority",
      "baseDir",
      "resources",
      "postSessionHook",
    ],
    "profile.lifecycle",
  );
  const state = safeName(input.state, "profile.lifecycle.state", 32);
  if (!RUNNER_LIFECYCLE_STATES.has(state)) {
    throw new TypeError("profile.lifecycle.state is invalid");
  }
  if (state === "parked" || state === "reclaiming") {
    throw new TypeError("profile lifecycle is not accepting target work");
  }

  const generation = safeInteger(
    input.generation,
    "profile.lifecycle.generation",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const lease = exactObject(
    input.lease,
    ["id", "generation", "expiresAt"],
    "profile.lifecycle.lease",
  );
  const leaseGeneration = safeInteger(
    lease.generation,
    "profile.lifecycle.lease.generation",
    1,
    generation,
  );
  const leaseExpiresAt = safeTimestamp(
    lease.expiresAt,
    "profile.lifecycle.lease.expiresAt",
  );

  const proxyAuthority = exactObject(
    input.proxyAuthority,
    ["id", "revision", "issuedAt", "expiresAt"],
    "profile.lifecycle.proxyAuthority",
  );
  const proxyIssuedAt = safeTimestamp(
    proxyAuthority.issuedAt,
    "profile.lifecycle.proxyAuthority.issuedAt",
  );
  const proxyExpiresAt = safeTimestamp(
    proxyAuthority.expiresAt,
    "profile.lifecycle.proxyAuthority.expiresAt",
  );
  if (Date.parse(proxyExpiresAt) <= Date.parse(proxyIssuedAt)) {
    throw new TypeError("profile lifecycle proxy authority is invalid");
  }

  const baseDir = exactObject(
    input.baseDir,
    ["path", "writableRequired"],
    "profile.lifecycle.baseDir",
  );
  const baseDirPath = safePath(baseDir.path, "profile.lifecycle.baseDir.path");
  if (baseDirPath !== profileCwd || baseDir.writableRequired !== true) {
    throw new TypeError("profile lifecycle base directory is invalid");
  }

  const resources = exactObject(
    input.resources,
    ["cpuSeconds", "memoryBytes"],
    "profile.lifecycle.resources",
  );
  const memoryBytes = safeInteger(
    resources.memoryBytes,
    "profile.lifecycle.resources.memoryBytes",
    64 * 1024 * 1024,
    64 * 1024 * 1024 * 1024,
  );
  const cpuSeconds = safeInteger(
    resources.cpuSeconds,
    "profile.lifecycle.resources.cpuSeconds",
    1,
    24 * 60 * 60,
  );

  const postSessionHook = exactObject(
    input.postSessionHook,
    ["digest", "generation"],
    "profile.lifecycle.postSessionHook",
  );
  const hookDigest = safeString(
    postSessionHook.digest,
    "profile.lifecycle.postSessionHook.digest",
    80,
  ).toLowerCase();
  if (!SHA256_RE.test(hookDigest)) {
    throw new TypeError("profile lifecycle post-session hook is invalid");
  }
  const hookGeneration = safeInteger(
    postSessionHook.generation,
    "profile.lifecycle.postSessionHook.generation",
    1,
    generation,
  );
  if (hookGeneration !== leaseGeneration) {
    throw new TypeError("profile lifecycle post-session hook fence is stale");
  }

  return Object.freeze({
    runnerId: safeName(input.runnerId, "profile.lifecycle.runnerId"),
    authorityFile: path.resolve(
      safePath(input.authorityFile, "profile.lifecycle.authorityFile"),
    ),
    state,
    generation,
    lease: Object.freeze({
      id: safeName(lease.id, "profile.lifecycle.lease.id"),
      generation: leaseGeneration,
      expiresAt: leaseExpiresAt,
    }),
    proxyAuthority: Object.freeze({
      id: safeName(proxyAuthority.id, "profile.lifecycle.proxyAuthority.id"),
      revision: safeInteger(
        proxyAuthority.revision,
        "profile.lifecycle.proxyAuthority.revision",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      issuedAt: proxyIssuedAt,
      expiresAt: proxyExpiresAt,
    }),
    baseDir: Object.freeze({ path: baseDirPath, writableRequired: true }),
    resources: Object.freeze({ cpuSeconds, memoryBytes }),
    postSessionHook: Object.freeze({
      digest: hookDigest,
      generation: hookGeneration,
    }),
  });
}

function normalizeTransport(target, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("profile.transport must be an object");
  }
  if (target === "local") {
    const input = exactObject(
      value,
      ["home", "securityHome"],
      "profile.transport",
    );
    return Object.freeze({
      home: path.resolve(safePath(input.home, "profile.transport.home")),
      securityHome: path.resolve(
        safePath(input.securityHome, "profile.transport.securityHome"),
      ),
    });
  }
  if (target === "wsl") {
    const input = exactObject(value, ["distro"], "profile.transport");
    return Object.freeze({
      distro: safeName(input.distro, "profile.transport.distro"),
    });
  }
  if (target === "container") {
    const input = exactObject(value, ["container"], "profile.transport");
    return Object.freeze({
      container: safeName(input.container, "profile.transport.container"),
    });
  }
  const allowed = new Set([
    "host",
    "user",
    "port",
    "identityFile",
    "knownHostsFile",
    "knownHostsDigest",
  ]);
  if (
    Object.keys(value).some((field) => !allowed.has(field)) ||
    ![
      "host",
      "user",
      "port",
      "identityFile",
      "knownHostsFile",
      "knownHostsDigest",
    ].every((field) => Object.hasOwn(value, field))
  ) {
    throw new TypeError("profile.transport has an invalid schema");
  }
  const host = safeName(value.host, "profile.transport.host");
  const user =
    value.user == null ? null : safeName(value.user, "profile.transport.user");
  const port = Number(value.port);
  const identityFile =
    value.identityFile == null
      ? null
      : path.resolve(
          safePath(value.identityFile, "profile.transport.identityFile"),
        );
  const knownHostsFile = path.resolve(
    safePath(value.knownHostsFile, "profile.transport.knownHostsFile"),
  );
  const knownHostsDigest = safeString(
    value.knownHostsDigest,
    "profile.transport.knownHostsDigest",
    80,
  ).toLowerCase();
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !SHA256_RE.test(knownHostsDigest)
  ) {
    throw new TypeError("profile.transport SSH authority is invalid");
  }
  return Object.freeze({
    host,
    user,
    port,
    identityFile,
    knownHostsFile,
    knownHostsDigest,
  });
}

export function normalizeExecutionLocationProfile(value) {
  const baseFields = [
    "schema",
    "id",
    "target",
    "evidenceId",
    "cliCommand",
    "cwd",
    "transport",
    "expected",
    "sessionStore",
  ];
  const suppliedDigest = value?.profileDigest;
  const isV2 = value?.schema === EXECUTION_LOCATION_PROFILE_SCHEMA_V2;
  const input = exactObject(
    value,
    suppliedDigest == null
      ? isV2
        ? [...baseFields, "lifecycle"]
        : baseFields
      : isV2
        ? [...baseFields, "lifecycle", "profileDigest"]
        : [...baseFields, "profileDigest"],
    "execution location profile",
  );
  if (
    input.schema !== EXECUTION_LOCATION_PROFILE_SCHEMA &&
    input.schema !== EXECUTION_LOCATION_PROFILE_SCHEMA_V2
  ) {
    throw new TypeError(
      `execution location profile must use ${EXECUTION_LOCATION_PROFILE_SCHEMA} or ${EXECUTION_LOCATION_PROFILE_SCHEMA_V2}`,
    );
  }
  if (containsSecret(JSON.stringify(input))) {
    throw new TypeError(
      "execution location profile contains secret-shaped data",
    );
  }
  const target = safeName(input.target, "profile.target", 32).toLowerCase();
  if (!PROFILE_TARGETS.has(target)) {
    throw new TypeError(
      "profile.target is not supported by the target launcher",
    );
  }
  const expected = exactObject(
    input.expected,
    ["platform", "arch", "cliVersion", "gitCommit", "tools"],
    "profile.expected",
  );
  const gitCommit = safeName(
    expected.gitCommit,
    "profile.expected.gitCommit",
    64,
  ).toLowerCase();
  if (!COMMIT_RE.test(gitCommit)) {
    throw new TypeError("profile.expected.gitCommit is invalid");
  }
  const cwd = safePath(input.cwd, "profile.cwd");
  const profile = {
    schema: input.schema,
    id: safeName(input.id, "profile.id"),
    target,
    evidenceId: safeName(input.evidenceId, "profile.evidenceId"),
    cliCommand: safePath(input.cliCommand, "profile.cliCommand"),
    cwd,
    transport: normalizeTransport(target, input.transport),
    expected: Object.freeze({
      platform: safeName(expected.platform, "profile.expected.platform", 64),
      arch: safeName(expected.arch, "profile.expected.arch", 64),
      cliVersion: safeName(
        expected.cliVersion,
        "profile.expected.cliVersion",
        64,
      ),
      gitCommit,
      tools: Object.freeze(normalizeTools(expected.tools)),
    }),
    sessionStore: normalizeSessionStore(input.sessionStore),
    ...(isV2
      ? { lifecycle: normalizeRunnerLifecycle(input.lifecycle, cwd) }
      : {}),
  };
  const profileDigest = digest(
    isV2
      ? "chainlesschain.execution-location.profile.v2\0"
      : "chainlesschain.execution-location.profile.v1\0",
    profile,
  );
  if (suppliedDigest != null && suppliedDigest !== profileDigest) {
    throw new TypeError("execution location profile digest is invalid");
  }
  return Object.freeze({
    ...profile,
    profileDigest,
  });
}

function readBoundedRegularFile(filePath, maxBytes, label, runtimeFs = fs) {
  return withTrustedFileParentSync(
    runtimeFs,
    path.resolve(filePath),
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > maxBytes
      ) {
        throw new Error(
          `${label} must be a bounded, regular, single-link file`,
        );
      }
      let descriptor;
      try {
        descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(`${label} identity changed while opening`);
        }
        const bytes = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          bytes.length <= 0 ||
          bytes.length > maxBytes ||
          !sameFileStatIdentity(opened, after)
        ) {
          throw new Error(`${label} changed while reading`);
        }
        return bytes;
      } finally {
        if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
      }
    },
  );
}

export function readExecutionLocationProfile(filePath, deps = {}) {
  const bytes = readBoundedRegularFile(
    filePath,
    MAX_PROFILE_BYTES,
    "execution location profile",
    deps.fs || fs,
  );
  let parsed;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("execution location profile is not strict UTF-8 JSON");
  }
  return normalizeExecutionLocationProfile(parsed);
}

function quotePosix(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`;
}

function targetLifecycleEnvironment(profile, deps = {}) {
  if (!profile.lifecycle) return Object.freeze([]);
  const now = Number((deps.now || Date.now)());
  const lifecycle = profile.lifecycle;
  (
    deps.assertRunnerLifecycleAuthority ||
    assertExecutionLocationRunnerLeaseAuthority
  )(lifecycle, profile.target, { now: () => now });
  const leaseExpiry = Date.parse(lifecycle.lease.expiresAt);
  const proxyIssuedAt = Date.parse(lifecycle.proxyAuthority.issuedAt);
  const proxyExpiry = Date.parse(lifecycle.proxyAuthority.expiresAt);
  if (
    !Number.isFinite(now) ||
    leaseExpiry <= now ||
    proxyIssuedAt > now + 30_000 ||
    now - proxyIssuedAt > MAX_PROXY_AUTHORITY_AGE_MS ||
    proxyExpiry <= now
  ) {
    throw new Error("execution location lease or proxy authority is stale");
  }
  const values = {
    CC_EXECUTION_LOCATION_BASE_DIR: lifecycle.baseDir.path,
    CC_EXECUTION_LOCATION_CPU_SECONDS: String(lifecycle.resources.cpuSeconds),
    CC_EXECUTION_LOCATION_GENERATION: String(lifecycle.generation),
    CC_EXECUTION_LOCATION_LEASE_GENERATION: String(lifecycle.lease.generation),
    CC_EXECUTION_LOCATION_LEASE_ID: lifecycle.lease.id,
    CC_EXECUTION_LOCATION_LEASE_EXPIRES_AT: lifecycle.lease.expiresAt,
    CC_EXECUTION_LOCATION_MEMORY_BYTES: String(lifecycle.resources.memoryBytes),
    CC_EXECUTION_LOCATION_POST_SESSION_HOOK_DIGEST:
      lifecycle.postSessionHook.digest,
    CC_EXECUTION_LOCATION_POST_SESSION_HOOK_GENERATION: String(
      lifecycle.postSessionHook.generation,
    ),
    CC_EXECUTION_LOCATION_PROXY_AUTHORITY_ID: lifecycle.proxyAuthority.id,
    CC_EXECUTION_LOCATION_PROXY_EXPIRES_AT: lifecycle.proxyAuthority.expiresAt,
    CC_EXECUTION_LOCATION_PROXY_ISSUED_AT: lifecycle.proxyAuthority.issuedAt,
    CC_EXECUTION_LOCATION_PROXY_REVISION: String(
      lifecycle.proxyAuthority.revision,
    ),
    CC_EXECUTION_LOCATION_RUNNER_ID: lifecycle.runnerId,
    CC_EXECUTION_LOCATION_STATE: lifecycle.state,
  };
  return Object.freeze(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  );
}

function localTargetEnvironment(profile, lifecycleEnvironment) {
  const inherited = {};
  for (const key of [
    "ComSpec",
    "FORCE_COLOR",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]) {
    if (typeof process.env[key] === "string") inherited[key] = process.env[key];
  }
  return Object.freeze({
    ...inherited,
    APPDATA: path.join(profile.transport.home, "AppData", "Roaming"),
    // `home` is the target account's home directory, not the application
    // state directory. Pointing CHAINLESSCHAIN_HOME at it makes the
    // owner-only guard (correctly) refuse to repair a broad user home on
    // Windows. Keep all CLI state beneath a dedicated child directory.
    CHAINLESSCHAIN_HOME: path.join(profile.transport.home, ".chainlesschain"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: profile.transport.securityHome,
    FORCE_COLOR: "0",
    HOME: profile.transport.home,
    LOCALAPPDATA: path.join(profile.transport.home, "AppData", "Local"),
    NO_COLOR: "1",
    USERPROFILE: profile.transport.home,
    ...Object.fromEntries(
      lifecycleEnvironment.map((entry) => {
        const separator = entry.indexOf("=");
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    ),
  });
}

function isLocalSessionPrepare(cliArgs) {
  return (
    cliArgs[0] === "session" &&
    cliArgs[1] === "location" &&
    cliArgs[2] === "prepare" &&
    typeof cliArgs[3] === "string"
  );
}

/**
 * Materialize the exact durable directories required by a Local replica
 * handoff before launching its restricted Windows target process.  The target
 * is deliberately allowed to write only within these target-owned roots, but
 * starting one PowerShell ACL repair per directory under a restricted token
 * can consume the entire bounded target command window.  Create and repair
 * the fixed tree in one host-side batch, then let the target verify and use
 * the already-private paths.
 *
 * @param {Object} profile
 * @param {string[]} cliArgs
 * @param {Object} deps
 */
export function prepareLocalTargetState(profile, cliArgs, deps = {}) {
  if (!isLocalSessionPrepare(cliArgs)) return null;
  const sessionId = safeName(
    cliArgs[3],
    "Local target replica session id",
    1024,
  );
  const stateHome = path.join(profile.transport.home, ".chainlesschain");
  const antiRollbackDirectory = getSessionAntiRollbackDirectory({
    homeDir: stateHome,
    anchorBase: profile.transport.securityHome,
  });
  const sessionDigest = createHash("sha256").update(sessionId).digest("hex");
  const directories = [
    stateHome,
    path.join(stateHome, "sessions"),
    profile.transport.securityHome,
    path.join(profile.transport.securityHome, "sessions-v1"),
    antiRollbackDirectory,
    path.join(antiRollbackDirectory, "namespace"),
    path.join(antiRollbackDirectory, "records"),
    path.join(antiRollbackDirectory, "records", sessionDigest.slice(0, 2)),
  ];
  const uniqueDirectories = [...new Set(directories)];
  const ensure = deps.ensurePrivateDirectory || ensurePrivateDirectory;
  const repair = deps.repairPrivatePaths || repairPrivatePaths;
  const platform = deps.platform || process.platform;
  for (const directory of uniqueDirectories) {
    ensure(
      directory,
      platform === "win32"
        ? { applyWindowsAcl: false, failIfUnavailable: true }
        : { failIfUnavailable: true },
    );
  }
  if (platform === "win32") {
    repair(uniqueDirectories, { platform: "win32" });
  }
  return Object.freeze({
    stateHome,
    antiRollbackDirectory,
    directories: Object.freeze(uniqueDirectories),
  });
}

function materializeKnownHostsAuthority(bytes, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const root = runtimeFs.mkdtempSync(
    path.join(deps.tmpdir || tmpdir(), "cc-target-known-hosts-"),
  );
  const authorityPath = path.join(root, "known_hosts");
  let descriptor;
  try {
    descriptor = runtimeFs.openSync(
      authorityPath,
      runtimeFs.constants.O_CREAT |
        runtimeFs.constants.O_EXCL |
        runtimeFs.constants.O_WRONLY,
      0o600,
    );
    runtimeFs.writeFileSync(descriptor, bytes);
    runtimeFs.fsyncSync(descriptor);
  } catch (error) {
    try {
      runtimeFs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Preserve the original materialization failure.
    }
    throw error;
  } finally {
    if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
  }
  return Object.freeze({
    path: authorityPath,
    cleanup: () => runtimeFs.rmSync(root, { recursive: true, force: true }),
  });
}

/**
 * A brokered Local target cannot reliably receive a source-side stdin pipe on
 * Windows: the restricted-token helper owns the process boundary. Stage the
 * bounded replica beneath the already owner-only target state tree instead of
 * using the source process temporary directory, which the target is not
 * authorized to read.
 */
function materializeLocalTargetInput(profile, input, deps = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || "");
  if (bytes.length === 0 || bytes.length > MAX_REPLICA_BYTES) {
    throw new Error("local target input is empty or exceeds its byte limit");
  }
  const runtimeFs = deps.fs || fs;
  const root = runtimeFs.mkdtempSync(
    path.join(profile.transport.home, ".chainlesschain", "target-input-"),
  );
  const inputPath = path.join(root, "stdin.bin");
  let descriptor;
  try {
    descriptor = runtimeFs.openSync(
      inputPath,
      runtimeFs.constants.O_CREAT |
        runtimeFs.constants.O_EXCL |
        runtimeFs.constants.O_WRONLY,
      0o600,
    );
    runtimeFs.writeFileSync(descriptor, bytes);
    runtimeFs.fsyncSync(descriptor);
  } catch (error) {
    try {
      runtimeFs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Preserve the original materialization failure.
    }
    throw error;
  } finally {
    if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
  }
  return Object.freeze({
    path: inputPath,
    cleanup: () => runtimeFs.rmSync(root, { recursive: true, force: true }),
  });
}

function targetInvocation(profile, cliArgs, deps = {}, options = {}) {
  const lifecycleEnvironment = targetLifecycleEnvironment(profile, deps);
  if (profile.target === "local") {
    if (!path.isAbsolute(profile.cliCommand)) {
      throw new Error("Local target CLI entry must be an absolute path");
    }
    if (!profile.lifecycle) {
      throw new Error("Local target launch requires a lifecycle profile");
    }
    if (isLocalSessionPrepare(cliArgs)) {
      // Injected spawnSync calls model a target transport in unit tests. They
      // must not mutate a caller's host filesystem merely to exercise argv
      // validation; production always takes the authenticated bootstrap path.
      const bootstrap =
        deps.prepareLocalTargetState ||
        (deps.spawnSync ? null : prepareLocalTargetState);
      bootstrap?.(profile, cliArgs, deps);
    }
    if (options.input != null && !isLocalSessionPrepare(cliArgs)) {
      throw new Error(
        "local target input is only supported for session prepare",
      );
    }
    const inputAuthority =
      options.input == null
        ? null
        : materializeLocalTargetInput(profile, options.input, deps);
    return Object.freeze({
      file: deps.nodeCommand || process.execPath,
      args: Object.freeze([
        LOCAL_TARGET_SUPERVISOR,
        "--cwd",
        profile.cwd,
        "--cpu-seconds",
        String(profile.lifecycle.resources.cpuSeconds),
        "--memory-bytes",
        String(profile.lifecycle.resources.memoryBytes),
        "--entry",
        profile.cliCommand,
        ...(inputAuthority === null
          ? []
          : ["--stdin-file", inputAuthority.path]),
        "--",
        ...cliArgs,
      ]),
      spawnOptions: Object.freeze({
        cwd: profile.cwd,
        env: localTargetEnvironment(profile, lifecycleEnvironment),
      }),
      inputHandled: inputAuthority !== null,
      cleanup: inputAuthority?.cleanup || null,
    });
  }
  if (profile.target === "wsl") {
    if ((deps.platform || process.platform) !== "win32") {
      throw new Error("WSL target launch requires a Windows host");
    }
    return Object.freeze({
      file: "wsl.exe",
      args: Object.freeze([
        "--distribution",
        profile.transport.distro,
        "--cd",
        profile.cwd,
        "--exec",
        ...(lifecycleEnvironment.length > 0
          ? ["env", ...lifecycleEnvironment]
          : []),
        profile.cliCommand,
        ...cliArgs,
      ]),
      cleanup: null,
    });
  }
  if (profile.target === "container") {
    return Object.freeze({
      file: "docker",
      args: Object.freeze([
        "exec",
        ...(options.input == null ? [] : ["-i"]),
        "--workdir",
        profile.cwd,
        ...lifecycleEnvironment.flatMap((entry) => ["--env", entry]),
        profile.transport.container,
        profile.cliCommand,
        ...cliArgs,
      ]),
      cleanup: null,
    });
  }
  const transport = profile.transport;
  const knownHostsBytes = readBoundedRegularFile(
    transport.knownHostsFile,
    MAX_PROFILE_BYTES,
    "SSH known-hosts authority",
    deps.fs || fs,
  );
  const actualKnownHostsDigest = `sha256:${createHash("sha256")
    .update(knownHostsBytes)
    .digest("hex")}`;
  if (actualKnownHostsDigest !== transport.knownHostsDigest) {
    throw new Error("SSH known-hosts authority digest mismatch");
  }
  const knownHostsAuthority = materializeKnownHostsAuthority(
    knownHostsBytes,
    deps,
  );
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "NumberOfPasswordPrompts=0",
    "-o",
    "ConnectTimeout=10",
    "-o",
    `UserKnownHostsFile=${knownHostsAuthority.path}`,
    "-p",
    String(transport.port),
  ];
  if (transport.identityFile) {
    args.push("-o", "IdentitiesOnly=yes", "-i", transport.identityFile);
  }
  const target = transport.user
    ? `${transport.user}@${transport.host}`
    : transport.host;
  args.push(
    target,
    `cd ${quotePosix(profile.cwd)} && ${[
      ...(lifecycleEnvironment.length > 0
        ? ["env", ...lifecycleEnvironment]
        : []),
      profile.cliCommand,
      ...cliArgs,
    ]
      .map(quotePosix)
      .join(" ")}`,
  );
  return Object.freeze({
    file: "ssh",
    args: Object.freeze(args),
    cleanup: knownHostsAuthority.cleanup,
  });
}

function runTargetCommand(profile, cliArgs, deps = {}, options = {}) {
  const invocation = targetInvocation(profile, cliArgs, deps, options);
  const spawnSync =
    deps.spawnSync ||
    ((file, args, spawnOptions) =>
      executionBroker.spawnSync(file, args, spawnOptions));
  try {
    const maxBuffer = Number(options.maxBuffer ?? MAX_PROBE_BYTES);
    if (
      !Number.isSafeInteger(maxBuffer) ||
      maxBuffer < 1 ||
      maxBuffer > MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES
    ) {
      throw new Error("target command output boundary is invalid");
    }
    const timeoutMs = Number(
      options.timeoutMs ?? DEFAULT_TARGET_COMMAND_TIMEOUT_MS,
    );
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_TARGET_COMMAND_TIMEOUT_MS
    ) {
      throw new Error("target command timeout boundary is invalid");
    }
    const result = spawnSync(invocation.file, invocation.args, {
      origin: "execution-location:target",
      scope: "execution-location",
      policy: "allow",
      shell: false,
      encoding: "utf8",
      timeout: options.interactive ? undefined : timeoutMs,
      maxBuffer: options.interactive ? undefined : maxBuffer,
      ...(options.input == null || invocation.inputHandled
        ? {}
        : { input: options.input }),
      stdio: options.interactive
        ? "inherit"
        : [
            options.input == null || invocation.inputHandled
              ? "ignore"
              : "pipe",
            "pipe",
            "pipe",
          ],
      ...(invocation.spawnOptions || {}),
    });
    if (result?.error) throw result.error;
    if (!result || result.status !== 0) {
      const error = new Error(
        `target command failed with status ${result?.status ?? "unknown"}`,
      );
      error.code = "CC_EXECUTION_LOCATION_TARGET_COMMAND_FAILED";
      throw error;
    }
    return options.interactive ? null : result.stdout;
  } finally {
    invocation.cleanup?.();
  }
}

function parseTargetProjection(raw, label) {
  const bytes = Buffer.byteLength(String(raw || ""), "utf8");
  if (bytes <= 0 || bytes > MAX_PROBE_BYTES) {
    throw new Error(`${label} output is empty or exceeds its byte limit`);
  }
  let projection;
  try {
    projection = JSON.parse(String(raw));
  } catch {
    throw new Error(`${label} output is not one exact JSON object`);
  }
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    containsSecret(JSON.stringify(projection))
  ) {
    throw new Error(`${label} output is invalid or secret-bearing`);
  }
  return projection;
}

function preflightExecutionLocationTarget(profile, deps = {}) {
  if (!profile.lifecycle) return null;
  const raw = runTargetCommand(
    profile,
    ["session", "location", "target-preflight", "--json"],
    deps,
  );
  const receipt = exactObject(
    parseTargetProjection(raw, "target lifecycle preflight"),
    [
      "schema",
      "runnerId",
      "state",
      "generation",
      "lease",
      "proxyAuthority",
      "baseDir",
      "resources",
      "postSessionHook",
      "secretTransferCount",
      "receiptDigest",
    ],
    "target lifecycle preflight",
  );
  const lifecycle = profile.lifecycle;
  const reportedEnforcement = receipt.resources?.enforcement;
  const expectedEnforcement =
    profile.target === "local"
      ? "target-supervisor"
      : reportedEnforcement === "posix-rlimit" ||
          reportedEnforcement === "target-supervisor"
        ? reportedEnforcement
        : "posix-rlimit";
  const material = {
    schema: "cc-execution-location-target-preflight/v1",
    runnerId: lifecycle.runnerId,
    state: lifecycle.state,
    generation: lifecycle.generation,
    lease: {
      id: lifecycle.lease.id,
      generation: lifecycle.lease.generation,
      expiresAt: lifecycle.lease.expiresAt,
    },
    proxyAuthority: {
      id: lifecycle.proxyAuthority.id,
      revision: lifecycle.proxyAuthority.revision,
      issuedAt: lifecycle.proxyAuthority.issuedAt,
      expiresAt: lifecycle.proxyAuthority.expiresAt,
    },
    baseDir: {
      digest: digest(
        "chainlesschain.execution-location.base-dir.v1\0",
        lifecycle.baseDir.path,
      ),
      writable: true,
    },
    resources: {
      cpuSeconds: lifecycle.resources.cpuSeconds,
      memoryBytes: lifecycle.resources.memoryBytes,
      observedCpuSeconds: Number(receipt.resources?.observedCpuSeconds),
      observedMemoryBytes: Number(receipt.resources?.observedMemoryBytes),
      targetEnforced: true,
      enforcement: expectedEnforcement,
    },
    postSessionHook: {
      digest: lifecycle.postSessionHook.digest,
      generation: lifecycle.postSessionHook.generation,
    },
    secretTransferCount: 0,
  };
  const expectedReceiptDigest = digest(
    "chainlesschain.execution-location.target-preflight.v1\0",
    material,
  );
  if (
    canonicalJson(receipt, "targetLifecyclePreflight") !==
      canonicalJson(
        { ...material, receiptDigest: expectedReceiptDigest },
        "expectedTargetLifecyclePreflight",
      ) ||
    material.resources.observedCpuSeconds < 1 ||
    material.resources.observedCpuSeconds > lifecycle.resources.cpuSeconds ||
    material.resources.observedMemoryBytes < 1 ||
    material.resources.observedMemoryBytes > lifecycle.resources.memoryBytes
  ) {
    throw new Error("target lifecycle preflight does not match the profile");
  }
  return Object.freeze(receipt);
}

export function probeExecutionLocationTargetPreflight(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  if (!profile.lifecycle) {
    throw new TypeError("target preflight requires a v2 lifecycle profile");
  }
  return preflightExecutionLocationTarget(profile, deps);
}

export function probeExecutionLocationTargetResourceLimit(
  input = {},
  deps = {},
) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  if (!profile.lifecycle) {
    throw new TypeError(
      "resource enforcement probe requires a v2 lifecycle profile",
    );
  }
  const kind = input.kind;
  if (kind !== "cpu" && kind !== "memory") {
    throw new TypeError(
      "resource enforcement probe kind must be cpu or memory",
    );
  }
  const preflight = preflightExecutionLocationTarget(profile, deps);
  const invocation = targetInvocation(
    profile,
    ["session", "location", "resource-probe", kind],
    deps,
  );
  const spawnSync =
    deps.spawnSync ||
    ((file, args, spawnOptions) =>
      executionBroker.spawnSync(file, args, spawnOptions));
  let result;
  try {
    result = spawnSync(invocation.file, invocation.args, {
      origin: "execution-location:target-resource-probe",
      scope: "execution-location",
      policy: "allow",
      shell: false,
      encoding: "utf8",
      timeout: Math.min(
        60_000,
        (profile.lifecycle.resources.cpuSeconds + 30) * 1000,
      ),
      maxBuffer: MAX_PROBE_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      ...(invocation.spawnOptions || {}),
    });
  } finally {
    invocation.cleanup?.();
  }
  if (result?.error) throw result.error;
  const expectedMarker = `CC_EXECUTION_LOCATION_RESOURCE_PROBE_ARMED:${kind}`;
  const status = Number(result?.status);
  const signal = result?.signal == null ? null : String(result.signal);
  const signalTerminated = new Set(["SIGABRT", "SIGKILL", "SIGXCPU"]).has(
    signal,
  );
  const exitTerminated = [134, 137, 152].includes(status);
  if (
    !result ||
    String(result.stdout || "").trim() !== expectedMarker ||
    (!signalTerminated && !exitTerminated)
  ) {
    throw new Error("target workload did not terminate at its resource limit");
  }
  const material = {
    schema: "cc-execution-location-target-resource-enforcement/v1",
    target: profile.target,
    kind,
    profileDigest: profile.profileDigest,
    preflightReceiptDigest: preflight.receiptDigest,
    runnerId: profile.lifecycle.runnerId,
    runnerGeneration: profile.lifecycle.generation,
    leaseId: profile.lifecycle.lease.id,
    leaseGeneration: profile.lifecycle.lease.generation,
    limit:
      kind === "cpu"
        ? profile.lifecycle.resources.cpuSeconds
        : profile.lifecycle.resources.memoryBytes,
    enforcementScope: "target-workload",
    termination: signalTerminated
      ? { kind: "signal", value: signal }
      : { kind: "exit-status", value: status },
    secretTransferCount: 0,
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-resource-enforcement.v1\0",
      material,
    ),
  });
}

export function probeExecutionLocationTargetSigtermDrain(
  input = {},
  deps = {},
) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  if (!profile.lifecycle || profile.lifecycle.state !== "accepting") {
    throw new TypeError("SIGTERM drain probe requires an accepting v2 profile");
  }
  const preflight = preflightExecutionLocationTarget(profile, deps);
  const raw = runTargetCommand(
    profile,
    ["session", "location", "sigterm-drain-probe", "--json"],
    deps,
  );
  const receipt = exactObject(
    parseTargetProjection(raw, "target SIGTERM drain probe"),
    [
      "schema",
      "runnerId",
      "signal",
      "before",
      "after",
      "lease",
      "preflightReceiptDigest",
      "signalDeliveryCount",
      "postSignalLeaseAcceptanceCount",
      "secretTransferCount",
      "receiptDigest",
    ],
    "target SIGTERM drain probe",
  );
  const lifecycle = profile.lifecycle;
  const material = {
    schema: "cc-execution-location-target-sigterm-drain/v1",
    runnerId: lifecycle.runnerId,
    signal: "SIGTERM",
    before: {
      state: "accepting",
      generation: lifecycle.generation,
      accepting: true,
    },
    after: {
      state: "draining",
      generation: lifecycle.generation + 1,
      accepting: false,
    },
    lease: {
      id: lifecycle.lease.id,
      generation: lifecycle.lease.generation,
      expiresAt: lifecycle.lease.expiresAt,
      continued: true,
    },
    preflightReceiptDigest: preflight.receiptDigest,
    signalDeliveryCount: 1,
    postSignalLeaseAcceptanceCount: 0,
    secretTransferCount: 0,
  };
  const expected = {
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-sigterm-drain.v1\0",
      material,
    ),
  };
  if (
    canonicalJson(receipt, "targetSigtermDrain") !==
    canonicalJson(expected, "expectedTargetSigtermDrain")
  ) {
    throw new Error("target SIGTERM drain receipt does not match the profile");
  }
  return Object.freeze(receipt);
}

function validateProfileHandoff(profile, handoff) {
  if (!handoff?.allowed) {
    throw new Error("execution location handoff is not allowed");
  }
  if (
    handoff.target?.location !== profile.target ||
    handoff.target?.evidenceId !== profile.evidenceId
  ) {
    throw new Error("execution location profile does not match handoff target");
  }
  if (
    handoff.transfer?.git?.baseCommit !== profile.expected.gitCommit ||
    handoff.target?.dataBoundary?.root !== profile.cwd
  ) {
    throw new Error("execution location profile source or boundary drifted");
  }
  if (profile.sessionStore) {
    if (
      profile.sessionStore.targetSessionId !== handoff.session?.sessionId ||
      profile.sessionStore.headHash !== handoff.session?.headHash ||
      profile.sessionStore.eventCount !== handoff.session?.eventCount
    ) {
      throw new Error("target session-store authority does not match handoff");
    }
  }
}

function validateCurrentProjection(profile, rawProjection) {
  if (
    rawProjection.schema !== SESSION_LOCATION_AUTHORITY_SCHEMA ||
    rawProjection.authority !== "current-process-observation"
  ) {
    throw new Error("target current-location projection has invalid authority");
  }
  const binding = normalizeExecutionLocationBinding(rawProjection.binding);
  const expected = profile.expected;
  const missingTools = expected.tools.filter(
    (tool) => !binding.runtime.tools.includes(tool),
  );
  if (
    binding.observed !== true ||
    binding.location !== profile.target ||
    binding.source.cwd !== profile.cwd ||
    binding.source.git.commit !== expected.gitCommit ||
    binding.runtime.platform !== expected.platform ||
    binding.runtime.arch !== expected.arch ||
    binding.runtime.cliVersion !== expected.cliVersion ||
    missingTools.length > 0
  ) {
    throw new Error("target current-location facts do not match the profile");
  }
  return binding;
}

export function attestExecutionLocationTarget(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const lifecyclePreflight = preflightExecutionLocationTarget(profile, deps);
  const raw = runTargetCommand(
    profile,
    ["session", "location", "current", "--json"],
    deps,
  );
  const current = parseTargetProjection(raw, "target current-location probe");
  const binding = validateCurrentProjection(profile, current);
  const attestation = createExecutionLocationTargetAttestation({
    profileDigest: profile.profileDigest,
    sourceSessionId: input.handoff.session.sessionId,
    sourceHeadHash: input.handoff.session.headHash,
    sourceEventCount: input.handoff.session.eventCount,
    targetEvidenceId: input.handoff.target.evidenceId,
    baseCommit: input.handoff.transfer.git.baseCommit,
    binding,
  });
  if (!lifecyclePreflight) return attestation;
  return Object.freeze({
    ...attestation,
    lifecyclePreflight,
    lifecycleAttestationDigest: digest(
      "chainlesschain.execution-location.lifecycle-attestation.v1\0",
      {
        attestationDigest: attestation.attestationDigest,
        preflightReceiptDigest: lifecyclePreflight.receiptDigest,
        profileDigest: profile.profileDigest,
      },
    ),
  });
}

function verifyTargetSessionStore(
  profile,
  handoff,
  transfer,
  attestation,
  deps,
) {
  if (!profile.sessionStore) {
    throw new Error("target session-store authority is required for resume");
  }
  const raw = runTargetCommand(
    profile,
    [
      "session",
      "location",
      "show",
      profile.sessionStore.targetSessionId,
      "--json",
    ],
    deps,
  );
  const projection = parseTargetProjection(raw, "target session-store probe");
  const commonMatches =
    projection.schema === SESSION_LOCATION_AUTHORITY_SCHEMA &&
    projection.sessionId === profile.sessionStore.targetSessionId &&
    projection.sessionId === handoff.session.sessionId;
  const replicatedMatches =
    profile.sessionStore.mode === "replicated" &&
    projection.authority === "verified-session-location-handoff" &&
    projection.headHash === transfer.targetHeadHash &&
    projection.eventCount === transfer.targetEventCount &&
    projection.bindingEventHash === transfer.targetHeadHash &&
    projection.bindingEventCount === transfer.targetEventCount &&
    projection.locationHandoff?.handoffId === transfer.handoffId &&
    projection.locationHandoff?.source?.sessionId ===
      handoff.session.sessionId &&
    projection.locationHandoff?.source?.headHash === handoff.session.headHash &&
    projection.locationHandoff?.source?.eventCount ===
      handoff.session.eventCount &&
    projection.locationHandoff?.source?.transcriptDigest ===
      transfer.transcriptDigest &&
    projection.locationHandoff?.target?.profileDigest ===
      profile.profileDigest &&
    projection.locationHandoff?.target?.targetEvidenceId ===
      profile.evidenceId &&
    projection.locationHandoff?.target?.targetFactsDigest ===
      attestation.targetFactsDigest &&
    projection.locationHandoff?.target?.attestationDigest ===
      transfer.attestationDigest;
  const sharedMatches =
    profile.sessionStore.mode === "shared" &&
    projection.authority === "verified-session-start" &&
    projection.headHash === profile.sessionStore.headHash &&
    projection.eventCount === profile.sessionStore.eventCount &&
    projection.headHash === handoff.session.headHash &&
    projection.eventCount === handoff.session.eventCount;
  if (!commonMatches || (!replicatedMatches && !sharedMatches)) {
    throw new Error(
      "target canonical session authority does not match handoff",
    );
  }
  return Object.freeze({
    mode: profile.sessionStore.mode,
    sessionId: projection.sessionId,
    headHash: projection.headHash,
    eventCount: projection.eventCount,
    authority: projection.authority,
    handoffId: projection.locationHandoff?.handoffId ?? null,
  });
}

function transferTargetSessionStore(
  profile,
  handoff,
  attestation,
  transcriptInput,
  deps,
) {
  if (!profile.sessionStore) {
    throw new Error("target session-store authority is required for resume");
  }
  if (profile.sessionStore.mode === "shared") {
    return Object.freeze({
      mode: "shared",
      performed: false,
      installed: false,
      transcriptDigest: null,
      receiptDigest: null,
      handoffId: null,
      targetHeadHash: handoff.session.headHash,
      targetEventCount: handoff.session.eventCount,
      attestationDigest: null,
    });
  }
  const transcriptBytes = Buffer.isBuffer(transcriptInput)
    ? transcriptInput
    : Buffer.from(transcriptInput || "");
  if (transcriptBytes.length === 0) {
    throw new Error("source transcript bytes are required for replication");
  }
  if (transcriptBytes.length > MAX_REPLICA_BYTES) {
    throw new Error(
      `source transcript exceeds ${MAX_REPLICA_BYTES} replica bytes`,
    );
  }
  const transcriptDigest = `sha256:${createHash("sha256")
    .update(transcriptBytes)
    .digest("hex")}`;
  const raw = runTargetCommand(
    profile,
    [
      "session",
      "location",
      "prepare",
      profile.sessionStore.targetSessionId,
      "--expected-head-hash",
      handoff.session.headHash,
      "--expected-event-count",
      String(handoff.session.eventCount),
      "--expected-transcript-digest",
      transcriptDigest,
      "--expected-target-facts-digest",
      attestation.targetFactsDigest,
      "--profile-digest",
      profile.profileDigest,
      "--target-evidence-id",
      profile.evidenceId,
      "--attestation-digest",
      attestation.attestationDigest,
      "--json",
    ],
    deps,
    { input: transcriptBytes, timeoutMs: REPLICA_TRANSFER_TIMEOUT_MS },
  );
  const receipt = parseTargetProjection(
    raw,
    "target session location-handoff receipt",
  );
  exactObject(
    receipt,
    [
      "schema",
      "sessionId",
      "sourceHeadHash",
      "sourceEventCount",
      "transcriptDigest",
      "handoffId",
      "targetHeadHash",
      "targetEventCount",
      "targetFactsDigest",
      "profileDigest",
      "targetEvidenceId",
      "attestationDigest",
      "replicaInstalled",
      "handoffAppended",
      "receiptDigest",
    ],
    "target session location-handoff receipt",
  );
  const receiptMaterial = {
    schema: SESSION_LOCATION_HANDOFF_INSTALL_SCHEMA,
    sessionId: handoff.session.sessionId,
    sourceHeadHash: handoff.session.headHash,
    sourceEventCount: handoff.session.eventCount,
    transcriptDigest,
    handoffId: receipt.handoffId,
    targetHeadHash: receipt.targetHeadHash,
    targetEventCount: handoff.session.eventCount + 1,
    targetFactsDigest: attestation.targetFactsDigest,
    profileDigest: profile.profileDigest,
    targetEvidenceId: profile.evidenceId,
    attestationDigest: receipt.attestationDigest,
    replicaInstalled: receipt.replicaInstalled,
    handoffAppended: receipt.handoffAppended,
  };
  const expectedReceiptDigest = digest(
    "chainlesschain.session-execution-location-handoff-install.v1\0",
    receiptMaterial,
  );
  if (
    receipt.schema !== receiptMaterial.schema ||
    receipt.sessionId !== receiptMaterial.sessionId ||
    receipt.sourceHeadHash !== receiptMaterial.sourceHeadHash ||
    receipt.sourceEventCount !== receiptMaterial.sourceEventCount ||
    receipt.transcriptDigest !== receiptMaterial.transcriptDigest ||
    !SHA256_RE.test(receipt.handoffId || "") ||
    !/^[a-f0-9]{64}$/u.test(receipt.targetHeadHash || "") ||
    receipt.targetEventCount !== receiptMaterial.targetEventCount ||
    receipt.targetFactsDigest !== receiptMaterial.targetFactsDigest ||
    receipt.profileDigest !== receiptMaterial.profileDigest ||
    receipt.targetEvidenceId !== receiptMaterial.targetEvidenceId ||
    // Target prepare records a fresh observedAt, so its attestation digest is
    // expected to differ from the earlier source-side probe. The receipt is
    // rehashed here and the next target `location show` validates that digest
    // against the canonical handoff binding before resume.
    !SHA256_RE.test(receipt.attestationDigest || "") ||
    typeof receipt.replicaInstalled !== "boolean" ||
    typeof receipt.handoffAppended !== "boolean" ||
    receipt.receiptDigest !== expectedReceiptDigest
  ) {
    throw new Error(
      "target session location-handoff receipt does not match source",
    );
  }
  return Object.freeze({
    mode: "replicated",
    performed: true,
    installed: receipt.replicaInstalled,
    handoffAppended: receipt.handoffAppended,
    transcriptDigest,
    handoffId: receipt.handoffId,
    targetHeadHash: receipt.targetHeadHash,
    targetEventCount: receipt.targetEventCount,
    attestationDigest: receipt.attestationDigest,
    receiptDigest: receipt.receiptDigest,
  });
}

function verifySourceAuthorityBeforeResume(handoff, readSourceAuthority) {
  if (typeof readSourceAuthority !== "function") {
    throw new Error("source authority revalidation is required before resume");
  }
  const current = readSourceAuthority();
  if (
    current?.sessionId !== handoff.session?.sessionId ||
    current?.headHash !== handoff.session?.headHash ||
    current?.eventCount !== handoff.session?.eventCount
  ) {
    throw new Error("source session authority changed before target resume");
  }
  return Object.freeze({
    sessionId: current.sessionId,
    headHash: current.headHash,
    eventCount: current.eventCount,
  });
}

function normalizeResultCollectionItem(entry, label) {
  const mediaType = String(entry?.mediaType || "").toLowerCase();
  const filePath = safePath(entry?.path, `${label} path`);
  if (!RESULT_MEDIA_TYPE_RE.test(mediaType)) {
    throw new TypeError(`${label} media type is invalid`);
  }
  return { mediaType, path: filePath };
}

export function createExecutionLocationTargetResultCollectionRequest(
  input = {},
) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  const target = safeName(
    input.target ?? profile.target,
    "result collection target",
    32,
  );
  if (target !== profile.target) {
    throw new TypeError("result collection target does not match profile");
  }
  const requestId = safeName(
    input.requestId,
    "result collection request id",
    128,
  );
  const sessionId = safeName(input.sessionId, "result collection session id");
  const resultId = safeName(input.resultId, "result id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(resultId)) {
    throw new TypeError("result id is invalid");
  }
  const targetFactsDigest = String(
    input.expectedTargetFactsDigest || "",
  ).toLowerCase();
  const handoffId = String(input.expectedHandoffId || "").toLowerCase();
  if (!SHA256_RE.test(targetFactsDigest)) {
    throw new TypeError("expected target facts digest is invalid");
  }
  if (!SHA256_RE.test(handoffId)) {
    throw new TypeError("expected result handoff id is invalid");
  }
  const artifacts = (input.artifacts ?? []).map((entry, index) =>
    normalizeResultCollectionItem(entry, `result artifact ${index}`),
  );
  const evidence = (input.evidence ?? []).map((entry, index) =>
    normalizeResultCollectionItem(entry, `result evidence ${index}`),
  );
  if (artifacts.length + evidence.length > 64) {
    throw new TypeError("result collection item list is invalid");
  }
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_REQUEST_SCHEMA,
    requestId,
    sessionId,
    target,
    profileDigest: profile.profileDigest,
    targetFactsDigest,
    handoffId,
    resultId,
    summaryPath: safePath(input.summaryPath, "result summary path"),
    diffPath: safePath(input.diffPath, "result diff path"),
    artifacts,
    evidence,
  };
  return Object.freeze({
    ...material,
    requestDigest: digest(
      "chainlesschain.execution-location.target-result-collection-request.v1\0",
      material,
    ),
  });
}

export function collectExecutionLocationTargetResult(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const expectedTargetFactsDigest = safeString(
    input.expectedTargetFactsDigest,
    "expected target facts digest",
    80,
  ).toLowerCase();
  if (!SHA256_RE.test(expectedTargetFactsDigest)) {
    throw new Error("expected target facts digest is invalid");
  }
  const sourceBefore = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  const attestation = attestExecutionLocationTarget(
    { profile, handoff: input.handoff },
    deps,
  );
  if (attestation.targetFactsDigest !== expectedTargetFactsDigest) {
    throw new Error("target facts digest changed before result collection");
  }
  const resultId = safeName(input.resultId, "result id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(resultId)) {
    throw new TypeError("result id is invalid");
  }
  const expectedHandoffId = String(input.expectedHandoffId || "");
  if (!SHA256_RE.test(expectedHandoffId)) {
    throw new TypeError("expected result handoff id is invalid");
  }
  const summaryPath = safePath(input.summaryPath, "result summary path");
  const diffPath = safePath(input.diffPath, "result diff path");
  const artifactInput = input.artifacts ?? [];
  const evidenceInput = input.evidence ?? [];
  if (!Array.isArray(artifactInput) || !Array.isArray(evidenceInput)) {
    throw new TypeError("result collection item list is invalid");
  }
  const artifacts = artifactInput.map((entry, index) =>
    normalizeResultCollectionItem(entry, `result artifact ${index}`),
  );
  const evidence = evidenceInput.map((entry, index) =>
    normalizeResultCollectionItem(entry, `result evidence ${index}`),
  );
  if (artifacts.length + evidence.length > 64) {
    throw new TypeError("result collection item list is invalid");
  }
  const request = createExecutionLocationTargetResultCollectionRequest({
    requestId: input.requestId,
    sessionId: input.handoff?.session?.sessionId,
    target: profile.target,
    profile,
    expectedTargetFactsDigest,
    expectedHandoffId,
    resultId,
    summaryPath,
    diffPath,
    artifacts,
    evidence,
  });
  const args = [
    "session",
    "location",
    "result-pack",
    input.handoff.session.sessionId,
    "--result-id",
    resultId,
    "--summary",
    summaryPath,
    "--diff",
    diffPath,
  ];
  for (const entry of artifacts) {
    args.push("--artifact", `${entry.mediaType}=${entry.path}`);
  }
  for (const entry of evidence) {
    args.push("--evidence", `${entry.mediaType}=${entry.path}`);
  }
  args.push("--json");
  const raw = runTargetCommand(profile, args, deps, {
    maxBuffer: MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
  });
  let bundleInput;
  try {
    bundleInput = JSON.parse(String(raw));
  } catch {
    throw new Error("target result bundle output is not one exact JSON object");
  }
  const bundle = normalizeExecutionLocationResultBundle(bundleInput);
  const sourceAfter = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  const verification = verifyExecutionLocationResultBundle({
    bundle,
    sourceAuthority: sourceAfter,
    expectedHandoffId,
  });
  if (
    bundle.session.handoffId !== expectedHandoffId ||
    bundle.session.target.profileDigest !== profile.profileDigest ||
    bundle.session.target.targetEvidenceId !== profile.evidenceId ||
    bundle.session.target.targetFactsDigest !== expectedTargetFactsDigest ||
    sourceBefore.headHash !== sourceAfter.headHash ||
    sourceBefore.eventCount !== sourceAfter.eventCount
  ) {
    throw new Error(
      "target result bundle does not match the accepted handoff authority",
    );
  }
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_SCHEMA,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    resultId,
    target: profile.target,
    profileDigest: profile.profileDigest,
    targetFactsDigest: expectedTargetFactsDigest,
    collectionAttestationDigest: attestation.attestationDigest,
    handoffId: bundle.session.handoffId,
    sourceAuthority: sourceAfter,
    targetHeadHash: bundle.session.target.headHash,
    targetEventCount: bundle.session.target.eventCount,
    bundleDigest: bundle.bundleDigest,
    verificationDigest: verification.verificationDigest,
    applied: false,
    continuity: "single-fixed-command-response",
    gaps: [
      "returned-result-bytes-not-durable",
      "cross-host-concurrent-writer-fencing-not-durable",
      "returned-result-not-applied",
    ],
  };
  return Object.freeze({
    ...material,
    bundle,
    verification,
    collectionDigest: digest(
      "chainlesschain.execution-location.target-result-collection.v1\0",
      material,
    ),
  });
}

export function resumeExecutionLocationTarget(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const attestation = attestExecutionLocationTarget(
    { profile, handoff: input.handoff },
    deps,
  );
  const expectedTargetFactsDigest = safeString(
    input.expectedTargetFactsDigest,
    "expected target facts digest",
    80,
  ).toLowerCase();
  if (
    !SHA256_RE.test(expectedTargetFactsDigest) ||
    expectedTargetFactsDigest !== attestation.targetFactsDigest
  ) {
    throw new Error("target facts digest changed before resume");
  }
  const transfer = transferTargetSessionStore(
    profile,
    input.handoff,
    attestation,
    input.transcriptBytes,
    deps,
  );
  const sessionStore = verifyTargetSessionStore(
    profile,
    input.handoff,
    transfer,
    attestation,
    deps,
  );
  const sourceAuthority = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  runTargetCommand(
    profile,
    ["session", "resume", sessionStore.sessionId],
    deps,
    { interactive: true },
  );
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
    profileDigest: profile.profileDigest,
    attestationDigest: attestation.attestationDigest,
    target: profile.target,
    targetEvidenceId: profile.evidenceId,
    sourceAuthority,
    sessionStore: { ...sessionStore, transfer },
    command: "session-resume",
    exitStatus: 0,
    continuity: "target-process-lifetime",
    gaps: [
      "disconnect-reconnect-not-durable",
      "cross-host-concurrent-writer-fencing-not-durable",
      ...(profile.sessionStore.mode === "shared"
        ? ["shared-session-location-handoff-event-not-anchored"]
        : []),
    ],
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-resume.v1\0",
      material,
    ),
  });
}
