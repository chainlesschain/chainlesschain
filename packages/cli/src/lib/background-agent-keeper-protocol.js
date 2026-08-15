import { join } from "node:path";

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

export function backgroundAgentKeeperPipePath(id, directory) {
  const safeId = requiredSafeString(id, "id");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cc-bg-keeper-${safeId}`;
  }
  return join(directory, `${safeId}.keeper.sock`);
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
