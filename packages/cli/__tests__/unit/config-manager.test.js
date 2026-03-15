import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
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
});
