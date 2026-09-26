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
      provider: "typesafe",
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
    expect(
      resolveHeadlessSkillDecisionOptions({ decisionProvider: "laya" }),
    ).toMatchObject({
      provider: "laya",
      model: "laya",
      baseUrl: "http://127.0.0.1:8000",
    });
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

  it("keeps an unmetered model answer out of suggest-mode routing", async () => {
    const harness = makeHarness({ mode: "suggest" });
    const valid = await provider().decide();
    harness.deps.decisionProvider = provider(async () => ({
      ...valid,
      usage: undefined,
    }));

    const outcome = await runAgentHeadless(harness.options, harness.deps);

    expect(outcome).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.result).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown",
      selectedDigest: null,
    });
    expect(harness.events.map(({ type }) => type)).toContain(
      "model_usage_unknown",
    );
    expect(harness.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill_decision_observation",
          data: expect.objectContaining({
            status: "unavailable",
            selectedDigest: null,
          }),
        }),
      ]),
    );
    expect(harness.events.some(({ type }) => type === "token_usage")).toBe(
      false,
    );
  });

  it("blocks another paid decision when resuming a session with unknown decision usage", async () => {
    const harness = makeHarness({ mode: "suggest" });
    const valid = await provider().decide();
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ...valid, usage: undefined })
      .mockResolvedValue(valid);
    harness.deps.decisionProvider = provider(decide);

    const first = await runAgentHeadless(harness.options, harness.deps);
    expect(first).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.result.reasonCode).toBe("provider-usage-unknown");

    const second = await runAgentHeadless(harness.options, harness.deps);
    expect(second).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.result).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
      selectedDigest: null,
    });
    expect(decide).toHaveBeenCalledOnce();
    expect(
      harness.events.filter(({ type }) => type === "model_usage_started"),
    ).toHaveLength(1);
    expect(
      harness.events.filter(
        ({ type }) => type === "skill_decision_observation",
      ),
    ).toHaveLength(2);
  });

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

  it.each(["shadow", "suggest"])(
    "runs local Laya in %s mode without sending the TypeSafe key",
    async (mode) => {
      const harness = makeHarness({ mode });
      delete harness.deps.decisionProvider;
      harness.options.decisionProvider = "laya";
      const response = await provider().decide();
      harness.deps.decisionFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...response,
          model: "laya",
          usage: { input_tokens: 12, output_tokens: 0 },
        }),
      }));
      vi.stubEnv("TYPESAFE_API_KEY", "cloud-secret-must-not-leak");
      vi.stubEnv("DECISION_API_KEY", "");
      try {
        const outcome = await runAgentHeadless(harness.options, harness.deps);
        expect(outcome).toMatchObject({ exitCode: 0, isError: false });
        expect(harness.observed.result).toMatchObject({
          status: "suggestion",
          visible: mode === "suggest",
          selectedSkillId: "repair-tests",
        });
        expect(harness.deps.decisionFetch).toHaveBeenCalledExactlyOnceWith(
          "http://127.0.0.1:8000/v1/systemone",
          expect.objectContaining({
            method: "POST",
            headers: { "content-type": "application/json" },
          }),
        );
        expect(harness.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "token_usage",
              data: expect.objectContaining({
                provider: "laya",
                model: "laya",
                usage: expect.objectContaining({ output_tokens: 0 }),
              }),
            }),
            expect.objectContaining({
              type: "skill_decision_observation",
              data: expect.objectContaining({ provider: "laya", mode }),
            }),
          ]),
        );
        expect(JSON.stringify(harness.events)).not.toContain(
          "cloud-secret-must-not-leak",
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("uses a separate optional credential for a compatible decision service", async () => {
    const harness = makeHarness({ mode: "shadow" });
    delete harness.deps.decisionProvider;
    Object.assign(harness.options, {
      decisionProvider: "system-one",
      decisionBaseUrl: "https://decisions.example.test/v1",
      decisionModel: "local-checkpoint",
    });
    const response = await provider().decide();
    harness.deps.decisionFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...response, model: "local-checkpoint" }),
    }));
    vi.stubEnv("TYPESAFE_API_KEY", "unrelated-secret");
    vi.stubEnv("DECISION_API_KEY", "service-secret");
    try {
      const outcome = await runAgentHeadless(harness.options, harness.deps);
      expect(outcome).toMatchObject({ exitCode: 0, isError: false });
      expect(harness.deps.decisionFetch).toHaveBeenCalledExactlyOnceWith(
        "https://decisions.example.test/v1/systemone",
        expect.objectContaining({
          headers: {
            "content-type": "application/json",
            authorization: "Bearer service-secret",
          },
        }),
      );
      expect(harness.events).toContainEqual(
        expect.objectContaining({
          type: "skill_decision_observation",
          data: expect.objectContaining({ provider: "system-one" }),
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps an unavailable local decision service local and preserves the run", async () => {
    const harness = makeHarness({ mode: "suggest" });
    delete harness.deps.decisionProvider;
    harness.options.decisionProvider = "laya";
    harness.deps.decisionFetch = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const outcome = await runAgentHeadless(harness.options, harness.deps);
    expect(outcome).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.result).toMatchObject({
      status: "unavailable",
      selectedSkillId: null,
    });
    expect(harness.deps.decisionFetch).toHaveBeenCalledTimes(1);
    expect(harness.deps.decisionFetch.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/v1/systemone",
    );
  });

  it("rejects invalid local answers through the existing candidate contract", async () => {
    const harness = makeHarness({ mode: "suggest" });
    delete harness.deps.decisionProvider;
    harness.options.decisionProvider = "laya";
    const response = await provider().decide();
    response.answers.best_skill.choice = "unadmitted-skill";
    harness.deps.decisionFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...response, model: "laya" }),
    }));
    const outcome = await runAgentHeadless(harness.options, harness.deps);
    expect(outcome).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.observed.result).toMatchObject({
      status: "unavailable",
      selectedSkillId: null,
    });
  });

  it("keeps local off mode free of decision requests", async () => {
    const harness = makeHarness();
    delete harness.deps.decisionProvider;
    harness.options.decisionProvider = "laya";
    harness.deps.decisionFetch = vi.fn();
    const outcome = await runAgentHeadless(harness.options, harness.deps);
    expect(outcome).toMatchObject({ exitCode: 0, isError: false });
    expect(harness.deps.decisionFetch).not.toHaveBeenCalled();
    expect(harness.observed.runtime).toBeUndefined();
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
