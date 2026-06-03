/**
 * #21 A.1 PR2 — Pairing token issuer + persistent store.
 *
 * Pre-generates pairing tokens compatible with the existing Electron
 * `device-pairing-handler.js` QR data format. Use case: SSH-only Linux
 * dev box / CI runner where the user wants to:
 *
 *   1. SSH into the box and run `cc pair token generate --did did:cc:foo`
 *   2. Copy/paste the 6-digit code or scan ASCII QR
 *   3. Use it on mobile / Electron client to complete pairing
 *
 * PR2 ships only token issuance + management. The actual signaling
 * server that listens for mobile→PC confirmation stays in Electron's
 * path (or future PR3 for a headless signaling server).
 *
 * Storage: `~/.chainlesschain/pairing-tokens.json` — simple JSON list of
 * `{ code, did, expiresAtMs, createdAtMs, deviceInfo, status }`.
 * Status: "pending" / "consumed" / "revoked" / "expired".
 *
 * Compatibility: token QR shape matches what `device-pairing-handler.js`
 * `handleQRCodeScan()` expects:
 *   { type: "device-pairing", code: "######",
 *     did: "did:cc:...", deviceInfo: { ... }, timestamp: <ms> }
 *
 * Spike doc: docs/design/A1_Linux_Native_Pairing_spike.md §2 PR2
 *
 * @module lib/lan-pairing-tokens
 * @version 0.1.0 (#21 A.1 PR2)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getHomeDir } from "./paths.js";

/** Token lifetime — mirrors device-pairing-handler.js pairingTimeout (5 min). */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Token QR type — must match device-pairing-handler.js validation. */
const QR_TYPE = "device-pairing";

