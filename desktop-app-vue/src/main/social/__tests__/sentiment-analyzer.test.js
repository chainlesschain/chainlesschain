/**
 * SentimentAnalyzer Unit Tests
 *
 * Covers:
 * - initialize() table and index creation
 * - analyzePost() with positive, negative, and neutral text
 * - analyzePost() DB insert, return shape, and cache-hit path
 * - analyzePost() validation (missing postId or text)
 * - analyzeBatch() iterates over each post; handles individual failures
 * - getSentimentTrend() query delegation and return shape
 * - getEmotionDistribution() full-emotion coverage and percentages
 * - getAverageSentiment() period handling and return shape
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ────────────────────────────────────────────────────────
const { SentimentAnalyzer, Emotion } = require("../sentiment-analyzer.js");

// ─── Test data ────────────────────────────────────────────────────────────────
const positiveTexts = [
  "I love this! Amazing and wonderful!",
  "Great job, excellent work everyone",
];

const negativeTexts = [
  "This is terrible and awful, I hate it",
  "I hate this broken thing, it is horrible",
];

const neutralTexts = [
  "Today is Monday",
  "The file is 5KB",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockInnerDb() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
}

function createMockDatabase() {
  const innerDb = createMockInnerDb();
  return { db: innerDb, _inner: innerDb };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SentimentAnalyzer", () => {
  let analyzer;
  let mockDb;
  let innerDb;

  beforeEach(() => {
    uuidCounter = 0;
    mockDb = createMockDatabase();
    innerDb = mockDb._inner;
    analyzer = new SentimentAnalyzer(mockDb);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should store database reference and start uninitialized", () => {
      expect(analyzer.database).toBe(mockDb);
      expect(analyzer.initialized).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(typeof analyzer.on).toBe("function");
      expect(typeof analyzer.emit).toBe("function");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Emotion constant
  // ─────────────────────────────────────────────────────────────────────────
  describe("Emotion constant", () => {
    it("should export all expected emotion values", () => {
      expect(Emotion.JOY).toBe("joy");
      expect(Emotion.SADNESS).toBe("sadness");
      expect(Emotion.ANGER).toBe("anger");
      expect(Emotion.FEAR).toBe("fear");
      expect(Emotion.SURPRISE).toBe("surprise");
      expect(Emotion.NEUTRAL).toBe("neutral");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should call db.exec to create sentiment_data table", async () => {
      await analyzer.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasTable = execCalls.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS sentiment_data"),
      );
      expect(hasTable).toBe(true);
    });

    it("should create an index on post_id", async () => {
      await analyzer.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_sentiment_post"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should create an index on emotion", async () => {
      await analyzer.initialize();

      const execCalls = innerDb.exec.mock.calls.map((c) => c[0]);
      const hasIndex = execCalls.some((sql) =>
        sql.includes("idx_sentiment_emotion"),
      );
      expect(hasIndex).toBe(true);
    });

    it("should set initialized to true", async () => {
      await analyzer.initialize();
      expect(analyzer.initialized).toBe(true);
    });

    it("should be idempotent – second call skips re-creation", async () => {
      await analyzer.initialize();
      const firstCount = innerDb.exec.mock.calls.length;

      await analyzer.initialize();
      expect(innerDb.exec.mock.calls.length).toBe(firstCount);
    });

    it("should propagate errors from db.exec", async () => {
      innerDb.exec.mockImplementationOnce(() => {
        throw new Error("schema error");
      });

      await expect(analyzer.initialize()).rejects.toThrow("schema error");
      expect(analyzer.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzePost() – positive text
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzePost() with positive text", () => {
    it("should return sentiment_score > 0 for positive text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null); // no existing record

      const result = await analyzer.analyzePost("post-1", positiveTexts[0]);
      expect(result.sentiment_score).toBeGreaterThan(0);
    });

    it("should return emotion 'joy' for strongly positive text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-1", "I love this! happy and cheerful celebrate");
      expect(result.emotion).toBe(Emotion.JOY);
    });

    it("should return confidence > 0 when positive keywords are present", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-1", positiveTexts[1]);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzePost() – negative text
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzePost() with negative text", () => {
    it("should return sentiment_score < 0 for negative text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-2", negativeTexts[0]);
      expect(result.sentiment_score).toBeLessThan(0);
    });

    it("should return an anger or negative emotion for anger-laden text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-2", "I hate this, so angry and frustrated");
      // should not be neutral or joy
      expect(result.emotion).not.toBe(Emotion.NEUTRAL);
      expect(result.emotion).not.toBe(Emotion.JOY);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzePost() – neutral text
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzePost() with neutral text", () => {
    it("should return sentiment_score near 0 for neutral text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-3", neutralTexts[0]);
      expect(result.sentiment_score).toBeGreaterThanOrEqual(-0.1);
      expect(result.sentiment_score).toBeLessThanOrEqual(0.1);
    });

    it("should return emotion 'neutral' for plain factual text", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-3", neutralTexts[1]);
      expect(result.emotion).toBe(Emotion.NEUTRAL);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzePost() – DB interaction and return shape
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzePost() – DB interaction", () => {
    it("should call prepare INSERT when no existing record", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      await analyzer.analyzePost("post-5", positiveTexts[0]);

      // The second prepare call is the INSERT
      const insertCall = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO sentiment_data"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should return { id, post_id, sentiment_score, emotion, confidence, analyzed_at }", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const result = await analyzer.analyzePost("post-6", positiveTexts[0]);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("post_id", "post-6");
      expect(result).toHaveProperty("sentiment_score");
      expect(result).toHaveProperty("emotion");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("analyzed_at");
    });

    it("should return the cached row when the post was already analyzed", async () => {
      const cached = {
        id: "cached-id",
        post_id: "post-7",
        sentiment_score: 0.8,
        emotion: "joy",
        confidence: 0.5,
        analyzed_at: 1700000000000,
      };
      innerDb._prep.get.mockReturnValueOnce(cached);

      const result = await analyzer.analyzePost("post-7", positiveTexts[0]);

      // Should return the cached row without INSERT
      expect(result).toBe(cached);
      const insertCall = innerDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO sentiment_data"),
      );
      expect(insertCall).toBeUndefined();
    });

    it("should emit sentiment:analyzed event with postId and sentiment", async () => {
      innerDb._prep.get.mockReturnValueOnce(null);

      const spy = vi.fn();
      analyzer.on("sentiment:analyzed", spy);

      await analyzer.analyzePost("post-8", positiveTexts[0]);

      expect(spy).toHaveBeenCalledOnce();
      const { postId } = spy.mock.calls[0][0];
      expect(postId).toBe("post-8");
    });

    it("should throw when postId is missing", async () => {
      await expect(analyzer.analyzePost("", positiveTexts[0])).rejects.toThrow(
        "Post ID and text are required",
      );
    });

    it("should throw when text is missing", async () => {
      await expect(analyzer.analyzePost("post-9", "")).rejects.toThrow(
        "Post ID and text are required",
      );
    });

    it("should throw when both postId and text are missing", async () => {
      await expect(analyzer.analyzePost(null, null)).rejects.toThrow(
        "Post ID and text are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // analyzeBatch()
  // ─────────────────────────────────────────────────────────────────────────
  describe("analyzeBatch()", () => {
    it("should call analyzePost once for each post in the array", async () => {
      innerDb._prep.get
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      const posts = [
        { id: "p1", text: positiveTexts[0] },
        { id: "p2", text: negativeTexts[0] },
      ];

      const results = await analyzer.analyzeBatch(posts);
      expect(results).toHaveLength(2);
    });

    it("should return empty array for empty input", async () => {
      const results = await analyzer.analyzeBatch([]);
      expect(results).toEqual([]);
    });

    it("should return empty array for non-array input", async () => {
      const results = await analyzer.analyzeBatch(null);
      expect(results).toEqual([]);
    });

    it("should include error entry for a post that fails analysis", async () => {
      // Force second prepare call to throw on the INSERT
      let callCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        callCount++;
        if (callCount === 2) throw new Error("DB write error");
        return null;
      });

      const posts = [
        { id: "ok-post", text: positiveTexts[0] },
        { id: "bad-post", text: "valid text" },
      ];

      const results = await analyzer.analyzeBatch(posts);
      expect(results).toHaveLength(2);

      const errorResult = results.find((r) => r.error !== undefined);
      expect(errorResult).toBeTruthy();
      expect(errorResult.post_id).toBe("bad-post");
      expect(errorResult.sentiment_score).toBe(0);
      expect(errorResult.emotion).toBe(Emotion.NEUTRAL);
    });

    it("should return sentiment results for successful posts", async () => {
      innerDb._prep.get.mockReturnValue(null);

      const posts = [{ id: "p10", text: positiveTexts[0] }];
      const results = await analyzer.analyzeBatch(posts);

      expect(results[0].sentiment_score).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSentimentTrend()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSentimentTrend()", () => {
    it("should call prepare with a query on sentiment_data", async () => {
      await analyzer.getSentimentTrend("2023-01-01", "2023-12-31");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("sentiment_data");
    });

    it("should pass timestamp bounds to .all()", async () => {
      await analyzer.getSentimentTrend("2023-06-01", "2023-06-30");

      const startTs = new Date("2023-06-01").getTime();
      const endTs = new Date("2023-06-30T23:59:59").getTime();

      expect(innerDb._prep.all).toHaveBeenCalledWith(startTs, endTs);
    });

    it("should return an array of trend data points", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        {
          date: "2023-06-10",
          avg_score: 0.25,
          count: 5,
          min_score: -0.1,
          max_score: 0.8,
        },
      ]);

      const results = await analyzer.getSentimentTrend("2023-06-01", "2023-06-30");

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        date: "2023-06-10",
        avgScore: expect.any(Number),
        count: 5,
        minScore: expect.any(Number),
        maxScore: expect.any(Number),
      });
    });

    it("should return empty array when no data exists for the range", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);
      const results = await analyzer.getSentimentTrend("2099-01-01", "2099-12-31");
      expect(results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getEmotionDistribution()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getEmotionDistribution()", () => {
    it("should call prepare with a query on sentiment_data", async () => {
      await analyzer.getEmotionDistribution("2023-01-01", "2023-12-31");

      const sql = innerDb.prepare.mock.calls[0][0];
      expect(sql).toContain("sentiment_data");
    });

    it("should return an object with total, distribution, startDate, endDate", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        { emotion: "joy", count: 10 },
        { emotion: "neutral", count: 5 },
      ]);

      const result = await analyzer.getEmotionDistribution("2023-01-01", "2023-12-31");

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("distribution");
      expect(result).toHaveProperty("startDate", "2023-01-01");
      expect(result).toHaveProperty("endDate", "2023-12-31");
    });

    it("should ensure all emotions are represented in distribution", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        { emotion: "joy", count: 3 },
      ]);

      const result = await analyzer.getEmotionDistribution("2023-01-01", "2023-12-31");

      for (const emotion of Object.values(Emotion)) {
        expect(result.distribution).toHaveProperty(emotion);
      }
    });

    it("should calculate correct percentages for known distribution", async () => {
      innerDb._prep.all.mockReturnValueOnce([
        { emotion: "joy", count: 75 },
        { emotion: "neutral", count: 25 },
      ]);

      const result = await analyzer.getEmotionDistribution("2023-01-01", "2023-12-31");

      expect(result.total).toBe(100);
      expect(result.distribution.joy.percentage).toBe(75);
      expect(result.distribution.neutral.percentage).toBe(25);
    });

    it("should return zero percentages when no data", async () => {
      innerDb._prep.all.mockReturnValueOnce([]);

      const result = await analyzer.getEmotionDistribution("2099-01-01", "2099-12-31");

      expect(result.total).toBe(0);
      for (const emotion of Object.values(Emotion)) {
        expect(result.distribution[emotion].count).toBe(0);
        expect(result.distribution[emotion].percentage).toBe(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getAverageSentiment()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getAverageSentiment()", () => {
    function setupAverageSentimentMocks({ avgRow = null, emotionRow = null } = {}) {
      let getCount = 0;
      innerDb._prep.get.mockImplementation(() => {
        getCount++;
        if (getCount === 1) return avgRow;
        if (getCount === 2) return emotionRow;
        return null;
      });
    }

    it("should return an object with period, averageScore, totalAnalyzed, minScore, maxScore, dominantEmotion", async () => {
      setupAverageSentimentMocks({
        avgRow: { avg_score: 0.42, count: 10, min_score: -0.1, max_score: 0.9 },
        emotionRow: { emotion: "joy" },
      });

      const result = await analyzer.getAverageSentiment("week");

      expect(result).toHaveProperty("period", "week");
      expect(result).toHaveProperty("averageScore");
      expect(result).toHaveProperty("totalAnalyzed");
      expect(result).toHaveProperty("minScore");
      expect(result).toHaveProperty("maxScore");
      expect(result).toHaveProperty("dominantEmotion");
    });

    it("should return correct averageScore from DB row", async () => {
      setupAverageSentimentMocks({
        avgRow: { avg_score: 0.5, count: 3, min_score: 0.1, max_score: 0.9 },
        emotionRow: { emotion: "joy" },
      });

      const result = await analyzer.getAverageSentiment("month");
      expect(result.averageScore).toBe(0.5);
    });

    it("should return 0 for averageScore when no data exists", async () => {
      setupAverageSentimentMocks({ avgRow: null, emotionRow: null });

      const result = await analyzer.getAverageSentiment("day");
      expect(result.averageScore).toBe(0);
      expect(result.totalAnalyzed).toBe(0);
    });

    it("should return dominantEmotion from emotionRow", async () => {
      setupAverageSentimentMocks({
        avgRow: { avg_score: -0.2, count: 2, min_score: -0.5, max_score: 0.0 },
        emotionRow: { emotion: "sadness" },
      });

      const result = await analyzer.getAverageSentiment("year");
      expect(result.dominantEmotion).toBe("sadness");
    });

    it("should default dominantEmotion to neutral when no emotion row", async () => {
      setupAverageSentimentMocks({
        avgRow: { avg_score: 0, count: 0, min_score: 0, max_score: 0 },
        emotionRow: null,
      });

      const result = await analyzer.getAverageSentiment("day");
      expect(result.dominantEmotion).toBe(Emotion.NEUTRAL);
    });

    it("should handle unknown period gracefully (uses 30-day fallback)", async () => {
      setupAverageSentimentMocks({
        avgRow: { avg_score: 0.1, count: 5, min_score: 0, max_score: 0.5 },
        emotionRow: { emotion: "neutral" },
      });

      const result = await analyzer.getAverageSentiment("century");
      expect(result).toHaveProperty("period", "century");
      expect(result.totalAnalyzed).toBe(5);
    });

    it("should handle each named period without throwing", async () => {
      for (const period of ["day", "week", "month", "year"]) {
        setupAverageSentimentMocks({ avgRow: null, emotionRow: null });
        const result = await analyzer.getAverageSentiment(period);
        expect(result.period).toBe(period);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // close()
  // ─────────────────────────────────────────────────────────────────────────
  describe("close()", () => {
    it("should set initialized to false", async () => {
      await analyzer.initialize();
      expect(analyzer.initialized).toBe(true);

      await analyzer.close();
      expect(analyzer.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      const spy = vi.fn();
      analyzer.on("sentiment:analyzed", spy);

      await analyzer.close();
      analyzer.emit("sentiment:analyzed", {});

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
