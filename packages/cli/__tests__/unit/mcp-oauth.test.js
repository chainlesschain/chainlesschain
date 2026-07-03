/**
 * mcp-oauth — OAuth 2.0 (Auth Code + PKCE) for remote MCP servers.
 *
 * Covers PKCE, metadata discovery (protected-resource → auth-server, fallback),
 * dynamic registration, authorize-URL building, code/refresh token exchange,
 * the token store, expiry/refresh. fetch/fs/crypto/now are stubbed (no network,
 * no disk, no browser).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as oauth from "../../src/lib/mcp-oauth.js";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";

const { _deps } = oauth;

/** A fetch stub that maps URL (+ optional method) → { ok, json, status }. */
function fetchStub(routes) {
  return vi.fn(async (url, opts = {}) => {
    const key = `${(opts.method || "GET").toUpperCase()} ${url}`;
    const r = routes[key] ?? routes[url];
    if (!r)
      return {
        ok: false,
        status: 404,
        text: async () => "no route",
        json: async () => ({}),
      };
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  });
}

let store; // in-memory token store file content
beforeEach(() => {
  let _n = 1_000_000;
  _deps.now = () => _n;
  _deps.homedir = () => (process.platform === "win32" ? "C:\\home" : "/home");
  _deps.randomBytes = (n) => Buffer.alloc(n, 7); // deterministic
  store = {};
  const file = oauth.tokenStorePath();
  _deps.fs = {
    existsSync: (p) => p === file && store.__written === true,
    readFileSync: () => store.content,
    writeFileSync: (p, c) => {
      store.content = c;
      store.__written = true;
    },
    mkdirSync: () => {},
  };
});

describe("generatePkce", () => {
  it("produces a verifier + S256 challenge (url-safe, no padding)", () => {
    const { verifier, challenge, method } = oauth.generatePkce();
    expect(method).toBe("S256");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain("=");
  });
});

describe("discoverAuthMetadata", () => {
  it("follows protected-resource → authorization-server", async () => {
    _deps.fetch = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        body: { authorization_servers: ["https://auth.example.com"] },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        body: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        },
      },
    });
    const md = await oauth.discoverAuthMetadata("https://mcp.example.com/mcp");
    expect(md).toMatchObject({
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      registration_endpoint: "https://auth.example.com/register",
    });
  });

  it("falls back to the origin's auth-server doc when no protected-resource", async () => {
    _deps.fetch = fetchStub({
      "https://mcp.example.com/.well-known/oauth-authorization-server": {
        body: {
          authorization_endpoint: "https://mcp.example.com/authorize",
          token_endpoint: "https://mcp.example.com/token",
        },
      },
    });
    const md = await oauth.discoverAuthMetadata("https://mcp.example.com/mcp");
    expect(md.token_endpoint).toBe("https://mcp.example.com/token");
  });

  it("throws when nothing is discoverable", async () => {
    _deps.fetch = fetchStub({});
    await expect(
      oauth.discoverAuthMetadata("https://x.example.com"),
    ).rejects.toThrow(/could not discover/);
  });

  it("refuses a cleartext remote MCP server URL (no http downgrade of discovery)", async () => {
    _deps.fetch = fetchStub({}); // must never be reached
    await expect(
      oauth.discoverAuthMetadata("http://mcp.example.com/mcp"),
    ).rejects.toThrow(/insecure|HTTPS is required/i);
  });

  it("refuses an authServer the protected-resource doc downgrades to http", async () => {
    _deps.fetch = fetchStub({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        // A malicious / MITM'd PR doc points discovery at a cleartext host.
        body: { authorization_servers: ["http://attacker.example.com"] },
      },
    });
    await expect(
      oauth.discoverAuthMetadata("https://mcp.example.com/mcp"),
    ).rejects.toThrow(/insecure|HTTPS is required/i);
  });

  it("still allows a loopback http MCP server (local dev)", async () => {
    _deps.fetch = fetchStub({
      "http://127.0.0.1:3000/.well-known/oauth-authorization-server": {
        body: {
          authorization_endpoint: "http://127.0.0.1:3000/authorize",
          token_endpoint: "http://127.0.0.1:3000/token",
        },
      },
    });
    const md = await oauth.discoverAuthMetadata("http://127.0.0.1:3000/mcp");
    expect(md.token_endpoint).toBe("http://127.0.0.1:3000/token");
  });
});

