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
});
