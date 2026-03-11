import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import {
  getUserDataPath,
  getConfigDir,
  getDataDir,
  getLogsDir,
  getTempDir,
  getPath,
  ensureDir,
  _setElectronApp,
} from "../lib/paths.js";

describe("core-env/paths", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _setElectronApp(null);
    delete process.env.CHAINLESSCHAIN_HOME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _setElectronApp(null);
  });

  describe("getUserDataPath", () => {
    it("uses CHAINLESSCHAIN_HOME env var when set", () => {
      process.env.CHAINLESSCHAIN_HOME = "/custom/path";
      expect(getUserDataPath()).toBe("/custom/path");
    });

    it("uses Electron app when available", () => {
      const mockApp = { getPath: (name) => `/electron/${name}` };
      _setElectronApp(mockApp);
      expect(getUserDataPath()).toBe("/electron/userData");
    });

    it("falls back to platform path when no Electron", () => {
      const result = getUserDataPath();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      // Should contain 'chainlesschain' in the path
      expect(result.toLowerCase()).toContain("chainlesschain");
    });
  });

  describe("getConfigDir", () => {
    it("returns .chainlesschain under userData", () => {
      process.env.CHAINLESSCHAIN_HOME = "/test";
      expect(getConfigDir()).toBe(path.join("/test", ".chainlesschain"));
    });
  });

  describe("getDataDir", () => {
    it("returns data under userData", () => {
      process.env.CHAINLESSCHAIN_HOME = "/test";
      expect(getDataDir()).toBe(path.join("/test", "data"));
    });
  });

  describe("getLogsDir", () => {
    it("returns logs under userData", () => {
      process.env.CHAINLESSCHAIN_HOME = "/test";
      expect(getLogsDir()).toBe(path.join("/test", "logs"));
    });
  });

  describe("getTempDir", () => {
    it("returns chainlesschain temp dir in CLI mode", () => {
      const result = getTempDir();
      expect(result).toBe(path.join(os.tmpdir(), "chainlesschain"));
    });

    it("uses Electron temp when available", () => {
      const mockApp = { getPath: (name) => `/electron/${name}` };
      _setElectronApp(mockApp);
      expect(getTempDir()).toBe("/electron/temp");
    });
  });

  describe("getPath", () => {
    it("maps known path names in CLI mode", () => {
      process.env.CHAINLESSCHAIN_HOME = "/test";
      expect(getPath("userData")).toBe("/test");
      expect(getPath("home")).toBe(os.homedir());
    });

    it("falls back to userData subdir for unknown names", () => {
      process.env.CHAINLESSCHAIN_HOME = "/test";
      expect(getPath("custom")).toBe(path.join("/test", "custom"));
    });

    it("delegates to Electron app when available", () => {
      const mockApp = { getPath: (name) => `/electron/${name}` };
      _setElectronApp(mockApp);
      expect(getPath("userData")).toBe("/electron/userData");
      expect(getPath("temp")).toBe("/electron/temp");
    });
  });

  describe("ensureDir", () => {
    it("creates directory if not exists", async () => {
      const fs = await import("fs");
      const testDir = path.join(
        os.tmpdir(),
        `core-env-test-${Date.now()}`,
      );
      ensureDir(testDir);
      expect(fs.existsSync(testDir)).toBe(true);
      // Cleanup
      fs.rmdirSync(testDir);
    });
  });
});
