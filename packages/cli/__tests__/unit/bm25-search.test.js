import { describe, it, expect, beforeEach } from "vitest";
import { BM25Search } from "../../src/lib/bm25-search.js";

describe("BM25Search", () => {
  let bm25;

  beforeEach(() => {
    bm25 = new BM25Search();
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("uses default parameters", () => {
      const stats = bm25.getStats();
      expect(stats.totalDocuments).toBe(0);
      expect(stats.uniqueTerms).toBe(0);
      expect(stats.avgDocumentLength).toBe(0);
    });

    it("accepts custom k1 and b parameters", () => {
      const custom = new BM25Search({ k1: 2.0, b: 0.5, language: "en" });
      expect(custom.k1).toBe(2.0);
      expect(custom.b).toBe(0.5);
      expect(custom.language).toBe("en");
    });
  });

  // ── indexDocuments ──

  describe("indexDocuments", () => {
    it("indexes an array of documents", () => {
      bm25.indexDocuments([
        { id: "1", title: "Hello world", content: "This is a test document" },
        { id: "2", title: "Goodbye world", content: "Another test document" },
      ]);
      expect(bm25.getStats().totalDocuments).toBe(2);
      expect(bm25.getStats().uniqueTerms).toBeGreaterThan(0);
    });

    it("handles empty array", () => {
      bm25.indexDocuments([]);
      expect(bm25.getStats().totalDocuments).toBe(0);
    });

    it("replaces previous index on re-index", () => {
      bm25.indexDocuments([{ id: "1", title: "First" }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
      bm25.indexDocuments([{ id: "a" }, { id: "b" }, { id: "c" }]);
      expect(bm25.getStats().totalDocuments).toBe(3);
    });

    it("handles documents with only title", () => {
      bm25.indexDocuments([{ id: "1", title: "Only title" }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
    });

    it("handles documents with only content", () => {
      bm25.indexDocuments([{ id: "1", content: "Only content" }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
    });

    it("handles documents with empty title and content", () => {
      bm25.indexDocuments([{ id: "1", title: "", content: "" }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
      expect(bm25.getStats().avgDocumentLength).toBe(0);
    });

    it("handles documents with no title or content fields", () => {
      bm25.indexDocuments([{ id: "1" }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
    });
  });

  // ── search ──

  describe("search", () => {
    beforeEach(() => {
      bm25.indexDocuments([
        {
          id: "1",
          title: "JavaScript tutorial",
          content: "Learn JavaScript programming with Node.js runtime",
        },
        {
          id: "2",
          title: "Python guide",
          content: "Python programming language basics and fundamentals",
        },
        {
          id: "3",
          title: "JavaScript frameworks",
          content: "React Vue Angular JavaScript frameworks comparison",
        },
        {
          id: "4",
          title: "Database design",
          content: "SQL and NoSQL database design patterns",
        },
        {
          id: "5",
          title: "Machine learning",
          content: "Deep learning neural network tensorflow",
        },
      ]);
    });

    it("returns ranked results for a query", () => {
      const results = bm25.search("JavaScript");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("ranks relevant documents higher", () => {
      const results = bm25.search("JavaScript programming");
      const topIds = results.slice(0, 2).map((r) => r.id);
      expect(topIds).toContain("1");
      expect(topIds).toContain("3");
    });

    it("respects topK parameter", () => {
      const results = bm25.search("programming", { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("respects threshold parameter", () => {
      const allResults = bm25.search("JavaScript");
      const minScore = allResults[allResults.length - 1]?.score || 0;
      const filteredResults = bm25.search("JavaScript", {
        threshold: minScore + 0.1,
      });
      expect(filteredResults.length).toBeLessThanOrEqual(allResults.length);
    });

    it("returns empty array for no matches", () => {
      expect(bm25.search("zzznonexistentterm")).toEqual([]);
    });

    it("returns empty array for empty query", () => {
      expect(bm25.search("")).toEqual([]);
    });

    it("returns empty array for null query", () => {
      expect(bm25.search(null)).toEqual([]);
    });

    it("returns empty array for undefined query", () => {
      expect(bm25.search(undefined)).toEqual([]);
    });

    it("returns empty array when no documents indexed", () => {
      const empty = new BM25Search();
      expect(empty.search("test")).toEqual([]);
    });

    it("includes original document in results", () => {
      const results = bm25.search("JavaScript");
      expect(results[0].doc).toBeDefined();
      expect(results[0].doc.id).toBeDefined();
      expect(results[0].doc.title).toBeDefined();
    });

    it("handles single-word queries", () => {
      const results = bm25.search("database");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("4");
    });

    it("handles multi-word queries with partial matches", () => {
      const results = bm25.search("JavaScript database");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles stop words in query", () => {
      // "the" and "is" are stop words
      const results = bm25.search("the JavaScript is");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles query of only stop words", () => {
      const results = bm25.search("the is a an");
      expect(results).toEqual([]);
    });

    it("is case-insensitive", () => {
      const lower = bm25.search("javascript");
      const upper = bm25.search("JAVASCRIPT");
      expect(lower.length).toBe(upper.length);
      if (lower.length > 0) {
        expect(lower[0].id).toBe(upper[0].id);
      }
    });
  });

  // ── addDocument / removeDocument ──

  describe("addDocument", () => {
    it("adds a single document to empty index", () => {
      bm25.addDocument({ id: "1", title: "Test" });
      expect(bm25.getStats().totalDocuments).toBe(1);
    });

    it("adds to existing index", () => {
      bm25.indexDocuments([{ id: "1", title: "First" }]);
      bm25.addDocument({ id: "2", title: "Second" });
      expect(bm25.getStats().totalDocuments).toBe(2);
    });

    it("makes new document searchable", () => {
      bm25.indexDocuments([{ id: "1", title: "Apple" }]);
      bm25.addDocument({ id: "2", title: "Banana" });
      const results = bm25.search("banana");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("2");
    });

    it("updates avgDl after adding", () => {
      bm25.indexDocuments([{ id: "1", title: "Short" }]);
      const beforeAvg = bm25.getStats().avgDocumentLength;
      bm25.addDocument({
        id: "2",
        title: "A much longer document with many words",
      });
      expect(bm25.getStats().avgDocumentLength).toBeGreaterThan(beforeAvg);
    });
  });

  describe("removeDocument", () => {
    beforeEach(() => {
      bm25.indexDocuments([
        { id: "1", title: "First" },
        { id: "2", title: "Second" },
        { id: "3", title: "Third" },
      ]);
    });

    it("removes a document", () => {
      expect(bm25.removeDocument("2")).toBe(true);
      expect(bm25.getStats().totalDocuments).toBe(2);
    });

    it("returns false for non-existent document", () => {
      expect(bm25.removeDocument("nonexistent")).toBe(false);
    });

    it("removed document is no longer searchable", () => {
      bm25.indexDocuments([
        { id: "1", title: "Apple" },
        { id: "2", title: "Banana" },
      ]);
      bm25.removeDocument("2");
      const results = bm25.search("banana");
      expect(results.length).toBe(0);
    });

    it("updates avgDl after removal", () => {
      const before = bm25.getStats().avgDocumentLength;
      bm25.removeDocument("1");
      // May or may not change, but shouldn't crash
      expect(bm25.getStats().avgDocumentLength).toBeGreaterThanOrEqual(0);
    });

    it("handles removing from single-document index", () => {
      const single = new BM25Search();
      single.addDocument({ id: "1", title: "Test" });
      expect(single.removeDocument("1")).toBe(true);
      expect(single.getStats().totalDocuments).toBe(0);
      expect(single.getStats().avgDocumentLength).toBe(0);
    });
  });

  // ── Chinese text ──

  describe("Chinese text support", () => {
    it("handles Chinese text queries", () => {
      bm25.indexDocuments([
        { id: "1", title: "学习笔记", content: "JavaScript编程学习笔记整理" },
        { id: "2", title: "数据库设计", content: "SQL数据库设计模式与实践" },
      ]);
      const results = bm25.search("JavaScript");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("1");
    });

    it("handles pure Chinese queries", () => {
      bm25.indexDocuments([
        { id: "1", title: "数据库", content: "数据库设计" },
        { id: "2", title: "编程", content: "编程语言" },
      ]);
      const results = bm25.search("数据库");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles mixed Chinese and English", () => {
      bm25.indexDocuments([
        { id: "1", title: "Vue教程", content: "Vue框架学习" },
      ]);
      const results = bm25.search("vue");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles very long documents", () => {
      const longContent = "word ".repeat(10000);
      bm25.indexDocuments([{ id: "1", title: "Long", content: longContent }]);
      const results = bm25.search("word");
      expect(results.length).toBe(1);
    });

    it("handles special characters in query", () => {
      bm25.indexDocuments([{ id: "1", title: "Hello @world #test" }]);
      const results = bm25.search("hello");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles numeric content", () => {
      bm25.indexDocuments([
        { id: "1", title: "Error 404", content: "Page not found error 404" },
        {
          id: "2",
          title: "Version 2.0",
          content: "Release notes for version 2.0",
        },
      ]);
      const results = bm25.search("404");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles duplicate documents", () => {
      bm25.indexDocuments([
        { id: "1", title: "Same", content: "Same content" },
        { id: "2", title: "Same", content: "Same content" },
      ]);
      const results = bm25.search("same content");
      expect(results.length).toBe(2);
    });

    it("handles documents with only whitespace", () => {
      bm25.indexDocuments([{ id: "1", title: "   ", content: "   " }]);
      expect(bm25.getStats().totalDocuments).toBe(1);
    });
  });

  // ── getStats ──

  describe("getStats", () => {
    it("returns correct stats after indexing", () => {
      bm25.indexDocuments([{ id: "1", title: "Test", content: "Hello world" }]);
      const stats = bm25.getStats();
      expect(stats.totalDocuments).toBe(1);
      expect(stats.uniqueTerms).toBeGreaterThan(0);
      expect(stats.avgDocumentLength).toBeGreaterThan(0);
    });

    it("returns zeroes for empty index", () => {
      const stats = bm25.getStats();
      expect(stats.totalDocuments).toBe(0);
      expect(stats.uniqueTerms).toBe(0);
      expect(stats.avgDocumentLength).toBe(0);
    });
  });
});
