import { describe, expect, it } from "vitest";
const { AnalysisSkill } = require("../lib/analysis-skills/base");

describe("analysis skill model failures", () => {
  it.each([true, false])("preserves Desktop governance rejection (governed=%s)", async (governed) => {
    const error = new Error("model request failed");
    if (governed) error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    const skill = new AnalysisSkill({ vault: {}, llm: { isLocal: true, chat: async () => { throw error; } } });
    const result = skill.callLlmCommentary([{ role: "user", content: "Summarize" }]);
    if (governed) await expect(result).rejects.toBe(error);
    else await expect(result).resolves.toBeNull();
  });
});