describe("registerClient", () => {
  it("posts to the registration endpoint → client_id", async () => {
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/register": {
        body: { client_id: "cid-123" },
      },
    });
    const r = await oauth.registerClient(
      { registration_endpoint: "https://auth.example.com/register" },
      { redirectUri: "http://127.0.0.1:53682/callback" },
    );
    expect(r.clientId).toBe("cid-123");
  });
  it("errors without a registration endpoint", async () => {
    await expect(oauth.registerClient({}, {})).rejects.toThrow(
      /no --client-id/,
    );
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds the PKCE authorize URL", () => {
    const url = oauth.buildAuthorizeUrl(
      { authorization_endpoint: "https://auth.example.com/authorize" },
      {
        clientId: "cid",
        redirectUri: "http://127.0.0.1:53682/callback",
        scope: "mcp",
        codeChallenge: "CHAL",
        state: "ST",
        resource: "https://mcp.example.com/mcp",
      },
    );
    const u = new URL(url);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("code_challenge")).toBe("CHAL");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("ST");
    expect(u.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");
  });
});

describe("token exchange + refresh", () => {
  it("exchanges a code and computes expires_at", async () => {
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/token": {
        body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 },
      },
    });
    const tok = await oauth.exchangeCodeForToken(
      { token_endpoint: "https://auth.example.com/token" },
      {
        code: "C",
        codeVerifier: "V",
        clientId: "cid",
        redirectUri: "http://x/cb",
      },
    );
    expect(tok).toMatchObject({ access_token: "AT", refresh_token: "RT" });
    expect(tok.expires_at).toBe(1_000_000 + 3600 * 1000);
  });

  it("refresh keeps the old refresh_token when none returned", async () => {
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/token": {
        body: { access_token: "AT2", expires_in: 60 },
      },
    });
    const tok = await oauth.refreshAccessToken(
      { token_endpoint: "https://auth.example.com/token" },
      { refreshToken: "RT", clientId: "cid" },
    );
    expect(tok).toMatchObject({ access_token: "AT2", refresh_token: "RT" });
  });
});

describe("fetchJson retry on transient errors (CC 2.1.191)", () => {
  let slept;
  let realSleep;
  const TOKEN = { token_endpoint: "https://auth.example.com/token" };
  const exch = () =>
    oauth.exchangeCodeForToken(TOKEN, {
      code: "C",
      codeVerifier: "V",
      clientId: "cid",
      redirectUri: "http://x/cb",
    });
  const okRes = () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "AT", expires_in: 60 }),
    text: async () => "{}",
  });

  beforeEach(() => {
    slept = [];
    realSleep = _deps.sleep;
    _deps.sleep = async (ms) => {
      slept.push(ms);
    };
  });
  afterEach(() => {
    _deps.sleep = realSleep;
  });

  it("retries once after a network rejection, then succeeds", async () => {
    let n = 0;
    _deps.fetch = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("fetch failed");
      return okRes();
    });
    const tok = await exch();
    expect(tok.access_token).toBe("AT");
    expect(n).toBe(2);
    expect(slept).toEqual([300]);
  });

  it("retries once on a 5xx, then succeeds", async () => {
    let n = 0;
    _deps.fetch = vi.fn(async () => {
      n += 1;
      if (n === 1)
        return {
          ok: false,
          status: 503,
          text: async () => "busy",
          json: async () => ({}),
        };
      return okRes();
    });
    const tok = await exch();
    expect(tok.access_token).toBe("AT");
    expect(n).toBe(2);
    expect(slept).toEqual([300]);
  });

  it("does NOT retry a 4xx (permanent) and surfaces it", async () => {
    let n = 0;
    _deps.fetch = vi.fn(async () => {
      n += 1;
      return {
        ok: false,
        status: 400,
        text: async () => "bad",
        json: async () => ({}),
      };
    });
    await expect(exch()).rejects.toThrow(/HTTP 400/);
    expect(n).toBe(1);
    expect(slept).toEqual([]);
  });

  it("gives up after a single retry on a persistent network error", async () => {
    let n = 0;
    _deps.fetch = vi.fn(async () => {
      n += 1;
      throw new Error("ECONNRESET");
    });
    await expect(exch()).rejects.toThrow(/ECONNRESET/);
    expect(n).toBe(2); // original + one retry
    expect(slept).toEqual([300]);
  });
});

