import { describe, expect, it } from "vitest";
import {
  buildDiffReviewAudit,
  fingerprintText,
} from "../../../vscode-extension/src/diff-review-audit.js";

describe("VS Code diff review audit", () => {
  it("records a user-edited accepted proposal without embedding file contents", () => {
    const audit = buildDiffReviewAudit({
      path: "/ws/src/a.js",
      originalText: "old",
      proposedText: "agent proposal",
      result: { outcome: "accepted", finalText: "user revision" },
      reviewContext: {
        sessionId: "sess-1",
        turnId: "run-1:t2",
        toolUseId: "call-7",
      },
      host: "vscode",
      now: new Date("2026-07-23T00:00:00.000Z"),
    });
    expect(audit).toMatchObject({
      schema: "cc-diff-review/v1",
      reviewId: expect.stringMatching(/^drev_[a-f0-9]{24}$/),
      createdAt: "2026-07-23T00:00:00.000Z",
      actor: "local-user",
      host: "vscode",
      outcome: "accepted",
      source: "user-edited",
      written: true,
      operation: "modify",
      sessionId: "sess-1",
      turnId: "run-1:t2",
      toolUseId: "call-7",
      followUpRequested: false,
      baseline: { chars: 3, lines: 1 },
      final: { chars: 13, lines: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain("user revision");
  });

  it("records selected hunks and bounded line comments", () => {
    const audit = buildDiffReviewAudit({
      path: "/ws/a.js",
      originalText: "a",
      proposedText: "b",
      result: {
        outcome: "changes-requested",
        selectedHunks: [2, 0, 2, -1, "1"],
        comments: [
          {
            line: 0,
            endLine: 2,
            lineText: "const apiKey = 'sensitive line'",
            note: "Revise this",
          },
        ],
      },
    });
    expect(audit.selectedHunks).toEqual([0, 2]);
    expect(audit.comments).toEqual([
      {
        line: 0,
        endLine: 2,
        lineFingerprint: { sha256: expect.any(String), chars: 31, lines: 1 },
        note: "Revise this",
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain("sensitive line");
    expect(audit.written).toBe(false);
    expect(audit.followUpRequested).toBe(true);
    expect(audit.final).toBe(null);
  });

  it("records rename/delete intent without inventing a deleted final file", () => {
    const renamed = buildDiffReviewAudit({
      path: "/x/old.js",
      originalText: "old",
      proposedText: "old",
      result: {
        outcome: "accepted",
        operation: "rename",
        targetPath: "/x/new.js",
        finalText: "old",
      },
    });
    expect(renamed).toMatchObject({
      operation: "rename",
      targetPath: "/x/new.js",
      final: { chars: 3 },
    });

    const deleted = buildDiffReviewAudit({
      path: "/x/old.js",
      originalText: "old",
      proposedText: "",
      result: { outcome: "accepted", operation: "delete" },
    });
    expect(deleted).toMatchObject({
      operation: "delete",
      targetPath: null,
      final: null,
      written: true,
    });
  });

  it("uses stable SHA-256 text fingerprints", () => {
    expect(fingerprintText("hello")).toEqual({
      sha256:
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      chars: 5,
      lines: 1,
    });
  });
});
