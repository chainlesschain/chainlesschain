/**
 * Unit tests: src/lib/packer/pack-update-applier.js
 *
 * The applier is the one place in the OTA chain where we mutate the running
 * exe's file path. We must test both platform branches (POSIX rename, Windows
 * sidecar cmd) without touching the real running `node` binary. Strategy:
 *
 *   - `dryRun: true` for plan-only assertions.
 *   - Injected `platform: "win32" | "posix"` forces both branches on any host.
 *   - Injected `spawnImpl` stub captures the commands we'd have run.
 *   - A throwaway "fake exe" file in os.tmpdir stands in for process.execPath.
 *
 * We deliberately test the sidecar path on non-Windows hosts by mocking
 * os.tmpdir + forcing platform="win32". The generated .cmd is never actually
 * executed — we just assert on its textual shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scheduleReplace,
  writeWindowsSidecar,
  ApplyError,
} from "../../src/lib/packer/pack-update-applier.js";

describe("scheduleReplace – argument guards", () => {
  it("rejects missing newExePath", async () => {
    await expect(
      scheduleReplace({ targetExePath: "/bin/x" }),
    ).rejects.toMatchObject({ code: "NO_NEW_EXE" });
  });

  it("rejects missing targetExePath", async () => {
    await expect(
      scheduleReplace({ newExePath: "/bin/x.new" }),
    ).rejects.toMatchObject({ code: "NO_TARGET_EXE" });
  });

  it("rejects newExePath that does not exist", async () => {
    await expect(
      scheduleReplace({
        newExePath: "/definitely/does/not/exist.exe.new",
        targetExePath: "/bin/x",
      }),
    ).rejects.toMatchObject({ code: "NEW_EXE_MISSING" });
  });
});

describe("scheduleReplace – dryRun", () => {
  let tmpDir;
  let newExe;
  let target;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-apply-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-bytes", "utf-8");
    fs.writeFileSync(target, "old-bytes", "utf-8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns a plan and does not touch the filesystem", async () => {
    const r = await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      dryRun: true,
    });
    expect(r.action).toBe("dry-run");
    expect(r.targetExePath).toBe(target);
    expect(r.newExePath).toBe(newExe);
    expect(r.sidecarPath).toBeNull();
    // Target content must still be the old bytes — the plan hasn't executed.
    expect(fs.readFileSync(target, "utf-8")).toBe("old-bytes");
    expect(fs.readFileSync(newExe, "utf-8")).toBe("new-bytes");
  });

  it("dryRun respects the forced platform", async () => {
    const r = await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      dryRun: true,
      platform: "win32",
    });
    expect(r.platform).toBe("win32");
  });
});

describe("scheduleReplace – POSIX branch", () => {
  let tmpDir;
  let newExe;
  let target;
  let spawnCalls;
  const fakeSpawn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    return { unref: () => {} };
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-apply-posix-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-payload", "utf-8");
    fs.writeFileSync(target, "old-payload", "utf-8");
    spawnCalls = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("renames new → target atomically", async () => {
    const r = await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      platform: "posix",
      spawnImpl: fakeSpawn,
    });
    expect(r.action).toBe("replace-in-place");
    expect(r.sidecarPath).toBeNull();
    expect(fs.existsSync(newExe)).toBe(false);
    expect(fs.readFileSync(target, "utf-8")).toBe("new-payload");
    // restart not requested → no spawn
    expect(spawnCalls).toEqual([]);
  });

  it("restart=true spawns the new exe detached after rename", async () => {
    await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      restart: true,
      platform: "posix",
      spawnImpl: fakeSpawn,
    });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe(target);
    expect(spawnCalls[0].opts.detached).toBe(true);
    expect(spawnCalls[0].opts.stdio).toBe("ignore");
  });

  it("chmod +x is applied before rename (exec bit survives)", async () => {
    // Start new.exe as mode 0644 (no exec bit)
    fs.chmodSync(newExe, 0o644);
    await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      platform: "posix",
      spawnImpl: fakeSpawn,
    });
    if (process.platform !== "win32") {
      // Inspect the real FS only on POSIX where chmod is meaningful.
      const mode = fs.statSync(target).mode & 0o777;
      expect(mode & 0o100).toBe(0o100); // owner exec
    }
  });
});

describe("scheduleReplace – Windows branch (sidecar cmd)", () => {
  let tmpDir;
  let newExe;
  let target;
  let spawnCalls;
  const fakeSpawn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    return { unref: () => {} };
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-apply-win-"));
    newExe = path.join(tmpDir, "new.exe");
    target = path.join(tmpDir, "current.exe");
    fs.writeFileSync(newExe, "new-bytes", "utf-8");
    fs.writeFileSync(target, "old-bytes", "utf-8");
    spawnCalls = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("writes a .cmd sidecar and spawns cmd.exe detached", async () => {
    const r = await scheduleReplace({
      newExePath: newExe,
      targetExePath: target,
      platform: "win32",
      parentPid: 12345,
      spawnImpl: fakeSpawn,
    });
    expect(r.action).toBe("sidecar-cmd");
    expect(r.sidecarPath).toBeTruthy();
    expect(fs.existsSync(r.sidecarPath)).toBe(true);
    // The real FS is untouched — sidecar hasn't run.
    expect(fs.readFileSync(target, "utf-8")).toBe("old-bytes");
    expect(fs.readFileSync(newExe, "utf-8")).toBe("new-bytes");
    // Sidecar spawned with cmd.exe /c <path>, detached, windowsHide.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("cmd.exe");
    expect(spawnCalls[0].args[0]).toBe("/c");
    expect(spawnCalls[0].args[1]).toBe(r.sidecarPath);
    expect(spawnCalls[0].opts.detached).toBe(true);
    expect(spawnCalls[0].opts.windowsHide).toBe(true);
    // Cleanup
    try {
      fs.unlinkSync(r.sidecarPath);
    } catch {
      /* best effort */
    }
  });
});

