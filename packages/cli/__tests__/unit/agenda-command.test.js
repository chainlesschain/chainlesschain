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
    expect(spawnAgent).toHaveBeenCalledWith("check");
    expect(store.list("wakeup").find((e) => e.id === w.id).status).toBe(
      "fired",
    );
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
      expect(spawnAgent).toHaveBeenCalledWith("go");
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
