import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";
import {
  BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA,
  BROWSER_QUARANTINE_RETENTION_SWEEP_REQUEST_SCHEMA,
  captureBrowserQuarantineRetentionAuthority,
  createBrowserQuarantineRetentionAuthority,
} from "../../src/lib/evolution/browser-quarantine-retention-authority.js";

const NOW = Date.parse("2026-09-20T09:00:00.000Z");
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function retentionDescriptor(overrides = {}) {
  return {
    schema: BROWSER_FILESYSTEM_QUARANTINE_RETENTION_DESCRIPTOR_SCHEMA,
    authorityId: "browser-quarantine-retention",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    policyRevision: "retention-policy-1",
    maxBatchSize: 10,
    maxGrantTtlMs: 5000,
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-expiry-disposal",
    ...overrides,
  };
}

function durableOutcomeAck(request) {
  return {
    schema: BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA,
    authorityId: "browser-quarantine-retention",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    sweepReceiptDigest: request.sweepReceiptDigest,
    outcomeRequestDigest: request.outcomeRequestDigest,
    auditEventDigest: digest("audit-event"),
    durabilityReceiptDigest: digest("durability-receipt"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  };
}

describe("browser quarantine retention authority", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture() {
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-browser-quarantine-retention-"),
    );
    roots.push(stateRoot);
    let clock = NOW;
    const custody = createBrowserFilesystemQuarantineCustody({
      descriptor: {
        schema: BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
        custodyId: "download-custody-test",
        tenantId: "tenant-1",
        handlerArtifactDigest: digest("handler"),
        retentionMs: 1000,
        custodyMode: "exclusive-stream-fsync",
      },
      stateRoot,
      now: () => clock,
    });
    const port = captureBrowserFilesystemQuarantineCustody(custody);
    const commit = async (artifactId, content) => {
      const session = await port.openQuarantine({
        artifactId,
        tenantId: "tenant-1",
        maxBytes: 1024,
        contentType: "application/pdf",
        networkReceiptDigest: digest(`network:${artifactId}`),
        actionReceiptDigest: digest(`action:${artifactId}`),
      });
      await session.writeChunk(Buffer.from(content));
      return session.commitArtifact({
        artifactDigest: digest(content),
        sizeBytes: Buffer.byteLength(content),
        contentType: "application/pdf",
      });
    };
    const expired = await commit("expired-artifact", "expired");
    clock = NOW + 1500;
    const current = await commit("current-artifact", "current");
    clock = NOW + 2000;
    return {
      custody,
      port,
      expired,
      current,
      now: () => clock,
    };
  }

  it("deletes only metadata-expired artifacts after policy authorization", async () => {
    const { custody, port, expired, current, now } = await fixture();
    const authorizeSweep = vi.fn(async (request) => ({
      decision: "allow",
      policyEvidenceRef: `policy:${request.planDigest}`,
      validUntil: new Date(now() + 1000).toISOString(),
    }));
    const recordOutcome = vi.fn(async (request) => durableOutcomeAck(request));
    const authority = captureBrowserQuarantineRetentionAuthority(
      createBrowserQuarantineRetentionAuthority({
        descriptor: retentionDescriptor(),
        custody,
        authorizeSweep,
        recordOutcome,
        now,
      }),
    );

    await expect(authority.runExpirySweep()).resolves.toMatchObject({
      plannedCount: 1,
      deletedCount: 1,
      deletions: [
        {
          artifactDigest: expired.artifactDigest,
          deletionReceiptDigest: expect.stringMatching(/^sha256:/u),
        },
      ],
      resultDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: digest("audit-event"),
      durabilityReceiptDigest: digest("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      qualifiesForPromotion: false,
    });
    expect(authorizeSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: BROWSER_QUARANTINE_RETENTION_SWEEP_REQUEST_SCHEMA,
        artifactCount: 1,
        artifacts: [
          expect.objectContaining({
            artifactDigest: expired.artifactDigest,
            expiresAt: new Date(NOW + 1000).toISOString(),
          }),
        ],
      }),
    );
    expect(JSON.stringify(authorizeSweep.mock.calls[0][0])).not.toContain(
      "quarantine:",
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        plannedCount: 1,
        deletedCount: 1,
        outcomeRequestDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    await expect(port.inspectArtifact(expired.artifactRef)).rejects.toThrow(
      /ENOENT/u,
    );
    await expect(
      port.inspectArtifact(current.artifactRef),
    ).resolves.toMatchObject({ artifactDigest: current.artifactDigest });
  });

  it("fails closed on policy denial and substituted composition inputs", async () => {
    const { custody, port, expired, now } = await fixture();
    const authority = captureBrowserQuarantineRetentionAuthority(
      createBrowserQuarantineRetentionAuthority({
        descriptor: retentionDescriptor(),
        custody,
        authorizeSweep: async () => ({
          decision: "deny",
          reason: "retention policy is paused",
        }),
        recordOutcome: vi.fn(),
        now,
      }),
    );
    await expect(authority.runExpirySweep()).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_RETENTION_DENIED",
    });
    await expect(
      port.inspectArtifact(expired.artifactRef),
    ).resolves.toMatchObject({ artifactDigest: expired.artifactDigest });

    expect(() =>
      createBrowserQuarantineRetentionAuthority({
        descriptor: retentionDescriptor({ tenantId: "tenant-2" }),
        custody,
        authorizeSweep: async () => ({ decision: "deny", reason: "deny" }),
        recordOutcome: vi.fn(),
        now,
      }),
    ).toThrow(/retention descriptor is invalid/u);
    expect(() =>
      createBrowserQuarantineRetentionAuthority({
        descriptor: retentionDescriptor(),
        custody: {},
        authorizeSweep: async () => ({ decision: "deny", reason: "deny" }),
        recordOutcome: vi.fn(),
        now,
      }),
    ).toThrow(/branded filesystem quarantine custody/u);
  });

  it("durably records a failed sweep without deleting an active scan", async () => {
    const { custody, port, expired, now } = await fixture();
    const source = await port.openArtifactForScan({
      artifactRef: expired.artifactRef,
      artifactDigest: expired.artifactDigest,
      sizeBytes: 7,
      contentType: "application/pdf",
      quarantineReceiptDigest: expired.quarantineReceiptDigest,
    });
    const reader = source.body[Symbol.asyncIterator]();
    await reader.next();
    const recordOutcome = vi.fn(async (request) => durableOutcomeAck(request));
    const authority = captureBrowserQuarantineRetentionAuthority(
      createBrowserQuarantineRetentionAuthority({
        descriptor: retentionDescriptor(),
        custody,
        authorizeSweep: async () => ({
          decision: "allow",
          policyEvidenceRef: "retention-policy-evidence",
          validUntil: new Date(now() + 1000).toISOString(),
        }),
        recordOutcome,
        now,
      }),
    );

    await expect(authority.runExpirySweep()).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_RETENTION_SWEEP_FAILED",
    });
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        plannedCount: 1,
        deletedCount: 0,
        failureDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    await expect(
      port.inspectArtifact(expired.artifactRef),
    ).resolves.toMatchObject({ artifactDigest: expired.artifactDigest });
    await reader.return();
  });
});
