import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMergeReview,
  canonicalMergeReviewJson,
  computeMergeReviewConflictsDigest,
  computeMergeReviewEvidenceDigest,
  computeMergeReviewPatchDigest,
  TEAM_MERGE_REVIEW_ERROR,
} from "../../src/lib/agent-team/team-merge-review.js";
import {
  computeTeamMergeReviewStoreEventDigest,
  TeamMergeReviewStore,
  TEAM_MERGE_REVIEW_STORE_ERROR,
} from "../../src/lib/agent-team/team-merge-review-store.js";

const OID = {
  base: "1".repeat(40),
  candidate: "2".repeat(40),
  oldBlob: "3".repeat(40),
  newBlob: "4".repeat(40),
  prepared: "5".repeat(40),
};
const PREPARED_EVIDENCE = `sha256:${"a".repeat(64)}`;
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cc-team-merge-review-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "reviews.jsonl");
  return {
    directory,
    filePath,
    store: new TeamMergeReviewStore({
      filePath,
      // secure-fs has its own Windows ACL suite; avoid invoking icacls for
      // every append in these hash-chain/CAS-focused tests.
      ensureOwnerOnlyFile: () => {},
    }),
  };
}

function plan() {
  return buildMergeReview({
    base: { branch: "main", commitOid: OID.base },
    candidates: [
      {
        key: "agent-a",
        branch: "team/run/agent-a",
        commitOid: OID.candidate,
      },
    ],
    files: [
      {
        candidateKey: "agent-a",
        path: "src/change.js",
        oldPath: "src/change.js",
        status: "modified",
        oldBlobOid: OID.oldBlob,
        newBlobOid: OID.newBlob,
        binary: false,
        patchDigest: computeMergeReviewPatchDigest(
          "@@ -4 +4 @@\n-before\n+after\n",
        ),
        hunks: [
          {
            oldStart: 4,
            oldLines: 1,
            newStart: 4,
            newLines: 1,
            patch: "@@ -4 +4 @@\n-before\n+after\n",
          },
        ],
      },
    ],
    createdAt: "2026-08-14T01:00:00.000Z",
  });
}

function decisionRequest(review, overrides = {}) {
  return {
    expectedRevision: review.revision,
    actor: "release-reviewer",
    host: "test-host.local",
    reason: "selected after inspecting the exact candidate diff",
    selectedFileIds: [],
    selectedHunkIds: [review.files[0].hunks[0].id],
    at: "2026-08-14T01:00:01.000Z",
    ...overrides,
  };
}

