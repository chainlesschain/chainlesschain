/**
 * remote-control core — option resolution, pairing payloads, and discovery
 * state for the unified `cc remote-control` entry (gap-analysis 第四阶段 #1).
 *
 * The heavy lifting (WS server, remote-session registry, E2EE relay, push)
 * already exists under src/gateways + src/harness; this module only composes
 * it into one entry point:
 *
 *   - resolveRemoteControlOptions()  flags > env > config > defaults
 *   - buildDirectPairingUri()        LAN pairing descriptor (no relay needed)
 *   - parseDirectPairingUri()        inverse, used by clients + tests
 *   - pickLanAddress()               best-effort non-internal IPv4
 *   - state file read/write          ~/.chainlesschain/remote-control/<port>.json
 *     so `cc remote-control status/stop` can discover a running host process.
 *     The file is 0600 and CONTAINS THE SERVER TOKEN — same local trust model
 *     as ~/.chainlesschain/ide/<port>.json (readable only by the OS user).
 *   - renderQrCode()                 lazy OPTIONAL `qrcode` import; returns
 *     null when the package is not installed (URI printing is the contract,
 *     the QR is progressive enhancement — no hard dependency, trap #6/#27).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { REMOTE_SESSION_SCOPES } from "../harness/remote-session-registry.js";
import { extractHost, isPrivateHost } from "./sandbox-network-policy.js";

export const REMOTE_CONTROL_DEFAULT_PORT = 18800;
export const REMOTE_CONTROL_PAIRING_SCHEME =
  "chainlesschain://remote-control/pair#";
export const REMOTE_CONTROL_DEFAULT_SCOPES = Object.freeze([
  "observe",
  "prompt",
  "approve",
  "interrupt",
]);

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function unb64url(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

/** Parse a comma/space separated scope list, validating against the registry. */
export function parseScopes(raw) {
  if (raw == null || raw === "") return [...REMOTE_CONTROL_DEFAULT_SCOPES];
  const scopes = String(raw)
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0) return [...REMOTE_CONTROL_DEFAULT_SCOPES];
  for (const scope of scopes) {
    if (!REMOTE_SESSION_SCOPES.includes(scope)) {
      throw new Error(
        `Unknown remote-control scope "${scope}". Valid: ${REMOTE_SESSION_SCOPES.join(", ")}`,
      );
    }
  }
  return [...new Set(scopes)];
}

/**
 * Resolve effective start options. Precedence: explicit flags > environment >
 * config (`remoteControl` / legacy `remoteSession` blocks) > defaults. A
 * missing token is AUTO-GENERATED (32 hex chars) — the WS server must never
 * come up unauthenticated on the unified entry, even on loopback, because the
 * pairing URI embeds the token and pairing is the whole point.
 */
export function resolveRemoteControlOptions({
  flags = {},
  env = process.env,
  config = {},
} = {}) {
  const rc = config.remoteControl || {};
  const legacy = config.remoteSession || {};
  const port = Number(
    flags.port ?? env.CC_REMOTE_CONTROL_PORT ?? rc.port ?? undefined,
  );
  const resolvedPort =
    Number.isFinite(port) && port >= 1 && port <= 65535
      ? Math.floor(port)
      : REMOTE_CONTROL_DEFAULT_PORT;
  const token =
    flags.token ||
    env.CC_REMOTE_CONTROL_TOKEN ||
    rc.token ||
    randomBytes(16).toString("hex");
  const relayUrl =
    flags.relayUrl ||
    env.CC_REMOTE_SESSION_RELAY_URL ||
    rc.relayUrl ||
    legacy.relayUrl ||
    null;
  const peerId =
    flags.peerId ||
    env.CC_REMOTE_SESSION_PEER_ID ||
    rc.peerId ||
    legacy.peerId ||
    (relayUrl
      ? `cc-host-${os.hostname()}-${randomBytes(4).toString("hex")}`
      : null);
  return {
    port: resolvedPort,
    host: flags.host || rc.host || "0.0.0.0",
    token,
    relayUrl,
    peerId,
    scopes: parseScopes(flags.scopes ?? rc.scopes ?? null),
    name: flags.name || rc.name || `remote-control @ ${os.hostname()}`,
  };
}

