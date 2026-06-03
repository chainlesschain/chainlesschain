import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  getCachedResponse,
  setCachedResponse,
  clearCache,
  clearExpired,
  getCacheStats,
} from "../../src/lib/response-cache.js";

describe("response-cache", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  afterEach(() => {
    db.close();
  });

  // ── Cache miss ──

  describe("cache miss", () => {
    it("returns hit: false for empty cache", () => {
      const result = getCachedResponse(db, "ollama", "qwen2:7b", [
        { role: "user", content: "hello" },
      ]);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different messages", () => {
      setCachedResponse(
        db,
        "ollama",
        "qwen2:7b",
        [{ role: "user", content: "hello" }],
        "Hi!",
      );

      const result = getCachedResponse(db, "ollama", "qwen2:7b", [
        { role: "user", content: "goodbye" },
      ]);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different provider", () => {
      const messages = [{ role: "user", content: "hello" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "Hi!");

      const result = getCachedResponse(db, "openai", "qwen2:7b", messages);
      expect(result.hit).toBe(false);
    });

    it("returns hit: false for different model", () => {
      const messages = [{ role: "user", content: "hello" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "Hi!");

      const result = getCachedResponse(db, "ollama", "llama3", messages);
      expect(result.hit).toBe(false);
    });
  });

  // ── Cache operations ──

  describe("cache operations", () => {
    it("stores a cached response to database", () => {
      const messages = [{ role: "user", content: "What is 2+2?" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "4", {
        responseTokens: 1,
      });

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].provider).toBe("ollama");
      expect(rows[0].model).toBe("qwen2:7b");
      expect(rows[0].response_content).toBe("4");
      expect(rows[0].response_tokens).toBe(1);
    });

    it("stores multiple entries with different keys", () => {
      setCachedResponse(
        db,
        "ollama",
        "qwen2:7b",
        [{ role: "user", content: "a" }],
        "A",
      );
      setCachedResponse(
        db,
        "openai",
        "gpt-4o",
        [{ role: "user", content: "b" }],
        "B",
      );

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(2);
    });

    it("replaces entry with same cache key (OR REPLACE)", () => {
      const messages = [{ role: "user", content: "What is 2+2?" }];
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "4");
      setCachedResponse(db, "ollama", "qwen2:7b", messages, "four");

      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].response_content).toBe("four");
    });

    it("clears all cache", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
      );
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "b" }],
        "y",
      );

      clearCache(db);
      const rows = db.data.get("llm_cache") || [];
      expect(rows.length).toBe(0);
    });

    it("sets expires_at field in the future", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].expires_at).toBeDefined();
      expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("sets cache_key as sha256 hash", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].cache_key).toBeDefined();
      expect(rows[0].cache_key.length).toBe(64); // SHA-256 hex length
    });

    it("sets request_hash as md5 hash", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].request_hash).toBeDefined();
      expect(rows[0].request_hash.length).toBe(32); // MD5 hex length
    });

    it("defaults responseTokens to 0", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "q" }],
        "a",
      );
      const rows = db.data.get("llm_cache") || [];
      expect(rows[0].response_tokens).toBe(0);
    });
  });

  // ── clearExpired ──

  describe("clearExpired", () => {
    it("returns 0 when no entries", () => {
      const removed = clearExpired(db);
      expect(removed).toBe(0);
    });

    it("returns 0 when no expired entries", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
      );
      const removed = clearExpired(db);
      // Entries just created shouldn't be expired yet
      expect(removed).toBe(0);
    });
  });

  // ── getCacheStats ──

  describe("getCacheStats", () => {
    it("returns zeroes for empty cache", () => {
      const stats = getCacheStats(db);
      expect(stats.total_entries).toBe(0);
      expect(stats.total_hits).toBe(0);
      expect(stats.total_tokens_saved).toBe(0);
      expect(stats.expired_entries).toBe(0);
    });

    it("counts entries correctly", () => {
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "a" }],
        "x",
        { responseTokens: 10 },
      );
      setCachedResponse(
        db,
        "ollama",
        "m",
        [{ role: "user", content: "b" }],
        "y",
        { responseTokens: 20 },
      );

      const stats = getCacheStats(db);
      expect(stats.total_entries).toBe(2);
    });

    it("handles null safety on aggregate results", () => {
      // Even with empty table, should not crash
      const stats = getCacheStats(db);
      expect(stats).toBeDefined();
      expect(typeof stats.total_entries).toBe("number");
      expect(typeof stats.total_hits).toBe("number");
      expect(typeof stats.total_tokens_saved).toBe("number");
    });
  });

  // ── Table creation ──

  describe("table creation", () => {
    it("creates table on first getCachedResponse", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      getCachedResponse(db, "ollama", "m", []);
      expect(db.tables.has("llm_cache")).toBe(true);
    });

    it("creates table on first setCachedResponse", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      setCachedResponse(db, "ollama", "m", [], "x");
      expect(db.tables.has("llm_cache")).toBe(true);
    });

    it("creates table on first clearCache", () => {
      expect(db.tables.has("llm_cache")).toBe(false);
      clearCache(db);
      expect(db.tables.has("llm_cache")).toBe(true);
    });
  });
});

