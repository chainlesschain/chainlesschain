/**
 * safe-open 测试 — src/main/utils/safe-open.js
 *
 * Security-critical input validation for shell.openExternal / shell.openPath.
 * Uses the module's injection points (opts.openExternal/openPath/fs) so no
 * electron is required.
 */

import { describe, it, expect, vi } from "vitest";
import path from "path";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  isSafeExternalUrl,
  safeOpenExternal,
  isPathWithin,
  safeOpenPathDir,
  isExecutableProgramPath,
  assertSafeProgramOpen,
  ALLOWED_EXTERNAL_PROTOCOLS,
} from "../../../src/main/utils/safe-open.js";

describe("isSafeExternalUrl", () => {
  it("allows http and https only", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("https://example.com/path?q=1")).toBe(true);
    expect(ALLOWED_EXTERNAL_PROTOCOLS.has("https:")).toBe(true);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeExternalUrl("file:///C:/Windows/system32/calc.exe")).toBe(
      false,
    );
    expect(isSafeExternalUrl("smb://host/share")).toBe(false);
    expect(isSafeExternalUrl("ftp://host/x")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("custom-app://launch")).toBe(false);
  });

  it("rejects non-strings, empty, and malformed URLs", () => {
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(123)).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});

describe("safeOpenExternal", () => {
  it("opens a safe url via the injected opener", async () => {
    const openExternal = vi.fn().mockResolvedValue("ok");
    await expect(
      safeOpenExternal("https://x.com", { openExternal }),
    ).resolves.toBe("ok");
    expect(openExternal).toHaveBeenCalledWith("https://x.com");
  });

  it("refuses a disallowed scheme and never calls the opener", async () => {
    const openExternal = vi.fn();
    await expect(
      safeOpenExternal("file:///etc/passwd", { openExternal }),
    ).rejects.toThrow(/disallowed scheme/);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("isPathWithin", () => {
  const root = path.resolve("project-root");

  it("accepts the dir itself and nested paths", () => {
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(root, path.join(root, "src", "a.ts"))).toBe(true);
  });

  it("rejects parent-escape and sibling/absolute paths", () => {
    expect(isPathWithin(root, path.join(root, "..", "secret"))).toBe(false);
    expect(isPathWithin(root, path.resolve(root, "../sibling"))).toBe(false);
    expect(isPathWithin(path.resolve("/a/b"), path.resolve("/c/d"))).toBe(
      false,
    );
  });

  it("rejects non-string / empty args", () => {
    expect(isPathWithin(root, "")).toBe(false);
    expect(isPathWithin("", root)).toBe(false);
    expect(isPathWithin(null, root)).toBe(false);
  });
});

describe("safeOpenPathDir", () => {
  it("opens an existing directory via the injected opener", async () => {
    const openPath = vi.fn().mockResolvedValue("opened");
    const fs = { statSync: () => ({ isDirectory: () => true }) };
    await expect(safeOpenPathDir("/some/dir", { openPath, fs })).resolves.toBe(
      "opened",
    );
    expect(openPath).toHaveBeenCalledWith("/some/dir");
  });

  it("refuses a non-existent path", async () => {
    const fs = {
      statSync: () => {
        throw new Error("ENOENT");
      },
    };
    const openPath = vi.fn();
    await expect(safeOpenPathDir("/missing", { openPath, fs })).rejects.toThrow(
      /does not exist/,
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("refuses a path that is not a directory (e.g. an executable)", async () => {
    const fs = { statSync: () => ({ isDirectory: () => false }) };
    const openPath = vi.fn();
    await expect(
      safeOpenPathDir("/some/app.exe", { openPath, fs }),
    ).rejects.toThrow(/non-directory/);
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe("isExecutableProgramPath", () => {
  const okFs = { statSync: () => ({ isFile: () => true, mode: 0o755 }) };
  const missingFs = {
    statSync: () => {
      throw new Error("ENOENT");
    },
  };

  it("accepts an existing absolute .exe on windows", () => {
    expect(
      isExecutableProgramPath("C:\\Program Files\\app\\app.exe", {
        fs: okFs,
        platform: "win32",
      }),
    ).toBe(true);
  });

  it("rejects bare command names (would resolve via PATH)", () => {
    expect(
      isExecutableProgramPath("cmd", { fs: okFs, platform: "win32" }),
    ).toBe(false);
    // not absolute → rejected even with .exe extension
    expect(
      isExecutableProgramPath("powershell.exe", {
        fs: okFs,
        platform: "win32",
      }),
    ).toBe(false);
  });

  it("rejects a non-existent program", () => {
    expect(
      isExecutableProgramPath("C:\\nope\\x.exe", {
        fs: missingFs,
        platform: "win32",
      }),
    ).toBe(false);
  });

  it("rejects disallowed extensions on windows (.bat/.txt)", () => {
    expect(
      isExecutableProgramPath("C:\\x\\run.bat", {
        fs: okFs,
        platform: "win32",
      }),
    ).toBe(false);
    expect(
      isExecutableProgramPath("C:\\x\\notes.txt", {
        fs: okFs,
        platform: "win32",
      }),
    ).toBe(false);
  });

  it("accepts posix files with the execute bit, rejects non-exec", () => {
    expect(
      isExecutableProgramPath("/usr/bin/code", {
        fs: { statSync: () => ({ isFile: () => true, mode: 0o755 }) },
        platform: "linux",
      }),
    ).toBe(true);
    expect(
      isExecutableProgramPath("/usr/share/doc/readme", {
        fs: { statSync: () => ({ isFile: () => true, mode: 0o644 }) },
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("rejects directories, non-strings, and empty", () => {
    expect(
      isExecutableProgramPath("C:\\dir", {
        fs: { statSync: () => ({ isFile: () => false }) },
        platform: "win32",
      }),
    ).toBe(false);
    expect(isExecutableProgramPath(null, { fs: okFs })).toBe(false);
    expect(isExecutableProgramPath("", { fs: okFs })).toBe(false);
  });
});

describe("assertSafeProgramOpen", () => {
  const okFs = { statSync: () => ({ isFile: () => true, mode: 0o755 }) };

  it("passes for a valid program + existing absolute target", () => {
    expect(() =>
      assertSafeProgramOpen("C:\\app\\a.exe", "C:\\docs\\f.txt", {
        fs: okFs,
        platform: "win32",
      }),
    ).not.toThrow();
  });

  it("throws for a disallowed program (arbitrary-exe spawn blocked)", () => {
    expect(() =>
      assertSafeProgramOpen("cmd", "C:\\docs\\f.txt", {
        fs: okFs,
        platform: "win32",
      }),
    ).toThrow(/disallowed or non-executable/);
  });

  it("throws for a non-existent target (arg-injection like '/c calc')", () => {
    const fs = {
      statSync: (p) => {
        if (String(p).toLowerCase().endsWith(".exe")) {
          return { isFile: () => true, mode: 0o755 };
        }
        throw new Error("ENOENT");
      },
    };
    expect(() =>
      assertSafeProgramOpen("C:\\app\\a.exe", "/c calc", {
        fs,
        platform: "win32",
      }),
    ).toThrow(/does not exist/);
  });

  it("throws for a non-absolute target", () => {
    expect(() =>
      assertSafeProgramOpen("C:\\app\\a.exe", "foo.txt", {
        fs: okFs,
        platform: "win32",
      }),
    ).toThrow(/non-absolute/);
  });
});
