import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps as remoteSourceDeps,
  assertRegistryUrlSafe,
  fetchRegistry,
  registryCachePath,
} from "../../src/lib/plugin-runtime/remote-source.js";
import { fetchGitRepo, _deps } from "../../src/lib/plugin-runtime/install.js";

const savedEnv = process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP;
let originalRemoteSourceDeps;
let cacheRoot;

beforeEach(() => {
  originalRemoteSourceDeps = { ...remoteSourceDeps };
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-registry-cache-"));
});

afterEach(() => {
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
      /HTTP 401 Unauthorized/,
    );
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
