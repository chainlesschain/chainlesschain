import { afterEach, describe, expect, it, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => process.cwd()),
  },
}));

const {
  DEFAULT_ERROR_MONITOR_LIMITS,
  HARD_ERROR_MONITOR_LIMITS,
  ErrorMonitor,
} = require("../../../src/main/monitoring/error-monitor.js");
const {
  OptionalDockerRuntime,
  resolveDockerAutoStartEnabled,
} = require("../../../src/main/monitoring/optional-docker-runtime.js");

const monitors = [];
const temporaryDirectories = [];

function createMonitor(options = {}) {
  const monitor = new ErrorMonitor({
    enableAIDiagnosis: false,
    logPath: path.join(os.tmpdir(), "chainless-error-monitor-tests"),
    ...options,
  });
  monitor.saveErrorLog = vi.fn().mockResolvedValue(undefined);
  monitor.analyzeAndFix = vi.fn().mockResolvedValue({ attempted: false });
  monitors.push(monitor);
  return monitor;
}

afterEach(() => {
  for (const monitor of monitors.splice(0)) {
    monitor.destroy();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("monitoring ErrorMonitor boundaries", () => {
  it("keeps Docker recovery disabled by default", async () => {
    const run = vi.fn();
    const dockerRuntime = new OptionalDockerRuntime({
      environment: {},
      run,
    });
    const monitor = createMonitor({ dockerRuntime });

    expect(resolveDockerAutoStartEnabled(undefined, {})).toBe(false);
    await expect(monitor.restartService("ollama")).resolves.toMatchObject({
      success: false,
      skipped: true,
      reason: "disabled",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("uses Docker only after opt-in and an availability probe", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "27.0.0" });
    const dockerRuntime = new OptionalDockerRuntime({ enabled: true, run });
    const monitor = createMonitor({ dockerRuntime });

    await expect(monitor.restartService("qdrant")).resolves.toMatchObject({
      success: true,
      container: "chainlesschain-qdrant",
    });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["version", "--format", "{{.Server.Version}}"],
      ["start", "chainlesschain-qdrant"],
    ]);
  });

  it("degrades cleanly when opted in but Docker is unavailable", async () => {
    const run = vi.fn().mockRejectedValue(
      Object.assign(new Error("missing"), {
        code: "ENOENT",
      }),
    );
    const dockerRuntime = new OptionalDockerRuntime({ enabled: true, run });
    const monitor = createMonitor({ dockerRuntime });

    await expect(monitor.restartService("redis")).resolves.toMatchObject({
      success: false,
      skipped: true,
      reason: "unavailable",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("clamps hostile configuration at immutable hard limits", () => {
    const monitor = createMonitor(
      Object.fromEntries(
        Object.keys(HARD_ERROR_MONITOR_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(monitor.limits).toEqual(HARD_ERROR_MONITOR_LIMITS);
    expect(DEFAULT_ERROR_MONITOR_LIMITS.maxErrors).toBeLessThan(
      HARD_ERROR_MONITOR_LIMITS.maxErrors,
    );
  });

  it("truncates UTF-8 fields and caps retained count and bytes", async () => {
    const monitor = createMonitor({
      maxErrors: 2,
      maxMessageBytes: 9,
      maxStackBytes: 17,
      maxTypeBytes: 5,
      maxRetainedBytes: 700,
    });

    for (let index = 0; index < 4; index += 1) {
      await monitor.captureError("类型类型", {
        message: "😀😀😀😀",
        stack: "堆栈".repeat(10),
      });
    }

    const stats = monitor.getBasicErrorStats();
    expect(stats.total).toBeLessThanOrEqual(2);
    expect(stats.retainedBytes).toBeLessThanOrEqual(700);
    for (const report of stats.recentErrors) {
      expect(Buffer.byteLength(report.type, "utf8")).toBeLessThanOrEqual(5);
      expect(Buffer.byteLength(report.message, "utf8")).toBeLessThanOrEqual(9);
      expect(Buffer.byteLength(report.stack, "utf8")).toBeLessThanOrEqual(17);
      expect(report.message).not.toContain("�");
      expect(report.stack).not.toContain("�");
    }
  });

  it("returns detached reports and detached basic statistics", async () => {
    const monitor = createMonitor();
    const source = new Error("original");
    const captured = await monitor.captureError("TEST", source);

    source.message = "mutated source";
    captured.message = "mutated result";
    captured.memory.rss = -1;
    const firstStats = monitor.getBasicErrorStats();
    firstStats.recentErrors[0].message = "mutated stats";
    firstStats.recentErrors[0].memory.rss = -2;

    const secondStats = monitor.getBasicErrorStats();
    expect(secondStats.recentErrors[0].message).toBe("original");
    expect(secondStats.recentErrors[0].memory.rss).toBeGreaterThan(0);
  });

  it("returns a structured overload result at the capture concurrency cap", async () => {
    const monitor = createMonitor({ maxConcurrentCaptures: 1 });
    let releaseWrite;
    monitor.saveErrorLog = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseWrite = resolve;
        }),
    );

    const firstCapture = monitor.captureError("FIRST", new Error("first"));
    await vi.waitFor(() => expect(monitor.saveErrorLog).toHaveBeenCalledOnce());

    await expect(
      monitor.captureError("SECOND", new Error("second")),
    ).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "error_capture",
      limit: { maxConcurrentCaptures: 1 },
    });

    releaseWrite();
    await expect(firstCapture).resolves.toMatchObject({ message: "first" });
    expect(monitor.activeCaptures).toBe(0);
  });

  it("normalizes auto-fix output before retaining or returning it", async () => {
    const monitor = createMonitor({
      maxTypeBytes: 8,
      maxAutoFixMessageBytes: 12,
    });
    monitor.analyzeAndFix = vi.fn().mockResolvedValue({
      attempted: true,
      success: "truthy",
      errorType: "类型".repeat(10),
      message: "😀".repeat(20),
      secret: "must not escape",
    });

    const captured = await monitor.captureError("TEST", new Error("failure"));

    expect(captured.autoFixResult).toEqual({
      attempted: true,
      success: false,
      errorType: expect.any(String),
      message: expect.any(String),
    });
    expect(captured.autoFixResult).not.toHaveProperty("secret");
    expect(
      Buffer.byteLength(captured.autoFixResult.errorType, "utf8"),
    ).toBeLessThanOrEqual(8);
    expect(
      Buffer.byteLength(captured.autoFixResult.message, "utf8"),
    ).toBeLessThanOrEqual(12);
    expect(monitor.getBasicErrorStats().retainedBytes).toBeGreaterThan(0);
  });

  it("removes its exact global process listeners on destroy", async () => {
    const before = {
      uncaughtException: process.listenerCount("uncaughtException"),
      unhandledRejection: process.listenerCount("unhandledRejection"),
      warning: process.listenerCount("warning"),
    };
    const monitor = createMonitor();

    expect(process.listenerCount("uncaughtException")).toBe(
      before.uncaughtException + 1,
    );
    expect(process.listenerCount("unhandledRejection")).toBe(
      before.unhandledRejection + 1,
    );
    expect(process.listenerCount("warning")).toBe(before.warning + 1);

    monitor.destroy();

    expect(process.listenerCount("uncaughtException")).toBe(
      before.uncaughtException,
    );
    expect(process.listenerCount("unhandledRejection")).toBe(
      before.unhandledRejection,
    );
    expect(process.listenerCount("warning")).toBe(before.warning);
    await expect(
      monitor.captureError("AFTER_DESTROY", new Error("ignored")),
    ).resolves.toMatchObject({
      accepted: false,
      code: "CANCELED",
      scope: "error_capture",
    });
  });

  it("clears retained reports and byte accounting together", async () => {
    const monitor = createMonitor();
    await monitor.captureError("TEST", new Error("failure"));
    expect(monitor.getBasicErrorStats().retainedBytes).toBeGreaterThan(0);

    monitor.clearErrors();

    expect(monitor.getBasicErrorStats()).toMatchObject({
      total: 0,
      retainedBytes: 0,
      recentErrors: [],
    });
  });

  it("serializes, rotates, and prunes bounded daily log files", async () => {
    const monitor = createMonitor({
      maxMessageBytes: 8,
      maxStackBytes: 8,
      maxLogFileBytes: 512,
      maxLogFiles: 2,
    });
    const logPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "chainless-error-monitor-"),
    );
    temporaryDirectories.push(logPath);
    monitor.logPath = logPath;
    monitor.saveErrorLog = ErrorMonitor.prototype.saveErrorLog.bind(monitor);

    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        monitor.captureError(`TYPE-${index}`, {
          message: "m".repeat(100),
          stack: "s".repeat(100),
        }),
      ),
    );
    await monitor.logWriteChain;

    const logFiles = fs
      .readdirSync(logPath)
      .filter((filename) => filename.endsWith(".log"));
    expect(logFiles.length).toBeLessThanOrEqual(2);
    expect(logFiles.length).toBeGreaterThan(0);
    for (const filename of logFiles) {
      expect(
        fs.statSync(path.join(logPath, filename)).size,
      ).toBeLessThanOrEqual(monitor.limits.maxLogFileBytes);
    }
  });
});
