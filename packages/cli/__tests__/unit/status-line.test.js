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
  it("clamps an over-large / non-finite padding to <=80 (avoids repeat RangeError)", () => {
    for (const [padding, expected] of [
      [999999999, 80],
      ["1e999", 80], // Number("1e999") === Infinity
      [-5, 0],
      ["abc", 0],
      [5.7, 5],
    ]) {
      settingsLayers = [{ statusLine: { command: "s.sh", padding } }];
      expect(loadStatusLineConfig({ cwd: "/x" }).padding).toBe(expected);
    }
  });
});

describe("renderStatusLine", () => {
  it("returns the first stdout line, trimmed", () => {
    _deps.runProcess = vi.fn(() => ({
      status: 0,
      stdout: "branch:main | $0.02\nignored second line",
      stderr: "",
    }));
    const out = renderStatusLine({ command: "s.sh" }, {}, { cwd: "/x" });
    expect(out).toBe("branch:main | $0.02");
  });
  it("passes the JSON context on stdin", () => {
    let seen = null;
    _deps.runProcess = vi.fn((cmd, args, opts) => {
      seen = opts.input;
      return { status: 0, stdout: "ok", stderr: "" };
    });
    renderStatusLine(
      { command: "s.sh" },
      buildContext({ sessionId: "S", model: "opus" }),
      {},
    );
    expect(JSON.parse(seen)).toMatchObject({
      session_id: "S",
      model: { id: "opus" },
    });
    expect(_deps.runProcess).toHaveBeenCalledWith(
      "s.sh",
      [],
      expect.objectContaining({
        origin: "status-line:command",
        policy: "allow",
        scope: "status-line",
        shell: true,
      }),
    );
  });
  it("non-zero exit → null (never breaks the REPL)", () => {
    _deps.runProcess = vi.fn(() => ({
      status: 1,
      stdout: "x",
      stderr: "boom",
    }));
    expect(renderStatusLine({ command: "s.sh" }, {}, {})).toBeNull();
  });
  it("spawn error → null", () => {
    _deps.runProcess = vi.fn(() => ({
      error: new Error("ENOENT"),
      status: null,
    }));
    expect(renderStatusLine({ command: "missing" }, {}, {})).toBeNull();
  });
  it("applies padding", () => {
    _deps.runProcess = vi.fn(() => ({
      status: 0,
      stdout: "hi",
      stderr: "",
    }));
    expect(renderStatusLine({ command: "s", padding: 2 }, {}, {})).toBe("  hi");
  });

  it("passes COLUMNS/LINES env from explicit size and inherits process.env (2.1.153)", () => {
    let opts = null;
    _deps.runProcess = vi.fn((cmd, args, o) => {
      opts = o;
      return { status: 0, stdout: "ok", stderr: "" };
    });
    renderStatusLine({ command: "s.sh" }, {}, { columns: 120, rows: 40 });
    expect(opts.env.COLUMNS).toBe("120");
    expect(opts.env.LINES).toBe("40");
    // process.env is inherited so the shell command keeps PATH etc.
    expect(opts.env.PATH || opts.env.Path).toBe(
      process.env.PATH || process.env.Path,
    );
  });

  it("omits COLUMNS/LINES when no terminal size is known (non-TTY)", () => {
    let opts = null;
    _deps.runProcess = vi.fn((cmd, args, o) => {
      opts = o;
      return { status: 0, stdout: "ok", stderr: "" };
    });
    const realCols = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    const realRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "columns", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "rows", {
      value: undefined,
      configurable: true,
    });
    try {
      renderStatusLine({ command: "s.sh" }, {}, {});
      expect("COLUMNS" in opts.env).toBe(false);
      expect("LINES" in opts.env).toBe(false);
    } finally {
      if (realCols) Object.defineProperty(process.stdout, "columns", realCols);
      if (realRows) Object.defineProperty(process.stdout, "rows", realRows);
    }
  });
});
