import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCheckpointTimeline } from "../../src/lib/checkpoint-timeline.js";
import {
  planCheckpointTimelineAction,
  validateCheckpointTimelineSubmission,
} from "../../src/lib/checkpoint-timeline-authority.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../vscode-extension/src/__fixtures__/checkpoint-timeline/cases.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

function builtTimeline() {
  return buildCheckpointTimeline(fixture.input);
}

function submission(timeline, turnId, action) {
  return timeline.entries
    .find((entry) => entry.turnId === turnId)
    .actions.find((candidate) => candidate.action === action).submission;
}

describe("checkpoint timeline CLI authority", () => {
  it("builds the shared restore-both preview with honest risk details", () => {
    const timeline = builtTimeline();
    const planned = planCheckpointTimelineAction({
      timeline,
      submission: submission(timeline, "turn-2", "restore-both"),
      messages: fixture.input.messages,
      codePreview: {
        modified: [{ rel: "src/a.js" }],
        added: [],
        deleted: ["old.js"],
      },
    });

    expect(planned.ok).toBe(true);
    expect(planned.preview).toEqual(fixture.actionPreview);
    expect(planned.commit.messages).toEqual(fixture.input.messages.slice(0, 4));
    expect(planned.commit.bindingPruneOffset).toBe(5);
  });

  it("plans all six actions while keeping the parent branch intact", () => {
    const timeline = builtTimeline();
    const plans = Object.fromEntries(
      [
        "restore-code",
        "restore-conversation",
        "restore-both",
        "summary-from",
        "summary-to",
        "branch",
      ].map((action) => [
        action,
        planCheckpointTimelineAction({
          timeline,
          submission: submission(timeline, "turn-2", action),
          messages: fixture.input.messages,
        }),
      ]),
    );

    expect(Object.values(plans).every((plan) => plan.ok)).toBe(true);
    expect(plans["restore-code"].commit.messages).toBeNull();
    expect(plans["restore-conversation"].commit.messages).toHaveLength(4);
    expect(plans["restore-both"].commit.messages).toHaveLength(4);
    expect(plans["summary-from"].commit.messages).toHaveLength(5);
    expect(plans["summary-from"].commit.messages.at(-1).content).toContain(
      "Conversation Summary",
    );
    expect(plans["summary-to"].commit.bindingPruneOffset).toBe(0);
    expect(plans.branch.commit.branchPlan).toMatchObject({
      parentSessionId: "session-fixture",
      parentTurnId: "turn-2",
      preservesParent: true,
    });
  });

  it("rejects stale, tampered, and conversation-anchor-drifted submissions", () => {
    const timeline = builtTimeline();
    const exact = submission(timeline, "turn-2", "branch");
    expect(validateCheckpointTimelineSubmission(timeline, exact).ok).toBe(true);
    expect(
      validateCheckpointTimelineSubmission(timeline, {
        ...exact,
        revision: "old-revision",
      }),
    ).toMatchObject({ ok: false, code: "TIMELINE_STALE" });
    expect(
      validateCheckpointTimelineSubmission(timeline, {
        ...exact,
        checkpointId: "cp-other",
      }),
    ).toEqual({ ok: false, code: "TIMELINE_SUBMISSION_INVALID" });
    expect(
      planCheckpointTimelineAction({
        timeline,
        submission: exact,
        messages: [{ role: "assistant", content: "offset no longer matches" }],
      }),
    ).toMatchObject({
      ok: false,
      code: "TIMELINE_CONVERSATION_ANCHOR_STALE",
    });
  });
});