describe("writeWindowsSidecar (cmd body)", () => {
  let tmpFiles = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best effort */
      }
    }
    tmpFiles = [];
  });

  it("emits a cmd that waits on PARENT_PID, moves, and self-deletes", () => {
    const p = writeWindowsSidecar({
      newExePath: "C:\\Users\\u\\app.exe.new",
      targetExePath: "C:\\Users\\u\\app.exe",
      parentPid: 7777,
      restart: false,
    });
    tmpFiles.push(p);
    const body = fs.readFileSync(p, "utf-8");
    expect(body).toContain("@echo off");
    expect(body).toContain("set PARENT_PID=7777");
    expect(body).toContain('set NEW_EXE="C:\\Users\\u\\app.exe.new"');
    expect(body).toContain('set TARGET_EXE="C:\\Users\\u\\app.exe"');
    expect(body).toContain("tasklist");
    expect(body).toContain("move /Y %NEW_EXE% %TARGET_EXE%");
    expect(body).toContain("REM restart not requested");
    expect(body).toContain('del "%~f0"');
  });

  it("emits a `start` line when restart=true", () => {
    const p = writeWindowsSidecar({
      newExePath: "C:\\x.new",
      targetExePath: "C:\\x",
      parentPid: 1,
      restart: true,
    });
    tmpFiles.push(p);
    const body = fs.readFileSync(p, "utf-8");
    expect(body).toContain('start "" %TARGET_EXE%');
    expect(body).not.toContain("REM restart not requested");
  });

  it("each invocation produces a unique sidecar path", () => {
    const a = writeWindowsSidecar({
      newExePath: "C:\\n",
      targetExePath: "C:\\t",
      parentPid: 1,
      restart: false,
    });
    const b = writeWindowsSidecar({
      newExePath: "C:\\n",
      targetExePath: "C:\\t",
      parentPid: 1,
      restart: false,
    });
    tmpFiles.push(a, b);
    expect(a).not.toBe(b);
  });

  it("ApplyError is a typed Error with a code", () => {
    const e = new ApplyError("test", "XYZ");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApplyError");
    expect(e.code).toBe("XYZ");
  });
});
