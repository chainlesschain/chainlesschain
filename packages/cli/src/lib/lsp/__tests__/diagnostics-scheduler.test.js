/**
 * Edit-triggered auto-diagnostics scheduler (P2) — debounce, throttle, and
 * token-cap. Pure + clock-injected.
 */
import { describe, it, expect } from "vitest";
import {
  DiagnosticsScheduler,
  capDiagnostics,
} from "../diagnostics-scheduler.js";

describe("DiagnosticsScheduler — debounce", () => {
  it("coalesces a burst of edits into one run after the quiet period", () => {
    const s = new DiagnosticsScheduler({ debounceMs: 300, throttleMs: 1000 });
    s.noteEdit("f.js", 0).noteEdit("f.js", 100).noteEdit("f.js", 200);
    expect(s.due(400)).toEqual([]); // last edit at 200, only 200ms quiet
    expect(s.due(500)).toEqual(["f.js"]); // 300ms after the last edit
    expect(s.pendingCount()).toBe(0);
  });
});

describe("DiagnosticsScheduler — throttle", () => {
  it("won't run the same file again within the throttle window", () => {
    const s = new DiagnosticsScheduler({ debounceMs: 100, throttleMs: 1000 });
    s.noteEdit("f.js", 0);
    expect(s.due(200)).toEqual(["f.js"]); // first run at 200
    s.noteEdit("f.js", 300);
    expect(s.due(500)).toEqual([]); // throttled (only 300ms since last run)
    expect(s.pendingCount()).toBe(1); // stays pending
    expect(s.due(1300)).toEqual(["f.js"]); // window passed → runs
  });
});

describe("DiagnosticsScheduler — msUntilNextDue", () => {
  it("reports the earliest time a pending file can run", () => {
    const s = new DiagnosticsScheduler({ debounceMs: 300, throttleMs: 1000 });
    s.noteEdit("f.js", 100);
    expect(s.msUntilNextDue(200)).toBe(200); // ready at 400, now 200
    expect(s.msUntilNextDue(500)).toBe(0); // already due
    s.reset();
    expect(s.msUntilNextDue(0)).toBeNull();
  });

  it("independent files debounce independently", () => {
    const s = new DiagnosticsScheduler({ debounceMs: 300, throttleMs: 1000 });
    s.noteEdit("a.js", 0).noteEdit("b.js", 200);
    expect(s.due(350).sort()).toEqual(["a.js"]); // b still settling
    expect(s.due(600)).toEqual(["b.js"]);
  });
});

describe("capDiagnostics — token cap, least-severe dropped first", () => {
  const mk = (severity, message) => ({ severity, message });

  it("keeps within the token budget and drops the tail", () => {
    const long = "x".repeat(400); // ~106 tokens each
    const diags = [
      mk("error", long),
      mk("error", long),
      mk("warning", long),
      mk("hint", long),
    ];
    const r = capDiagnostics(diags, { maxTokens: 220 });
    expect(r.kept.length).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.dropped).toBe(2);
  });

  it("prioritizes by severity — errors kept, hints dropped", () => {
    const long = "y".repeat(400);
    const diags = [mk("hint", long), mk("error", long), mk("warning", long)];
    const r = capDiagnostics(diags, { maxTokens: 120 });
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].severity).toBe("error"); // most severe survived
  });

  it("accepts numeric LSP severities (1=error … 4=hint)", () => {
    const long = "z".repeat(400);
    const r = capDiagnostics([mk(4, long), mk(1, long)], { maxTokens: 120 });
    expect(r.kept[0].severity).toBe(1);
  });

  it("keeps at least one item and is a no-op under budget", () => {
    const small = [mk("error", "short")];
    expect(capDiagnostics(small, { maxTokens: 10000 })).toMatchObject({
      dropped: 0,
      truncated: false,
    });
    // a single huge item is still kept (never emit empty)
    expect(
      capDiagnostics([mk("error", "q".repeat(9999))], { maxTokens: 5 }).kept,
    ).toHaveLength(1);
  });
});