// ── V2 Surface ──

import {
  PROFILE_MATURITY_V2,
  REFRESH_JOB_LIFECYCLE_V2,
  CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER,
  CACHE_DEFAULT_MAX_PENDING_REFRESH_JOBS_PER_PROFILE,
  CACHE_DEFAULT_PROFILE_IDLE_MS,
  CACHE_DEFAULT_REFRESH_STUCK_MS,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxPendingRefreshJobsPerProfileV2,
  setMaxPendingRefreshJobsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getRefreshStuckMsV2,
  setRefreshStuckMsV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileStatusV2,
  activateProfileV2,
  suspendProfileV2,
  archiveProfileV2,
  touchProfileV2,
  getActiveProfileCountV2,
  createRefreshJobV2,
  getRefreshJobV2,
  listRefreshJobsV2,
  setRefreshJobStatusV2,
  startRefreshJobV2,
  completeRefreshJobV2,
  failRefreshJobV2,
  cancelRefreshJobV2,
  getPendingRefreshJobCountV2,
  autoSuspendIdleProfilesV2,
  autoFailStuckRefreshJobsV2,
  getResponseCacheStatsV2,
  _resetStateResponseCacheV2,
} from "../../src/lib/response-cache.js";

describe("response-cache V2", () => {
  beforeEach(() => {
    _resetStateResponseCacheV2();
  });

  describe("enums", () => {
    it("PROFILE_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(PROFILE_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "suspended",
        "archived",
      ]);
      expect(Object.isFrozen(PROFILE_MATURITY_V2)).toBe(true);
    });

    it("REFRESH_JOB_LIFECYCLE_V2 frozen 5 states", () => {
      expect(Object.values(REFRESH_JOB_LIFECYCLE_V2)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ]);
      expect(Object.isFrozen(REFRESH_JOB_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("defaults match constants", () => {
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(
        CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER,
      );
      expect(getMaxPendingRefreshJobsPerProfileV2()).toBe(
        CACHE_DEFAULT_MAX_PENDING_REFRESH_JOBS_PER_PROFILE,
      );
      expect(getProfileIdleMsV2()).toBe(CACHE_DEFAULT_PROFILE_IDLE_MS);
      expect(getRefreshStuckMsV2()).toBe(CACHE_DEFAULT_REFRESH_STUCK_MS);
    });

    it("setters update", () => {
      setMaxActiveProfilesPerOwnerV2(50);
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(50);
      setMaxPendingRefreshJobsPerProfileV2(7);
      expect(getMaxPendingRefreshJobsPerProfileV2()).toBe(7);
      setProfileIdleMsV2(1234);
      expect(getProfileIdleMsV2()).toBe(1234);
      setRefreshStuckMsV2(5678);
      expect(getRefreshStuckMsV2()).toBe(5678);
    });

    it("setters floor non-integers", () => {
      setMaxActiveProfilesPerOwnerV2(7.9);
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(7);
    });

    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveProfilesPerOwnerV2(0)).toThrow();
      expect(() => setMaxPendingRefreshJobsPerProfileV2(-1)).toThrow();
      expect(() => setProfileIdleMsV2(NaN)).toThrow();
      expect(() => setRefreshStuckMsV2("nope")).toThrow();
    });

    it("_resetState restores defaults", () => {
      setMaxActiveProfilesPerOwnerV2(99);
      _resetStateResponseCacheV2();
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(
        CACHE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER,
      );
    });
  });

  describe("registerProfileV2", () => {
    it("creates pending profile", () => {
      const p = registerProfileV2("p1", {
        ownerId: "u1",
        label: "OpenAI cache",
        now: 1000,
      });
      expect(p.status).toBe("pending");
      expect(p.activatedAt).toBeNull();
      expect(p.archivedAt).toBeNull();
    });

    it("rejects invalid id/owner/label", () => {
      expect(() =>
        registerProfileV2("", { ownerId: "u", label: "L" }),
      ).toThrow();
      expect(() =>
        registerProfileV2("p", { ownerId: "", label: "L" }),
      ).toThrow();
      expect(() =>
        registerProfileV2("p", { ownerId: "u", label: "" }),
      ).toThrow();
    });

    it("rejects duplicate", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
      expect(() =>
        registerProfileV2("p1", { ownerId: "u", label: "L2" }),
      ).toThrow(/already exists/);
    });

    it("returns defensive copy", () => {
      const p = registerProfileV2("p1", {
        ownerId: "u",
        label: "L",
        metadata: { k: "v" },
      });
      p.metadata.k = "tampered";
      expect(getProfileV2("p1").metadata.k).toBe("v");
    });
  });

  describe("profile transitions", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "u1", label: "L", now: 1000 });
    });

    it("pending→active stamps activatedAt", () => {
      const p = activateProfileV2("p1", { now: 2000 });
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBe(2000);
    });

    it("suspended→active recovery preserves activatedAt", () => {
      activateProfileV2("p1", { now: 2000 });
      suspendProfileV2("p1", { now: 3000 });
      const p = activateProfileV2("p1", { now: 4000 });
      expect(p.activatedAt).toBe(2000);
    });

    it("→archived stamps archivedAt and is terminal", () => {
      const p = archiveProfileV2("p1", { now: 5000 });
      expect(p.archivedAt).toBe(5000);
      expect(() => activateProfileV2("p1")).toThrow(/terminal/);
    });

    it("rejects unknown status", () => {
      expect(() => setProfileStatusV2("p1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal pending→suspended", () => {
      expect(() => suspendProfileV2("p1")).toThrow(/cannot transition/);
    });

    it("rejects missing", () => {
      expect(() => activateProfileV2("nope")).toThrow(/not found/);
    });

    it("per-owner cap enforced on pending→active only", () => {
      setMaxActiveProfilesPerOwnerV2(2);
      registerProfileV2("p2", { ownerId: "u1", label: "L" });
      registerProfileV2("p3", { ownerId: "u1", label: "L" });
      activateProfileV2("p1");
      activateProfileV2("p2");
      expect(() => activateProfileV2("p3")).toThrow(/active-profile cap/);
    });

    it("suspended→active recovery exempt from cap", () => {
      setMaxActiveProfilesPerOwnerV2(2);
      registerProfileV2("p2", { ownerId: "u1", label: "L" });
      registerProfileV2("p3", { ownerId: "u1", label: "L" });
      activateProfileV2("p1");
      activateProfileV2("p2");
      suspendProfileV2("p1");
      activateProfileV2("p3");
      const p1 = activateProfileV2("p1");
      expect(p1.status).toBe("active");
    });

    it("per-owner cap is owner-scoped", () => {
      setMaxActiveProfilesPerOwnerV2(1);
      registerProfileV2("p2", { ownerId: "u2", label: "L" });
      activateProfileV2("p1");
      const p = activateProfileV2("p2");
      expect(p.status).toBe("active");
    });
  });

  describe("touchProfileV2", () => {
    it("updates lastSeenAt", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activateProfileV2("p1", { now: 2000 });
      const p = touchProfileV2("p1", { now: 9999 });
      expect(p.lastSeenAt).toBe(9999);
      expect(p.status).toBe("active");
    });

    it("throws on missing", () => {
      expect(() => touchProfileV2("nope")).toThrow(/not found/);
    });
  });

  describe("listProfilesV2 + getActiveProfileCountV2", () => {
    it("filters by ownerId/status", () => {
      registerProfileV2("p1", { ownerId: "u1", label: "L" });
      registerProfileV2("p2", { ownerId: "u1", label: "L" });
      registerProfileV2("p3", { ownerId: "u2", label: "L" });
      activateProfileV2("p1");
      expect(listProfilesV2({ ownerId: "u1" })).toHaveLength(2);
      expect(listProfilesV2({ status: "active" })).toHaveLength(1);
    });

    it("counts only active", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
      registerProfileV2("p2", { ownerId: "u", label: "L" });
      activateProfileV2("p1");
      expect(getActiveProfileCountV2("u")).toBe(1);
    });
  });

  describe("createRefreshJobV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
    });

    it("creates queued job", () => {
      const j = createRefreshJobV2("j1", {
        profileId: "p1",
        kind: "warm",
        now: 1000,
      });
      expect(j.status).toBe("queued");
      expect(j.kind).toBe("warm");
      expect(j.startedAt).toBeNull();
      expect(j.settledAt).toBeNull();
    });

    it("rejects invalid id/profileId", () => {
      expect(() => createRefreshJobV2("", { profileId: "p1" })).toThrow();
      expect(() => createRefreshJobV2("j", { profileId: "" })).toThrow();
    });

    it("rejects duplicate", () => {
      createRefreshJobV2("j1", { profileId: "p1" });
      expect(() => createRefreshJobV2("j1", { profileId: "p1" })).toThrow(
        /already exists/,
      );
    });

    it("per-profile cap counts queued+running", () => {
      setMaxPendingRefreshJobsPerProfileV2(2);
      createRefreshJobV2("j1", { profileId: "p1" });
      createRefreshJobV2("j2", { profileId: "p1" });
      expect(() => createRefreshJobV2("j3", { profileId: "p1" })).toThrow(
        /pending-refresh-job cap/,
      );
      startRefreshJobV2("j1");
      expect(() => createRefreshJobV2("j3", { profileId: "p1" })).toThrow(
        /pending-refresh-job cap/,
      );
    });

    it("per-profile cap excludes terminals", () => {
      setMaxPendingRefreshJobsPerProfileV2(2);
      createRefreshJobV2("j1", { profileId: "p1" });
      createRefreshJobV2("j2", { profileId: "p1" });
      cancelRefreshJobV2("j1");
      const j3 = createRefreshJobV2("j3", { profileId: "p1" });
      expect(j3.status).toBe("queued");
    });
  });

  describe("refresh job transitions", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
      createRefreshJobV2("j1", { profileId: "p1", now: 1000 });
    });

    it("queued→running stamps startedAt", () => {
      const j = startRefreshJobV2("j1", { now: 2000 });
      expect(j.status).toBe("running");
      expect(j.startedAt).toBe(2000);
      expect(j.settledAt).toBeNull();
    });

    it("running→completed stamps settledAt", () => {
      startRefreshJobV2("j1", { now: 2000 });
      const j = completeRefreshJobV2("j1", { now: 3000 });
      expect(j.settledAt).toBe(3000);
      expect(() => failRefreshJobV2("j1")).toThrow(/terminal/);
    });

    it("running→failed stamps settledAt", () => {
      startRefreshJobV2("j1", { now: 2000 });
      const j = failRefreshJobV2("j1", { now: 3000 });
      expect(j.status).toBe("failed");
      expect(j.settledAt).toBe(3000);
    });

    it("queued→cancelled stamps settledAt", () => {
      const j = cancelRefreshJobV2("j1", { now: 2500 });
      expect(j.status).toBe("cancelled");
      expect(j.settledAt).toBe(2500);
    });

    it("queued cannot complete directly", () => {
      expect(() => completeRefreshJobV2("j1")).toThrow(/cannot transition/);
    });

    it("rejects unknown status", () => {
      expect(() => setRefreshJobStatusV2("j1", "bogus")).toThrow(/unknown/);
    });

    it("rejects missing", () => {
      expect(() => startRefreshJobV2("nope")).toThrow(/not found/);
    });
  });

  describe("listRefreshJobsV2 + getPendingRefreshJobCountV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
      registerProfileV2("p2", { ownerId: "u", label: "L" });
      createRefreshJobV2("j1", { profileId: "p1" });
      createRefreshJobV2("j2", { profileId: "p1" });
      createRefreshJobV2("j3", { profileId: "p2" });
      startRefreshJobV2("j1");
    });

    it("filters by profileId/status", () => {
      expect(listRefreshJobsV2({ profileId: "p1" })).toHaveLength(2);
      expect(listRefreshJobsV2({ status: "queued" })).toHaveLength(2);
    });

    it("counts queued+running", () => {
      expect(getPendingRefreshJobCountV2("p1")).toBe(2);
      expect(getPendingRefreshJobCountV2("p2")).toBe(1);
      cancelRefreshJobV2("j2");
      expect(getPendingRefreshJobCountV2("p1")).toBe(1);
    });
  });

  describe("autoSuspendIdleProfilesV2", () => {
    it("flips active→suspended when idle", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activateProfileV2("p1", { now: 1000 });
      setProfileIdleMsV2(500);
      const flipped = autoSuspendIdleProfilesV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("suspended");
    });

    it("skips non-active", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L", now: 1000 });
      setProfileIdleMsV2(500);
      const flipped = autoSuspendIdleProfilesV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("preserves under-threshold", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L", now: 1000 });
      activateProfileV2("p1", { now: 1000 });
      setProfileIdleMsV2(5000);
      const flipped = autoSuspendIdleProfilesV2({ now: 2000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckRefreshJobsV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
    });

    it("flips running→failed when stuck", () => {
      createRefreshJobV2("j1", { profileId: "p1", now: 1000 });
      startRefreshJobV2("j1", { now: 1000 });
      setRefreshStuckMsV2(500);
      const flipped = autoFailStuckRefreshJobsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].settledAt).toBe(2000);
    });

    it("skips non-running (queued)", () => {
      createRefreshJobV2("j1", { profileId: "p1", now: 1000 });
      setRefreshStuckMsV2(500);
      const flipped = autoFailStuckRefreshJobsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("skips terminals", () => {
      createRefreshJobV2("j1", { profileId: "p1", now: 1000 });
      cancelRefreshJobV2("j1", { now: 1000 });
      setRefreshStuckMsV2(500);
      const flipped = autoFailStuckRefreshJobsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getResponseCacheStatsV2", () => {
    it("zero-init when empty", () => {
      const s = getResponseCacheStatsV2();
      expect(s.totalProfilesV2).toBe(0);
      expect(s.totalRefreshJobsV2).toBe(0);
      expect(s.profilesByStatus).toEqual({
        pending: 0,
        active: 0,
        suspended: 0,
        archived: 0,
      });
      expect(s.jobsByStatus).toEqual({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it("counts by status + config snapshot", () => {
      registerProfileV2("p1", { ownerId: "u", label: "L" });
      activateProfileV2("p1");
      createRefreshJobV2("j1", { profileId: "p1" });
      startRefreshJobV2("j1");
      setMaxActiveProfilesPerOwnerV2(77);
      const s = getResponseCacheStatsV2();
      expect(s.totalProfilesV2).toBe(1);
      expect(s.profilesByStatus.active).toBe(1);
      expect(s.totalRefreshJobsV2).toBe(1);
      expect(s.jobsByStatus.running).toBe(1);
      expect(s.maxActiveProfilesPerOwner).toBe(77);
    });
  });
});
