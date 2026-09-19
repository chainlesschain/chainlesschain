import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_TAB_OPEN_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_TAB_OPEN_ACTION_OUTCOME_ACK_SCHEMA,
  BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA,
  BROWSER_TAB_OPEN_ACTION_REQUEST_SCHEMA,
  captureBrowserTabOpenActionAuthority,
  createBrowserTabOpenActionAuthority,
} from "../../src/lib/evolution/browser-tab-open-action-authority.js";

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
    schema: BROWSER_TAB_OPEN_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "tab-open-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 10_000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  };
}

function request({ core: coreOverrides = {}, ...overrides } = {}) {
  const inputCore = {
    profileName: "default",
    operation: "open-tab",
    destinationUrl: "https://example.test/path",
    allowedRedirectOrigins: ["https://example.test"],
    waitUntil: "domcontentloaded",
    timeout: 30_000,
    ...coreOverrides,
  };
  return {
    schema: BROWSER_TAB_OPEN_ACTION_REQUEST_SCHEMA,
    requestId: "request-1",
    ...inputCore,
    senderId: 17,
    frameUrlDigest: digest("test", "frame"),
    inputDigest: digest(
      "chainlesschain.browser-tab-open-action-input/v1",
      inputCore,
    ),
    authorization: { approval: "interactive" },
    requestedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function fixture(authorize = null) {
  const descriptorValue = descriptor();
  const recordOutcome = vi.fn(async (value) => ({
    schema: BROWSER_TAB_OPEN_ACTION_OUTCOME_ACK_SCHEMA,
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
  }));
  const authorizePort =
    authorize ??
    vi.fn(async () => ({
      decision: "allow",
      approvalEvidenceRef: "approval-1",
      validUntil: "2026-09-20T00:00:05.000Z",
    }));
  const port = captureBrowserTabOpenActionAuthority(
    createBrowserTabOpenActionAuthority({
      descriptor: descriptorValue,
      authorize: authorizePort,
      recordOutcome,
      now: () => Date.parse("2026-09-20T00:00:00.000Z"),
    }),
  );
  return { port, authorizePort, recordOutcome };
}

describe("browser tab open action authority", () => {
  it("authorizes one destination-bound tab and durably settles its outcome", async () => {
    const { port, authorizePort, recordOutcome } = fixture();
    const receipt = await port.authorizeAction(request());
    expect(receipt).toMatchObject({
      profileName: "default",
      operation: "open-tab",
      destinationDigest: expect.stringMatching(/^sha256:/u),
      redirectOriginsDigest: expect.stringMatching(/^sha256:/u),
      inputDigest: request().inputDigest,
    });
    expect(JSON.stringify(receipt)).not.toContain("https://example.test/path");
    expect(authorizePort).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUrl: "https://example.test/path",
        allowedRedirectOrigins: ["https://example.test"],
      }),
    );

    await expect(
      port.recordActionOutcome({
        schema: BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA,
        actionReceiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
        profileName: receipt.profileName,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        status: "succeeded",
        resultDigest: digest("test", "result"),
        recordedAt: "2026-09-20T00:00:01.000Z",
      }),
    ).resolves.toMatchObject({ durable: true, readbackVerified: true });
    expect(recordOutcome).toHaveBeenCalledOnce();
  });

  it.each([
    request({ core: { destinationUrl: "file:///secret" } }),
    request({ core: { destinationUrl: "https://user:pass@example.test/" } }),
    request({ core: { allowedRedirectOrigins: ["https://other.test"] } }),
    request({ inputDigest: digest("test", "wrong") }),
  ])("rejects invalid destination scope before policy", async (invalid) => {
    const { port, authorizePort } = fixture();
    await expect(port.authorizeAction(invalid)).rejects.toThrow();
    expect(authorizePort).not.toHaveBeenCalled();
  });

  it("denies without issuing a receipt", async () => {
    const { port } = fixture(async () => ({
      decision: "deny",
      reason: "new tabs are outside the approved task",
    }));
    await expect(port.authorizeAction(request())).rejects.toMatchObject({
      code: "BROWSER_TAB_OPEN_ACTION_DENIED",
    });
  });

  it("rejects substituted or replayed outcome bindings", async () => {
    const { port } = fixture();
    const receipt = await port.authorizeAction(request());
    const outcome = {
      schema: BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA,
      actionReceiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
      profileName: receipt.profileName,
      operation: receipt.operation,
      inputDigest: receipt.inputDigest,
      status: "failed",
      resultDigest: digest("test", "failure"),
      recordedAt: "2026-09-20T00:00:01.000Z",
    };
    await expect(
      port.recordActionOutcome({ ...outcome, profileName: "other" }),
    ).rejects.toThrow(/differs/u);
    await expect(port.recordActionOutcome(outcome)).resolves.toMatchObject({
      authenticated: true,
    });
    await expect(port.recordActionOutcome(outcome)).rejects.toThrow(/differs/u);
  });
});
