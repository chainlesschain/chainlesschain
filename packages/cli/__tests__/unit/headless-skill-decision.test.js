import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import {
  RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
  resolveHeadlessSkillDecisionOptions,
  runAgentHeadless,
} from "../../src/runtime/headless-runner.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function provider(decide = null) {
  return openDecisionProviderAuthority({
    provider: "typesafe",
    model: "jev-test",
    decide:
      decide ||
      (async () => ({
        provider: "typesafe",
        model: "jev-test",
        answers: {
          needs_skill: { type: "noul", noul: 0.95 },
          best_skill: {
            type: "choice",
            choice: "c1",
            confidence: 0.9,
            probabilities: { c1: 0.96, none: 0.04 },
          },
          fits_c1: { type: "noul", noul: 0.94 },
        },
        usage: { input_tokens: 12, output_tokens: 4 },
      })),
  });
}

function makeHarness({ mode = "off", appendEvent = null } = {}) {
  const events = [];
  const observed = {};
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => ({
      setSessionPolicy: () => {},
      setConfirmer: () => {},
      decide: async () => ({ decision: "allow" }),
    }),
    writeOut: () => {},
    writeErr: () => {},
    sessionExists: () => false,
    rebuildMessages: () => [],
    startSession: () => true,
    appendUserMessage: () => true,
    appendAssistantMessage: () => true,
    appendTokenUsage: () => true,
    appendToolCallCompact: () => true,
    appendLlmRetryCompact: () => true,
    appendCompactEvent: () => true,
    readEvents: () => events,
    appendEvent:
      appendEvent ||
      ((sessionId, type, data) => {
        events.push({ sessionId, type, data });
        return true;
      }),
    appendAuthorityEvent: (sessionId, type, data) => {
      events.push({ sessionId, type, data });
      return true;
    },
    decisionProvider: provider(),
    agentLoop: vi.fn(async function* (_messages, options) {
      observed.runtime = options.skillDecisionRuntime;
      if (options.skillDecisionRuntime) {
        observed.result = await options.skillDecisionRuntime.suggest({
          query: "repair the unit tests",
          candidates: [
            {
              id: "repair-tests",
              displayName: "Repair tests",
              description: "Repair failing unit tests",
              category: "development",
              digest: digest("repair-tests"),
              tags: ["tests"],
            },
          ],
          turnId: "turn-1",
        });
      }
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    }),
  };
  return {
    deps,
    events,
    observed,
    options: {
      prompt: "test decision routing",
      resume: "decision-session",
      decisionMode: mode,
      hermeticExecution: true,
    },
  };
}

describe("headless Skill decision wiring", () => {
  it("normalizes CLI decision options and rejects invalid values", () => {
    expect(resolveHeadlessSkillDecisionOptions()).toEqual({
      mode: "off",
      model: "jev-latest",
      baseUrl: "https://api.typesafe.ai",
      timeoutMs: 800,
    });
    expect(
      resolveHeadlessSkillDecisionOptions({
        decisionMode: "shadow",
        decisionTimeoutMs: "1200",
      }),
    ).toMatchObject({ mode: "shadow", timeoutMs: 1200 });
    expect(() =>
      resolveHeadlessSkillDecisionOptions({ decisionMode: "execute" }),
    ).toThrow("Invalid --decision-mode");
    expect(() =>
      resolveHeadlessSkillDecisionOptions({ decisionTimeoutMs: 20 }),
    ).toThrow("Invalid --decision-timeout-ms");
  });

  it("keeps the default off mode provider-free", async () => {
    const harness = makeHarness();

    const outcome = await runAgentHeadless(harness.options, harness.deps);

    expect(outcome).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.runtime).toBeUndefined();
    expect(
      harness.events.some(({ type }) =>
        [
          "model_usage_started",
          "model_usage_unknown",
          "skill_decision_observation",
        ].includes(type),
      ),
    ).toBe(false);
  });

  it.each([
    ["shadow", false],
    ["suggest", true],
  ])(
    "wires %s mode through the durable session ledger",
    async (mode, visible) => {
      const harness = makeHarness({ mode });

      const outcome = await runAgentHeadless(harness.options, harness.deps);

      expect(outcome).toMatchObject({ exitCode: 0, isError: false });
      expect(harness.observed.result).toMatchObject({
        mode,
        visible,
        status: "suggestion",
        selectedSkillId: "repair-tests",
      });
      expect(harness.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "model_usage_started",
            data: expect.objectContaining({
              provider: "typesafe",
              model: "jev-test",
              operationId: expect.stringMatching(/^decision:skill-/u),
            }),
          }),
          expect.objectContaining({
            type: "token_usage",
            data: expect.objectContaining({
              usage: expect.objectContaining({
                input_tokens: 12,
                output_tokens: 4,
              }),
            }),
          }),
          expect.objectContaining({
            type: "skill_decision_observation",
            data: expect.objectContaining({
              mode,
              status: "suggestion",
              selectedDigest: digest("repair-tests"),
            }),
          }),
        ]),
      );
    },
  );

  it("rejects enabled decisions without durable persistence", async () => {
    const harness = makeHarness({ mode: "shadow" });

    await expect(
      runAgentHeadless(
        {
          ...harness.options,
          resume: undefined,
          ephemeral: true,
        },
        harness.deps,
      ),
    ).rejects.toThrow("requires a durable session");
    expect(harness.deps.agentLoop).not.toHaveBeenCalled();
  });

  it("requires the TypeSafe secret before starting a durable run", async () => {
    const harness = makeHarness({ mode: "shadow" });
    delete harness.deps.decisionProvider;
    vi.stubEnv("TYPESAFE_API_KEY", "");

    try {
      await expect(
        runAgentHeadless(harness.options, harness.deps),
      ).rejects.toThrow("TYPESAFE_API_KEY is required");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(harness.deps.agentLoop).not.toHaveBeenCalled();
  });

  it("fails the run when decision usage cannot establish its ledger boundary", async () => {
    const harness = makeHarness({
      mode: "suggest",
      appendEvent: (_sessionId, type) => {
        if (type === "model_usage_started") {
          throw new Error("ledger unavailable");
        }
        return true;
      },
    });

    const outcome = await runAgentHeadless(harness.options, harness.deps);

    expect(outcome).toEqual({
      exitCode: 1,
      result: RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
      isError: true,
    });
  });
});