/** First non-internal IPv4 address, or null. Pure over an interfaces map. */
export function pickLanAddress(interfaces = os.networkInterfaces()) {
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      const family =
        entry.family === "IPv4" || entry.family === 4 ? "IPv4" : entry.family;
      if (family === "IPv4" && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
}

/**
 * Direct (LAN) pairing descriptor for hosts without a signaling relay: the
 * device connects straight to the host's WS endpoint, authenticates with the
 * embedded server token, then joins the remote session with the one-time
 * pairing token. Encodes as `chainlesschain://remote-control/pair#<b64url json>`
 * so the same string works as QR payload and deep link.
 */
export function buildDirectPairingUri({
  wsUrl,
  serverToken,
  remoteSessionId,
  agentSessionId,
  pairingToken,
  scopes,
  expiresAt,
}) {
  if (!wsUrl || !remoteSessionId || !pairingToken) {
    throw new Error("wsUrl, remoteSessionId and pairingToken are required");
  }
  const payload = {
    v: 1,
    transport: "direct",
    wsUrl,
    serverToken: serverToken || null,
    remoteSessionId,
    agentSessionId: agentSessionId || null,
    pairingToken,
    scopes: Array.isArray(scopes) ? scopes : null,
    expiresAt: expiresAt ?? null,
  };
  return REMOTE_CONTROL_PAIRING_SCHEME + b64url(JSON.stringify(payload));
}

/**
 * Direct pairing carries NO cryptographic host identity (unlike relay E2EE),
 * so the endpoint itself is the trust boundary: plaintext `ws://` is only
 * acceptable to loopback/RFC-1918/link-local hosts (the only thing
 * `pickLanAddress()` ever emits); anything else must be `wss://`. Throws on
 * violation — mirrored by the web-panel parser (remote-control-pairing.js).
 */
export function assertDirectWsUrlAllowed(wsUrl) {
  let parsed;
  try {
    parsed = new URL(String(wsUrl));
  } catch {
    throw new Error(`Invalid direct pairing endpoint: ${wsUrl}`);
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(
      `Direct pairing endpoint must be ws:// or wss:// (got ${parsed.protocol})`,
    );
  }
  // extractHost strips IPv6 brackets ("[::1]" → "::1") — isPrivateHost alone
  // would miss bracketed literals (the documented new URL() gotcha).
  if (
    parsed.protocol === "ws:" &&
    !isPrivateHost(extractHost(parsed.hostname))
  ) {
    throw new Error(
      `Refusing plaintext ws:// to non-private host "${parsed.hostname}" — ` +
        "direct pairing is LAN/loopback only; use wss:// for anything else",
    );
  }
  return parsed;
}

/** Inverse of buildDirectPairingUri. Throws on malformed input. */
export function parseDirectPairingUri(uri) {
  if (
    typeof uri !== "string" ||
    !uri.startsWith(REMOTE_CONTROL_PAIRING_SCHEME)
  ) {
    throw new Error("Not a remote-control pairing URI");
  }
  const payload = JSON.parse(
    unb64url(uri.slice(REMOTE_CONTROL_PAIRING_SCHEME.length)),
  );
  if (payload.v !== 1 || payload.transport !== "direct") {
    throw new Error(
      `Unsupported remote-control pairing payload (v=${payload.v}, transport=${payload.transport})`,
    );
  }
  if (payload.wsUrl) assertDirectWsUrlAllowed(payload.wsUrl);
  return payload;
}

// ─── discovery state files ────────────────────────────────────────────────

export function remoteControlStateDir(homedir = os.homedir()) {
  return path.join(homedir, ".chainlesschain", "remote-control");
}

function stateFilePath(dir, port) {
  return path.join(dir, `${port}.json`);
}

/**
 * Persist a running host's discovery record (0600 file, 0700 dir). Contains
 * the server token — local-user trust domain only, mirroring the IDE bridge.
 */
export function writeRemoteControlState(state, { dir } = {}) {
  const stateDir = dir || remoteControlStateDir();
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = stateFilePath(stateDir, state.port);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return file;
}

export function removeRemoteControlState(port, { dir } = {}) {
  const file = stateFilePath(dir || remoteControlStateDir(), port);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but owned elsewhere; ESRCH = gone.
    return err.code === "EPERM";
  }
}

/**
 * All discovery records with liveness annotated. Unreadable/corrupt files are
 * reported as `invalid` rather than thrown (a stale half-written file must
 * never break `status`).
 */
export function readRemoteControlStates({ dir } = {}) {
  const stateDir = dir || remoteControlStateDir();
  let names = [];
  try {
    names = fs.readdirSync(stateDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const states = [];
  for (const name of names) {
    const file = path.join(stateDir, name);
    try {
      const state = JSON.parse(fs.readFileSync(file, "utf-8"));
      states.push({
        ...state,
        stateFile: file,
        alive: isPidAlive(state.pid),
      });
    } catch {
      states.push({ stateFile: file, invalid: true, alive: false });
    }
  }
  return states;
}

/**
 * Terminal QR for a pairing URI via the OPTIONAL `qrcode` package. Returns
 * null when unavailable/failed — callers always print the URI regardless.
 */
export async function renderQrCode(text, _deps = {}) {
  try {
    const importer = _deps.importer || ((spec) => import(spec));
    const mod = await importer("qrcode");
    const qrcode = mod.default || mod;
    return await qrcode.toString(text, { type: "terminal", small: true });
  } catch {
    return null;
  }
}
