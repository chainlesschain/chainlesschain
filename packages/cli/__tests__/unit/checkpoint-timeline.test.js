import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCheckpointCommand } from "../../src/commands/checkpoint.js";
import {
  CHECKPOINT_TIMELINE_ACTIONS,
  CHECKPOINT_TIMELINE_MARKERS,
  CHECKPOINT_TIMELINE_SCHEMA,
  buildCheckpointTimeline,
  projectCheckpointTimeline,
  resolveCheckpointTimelineAction,
} from "../../src/lib/checkpoint-timeline.js";

const fixturePath = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/checkpoint-timeline/cases.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("checkpoint timeline projection", () => {
  it("registers the machine-readable checkpoint timeline CLI", () => {
    const program = new Command();
    registerCheckpointCommand(program);
    const checkpoint = program.commands.find(
      (command) => command.name() === "checkpoint",
    );
    const timeline = checkpoint.commands.find(
      (command) => command.name() === "timeline",
    );

    expect(timeline).toBeDefined();
    expect(timeline.options.map((option) => option.long)).toContain("--json");
    const action = checkpoint.commands.find(
      (command) => command.name() === "action",
    );
    expect(action).toBeDefined();
    expect(action.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--submission", "--preview", "--confirm"]),
    );
  });

  it("builds the shared full/partial/none host projection deterministically", () => {
    const first = buildCheckpointTimeline(fixture.input);
    const second = buildCheckpointTimeline(fixture.input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: CHECKPOINT_TIMELINE_SCHEMA,
      version: 1,
      authority: "cli",
      sessionId: "session-fixture",
    });
    expect(projectCheckpointTimeline(first)).toEqual(fixture.hostProjection);
    expect(projectCheckpointTimeline(fixture.projection)).toEqual(
      fixture.hostProjection,
    );
  });

  it("expresses every marker and rewind/range/branch action in one contract", () => {
    const timeline = buildCheckpointTimeline(fixture.input);
    const markerKinds = new Set(
      timeline.entries.flatMap((entry) =>
        entry.markers.map((marker) => marker.kind),
      ),
    );
    const actions = new Set(
      timeline.entries.flatMap((entry) =>
        entry.actions.map((action) => action.action),
      ),
    );

    expect(markerKinds).toEqual(
      new Set(Object.values(CHECKPOINT_TIMELINE_MARKERS)),
    );
    expect(actions).toEqual(
      new Set(Object.values(CHECKPOINT_TIMELINE_ACTIONS)),
    );
    expect(timeline.unboundMarkers).toEqual([
      expect.objectContaining({
        kind: "checkpoint",
        referenceId: "cp-orphan",
        turnId: null,
      }),
    ]);
  });

  it("keeps coverage warnings honest and does not offer code restore without a checkpoint", () => {
    const timeline = buildCheckpointTimeline(fixture.input);
    const partial = timeline.entries[1];
    const none = timeline.entries[2];

    expect(partial).toMatchObject({
      coverage: "partial",
      excludedPaths: ["vendor/cache"],
      irreversibleSideEffects: ["publish release", "bundle.zip"],
      warnings: [
        "partial-coverage",
        "excluded-paths",
        "irreversible-side-effects",
      ],
    });
    expect(none.warnings).toEqual([
      "no-restore-coverage",
      "excluded-paths",
      "irreversible-side-effects",
    ]);
    expect(
      none.actions.find((action) => action.action === "restore-code"),
    ).toMatchObject({ enabled: false, submission: null });
    expect(
      none.actions.find((action) => action.action === "restore-both"),
    ).toMatchObject({ enabled: false, submission: null });
  });

  it("does not advertise code restore when immutable checkpoint identity is missing", () => {
    const timeline = buildCheckpointTimeline({
      sessionId: "missing-identity",
      turns: [
        {
          turnId: "turn-1",
          conversationOffset: 2,
          fileCheckpointId: "cp-1",
          coverage: "full",
        },
      ],
      checkpoints: [{ id: "cp-1", label: "legacy" }],
    });

    expect(
      timeline.entries[0].actions.find(
        (action) => action.action === "restore-code",
      ),
    ).toMatchObject({
      enabled: false,
      reason: "checkpoint-identity-unavailable",
      submission: null,
    });
    expect(
      timeline.entries[0].actions.find(
        (action) => action.action === "restore-conversation",
      ).enabled,
    ).toBe(true);
  });

  it("returns only the embedded CLI-authored action envelope and fails closed", () => {
    const timeline = buildCheckpointTimeline(fixture.input);
    const resolved = resolveCheckpointTimelineAction(
      timeline,
      "turn-2",
      "branch",
    );
    expect(resolved).toEqual({
      ok: true,
      submission: expect.objectContaining({
        schema: "cc-checkpoint-timeline-action/v1",
        authority: "cli",
        action: "branch",
        sessionId: "session-fixture",
        turnId: "turn-2",
      }),
    });
    expect(
      resolveCheckpointTimelineAction(timeline, "turn-3", "restore-code"),
    ).toMatchObject({ ok: false, code: "TIMELINE_ACTION_UNAVAILABLE" });
    expect(
      resolveCheckpointTimelineAction(
        { ...timeline, version: 2 },
        "turn-2",
        "branch",
      ),
    ).toEqual({ ok: false, code: "TIMELINE_SCHEMA_UNSUPPORTED" });
  });
});
