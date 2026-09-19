import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
  captureBrowserDownloadArtifactDisposalAuthority,
  createBrowserDownloadArtifactDisposalAuthority,
} from "../../src/lib/evolution/browser-download-artifact-disposal-authority.js";
import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
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

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const domainDigest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;

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

function disposalDescriptor(handlerArtifactDigest = digest("handler")) {
  return {
    schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
    authorityId: "browser-download-disposal",
    tenantId: "tenant-1",
    handlerArtifactDigest,
    policyRevision: "policy-1",
    maxGrantTtlMs: 5000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
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

async function nextJsonLine(stream, timeoutMs = 15_000) {
  let buffered = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("child custody process did not become ready")),
      timeoutMs,
    );
    const onData = (chunk) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      stream.off("data", onData);
      try {
        resolve(JSON.parse(buffered.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    };
    stream.on("data", onData);
  });
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

  it("fsyncs files and directories, reads back, completes, and reopens an artifact", async () => {
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

  it("durably creates an absent nested custody namespace", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "cc-browser-parent-"));
    roots.push(parent);
    const stateRoot = path.join(parent, "nested", "quarantine");
    const port = captureBrowserFilesystemQuarantineCustody(
      createBrowserFilesystemQuarantineCustody({
        descriptor: descriptor(),
        stateRoot,
        now: () => NOW,
      }),
    );

    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("partial"));
    await session.discardArtifact();
    for (const directory of [
      stateRoot,
      path.join(stateRoot, "objects"),
      path.join(stateRoot, "metadata"),
      path.join(stateRoot, "deletions"),
      path.join(stateRoot, "locks"),
    ])
      await expect(access(directory)).resolves.toBeUndefined();
  });

  it("removes every partial artifact when a streaming session is discarded", async () => {
    const { port } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("partial"));
    await session.discardArtifact({ reason: "download-execution-failed" });

    await expect(
      port.inspectArtifact("quarantine:artifact-1"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const reopened = await port.openQuarantine(openInput());
    expect(reopened).toMatchObject({
      writeChunk: expect.any(Function),
      commitArtifact: expect.any(Function),
      discardArtifact: expect.any(Function),
    });
    await reopened.discardArtifact();
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

  it("durably disposes an authorized artifact and resumes from its tombstone", async () => {
    const { descriptorValue, port, stateRoot } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    await port.completeArtifact({
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sizeBytes: committed.sizeBytes,
      contentType: committed.contentType,
      networkReceiptDigest: digest("network"),
      quarantineReceiptDigest: committed.quarantineReceiptDigest,
      scanEvidenceDigest: digest("scan"),
      completedAt: new Date(NOW + 1000).toISOString(),
    });

    const disposalDescriptorValue = disposalDescriptor(
      descriptorValue.handlerArtifactDigest,
    );
    const boundDisposal = port.bindDisposalAuthority(disposalDescriptorValue);
    const disposeArtifact = vi.fn(boundDisposal);
    const authority = captureBrowserDownloadArtifactDisposalAuthority(
      createBrowserDownloadArtifactDisposalAuthority({
        descriptor: disposalDescriptorValue,
        authorize: async () => ({
          decision: "allow",
          approvalEvidenceRef: "approval-1",
          validUntil: new Date(NOW + 5000).toISOString(),
        }),
        disposeArtifact,
        now: () => NOW + 2000,
      }),
    );
    const inputCore = {
      operation: "discard-download-artifact",
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: digest("action"),
      reason: "user-discard",
    };
    const receipt = await authority.authorizeDisposal({
      schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
      requestId: "request-1",
      senderId: 17,
      frameUrlDigest: digest("frame"),
      ...inputCore,
      inputDigest: domainDigest(
        "chainlesschain.browser-download-artifact-disposal-input/v1",
        inputCore,
      ),
      authorization: { approval: "interactive" },
      requestedAt: new Date(NOW + 1000).toISOString(),
    });
    const result = await authority.disposeAuthorizedArtifact({
      receiptDigest: receipt.receiptDigest,
      requestDigest: receipt.requestDigest,
    });

    expect(result).toMatchObject({
      status: "discarded",
      artifactDigest: committed.artifactDigest,
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    await expect(port.inspectArtifact(committed.artifactRef)).rejects.toThrow(
      /ENOENT/u,
    );

    const disposalInput = disposeArtifact.mock.calls[0][0];
    const reopened = captureBrowserFilesystemQuarantineCustody(
      createBrowserFilesystemQuarantineCustody({
        descriptor: descriptorValue,
        stateRoot,
        now: () => NOW + 3000,
      }),
    );
    const resumed = await reopened.bindDisposalAuthority(
      disposalDescriptorValue,
    )(disposalInput);
    expect(resumed).toMatchObject({
      deletionReceiptDigest: result.deletionReceiptDigest,
      durable: true,
      readbackVerified: true,
      bytesUnavailable: true,
    });
    await expect(
      reopened.bindDisposalAuthority(disposalDescriptorValue)({
        ...disposalInput,
        reason: "revoked",
      }),
    ).rejects.toThrow(/tombstone is invalid/u);
    await expect(reopened.openQuarantine(openInput())).rejects.toThrow(
      /already exists/u,
    );
  });

  it("resumes a durable deletion intent after a simulated restart", async () => {
    const { descriptorValue, port, stateRoot } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    const disposalInput = {
      actionReceiptDigest: digest("disposal-action"),
      requestDigest: digest("disposal-request"),
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: digest("action"),
      reason: "user-discard",
    };
    const intentCore = {
      schema: BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
      custodyId: descriptorValue.custodyId,
      tenantId: descriptorValue.tenantId,
      authorityId: "browser-download-disposal",
      handlerArtifactDigest: descriptorValue.handlerArtifactDigest,
      ...disposalInput,
      startedAt: new Date(NOW + 1000).toISOString(),
    };
    await writeFile(
      path.join(stateRoot, "deletions", "artifact-1.intent.json"),
      `${canonical({
        ...intentCore,
        intentDigest: domainDigest(
          BROWSER_FILESYSTEM_QUARANTINE_DELETION_INTENT_SCHEMA,
          intentCore,
        ),
      })}\n`,
    );

    const reopened = captureBrowserFilesystemQuarantineCustody(
      createBrowserFilesystemQuarantineCustody({
        descriptor: descriptorValue,
        stateRoot,
        now: () => NOW + 2000,
      }),
    );
    await expect(
      reopened.bindDisposalAuthority(
        disposalDescriptor(descriptorValue.handlerArtifactDigest),
      )(disposalInput),
    ).resolves.toMatchObject({
      artifactRef: committed.artifactRef,
      discardedAt: intentCore.startedAt,
      durable: true,
      readbackVerified: true,
      bytesUnavailable: true,
    });
    await expect(
      reopened.inspectArtifact(committed.artifactRef),
    ).rejects.toThrow(/ENOENT/u);
  });

  it("serializes competing disposal receipts before deleting bytes", async () => {
    const { descriptorValue, port } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    const dispose = port.bindDisposalAuthority(
      disposalDescriptor(descriptorValue.handlerArtifactDigest),
    );
    const disposalInput = {
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: digest("action"),
    };
    const settled = await Promise.allSettled([
      dispose({
        ...disposalInput,
        actionReceiptDigest: digest("disposal-action-1"),
        requestDigest: digest("disposal-request-1"),
        reason: "user-discard",
      }),
      dispose({
        ...disposalInput,
        actionReceiptDigest: digest("disposal-action-2"),
        requestDigest: digest("disposal-request-2"),
        reason: "revoked",
      }),
    ]);

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(
      settled.find(({ status }) => status === "fulfilled").value,
    ).toMatchObject({ bytesUnavailable: true, readbackVerified: true });
    expect(
      settled.find(({ status }) => status === "rejected").reason.message,
    ).toMatch(
      /disposal is already active|deletion intent is invalid|tombstone is invalid/u,
    );
  });

  it("does not claim deletion while a scanner still holds the bytes", async () => {
    const { descriptorValue, port } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    const scanSource = await port.openArtifactForScan({
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sizeBytes: committed.sizeBytes,
      contentType: committed.contentType,
      quarantineReceiptDigest: committed.quarantineReceiptDigest,
    });
    const reader = scanSource.body[Symbol.asyncIterator]();
    await expect(reader.next()).resolves.toMatchObject({
      done: false,
      value: Buffer.from("content"),
    });
    const dispose = port.bindDisposalAuthority(
      disposalDescriptor(descriptorValue.handlerArtifactDigest),
    );
    const disposalInput = {
      actionReceiptDigest: digest("disposal-action"),
      requestDigest: digest("disposal-request"),
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: digest("action"),
      reason: "user-discard",
    };

    await expect(dispose(disposalInput)).rejects.toThrow(
      /active scan readers/u,
    );
    await reader.return();
    await expect(dispose(disposalInput)).resolves.toMatchObject({
      bytesUnavailable: true,
      readbackVerified: true,
    });
  });

  it("does not race deletion against a completion metadata commit", async () => {
    const { descriptorValue, port } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    const completion = port.completeArtifact({
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sizeBytes: committed.sizeBytes,
      contentType: committed.contentType,
      networkReceiptDigest: digest("network"),
      quarantineReceiptDigest: committed.quarantineReceiptDigest,
      scanEvidenceDigest: digest("scan"),
      completedAt: new Date(NOW + 1000).toISOString(),
    });
    const dispose = port.bindDisposalAuthority(
      disposalDescriptor(descriptorValue.handlerArtifactDigest),
    );
    const disposalInput = {
      actionReceiptDigest: digest("disposal-action"),
      requestDigest: digest("disposal-request"),
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: digest("action"),
      reason: "user-discard",
    };

    await expect(dispose(disposalInput)).rejects.toThrow(
      /completion is active/u,
    );
    await expect(completion).resolves.toMatchObject({
      artifactRef: committed.artifactRef,
      readbackVerified: true,
    });
    await expect(dispose(disposalInput)).resolves.toMatchObject({
      bytesUnavailable: true,
      readbackVerified: true,
    });
  });

  it("recovers a crashed writer's part, orphan blob, and atomic temp files", async () => {
    const { descriptorValue, port, stateRoot } = await fixture();
    const moduleUrl = new URL(
      "../../src/lib/evolution/browser-filesystem-quarantine-custody.js",
      import.meta.url,
    ).href;
    const childSource = `
      import { createHash } from "node:crypto";
      import {
        captureBrowserFilesystemQuarantineCustody,
        createBrowserFilesystemQuarantineCustody,
      } from ${JSON.stringify(moduleUrl)};
      const descriptor = ${JSON.stringify(descriptorValue)};
      const stateRoot = ${JSON.stringify(stateRoot)};
      const sha = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
      const port = captureBrowserFilesystemQuarantineCustody(
        createBrowserFilesystemQuarantineCustody({
          descriptor,
          stateRoot,
          now: () => ${NOW},
        }),
      );
      const session = await port.openQuarantine({
        artifactId: "artifact-1",
        tenantId: "tenant-1",
        maxBytes: 1024,
        contentType: "application/pdf",
        networkReceiptDigest: sha("network"),
        actionReceiptDigest: sha("action"),
      });
      await session.writeChunk(Buffer.from("partial"));
      process.stdout.write(JSON.stringify({ status: "writing" }) + "\\n");
      setInterval(() => {}, 60_000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await nextJsonLine(child.stdout);
      await expect(port.openQuarantine(openInput())).rejects.toMatchObject({
        code: "BROWSER_FILESYSTEM_QUARANTINE_ARTIFACT_LOCKED",
      });
      const exited = once(child, "exit");
      child.kill();
      await exited;

      const metadataTemp = path.join(
        stateRoot,
        "metadata",
        `artifact-1.json.${randomUUID()}.tmp`,
      );
      const deletionTemp = path.join(
        stateRoot,
        "deletions",
        `artifact-1.intent.json.${randomUUID()}.tmp`,
      );
      const orphanBlob = path.join(stateRoot, "objects", "artifact-1.blob");
      await Promise.all([
        writeFile(metadataTemp, "incomplete metadata"),
        writeFile(deletionTemp, "incomplete deletion"),
        writeFile(orphanBlob, "orphan"),
      ]);

      const recovered = await port.openQuarantine(openInput());
      await recovered.writeChunk(Buffer.from("fresh"));
      await expect(
        recovered.commitArtifact({
          artifactDigest: digest("fresh"),
          sizeBytes: 5,
          contentType: "application/pdf",
        }),
      ).resolves.toMatchObject({
        artifactRef: "quarantine:artifact-1",
        artifactDigest: digest("fresh"),
        readbackVerified: true,
      });
      for (const file of [metadataTemp, deletionTemp])
        await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited.catch(() => {});
      }
    }
  });

  it("fails closed without deleting unknown recovery entries", async () => {
    const { descriptorValue, port, stateRoot } = await fixture();
    const session = await port.openQuarantine(openInput());
    await session.discardArtifact();
    const unknown = path.join(stateRoot, "objects", "operator-notes.txt");
    await writeFile(unknown, "do not sweep");
    const reopened = captureBrowserFilesystemQuarantineCustody(
      createBrowserFilesystemQuarantineCustody({
        descriptor: descriptorValue,
        stateRoot,
        now: () => NOW + 1000,
      }),
    );

    await expect(
      reopened.openQuarantine(openInput({ artifactId: "artifact-2" })),
    ).rejects.toThrow(/object entry is unknown/u);
    await expect(access(unknown)).resolves.toBeUndefined();
  });

  it("blocks a second process and recovers the lock after its owner crashes", async () => {
    const { descriptorValue, stateRoot } = await fixture();
    const moduleUrl = new URL(
      "../../src/lib/evolution/browser-filesystem-quarantine-custody.js",
      import.meta.url,
    ).href;
    const childSource = `
      import { createHash } from "node:crypto";
      import {
        captureBrowserFilesystemQuarantineCustody,
        createBrowserFilesystemQuarantineCustody,
      } from ${JSON.stringify(moduleUrl)};
      const descriptor = ${JSON.stringify(descriptorValue)};
      const stateRoot = ${JSON.stringify(stateRoot)};
      const sha = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
      const port = captureBrowserFilesystemQuarantineCustody(
        createBrowserFilesystemQuarantineCustody({
          descriptor,
          stateRoot,
          now: () => ${NOW},
        }),
      );
      const session = await port.openQuarantine({
        artifactId: "artifact-1",
        tenantId: "tenant-1",
        maxBytes: 1024,
        contentType: "application/pdf",
        networkReceiptDigest: sha("network"),
        actionReceiptDigest: sha("action"),
      });
      await session.writeChunk(Buffer.from("content"));
      const committed = await session.commitArtifact({
        artifactDigest: sha("content"),
        sizeBytes: 7,
        contentType: "application/pdf",
      });
      const source = await port.openArtifactForScan({
        artifactRef: committed.artifactRef,
        artifactDigest: committed.artifactDigest,
        sizeBytes: committed.sizeBytes,
        contentType: committed.contentType,
        quarantineReceiptDigest: committed.quarantineReceiptDigest,
      });
      const reader = source.body[Symbol.asyncIterator]();
      await reader.next();
      process.stdout.write(JSON.stringify(committed) + "\\n");
      setInterval(() => {}, 60_000);
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const committed = await nextJsonLine(child.stdout);
      const reopened = captureBrowserFilesystemQuarantineCustody(
        createBrowserFilesystemQuarantineCustody({
          descriptor: descriptorValue,
          stateRoot,
          now: () => NOW + 2000,
        }),
      );
      const dispose = reopened.bindDisposalAuthority(
        disposalDescriptor(descriptorValue.handlerArtifactDigest),
      );
      const disposalInput = {
        actionReceiptDigest: digest("cross-process-action"),
        requestDigest: digest("cross-process-request"),
        artifactRef: committed.artifactRef,
        artifactDigest: committed.artifactDigest,
        sourceActionReceiptDigest: digest("action"),
        reason: "revoked",
      };

      await expect(dispose(disposalInput)).rejects.toMatchObject({
        code: "BROWSER_FILESYSTEM_QUARANTINE_ARTIFACT_LOCKED",
      });
      const exited = once(child, "exit");
      child.kill();
      await exited;
      await expect(dispose(disposalInput)).resolves.toMatchObject({
        bytesUnavailable: true,
        durable: true,
        readbackVerified: true,
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited.catch(() => {});
      }
    }
  });
});
