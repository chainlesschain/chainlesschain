/**
 * mcp-oauth — OAuth 2.0 (Authorization Code + PKCE) for remote MCP servers,
 * Claude-Code parity. A remote HTTP/SSE MCP server that requires OAuth is
 * authorized once via `cc mcp login <url>`; the access token is stored and
 * injected as `Authorization: Bearer …` on every connect (refreshed when it
 * expires). Static `-H "Authorization: Bearer …"` headers still work for
 * servers where you already hold a token.
 *
 * The flow (RFC 8414 metadata discovery + RFC 7591 dynamic registration +
 * RFC 7636 PKCE):
 *   1. discover the protected-resource / authorization-server metadata;
 *   2. register a public client (or use a configured client_id);
 *   3. open the browser to the authorize URL, catch the code on a localhost
 *      callback, exchange it (with the PKCE verifier) for tokens;
 *   4. persist { access_token, refresh_token, expires_at, client_id, endpoints }.
 *
 * The pure pieces (PKCE, discovery, URL building, token exchange, the store)
 * are `_deps`-injected (fetch / fs / homedir / crypto / http / spawn) so they
 * unit-test without a network, browser, or real OAuth server. The interactive
 * `authorizeInteractive` orchestrator is the thin glue over them.
 */

import fsDefault from "node:fs";
import pathDefault from "node:path";
import { homedir as homedirDefault } from "node:os";
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";

export const _deps = {
  fetch: (...a) => globalThis.fetch(...a),
  fs: fsDefault,
  homedir: homedirDefault,
  randomBytes: (n) => crypto.randomBytes(n),
  sha256: (s) => crypto.createHash("sha256").update(s).digest(),
  createServer: (h) => http.createServer(h),
  openBrowser: defaultOpenBrowser,
  now: () => Date.now(),
};

const base64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** RFC 7636 PKCE pair (S256). */
export function generatePkce() {
  const verifier = base64url(_deps.randomBytes(32));
  const challenge = base64url(_deps.sha256(verifier));
  return { verifier, challenge, method: "S256" };
}

/** A random URL-safe state / nonce. */
export function randomState(bytes = 16) {
  return base64url(_deps.randomBytes(bytes));
}

/** Minimal HTML-escape for values reflected into the callback page. */
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

/**
 * The HTML shown in the user's browser after the OAuth redirect hits our
 * localhost callback. On success it AUTO-CLOSES the tab (Claude-Code 2.1.181
 * parity) — best-effort, since window.close() only acts on script-opened
 * windows, so the page still tells the user they may close it manually. The
 * provider-supplied `error` is HTML-escaped (it is reflected into the page).
 * Pure → unit-testable.
 *
 * @param {string|null|undefined} error  the `error` query param, if any
 */
export function renderCallbackPage(error) {
  const ok = !error;
  const title = ok ? "Authorized" : "Authorization failed";
  const body = ok
    ? "You can close this tab and return to the terminal."
    : `The provider returned an error: ${escapeHtml(error)}`;
  const autoClose = ok
    ? "<script>setTimeout(function(){try{window.close();}catch(e){}},800);</script>"
    : "";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    title +
    "</title></head>" +
    '<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;margin-top:18vh;color:#222">' +
    `<h2 style="color:${ok ? "#16794a" : "#b00020"}">${title}</h2>` +
    `<p style="color:#555">${body}</p>` +
    autoClose +
    "</body></html>"
  );
}

