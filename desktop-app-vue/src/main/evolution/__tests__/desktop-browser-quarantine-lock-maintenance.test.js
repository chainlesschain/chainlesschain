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
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { describe, expect, it, vi } from "vitest";

const {
  computeDIDFromPublicKey,
  verifyPayloadAgainstDid,
} = require("../../did/did-signer");
const {
  CHANNEL,
  createDesktopBrowserQuarantineLockMaintenanceHost,
  maintainDesktopBrowserQuarantineLock,
  registerDesktopBrowserQuarantineLockMaintenanceIPC,
} = require("../desktop-browser-quarantine-lock-maintenance");

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function identity() {
  const pair = nacl.sign.keyPair();
  return {
    did: computeDIDFromPublicKey(pair.publicKey),
    public_key_sign: naclUtil.encodeBase64(pair.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(pair.secretKey),
    }),
  };
}

function database(role = "admin") {
  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        get: () => {
          if (sql.includes("FROM organizations"))
            return role === "owner" ? { ok: 1 } : undefined;
          return role === null ? undefined : { role };
        },
      }),
    }),
  };
}

const artifactRef = "quarantine:artifact-1";
const lockStateDigest = digest("test", "lock-state");
const input = Object.freeze({
  operation: "inspect",
  artifactRef,
  expectedLockStateDigest: null,
  caseId: "INC-LOCK-100",
  justification: "Investigate a suspected PID-reused quarantine lock",
});

function fixture() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "desktop-lock-maintenance",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "operator-signed",
    auditMode: "authenticated-durable-readback",
    effectMode: "orphan-lock-release",
  });
  const maintainLock = vi.fn(async (request) => {
    const releasing = request.operation === "release";
    const core = Object.freeze({
      schema: "chainlesschain.browser-quarantine-lock-maintenance-result/v1",
      status: releasing ? "released" : "inspected",
      operation: request.operation,
      artifactRefDigest: digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ),
      lockStatus: "owned-live",
      ownerOperation: "write",
      ownerProcessDigest: digest("test", "process"),
      ownerAcquiredAt: "2026-09-20T12:59:00.000Z",
      lockStateDigest,
      releaseReceiptDigest: releasing ? digest("test", "release") : null,
      operatorIdDigest: request.operatorIdDigest,
      outcomeRequestDigest: digest("test", "outcome"),
      auditEventDigest: digest("test", "audit"),
      durabilityReceiptDigest: digest("test", "durability"),
    });
    return Object.freeze({
      ...core,
      resultDigest: digest(core.schema, core),
    });
  });
  const capture = vi.fn((value) => {
    if (value !== authority) throw new TypeError("unbranded authority");
    return Object.freeze({ descriptor, maintainLock });
  });
  return {
    host: createDesktopBrowserQuarantineLockMaintenanceHost(authority, capture),
    maintainLock,
  };
}

function context(operatorIdentity, overrides = {}) {
  return {
    didManager: { getCurrentIdentity: () => operatorIdentity },
    database: database("admin"),
    senderId: 17,
    frameUrl: "app://desktop/index.html",
    now: () => Date.parse("2026-09-20T13:00:00.000Z"),
    ...overrides,
  };
}

