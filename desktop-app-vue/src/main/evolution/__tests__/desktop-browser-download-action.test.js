import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const {
  authorizeDesktopBrowserDownloadAction,
  createDesktopBrowserDownloadActionHost,
  executeDesktopBrowserDownloadActionGrant,
  recordDesktopBrowserDownloadActionOutcome,
} = require("../desktop-browser-download-action");

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

function fixture({ executionOverrides = {} } = {}) {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "download-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    artifactMode: "opaque-quarantine-clean-scan",
  });
  const authorizeAction = vi.fn(async (request) => ({
    schema: "chainlesschain.browser-download-action-receipt/v1",
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    approvalMode: descriptor.approvalMode,
    artifactMode: descriptor.artifactMode,
    requestId: request.requestId,
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    destinationDigest: digest(
      "chainlesschain.browser-download-action-destination/v1",
      request.destinationUrl,
    ),
    redirectOriginsDigest: digest(
      "chainlesschain.browser-download-action-redirect-origins/v1",
      request.allowedRedirectOrigins,
    ),
    contentTypesDigest: digest(
      "chainlesschain.browser-download-action-content-types/v1",
      request.allowedContentTypes,
    ),
    maxBytes: request.maxBytes,
    timeout: request.timeout,
    inputDigest: request.inputDigest,
    requestDigest: digest("test", `request:${request.requestId}`),
    validUntil: new Date(Date.now() + 5000).toISOString(),
    receiptDigest: digest("test", request.requestId),
  }));
  const executeAuthorizedDownload = vi.fn(async () => ({
    status: "succeeded",
    failureClass: null,
    artifactRef: "quarantine:artifact-1",
    artifactDigest: digest("test", "artifact"),
    sizeBytes: 4096,
    contentType: "application/pdf",
    finalUrlDigest: digest("test", "final-url"),
    redirectOriginsDigest: digest("test", "redirects"),
    scanEvidenceDigest: digest("test", "scan"),
    quarantineReceiptDigest: digest("test", "quarantine"),
    completionReceiptDigest: digest("test", "completion"),
    completedAt: new Date().toISOString(),
    resultDigest: digest("test", "result"),
    ...executionOverrides,
  }));
  const recordActionOutcome = vi.fn(async (request) => ({
    schema: "chainlesschain.browser-download-action-outcome-ack/v1",
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    actionReceiptDigest: request.actionReceiptDigest,
    outcomeRequestDigest: digest(request.schema, request),
    auditEventDigest: digest("test", `audit:${request.resultDigest}`),
    durabilityReceiptDigest: digest("test", `durable:${request.resultDigest}`),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  }));
  const host = createDesktopBrowserDownloadActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({
      descriptor,
      authorizeAction,
      executeAuthorizedDownload,
      recordActionOutcome,
    });
  });
  return {
    authorizeAction,
    executeAuthorizedDownload,
    host,
    recordActionOutcome,
  };
}

function options(overrides = {}) {
  return {
    allowedRedirectOrigins: [
      "https://cdn.example.test",
      "https://example.test",
    ],
    allowedContentTypes: ["application/pdf"],
    maxBytes: 1024 * 1024,
    timeout: 45_000,
    actionAuthorization: { approval: "interactive" },
    ...overrides,
  };
}

async function authorize(host, optionValue = options()) {
  return authorizeDesktopBrowserDownloadAction(host, {
    targetId: "tab-1",
    destinationUrl: "https://example.test/private/report.pdf",
    options: optionValue,
    senderId: 17,
    frameUrl: "app://desktop/index.html",
    authorization: optionValue.actionAuthorization ?? null,
  });
}

