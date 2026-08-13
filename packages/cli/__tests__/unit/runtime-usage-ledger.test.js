import { describe, expect, it } from "vitest";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeToolCallId,
} from "../../src/lib/runtime-usage-ledger.js";

describe("runtime usage ledger projection", () => {
  it("persists only canonical bounded usage fields", () => {
    expect(
      projectRuntimeTokenUsage({
        provider: "openai",
        model: "gpt-4o",
        callId: "call-1",
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          secret: "must not persist",
        },
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-4o",
      callId: "call-1",
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });

  it("preserves a bounded secret-free skill attribution", () => {
    expect(
      projectRuntimeTokenUsage({
        provider: "anthropic",
        model: "claude",
        usage: { input_tokens: 3, output_tokens: 1 },
        attribution: {
          origin: "skill",
          skill: `  csv\u0000-clean-${"x".repeat(300)}  `,
          secret: "must not persist",
        },
      }).attribution,
    ).toEqual({
      origin: "skill",
      skill: `csv-clean-${"x".repeat(246)}`,
    });
  });

  it("rejects ambiguous, malformed, and colliding usage authority", () => {
    expect(() => projectRuntimeTokenUsage({ usage: {} })).toThrow(
      /requires input_tokens or prompt_tokens/,
    );
    expect(() =>
      projectRuntimeTokenUsage({ usage: { input_tokens: 0 } }),
    ).toThrow(/requires output_tokens or completion_tokens/);
    expect(() =>
      projectRuntimeTokenUsage({
        usage: { input_tokens: 1, prompt_tokens: 2 },
      }),
    ).toThrow(/aliases conflict/);
    expect(() =>
      projectRuntimeTokenUsage({ usage: { input_tokens: null } }),
    ).toThrow(/safe integers/);
    expect(() =>
      projectRuntimeTokenUsage({
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 2 },
      }),
    ).toThrow(/total conflicts/);
    expect(() =>
      projectRuntimeUsageBoundary(
        { callId: "x".repeat(129), source: "model" },
        "started",
      ),
    ).toThrow(/bounded call id/);
  });

  it("preserves bounded attribution on started and unknown boundaries", () => {
    expect(
      projectRuntimeUsageBoundary(
        {
          callId: "child-1",
          provider: "openai",
          model: "gpt-4o",
          source: "subagent",
          attribution: {
            origin: "subagent",
            subagentId: "child-a",
            skill: "review",
            secret: "must not persist",
          },
        },
        "unknown",
      ),
    ).toEqual({
      callId: "child-1",
      provider: "openai",
      model: "gpt-4o",
      source: "subagent",
      attribution: {
        origin: "subagent",
        subagentId: "child-a",
        skill: "review",
      },
      code: "provider_transport_outcome_unknown",
    });
  });

  it("generates unique bounded fallback tool ids and marks persistence errors", () => {
    const first = runtimeToolCallId();
    const second = runtimeToolCallId();
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(128);
    const error = new Error("disk");
    expect(markRuntimeLedgerPersistenceError(error)).toBe(error);
    expect(error.runtimeLedgerPersistence).toBe(true);
  });
});