async function fetchJson(url, opts) {
  const res = await _deps.fetch(url, opts);
  if (!res || !res.ok) {
    const status = res ? res.status : "no-response";
    let body = "";
    try {
      body = res ? await res.text() : "";
    } catch {
      /* ignore */
    }
    const err = new Error(
      `HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
    err.status = res ? res.status : null;
    throw err;
  }
  return res.json();
}

/**
 * Discover the authorization-server metadata for a remote MCP server. Tries the
 * protected-resource doc first (which points at its authorization server), then
 * the authorization-server doc directly at the origin.
 * @returns {Promise<{issuer?,authorization_endpoint,token_endpoint,registration_endpoint?,scopes_supported?}>}
 */
export async function discoverAuthMetadata(
  serverUrl,
  { resourceMetadataUrl } = {},
) {
  const origin = new URL(serverUrl).origin;
  // 1. protected-resource metadata (RFC 9728) → authorization_servers[]
  let authServer = origin;
  try {
    const prUrl =
      resourceMetadataUrl || `${origin}/.well-known/oauth-protected-resource`;
    const pr = await fetchJson(prUrl);
    if (
      Array.isArray(pr.authorization_servers) &&
      pr.authorization_servers[0]
    ) {
      authServer = String(pr.authorization_servers[0]).replace(/\/$/, "");
    }
  } catch {
    // no protected-resource doc → assume the origin is its own auth server
  }
  // 2. authorization-server metadata (RFC 8414)
  const candidates = [
    `${authServer}/.well-known/oauth-authorization-server`,
    `${authServer}/.well-known/openid-configuration`,
  ];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const md = await fetchJson(url);
      if (md && md.authorization_endpoint && md.token_endpoint) {
        return {
          issuer: md.issuer || authServer,
          authorization_endpoint: md.authorization_endpoint,
          token_endpoint: md.token_endpoint,
          registration_endpoint: md.registration_endpoint || null,
          scopes_supported: md.scopes_supported || null,
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `could not discover OAuth metadata for ${serverUrl}${lastErr ? ` (${lastErr.message})` : ""}`,
  );
}

/** RFC 7591 dynamic client registration → client_id (public client). */
export async function registerClient(
  metadata,
  { redirectUri, clientName = "chainlesschain-cli" } = {},
) {
  if (!metadata.registration_endpoint) {
    throw new Error(
      "server has no registration_endpoint and no --client-id was given",
    );
  }
  const reg = await fetchJson(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!reg.client_id)
    throw new Error("registration did not return a client_id");
  return { clientId: reg.client_id, clientSecret: reg.client_secret || null };
}

/** Build the authorize URL (Authorization Code + PKCE). */
export function buildAuthorizeUrl(
  metadata,
  { clientId, redirectUri, scope, codeChallenge, state, resource },
) {
  const u = new URL(metadata.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  if (scope) u.searchParams.set("scope", scope);
  if (resource) u.searchParams.set("resource", resource);
  return u.toString();
}

function _tokenExpiresAt(tok) {
  const ttl = Number(tok.expires_in);
  return Number.isFinite(ttl) && ttl > 0 ? _deps.now() + ttl * 1000 : null;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForToken(
  metadata,
  { code, codeVerifier, clientId, clientSecret, redirectUri, resource },
) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (resource) body.set("resource", resource);
  const tok = await fetchJson(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || null,
    token_type: tok.token_type || "Bearer",
    expires_at: _tokenExpiresAt(tok),
    scope: tok.scope || undefined,
  };
}

/** Refresh an access token. */
export async function refreshAccessToken(
  metadata,
  { refreshToken, clientId, clientSecret, resource },
) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (resource) body.set("resource", resource);
  const tok = await fetchJson(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || refreshToken,
    token_type: tok.token_type || "Bearer",
    expires_at: _tokenExpiresAt(tok),
  };
}

// ── token store (~/.chainlesschain/mcp-oauth.json) ────────────────────────

/** Stable key for a server (origin) so http/https/path variants share a token. */
export function serverKey(serverUrl) {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return String(serverUrl || "").trim();
  }
}

export function tokenStorePath() {
  return pathDefault.join(_deps.homedir(), ".chainlesschain", "mcp-oauth.json");
}

export function loadTokenStore() {
  const file = tokenStorePath();
  try {
    if (!_deps.fs.existsSync(file)) return {};
    const data = JSON.parse(_deps.fs.readFileSync(file, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function getStoredToken(serverUrl) {
  return loadTokenStore()[serverKey(serverUrl)] || null;
}

export function saveStoredToken(serverUrl, record) {
  const file = tokenStorePath();
  const store = loadTokenStore();
  store[serverKey(serverUrl)] = { server: serverKey(serverUrl), ...record };
  _deps.fs.mkdirSync(pathDefault.dirname(file), { recursive: true });
  _deps.fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf-8");
  return store[serverKey(serverUrl)];
}

export function deleteStoredToken(serverUrl) {
  const file = tokenStorePath();
  const store = loadTokenStore();
  const key = serverKey(serverUrl);
  if (!(key in store)) return false;
  delete store[key];
  try {
    _deps.fs.writeFileSync(
      file,
      JSON.stringify(store, null, 2) + "\n",
      "utf-8",
    );
  } catch {
    /* best-effort */
  }
  return true;
}

/** True when a record's access token is missing or within `skewMs` of expiry. */
export function isTokenExpired(record, { skewMs = 60_000 } = {}) {
  if (!record || !record.access_token) return true;
  if (!record.expires_at) return false; // no expiry info → assume valid
  return _deps.now() >= record.expires_at - skewMs;
}

/**
 * Return a valid bearer token for a server, refreshing if expired. Returns the
 * access_token string, or null if there's no stored token / refresh failed.
 */
export async function ensureValidToken(serverUrl) {
  const record = getStoredToken(serverUrl);
  if (!record) return null;
  if (!isTokenExpired(record)) return record.access_token;
  if (!record.refresh_token || !record.endpoints?.token_endpoint) {
    return record.access_token || null; // can't refresh → use what we have
  }
  try {
    const tok = await refreshAccessToken(
      { token_endpoint: record.endpoints.token_endpoint },
      { refreshToken: record.refresh_token, clientId: record.client_id },
    );
    const updated = saveStoredToken(serverUrl, { ...record, ...tok });
    return updated.access_token;
  } catch {
    return record.access_token || null;
  }
}

// ── interactive orchestrator ──────────────────────────────────────────────

function defaultOpenBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

/** Wait for the OAuth redirect on a localhost callback server; resolve {code,state}. */
function waitForCallback({
  port,
  host = "127.0.0.1",
  path = "/callback",
  timeout = 300_000,
}) {
  return new Promise((resolve, reject) => {
    const server = _deps.createServer((req, res) => {
      let u;
      try {
        u = new URL(req.url, `http://${host}:${port}`);
      } catch {
        res.writeHead(400);
        res.end("bad request");
        return;
      }
      if (u.pathname !== path) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      const error = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderCallbackPage(error));
      server.close();
      clearTimeout(timer);
      if (error) reject(new Error(`authorization error: ${error}`));
      else if (!code) reject(new Error("no authorization code in callback"));
      else resolve({ code, state });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for the OAuth callback"));
    }, timeout);
    server.on("error", reject);
    server.listen(port, host);
  });
}

