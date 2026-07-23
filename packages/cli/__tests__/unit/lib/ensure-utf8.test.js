import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ensureUtf8,
  getUtf8SpawnOptions,
  _deps,
} from "../../../src/lib/ensure-utf8.js";

// process.platform is a non-writable getter; override via defineProperty and
// restore the original descriptor after each test so other suites are unaffected.
const ORIG_PLATFORM_DESC = Object.getOwnPropertyDescriptor(process, "platform");
function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}
// isTTY is a normal data property on the stream; save/restore so we can simulate
// piped vs interactive output deterministically.
const ORIG_OUT_TTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const ORIG_ERR_TTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
function setTTY(out, err) {
  Object.defineProperty(process.stdout, "isTTY", {
    value: out,
    configurable: true,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    value: err,
    configurable: true,
  });
}
const ORIG_EXEC_FILE_SYNC = _deps.execFileSync;
afterEach(() => {
  Object.defineProperty(process, "platform", ORIG_PLATFORM_DESC);
  if (ORIG_OUT_TTY)
    Object.defineProperty(process.stdout, "isTTY", ORIG_OUT_TTY);
  if (ORIG_ERR_TTY)
    Object.defineProperty(process.stderr, "isTTY", ORIG_ERR_TTY);
  _deps.execFileSync = ORIG_EXEC_FILE_SYNC;
  delete process.env.CC_FORCE_CHCP;
});

describe("getUtf8SpawnOptions", () => {
  it("non-win32: defaults encoding to utf-8 and passes opts through", () => {
    setPlatform("linux");
    const o = getUtf8SpawnOptions();
    expect(o.encoding).toBe("utf-8");
    // no Windows env injection off-Windows
    expect(o.env).toBeUndefined();
  });

  it("non-win32: caller opts (incl. cwd / encoding override) pass through", () => {
    setPlatform("darwin");
    const o = getUtf8SpawnOptions({ cwd: "/tmp", encoding: "buffer" });
    expect(o.cwd).toBe("/tmp");
    expect(o.encoding).toBe("buffer"); // explicit override wins
  });

  it("win32: injects UTF-8 codepage env + inherits process.env", () => {
    setPlatform("win32");
    process.env.__EUTF8_MARKER__ = "marker-value";
    try {
      const o = getUtf8SpawnOptions();
      expect(o.encoding).toBe("utf-8");
      expect(o.env.PYTHONIOENCODING).toBe("utf-8");
      expect(o.env.CHCP).toBe("65001");
      expect(o.env.__EUTF8_MARKER__).toBe("marker-value"); // process.env inherited
    } finally {
      delete process.env.__EUTF8_MARKER__;
    }
  });

  it("win32: caller opts.env is MERGED, not clobbering the UTF-8 env (regression)", () => {
    setPlatform("win32");
    const o = getUtf8SpawnOptions({ env: { FOO: "bar" } });
    // The whole purpose of the helper survives even when a caller passes env:
    expect(o.env.PYTHONIOENCODING).toBe("utf-8");
    expect(o.env.CHCP).toBe("65001");
    // ...and the caller's own var is still present.
    expect(o.env.FOO).toBe("bar");
  });

  it("win32: caller opts.env can override individual UTF-8 vars", () => {
    setPlatform("win32");
    const o = getUtf8SpawnOptions({ env: { PYTHONIOENCODING: "latin1" } });
    expect(o.env.PYTHONIOENCODING).toBe("latin1"); // caller override honored
    expect(o.env.CHCP).toBe("65001"); // others still injected
  });

  it("win32: non-env opts (cwd) pass through while env stays merged", () => {
    setPlatform("win32");
    const o = getUtf8SpawnOptions({ cwd: "C:/work" });
    expect(o.cwd).toBe("C:/work");
    expect(o.env.CHCP).toBe("65001");
  });
});

describe("ensureUtf8", () => {
  it("non-win32: returns early without setting UTF-8 env vars", () => {
    setPlatform("linux");
    const hadPyEnc = "PYTHONIOENCODING" in process.env;
    const prevPyEnc = process.env.PYTHONIOENCODING;
    delete process.env.PYTHONIOENCODING;
    try {
      ensureUtf8();
      expect(process.env.PYTHONIOENCODING).toBeUndefined();
    } finally {
      if (hadPyEnc) process.env.PYTHONIOENCODING = prevPyEnc;
    }
  });

  it("win32: sets PYTHONIOENCODING and LANG to UTF-8 (chcp is fail-open)", () => {
    setPlatform("win32");
    const snapshot = {
      py: process.env.PYTHONIOENCODING,
      lang: process.env.LANG,
    };
    delete process.env.PYTHONIOENCODING;
    delete process.env.LANG;
    try {
      // execSync("chcp 65001") is wrapped in try/catch — harmless on win32,
      // and a no-op-by-catch when this override runs on a non-Windows CI host.
      ensureUtf8();
      expect(process.env.PYTHONIOENCODING).toBe("utf-8");
      expect(process.env.LANG).toBe("en_US.UTF-8");
    } finally {
      if (snapshot.py === undefined) delete process.env.PYTHONIOENCODING;
      else process.env.PYTHONIOENCODING = snapshot.py;
      if (snapshot.lang === undefined) delete process.env.LANG;
      else process.env.LANG = snapshot.lang;
    }
  });

  it("win32 + interactive console: spawns chcp (TTY attached)", () => {
    setPlatform("win32");
    setTTY(true, false);
    _deps.execFileSync = vi.fn();
    ensureUtf8();
    expect(_deps.execFileSync).toHaveBeenCalledWith(
      "cmd.exe",
      ["/d", "/s", "/c", "chcp 65001"],
      expect.objectContaining({
        stdio: "ignore",
        origin: "runtime:utf8-console",
        policy: "allow",
        scope: "runtime",
        shell: false,
      }),
    );
  });

  it("win32 + piped output: SKIPS the ~280ms chcp spawn (no TTY)", () => {
    setPlatform("win32");
    setTTY(false, false);
    _deps.execFileSync = vi.fn();
    ensureUtf8();
    expect(_deps.execFileSync).not.toHaveBeenCalled();
    // env vars still set so child processes inherit UTF-8 regardless.
    expect(process.env.PYTHONIOENCODING).toBe("utf-8");
  });

  it("win32 + stderr-only TTY: still spawns chcp (console attached via stderr)", () => {
    setPlatform("win32");
    setTTY(false, true);
    _deps.execFileSync = vi.fn();
    ensureUtf8();
    expect(_deps.execFileSync).toHaveBeenCalledTimes(1);
  });

  it("win32 + piped + CC_FORCE_CHCP=1: forces the spawn (escape hatch)", () => {
    setPlatform("win32");
    setTTY(false, false);
    process.env.CC_FORCE_CHCP = "1";
    _deps.execFileSync = vi.fn();
    ensureUtf8();
    expect(_deps.execFileSync).toHaveBeenCalledTimes(1);
  });
});
