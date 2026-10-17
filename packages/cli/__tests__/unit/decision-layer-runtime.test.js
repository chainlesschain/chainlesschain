import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import {
  captureSkillDecisionRuntime,
  createSkillDecisionRuntime,
} from "../../src/lib/decision-layer/runtime.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function candidates() {
  return [
    {
      id: "repair-tests",
      displayName: "Repair tests",
      description: "Repair failing tests",
      category: "development",
      digest: D("repair-tests"),
      tags: ["tests"],
    },
  ];
}

function successfulProvider(decide = null) {
  return openDecisionProviderAuthority({
    provider: "typesafe",
    model: "jev-test",
    decide:
      decide ||
      (async () => ({
        provider: "typesafe",
        model: "jev-test",
        answers: {
          needs_skill: { type: "noul", noul: 0.9 },
          best_skill: {
            type: "choice",
            choice: "c1",
            confidence: 0.9,
            probabilities: { c1: 0.95, none: 0.05 },
          },
          fits_c1: { type: "noul", noul: 0.91 },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      })),
  });
}

function runtimeOptions(overrides = {}) {
  return {
    mode: "suggest",
    tenantId: "tenant-a",
    sessionId: "session-a",
    provider: successfulProvider(),
    persist: vi.fn(async () => {}),
    observe: vi.fn(async () => {}),
    idGenerator: () => "decision-1",
    now: (() => {
      let time = Date.parse("2026-09-22T00:00:00.000Z");
      return () => new Date((time += 5));
    })(),
    ...overrides,
  };
}

describe("Skill decision runtime", () => {
  it("keeps off mode provider-free and side-effect free", async () => {
    const runtime = createSkillDecisionRuntime({ mode: "off" });
    expect(captureSkillDecisionRuntime(runtime)).toBe(runtime);
    await expect(runtime.suggest()).resolves.toMatchObject({
      status: "disabled",
      visible: false,
    });
  });

  it("meters, observes and exposes a suggest-mode decision", async () => {
    const options = runtimeOptions();
    const runtime = createSkillDecisionRuntime(options);
    const result = await runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });

    expect(result).toMatchObject({
      status: "suggestion",
      visible: true,
      selectedSkillId: "repair-tests",
      selectedDigest: D("repair-tests"),
    });
    expect(options.persist).toHaveBeenCalledTimes(2);
    expect(options.persist.mock.calls[0][0]).toContain("started");
    expect(options.persist.mock.calls[1][0]).toBe("token_usage");
    expect(options.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "suggestion",
        selectedDigest: D("repair-tests"),
      }),
    );
  });

  it("keeps shadow results out of the Agent-visible surface", async () => {
    const options = runtimeOptions({ mode: "shadow" });
    const runtime = createSkillDecisionRuntime(options);
    const result = await runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    expect(result).toMatchObject({ status: "suggestion", visible: false });
    expect(options.observe).toHaveBeenCalledOnce();
  });

  it("falls back on an ordinary provider failure after settling unknown usage", async () => {
    const options = runtimeOptions({
      provider: successfulProvider(async () => {
        throw new Error("network unavailable");
      }),
    });
    const runtime = createSkillDecisionRuntime(options);
    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "provider-unavailable",
      visible: true,
    });
    expect(options.persist).toHaveBeenCalledTimes(2);
    expect(options.observe).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["malformed", { input_tokens: "10", output_tokens: 3 }],
  ])("does not expose a valid answer with %s usage", async (_label, usage) => {
    const valid = await successfulProvider().decide();
    const options = runtimeOptions({
      provider: successfulProvider(async () => ({ ...valid, usage })),
    });
    const result = await createSkillDecisionRuntime(options).suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown",
      selectedDigest: null,
      selectedSkillId: null,
      resultDigest: null,
    });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(options.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unavailable",
        reasonCode: "provider-usage-unknown",
        selectedDigest: null,
      }),
    );
  });

  it.each(["missing-usage", "provider-failure"])(
    "blocks a second provider call after %s was durably unknown",
    async (firstOutcome) => {
      const valid = await successfulProvider().decide();
      const decide = vi.fn(async () => {
        if (firstOutcome === "provider-failure") {
          throw new Error("provider unavailable");
        }
        return { ...valid, usage: undefined };
      });
      let sequence = 0;
      const options = runtimeOptions({
        provider: successfulProvider(decide),
        idGenerator: () => `decision-${++sequence}`,
      });
      const runtime = createSkillDecisionRuntime(options);
      const first = await runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
      });
      const second = await runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-b",
      });

      expect(first.status).toBe("unavailable");
      expect(second).toMatchObject({
        status: "unavailable",
        reasonCode: "provider-usage-unknown-blocked",
        selectedDigest: null,
      });
      expect(decide).toHaveBeenCalledOnce();
      expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
        "model_usage_started",
        "model_usage_unknown",
      ]);
      expect(options.observe).toHaveBeenCalledTimes(2);
    },
  );

  it("blocks another decision after budget admission leaves a durable start unsettled", async () => {
    const decide = vi.fn();
    let sequence = 0;
    const sessionBudget = {
      consumeTurn: vi.fn(() => ({ ok: true })),
      beginUsageSettlement: vi.fn(() => ({ ok: false, reason: "blocked" })),
    };
    const options = runtimeOptions({
      provider: successfulProvider(decide),
      sessionBudget,
      idGenerator: () => `decision-${++sequence}`,
    });
    const runtime = createSkillDecisionRuntime(options);

    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
      }),
    ).rejects.toMatchObject({ code: "CC_SESSION_BUDGET_EXHAUSTED" });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
    ]);
    expect(decide).not.toHaveBeenCalled();

    const second = await runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-b",
    });
    expect(second).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(sessionBudget.consumeTurn).toHaveBeenCalledOnce();
    expect(options.persist).toHaveBeenCalledOnce();
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not start a second provider while the first call awaits settlement", async () => {
    const answer = await successfulProvider().decide();
    let release;
    let entered;
    const providerEntered = new Promise((resolve) => {
      entered = resolve;
    });
    const decide = vi.fn(() => {
      entered();
      return new Promise((resolve) => {
        release = () => resolve(answer);
      });
    });
    let sequence = 0;
    const options = runtimeOptions({
      provider: successfulProvider(decide),
      idGenerator: () => `decision-${++sequence}`,
    });
    const runtime = createSkillDecisionRuntime(options);
    const first = runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    await providerEntered;

    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-b",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(decide).toHaveBeenCalledOnce();
    release();
    await expect(first).resolves.toMatchObject({ status: "suggestion" });
  });

  it("blocks a concurrent decision while the first start receipt is pending", async () => {
    let acknowledgeStart;
    let startEntered;
    const startPending = new Promise((resolve) => {
      startEntered = resolve;
    });
    const persist = vi.fn((type) => {
      if (type !== "model_usage_started") return Promise.resolve();
      startEntered();
      return new Promise((resolve) => {
        acknowledgeStart = resolve;
      });
    });
    const decide = vi
      .fn()
      .mockImplementation(() => successfulProvider().decide());
    let sequence = 0;
    const options = runtimeOptions({
      provider: successfulProvider(decide),
      persist,
      idGenerator: () => `decision-${++sequence}`,
    });
    const runtime = createSkillDecisionRuntime(options);
    const first = runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    await startPending;

    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-b",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
    ]);
    expect(decide).not.toHaveBeenCalled();

    acknowledgeStart();
    await expect(first).resolves.toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("records its own deadline as an unavailable provider timeout", async () => {
    const options = runtimeOptions({
      timeoutMs: 50,
      provider: successfulProvider(
        (_request, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    });
    const result = await createSkillDecisionRuntime(options).suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-timeout",
      selectedDigest: null,
    });
    expect(options.persist).toHaveBeenCalledTimes(2);
    expect(options.persist.mock.calls[1][0]).toContain("unknown");
    expect(options.observe).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "provider-timeout" }),
    );
  });

  it("bounds a provider that ignores its deadline and blocks later unknown usage", async () => {
    const decide = vi.fn(() => new Promise(() => {}));
    let sequence = 0;
    const options = runtimeOptions({
      timeoutMs: 50,
      provider: successfulProvider(decide),
      idGenerator: () => `decision-${++sequence}`,
    });
    const runtime = createSkillDecisionRuntime(options);
    const first = await runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    expect(first).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-timeout",
      selectedDigest: null,
    });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    const second = await runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-b",
    });
    expect(second).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-usage-unknown-blocked",
    });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("keeps user cancellation terminal even when the provider aborts", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    const options = runtimeOptions({
      provider: successfulProvider(async () => {
        controller.abort(reason);
        throw reason;
      }),
    });
    await expect(
      createSkillDecisionRuntime(options).suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(options.observe).not.toHaveBeenCalled();
  });

  it("ends a canceled wait when the provider ignores its signal", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const options = runtimeOptions({
      provider: successfulProvider(() => {
        entered();
        return new Promise(() => {});
      }),
    });
    const result = createSkillDecisionRuntime(options).suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
      signal: controller.signal,
    });
    await started;
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(options.observe).not.toHaveBeenCalled();
  });

  it("does not invent unknown provider usage when canceled during started persistence", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    let entered;
    let release;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const pendingWrite = new Promise((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async () => successfulProvider().decide());
    const options = runtimeOptions({
      provider: successfulProvider(decide),
      persist: vi.fn(async (type) => {
        if (type === "model_usage_started") {
          entered();
          await pendingWrite;
        }
      }),
    });
    const runtime = createSkillDecisionRuntime(options);
    const input = {
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    };
    const pending = runtime.suggest({ ...input, signal: controller.signal });
    await started;
    controller.abort(reason);
    release();
    await expect(pending).rejects.toBe(reason);
    expect(decide).not.toHaveBeenCalled();
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
    expect(options.observe).not.toHaveBeenCalled();
    await expect(
      runtime.suggest({ ...input, turnId: "turn-b" }),
    ).resolves.toMatchObject({ status: "suggestion" });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("discards a successful late answer after caller cancellation and records unknown usage", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    const valid = await successfulProvider().decide();
    let release;
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const options = runtimeOptions({
      provider: successfulProvider(async () => {
        started();
        await pending;
        return valid;
      }),
    });
    const result = createSkillDecisionRuntime(options).suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
      signal: controller.signal,
    });
    await entered;
    controller.abort(reason);
    release();
    await expect(result).rejects.toBe(reason);
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(options.observe).not.toHaveBeenCalled();
  });

  it("discards an answer returned after the provider deadline with unknown usage", async () => {
    const valid = await successfulProvider().decide();
    const options = runtimeOptions({
      timeoutMs: 50,
      provider: successfulProvider(async () => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        return valid;
      }),
    });
    const result = await createSkillDecisionRuntime(options).suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reasonCode: "provider-timeout",
      selectedDigest: null,
    });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
  });

  it("does not expose an observed suggestion canceled during observation persistence", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    const options = runtimeOptions({
      observe: vi.fn(async () => {
        controller.abort(reason);
      }),
    });
    await expect(
      createSkillDecisionRuntime(options).suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(options.observe).toHaveBeenCalledOnce();
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
  });

  it("fails closed when observation persistence exceeds its boundary deadline", async () => {
    const options = runtimeOptions({
      boundaryTimeoutMs: 50,
      observe: vi.fn(() => new Promise(() => {})),
    });
    const runtime = createSkillDecisionRuntime(options);
    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });
    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-b",
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
    expect(options.observe).toHaveBeenCalledOnce();
  });

  it("blocks later provider calls after observation persistence rejects", async () => {
    const decide = vi.fn(async () => successfulProvider().decide());
    const options = runtimeOptions({
      provider: successfulProvider(decide),
      observe: vi.fn(async () => {
        throw new Error("observation store down");
      }),
    });
    const runtime = createSkillDecisionRuntime(options);
    const input = {
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    };
    await expect(runtime.suggest(input)).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    await expect(
      runtime.suggest({ ...input, turnId: "turn-b" }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });
    expect(decide).toHaveBeenCalledOnce();
    expect(options.observe).toHaveBeenCalledOnce();
  });

  it("keeps a canceled observation terminal until its write is reconciled", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user canceled", "AbortError");
    let enter;
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    const options = runtimeOptions({
      observe: vi.fn(() => {
        enter();
        return new Promise(() => {});
      }),
    });
    const runtime = createSkillDecisionRuntime(options);
    const pending = runtime.suggest({
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
      signal: controller.signal,
    });
    await entered;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-b",
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
    expect(options.observe).toHaveBeenCalledOnce();
  });

  it("fails closed when usage persistence cannot establish the started boundary", async () => {
    const options = runtimeOptions({
      persist: vi.fn(async () => {
        throw new Error("ledger down");
      }),
    });
    const runtime = createSkillDecisionRuntime(options);
    await expect(
      runtime.suggest({
        query: "repair tests",
        candidates: candidates(),
        turnId: "turn-a",
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });
  });

  it("bounds a hung started write and blocks later calls on the same runtime", async () => {
    const decide = vi.fn();
    const options = runtimeOptions({
      boundaryTimeoutMs: 50,
      provider: successfulProvider(decide),
      persist: vi.fn(() => new Promise(() => {})),
    });
    const runtime = createSkillDecisionRuntime(options);
    const input = {
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    };
    await expect(runtime.suggest(input)).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    await expect(
      runtime.suggest({ ...input, turnId: "turn-b" }),
    ).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    expect(options.persist).toHaveBeenCalledOnce();
    expect(decide).not.toHaveBeenCalled();
    expect(options.observe).not.toHaveBeenCalled();
  });

  it("bounds a hung known-usage settlement and keeps its runtime terminal", async () => {
    const valid = await successfulProvider().decide();
    const decide = vi.fn(async () => valid);
    const options = runtimeOptions({
      boundaryTimeoutMs: 50,
      provider: successfulProvider(decide),
      persist: vi.fn((type) =>
        type === "token_usage" ? new Promise(() => {}) : Promise.resolve(),
      ),
    });
    const runtime = createSkillDecisionRuntime(options);
    const input = {
      query: "repair tests",
      candidates: candidates(),
      turnId: "turn-a",
    };
    await expect(runtime.suggest(input)).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    await expect(
      runtime.suggest({ ...input, turnId: "turn-b" }),
    ).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    expect(options.persist.mock.calls.map(([type]) => type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
    expect(decide).toHaveBeenCalledOnce();
    expect(options.observe).not.toHaveBeenCalled();
  });
});
