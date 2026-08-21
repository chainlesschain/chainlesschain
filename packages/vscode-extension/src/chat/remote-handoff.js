/**
 * Remote/cloud session handoff — pure arg builders + tolerant parsers.
 *
 * `/handoff` converts the panel's conversation into a detached background
 * agent (`cc agent --bg --resume <sessionId> -p <prompt> --output-format
 * json`). The session then keeps running without the IDE and is continuable
 * from the web panel's Background Agents view (browser/phone), `cc attach
 * <id>` in any terminal, or either IDE's Background Agents panel.
 *
 * The Remote Control commands wrap `cc remote-control start/status/stop
 * --json` so the IDE can boot a pairing host for mobile/web devices, surface
 * the pairing URI, list live hosts, and stop them.
 *
 * Pure Node (no vscode import); `deps.execFile`/`deps.spawn` injectable.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");

/** `cc agent --bg --resume <sessionId> -p <prompt> --output-format json`. */
function buildHandoffArgs(sessionId, prompt) {
  return [
    "agent",
    "--bg",
    "--resume",
    String(sessionId),
    "-p",
    String(prompt),
    "--output-format",
    "json",
  ];
}

/**
 * Parse the background-launch JSON state (`{id, sessionId, …}`) out of the
 * launcher's stdout. Tolerant: scans lines for the first JSON object carrying
 * an `id`, so stray log lines before/after don't break it. Null on no match.
 */
function parseBackgroundState(stdout) {
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && parsed.id) return parsed;
    } catch {
      /* not this line */
    }
  }
  return null;
}

/**
 * `cc remote-control start --json` — long-running; first output is pairing
 * JSON. Optional relay settings (E2EE cross-network pairing) become
 * `--relay-url` / `--peer-id` flags. LAN exposure is independent and only an
 * explicit boolean opt-in in direct mode becomes `--allow-lan`; the default
 * emits no LAN flag and therefore keeps the CLI listener on loopback. An
 * explicit relay URL suppresses the LAN flag because its listener does not
 * need additional exposure. Blank/whitespace relay values are dropped so a
 * cleared IDE setting falls back to the CLI's own resolution chain
 * (env `CC_REMOTE_SESSION_RELAY_URL` → config `remoteControl.relayUrl`);
 * flags — when present — win, matching the CLI precedence. peerId is passed
 * independently of relayUrl: a user may set the relay via env/config and only
 * pin the peer id in the IDE.
 */
function buildRemoteControlStartArgs({
  relayUrl,
  peerId,
  allowLan = false,
} = {}) {
  const args = ["remote-control", "start", "--json"];
  const url = String(relayUrl || "").trim();
  const peer = String(peerId || "").trim();
  if (allowLan === true && !url) args.push("--allow-lan");
  if (url) args.push("--relay-url", url);
  if (peer) args.push("--peer-id", peer);
  return args;
}

/** `cc remote-control status --json --prune` (prune drops dead-pid records). */
function buildRemoteControlStatusArgs() {
  return ["remote-control", "status", "--json", "--prune"];
}

/** `cc remote-control stop --port <port> --json`. */
function buildRemoteControlStopArgs(port) {
  return ["remote-control", "stop", "--port", String(port), "--json"];
}

/**
 * Extract the FIRST complete top-level JSON object from an accumulating
 * stdout buffer (the start command pretty-prints its pairing JSON across
 * multiple lines, then keeps serving). Returns the parsed object or null if
 * the buffer doesn't yet hold a balanced object. String-aware brace counting
 * — pairing URIs may contain braces only percent-encoded, but tokens are
 * arbitrary base64url, so quotes/escapes are honored.
 */
function extractFirstJsonObject(buffer) {
  const s = String(buffer || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Parse `remote-control status --json` (array of host states). */
function parseRemoteControlStatus(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || "").trim());
    return Array.isArray(parsed)
      ? parsed.filter((s) => s && typeof s === "object" && !s.invalid)
      : [];
  } catch {
    return [];
  }
}

