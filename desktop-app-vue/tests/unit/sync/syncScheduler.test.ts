/**
 * syncScheduler 单测 — Phase 3b provider-aware 版本。
 *
 * 不 mock provider 实现，但 mock 各自的 electronAPI 命名空间（backend / git
 * / p2p），placeholder providers (mobile/webdav/oss) 自然 available()=false 跳过。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import * as scheduler from "@renderer/utils/syncScheduler";

const STORAGE_PREFIX = "cc.sync.providers.";

function setEnabled(id: string, enabled: boolean) {
  window.localStorage.setItem(STORAGE_PREFIX + id, enabled ? "true" : "false");
}

describe("syncScheduler (provider-aware)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    scheduler._resetForTest();
    (window as any).electronAPI = {};
  });

  describe("runOnce()", () => {
    it("returns skipped:true when no providers enabled", async () => {
      const result = await scheduler.runOnce();
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
      expect(result.ran).toBe(0);
    });

    it("backend provider success path", async () => {
      (window as any).electronAPI = {
        sync: {
          incremental: vi.fn(async () => ({ success: true })),
        },
      };
      setEnabled("backend", true);

      const result = await scheduler.runOnce();
      expect(result.success).toBe(true);
      expect(result.ran).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.perProvider[0].providerId).toBe("backend");
    });

    it("backend provider auto-falls-back to start() on '未初始化'", async () => {
      const incremental = vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: "同步管理器未初始化" })
        .mockResolvedValueOnce({ success: true });
      const start = vi.fn(async () => ({ success: true }));
      (window as any).electronAPI = {
        sync: { incremental, start },
      };
      setEnabled("backend", true);

      const result = await scheduler.runOnce();
      expect(result.success).toBe(true);
      expect(start).toHaveBeenCalledTimes(1);
      expect(incremental).toHaveBeenCalledTimes(2);
    });

    it("git provider failure surfaces in aggregate", async () => {
      (window as any).electronAPI = {
        git: {
          sync: vi.fn(async () => {
            throw new Error("Git同步未启用");
          }),
        },
      };
      setEnabled("git", true);

      const result = await scheduler.runOnce();
      expect(result.success).toBe(false);
      expect(result.ran).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.error).toMatch(/Git 同步未启用/);
    });

    it("aggregates multiple enabled providers serially", async () => {
      const incremental = vi.fn(async () => ({ success: true }));
      const gitSync = vi.fn(async () => true);
      (window as any).electronAPI = {
        sync: { incremental },
        git: { sync: gitSync },
      };
      setEnabled("backend", true);
      setEnabled("git", true);

      const result = await scheduler.runOnce();
      expect(result.ran).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.perProvider.map((x) => x.providerId)).toEqual([
        "backend",
        "git",
      ]);
    });

    it("skips unavailable providers (no IPC mounted) silently", async () => {
      // backend enabled but electronAPI.sync.incremental missing
      setEnabled("backend", true);
      const result = await scheduler.runOnce();
      expect(result.skipped).toBe(true);
      expect(result.ran).toBe(0);
    });

    it("force=true bypasses enabled flag", async () => {
      (window as any).electronAPI = {
        sync: { incremental: vi.fn(async () => ({ success: true })) },
      };
      // not setEnabled
      const result = await scheduler.runOnce(true);
      expect(result.ran).toBeGreaterThan(0);
    });
  });

  describe("runProviderOnce()", () => {
    it("targets a single provider regardless of enabled flag", async () => {
      (window as any).electronAPI = {
        sync: { incremental: vi.fn(async () => ({ success: true })) },
      };
      const res = await scheduler.runProviderOnce("backend");
      expect(res.success).toBe(true);
    });

    it("returns error for unknown id", async () => {
      const res = await scheduler.runProviderOnce("does-not-exist");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/未知 provider/);
    });

    it("rejects unavailable provider with clear error", async () => {
      // backend with no electronAPI.sync mounted
      const res = await scheduler.runProviderOnce("backend");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/不可用/);
    });
  });

  describe("auto-sync timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("start() persists enabled=true and interval", () => {
      scheduler.start(7);
      expect(window.localStorage.getItem("cc.sync.autoSync")).toBe("true");
      expect(window.localStorage.getItem("cc.sync.intervalMin")).toBe("7");
      expect(scheduler.getState().running).toBe(true);
    });

    it("stop() persists enabled=false", () => {
      scheduler.start(3);
      scheduler.stop();
      expect(window.localStorage.getItem("cc.sync.autoSync")).toBe("false");
      expect(scheduler.getState().running).toBe(false);
    });

    it("bootstrapFromPersisted() respects persisted enabled flag", () => {
      window.localStorage.setItem("cc.sync.autoSync", "true");
      window.localStorage.setItem("cc.sync.intervalMin", "10");
      scheduler.bootstrapFromPersisted();
      expect(scheduler.getState().running).toBe(true);
      expect(scheduler.getIntervalMin()).toBe(10);
    });

    it("clamps interval to [1, 1440]", () => {
      scheduler.setIntervalMin(0);
      expect(scheduler.getIntervalMin()).toBe(1);
      scheduler.setIntervalMin(99999);
      expect(scheduler.getIntervalMin()).toBe(1440);
    });
  });

  describe("provider enable/disable persistence", () => {
    it("setProviderEnabled / isProviderEnabled round-trip", () => {
      scheduler.setProviderEnabled("backend", true);
      expect(scheduler.isProviderEnabled("backend")).toBe(true);
      scheduler.setProviderEnabled("backend", false);
      expect(scheduler.isProviderEnabled("backend")).toBe(false);
    });

    it("getEnabledProviderIds reflects current state", () => {
      scheduler.setProviderEnabled("backend", true);
      scheduler.setProviderEnabled("git", true);
      expect(scheduler.getEnabledProviderIds()).toEqual(["backend", "git"]);
    });
  });
});