describe("Desktop browser quarantine lock maintenance", () => {
  it("derives RBAC and a verified DID signature in the main process", async () => {
    const operatorIdentity = identity();
    const { host, maintainLock } = fixture();
    await expect(
      maintainDesktopBrowserQuarantineLock(
        host,
        input,
        context(operatorIdentity),
      ),
    ).resolves.toMatchObject({
      status: "inspected",
      operation: "inspect",
      lockStatus: "owned-live",
      lockStateDigest,
    });

    const request = maintainLock.mock.calls[0][0];
    expect(request.authorization.signedPayload).toMatchObject({
      tenantId: "tenant-1",
      senderId: 17,
      role: "admin",
      permission: "browser.quarantine.lock.maintain",
      operation: "inspect",
      caseId: "INC-LOCK-100",
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(
      verifyPayloadAgainstDid(
        request.authorization.signedPayload,
        operatorIdentity.did,
        request.authorization.senderPublicKey,
        request.authorization.signature,
      ),
    ).toEqual({ ok: true });
    expect(JSON.stringify(request.authorization)).not.toContain(artifactRef);
  });

  it("rejects renderer actor claims and fails closed on DID/RBAC errors", async () => {
    const operatorIdentity = identity();
    const { host, maintainLock } = fixture();
    for (const claimed of [
      { operatorDid: "did:chainlesschain:spoofed" },
      { role: "owner" },
      { signature: "spoofed" },
    ]) {
      await expect(
        maintainDesktopBrowserQuarantineLock(
          host,
          { ...input, ...claimed },
          context(operatorIdentity),
        ),
      ).rejects.toThrow(/unexpected/u);
    }
    await expect(
      maintainDesktopBrowserQuarantineLock(host, input, context(null)),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_LOCK_MAINTENANCE_AUTHENTICATION_REQUIRED",
    });
    await expect(
      maintainDesktopBrowserQuarantineLock(
        host,
        input,
        context(operatorIdentity, { database: database("member") }),
      ),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_LOCK_MAINTENANCE_RBAC_DENIED",
    });
    await expect(
      maintainDesktopBrowserQuarantineLock(
        host,
        input,
        context({ ...operatorIdentity, did: "did:chainlesschain:spoofed" }),
      ),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_LOCK_MAINTENANCE_SIGNATURE_INVALID",
    });
    expect(maintainLock).not.toHaveBeenCalled();
  });

  it("registers one dedicated operator IPC channel", async () => {
    const operatorIdentity = identity();
    const { host, maintainLock } = fixture();
    const handlers = new Map();
    registerDesktopBrowserQuarantineLockMaintenanceIPC({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      host,
      didManager: { getCurrentIdentity: () => operatorIdentity },
      database: database("owner"),
      now: () => Date.parse("2026-09-20T13:00:00.000Z"),
    });
    expect([...handlers.keys()]).toEqual([CHANNEL]);
    await expect(
      handlers.get(CHANNEL)(
        {
          sender: { id: 23, getURL: () => "app://desktop/fallback.html" },
          senderFrame: { url: "app://desktop/operator.html" },
        },
        input,
      ),
    ).resolves.toMatchObject({ status: "inspected" });
    expect(
      maintainLock.mock.calls[0][0].authorization.signedPayload,
    ).toMatchObject({ senderId: 23, role: "owner" });
  });

  it("carries signed DID/RBAC evidence through real authority and custody", async () => {
    const custodyModule =
      await import("../../../../../packages/cli/src/lib/evolution/browser-filesystem-quarantine-custody.js");
    const maintenanceModule =
      await import("../../../../../packages/cli/src/lib/evolution/browser-quarantine-lock-maintenance-authority.js");
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-desktop-lock-maintenance-"),
    );
    const operatorIdentity = identity();
    const nowMs = Date.parse("2026-09-20T13:00:00.000Z");
    try {
      const handlerArtifactDigest = digest("test", "real-handler");
      const lockDirectory = path.join(stateRoot, "locks", "artifact-real.lock");
      await Promise.all([
        mkdir(lockDirectory, { recursive: true }),
        mkdir(path.join(stateRoot, "objects"), { recursive: true }),
      ]);
      await Promise.all([
        mkdir(path.join(stateRoot, "metadata"), { recursive: true }),
        mkdir(path.join(stateRoot, "deletions"), { recursive: true }),
        writeFile(path.join(stateRoot, "objects", "artifact-real.part"), "x"),
        writeFile(
          path.join(lockDirectory, "owner.json"),
          `${canonical({
            schema:
              custodyModule.BROWSER_FILESYSTEM_QUARANTINE_LOCK_OWNER_SCHEMA,
            custodyId: "desktop-lock-custody",
            tenantId: "tenant-1",
            artifactId: "artifact-real",
            operation: "write",
            lockId: randomUUID(),
            pid: process.pid,
            acquiredAt: new Date(nowMs - 60_000).toISOString(),
          })}\n`,
        ),
      ]);
      const custody = custodyModule.createBrowserFilesystemQuarantineCustody({
        descriptor: {
          schema:
            custodyModule.BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
          custodyId: "desktop-lock-custody",
          tenantId: "tenant-1",
          handlerArtifactDigest,
          retentionMs: 60_000,
          custodyMode: "exclusive-stream-fsync",
        },
        stateRoot,
        now: () => nowMs,
      });
      const policy = vi.fn(async (request) => {
        const authorization = request.authorization;
        const verified = verifyPayloadAgainstDid(
          authorization.signedPayload,
          operatorIdentity.did,
          authorization.senderPublicKey,
          authorization.signature,
        );
        if (
          verified.ok !== true ||
          authorization.signedPayload.operatorIdDigest !==
            request.operatorIdDigest ||
          authorization.signedPayload.role !== "admin" ||
          authorization.signedPayload.permission !==
            "browser.quarantine.lock.maintain"
        )
          return { decision: "deny", reason: "invalid operator evidence" };
        return {
          decision: "allow",
          operatorEvidenceRef: "operator-signature:INC-LOCK-100",
          validUntil: new Date(nowMs + 1000).toISOString(),
        };
      });
      const authority =
        maintenanceModule.createBrowserQuarantineLockMaintenanceAuthority({
          descriptor: {
            schema:
              maintenanceModule.BROWSER_FILESYSTEM_QUARANTINE_LOCK_MAINTENANCE_DESCRIPTOR_SCHEMA,
            authorityId: "desktop-lock-maintenance",
            tenantId: "tenant-1",
            handlerArtifactDigest,
            policyRevision: "operator-policy-1",
            maxGrantTtlMs: 5000,
            approvalMode: "operator-signed",
            auditMode: "authenticated-durable-readback",
            effectMode: "orphan-lock-release",
          },
          custody,
          authorizeMaintenance: policy,
          recordOutcome: async (request) => ({
            schema:
              maintenanceModule.BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_ACK_SCHEMA,
            authorityId: "desktop-lock-maintenance",
            tenantId: "tenant-1",
            handlerArtifactDigest,
            maintenanceReceiptDigest: request.maintenanceReceiptDigest,
            outcomeRequestDigest: request.outcomeRequestDigest,
            auditEventDigest: digest("test", "real-audit"),
            durabilityReceiptDigest: digest("test", "real-durability"),
            authenticated: true,
            durable: true,
            readbackVerified: true,
            qualifiesForPromotion: false,
          }),
          now: () => nowMs,
        });
      const host = createDesktopBrowserQuarantineLockMaintenanceHost(
        authority,
        maintenanceModule.captureBrowserQuarantineLockMaintenanceAuthority,
      );
      const inspectResult = await maintainDesktopBrowserQuarantineLock(
        host,
        {
          ...input,
          artifactRef: "quarantine:artifact-real",
        },
        context(operatorIdentity, { now: () => nowMs }),
      );
      expect(inspectResult).toMatchObject({
        status: "inspected",
        lockStatus: "owned-live",
      });
      await expect(
        maintainDesktopBrowserQuarantineLock(
          host,
          {
            ...input,
            operation: "release",
            artifactRef: "quarantine:artifact-real",
            expectedLockStateDigest: inspectResult.lockStateDigest,
          },
          context(operatorIdentity, { now: () => nowMs }),
        ),
      ).resolves.toMatchObject({
        status: "released",
        releaseReceiptDigest: expect.stringMatching(/^sha256:/u),
        auditEventDigest: digest("test", "real-audit"),
      });
      expect(policy).toHaveBeenCalledTimes(2);
      await expect(access(lockDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(path.join(stateRoot, "objects", "artifact-real.part"), "utf8"),
      ).resolves.toBe("x");
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
