import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createPmExplorationReceiptAuthority,
  createPmExplorationReceiptSigner,
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  issuePmExplorationReceipt,
  verifyPmExplorationReceipt,
} from "../../src/lib/evolution/pm-exploration-receipts.js";

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function signer(role, suffix = role) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createPmExplorationReceiptSigner({
    role,
    authorityId: `${role}-authority-${suffix}`,
    revision: 1,
    handlerArtifactDigest: sha(`${role}${suffix}`),
    privateKey,
    publicKey,
  });
}

const METRICS = Object.freeze({ tokens: 3, toolCalls: 1, wallClockMs: 5 });
const ISSUED_AT = "2026-09-18T00:00:00.000Z";

function payload(role) {
  if (role === "execution") {
    return {
      planDigest: sha("plan"),
      environmentDigest: sha("environment"),
      requestDigest: sha("request"),
      roundId: "round-one",
      stage: "broad",
      branchId: "workflow",
      taskId: "task-one",
      inputMemoryDigest: sha("input"),
      outputMemoryDigest: sha("output"),
      traceDigest: sha("trace"),
      status: "succeeded",
      failureClass: "none",
      metrics: METRICS,
      issuedAt: ISSUED_AT,
    };
  }
  if (role === "grader") {
    return {
      planDigest: sha("plan"),
      environmentDigest: sha("environment"),
      requestDigest: sha("request"),
      roundId: "round-one",
      executionReceiptDigest: sha("execution"),
      outputMemoryDigest: sha("output"),
      decision: "accept",
      scoreBasisPoints: 9000,
      resultDigest: sha("result"),
      metrics: METRICS,
      issuedAt: ISSUED_AT,
    };
  }
  if (role === "merge") {
    return {
      planDigest: sha("plan"),
      environmentDigest: sha("environment"),
      requestDigest: sha("request"),
      mergeId: "merge-one",
      branchCheckpoints: [
        {
          branchId: "workflow",
          checkpointDigest: sha("checkpoint"),
          memoryDigest: sha("memory"),
        },
      ],
      outputMemoryDigest: sha("output"),
      conflictResolutionDigest: sha("conflict"),
      status: "succeeded",
      failureClass: "none",
      metrics: METRICS,
      issuedAt: ISSUED_AT,
    };
  }
  return {
    planDigest: sha("plan"),
    environmentDigest: sha("environment"),
    requestDigest: sha("request"),
    mergeReceiptDigest: sha("merge"),
    finalCheckpointDigest: sha("checkpoint"),
    finalMemoryDigest: sha("memory"),
    decision: "accept",
    scoreBasisPoints: 9500,
    evaluationDigest: sha("evaluation"),
    metrics: METRICS,
    issuedAt: ISSUED_AT,
  };
}

describe("PM exploration signed receipts", () => {
  it.each(["execution", "grader", "merge", "evaluator"])(
    "issues and verifies a %s receipt with exact payload bindings",
    (role) => {
      const receiptSigner = signer(role);
      const authority = getPmExplorationReceiptSignerAuthority(receiptSigner);
      const receipt = issuePmExplorationReceipt(receiptSigner, payload(role));
      const verified = verifyPmExplorationReceipt(authority, receipt, {
        planDigest: sha("plan"),
        environmentDigest: sha("environment"),
        requestDigest: sha("request"),
      });

      expect(verified.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(verified.authenticated).toBe(true);
      expect(Object.isFrozen(verified.payload)).toBe(true);
      expect(inspectPmExplorationReceiptAuthority(receiptSigner).role).toBe(
        role,
      );
    },
  );

  it("rejects payload, authority, digest, and signature substitution", () => {
    const receiptSigner = signer("execution", "primary");
    const authority = getPmExplorationReceiptSignerAuthority(receiptSigner);
    const receipt = issuePmExplorationReceipt(
      receiptSigner,
      payload("execution"),
    );

    const changedPayload = structuredClone(receipt);
    changedPayload.payload.taskId = "task-other";
    expect(() => verifyPmExplorationReceipt(authority, changedPayload)).toThrow(
      /digest mismatch/,
    );

    const changedDigest = structuredClone(receipt);
    changedDigest.receiptDigest = sha("other");
    expect(() => verifyPmExplorationReceipt(authority, changedDigest)).toThrow(
      /digest mismatch/,
    );

    const changedSignature = structuredClone(receipt);
    changedSignature.signature = `${receipt.signature.slice(0, -1)}${
      receipt.signature.endsWith("A") ? "B" : "A"
    }`;
    expect(() =>
      verifyPmExplorationReceipt(authority, changedSignature),
    ).toThrow(/signature rejected|signature is invalid/);

    const otherAuthority = getPmExplorationReceiptSignerAuthority(
      signer("execution", "other"),
    );
    expect(() => verifyPmExplorationReceipt(otherAuthority, receipt)).toThrow(
      /authority binding mismatch/,
    );
  });

  it("keeps verification authorities public-key-only and rejects mismatched keys", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    expect(() =>
      createPmExplorationReceiptSigner({
        role: "grader",
        authorityId: "grader-authority",
        revision: 1,
        handlerArtifactDigest: sha("grader"),
        privateKey: first.privateKey,
        publicKey: second.publicKey,
      }),
    ).toThrow(/key pair does not match/);

    const authority = createPmExplorationReceiptAuthority({
      role: "grader",
      authorityId: "grader-public-authority",
      revision: 1,
      handlerArtifactDigest: sha("public"),
      publicKey: first.publicKey,
    });
    expect(inspectPmExplorationReceiptAuthority(authority).role).toBe("grader");
    expect(() =>
      issuePmExplorationReceipt(authority, payload("grader")),
    ).toThrow(/signer is required/);
  });

  it("rejects accessor-backed payloads before signing", () => {
    const receiptSigner = signer("execution");
    const value = payload("execution");
    Object.defineProperty(value, "taskId", {
      enumerable: true,
      get: () => "task-one",
    });
    expect(() => issuePmExplorationReceipt(receiptSigner, value)).toThrow(
      /accessor fields/,
    );
  });
});
