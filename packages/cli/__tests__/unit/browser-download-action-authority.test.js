import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_DOWNLOAD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
  BROWSER_DOWNLOAD_ACTION_OUTCOME_ACK_SCHEMA,
  BROWSER_DOWNLOAD_ACTION_OUTCOME_REQUEST_SCHEMA,
  BROWSER_DOWNLOAD_ACTION_REQUEST_SCHEMA,
  BROWSER_DOWNLOAD_ARTIFACT_SCHEMA,
  captureBrowserDownloadActionAuthority,
  createBrowserDownloadActionAuthority,
} from "../../src/lib/evolution/browser-download-action-authority.js";

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

const NOW = "2026-09-20T02:00:00.000Z";

function descriptor() {
  return {
    schema: BROWSER_DOWNLOAD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA,
    authorityId: "download-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 10_000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    artifactMode: "opaque-quarantine-clean-scan",
  };
}

function request({ core: coreOverrides = {}, ...overrides } = {}) {
  const inputCore = {
    targetId: "tab-1",
    operation: "download-url",
    destinationUrl: "https://example.test/private/report.pdf",
    allowedRedirectOrigins: [
      "https://cdn.example.test",
      "https://example.test",
    ],
    allowedContentTypes: ["application/pdf"],
    maxBytes: 1024 * 1024,
    timeout: 30_000,
    ...coreOverrides,
  };
  return {
    schema: BROWSER_DOWNLOAD_ACTION_REQUEST_SCHEMA,
    requestId: "request-1",
    ...inputCore,
    senderId: 17,
    frameUrlDigest: digest("test", "frame"),
    inputDigest: digest(
      "chainlesschain.browser-download-action-input/v1",
      inputCore,
    ),
    authorization: { approval: "interactive" },
    requestedAt: NOW,
    ...overrides,
  };
}

function artifact(overrides = {}) {
  return {
    schema: BROWSER_DOWNLOAD_ARTIFACT_SCHEMA,
    artifactRef: "quarantine:artifact-1",
    artifactDigest: digest("test", "artifact"),
    sizeBytes: 8192,
    contentType: "application/pdf",
    finalUrl: "https://cdn.example.test/report.pdf",
    redirectOrigins: ["https://cdn.example.test", "https://example.test"],
    quarantined: true,
    scanVerdict: "clean",
    scanEvidenceDigest: digest("test", "scan"),
    quarantineReceiptDigest: digest("test", "quarantine"),
    completionReceiptDigest: digest("test", "completion"),
    completedAt: "2026-09-20T02:00:01.000Z",
    ...overrides,
  };
}