describe("token store + expiry", () => {
  it("save → get round-trips by server origin", () => {
    oauth.saveStoredToken("https://mcp.example.com/mcp", {
      access_token: "AT",
    });
    expect(oauth.getStoredToken("https://mcp.example.com/other")).toMatchObject(
      {
        access_token: "AT",
        server: "https://mcp.example.com",
      },
    );
  });

  it("delete removes it", () => {
    oauth.saveStoredToken("https://m.example.com", { access_token: "AT" });
    expect(oauth.deleteStoredToken("https://m.example.com")).toBe(true);
    expect(oauth.getStoredToken("https://m.example.com")).toBeNull();
  });

  it("writes the token store atomically (temp + rename, no .tmp left, 0600 temp)", () => {
    const calls = { writes: [], renames: [] };
    const files = {};
    _deps.fs = {
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p] ?? "{}",
      mkdirSync: () => {},
      writeFileSync: (p, c, opts) => {
        files[p] = c;
        calls.writes.push({ p, mode: opts && opts.mode });
      },
      renameSync: (from, to) => {
        files[to] = files[from];
        delete files[from];
        calls.renames.push({ from, to });
      },
      unlinkSync: (p) => delete files[p],
      chmodSync: () => {},
    };
    oauth.saveStoredToken("https://m.example.com", { access_token: "AT" });
    // Wrote a 0600 temp sibling, then renamed it over the store; none left.
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0].p).toMatch(/\.tmp$/);
    expect(calls.writes[0].mode).toBe(0o600);
    expect(calls.renames).toHaveLength(1);
    expect(calls.renames[0].from).toBe(calls.writes[0].p);
    expect(Object.keys(files).some((k) => k.endsWith(".tmp"))).toBe(false);
  });

  it("writes the token file owner-only (0600 file, 0700 dir, chmod enforced)", () => {
    const cap = { write: null, mkdir: null, chmod: null };
    _deps.fs = {
      existsSync: () => false,
      readFileSync: () => "{}",
      mkdirSync: (_p, opts) => {
        cap.mkdir = opts && opts.mode;
      },
      writeFileSync: (_p, _c, opts) => {
        cap.write = opts && opts.mode;
      },
      chmodSync: (_p, mode) => {
        cap.chmod = mode;
      },
    };
    oauth.saveStoredToken("https://m.example.com", {
      access_token: "AT",
      refresh_token: "RT",
    });
    expect(cap.write).toBe(0o600); // token file not world-readable
    expect(cap.mkdir).toBe(0o700); // dir not world-listable
    expect(cap.chmod).toBe(0o600); // enforced even if the file pre-existed
  });

  it("isTokenExpired: missing token, within skew, valid", () => {
    expect(oauth.isTokenExpired(null)).toBe(true);
    expect(oauth.isTokenExpired({ access_token: "AT" })).toBe(false); // no expiry
    expect(
      oauth.isTokenExpired({
        access_token: "AT",
        expires_at: 1_000_000 + 30_000,
      }),
    ).toBe(true); // within 60s skew
    expect(
      oauth.isTokenExpired({
        access_token: "AT",
        expires_at: 1_000_000 + 600_000,
      }),
    ).toBe(false);
  });

  it("ensureValidToken refreshes an expired token via the stored endpoint", async () => {
    oauth.saveStoredToken("https://m.example.com", {
      access_token: "OLD",
      refresh_token: "RT",
      expires_at: 1_000_000 - 1, // already expired
      client_id: "cid",
      endpoints: { token_endpoint: "https://auth.example.com/token" },
    });
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/token": {
        body: { access_token: "NEW", expires_in: 3600 },
      },
    });
    const at = await oauth.ensureValidToken("https://m.example.com");
    expect(at).toBe("NEW");
    expect(oauth.getStoredToken("https://m.example.com").access_token).toBe(
      "NEW",
    );
  });

  it("ensureValidToken returns null when nothing stored", async () => {
    expect(await oauth.ensureValidToken("https://none.example.com")).toBeNull();
  });

  it("ensureValidToken({forceRefresh}) refreshes even a locally-valid token", async () => {
    oauth.saveStoredToken("https://m.example.com", {
      access_token: "STALE",
      refresh_token: "RT",
      expires_at: 1_000_000 + 600_000, // NOT expired locally
      client_id: "cid",
      endpoints: { token_endpoint: "https://auth.example.com/token" },
    });
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/token": {
        body: { access_token: "ROTATED", expires_in: 3600 },
      },
    });
    // Proactive path hands back the locally-valid token untouched…
    expect(await oauth.ensureValidToken("https://m.example.com")).toBe("STALE");
    // …but a forced refresh (server rejected it) exchanges the refresh token.
    expect(
      await oauth.ensureValidToken("https://m.example.com", {
        forceRefresh: true,
      }),
    ).toBe("ROTATED");
  });

  it("ensureValidToken({forceRefresh}) returns null when it cannot refresh", async () => {
    oauth.saveStoredToken("https://norefresh.example.com", {
      access_token: "REJECTED", // looks valid locally, no refresh capability
      expires_at: 1_000_000 + 600_000,
    });
    // Proactive path still returns the cached token…
    expect(await oauth.ensureValidToken("https://norefresh.example.com")).toBe(
      "REJECTED",
    );
    // …but a forced refresh has no way to recover → null (re-login needed).
    expect(
      await oauth.ensureValidToken("https://norefresh.example.com", {
        forceRefresh: true,
      }),
    ).toBeNull();
  });
});

