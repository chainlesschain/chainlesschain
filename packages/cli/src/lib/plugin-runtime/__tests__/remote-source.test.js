/**
 * remote-source tests — resolving a plugin from a hosted registry/manifest URL,
 * with private-token auth and an offline cache. `fetch` and fs are injected via
 * `_deps` so nothing hits the network or the real disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isRemoteSource,
  validateRegistry,
  resolvePluginEntry,
  listRegistryPlugins,
  resolveRegistryToken,
  fetchRegistry,
  resolveRemoteSource,
  registryCachePath,
  _deps,
} from "../remote-source.js";

const REGISTRY = {
  name: "acme",
  plugins: [
    {
      name: "toml-tools",
      source: "https://github.com/x/toml.git",
      ref: "v1.0.0",
      version: "1.0.0",
      description: "TOML LSP",
      sha256: "abc123",
    },
    { name: "py-helpers", source: "owner/py-helpers" },
  ],
};

/** A fake in-memory fs + fetch wired into _deps. */
function install(fakes = {}) {
  const files = new Map(fakes.files || []);
  _deps.existsSync = (p) => files.has(String(p));
  _deps.readFileSync = (p) => {
    if (!files.has(String(p))) throw new Error("ENOENT");
    return files.get(String(p));
  };
  _deps.writeFileSync = (p, text) => files.set(String(p), text);
  _deps.mkdirSync = () => {};
  if (fakes.fetch) _deps.fetch = fakes.fetch;
  return files;
}

/** Build a fetch that returns JSON once, then throws (to test caching). */
function okThenOffline(body) {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls === 1) {
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }
    throw new Error("ECONNREFUSED");
  });
}

let orig;
beforeEach(() => {
  orig = { ..._deps };
  delete process.env.CC_PLUGIN_REGISTRY_TOKEN;
});
afterEach(() => {
  Object.assign(_deps, orig);
  vi.restoreAllMocks();
  delete process.env.CC_PLUGIN_REGISTRY_TOKEN;
});

describe("isRemoteSource", () => {
  it("recognizes http(s) .json URLs", () => {
    expect(isRemoteSource("https://x.com/registry.json")).toBe(true);
    expect(isRemoteSource("http://x.com/a/b.json?ref=1")).toBe(true);
  });
  it("rejects local dirs, git URLs, and owner/repo", () => {
    expect(isRemoteSource("./plugins/foo")).toBe(false);
    expect(isRemoteSource("https://github.com/x/foo.git")).toBe(false);
    expect(isRemoteSource("owner/repo")).toBe(false);
  });
});

describe("validateRegistry", () => {
  it("accepts a multi-plugin index", () => {
    expect(validateRegistry(REGISTRY).plugins).toHaveLength(2);
  });
  it("wraps a single-plugin manifest into a one-entry registry", () => {
    const r = validateRegistry({
      name: "solo",
      source: "owner/solo",
      ref: "v2",
    });
    expect(r.plugins).toEqual([
      { name: "solo", source: "owner/solo", ref: "v2" },
    ]);
  });
  it("rejects garbage and entries missing name/source", () => {
    expect(() => validateRegistry(null)).toThrow(/not a JSON object/);
    expect(() => validateRegistry({ foo: 1 })).toThrow(
      /plugins.*array.*source/,
    );
    expect(() => validateRegistry({ plugins: [{ name: "x" }] })).toThrow(
      /missing name\/source/,
    );
  });
});

describe("resolvePluginEntry", () => {
  it("selects by name", () => {
    expect(resolvePluginEntry(REGISTRY, "py-helpers").source).toBe(
      "owner/py-helpers",
    );
  });
  it("auto-selects the sole plugin when name omitted", () => {
    const solo = { plugins: [REGISTRY.plugins[0]] };
    expect(resolvePluginEntry(solo).name).toBe("toml-tools");
  });
  it("requires a name when the registry has many", () => {
    expect(() => resolvePluginEntry(REGISTRY)).toThrow(/pick one with --name/);
  });
  it("lists options when the name is unknown", () => {
    expect(() => resolvePluginEntry(REGISTRY, "nope")).toThrow(
      /not found.*toml-tools, py-helpers/s,
    );
  });
});

