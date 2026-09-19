import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";
import {
  BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA,
  BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA,
  BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA,
  createBrowserQuarantinedDownloadExecutor,
} from "../../src/lib/evolution/browser-quarantined-download-executor.js";

const NOW = Date.parse("2026-09-20T04:00:00.000Z");
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function descriptor() {
  return {
    schema: BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
    custodyId: "download-custody-test",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    retentionMs: 60_000,
    custodyMode: "exclusive-stream-fsync",
  };
}

function openInput(overrides = {}) {
  return {
    artifactId: "artifact-1",
    tenantId: "tenant-1",
    maxBytes: 1024,
    contentType: "application/pdf",
    networkReceiptDigest: digest("network"),
    actionReceiptDigest: digest("action"),
    ...overrides,
  };
}

async function bodyBytes(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("browser filesystem quarantine custody", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture() {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-browser-quarantine-"),
    );
    roots.push(stateRoot);
    const descriptorValue = descriptor();
    const custody = createBrowserFilesystemQuarantineCustody({
      descriptor: descriptorValue,
      stateRoot,
      now: () => NOW,
    });
    return {
      custody,
      descriptorValue,
      port: captureBrowserFilesystemQuarantineCustody(custody),
      stateRoot,
    };
  }

  it("fsyncs, independently reads back, completes, and reopens an artifact", async () => {
    const { descriptorValue, port, stateRoot } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("hello "));
    await session.writeChunk(Buffer.from("world"));
    const artifactDigest = digest("hello world");
    const committed = await session.commitArtifact({
      artifactDigest,
      sizeBytes: 11,
      contentType: "application/pdf",
    });
    expect(committed).toMatchObject({
      artifactRef: "quarantine:artifact-1",
      artifactDigest,
      sizeBytes: 11,
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });

    const scanInput = {
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sizeBytes: committed.sizeBytes,
      contentType: committed.contentType,
      quarantineReceiptDigest: committed.quarantineReceiptDigest,
    };
    const scanSource = await port.openArtifactForScan(scanInput);
    expect(Object.hasOwn(scanSource.body, "path")).toBe(false);
    expect(JSON.stringify(scanSource)).not.toContain(stateRoot);
    await expect(bodyBytes(scanSource.body)).resolves.toEqual(
      Buffer.from("hello world"),
    );
    const completedAt = new Date(NOW + 1000).toISOString();
    const completion = await port.completeArtifact({
      ...scanInput,
      networkReceiptDigest: digest("network"),
      scanEvidenceDigest: digest("scan"),
      completedAt,
    });
    expect(completion).toMatchObject({
      artifactRef: committed.artifactRef,
      artifactDigest,
      scanEvidenceDigest: digest("scan"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });

    const reopened = captureBrowserFilesystemQuarantineCustody(
      createBrowserFilesystemQuarantineCustody({
        descriptor: descriptorValue,
        stateRoot,
        now: () => NOW + 2000,
      }),
    );
    await expect(
      reopened.inspectArtifact(committed.artifactRef),
    ).resolves.toEqual({
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      artifactDigest,
      sizeBytes: 11,
      contentType: "application/pdf",
      sourceActionReceiptDigest: digest("action"),
      status: "ready",
      committedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      quarantineReceiptDigest: committed.quarantineReceiptDigest,
      scanEvidenceDigest: digest("scan"),
      completedAt,
      completionReceiptDigest: completion.completionReceiptDigest,
    });
  });

  it("removes every partial artifact when a streaming session is discarded", async () => {
    const { port } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("partial"));
    await session.discardArtifact({ reason: "download-execution-failed" });

    await expect(
      port.inspectArtifact("quarantine:artifact-1"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(port.openQuarantine(openInput())).resolves.toMatchObject({
      writeChunk: expect.any(Function),
      commitArtifact: expect.any(Function),
      discardArtifact: expect.any(Function),
    });
  });

  it("fails closed when persisted bytes are changed after commit", async () => {
    const { port, stateRoot } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("original"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("original"),
      sizeBytes: 8,
      contentType: "application/pdf",
    });
    await writeFile(
      path.join(stateRoot, "objects", "artifact-1.blob"),
      Buffer.from("modified"),
    );

    await expect(
      port.openArtifactForScan({
        artifactRef: committed.artifactRef,
        artifactDigest: committed.artifactDigest,
        sizeBytes: committed.sizeBytes,
        contentType: committed.contentType,
        quarantineReceiptDigest: committed.quarantineReceiptDigest,
      }),
    ).rejects.toThrow(/digest differs/u);
  });

  it("rejects traversal, tenant substitution, and completion evidence mismatch", async () => {
    const { port } = await fixture();
    await expect(
      port.openQuarantine(openInput({ artifactId: "../escape" })),
    ).rejects.toThrow(/open request/u);
    await expect(
      port.openQuarantine(openInput({ tenantId: "tenant-2" })),
    ).rejects.toThrow(/open request/u);

    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    await expect(
      port.completeArtifact({
        artifactRef: committed.artifactRef,
        artifactDigest: digest("substituted"),
        sizeBytes: committed.sizeBytes,
        contentType: committed.contentType,
        networkReceiptDigest: digest("network"),
        quarantineReceiptDigest: committed.quarantineReceiptDigest,
        scanEvidenceDigest: digest("scan"),
        completedAt: new Date(NOW + 1000).toISOString(),
      }),
    ).rejects.toThrow(/differs from custody/u);
  });

  it("serves as the executor custody and completion ports without exposing paths", async () => {
    const { port, stateRoot } = await fixture();
    const executor = createBrowserQuarantinedDownloadExecutor({
      descriptor: {
        schema: BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA,
        executorId: "download-executor-test",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        networkMode: "policy-egress",
        custodyMode: "exclusive-stream-fsync",
        scannerMode: "independent-malware-scan",
      },
      openNetworkResponse: async () => ({
        schema: BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA,
        statusCode: 200,
        finalUrl: "https://example.test/report.pdf",
        redirectOrigins: ["https://example.test"],
        contentType: "application/pdf",
        contentLength: 7,
        networkReceiptDigest: digest("network"),
        body: (async function* () {
          yield Buffer.from("content");
        })(),
      }),
      openQuarantine: port.openQuarantine,
      scanArtifact: async (input) => {
        const source = await port.openArtifactForScan(input);
        expect(await bodyBytes(source.body)).toEqual(Buffer.from("content"));
        return {
          schema: BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA,
          artifactRef: input.artifactRef,
          artifactDigest: input.artifactDigest,
          sizeBytes: input.sizeBytes,
          contentType: input.contentType,
          verdict: "clean",
          scanEvidenceDigest: digest("scan"),
          authenticated: true,
          independent: true,
        };
      },
      completeArtifact: port.completeArtifact,
      now: () => NOW + 1000,
    });
    const artifact = await executor({
      schema: "chainlesschain.browser-download-action-execution/v1",
      actionReceiptDigest: digest("action"),
      requestDigest: digest("request"),
      targetId: "tab-1",
      operation: "download-url",
      destinationUrl: "https://example.test/report.pdf",
      allowedRedirectOrigins: ["https://example.test"],
      allowedContentTypes: ["application/pdf"],
      maxBytes: 1024,
      deadlineAt: new Date(NOW + 30_000).toISOString(),
    });

    expect(artifact).toMatchObject({
      artifactRef: expect.stringMatching(/^quarantine:/u),
      artifactDigest: digest("content"),
      sizeBytes: 7,
      scanVerdict: "clean",
      quarantineReceiptDigest: expect.stringMatching(/^sha256:/u),
      completionReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(artifact)).not.toContain(stateRoot);
    await expect(
      port.inspectArtifact(artifact.artifactRef),
    ).resolves.toMatchObject({
      status: "ready",
      artifactDigest: digest("content"),
      sourceActionReceiptDigest: digest("action"),
    });
  });
});