describe("corrupt token store (unreadable file is not silently destroyed)", () => {
  // NOTE: keep the load-warn case FIRST — the once-per-path warn guard is
  // module-level (no resetModules here), so a later case can't re-trigger it.
  it("loadTokenStore warns once and returns {} when the store is unreadable", () => {
    store.content = "{ broken json";
    store.__written = true;
    const warn = vi.fn();
    _deps.warn = warn;
    expect(oauth.loadTokenStore()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(oauth.tokenStorePath());
    expect(warn.mock.calls[0][0]).toMatch(/cc mcp login/);
  });

  it("saveStoredToken writes a FRESH store (does not merge into corrupt bytes)", () => {
    store.content = "{ broken json";
    store.__written = true;
    _deps.warn = vi.fn();
    oauth.saveStoredToken("https://x.example.com", { access_token: "NEW" });
    const written = JSON.parse(store.content);
    // only the new entry survives — the unreadable store wasn't merged/clobbered
    // into a half-broken result, and the other (lost) tokens aren't faked back.
    expect(Object.keys(written)).toEqual(["https://x.example.com"]);
    expect(written["https://x.example.com"].access_token).toBe("NEW");
  });

  it("saveStoredToken archives the unreadable file when renameSync exists", () => {
    store.content = "{ broken json";
    store.__written = true;
    const renamed = [];
    _deps.fs.renameSync = (from, to) => renamed.push([from, to]);
    _deps.warn = vi.fn();
    oauth.saveStoredToken("https://x.example.com", { access_token: "NEW" });
    // the corrupt file was moved aside to a `.corrupt-<ts>` path before writing
    expect(renamed.some(([, to]) => String(to).includes(".corrupt-"))).toBe(
      true,
    );
  });
});

describe("connect wiring (setupMcpFromConfig)", () => {
  function fakeStore(json) {
    _deps.fs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify(json),
      writeFileSync: () => {},
      mkdirSync: () => {},
    };
  }

  it("injects a stored token as an Authorization: Bearer header", async () => {
    fakeStore({
      "https://m.example.com": {
        server: "https://m.example.com",
        access_token: "AT",
      },
    });
    let seenCfg = null;
    const fakeClient = {
      servers: new Map(),
      connect: async (_name, cfg) => {
        seenCfg = cfg;
        return { tools: [] };
      },
    };
    await setupMcpFromConfig(
      { remote: { url: "https://m.example.com/mcp", headers: {} } },
      { createClient: () => fakeClient },
    );
    expect(seenCfg.headers.Authorization).toBe("Bearer AT");
  });

  it("does not override an explicit Authorization header", async () => {
    fakeStore({
      "https://m.example.com": {
        server: "https://m.example.com",
        access_token: "AT",
      },
    });
    let seenCfg = null;
    const fakeClient = {
      servers: new Map(),
      connect: async (_name, cfg) => {
        seenCfg = cfg;
        return { tools: [] };
      },
    };
    await setupMcpFromConfig(
      {
        remote: {
          url: "https://m.example.com/mcp",
          headers: { Authorization: "Bearer MANUAL" },
        },
      },
      { createClient: () => fakeClient },
    );
    expect(seenCfg.headers.Authorization).toBe("Bearer MANUAL");
  });

  it("registers a reconnector that force-refreshes the bearer on a 401/403", async () => {
    fakeStore({
      "https://m.example.com": {
        server: "https://m.example.com",
        access_token: "AT",
        refresh_token: "RT",
        client_id: "cid",
        endpoints: { token_endpoint: "https://auth.example.com/token" },
      },
    });
    _deps.fetch = fetchStub({
      "POST https://auth.example.com/token": {
        body: { access_token: "FRESH", expires_in: 3600 },
      },
    });
    let reconnector = null;
    const fakeClient = {
      servers: new Map(),
      connect: async () => ({ tools: [] }),
      setReconnector: (_name, fn) => {
        reconnector = fn;
      },
    };
    await setupMcpFromConfig(
      { remote: { url: "https://m.example.com/mcp", headers: {} } },
      { createClient: () => fakeClient },
    );
    expect(typeof reconnector).toBe("function");
    // Simulate the mcp-client callTool retry path invoking it after a 401:
    // it force-refreshes and returns a fresh-bearer config to reconnect with.
    const fresh = await reconnector();
    expect(fresh.headers.Authorization).toBe("Bearer FRESH");
    expect(fresh.url).toBe("https://m.example.com/mcp");
  });

  it("reconnector returns null when the token cannot be refreshed", async () => {
    fakeStore({
      "https://m.example.com": {
        server: "https://m.example.com",
        access_token: "AT", // no refresh_token → forced refresh can't recover
      },
    });
    let reconnector = null;
    const fakeClient = {
      servers: new Map(),
      connect: async () => ({ tools: [] }),
      setReconnector: (_name, fn) => {
        reconnector = fn;
      },
    };
    await setupMcpFromConfig(
      { remote: { url: "https://m.example.com/mcp", headers: {} } },
      { createClient: () => fakeClient },
    );
    expect(typeof reconnector).toBe("function");
    expect(await reconnector()).toBeNull();
  });

  it("does not register a reconnector when the config carries its own auth", async () => {
    fakeStore({});
    let called = false;
    const fakeClient = {
      servers: new Map(),
      connect: async () => ({ tools: [] }),
      setReconnector: () => {
        called = true;
      },
    };
    await setupMcpFromConfig(
      {
        remote: {
          url: "https://m.example.com/mcp",
          headers: { Authorization: "Bearer MANUAL" },
        },
      },
      { createClient: () => fakeClient },
    );
    expect(called).toBe(false);
  });
});

