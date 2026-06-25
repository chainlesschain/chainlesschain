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
  // Backoff sleep seam (tests override with a no-op so the retry doesn't wait).
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Discovery/token requests retry ONCE after a transient error (CC 2.1.191). */
const MCP_OAUTH_RETRY_BACKOFF_MS = 300;

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

/**
 * Is `hostname` a loopback address? Plain http is tolerated only for these (a
 * self-hosted MCP server on the dev box). Handles the bracketed IPv6 form that
 * `new URL().hostname` yields (e.g. "[::1]") and the whole 127.0.0.0/8 range.
 */
export function isLoopbackHost(hostname) {
  const h = String(hostname || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (h === "localhost") return true;
  if (h === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Require an OAuth endpoint to be HTTPS (or plain http on loopback for local
 * dev). Authorization codes, PKCE verifiers, client secrets, and bearer/refresh
 * tokens flow through these endpoints, so a discovered (or stored) endpoint that
 * downgrades to cleartext http on a remote host must be refused rather than
 * leaking secrets over the wire (RFC 6749 §3.1.2.1 / RFC 8252). Returns the
 * endpoint unchanged when allowed; throws otherwise.
 */
export function assertSecureEndpoint(endpoint, label = "endpoint") {
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    throw new Error(`OAuth ${label} is not a valid URL: ${endpoint}`);
  }
  if (u.protocol === "https:") return endpoint;
  if (u.protocol === "http:" && isLoopbackHost(u.hostname)) return endpoint;
  throw new Error(
    `refusing to use insecure OAuth ${label} (${endpoint}); ` +
      `HTTPS is required for non-loopback endpoints`,
  );
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

async function fetchJson(url, opts, attempt = 0) {
  let res;
  try {
    res = await _deps.fetch(url, opts);
  } catch (netErr) {
    // fetch rejected = transient network error → retry once after a short wait
    // (CC 2.1.191: "discovery and token requests now retry once after transient
    // network errors").
    if (attempt < 1) {
      await _deps.sleep(MCP_OAUTH_RETRY_BACKOFF_MS);
      return fetchJson(url, opts, attempt + 1);
    }
    throw netErr;
  }
  if (!res || !res.ok) {
    const status = res ? res.status : "no-response";
    // 5xx is transient → retry once. 4xx is permanent — and discovery probes
    // 404s on purpose (it falls through to the next metadata URL), so retrying
    // those would only slow the expected fall-through.
    if (attempt < 1 && typeof status === "number" && status >= 500) {
      await _deps.sleep(MCP_OAUTH_RETRY_BACKOFF_MS);
      return fetchJson(url, opts, attempt + 1);
    }
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
  assertSecureEndpoint(metadata.registration_endpoint, "registration_endpoint");
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
  assertSecureEndpoint(
    metadata.authorization_endpoint,
    "authorization_endpoint",
  );
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
  assertSecureEndpoint(metadata.token_endpoint, "token_endpoint");
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
  assertSecureEndpoint(metadata.token_endpoint, "token_endpoint");
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

// The store holds OAuth access + refresh tokens, so it must not be world-
// readable. writeFileSync's `mode` only applies when the file is created, so
// also chmod (best-effort) to tighten a file an older version left at 0644.
function _writeStoreSecure(file, store) {
  _deps.fs.mkdirSync(pathDefault.dirname(file), {
    recursive: true,
    mode: 0o700,
  });
  const data = JSON.stringify(store, null, 2) + "\n";
  // Atomic temp+rename: the store holds live OAuth tokens, so a crash (or a
  // concurrent `cc mcp login`) mid-write must not truncate it and lose auth for
  // every server. The temp inherits the 0600 mode. Falls back to a direct write
  // when the injected fs lacks renameSync (test mocks); the real fs always has
  // it, so production is always atomic.
  if (typeof _deps.fs.renameSync !== "function") {
    _deps.fs.writeFileSync(file, data, { encoding: "utf-8", mode: 0o600 });
  } else {
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      _deps.fs.writeFileSync(tmp, data, { encoding: "utf-8", mode: 0o600 });
      _deps.fs.renameSync(tmp, file);
    } catch (err) {
      try {
        if (
          _deps.fs.existsSync &&
          _deps.fs.existsSync(tmp) &&
          _deps.fs.unlinkSync
        )
          _deps.fs.unlinkSync(tmp);
      } catch {
        /* best-effort temp cleanup */
      }
      throw err;
    }
  }
  try {
    _deps.fs.chmodSync(file, 0o600);
  } catch {
    /* chmod unsupported on this platform/fs (e.g. Windows) — mode is advisory */
  }
}

/** Bounded synchronous sleep (the store lock is held only for a few file ops). */
function _sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin — Atomics.wait unavailable (should not happen on modern Node) */
    }
  }
}

/**
 * Run `fn` while holding a cross-process advisory lock on the token store.
 *
 * saveStoredToken / deleteStoredToken are read-modify-write (load → mutate →
 * write). Two concurrent `cc mcp login` PROCESSES for different servers would
 * each load the old store and the second writer would clobber the first's new
 * entry (lost update) — the atomic temp+rename only prevents a torn file, not a
 * lost update. An O_EXCL lockfile makes the whole RMW mutually exclusive across
 * processes, so each writer re-reads the latest store inside the lock.
 *
 * Robustness: a stale lock (holder crashed) older than STALE_MS is stolen; if
 * the lock can't be acquired within MAX_WAIT_MS we proceed anyway (degrading to
 * the pre-lock last-writer-wins rather than failing the login). When the
 * injected fs lacks the lock primitives (test fs / exotic fs) we run `fn`
 * directly — single-process correctness is unchanged, only cross-process mutual
 * exclusion is lost. Lock timing uses the wall clock (not the `now` test seam).
 */
function withStoreLock(file, fn) {
  const fs = _deps.fs;
  if (
    typeof fs.openSync !== "function" ||
    typeof fs.closeSync !== "function" ||
    typeof fs.unlinkSync !== "function"
  ) {
    return fn(); // no lock primitives → run unlocked (back-compat)
  }
  const STALE_MS = 10_000;
  const MAX_WAIT_MS = 5_000;
  const lockPath = `${file}.lock`;
  try {
    fs.mkdirSync(pathDefault.dirname(file), { recursive: true, mode: 0o700 });
  } catch {
    /* dir may already exist — openSync below reports any real problem */
  }
  const start = Date.now();
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx"); // O_CREAT|O_EXCL — fails if held
      break;
    } catch (err) {
      if (!err || err.code !== "EEXIST") {
        // Unexpected (e.g. ENOENT/EACCES): don't fail the login over the lock —
        // proceed unlocked, same as a missing-primitives fs.
        return fn();
      }
      let stale = false;
      try {
        const st = fs.statSync(lockPath);
        const mtime = st.mtimeMs != null ? st.mtimeMs : 0;
        stale = Date.now() - mtime > STALE_MS;
      } catch {
        /* lock vanished between open and stat → retry immediately */
      }
      if (stale) {
        try {
          fs.unlinkSync(lockPath); // steal a lock from a crashed holder
        } catch {
          /* someone else stole it first — retry */
        }
        continue;
      }
      if (Date.now() - start > MAX_WAIT_MS) break; // give up waiting; proceed
      _sleepSyncMs(50);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore — a stale-steal by another process may have removed it */
      }
    }
  }
}

