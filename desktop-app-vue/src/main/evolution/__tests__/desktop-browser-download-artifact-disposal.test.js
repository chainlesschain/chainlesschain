import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserDownloadArtifactDisposal,
  createDesktopBrowserDownloadArtifactDisposalHost,
  executeDesktopBrowserDownloadArtifactDisposal,
} = require("../desktop-browser-download-artifact-disposal");

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

function fixture() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "desktop-disposal",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
  });
  const authorizeDisposal = vi.fn(async (request) => ({
    schema: "chainlesschain.browser-download-artifact-disposal-receipt/v1",
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    approvalMode: descriptor.approvalMode,
    auditMode: descriptor.auditMode,
    effectMode: descriptor.effectMode,
    requestId: request.requestId,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    operation: request.operation,
    artifactRefDigest: digest(
      "chainlesschain.browser-download-artifact-ref/v1",
      request.artifactRef,
    ),
    artifactDigest: request.artifactDigest,
    sourceActionReceiptDigest: request.sourceActionReceiptDigest,
    reason: request.reason,
    inputDigest: request.inputDigest,
    requestDigest: digest("test", `request:${request.requestId}`),
    validUntil: new Date(Date.now() + 5000).toISOString(),
    receiptDigest: digest("test", request.requestId),
  }));
  const disposeAuthorizedArtifact = vi.fn(async () => {
    const core = {
      status: "discarded",
      artifactRefDigest: digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        "quarantine:artifact-1",
      ),
      artifactDigest: digest("test", "artifact"),
      sourceActionReceiptDigest: digest("test", "source-receipt"),
      reason: "user-discard",
      discardedAt: new Date().toISOString(),
      deletionReceiptDigest: digest("test", "deletion"),
    };
    return {
      ...core,
      resultDigest: digest(
        "chainlesschain.browser-download-artifact-disposal-result/v1",
        core,
      ),
    };
  });
  const host = createDesktopBrowserDownloadArtifactDisposalHost(
    authority,
    (value) => {
      if (value !== authority) throw new TypeError("unbranded");
      return Object.freeze({
        descriptor,
        authorizeDisposal,
        disposeAuthorizedArtifact,
      });
    },
  );
  return { authorizeDisposal, disposeAuthorizedArtifact, host };
}

const artifactDigest = digest("test", "artifact");
const sourceActionReceiptDigest = digest("test", "source-receipt");

async function authorize(host, options = {}) {
  return authorizeDesktopBrowserDownloadArtifactDisposal(host, {
    artifactRef: "quarantine:artifact-1",
    artifactDigest,
    sourceActionReceiptDigest,
    options,
    senderId: 17,
    frameUrl: "app://desktop/index.html",
  });
}

describe("Desktop browser download artifact disposal host", () => {
  it("binds and executes one irreversible artifact disposal", async () => {
    const { authorizeDisposal, disposeAuthorizedArtifact, host } = fixture();
    const grant = await authorize(host, {
      actionAuthorization: { approval: "interactive" },
    });
    expect(authorizeDisposal).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactRef: "quarantine:artifact-1",
        artifactDigest,
        sourceActionReceiptDigest,
        reason: "user-discard",
      }),
    );
    await expect(
      executeDesktopBrowserDownloadArtifactDisposal(
        grant,
        "quarantine:artifact-1",
        artifactDigest,
        sourceActionReceiptDigest,
        { actionAuthorization: { approval: "interactive" } },
      ),
    ).resolves.toMatchObject({
      status: "discarded",
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(disposeAuthorizedArtifact).toHaveBeenCalledOnce();
  });

  it("rejects invalid references, reasons and extra fields before authority", async () => {
    const { authorizeDisposal, host } = fixture();
    for (const input of [
      { artifactRef: "../../artifact", options: {} },
      { artifactRef: "quarantine:artifact-1", options: { reason: "unknown" } },
      { artifactRef: "quarantine:artifact-1", options: { savePath: "x" } },
    ]) {
      await expect(
        authorizeDesktopBrowserDownloadArtifactDisposal(host, {
          ...input,
          artifactDigest,
          sourceActionReceiptDigest,
          senderId: 17,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow();
    }
    expect(authorizeDisposal).not.toHaveBeenCalled();
  });

  it("rejects artifact substitution and replay", async () => {
    const { host } = fixture();
    const grant = await authorize(host);
    await expect(
      executeDesktopBrowserDownloadArtifactDisposal(
        grant,
        "quarantine:artifact-2",
        artifactDigest,
        sourceActionReceiptDigest,
      ),
    ).rejects.toThrow(/fresh bound/u);
    await executeDesktopBrowserDownloadArtifactDisposal(
      grant,
      "quarantine:artifact-1",
      artifactDigest,
      sourceActionReceiptDigest,
    );
    await expect(
      executeDesktopBrowserDownloadArtifactDisposal(
        grant,
        "quarantine:artifact-1",
        artifactDigest,
        sourceActionReceiptDigest,
      ),
    ).rejects.toThrow(/fresh bound/u);
  });
});
