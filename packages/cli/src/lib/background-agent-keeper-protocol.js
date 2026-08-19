import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";

export const BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION = 1;
export const BACKGROUND_AGENT_KEEPER_HELLO = "background-agent-keeper-hello";
export const BACKGROUND_AGENT_KEEPER_READY = "background-agent-keeper-ready";
export const BACKGROUND_AGENT_KEEPER_HEARTBEAT =
  "background-agent-keeper-heartbeat";
export const BACKGROUND_AGENT_KEEPER_ARM = "background-agent-keeper-arm";
export const BACKGROUND_AGENT_KEEPER_ARMED = "background-agent-keeper-armed";
export const BACKGROUND_AGENT_KEEPER_RETIRE = "background-agent-keeper-retire";
export const BACKGROUND_AGENT_KEEPER_RETIRED =
  "background-agent-keeper-retired";
export const BACKGROUND_AGENT_KEEPER_LAUNCH_CLAIM =
  "background-agent-keeper-launch-claim";
export const BACKGROUND_AGENT_KEEPER_HEARTBEAT_INTERVAL_MS = 1_000;
// Do not launch an OS process-identity probe while authenticated application
// heartbeats are fresh. On Windows the cached WMIC/CIM fallback can otherwise
// make 20 keepers synchronously spawn probe helpers together every ten seconds.
export const BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_DELAY_MS = 15_000;
// This application-level fence is a backstop for the rare case where Windows
// retains both the named-pipe handle and an exact process object after worker
// death. Normal death still closes the socket immediately; a stale channel
// gets the delayed PID/start-time probe before this final fence. A 20-worker
// hosted Windows launch has demonstrated
// 37-second scheduling tails, so 15 seconds could kill a live, healthy worker
// while it was merely descheduled. Keep the backstop bounded but above that
// measured contention window.
export const BACKGROUND_AGENT_KEEPER_HEARTBEAT_TIMEOUT_MS = 60_000;

// RETIRE is the only keeper request that performs destructive OS cleanup. Its
// deadline is deliberately independent from the short HELLO/ARM request
// deadline and is derived from every synchronous operation on the longest
// Windows path:
//
//   2 targets * (strict identity + taskkill + cleanup confirmation identity) +
//   2 cleanup-critical persistence retry windows + cleanup confirmation +
//   scheduling margin = 128 seconds.
//
// Keeping these limits in the shared protocol contract prevents either side
// from silently reintroducing the old 10-second client / longer keeper race.
export const BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT = 2;
export const BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS = 10_000;
export const BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS = 5_000;
export const BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS = 10_000;
export const BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_TIMEOUT_MS =
  BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS +
  BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS;
export const BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS = 5_000;
export const BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS =
  3 * BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS;
// A 20-Agent macOS formal run can leave successfully SIGKILLed process groups
// observable for several seconds while launchd reaps their orphaned leaders.
// Two seconds made that bounded kernel/reaper delay look like an escaped tree.
// Ten seconds stays inside the formal observer's 150-second budget while
// retaining a finite fail-closed confirmation window.
export const BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS = 10_000;
export const BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS = 8_000;
export const BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS =
  BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT *
    (BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS +
      2 * BACKGROUND_AGENT_KEEPER_IDENTITY_PROBE_TIMEOUT_MS) +
  2 * BACKGROUND_AGENT_KEEPER_PERSIST_RETRY_TIMEOUT_MS +
  BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS +
  BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS;

export function resolveBackgroundAgentKeeperRetireTimeoutMs(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) {
    return BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS;
  }
  return Math.min(
    BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS,
    Math.max(1, Math.floor(requested)),
  );
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const SAFE_TOKEN = /^[a-f0-9]{64}$/u;
const POSIX_LOCAL_PIPE_DIRECTORY = /^cc-bg[ks]-[a-f0-9]{24}$/u;
const POSIX_LOCAL_PIPE_SOCKET = /^[a-f0-9]{32}\.sock$/u;

// Darwin's sockaddr_un.sun_path has 104 bytes including the trailing NUL.
// Linux allows a few more bytes, but the conservative cross-platform ceiling
// prevents a long state directory from being silently truncated into the same
// endpoint as a concurrent keeper.
export const POSIX_KEEPER_SOCKET_PATH_MAX_BYTES = 103;

