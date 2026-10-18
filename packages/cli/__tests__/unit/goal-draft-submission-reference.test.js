import { describe, expect, it } from "vitest";
import {
  createGoalDraftSubmissionReference,
  validateGoalDraftSubmissionReference,
} from "@chainlesschain/session-core/goal-draft-connection-contract";
const input = {
  goalRef: { id: "g1", storeId: "s1", revision: 2, controlGeneration: 1 },
  plugin: { name: "drafter", scope: "project", version: "1.0.0" },
  declarationDigest: `sha256:${"a".repeat(64)}`,
  grantRef: { id: `goal-external-grant-${"b".repeat(64)}`, epoch: 1 },
  requestId: "stable-request",
  inputDigest: `sha256:${"c".repeat(64)}`,
};
describe("durable credential-free draft submission reference", () => {
  it("roundtrips a deterministic reference and returns independent copies", () => {
    const first = createGoalDraftSubmissionReference(input);
    expect(first.schema).toBe("chainlesschain.goal-draft-submission-ref/v1");
    expect(validateGoalDraftSubmissionReference(first)).toEqual(first);
    expect(createGoalDraftSubmissionReference(input)).toEqual(first);
    first.goalRef.id = "changed";
    expect(input.goalRef.id).toBe("g1");
    expect(() => validateGoalDraftSubmissionReference(first)).toThrow();
  });
  it.each(["key", "endpoint", "connection", "description", "approved"])(
    "rejects unexpected %s material",
    (key) => {
      expect(() =>
        createGoalDraftSubmissionReference({ ...input, [key]: "forbidden" }),
      ).toThrow();
      expect(() =>
        validateGoalDraftSubmissionReference({
          ...createGoalDraftSubmissionReference(input),
          [key]: "forbidden",
        }),
      ).toThrow();
    },
  );
  it.each(["epoch", "digest", "schema", "requestId"])(
    "rejects changed %s bindings",
    (field) => {
      const reference = createGoalDraftSubmissionReference(input);
      if (field === "epoch") reference.grantRef.epoch++;
      if (field === "digest")
        reference.inputDigest = `sha256:${"d".repeat(64)}`;
      if (field === "schema") reference.schema = "other";
      if (field === "requestId") reference.requestId = "other";
      expect(() => validateGoalDraftSubmissionReference(reference)).toThrow();
    },
  );
});
