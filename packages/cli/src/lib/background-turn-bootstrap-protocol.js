/**
 * Private worker <-> turn bootstrap protocol.
 *
 * The nonce is deliberately confined to the inherited environment and the
 * dedicated Node IPC channel. It must never be copied into background-agent
 * state or the attach transport.
 */

export const BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION = 1;
export const BACKGROUND_TURN_BOOTSTRAP_READY =
  "background-turn-bootstrap-ready";
export const BACKGROUND_TURN_BOOTSTRAP_RELEASE =
  "background-turn-bootstrap-release";
// The formal launch gate permits 120 seconds for a 20-worker hosted runner to
// become ready. Keep the pre-main barrier alive for that same bounded window;
// worker/IPC death still fails immediately through the disconnect listener.
export const BACKGROUND_TURN_BOOTSTRAP_RELEASE_TIMEOUT_MS = 120_000;

export const BACKGROUND_TURN_BOOTSTRAP_ENV = Object.freeze({
  nonce: "CC_BACKGROUND_TURN_BOOTSTRAP_NONCE",
  workerGeneration: "CC_BACKGROUND_TURN_BOOTSTRAP_GENERATION",
  attempt: "CC_BACKGROUND_TURN_BOOTSTRAP_ATTEMPT",
  testTimeoutMs: "CC_BACKGROUND_TURN_BOOTSTRAP_TEST_TIMEOUT_MS",
});

const SAFE_BINDING = /^[A-Za-z0-9_-]+$/u;

function requiredBindingString(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length < 1 ||
    normalized.length > 256 ||
    !SAFE_BINDING.test(normalized)
  ) {
    throw new TypeError(`invalid background turn bootstrap ${label}`);
  }
  return normalized;
}

function requiredPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`invalid background turn bootstrap ${label}`);
  }
  return normalized;
}

export function normalizeBackgroundTurnBootstrapAuthority(binding = {}) {
  return Object.freeze({
    nonce: requiredBindingString(binding.nonce, "nonce"),
    workerGeneration: requiredBindingString(
      binding.workerGeneration,
      "worker generation",
    ),
    attempt: requiredPositiveInteger(binding.attempt, "attempt"),
  });
}

export function normalizeBackgroundTurnBootstrapBinding(binding = {}) {
  return Object.freeze({
    ...normalizeBackgroundTurnBootstrapAuthority(binding),
    pid: requiredPositiveInteger(binding.pid, "pid"),
  });
}

export function backgroundTurnBootstrapBindingFromEnvironment(
  environment,
  pid,
) {
  return normalizeBackgroundTurnBootstrapBinding({
    nonce: environment?.[BACKGROUND_TURN_BOOTSTRAP_ENV.nonce],
    workerGeneration:
      environment?.[BACKGROUND_TURN_BOOTSTRAP_ENV.workerGeneration],
    attempt: environment?.[BACKGROUND_TURN_BOOTSTRAP_ENV.attempt],
    pid,
  });
}

export function createBackgroundTurnBootstrapMessage(type, binding) {
  if (
    type !== BACKGROUND_TURN_BOOTSTRAP_READY &&
    type !== BACKGROUND_TURN_BOOTSTRAP_RELEASE
  ) {
    throw new TypeError("invalid background turn bootstrap message type");
  }
  return Object.freeze({
    type,
    protocolVersion: BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION,
    ...normalizeBackgroundTurnBootstrapBinding(binding),
  });
}

export function matchesBackgroundTurnBootstrapMessage(
  message,
  type,
  authority,
) {
  let expected;
  let actual;
  try {
    expected = normalizeBackgroundTurnBootstrapAuthority(authority);
    actual = normalizeBackgroundTurnBootstrapBinding(message);
  } catch {
    return false;
  }
  return (
    message?.type === type &&
    message.protocolVersion === BACKGROUND_TURN_BOOTSTRAP_PROTOCOL_VERSION &&
    actual.nonce === expected.nonce &&
    actual.workerGeneration === expected.workerGeneration &&
    actual.attempt === expected.attempt &&
    (authority.pid === undefined || Number(authority.pid) === actual.pid)
  );
}

export function removeBackgroundTurnBootstrapImport(execArgv, moduleUrl) {
  const expected = `--import=${moduleUrl}`;
  const values = Array.isArray(execArgv) ? [...execArgv] : [];
  if (values.filter((value) => value === expected).length !== 1) {
    throw new Error("background turn bootstrap preload identity is ambiguous");
  }
  return values.filter((value) => value !== expected);
}

export function clearBackgroundTurnBootstrapEnvironment(environment) {
  if (!environment || typeof environment !== "object") return;
  for (const key of Object.values(BACKGROUND_TURN_BOOTSTRAP_ENV)) {
    delete environment[key];
  }
}

/**
 * Freeze a released POSIX turn in its detached process group when its worker
 * disappears. The worker's detached-spawn contract makes the positive current
 * PID the group ID; using its negative form fails with ESRCH if that invariant
 * is ever broken instead of stopping an unrelated worker/runner group.
 *
 * Register the SIGCONT fail-safe before SIGSTOP because Node's process.kill()
 * can return to JavaScript before the stop is delivered. If the group is ever
 * resumed, immediately SIGKILL it instead of letting the Agent or one of its
 * descendants continue without supervision.
 */
export function containReleasedBackgroundTurnDisconnect(options = {}) {
  const released = options.released === true;
  const platform = options.platform || process.platform;
  const currentPid = Number(options.currentPid ?? process.pid);
  const signalProcessGroup =
    options.signalProcessGroup || process.kill.bind(process);
  const resumeSignalTarget = options.resumeSignalTarget || process;
  const onResumedKillFailure =
    options.onResumedKillFailure || (() => process.exit(1));
  if (
    !released ||
    platform === "win32" ||
    !Number.isSafeInteger(currentPid) ||
    currentPid <= 0
  ) {
    return false;
  }
  const groupPid = -currentPid;
  const killAfterResume = () => {
    try {
      signalProcessGroup(groupPid, "SIGKILL");
    } catch {
      onResumedKillFailure();
    }
  };
  try {
    resumeSignalTarget.once("SIGCONT", killAfterResume);
  } catch {
    try {
      signalProcessGroup(groupPid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  }
  try {
    signalProcessGroup(groupPid, "SIGSTOP");
    return true;
  } catch {
    try {
      resumeSignalTarget.removeListener("SIGCONT", killAfterResume);
    } catch {
      // The same group SIGKILL below remains the containment fallback.
    }
    try {
      signalProcessGroup(groupPid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  }
}
