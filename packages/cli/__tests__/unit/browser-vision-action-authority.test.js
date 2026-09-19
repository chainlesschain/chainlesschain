import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_VISION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_VISION_ACTION_OUTCOME_ACK_SCHEMA,
  BROWSER_VISION_ACTION_OUTCOME_REQUEST_SCHEMA,
  BROWSER_VISION_ACTION_REQUEST_SCHEMA,
  BROWSER_VISION_ACTION_RECEIPT_SCHEMA,
  captureBrowserVisionActionAuthority,
  createBrowserVisionActionAuthority,
} from "../../src/lib/evolution/browser-vision-action-authority.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function descriptor() {
  return {
    schema: BROWSER_VISION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "browser-action-test",
    tenantId: "tenant-test",
    handlerArtifactDigest: digest("handler"),
    policyRevision: "policy-8",
    maxGrantTtlMs: 5000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  };
}

function outcomeRecorder() {
  return vi.fn(async (value) => ({
    schema: BROWSER_VISION_ACTION_OUTCOME_ACK_SCHEMA,
    authorityId: descriptor().authorityId,
    tenantId: descriptor().tenantId,
    handlerArtifactDigest: descriptor().handlerArtifactDigest,
    actionReceiptDigest: value.actionReceiptDigest,
    outcomeRequestDigest: value.outcomeRequestDigest,
    auditEventDigest: digest(`audit:${value.outcomeRequestDigest}`),
    durabilityReceiptDigest: digest(`durable:${value.outcomeRequestDigest}`),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  }));
}

function request(overrides = {}) {
  return {
    schema: BROWSER_VISION_ACTION_REQUEST_SCHEMA,
    requestId: "request-1",
    targetId: "tab-1",
    operation: "visual-click",
    senderId: 17,
    frameUrlDigest: digest("https://desktop.local"),
    inputDigest: digest("click-input"),
    observationReceiptDigest: digest("observation-receipt"),
    authorization: { approval: "private-token" },
    requestedAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("browser vision action authority", () => {
  it("returns an interactive digest-bound receipt without leaking approval material", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decision: "allow",
      approvalEvidenceRef: "did:example:operator#approval-1",
      validUntil: "2026-09-19T12:00:04.000Z",
    });
    const recordOutcome = outcomeRecorder();
    const authority = createBrowserVisionActionAuthority({
      descriptor: descriptor(),
      authorize,
      recordOutcome,
      now: () => Date.parse("2026-09-19T12:00:00.000Z"),
    });
    const port = captureBrowserVisionActionAuthority(authority);

    const receipt = await port.authorizeAction(request());

    expect(receipt).toMatchObject({
      schema: BROWSER_VISION_ACTION_RECEIPT_SCHEMA,
      authorityId: "browser-action-test",
      tenantId: "tenant-test",
      approvalMode: "interactive",
      operation: "visual-click",
      observationReceiptDigest: digest("observation-receipt"),
      handlerArtifactDigest: descriptor().handlerArtifactDigest,
    });
    expect(receipt.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.authorizationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain("private-token");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: { approval: "private-token" },
        observationReceiptDigest: digest("observation-receipt"),
        requestDigest: receipt.requestDigest,
      }),
    );
    expect(Object.keys(authority)).toEqual([]);

    const outcomeRequest = {
      schema: BROWSER_VISION_ACTION_OUTCOME_REQUEST_SCHEMA,
      actionReceiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
      targetId: receipt.targetId,
      operation: receipt.operation,
      inputDigest: receipt.inputDigest,
      observationReceiptDigest: receipt.observationReceiptDigest,
      status: "succeeded",
      resultDigest: digest("click-result"),
      recordedAt: "2026-09-19T12:00:01.000Z",
    };
    const acknowledgement = await port.recordActionOutcome(outcomeRequest);
    expect(acknowledgement).toMatchObject({
      authenticated: true,
      durable: true,
      readbackVerified: true,
      qualifiesForPromotion: false,
    });
    expect(recordOutcome).toHaveBeenCalledOnce();
    await expect(port.recordActionOutcome(outcomeRequest)).rejects.toThrow(
      /differs from its authorization/u,
    );
  });

  it("fails closed on denial, non-interactive descriptors, expiry, and unsupported actions", async () => {
    expect(() =>
      createBrowserVisionActionAuthority({
        descriptor: { ...descriptor(), approvalMode: "automatic" },
        authorize: async () => ({ decision: "deny" }),
        recordOutcome: outcomeRecorder(),
      }),
    ).toThrow(/descriptor is invalid/u);

    const denied = captureBrowserVisionActionAuthority(
      createBrowserVisionActionAuthority({
        descriptor: descriptor(),
        authorize: async () => ({ decision: "deny", reason: "not approved" }),
        recordOutcome: outcomeRecorder(),
      }),
    );
    await expect(denied.authorizeAction(request())).rejects.toMatchObject({
      code: "BROWSER_VISION_ACTION_DENIED",
    });

    const expired = captureBrowserVisionActionAuthority(
      createBrowserVisionActionAuthority({
        descriptor: descriptor(),
        authorize: async () => ({
          decision: "allow",
          approvalEvidenceRef: "expired",
          validUntil: "2026-09-19T12:00:00.000Z",
        }),
        recordOutcome: outcomeRecorder(),
        now: () => Date.parse("2026-09-19T12:00:00.000Z"),
      }),
    );
    await expect(expired.authorizeAction(request())).rejects.toThrow(
      /decision is invalid/u,
    );
    await expect(
      expired.authorizeAction(request({ operation: "type" })),
    ).rejects.toThrow(/request is invalid/u);
    expect(() => captureBrowserVisionActionAuthority({})).toThrow(/branded/u);
  });

  it("issues and settles an independently bound visual type action", async () => {
    const recordOutcome = outcomeRecorder();
    const port = captureBrowserVisionActionAuthority(
      createBrowserVisionActionAuthority({
        descriptor: descriptor(),
        authorize: async () => ({
          decision: "allow",
          approvalEvidenceRef: "did:example:operator#type-approval",
          validUntil: "2026-09-19T12:00:04.000Z",
        }),
        recordOutcome,
        now: () => Date.parse("2026-09-19T12:00:00.000Z"),
      }),
    );
    const receipt = await port.authorizeAction(
      request({
        requestId: "request-type-1",
        operation: "visual-type",
        inputDigest: digest("type-input"),
      }),
    );
    expect(receipt).toMatchObject({
      operation: "visual-type",
      inputDigest: digest("type-input"),
      observationReceiptDigest: digest("observation-receipt"),
    });
    await expect(
      port.recordActionOutcome({
        schema: BROWSER_VISION_ACTION_OUTCOME_REQUEST_SCHEMA,
        actionReceiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
        targetId: receipt.targetId,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        observationReceiptDigest: receipt.observationReceiptDigest,
        status: "succeeded",
        resultDigest: digest("redacted-type-result"),
        recordedAt: "2026-09-19T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ durable: true, readbackVerified: true });
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "visual-type" }),
    );
  });

  it("does not invoke accessor decision fields", async () => {
    const getter = vi.fn(() => "allow");
    const port = captureBrowserVisionActionAuthority(
      createBrowserVisionActionAuthority({
        descriptor: descriptor(),
        authorize: async () =>
          Object.defineProperty({}, "decision", {
            enumerable: true,
            get: getter,
          }),
        recordOutcome: outcomeRecorder(),
      }),
    );
    await expect(port.authorizeAction(request())).rejects.toThrow(
      /plain data/u,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
