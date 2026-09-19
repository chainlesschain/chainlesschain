import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_NAVIGATION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_NAVIGATION_ACTION_OUTCOME_ACK_SCHEMA,
  BROWSER_NAVIGATION_ACTION_OUTCOME_REQUEST_SCHEMA,
  BROWSER_NAVIGATION_ACTION_REQUEST_SCHEMA,
  captureBrowserNavigationActionAuthority,
  createBrowserNavigationActionAuthority,
} from "../../src/lib/evolution/browser-navigation-action-authority.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;

function descriptor() {
  return {
    schema: BROWSER_NAVIGATION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "navigation-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 10_000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  };
}

function request(overrides = {}) {
  const inputCore = {
    targetId: "tab-1",
    operation: "navigate",
    destinationUrl: "https://example.test/path?private=value",
    allowedRedirectOrigins: ["https://example.test"],
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  };
  return {
    schema: BROWSER_NAVIGATION_ACTION_REQUEST_SCHEMA,
    requestId: "request-1",
    targetId: inputCore.targetId,
    operation: inputCore.operation,
    senderId: 17,
    frameUrlDigest: digest("test", "frame"),
    destinationUrl: inputCore.destinationUrl,
    allowedRedirectOrigins: inputCore.allowedRedirectOrigins,
    waitUntil: inputCore.waitUntil,
    timeout: inputCore.timeout,
    inputDigest: digest(
      "chainlesschain.browser-navigation-action-input/v2",
      inputCore,
    ),
    authorization: { approval: "interactive" },
    requestedAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

function outcomeRecorder(descriptorValue, spy = vi.fn()) {
  const recordOutcome = vi.fn(async (value) => {
    spy(value);
    return {
      schema: BROWSER_NAVIGATION_ACTION_OUTCOME_ACK_SCHEMA,
      authorityId: descriptorValue.authorityId,
      tenantId: descriptorValue.tenantId,
      handlerArtifactDigest: descriptorValue.handlerArtifactDigest,
      actionReceiptDigest: value.actionReceiptDigest,
      outcomeRequestDigest: value.outcomeRequestDigest,
      auditEventDigest: digest("test", `audit:${value.resultDigest}`),
      durabilityReceiptDigest: digest("test", `durable:${value.resultDigest}`),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      qualifiesForPromotion: false,
    };
  });
  return { recordOutcome, spy };
}

describe("browser navigation action authority", () => {
  it("authorizes one URL-bound action and durably settles its outcome", async () => {
    const descriptorValue = descriptor();
    const authorize = vi.fn(async ({ destinationUrl }) => {
      expect(destinationUrl).toBe("https://example.test/path?private=value");
      return {
        decision: "allow",
        approvalEvidenceRef: "approval-1",
        validUntil: "2026-09-19T12:00:05.000Z",
      };
    });
    const { recordOutcome, spy } = outcomeRecorder(descriptorValue);
    const port = captureBrowserNavigationActionAuthority(
      createBrowserNavigationActionAuthority({
        descriptor: descriptorValue,
        authorize,
        recordOutcome,
        now: () => Date.parse("2026-09-19T12:00:00.000Z"),
      }),
    );

    const receipt = await port.authorizeAction(request());
    expect(receipt).toMatchObject({
      targetId: "tab-1",
      operation: "navigate",
      destinationDigest: expect.stringMatching(/^sha256:/u),
      inputDigest: request().inputDigest,
    });
    expect(JSON.stringify(receipt)).not.toContain("private=value");

    await expect(
      port.recordActionOutcome({
        schema: BROWSER_NAVIGATION_ACTION_OUTCOME_REQUEST_SCHEMA,
        actionReceiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
        targetId: receipt.targetId,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        status: "succeeded",
        resultDigest: digest("test", "navigation-result"),
        recordedAt: "2026-09-19T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ durable: true, readbackVerified: true });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("rejects unsafe schemes, credentials, and substituted input digests", async () => {
    const descriptorValue = descriptor();
    const authorize = vi.fn();
    const { recordOutcome } = outcomeRecorder(descriptorValue);
    const port = captureBrowserNavigationActionAuthority(
      createBrowserNavigationActionAuthority({
        descriptor: descriptorValue,
        authorize,
        recordOutcome,
      }),
    );

    await expect(
      port.authorizeAction(
        request({ destinationUrl: "file:///private/secret.txt" }),
      ),
    ).rejects.toThrow(/destination/u);
    await expect(
      port.authorizeAction(
        request({ destinationUrl: "https://user:pass@example.test/" }),
      ),
    ).rejects.toThrow(/destination/u);
    await expect(
      port.authorizeAction(request({ inputDigest: digest("test", "wrong") })),
    ).rejects.toThrow(/request/u);
    await expect(
      port.authorizeAction(
        request({ allowedRedirectOrigins: ["https://different.test"] }),
      ),
    ).rejects.toThrow(/redirect origins/u);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("denies without issuing a receipt", async () => {
    const descriptorValue = descriptor();
    const { recordOutcome } = outcomeRecorder(descriptorValue);
    const port = captureBrowserNavigationActionAuthority(
      createBrowserNavigationActionAuthority({
        descriptor: descriptorValue,
        authorize: async () => ({
          decision: "deny",
          reason: "domain is outside the approved task scope",
        }),
        recordOutcome,
      }),
    );

    await expect(port.authorizeAction(request())).rejects.toMatchObject({
      code: "BROWSER_NAVIGATION_ACTION_DENIED",
    });
  });

  it("rejects replayed or substituted outcome binding", async () => {
    const descriptorValue = descriptor();
    const { recordOutcome } = outcomeRecorder(descriptorValue);
    const port = captureBrowserNavigationActionAuthority(
      createBrowserNavigationActionAuthority({
        descriptor: descriptorValue,
        authorize: async () => ({
          decision: "allow",
          approvalEvidenceRef: "approval-1",
          validUntil: "2026-09-19T12:00:05.000Z",
        }),
        recordOutcome,
        now: () => Date.parse("2026-09-19T12:00:00.000Z"),
      }),
    );
    const receipt = await port.authorizeAction(request());
    const outcome = {
      schema: BROWSER_NAVIGATION_ACTION_OUTCOME_REQUEST_SCHEMA,
      actionReceiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
      targetId: receipt.targetId,
      operation: receipt.operation,
      inputDigest: receipt.inputDigest,
      status: "failed",
      resultDigest: digest("test", "failure"),
      recordedAt: "2026-09-19T12:00:01.000Z",
    };

    await expect(
      port.recordActionOutcome({ ...outcome, targetId: "tab-2" }),
    ).rejects.toThrow(/differs/u);
    await expect(port.recordActionOutcome(outcome)).resolves.toMatchObject({
      authenticated: true,
    });
    await expect(port.recordActionOutcome(outcome)).rejects.toThrow(/differs/u);
  });
});
