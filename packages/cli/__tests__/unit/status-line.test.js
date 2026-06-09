/**
 * status-line — `statusLine` config loader + command renderer (Claude-Code parity).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import sl from "../../src/lib/status-line.cjs";

const { loadStatusLineConfig, renderStatusLine, buildContext, _deps } = sl;

let settingsLayers; // array of parsed settings objects (low→high)

beforeEach(() => {
  settingsLayers = [];
  _deps.readSettings = () => settingsLayers;
});

describe("loadStatusLineConfig", () => {
  it("returns null with no config", () => {
    expect(loadStatusLineConfig({ cwd: "/x" })).toBeNull();
  });
  it("accepts a bare string command", () => {
    settingsLayers = [{ statusLine: "./status.sh" }];
    expect(loadStatusLineConfig({ cwd: "/x" })).toMatchObject({
      type: "command",
      command: "./status.sh",
    });
  });
  it("accepts an object {type,command,padding}", () => {
    settingsLayers = [
      { statusLine: { type: "command", command: "s.sh", padding: 2 } },
    ];
    expect(loadStatusLineConfig({ cwd: "/x" })).toMatchObject({
      command: "s.sh",
      padding: 2,
    });
  });
  it("last layer wins; false disables", () => {
    settingsLayers = [{ statusLine: "a.sh" }, { statusLine: false }];
    expect(loadStatusLineConfig({ cwd: "/x" })).toBeNull();
  });
});

describe("renderStatusLine", () => {
  it("returns the first stdout line, trimmed", () => {
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "branch:main | $0.02\nignored second line",
      stderr: "",
    }));
    const out = renderStatusLine({ command: "s.sh" }, {}, { cwd: "/x" });
    expect(out).toBe("branch:main | $0.02");
  });
  it("passes the JSON context on stdin", () => {
    let seen = null;
    _deps.spawnSync = vi.fn((cmd, opts) => {
      seen = opts.input;
      return { status: 0, stdout: "ok", stderr: "" };
    });
    renderStatusLine({ command: "s.sh" }, buildContext({ sessionId: "S", model: "opus" }), {});
    expect(JSON.parse(seen)).toMatchObject({
      session_id: "S",
      model: { id: "opus" },
    });
  });
  it("non-zero exit → null (never breaks the REPL)", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 1, stdout: "x", stderr: "boom" }));
    expect(renderStatusLine({ command: "s.sh" }, {}, {})).toBeNull();
  });
  it("spawn error → null", () => {
    _deps.spawnSync = vi.fn(() => ({ error: new Error("ENOENT"), status: null }));
    expect(renderStatusLine({ command: "missing" }, {}, {})).toBeNull();
  });
  it("applies padding", () => {
    _deps.spawnSync = vi.fn(() => ({ status: 0, stdout: "hi", stderr: "" }));
    expect(renderStatusLine({ command: "s", padding: 2 }, {}, {})).toBe("  hi");
  });
});