describe("renderCallbackPage (auto-close on success)", () => {
  it("auto-closes the tab on success and shows a friendly message", () => {
    const html = oauth.renderCallbackPage(null);
    expect(html).toContain("Authorized");
    expect(html).toContain("window.close()");
    expect(html).toContain("close this tab");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('charset="utf-8"');
  });

  it("shows the error WITHOUT auto-closing, and escapes it (no injection)", () => {
    const html = oauth.renderCallbackPage('<img src=x onerror="alert(1)">');
    expect(html).toContain("Authorization failed");
    expect(html).not.toContain("window.close()"); // failures stay open to read
    // The raw tag must be escaped, never reflected as live HTML.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("treats empty-string error as a failure (not success)", () => {
    // `error=` with no value still means the provider denied — but an empty
    // string is falsy, so it renders as success; a real denial always carries
    // an error code. Document the boundary: undefined/null/"" → success page.
    expect(oauth.renderCallbackPage(undefined)).toContain("window.close()");
  });
});

describe("waitForCallback (timeout-timer cleanup)", () => {
  const origCreateServer = _deps.createServer;
  afterEach(() => {
    _deps.createServer = origCreateServer;
    vi.useRealTimers();
  });

  it("clears the backstop timer when the server errors (no leak)", async () => {
    vi.useFakeTimers();
    let onError;
    _deps.createServer = () => ({
      on: (ev, cb) => {
        if (ev === "error") onError = cb;
      },
      listen: () => {},
      close: () => {},
    });
    const p = oauth.waitForCallback({ port: 0, timeout: 60_000 });
    expect(vi.getTimerCount()).toBe(1); // timeout armed
    onError(new Error("EADDRINUSE"));
    await expect(p).rejects.toThrow("EADDRINUSE");
    // Previously the timer was left pending for the full timeout on this path.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves on a valid callback and clears the timer", async () => {
    vi.useFakeTimers();
    let handler;
    const closed = vi.fn();
    _deps.createServer = (h) => {
      handler = h;
      return { on: () => {}, listen: () => {}, close: closed };
    };
    const p = oauth.waitForCallback({
      port: 0,
      path: "/callback",
      timeout: 60_000,
    });
    handler(
      { url: "/callback?code=abc&state=xyz" },
      { writeHead: () => {}, end: () => {} },
    );
    await expect(p).resolves.toEqual({ code: "abc", state: "xyz" });
    expect(closed).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a forged/mismatched-state callback and keeps waiting", async () => {
    vi.useFakeTimers();
    let handler;
    const closed = vi.fn();
    _deps.createServer = (h) => {
      handler = h;
      return { on: () => {}, listen: () => {}, close: closed };
    };
    const p = oauth.waitForCallback({
      port: 0,
      path: "/callback",
      timeout: 60_000,
      expectedState: "GOOD",
    });

    // A drive-by / duplicate hit with the WRONG state must not abort the login.
    const res1 = { writeHead: vi.fn(), end: vi.fn() };
    handler({ url: "/callback?code=evil&state=WRONG" }, res1);
    expect(res1.writeHead).toHaveBeenCalledWith(400, expect.anything());
    expect(closed).not.toHaveBeenCalled(); // server still listening
    expect(vi.getTimerCount()).toBe(1); // backstop timer still armed

    // The genuine redirect (matching state) resolves it.
    handler(
      { url: "/callback?code=real&state=GOOD" },
      { writeHead: () => {}, end: () => {} },
    );
    await expect(p).resolves.toEqual({ code: "real", state: "GOOD" });
    expect(closed).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a provider error regardless of state (fast-fail on deny)", async () => {
    vi.useFakeTimers();
    let handler;
    const closed = vi.fn();
    _deps.createServer = (h) => {
      handler = h;
      return { on: () => {}, listen: () => {}, close: closed };
    };
    const p = oauth.waitForCallback({
      port: 0,
      path: "/callback",
      timeout: 60_000,
      expectedState: "GOOD",
    });
    handler(
      { url: "/callback?error=access_denied" },
      { writeHead: () => {}, end: () => {} },
    );
    await expect(p).rejects.toThrow(/access_denied/);
    expect(closed).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a no-code callback in legacy mode (no expectedState)", async () => {
    vi.useFakeTimers();
    let handler;
    const closed = vi.fn();
    _deps.createServer = (h) => {
      handler = h;
      return { on: () => {}, listen: () => {}, close: closed };
    };
    const p = oauth.waitForCallback({
      port: 0,
      path: "/callback",
      timeout: 60_000,
    });
    handler({ url: "/callback" }, { writeHead: () => {}, end: () => {} });
    await expect(p).rejects.toThrow(/no authorization code/);
    expect(closed).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("HTTPS endpoint enforcement", () => {
  it("isLoopbackHost recognizes loopback addresses (incl. bracketed IPv6)", () => {
    for (const h of ["localhost", "127.0.0.1", "127.0.0.5", "::1", "[::1]"]) {
      expect(oauth.isLoopbackHost(h)).toBe(true);
    }
    for (const h of [
      "example.com",
      "0.0.0.0",
      "8.8.8.8",
      "127.0.0.1.evil.com",
    ]) {
      expect(oauth.isLoopbackHost(h)).toBe(false);
    }
  });

  it("assertSecureEndpoint allows https and loopback http, rejects remote http", () => {
    expect(oauth.assertSecureEndpoint("https://auth.example.com/token")).toBe(
      "https://auth.example.com/token",
    );
    expect(oauth.assertSecureEndpoint("http://127.0.0.1:8080/token")).toBe(
      "http://127.0.0.1:8080/token",
    );
    expect(oauth.assertSecureEndpoint("http://localhost/token")).toBe(
      "http://localhost/token",
    );
    expect(() =>
      oauth.assertSecureEndpoint(
        "http://auth.example.com/token",
        "token_endpoint",
      ),
    ).toThrow(/HTTPS is required|insecure/i);
    expect(() => oauth.assertSecureEndpoint("not a url")).toThrow(
      /not a valid URL/i,
    );
  });

  it("buildAuthorizeUrl refuses a cleartext remote authorization_endpoint", () => {
    expect(() =>
      oauth.buildAuthorizeUrl(
        { authorization_endpoint: "http://auth.example.com/authorize" },
        {
          clientId: "c",
          redirectUri: "http://127.0.0.1:53682/callback",
          codeChallenge: "x",
          state: "s",
        },
      ),
    ).toThrow(/insecure|HTTPS is required/i);
  });

  it("buildAuthorizeUrl allows a loopback http authorization_endpoint (dev)", () => {
    const url = oauth.buildAuthorizeUrl(
      { authorization_endpoint: "http://127.0.0.1:9000/authorize" },
      {
        clientId: "c",
        redirectUri: "http://127.0.0.1:53682/callback",
        codeChallenge: "x",
        state: "s",
      },
    );
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9000\/authorize\?/);
  });

  it("exchangeCodeForToken refuses a cleartext remote token_endpoint before fetching", async () => {
    const fetchSpy = vi.fn();
    const orig = oauth._deps.fetch;
    oauth._deps.fetch = fetchSpy;
    try {
      await expect(
        oauth.exchangeCodeForToken(
          { token_endpoint: "http://auth.example.com/token" },
          {
            code: "abc",
            codeVerifier: "v",
            clientId: "c",
            redirectUri: "http://127.0.0.1:53682/callback",
          },
        ),
      ).rejects.toThrow(/insecure|HTTPS is required/i);
      expect(fetchSpy).not.toHaveBeenCalled(); // refused before any network I/O
    } finally {
      oauth._deps.fetch = orig;
    }
  });

  it("refreshAccessToken refuses a cleartext remote token_endpoint (stored-record path)", async () => {
    const fetchSpy = vi.fn();
    const orig = oauth._deps.fetch;
    oauth._deps.fetch = fetchSpy;
    try {
      await expect(
        oauth.refreshAccessToken(
          { token_endpoint: "http://auth.example.com/token" },
          { refreshToken: "r", clientId: "c" },
        ),
      ).rejects.toThrow(/insecure|HTTPS is required/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      oauth._deps.fetch = orig;
    }
  });
});

describe("token store cross-process lock", () => {
  // A fake fs with the lock primitives + an atomic-rename store, backed by an
  // in-memory file map, so the O_EXCL lock path is actually exercised.
  function makeLockFs({
    initialStore = null,
    lockHeld = false,
    lockMtimeMs,
  } = {}) {
    const files = new Map();
    const storeFile = oauth.tokenStorePath();
    const lockPath = `${storeFile}.lock`;
    if (initialStore) files.set(storeFile, JSON.stringify(initialStore));
    const lockMtimes = new Map();
    if (lockHeld) {
      files.set(lockPath, "");
      lockMtimes.set(lockPath, lockMtimeMs ?? Date.now());
    }
    const calls = [];
    const fs = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => {
        if (!files.has(p)) {
          const e = new Error("ENOENT");
          e.code = "ENOENT";
          throw e;
        }
        return files.get(p);
      },
      writeFileSync: (p, c) => files.set(p, c),
      mkdirSync: () => {},
      renameSync: (a, b) => {
        files.set(b, files.get(a));
        files.delete(a);
      },
      chmodSync: () => {},
      unlinkSync: (p) => {
        calls.push(p === lockPath ? "unlink:lock" : "unlink:other");
        files.delete(p);
        lockMtimes.delete(p);
      },
      openSync: (p, flag) => {
        calls.push(`open:${flag}`);
        if (flag === "wx" && files.has(p)) {
          const e = new Error("EEXIST");
          e.code = "EEXIST";
          throw e;
        }
        files.set(p, "");
        if (p === lockPath) lockMtimes.set(p, Date.now());
        return 99;
      },
      closeSync: () => calls.push("close"),
      statSync: (p) => ({ mtimeMs: lockMtimes.get(p) ?? 0 }),
    };
    return { fs, files, calls, storeFile, lockPath };
  }

  it("acquires (O_EXCL) and releases the lock around a write", () => {
    const { fs, calls, files, storeFile } = makeLockFs();
    _deps.fs = fs;
    const rec = oauth.saveStoredToken("https://m.example.com/mcp", {
      access_token: "AT",
    });
    expect(rec.access_token).toBe("AT");
    expect(calls).toContain("open:wx"); // exclusive create
    expect(calls).toContain("close");
    expect(calls).toContain("unlink:lock"); // released
    const saved = JSON.parse(files.get(storeFile));
    expect(
      saved[oauth.serverKey("https://m.example.com/mcp")].access_token,
    ).toBe("AT");
  });

  it("re-reads inside the lock so a concurrent server's token isn't lost", () => {
    const { fs, files, storeFile } = makeLockFs({
      initialStore: {
        "https://a.example.com": {
          server: "https://a.example.com",
          access_token: "A",
        },
      },
    });
    _deps.fs = fs;
    oauth.saveStoredToken("https://b.example.com/mcp", { access_token: "B" });
    const saved = JSON.parse(files.get(storeFile));
    expect(saved["https://a.example.com"].access_token).toBe("A"); // preserved
    expect(
      saved[oauth.serverKey("https://b.example.com/mcp")].access_token,
    ).toBe("B");
  });

  it("steals a stale lock left by a crashed holder", () => {
    const { fs, calls, files, storeFile } = makeLockFs({
      lockHeld: true,
      lockMtimeMs: Date.now() - 60_000, // older than STALE_MS (10s)
    });
    _deps.fs = fs;
    oauth.saveStoredToken("https://m.example.com/mcp", { access_token: "AT" });
    // First open throws EEXIST → stale lock unlinked (stolen) → second open wins.
    expect(calls.filter((c) => c === "open:wx").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(calls).toContain("unlink:lock");
    const saved = JSON.parse(files.get(storeFile));
    expect(
      saved[oauth.serverKey("https://m.example.com/mcp")].access_token,
    ).toBe("AT");
  });

  it("runs unlocked when the fs lacks lock primitives (back-compat)", () => {
    const files = new Map();
    _deps.fs = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => files.get(p),
      writeFileSync: (p, c) => files.set(p, c),
      mkdirSync: () => {},
      // no openSync/closeSync/unlinkSync → unlocked fallback
    };
    const rec = oauth.saveStoredToken("https://m.example.com/mcp", {
      access_token: "AT",
    });
    expect(rec.access_token).toBe("AT");
  });
});

describe("defaultOpenBrowser", () => {
  let spawned;
  beforeEach(() => {
    spawned = [];
    _deps.spawn = vi.fn((cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return { unref: vi.fn() };
    });
  });

  it("win32: never routes the URL through cmd.exe — rundll32 gets it as ONE verbatim argv entry (cmd /c start truncated at the first & and RAN the remainder as commands)", () => {
    const url =
      "https://auth.example.com/authorize?client_id=x&state=y&scope=mcp";
    const ok = oauth.defaultOpenBrowser(url, "win32");
    expect(ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].cmd).toBe("rundll32");
    expect(spawned[0].cmd).not.toBe("cmd");
    expect(spawned[0].args).toEqual(["url.dll,FileProtocolHandler", url]);
  });

  it("rejects non-http(s) schemes from remote metadata (file:, custom handlers) without spawning", () => {
    expect(
      oauth.defaultOpenBrowser("file:///C:/Windows/evil.bat", "win32"),
    ).toBe(false);
    expect(
      oauth.defaultOpenBrowser("ms-settings:network?x=1&calc", "win32"),
    ).toBe(false);
    expect(oauth.defaultOpenBrowser("not a url at all", "linux")).toBe(false);
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it("darwin/linux: passes the URL as a single argv entry to open/xdg-open", () => {
    const url = "https://a.example/cb?a=1&b=2";
    expect(oauth.defaultOpenBrowser(url, "darwin")).toBe(true);
    expect(oauth.defaultOpenBrowser(url, "linux")).toBe(true);
    expect(spawned[0]).toMatchObject({ cmd: "open", args: [url] });
    expect(spawned[1]).toMatchObject({ cmd: "xdg-open", args: [url] });
  });

  it("returns false when spawn throws (no browser available)", () => {
    _deps.spawn = vi.fn(() => {
      throw new Error("ENOENT");
    });
    expect(oauth.defaultOpenBrowser("https://a.example/", "linux")).toBe(false);
  });
});