const STATUS = Object.freeze({
  PENDING: "pending",
  CONSUMED: "consumed",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

/**
 * Path to the token store file. Caller may override for tests.
 */
export function defaultTokenStorePath() {
  return path.join(getHomeDir(), "pairing-tokens.json");
}

/**
 * Generate a 6-digit pairing code. Uses crypto.randomInt for unbiased
 * uniform distribution (Math.random would be acceptable too but crypto
 * is cheap on this size).
 */
export function generatePairingCode() {
  // 100000 inclusive, 1000000 exclusive → always 6 digits no leading zero loss.
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Build a token's QR data payload that matches the Electron handler's
 * expected shape (handleQRCodeScan in device-pairing-handler.js).
 *
 * @param {{ did: string, deviceInfo?: object }} input
 * @returns {{ code, qrData, expiresAtMs, createdAtMs, status }}
 */
export function buildToken({ did, deviceInfo } = {}) {
  if (typeof did !== "string" || !did) {
    const e = new Error("buildToken: did required");
    e.code = "INVALID_ARGS";
    throw e;
  }
  const now = Date.now();
  const code = generatePairingCode();
  const qrData = {
    type: QR_TYPE,
    code,
    did,
    deviceInfo: deviceInfo || {
      deviceId: `cli-${os.hostname() || "unknown"}-${now}`,
      name: os.hostname() || "ChainlessChain CLI",
      platform: os.platform(),
      version: process.env.npm_package_version || "0.1.0",
    },
    timestamp: now,
  };
  return {
    code,
    qrData,
    expiresAtMs: now + DEFAULT_TTL_MS,
    createdAtMs: now,
    status: STATUS.PENDING,
  };
}

/**
 * Read the token store. Returns `{ schema, tokens: [...] }`. Creates
 * an empty store if file doesn't exist. Tolerates malformed JSON by
 * returning an empty store + caller can choose to log.
 *
 * @param {string} [filePath]
 * @returns {{ schema: string, tokens: Array }}
 */
export function readTokens(filePath = defaultTokenStorePath()) {
  if (!fs.existsSync(filePath)) {
    return { schema: "cc-pairing-tokens/v1", tokens: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tokens)) {
      return {
        schema: parsed.schema || "cc-pairing-tokens/v1",
        tokens: parsed.tokens,
      };
    }
    return { schema: "cc-pairing-tokens/v1", tokens: [] };
  } catch (_err) {
    // Malformed → return empty (don't crash CLI; user can `revoke --all`).
    return { schema: "cc-pairing-tokens/v1", tokens: [] };
  }
}

/**
 * Atomically write the token store. Creates parent dir if missing.
 *
 * @param {{ schema?: string, tokens: Array }} state
 * @param {string} [filePath]
 */
export function writeTokens(state, filePath = defaultTokenStorePath()) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const toWrite = {
    schema: state.schema || "cc-pairing-tokens/v1",
    tokens: state.tokens || [],
  };
  // Write to temp + rename for atomicity (avoid partial reads).
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * Append a new token to the store. Mark prior pending tokens for the
 * same DID as REVOKED (one-active-token-per-DID invariant — prevents
 * stale codes leaking into mobile scans).
 *
 * @param {{ did, deviceInfo? }} input
 * @param {string} [filePath]
 * @returns {object} the newly-stored token (with status PENDING)
 */
export function addToken(input, filePath = defaultTokenStorePath()) {
  const token = buildToken(input);
  const state = readTokens(filePath);
  // Invalidate prior pending tokens for the same DID.
  state.tokens = state.tokens.map((t) => {
    if (t.qrData?.did === input.did && t.status === STATUS.PENDING) {
      return { ...t, status: STATUS.REVOKED, revokedAtMs: Date.now() };
    }
    return t;
  });
  state.tokens.push(token);
  writeTokens(state, filePath);
  return token;
}

/**
 * Mark expired tokens. Returns the count touched. Caller can run this
 * before `list` to keep status accurate.
 */
export function sweepExpired(filePath = defaultTokenStorePath()) {
  const state = readTokens(filePath);
  const now = Date.now();
  let touched = 0;
  state.tokens = state.tokens.map((t) => {
    if (t.status === STATUS.PENDING && t.expiresAtMs <= now) {
      touched += 1;
      return { ...t, status: STATUS.EXPIRED, expiredAtMs: now };
    }
    return t;
  });
  if (touched > 0) writeTokens(state, filePath);
  return touched;
}

/**
 * List tokens. Optional filter by status. Tokens returned newest-first.
 */
export function listTokens(
  { status, did } = {},
  filePath = defaultTokenStorePath(),
) {
  sweepExpired(filePath);
  const state = readTokens(filePath);
  let tokens = state.tokens;
  if (status) tokens = tokens.filter((t) => t.status === status);
  if (did) tokens = tokens.filter((t) => t.qrData?.did === did);
  return tokens
    .slice()
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

/**
 * Look up a token by 6-digit code. Returns null when not found.
 */
export function findToken(code, filePath = defaultTokenStorePath()) {
  if (typeof code !== "string" || !code) return null;
  sweepExpired(filePath);
  const state = readTokens(filePath);
  return state.tokens.find((t) => t.code === code) || null;
}

/**
 * Revoke a token by code. Idempotent — returns `{revoked: false}` when
 * not found or already non-pending.
 */
export function revokeToken(code, filePath = defaultTokenStorePath()) {
  const state = readTokens(filePath);
  const i = state.tokens.findIndex((t) => t.code === code);
  if (i < 0) return { revoked: false, reason: "not_found" };
  const t = state.tokens[i];
  if (t.status !== STATUS.PENDING) {
    return { revoked: false, reason: `not_pending(${t.status})` };
  }
  state.tokens[i] = {
    ...t,
    status: STATUS.REVOKED,
    revokedAtMs: Date.now(),
  };
  writeTokens(state, filePath);
  return { revoked: true, token: state.tokens[i] };
}

/**
 * Mark a token as consumed. Caller (e.g. signaling listener in PR3) calls
 * this after the mobile successfully connects.
 */
export function markConsumed(code, filePath = defaultTokenStorePath()) {
  const state = readTokens(filePath);
  const i = state.tokens.findIndex((t) => t.code === code);
  if (i < 0) return { consumed: false, reason: "not_found" };
  const t = state.tokens[i];
  if (t.status !== STATUS.PENDING) {
    return { consumed: false, reason: `not_pending(${t.status})` };
  }
  state.tokens[i] = {
    ...t,
    status: STATUS.CONSUMED,
    consumedAtMs: Date.now(),
  };
  writeTokens(state, filePath);
  return { consumed: true, token: state.tokens[i] };
}

export { STATUS, QR_TYPE, DEFAULT_TTL_MS };