function fixture({ executeDownload, authorize } = {}) {
  const descriptorValue = descriptor();
  const executePort = executeDownload ?? vi.fn(async () => artifact());
  const authorizePort =
    authorize ??
    vi.fn(async () => ({
      decision: "allow",
      approvalEvidenceRef: "approval-1",
      validUntil: "2026-09-20T02:00:05.000Z",
    }));
  const recordOutcome = vi.fn(async (value) => ({
    schema: BROWSER_DOWNLOAD_ACTION_OUTCOME_ACK_SCHEMA,
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
  const port = captureBrowserDownloadActionAuthority(
    createBrowserDownloadActionAuthority({
      descriptor: descriptorValue,
      authorize: authorizePort,
      executeDownload: executePort,
      recordOutcome,
      now: () => Date.parse(NOW),
    }),
  );
  return { authorizePort, executePort, port, recordOutcome };
}

function outcome(receipt, execution, overrides = {}) {
  return {
    schema: BROWSER_DOWNLOAD_ACTION_OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: receipt.receiptDigest,
    requestDigest: receipt.requestDigest,
    targetId: receipt.targetId,
    operation: receipt.operation,
    inputDigest: receipt.inputDigest,
    status: execution.status,
    resultDigest: execution.resultDigest,
    recordedAt: "2026-09-20T02:00:02.000Z",
    ...overrides,
  };
}

describe("browser download action authority", () => {
  it("executes one URL-bound quarantined download and durably settles it", async () => {
    const { authorizePort, executePort, port, recordOutcome } = fixture();
    const receipt = await port.authorizeAction(request());
    expect(receipt).toMatchObject({
      targetId: "tab-1",
      operation: "download-url",
      artifactMode: "opaque-quarantine-clean-scan",
      destinationDigest: expect.stringMatching(/^sha256:/u),
      contentTypesDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(receipt)).not.toContain("report.pdf");
    expect(authorizePort).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUrl: "https://example.test/private/report.pdf",
        allowedContentTypes: ["application/pdf"],
      }),
    );

    const execution = await port.executeAuthorizedDownload({
      receiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
    });
    expect(executePort).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUrl: "https://example.test/private/report.pdf",
        maxBytes: 1024 * 1024,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(execution).toMatchObject({
      status: "succeeded",
      artifactRef: "quarantine:artifact-1",
      artifactDigest: expect.stringMatching(/^sha256:/u),
      scanEvidenceDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(execution)).not.toContain("report.pdf");

    await expect(
      port.recordActionOutcome(outcome(receipt, execution)),
    ).resolves.toMatchObject({ durable: true, readbackVerified: true });
    expect(recordOutcome).toHaveBeenCalledOnce();
  });

  it.each([
    request({ core: { destinationUrl: "file:///secret.pdf" } }),
    request({
      core: { destinationUrl: "https://user:pass@example.test/report.pdf" },
    }),
    request({ core: { allowedRedirectOrigins: ["https://other.test"] } }),
    request({ core: { allowedContentTypes: ["application/*"] } }),
    request({ core: { maxBytes: 100 * 1024 * 1024 + 1 } }),
    request({ inputDigest: digest("test", "wrong") }),
  ])("rejects invalid download scope before policy", async (invalid) => {
    const { authorizePort, port } = fixture();
    await expect(port.authorizeAction(invalid)).rejects.toThrow();
    expect(authorizePort).not.toHaveBeenCalled();
  });

  it.each([
    ["oversized artifact", { sizeBytes: 1024 * 1024 + 1 }],
    ["wrong content type", { contentType: "text/html" }],
    [
      "unapproved final origin",
      {
        finalUrl: "https://evil.test/report.pdf",
        redirectOrigins: ["https://evil.test", "https://example.test"],
      },
    ],
    ["unclean scan", { scanVerdict: "infected" }],
    ["unquarantined artifact", { quarantined: false }],
  ])("fails closed for %s evidence", async (_label, artifactOverrides) => {
    const { port } = fixture({
      executeDownload: vi.fn(async () => artifact(artifactOverrides)),
    });
    const receipt = await port.authorizeAction(request());
    const execution = await port.executeAuthorizedDownload({
      receiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
    });
    expect(execution).toMatchObject({
      status: "failed",
      failureClass: "download-provider-failed",
      artifactRef: null,
      finalUrlDigest: null,
    });
    await expect(
      port.recordActionOutcome(outcome(receipt, execution)),
    ).resolves.toMatchObject({ authenticated: true });
  });

  it("rejects substituted and replayed execution or outcome bindings", async () => {
    const { port } = fixture();
    const receipt = await port.authorizeAction(request());
    await expect(
      port.executeAuthorizedDownload({
        receiptDigest: receipt.receiptDigest,
        requestDigest: digest("test", "substituted"),
      }),
    ).rejects.toThrow(/invalid or spent/u);
    const execution = await port.executeAuthorizedDownload({
      receiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
    });
    await expect(
      port.executeAuthorizedDownload({
        receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
      }),
    ).rejects.toThrow(/invalid or spent/u);
    await expect(
      port.recordActionOutcome(
        outcome(receipt, execution, { status: "failed" }),
      ),
    ).rejects.toThrow(/differs/u);
    const validOutcome = outcome(receipt, execution);
    await expect(port.recordActionOutcome(validOutcome)).resolves.toMatchObject(
      {
        authenticated: true,
      },
    );
    await expect(port.recordActionOutcome(validOutcome)).rejects.toThrow(
      /differs/u,
    );
  });

  it("fails closed when a provider resolves synchronously from abort", async () => {
    let observedSignal = null;
    const executeDownload = vi.fn((_execution, { signal }) => {
      observedSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(artifact()), {
          once: true,
        });
      });
    });
    const { port } = fixture({ executeDownload });
    const receipt = await port.authorizeAction(
      request({ core: { timeout: 1 } }),
    );
    await expect(
      port.executeAuthorizedDownload({
        receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "download-timeout",
      artifactRef: null,
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("denies without exposing a download execution grant", async () => {
    const { executePort, port } = fixture({
      authorize: async () => ({
        decision: "deny",
        reason: "download is outside the approved task",
      }),
    });
    await expect(port.authorizeAction(request())).rejects.toMatchObject({
      code: "BROWSER_DOWNLOAD_ACTION_DENIED",
    });
    expect(executePort).not.toHaveBeenCalled();
  });
});
