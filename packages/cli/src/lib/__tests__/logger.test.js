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
  setMachineReadable,
} from "../logger.js";

let logSpy;
let errSpy;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  setQuiet(false);
  setVerbose(false);
  setMachineReadable(false);
});

afterEach(() => {
  setQuiet(false);
  setVerbose(false);
  setMachineReadable(false);
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

  it("does NOT suppress warn (writes to console.error/stderr)", () => {
    warn("careful");
    // warn goes to stderr (not stdout) so it never pollutes machine-readable
    // stdout like `--json`; still never suppressed by quiet mode.
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does NOT suppress error", () => {
    error("boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe("verbose mode", () => {
  it("emits verbose to stderr only after setVerbose(true)", () => {
    verbose("before");
    expect(errSpy).not.toHaveBeenCalled();
    setVerbose(true);
    verbose("after");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("lets quiet take precedence when both flags are enabled", () => {
    setVerbose(true);
    setQuiet(true);
    verbose("hidden diagnostic");
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe("machine-readable mode", () => {
  beforeEach(() => setMachineReadable(true));

  it("keeps result payloads on stdout and moves presentation to stderr", () => {
    info("progress");
    success("done");
    log('{"ok":true}');
    newline();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('{"ok":true}');
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it("does not let quiet suppress an explicit machine payload", () => {
    setQuiet(true);
    info("progress");
    log('{"ok":true}');

    expect(logSpy).toHaveBeenCalledOnce();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("emits warnings and errors as structured stderr records", () => {
    warn("careful", { retry: false });
    error("boom");

    expect(JSON.parse(errSpy.mock.calls[0][0])).toEqual({
      warning: { message: 'careful {"retry":false}' },
    });
    expect(JSON.parse(errSpy.mock.calls[1][0])).toEqual({
      error: { message: "boom" },
    });
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
      "setMachineReadable",
    ]) {
      expect(typeof logger[m]).toBe("function");
    }
  });
});
