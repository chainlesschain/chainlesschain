import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
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
    // ACL behavior is covered by config-security.test.js. Keep this integration
    // focused on setup/config transactions in restricted Windows test runners.
    vi.doMock("../../src/lib/secure-fs.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        ensurePrivateDirectory: (target) => {
          mkdirSync(target, { recursive: true, mode: 0o700 });
          return target;
        },
        ensurePrivateFile: (target) => target,
      };
    });
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

  it("sets typed values and routes secrets through secure input storage", async () => {
    const { setConfigValue, setSecretConfigValue, getConfigValue } =
      await import("../../src/lib/config-manager.js");

    setConfigValue("llm.provider", "openai");
    setSecretConfigValue("llm.apiKey", "sk-test-key", { storage: "file" });
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

  it("refuses an empty credential before a required-provider switch", async () => {
    const { assertRequiredProviderCredential } =
      await import("../../src/commands/setup.js");

    expect(() =>
      assertRequiredProviderCredential({ requiresApiKey: true }, ""),
    ).toThrow(/API key is required/);
    expect(() =>
      assertRequiredProviderCredential({ requiresApiKey: false }, null),
    ).not.toThrow();
  });
});
