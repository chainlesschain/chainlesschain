import { describe, it, expect } from "vitest";
import CoworkLLMIntegration from "../llm-integration.js";

/**
 * CoworkLLMIntegration 的 5 个 _parse* 方法此前零覆盖，且都用贪婪 /\{[\s\S]*\}/ 抽 JSON
 * （首 { 到末 }），LLM 在 JSON 后追加带 } 的散文时会过度捕获 → 解析失败 → 回退默认值。
 * 现统一改走 response-parser 的 looseParseJSON（括号配对抽取）。llmService 不参与解析，
 * 构造时传 null 即可直测私有方法。
 */
describe("CoworkLLMIntegration JSON parsing via looseParseJSON", () => {
  const llm = new CoworkLLMIntegration(null);

  it("_parseTaskAnalysis parses a clean JSON response", () => {
    const r = llm._parseTaskAnalysis(
      '{"complexity": 8, "recommendedAgents": 3}',
    );
    expect(r.complexity).toBe(8);
    expect(r.recommendedAgents).toBe(3);
  });

  it("_parseTaskAnalysis extracts JSON despite trailing prose with a brace (regression)", () => {
    // 旧贪婪正则会吃到散文里的 } → JSON.parse 抛错 → 回退 _fallbackTaskAnalysis。
    const r = llm._parseTaskAnalysis('{"complexity": 8} note: keep } safe');
    expect(r.complexity).toBe(8);
  });

  it("_parseSubtasks maps a subtasks array", () => {
    const r = llm._parseSubtasks(
      '{"subtasks": [{"description": "a"}, {"description": "b"}]}',
      { id: "p1" },
    );
    expect(r).toHaveLength(2);
    expect(r[0].description).toBe("a");
    expect(r[0].parentTaskId).toBe("p1");
    expect(r[0].order).toBe(1);
  });

  it("_parseStrategy returns the parsed object", () => {
    expect(llm._parseStrategy('{"approach": "parallel"}')).toEqual({
      approach: "parallel",
    });
  });

  it("_parseConflictResolution falls back on a non-JSON response", () => {
    expect(llm._parseConflictResolution("no json at all")).toEqual({
      decision: "Unable to resolve",
      confidence: 0,
    });
  });
});
