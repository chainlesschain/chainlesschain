/**
 * IDE MCP tool path-boundary guard (IDE gap P0#2) — verified WITHOUT a VS Code
 * host:
 *   1. pure rules: validateIdeToolPath (traversal, UNC, outside-workspace
 *      absolute paths, prefix confusion, Windows case-insensitivity, relative
 *      resolution against the first folder, CJK/space paths)
 *   2. wiring: buildIdeTools handlers refuse out-of-workspace paths for the
 *      write tools (openDiff / openMultiDiff) and the read scope
 *      (getDiagnostics), forwarding the RESOLVED path when allowed
 *   3. Windows lockfile ACL tightening (icacls seam): correct argv, fail-open.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { validateIdeToolPath } from "../../../vscode-extension/src/ide-path-guard.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import lockfile from "../../../vscode-extension/src/lockfile.js";

const WIN = { platform: "win32" };
const NIX = { platform: "linux" };

describe("validateIdeToolPath — pure rules", () => {
  const roots = ["C:\\work\\proj"];

  it("rejects .. traversal that escapes the workspace", () => {
    const v = validateIdeToolPath("..\\..\\etc\\pwn.txt", roots, WIN);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/outside every workspace folder/);
  });

  it("allows .. that stays inside the workspace (and folds it)", () => {
    const v = validateIdeToolPath("sub\\..\\a.txt", roots, WIN);
    expect(v).toEqual({ ok: true, resolved: "C:\\work\\proj\\a.txt" });
  });

  it("rejects UNC and device paths outright", () => {
    for (const p of [
      "\\\\evil\\share\\x.txt",
      "//evil/share/x.txt",
      "\\\\?\\C:\\work\\proj\\a.txt",
      "\\\\wsl.localhost\\Ubuntu\\home\\x",
    ]) {
      const v = validateIdeToolPath(p, roots, WIN);
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/UNC \/ device paths/);
    }
  });

  it("rejects absolute paths outside the workspace (incl. other drives)", () => {
    expect(
      validateIdeToolPath("C:\\Windows\\system32\\cfg", roots, WIN).ok,
    ).toBe(false);
    expect(validateIdeToolPath("D:\\work\\proj\\a.txt", roots, WIN).ok).toBe(
      false,
    );
    expect(validateIdeToolPath("/etc/passwd", ["/home/u/ws"], NIX).ok).toBe(
      false,
    );
  });

  it("is not fooled by prefix confusion (C:\\work vs C:\\work2, /tmp vs /tmpfoo)", () => {
    expect(
      validateIdeToolPath("C:\\work\\proj2\\a.txt", ["C:\\work\\proj"], WIN).ok,
    ).toBe(false);
    expect(validateIdeToolPath("/tmpfoo/a.txt", ["/tmp"], NIX).ok).toBe(false);
    expect(validateIdeToolPath("/tmp/a.txt", ["/tmp"], NIX).ok).toBe(true);
  });

  it("compares case-insensitively on Windows, case-sensitively on POSIX", () => {
    const v = validateIdeToolPath("c:\\WORK\\PROJ\\A.txt", roots, WIN);
    expect(v.ok).toBe(true);
    expect(v.resolved).toBe("c:\\WORK\\PROJ\\A.txt"); // original casing kept
    expect(validateIdeToolPath("/WS/a.txt", ["/ws"], NIX).ok).toBe(false);
  });

  it("resolves relative paths against the FIRST workspace folder", () => {
    const v = validateIdeToolPath("src/a.js", ["C:\\ws1", "C:\\ws2"], WIN);
    expect(v).toEqual({ ok: true, resolved: "C:\\ws1\\src\\a.js" });
  });

  it("accepts absolute paths inside ANY workspace folder (multi-root)", () => {
    const v = validateIdeToolPath(
      "C:\\ws2\\lib\\b.js",
      ["C:\\ws1", "C:\\ws2"],
      WIN,
    );
    expect(v).toEqual({ ok: true, resolved: "C:\\ws2\\lib\\b.js" });
  });

  it("handles CJK and space-containing paths", () => {
    const v = validateIdeToolPath(
      "子 目录\\文件 名.txt",
      ["C:\\我的 项目"],
      WIN,
    );
    expect(v).toEqual({
      ok: true,
      resolved: "C:\\我的 项目\\子 目录\\文件 名.txt",
    });
    expect(
      validateIdeToolPath("..\\外面\\x.txt", ["C:\\我的 项目"], WIN).ok,
    ).toBe(false);
  });

  it("fails closed on empty/invalid inputs", () => {
    expect(validateIdeToolPath("", roots, WIN).ok).toBe(false);
    expect(validateIdeToolPath(null, roots, WIN).ok).toBe(false);
    expect(validateIdeToolPath(42, roots, WIN).ok).toBe(false);
    expect(validateIdeToolPath("a\0b", roots, WIN).ok).toBe(false);
    const noFolders = validateIdeToolPath("a.txt", [], WIN);
    expect(noFolders.ok).toBe(false);
    expect(noFolders.reason).toMatch(/no workspace folder/);
    expect(validateIdeToolPath("a.txt", undefined, WIN).ok).toBe(false);
  });

  it("accepts {path}/{fsPath} folder objects (lsp workspaceRoots shape)", () => {
    const v = validateIdeToolPath(
      "a.txt",
      [{ name: "ws", path: "C:\\ws" }],
      WIN,
    );
    expect(v).toEqual({ ok: true, resolved: "C:\\ws\\a.txt" });
  });
});

// ---------------------------------------------------------------------------
// Wiring: buildIdeTools enforces the guard on openDiff / openMultiDiff /
// getDiagnostics. Uses paths matching the REAL host platform because the
// handlers validate with the default (process) platform.
// ---------------------------------------------------------------------------

const IS_WIN = process.platform === "win32";
const ROOT = IS_WIN ? "C:\\ws" : "/ws";
const INSIDE = path.join(ROOT, "src", "a.js");
const OUTSIDE = IS_WIN ? "C:\\other\\evil.js" : "/other/evil.js";

function fakeFacade() {
  return {
    getSelection: async () => null,
    getDiagnostics: vi.fn(async () => []),
    getOpenEditors: async () => [],
    openDiff: vi.fn(async (args) => ({ outcome: "accepted", path: args.path })),
    openMultiDiff: vi.fn(async ({ files }) => ({
      outcome: "accepted",
      applied: files.length,
      total: files.length,
    })),
  };
}

function toolsWithBoundary(facade) {
  return buildIdeTools(facade, { getWorkspaceFolders: () => [ROOT] });
}

const byName = (tools) => Object.fromEntries(tools.map((t) => [t.name, t]));

describe("buildIdeTools — path boundary wiring", () => {
  it("openDiff rejects an out-of-workspace target without calling the facade", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(
      t.openDiff.handler({ path: OUTSIDE, modifiedText: "x" }),
    ).rejects.toThrow(/openDiff: unsafe write target rejected/);
    expect(facade.openDiff).not.toHaveBeenCalled();
  });

  it("openDiff rejects traversal escaping via a relative path", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(
      t.openDiff.handler({
        path: path.join("..", "escape.js"),
        modifiedText: "x",
      }),
    ).rejects.toThrow(/unsafe write target/);
    expect(facade.openDiff).not.toHaveBeenCalled();
  });

  it("openDiff forwards the RESOLVED in-workspace path", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    const res = await t.openDiff.handler({
      path: path.join(ROOT, "src", "..", "src", "a.js"),
      modifiedText: "x",
    });
    expect(facade.openDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: INSIDE }),
    );
    expect(res.outcome).toBe("accepted");
  });

  it("openMultiDiff rejects the whole batch when ONE file escapes", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(
      t.openMultiDiff.handler({
        files: [
          { path: INSIDE, modifiedText: "ok" },
          { path: OUTSIDE, modifiedText: "evil" },
        ],
      }),
    ).rejects.toThrow(/openMultiDiff: unsafe write target rejected/);
    expect(facade.openMultiDiff).not.toHaveBeenCalled();
  });

  it("openMultiDiff passes when every file is inside", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    const res = await t.openMultiDiff.handler({
      files: [{ path: INSIDE, modifiedText: "ok" }],
    });
    expect(res.outcome).toBe("accepted");
    expect(facade.openMultiDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ path: INSIDE })],
      }),
    );
  });

  it("getDiagnostics rejects an out-of-workspace scope with READ wording", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(t.getDiagnostics.handler({ path: OUTSIDE })).rejects.toThrow(
      /getDiagnostics: unsafe read path rejected/,
    );
    expect(facade.getDiagnostics).not.toHaveBeenCalled();
  });

  it("getDiagnostics without a path is untouched (whole-workspace scan)", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    const res = await t.getDiagnostics.handler({});
    expect(res).toEqual({ diagnostics: [] });
    expect(facade.getDiagnostics).toHaveBeenCalledWith({ path: undefined });
  });

  it("uses editor.lsp.workspaceRoots() when no explicit provider is injected", async () => {
    const facade = fakeFacade();
    facade.lsp = { workspaceRoots: async () => [{ name: "ws", path: ROOT }] };
    const t = byName(buildIdeTools(facade));
    await expect(
      t.openDiff.handler({ path: OUTSIDE, modifiedText: "x" }),
    ).rejects.toThrow(/unsafe write target/);
    const res = await t.openDiff.handler({ path: INSIDE, modifiedText: "x" });
    expect(res.outcome).toBe("accepted");
  });

  it("a provider that reports NO open folder fails closed", async () => {
    const facade = fakeFacade();
    const t = byName(buildIdeTools(facade, { getWorkspaceFolders: () => [] }));
    await expect(
      t.openDiff.handler({ path: INSIDE, modifiedText: "x" }),
    ).rejects.toThrow(/no workspace folder/);
  });

  it("legacy pure-logic hosts (no provider at all) keep the old behavior", async () => {
    // No options, no lsp, and require("vscode") fails in this test process →
    // boundary unknowable → historical unguarded pass-through is preserved.
    const facade = fakeFacade();
    const t = byName(buildIdeTools(facade));
    const res = await t.openDiff.handler({ path: OUTSIDE, modifiedText: "x" });
    expect(res.outcome).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// Task 2: Windows lockfile ACL tightening (icacls seam, fail-open).
// ---------------------------------------------------------------------------

describe("lockfile — Windows ACL tightening", () => {
  let tmpHome;
  const saved = {};

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-acl-"));
    saved.homedir = lockfile._deps.homedir;
    saved.platform = lockfile._deps.platform;
    saved.env = lockfile._deps.env;
    saved.spawnSync = lockfile._deps.spawnSync;
    lockfile._deps.homedir = () => tmpHome;
    lockfile._aclWarnState.warned = false;
  });

  afterEach(() => {
    Object.assign(lockfile._deps, saved);
    lockfile._aclWarnState.warned = false;
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    vi.restoreAllMocks();
  });

  it("win32: tightens dir + file with /inheritance:r then current-user-only grant", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "John Doe" });
    const calls = [];
    lockfile._deps.spawnSync = (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 0 };
    };
    const file = lockfile.writeLock({ port: 4321, token: "t" });
    expect(calls).toHaveLength(2);
    const dir = path.dirname(file);
    expect(calls[0]).toEqual([
      "icacls",
      [dir, "/inheritance:r", "/grant:r", "John Doe:F"],
    ]);
    expect(calls[1]).toEqual([
      "icacls",
      [file, "/inheritance:r", "/grant:r", "John Doe:F"],
    ]);
  });

  it("win32: a failing icacls is fail-open — lock is still written, one warn", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "u" });
    lockfile._deps.spawnSync = () => {
      throw new Error("icacls not found");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = lockfile.writeLock({ port: 4322, token: "tok" });
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).token).toBe("tok");
    expect(warn).toHaveBeenCalledTimes(1); // dir + file failures → single warn
  });

  it("win32: non-zero icacls exit is tolerated (fail-open)", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "u" });
    lockfile._deps.spawnSync = () => ({ status: 5 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = lockfile.writeLock({ port: 4323, token: "t" });
    expect(fs.existsSync(file)).toBe(true);
  });

  it("win32: missing USERNAME is tolerated without spawning", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({});
    const spawn = vi.fn();
    lockfile._deps.spawnSync = spawn;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = lockfile.writeLock({ port: 4324, token: "t" });
    expect(fs.existsSync(file)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("non-Windows: icacls is never invoked (chmod path already correct)", () => {
    lockfile._deps.platform = () => "linux";
    const spawn = vi.fn();
    lockfile._deps.spawnSync = spawn;
    lockfile.writeLock({ port: 4325, token: "t" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
