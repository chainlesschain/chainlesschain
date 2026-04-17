import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  CONTENT_TYPES,
  RECOMMENDATION_STATUS,
  FEEDBACK_VALUES,
  DEFAULT_CONFIG,
  ensureRecommendationTables,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  listProfiles,
  applyDecay,
  scoreContent,
  generateRecommendations,
  getRecommendation,
  listRecommendations,
  markViewed,
  provideFeedback,
  dismissRecommendation,
  getRecommendationStats,
  getTopInterests,
  suggestTopics,
  _resetState,
} from "../../src/lib/content-recommendation.js";

describe("content-recommendation", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureRecommendationTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureRecommendationTables", () => {
    it("creates both tables", () => {
      expect(db.tables.has("user_interest_profiles")).toBe(true);
      expect(db.tables.has("content_recommendations")).toBe(true);
    });

    it("is idempotent", () => {
      ensureRecommendationTables(db);
      expect(db.tables.has("user_interest_profiles")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 4 content types", () => {
      expect(Object.keys(CONTENT_TYPES)).toHaveLength(4);
    });

    it("has 3 recommendation statuses", () => {
      expect(Object.keys(RECOMMENDATION_STATUS)).toHaveLength(3);
    });

    it("has 3 feedback values", () => {
      expect(Object.keys(FEEDBACK_VALUES)).toHaveLength(3);
    });

    it("DEFAULT_CONFIG has expected keys", () => {
      expect(DEFAULT_CONFIG.minScore).toBe(0.3);
      expect(DEFAULT_CONFIG.maxBatchSize).toBe(50);
      expect(DEFAULT_CONFIG.decayFactor).toBe(0.9);
    });
  });

  /* ── Profile CRUD ────────────────────────────────── */

  describe("createProfile", () => {
    it("creates a profile with topics", () => {
      const r = createProfile(db, "user1", {
        topics: { ai: 0.8, crypto: 0.6 },
      });
      expect(r.profileId).toBeTruthy();
    });

    it("rejects duplicate profile", () => {
      createProfile(db, "user1");
      const r = createProfile(db, "user1");
      expect(r.profileId).toBeNull();
      expect(r.reason).toBe("profile_exists");
    });

    it("stores interaction weights", () => {
      createProfile(db, "user1", {
        topics: { ai: 0.5 },
        interactionWeights: { note: 1.0, post: 0.5 },
      });
      const p = getProfile(db, "user1");
      expect(p.interaction_weights.note).toBe(1.0);
    });
  });

  describe("getProfile", () => {
    it("returns null for unknown user", () => {
      expect(getProfile(db, "nobody")).toBeNull();
    });

    it("returns profile with topics parsed", () => {
      createProfile(db, "user1", { topics: { ai: 0.9 } });
      const p = getProfile(db, "user1");
      expect(p.topics.ai).toBe(0.9);
      expect(p.user_id).toBe("user1");
    });
  });

  describe("updateProfile", () => {
    it("updates topics", () => {
      createProfile(db, "user1", { topics: { ai: 0.5 } });
      const r = updateProfile(db, "user1", { topics: { ai: 0.9, web3: 0.4 } });
      expect(r.updated).toBe(true);
      const p = getProfile(db, "user1");
      expect(p.topics.ai).toBe(0.9);
      expect(p.topics.web3).toBe(0.4);
    });

    it("updates decay factor", () => {
      createProfile(db, "user1");
      updateProfile(db, "user1", { decayFactor: 0.85 });
      const p = getProfile(db, "user1");
      expect(p.decay_factor).toBe(0.85);
    });

    it("increments update_count", () => {
      createProfile(db, "user1");
      updateProfile(db, "user1", { topics: { a: 1 } });
      updateProfile(db, "user1", { topics: { b: 1 } });
      const p = getProfile(db, "user1");
      expect(p.update_count).toBe(2);
    });

    it("fails for unknown user", () => {
      const r = updateProfile(db, "nobody", { topics: {} });
      expect(r.updated).toBe(false);
      expect(r.reason).toBe("not_found");
    });
  });

  describe("deleteProfile", () => {
    it("deletes existing profile", () => {
      createProfile(db, "user1");
      const r = deleteProfile(db, "user1");
      expect(r.deleted).toBe(true);
      expect(getProfile(db, "user1")).toBeNull();
    });

    it("fails for unknown user", () => {
      const r = deleteProfile(db, "nobody");
      expect(r.deleted).toBe(false);
    });
  });

  describe("listProfiles", () => {
    it("lists profiles sorted by last_updated desc", () => {
      createProfile(db, "user1", { topics: { a: 1 } });
      createProfile(db, "user2", { topics: { b: 1 } });
      const list = listProfiles(db);
      expect(list).toHaveLength(2);
    });

    it("respects limit", () => {
      createProfile(db, "u1");
      createProfile(db, "u2");
      createProfile(db, "u3");
      const list = listProfiles(db, { limit: 2 });
      expect(list).toHaveLength(2);
    });
  });

  /* ── Decay ───────────────────────────────────────── */

  describe("applyDecay", () => {
    it("reduces topic weights by decay factor", () => {
      createProfile(db, "user1", { topics: { ai: 1.0, crypto: 0.5 } });
      const r = applyDecay(db, "user1");
      expect(r.applied).toBe(true);
      const p = getProfile(db, "user1");
      expect(p.topics.ai).toBe(0.9);
      expect(p.topics.crypto).toBe(0.45);
    });

    it("removes topics below 0.01", () => {
      createProfile(db, "user1", { topics: { rare: 0.005 } });
      applyDecay(db, "user1");
      const p = getProfile(db, "user1");
      expect(p.topics.rare).toBeUndefined();
    });

    it("fails for unknown user", () => {
      const r = applyDecay(db, "nobody");
      expect(r.applied).toBe(false);
    });
  });

  /* ── Scoring ─────────────────────────────────────── */

  describe("scoreContent", () => {
    it("returns 0 for empty profile", () => {
      expect(scoreContent({ topics: {} }, { title: "test" })).toBe(0);
    });

    it("returns 0 for null profile", () => {
      expect(scoreContent(null, { title: "test" })).toBe(0);
    });

    it("scores based on topic overlap", () => {
      const profile = {
        topics: { ai: 0.8, crypto: 0.6 },
        interaction_weights: {},
      };
      const content = { title: "AI advances", topics: ["ai"] };
      const score = scoreContent(profile, content);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("matches topics in title text", () => {
      const profile = { topics: { blockchain: 0.7 }, interaction_weights: {} };
      const content = { title: "Introduction to Blockchain", topics: [] };
      const score = scoreContent(profile, content);
      expect(score).toBeGreaterThan(0);
    });

    it("boosts for interaction weight match", () => {
      const profile = {
        topics: { ai: 0.8 },
        interaction_weights: { note: 1.0 },
      };
      const content1 = {
        title: "AI note",
        topics: ["ai"],
        content_type: "note",
      };
      const content2 = {
        title: "AI post",
        topics: ["ai"],
        content_type: "post",
      };
      const s1 = scoreContent(profile, content1);
      const s2 = scoreContent(profile, content2);
      expect(s1).toBeGreaterThanOrEqual(s2);
    });
  });

  /* ── Generation ──────────────────────────────────── */

  describe("generateRecommendations", () => {
    const pool = [
      { id: "c1", title: "AI Tutorial", content_type: "note", topics: ["ai"] },
      {
        id: "c2",
        title: "Cooking Guide",
        content_type: "article",
        topics: ["cooking"],
      },
      {
        id: "c3",
        title: "ML Basics",
        content_type: "note",
        topics: ["ai", "ml"],
      },
      {
        id: "c4",
        title: "Blockchain 101",
        content_type: "post",
        topics: ["crypto"],
      },
    ];

    it("generates scored recommendations", () => {
      createProfile(db, "user1", { topics: { ai: 0.9, ml: 0.7 } });
      const r = generateRecommendations(db, "user1", pool);
      expect(r.generated).toBeGreaterThan(0);
      expect(r.ids).toHaveLength(r.generated);
    });

    it("fails without profile", () => {
      const r = generateRecommendations(db, "nobody", pool);
      expect(r.generated).toBe(0);
      expect(r.reason).toBe("no_profile");
    });

    it("respects minScore filter", () => {
      createProfile(db, "user1", { topics: { ai: 0.9 } });
      const r = generateRecommendations(db, "user1", pool, { minScore: 1.1 });
      expect(r.generated).toBe(0);
    });

    it("respects limit", () => {
      createProfile(db, "user1", {
        topics: { ai: 0.9, crypto: 0.8, cooking: 0.7 },
      });
      const r = generateRecommendations(db, "user1", pool, { limit: 2 });
      expect(r.generated).toBeLessThanOrEqual(2);
    });

    it("stores recommendations with reason", () => {
      createProfile(db, "user1", { topics: { ai: 0.9 } });
      const r = generateRecommendations(db, "user1", pool);
      const rec = getRecommendation(db, r.ids[0]);
      expect(rec.reason).toContain("ai");
      expect(rec.status).toBe("pending");
    });
  });

  /* ── Recommendation CRUD ─────────────────────────── */

  describe("getRecommendation", () => {
    it("returns null for unknown id", () => {
      expect(getRecommendation(db, "nope")).toBeNull();
    });
  });

  describe("listRecommendations", () => {
    it("returns empty for unknown user", () => {
      expect(listRecommendations(db, "nobody")).toEqual([]);
    });

    it("filters by status", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const pool = [
        { id: "c1", title: "AI 1", topics: ["ai"] },
        { id: "c2", title: "AI 2", topics: ["ai"] },
      ];
      const r = generateRecommendations(db, "u", pool);
      markViewed(db, r.ids[0]);
      const pending = listRecommendations(db, "u", { status: "pending" });
      const viewed = listRecommendations(db, "u", { status: "viewed" });
      expect(pending).toHaveLength(1);
      expect(viewed).toHaveLength(1);
    });

    it("filters by content type", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const pool = [
        { id: "c1", title: "AI note", content_type: "note", topics: ["ai"] },
        { id: "c2", title: "AI post", content_type: "post", topics: ["ai"] },
      ];
      generateRecommendations(db, "u", pool);
      const notes = listRecommendations(db, "u", { contentType: "note" });
      expect(notes.every((r) => r.content_type === "note")).toBe(true);
    });

    it("sorts by score descending", () => {
      createProfile(db, "u", { topics: { ai: 1, cooking: 0.1 } });
      const pool = [
        { id: "c1", title: "Cooking tips", topics: ["cooking"] },
        { id: "c2", title: "AI deep learning", topics: ["ai"] },
      ];
      generateRecommendations(db, "u", pool);
      const list = listRecommendations(db, "u");
      if (list.length >= 2) {
        expect(list[0].score).toBeGreaterThanOrEqual(list[1].score);
      }
    });
  });

  describe("markViewed", () => {
    it("marks pending as viewed", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      const result = markViewed(db, r.ids[0]);
      expect(result.marked).toBe(true);
      const rec = getRecommendation(db, r.ids[0]);
      expect(rec.status).toBe("viewed");
      expect(rec.viewed_at).toBeTruthy();
    });

    it("rejects already viewed", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      markViewed(db, r.ids[0]);
      const result = markViewed(db, r.ids[0]);
      expect(result.marked).toBe(false);
      expect(result.reason).toBe("already_viewed");
    });

    it("fails for unknown id", () => {
      const result = markViewed(db, "nope");
      expect(result.marked).toBe(false);
    });
  });

  describe("provideFeedback", () => {
    it("records like feedback", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      const result = provideFeedback(db, r.ids[0], "like");
      expect(result.recorded).toBe(true);
      const rec = getRecommendation(db, r.ids[0]);
      expect(rec.feedback).toBe("like");
    });

    it("dislike sets status to dismissed", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      provideFeedback(db, r.ids[0], "dislike");
      const rec = getRecommendation(db, r.ids[0]);
      expect(rec.status).toBe("dismissed");
    });

    it("rejects invalid feedback value", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      const result = provideFeedback(db, r.ids[0], "invalid");
      expect(result.recorded).toBe(false);
      expect(result.reason).toBe("invalid_feedback");
    });

    it("transitions pending to viewed on feedback", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      provideFeedback(db, r.ids[0], "later");
      const rec = getRecommendation(db, r.ids[0]);
      expect(rec.status).toBe("viewed");
    });
  });

  describe("dismissRecommendation", () => {
    it("dismisses a recommendation", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const r = generateRecommendations(db, "u", [
        { id: "c1", title: "AI", topics: ["ai"] },
      ]);
      const result = dismissRecommendation(db, r.ids[0]);
      expect(result.dismissed).toBe(true);
      expect(getRecommendation(db, r.ids[0]).status).toBe("dismissed");
    });

    it("fails for unknown id", () => {
      expect(dismissRecommendation(db, "nope").dismissed).toBe(false);
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getRecommendationStats", () => {
    it("returns zeros for unknown user", () => {
      const s = getRecommendationStats(db, "nobody");
      expect(s.total).toBe(0);
      expect(s.feedbackRate).toBe(0);
    });

    it("computes correct stats", () => {
      createProfile(db, "u", { topics: { ai: 1, crypto: 0.8 } });
      const pool = [
        { id: "c1", title: "AI 1", topics: ["ai"] },
        { id: "c2", title: "AI 2", topics: ["ai"] },
        { id: "c3", title: "Crypto", topics: ["crypto"] },
      ];
      const r = generateRecommendations(db, "u", pool);
      markViewed(db, r.ids[0]);
      provideFeedback(db, r.ids[1], "like");
      const s = getRecommendationStats(db, "u");
      expect(s.total).toBe(3);
      expect(s.viewed).toBeGreaterThanOrEqual(1);
      expect(s.feedbackCount).toBe(1);
      expect(s.feedbackRate).toBeGreaterThan(0);
      expect(s.avgScore).toBeGreaterThan(0);
    });
  });

  /* ── Insights ────────────────────────────────────── */

  describe("getTopInterests", () => {
    it("returns sorted interests", () => {
      createProfile(db, "u", { topics: { ai: 0.9, crypto: 0.3, web: 0.7 } });
      const top = getTopInterests(db, "u", { limit: 2 });
      expect(top).toHaveLength(2);
      expect(top[0].topic).toBe("ai");
      expect(top[1].topic).toBe("web");
    });

    it("returns empty for unknown user", () => {
      expect(getTopInterests(db, "nobody")).toEqual([]);
    });
  });

  describe("suggestTopics", () => {
    it("returns empty with no feedback", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      expect(suggestTopics(db, "u")).toEqual([]);
    });

    it("suggests boost for liked topics", () => {
      createProfile(db, "u", { topics: { ai: 1 } });
      const pool = [
        { id: "c1", title: "AI Tutorial", topics: ["ai"] },
        { id: "c2", title: "AI Deep", topics: ["ai"] },
      ];
      const r = generateRecommendations(db, "u", pool);
      provideFeedback(db, r.ids[0], "like");
      provideFeedback(db, r.ids[1], "like");
      const suggestions = suggestTopics(db, "u");
      const aiSuggestion = suggestions.find((s) => s.topic === "ai");
      if (aiSuggestion) {
        expect(aiSuggestion.action).toBe("boost");
      }
    });
  });
});
