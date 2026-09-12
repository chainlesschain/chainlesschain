"use strict";

import { describe, expect, it } from "vitest";

const { AnalysisEngine } = require("../lib/analysis");
const {
  MODEL_EGRESS_INGRESS_FAILED,
  createAuthenticatedEvolutionModelClient,
} = require("../lib/model-egress-guard");

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

  it("admits only the frozen prepare-transport-complete client lifecycle", async () => {
    const order = [];
    const capabilities = {
      getName: () => "governed-test",
      getIsLocal: () => true,
      prepare: async (messages) => {
        order.push("prepare");
        return {
          messages,
          complete: async () => order.push("complete"),
        };
      },
      transport: async () => {
        order.push("transport");
        return { text: "safe answer", usage: {} };
      },
    };
    const llm = createAuthenticatedEvolutionModelClient(capabilities);
    capabilities.transport = async () => {
      throw new Error("mutated transport must not run");
    };
    const engine = new AnalysisEngine({
      vault: {
        queryEvents: () => [],
        queryPersons: () => [],
        queryItems: () => [],
        audit: () => {},
      },
      llm,
    });

    await expect(engine.ask("summarize my private records")).resolves.toMatchObject({
      answer: "safe answer",
      model: "governed-test",
    });
    expect(Object.isFrozen(llm)).toBe(true);
    expect(order).toEqual(["prepare", "transport", "complete"]);
  });
});
