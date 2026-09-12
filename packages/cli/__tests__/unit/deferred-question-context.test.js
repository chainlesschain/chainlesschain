import { describe, expect, it } from "vitest";
import { DeferredQuestionContext } from "../../src/lib/deferred-question-context.js";

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
});
