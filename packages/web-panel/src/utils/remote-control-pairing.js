// Browser port of the CLI's direct (LAN) remote-control pairing URI parser
// (packages/cli/src/lib/remote-control.js parseDirectPairingUri). The URI is
// `chainlesschain://remote-control/pair#<base64url json>` — the same string
// works as QR payload and deep link. The payload embeds everything a device
// needs to join without a relay: the host's WS endpoint, the server token,
// the remote session id and a ONE-TIME pairing token.

export const REMOTE_CONTROL_PAIRING_SCHEME =
  "chainlesschain://remote-control/pair#";

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function isDirectPairingUri(uri) {
  return (
    typeof uri === "string" && uri.startsWith(REMOTE_CONTROL_PAIRING_SCHEME)
  );
}

function isPrivateIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) return false;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * True when `hostname` (as produced by `new URL().hostname` — IPv6 literals
 * keep their square brackets) is loopback / RFC-1918 / link-local / ULA.
 * DNS names other than `localhost` are NOT trusted: they can resolve to
 * anything (classic rebinding), and the legit host only ever embeds IP
 * literals from `pickLanAddress()`.
 */
export function isPrivateOrLoopbackHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost") return true;
  if (isPrivateIpv4(host)) return true;
  if (host === "::1") return true;
  // IPv4-mapped IPv6 — both dotted (::ffff:10.0.0.1) and hex (::ffff:a00:1).
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(
    host,
  );
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(
      `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
    );
  }
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(host)) return true; // fc00::/7 ULA
  return false;
}

/**
 * Direct pairing has NO cryptographic host identity (unlike relay E2EE), so
 * the endpoint itself is the trust boundary. Plaintext `ws://` is only
 * acceptable to hosts we can classify as local/LAN; anything else must be
 * `wss://`. Throws on violation or unparseable/foreign-scheme URLs.
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
  if (parsed.protocol === "ws:" && !isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error(
      `Refusing plaintext ws:// to non-private host "${parsed.hostname}" — ` +
        "direct pairing is LAN/loopback only; use wss:// for anything else",
    );
  }
  return parsed;
}

/**
 * Parse + validate a direct pairing URI. Throws on malformed/unsupported/
 * expired payloads (mirrors the relay parser's expiry check so a stale QR
 * fails fast client-side instead of with an opaque join error).
 */
export function parseDirectPairingUri(uri, now = Date.now()) {
  if (!isDirectPairingUri(uri)) {
    throw new Error("Not a remote-control pairing URI");
  }
  let payload;
  try {
    payload = JSON.parse(
      fromBase64Url(uri.slice(REMOTE_CONTROL_PAIRING_SCHEME.length)),
    );
  } catch {
    throw new Error("Malformed remote-control pairing payload");
  }
  if (payload.v !== 1 || payload.transport !== "direct") {
    throw new Error(
      `Unsupported remote-control pairing payload (v=${payload.v}, transport=${payload.transport})`,
    );
  }
  if (!payload.wsUrl || !payload.remoteSessionId || !payload.pairingToken) {
    throw new Error("Pairing payload is missing wsUrl/session/token");
  }
  if (payload.expiresAt != null && payload.expiresAt <= now) {
    throw new Error("Pairing link has expired — generate a new one");
  }
  assertDirectWsUrlAllowed(payload.wsUrl);
  return {
    wsUrl: payload.wsUrl,
    serverToken: payload.serverToken || null,
    remoteSessionId: payload.remoteSessionId,
    agentSessionId: payload.agentSessionId || null,
    pairingToken: payload.pairingToken,
    scopes: Array.isArray(payload.scopes) ? payload.scopes : null,
    expiresAt: payload.expiresAt ?? null,
  };
}