function requiredSafeString(value, label, pattern = SAFE_ID) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!pattern.test(normalized)) {
    throw new TypeError(`invalid background agent keeper ${label}`);
  }
  return normalized;
}

function requiredPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`invalid background agent keeper ${label}`);
  }
  return normalized;
}

function requiredTimestamp(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new TypeError(`invalid background agent keeper ${label}`);
  }
  return normalized;
}

export function backgroundAgentKeeperLaunchClaimPath(
  id,
  keeperGeneration,
  directory,
) {
  const safeId = requiredSafeString(id, "id");
  const safeGeneration = requiredSafeString(
    keeperGeneration,
    "keeper generation",
  );
  const requestedDirectory =
    typeof directory === "string" ? directory.trim() : "";
  if (!requestedDirectory || requestedDirectory.includes("\0")) {
    throw new TypeError("invalid background agent keeper state directory");
  }
  const stateDirectory = resolve(requestedDirectory);
  return join(
    stateDirectory,
    `.${safeId}.keeper-${safeGeneration}.launch-claim.json`,
  );
}

export function createBackgroundAgentKeeperLaunchClaim(binding = {}) {
  return Object.freeze({
    type: BACKGROUND_AGENT_KEEPER_LAUNCH_CLAIM,
    protocolVersion: BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION,
    id: requiredSafeString(binding.id, "id"),
    workerGeneration: requiredSafeString(
      binding.workerGeneration,
      "worker generation",
    ),
    keeperGeneration: requiredSafeString(
      binding.keeperGeneration,
      "keeper generation",
    ),
    keeperPid: requiredPositiveInteger(binding.keeperPid, "keeper pid"),
    token: requiredSafeString(binding.token, "token", SAFE_TOKEN),
  });
}

export function matchesBackgroundAgentKeeperLaunchClaim(value, expected = {}) {
  let actual;
  let binding;
  try {
    actual = createBackgroundAgentKeeperLaunchClaim(value);
    binding = createBackgroundAgentKeeperLaunchClaim(expected);
  } catch {
    return false;
  }
  return Object.keys(binding).every((key) => actual[key] === binding[key]);
}

function digestKeeperPath(value, length) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function requiredPosixDirectory(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.includes("\0")) {
    throw new TypeError(`invalid background agent keeper ${label}`);
  }
  return posix.resolve(normalized.replaceAll("\\", "/"));
}

function backgroundAgentPosixPipePath(
  id,
  directory,
  options,
  { candidateSuffix, fallbackPrefix, tooLongMessage },
) {
  const safeId = requiredSafeString(id, "id");
  const stateDirectory = requiredPosixDirectory(directory, "state directory");
  const candidate = posix.join(stateDirectory, `${safeId}${candidateSuffix}`);
  if (
    Buffer.byteLength(candidate, "utf8") <= POSIX_KEEPER_SOCKET_PATH_MAX_BYTES
  ) {
    return candidate;
  }

  // Keep the endpoint inside a private, state-root-specific namespace under
  // the short POSIX /tmp alias. The full directory and id remain collision
  // inputs even though neither long value appears in sockaddr_un.sun_path.
  const uid =
    options.uid ??
    (typeof process.getuid === "function" ? process.getuid() : "unknown");
  const shortTempDirectory = requiredPosixDirectory(
    options.tempDirectory || "/tmp",
    "short temp directory",
  );
  const namespace = digestKeeperPath(`${uid}\0${stateDirectory}`, 24);
  const socketId = digestKeeperPath(safeId, 32);
  const fallback = posix.join(
    shortTempDirectory,
    `${fallbackPrefix}-${namespace}`,
    `${socketId}.sock`,
  );
  if (
    Buffer.byteLength(fallback, "utf8") > POSIX_KEEPER_SOCKET_PATH_MAX_BYTES
  ) {
    throw new Error(tooLongMessage);
  }
  return fallback;
}

export function backgroundAgentKeeperPipePath(id, directory, options = {}) {
  const safeId = requiredSafeString(id, "id");
  const platform = options.platform || process.platform;
  if (platform === "win32") {
    return `\\\\.\\pipe\\cc-bg-keeper-${safeId}`;
  }
  return backgroundAgentPosixPipePath(id, directory, options, {
    candidateSuffix: ".keeper.sock",
    fallbackPrefix: "cc-bgk",
    tooLongMessage: "background agent keeper fallback socket path is too long",
  });
}

