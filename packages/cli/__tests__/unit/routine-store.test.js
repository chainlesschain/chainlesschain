import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RoutineStore,
  fireRoutine,
  pollGithubRoutine,
  ROUTINE_TRIGGER_KINDS,
} from "../../src/lib/routine-store.js";

let dir;
let nowMs;
const now = () => nowMs;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-routines-"));
  nowMs = Date.UTC(2026, 6, 11, 12, 0, 0); // 2026-07-11T12:00:00Z
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const store = () => new RoutineStore({ dir, now });

describe("RoutineStore definitions", () => {
  it("creates, lists, gets by id/prefix/name, enables/disables, removes", () => {
    const s = store();
    const r = s.create({
      name: "nightly",
      prompt: "do the thing",
      trigger: { kind: "cron", cron: "0 3 * * *" },
    });
    expect(r.enabled).toBe(true);
    expect(s.list()).toHaveLength(1);
    expect(s.get(r.id).name).toBe("nightly");
    expect(s.get(r.id.slice(0, 8)).id).toBe(r.id); // prefix
    expect(s.get("nightly").id).toBe(r.id); // name

    s.setEnabled(r.id, false);
    expect(s.get(r.id).enabled).toBe(false);
    s.remove(r.id);
    expect(s.list()).toHaveLength(0);
  });

  it("validates trigger kinds, cron syntax, once times, github repo", () => {
    const s = store();
    expect(ROUTINE_TRIGGER_KINDS).toEqual([
      "cron",
      "once",
      "webhook",
      "github",
    ]);
    expect(() =>
      s.create({ name: "x", prompt: "p", trigger: { kind: "nope" } }),
    ).toThrow(/trigger kind/);
    expect(() =>
      s.create({
        name: "x",
        prompt: "p",
        trigger: { kind: "cron", cron: "not a cron" },
      }),
    ).toThrow(/cron/); // parseCron raises its own descriptive message
    expect(() =>
      s.create({
        name: "x",
        prompt: "p",
        trigger: { kind: "once", at: "garbage" },
      }),
    ).toThrow(/invalid --at/);
    expect(() =>
      s.create({ name: "x", prompt: "p", trigger: { kind: "github" } }),
    ).toThrow(/--repo/);
    expect(() =>
      s.create({ name: "", prompt: "p", trigger: { kind: "webhook" } }),
    ).toThrow(/name/);
  });

  it("computes due(): cron past next-fire, once reached, disabled never", () => {
    const s = store();
    const hourly = s.create({
      name: "hourly",
      prompt: "p",
      trigger: { kind: "cron", cron: "0 * * * *" },
    });
    const oneShot = s.create({
      name: "soon",
      prompt: "p",
      trigger: { kind: "once", at: nowMs + 60_000 },
    });
    s.create({
      name: "hook",
      prompt: "p",
      trigger: { kind: "webhook" },
    });

    expect(s.due(nowMs).map((r) => r.id)).toEqual([]); // nothing yet
    nowMs += 61 * 60_000; // +61min → cron due AND once reached
    const due = s.due(nowMs).map((r) => r.name);
    expect(due).toContain("hourly");
    expect(due).toContain("soon");
    expect(due).not.toContain("hook"); // webhook never driver-fired

    s.setEnabled(hourly.id, false);
    expect(s.due(nowMs).map((r) => r.name)).not.toContain("hourly");
    expect(oneShot.trigger.at).toBeTypeOf("number");
  });
});

