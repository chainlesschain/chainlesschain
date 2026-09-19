import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_DOWNLOAD_COMPLETION_ACK_SCHEMA,
  BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA,
  BROWSER_DOWNLOAD_QUARANTINE_COMMIT_ACK_SCHEMA,
  BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA,
  BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA,
  createBrowserQuarantinedDownloadExecutor,
  isBrowserQuarantinedDownloadExecutor,
} from "../../src/lib/evolution/browser-quarantined-download-executor.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const NOW = Date.parse("2026-09-20T03:00:00.000Z");

function descriptor() {
  return {
    schema: BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA,
    executorId: "download-executor-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    networkMode: "policy-egress",
    custodyMode: "exclusive-stream-fsync",
    scannerMode: "independent-malware-scan",
  };
}

function execution(overrides = {}) {
  return {
    schema: "chainlesschain.browser-download-action-execution/v1",
    actionReceiptDigest: digest("receipt"),
    requestDigest: digest("request"),
    targetId: "tab-1",
    operation: "download-url",
    destinationUrl: "https://example.test/report.pdf",
    allowedRedirectOrigins: [
      "https://cdn.example.test",
      "https://example.test",
    ],
    allowedContentTypes: ["application/pdf"],
    maxBytes: 1024,
    deadlineAt: "2026-09-20T03:00:10.000Z",
    ...overrides,
  };
}

async function* chunks(...values) {
  for (const value of values) yield Buffer.from(value);
}

