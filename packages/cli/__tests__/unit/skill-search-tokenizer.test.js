import { describe, expect, it } from "vitest";
import { BM25Search } from "../../src/lib/bm25-search.js";
import { tokenizeSkillSearchText } from "../../src/lib/skill-search-tokenizer.js";

describe("Skill descriptor tokenization", () => {
  it("segments Chinese intent without unrelated single-character matches", () => {
    expect(tokenizeSkillSearchText("请帮我数据导出一下")).toEqual([
      "数据",
      "导出",
    ]);
    const index = new BM25Search({ tokenizer: tokenizeSkillSearchText });
    index.indexDocuments([{ id: "clock", content: "数字时钟" }]);
    expect(index.search("数据导出")).toEqual([]);
  });

  it("normalizes fullwidth text and keeps mixed-language query words", () => {
    expect(tokenizeSkillSearchText("修复Ｖｉｔｅｓｔ测试")).toEqual([
      "修复",
      "vitest",
      "测试",
    ]);
    expect(tokenizeSkillSearchText("ＣＡＦÉ résumé")).toEqual([
      "café",
      "résumé",
    ]);
  });

  it("splits camel, acronym, kebab and snake skill identifiers consistently", () => {
    expect(tokenizeSkillSearchText("repair-tests")).toEqual([
      "repair",
      "tests",
    ]);
    expect(tokenizeSkillSearchText("repairTests")).toEqual([
      "repair",
      "tests",
      "repairtests",
    ]);
    expect(tokenizeSkillSearchText("repair_tests")).toEqual([
      "repair",
      "tests",
      "repair_tests",
    ]);
    expect(tokenizeSkillSearchText("parseHTTPResponse")).toEqual([
      "parse",
      "http",
      "response",
      "parsehttpresponse",
    ]);
  });

  it("retains meaningful single-character words and returns no conversational filler", () => {
    expect(tokenizeSkillSearchText("C R Go")).toEqual(["c", "r", "go"]);
    expect(tokenizeSkillSearchText("请问帮我一下 please help me")).toEqual([]);
    expect(tokenizeSkillSearchText(null)).toEqual([]);
  });

  it("uses the domain tokenizer for indexing, adding, searching and removal", () => {
    const index = new BM25Search({ tokenizer: tokenizeSkillSearchText });
    index.indexDocuments([{ id: "repair", title: "repairTests" }]);
    index.addDocument({ id: "parse", title: "parseHTTPResponse" });
    expect(index.search("repair tests").map(({ id }) => id)).toEqual([
      "repair",
    ]);
    expect(index.search("repairtests").map(({ id }) => id)).toEqual(["repair"]);
    expect(index.search("parse http response").map(({ id }) => id)).toEqual([
      "parse",
    ]);
    expect(index.removeDocument("repair")).toBe(true);
    expect(index.search("repair tests")).toEqual([]);
    expect(index.search("parse http response")).toHaveLength(1);
  });
});
