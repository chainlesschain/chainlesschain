import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { getLogger, setLogger } = require("../lib/logger-adapter.js");

describe("logger-adapter", () => {
  beforeEach(() => {
    // Reset the module-level cache so each test starts from a clean slate.
    setLogger(null);
  });

  afterEach(() => {
    setLogger(null);
    vi.restoreAllMocks();
  });

  it("getLogger() returns a logger exposing debug/info/warn/error", () => {
    const logger = getLogger();
    for (const level of ["debug", "info", "warn", "error"]) {
      expect(typeof logger[level]).toBe("function");
    }
  });

  it("memoizes the default logger (same instance on repeated calls)", () => {
    const first = getLogger();
    const second = getLogger();
    expect(second).toBe(first);
  });

  it("default logger delegates each level to the matching console method", () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    const logger = getLogger();
    logger.debug("d", 1);
    logger.info("i", 2);
    logger.warn("w", 3);
    logger.error("e", 4);

    expect(spies.debug).toHaveBeenCalledWith("d", 1);
    expect(spies.info).toHaveBeenCalledWith("i", 2);
    expect(spies.warn).toHaveBeenCalledWith("w", 3);
    expect(spies.error).toHaveBeenCalledWith("e", 4);
  });

  it("setLogger() overrides the logger returned by getLogger()", () => {
    const custom = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLogger(custom);

    const logger = getLogger();
    expect(logger).toBe(custom);

    logger.info("hello");
    expect(custom.info).toHaveBeenCalledWith("hello");
  });

  it("setLogger(null) clears the cache so getLogger() rebuilds the default", () => {
    const custom = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setLogger(custom);
    expect(getLogger()).toBe(custom);

    setLogger(null);
    const rebuilt = getLogger();
    expect(rebuilt).not.toBe(custom);
    expect(typeof rebuilt.info).toBe("function");
  });
});
