import { describe, it, expect, afterEach } from "vitest";
import {
  assertRegistryUrlSafe,
  fetchRegistry,
} from "../../src/lib/plugin-runtime/remote-source.js";
import { fetchGitRepo, _deps } from "../../src/lib/plugin-runtime/install.js";

const savedEnv = process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP;
  else process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP = savedEnv;
});

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
