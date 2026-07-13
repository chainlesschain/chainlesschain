import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import {
  runAgendaList,
  runAgendaCancel,
  runAgendaRun,
  runAgendaPrune,
  buildAgentArgs,
} from "../../src/commands/agenda.js";

describe("cc agenda", () => {
  let dir;
  let clock;
  let store;
  let logs;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-agenda-"));
    clock = 1_000_000;
    store = new AgentScheduleStore({ dir, now: () => clock });
    logs = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const log = (m) => logs.push(m);

  it("lists entries as JSON", () => {
    store.scheduleWakeup({ prompt: "a", delayMs: 1000 });
    const code = runAgendaList({ json: true }, { store, log });
    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.entries).toHaveLength(1);
  });

  it("reports the adaptive next-wakeup (earliest future fire time)", () => {
    store.scheduleWakeup({ prompt: "later", dueAt: clock + 5000 });
    store.scheduleWakeup({ prompt: "sooner", dueAt: clock + 2000 });
    const code = runAgendaList(
      { json: true },
      { store, log, now: () => clock },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.nextWakeupAt).toBe(clock + 2000); // the sooner of the two
  });

  it("next-wakeup is null when nothing is schedulable", () => {
    const w = store.scheduleWakeup({ prompt: "x", delayMs: 0 });
    store.markWakeupFired(w.id, clock); // now terminal
    runAgendaList({ json: true }, { store, log, now: () => clock });
    expect(JSON.parse(logs.join("\n")).nextWakeupAt).toBe(null);
  });

  it("cancels by id", () => {
    const w = store.scheduleWakeup({ prompt: "a" });
    const code = runAgendaCancel(w.id, { json: true }, { store, log });
    expect(code).toBe(0);
    expect(JSON.parse(logs.join("\n")).cancelled).toBe(w.id);
    expect(runAgendaCancel("missing", { json: true }, { store, log })).toBe(2);
  });

  it("dry-run reports due entries without firing", async () => {
    store.scheduleWakeup({ prompt: "wake", delayMs: 0 });
    const spawnAgent = vi.fn();
    const code = await runAgendaRun(
      { dryRun: true, json: true },
      { store, log, spawnAgent, now: () => clock },
    );
    expect(code).toBe(0);
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(JSON.parse(logs.join("\n")).actions[0].action).toBe("would-fire");
  });

  it("fires a due wakeup via cc agent and marks it fired", async () => {
    const w = store.scheduleWakeup({ prompt: "check", delayMs: 0 });
    const spawnAgent = vi.fn(async () => 0);
    const code = await runAgendaRun(
      { json: true },
      { store, log, spawnAgent, now: () => clock + 1 },
    );
    expect(code).toBe(0);
    // An unpolicied wakeup passes prompt + undefined policy (byte-identical argv).
    expect(spawnAgent).toHaveBeenCalledWith("check", undefined);
    expect(store.list("wakeup").find((e) => e.id === w.id).status).toBe(
      "fired",
    );
  });

  describe("per-task run policy", () => {
    it("buildAgentArgs appends policy flags, or nothing when unset", () => {
      expect(buildAgentArgs("hi")).toEqual(["agent", "-p", "hi"]);
      expect(buildAgentArgs("hi", null)).toEqual(["agent", "-p", "hi"]);
      expect(
        buildAgentArgs("hi", {
          permissionMode: "plan",
          worktree: true,
          maxTurns: 5,
        }),
      ).toEqual([
        "agent",
        "-p",
        "hi",
        "--permission-mode",
        "plan",
        "--worktree",
        "--max-turns",
        "5",
      ]);
    });

    it("buildAgentArgs emits goal-condition + its budget flags", () => {
      expect(
        buildAgentArgs("build", {
          goalCondition: "exit-zero: npm test",
          maxOuterTurns: 8,
          goalMaxTokens: 50000,
          goalMaxCost: 1.5,
          goalMaxTime: 600000,
        }),
      ).toEqual([
        "agent",
        "-p",
        "build",
        "--goal-condition",
        "exit-zero: npm test",
        "--max-outer-turns",
        "8",
        "--goal-max-tokens",
        "50000",
        "--goal-max-cost",
        "1.5",
        "--goal-max-time",
        "600000",
      ]);
      // no goal-condition → no goal flags even if budgets linger
      expect(buildAgentArgs("x", { goalMaxTokens: 999 })).toEqual([
        "agent",
        "-p",
        "x",
      ]);
    });

    it("passes a fired entry's runPolicy through to spawnAgent", async () => {
      store.scheduleWakeup({
        prompt: "isolated",
        delayMs: 0,
        permissionMode: "plan",
        worktree: true,
        maxTurns: 3,
      });
      const spawnAgent = vi.fn(async () => 0);
      await runAgendaRun(
        { json: true },
        { store, log, spawnAgent, now: () => clock + 1 },
      );
      expect(spawnAgent).toHaveBeenCalledWith("isolated", {
        permissionMode: "plan",
        worktree: true,
        maxTurns: 3,
      });
    });
  });

  it("runs a monitor, matches output, and notifies", async () => {
    const m = store.createMonitor({
      command: "echo BUILD OK",
      intervalMs: 1000,
      stopWhen: "OK",
      notify: { title: "build done" },
    });
    const runCommand = vi.fn(async () => "BUILD OK\n");
    const notify = vi.fn(async () => ({ delivered: ["telegram"] }));
    await runAgendaRun(
      { json: true },
      { store, log, runCommand, notify, now: () => clock + 2000 },
    );
    expect(runCommand).toHaveBeenCalledWith("echo BUILD OK");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "build done", level: "success" }),
    );
    expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
      "matched",
    );
  });

  describe("monitor event envelope (event_id / authority / dedup)", () => {
    it("stamps a matched firing with a deterministic event_id + steer authority", async () => {
      const m = store.createMonitor({
        command: "echo BUILD OK",
        intervalMs: 1000,
        stopWhen: "OK",
      });
      const runCommand = vi.fn(async () => "BUILD OK\n");
      const notify = vi.fn(async () => ({ delivered: ["telegram"] }));
      await runAgendaRun(
        { json: true },
        { store, log, runCommand, notify, now: () => clock + 2000 },
      );
      const { actions } = JSON.parse(logs.join("\n"));
      const fired = actions.find((a) => a.id === m.id);
      expect(fired.action).toBe("matched");
      // event_id is deterministic (RNG-free) and prefixed by the pure core.
      expect(fired.event_id).toMatch(/^ev_[0-9a-f]{24}$/);
      // A monitor firing tops out at "steer" — it can never approve a gate.
      expect(fired.authority).toBe("steer");
      // The audit identity is persisted on the entry for a resident daemon.
      const entry = store.list("monitor").find((e) => e.id === m.id);
      expect(entry.lastEventId).toBe(fired.event_id);
      expect(entry.lastAuthority).toBe("steer");
      // The store stamps the audit time from its own clock.
      expect(entry.lastEventAt).toBe(clock);
    });

    it("suppresses a duplicate firing when lastEventId already matches", async () => {
      // A resident-daemon future re-observation: an entry that is still
      // schedulable but already carries the exact event_id for this observation.
      // recordMonitorCheck sets a terminal status on match, so this pre-seeded
      // state is constructed via an injected store to exercise the dedup guard.
      const { monitorEventId } = await import("../../src/lib/monitor-event.js");
      const predicted = monitorEventId("mon-dup", {
        what: "echo BUILD OK",
        output: "BUILD OK\n",
      });
      const entry = {
        id: "mon-dup",
        kind: "monitor",
        source: "command",
        command: "echo BUILD OK",
        stopWhen: "OK",
        status: "active",
        notify: null,
        lastEventId: predicted,
      };
      const record = vi.fn((_id, opts) => {
        if (opts.matched) entry.status = "matched";
        return entry;
      });
      const fakeStore = {
        list: () => [entry],
        due: () => [entry],
        retireExpired: () => [],
        recordMonitorCheck: record,
      };
      const runCommand = vi.fn(async () => "BUILD OK\n");
      const notify = vi.fn(async () => ({}));
      await runAgendaRun(
        { json: true },
        {
          store: fakeStore,
          log,
          runCommand,
          notify,
          now: () => clock + 2000,
        },
      );
      const { actions } = JSON.parse(logs.join("\n"));
      const fired = actions.find((a) => a.id === "mon-dup");
      expect(fired.action).toBe("duplicate");
      expect(fired.event_id).toBe(predicted);
      // The firing is still recorded (audit) but NOT re-notified.
      expect(record).toHaveBeenCalledWith(
        "mon-dup",
        expect.objectContaining({ matched: true, eventId: predicted }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it("keeps action=matched and records the match when the notification fails", async () => {
      const m = store.createMonitor({
        command: "echo BUILD OK",
        intervalMs: 1000,
        stopWhen: "OK",
      });
      const runCommand = vi.fn(async () => "BUILD OK\n");
      const notify = vi.fn(async () => {
        throw new Error("telegram down");
      });
      const code = await runAgendaRun(
        { json: true },
        { store, log, runCommand, notify, now: () => clock + 2000 },
      );
      const { actions } = JSON.parse(logs.join("\n"));
      const fired = actions.find((a) => a.id === m.id);
      expect(fired.action).toBe("matched");
      expect(fired.notifyError).toBe("telegram down");
      // The match is durably recorded even though delivery failed (best-effort).
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
      // A best-effort delivery failure is not a run-level error.
      expect(code).toBe(0);
    });

    it("byte-caps an oversized notification body without splitting a code point", async () => {
      const m = store.createMonitor({
        command: "echo big",
        intervalMs: 1000,
        stopWhen: "DONE",
      });
      const big = "DONE " + "π".repeat(600); // multi-byte, well over 500 bytes
      const runCommand = vi.fn(async () => big);
      let capturedBody = null;
      const notify = vi.fn(async ({ body }) => {
        capturedBody = body;
        return {};
      });
      await runAgendaRun(
        { json: true },
        { store, log, runCommand, notify, now: () => clock + 2000 },
      );
      expect(Buffer.byteLength(capturedBody, "utf8")).toBeLessThanOrEqual(500);
      // No lone/partial UTF-8 unit — round-trips cleanly.
      expect(Buffer.from(capturedBody, "utf8").toString("utf8")).toBe(
        capturedBody,
      );
    });
  });

  it("re-arms a monitor whose output does not match yet", async () => {
    const m = store.createMonitor({
      command: "echo waiting",
      intervalMs: 1000,
      stopWhen: "OK",
    });
    const runCommand = vi.fn(async () => "still waiting\n");
    const notify = vi.fn();
    await runAgendaRun(
      { json: true },
      { store, log, runCommand, notify, now: () => clock + 2000 },
    );
    expect(notify).not.toHaveBeenCalled();
    const after = store.list("monitor").find((e) => e.id === m.id);
    expect(after.status).toBe("active");
    expect(after.checks).toBe(1);
  });

  describe("file-watch monitor", () => {
    it("matches a watched file's content and notifies", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/build.log",
        intervalMs: 1000,
        stopWhen: "BUILD OK",
        notify: { title: "built" },
      });
      const readWatchedFile = vi.fn(async () => ({
        exists: true,
        content: "...\nBUILD OK\n",
      }));
      const notify = vi.fn(async () => ({ delivered: ["telegram"] }));
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(readWatchedFile).toHaveBeenCalledWith("/tmp/build.log");
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "built", level: "success" }),
      );
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
    });

    it("fires when a watched file appears (no stopWhen pattern)", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/marker",
        intervalMs: 1000,
      });
      const readWatchedFile = vi.fn(async () => ({
        exists: true,
        content: "",
      }));
      const notify = vi.fn(async () => ({}));
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(notify).toHaveBeenCalled();
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
    });

    it("re-arms while a watched file is still missing", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/never",
        intervalMs: 1000,
      });
      const readWatchedFile = vi.fn(async () => ({
        exists: false,
        content: "",
      }));
      const notify = vi.fn();
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(notify).not.toHaveBeenCalled();
      const after = store.list("monitor").find((e) => e.id === m.id);
      expect(after.status).toBe("active");
      expect(after.checks).toBe(1);
    });
  });

  describe("watchChange (mtime) monitor", () => {
    it("establishes a baseline on the first check without firing", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/config.json",
        watchChange: true,
        intervalMs: 1000,
      });
      const readWatchedFile = vi.fn(async () => ({
        exists: true,
        content: "v1",
        mtimeMs: 1000,
      }));
      const notify = vi.fn();
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(notify).not.toHaveBeenCalled();
      const after = store.list("monitor").find((e) => e.id === m.id);
      expect(after.status).toBe("active");
      expect(after.lastMtimeMs).toBe(1000); // baseline recorded
    });

    it("fires once the file's mtime advances past the baseline", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/config.json",
        watchChange: true,
        intervalMs: 1000,
        notify: { title: "changed" },
      });
      store.recordMonitorCheck(m.id, { matched: false, mtimeMs: 1000 }); // baseline
      const readWatchedFile = vi.fn(async () => ({
        exists: true,
        content: "v2",
        mtimeMs: 2000, // advanced
      }));
      const notify = vi.fn(async () => ({ delivered: ["telegram"] }));
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "changed", level: "success" }),
      );
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
    });

    it("re-arms while the file's mtime is unchanged", async () => {
      const m = store.createMonitor({
        watchFile: "/tmp/config.json",
        watchChange: true,
        intervalMs: 1000,
      });
      store.recordMonitorCheck(m.id, { matched: false, mtimeMs: 1000 }); // baseline
      const readWatchedFile = vi.fn(async () => ({
        exists: true,
        content: "v1",
        mtimeMs: 1000, // same
      }));
      const notify = vi.fn();
      await runAgendaRun(
        { json: true },
        { store, log, readWatchedFile, notify, now: () => clock + 2000 },
      );
      expect(notify).not.toHaveBeenCalled();
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "active",
      );
    });
  });

  describe("http monitor", () => {
    it("matches a watched URL's response body and notifies", async () => {
      const m = store.createMonitor({
        watchUrl: "https://ci.test/status",
        intervalMs: 1000,
        stopWhen: "deployed",
        notify: { title: "shipped" },
      });
      const fetchUrl = vi.fn(async () => ({
        ok: true,
        status: 200,
        body: '{"state":"deployed"}',
      }));
      const notify = vi.fn(async () => ({ delivered: ["telegram"] }));
      await runAgendaRun(
        { json: true },
        { store, log, fetchUrl, notify, now: () => clock + 2000 },
      );
      expect(fetchUrl).toHaveBeenCalledWith("https://ci.test/status");
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "shipped", level: "success" }),
      );
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
    });

    it("fires on any 2xx response when there is no stopWhen pattern", async () => {
      const m = store.createMonitor({
        watchUrl: "https://svc.test/health",
        intervalMs: 1000,
      });
      const fetchUrl = vi.fn(async () => ({ ok: true, status: 204, body: "" }));
      const notify = vi.fn(async () => ({}));
      await runAgendaRun(
        { json: true },
        { store, log, fetchUrl, notify, now: () => clock + 2000 },
      );
      expect(notify).toHaveBeenCalled();
      expect(store.list("monitor").find((e) => e.id === m.id).status).toBe(
        "matched",
      );
    });

    it("re-arms while the endpoint is still failing", async () => {
      const m = store.createMonitor({
        watchUrl: "https://svc.test/health",
        intervalMs: 1000,
      });
      const fetchUrl = vi.fn(async () => ({
        ok: false,
        status: 503,
        body: "",
      }));
      const notify = vi.fn();
      await runAgendaRun(
        { json: true },
        { store, log, fetchUrl, notify, now: () => clock + 2000 },
      );
      expect(notify).not.toHaveBeenCalled();
      const after = store.list("monitor").find((e) => e.id === m.id);
      expect(after.status).toBe("active");
      expect(after.checks).toBe(1);
    });
  });

  it("reports a spawn failure as an error action (exit 1)", async () => {
    store.scheduleWakeup({ prompt: "boom", delayMs: 0 });
    const spawnAgent = vi.fn(async () => {
      throw new Error("cc agent exited with code 2");
    });
    const code = await runAgendaRun(
      { json: true },
      { store, log, spawnAgent, now: () => clock + 1 },
    );
    expect(code).toBe(1);
    expect(JSON.parse(logs.join("\n")).actions[0].action).toBe("error");
  });

  describe("expiry retirement", () => {
    it("retires an expired entry before firing and never fires it", async () => {
      const dead = store.scheduleWakeup({
        prompt: "stale",
        delayMs: 0,
        expiresAt: clock + 100,
      });
      const spawnAgent = vi.fn(async () => 0);
      const code = await runAgendaRun(
        { json: true },
        { store, log, spawnAgent, now: () => clock + 500 },
      );
      expect(code).toBe(0);
      expect(spawnAgent).not.toHaveBeenCalled(); // expired → never fires
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.retired.map((e) => e.id)).toContain(dead.id);
      expect(store.list("wakeup").find((e) => e.id === dead.id).status).toBe(
        "expired",
      );
    });

    it("fires a live due entry while retiring an expired one", async () => {
      store.scheduleWakeup({
        prompt: "stale",
        delayMs: 0,
        expiresAt: clock + 100,
      });
      const live = store.scheduleWakeup({
        prompt: "go",
        delayMs: 0,
        expiresAt: clock + 100000,
      });
      const spawnAgent = vi.fn(async () => 0);
      await runAgendaRun(
        { json: true },
        { store, log, spawnAgent, now: () => clock + 500 },
      );
      expect(spawnAgent).toHaveBeenCalledTimes(1);
      expect(spawnAgent).toHaveBeenCalledWith("go", undefined);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.retired).toHaveLength(1);
      expect(parsed.actions.filter((a) => a.action === "fired")).toHaveLength(
        1,
      );
      expect(store.list("wakeup").find((e) => e.id === live.id).status).toBe(
        "fired",
      );
    });

    it("dry-run reports would-expire without mutating the store", async () => {
      const dead = store.scheduleWakeup({
        prompt: "stale",
        delayMs: 0,
        expiresAt: clock + 100,
      });
      const code = await runAgendaRun(
        { dryRun: true, json: true },
        { store, log, now: () => clock + 500 },
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.retired.map((e) => e.id)).toContain(dead.id);
      expect(store.list("wakeup").find((e) => e.id === dead.id).status).toBe(
        "pending", // dry-run must not mutate
      );
    });
  });

  describe("prune", () => {
    it("removes finished entries and reports them as JSON", () => {
      const fired = store.scheduleWakeup({ prompt: "done", delayMs: 0 });
      store.markWakeupFired(fired.id, clock);
      store.scheduleWakeup({ prompt: "pending", delayMs: 5000 }); // kept

      const code = runAgendaPrune(
        { json: true },
        { store, log, now: () => clock },
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.pruned).toHaveLength(1);
      expect(parsed.pruned[0]).toMatchObject({ id: fired.id, status: "fired" });
      expect(store.list()).toHaveLength(1);
    });

    it("--older-than keeps recently-finished entries", () => {
      const old = store.scheduleWakeup({ prompt: "old", delayMs: 0 });
      store.markWakeupFired(old.id, clock);
      const recent = store.scheduleWakeup({ prompt: "recent", delayMs: 0 });
      store.markWakeupFired(recent.id, clock + 10_000);

      const code = runAgendaPrune(
        { json: true, olderThan: "5" }, // 5s → cutoff clock+5s
        { store, log, now: () => clock + 10_000 },
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.pruned.map((e) => e.id)).toEqual([old.id]);
      expect(store.list().map((e) => e.id)).toEqual([recent.id]);
    });

    it("rejects an invalid --older-than with exit 2", () => {
      const code = runAgendaPrune(
        { json: true, olderThan: "soon" },
        { store, log, now: () => clock },
      );
      expect(code).toBe(2);
    });

    it("reports nothing to prune when the store is all-schedulable", () => {
      store.scheduleWakeup({ prompt: "pending", delayMs: 5000 });
      const code = runAgendaPrune(
        { json: true },
        { store, log, now: () => clock },
      );
      expect(code).toBe(0);
      expect(JSON.parse(logs.join("\n")).pruned).toHaveLength(0);
    });
  });
});
