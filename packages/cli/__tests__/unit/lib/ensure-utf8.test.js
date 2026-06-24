import { describe, it, expect, afterEach } from "vitest";
import {
  ensureUtf8,
  getUtf8SpawnOptions,
} from "../../../src/lib/ensure-utf8.js";

// process.platform is a non-writable getter; override via defineProperty and
// restore the original descriptor after each test so other suites are unaffected.
const ORIG_PLATFORM_DESC = Object.getOwnPropertyDescriptor(process, "platform");
function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}
afterEach(() => {
  Object.defineProperty(process, "platform", ORIG_PLATFORM_DESC);
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
});
