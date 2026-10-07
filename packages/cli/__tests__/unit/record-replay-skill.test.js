import { describe, expect, it, vi } from "vitest";
import {
  createRecordedSkillDraft,
  replayRecordedSkill,
  reviewRecordedSkillDraft,
  scanRecordedValue,
  validateRecordedSkillDraft,
  validateReviewedRecordedSkill,
} from "../../src/lib/record-replay/skill-recorder.js";
import {
  prepareRecordedSkillBrowserTarget,
  recordedSkillBrowserEnvironment,
} from "../../src/lib/record-replay/browser-target-policy.js";

// This real generated hash contains a phone-like digit run; keep the fixture
// deterministic instead of waiting for a random URL/port hash to hit it in CI.
const browserEnvironment = recordedSkillBrowserEnvironment(
  prepareRecordedSkillBrowserTarget({ html: "<h1>Project 57</h1>" }),
);
const phoneLikeDigest = browserEnvironment.targetDigest;

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

  it("retains generated browser digests through capture, serialization and review", () => {
    expect(scanRecordedValue(phoneLikeDigest)).toEqual([
      { path: "#", category: "pii" },
    ]);
    const value = draft({ environment: browserEnvironment });
    expect(value.environment.requirements.targetDigest).toBe(phoneLikeDigest);
    const approved = approve(JSON.parse(JSON.stringify(value)));
    expect(validateReviewedRecordedSkill(approved).draftDigest).toBe(
      value.draftDigest,
    );
  });

  it("does not scan the recomputed environment binding digest as user content", () => {
    const value = draft({ environment: { app: "project-356" } });
    expect(scanRecordedValue(value.environment.digest)).toEqual([
      { path: "#", category: "pii" },
    ]);
    expect(validateRecordedSkillDraft(value).draftDigest).toBe(
      value.draftDigest,
    );
    expect(approve(value).environment.digest).toBe(value.environment.digest);
  });

  it.each([
    { description: phoneLikeDigest },
    { failureConditions: [phoneLikeDigest] },
    { environment: { note: phoneLikeDigest } },
    { environment: { "targetDigest/nested": phoneLikeDigest } },
    {
      environment: {
        ...browserEnvironment,
        contact: "person@example.com",
      },
    },
    {
      environment: {
        ...browserEnvironment,
        networkPolicy: {
          ...browserEnvironment.networkPolicy,
          credential: "Bearer secret-token-value",
        },
      },
    },
  ])(
    "keeps user content scanning strict beside digest metadata: %j",
    (overrides) => {
      expect(() => draft(overrides)).toThrowError(
        expect.objectContaining({
          code: "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
        }),
      );
    },
  );

  it.each([
    { targetDigest: "sha256:13800138000" },
    { targetDigest: null },
    { targetDigest: `${phoneLikeDigest} person@example.com` },
    { targetDigest: { nested: phoneLikeDigest } },
    { storageStateDigest: "Bearer secret-token-value" },
    { networkPolicy: { digest: "sha256:invalid" } },
  ])("rejects malformed browser digest fields: %j", (environment) => {
    expect(() => draft({ environment })).toThrowError(
      expect.objectContaining({ code: "CC_REPLAY_INVALID_ARGUMENT" }),
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