export function saveStoredToken(serverUrl, record) {
  const file = tokenStorePath();
  return withStoreLock(file, () => {
    const store = loadTokenStore(); // re-read inside the lock (latest state)
    store[serverKey(serverUrl)] = { server: serverKey(serverUrl), ...record };
    _writeStoreSecure(file, store);
    return store[serverKey(serverUrl)];
  });
}

export function deleteStoredToken(serverUrl) {
  const file = tokenStorePath();
  return withStoreLock(file, () => {
    const store = loadTokenStore(); // re-read inside the lock (latest state)
    const key = serverKey(serverUrl);
    if (!(key in store)) return false;
    delete store[key];
    try {
      _writeStoreSecure(file, store);
    } catch {
      /* best-effort */
    }
    return true;
  });
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

/**
 * Wait for the OAuth redirect on a localhost callback server; resolve
 * {code,state}.
 *
 * When `expectedState` is given, a SUCCESS callback (`code`) is only accepted if
 * its `state` matches: the callback port is fixed and guessable, so a duplicate
 * browser request, a probe, or a drive-by request from a malicious local page
 * must not abort the real login or inject a forged code — those are answered
 * politely but the server keeps waiting for the genuine redirect (until the
 * backstop timeout). A provider `error` is always terminal (so denying consent
 * fails fast even if the provider omits state on error). With no `expectedState`
 * the legacy contract is preserved (first `/callback` hit is terminal).
 */
export function waitForCallback({
  port,
  host = "127.0.0.1",
  path = "/callback",
  timeout = 300_000,
  expectedState = null,
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

      // Provider error (e.g. user denied) — always terminal so we fail fast.
      if (error) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderCallbackPage(error));
        server.close();
        clearTimeout(timer);
        reject(new Error(`authorization error: ${error}`));
        return;
      }

      const stateOk = expectedState == null || state === expectedState;
      if (code && stateOk) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderCallbackPage(null));
        server.close();
        clearTimeout(timer);
        resolve({ code, state });
        return;
      }

      // A mismatched/forged/duplicate request to our fixed port must not abort
      // the real login — answer it but keep listening for the genuine redirect.
      if (expectedState != null) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderCallbackPage("state mismatch"));
        return;
      }

      // Legacy contract (no expectedState): a /callback hit with no code ends it.
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(renderCallbackPage("missing code"));
      server.close();
      clearTimeout(timer);
      reject(new Error("no authorization code in callback"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for the OAuth callback"));
    }, timeout);
    // Backstop timer should never keep the process alive on its own (the
    // listening server does that); the loop exits promptly once it closes.
    timer.unref?.();
    server.on("error", (err) => {
      // Without clearing the timer here, a bind failure (e.g. port in use)
      // left it pending for the full `timeout`, delaying process exit.
      clearTimeout(timer);
      reject(err);
    });
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
    // Ignore callbacks that don't carry the state we issued (forged / drive-by /
    // duplicate hits to the fixed localhost port) instead of aborting the login.
    expectedState: state,
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