function readEvents(filePath) {
  return readFileSync(filePath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function conflictEvidence(review) {
  return [
    {
      candidateKey: review.files[0].candidateKey,
      path: review.files[0].path,
      type: "patch_rejected",
      explanation: "selected hunk could not be applied to the staging tree",
      suggestion:
        "Refresh the exact candidate branch and review the hunk again.",
      hunkIds: [review.files[0].hunks[0].id],
    },
  ];
}

describe("TeamMergeReviewStore", () => {
  it("treats an owner-only empty file as a new append-only log", () => {
    const { filePath, store } = fixture();
    writeFileSync(filePath, "", { mode: 0o600 });

    expect(store.read()).toEqual({
      reviews: [],
      cursor: { sequence: 0, digest: null },
    });
    expect(store.create(plan()).cursor.sequence).toBe(1);
  });

  it("persists canonical snapshots as a physically append-only hash chain", () => {
    const { filePath, store } = fixture();
    const review = plan();
    const created = store.create(review, {
      expectedCursor: { sequence: 0, digest: null },
    });
    const firstBytes = readFileSync(filePath);

    expect(created).toMatchObject({
      review,
      duplicate: false,
      cursor: { sequence: 1 },
    });
    expect(created.cursor.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.create(review)).toMatchObject({
      duplicate: true,
      cursor: created.cursor,
    });
    expect(readFileSync(filePath)).toEqual(firstBytes);

    const secret = `Bearer ${"s".repeat(32)}`;
    const decided = store.decide(
      review.reviewId,
      decisionRequest(review, { reason: `approved; remove ${secret}` }),
      { expectedCursor: created.cursor },
    );
    const secondBytes = readFileSync(filePath);
    expect(secondBytes.subarray(0, firstBytes.length)).toEqual(firstBytes);
    expect(secondBytes.length).toBeGreaterThan(firstBytes.length);
    expect(secondBytes.toString("utf8")).not.toContain(secret);
    expect(decided.review.decision.reason).toContain("[REDACTED]");

    const prepared = store.transition(
      review.reviewId,
      {
        expectedRevision: decided.review.revision,
        to: "prepared",
        preparedOid: OID.prepared,
        transitionEvidenceDigest: PREPARED_EVIDENCE,
        at: "2026-08-14T01:00:02.000Z",
      },
      { expectedCursor: decided.cursor },
    );
    const finalBytes = readFileSync(filePath);
    expect(finalBytes.subarray(0, secondBytes.length)).toEqual(secondBytes);
    expect(prepared).toMatchObject({
      duplicate: false,
      review: { revision: 2, state: "prepared" },
      cursor: { sequence: 3 },
    });

    const events = readEvents(filePath);
    expect(events.map((event) => event.type)).toEqual([
      "review.created",
      "review.decided",
      "review.transitioned",
    ]);
    expect(events[0].previousDigest).toBeNull();
    expect(events[1].previousDigest).toBe(events[0].digest);
    expect(events[2].previousDigest).toBe(events[1].digest);
    expect(
      events.every(
        (event) =>
          computeTeamMergeReviewStoreEventDigest(event) === event.digest,
      ),
    ).toBe(true);
    expect(store.get(review.reviewId)).toEqual(prepared.review);
    expect(store.read()).toEqual({
      reviews: [prepared.review],
      cursor: prepared.cursor,
    });
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it("enforces both review revision CAS and physical-log cursor CAS", () => {
    const { store } = fixture();
    const review = plan();
    const created = store.create(review);

    expect(() =>
      store.decide(review.reviewId, {
        ...decisionRequest(review),
        expectedRevision: 1,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_ERROR.STALE }),
    );
    expect(() =>
      store.decide(review.reviewId, decisionRequest(review), {
        expectedCursor: { sequence: 0, digest: null },
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.STALE }),
    );

    const decided = store.decide(review.reviewId, decisionRequest(review), {
      expectedCursor: created.cursor,
    });
    expect(() =>
      store.transition(
        review.reviewId,
        {
          expectedRevision: 1,
          to: "prepared",
          preparedOid: OID.prepared,
          transitionEvidenceDigest: PREPARED_EVIDENCE,
        },
        { expectedCursor: created.cursor },
      ),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.STALE }),
    );
    expect(decided.cursor.sequence).toBe(2);
  });

  it("accepts a durable prefix anchor and rejects non-prefix/ahead anchors", () => {
    const { store } = fixture();
    const review = plan();
    const created = store.create(review);
    const decided = store.decide(review.reviewId, decisionRequest(review));

    expect(store.read({ anchor: created.cursor })).toEqual({
      reviews: [decided.review],
      cursor: decided.cursor,
    });
    expect(() =>
      store.read({
        anchor: { sequence: 1, digest: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.STALE }),
    );
    expect(() =>
      store.read({
        anchor: { sequence: 3, digest: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.STALE }),
    );

    const [firstEvent] = readEvents(store.filePath);
    writeFileSync(store.filePath, `${JSON.stringify(firstEvent)}\n`);
    expect(() => store.read({ anchor: decided.cursor })).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.STALE }),
    );
  });

  it("retains readable conflict evidence across store reopen and rejects dangling tampering", () => {
    const { filePath, store } = fixture();
    const review = plan();
    store.create(review);
    const decided = store.decide(review.reviewId, decisionRequest(review));
    const conflicts = conflictEvidence(decided.review);
    const conflicted = store.transition(review.reviewId, {
      expectedRevision: decided.review.revision,
      to: "conflicted",
      conflicts,
      conflictDigest: computeMergeReviewConflictsDigest(conflicts),
      transitionEvidenceDigest: PREPARED_EVIDENCE,
      at: "2026-08-14T01:00:02.000Z",
    });

    const reopened = new TeamMergeReviewStore({
      filePath,
      ensureOwnerOnlyFile: () => {},
    });
    expect(reopened.get(review.reviewId)).toMatchObject({
      state: "conflicted",
      conflicts,
    });

    const events = readEvents(filePath);
    const last = events.at(-1);
    last.review.conflicts[0].hunkIds = [`tmrh_${"0".repeat(32)}`];
    last.review.settlement.conflictDigest = computeMergeReviewConflictsDigest(
      last.review.conflicts,
    );
    last.review.evidenceDigest = computeMergeReviewEvidenceDigest(last.review);
    last.digest = computeTeamMergeReviewStoreEventDigest(last);
    writeFileSync(
      filePath,
      `${events.map((event) => canonicalMergeReviewJson(event)).join("\n")}\n`,
    );
    expect(conflicted.review.conflicts).toEqual(conflicts);
    expect(() => reopened.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );
  });

  it("fails closed for edited evidence and unknown event fields", () => {
    const edited = fixture();
    const review = plan();
    edited.store.create(review);
    edited.store.decide(review.reviewId, decisionRequest(review));
    const events = readEvents(edited.filePath);
    events[1].review.decision.reason = "forged";
    writeFileSync(
      edited.filePath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    expect(() => edited.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );

    const unknown = fixture();
    unknown.store.create(plan());
    const [event] = readEvents(unknown.filePath);
    event.unknownAuthority = true;
    event.digest = computeTeamMergeReviewStoreEventDigest(event);
    writeFileSync(unknown.filePath, `${JSON.stringify(event)}\n`);
    expect(() => unknown.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );

    const recoded = fixture();
    recoded.store.create(plan());
    const canonical = readFileSync(recoded.filePath, "utf8");
    writeFileSync(recoded.filePath, canonical.replace("{", "{ "));
    expect(() => recoded.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );
  });

  it("fails closed for reordered/deleted events and truncated final writes", () => {
    const reordered = fixture();
    const review = plan();
    reordered.store.create(review);
    reordered.store.decide(review.reviewId, decisionRequest(review));
    const events = readEvents(reordered.filePath).reverse();
    writeFileSync(
      reordered.filePath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    expect(() => reordered.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );

    const deleted = fixture();
    const deletedReview = plan();
    deleted.store.create(deletedReview);
    deleted.store.decide(
      deletedReview.reviewId,
      decisionRequest(deletedReview),
    );
    const [, second] = readEvents(deleted.filePath);
    writeFileSync(deleted.filePath, `${JSON.stringify(second)}\n`);
    expect(() => deleted.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );

    const truncated = fixture();
    truncated.store.create(plan());
    const complete = readFileSync(truncated.filePath);
    writeFileSync(
      truncated.filePath,
      complete.subarray(0, complete.length - 1),
    );
    expect(() => truncated.store.read()).toThrowError(
      expect.objectContaining({ code: TEAM_MERGE_REVIEW_STORE_ERROR.CORRUPT }),
    );
  });

  it("rejects a hard-linked store instead of accepting ambiguous ownership", () => {
    const { directory, filePath, store } = fixture();
    store.create(plan());
    linkSync(filePath, join(directory, "reviews-alias.jsonl"));

    expect(() => store.read()).toThrowError(
      expect.objectContaining({
        code: TEAM_MERGE_REVIEW_STORE_ERROR.UNSAFE_PATH,
      }),
    );
  });
});
