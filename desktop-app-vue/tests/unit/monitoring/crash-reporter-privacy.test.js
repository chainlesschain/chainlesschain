import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  crashStart: vi.fn(),
  appOn: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  showErrorBox: vi.fn(),
  showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "C:/mock-user-data"),
    getVersion: vi.fn(() => "1.2.3"),
    on: electronMocks.appOn,
    relaunch: electronMocks.relaunch,
    exit: electronMocks.exit,
  },
  crashReporter: { start: electronMocks.crashStart },
  dialog: {
    showErrorBox: electronMocks.showErrorBox,
    showMessageBox: electronMocks.showMessageBox,
  },
}));

const logSink = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../src/main/utils/logger.js", () => ({ logger: logSink }));

const {
  CrashReporter,
} = require("../../../src/main/monitoring/crash-reporter.js");

describe("CrashReporter privacy boundary", () => {
  const temporaryRoots = [];

  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 });
  });

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function createRoot() {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "chainless-crash-privacy-"),
    );
    temporaryRoots.push(root);
    return root;
  }

  function runtimeOptions() {
    return {
      app: {
        getVersion: () => "1.2.3",
        on: electronMocks.appOn,
        relaunch: electronMocks.relaunch,
        exit: electronMocks.exit,
      },
      dialog: {
        showErrorBox: electronMocks.showErrorBox,
        showMessageBox: electronMocks.showMessageBox,
      },
    };
  }

  it("stores only bounded crash metadata and never starts native dumps", async () => {
    const secret = "crash-report-private-stack-and-path";
    const root = createRoot();
    const reporter = new CrashReporter({
      ...runtimeOptions(),
      crashesDir: path.join(root, "crashes"),
      setupHandlers: false,
      showDialog: false,
      uploadToServer: true,
      submitURL: `https://private.example/${secret}`,
    });

    const filename = reporter.saveCrashReport({
      type: "uncaughtException",
      name: "TypeError",
      message: secret,
      stack: `Error: ${secret}`,
      promise: secret,
      path: secret,
    });
    const raw = fs.readFileSync(path.join(root, "crashes", filename), "utf8");
    const report = JSON.parse(raw);

    expect(electronMocks.crashStart).not.toHaveBeenCalled();
    expect(report).toEqual({
      schemaVersion: 2,
      timestamp: expect.any(String),
      crash: { type: "uncaughtException", errorName: "TypeError" },
      runtime: {
        appVersion: "1.2.3",
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(raw).not.toContain(secret);
    expect(reporter.getCrashReports()[0]).not.toHaveProperty("path");

    reporter.showCrashDialog(new Error(secret));
    await Promise.resolve();
    expect(
      JSON.stringify(electronMocks.showMessageBox.mock.calls),
    ).not.toContain(secret);
  });

  it("rewrites legacy reports before read and export", () => {
    const secret = "legacy-crash-secret";
    const root = createRoot();
    const crashesDir = path.join(root, "crashes");
    fs.mkdirSync(crashesDir, { recursive: true });
    const filename = "crash-2026-09-20T01-02-03-004Z.json";
    fs.writeFileSync(
      path.join(crashesDir, filename),
      JSON.stringify({
        timestamp: "2026-09-20T01:02:03.004Z",
        crash: {
          type: "uncaughtException",
          name: "Error",
          message: secret,
          stack: secret,
        },
        app: { version: "1.0.0", path: secret },
        system: {
          platform: process.platform,
          arch: process.arch,
          host: secret,
        },
        process: { pid: 42, versions: { secret } },
      }),
      "utf8",
    );

    const reporter = new CrashReporter({
      ...runtimeOptions(),
      crashesDir,
      setupHandlers: false,
      showDialog: false,
    });
    const migrated = fs.readFileSync(path.join(crashesDir, filename), "utf8");
    const outputPath = path.join(root, "export.json");

    expect(migrated).not.toContain(secret);
    expect(reporter.readCrashReport(filename)).toMatchObject({
      schemaVersion: 2,
      crash: { type: "uncaughtException", errorName: "Error" },
    });
    expect(reporter.exportCrashReports(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf8")).not.toContain(secret);
  });

  it("rejects report path traversal and raw crash source patterns", () => {
    const root = createRoot();
    const crashesDir = path.join(root, "crashes");
    const outside = path.join(root, "outside.json");
    fs.writeFileSync(outside, "keep", "utf8");
    const reporter = new CrashReporter({
      ...runtimeOptions(),
      crashesDir,
      setupHandlers: false,
      showDialog: false,
    });

    expect(reporter.readCrashReport("../outside.json")).toBeNull();
    expect(reporter.deleteCrashReport("../outside.json")).toBe(false);
    expect(fs.readFileSync(outside, "utf8")).toBe("keep");

    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/monitoring/crash-reporter.js"),
      "utf8",
    );
    expect(source).not.toContain("crashReporter.start");
    expect(source).not.toContain("app.getAppPath()");
    expect(source).not.toContain("process.versions");
    expect(source).not.toContain("error.stack");
    expect(source).not.toContain("String(reason)");
    expect(source).not.toContain("String(promise)");
  });
});
