/**
 * auto-archive-scheduler.test.js — B4-auto-archive v1
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
const {
  AutoArchiveScheduler,
  MIN_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
} = require("../auto-archive-scheduler.js");

function makeAppConfig(initial = {}) {
  const config = { mtc: { autoArchive: initial } };
  return {
    config,
    saveAsync: vi.fn().mockResolvedValue(true),
  };
}

function makeArchiver() {
  return {
    push: vi
      .fn()
      .mockResolvedValue({ ok: true, name: "channel-mtc-x.zip", bytes: 1024 }),
  };
}

function makeFactory() {
  return vi.fn().mockReturnValue({
    putFile: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]),
  });
}

function makeTimers() {
  const intervals = [];
  return {
    intervals,
    setInterval: vi.fn((fn, ms) => {
      const handle = { fn, ms };
      intervals.push(handle);
      return handle;
    }),
    clearInterval: vi.fn((handle) => {
      const idx = intervals.indexOf(handle);
      if (idx >= 0) {
        intervals.splice(idx, 1);
      }
    }),
  };
}

describe("AutoArchiveScheduler", () => {
  let archiver, factory, appConfig, timers, sched, logger;
  beforeEach(() => {
    archiver = makeArchiver();
    factory = makeFactory();
    appConfig = makeAppConfig();
    timers = makeTimers();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  describe("constructor validation", () => {
    it("rejects missing archiver", () => {
      expect(
        () =>
          new AutoArchiveScheduler({
            archiveProviderFactory: factory,
            appConfig,
          }),
      ).toThrow(/archiver required/);
    });
    it("rejects missing factory", () => {
      expect(
        () =>
          new AutoArchiveScheduler({
            archiver,
            appConfig,
          }),
      ).toThrow(/archiveProviderFactory required/);
    });
    it("rejects missing appConfig", () => {
      expect(
        () =>
          new AutoArchiveScheduler({
            archiver,
            archiveProviderFactory: factory,
          }),
      ).toThrow(/appConfig required/);
    });
  });

  describe("getConfig", () => {
    it("merges defaults on fresh install (no mtc namespace)", () => {
      const fresh = { config: {}, saveAsync: vi.fn() };
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        appConfig: fresh,
        logger,
        timers,
      });
      const c = sched.getConfig();
      expect(c.enabled).toBe(false);
      expect(c.intervalMs).toBe(DEFAULT_INTERVAL_MS);
      expect(c.communityIds).toEqual([]);
      expect(c.providerSpec).toBeNull();
      expect(c.lastRunAt).toBeNull();
    });

    it("clamps stored sub-min intervalMs to default", () => {
      appConfig = makeAppConfig({ intervalMs: 1000 }); // way under MIN
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        appConfig,
        logger,
        timers,
      });
      expect(sched.getConfig().intervalMs).toBe(DEFAULT_INTERVAL_MS);
    });
  });

  describe("setConfig validation", () => {
    beforeEach(() => {
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        appConfig,
        logger,
        timers,
      });
    });

    it("rejects enabled=true with no providerSpec", async () => {
      await expect(sched.setConfig({ enabled: true })).rejects.toThrow(
        /providerSpec required/,
      );
    });

    it("rejects intervalMs below MIN", async () => {
      await expect(
        sched.setConfig({
          enabled: true,
          providerSpec: { kind: "filesystem", rootDir: "/x" },
          intervalMs: 1000,
        }),
      ).rejects.toThrow(/intervalMs must be ≥/);
    });

    it("rejects non-array communityIds", async () => {
      await expect(
        sched.setConfig({ communityIds: "not-an-array" }),
      ).rejects.toThrow(/array/);
    });

    it("happy: persists + restarts when enabled", async () => {
      const next = await sched.setConfig({
        enabled: true,
        providerSpec: { kind: "filesystem", rootDir: "/x" },
        intervalMs: MIN_INTERVAL_MS,
      });
      expect(next.enabled).toBe(true);
      expect(appConfig.saveAsync).toHaveBeenCalled();
      expect(appConfig.config.mtc.autoArchive.enabled).toBe(true);
      // setConfig kicks start when enabled
      expect(timers.setInterval).toHaveBeenCalledTimes(1);
    });

    it("disabled patch stops a running scheduler", async () => {
      await sched.setConfig({
        enabled: true,
        providerSpec: { kind: "filesystem", rootDir: "/x" },
        intervalMs: MIN_INTERVAL_MS,
      });
      expect(timers.intervals.length).toBe(1);
      await sched.setConfig({ enabled: false });
      expect(timers.intervals.length).toBe(0);
    });
  });

  describe("start/stop", () => {
    it("does not start when disabled", () => {
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        appConfig,
        logger,
        timers,
      });
      sched.start();
      expect(timers.setInterval).not.toHaveBeenCalled();
    });

    it("idempotent — start twice yields one timer", async () => {
      appConfig = makeAppConfig({
        enabled: true,
        intervalMs: MIN_INTERVAL_MS,
        providerSpec: { kind: "filesystem", rootDir: "/x" },
      });
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        appConfig,
        logger,
        timers,
      });
      sched.start();
      sched.start();
      expect(timers.setInterval).toHaveBeenCalledTimes(1);
    });
  });

  describe("runOnce", () => {
    let communityManager;
    beforeEach(() => {
      communityManager = {
        getCommunities: vi
          .fn()
          .mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]),
      };
      appConfig = makeAppConfig({
        enabled: true,
        intervalMs: MIN_INTERVAL_MS,
        providerSpec: { kind: "filesystem", rootDir: "/x" },
        communityIds: [],
      });
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        communityManager,
        appConfig,
        logger,
        timers,
      });
    });

    it("happy: archives all joined communities when communityIds empty", async () => {
      const r = await sched.runOnce();
      expect(r.status).toBe("ok");
      expect(archiver.push).toHaveBeenCalledTimes(3);
      expect(r.summary.totalArchives).toBe(3);
      expect(r.summary.totalBytes).toBe(3072);
      expect(Object.keys(r.summary.perCommunity)).toEqual(["c1", "c2", "c3"]);
    });

    it("uses configured communityIds whitelist", async () => {
      appConfig.config.mtc.autoArchive.communityIds = ["c2"];
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        communityManager,
        appConfig,
        logger,
        timers,
      });
      const r = await sched.runOnce();
      expect(archiver.push).toHaveBeenCalledTimes(1);
      expect(archiver.push).toHaveBeenCalledWith(expect.anything(), "c2", {});
      expect(r.status).toBe("ok");
    });

    it("partial: per-community failure → status='partial', other communities still attempted", async () => {
      archiver.push
        .mockResolvedValueOnce({ ok: true, name: "x.zip", bytes: 100 })
        .mockRejectedValueOnce(new Error("provider unauthorized"))
        .mockResolvedValueOnce({ ok: true, name: "z.zip", bytes: 200 });
      const r = await sched.runOnce();
      expect(r.status).toBe("partial");
      expect(r.summary.perCommunity.c1.ok).toBe(true);
      expect(r.summary.perCommunity.c2.ok).toBe(false);
      expect(r.summary.perCommunity.c2.error).toMatch(/unauthorized/);
      expect(r.summary.perCommunity.c3.ok).toBe(true);
      // 2 successes, 1 fail
      expect(r.summary.totalArchives).toBe(2);
      expect(r.summary.totalBytes).toBe(300);
    });

    it("fatal: providerSpec missing → status='failed'", async () => {
      appConfig.config.mtc.autoArchive.providerSpec = null;
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        communityManager,
        appConfig,
        logger,
        timers,
      });
      const r = await sched.runOnce();
      expect(r.status).toBe("failed");
      expect(r.error).toMatch(/providerSpec missing/);
      expect(archiver.push).not.toHaveBeenCalled();
    });

    it("guards against re-entrancy", async () => {
      // make push slow
      let resolve;
      archiver.push.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const p1 = sched.runOnce();
      const p2 = sched.runOnce();
      const r2 = await p2;
      expect(r2.skipped).toBe(true);
      // unblock the in-flight call
      resolve({ ok: true, name: "x.zip", bytes: 50 });
      await p1;
    });

    it("persists lastRun* fields via setConfig", async () => {
      await sched.runOnce();
      expect(appConfig.config.mtc.autoArchive.lastRunAt).toBeTypeOf("number");
      expect(appConfig.config.mtc.autoArchive.lastRunStatus).toBe("ok");
      expect(appConfig.config.mtc.autoArchive.lastRunSummary).toBeTruthy();
    });

    it("communityIds empty + no communityManager → no targets", async () => {
      sched = new AutoArchiveScheduler({
        archiver,
        archiveProviderFactory: factory,
        communityManager: null,
        appConfig,
        logger,
        timers,
      });
      const r = await sched.runOnce();
      expect(archiver.push).not.toHaveBeenCalled();
      expect(r.summary.note).toBe("no-target-communities");
    });
  });
});