function fixture({
  response = {},
  commit = {},
  scan = {},
  completion = {},
  now = () => NOW,
} = {}) {
  const writeChunk = vi.fn(async () => {});
  const discardArtifact = vi.fn(async () => {});
  const commitArtifact = vi.fn(async (streamed) => ({
    schema: BROWSER_DOWNLOAD_QUARANTINE_COMMIT_ACK_SCHEMA,
    artifactRef: "quarantine:artifact-1",
    artifactDigest: streamed.artifactDigest,
    sizeBytes: streamed.sizeBytes,
    contentType: streamed.contentType,
    quarantineReceiptDigest: digest("quarantine"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    ...commit,
  }));
  const openQuarantine = vi.fn(async () => ({
    writeChunk,
    commitArtifact,
    discardArtifact,
  }));
  const openNetworkResponse = vi.fn(async () => ({
    schema: BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA,
    statusCode: 200,
    finalUrl: "https://cdn.example.test/report.pdf",
    redirectOrigins: ["https://cdn.example.test", "https://example.test"],
    contentType: "application/pdf",
    contentLength: 11,
    networkReceiptDigest: digest("network"),
    body: chunks("hello ", "world"),
    ...response,
  }));
  const scanArtifact = vi.fn(async (input) => ({
    schema: BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA,
    artifactRef: input.artifactRef,
    artifactDigest: input.artifactDigest,
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    verdict: "clean",
    scanEvidenceDigest: digest("scan"),
    authenticated: true,
    independent: true,
    ...scan,
  }));
  const completeArtifact = vi.fn(async (input) => ({
    schema: BROWSER_DOWNLOAD_COMPLETION_ACK_SCHEMA,
    artifactRef: input.artifactRef,
    artifactDigest: input.artifactDigest,
    scanEvidenceDigest: input.scanEvidenceDigest,
    completionReceiptDigest: digest("completion"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    ...completion,
  }));
  const executor = createBrowserQuarantinedDownloadExecutor({
    descriptor: descriptor(),
    openNetworkResponse,
    openQuarantine,
    scanArtifact,
    completeArtifact,
    now,
  });
  return {
    commitArtifact,
    completeArtifact,
    discardArtifact,
    executor,
    openNetworkResponse,
    openQuarantine,
    scanArtifact,
    writeChunk,
  };
}

describe("browser quarantined download executor", () => {
  it("streams bytes through quarantine and independently scans before completion", async () => {
    const ports = fixture();
    expect(isBrowserQuarantinedDownloadExecutor(ports.executor)).toBe(true);
    const signal = new AbortController().signal;
    await expect(
      ports.executor(execution(), { signal }),
    ).resolves.toMatchObject({
      schema: "chainlesschain.browser-download-artifact/v1",
      artifactRef: "quarantine:artifact-1",
      artifactDigest: digest("hello world"),
      sizeBytes: 11,
      contentType: "application/pdf",
      quarantined: true,
      scanVerdict: "clean",
      scanEvidenceDigest: digest("scan"),
      quarantineReceiptDigest: digest("quarantine"),
      completionReceiptDigest: digest("completion"),
    });
    expect(
      ports.writeChunk.mock.calls.map(([value]) => value.toString()),
    ).toEqual(["hello ", "world"]);
    expect(ports.commitArtifact).toHaveBeenCalledWith({
      artifactDigest: digest("hello world"),
      sizeBytes: 11,
      contentType: "application/pdf",
    });
    expect(ports.commitArtifact).toHaveBeenCalledBefore(ports.scanArtifact);
    expect(ports.scanArtifact).toHaveBeenCalledBefore(ports.completeArtifact);
    expect(ports.discardArtifact).not.toHaveBeenCalled();
  });

  it("stops an oversized stream and discards its partial quarantine", async () => {
    const ports = fixture({
      response: {
        contentLength: null,
        body: chunks("123", "456"),
      },
    });
    await expect(
      ports.executor(execution({ maxBytes: 5 }), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/byte budget/u);
    expect(ports.writeChunk).toHaveBeenCalledTimes(1);
    expect(ports.commitArtifact).not.toHaveBeenCalled();
    expect(ports.scanArtifact).not.toHaveBeenCalled();
    expect(ports.discardArtifact).toHaveBeenCalledWith({
      reason: "download-execution-failed",
    });
  });

  it.each([
    ["unexpected MIME", { contentType: "text/html" }],
    [
      "unapproved redirect",
      {
        finalUrl: "https://evil.test/report.pdf",
        redirectOrigins: ["https://evil.test", "https://example.test"],
      },
    ],
    ["partial response", { statusCode: 206 }],
    ["oversized declared length", { contentLength: 2048 }],
  ])("rejects %s before quarantine allocation", async (_label, response) => {
    const ports = fixture({ response });
    await expect(
      ports.executor(execution(), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/network response/u);
    expect(ports.openQuarantine).not.toHaveBeenCalled();
  });

  it("discards a quarantined artifact rejected by an independent scanner", async () => {
    const ports = fixture({ scan: { verdict: "rejected" } });
    await expect(
      ports.executor(execution(), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/malware scanning/u);
    expect(ports.commitArtifact).toHaveBeenCalledOnce();
    expect(ports.discardArtifact).toHaveBeenCalledOnce();
    expect(ports.completeArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ["artifact reference", { artifactRef: "artifact-1" }],
    ["artifact digest", { artifactDigest: digest("substituted") }],
    ["durability", { durable: false }],
    ["readback", { readbackVerified: false }],
  ])(
    "rejects substituted quarantine %s acknowledgements",
    async (_label, commit) => {
      const ports = fixture({ commit });
      await expect(
        ports.executor(execution(), {
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/quarantine commit acknowledgement/u);
      expect(ports.discardArtifact).toHaveBeenCalledOnce();
      expect(ports.scanArtifact).not.toHaveBeenCalled();
    },
  );

  it("fails and discards when the execution deadline expires mid-stream", async () => {
    let ticks = 0;
    const ports = fixture({
      response: { contentLength: null, body: chunks("a", "b") },
      now: () => NOW + ticks++ * 6000,
    });
    await expect(
      ports.executor(execution(), {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/deadline/u);
    expect(ports.discardArtifact).toHaveBeenCalledOnce();
    expect(ports.commitArtifact).not.toHaveBeenCalled();
  });

  it("discards partial custody when an active execution is cancelled", async () => {
    const controller = new AbortController();
    async function* cancellingBody() {
      yield Buffer.from("a");
      controller.abort(new Error("user-request"));
      yield Buffer.from("b");
    }
    const ports = fixture({
      response: { contentLength: null, body: cancellingBody() },
    });

    await expect(
      ports.executor(execution(), { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/u);
    expect(ports.writeChunk).toHaveBeenCalledOnce();
    expect(ports.commitArtifact).not.toHaveBeenCalled();
    expect(ports.scanArtifact).not.toHaveBeenCalled();
    expect(ports.discardArtifact).toHaveBeenCalledWith({
      reason: "download-execution-failed",
    });
  });
});
