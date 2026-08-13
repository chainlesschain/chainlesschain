import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import {
  parseCron,
  parseCronField,
  validateCron,
  loadSchedules,
  saveSchedules,
  addSchedule,
  ensureScheduleNextAt,
  removeSchedule,
  setScheduleEnabled,
  updateScheduleRunState,
  claimScheduleFire,
  renewScheduleFire,
  settleScheduleFire,
  CoworkCronScheduler,
  ALIASES,
  _expandExpr,
  hasSecondsResolution,
  latestCoworkCronTime,
  nextCoworkCronTime,
  coworkCronFireKey,
  _deps,
} from "../../src/lib/cowork-cron.js";

// ─── In-memory fake fs for tests ─────────────────────────────────────────────

function installFakeFs() {
  const files = new Map();
  const descriptors = new Map();
  let nextDescriptor = 10;
  _deps.mkdirSync = vi.fn();
  _deps.readFileSync = vi.fn((p) => {
    if (!files.has(p)) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    return files.get(p);
  });
  _deps.openSync = vi.fn((p, flags) => {
    if (flags === "wx" && files.has(p)) {
      throw Object.assign(new Error(`EEXIST: ${p}`), { code: "EEXIST" });
    }
    const descriptor = nextDescriptor++;
    descriptors.set(descriptor, p);
    if (flags === "wx") files.set(p, "");
    return descriptor;
  });
  _deps.writeSync = vi.fn((descriptor, buffer, offset, length) => {
    const path = descriptors.get(descriptor);
    if (!path) throw new Error(`EBADF: ${descriptor}`);
    const prior = files.get(path) || Buffer.alloc(0);
    const chunk = Buffer.from(buffer).subarray(offset, offset + length);
    files.set(
      path,
      Buffer.concat([Buffer.from(prior), chunk]).toString("utf8"),
    );
    return chunk.length;
  });
  _deps.fsyncSync = vi.fn((descriptor) => {
    if (!descriptors.has(descriptor)) throw new Error(`EBADF: ${descriptor}`);
  });
  _deps.closeSync = vi.fn((descriptor) => {
    if (!descriptors.delete(descriptor))
      throw new Error(`EBADF: ${descriptor}`);
  });
  _deps.renameSync = vi.fn((from, to) => {
    if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
    files.set(to, files.get(from));
    files.delete(from);
  });
  _deps.unlinkSync = vi.fn((p) => {
    files.delete(p);
  });
  _deps.withFileLock = vi.fn((_target, body) => body({ locked: true }));
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

  it("evaluates both real instants of a repeated IANA wall minute", () => {
    const matcher = parseCron("30 1 * * *", {
      timeZone: "America/New_York",
    });
    expect(matcher(new Date("2026-11-01T05:30:00Z"))).toBe(true);
    expect(matcher(new Date("2026-11-01T06:30:00Z"))).toBe(true);
    expect(matcher(new Date("2026-11-01T07:30:00Z"))).toBe(false);
  });

  it("skips a nonexistent spring-forward wall minute", () => {
    expect(
      nextCoworkCronTime("30 2 * * *", Date.parse("2026-03-08T05:00:00Z"), {
        timeZone: "America/New_York",
      }),
    ).toBe(Date.parse("2026-03-09T06:30:00Z"));
  });

  it("preserves POSIX dom/dow OR semantics when finding the next instant", () => {
    expect(
      nextCoworkCronTime("0 0 15 * 5", new Date(2026, 0, 1, 0, 0).getTime()),
    ).toBe(new Date(2026, 0, 2, 0, 0).getTime());
  });

  it("collapses six-field catch-up to the latest due second", () => {
    expect(
      latestCoworkCronTime(
        "0,30 * * * * *",
        Date.parse("2026-01-01T00:00:00Z"),
        Date.parse("2026-01-01T00:03:42Z"),
        { timeZone: "UTC" },
      ),
    ).toBe(Date.parse("2026-01-01T00:03:30Z"));
  });

  it("collapses a long every-second outage without replaying each second", () => {
    expect(
      latestCoworkCronTime(
        "* * * * * *",
        Date.parse("2026-01-01T00:00:00Z"),
        Date.parse("2026-08-12T12:34:56.789Z"),
        { timeZone: "UTC" },
      ),
    ).toBe(Date.parse("2026-08-12T12:34:56Z"));
  });

  it("uses real instants for fire identity across fall-back", () => {
    const schedule = {
      id: "dst",
      cron: "30 1 * * *",
      timeZone: "America/New_York",
    };
    expect(
      coworkCronFireKey(schedule, new Date("2026-11-01T05:30:00Z")),
    ).not.toBe(coworkCronFireKey(schedule, new Date("2026-11-01T06:30:00Z")));
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

  it("treats only ENOENT as empty and exposes other read failures stably", () => {
    const file = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "schedules.jsonl",
    );
    const denied = Object.assign(new Error("access denied"), {
      code: "EACCES",
    });
    _deps.readFileSync = vi.fn(() => {
      throw denied;
    });

    expect(() => loadSchedules("/project", { failOnMalformed: true })).toThrow(
      expect.objectContaining({
        code: "COWORK_SCHEDULE_STORE_READ_FAILED",
        fsCode: "EACCES",
        filePath: file,
        cause: denied,
      }),
    );
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
    expect(_deps.withFileLock).toHaveBeenCalledWith(
      expect.stringContaining("schedules.jsonl"),
      expect.any(Function),
      expect.objectContaining({ failIfUnavailable: true }),
    );
  });

  it("persists a canonical IANA zone and explicit collapse cursor", () => {
    const schedule = addSchedule("/project", {
      cron: "0 9 * * *",
      timeZone: "Asia/Kathmandu",
      userMessage: "zoned",
    });
    expect(schedule).toMatchObject({
      timeZone: "Asia/Katmandu",
      missedRunPolicy: "collapse",
      nextAt: Date.parse("2026-04-14T03:15:00Z"),
    });
  });

  it("does not overwrite a malformed durable schedule store", () => {
    const file = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "schedules.jsonl",
    );
    const malformed = '{"id":"kept"}\nnot-json\n';
    // Seed the private fake filesystem through the same exclusive-create seam
    // used by production persistence.
    const descriptor = _deps.openSync(file, "wx", 0o600);
    const bytes = Buffer.from(malformed, "utf8");
    _deps.writeSync(descriptor, bytes, 0, bytes.length, null);
    _deps.closeSync(descriptor);

    expect(() =>
      addSchedule("/project", {
        cron: "* * * * *",
        userMessage: "must not replace the corrupt store",
      }),
    ).toThrow(/malformed JSON/);
    expect(_deps.readFileSync(file)).toBe(malformed);
  });

  it("does not replace a syntactically valid non-object schedule record", () => {
    const file = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "schedules.jsonl",
    );
    const descriptor = _deps.openSync(file, "wx", 0o600);
    const bytes = Buffer.from("null\n", "utf8");
    _deps.writeSync(descriptor, bytes, 0, bytes.length, null);
    _deps.closeSync(descriptor);

    expect(() =>
      addSchedule("/project", {
        cron: "* * * * *",
        userMessage: "must not replace the corrupt store",
      }),
    ).toThrow(
      expect.objectContaining({ code: "COWORK_SCHEDULE_STORE_CORRUPT" }),
    );
    expect(_deps.readFileSync(file)).toBe("null\n");
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

  it("re-enabling resets the cursor instead of replaying disabled periods", () => {
    const schedule = addSchedule("/project", {
      cron: "0 * * * *",
      userMessage: "x",
    });
    setScheduleEnabled("/project", schedule.id, false);
    _deps.now = () => new Date("2026-04-14T04:30:00Z");
    setScheduleEnabled("/project", schedule.id, true);
    expect(loadSchedules("/project")[0]).toMatchObject({
      enabled: true,
      nextAt: Date.parse("2026-04-14T05:00:00Z"),
      missedRunPolicy: "collapse",
    });
  });

  it("migrates a legacy schedule without replaying pre-upgrade history", () => {
    saveSchedules("/project", [
      {
        id: "legacy",
        cron: "0 * * * *",
        userMessage: "x",
        enabled: true,
        createdAt: "2026-04-14T00:30:00Z",
        lastRunAt: null,
      },
    ]);
    _deps.now = () => new Date("2026-04-14T04:30:00Z");
    const migrated = ensureScheduleNextAt("/project", "legacy", _deps.now());
    expect(migrated).toMatchObject({
      nextAt: Date.parse("2026-04-14T05:00:00Z"),
      missedRunPolicy: "collapse",
    });
  });

  it("migrates from durable lastRunAt so one missed run can collapse", () => {
    saveSchedules("/project", [
      {
        id: "legacy-ran",
        cron: "0 * * * *",
        userMessage: "x",
        enabled: true,
        createdAt: "2026-04-14T00:30:00Z",
        lastRunAt: "2026-04-14T01:00:00Z",
      },
    ]);
    const migrated = ensureScheduleNextAt(
      "/project",
      "legacy-ran",
      new Date("2026-04-14T04:30:00Z"),
    );
    expect(migrated.nextAt).toBe(Date.parse("2026-04-14T02:00:00Z"));
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

  it("uses fenced delivery leases for cross-process cron claims", () => {
    const schedule = addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    const deliveryId = `${schedule.id}:2026-4-14-0-0`;
    const first = claimScheduleFire("/project", schedule.id, deliveryId, {
      ownerId: "owner-a",
      now: new Date("2026-04-14T00:00:00Z"),
      leaseMs: 1000,
    });
    expect(first.fence).toBe(1);
    expect(
      claimScheduleFire("/project", schedule.id, deliveryId, {
        ownerId: "owner-b",
        now: new Date("2026-04-14T00:00:00.500Z"),
        leaseMs: 1000,
      }),
    ).toBeNull();

    const successor = claimScheduleFire("/project", schedule.id, deliveryId, {
      ownerId: "owner-b",
      now: new Date("2026-04-14T00:00:02Z"),
      leaseMs: 1000,
    });
    expect(successor.fence).toBe(2);
    expect(
      renewScheduleFire("/project", schedule.id, first, {
        now: new Date("2026-04-14T00:00:02Z"),
        leaseMs: 1000,
      }),
    ).toBe(false);
    expect(
      settleScheduleFire("/project", schedule.id, first, {
        lastStatus: "completed",
      }),
    ).toBe(false);
    expect(
      settleScheduleFire("/project", schedule.id, successor, {
        lastRunAt: "2026-04-14T00:00:03Z",
        lastStatus: "completed",
      }),
    ).toBe(true);
    expect(
      claimScheduleFire("/project", schedule.id, deliveryId, {
        ownerId: "owner-c",
        now: new Date("2026-04-14T00:00:04Z"),
      }),
    ).toBeNull();
    expect(loadSchedules("/project")[0]).toMatchObject({
      lastDeliveryId: deliveryId,
      lastStatus: "completed",
      activeDelivery: null,
      deliveryFence: 2,
    });
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

  it("deduplicates the same fire across scheduler instances", async () => {
    addSchedule("/project", {
      cron: "* * * * *",
      userMessage: "x",
    });
    let finish;
    _deps.runTask = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = new CoworkCronScheduler({
      cwd: "/project",
      ownerId: "scheduler-a",
    });
    const second = new CoworkCronScheduler({
      cwd: "/project",
      ownerId: "scheduler-b",
    });

    await first._tick();
    await second._tick();
    expect(_deps.runTask).toHaveBeenCalledOnce();

    finish({ taskId: "task-1", status: "completed" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(loadSchedules("/project")[0].lastStatus).toBe("completed");
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
