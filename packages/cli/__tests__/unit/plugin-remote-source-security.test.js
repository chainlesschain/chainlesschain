import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps as remoteSourceDeps,
  assertRegistryUrlSafe,
  fetchRegistry,
  normalizeRegistryPluginSource,
  resolveRemoteSource,
  registryCachePath,
} from "../../src/lib/plugin-runtime/remote-source.js";
import { fetchGitRepo, _deps } from "../../src/lib/plugin-runtime/install.js";
import { _resetPluginManagedPolicyCache } from "../../src/lib/plugin-security.js";

const savedEnv = process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP;
let originalRemoteSourceDeps;
let cacheRoot;

beforeEach(() => {
  _resetPluginManagedPolicyCache();
  originalRemoteSourceDeps = { ...remoteSourceDeps };
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-registry-cache-"));
});

afterEach(() => {
  _resetPluginManagedPolicyCache();
  Object.assign(remoteSourceDeps, originalRemoteSourceDeps);
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP;
  else process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP = savedEnv;
});

function registryResponse(document, overrides = {}) {
  const text = JSON.stringify(document);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => String(Buffer.byteLength(text)) },
    text: async () => text,
    ...overrides,
  };
}

describe("registry URL transport security", () => {
  it("accepts https and loopback http", () => {
    expect(() =>
      assertRegistryUrlSafe("https://registry.example/index.json"),
    ).not.toThrow();
    expect(() =>
      assertRegistryUrlSafe("http://localhost:8080/index.json"),
    ).not.toThrow();
    expect(() =>
      assertRegistryUrlSafe("http://127.0.0.1/index.json"),
    ).not.toThrow();
    expect(() =>
      assertRegistryUrlSafe("http://[::1]:9000/index.json"),
    ).not.toThrow();
  });

  it("rejects a plain-HTTP registry (MITM controls source AND sha256)", () => {
    expect(() =>
      assertRegistryUrlSafe("http://registry.example/index.json"),
    ).toThrow(/plain-HTTP registry rejected/);
  });

  it("allows plain HTTP only with the explicit opt-in (flag or env)", () => {
    expect(() =>
      assertRegistryUrlSafe("http://registry.example/index.json", {
        allowInsecure: true,
      }),
    ).not.toThrow();
    process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP = "1";
    expect(() =>
      assertRegistryUrlSafe("http://registry.example/index.json"),
    ).not.toThrow();
  });

  it("rejects non-http(s) and unparseable registry URLs", () => {
    expect(() => assertRegistryUrlSafe("ftp://x/index.json")).toThrow(
      /must be http/,
    );
    expect(() => assertRegistryUrlSafe("not a url")).toThrow(
      /invalid registry URL/,
    );
  });

  it("fetchRegistry enforces the guard before touching network OR cache", async () => {
    // No fetch stub needed: the guard must throw first.
    await expect(
      fetchRegistry("http://registry.example/index.json"),
    ).rejects.toThrow(/plain-HTTP registry rejected/);
  });

  it("publishes a digest-addressed document and explicit offline mode never fetches", async () => {
    const url = "https://registry.example/index.json";
    const document = {
      plugins: [{ name: "safe-plugin", source: "owner/safe-plugin" }],
    };
    const bytes = Buffer.from(JSON.stringify(document));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    remoteSourceDeps.fetch = vi.fn(async () => registryResponse(document));

    await expect(fetchRegistry(url, { cacheDir: cacheRoot })).resolves.toEqual({
      registry: document,
      fromCache: false,
      documentSha256: digest,
    });
    expect(fs.readFileSync(registryCachePath(url, cacheRoot, digest))).toEqual(
      bytes,
    );

    remoteSourceDeps.fetch.mockClear();
    const cached = await fetchRegistry(url, {
      cacheDir: cacheRoot,
      offline: true,
      expectedSha256: digest,
    });
    expect(cached).toEqual({
      registry: document,
      fromCache: true,
      documentSha256: digest,
    });
    expect(remoteSourceDeps.fetch).not.toHaveBeenCalled();
  });

  it("enforces canonical managed policy before transport construction or DNS", async () => {
    remoteSourceDeps.fetch = vi.fn(async () => {
      throw new Error("network must remain unreachable");
    });
    await expect(
      resolveRemoteSource(
        "https://REGISTRY.example:443/catalog?tenant=a%2Fb#ignored",
        {
          name: "blocked",
          cacheDir: cacheRoot,
          managedPolicy: {
            blockedMarketplaces: [
              {
                source: "url",
                url: "https://registry.example/catalog?tenant=a%2Fb",
              },
            ],
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "PLUGIN_SOURCE_POLICY_BLOCKED",
      sourceIdentity: "url:https://registry.example/catalog?[REDACTED]",
    });
    expect(remoteSourceDeps.fetch).not.toHaveBeenCalled();
    expect(fs.readdirSync(cacheRoot)).toEqual([]);
  });

  it("does not let a null API override disable on-disk managed policy", async () => {
    const url = "https://registry.example/index.json";
    const managedSettingsFile = path.join(cacheRoot, "managed-settings.json");
    fs.writeFileSync(
      managedSettingsFile,
      JSON.stringify({ blockedMarketplaces: [{ source: "url", url }] }),
    );
    _resetPluginManagedPolicyCache();
    remoteSourceDeps.fetch = vi.fn(async () => {
      throw new Error("network must remain unreachable");
    });
    await expect(
      fetchRegistry(url, {
        allowCache: false,
        managedPolicy: null,
        managedSettingsFile,
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_SOURCE_POLICY_BLOCKED" });
    expect(remoteSourceDeps.fetch).not.toHaveBeenCalled();
  });

  it("rejects cache tampering and ambiguous unpinned history", async () => {
    const url = "https://registry.example/index.json";
    const first = {
      plugins: [{ name: "safe-plugin", source: "owner/one" }],
    };
    const second = {
      plugins: [{ name: "safe-plugin", source: "owner/two" }],
    };
    remoteSourceDeps.fetch = vi
      .fn()
      .mockResolvedValueOnce(registryResponse(first))
      .mockResolvedValueOnce(registryResponse(second));
    const firstFetch = await fetchRegistry(url, { cacheDir: cacheRoot });
    const secondFetch = await fetchRegistry(url, { cacheDir: cacheRoot });

    await expect(
      fetchRegistry(url, { cacheDir: cacheRoot, offline: true }),
    ).rejects.toThrow(/cache is ambiguous/);
    await expect(
      fetchRegistry(url, {
        cacheDir: cacheRoot,
        offline: true,
        expectedSha256: firstFetch.documentSha256,
      }),
    ).resolves.toMatchObject({ registry: first, fromCache: true });

    fs.writeFileSync(
      registryCachePath(url, cacheRoot, secondFetch.documentSha256),
      JSON.stringify(first),
    );
    await expect(
      fetchRegistry(url, {
        cacheDir: cacheRoot,
        offline: true,
        expectedSha256: secondFetch.documentSha256,
      }),
    ).rejects.toThrow(/digest mismatch/);
  });

  it("does not reflect corrupt pinned offline cache bytes", async () => {
    const url = "https://registry.example/index.json";
    const bytes = Buffer.from("SECRET_CACHE_BODY", "utf8");
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const file = registryCachePath(url, cacheRoot, digest);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    let failure;
    try {
      await fetchRegistry(url, {
        cacheDir: cacheRoot,
        offline: true,
        expectedSha256: digest,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toMatch(/cache document is invalid/u);
    expect(failure?.message).not.toContain("SECRET_CACHE_BODY");
  });

  it("does not let an authentication failure silently fall back to cache", async () => {
    const url = "https://registry.example/index.json";
    const document = {
      plugins: [{ name: "safe-plugin", source: "owner/safe-plugin" }],
    };
    remoteSourceDeps.fetch = vi
      .fn()
      .mockResolvedValueOnce(registryResponse(document))
      .mockResolvedValueOnce(
        registryResponse(document, {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      );
    await fetchRegistry(url, { cacheDir: cacheRoot });
    await expect(fetchRegistry(url, { cacheDir: cacheRoot })).rejects.toThrow(
      /HTTP 401/,
    );
  });

  it("requests manual redirects and fails closed without reading the body", async () => {
    let requestOptions;
    const text = vi.fn(async () => "redirect body must not be read");
    remoteSourceDeps.fetch = vi.fn(async (_url, options) => {
      requestOptions = options;
      return {
        ok: false,
        status: 302,
        statusText: "Found",
        headers: { get: () => "0" },
        text,
      };
    });
    await expect(
      fetchRegistry("https://registry.example/index.json", {
        cacheDir: cacheRoot,
      }),
    ).rejects.toThrow(/redirects are disabled/);
    expect(requestOptions.redirect).toBe("manual");
    expect(text).not.toHaveBeenCalled();
    expect(fs.readdirSync(cacheRoot)).toEqual([]);
  });

  it("applies blocked-source policy to the registry-resolved git ref", async () => {
    const url = "https://registry.example/index.json?tenant=acme";
    const resolved = "https://github.com/acme/blocked.git#release";
    remoteSourceDeps.fetch = vi.fn(async () =>
      registryResponse({
        plugins: [
          {
            name: "blocked",
            source: "https://github.com/acme/blocked.git",
            ref: "release",
          },
        ],
      }),
    );
    await expect(
      resolveRemoteSource(url, {
        name: "blocked",
        cacheDir: cacheRoot,
        managedPolicy: {
          allowedMarketplaces: [{ source: "url", url }],
          blockedPluginSources: [resolved],
        },
      }),
    ).rejects.toMatchObject({
      code: "PLUGIN_SOURCE_POLICY_BLOCKED",
      sourceIdentity: "github:https://github.com/acme/blocked",
    });
    expect(remoteSourceDeps.fetch).toHaveBeenCalledOnce();
  });

  it("does not reuse the registry allowlist as a resolved-source allowlist", async () => {
    const url = "https://registry.example/index.json";
    remoteSourceDeps.fetch = vi.fn(async () =>
      registryResponse({
        plugins: [{ name: "safe", source: "acme/safe" }],
      }),
    );
    await expect(
      resolveRemoteSource(url, {
        name: "safe",
        cacheDir: cacheRoot,
        managedPolicy: {
          allowedMarketplaces: [{ source: "url", url }],
        },
      }),
    ).resolves.toMatchObject({ source: "acme/safe" });
  });

  it("rejects local, file, unbounded, and non-string registry sources", () => {
    for (const source of [
      "./local-plugin",
      "file:///tmp/local-plugin.git",
      "relative.git",
      "x".repeat(4097),
      { url: "https://github.com/acme/review.git" },
    ]) {
      expect(() => normalizeRegistryPluginSource({ source })).toThrow(
        /registry plugin source/u,
      );
    }
  });

  it("rejects registry URL userinfo before policy or transport", async () => {
    const url =
      "https://alice:password@registry.example/index.json?token=secret";
    remoteSourceDeps.fetch = vi.fn(async () => {
      throw new Error("transport must remain unreachable");
    });
    let failure;
    try {
      await fetchRegistry(url, {
        allowCache: false,
        managedPolicy: {
          allowedMarketplaces: [
            {
              source: "url",
              url: "https://registry.example/index.json?token=secret",
            },
          ],
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toBe("registry URL credentials are not supported");
    expect(failure?.message).not.toMatch(/alice|password|token|secret/u);
    expect(remoteSourceDeps.fetch).not.toHaveBeenCalled();
  });

  it("never reflects untrusted body, status, or transport diagnostics", async () => {
    const url = "https://registry.example/index.json";
    const attempts = [
      {
        secret: "SECRET_STATUS_TEXT",
        fetch: async () => ({
          ok: false,
          status: 418,
          statusText: "SECRET_STATUS_TEXT",
          headers: { get: () => "0" },
          text: async () => "",
        }),
        expected: /HTTP 418/u,
      },
      {
        secret: "SECRET_RESPONSE_BODY",
        fetch: async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "20" },
          text: async () => "SECRET_RESPONSE_BODY",
        }),
        expected: /registry document is invalid/u,
      },
      {
        secret: "SECRET_TRANSPORT_DETAIL",
        fetch: async () => {
          throw new Error("SECRET_TRANSPORT_DETAIL");
        },
        expected: /registry request failed/u,
      },
    ];
    for (const attempt of attempts) {
      remoteSourceDeps.fetch = vi.fn(attempt.fetch);
      let failure;
      try {
        await fetchRegistry(url, {
          allowCache: false,
          managedPolicy: null,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure?.message).toMatch(attempt.expected);
      expect(failure?.message).not.toContain(attempt.secret);
    }
  });
});

describe("git argv-injection guard (fetchGitRepo)", () => {
  it("refuses an option-looking url / ref without ever invoking git", () => {
    const orig = _deps.spawnSync;
    let spawned = 0;
    _deps.spawnSync = () => {
      spawned++;
      return { status: 0 };
    };
    try {
      expect(() => fetchGitRepo("--upload-pack=evil.git", null)).toThrow(
        /looks like an option/,
      );
      expect(() => fetchGitRepo("https://github.com/a/b.git", "-f")).toThrow(
        /looks like an option/,
      );
      expect(spawned).toBe(0); // git was never reached with the hostile argv
    } finally {
      _deps.spawnSync = orig;
    }
  });
});