describe("resolveRegistryToken", () => {
  it("prefers an explicit token, then env, then per-host config", () => {
    expect(
      resolveRegistryToken("https://h/r.json", { token: "explicit" }),
    ).toBe("explicit");
    process.env.CC_PLUGIN_REGISTRY_TOKEN = "envtok";
    expect(resolveRegistryToken("https://h/r.json", {})).toBe("envtok");
    delete process.env.CC_PLUGIN_REGISTRY_TOKEN;
    const config = { plugins: { registryTokens: { "priv.co": "cfgtok" } } };
    expect(resolveRegistryToken("https://priv.co/r.json", { config })).toBe(
      "cfgtok",
    );
    expect(
      resolveRegistryToken("https://other.co/r.json", { config }),
    ).toBeNull();
  });
});

describe("fetchRegistry", () => {
  it("fetches, validates, and caches; sends a bearer token when given", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(REGISTRY),
    }));
    install({ fetch });
    const { registry, fromCache } = await fetchRegistry("https://h/r.json", {
      token: "t",
      cacheDir: "/cache",
    });
    expect(fromCache).toBe(false);
    expect(registry.plugins).toHaveLength(2);
    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer t");
  });

  it("falls back to the offline cache when the network fails", async () => {
    const fetch = okThenOffline(REGISTRY);
    install({ fetch });
    // 1st call populates the cache
    await fetchRegistry("https://h/r.json", { cacheDir: "/cache" });
    // 2nd call: network throws → served from cache
    const { registry, fromCache } = await fetchRegistry("https://h/r.json", {
      cacheDir: "/cache",
    });
    expect(fromCache).toBe(true);
    expect(registry.plugins).toHaveLength(2);
  });

  it("throws on HTTP error with no cache", async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    }));
    install({ fetch });
    await expect(
      fetchRegistry("https://h/missing.json", { cacheDir: "/cache" }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("throws when offline and nothing is cached", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    install({ fetch });
    await expect(
      fetchRegistry("https://h/r.json", { cacheDir: "/cache" }),
    ).rejects.toThrow(/no offline cache/);
  });
});

describe("resolveRemoteSource", () => {
  it("resolves a named entry to a git source string with a #ref and carries sha256", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(REGISTRY),
    }));
    install({ fetch });
    const r = await resolveRemoteSource("https://h/r.json", {
      name: "toml-tools",
      cacheDir: "/cache",
    });
    expect(r.source).toBe("https://github.com/x/toml.git#v1.0.0");
    expect(r.sha256).toBe("abc123");
    expect(r.fromCache).toBe(false);
  });

  it("omits the #ref when the entry has none", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(REGISTRY),
    }));
    install({ fetch });
    const r = await resolveRemoteSource("https://h/r.json", {
      name: "py-helpers",
      cacheDir: "/cache",
    });
    expect(r.source).toBe("owner/py-helpers");
    expect(r.ref).toBeNull();
  });
});

describe("listRegistryPlugins", () => {
  it("flattens entries for display", () => {
    const rows = listRegistryPlugins(REGISTRY);
    expect(rows.map((r) => r.name)).toEqual(["toml-tools", "py-helpers"]);
    expect(rows[0]).toMatchObject({
      version: "1.0.0",
      ref: "v1.0.0",
      description: "TOML LSP",
    });
  });
});

describe("registryCachePath", () => {
  it("is stable and content-addressed by URL", () => {
    const a = registryCachePath("https://h/r.json", "/cache");
    const b = registryCachePath("https://h/r.json", "/cache");
    const c = registryCachePath("https://h/OTHER.json", "/cache");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.endsWith(".json")).toBe(true);
  });
});
