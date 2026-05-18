import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("setup flow (integration)", () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-setup-test-"));
    configPath = join(tempDir, "config.json");
    vi.resetModules();
    vi.doMock("../../src/lib/paths.js", () => ({
      getConfigPath: () => configPath,
      getHomeDir: () => tempDir,
      getBinDir: () => join(tempDir, "bin"),
      getStatePath: () => join(tempDir, "state"),
      getServicesDir: () => join(tempDir, "services"),
      getLogsDir: () => join(tempDir, "logs"),
      getCacheDir: () => join(tempDir, "cache"),
      ensureHomeDir: () => tempDir,
      ensureDir: (d) => d,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("config-manager round-trip: save then load", async () => {
    const { saveConfig, loadConfig } =
      await import("../../src/lib/config-manager.js");

    const config = {
      setupCompleted: true,
      completedAt: "2026-03-11T00:00:00.000Z",
      edition: "personal",
      llm: {
        provider: "ollama",
        model: "qwen2:7b",
        apiKey: null,
        baseUrl: "http://localhost:11434",
      },
    };
    saveConfig(config);
    expect(existsSync(configPath)).toBe(true);

    const loaded = loadConfig();
    expect(loaded.setupCompleted).toBe(true);
    expect(loaded.edition).toBe("personal");
    expect(loaded.llm.provider).toBe("ollama");
  });

  it("setConfigValue then getConfigValue for nested keys", async () => {
    const { setConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");

    setConfigValue("llm.provider", "openai");
    setConfigValue("llm.apiKey", "sk-test-key");
    setConfigValue("edition", "enterprise");

    expect(getConfigValue("llm.provider")).toBe("openai");
    expect(getConfigValue("llm.apiKey")).toBe("sk-test-key");
    expect(getConfigValue("edition")).toBe("enterprise");
  });

  it("resetConfig restores default state", async () => {
    const { setConfigValue, resetConfig, loadConfig } =
      await import("../../src/lib/config-manager.js");

    setConfigValue("setupCompleted", "true");
    setConfigValue("edition", "enterprise");

    resetConfig();
    const config = loadConfig();
    expect(config.setupCompleted).toBe(false);
    expect(config.edition).toBe("personal");
  });
});
