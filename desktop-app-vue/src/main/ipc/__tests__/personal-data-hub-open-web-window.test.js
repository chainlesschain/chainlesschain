/**
 * V6 PDH bridge — `openPdhWebWindow` helper test.
 *
 * Tests the URL discovery + window-opening logic via `_deps` injection
 * (vi.mock can't intercept require('electron') in CJS modules — see
 * memory vi_mock_cjs_interop_systemic). The actual IPC `handle` wiring
 * is trivial passthrough; we don't double-test electron's ipcMain.
 *
 * Coverage:
 *   1. desktop.port missing            → error: web-shell-not-running
 *   2. desktop.port present + valid    → BrowserWindow.loadURL(target)
 *   3. route param sanitized           → defaults / non-slash rejected
 *   4. BrowserWindow ctor throws       → fall back to openExternal
 *   5. Both throw                      → error: open-failed
 *   6. desktop.port unparseable JSON   → treated as missing
 *   7. desktop.port missing port field → treated as missing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Hub wiring deps that personal-data-hub-ipc.js imports at module-load
// time. The open-web-window helper doesn't touch them; null stubs suffice.
vi.mock("../../personal-data-hub/wiring.js", () => ({
  getHub: vi.fn(),
}));
vi.mock("../../personal-data-hub/aichat-wizard-factory.js", () => ({
  getAIChatWizard: vi.fn(),
}));
vi.mock("@chainlesschain/personal-data-hub", () => ({
  ingestSystemDataAndroidSnapshot: vi.fn(),
}));

const { openPdhWebWindow } = require("../personal-data-hub-ipc.js");

let tmpHome;

function writePortFile(info) {
  const dir = path.join(tmpHome, ".chainlesschain");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "desktop.port"), JSON.stringify(info));
}

function mkDeps(overrides = {}) {
  // Tracks calls to BrowserWindow + loadURL for assertions.
  const calls = { createdOpts: null, loadedUrl: null, externalUrl: null };
  return {
    calls,
    deps: {
      fs,
      homedir: () => tmpHome,
      BrowserWindow: vi.fn(function (opts) {
        calls.createdOpts = opts;
        return {
          loadURL: (url) => {
            calls.loadedUrl = url;
          },
        };
      }),
      openExternal: (url) => {
        calls.externalUrl = url;
        return Promise.resolve();
      },
      logWarn: vi.fn(),
      ...overrides,
    },
  };
}

describe("openPdhWebWindow", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-openwin-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch (_e) {}
  });

  it("returns web-shell-not-running when desktop.port is missing", async () => {
    const { deps } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.error).toBe("web-shell-not-running");
    expect(result.message).toMatch(/cc ui/);
  });

  it("creates a BrowserWindow at the resolved URL when port file is present", async () => {
    writePortFile({ host: "127.0.0.1", port: 7060, pid: 1234 });
    const { deps, calls } = mkDeps();

    const result = await openPdhWebWindow({
      route: "/personal-data-hub",
      _deps: deps,
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe("http://127.0.0.1:7060/personal-data-hub");
    expect(calls.loadedUrl).toBe("http://127.0.0.1:7060/personal-data-hub");
    expect(calls.createdOpts.title).toBe("个人数据中台");
    expect(calls.createdOpts.webPreferences.contextIsolation).toBe(true);
    expect(calls.createdOpts.webPreferences.nodeIntegration).toBe(false);
  });

  it("defaults route to /personal-data-hub when omitted", async () => {
    writePortFile({ host: "127.0.0.1", port: 7060 });
    const { deps, calls } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.ok).toBe(true);
    expect(calls.loadedUrl).toBe("http://127.0.0.1:7060/personal-data-hub");
  });

  it("rejects non-slash-prefixed route (no open-redirect) and falls back to default", async () => {
    writePortFile({ host: "127.0.0.1", port: 7060 });
    const { deps, calls } = mkDeps();
    // Attempt to bypass with absolute URL — must be ignored.
    await openPdhWebWindow({
      route: "https://evil.example.com/x",
      _deps: deps,
    });
    expect(calls.loadedUrl).toBe("http://127.0.0.1:7060/personal-data-hub");
  });

  it("falls back to openExternal when BrowserWindow ctor throws", async () => {
    writePortFile({ host: "127.0.0.1", port: 7060 });
    const { deps, calls } = mkDeps({
      BrowserWindow: vi.fn(() => {
        throw new Error("display locked");
      }),
    });
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.ok).toBe(true);
    expect(result.fallback).toBe("external");
    expect(calls.externalUrl).toBe("http://127.0.0.1:7060/personal-data-hub");
  });

  it("returns open-failed when both BrowserWindow and openExternal throw", async () => {
    writePortFile({ host: "127.0.0.1", port: 7060 });
    const { deps } = mkDeps({
      BrowserWindow: vi.fn(() => {
        throw new Error("display locked");
      }),
      openExternal: () => Promise.reject(new Error("xdg-open missing")),
    });
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.error).toBe("open-failed");
    expect(result.message).toMatch(/display locked/);
  });

  it("treats unparseable desktop.port as missing", async () => {
    const dir = path.join(tmpHome, ".chainlesschain");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "desktop.port"), "not-json{");
    const { deps } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.error).toBe("web-shell-not-running");
  });

  it("treats incomplete port file (missing port AND httpUrl) as missing", async () => {
    writePortFile({ host: "127.0.0.1" });
    const { deps } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.error).toBe("web-shell-not-running");
  });

  it("prefers pre-formed httpUrl over host+port (covers port:null real shape)", async () => {
    // This is the actual shape index.js:1043 writes when handle.port is
    // null (OS-assigned port only visible via handle.httpUrl/wsUrl).
    writePortFile({
      pid: 1132,
      host: "127.0.0.1",
      port: null,
      httpUrl: "http://127.0.0.1:49781/",
      wsUrl: "ws://127.0.0.1:49780/",
    });
    const { deps, calls } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.ok).toBe(true);
    // Trailing slash from httpUrl must be stripped to avoid http://...:port//personal-data-hub
    expect(result.url).toBe("http://127.0.0.1:49781/personal-data-hub");
    expect(calls.loadedUrl).toBe("http://127.0.0.1:49781/personal-data-hub");
  });

  it("propagates port file unreadable error to logger.warn (deps.logWarn)", async () => {
    const dir = path.join(tmpHome, ".chainlesschain");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "desktop.port"), "{invalid");
    const { deps } = mkDeps();
    const result = await openPdhWebWindow({ _deps: deps });
    expect(result.error).toBe("web-shell-not-running");
    expect(deps.logWarn).toHaveBeenCalled();
  });
});
