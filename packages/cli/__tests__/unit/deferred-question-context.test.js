import { describe, expect, it } from "vitest";
import {
  DEFERRED_QUESTION_EVENTS,
  DeferredQuestionContext,
  reduceDeferredQuestionEvents,
} from "../../src/lib/deferred-question-context.js";

describe("DeferredQuestionContext", () => {
  it("bounds answer content and consumes records once", () => {
    const context = new DeferredQuestionContext({ sessionId: "s-1" });
    context.record({
      questionId: "q-1",
      question: "Color?",
      answer: "x".repeat(20_000),
      requestedRevision: 1,
      resolvedRevision: 1,
    });

    const prepared = context.prepareCall({ currentRevision: 1 });
    expect(prepared.systemSuffix).toContain("never grant permission");
    expect(prepared.userContext.length).toBeLessThan(17_500);
    expect(prepared.userContext).toContain("[truncated]");
    expect(prepared.userContext).toContain('"stale":false');
    expect(context.prepareCall({ currentRevision: 1 })).toBeNull();
  });

  it("retains only a bounded number of unanswered injections", () => {
    const context = new DeferredQuestionContext({ maxPendingAnswers: 2 });
    context.record({ questionId: "q-1", answer: "one" });
    context.record({ questionId: "q-2", answer: "two" });
    context.record({ questionId: "q-3", answer: "three" });

    const prepared = context.prepareCall();
    expect(prepared.userContext).not.toContain('"questionId":"q-1"');
    expect(prepared.userContext).toContain('"questionId":"q-2"');
    expect(prepared.userContext).toContain('"questionId":"q-3"');
  });

  it("normalizes an undefined answer without breaking the next model call", () => {
    const context = new DeferredQuestionContext({ sessionId: "s-1" });
    expect(
      context.record({
        questionId: "q-undefined",
        question: "Optional detail?",
        answer: undefined,
      }),
    ).toBe(true);

    const prepared = context.prepareCall({ currentRevision: 1 });
    expect(prepared.userContext).toContain('"answer":""');
    expect(context.size).toBe(0);
  });

  it("hydrates durable answers, de-duplicates them, and reports one-shot consumption", () => {
    const consumed = [];
    const context = new DeferredQuestionContext({
      sessionId: "s-1",
      initialAnswers: [
        {
          questionId: "q-restored",
          question: "Old question",
          answer: "old",
          requestedRevision: 2,
          resolvedRevision: 2,
        },
      ],
      onConsumed: (ids) => consumed.push(ids),
    });
    context.record({
      questionId: "q-restored",
      question: "Updated question",
      answer: "new",
      requestedRevision: 2,
      resolvedRevision: 3,
    });

    expect(context.snapshot()).toHaveLength(1);
    const prepared = context.prepareCall({ currentRevision: 3 });
    expect(prepared.userContext).toContain('"answer":"new"');
    expect(prepared.userContext).toContain('"stale":true');
    expect(consumed).toEqual([["q-restored"]]);
    expect(context.size).toBe(0);
  });

  it("retains an answer until durable consumption acknowledges it", () => {
    let acknowledged = false;
    const context = new DeferredQuestionContext({
      initialAnswers: [{ questionId: "q-1", answer: "blue" }],
      onConsumed: () => acknowledged,
    });

    expect(context.prepareCall()).toBeNull();
    expect(context.size).toBe(1);
    acknowledged = true;
    expect(context.prepareCall().userContext).toContain('"answer":"blue"');
    expect(context.size).toBe(0);
  });

  it("reduces bound durable question events without resurrecting consumed answers", () => {
    const binding = {
      backgroundAgentId: null,
      sessionId: "s-1",
      turnId: "turn-1",
      toolUseId: "tool-1",
      sequence: 4,
    };
    const events = [
      {
        type: DEFERRED_QUESTION_EVENTS.REQUESTED,
        data: {
          questionId: "q-4",
          question: "Color?",
          purpose: "preference",
          binding,
          requestedRevision: 2,
        },
      },
      {
        type: DEFERRED_QUESTION_EVENTS.RESOLVED,
        data: {
          questionId: "q-4",
          question: "Color?",
          answer: "blue",
          purpose: "preference",
          binding,
          requestedRevision: 2,
          resolvedRevision: 3,
        },
      },
    ];

    expect(
      reduceDeferredQuestionEvents(events, { sessionId: "s-1" }),
    ).toMatchObject({
      pendingQuestions: [],
      answers: [{ questionId: "q-4", answer: "blue" }],
      maxSequence: 4,
    });
    events.push({
      type: DEFERRED_QUESTION_EVENTS.CONSUMED,
      data: { questionIds: ["q-4"] },
    });
    expect(
      reduceDeferredQuestionEvents(events, { sessionId: "s-1" }),
    ).toMatchObject({
      pendingQuestions: [],
      answers: [],
      maxSequence: 4,
    });
  });

  it("ignores answers whose persisted binding does not match the request", () => {
    const requestBinding = { sessionId: "s-1", sequence: 1 };
    const state = reduceDeferredQuestionEvents(
      [
        {
          type: DEFERRED_QUESTION_EVENTS.REQUESTED,
          data: { questionId: "q-1", binding: requestBinding },
        },
        {
          type: DEFERRED_QUESTION_EVENTS.RESOLVED,
          data: {
            questionId: "q-1",
            answer: "forged",
            binding: { sessionId: "s-1", sequence: 2 },
          },
        },
      ],
      { sessionId: "s-1" },
    );
    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.answers).toEqual([]);
  });

  it("does not reopen a consumed question from a replayed request", () => {
    const binding = { sessionId: "s-1", sequence: 1 };
    const state = reduceDeferredQuestionEvents(
      [
        {
          type: DEFERRED_QUESTION_EVENTS.REQUESTED,
          data: { questionId: "q-1", binding },
        },
        {
          type: DEFERRED_QUESTION_EVENTS.RESOLVED,
          data: { questionId: "q-1", answer: "blue", binding },
        },
        {
          type: DEFERRED_QUESTION_EVENTS.CONSUMED,
          data: { questionId: "q-1" },
        },
        {
          type: DEFERRED_QUESTION_EVENTS.REQUESTED,
          data: { questionId: "q-1", binding },
        },
      ],
      { sessionId: "s-1" },
    );
    expect(state.pendingQuestions).toEqual([]);
    expect(state.answers).toEqual([]);
    expect(state.maxSequence).toBe(1);
  });
});
