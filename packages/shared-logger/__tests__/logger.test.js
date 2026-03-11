import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Mock core-env before importing logger
vi.mock("@chainlesschain/core-env", () => {
  const testLogDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);
  return {
    getLogsDir: () => testLogDir,
  };
});

const { Logger, createLogger, LOG_LEVELS } = await import("../lib/index.js");

describe("shared-logger", () => {
  let testLogDir;
  let logger;

  beforeEach(() => {
    testLogDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);
    logger = new Logger("test", {
      logDir: testLogDir,
      config: { console: false, file: true },
    });
  });

  afterEach(() => {
    // Cleanup test log directory
    try {
      if (fs.existsSync(testLogDir)) {
        const files = fs.readdirSync(testLogDir);
        files.forEach((f) => fs.unlinkSync(path.join(testLogDir, f)));
        fs.rmdirSync(testLogDir);
      }
    } catch {
      // Cleanup best-effort
    }
  });

  describe("Logger constructor", () => {
    it("creates log directory", () => {
      expect(fs.existsSync(testLogDir)).toBe(true);
    });

    it("sets module name", () => {
      expect(logger.module).toBe("test");
    });
  });

  describe("logging methods", () => {
    it("writes info log to file", () => {
      logger.info("test message", { key: "value" });
      const logFile = logger.getCurrentLogFile();
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("[INFO]");
      expect(content).toContain("[test]");
      expect(content).toContain("test message");
    });

    it("writes error log to file", () => {
      logger.error("error occurred", { code: 500 });
      const logFile = logger.getCurrentLogFile();
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("[ERROR]");
      expect(content).toContain("error occurred");
    });

    it("respects log level filtering", () => {
      logger.setConfig({ level: LOG_LEVELS.ERROR });
      logger.info("should not appear");
      logger.error("should appear");
      const logFile = logger.getCurrentLogFile();
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).not.toContain("should not appear");
      expect(content).toContain("should appear");
    });
  });

  describe("child logger", () => {
    it("creates child with combined module name", () => {
      const child = logger.child("sub");
      expect(child.module).toBe("test:sub");
    });

    it("writes to same log directory", () => {
      const child = logger.child("sub");
      child.info("child message");
      const logFile = child.getCurrentLogFile();
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("[test:sub]");
    });
  });

  describe("performance tracking", () => {
    it("tracks performance marks", () => {
      logger.perfStart("test-op");
      const duration = logger.perfEnd("test-op");
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it("returns undefined for non-existent marks", () => {
      const result = logger.perfEnd("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("createLogger helper", () => {
    it("creates a new Logger instance", () => {
      const log = createLogger("custom", { logDir: testLogDir });
      expect(log).toBeInstanceOf(Logger);
      expect(log.module).toBe("custom");
    });
  });

  describe("sensitive data redaction", () => {
    it("redacts password fields", () => {
      logger.info("auth", { password: "secret123", user: "admin" });
      const logFile = logger.getCurrentLogFile();
      const content = fs.readFileSync(logFile, "utf8");
      expect(content).toContain("***REDACTED***");
      expect(content).not.toContain("secret123");
      expect(content).toContain("admin");
    });
  });
});
