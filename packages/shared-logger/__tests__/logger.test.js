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

  describe("cleanup", () => {
    it("only deletes old chainlesschain log files, leaving other files untouched", () => {
      const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const oldLog = path.join(testLogDir, "chainlesschain-2000-01-01.log");
      const recentLog = path.join(testLogDir, "chainlesschain-2999-01-01.log");
      const unrelated = path.join(testLogDir, "config.json");
      fs.writeFileSync(oldLog, "old", "utf8");
      fs.writeFileSync(recentLog, "recent", "utf8");
      fs.writeFileSync(unrelated, "{}", "utf8");
      fs.utimesSync(oldLog, oldMtime, oldMtime);
      fs.utimesSync(unrelated, oldMtime, oldMtime);

      const deleted = logger.cleanup(7);

      expect(deleted).toBe(1);
      expect(fs.existsSync(oldLog)).toBe(false);
      expect(fs.existsSync(recentLog)).toBe(true);
      // An unrelated old file must NOT be deleted by log cleanup.
      expect(fs.existsSync(unrelated)).toBe(true);
    });

    it("does not abort on a subdirectory in the log dir", () => {
      const oldMtime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const oldLog = path.join(testLogDir, "chainlesschain-2000-01-01.log");
      const subDir = path.join(testLogDir, "archive");
      fs.writeFileSync(oldLog, "old", "utf8");
      fs.mkdirSync(subDir);
      fs.utimesSync(oldLog, oldMtime, oldMtime);
      fs.utimesSync(subDir, oldMtime, oldMtime);

      // Previously unlinkSync on the subdir threw EISDIR and the old log
      // survived; now cleanup ignores the subdir and removes the log.
      const deleted = logger.cleanup(7);

      expect(deleted).toBe(1);
      expect(fs.existsSync(oldLog)).toBe(false);
      expect(fs.existsSync(subDir)).toBe(true);

      fs.rmdirSync(subDir);
    });
  });

  describe("log rotation", () => {
    it("rotates without corrupting a log dir whose path contains '.log'", () => {
      // The directory name embeds ".log" — a bare .replace(".log", …) replaces
      // THIS occurrence first, retargeting the rename into a different (missing)
      // directory, so no rotated file lands in the real log dir.
      const trickyDir = path.join(testLogDir, "my.log.archive");
      const trickyLogger = new Logger("tricky", {
        logDir: trickyDir,
        config: { console: false, file: true, fileConfig: { maxSize: 1, maxFiles: 10 } },
      });
      trickyLogger.info("trigger rotation with a sufficiently long message body");

      const files = fs.readdirSync(trickyDir);
      // The rotated file gets a 13+ digit ms-epoch suffix
      // (chainlesschain-<date>-<timestamp>.log) — distinct from the plain daily
      // file. Its presence directly inside trickyDir proves the extension-only
      // replacement did not mangle the "my.log.archive" directory segment.
      const rotated = files.filter((f) => /-\d{13,}\.log$/.test(f));
      expect(rotated.length).toBeGreaterThanOrEqual(1);

      // Cleanup tricky dir.
      files.forEach((f) => fs.unlinkSync(path.join(trickyDir, f)));
      fs.rmdirSync(trickyDir);
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

    it("redacts apiKey / privateKey fields despite camelCase naming", () => {
      // These were never redacted: the list held "apiKey"/"privateKey" but the
      // key was lowercased before the substring check, so they leaked.
      logger.info("llm", {
        apiKey: "sk-LEAK-API",
        privateKey: "PRIV-LEAK-KEY",
        llmApiKey: "sk-NESTED-LEAK",
        model: "doubao",
      });
      const content = fs.readFileSync(logger.getCurrentLogFile(), "utf8");
      expect(content).not.toContain("sk-LEAK-API");
      expect(content).not.toContain("PRIV-LEAK-KEY");
      expect(content).not.toContain("sk-NESTED-LEAK");
      expect(content).toContain("doubao"); // non-sensitive field preserved
    });
  });
});
