import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  statSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config-manager", () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-config-test-"));
    configPath = join(tempDir, "config.json");
    vi.resetModules();
    // Mock getConfigPath to use temp dir
    vi.doMock("../../src/lib/paths.js", () => ({
      getConfigPath: () => configPath,
    }));
    // Filesystem ACL behavior has dedicated injected cross-platform tests in
    // config-security.test.js. Keep config-manager tests focused on atomic
    // persistence without launching a real PowerShell ACL repair for every
    // temporary directory in the restricted test sandbox.
    vi.doMock("../../src/lib/secure-fs.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        ensurePrivateDirectory: (target) => {
          mkdirSync(target, { recursive: true, mode: 0o700 });
          if (process.platform !== "win32") chmodSync(target, 0o700);
          return target;
        },
        ensurePrivateFile: (target) => {
          if (process.platform !== "win32") chmodSync(target, 0o600);
          return target;
        },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig returns defaults when no file exists", async () => {
    const { loadConfig } = await import("../../src/lib/config-manager.js");
    const config = loadConfig();
    expect(config.setupCompleted).toBe(false);
    expect(config.edition).toBe("personal");
    expect(config.llm.provider).toBe("volcengine");
  });

  it("saveConfig writes JSON file", async () => {
    const { saveConfig } = await import("../../src/lib/config-manager.js");
    saveConfig({
      setupCompleted: true,
      edition: "enterprise",
      llm: { provider: "openai" },
    });
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.setupCompleted).toBe(true);
    expect(parsed.edition).toBe("enterprise");
  });

  it("saveConfig writes atomically (valid JSON, no .tmp leftover)", async () => {
    const { saveConfig } = await import("../../src/lib/config-manager.js");
    saveConfig({ llm: { apiKey: "sk-secret", provider: "openai" } });
    // The config file is complete + parseable (atomic rename → never partial).
    expect(JSON.parse(readFileSync(configPath, "utf-8")).llm.apiKey).toBe(
      "sk-secret",
    );
    // No temp sibling left behind after a successful write.
    const leftovers = readdirSync(tempDir).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("writes config.json with owner-only POSIX permissions", async () => {
    const { saveConfig } = await import("../../src/lib/config-manager.js");
    saveConfig({ edition: "personal" });
    if (process.platform !== "win32") {
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      expect(statSync(tempDir).mode & 0o777).toBe(0o700);
    }
  });

  it("stores schema secrets by OS-store reference and resolves them", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const values = new Map();
    const store = {
      name: "memory",
      set: (key, value) => values.set(key, value),
      get: (key) => values.get(key) ?? null,
    };
    mod._deps.createSecretStore = () => store;
    const result = mod.setSecretConfigValue("llm.apiKey", "private-value", {
      storage: "keychain",
      configMutator: (config) => {
        config.edition = "enterprise";
      },
    });
    expect(result).toMatchObject({ storage: "keychain", backend: "memory" });
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    expect(raw.llm.apiKey.__cc_secret_ref).toMatch(
      /^config\/[a-f0-9]{24}\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/,
    );
    expect(values.get(raw.llm.apiKey.__cc_secret_ref)).toBe("private-value");
    expect(raw.edition).toBe("enterprise");
    expect(JSON.stringify(raw)).not.toContain("private-value");
    expect(mod.getConfigValue("llm.apiKey")).toBe("private-value");
  });

  it("never treats a config write failure as permission to downgrade a stored secret", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const previousRef = "config/legacy/llm.apiKey";
    writeFileSync(
      configPath,
      JSON.stringify({ llm: { apiKey: { __cc_secret_ref: previousRef } } }),
    );
    const values = new Map([[previousRef, "previous-value"]]);
    const store = {
      name: "memory",
      set: vi.fn((ref, value) => {
        values.set(ref, value);
        // Simulate a persistence failure only after the keychain accepted the
        // value. A directory at config.json makes the atomic rename fail.
        rmSync(configPath, { force: true });
        mkdirSync(configPath);
      }),
      get: () => null,
      delete: vi.fn((ref) => values.delete(ref)),
    };
    let failure;
    try {
      mod.setSecretConfigValue("llm.apiKey", "must-not-fallback", {
        storage: "auto",
        secretStore: store,
      });
    } catch (error) {
      failure = error;
    }
    expect(store.set).toHaveBeenCalledOnce();
    const newRef = store.set.mock.calls[0][0];
    expect(newRef).not.toBe(previousRef);
    expect(store.delete).toHaveBeenCalledWith(newRef);
    expect(values.get(previousRef)).toBe("previous-value");
    expect(values.has(newRef)).toBe(false);
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.code).not.toBe("CONFIG_SECRET_STORE_UNAVAILABLE");
    expect(statSync(configPath).isDirectory()).toBe(true);
    expect(readdirSync(tempDir).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("replaces OS secrets with a new reference before retiring the old one", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const previousRef = "config/legacy/llm.apiKey";
    writeFileSync(
      configPath,
      JSON.stringify({ llm: { apiKey: { __cc_secret_ref: previousRef } } }),
    );
    const values = new Map([[previousRef, "previous-value"]]);
    const store = {
      name: "memory",
      set: vi.fn((ref, value) => values.set(ref, value)),
      get: vi.fn((ref) => values.get(ref) ?? null),
      delete: vi.fn((ref) => values.delete(ref)),
    };

    mod.setSecretConfigValue("llm.apiKey", "next-value", {
      storage: "keychain",
      secretStore: store,
    });

    const nextRef = JSON.parse(readFileSync(configPath, "utf8")).llm.apiKey
      .__cc_secret_ref;
    expect(nextRef).not.toBe(previousRef);
    expect(values.get(nextRef)).toBe("next-value");
    expect(values.has(previousRef)).toBe(false);
    expect(store.delete).toHaveBeenCalledWith(previousRef);
  });

  it("rejects prototype-polluting keys before merge or persistence", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    writeFileSync(configPath, '{"__proto__":{"polluted":"yes"}}');
    expect(() => mod.loadConfig({ failIfUnavailable: true })).toThrow(
      /Invalid configuration key/,
    );
    expect({}.polluted).toBeUndefined();
    expect(() =>
      mod.saveConfig(JSON.parse('{"constructor":{"prototype":{}}}')),
    ).toThrow(/Invalid configuration key/);
  });

  it("never resolves a secret reference from a non-secret schema path", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const get = vi.fn(() => "must-never-be-exposed");
    mod._deps.createSecretStore = () => ({ name: "memory", get });
    writeFileSync(
      configPath,
      JSON.stringify({
        features: {
          leak: { __cc_secret_ref: "config/llm.apiKey" },
        },
      }),
    );
    expect(() => mod.loadConfig({ failIfUnavailable: true })).toThrow(
      /non-secret key/,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("falls back to the owner-only file when auto OS storage is unavailable", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const result = mod.setSecretConfigValue("llm.apiKey", "fallback-value", {
      storage: "auto",
      secretStore: {
        name: "missing",
        set: () => {
          throw new Error("not installed");
        },
      },
    });
    expect(result.storage).toBe("file");
    expect(JSON.parse(readFileSync(configPath, "utf8")).llm.apiKey).toBe(
      "fallback-value",
    );
    if (process.platform !== "win32") {
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
    }
  });

  it("loadConfig merges saved values with defaults", async () => {
    const { saveConfig, loadConfig } =
      await import("../../src/lib/config-manager.js");
    saveConfig({ edition: "enterprise" });
    const config = loadConfig();
    expect(config.edition).toBe("enterprise");
    // Defaults should still be present
    expect(config.llm).toBeDefined();
    expect(config.services).toBeDefined();
  });

  it("getConfigValue reads nested keys", async () => {
    const { saveConfig, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    saveConfig({ llm: { provider: "deepseek", model: "deepseek-chat" } });
    expect(getConfigValue("llm.provider")).toBe("deepseek");
    expect(getConfigValue("llm.model")).toBe("deepseek-chat");
  });

  it("getConfigValue returns undefined for missing keys", async () => {
    const { getConfigValue } = await import("../../src/lib/config-manager.js");
    expect(getConfigValue("nonexistent.key")).toBeUndefined();
  });

  it("setConfigValue writes nested keys", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    setConfigValue("llm.provider", "openai");
    expect(getConfigValue("llm.provider")).toBe("openai");
  });

  it("setConfigValue parses boolean strings", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    setConfigValue("setupCompleted", "true");
    expect(getConfigValue("setupCompleted")).toBe(true);
  });

  it("rejects unknown keys unless extension development opts in", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    expect(() => setConfigValue("services.port", "8080")).toThrow(
      /Unknown configuration key/,
    );
    setConfigValue("services.port", "8080", { allowUnknown: true });
    expect(getConfigValue("services.port")).toBe(8080);
  });

  it("refuses secrets through the general setter", async () => {
    const { setConfigValue } = await import("../../src/lib/config-manager.js");
    expect(() => setConfigValue("llm.apiKey", "not-on-argv")).toThrow(
      /set-secret/,
    );
  });

  it("resetConfig restores defaults", async () => {
    const { setConfigValue, resetConfig, loadConfig } =
      await import("../../src/lib/config-manager.js");
    setConfigValue("edition", "enterprise");
    resetConfig();
    const config = loadConfig();
    expect(config.edition).toBe("personal");
    expect(config.setupCompleted).toBe(false);
  });

  it("reset removes an unreadable OS secret reference", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const remove = vi.fn(() => true);
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: { apiKey: { __cc_secret_ref: "config/llm.apiKey" } },
      }),
    );
    mod._deps.createSecretStore = () => ({
      get: () => {
        throw new Error("store unavailable");
      },
      delete: remove,
    });
    expect(mod.loadConfig().llm.apiKey).toBeNull();
    mod.resetConfig();
    expect(JSON.parse(readFileSync(configPath, "utf8")).llm.apiKey).toBeNull();
    expect(remove).toHaveBeenCalledWith("config/llm.apiKey");
  });

  it("warns when a persisted OS secret reference no longer exists", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const warn = vi.fn();
    mod._deps.warn = warn;
    mod._deps.createSecretStore = () => ({ get: () => null });
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: { apiKey: { __cc_secret_ref: "config/missing-ref" } },
      }),
    );

    expect(mod.loadConfig().llm.apiKey).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/secret is missing.*llm\.apiKey/i);
  });

  it("loadConfig handles corrupt JSON gracefully", async () => {
    const { loadConfig } = await import("../../src/lib/config-manager.js");
    writeFileSync(configPath, "not valid json{{{", "utf-8");
    const config = loadConfig();
    expect(config.setupCompleted).toBe(false); // falls back to defaults
  });

  it("warns (once) that settings are ignored when the config is malformed", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const warn = vi.fn();
    mod._deps.warn = warn;
    writeFileSync(configPath, "{ broken json", "utf-8");

    const config = mod.loadConfig();
    expect(config.llm.provider).toBe("volcengine"); // still falls back, no throw
    // The silent drop is now visible and points at the file + what's lost.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(configPath);
    expect(warn.mock.calls[0][0]).toMatch(/IGNORED|defaults/i);

    // De-duped: a second load of the same bad path does not re-warn.
    mod.loadConfig();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("backs up a corrupt config and refuses to clobber it", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    const warn = vi.fn();
    mod._deps.warn = warn;
    const broken = '{ "llm": { "apiKey": "sk-precious" '; // truncated write
    writeFileSync(configPath, broken, "utf-8");

    mod.loadConfig();

    // The broken original survives as a sibling copy...
    const backupPath = `${configPath}.corrupted`;
    expect(readFileSync(backupPath, "utf-8")).toBe(broken);
    // ...the warning points at it...
    expect(warn.mock.calls[0][0]).toContain(`${configPath}.corrupted`);

    // A durable read-modify-write now fails closed. It must not replace the
    // broken source with defaults plus one new value.
    expect(() => mod.setConfigValue("edition", "enterprise")).toThrow(
      /durable config/,
    );
    expect(readFileSync(backupPath, "utf-8")).toBe(broken);
    expect(readFileSync(configPath, "utf-8")).toBe(broken);
  });

  it("does not create a backup when the config is healthy", async () => {
    const mod = await import("../../src/lib/config-manager.js");
    writeFileSync(configPath, '{ "edition": "personal" }', "utf-8");
    mod.loadConfig();
    const leftovers = readdirSync(tempDir).filter((n) =>
      n.endsWith(".corrupted"),
    );
    expect(leftovers).toEqual([]);
  });

  it("keeps the first owner-only pre-migration backup", async () => {
    const { backupConfigForMigration } =
      await import("../../src/lib/config-manager.js");
    writeFileSync(configPath, '{ "llm": { "fallbackModel": "old" } }');
    const backupPath = backupConfigForMigration(".before-schema-v1", {
      applyWindowsAcl: false,
    });
    expect(readFileSync(backupPath, "utf8")).toContain("fallbackModel");
    writeFileSync(configPath, '{ "llm": { "fallbackModels": ["new"] } }');
    backupConfigForMigration(".before-schema-v1", {
      applyWindowsAcl: false,
    });
    expect(readFileSync(backupPath, "utf8")).toContain("fallbackModel");
    if (process.platform !== "win32") {
      expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    }
  });

  describe("renameWithRetry (Windows EPERM hardening)", () => {
    it("retries transient rename errors then succeeds", async () => {
      const { renameWithRetry } =
        await import("../../src/lib/config-manager.js");
      let calls = 0;
      const sleeps = [];
      const _rename = () => {
        calls++;
        if (calls < 3) {
          const e = new Error("perm");
          e.code = "EPERM";
          throw e;
        }
      };
      renameWithRetry("a", "b", { _rename, _sleep: (ms) => sleeps.push(ms) });
      expect(calls).toBe(3); // failed twice, succeeded on third
      expect(sleeps.length).toBe(2); // backoff between the two failures
    });

    it("rethrows immediately for non-transient errors", async () => {
      const { renameWithRetry } =
        await import("../../src/lib/config-manager.js");
      let calls = 0;
      const _rename = () => {
        calls++;
        const e = new Error("nope");
        e.code = "ENOENT";
        throw e;
      };
      expect(() =>
        renameWithRetry("a", "b", { _rename, _sleep: () => {} }),
      ).toThrow(/nope/);
      expect(calls).toBe(1); // no retries for non-transient errors
    });

    it("gives up after the attempt budget and rethrows", async () => {
      const { renameWithRetry } =
        await import("../../src/lib/config-manager.js");
      let calls = 0;
      const _rename = () => {
        calls++;
        const e = new Error("busy");
        e.code = "EBUSY";
        throw e;
      };
      expect(() =>
        renameWithRetry("a", "b", { attempts: 4, _rename, _sleep: () => {} }),
      ).toThrow(/busy/);
      expect(calls).toBe(4);
    });
  });
});