describe("fireRoutine + run history", () => {
  it("records start/end, persists the log, updates lastFiredAt, disables a fired once", async () => {
    const s = store();
    const r = s.create({
      name: "one",
      prompt: "say hi",
      trigger: { kind: "once", at: nowMs - 1 },
    });
    const runAgent = vi.fn(async () => ({
      exitCode: 0,
      output: "line1\nline2\nline3\nline4",
      usage: { total_tokens: 42 },
      costUsd: 0.0123,
    }));
    const runId = await fireRoutine(s, r, runAgent, { trigger: "once" });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "say hi" }),
    );
    const runs = s.listRuns({ routineId: r.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId,
      status: "ok",
      exitCode: 0,
      costUsd: 0.0123,
    });
    expect(runs[0].summary).toContain("line4");
    expect(readFileSync(s.logFile(runId), "utf-8")).toContain("line1");
    const after = s.get(r.id);
    expect(after.lastFiredAt).toBe(nowMs);
    expect(after.enabled).toBe(false); // fired `once` disables itself
  });

  it("a crashing runner records a failed run instead of throwing", async () => {
    const s = store();
    const r = s.create({
      name: "boom",
      prompt: "p",
      trigger: { kind: "webhook" },
    });
    await fireRoutine(
      s,
      r,
      async () => {
        throw new Error("provider down");
      },
      { trigger: "manual" },
    );
    const run = s.listRuns({ routineId: r.id })[0];
    expect(run.status).toBe("failed");
    expect(readFileSync(s.logFile(run.runId), "utf-8")).toContain(
      "provider down",
    );
  });

  it("summarize() aggregates ok/failed counts and cost per routine", async () => {
    const s = store();
    const r = s.create({
      name: "agg",
      prompt: "p",
      trigger: { kind: "webhook" },
    });
    await fireRoutine(s, r, async () => ({
      exitCode: 0,
      output: "ok",
      costUsd: 0.01,
    }));
    nowMs += 1000; // distinct startedAt so "newest first" is deterministic
    await fireRoutine(s, r, async () => ({ exitCode: 1, output: "bad" }));
    const summary = s.summarize(r.id);
    expect(summary).toMatchObject({ totalRuns: 2, ok: 1, failed: 1 });
    expect(summary.costUsd).toBeCloseTo(0.01);
    expect(summary.lastRun.status).toBe("failed");
  });

  it("run history tolerates corrupt rows", async () => {
    const s = store();
    const r = s.create({
      name: "x",
      prompt: "p",
      trigger: { kind: "webhook" },
    });
    await fireRoutine(s, r, async () => ({ exitCode: 0, output: "fine" }));
    const runsFile = join(dir, "runs.jsonl");
    expect(existsSync(runsFile)).toBe(true);
    const fs = await import("node:fs");
    fs.appendFileSync(runsFile, "{corrupt row\n", "utf-8");
    expect(s.listRuns({ routineId: r.id })).toHaveLength(1);
  });
});

describe("pollGithubRoutine", () => {
  it("fires once on NEW events of the wanted types and tracks the high-water id", async () => {
    const s = store();
    const r = s.create({
      name: "gh",
      prompt: "react to pushes",
      trigger: { kind: "github", repo: "acme/app", events: ["PushEvent"] },
    });
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "done" }));

    // first poll: baseline events → fires (never seen before)
    let events = [
      { id: "200", type: "PushEvent" },
      { id: "199", type: "IssuesEvent" },
    ];
    const fired1 = await pollGithubRoutine(s, s.get(r.id), {
      fetchEvents: async () => events,
      runAgent,
    });
    expect(fired1).toHaveLength(1);
    expect(s.get(r.id).lastSeenGithubEventId).toBe("200");

    // second poll: nothing new → no fire
    const fired2 = await pollGithubRoutine(s, s.get(r.id), {
      fetchEvents: async () => events,
      runAgent,
    });
    expect(fired2).toEqual([]);

    // third poll: a new unwanted-type event → high-water advances, no fire
    events = [{ id: "201", type: "IssuesEvent" }, ...events];
    const fired3 = await pollGithubRoutine(s, s.get(r.id), {
      fetchEvents: async () => events,
      runAgent,
    });
    expect(fired3).toEqual([]);
    expect(s.get(r.id).lastSeenGithubEventId).toBe("201");

    // fourth: a new PushEvent → fires
    events = [{ id: "202", type: "PushEvent" }, ...events];
    const fired4 = await pollGithubRoutine(s, s.get(r.id), {
      fetchEvents: async () => events,
      runAgent,
    });
    expect(fired4).toHaveLength(1);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });
});
