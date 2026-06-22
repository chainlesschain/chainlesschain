"use strict";

/**
 * logger tests (previously untested) — the cc CLI's console logger. Small but
 * the gating semantics matter: quiet suppresses info/success/log/newline but
 * must NEVER suppress warn/error (otherwise failures would be hidden), and
 * verbose only emits when enabled. console is spied; module-level verbose/quiet
 * flags are reset between tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setVerbose,
  setQuiet,
  info,
  success,
  warn,
  error,
  verbose,
  log,
  newline,
  logger,
} from "../logger.js";

let logSpy;
let errSpy;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  setQuiet(false);
  setVerbose(false);
});

afterEach(() => {
  setQuiet(false);
  setVerbose(false);
  vi.restoreAllMocks();
});

describe("default (not quiet, not verbose)", () => {
  it("info/success/log/newline write to console.log", () => {
    info("i");
    success("s");
    log("l");
    newline();
    expect(logSpy).toHaveBeenCalledTimes(4);
  });

  it("verbose is suppressed unless enabled", () => {
    verbose("v");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("error writes to console.error, not console.log", () => {
    error("boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("quiet mode", () => {
  beforeEach(() => setQuiet(true));

  it("suppresses info/success/log/newline", () => {
    info("i");
    success("s");
    log("l");
    newline();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does NOT suppress warn (still console.log)", () => {
    warn("careful");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT suppress error", () => {
    error("boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe("verbose mode", () => {
  it("emits verbose only after setVerbose(true)", () => {
    verbose("before");
    expect(logSpy).not.toHaveBeenCalled();
    setVerbose(true);
    verbose("after");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("logger object", () => {
  it("exposes the full method surface", () => {
    for (const m of [
      "info",
      "success",
      "warn",
      "error",
      "verbose",
      "log",
      "newline",
      "setVerbose",
      "setQuiet",
    ]) {
      expect(typeof logger[m]).toBe("function");
    }
  });
});
