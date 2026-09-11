"use strict";

import { describe, expect, it } from "vitest";

const { AnalysisEngine } = require("../lib/analysis");
const { MODEL_EGRESS_INGRESS_FAILED } = require("../lib/model-egress-guard");

describe("AnalysisEngine model egress governance", () => {
  it("rejects before an injected model receives gathered personal-data context", async () => {
    let calls = 0;
    const engine = new AnalysisEngine({
      vault: {
        queryEvents: () => [],
        queryPersons: () => [],
        queryItems: () => [],
        audit: () => {},
      },
      llm: {
        isLocal: true,
        chat: async () => {
          calls += 1;
          return { text: "should not be reached" };
        },
      },
    });

    await expect(engine.ask("summarize my private records"))
      .rejects.toMatchObject({ code: MODEL_EGRESS_INGRESS_FAILED });
    expect(calls).toBe(0);
  });
});
