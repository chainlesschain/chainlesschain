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