/** One-line human summary of a background handoff for the transcript. */
function formatHandoffNote(state) {
  if (!state?.id) return null;
  return (
    `handed off to background agent ${state.id} — continue from the web ` +
    `panel's Background Agents view, \`cc attach ${state.id}\`, or the IDE ` +
    `Background Agents panel; this tab is detached (pick the session again ` +
    `to re-attach here later)`
  );
}

/**
 * Whether the pairing URI is intentionally reachable from another device.
 *
 * Relay is cross-network by definition. Direct mode is fail-closed: new CLI
 * payloads explicitly report `exposure` and `lanAccessible`, and an explicit
 * negative wins if the two fields ever disagree. Legacy direct payloads that
 * carry neither field are not assumed to be LAN-safe.
 */
function isPairingUsableFromAnotherDevice(pairing) {
  if (pairing?.mode === "relay") return true;
  if (pairing?.mode !== "direct") return false;
  if (pairing.lanAccessible === false || pairing.exposure === "loopback") {
    return false;
  }
  return pairing.lanAccessible === true || pairing.exposure === "lan";
}

/** Human summary of a pairing payload (start --json). */
function formatPairingNote(pairing) {
  if (!pairing?.pairingUri) return null;
  const relay = pairing.mode === "relay";
  const anotherDevice = isPairingUsableFromAnotherDevice(pairing);
  const mode = relay
    ? "relay (E2EE)"
    : anotherDevice
      ? "direct LAN (explicit opt-in)"
      : "direct loopback";
  const exp = pairing.pairing?.expiresAt
    ? new Date(pairing.pairing.expiresAt).toISOString()
    : "n/a";
  const audience = anotherDevice
    ? "pair a phone/web panel with the one-time URI"
    : "this URI is usable only by clients on this machine; explicitly enable LAN access on a trusted network or configure an E2EE relay to pair another device";
  return `remote control ready (${mode}, port ${pairing.port}) — ${audience} (expires ${exp}):\n${pairing.pairingUri}`;
}

/**
 * Launch the background handoff and return the parsed state
 * (`{ok, state, error}`). The launcher prints the state JSON and exits —
 * the detached worker keeps running on its own.
 */
function runHandoff({
  command = "cc",
  sessionId,
  prompt,
  cwd,
  env,
  deps,
} = {}) {
  const run = deps?.execFile || execFile;
  return new Promise((resolve) => {
    if (!sessionId || !String(prompt || "").trim()) {
      return resolve({
        ok: false,
        state: null,
        error: "missing session or prompt",
      });
    }
    const platform = deps?.platform || process.platform;
    // shell:true joins argv with plain spaces — the user-typed prompt must be
    // cmd-escaped or `… & run tests` executes `run tests` as a second command.
    const useShell = platform === "win32";
    const args = buildHandoffArgs(sessionId, String(prompt).trim());
    run(
      command,
      useShell ? escapeCmdArgs(args, { platform }) : args,
      {
        cwd,
        env: hardenedEnv(env),
        timeout: 60000,
        windowsHide: true,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: useShell,
      },
      (err, stdout, stderr) => {
        const state = parseBackgroundState(stdout);
        if (state) return resolve({ ok: true, state, error: null });
        resolve({
          ok: false,
          state: null,
          error:
            (err && err.message) ||
            String(stderr || "").trim() ||
            "background launch returned no state",
        });
      },
    );
  });
}

module.exports = {
  buildHandoffArgs,
  runHandoff,
  buildRemoteControlStartArgs,
  buildRemoteControlStatusArgs,
  buildRemoteControlStopArgs,
  extractFirstJsonObject,
  formatHandoffNote,
  formatPairingNote,
  isPairingUsableFromAnotherDevice,
  parseBackgroundState,
  parseRemoteControlStatus,
};
