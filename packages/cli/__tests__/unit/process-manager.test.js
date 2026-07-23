import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("process-manager", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-pm-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("isAppRunning returns false when no PID file exists", async () => {
    vi.doMock("../../src/lib/paths.js", () => ({
      getPidFilePath: () => join(tempDir, "app.pid"),
      getBinDir: () => join(tempDir, "bin"),
      ensureDir: (d) => d,
      getStatePath: () => tempDir,
    }));
    vi.resetModules();
    const { isAppRunning } = await import("../../src/lib/process-manager.js");
    expect(isAppRunning()).toBe(false);
  });

  it("getAppPid returns null when no PID file exists", async () => {
    vi.doMock("../../src/lib/paths.js", () => ({
      getPidFilePath: () => join(tempDir, "nope.pid"),
      getBinDir: () => join(tempDir, "bin"),
      ensureDir: (d) => d,
      getStatePath: () => tempDir,
    }));
    vi.resetModules();
    const { getAppPid } = await import("../../src/lib/process-manager.js");
    expect(getAppPid()).toBeNull();
  });

  it("getAppPid reads PID from file", async () => {
    const pidFile = join(tempDir, "app.pid");
    writeFileSync(pidFile, "12345");
    vi.doMock("../../src/lib/paths.js", () => ({
      getPidFilePath: () => pidFile,
      getBinDir: () => join(tempDir, "bin"),
      ensureDir: (d) => d,
      getStatePath: () => tempDir,
    }));
    vi.resetModules();
    const { getAppPid } = await import("../../src/lib/process-manager.js");
    expect(getAppPid()).toBe(12345);
  });

  function mockPaths(pidFile) {
    vi.doMock("../../src/lib/paths.js", () => ({
      getPidFilePath: () => pidFile,
      getBinDir: () => join(tempDir, "bin"),
      ensureDir: (d) => d,
      getStatePath: () => tempDir,
    }));
    vi.resetModules();
  }

  it("getAppPid returns null for a corrupt PID file (not NaN)", async () => {
    const pidFile = join(tempDir, "app.pid");
    writeFileSync(pidFile, "not-a-pid");
    mockPaths(pidFile);
    const { getAppPid } = await import("../../src/lib/process-manager.js");
    expect(getAppPid()).toBeNull();
  });

  it("isAppRunning treats a corrupt PID file as not-running and removes it", async () => {
    const pidFile = join(tempDir, "app.pid");
    writeFileSync(pidFile, "garbage\n");
    mockPaths(pidFile);
    const { isAppRunning } = await import("../../src/lib/process-manager.js");
    expect(isAppRunning()).toBe(false);
    expect(existsSync(pidFile)).toBe(false); // stale file cleaned up
  });

  it("stopApp returns false for a corrupt PID file instead of a false success", async () => {
    const pidFile = join(tempDir, "app.pid");
    writeFileSync(pidFile, "   ");
    mockPaths(pidFile);
    const { stopApp } = await import("../../src/lib/process-manager.js");
    // Before the fix this returned true (taskkill/kill on NaN silently no-ops).
    expect(stopApp()).toBe(false);
    expect(existsSync(pidFile)).toBe(false); // corrupt file removed
  });

  it("starts the desktop executable through the app Broker scope", async () => {
    const pidFile = join(tempDir, "app.pid");
    const appPath = join(tempDir, 'ChainlessChain "safe".exe');
    mockPaths(pidFile);
    vi.doMock("../../src/lib/platform.js", () => ({
      isWindows: () => false,
    }));
    const { _deps, startApp } =
      await import("../../src/lib/process-manager.js");
    const child = { pid: 4242, unref: vi.fn() };
    _deps.spawn = vi.fn(() => child);

    expect(startApp({ appPath, headless: true, env: { CC_TEST: "1" } })).toBe(
      4242,
    );
    expect(_deps.spawn).toHaveBeenCalledWith(
      appPath,
      ["--headless"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        origin: "app:start",
        policy: "allow",
        scope: "app",
        shell: false,
        env: expect.objectContaining({ CC_TEST: "1" }),
      }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
    expect(readFileSync(pidFile, "utf-8")).toBe("4242");
  });

  it("stops a Windows process with taskkill argv instead of a shell string", async () => {
    const pidFile = join(tempDir, "app.pid");
    writeFileSync(pidFile, "4321");
    mockPaths(pidFile);
    vi.doMock("../../src/lib/platform.js", () => ({
      isWindows: () => true,
    }));
    const { _deps, stopApp } = await import("../../src/lib/process-manager.js");
    _deps.execFileSync = vi.fn(() => "");

    expect(stopApp()).toBe(true);
    expect(_deps.execFileSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4321", "/T", "/F"],
      {
        stdio: "ignore",
        origin: "app:stop",
        policy: "allow",
        scope: "app",
        shell: false,
      },
    );
    expect(existsSync(pidFile)).toBe(false);
  });

  describe("parsePid", () => {
    it("parses valid positive integers (trimmed)", async () => {
      vi.resetModules();
      const { parsePid } = await import("../../src/lib/process-manager.js");
      expect(parsePid("12345")).toBe(12345);
      expect(parsePid("  678 \n")).toBe(678);
    });

    it("rejects corrupt / empty / non-positive content as null", async () => {
      vi.resetModules();
      const { parsePid } = await import("../../src/lib/process-manager.js");
      expect(parsePid("not-a-pid")).toBeNull();
      expect(parsePid("")).toBeNull();
      expect(parsePid("   ")).toBeNull();
      expect(parsePid("0")).toBeNull();
      expect(parsePid("-5")).toBeNull();
    });
  });
});
