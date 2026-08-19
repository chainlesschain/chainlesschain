import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";
import {
  createExecutionLocationResultBundle,
  verifyExecutionLocationResultBundle,
} from "../../src/lib/execution-location-result.js";
import {
  EXECUTION_LOCATION_RESULT_REVIEW_SCHEMA,
  createExecutionLocationResultReview,
} from "../../src/lib/execution-location-result-review.js";
import { storeExecutionLocationResultBundle } from "../../src/lib/execution-location-result-store.js";

const DIGEST = `sha256:${"1".repeat(64)}`;

function authority() {
  const source = {
    sessionId: "result-review-session-1",
    headHash: "a".repeat(64),
    eventCount: 3,
    transcriptDigest: `sha256:${"2".repeat(64)}`,
  };
  const targetBinding = createExecutionLocationBinding({
    location: "container",
    observed: true,
    observedAt: "2026-08-18T16:00:00.000Z",
    source: {
      cwd: "/target/repo",
      git: { root: "/target/repo", commit: "b".repeat(40) },
    },
    runtime: { platform: "linux", arch: "x64", tools: ["node"] },
  });
  const handoff = {
    schema: "chainlesschain.session-execution-location-handoff/v1",
    handoffId: `sha256:${"3".repeat(64)}`,
    source,
    target: {
      profileDigest: DIGEST,
      targetEvidenceId: "container-evidence-review-1",
      targetFactsDigest: `sha256:${"4".repeat(64)}`,
      attestationDigest: `sha256:${"5".repeat(64)}`,
      binding: targetBinding,
    },
    eventHash: "c".repeat(64),
    eventCount: 4,
  };
  return {
    authority: "verified-session-location-handoff",
    sessionId: source.sessionId,
    headHash: "d".repeat(64),
    eventCount: 6,
    bindingEventHash: handoff.eventHash,
    bindingEventCount: handoff.eventCount,
    locationHandoff: handoff,
    binding: targetBinding,
  };
}

function bundle(summary = "private review summary") {
  return createExecutionLocationResultBundle({
    sessionAuthority: authority(),
    resultId: "review-result-1",
    summaryBytes: Buffer.from(summary, "utf8"),
    diffBytes: Buffer.from("diff --git a/secret b/secret\n", "utf8"),
    artifacts: [
      {
        mediaType: "application/json",
        bytes: Buffer.from('{"private":"artifact"}', "utf8"),
      },
    ],
    evidence: [
      { mediaType: "text/plain", bytes: Buffer.from("private evidence") },
    ],
  });
}

function settlement(expectedBundle, storage) {
  const verification = verifyExecutionLocationResultBundle({
    bundle: expectedBundle,
    sourceAuthority: {
      sessionId: expectedBundle.session.sessionId,
      headHash: expectedBundle.session.source.headHash,
      eventCount: expectedBundle.session.source.eventCount,
    },
    expectedHandoffId: expectedBundle.session.handoffId,
  });
  return {
    schema:
      "chainlesschain.session-execution-location-result-collection-receipt/v2",
    sessionId: expectedBundle.session.sessionId,
    settlementId: `sha256:${"6".repeat(64)}`,
    requestId: "review-request-1",
    requestDigest: `sha256:${"7".repeat(64)}`,
    resultId: expectedBundle.resultId,
    handoffId: expectedBundle.session.handoffId,
    sourceHeadHash: expectedBundle.session.source.headHash,
    sourceEventCount: expectedBundle.session.source.eventCount,
    settlementEventHash: "e".repeat(64),
    settlementEventCount: expectedBundle.session.source.eventCount + 1,
    targetHeadHash: expectedBundle.session.target.headHash,
    targetEventCount: expectedBundle.session.target.eventCount,
    bundleDigest: expectedBundle.bundleDigest,
    verificationDigest: verification.verificationDigest,
    collectionDigest: `sha256:${"8".repeat(64)}`,
    storage,
    totalBytes: expectedBundle.totalBytes,
    applied: false,
    receiptDigest: `sha256:${"9".repeat(64)}`,
  };
}

describe("execution-location stored result review", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-result-review-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates deterministic content-free review authority", () => {
    const expectedBundle = bundle();
    const stored = storeExecutionLocationResultBundle(expectedBundle, { dir });
    const review = createExecutionLocationResultReview({
      settlement: settlement(expectedBundle, stored.receipt),
      bundle: expectedBundle,
    });

    expect(review).toMatchObject({
      schema: EXECUTION_LOCATION_RESULT_REVIEW_SCHEMA,
      sessionId: "result-review-session-1",
      requestId: "review-request-1",
      resultId: "review-result-1",
      bundleDigest: expectedBundle.bundleDigest,
      summary: {
        mediaType: "text/plain",
        byteLength: Buffer.byteLength("private review summary"),
      },
      diff: { mediaType: "text/x-diff" },
      artifacts: [{ mediaType: "application/json" }],
      evidence: [{ mediaType: "text/plain" }],
      applied: false,
      applyPolicy: {
        automaticApply: false,
        requirements: [
          "explicit-review-digest",
          "exact-source-git-identity",
          "managed-workspace-transaction",
          "session-apply-reservation",
        ],
      },
    });
    expect(review.reviewDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      createExecutionLocationResultReview({
        settlement: settlement(expectedBundle, stored.receipt),
        bundle: expectedBundle,
      }),
    ).toEqual(review);
    const json = JSON.stringify(review);
    expect(json).not.toContain("contentBase64");
    expect(json).not.toContain("private review summary");
    expect(json).not.toContain("diff --git");
    expect(json).not.toContain("private evidence");
    expect(json).not.toContain("/target/repo");
  });

  it("changes the review digest when reviewed bytes change", () => {
    const firstBundle = bundle("private review summary");
    const secondBundle = bundle("changed review summary");
    const firstStore = storeExecutionLocationResultBundle(firstBundle, { dir });
    const secondStore = storeExecutionLocationResultBundle(secondBundle, {
      dir,
    });
    const first = createExecutionLocationResultReview({
      settlement: settlement(firstBundle, firstStore.receipt),
      bundle: firstBundle,
    });
    const second = createExecutionLocationResultReview({
      settlement: settlement(secondBundle, secondStore.receipt),
      bundle: secondBundle,
    });
    expect(second.reviewDigest).not.toBe(first.reviewDigest);
    expect(second.summary.digest).not.toBe(first.summary.digest);
  });

  it("rejects settlement, stored authority, and content drift", () => {
    const expectedBundle = bundle();
    const stored = storeExecutionLocationResultBundle(expectedBundle, { dir });
    const expectedSettlement = settlement(expectedBundle, stored.receipt);

    expect(() =>
      createExecutionLocationResultReview({
        settlement: {
          ...expectedSettlement,
          bundleDigest: `sha256:${"0".repeat(64)}`,
        },
        bundle: expectedBundle,
      }),
    ).toThrow(/does not match settlement authority/u);
    expect(() =>
      createExecutionLocationResultReview({
        settlement: {
          ...expectedSettlement,
          storage: {
            ...stored.receipt,
            resultId: "another-result",
          },
        },
        bundle: expectedBundle,
      }),
    ).toThrow(/receipt is invalid/u);

    const tampered = structuredClone(expectedBundle);
    tampered.summary.contentBase64 = Buffer.from("tampered").toString("base64");
    expect(() =>
      createExecutionLocationResultReview({
        settlement: expectedSettlement,
        bundle: tampered,
      }),
    ).toThrow(/bytes or digest/u);
  });
});
