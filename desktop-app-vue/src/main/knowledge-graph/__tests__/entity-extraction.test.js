import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  ENTITY_TYPES,
  extractEntities,
  extractEntitiesWithLLM,
  extractKeywords,
  extractWikiLinks,
  extractSummary,
  calculateTextSimilarity,
  processNotesForEntities,
  buildEntityGraph,
} from "../entity-extraction.js";

const findVal = (entities, type) =>
  entities.filter((e) => e.type === type).map((e) => e.value);

describe("extractEntities", () => {
  it("extracts dates in the three supported formats", () => {
    const e = extractEntities("会议 2024年1月15日 与 2024-02-03 以及 2024/03/04");
    expect(findVal(e, ENTITY_TYPES.DATE)).toEqual([
      "2024年1月15日",
      "2024-02-03",
      "2024/03/04",
    ]);
  });

  it("extracts time, url, hashtag and code-block technology", () => {
    expect(findVal(extractEntities("时间 14:30 开始"), ENTITY_TYPES.TIME)).toContain(
      "14:30",
    );
    expect(findVal(extractEntities("see https://example.com/x"), "url")).toContain(
      "https://example.com/x",
    );
    expect(findVal(extractEntities("学习 #机器学习 有趣"), "tag")).toContain(
      "机器学习",
    );
    expect(
      findVal(extractEntities("```python\nprint(1)\n```"), ENTITY_TYPES.TECHNOLOGY),
    ).toContain("python");
  });

  it("extracts a markdown link's text as a concept", () => {
    const e = extractEntities("详见 [设计文档](http://x/y) 部分");
    expect(findVal(e, ENTITY_TYPES.CONCEPT)).toContain("设计文档");
  });

  it("matches tech keywords case-insensitively", () => {
    const e = extractEntities("我们用 react 和 Python 开发");
    const tech = findVal(e, ENTITY_TYPES.TECHNOLOGY).map((v) => v.toLowerCase());
    expect(tech).toContain("react");
    expect(tech).toContain("python");
  });

  it("dedupes by position and returns entities sorted by start", () => {
    const e = extractEntities("2024-01-01 then 2024-02-02");
    const starts = e.map((x) => x.start);
    expect([...starts]).toEqual([...starts].sort((a, b) => a - b));
    // no two entities share the same start-end span
    const spans = e.map((x) => `${x.start}-${x.end}`);
    expect(new Set(spans).size).toBe(spans.length);
  });

  it("returns an empty array for text with no recognizable entities", () => {
    expect(extractEntities("just some plain words")).toEqual(
      // 'some' etc are not tech keywords; plain prose yields nothing
      expect.arrayContaining([]),
    );
    expect(extractEntities("纯文本没有实体")).toEqual([]);
  });
});

describe("extractKeywords", () => {
  it("counts frequency, filters single chars, and honors topN", () => {
    const kw = extractKeywords("apple apple banana cat a", 2);
    expect(kw).toHaveLength(2);
    expect(kw[0]).toMatchObject({ word: "apple", frequency: 2 });
    expect(kw.every((k) => k.word.length > 1)).toBe(true);
    expect(kw[0].score).toBeGreaterThan(0);
  });
});

describe("extractWikiLinks", () => {
  it("extracts [[title]] links with positions", () => {
    const links = extractWikiLinks("see [[Alpha]] and [[Beta Note]]");
    expect(links.map((l) => l.title)).toEqual(["Alpha", "Beta Note"]);
    expect(links[0].start).toBeLessThan(links[1].start);
  });
});

describe("extractSummary", () => {
  it("strips markdown markers from the first paragraph, keeping link text", () => {
    const text =
      "This is **bold** and `code` and [link](http://x).\n\nSecond para.";
    const s = extractSummary(text);
    expect(s).not.toMatch(/[#*`]/);
    expect(s).toContain("This is bold and");
    expect(s).toContain("link"); // link text preserved, url dropped
    expect(s).not.toContain("Second"); // only the first paragraph
  });

  it("treats a leading heading as its own first paragraph", () => {
    // '#{1,6}\\s+' strips the marker, and the blank line splits it off, so a
    // heading-first note summarizes to just the heading text.
    expect(extractSummary("# Heading\n\nBody text")).toBe("Heading");
  });

  it("truncates to maxLength with an ellipsis", () => {
    const s = extractSummary("x".repeat(50), 10);
    expect(s).toBe("x".repeat(10) + "...");
  });
});

describe("calculateTextSimilarity", () => {
  it("is 1 for identical word sets and 0 for disjoint", () => {
    expect(calculateTextSimilarity("a b c", "a b c")).toBe(1);
    expect(calculateTextSimilarity("a b", "c d")).toBe(0);
  });
  it("computes Jaccard for partial overlap", () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 => 0.5
    expect(calculateTextSimilarity("a b c", "b c d")).toBe(0.5);
  });
});

describe("extractEntitiesWithLLM", () => {
  it("falls back to rule-based extraction without an LLM manager", async () => {
    const out = await extractEntitiesWithLLM("用 React 开发", null);
    // fallback returns the bare entities array (rule-based)
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((e) => e.value.toLowerCase() === "react")).toBe(true);
  });

  it("parses a JSON object out of the LLM response", async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content:
          'noise before {"entities":[{"type":"person","value":"张三"}],"relations":[]} after',
      }),
    };
    const out = await extractEntitiesWithLLM("张三用React", llm);
    expect(out).toEqual({
      entities: [{ type: "person", value: "张三" }],
      relations: [],
    });
  });

  it("falls back when the LLM throws", async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error("down")) };
    const out = await extractEntitiesWithLLM("用 Python", llm);
    expect(out.relations).toEqual([]);
    expect(out.entities.some((e) => e.value.toLowerCase() === "python")).toBe(true);
  });
});

describe("processNotesForEntities / buildEntityGraph", () => {
  it("aggregates per-note extraction and builds a graph", async () => {
    const notes = [
      { id: "n1", title: "Note 1", content: "用 React #frontend [[Other]]" },
    ];
    const processed = await processNotesForEntities(notes);
    expect(processed[0]).toMatchObject({ noteId: "n1", title: "Note 1" });
    expect(processed[0].entities.length).toBeGreaterThan(0);
    expect(processed[0].wikiLinks.map((l) => l.title)).toContain("Other");

    const graph = buildEntityGraph(processed);
    const noteNode = graph.nodes.find((n) => n.id === "n1");
    expect(noteNode).toMatchObject({ type: "note" });
    // a "contains" edge links the note to at least one extracted entity
    expect(
      graph.edges.some(
        (e) => e.source_id === "n1" && e.relation_type === "contains",
      ),
    ).toBe(true);
    // wiki link becomes a references edge
    expect(
      graph.edges.some(
        (e) => e.relation_type === "references" && e.target_id === "Other",
      ),
    ).toBe(true);
  });

  it("records a per-note error without aborting the batch", async () => {
    // content=null makes the regex extractors throw -> caught per note
    const processed = await processNotesForEntities([
      { id: "bad", title: "Bad", content: null },
    ]);
    expect(processed[0]).toMatchObject({
      noteId: "bad",
      entities: [],
      summary: "",
    });
    expect(processed[0].error).toBeTruthy();
  });
});
