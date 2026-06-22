import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import semanticChunker from "../semantic-chunker.js";
const { SemanticChunker, DEFAULT_CONFIG } = semanticChunker;

// Small, deterministic thresholds so test inputs stay readable.
const cfg = {
  targetChunkSize: 40,
  maxChunkSize: 80,
  minChunkSize: 10,
  overlapSize: 5,
};
const mk = (extra = {}) => new SemanticChunker({ ...cfg, ...extra });

describe("SemanticChunker", () => {
  describe("config", () => {
    it("merges overrides onto DEFAULT_CONFIG", () => {
      const c = new SemanticChunker({ targetChunkSize: 123 });
      expect(c.config.targetChunkSize).toBe(123);
      expect(c.config.maxChunkSize).toBe(DEFAULT_CONFIG.maxChunkSize);
    });

    it("updateConfig mutates live config", () => {
      const c = mk();
      c.updateConfig({ minChunkSize: 999 });
      expect(c.config.minChunkSize).toBe(999);
      expect(c.config.targetChunkSize).toBe(40); // others preserved
    });
  });

  describe("chunk — empty / short inputs", () => {
    it("returns [] for empty or whitespace-only text", () => {
      expect(mk().chunk("")).toEqual([]);
      expect(mk().chunk("   \n\t ")).toEqual([]);
      expect(mk().chunk(null)).toEqual([]);
    });

    it("emits one fallback chunk for a short non-empty plain doc (no data loss)", () => {
      // A sub-minChunkSize plain doc must still produce a single retrievable
      // chunk rather than being filtered out entirely (regression: short notes
      // used to vanish from the semantic index).
      const out = mk({ minChunkSize: 50 }).chunk("a short note", { id: "d" });
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("d_chunk_0");
      expect(out[0].content).toBe("a short note");
      expect(out[0].metadata.totalChunks).toBe(1);
      expect(out[0].metadata.charCount).toBe("a short note".length);
    });

    it("emits a fallback chunk when every markdown section is too short", () => {
      const out = mk({ minChunkSize: 500 }).chunk("# Tiny\nshort body", { id: "m" });
      expect(out).toHaveLength(1);
      expect(out[0].content).toBe("# Tiny\nshort body");
    });
  });

  describe("chunk — plain text", () => {
    const text =
      "First sentence here. Second sentence follows. Third one is longer than the rest of them. " +
      "Fourth sentence. Fifth sentence ends the paragraph completely.";

    it("produces multiple chunks with structured ids + metadata", () => {
      const out = mk().chunk(text, { id: "doc1", source: "test" });
      expect(out.length).toBeGreaterThan(1);
      out.forEach((c, i) => {
        expect(c.id).toBe(`doc1_chunk_${i}`);
        expect(c.content).toBeTruthy();
        expect(c.metadata.chunkIndex).toBe(i);
        expect(c.metadata.totalChunks).toBe(out.length);
        expect(c.metadata.charCount).toBe(c.content.length);
        expect(typeof c.metadata.wordCount).toBe("number");
        expect(c.metadata.source).toBe("test"); // caller metadata preserved
      });
    });

    it("prepends overlap from the previous chunk (non-markdown path)", () => {
      const out = mk().chunk(text, { id: "doc1" });
      // First chunk has no overlap; later chunks carry a "..." overlap marker.
      expect(out[0].content).not.toContain("...");
      expect(out.slice(1).some((c) => c.content.includes("..."))).toBe(true);
    });

    it("force-splits a long run with no separators", () => {
      const blob = "x".repeat(130); // > targetChunkSize, no separators
      const out = mk().chunk(blob, { id: "blob" });
      expect(out.length).toBeGreaterThan(1);
      // each emitted chunk stays within a reasonable bound of targetChunkSize
      out.forEach((c) =>
        expect(c.content.replace(/\.\.\./g, "").length).toBeLessThanOrEqual(
          cfg.targetChunkSize + cfg.overlapSize,
        ),
      );
    });
  });

  describe("chunk — markdown", () => {
    const md =
      "Intro paragraph before any heading that is long enough to keep.\n" +
      "## Section One\nContent of the first section that is sufficiently long.\n" +
      "## Section Two\nContent of the second section, also long enough to keep.";

    it("splits by headings and tags section title/level", () => {
      const out = mk().chunk(md, { id: "mdoc" });
      const titles = out.map((c) => c.metadata.sectionTitle);
      expect(titles).toContain("Section One");
      expect(titles).toContain("Section Two");
      // Pre-heading content is labelled 前言.
      expect(titles).toContain("前言");
      out.forEach((c) => expect(c.metadata.totalChunks).toBe(out.length));
    });

    it("_isMarkdown routes heading/list text through the markdown path", () => {
      // A list-only doc is detected as markdown (no '...' overlap markers added).
      const list = "- item one is long enough\n- item two is also long enough\n- third";
      const out = mk().chunk(list, { id: "l" });
      expect(out.every((c) => !c.content.includes("..."))).toBe(true);
    });
  });

  describe("chunkDocuments", () => {
    it("flattens chunks across documents and stamps sourceDocument", () => {
      const docs = [
        { id: "a", content: "Alpha content long enough to survive the filter." },
        { id: "b", content: "Beta content also long enough to survive the cut." },
      ];
      const out = mk().chunkDocuments(docs);
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.every((c) => ["a", "b"].includes(c.metadata.sourceDocument))).toBe(true);
    });
  });

  describe("word counting (via metadata)", () => {
    it("counts Chinese characters + English words", () => {
      // 4 chinese chars + 3 english words, padded so it survives minChunkSize.
      const c = mk({ minChunkSize: 1, overlapSize: 0 });
      const out = c.chunk("你好世界 hello brave world", { id: "w" });
      expect(out).toHaveLength(1);
      expect(out[0].metadata.wordCount).toBe(7);
    });
  });
});
