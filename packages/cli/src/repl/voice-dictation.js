/**
 * Voice dictation for the agent REPL (gap-2026-07-11 P2#11).
 *
 * Claude Code's `/voice` dictates a prompt by speech. cc generalizes it to a
 * pluggable STT backend with a strict local-first priority so nothing leaves
 * the box unless the user opts into cloud transcription:
 *
 *   local Whisper  >  system STT (OS dictation)  >  cloud (opt-in)
 *
 * Two capture modes mirror the upstream UX:
 *   - hold : push-to-talk — record while a key is held, transcribe on release.
 *   - tap  : toggle — tap to start, tap again to stop.
 *
 * Real audio capture is a host binding (a Whisper binary, an OS dictation API);
 * it is injected, so on a host with no backend — or a headless/SSH session where
 * there is no microphone — `/voice` degrades to a clear message instead of
 * pretending to listen. This module is the pure decision core (mode/command
 * parse, environment degradation, backend priority, status render).
 */

export const VOICE_MODES = Object.freeze(["off", "hold", "tap"]);
export const DEFAULT_VOICE_MODE = "off";

/**
 * STT backends in priority order. `local` never sends audio off the box;
 * `cloud` requires explicit opt-in (config voice.allowCloud). Each entry names
 * the capability probe the host binding fills in.
 */
export const STT_BACKENDS = Object.freeze([
  { id: "whisper-local", kind: "local", label: "local Whisper" },
  { id: "system-stt", kind: "system", label: "system STT" },
  { id: "cloud", kind: "cloud", label: "cloud transcription" },
]);

/**
 * Parse `/voice [hold|tap|off|status]`. Returns null for non-/voice input,
 * `{ error }` for a bad arg, else `{ action }`. Bare `/voice` shows status.
 * Pure.
 */
export function parseVoiceCommand(input) {
  const t = String(input || "").trim();
  if (t !== "/voice" && !t.startsWith("/voice ")) return null;
  const arg = t.slice("/voice".length).trim().toLowerCase();
  if (!arg || arg === "status") return { action: "status" };
  if (arg === "hold" || arg === "ptt" || arg === "push")
    return { action: "hold" };
  if (arg === "tap" || arg === "toggle") return { action: "tap" };
  if (arg === "off" || arg === "stop" || arg === "0") return { action: "off" };
  return {
    error: `Unknown /voice option "${arg}". Use: hold | tap | off | status`,
  };
}

/**
 * Decide whether voice capture is usable in this environment. Headless / SSH /
 * CI sessions have no local microphone, so dictation degrades. Pure over the
 * passed env + tty flags.
 * @returns {{ supported, reason }}
 */
export function detectVoiceEnvironment({ env = {}, isTTY = true } = {}) {
  if (!isTTY) {
    return {
      supported: false,
      reason: "not a TTY — no interactive microphone",
    };
  }
  if (env.SSH_TTY || env.SSH_CONNECTION) {
    return {
      supported: false,
      reason:
        "remote SSH session — capture audio locally and paste, or use a cloud STT relay",
    };
  }
  if (isTruthy(env.CI)) {
    return { supported: false, reason: "CI environment — no microphone" };
  }
  if (isTruthy(env.CC_NO_VOICE)) {
    return { supported: false, reason: "disabled via CC_NO_VOICE" };
  }
  return { supported: true, reason: "" };
}

/**
 * Pick the highest-priority available STT backend. `available` is a map of
 * backend id → boolean from the host capability probe. Cloud is only eligible
 * when `allowCloud` is true (config voice.allowCloud). Returns
 * `{ backend, reason }` or `{ backend: null, reason }`. Pure.
 */
export function resolveSttBackend({
  available = {},
  allowCloud = false,
  prefer = null,
} = {}) {
  const eligible = STT_BACKENDS.filter((b) => {
    if (!available[b.id]) return false;
    if (b.kind === "cloud" && !allowCloud) return false;
    return true;
  });
  if (eligible.length === 0) {
    return {
      backend: null,
      reason:
        "no STT backend available — install a local Whisper build or enable system dictation (voice.allowCloud for cloud)",
    };
  }
  // Honor an explicit preference if it's eligible; else take the top priority.
  const chosen =
    (prefer && eligible.find((b) => b.id === prefer)) || eligible[0];
  return { backend: chosen, reason: `using ${chosen.label}` };
}

/** One-line `/voice status`. Pure. */
export function renderVoiceStatus({ mode = "off", backend = null, env } = {}) {
  const m = VOICE_MODES.includes(mode) ? mode : "off";
  if (env && !env.supported) {
    return `Voice: unavailable — ${env.reason}.`;
  }
  if (m === "off") {
    return "Voice: off. /voice hold (push-to-talk) or /voice tap (toggle).";
  }
  const be = backend ? backend.label : "no backend";
  const how =
    m === "hold" ? "hold the dictation key to talk" : "tap to start/stop";
  return `Voice: ${m} — ${how}; ${be}.`;
}

function isTruthy(v) {
  const n = String(v == null ? "" : v)
    .toLowerCase()
    .trim();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}
