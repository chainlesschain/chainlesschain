import { describe, expect, it, vi } from "vitest";
import {
  createRecordedSkillDraft,
  replayRecordedSkill,
  reviewRecordedSkillDraft,
  validateRecordedSkillDraft,
  validateReviewedRecordedSkill,
} from "../../src/lib/record-replay/skill-recorder.js";

function draft(overrides = {}) {
  return createRecordedSkillDraft({
    name: "open-project",
    description: "Open a low-risk project page and assert its title",
    actions: [
      { kind: "click", target: "[data-project='captured-project']" },
      { kind: "assert", target: "h1", value: "captured-project" },
    ],
    parameterBindings: [
      { name: "projectName", value: "captured-project", required: true },
    ],
    environment: {
      app: "chainlesschain-desktop",
      selectorContract: "project-list-v1",
    },
    failureConditions: ["project title is not visible"],
    ...overrides,
  });
}

function approve(value) {
  return reviewRecordedSkillDraft(value, {
    reviewerId: "reviewer-1",
    approvedCapabilities: value.capabilityManifest,
    acceptedFailureConditions: true,
  });
}

describe("Record & Replay to Skill prototype", () => {
  it("parameterizes volatile input without retaining the captured value", () => {
    const value = draft();
    expect(JSON.stringify(value)).not.toContain("captured-project");
    expect(value).toMatchObject({
      status: "draft",
      parameters: [{ name: "projectName", sensitive: false, required: true }],
      capabilityManifest: ["ui.interact", "ui.observe"],
      draftDigest: expect.stringMatching(/^sha256:/),
    });
    expect(Object.isFrozen(value.actions)).toBe(true);
    expect(Object.isFrozen(value.actions[0])).toBe(true);
    expect(Object.isFrozen(value.environment.requirements)).toBe(true);
  });

  it.each([
    { description: "contact person@example.com" },
    { environment: { token: "Bearer secret-token-value" } },
    { failureConditions: ["path C:/temp/runtime must exist"] },
  ])("scans every persisted draft field: %j", (overrides) => {
    expect(() => draft(overrides)).toThrowError(
      expect.objectContaining({
        code: "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
      }),
    );
  });

  it("revalidates serialized drafts and approvals instead of trusting object shape", () => {
    const serializedDraft = JSON.parse(JSON.stringify(draft()));
    expect(validateRecordedSkillDraft(serializedDraft).draftDigest).toBe(
      serializedDraft.draftDigest,
    );
    serializedDraft.actions[0].target = "#modified-after-review";
    expect(() => validateRecordedSkillDraft(serializedDraft)).toThrowError(
      expect.objectContaining({ code: "CC_REPLAY_DRAFT_INTEGRITY" }),
    );

    const serializedApproval = JSON.parse(JSON.stringify(approve(draft())));
    expect(
      validateReviewedRecordedSkill(serializedApproval).approvalDigest,
    ).toBe(serializedApproval.approvalDigest);
    serializedApproval.review.approvedCapabilities = ["ui.observe"];
    expect(() =>
      validateReviewedRecordedSkill(serializedApproval),
    ).toThrowError(
      expect.objectContaining({ code: "CC_REPLAY_APPROVAL_INVALID" }),
    );
  });

  it.each([
    "Bearer secret-token-value",
    "person@example.com",
    "2026-08-24T12:00:00Z",
  ])(
    "fails closed when an unparameterized sensitive value remains: %s",
    (value) => {
      expect(() =>
        createRecordedSkillDraft({
          name: "unsafe",
          actions: [{ kind: "type", target: "input", value }],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
        }),
      );
    },
  );

  it("requires exact user review and sandboxed, network-off replay", async () => {
    const value = draft();
    expect(() =>
      reviewRecordedSkillDraft(value, {
        reviewerId: "reviewer-1",
        approvedCapabilities: ["ui.observe"],
        acceptedFailureConditions: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_REPLAY_REVIEW_INCOMPLETE" }),
    );
    await expect(
      replayRecordedSkill(approve(value), {
        inputs: { projectName: "project-2" },
        environment: value.environment.requirements,
        isolation: { sandboxed: true, network: "allow" },
        executor: { capabilities: value.capabilityManifest, execute: vi.fn() },
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "CC_REPLAY_ISOLATION_REQUIRED" }),
    );
  });

  it("replays a portable fixture with evidence and rejects environment drift", async () => {
    const value = approve(draft());
    const execute = vi.fn(async () => ({
      ok: true,
      evidence: { screenshotDigest: `sha256:${"a".repeat(64)}` },
    }));
    const options = {
      inputs: { projectName: "project-2" },
      environment: value.environment.requirements,
      executor: { capabilities: value.capabilityManifest, execute },
    };
    const report = await replayRecordedSkill(value, options);

    expect(report).toMatchObject({
      status: "succeeded",
      receipts: [
        {
          actionId: "action-1",
          evidenceDigest: expect.stringMatching(/^sha256:/),
        },
        {
          actionId: "action-2",
          evidenceDigest: expect.stringMatching(/^sha256:/),
        },
      ],
    });
    expect(execute.mock.calls[0][0].target).toContain("project-2");
    await expect(
      replayRecordedSkill(value, {
        ...options,
        environment: { app: "other", selectorContract: "project-list-v1" },
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "CC_REPLAY_ENVIRONMENT_DRIFT" }),
    );
  });

  it("rejects unbounded executor evidence before it enters a receipt digest", async () => {
    const value = approve(draft());
    await expect(
      replayRecordedSkill(value, {
        inputs: { projectName: "project-2" },
        environment: value.environment.requirements,
        executor: {
          capabilities: value.capabilityManifest,
          execute: async () => ({
            ok: true,
            evidence: { value: "x".repeat(300_000) },
          }),
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "CC_REPLAY_ACTION_FAILED" }),
    );
  });
});
