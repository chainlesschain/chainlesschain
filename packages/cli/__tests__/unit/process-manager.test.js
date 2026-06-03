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
});
