import { describe, expect, it } from "vitest";
import {
  applyMergeReviewDecision,
  assertMergeReviewSuccessor,
  buildMergeReview,
  canonicalizeMergeReviewConflicts,
  computeMergeReviewConflictsDigest,
  computeMergeReviewEvidenceDigest,
  computeMergeReviewHunkDigest,
  computeMergeReviewPatchDigest,
  TEAM_MERGE_REVIEW_ERROR,
  TEAM_MERGE_REVIEW_LIMITS,
  transitionMergeReview,
  validateMergeReview,
} from "../../src/lib/agent-team/team-merge-review.js";

const OID = {
  base: "1".repeat(40),
  agentA: "2".repeat(40),
  agentB: "3".repeat(40),
  oldBlob: "4".repeat(40),
  newBlobA: "5".repeat(40),
  newBlobB: "6".repeat(40),
  prepared: "7".repeat(40),
  published: "7".repeat(40),
  rollback: "9".repeat(40),
};
const EVIDENCE = {
  prepared: `sha256:${"a".repeat(64)}`,
  publishing: `sha256:${"b".repeat(64)}`,
  published: `sha256:${"c".repeat(64)}`,
  rollback: `sha256:${"d".repeat(64)}`,
  rolledBack: `sha256:${"e".repeat(64)}`,
};

