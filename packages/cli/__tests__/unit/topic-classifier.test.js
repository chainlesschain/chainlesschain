/**
 * Tests for src/lib/topic-classifier.js — language-aware topic classification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectLanguage,
  tokenize,
  classifyTopic,
  DEFAULT_TOPIC_LEXICONS,
  registerTopicLexicon,
  unregisterTopicLexicon,
  listTopicLexicons,
  _resetState,
} from "../../src/lib/topic-classifier.js";

describe("topic-classifier", () => {
  beforeEach(() => {
    _resetState();
  });

  // ── detectLanguage ───────────────────────────────────────────

  describe("detectLanguage", () => {
    it("returns 'other' for empty/invalid input", () => {
      expect(detectLanguage("")).toBe("other");
      expect(detectLanguage("   ")).toBe("other");
      expect(detectLanguage(null)).toBe("other");
      expect(detectLanguage(undefined)).toBe("other");
      expect(detectLanguage(123)).toBe("other");
    });

    it("detects Japanese via Hiragana/Katakana", () => {
      expect(detectLanguage("これはテストです")).toBe("ja");
      expect(detectLanguage("スポーツ")).toBe("ja");
      // Mixed Han + Kana → still ja because Kana is distinctive
      expect(detectLanguage("今日はいい天気")).toBe("ja");
    });

    it("detects Chinese when Han is present but no Kana", () => {
      expect(detectLanguage("这是一个测试")).toBe("zh");
      expect(detectLanguage("加密货币很有趣")).toBe("zh");
    });

    it("detects English when Latin letters dominate", () => {
      expect(detectLanguage("Hello world this is a test")).toBe("en");
      expect(detectLanguage("AI and machine learning")).toBe("en");
    });

    it("returns 'other' for symbol-heavy or non-Latin-non-CJK text", () => {
      expect(detectLanguage("!!! ??? 123 456")).toBe("other");
    });
  });

  // ── tokenize ─────────────────────────────────────────────────

  describe("tokenize", () => {
    it("splits English on non-alphanumerics, lowercases", () => {
      const tokens = tokenize("Hello, World! AI is cool.", "en");
      expect(tokens).toEqual(["hello", "world", "ai", "is", "cool"]);
    });

    it("tokenizes Chinese char-by-char for CJK", () => {
      const tokens = tokenize("科技改变世界", "zh");
      expect(tokens).toContain("科");
      expect(tokens).toContain("技");
      expect(tokens).toContain("改");
      expect(tokens).toContain("变");
      expect(tokens).toContain("世");
      expect(tokens).toContain("界");
    });

    it("tokenizes Japanese char-by-char for Kana + Han", () => {
      const tokens = tokenize("スポーツが好き", "ja");
      // Each Kana and Han character should become a token
      expect(tokens.length).toBeGreaterThanOrEqual(6);
      expect(tokens).toContain("ス");
      expect(tokens).toContain("ポ");
      expect(tokens).toContain("好");
    });

    it("mixes Latin words into CJK tokenization", () => {
      const tokens = tokenize("AI改变未来", "zh");
      // "ai" from Latin, plus CJK chars
      expect(tokens).toContain("ai");
      expect(tokens).toContain("改");
      expect(tokens).toContain("变");
    });

    it("returns empty array for empty input", () => {
      expect(tokenize("", "en")).toEqual([]);
      expect(tokenize(null, "zh")).toEqual([]);
    });

    it("auto-detects language if not provided", () => {
      expect(tokenize("hello world")).toEqual(["hello", "world"]);
      const zh = tokenize("科技");
      expect(zh).toContain("科");
    });
  });

  // ── classifyTopic ────────────────────────────────────────────

  describe("classifyTopic", () => {
    it("returns empty topics for empty text", () => {
      const result = classifyTopic("");
      expect(result.topics).toEqual([]);
      expect(result.tokens).toEqual([]);
    });

    it("classifies English tech text as 'tech'", () => {
      const result = classifyTopic(
        "AI and machine learning are transforming software development and cloud computing.",
      );
      expect(result.language).toBe("en");
      expect(result.topics.length).toBeGreaterThan(0);
      expect(result.topics[0].topic).toBe("tech");
      expect(result.topics[0].score).toBeGreaterThan(0);
    });

    it("classifies Chinese finance text as 'finance'", () => {
      const result = classifyTopic(
        "股票市场最近波动很大,投资和加密货币都受到影响,经济形势紧张。",
      );
      expect(result.language).toBe("zh");
      expect(result.topics[0].topic).toBe("finance");
    });

    it("classifies Japanese sports text as 'sports'", () => {
      const result = classifyTopic(
        "今日のサッカーの試合は素晴らしかった。野球も好き。オリンピック優勝。",
      );
      expect(result.language).toBe("ja");
      expect(result.topics[0].topic).toBe("sports");
    });

    it("respects topK parameter", () => {
      const text =
        "AI software and sports game, plus food cuisine and travel trip.";
      const result = classifyTopic(text, { topK: 2 });
      expect(result.topics.length).toBeLessThanOrEqual(2);
    });

    it("normalizes scores so they sum to ~1", () => {
      const result = classifyTopic(
        "AI and software and algorithms; plus sports, football, basketball.",
        { topK: 10 },
      );
      if (result.topics.length > 0) {
        const sum = result.topics.reduce((s, t) => s + t.score, 0);
        expect(sum).toBeGreaterThan(0.99);
        expect(sum).toBeLessThanOrEqual(1.0001);
      }
    });

    it("sorts topics by rawScore descending", () => {
      const result = classifyTopic(
        "code software developer algorithm AI startup, and one football match.",
        { topK: 5 },
      );
      for (let i = 1; i < result.topics.length; i++) {
        expect(result.topics[i - 1].rawScore).toBeGreaterThanOrEqual(
          result.topics[i].rawScore,
        );
      }
    });

    it("matches multi-char CJK phrases via substring inclusion", () => {
      // "人工智能" is a multi-char phrase in the zh tech lexicon.
      const result = classifyTopic("人工智能是未来的趋势。");
      expect(result.language).toBe("zh");
      expect(result.topics[0].topic).toBe("tech");
    });

    it("honors lang override", () => {
      const result = classifyTopic("AI software code", { lang: "zh" });
      // Forced to zh — English lexicon won't be used, and zh lexicon has no
      // Latin keywords, so fallback to EN kicks in.
      expect(result.language).toBe("zh");
    });

    it("honors minScore threshold", () => {
      const result = classifyTopic("AI software code developer", {
        minScore: 100,
      });
      expect(result.topics.length).toBe(0);
    });

    it("falls back to English lexicon when target-language is empty", () => {
      // Register an artificial language that our detector will never pick,
      // then classify with lang override pointing at a lexicon that only
      // has EN entries.
      registerTopicLexicon("customTopic", {
        en: ["widget", "gizmo"],
      });
      const result = classifyTopic("I love my new widget and gizmo!", {
        topK: 3,
      });
      const customHit = result.topics.find((t) => t.topic === "customTopic");
      expect(customHit).toBeDefined();
    });

    it("returns language + tokens in result", () => {
      const result = classifyTopic("Hello world AI software");
      expect(result.language).toBe("en");
      expect(result.tokens.length).toBeGreaterThan(0);
      expect(Array.isArray(result.tokens)).toBe(true);
    });
  });

  // ── Lexicon registry ─────────────────────────────────────────

  describe("registerTopicLexicon / unregisterTopicLexicon", () => {
    it("registers a custom lexicon and uses it in classification", () => {
      registerTopicLexicon("gaming", {
        en: ["game", "gaming", "esports", "playstation", "xbox"],
        zh: ["游戏", "电竞", "主机"],
      });
      const result = classifyTopic(
        "I love gaming and esports tournaments on my PlayStation.",
      );
      expect(result.topics[0].topic).toBe("gaming");
    });

    it("overrides a default lexicon when same topic is registered", () => {
      registerTopicLexicon("tech", {
        en: ["zzzzz"], // deliberately nonsense — normal tech words shouldn't match
      });
      const result = classifyTopic("AI and software", { topK: 3 });
      const techHit = result.topics.find((t) => t.topic === "tech");
      expect(techHit).toBeUndefined();
    });

    it("unregisters custom lexicon and falls back to defaults", () => {
      registerTopicLexicon("tech", { en: ["zzzzz"] });
      expect(unregisterTopicLexicon("tech")).toBe(true);
      const result = classifyTopic("AI and software programming");
      expect(result.topics[0].topic).toBe("tech");
    });

    it("throws when topic or lexicon is invalid", () => {
      expect(() => registerTopicLexicon("", { en: [] })).toThrow();
      expect(() => registerTopicLexicon("foo", null)).toThrow();
      expect(() => registerTopicLexicon("foo", "bar")).toThrow();
    });

    it("supports weighted keyword tuples [word, weight]", () => {
      registerTopicLexicon("weighted", {
        en: [["rare", 100]], // one hit = 100 points
      });
      const result = classifyTopic("this is a rare case", { topK: 5 });
      const hit = result.topics.find((t) => t.topic === "weighted");
      expect(hit).toBeDefined();
      expect(hit.rawScore).toBe(100);
    });
  });

  describe("listTopicLexicons", () => {
    it("returns defaults when nothing is registered", () => {
      const all = listTopicLexicons();
      expect(all.tech).toBeDefined();
      expect(all.sports).toBeDefined();
      expect(all.finance).toBeDefined();
    });

    it("merges custom over defaults", () => {
      registerTopicLexicon("custom1", { en: ["foo"] });
      const all = listTopicLexicons();
      expect(all.custom1).toBeDefined();
      expect(all.tech).toBeDefined();
    });
  });

  // ── DEFAULT_TOPIC_LEXICONS ──────────────────────────────────

  describe("DEFAULT_TOPIC_LEXICONS", () => {
    it("is frozen", () => {
      expect(Object.isFrozen(DEFAULT_TOPIC_LEXICONS)).toBe(true);
    });

    it("has 8 topics × 3 languages", () => {
      const topics = Object.keys(DEFAULT_TOPIC_LEXICONS);
      expect(topics.length).toBe(8);
      for (const topic of topics) {
        const perLang = DEFAULT_TOPIC_LEXICONS[topic];
        expect(perLang.en).toBeDefined();
        expect(perLang.zh).toBeDefined();
        expect(perLang.ja).toBeDefined();
      }
    });
  });
});
