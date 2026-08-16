import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { posix } from "node:path";

export const BACKGROUND_AGENT_KEEPER_PROTOCOL_VERSION = 1;
export const BACKGROUND_AGENT_KEEPER_HELLO = "background-agent-keeper-hello";
export const BACKGROUND_AGENT_KEEPER_READY = "background-agent-keeper-ready";
export const BACKGROUND_AGENT_KEEPER_ARM = "background-agent-keeper-arm";
export const BACKGROUND_AGENT_KEEPER_ARMED = "background-agent-keeper-armed";
export const BACKGROUND_AGENT_KEEPER_RETIRE = "background-agent-keeper-retire";
export const BACKGROUND_AGENT_KEEPER_RETIRED =
  "background-agent-keeper-retired";

// RETIRE is the only keeper request that performs destructive OS cleanup. Its
// deadline is deliberately independent from the short HELLO/ARM request
// deadline and is derived from every synchronous operation on the longest
// Windows path:
//
//   2 targets * (taskkill + WMIC + PowerShell) +
//   2 durable state-lock acquisitions + cleanup confirmation + scheduling
//   margin = 70 seconds.
//
// Keeping these limits in the shared protocol contract prevents either side
// from silently reintroducing the old 10-second client / longer keeper race.
export const BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT = 2;
export const BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS = 10_000;
export const BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS = 5_000;
export const BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS = 10_000;
export const BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS = 5_000;
export const BACKGROUND_AGENT_KEEPER_CLEANUP_CONFIRM_TIMEOUT_MS = 2_000;
export const BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MARGIN_MS = 8_000;
export const BACKGROUND_AGENT_KEEPER_RETIRE_TIMEOUT_MS =
  BACKGROUND_AGENT_KEEPER_CLEANUP_TARGET_LIMIT *
    (BACKGROUND_AGENT_KEEPER_TASKKILL_TIMEOUT_MS +
      BACKGROUND_AGENT_KEEPER_WMIC_TIMEOUT_MS +
      BACKGROUND_AGENT_KEEPER_POWERSHELL_TIMEOUT_MS) +
  2 * BACKGROUND_AGENT_KEEPER_STATE_LOCK_TIMEOUT_MS +
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
const POSIX_KEEPER_DIRECTORY = /^cc-bgk-[a-f0-9]{24}$/u;
const POSIX_KEEPER_SOCKET = /^[a-f0-9]{32}\.sock$/u;

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

export function backgroundAgentKeeperPipePath(id, directory, options = {}) {
  const safeId = requiredSafeString(id, "id");
  const platform = options.platform || process.platform;
  if (platform === "win32") {
    return `\\\\.\\pipe\\cc-bg-keeper-${safeId}`;
  }
  const stateDirectory = requiredPosixDirectory(directory, "state directory");
  const candidate = posix.join(stateDirectory, `${safeId}.keeper.sock`);
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
    `cc-bgk-${namespace}`,
    `${socketId}.sock`,
  );
  if (
    Buffer.byteLength(fallback, "utf8") > POSIX_KEEPER_SOCKET_PATH_MAX_BYTES
  ) {
    throw new Error("background agent keeper fallback socket path is too long");
  }
  return fallback;
}

function fallbackKeeperDirectory(pipePath) {
  const normalized = posix.resolve(
    String(pipePath || "").replaceAll("\\", "/"),
  );
  const directory = posix.dirname(normalized);
  return POSIX_KEEPER_DIRECTORY.test(posix.basename(directory)) &&
    POSIX_KEEPER_SOCKET.test(posix.basename(normalized))
    ? directory
    : null;
}

export function prepareBackgroundAgentKeeperPipePath(
  pipePath,
  { platform = process.platform } = {},
) {
  if (platform === "win32") return pipePath;
  const directory = fallbackKeeperDirectory(pipePath);
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
    throw new Error("background agent keeper socket directory is not private");
  }
  return pipePath;
}

export function cleanupBackgroundAgentKeeperPipeDirectory(
  pipePath,
  { platform = process.platform } = {},
) {
  if (platform === "win32") return false;
  const directory = fallbackKeeperDirectory(pipePath);
  if (!directory) return false;
  try {
    rmdirSync(directory);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTEMPTY") return false;
    throw error;
  }
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
