/**
 * TerminalCapture — the pure ring buffer behind the `getTerminalOutput` IDE
 * tool (Claude-Code "terminal output in prompts" parity). Caps per-output and
 * entry count; formats recent executions. No vscode; runs in the CLI suite.
 */
import { describe, it, expect } from "vitest";
import {
  TerminalCapture,
  formatTerminalOutput,
} from "../../../vscode-extension/src/terminal-capture.js";

describe("TerminalCapture", () => {
  it("records executions and returns them oldest→newest", () => {
    const c = new TerminalCapture();
    c.record({ command: "npm test", exitCode: 0, output: "ok", terminal: "bash", endedAt: 1 });
    c.record({ command: "npm run build", exitCode: 1, output: "boom", terminal: "bash", endedAt: 2 });
    expect(c.size()).toBe(2);
    const r = c.recent();
    expect(r.map((e) => e.command)).toEqual(["npm test", "npm run build"]);
    expect(r[1]).toMatchObject({ exitCode: 1, output: "boom", terminal: "bash" });
  });

  it("ignores entries without a string command; coerces missing fields", () => {
    const c = new TerminalCapture();
    c.record(null);
    c.record({ output: "x" }); // no command
    c.record({ command: "ls" }); // missing exitCode/output/terminal
    expect(c.size()).toBe(1);
    expect(c.recent()[0]).toMatchObject({
      command: "ls",
      exitCode: null,
      output: "",
      terminal: "",
      endedAt: null,
    });
  });

  it("caps the buffer to maxEntries (drops oldest)", () => {
    const c = new TerminalCapture({ maxEntries: 3 });
    for (let i = 1; i <= 5; i++) c.record({ command: "cmd" + i });
    expect(c.recent().map((e) => e.command)).toEqual(["cmd3", "cmd4", "cmd5"]);
  });

  it("caps output to the most recent maxOutput chars + flags truncation", () => {
    const c = new TerminalCapture({ maxOutput: 5 });
    c.record({ command: "noisy", output: "ABCDEFGHIJ" }); // 10 chars
    const e = c.recent()[0];
    expect(e.output).toBe("FGHIJ"); // tail kept (errors live at the end)
    expect(e.outputTruncated).toBe(true);
  });

  it("recent(limit) returns the last N; clear empties", () => {
    const c = new TerminalCapture();
    for (let i = 1; i <= 4; i++) c.record({ command: "c" + i });
    expect(c.recent(2).map((e) => e.command)).toEqual(["c3", "c4"]);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.recent()).toEqual([]);
  });
});

describe("formatTerminalOutput", () => {
  it("renders command + exit + terminal + output per block", () => {
    const out = formatTerminalOutput([
      { command: "npm test", exitCode: 0, output: "12 passed", terminal: "bash" },
      { command: "git push", exitCode: 1, output: "rejected", terminal: "", outputTruncated: true },
    ]);
    expect(out).toContain("$ npm test (exit 0) [bash]\n12 passed");
    expect(out).toContain("$ git push (exit 1)\nrejected\n…(output truncated)");
  });

  it("handles no-output and unknown exit code; null for empty", () => {
    expect(formatTerminalOutput([{ command: "sleep 1", exitCode: null, output: "" }]))
      .toBe("$ sleep 1\n(no captured output)");
    expect(formatTerminalOutput([])).toBe(null);
    expect(formatTerminalOutput(null)).toBe(null);
  });
});
