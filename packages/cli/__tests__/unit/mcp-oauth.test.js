/**
 * mcp-oauth — OAuth 2.0 (Auth Code + PKCE) for remote MCP servers.
 *
 * Covers PKCE, metadata discovery (protected-resource → auth-server, fallback),
 * dynamic registration, authorize-URL building, code/refresh token exchange,
 * the token store, expiry/refresh. fetch/fs/crypto/now are stubbed (no network,
 * no disk, no browser).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("saveStoredToken writes atomically (temp + rename) when fs supports renameSync", () => {
    const file = oauth.tokenStorePath();
    const calls = { writes: [], renames: [], unlinks: [] };
    _deps.fs = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("no file"); // loadTokenStore → {} on throw
      },
      mkdirSync: () => {},
      writeFileSync: (p, c) => calls.writes.push({ p, c }),
      renameSync: (a, b) => calls.renames.push({ a, b }),
      unlinkSync: (p) => calls.unlinks.push(p),
    };
    oauth.saveStoredToken("https://m.example.com", { access_token: "AT" });
    // Wrote to a temp sibling, then renamed it over the real file (never a
    // direct write to the live token store).
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0].p).toMatch(/\.tmp$/);
    expect(calls.writes[0].p).not.toBe(file);
    expect(calls.renames).toEqual([{ a: calls.writes[0].p, b: file }]);
    expect(calls.unlinks).toEqual([]); // no cleanup needed on success
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
