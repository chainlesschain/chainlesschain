import { describe, expect, it } from "vitest";
const { AnalysisSkill } = require("../lib/analysis-skills/base");
const { MODEL_EGRESS_INGRESS_FAILED } = require("../lib/model-egress-guard");

describe("analysis skill model failures", () => {
  it("rejects before an injected model receives commentary input", async () => {
    let calls = 0;
    const skill = new AnalysisSkill({
      vault: {},
      llm: {
        isLocal: true,
        chat: async () => {
          calls += 1;
          return { text: "commentary" };
        },
      },
    });

    await expect(skill.callLlmCommentary([{ role: "user", content: "Summarize private data" }]))
      .rejects.toMatchObject({ code: MODEL_EGRESS_INGRESS_FAILED });
    expect(calls).toBe(0);
  });
});
