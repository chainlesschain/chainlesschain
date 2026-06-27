import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
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
    const { saveConfig, loadConfig } =
      await import("../../src/lib/config-manager.js");
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

  it("setConfigValue parses number strings", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    setConfigValue("services.port", "8080");
    expect(getConfigValue("services.port")).toBe(8080);
  });

  it("setConfigValue parses null string", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");
    setConfigValue("llm.apiKey", "null");
    expect(getConfigValue("llm.apiKey")).toBeNull();
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
