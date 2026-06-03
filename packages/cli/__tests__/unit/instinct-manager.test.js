import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureInstinctsTable,
  recordInstinct,
  getInstincts,
  getStrongInstincts,
  deleteInstinct,
  resetInstincts,
  decayInstincts,
  generateInstinctPrompt,
  INSTINCT_CATEGORIES,
} from "../../src/lib/instinct-manager.js";

describe("Instinct Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureInstinctsTable ─────────────────────────────────────

  describe("ensureInstinctsTable", () => {
    it("should create instincts table", () => {
      ensureInstinctsTable(db);
      expect(db.tables.has("instincts")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureInstinctsTable(db);
      ensureInstinctsTable(db);
      expect(db.tables.has("instincts")).toBe(true);
    });
  });

  // ─── INSTINCT_CATEGORIES ─────────────────────────────────────

  describe("INSTINCT_CATEGORIES", () => {
    it("should have expected categories", () => {
      expect(INSTINCT_CATEGORIES.TOOL_PREFERENCE).toBe("tool_preference");
      expect(INSTINCT_CATEGORIES.CODING_STYLE).toBe("coding_style");
      expect(INSTINCT_CATEGORIES.RESPONSE_FORMAT).toBe("response_format");
      expect(INSTINCT_CATEGORIES.LANGUAGE).toBe("language");
      expect(INSTINCT_CATEGORIES.WORKFLOW).toBe("workflow");
      expect(INSTINCT_CATEGORIES.BEHAVIOR).toBe("behavior");
    });

    it("should have 6 categories", () => {
      expect(Object.keys(INSTINCT_CATEGORIES)).toHaveLength(6);
    });
  });

  // ─── recordInstinct ──────────────────────────────────────────

  describe("recordInstinct", () => {
    it("should create a new instinct", () => {
      const result = recordInstinct(
        db,
        "coding_style",
        "Prefers TypeScript over JavaScript",
      );
      expect(result.isNew).toBe(true);
      expect(result.confidence).toBe(0.5);
      expect(result.occurrences).toBe(1);
      expect(result.category).toBe("coding_style");
      expect(result.pattern).toBe("Prefers TypeScript over JavaScript");
    });

    it("should increment existing instinct", () => {
      recordInstinct(db, "tool_preference", "Uses write_file often");
      const result = recordInstinct(
        db,
        "tool_preference",
        "Uses write_file often",
      );
      expect(result.isNew).toBe(false);
      expect(result.occurrences).toBe(2);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should increase confidence asymptotically", () => {
      let inst;
      for (let i = 0; i < 10; i++) {
        inst = recordInstinct(db, "behavior", "Always asks for confirmation");
      }
      expect(inst.confidence).toBeGreaterThan(0.8);
      expect(inst.confidence).toBeLessThan(1.0);
    });

    it("should track different patterns separately", () => {
      recordInstinct(db, "language", "Responds in English");
      recordInstinct(db, "language", "Responds in Chinese");

      const instincts = getInstincts(db, { category: "language" });
      expect(instincts).toHaveLength(2);
    });
  });

  // ─── getInstincts ────────────────────────────────────────────

  describe("getInstincts", () => {
    it("should return all instincts", () => {
      recordInstinct(db, "coding_style", "Pattern A");
      recordInstinct(db, "behavior", "Pattern B");

      const all = getInstincts(db);
      expect(all).toHaveLength(2);
    });

    it("should filter by category", () => {
      recordInstinct(db, "coding_style", "Pattern A");
      recordInstinct(db, "behavior", "Pattern B");

      const filtered = getInstincts(db, { category: "coding_style" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].category).toBe("coding_style");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        recordInstinct(db, "behavior", `Pattern ${i}`);
      }

      const limited = getInstincts(db, { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("should return empty for no instincts", () => {
      ensureInstinctsTable(db);
      expect(getInstincts(db)).toHaveLength(0);
    });
  });

  // ─── getStrongInstincts ──────────────────────────────────────

  describe("getStrongInstincts", () => {
    it("should return only high-confidence instincts", () => {
      // Create a strong instinct by repeated recording
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "behavior", "Strong pattern");
      }
      recordInstinct(db, "behavior", "Weak pattern"); // Only 1 occurrence, conf=0.5

      const strong = getStrongInstincts(db, 0.7);
      expect(strong).toHaveLength(1);
      expect(strong[0].pattern).toBe("Strong pattern");
    });

    it("should return empty if no strong instincts", () => {
      recordInstinct(db, "behavior", "New pattern");
      expect(getStrongInstincts(db, 0.7)).toHaveLength(0);
    });
  });

  // ─── deleteInstinct ──────────────────────────────────────────

  describe("deleteInstinct", () => {
    it("should delete by ID prefix", () => {
      const inst = recordInstinct(db, "behavior", "To delete");
      const ok = deleteInstinct(db, inst.id.slice(0, 8));
      expect(ok).toBe(true);

      const remaining = getInstincts(db);
      expect(remaining).toHaveLength(0);
    });

    it("should return false for non-existent ID", () => {
      ensureInstinctsTable(db);
      expect(deleteInstinct(db, "nonexistent")).toBe(false);
    });
  });

  // ─── resetInstincts ──────────────────────────────────────────

  describe("resetInstincts", () => {
    it("should clear all instincts", () => {
      recordInstinct(db, "a", "Pattern 1");
      recordInstinct(db, "b", "Pattern 2");
      recordInstinct(db, "c", "Pattern 3");

      const count = resetInstincts(db);
      expect(count).toBe(3);
      expect(getInstincts(db)).toHaveLength(0);
    });

    it("should return 0 when already empty", () => {
      ensureInstinctsTable(db);
      expect(resetInstincts(db)).toBe(0);
    });
  });

  // ─── decayInstincts ──────────────────────────────────────────

  describe("decayInstincts", () => {
    it("should not decay recent instincts", () => {
      recordInstinct(db, "behavior", "Recent");
      const decayed = decayInstincts(db, 30);
      // Since the instinct was just created, it shouldn't be decayed
      expect(decayed).toBe(0);
    });

    it("should decay old instincts", () => {
      const inst = recordInstinct(db, "behavior", "Old pattern");
      // Manually set last_seen to old date
      const rows = db.data.get("instincts");
      const row = rows.find((r) => r.id === inst.id);
      if (row) row.last_seen = "2020-01-01 00:00:00";

      const decayed = decayInstincts(db, 1);
      expect(decayed).toBe(1);
    });
  });

  // ─── generateInstinctPrompt ──────────────────────────────────

  describe("generateInstinctPrompt", () => {
    it("should return empty string when no strong instincts", () => {
      ensureInstinctsTable(db);
      expect(generateInstinctPrompt(db)).toBe("");
    });

    it("should generate prompt from strong instincts", () => {
      // Build up strong instincts
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "coding_style", "Uses async/await");
      }

      const prompt = generateInstinctPrompt(db);
      expect(prompt).toContain("preferences");
      expect(prompt).toContain("coding_style");
      expect(prompt).toContain("async/await");
    });

    it("should include confidence percentage", () => {
      for (let i = 0; i < 15; i++) {
        recordInstinct(db, "workflow", "Prefers TDD");
      }

      const prompt = generateInstinctPrompt(db);
      expect(prompt).toMatch(/confidence: \d+%/);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle recording with same category but different patterns", () => {
      recordInstinct(db, "coding_style", "Uses semicolons");
      recordInstinct(db, "coding_style", "Prefers const over let");

      const all = getInstincts(db, { category: "coding_style" });
      expect(all).toHaveLength(2);
    });

    it("should decay confidence to minimum 0.1", () => {
      const inst = recordInstinct(db, "behavior", "Pattern");
      // Set very old date and low confidence
      const rows = db.data.get("instincts");
      const row = rows.find((r) => r.id === inst.id);
      if (row) {
        row.last_seen = "2010-01-01 00:00:00";
        row.confidence = 0.11;
      }

      decayInstincts(db, 1);
      const updated = getInstincts(db);
      expect(updated[0].confidence).toBeGreaterThanOrEqual(0.1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// V2 Surface — Instinct governance layer
// ═══════════════════════════════════════════════════════════════

import {
  PROFILE_MATURITY_V2,
  OBSERVATION_LIFECYCLE_V2,
  INSTINCT_DEFAULT_MAX_ACTIVE_PROFILES_PER_USER,
  INSTINCT_DEFAULT_MAX_PENDING_OBS_PER_PROFILE,
  INSTINCT_DEFAULT_PROFILE_IDLE_MS,
  INSTINCT_DEFAULT_OBS_STUCK_MS,
  getMaxActiveProfilesPerUserV2,
  setMaxActiveProfilesPerUserV2,
  getMaxPendingObsPerProfileV2,
  setMaxPendingObsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getObsStuckMsV2,
  setObsStuckMsV2,
  getActiveProfileCountV2,
  getPendingObsCountV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileStatusV2,
  activateProfileV2,
  dormantProfileV2,
  archiveProfileV2,
  touchProfileV2,
  createObservationV2,
  getObservationV2,
  listObservationsV2,
  setObservationStatusV2,
  reviewObservationV2,
  reinforceObservationV2,
  promoteObservationV2,
  discardObservationV2,
  autoDormantIdleProfilesV2,
  autoDiscardStaleObservationsV2,
  getInstinctManagerStatsV2,
  _resetStateInstinctManagerV2,
} from "../../src/lib/instinct-manager.js";

describe("Instinct Manager V2", () => {
  beforeEach(() => {
    _resetStateInstinctManagerV2();
  });

  describe("enums", () => {
    it("PROFILE_MATURITY_V2 has 4 frozen states", () => {
      expect(Object.values(PROFILE_MATURITY_V2)).toEqual([
        "pending",
        "active",
        "dormant",
        "archived",
      ]);
      expect(Object.isFrozen(PROFILE_MATURITY_V2)).toBe(true);
    });
    it("OBSERVATION_LIFECYCLE_V2 has 5 frozen states", () => {
      expect(Object.values(OBSERVATION_LIFECYCLE_V2)).toEqual([
        "captured",
        "reviewed",
        "reinforced",
        "discarded",
        "promoted",
      ]);
      expect(Object.isFrozen(OBSERVATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("exposes defaults", () => {
      expect(INSTINCT_DEFAULT_MAX_ACTIVE_PROFILES_PER_USER).toBe(5);
      expect(INSTINCT_DEFAULT_MAX_PENDING_OBS_PER_PROFILE).toBe(100);
      expect(INSTINCT_DEFAULT_PROFILE_IDLE_MS).toBe(1000 * 60 * 60 * 24 * 60);
      expect(INSTINCT_DEFAULT_OBS_STUCK_MS).toBe(1000 * 60 * 60 * 24 * 14);
    });
    it("getters return current values", () => {
      expect(getMaxActiveProfilesPerUserV2()).toBe(5);
      expect(getMaxPendingObsPerProfileV2()).toBe(100);
      expect(getProfileIdleMsV2()).toBeGreaterThan(0);
      expect(getObsStuckMsV2()).toBeGreaterThan(0);
    });
    it("setters update values and floor non-integers", () => {
      setMaxActiveProfilesPerUserV2(7.7);
      expect(getMaxActiveProfilesPerUserV2()).toBe(7);
      setMaxPendingObsPerProfileV2(42.3);
      expect(getMaxPendingObsPerProfileV2()).toBe(42);
      setProfileIdleMsV2(99);
      expect(getProfileIdleMsV2()).toBe(99);
      setObsStuckMsV2(11);
      expect(getObsStuckMsV2()).toBe(11);
    });
    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveProfilesPerUserV2(0)).toThrow();
      expect(() => setMaxActiveProfilesPerUserV2(-1)).toThrow();
      expect(() => setMaxPendingObsPerProfileV2(NaN)).toThrow();
      expect(() => setProfileIdleMsV2(0)).toThrow();
      expect(() => setObsStuckMsV2(-5)).toThrow();
    });
    it("_resetStateInstinctManagerV2 restores defaults", () => {
      setMaxActiveProfilesPerUserV2(99);
      setMaxPendingObsPerProfileV2(99);
      setProfileIdleMsV2(99);
      setObsStuckMsV2(99);
      _resetStateInstinctManagerV2();
      expect(getMaxActiveProfilesPerUserV2()).toBe(5);
      expect(getMaxPendingObsPerProfileV2()).toBe(100);
      expect(getProfileIdleMsV2()).toBe(INSTINCT_DEFAULT_PROFILE_IDLE_MS);
      expect(getObsStuckMsV2()).toBe(INSTINCT_DEFAULT_OBS_STUCK_MS);
    });
  });

  describe("registerProfileV2", () => {
    it("creates a pending profile with defaults", () => {
      const p = registerProfileV2("p1", { userId: "u1", category: "tool" });
      expect(p.id).toBe("p1");
      expect(p.userId).toBe("u1");
      expect(p.category).toBe("tool");
      expect(p.status).toBe("pending");
      expect(p.activatedAt).toBeNull();
      expect(p.archivedAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() =>
        registerProfileV2("", { userId: "u", category: "c" }),
      ).toThrow();
      expect(() =>
        registerProfileV2("p", { userId: "", category: "c" }),
      ).toThrow();
      expect(() =>
        registerProfileV2("p", { userId: "u", category: "" }),
      ).toThrow();
    });
    it("rejects duplicate id", () => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      expect(() =>
        registerProfileV2("p1", { userId: "u1", category: "c" }),
      ).toThrow(/already exists/);
    });
    it("returns defensive copy", () => {
      const p = registerProfileV2("p1", {
        userId: "u1",
        category: "c",
        metadata: { tag: "x" },
      });
      p.metadata.tag = "mutated";
      const fresh = getProfileV2("p1");
      expect(fresh.metadata.tag).toBe("x");
    });
  });

  describe("profile transitions", () => {
    beforeEach(() => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
    });
    it("pending → active stamps activatedAt and respects cap", () => {
      const p = activateProfileV2("p1", { now: 1000 });
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBe(1000);
    });
    it("active → dormant → active recovery preserves activatedAt", () => {
      const a = activateProfileV2("p1", { now: 1000 });
      const d = dormantProfileV2("p1", { now: 2000 });
      const r = activateProfileV2("p1", { now: 3000 });
      expect(d.status).toBe("dormant");
      expect(r.status).toBe("active");
      expect(r.activatedAt).toBe(a.activatedAt);
    });
    it("→ archived stamps archivedAt and is terminal", () => {
      activateProfileV2("p1");
      const ar = archiveProfileV2("p1", { now: 5000 });
      expect(ar.status).toBe("archived");
      expect(ar.archivedAt).toBe(5000);
      expect(() => activateProfileV2("p1")).toThrow(/terminal/);
    });
    it("rejects unknown next status", () => {
      expect(() => setProfileStatusV2("p1", "weird")).toThrow(/unknown/);
    });
    it("rejects illegal transition (pending → dormant)", () => {
      expect(() => dormantProfileV2("p1")).toThrow(/cannot transition/);
    });
    it("throws on missing profile", () => {
      expect(() => activateProfileV2("ghost")).toThrow(/not found/);
    });
    it("enforces per-user active-profile cap on pending → active only", () => {
      setMaxActiveProfilesPerUserV2(2);
      registerProfileV2("p2", { userId: "u1", category: "c" });
      registerProfileV2("p3", { userId: "u1", category: "c" });
      activateProfileV2("p1");
      activateProfileV2("p2");
      expect(() => activateProfileV2("p3")).toThrow(/cap/);
    });
    it("dormant → active recovery is exempt from cap", () => {
      setMaxActiveProfilesPerUserV2(1);
      activateProfileV2("p1");
      dormantProfileV2("p1");
      registerProfileV2("p2", { userId: "u1", category: "c" });
      activateProfileV2("p2");
      expect(() => activateProfileV2("p1")).not.toThrow();
    });
  });

  describe("touchProfileV2", () => {
    it("updates lastSeenAt", () => {
      registerProfileV2("p1", { userId: "u1", category: "c", now: 100 });
      const p = touchProfileV2("p1", { now: 500 });
      expect(p.lastSeenAt).toBe(500);
    });
    it("throws on missing profile", () => {
      expect(() => touchProfileV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listProfilesV2 + getActiveProfileCountV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { userId: "u1", category: "tool" });
      registerProfileV2("p2", { userId: "u1", category: "style" });
      registerProfileV2("p3", { userId: "u2", category: "tool" });
      activateProfileV2("p1");
      activateProfileV2("p2");
    });
    it("filters by userId/category/status", () => {
      expect(listProfilesV2({ userId: "u1" })).toHaveLength(2);
      expect(listProfilesV2({ category: "tool" })).toHaveLength(2);
      expect(listProfilesV2({ status: "active" })).toHaveLength(2);
      expect(listProfilesV2({ status: "pending" })).toHaveLength(1);
    });
    it("counts only active per user", () => {
      expect(getActiveProfileCountV2("u1")).toBe(2);
      expect(getActiveProfileCountV2("u2")).toBe(0);
    });
  });

  describe("createObservationV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
    });
    it("creates a captured observation", () => {
      const o = createObservationV2("o1", {
        profileId: "p1",
        signal: "uses-grep",
      });
      expect(o.status).toBe("captured");
      expect(o.profileId).toBe("p1");
      expect(o.reviewedAt).toBeNull();
      expect(o.settledAt).toBeNull();
    });
    it("rejects missing/invalid params", () => {
      expect(() =>
        createObservationV2("", { profileId: "p1", signal: "s" }),
      ).toThrow();
      expect(() =>
        createObservationV2("o", { profileId: "", signal: "s" }),
      ).toThrow();
      expect(() =>
        createObservationV2("o", { profileId: "p1", signal: "" }),
      ).toThrow();
    });
    it("rejects duplicate id", () => {
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      expect(() =>
        createObservationV2("o1", { profileId: "p1", signal: "s" }),
      ).toThrow(/already exists/);
    });
    it("enforces per-profile pending-obs cap at create time", () => {
      setMaxPendingObsPerProfileV2(2);
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      createObservationV2("o2", { profileId: "p1", signal: "s" });
      expect(() =>
        createObservationV2("o3", { profileId: "p1", signal: "s" }),
      ).toThrow(/cap/);
    });
    it("cap counts captured + reviewed", () => {
      setMaxPendingObsPerProfileV2(2);
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      reviewObservationV2("o1");
      createObservationV2("o2", { profileId: "p1", signal: "s" });
      expect(() =>
        createObservationV2("o3", { profileId: "p1", signal: "s" }),
      ).toThrow(/cap/);
    });
    it("cap excludes reinforced/discarded/promoted", () => {
      setMaxPendingObsPerProfileV2(2);
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      reviewObservationV2("o1");
      reinforceObservationV2("o1");
      createObservationV2("o2", { profileId: "p1", signal: "s" });
      expect(() =>
        createObservationV2("o3", { profileId: "p1", signal: "s" }),
      ).not.toThrow();
    });
  });

  describe("observation transitions", () => {
    beforeEach(() => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      createObservationV2("o1", { profileId: "p1", signal: "s" });
    });
    it("captured → reviewed stamps reviewedAt", () => {
      const o = reviewObservationV2("o1", { now: 100 });
      expect(o.status).toBe("reviewed");
      expect(o.reviewedAt).toBe(100);
    });
    it("reviewed → reinforced", () => {
      reviewObservationV2("o1");
      const o = reinforceObservationV2("o1");
      expect(o.status).toBe("reinforced");
    });
    it("reviewed → promoted stamps settledAt and is terminal", () => {
      reviewObservationV2("o1");
      const o = promoteObservationV2("o1", { now: 200 });
      expect(o.status).toBe("promoted");
      expect(o.settledAt).toBe(200);
      expect(() => discardObservationV2("o1")).toThrow(/terminal/);
    });
    it("captured → discarded stamps settledAt and is terminal", () => {
      const o = discardObservationV2("o1", { now: 300 });
      expect(o.status).toBe("discarded");
      expect(o.settledAt).toBe(300);
      expect(() => reviewObservationV2("o1")).toThrow(/terminal/);
    });
    it("reinforced → promoted is allowed", () => {
      reviewObservationV2("o1");
      reinforceObservationV2("o1");
      const o = promoteObservationV2("o1");
      expect(o.status).toBe("promoted");
    });
    it("captured cannot promote directly", () => {
      expect(() => promoteObservationV2("o1")).toThrow(/cannot transition/);
    });
    it("rejects unknown next status", () => {
      expect(() => setObservationStatusV2("o1", "weird")).toThrow(/unknown/);
    });
    it("throws on missing observation", () => {
      expect(() => reviewObservationV2("ghost")).toThrow(/not found/);
    });
  });

  describe("listObservationsV2 + getPendingObsCountV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      registerProfileV2("p2", { userId: "u1", category: "c" });
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      createObservationV2("o2", { profileId: "p1", signal: "s" });
      createObservationV2("o3", { profileId: "p2", signal: "s" });
      reviewObservationV2("o2");
      discardObservationV2("o3");
    });
    it("filters by profileId/status", () => {
      expect(listObservationsV2({ profileId: "p1" })).toHaveLength(2);
      expect(listObservationsV2({ profileId: "p2" })).toHaveLength(1);
      expect(listObservationsV2({ status: "captured" })).toHaveLength(1);
      expect(listObservationsV2({ status: "discarded" })).toHaveLength(1);
    });
    it("counts pending (captured+reviewed) per profile", () => {
      expect(getPendingObsCountV2("p1")).toBe(2);
      expect(getPendingObsCountV2("p2")).toBe(0);
    });
  });

  describe("autoDormantIdleProfilesV2", () => {
    it("flips active profiles past idle threshold", () => {
      registerProfileV2("p1", { userId: "u1", category: "c", now: 0 });
      activateProfileV2("p1", { now: 0 });
      setProfileIdleMsV2(1000);
      const flipped = autoDormantIdleProfilesV2({ now: 5000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("dormant");
    });
    it("skips non-active profiles", () => {
      registerProfileV2("p1", { userId: "u1", category: "c", now: 0 });
      const flipped = autoDormantIdleProfilesV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("preserves active under idle threshold", () => {
      registerProfileV2("p1", { userId: "u1", category: "c", now: 0 });
      activateProfileV2("p1", { now: 0 });
      setProfileIdleMsV2(10000);
      const flipped = autoDormantIdleProfilesV2({ now: 500 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoDiscardStaleObservationsV2", () => {
    it("flips captured/reviewed past stuck threshold to discarded", () => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      createObservationV2("o1", { profileId: "p1", signal: "s", now: 0 });
      createObservationV2("o2", { profileId: "p1", signal: "s", now: 0 });
      reviewObservationV2("o2", { now: 0 });
      setObsStuckMsV2(1000);
      const flipped = autoDiscardStaleObservationsV2({ now: 5000 });
      expect(flipped).toHaveLength(2);
      expect(flipped.every((o) => o.status === "discarded")).toBe(true);
      expect(flipped.every((o) => o.settledAt === 5000)).toBe(true);
    });
    it("skips terminal observations", () => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      createObservationV2("o1", { profileId: "p1", signal: "s", now: 0 });
      discardObservationV2("o1", { now: 0 });
      const flipped = autoDiscardStaleObservationsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
    it("skips reinforced (not pending)", () => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      createObservationV2("o1", { profileId: "p1", signal: "s", now: 0 });
      reviewObservationV2("o1", { now: 0 });
      reinforceObservationV2("o1", { now: 0 });
      setObsStuckMsV2(1);
      const flipped = autoDiscardStaleObservationsV2({ now: 9999999 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getInstinctManagerStatsV2", () => {
    it("zero-initializes all enum keys", () => {
      const s = getInstinctManagerStatsV2();
      expect(s.profilesByStatus.pending).toBe(0);
      expect(s.profilesByStatus.active).toBe(0);
      expect(s.profilesByStatus.dormant).toBe(0);
      expect(s.profilesByStatus.archived).toBe(0);
      expect(s.observationsByStatus.captured).toBe(0);
      expect(s.observationsByStatus.reviewed).toBe(0);
      expect(s.observationsByStatus.reinforced).toBe(0);
      expect(s.observationsByStatus.discarded).toBe(0);
      expect(s.observationsByStatus.promoted).toBe(0);
      expect(s.totalProfilesV2).toBe(0);
      expect(s.totalObservationsV2).toBe(0);
    });
    it("counts profiles + observations by status", () => {
      registerProfileV2("p1", { userId: "u1", category: "c" });
      activateProfileV2("p1");
      createObservationV2("o1", { profileId: "p1", signal: "s" });
      reviewObservationV2("o1");
      const s = getInstinctManagerStatsV2();
      expect(s.profilesByStatus.active).toBe(1);
      expect(s.observationsByStatus.reviewed).toBe(1);
      expect(s.totalProfilesV2).toBe(1);
      expect(s.totalObservationsV2).toBe(1);
    });
    it("includes config snapshot", () => {
      const s = getInstinctManagerStatsV2();
      expect(s.maxActiveProfilesPerUser).toBe(5);
      expect(s.maxPendingObsPerProfile).toBe(100);
      expect(s.profileIdleMs).toBeGreaterThan(0);
      expect(s.obsStuckMs).toBeGreaterThan(0);
    });
  });
});
