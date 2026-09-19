import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_LOCK_MAINTENANCE_DESCRIPTOR_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
  createBrowserFilesystemQuarantineCustody,
} from "../../src/lib/evolution/browser-filesystem-quarantine-custody.js";
import {
  BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_ACK_SCHEMA,
  BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA,
  captureBrowserQuarantineLockMaintenanceAuthority,
  createBrowserQuarantineLockMaintenanceAuthority,
} from "../../src/lib/evolution/browser-quarantine-lock-maintenance-authority.js";

const NOW = Date.parse("2026-09-20T13:00:00.000Z");
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

function descriptor(overrides = {}) {
  return {
    schema: BROWSER_FILESYSTEM_QUARANTINE_LOCK_MAINTENANCE_DESCRIPTOR_SCHEMA,
    authorityId: "browser-quarantine-lock-maintenance",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    policyRevision: "lock-policy-1",
    maxGrantTtlMs: 5000,
    approvalMode: "operator-signed",
    auditMode: "authenticated-durable-readback",
    effectMode: "orphan-lock-release",
    ...overrides,
  };
}

function request(operation, expectedLockStateDigest = null) {
  return {
    schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA,
    requestId: `lock-${operation}-1`,
    operation,
    artifactRef: "quarantine:artifact-1",
    expectedLockStateDigest,
    operatorIdDigest: digest("operator-1"),
    authorization: { role: "security-operator", ticket: "INC-LOCK-100" },
    requestedAt: new Date(NOW).toISOString(),
  };
}

function outcomeAck(value) {
  return {
    schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_ACK_SCHEMA,
    authorityId: "browser-quarantine-lock-maintenance",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("handler"),
    maintenanceReceiptDigest: value.maintenanceReceiptDigest,
    outcomeRequestDigest: value.outcomeRequestDigest,
    auditEventDigest: digest("audit-event"),
    durabilityReceiptDigest: digest("durability"),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    qualifiesForPromotion: false,
  };
}

describe("browser quarantine lock maintenance authority", () => {
  const roots = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function fixture({ fakeLock = true } = {}) {
    const stateRoot = await mkdtemp(path.join(tmpdir(), "cc-browser-lock-op-"));
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
    await port
      .bindLockMaintenanceAuthority(descriptor())
      .inspectLock("quarantine:bootstrap");
    if (fakeLock) {
      const lockDirectory = path.join(stateRoot, "locks", "artifact-1.lock");
      await mkdir(lockDirectory);
      await Promise.all([
        writeFile(
          path.join(stateRoot, "objects", "artifact-1.part"),
          "preserve-me",
        ),
        writeFile(
          path.join(lockDirectory, "owner.json"),
          `${canonical({
            schema: BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA,
            custodyId: "download-custody-test",
            tenantId: "tenant-1",
            artifactId: "artifact-1",
            operation: "write",
            lockId: randomUUID(),
            pid: process.pid,
            acquiredAt: new Date(NOW - 60_000).toISOString(),
          })}\n`,
        ),
      ]);
    }
    return { custody, port, stateRoot };
  }

  function authority(custody, overrides = {}) {
    return captureBrowserQuarantineLockMaintenanceAuthority(
      createBrowserQuarantineLockMaintenanceAuthority({
        descriptor: descriptor(),
        custody,
        authorizeMaintenance:
          overrides.authorizeMaintenance ??
          (async () => ({
            decision: "allow",
            operatorEvidenceRef: "operator-signature-1",
            validUntil: new Date(NOW + 1000).toISOString(),
          })),
        recordOutcome: overrides.recordOutcome ?? (async (v) => outcomeAck(v)),
        now: () => NOW,
      }),
    );
  }

  it("audits inspection and releases only the exact diagnosed lock state", async () => {
    const { custody, stateRoot } = await fixture();
    const authorizeMaintenance = vi.fn(async () => ({
      decision: "allow",
      operatorEvidenceRef: "operator-signature-1",
      validUntil: new Date(NOW + 1000).toISOString(),
    }));
    const recordOutcome = vi.fn(async (value) => outcomeAck(value));
    const port = authority(custody, { authorizeMaintenance, recordOutcome });

    const inspected = await port.maintainLock(request("inspect"));
    expect(inspected).toMatchObject({
      status: "inspected",
      operation: "inspect",
      lockStatus: "owned-live",
      ownerOperation: "write",
      ownerProcessDigest: expect.stringMatching(/^sha256:/u),
      lockStateDigest: expect.stringMatching(/^sha256:/u),
      releaseReceiptDigest: null,
      auditEventDigest: digest("audit-event"),
    });
    const released = await port.maintainLock(
      request("release", inspected.lockStateDigest),
    );
    expect(released).toMatchObject({
      status: "released",
      operation: "release",
      lockStateDigest: inspected.lockStateDigest,
      releaseReceiptDigest: expect.stringMatching(/^sha256:/u),
      resultDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(authorizeMaintenance.mock.calls)).not.toContain(
      "quarantine:",
    );
    expect(JSON.stringify(recordOutcome.mock.calls)).not.toContain(
      "quarantine:",
    );
    await expect(
      access(path.join(stateRoot, "locks", "artifact-1.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(stateRoot, "objects", "artifact-1.part"), "utf8"),
    ).resolves.toBe("preserve-me");
  });

  it("audits changed or actively-held targets as failures", async () => {
    const { custody, port } = await fixture({ fakeLock: false });
    const recordOutcome = vi.fn(async (value) => outcomeAck(value));
    const maintenance = authority(custody, { recordOutcome });
    const session = await port.openQuarantine({
      artifactId: "artifact-1",
      tenantId: "tenant-1",
      maxBytes: 1024,
      contentType: "application/pdf",
      networkReceiptDigest: digest("network"),
      actionReceiptDigest: digest("action"),
    });
    const inspected = await maintenance.maintainLock(request("inspect"));

    await expect(
      maintenance.maintainLock(request("release", inspected.lockStateDigest)),
    ).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_LOCK_MAINTENANCE_FAILED",
    });
    expect(recordOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        lockStateDigest: inspected.lockStateDigest,
        releaseReceiptDigest: null,
        failureDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
    await expect(
      maintenance.maintainLock(request("release", digest("substituted"))),
    ).rejects.toMatchObject({
      code: "BROWSER_QUARANTINE_LOCK_MAINTENANCE_FAILED",
    });
    await session.discardArtifact();
  });

  it("rejects untrusted operator decisions and substituted custody", async () => {
    const { custody } = await fixture();
    const denied = authority(custody, {
      authorizeMaintenance: async () => ({
        decision: "deny",
        reason: "operator signature is not trusted",
      }),
      recordOutcome: vi.fn(),
    });
    await expect(denied.maintainLock(request("inspect"))).rejects.toMatchObject(
      {
        code: "BROWSER_QUARANTINE_LOCK_MAINTENANCE_DENIED",
      },
    );
    expect(() =>
      createBrowserQuarantineLockMaintenanceAuthority({
        descriptor: descriptor({ tenantId: "tenant-2" }),
        custody,
        authorizeMaintenance: vi.fn(),
        recordOutcome: vi.fn(),
        now: () => NOW,
      }),
    ).toThrow(/lock maintenance descriptor is invalid/u);
  });
});
