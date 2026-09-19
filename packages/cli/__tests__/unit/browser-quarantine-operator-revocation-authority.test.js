import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";
import {
  BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_ACK_SCHEMA,
  BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA,
  captureBrowserQuarantineOperatorRevocationAuthority,
  createBrowserQuarantineOperatorRevocationAuthority,
} from "../../src/lib/evolution/browser-quarantine-operator-revocation-authority.js";

const NOW = Date.parse("2026-09-20T11:00:00.000Z");
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function descriptor(overrides = {}) {
  return {
    schema: BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA,
    authorityId: "browser-quarantine-operator-revocation",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    policyRevision: "operator-policy-1",
    maxGrantTtlMs: 5000,
    approvalMode: "operator-signed",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-revocation",
    ...overrides,
  };
}

function outcomeAck(request) {
  return {
    schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_ACK_SCHEMA,
    authorityId: "browser-quarantine-operator-revocation",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    revocationReceiptDigest: request.revocationReceiptDigest,
    outcomeRequestDigest: request.outcomeRequestDigest,
    auditEventDigest: digest("audit-event"),
    durabilityReceiptDigest: digest("durability"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  };
}

describe("browser quarantine operator revocation authority", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture() {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-browser-operator-revocation-"),
    );
    roots.push(stateRoot);
    const custody = createBrowserFilesystemQuarantineCustody({
      descriptor: {
        schema: BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
        custodyId: "download-custody-test",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        retentionMs: 60_000,
        custodyMode: "exclusive-stream-fsync",
      },
      stateRoot,
      now: () => NOW,
    });
    const port = captureBrowserFilesystemQuarantineCustody(custody);
    const session = await port.openQuarantine({
      artifactId: "artifact-1",
      tenantId: "tenant-1",
      maxBytes: 1024,
      contentType: "application/pdf",
      networkReceiptDigest: digest("network"),
      actionReceiptDigest: digest("download-action"),
    });
    await session.writeChunk(Buffer.from("content"));
    const artifact = await session.commitArtifact({
      artifactDigest: digest("content"),
      sizeBytes: 7,
      contentType: "application/pdf",
    });
    return { artifact, custody, port };
  }

  function request(artifact) {
    return {
      schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA,
      requestId: "operator-request-1",
      artifactRef: artifact.artifactRef,
      artifactDigest: artifact.artifactDigest,
      sourceActionReceiptDigest: digest("download-action"),
      operatorIdDigest: digest("operator-1"),
      authorization: { role: "security-operator", ticket: "INC-100" },
      requestedAt: new Date(NOW).toISOString(),
    };
  }

  it("revokes one exact artifact without exposing its reference to policy or audit", async () => {
    const { artifact, custody, port } = await fixture();
    const authorizeRevocation = vi.fn(async () => ({
      decision: "allow",
      operatorEvidenceRef: "operator-signature-1",
      validUntil: new Date(NOW + 1000).toISOString(),
    }));
    const recordOutcome = vi.fn(async (value) => outcomeAck(value));
    const authority = captureBrowserQuarantineOperatorRevocationAuthority(
      createBrowserQuarantineOperatorRevocationAuthority({
        descriptor: descriptor(),
        custody,
        authorizeRevocation,
        recordOutcome,
        now: () => NOW,
      }),
    );

    await expect(
      authority.revokeArtifact(request(artifact)),
    ).resolves.toMatchObject({
      status: "revoked",
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      artifactDigest: artifact.artifactDigest,
      operatorIdDigest: digest("operator-1"),
      deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: digest("audit-event"),
      resultDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(authorizeRevocation.mock.calls[0][0])).not.toContain(
      "quarantine:",
    );
    expect(authorizeRevocation.mock.calls[0][0].authorization).toEqual(
      request(artifact).authorization,
    );
    expect(JSON.stringify(recordOutcome.mock.calls[0][0])).not.toContain(
      "quarantine:",
    );
    await expect(port.inspectArtifact(artifact.artifactRef)).rejects.toThrow(
      /ENOENT/u,
    );
  });

  it("records a failed revoke and rejects substituted custody bindings", async () => {
    const { artifact, custody, port } = await fixture();
    const source = await port.openArtifactForScan({
      artifactRef: artifact.artifactRef,
      artifactDigest: artifact.artifactDigest,
      sizeBytes: 7,
      contentType: "application/pdf",
      quarantineReceiptDigest: artifact.quarantineReceiptDigest,
    });
    const reader = source.body[Symbol.asyncIterator]();
    await reader.next();
    const recordOutcome = vi.fn(async (value) => outcomeAck(value));
    const authority = captureBrowserQuarantineOperatorRevocationAuthority(
      createBrowserQuarantineOperatorRevocationAuthority({
        descriptor: descriptor(),
        custody,
        authorizeRevocation: async () => ({
          decision: "allow",
          operatorEvidenceRef: "operator-signature-1",
          validUntil: new Date(NOW + 1000).toISOString(),
        }),
        recordOutcome,
        now: () => NOW,
      }),
    );
    await expect(
      authority.revokeArtifact(request(artifact)),
    ).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_OPERATOR_REVOCATION_FAILED",
    });
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        deletionReceiptDigest: null,
        failureDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    await expect(
      port.inspectArtifact(artifact.artifactRef),
    ).resolves.toMatchObject({ artifactDigest: artifact.artifactDigest });
    await reader.return();

    const denied = captureBrowserQuarantineOperatorRevocationAuthority(
      createBrowserQuarantineOperatorRevocationAuthority({
        descriptor: descriptor(),
        custody,
        authorizeRevocation: async () => ({
          decision: "deny",
          reason: "operator signature is not trusted",
        }),
        recordOutcome: vi.fn(),
        now: () => NOW,
      }),
    );
    await expect(
      denied.revokeArtifact(request(artifact)),
    ).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_OPERATOR_REVOCATION_DENIED",
    });
    await expect(
      port.inspectArtifact(artifact.artifactRef),
    ).resolves.toMatchObject({ artifactDigest: artifact.artifactDigest });

    expect(() =>
      createBrowserQuarantineOperatorRevocationAuthority({
        descriptor: descriptor({ tenantId: "tenant-2" }),
        custody,
        authorizeRevocation: vi.fn(),
        recordOutcome: vi.fn(),
        now: () => NOW,
      }),
    ).toThrow(/operator revocation descriptor is invalid/u);
  });
});