function rawInput(overrides = {}) {
  return {
    base: { branch: "main", commitOid: OID.base },
    candidates: [
      { key: "agent-a", branch: "team/run/agent-a", commitOid: OID.agentA },
      { key: "agent-b", branch: "team/run/agent-b", commitOid: OID.agentB },
    ],
    files: [
      {
        candidateKey: "agent-b",
        path: "src/z.js",
        oldPath: "src/z.js",
        status: "modified",
        oldBlobOid: OID.oldBlob,
        newBlobOid: OID.newBlobB,
        binary: false,
        patchDigest: computeMergeReviewPatchDigest(
          "@@ -20 +20,2 @@\n-old\n+new\n+line\n",
        ),
        hunks: [
          {
            oldStart: 20,
            oldLines: 1,
            newStart: 20,
            newLines: 2,
            patch: "@@ -20 +20,2 @@\n-old\n+new\n+line\n",
          },
        ],
      },
      {
        candidateKey: "agent-a",
        path: "src/a.js",
        oldPath: "src/a.js",
        status: "modified",
        oldBlobOid: OID.oldBlob,
        newBlobOid: OID.newBlobA,
        binary: false,
        patchDigest: computeMergeReviewPatchDigest(
          "@@ -8 +8 @@\n-eight\n+EIGHT\n@@ -2 +2 @@\n-two\n+TWO\n",
        ),
        hunks: [
          {
            oldStart: 8,
            oldLines: 1,
            newStart: 8,
            newLines: 1,
            patch: "@@ -8 +8 @@\n-eight\n+EIGHT\n",
          },
          {
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            patch: "@@ -2 +2 @@\n-two\n+TWO\n",
          },
        ],
      },
    ],
    createdAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function plan() {
  return buildMergeReview(rawInput());
}

function decide(review = plan(), overrides = {}) {
  return applyMergeReviewDecision(review, {
    expectedRevision: review.revision,
    actor: "reviewer@example.test",
    host: "test-host.local",
    reason: "selected after inspecting the cumulative diff",
    selectedFileIds: [review.files[1].id],
    selectedHunkIds: [review.files[0].hunks[0].id],
    at: "2026-08-14T00:00:01.000Z",
    ...overrides,
  });
}

function conflictEvidence(review, overrides = {}) {
  return [
    {
      candidateKey: review.files[0].candidateKey,
      path: review.files[0].path,
      type: "content_conflict",
      explanation: "selected hunk overlaps another candidate change",
      suggestion:
        "Refresh the exact branches and inspect the overlapping hunk.",
      hunkIds: [review.files[0].hunks[0].id],
      ...overrides,
    },
  ];
}

describe("team merge-review canonical contract", () => {
  it("builds stable plan/file/hunk identities without persisting patch bytes", () => {
    const first = plan();
    const second = plan();

    expect(second).toEqual(first);
    expect(first.reviewId).toMatch(/^tmr_[a-f0-9]{32}$/);
    expect(
      first.files.every((file) => /^tmrf_[a-f0-9]{32}$/.test(file.id)),
    ).toBe(true);
    expect(
      first.files.every((file) =>
        file.hunks.every((hunk) => /^tmrh_[a-f0-9]{32}$/.test(hunk.id)),
      ),
    ).toBe(true);
    expect(first.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.files.map((file) => file.candidateKey)).toEqual([
      "agent-a",
      "agent-b",
    ]);
    expect(first.files[0].hunks.map((hunk) => hunk.oldStart)).toEqual([2, 8]);
    expect(JSON.stringify(first)).not.toContain("-eight");
    expect(first.files[0].hunks[1].digest).toBe(
      computeMergeReviewHunkDigest("@@ -8 +8 @@\n-eight\n+EIGHT\n"),
    );
    expect(validateMergeReview(first)).toEqual(first);
  });

  it("binds candidate order, exact refs, blobs, ranges, and full hunk digest", () => {
    const original = plan();
    const reversed = buildMergeReview({
      ...rawInput(),
      candidates: [...rawInput().candidates].reverse(),
    });
    expect(reversed.reviewId).not.toBe(original.reviewId);

    for (const mutate of [
      (copy) => {
        copy.base.commitOid = "9".repeat(40);
      },
      (copy) => {
        copy.candidates[0].commitOid = "9".repeat(40);
      },
      (copy) => {
        copy.files[0].newBlobOid = "9".repeat(40);
      },
      (copy) => {
        copy.files[0].hunks[0].oldStart += 1;
      },
      (copy) => {
        copy.files[0].hunks[0].digest = `sha256:${"9".repeat(64)}`;
      },
    ]) {
      const copy = structuredClone(original);
      mutate(copy);
      expect(() => validateMergeReview(copy)).toThrowError(
        expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
      );
    }
  });

  it("creates a fresh review authority for the same exact plan at a later time", () => {
    const first = plan();
    const retried = buildMergeReview(
      rawInput({ createdAt: "2026-08-14T00:10:00.000Z" }),
    );

    expect(retried.reviewId).not.toBe(first.reviewId);
    expect(retried.planDigest).toBe(first.planDigest);
    expect(retried.files.map((file) => file.id)).toEqual(
      first.files.map((file) => file.id),
    );
    expect(
      retried.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
    ).toEqual(first.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));
  });

  it.each(["renamed", "copied"])(
    "binds %s identity to the exact source path even when blobs match",
    (status) => {
      const file = {
        candidateKey: "agent-a",
        path: "src/destination.js",
        oldPath: "src/source-a.js",
        status,
        oldBlobOid: OID.oldBlob,
        newBlobOid: OID.oldBlob,
        binary: false,
        patchDigest: computeMergeReviewPatchDigest("rename metadata patch"),
        hunks: [],
      };
      const first = buildMergeReview(rawInput({ files: [file] }));
      const second = buildMergeReview(
        rawInput({
          files: [{ ...file, oldPath: "src/source-b.js" }],
        }),
      );

      expect(second.files[0].id).not.toBe(first.files[0].id);
      expect(second.planDigest).not.toBe(first.planDigest);
    },
  );

  it("binds mode-only changes to the full patch digest", () => {
    const file = {
      candidateKey: "agent-a",
      path: "scripts/run.sh",
      oldPath: "scripts/run.sh",
      status: "modified",
      oldBlobOid: OID.oldBlob,
      newBlobOid: OID.oldBlob,
      binary: false,
      patchDigest: computeMergeReviewPatchDigest(
        "old mode 100644\nnew mode 100755\n",
      ),
      hunks: [],
    };
    const executable = buildMergeReview(rawInput({ files: [file] }));
    const changedPatch = computeMergeReviewPatchDigest(
      "old mode 100644\nnew mode 100600\n",
    );
    const differentMode = buildMergeReview(
      rawInput({ files: [{ ...file, patchDigest: changedPatch }] }),
    );
    expect(differentMode.files[0].id).not.toBe(executable.files[0].id);

    const forged = structuredClone(executable);
    forged.files[0].patchDigest = changedPatch;
    expect(() => validateMergeReview(forged)).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
  });

  it("rejects unknown fields and non-canonical file/hunk ordering", () => {
    const unknown = { ...plan(), authority: "forged" };
    expect(() => validateMergeReview(unknown)).toThrow(/unexpected or missing/);

    const files = structuredClone(plan());
    files.files.reverse();
    expect(() => validateMergeReview(files)).toThrow(
      /stable candidate\/path order/,
    );

    const hunks = structuredClone(plan());
    hunks.files[0].hunks.reverse();
    expect(() => validateMergeReview(hunks)).toThrow(/stable order/);
  });

  it("rejects coercible scalar types in the strict persisted schema", () => {
    for (const mutate of [
      (copy) => {
        copy.revision = "0";
      },
      (copy) => {
        copy.createdAt = Date.parse(copy.createdAt);
      },
      (copy) => {
        copy.files[0].binary = 0;
      },
      (copy) => {
        copy.files[0].hunks[0].oldStart = "2";
      },
      (copy) => {
        copy.settlement.conflictDigest = undefined;
      },
    ]) {
      const copy = structuredClone(plan());
      mutate(copy);
      expect(() => validateMergeReview(copy)).toThrowError(
        expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.INVALID }),
      );
    }
  });

  it("requires selections to use the revisioned decision operation", () => {
    expect(() =>
      buildMergeReview(rawInput({ decision: { actor: "forged" } })),
    ).toThrow(/applyMergeReviewDecision/);
  });

  it("records only plan-bound selections and redacts secret-like reason text", () => {
    const review = plan();
    const selected = decide(review, {
      reason: `approved with Bearer ${"x".repeat(24)} removed`,
    });

    expect(selected.revision).toBe(1);
    expect(selected.state).toBe("planned");
    expect(selected.decision).toMatchObject({
      host: "test-host.local",
      decidedAt: "2026-08-14T00:00:01.000Z",
    });
    expect(selected.decision.reason).toContain("[REDACTED]");
    expect(selected.decision.digest).toMatch(/^sha256:/);
    expect(selected.evidenceDigest).not.toBe(review.evidenceDigest);
    expect(validateMergeReview(selected)).toEqual(selected);

    for (const mutate of [
      (copy) => {
        copy.decision.host = "different-host.local";
      },
      (copy) => {
        copy.decision.decidedAt = "2026-08-14T00:00:01.500Z";
      },
    ]) {
      const copy = structuredClone(selected);
      mutate(copy);
      expect(() => validateMergeReview(copy)).toThrowError(
        expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
      );
    }
    const leaked = structuredClone(selected);
    leaked.decision.reason = `Bearer ${"x".repeat(24)}`;
    expect(() => validateMergeReview(leaked)).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.SECRET }),
    );

    expect(() =>
      decide(review, {
        selectedFileIds: ["tmrf_" + "0".repeat(32)],
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
    expect(() =>
      decide(review, { selectedFileIds: [], selectedHunkIds: [] }),
    ).toThrow(/at least one/);
    expect(() =>
      decide(review, {
        selectedFileIds: [review.files[0].id],
        selectedHunkIds: [review.files[0].hunks[0].id],
      }),
    ).toThrow(/both whole file and hunk/);
    expect(() =>
      decide(review, { host: `ghp_${"a".repeat(24)}` }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.SECRET }),
    );
  });

  it("caps one durable selection so recovery action argv stays IDE-safe", () => {
    const files = Array.from(
      { length: TEAM_MERGE_REVIEW_LIMITS.selectionIds + 1 },
      (_, index) => ({
        candidateKey: "agent-a",
        path: `assets/file-${String(index).padStart(3, "0")}.bin`,
        oldPath: null,
        status: "added",
        oldBlobOid: null,
        newBlobOid: OID.newBlobA,
        binary: true,
        patchDigest: computeMergeReviewPatchDigest(`binary patch ${index}`),
        hunks: [],
      }),
    );
    const review = buildMergeReview(rawInput({ files }));
    expect(() =>
      applyMergeReviewDecision(review, {
        expectedRevision: review.revision,
        actor: "reviewer@example.test",
        host: "test-host.local",
        reason: "selection bound test",
        selectedFileIds: review.files.map((file) => file.id),
        selectedHunkIds: [],
        at: "2026-08-14T00:00:01.000Z",
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.LIMIT }),
    );
  });

  it("keeps an exact repeated decision idempotent and rejects a different one", () => {
    const selected = decide();
    const repeat = applyMergeReviewDecision(selected, {
      expectedRevision: 1,
      actor: selected.decision.actor,
      host: selected.decision.host,
      reason: selected.decision.reason,
      selectedFileIds: selected.decision.selectedFileIds,
      selectedHunkIds: selected.decision.selectedHunkIds,
      at: "2026-08-14T00:00:02.000Z",
    });
    expect(repeat).toEqual(selected);

    expect(() =>
      applyMergeReviewDecision(selected, {
        expectedRevision: 1,
        actor: selected.decision.actor,
        host: selected.decision.host,
        reason: "different decision",
        selectedFileIds: selected.decision.selectedFileIds,
        selectedHunkIds: selected.decision.selectedHunkIds,
      }),
    ).toThrow(/different immutable decision/);
  });

  it("enforces the publish and controlled rollback state machine", () => {
    let review = decide();
    const decidedAt = review.decision.decidedAt;
    review = transitionMergeReview(review, {
      expectedRevision: 1,
      to: "prepared",
      preparedOid: OID.prepared,
      transitionEvidenceDigest: EVIDENCE.prepared,
      at: "2026-08-14T00:00:02.000Z",
    });
    review = transitionMergeReview(review, {
      expectedRevision: 2,
      to: "publishing",
      transitionEvidenceDigest: EVIDENCE.publishing,
      at: "2026-08-14T00:00:03.000Z",
    });
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 3,
        to: "published",
        publishedOid: "8".repeat(40),
        transitionEvidenceDigest: EVIDENCE.published,
        at: "2026-08-14T00:00:04.000Z",
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
    review = transitionMergeReview(review, {
      expectedRevision: 3,
      to: "published",
      publishedOid: OID.published,
      transitionEvidenceDigest: EVIDENCE.published,
      at: "2026-08-14T00:00:04.000Z",
    });
    review = transitionMergeReview(review, {
      expectedRevision: 4,
      to: "rollback_required",
      transitionEvidenceDigest: EVIDENCE.rollback,
      at: "2026-08-14T00:00:05.000Z",
    });
    review = transitionMergeReview(review, {
      expectedRevision: 5,
      to: "rolled_back",
      rollbackOid: OID.rollback,
      transitionEvidenceDigest: EVIDENCE.rolledBack,
      at: "2026-08-14T00:00:06.000Z",
    });

    expect(review).toMatchObject({ revision: 6, state: "rolled_back" });
    expect(review.decision.decidedAt).toBe(decidedAt);
    expect(review.decision.host).toBe("test-host.local");
    expect(review.settlement).toMatchObject({
      preparedOid: OID.prepared,
      publishedOid: OID.published,
      rollbackOid: OID.rollback,
    });
    expect(validateMergeReview(review)).toEqual(review);
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 6,
        to: "published",
        transitionEvidenceDigest: EVIDENCE.published,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.TRANSITION }),
    );
  });

  it("does not allow later transitions to rewrite settlement authority", () => {
    let review = decide();
    review = transitionMergeReview(review, {
      expectedRevision: 1,
      to: "prepared",
      preparedOid: OID.prepared,
      transitionEvidenceDigest: EVIDENCE.prepared,
      at: "2026-08-14T00:00:02.000Z",
    });

    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 2,
        to: "publishing",
        preparedOid: "9".repeat(40),
        transitionEvidenceDigest: EVIDENCE.publishing,
        at: "2026-08-14T00:00:03.000Z",
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.TRANSITION }),
    );

    const legitimate = transitionMergeReview(review, {
      expectedRevision: 2,
      to: "publishing",
      transitionEvidenceDigest: EVIDENCE.publishing,
      at: "2026-08-14T00:00:03.000Z",
    });
    const forged = structuredClone(legitimate);
    forged.settlement.preparedOid = "9".repeat(40);
    forged.evidenceDigest = computeMergeReviewEvidenceDigest(forged);
    expect(validateMergeReview(forged)).toEqual(forged);
    expect(() =>
      assertMergeReviewSuccessor(review, forged, "review.transitioned"),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
  });

  it("supports conflict settlement before base publication", () => {
    let review = decide();
    const conflicts = conflictEvidence(review);
    review = transitionMergeReview(review, {
      expectedRevision: 1,
      to: "conflicted",
      conflicts,
      conflictDigest: computeMergeReviewConflictsDigest(conflicts),
      transitionEvidenceDigest: EVIDENCE.prepared,
      at: "2026-08-14T00:00:02.000Z",
    });
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 2,
        to: "rolled_back",
        conflicts: conflictEvidence(review, {
          explanation: "rewritten after settlement",
        }),
        rollbackOid: OID.rollback,
        transitionEvidenceDigest: EVIDENCE.rolledBack,
        at: "2026-08-14T00:00:03.000Z",
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.TRANSITION }),
    );
    review = transitionMergeReview(review, {
      expectedRevision: 2,
      to: "rolled_back",
      rollbackOid: OID.rollback,
      transitionEvidenceDigest: EVIDENCE.rolledBack,
      at: "2026-08-14T00:00:03.000Z",
    });
    expect(review.state).toBe("rolled_back");
    expect(review.conflicts).toEqual(conflicts);
    expect(review.settlement.publishedOid).toBeNull();
  });

  it("rejects missing, dangling, or tampered durable conflict evidence", () => {
    const review = decide();
    const conflicts = conflictEvidence(review);
    const canonical = canonicalizeMergeReviewConflicts(
      review,
      conflictEvidence(review, {
        explanation: `patch failed\nBearer ${"x".repeat(24)}`,
      }),
    );
    expect(canonical[0].explanation).toBe("patch failed Bearer [REDACTED]");
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 1,
        to: "conflicted",
        conflictDigest: computeMergeReviewConflictsDigest(conflicts),
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrow(/requires durable conflict evidence/);
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 1,
        to: "conflicted",
        conflicts,
        conflictDigest: `sha256:${"0".repeat(64)}`,
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 1,
        to: "conflicted",
        conflicts: conflictEvidence(review, { candidateKey: "missing-agent" }),
        conflictDigest: computeMergeReviewConflictsDigest(conflicts),
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
    expect(() =>
      transitionMergeReview(review, {
        expectedRevision: 1,
        to: "conflicted",
        conflicts: conflictEvidence(review, {
          hunkIds: [`tmrh_${"0".repeat(32)}`],
        }),
        conflictDigest: computeMergeReviewConflictsDigest(conflicts),
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );

    const conflicted = transitionMergeReview(review, {
      expectedRevision: 1,
      to: "conflicted",
      conflicts,
      conflictDigest: computeMergeReviewConflictsDigest(conflicts),
      transitionEvidenceDigest: EVIDENCE.prepared,
      at: "2026-08-14T00:00:02.000Z",
    });
    const forged = structuredClone(conflicted);
    forged.conflicts[0].explanation = "forged explanation";
    forged.evidenceDigest = computeMergeReviewEvidenceDigest(forged);
    expect(() => validateMergeReview(forged)).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.BINDING }),
    );
  });

  it("rejects stale revisions, missing decisions, unsafe paths, binary hunks and identity secrets", () => {
    expect(() =>
      transitionMergeReview(decide(), {
        expectedRevision: 0,
        to: "prepared",
        preparedOid: OID.prepared,
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.STALE }),
    );
    expect(() =>
      transitionMergeReview(plan(), {
        expectedRevision: 0,
        to: "prepared",
        preparedOid: OID.prepared,
        transitionEvidenceDigest: EVIDENCE.prepared,
      }),
    ).toThrow(/persist a decision/);

    const unsafe = rawInput();
    unsafe.files[0].path = "../outside";
    expect(() => buildMergeReview(unsafe)).toThrow(/repository-relative/);

    const binary = rawInput();
    binary.files[0].binary = true;
    expect(() => buildMergeReview(binary)).toThrow(/file-level selection only/);

    const secret = rawInput();
    secret.candidates[0].key = `ghp_${"a".repeat(24)}`;
    expect(() => buildMergeReview(secret)).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.SECRET }),
    );
  });

  it("models add/delete and binary files without raw content", () => {
    const input = rawInput({
      files: [
        {
          candidateKey: "agent-a",
          path: "assets/new.bin",
          oldPath: null,
          status: "added",
          oldBlobOid: null,
          newBlobOid: OID.newBlobA,
          binary: true,
          patchDigest: computeMergeReviewPatchDigest("binary add patch"),
          hunks: [],
        },
        {
          candidateKey: "agent-b",
          path: "src/old.js",
          oldPath: "src/old.js",
          status: "deleted",
          oldBlobOid: OID.oldBlob,
          newBlobOid: null,
          binary: false,
          patchDigest: computeMergeReviewPatchDigest("deleted file patch"),
          hunks: [],
        },
      ],
    });
    expect(validateMergeReview(buildMergeReview(input)).files).toHaveLength(2);
  });
});
