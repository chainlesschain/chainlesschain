/**
 * VS Code extension activity log (Phase: visualization) — ring buffer + counts
 * + listeners + arg summarization. Pure (no vscode), powers the status bar /
 * tree view / dashboard.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ActivityLog,
  summarizeArgs,
  shortenPath,
} from "../../../vscode-extension/src/activity-log.js";

describe("ActivityLog", () => {
  it("keeps newest-first recent() and caps at max", () => {
    const log = new ActivityLog({ max: 3 });
    for (let i = 0; i < 5; i++) log.record({ type: "tool", tool: `t${i}` });
    expect(log.entries()).toHaveLength(3); // capped
    expect(log.recent(2).map((e) => e.tool)).toEqual(["t4", "t3"]); // newest first
  });

  it("tallies counts (tool / connect / error)", () => {
    const log = new ActivityLog();
    log.record({ type: "connect" });
    log.record({ type: "tool", tool: "getSelection", ok: true });
    log.record({ type: "tool", tool: "openDiff", ok: false, error: "boom" });
    expect(log.counts()).toEqual({ tool: 2, connect: 1, error: 1 });
  });

  it("notifies onChange listeners and unsubscribes", () => {
    const log = new ActivityLog();
    const seen = [];
    const off = log.onChange((e) => seen.push(e && e.tool));
    log.record({ type: "tool", tool: "a" });
    off();
    log.record({ type: "tool", tool: "b" });
    expect(seen).toEqual(["a"]); // only before unsubscribe
  });

  it("a throwing listener does not break logging", () => {
    const log = new ActivityLog();
    log.onChange(() => {
      throw new Error("bad listener");
    });
    expect(() => log.record({ type: "tool", tool: "x" })).not.toThrow();
    expect(log.entries()).toHaveLength(1);
  });

  it("stamps ts when missing", () => {
    const log = new ActivityLog();
    const e = log.record({ type: "tool", tool: "x" });
    expect(typeof e.ts).toBe("number");
  });
});

describe("summarizeArgs / shortenPath", () => {
  it("summarizes openDiff + getDiagnostics by path, others empty", () => {
    expect(summarizeArgs("openDiff", { path: "/a/b/c/d.js", modifiedText: "x" })).toBe(
      "…/c/d.js",
    );
    expect(summarizeArgs("getDiagnostics", { path: "/a/b.js" })).toBe("/a/b.js");
    expect(summarizeArgs("getSelection", {})).toBe("");
  });

  it("shortenPath keeps short paths, trims long ones to last two segments", () => {
    expect(shortenPath("/a/b.js")).toBe("/a/b.js");
    expect(shortenPath("C:\\x\\y\\z\\f.ts")).toBe("…/z/f.ts");
  });
});
