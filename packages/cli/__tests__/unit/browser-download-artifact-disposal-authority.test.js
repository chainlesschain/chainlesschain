import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_DOWNLOAD_ARTIFACT_DELETION_ACK_SCHEMA,
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
  captureBrowserDownloadArtifactDisposalAuthority,
  createBrowserDownloadArtifactDisposalAuthority,
} from "../../src/lib/evolution/browser-download-artifact-disposal-authority.js";

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

const NOW = "2026-09-20T04:00:00.000Z";

function descriptor() {
  return {
    schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
    authorityId: "download-disposal-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 10_000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
  };
}

function request({ core: coreOverrides = {}, ...overrides } = {}) {
  const inputCore = {
    operation: "discard-download-artifact",
    artifactRef: "quarantine:artifact-1",
    artifactDigest: digest("test", "artifact"),
    sourceActionReceiptDigest: digest("test", "download-receipt"),
    reason: "user-discard",
    ...coreOverrides,
  };
  return {
    schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
    requestId: "request-1",
    senderId: 17,
    frameUrlDigest: digest("test", "frame"),
    ...inputCore,
    inputDigest: digest(
      "chainlesschain.browser-download-artifact-disposal-input/v1",
      inputCore,
    ),
    authorization: { approval: "interactive" },
    requestedAt: NOW,
    ...overrides,
  };
}

function fixture(authorize = null) {
  const descriptorValue = descriptor();
  const authorizePort =
    authorize ??
    vi.fn(async () => ({
      decision: "allow",
      approvalEvidenceRef: "approval-1",
      validUntil: "2026-09-20T04:00:05.000Z",
    }));
  const disposeArtifact = vi.fn(async (value) => ({
    schema: BROWSER_DOWNLOAD_ARTIFACT_DELETION_ACK_SCHEMA,
    authorityId: descriptorValue.authorityId,
    tenantId: descriptorValue.tenantId,
    handlerArtifactDigest: descriptorValue.handlerArtifactDigest,
    actionReceiptDigest: value.actionReceiptDigest,
    requestDigest: value.requestDigest,
    artifactRef: value.artifactRef,
    artifactDigest: value.artifactDigest,
    sourceActionReceiptDigest: value.sourceActionReceiptDigest,
    discardedAt: "2026-09-20T04:00:01.000Z",
    deletionReceiptDigest: digest("test", "deletion"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    bytesUnavailable: true,
    qualifiesForPromotion: false,
  }));
  const port = captureBrowserDownloadArtifactDisposalAuthority(
    createBrowserDownloadArtifactDisposalAuthority({
      descriptor: descriptorValue,
      authorize: authorizePort,
      disposeArtifact,
      now: () => Date.parse(NOW),
    }),
  );
  return { authorizePort, disposeArtifact, port };
}

describe("browser download artifact disposal authority", () => {
  it("authorizes one exact artifact disposal and returns redacted durable evidence", async () => {
    const { authorizePort, disposeArtifact, port } = fixture();
    const receipt = await port.authorizeDisposal(request());
    expect(receipt).toMatchObject({
      operation: "discard-download-artifact",
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      artifactDigest: request().artifactDigest,
      effectMode: "irreversible-byte-disposal",
    });
    expect(JSON.stringify(receipt)).not.toContain("quarantine:artifact-1");
    expect(authorizePort).toHaveBeenCalledWith(
      expect.objectContaining({ artifactRef: "quarantine:artifact-1" }),
    );
    const result = await port.disposeAuthorizedArtifact({
      receiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
    });
    expect(disposeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactRef: "quarantine:artifact-1",
        artifactDigest: request().artifactDigest,
        reason: "user-discard",
      }),
    );
    expect(result).toMatchObject({
      status: "discarded",
      artifactRefDigest: receipt.artifactRefDigest,
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
      resultDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toContain("quarantine:artifact-1");
  });

  it.each([
    request({ core: { artifactRef: "../../artifact" } }),
    request({ core: { artifactRef: "artifact-1" } }),
    request({ core: { reason: "unknown" } }),
    request({ core: { artifactDigest: "sha256:bad" } }),
    request({ inputDigest: digest("test", "substituted") }),
  ])("rejects invalid disposal bindings before policy", async (invalid) => {
    const { authorizePort, port } = fixture();
    await expect(port.authorizeDisposal(invalid)).rejects.toThrow();
    expect(authorizePort).not.toHaveBeenCalled();
  });

  it("rejects substituted or replayed execution grants", async () => {
    const { port } = fixture();
    const receipt = await port.authorizeDisposal(request());
    await expect(
      port.disposeAuthorizedArtifact({
        receiptDigest: receipt.receiptDigest,
        requestDigest: digest("test", "substituted"),
      }),
    ).rejects.toThrow(/invalid or spent/u);
    await expect(
      port.disposeAuthorizedArtifact({
        receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
      }),
    ).resolves.toMatchObject({ status: "discarded" });
    await expect(
      port.disposeAuthorizedArtifact({
        receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
      }),
    ).rejects.toThrow(/invalid or spent/u);
  });

  it("denies without invoking artifact custody", async () => {
    const { disposeArtifact, port } = fixture(async () => ({
      decision: "deny",
      reason: "artifact custody does not belong to this task",
    }));
    await expect(port.authorizeDisposal(request())).rejects.toMatchObject({
      code: "BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DENIED",
    });
    expect(disposeArtifact).not.toHaveBeenCalled();
  });
});