describe("Desktop browser download action host", () => {
  it("binds one download to opaque clean artifact evidence and durable audit", async () => {
    const {
      authorizeAction,
      executeAuthorizedDownload,
      host,
      recordActionOutcome,
    } = fixture();
    const optionValue = options();
    const grant = await authorize(host, optionValue);
    expect(authorizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "tab-1",
        destinationUrl: "https://example.test/private/report.pdf",
        allowedRedirectOrigins: [
          "https://cdn.example.test",
          "https://example.test",
        ],
        allowedContentTypes: ["application/pdf"],
      }),
    );
    const execution = await executeDesktopBrowserDownloadActionGrant(
      grant,
      "tab-1",
      "https://example.test/private/report.pdf",
      optionValue,
    );
    expect(executeAuthorizedDownload).toHaveBeenCalledWith({
      receiptDigest: expect.stringMatching(/^sha256:/u),
      requestDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(execution).toMatchObject({
      status: "succeeded",
      artifactRef: "quarantine:artifact-1",
      scanEvidenceDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(execution)).not.toContain("report.pdf");
    await expect(
      recordDesktopBrowserDownloadActionOutcome(grant),
    ).resolves.toMatchObject({
      actionReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(recordActionOutcome.mock.calls)).not.toContain(
      "report.pdf",
    );
  });

  it("rejects unsafe destinations and broad download options before authority", async () => {
    const { authorizeAction, host } = fixture();
    for (const input of [
      { destinationUrl: "file:///secret.pdf", options: options() },
      {
        destinationUrl: "https://example.test/report.pdf",
        options: options({ allowedRedirectOrigins: ["https://other.test"] }),
      },
      {
        destinationUrl: "https://example.test/report.pdf",
        options: options({ allowedContentTypes: ["application/*"] }),
      },
      {
        destinationUrl: "https://example.test/report.pdf",
        options: options({ savePath: "C:\\private\\report.pdf" }),
      },
    ]) {
      await expect(
        authorizeDesktopBrowserDownloadAction(host, {
          targetId: "tab-1",
          ...input,
          senderId: 17,
          frameUrl: "app://desktop/index.html",
        }),
      ).rejects.toThrow();
    }
    expect(authorizeAction).not.toHaveBeenCalled();
  });

  it("rejects target, URL, policy-bound option substitution and replay", async () => {
    const { host } = fixture();
    const optionValue = options();
    const grant = await authorize(host, optionValue);
    for (const [targetId, destinationUrl, substituted] of [
      ["tab-2", "https://example.test/private/report.pdf", optionValue],
      ["tab-1", "https://example.test/other.pdf", optionValue],
      [
        "tab-1",
        "https://example.test/private/report.pdf",
        options({ maxBytes: 2048 }),
      ],
    ]) {
      await expect(
        executeDesktopBrowserDownloadActionGrant(
          grant,
          targetId,
          destinationUrl,
          substituted,
        ),
      ).rejects.toThrow(/fresh bound/u);
    }
    await executeDesktopBrowserDownloadActionGrant(
      grant,
      "tab-1",
      "https://example.test/private/report.pdf",
      optionValue,
    );
    await expect(
      executeDesktopBrowserDownloadActionGrant(
        grant,
        "tab-1",
        "https://example.test/private/report.pdf",
        optionValue,
      ),
    ).rejects.toThrow(/fresh bound/u);
  });

  it("audits a fail-closed provider result without artifact details", async () => {
    const { host, recordActionOutcome } = fixture({
      executionOverrides: {
        status: "failed",
        failureClass: "download-provider-failed",
        artifactRef: null,
        artifactDigest: null,
        sizeBytes: null,
        contentType: null,
        finalUrlDigest: null,
        redirectOriginsDigest: null,
        scanEvidenceDigest: null,
        quarantineReceiptDigest: null,
        completionReceiptDigest: null,
        completedAt: null,
      },
    });
    const optionValue = options();
    const grant = await authorize(host, optionValue);
    await expect(
      executeDesktopBrowserDownloadActionGrant(
        grant,
        "tab-1",
        "https://example.test/private/report.pdf",
        optionValue,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "download-provider-failed",
      artifactRef: null,
    });
    await recordDesktopBrowserDownloadActionOutcome(grant);
    expect(recordActionOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });
});
