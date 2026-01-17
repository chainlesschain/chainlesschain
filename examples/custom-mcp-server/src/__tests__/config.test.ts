/**
 * Config Module Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use default values when no env vars set", async () => {
    delete process.env.WEATHER_API_KEY;
    delete process.env.WEATHER_TIMEOUT;
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_PATH;

    const { config } = await import("../config.js");

    expect(config.apiKey).toBeUndefined();
    expect(config.timeout).toBe(30000);
    expect(config.logLevel).toBe("info");
    expect(config.logPath).toBe(".logs/weather-mcp-server.log");
  });

  it("should use environment variables when set", async () => {
    process.env.WEATHER_API_KEY = "test-api-key";
    process.env.WEATHER_TIMEOUT = "60000";
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_PATH = "/custom/path/log.txt";

    const { config } = await import("../config.js");

    expect(config.apiKey).toBe("test-api-key");
    expect(config.timeout).toBe(60000);
    expect(config.logLevel).toBe("debug");
    expect(config.logPath).toBe("/custom/path/log.txt");
  });
});
