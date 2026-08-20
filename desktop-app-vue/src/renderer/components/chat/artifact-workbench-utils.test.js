import { describe, expect, it } from "vitest";
import {
  formatArtifactBytes,
  recoveryDecisionLabel,
  shapeArtifactWorkbench,
  shortArtifactDigest,
} from "./artifact-workbench-utils.js";

describe("desktop artifact workbench projection", () => {
  it("keeps only public artifact, returned-result, recovery, and audit fields", () => {
    const shaped = shapeArtifactWorkbench({
      schema: "cc-artifact-workbench/v1",
      observedAt: "2026-08-20T08:00:00.000Z",
      artifacts: [
        {
          id: "artifact-1",
          title: "Reviewed summary",
          kind: "report",
          mime: "text/plain",
          size: 2048,
          sha256: "a".repeat(64),
          sessionId: "session-1",
          storedPath: "C:/secret/managed.txt",
          payload: "S3CR3T",
          returnedResult: {
            sessionId: "session-1",
            requestId: "request-1",
            reviewDigest: `sha256:${"b".repeat(64)}`,
            item: "summary",
            kind: "summary",
            sourceDigest: `sha256:${"c".repeat(64)}`,
            sourcePath: "C:/secret/source.txt",
          },
          history: {
            accessCount: 2,
            latestAccess: {
              action: "download",
              client: "desktop",
              authorizedAt: "2026-08-20T08:00:01.000Z",
              eventDigest: `sha256:${"d".repeat(64)}`,
              storedPath: "C:/secret/managed.txt",
            },
          },
        },
      ],
      recovery: {
        planDigest: `sha256:${"e".repeat(64)}`,
        policy: { unattendedMutationAllowed: false },
        summary: { itemCount: 1, criticalCount: 1, timedOutCount: 1 },
        items: [
          {
            itemId: "recovery-1",
            kind: "pending-deletion",
            severity: "critical",
            timedOut: true,
            recommendedDecision: "retry",
            authority: { storedFile: "secret.txt" },
          },
        ],
      },
      history: {
        totalEventCount: 1,
        truncated: false,
        activity: [
          {
            type: "access",
            occurredAt: "2026-08-20T08:00:01.000Z",
            artifactId: "artifact-1",
            client: "desktop",
            action: "download",
            eventDigest: `sha256:${"d".repeat(64)}`,
            payload: "S3CR3T",
          },
        ],
      },
    });

    expect(shaped.artifacts[0].returnedResult.requestId).toBe("request-1");
    expect(shaped.recovery.items[0]).toEqual({
      itemId: "recovery-1",
      kind: "pending-deletion",
      severity: "critical",
      timedOut: true,
      recommendedDecision: "retry",
    });
    expect(shaped.history.activity[0].client).toBe("desktop");
    expect(JSON.stringify(shaped)).not.toContain("S3CR3T");
    expect(JSON.stringify(shaped)).not.toContain("C:/secret");
    expect(shaped.recovery.unattendedMutationAllowed).toBe(false);
  });

  it("rejects unsupported schemas and malformed recovery projections", () => {
    expect(shapeArtifactWorkbench({ schema: "other" })).toBeNull();
    expect(
      shapeArtifactWorkbench({
        schema: "cc-artifact-workbench/v1",
        artifacts: [],
        recovery: { items: null },
        history: { activity: [] },
      }),
    ).toBeNull();
  });

  it("formats bounded metadata labels", () => {
    expect(formatArtifactBytes(2048)).toBe("2.0 KB");
    expect(shortArtifactDigest(`sha256:${"a".repeat(64)}`)).toHaveLength(23);
    expect(recoveryDecisionLabel("delete-orphan")).toBe("删除孤儿副本");
  });
});
