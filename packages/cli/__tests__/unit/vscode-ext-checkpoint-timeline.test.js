import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as rewindModule from "../../../vscode-extension/src/chat/rewind-commands.js";

const rewind = rewindModule.default || rewindModule;
const fixturePath = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/checkpoint-timeline/cases.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

describe("VS Code checkpoint timeline projection", () => {
  it("requests the canonical session-scoped machine projection", () => {
    expect(rewind.buildTimelineArgs("session-fixture")).toEqual([
      "checkpoint",
      "timeline",
      "-s",
      "session-fixture",
      "--json",
    ]);
    expect(rewind.buildTimelineArgs()).toContain("default");
  });

  it("projects the shared fixture without host-side availability inference", () => {
    expect(rewind.parseTimelineProjection(fixture.projection)).not.toBeNull();
    expect(rewind.projectTimeline(fixture.projection)).toEqual(
      fixture.hostProjection,
    );
  });

  it("returns an exact embedded envelope and never creates a disabled action", () => {
    const submission = rewind.timelineActionSubmission(
      fixture.projection,
      "turn-2",
      "branch",
    );
    expect(submission).toEqual(
      fixture.projection.entries[1].actions[5].submission,
    );
    expect(
      rewind.timelineActionSubmission(
        fixture.projection,
        "turn-3",
        "restore-code",
      ),
    ).toBeNull();
    const args = rewind.buildTimelineActionArgs(submission, {
      preview: true,
      confirm: false,
    });
    expect(args.slice(0, 5)).toEqual([
      "checkpoint",
      "action",
      "-s",
      "session-fixture",
      "--submission",
    ]);
    expect(JSON.parse(args[5])).toEqual(submission);
    expect(args).toContain("--preview");
    expect(
      rewind.buildTimelineActionArgs(submission, {
        preview: false,
        confirm: true,
      }),
    ).toContain("--confirm");
  });

  it("fails closed for unsupported roots and strips tampered enabled envelopes", () => {
    expect(
      rewind.parseTimelineProjection({ ...fixture.projection, version: 2 }),
    ).toBeNull();

    const tampered = clone(fixture.projection);
    tampered.entries[0].actions[0].submission.turnId = "another-turn";
    expect(
      rewind.timelineActionSubmission(tampered, "turn-1", "restore-code"),
    ).toBeNull();
    expect(
      rewind.projectTimeline(tampered).entries[0].enabledActions,
    ).not.toContain("restore-code");
  });

  it("builds visual rows and renders the shared CLI preview without hiding risks", () => {
    const parsed = rewind.parseTimelineProjection(fixture.projection);
    const turn = rewind.toTimelineQuickPickItem(parsed.entries[1]);
    expect(turn.label).toContain("partial");
    expect(turn.description).toContain("artifact");
    expect(turn.detail).toContain("vendor/cache");
    expect(rewind.timelineActionItems(parsed.entries[1])).toHaveLength(6);

    expect(rewind.parseTimelineActionResult(fixture.actionPreview)).toEqual(
      fixture.actionPreview,
    );
    const text = rewind.formatTimelinePreview(fixture.actionPreview);
    expect(text).toContain("restore-both");
    expect(text).toContain("partial");
    expect(text).toContain("vendor/cache");
    expect(text).toContain("bundle.zip");
  });
});
