/**
 * IDE MCP tool path-boundary guard (IDE gap P0#2) — verified WITHOUT a VS Code
 * host:
 *   1. pure rules: validateIdeToolPath (traversal, UNC, outside-workspace
 *      absolute paths, prefix confusion, Windows case-insensitivity, relative
 *      resolution against the first folder, CJK/space paths)
 *   2. wiring: buildIdeTools handlers refuse out-of-workspace paths for the
 *      write tools (openDiff / openMultiDiff) and the read scope
 *      (getDiagnostics), forwarding the RESOLVED path when allowed
 *   3. Windows lockfile ACL tightening: exact protected DACL, fail-closed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

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

  it("openDiff validates and resolves a rename target independently", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(
      t.openDiff.handler({
        path: INSIDE,
        modifiedText: "x",
        operation: "rename",
        targetPath: OUTSIDE,
      }),
    ).rejects.toThrow(/openDiff targetPath: unsafe write target rejected/);
    expect(facade.openDiff).not.toHaveBeenCalled();

    const target = path.join(ROOT, "src", "..", "renamed.js");
    await t.openDiff.handler({
      path: INSIDE,
      modifiedText: "x",
      operation: "rename",
      targetPath: target,
    });
    expect(facade.openDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        path: INSIDE,
        operation: "rename",
        targetPath: path.join(ROOT, "renamed.js"),
      }),
    );
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

  it("openMultiDiff validates each rename destination independently", async () => {
    const facade = fakeFacade();
    const t = byName(toolsWithBoundary(facade));
    await expect(
      t.openMultiDiff.handler({
        files: [
          {
            path: INSIDE,
            targetPath: OUTSIDE,
            originalText: "x",
            modifiedText: "x",
            operation: "rename",
          },
        ],
      }),
    ).rejects.toThrow(/openMultiDiff targetPath: unsafe write target rejected/);
    expect(facade.openMultiDiff).not.toHaveBeenCalled();

    const target = path.join(ROOT, "renamed.js");
    await t.openMultiDiff.handler({
      files: [
        {
          path: INSIDE,
          targetPath: target,
          originalText: "x",
          modifiedText: "x",
          operation: "rename",
        },
      ],
    });
    expect(facade.openMultiDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            path: INSIDE,
            targetPath: target,
            operation: "rename",
          }),
        ],
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
// Task 2: Windows lockfile ACL tightening (injectable seam, fail-closed).
// ---------------------------------------------------------------------------

describe("lockfile — Windows ACL tightening", () => {
  let tmpHome;
  const saved = {};

  function managedSecurityPolicy(name = "managed-settings.json") {
    const file = path.join(tmpHome, name);
    fs.writeFileSync(
      file,
      JSON.stringify({
        ideBridge: { allowInsecureLockfilePermissions: true },
      }),
    );
    return lockfile.loadLockfileSecurityPolicy(file);
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-acl-"));
    saved.homedir = lockfile._deps.homedir;
    saved.platform = lockfile._deps.platform;
    saved.env = lockfile._deps.env;
    saved.spawn = lockfile._deps.spawn;
    saved.spawnSync = lockfile._deps.spawnSync;
    saved.chmodSync = lockfile._deps.chmodSync;
    saved.lstatSync = lockfile._deps.lstatSync;
    saved.getuid = lockfile._deps.getuid;
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

  it("win32: replaces dir + file DACLs with one current-SID rule", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "John Doe" });
    const calls = [];
    lockfile._deps.spawnSync = (cmd, args) => {
      calls.push([cmd, args]);
      const inspecting = String(args[6] || "").includes("ownerOnly");
      return inspecting
        ? { status: 0, stdout: '{"ownerOnly":true}' }
        : { status: 0 };
    };
    const file = lockfile.writeLock({ port: 4321, token: "t" });
    expect(calls).toHaveLength(6); // apply + inspect for dir, temp, and final file
    expect(calls.every(([cmd]) => cmd === "powershell.exe")).toBe(true);
    expect(
      calls.every(([, args]) => !String(args[6] || "").includes("Get-Acl")),
    ).toBe(true);
    expect(
      calls
        .filter(([, args]) => !String(args[6] || "").includes("ownerOnly"))
        .every(([, args]) =>
          String(args[6] || "").includes("SetAccessControl"),
        ),
    ).toBe(true);
    expect(
      calls
        .filter(([, args]) => !String(args[6] || "").includes("ownerOnly"))
        .every(([, args]) => String(args[6] || "").includes("/setowner")),
    ).toBe(true);
    const dir = path.dirname(file);
    const targets = calls.map(([, args]) => args.at(-1));
    expect(targets[0]).toBe(dir);
    expect(targets[1]).toBe(dir);
    expect(targets[2]).toBe(targets[3]);
    expect(targets[2]).toContain(".tmp-");
    expect(targets[4]).toBe(file);
    expect(targets[5]).toBe(file);
  });

  it("win32 async: publishes in one non-blocking PowerShell process without token argv exposure", async () => {
    lockfile._deps.platform = () => "win32";
    const token = "a".repeat(64);
    const calls = [];
    let payload;
    lockfile._deps.spawn = (cmd, args, options) => {
      calls.push({ cmd, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      let stdin = "";
      child.stdin.setEncoding("utf8");
      child.stdin.on("data", (chunk) => {
        stdin += chunk;
      });
      child.stdin.on("finish", () => {
        payload = JSON.parse(stdin);
        const content = Buffer.from(payload.contentBase64, "base64").toString(
          "utf8",
        );
        fs.mkdirSync(payload.dir, { recursive: true });
        fs.writeFileSync(payload.file, content, "utf8");
        child.stdout.end(
          JSON.stringify({ ownerOnly: true, file: payload.file }),
        );
        queueMicrotask(() => child.emit("close", 0, null));
      });
      return child;
    };

    const file = await lockfile.writeLockAsync({
      port: 4326,
      token,
      workspaceFolders: ["C:\\work\\repo"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("powershell.exe");
    expect(calls[0].options).toMatchObject({
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(calls[0].args.join(" ")).toContain("/setowner");
    expect(calls[0].args.join(" ")).toContain("SetAccessControl");
    expect(calls[0].args.join(" ")).not.toContain("/grant:r");
    expect(calls[0].args.join(" ")).not.toContain("Get-Acl");
    expect(calls[0].args.join(" ")).not.toContain(token);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
      token,
      workspaceFolders: ["C:\\work\\repo"],
    });
    expect(payload.file).toBe(file);
    expect(payload.tmp).toContain(".tmp-");
  });

  it.runIf(process.platform === "win32")(
    "win32 real process: replaces inherited ACEs and verifies the published file",
    async () => {
      lockfile._deps.platform = () => "win32";
      lockfile._deps.spawn = saved.spawn;
      lockfile._deps.spawnSync = saved.spawnSync;
      const token = lockfile.generateToken();

      const file = await lockfile.writeLockAsync({
        port: 4329,
        token,
        workspaceFolders: ["C:\\work\\repo"],
      });
      const actual = lockfile._inspectWindowsAcl(file);

      expect(actual).toMatchObject({
        ownerOnly: true,
        protected: true,
        aceCount: 1,
      });
      expect(actual.ownerSid).toBe(actual.currentSid);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
        port: 4329,
        token,
      });
    },
  );

  it("win32 async: publisher failure is fail-closed and removes discovery files", async () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.spawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      child.stdin.on("finish", () => {
        child.stderr.end("simulated ACL verification failure");
        queueMicrotask(() => child.emit("close", 4, null));
      });
      return child;
    };

    await expect(
      lockfile.writeLockAsync({ port: 4327, token: "b".repeat(64) }),
    ).rejects.toMatchObject({
      name: "LockfileSecurityError",
      code: "CC_IDE_LOCKFILE_INSECURE",
    });
    expect(
      fs.existsSync(path.join(tmpHome, ".chainlesschain", "ide", "4327.json")),
    ).toBe(false);
  });

  it("win32 async: managed policy can downgrade publisher failure exactly once", async () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.spawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      child.stdin.on("finish", () => {
        queueMicrotask(() => child.emit("close", 5, null));
      });
      return child;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const file = await lockfile.writeLockAsync({
      port: 4328,
      token: "c".repeat(64),
      securityPolicy: managedSecurityPolicy("managed-async.json"),
    });

    expect(fs.existsSync(file)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("win32: a failing ACL command is fail-closed and removes the token file", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "u" });
    lockfile._deps.spawnSync = () => {
      throw new Error("icacls not found");
    };
    expect(() => lockfile.writeLock({ port: 4322, token: "tok" })).toThrow(
      /icacls not found/,
    );
    expect(
      fs.existsSync(path.join(tmpHome, ".chainlesschain", "ide", "4322.json")),
    ).toBe(false);
  });

  it("win32: managed policy can explicitly downgrade an ACL failure", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.env = () => ({ USERNAME: "u" });
    lockfile._deps.spawnSync = () => ({ status: 5 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = lockfile.writeLock({
      port: 4323,
      token: "t",
      securityPolicy: managedSecurityPolicy("managed-sync.json"),
    });
    expect(fs.existsSync(file)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects a caller-controlled downgrade boolean", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.spawnSync = () => ({ status: 5 });
    expect(() =>
      lockfile.writeLock({
        port: 4330,
        token: "t",
        allowInsecurePermissions: true,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_IDE_LOCKFILE_POLICY_UNMANAGED",
      }),
    );
  });

  it("fails closed when the managed policy is malformed", () => {
    const managedFile = path.join(tmpHome, "managed-invalid.json");
    fs.writeFileSync(managedFile, "{not-json");
    expect(() => lockfile.loadLockfileSecurityPolicy(managedFile)).toThrowError(
      expect.objectContaining({
        code: "CC_MANAGED_SETTINGS_INVALID",
      }),
    );
  });

  it("win32: non-zero ACL exit is fail-closed by default", () => {
    lockfile._deps.platform = () => "win32";
    lockfile._deps.spawnSync = () => ({ status: 5 });
    expect(() => lockfile.writeLock({ port: 4324, token: "t" })).toThrow(
      /status 5/,
    );
  });

  it("non-Windows: icacls is never invoked (chmod path already correct)", () => {
    lockfile._deps.platform = () => "linux";
    const spawn = vi.fn();
    lockfile._deps.spawnSync = spawn;
    const modes = new Map();
    lockfile._deps.chmodSync = (target, mode) => modes.set(target, mode);
    lockfile._deps.lstatSync = (target) => ({
      mode: modes.get(target),
      uid: 1000,
      isSymbolicLink: () => false,
    });
    lockfile._deps.getuid = () => 1000;
    lockfile.writeLock({ port: 4325, token: "t" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