/**
 * Run the full interactive Authorization Code + PKCE flow and persist the token.
 *
 * @param {string} serverUrl
 * @param {object} [opts] { scope, clientId, port=53682, host, redirectPath,
 *                          timeout, writeOut }
 * @returns {Promise<{server, access_token, ...}>}  the stored record
 */
export async function authorizeInteractive(serverUrl, opts = {}) {
  const {
    scope,
    clientId: cfgClientId,
    port = 53682,
    host = "127.0.0.1",
    redirectPath = "/callback",
    timeout = 300_000,
    writeOut = (s) => process.stdout.write(s),
  } = opts;

  const metadata = await discoverAuthMetadata(serverUrl);
  const redirectUri = `http://${host}:${port}${redirectPath}`;

  let clientId = cfgClientId;
  let clientSecret = null;
  if (!clientId) {
    const reg = await registerClient(metadata, { redirectUri });
    clientId = reg.clientId;
    clientSecret = reg.clientSecret;
  }

  const pkce = generatePkce();
  const state = randomState();
  const authorizeUrl = buildAuthorizeUrl(metadata, {
    clientId,
    redirectUri,
    scope:
      scope ||
      (metadata.scopes_supported
        ? metadata.scopes_supported.join(" ")
        : undefined),
    codeChallenge: pkce.challenge,
    state,
    resource: serverUrl,
  });

  const callbackPromise = waitForCallback({
    port,
    host,
    path: redirectPath,
    timeout,
  });
  const opened = _deps.openBrowser(authorizeUrl);
  writeOut(
    (opened
      ? "Opened your browser to authorize.\n"
      : "Open this URL in your browser to authorize:\n") +
      `  ${authorizeUrl}\n`,
  );

  const { code, state: returnedState } = await callbackPromise;
  if (returnedState !== state)
    throw new Error("OAuth state mismatch (possible CSRF)");

  const tok = await exchangeCodeForToken(metadata, {
    code,
    codeVerifier: pkce.verifier,
    clientId,
    clientSecret,
    redirectUri,
    resource: serverUrl,
  });

  return saveStoredToken(serverUrl, {
    ...tok,
    client_id: clientId,
    endpoints: {
      authorization_endpoint: metadata.authorization_endpoint,
      token_endpoint: metadata.token_endpoint,
    },
  });
}
