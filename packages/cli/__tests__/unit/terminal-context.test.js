/**
 * Terminal-context policy core (P1-2 "交互终端" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure module: no fs /
 * clock / RNG / PTY — ANSI stripping, scrollback truncation, fail-closed
 * terminal-output-to-model gating (secret-redacted), safe background-command
 * descriptor.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCROLLBACK_LINES,
  HEALTH_STATUS,
  stripAnsi,
  truncateScrollback,
  selectTerminalContextForModel,
  normalizeHealthStatus,
  describeBackgroundCommand,
} from "../../src/lib/terminal-context.js";

const ESC = String.fromCharCode(27); // ANSI escape

describe("stripAnsi", () => {
  it("removes CSI color/style sequences", () => {
    const colored = `${ESC}[31mred${ESC}[0m ${ESC}[1;32mbold-green${ESC}[0m`;
    expect(stripAnsi(colored)).toBe("red bold-green");
  });

  it("removes cursor-move and clear sequences", () => {
    const s = `line1${ESC}[2K${ESC}[1Aline2`;
    expect(stripAnsi(s)).toBe("line1line2");
  });

  it("leaves plain text untouched and coerces non-strings to empty", () => {
    expect(stripAnsi("plain text 123")).toBe("plain text 123");
    expect(stripAnsi(null)).toBe("");
    expect(stripAnsi(undefined)).toBe("");
    expect(stripAnsi(42)).toBe("");
  });
});

describe("truncateScrollback", () => {
  it("keeps short buffers intact", () => {
    const r = truncateScrollback("a\nb\nc", 10);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("a\nb\nc");
    expect(r.droppedLines).toBe(0);
    expect(r.totalLines).toBe(3);
  });

  it("keeps the tail and marks the elision when over the cap", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n");
    const r = truncateScrollback(lines, 5);
    expect(r.truncated).toBe(true);
    expect(r.droppedLines).toBe(15);
    expect(r.totalLines).toBe(20);
    expect(r.text).toContain("15 earlier lines elided");
    expect(r.text).toContain("L19"); // last line survives
    expect(r.text).not.toContain("\nL0\n"); // early line dropped
  });

  it("falls back to the default cap for a bad maxLines", () => {
    expect(DEFAULT_SCROLLBACK_LINES).toBeGreaterThan(0);
    const lines = Array.from({ length: 3 }, (_, i) => `${i}`).join("\n");
    const r = truncateScrollback(lines, -1);
    expect(r.truncated).toBe(false);
  });
});

describe("selectTerminalContextForModel (fail-closed)", () => {
  it("attaches NOTHING unless the user explicitly opted in", () => {
    expect(selectTerminalContextForModel({ output: "secret logs" })).toBeNull();
    expect(
      selectTerminalContextForModel({ output: "logs", optIn: false }),
    ).toBeNull();
    // truthy-but-not-true is still fail-closed
    expect(
      selectTerminalContextForModel({ output: "logs", optIn: "yes" }),
    ).toBeNull();
  });

  it("returns null when opted in but there is nothing to attach", () => {
    expect(selectTerminalContextForModel({ optIn: true })).toBeNull();
    expect(
      selectTerminalContextForModel({ optIn: true, output: "   " }),
    ).toBeNull();
  });

  it("prefers the user selection over the full output when opted in", () => {
    const r = selectTerminalContextForModel({
      optIn: true,
      output: "the whole huge buffer",
      selection: "just this line",
    });
    expect(r.source).toBe("selection");
    expect(r.text).toBe("just this line");
  });

  it("falls back to full output when no selection is present", () => {
    const r = selectTerminalContextForModel({
      optIn: true,
      output: "build ok",
    });
    expect(r.source).toBe("output");
    expect(r.text).toBe("build ok");
  });

  it("ANSI-strips and secret-redacts the attached text", () => {
    const r = selectTerminalContextForModel({
      optIn: true,
      output: `${ESC}[32mdeploy${ESC}[0m token=sk-ant-api03-abcdefghijklmnop`,
    });
    expect(r.text).not.toContain(ESC);
    expect(r.text).toContain("deploy");
    expect(r.text).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(r.redacted).toBe(true);
  });

  it("caps scrollback of the attached output", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line${i}`).join("\n");
    const r = selectTerminalContextForModel({
      optIn: true,
      output: big,
      maxLines: 10,
    });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("earlier lines elided");
  });
});

describe("normalizeHealthStatus (fail-closed)", () => {
  it("maps aliases to canonical states", () => {
    expect(normalizeHealthStatus("up")).toBe(HEALTH_STATUS.RUNNING);
    expect(normalizeHealthStatus("OK")).toBe(HEALTH_STATUS.HEALTHY);
    expect(normalizeHealthStatus("degraded")).toBe(HEALTH_STATUS.UNHEALTHY);
    expect(normalizeHealthStatus("stopped")).toBe(HEALTH_STATUS.EXITED);
  });

  it("unknown/non-string → UNKNOWN", () => {
    expect(normalizeHealthStatus("weird")).toBe(HEALTH_STATUS.UNKNOWN);
    expect(normalizeHealthStatus(null)).toBe(HEALTH_STATUS.UNKNOWN);
    expect(normalizeHealthStatus(undefined)).toBe(HEALTH_STATUS.UNKNOWN);
  });
});

describe("describeBackgroundCommand", () => {
  it("builds a safe descriptor with pid, ports and status", () => {
    const d = describeBackgroundCommand({
      command: "npm run dev",
      pid: 4321,
      ports: [3000, "5173", 3000, 99999, -1],
      status: "up",
    });
    expect(d.pid).toBe(4321);
    expect(d.ports).toEqual([3000, 5173]); // deduped + validated
    expect(d.status).toBe(HEALTH_STATUS.RUNNING);
    expect(d.stoppable).toBe(true);
  });

  it("redacts a secret embedded in the command string", () => {
    const d = describeBackgroundCommand({
      command: "API_TOKEN=sk-ant-api03-abcdefghijklmnop npm start",
      pid: 10,
    });
    expect(d.command).not.toContain("sk-ant-api03-abcdefghijklmnop");
  });

  it("is not stoppable without a real pid", () => {
    const d = describeBackgroundCommand({ command: "x", pid: 0 });
    expect(d.pid).toBeNull();
    expect(d.stoppable).toBe(false);
    expect(describeBackgroundCommand({}).status).toBe(HEALTH_STATUS.UNKNOWN);
    expect(describeBackgroundCommand({}).command).toBeNull();
  });
});
