import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
  BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
  captureBrowserDownloadArtifactDisposalAuthority,
} from "../../src/lib/evolution/browser-download-artifact-disposal-authority.js";
import { createBrowserFilesystemQuarantineDisposalAuthority } from "../../src/lib/evolution/browser-filesystem-quarantine-disposal.js";
import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";

const NOW = Date.parse("2026-09-20T08:00:00.000Z");
const rawDigest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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

function disposalDescriptor(overrides = {}) {
  return {
    schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA,
    authorityId: "browser-download-disposal",
    tenantId: "tenant-1",
    handlerArtifactDigest: rawDigest("handler"),
    policyRevision: "policy-1",
    maxGrantTtlMs: 5000,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
    ...overrides,
  };
}

describe("browser filesystem quarantine disposal composition", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture() {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-browser-quarantine-disposal-"),
    );
    roots.push(stateRoot);
    const custody = createBrowserFilesystemQuarantineCustody({
      descriptor: {
        schema: BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
        custodyId: "download-custody-test",
        tenantId: "tenant-1",
        handlerArtifactDigest: rawDigest("handler"),
        retentionMs: 60_000,
        custodyMode: "exclusive-stream-fsync",
      },
      stateRoot,
      now: () => NOW,
    });
    return {
      custody,
      port: captureBrowserFilesystemQuarantineCustody(custody),
    };
  }

  it("binds policy authorization to the real custody deletion port", async () => {
    const { custody, port } = await fixture();
    const session = await port.openQuarantine({
      artifactId: "artifact-1",
      tenantId: "tenant-1",
      maxBytes: 1024,
      contentType: "application/pdf",
      networkReceiptDigest: rawDigest("network"),
      actionReceiptDigest: rawDigest("download-action"),
    });
    await session.writeChunk(Buffer.from("content"));
    const committed = await session.commitArtifact({
      artifactDigest: rawDigest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    const authorize = vi.fn(async () => ({
      decision: "allow",
      approvalEvidenceRef: "approval-1",
      validUntil: new Date(NOW + 5000).toISOString(),
    }));
    const authority = captureBrowserDownloadArtifactDisposalAuthority(
      createBrowserFilesystemQuarantineDisposalAuthority({
        descriptor: disposalDescriptor(),
        custody,
        authorize,
        now: () => NOW + 1000,
      }),
    );
    const inputCore = {
      operation: "discard-download-artifact",
      artifactRef: committed.artifactRef,
      artifactDigest: committed.artifactDigest,
      sourceActionReceiptDigest: rawDigest("download-action"),
      reason: "user-discard",
    };
    const receipt = await authority.authorizeDisposal({
      schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
      requestId: "request-1",
      senderId: 17,
      frameUrlDigest: rawDigest("frame"),
      ...inputCore,
      inputDigest: digest(
        "chainlesschain.browser-download-artifact-disposal-input/v1",
        inputCore,
      ),
      authorization: { approval: "interactive" },
      requestedAt: new Date(NOW).toISOString(),
    });

    await expect(
      authority.disposeAuthorizedArtifact({
        receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest,
      }),
    ).resolves.toMatchObject({
      status: "discarded",
      artifactDigest: committed.artifactDigest,
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(authorize).toHaveBeenCalledOnce();
    await expect(port.inspectArtifact(committed.artifactRef)).rejects.toThrow(
      /ENOENT/u,
    );
  });

  it("rejects unbranded custody, substituted bindings, and disposal injection", async () => {
    const { custody } = await fixture();
    const base = {
      descriptor: disposalDescriptor(),
      custody,
      authorize: async () => ({ decision: "deny" }),
      now: () => NOW,
    };
    expect(() =>
      createBrowserFilesystemQuarantineDisposalAuthority({
        ...base,
        custody: {},
      }),
    ).toThrow(/branded filesystem quarantine custody/u);
    expect(() =>
      createBrowserFilesystemQuarantineDisposalAuthority({
        ...base,
        descriptor: disposalDescriptor({ tenantId: "tenant-2" }),
      }),
    ).toThrow(/descriptor is invalid/u);
    expect(() =>
      createBrowserFilesystemQuarantineDisposalAuthority({
        ...base,
        disposeArtifact: async () => ({ bytesUnavailable: true }),
      }),
    ).toThrow(/unexpected or accessor fields/u);
  });
});
