import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import {
  parseCron,
  parseCronField,
  validateCron,
  loadSchedules,
  saveSchedules,
  addSchedule,
  removeSchedule,
  setScheduleEnabled,
  updateScheduleRunState,
  CoworkCronScheduler,
  ALIASES,
  _expandExpr,
  hasSecondsResolution,
  _deps,
} from "../../src/lib/cowork-cron.js";

// ─── In-memory fake fs for tests ─────────────────────────────────────────────

function installFakeFs() {
  const files = new Map();
  _deps.existsSync = vi.fn((p) => files.has(p));
  _deps.mkdirSync = vi.fn();
  _deps.readFileSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  });
  _deps.writeFileSync = vi.fn((p, body) => {
    files.set(p, body);
  });
  return files;
}

// ─── Cron parser ─────────────────────────────────────────────────────────────

describe("parseCronField", () => {
  it("expands '*'", () => {
    expect([...parseCronField("*", [0, 5])]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("parses a single number", () => {
    expect([...parseCronField("3", [0, 10])]).toEqual([3]);
  });

  it("parses a range", () => {
    expect([...parseCronField("2-4", [0, 10])]).toEqual([2, 3, 4]);
  });

  it("parses a step", () => {
    expect([...parseCronField("*/15", [0, 59])].sort((a, b) => a - b)).toEqual([
      0, 15, 30, 45,
    ]);
  });

  it("parses a list", () => {
    const v = [...parseCronField("1,3,5", [0, 10])].sort((a, b) => a - b);
    expect(v).toEqual([1, 3, 5]);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseCronField("99", [0, 59])).toThrow(/out of range/);
  });

  it("normalizes day-of-week 7 to 0", () => {
    expect([...parseCronField("7", [0, 6])]).toEqual([0]);
  });
});

describe("parseCron", () => {
  it("rejects non-5-field expressions", () => {
    expect(() => parseCron("* * *")).toThrow(/5 or 6 fields/);
  });

  it("'* * * * *' matches every minute", () => {
    const m = parseCron("* * * * *");
    expect(m(new Date(2026, 0, 1, 12, 34))).toBe(true);
  });

  it("minute-specific cron only matches that minute", () => {
    const m = parseCron("0 * * * *");
    expect(m(new Date(2026, 0, 1, 12, 0))).toBe(true);
    expect(m(new Date(2026, 0, 1, 12, 1))).toBe(false);
  });

  it("'0 9 * * 1-5' matches weekday mornings only", () => {
    const m = parseCron("0 9 * * 1-5");
    // Jan 5 2026 is a Monday
    expect(m(new Date(2026, 0, 5, 9, 0))).toBe(true);
    // Jan 3 2026 is a Saturday
    expect(m(new Date(2026, 0, 3, 9, 0))).toBe(false);
    // Right day, wrong hour
    expect(m(new Date(2026, 0, 5, 8, 0))).toBe(false);
  });

  it("OR-semantics when both dom and dow are restricted", () => {
    // Fire on the 15th OR any Friday
    const m = parseCron("0 0 15 * 5");
    expect(m(new Date(2026, 2, 15, 0, 0))).toBe(true); // 15th
    // Jan 2 2026 is Friday
    expect(m(new Date(2026, 0, 2, 0, 0))).toBe(true); // Friday
    // Jan 6 2026 is Tuesday, not the 15th
    expect(m(new Date(2026, 0, 6, 0, 0))).toBe(false);
  });
});

describe("validateCron", () => {
  it("returns null for valid", () => {
    expect(validateCron("*/5 * * * *")).toBeNull();
  });

  it("returns error string for invalid", () => {
    expect(validateCron("not a cron")).toMatch(/5 or 6 fields|invalid/);
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe("schedule persistence", () => {
  let files;
  beforeEach(() => {
    files = installFakeFs();
    _deps.now = () => new Date("2026-04-14T00:00:00Z");
  });

  it("loadSchedules returns [] when file missing", () => {
    expect(loadSchedules("/project")).toEqual([]);
  });

  it("round-trips schedules through save/load", () => {
    const entries = [
      { id: "a", cron: "* * * * *", userMessage: "x", enabled: true },
      { id: "b", cron: "0 9 * * *", userMessage: "y", enabled: false },
    ];
    saveSchedules("/project", entries);
    expect(loadSchedules("/project")).toEqual(entries);
  });

  it("loadSchedules skips malformed lines", () => {
    files.set(
      join("/project", ".chainlesschain", "cowork", "schedules.jsonl"),
      `{"id":"a","cron":"* * * * *","userMessage":"x"}\nnot-json\n{"id":"b","cron":"0 9 * * *","userMessage":"y"}\n`,
    );
    const out = loadSchedules("/project");
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("a");
    expect(out[1].id).toBe("b");
  });
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe("CRUD operations", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.now = () => new Date("2026-04-14T00:00:00Z");
  });

  it("addSchedule validates cron expression", () => {
    expect(() =>
      addSchedule("/project", { cron: "bogus", userMessage: "x" }),
    ).toThrow(/invalid cron/);
  });

  it("addSchedule requires userMessage", () => {
    expect(() => addSchedule("/project", { cron: "* * * * *" })).toThrow(
      /userMessage is required/,
    );
  });

  it("addSchedule persists an entry and assigns an id", () => {
    const s = addSchedule("/project", {
      cron: "0 9 * * 1-5",
      templateId: "doc-convert",
      userMessage: "Morning report",
    });
    expect(s.id).toMatch(/^sch-/);
    expect(s.enabled).toBe(true);
    expect(s.lastRunAt).toBeNull();
    expect(loadSchedules("/project")).toHaveLength(1);
  });

  it("removeSchedule removes by id", () => {
    const s = addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    expect(removeSchedule("/project", s.id)).toBe(true);
    expect(loadSchedules("/project")).toEqual([]);
  });

  it("removeSchedule returns false for unknown id", () => {
    expect(removeSchedule("/project", "nope")).toBe(false);
  });

  it("setScheduleEnabled toggles the enabled flag", () => {
    const s = addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    expect(setScheduleEnabled("/project", s.id, false)).toBe(true);
    expect(loadSchedules("/project")[0].enabled).toBe(false);
  });

  it("updateScheduleRunState records lastRunAt/lastStatus", () => {
    const s = addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    updateScheduleRunState("/project", s.id, {
      lastRunAt: "2026-04-14T09:00:00Z",
      lastStatus: "completed",
    });
    const loaded = loadSchedules("/project")[0];
    expect(loaded.lastRunAt).toBe("2026-04-14T09:00:00Z");
    expect(loaded.lastStatus).toBe("completed");
  });
});

// ─── Scheduler ───────────────────────────────────────────────────────────────

describe("CoworkCronScheduler", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.now = () => new Date(2026, 0, 5, 9, 0); // Monday 9:00 local
    _deps.runTask = vi.fn(async () => ({
      taskId: "sub-abc",
      status: "completed",
    }));
  });

  it("fires due schedules on _tick", async () => {
    addSchedule("/project", {
      cron: "0 9 * * 1-5",
      userMessage: "Morning report",
    });
    const events = [];
    const sched = new CoworkCronScheduler({
      cwd: "/project",
      onEvent: (e) => events.push(e),
    });

    await sched._tick();
    // Give queued microtasks a chance to run
    await new Promise((r) => setImmediate(r));

    expect(_deps.runTask).toHaveBeenCalledOnce();
    const fired = events.find((e) => e.type === "schedule-fired");
    expect(fired).toBeTruthy();
    const done = events.find((e) => e.type === "schedule-completed");
    expect(done?.status).toBe("completed");
  });

  it("skips disabled schedules", async () => {
    const s = addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    setScheduleEnabled("/project", s.id, false);

    const sched = new CoworkCronScheduler({ cwd: "/project" });
    await sched._tick();
    await new Promise((r) => setImmediate(r));

    expect(_deps.runTask).not.toHaveBeenCalled();
  });

  it("does not fire the same schedule twice in one minute", async () => {
    addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    const sched = new CoworkCronScheduler({ cwd: "/project" });
    await sched._tick();
    await sched._tick();
    await new Promise((r) => setImmediate(r));
    expect(_deps.runTask).toHaveBeenCalledOnce();
  });

  it("fires again on a different minute", async () => {
    addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    const sched = new CoworkCronScheduler({ cwd: "/project" });
    await sched._tick();
    await new Promise((r) => setImmediate(r));

    // Advance clock one minute
    _deps.now = () => new Date(2026, 0, 5, 9, 1);
    await sched._tick();
    await new Promise((r) => setImmediate(r));

    expect(_deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("records failure and emits event when runTask throws", async () => {
    addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    _deps.runTask = vi.fn(async () => {
      throw new Error("boom");
    });
    const events = [];
    const sched = new CoworkCronScheduler({
      cwd: "/project",
      onEvent: (e) => events.push(e),
    });
    await sched._tick();
    await new Promise((r) => setImmediate(r));

    const failed = events.find((e) => e.type === "schedule-failed");
    expect(failed?.error).toBe("boom");
    expect(loadSchedules("/project")[0].lastStatus).toBe("failed");
  });

  it("emits invalid-cron event for corrupted schedules without crashing", async () => {
    // Bypass addSchedule validation by writing directly
    saveSchedules("/project", [
      {
        id: "sch-bad",
        cron: "not a cron",
        userMessage: "x",
        enabled: true,
      },
    ]);
    const events = [];
    const sched = new CoworkCronScheduler({
      cwd: "/project",
      onEvent: (e) => events.push(e),
    });
    await sched._tick();
    await new Promise((r) => setImmediate(r));

    expect(_deps.runTask).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "invalid-cron")).toBeTruthy();
  });

  it("start() / stop() manage the interval timer", () => {
    const sched = new CoworkCronScheduler({
      cwd: "/project",
      intervalMs: 60_000,
    });
    sched.start();
    expect(sched._timer).toBeTruthy();
    sched.stop();
    expect(sched._timer).toBeNull();
  });
});

// ─── N5: aliases + seconds resolution ────────────────────────────────────────

describe("N5: cron aliases", () => {
  it("expands @daily → '0 0 * * *'", () => {
    expect(_expandExpr("@daily")).toBe("0 0 * * *");
  });

  it("expands @hourly → '0 * * * *'", () => {
    expect(_expandExpr("@hourly")).toBe("0 * * * *");
  });

  it("expands @yearly and @annually identically", () => {
    expect(_expandExpr("@yearly")).toBe(_expandExpr("@annually"));
  });

  it("is case-insensitive on the alias name", () => {
    expect(_expandExpr("@DAILY")).toBe("0 0 * * *");
  });

  it("throws on unknown alias", () => {
    expect(() => _expandExpr("@bogus")).toThrow(/unknown cron alias/i);
  });

  it("validateCron accepts all 7 aliases", () => {
    for (const a of Object.keys(ALIASES)) {
      expect(validateCron(a)).toBeNull();
    }
  });

  it("parseCron('@daily') matches midnight, rejects 09:00", () => {
    const m = parseCron("@daily");
    expect(m(new Date(2026, 3, 15, 0, 0))).toBe(true);
    expect(m(new Date(2026, 3, 15, 9, 0))).toBe(false);
  });
});

describe("N5: cron 6-field (seconds) resolution", () => {
  it("parseCron accepts 6-field expression and reports hasSeconds", () => {
    const m = parseCron("30 * * * * *");
    expect(m.hasSeconds).toBe(true);
  });

  it("parseCron(5-field).hasSeconds is false", () => {
    expect(parseCron("0 9 * * *").hasSeconds).toBe(false);
  });

  it("matches at the specified second only", () => {
    const m = parseCron("30 0 12 * * *"); // 12:00:30 daily
    expect(m(new Date(2026, 3, 15, 12, 0, 30))).toBe(true);
    expect(m(new Date(2026, 3, 15, 12, 0, 31))).toBe(false);
    expect(m(new Date(2026, 3, 15, 12, 1, 30))).toBe(false);
  });

  it("supports */N step in seconds field", () => {
    const m = parseCron("*/15 * * * * *"); // every 15 seconds
    expect(m(new Date(2026, 3, 15, 12, 0, 0))).toBe(true);
    expect(m(new Date(2026, 3, 15, 12, 0, 15))).toBe(true);
    expect(m(new Date(2026, 3, 15, 12, 0, 30))).toBe(true);
    expect(m(new Date(2026, 3, 15, 12, 0, 7))).toBe(false);
  });

  it("rejects 4-field expression with helpful error", () => {
    expect(() => parseCron("0 9 * *")).toThrow(/5 or 6 fields/);
  });

  it("rejects 7-field expression", () => {
    expect(() => parseCron("0 0 0 9 * * *")).toThrow(/5 or 6 fields/);
  });

  it("hasSecondsResolution returns false for invalid expr", () => {
    expect(hasSecondsResolution("garbage")).toBe(false);
  });

  it("hasSecondsResolution returns true only for 6-field", () => {
    expect(hasSecondsResolution("0 0 * * *")).toBe(false);
    expect(hasSecondsResolution("0 0 0 * * *")).toBe(true);
    expect(hasSecondsResolution("@daily")).toBe(false);
  });
});

describe("N5: scheduler adaptive interval", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.runTask = vi.fn(async () => ({ taskId: "t1", status: "completed" }));
  });

  it("defaults to 60s when no schedules use seconds", () => {
    saveSchedules("/p", [
      {
        id: "s1",
        cron: "0 9 * * *",
        userMessage: "x",
        files: [],
        enabled: true,
      },
    ]);
    const sched = new CoworkCronScheduler({ cwd: "/p" });
    sched._adaptInterval();
    expect(sched.intervalMs).toBe(60_000);
  });

  it("drops to 1s when any enabled schedule uses 6-field cron", () => {
    saveSchedules("/p", [
      {
        id: "s1",
        cron: "0 9 * * *",
        userMessage: "x",
        files: [],
        enabled: true,
      },
      {
        id: "s2",
        cron: "*/5 * * * * *",
        userMessage: "y",
        files: [],
        enabled: true,
      },
    ]);
    const sched = new CoworkCronScheduler({ cwd: "/p" });
    sched._adaptInterval();
    expect(sched.intervalMs).toBe(1_000);
  });

  it("ignores disabled seconds-aware schedules when adapting", () => {
    saveSchedules("/p", [
      {
        id: "s1",
        cron: "*/5 * * * * *",
        userMessage: "y",
        files: [],
        enabled: false,
      },
    ]);
    const sched = new CoworkCronScheduler({ cwd: "/p" });
    sched._adaptInterval();
    expect(sched.intervalMs).toBe(60_000);
  });

  it("honors caller-pinned intervalMs (no auto-adapt)", () => {
    saveSchedules("/p", [
      {
        id: "s1",
        cron: "*/5 * * * * *",
        userMessage: "y",
        files: [],
        enabled: true,
      },
    ]);
    const sched = new CoworkCronScheduler({ cwd: "/p", intervalMs: 30_000 });
    sched._adaptInterval();
    expect(sched.intervalMs).toBe(30_000);
  });

  it("addSchedule accepts @daily alias", () => {
    const entry = addSchedule("/p", {
      cron: "@daily",
      userMessage: "morning report",
    });
    expect(entry.cron).toBe("@daily");
    expect(validateCron(entry.cron)).toBeNull();
  });

  it("addSchedule accepts 6-field seconds cron", () => {
    const entry = addSchedule("/p", {
      cron: "*/10 * * * * *",
      userMessage: "tick",
    });
    expect(entry.cron).toBe("*/10 * * * * *");
  });
});