export function backgroundAgentSessionPipePath(id, directory, options = {}) {
  const safeId = requiredSafeString(id, "id");
  const platform = options.platform || process.platform;
  if (platform === "win32") {
    return `\\\\.\\pipe\\cc-bg-${safeId}`;
  }
  return backgroundAgentPosixPipePath(id, directory, options, {
    candidateSuffix: ".sock",
    fallbackPrefix: "cc-bgs",
    tooLongMessage: "background agent session fallback socket path is too long",
  });
}

function fallbackLocalPipeDirectory(pipePath) {
  const normalized = posix.resolve(
    String(pipePath || "").replaceAll("\\", "/"),
  );
  const directory = posix.dirname(normalized);
  return POSIX_LOCAL_PIPE_DIRECTORY.test(posix.basename(directory)) &&
    POSIX_LOCAL_PIPE_SOCKET.test(posix.basename(normalized))
    ? directory
    : null;
}

export function prepareBackgroundAgentLocalPipePath(
  pipePath,
  { platform = process.platform } = {},
) {
  if (platform === "win32") return pipePath;
  const directory = fallbackLocalPipeDirectory(pipePath);
  if (!directory) return pipePath;
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stat = lstatSync(directory);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== null && stat.uid !== uid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("background agent socket directory is not private");
  }
  return pipePath;
}

export function cleanupBackgroundAgentLocalPipeDirectory(
  pipePath,
  { platform = process.platform } = {},
) {
  if (platform === "win32") return false;
  const directory = fallbackLocalPipeDirectory(pipePath);
  if (!directory) return false;
  try {
    rmdirSync(directory);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTEMPTY") return false;
    throw error;
  }
}

export function prepareBackgroundAgentKeeperPipePath(pipePath, options) {
  return prepareBackgroundAgentLocalPipePath(pipePath, options);
}

export function cleanupBackgroundAgentKeeperPipeDirectory(pipePath, options) {
  return cleanupBackgroundAgentLocalPipeDirectory(pipePath, options);
}

export function normalizeBackgroundAgentKeeperAuthority(value = {}) {
  return Object.freeze({
    id: requiredSafeString(value.id, "id"),
    workerGeneration: requiredSafeString(
      value.workerGeneration,
      "worker generation",
    ),
  });
}

export function normalizeBackgroundAgentKeeperHello(value = {}) {
  return Object.freeze({
    ...normalizeBackgroundAgentKeeperAuthority(value),
    token: requiredSafeString(value.token, "token", SAFE_TOKEN),
    workerPid: requiredPositiveInteger(value.workerPid, "worker pid"),
  });
}

export function normalizeBackgroundAgentKeeperTurn(value = {}) {
  return Object.freeze({
    ...normalizeBackgroundAgentKeeperAuthority(value),
    turnLaunchToken: requiredSafeString(
      value.turnLaunchToken,
      "turn launch token",
    ),
    attempt: requiredPositiveInteger(value.attempt, "turn attempt"),
    agentPid: requiredPositiveInteger(value.agentPid, "agent pid"),
    agentStartedAt: requiredTimestamp(
      value.agentStartedAt,
      "agent start anchor",
    ),
    agentRuntimePid: requiredPositiveInteger(
      value.agentRuntimePid,
      "agent runtime pid",
    ),
    agentRuntimeStartedAt: requiredTimestamp(
      value.agentRuntimeStartedAt,
      "agent runtime start anchor",
    ),
  });
}

export function sameBackgroundAgentKeeperTurn(left, right) {
  let normalizedLeft;
  let normalizedRight;
  try {
    normalizedLeft = normalizeBackgroundAgentKeeperTurn(left);
    normalizedRight = normalizeBackgroundAgentKeeperTurn(right);
  } catch {
    return false;
  }
  return Object.keys(normalizedLeft).every(
    (key) => normalizedLeft[key] === normalizedRight[key],
  );
}

export function createBackgroundAgentKeeperMessage(type, payload = {}) {
  return Object.freeze({
    type,
    protocolVersion: BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION,
    ...payload,
  });
}
