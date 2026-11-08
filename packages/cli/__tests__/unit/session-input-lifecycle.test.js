import { describe, expect, it } from "vitest";
import {
  SESSION_INPUT_ACCEPTED,
  SESSION_INPUT_SETTLED,
  createSessionInputAccepted,
  createSessionInputSettled,
  createSessionInputLifecycleProjection,
  projectSessionInputMessages,
} from "../../src/lib/session-input-lifecycle.js";

const accepted = createSessionInputAccepted({
  inputId: "input-1",
  turnId: "run:t0",
  prompt: "private original prompt",
});
const acceptance = {
  type: SESSION_INPUT_ACCEPTED,
  data: accepted,
  hash: "a".repeat(64),
};
const settlement = {
  type: SESSION_INPUT_SETTLED,
  data: createSessionInputSettled(accepted, acceptance.hash, "answer"),
  hash: "b".repeat(64),
};

describe("session input lifecycle", () => {
  it("keeps interrupted acceptance inspectable and outside provider history", () => {
    const projection = createSessionInputLifecycleProjection();
    projection.accept(acceptance);
    expect(projectSessionInputMessages(acceptance)).toBeNull();
    const state = projection.finish();
    expect(state.pendingInputs[0].prompt).toBe(accepted.prompt);
    expect(JSON.stringify(state.summary)).not.toContain(accepted.prompt);
    expect(state.summary.pendingCount).toBe(1);
  });

  it("publishes both messages only from one complete settled event", () => {
    const projection = createSessionInputLifecycleProjection();
    projection.accept(acceptance);
    projection.accept(settlement);
    expect(projection.finish().pendingInputs).toEqual([]);
    expect(projectSessionInputMessages(settlement)).toEqual([
      { role: "user", content: accepted.prompt },
      { role: "assistant", content: "answer" },
    ]);
    expect(() =>
      projectSessionInputMessages({
        ...settlement,
        data: { ...settlement.data, assistant: undefined },
      }),
    ).toThrow();
  });

  it("does not consume old pending input when a new turn completes", () => {
    const projection = createSessionInputLifecycleProjection();
    projection.accept(acceptance);
    const next = createSessionInputAccepted({
      inputId: "input-2",
      turnId: "new:t0",
      prompt: "new prompt",
    });
    projection.accept({
      type: SESSION_INPUT_ACCEPTED,
      data: next,
      hash: "c".repeat(64),
    });
    projection.accept({
      type: SESSION_INPUT_SETTLED,
      data: createSessionInputSettled(next, "c".repeat(64), "new answer"),
    });
    expect(
      projection.finish().pendingInputs.map((input) => input.inputId),
    ).toEqual(["input-1"]);
  });

  it("rejects orphan, duplicate and mismatched settlement authority", () => {
    expect(() =>
      createSessionInputLifecycleProjection().accept(settlement),
    ).toThrow();
    for (const change of [
      { acceptanceHash: "c".repeat(64) },
      { turnId: "other:t0" },
      { inputDigest: "c".repeat(64) },
    ]) {
      const projection = createSessionInputLifecycleProjection();
      projection.accept(acceptance);
      expect(() =>
        projection.accept({
          ...settlement,
          data: { ...settlement.data, ...change },
        }),
      ).toThrow();
      expect(projection.finish().summary.pendingCount).toBe(1);
    }
    const projection = createSessionInputLifecycleProjection();
    projection.accept(acceptance);
    projection.accept(settlement);
    expect(() => projection.accept(settlement)).toThrow();
  });

  it("retains an empty successful assistant as a complete turn", () => {
    expect(
      projectSessionInputMessages({
        type: SESSION_INPUT_SETTLED,
        data: createSessionInputSettled(accepted, acceptance.hash, ""),
      }),
    ).toEqual([
      { role: "user", content: accepted.prompt },
      { role: "assistant", content: "" },
    ]);
  });

  it("ignores usage, budget, HOLD and unrelated records", () => {
    const projection = createSessionInputLifecycleProjection();
    projection.accept(acceptance);
    const before = projection.finish();
    for (const type of [
      "model_usage_started",
      "model_usage_unknown",
      "token_usage",
      "compact",
      "budget_hold",
    ])
      projection.accept({ type, data: { messages: [], tokens: 0 } });
    expect(projection.finish()).toEqual(before);
  });
});
