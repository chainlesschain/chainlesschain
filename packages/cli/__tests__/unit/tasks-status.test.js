/**
 * `/tasks` renderer — formats agent-core's listBackgroundShellTasks() output
 * into a human-readable block. Pure + deterministic (inject `now`).
 */
import { describe, it, expect } from "vitest";
import {
  formatBackgroundTasks,
  taskStatusLabel,
} from "../../src/repl/tasks-status.js";

const T0 = Date.parse("2026-06-14T10:00:00.000Z");

describe("taskStatusLabel", () => {
  it("badges each known status; falls back for unknown", () => {
    expect(taskStatusLabel({ status: "running" })).toBe("● running");
    expect(taskStatusLabel({ status: "exited", exitCode: 0 })).toBe(
      "✓ exited (0)",
    );
    expect(taskStatusLabel({ status: "failed", exitCode: 1 })).toBe(
      "✗ failed (1)",
    );
    expect(taskStatusLabel({ status: "error" })).toBe("✗ error");
    expect(taskStatusLabel({ status: "weird" })).toBe("weird");
    expect(taskStatusLabel({})).toBe("?");
  });
});

describe("formatBackgroundTasks", () => {
  it("explains the empty case and points at /sub-agents", () => {
    const out = formatBackgroundTasks([]);
    expect(out).toMatch(/No background shell tasks/);
    expect(out).toMatch(/\/sub-agents/);
  });

  it("renders running + finished tasks with elapsed time and a header count", () => {
    const tasks = [
      {
        id: "bg-1",
        status: "running",
        command: "npm run dev",
        exitCode: null,
        startedAt: new Date(T0 - 90_000).toISOString(), // 1m30s ago
        endedAt: null,
      },
      {
        id: "bg-2",
        status: "exited",
        command: "npm test",
        exitCode: 0,
        startedAt: new Date(T0 - 5_000).toISOString(),
        endedAt: new Date(T0 - 2_000).toISOString(), // ran 3s
      },
    ];
    const out = formatBackgroundTasks(tasks, { now: T0 });
    expect(out).toMatch(/Background shell tasks \(2, 1 running\):/);
    expect(out).toMatch(/● running {2}bg-1 {2}1m30s {2}npm run dev/);
    expect(out).toMatch(/✓ exited \(0\) {2}bg-2 {2}3s {2}npm test/);
    expect(out).toMatch(/\/tasks kill <id>/);
  });

  it("collapses whitespace and truncates long commands", () => {
    const long = "echo " + "x".repeat(200);
    const out = formatBackgroundTasks(
      [
        {
          id: "bg-9",
          status: "running",
          command: "a\n  b\t c",
          startedAt: new Date(T0).toISOString(),
          endedAt: null,
        },
        {
          id: "bg-10",
          status: "running",
          command: long,
          startedAt: new Date(T0).toISOString(),
          endedAt: null,
        },
      ],
      { now: T0 },
    );
    expect(out).toMatch(/bg-9 {2}0s {2}a b c/); // whitespace collapsed
    expect(out).toMatch(/…/); // long command truncated
    expect(out).not.toContain("x".repeat(80));
  });

  it("tolerates missing/garbage timestamps without throwing", () => {
    const out = formatBackgroundTasks(
      [{ id: "bg-x", status: "running", command: "sleep 1", startedAt: null }],
      { now: T0 },
    );
    expect(out).toMatch(/bg-x {2}\? {2}sleep 1/); // unknown elapsed → "?"
  });
});
