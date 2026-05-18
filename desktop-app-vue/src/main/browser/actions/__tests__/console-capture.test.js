/**
 * ConsoleCapture 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  ConsoleCapture,
  LogLevel,
  LogSource,
  getConsoleCapture,
} = require("../console-capture");

// Create mock console message
const createMockConsoleMessage = (type = "log", text = "Test message") => ({
  type: vi.fn().mockReturnValue(type),
  text: vi.fn().mockReturnValue(text),
  location: vi.fn().mockReturnValue({ url: "test.js", lineNumber: 10 }),
  args: vi.fn().mockReturnValue([{ toString: () => text }]),
});

// Create mock error
const createMockError = (message = "Test error") => ({
  message,
  stack: `Error: ${message}\n    at test.js:10:5`,
});

// Create mock request
const createMockRequest = (
  url = "https://example.com/api",
  method = "GET",
) => ({
  url: vi.fn().mockReturnValue(url),
  method: vi.fn().mockReturnValue(method),
  resourceType: vi.fn().mockReturnValue("fetch"),
  failure: vi.fn().mockReturnValue({ errorText: "net::ERR_FAILED" }),
});

// Create mock page with event handlers
const createMockPage = () => {
  const handlers = {};

  return {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event, handler) => {
      delete handlers[event];
    }),
    // Helper to trigger events in tests
    _handlers: handlers,
    _trigger: (event, ...args) => {
      if (handlers[event]) {
        handlers[event](...args);
      }
    },
  };
};

const createMockEngine = () => {
  const mockPage = createMockPage();
  return {
    getPage: vi.fn().mockReturnValue(mockPage),
    _mockPage: mockPage,
  };
};

describe("ConsoleCapture", () => {
  let capture;
  let mockEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine = createMockEngine();
    capture = new ConsoleCapture(mockEngine, {
      captureConsole: true,
      captureErrors: true,
      captureNetwork: true,
    });
  });

  afterEach(() => {
    capture.cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      expect(capture.config.captureConsole).toBe(true);
      expect(capture.config.captureErrors).toBe(true);
      expect(capture.config.maxLogs).toBe(1000);
    });

    it("should work without engine", () => {
      const c = new ConsoleCapture(null);
      expect(c.browserEngine).toBeNull();
      c.cleanup();
    });
  });

  describe("startCapture", () => {
    it("should start capturing console messages", async () => {
      const result = await capture.startCapture("tab1");

      expect(result.success).toBe(true);
      expect(capture.isCapturing("tab1")).toBe(true);
    });

    it("should register event handlers", async () => {
      await capture.startCapture("tab1");

      const mockPage = mockEngine._mockPage;
      expect(mockPage.on).toHaveBeenCalledWith("console", expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith(
        "pageerror",
        expect.any(Function),
      );
      expect(mockPage.on).toHaveBeenCalledWith(
        "requestfailed",
        expect.any(Function),
      );
    });

    it("should return already capturing if active", async () => {
      await capture.startCapture("tab1");
      const result = await capture.startCapture("tab1");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Already capturing");
    });

    it("should fail without engine", async () => {
      const c = new ConsoleCapture(null);
      const result = await c.startCapture("tab1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Browser engine not set");
      c.cleanup();
    });

    it("should fail for unknown page", async () => {
      mockEngine.getPage.mockReturnValueOnce(null);
      const result = await capture.startCapture("unknown");

      expect(result.success).toBe(false);
    });
  });

  describe("stopCapture", () => {
    it("should stop capturing", async () => {
      await capture.startCapture("tab1");
      const result = capture.stopCapture("tab1");

      expect(result.success).toBe(true);
      expect(capture.isCapturing("tab1")).toBe(false);
    });

    it("should return not capturing if inactive", () => {
      const result = capture.stopCapture("tab1");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Not capturing");
    });

    it("should remove event handlers", async () => {
      await capture.startCapture("tab1");
      capture.stopCapture("tab1");

      const mockPage = mockEngine._mockPage;
      expect(mockPage.off).toHaveBeenCalled();
    });
  });

  describe("console message handling", () => {
    it("should capture console log", async () => {
      await capture.startCapture("tab1");

      // Simulate console message
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Hello"),
      );

      const logs = capture.getLogs("tab1");
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe("log");
      expect(logs[0].message).toBe("Hello");
    });

    it("should capture console error", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("error", "Error!"),
      );

      const errors = capture.getErrors("tab1");
      expect(errors.length).toBe(1);
    });

    it("should capture console warning", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("warn", "Warning!"),
      );

      const warnings = capture.getWarnings("tab1");
      expect(warnings.length).toBe(1);
    });

    it("should filter by level", async () => {
      capture.config.filterLevels = [LogLevel.ERROR];
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("error", "Error"),
      );

      const logs = capture.getLogs("tab1");
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe("error");
    });
  });

  describe("page error handling", () => {
    it("should capture page errors", async () => {
      await capture.startCapture("tab1");

      capture._handlePageError("tab1", createMockError("Uncaught TypeError"));

      const errors = capture.getErrors("tab1");
      expect(errors.length).toBe(1);
      expect(errors[0].source).toBe(LogSource.JAVASCRIPT);
    });

    it("should include stack trace when configured", async () => {
      await capture.startCapture("tab1");

      capture._handlePageError("tab1", createMockError("Error with stack"));

      const errors = capture.getErrors("tab1");
      expect(errors[0].stack).toBeDefined();
    });

    it("should increment error count", async () => {
      await capture.startCapture("tab1");

      capture._handlePageError("tab1", createMockError("Error 1"));
      capture._handlePageError("tab1", createMockError("Error 2"));

      expect(capture.getErrorCount("tab1")).toBe(2);
    });
  });

  describe("network error handling", () => {
    it("should capture network errors", async () => {
      await capture.startCapture("tab1");

      capture._handleRequestFailed(
        "tab1",
        createMockRequest("https://api.example.com"),
      );

      const errors = capture.getNetworkErrors("tab1");
      expect(errors.length).toBe(1);
      expect(errors[0].source).toBe(LogSource.NETWORK);
    });

    it("should include request details", async () => {
      await capture.startCapture("tab1");

      capture._handleRequestFailed(
        "tab1",
        createMockRequest("https://api.example.com/users", "POST"),
      );

      const errors = capture.getNetworkErrors("tab1");
      expect(errors[0].url).toBe("https://api.example.com/users");
      expect(errors[0].method).toBe("POST");
    });
  });

  describe("getLogs", () => {
    it("should return all logs", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log 1"),
      );
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log 2"),
      );

      const logs = capture.getLogs("tab1");
      expect(logs.length).toBe(2);
    });

    it("should filter by level", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("warn", "Warning"),
      );

      const logs = capture.getLogs("tab1", { level: LogLevel.WARN });
      expect(logs.length).toBe(1);
    });

    it("should filter by source", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Console"),
      );
      capture._handleRequestFailed("tab1", createMockRequest());

      const logs = capture.getLogs("tab1", { source: LogSource.NETWORK });
      expect(logs.length).toBe(1);
    });

    it("should filter by search term", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Hello World"),
      );
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Goodbye"),
      );

      const logs = capture.getLogs("tab1", { search: "Hello" });
      expect(logs.length).toBe(1);
    });

    it("should limit results", async () => {
      await capture.startCapture("tab1");

      for (let i = 0; i < 10; i++) {
        capture._handleConsoleMessage(
          "tab1",
          createMockConsoleMessage("log", `Log ${i}`),
        );
      }

      const logs = capture.getLogs("tab1", { limit: 3 });
      expect(logs.length).toBe(3);
    });
  });

  describe("clearLogs", () => {
    it("should clear logs for target", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture.clearLogs("tab1");

      expect(capture.getLogs("tab1").length).toBe(0);
    });

    it("should reset error count", async () => {
      await capture.startCapture("tab1");

      capture._handlePageError("tab1", createMockError("Error"));
      capture.clearLogs("tab1");

      expect(capture.getErrorCount("tab1")).toBe(0);
    });
  });

  describe("clearAllLogs", () => {
    it("should clear all logs", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture.clearAllLogs();

      expect(capture.logs.size).toBe(0);
    });
  });

  describe("exportLogs", () => {
    it("should export as JSON", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Test"),
      );

      const result = capture.exportLogs("tab1", "json");

      expect(result.success).toBe(true);
      expect(result.format).toBe("json");
      expect(result.data).toContain("Test");
    });

    it("should export as text", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Test"),
      );

      const result = capture.exportLogs("tab1", "text");

      expect(result.success).toBe(true);
      expect(result.format).toBe("text");
      expect(result.data).toContain("Test");
    });
  });

  describe("isCapturing", () => {
    it("should return true when capturing", async () => {
      await capture.startCapture("tab1");

      expect(capture.isCapturing("tab1")).toBe(true);
    });

    it("should return false when not capturing", () => {
      expect(capture.isCapturing("tab1")).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return statistics", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("error", "Error"),
      );

      const stats = capture.getStats();

      expect(stats.totalLogs).toBe(2);
      expect(stats.errors).toBe(1);
      expect(stats.activeCaptures).toBe(1);
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", async () => {
      await capture.startCapture("tab1");

      capture._handleConsoleMessage(
        "tab1",
        createMockConsoleMessage("log", "Log"),
      );
      capture.resetStats();

      const stats = capture.getStats();
      expect(stats.totalLogs).toBe(0);
    });
  });

  describe("LogLevel constants", () => {
    it("should have all levels defined", () => {
      expect(LogLevel.LOG).toBe("log");
      expect(LogLevel.INFO).toBe("info");
      expect(LogLevel.WARN).toBe("warn");
      expect(LogLevel.ERROR).toBe("error");
      expect(LogLevel.DEBUG).toBe("debug");
      expect(LogLevel.TRACE).toBe("trace");
    });
  });

  describe("LogSource constants", () => {
    it("should have all sources defined", () => {
      expect(LogSource.CONSOLE).toBe("console");
      expect(LogSource.NETWORK).toBe("network");
      expect(LogSource.JAVASCRIPT).toBe("javascript");
      expect(LogSource.SECURITY).toBe("security");
      expect(LogSource.PERFORMANCE).toBe("performance");
    });
  });

  describe("getConsoleCapture singleton", () => {
    it("should return singleton instance", () => {
      const c1 = getConsoleCapture(mockEngine);
      const c2 = getConsoleCapture();

      expect(c1).toBe(c2);
    });
  });
});
