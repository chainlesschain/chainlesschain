import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
  createDesktopBrowserQuarantineOperatorRevocationHost,
  registerDesktopBrowserQuarantineOperatorRevocationIPC,
  revokeDesktopBrowserQuarantineArtifact,
} = require("../desktop-browser-quarantine-operator-revocation");

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

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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
const artifactDigest = digest("test", "artifact");
const sourceActionReceiptDigest = digest("test", "source-receipt");
const input = Object.freeze({
  artifactRef,
  artifactDigest,
  sourceActionReceiptDigest,
  caseId: "INC-100",
  justification: "Confirmed malicious payload from incident triage",
});

function fixture() {
  const authority = Object.freeze({});
  const descriptor = Object.freeze({
    authorityId: "desktop-operator-revocation",
    tenantId: "tenant-1",
    handlerArtifactDigest: digest("test", "handler"),
    approvalMode: "operator-signed",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-revocation",
  });
  const revokeArtifact = vi.fn(async (request) => {
    const core = Object.freeze({
      schema: "chainlesschain.browser-quarantine-operator-revocation-result/v1",
      status: "revoked",
      artifactRefDigest: digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ),
      artifactDigest: request.artifactDigest,
      sourceActionReceiptDigest: request.sourceActionReceiptDigest,
      operatorIdDigest: request.operatorIdDigest,
      discardedAt: "2026-09-20T12:00:00.000Z",
      deletionReceiptDigest: digest("test", "deletion"),
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
    return Object.freeze({ descriptor, revokeArtifact });
  });
  return {
    descriptor,
    host: createDesktopBrowserQuarantineOperatorRevocationHost(
      authority,
      capture,
    ),
    revokeArtifact,
  };
}

function context(operatorIdentity, overrides = {}) {
  return {
    didManager: { getCurrentIdentity: () => operatorIdentity },
    database: database("admin"),
    senderId: 17,
    frameUrl: "app://desktop/index.html",
    now: () => Date.parse("2026-09-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("Desktop browser quarantine operator revocation", () => {
  it("derives RBAC and a verified DID signature in the main process", async () => {
    const operatorIdentity = identity();
    const { host, revokeArtifact } = fixture();
    await expect(
      revokeDesktopBrowserQuarantineArtifact(
        host,
        input,
        context(operatorIdentity),
      ),
    ).resolves.toMatchObject({
      schema: "chainlesschain.browser-quarantine-operator-revocation-result/v1",
      status: "revoked",
      artifactRefDigest: expect.stringMatching(/^sha256:/u),
      operatorIdDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });

    const request = revokeArtifact.mock.calls[0][0];
    expect(request.authorization.signedPayload).toMatchObject({
      tenantId: "tenant-1",
      senderId: 17,
      role: "admin",
      permission: "browser.quarantine.revoke",
      caseId: "INC-100",
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

  it("rejects renderer-supplied identity, role or signature fields", async () => {
    const operatorIdentity = identity();
    const { host, revokeArtifact } = fixture();
    for (const claimed of [
      { operatorDid: "did:chainlesschain:spoofed" },
      { role: "owner" },
      { signature: "spoofed" },
    ]) {
      await expect(
        revokeDesktopBrowserQuarantineArtifact(
          host,
          { ...input, ...claimed },
          context(operatorIdentity),
        ),
      ).rejects.toThrow(/unexpected/u);
    }
    expect(revokeArtifact).not.toHaveBeenCalled();
  });

  it("fails closed before authority access without identity, role or valid DID binding", async () => {
    const operatorIdentity = identity();
    const { host, revokeArtifact } = fixture();
    await expect(
      revokeDesktopBrowserQuarantineArtifact(host, input, context(null)),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_OPERATOR_REVOCATION_AUTHENTICATION_REQUIRED",
    });
    await expect(
      revokeDesktopBrowserQuarantineArtifact(
        host,
        input,
        context(operatorIdentity, { database: database("member") }),
      ),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_OPERATOR_REVOCATION_RBAC_DENIED",
    });
    await expect(
      revokeDesktopBrowserQuarantineArtifact(
        host,
        input,
        context(operatorIdentity, {
          database: {
            getDatabase: () => {
              throw new Error("database unavailable");
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_OPERATOR_REVOCATION_RBAC_UNAVAILABLE",
    });
    await expect(
      revokeDesktopBrowserQuarantineArtifact(
        host,
        input,
        context({ ...operatorIdentity, did: "did:chainlesschain:spoofed" }),
      ),
    ).rejects.toMatchObject({
      code: "CC_BROWSER_OPERATOR_REVOCATION_SIGNATURE_INVALID",
    });
    expect(revokeArtifact).not.toHaveBeenCalled();
  });

  it("registers a dedicated operator IPC without accepting actor claims", async () => {
    const operatorIdentity = identity();
    const { host, revokeArtifact } = fixture();
    const handlers = new Map();
    registerDesktopBrowserQuarantineOperatorRevocationIPC({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      host,
      didManager: { getCurrentIdentity: () => operatorIdentity },
      database: database("owner"),
      now: () => Date.parse("2026-09-20T12:00:00.000Z"),
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
    ).resolves.toMatchObject({ status: "revoked" });
    expect(
      revokeArtifact.mock.calls[0][0].authorization.signedPayload,
    ).toMatchObject({ senderId: 23, role: "owner" });
  });

  it("carries the main-owned DID/RBAC signature through the real authority and custody", async () => {
    const custodyModule =
      await import("../../../../../packages/cli/src/lib/evolution/browser-filesystem-quarantine-custody.js");
    const revocationModule =
      await import("../../../../../packages/cli/src/lib/evolution/browser-quarantine-operator-revocation-authority.js");
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "cc-desktop-operator-revocation-"),
    );
    const operatorIdentity = identity();
    const nowMs = Date.parse("2026-09-20T12:00:00.000Z");
    try {
      const handlerArtifactDigest = digest("test", "real-handler");
      const custody = custodyModule.createBrowserFilesystemQuarantineCustody({
        descriptor: {
          schema:
            custodyModule.BROWSER_FILESYSTEM_QUARANTINE_CUSTODY_DESCRIPTOR_SCHEMA,
          custodyId: "desktop-operator-custody",
          tenantId: "tenant-1",
          handlerArtifactDigest,
          retentionMs: 60_000,
          custodyMode: "exclusive-stream-fsync",
        },
        stateRoot,
        now: () => nowMs,
      });
      const custodyPort =
        custodyModule.captureBrowserFilesystemQuarantineCustody(custody);
      const session = await custodyPort.openQuarantine({
        artifactId: "artifact-real",
        tenantId: "tenant-1",
        maxBytes: 1024,
        contentType: "application/pdf",
        networkReceiptDigest: digest("test", "network"),
        actionReceiptDigest: sourceActionReceiptDigest,
      });
      await session.writeChunk(Buffer.from("content"));
      const artifact = await session.commitArtifact({
        artifactDigest: contentDigest("content"),
        sizeBytes: 7,
        contentType: "application/pdf",
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
          authorization.signedPayload.permission !== "browser.quarantine.revoke"
        )
          return { decision: "deny", reason: "invalid operator evidence" };
        return {
          decision: "allow",
          operatorEvidenceRef: "operator-signature:INC-100",
          validUntil: new Date(nowMs + 1000).toISOString(),
        };
      });
      const authority =
        revocationModule.createBrowserQuarantineOperatorRevocationAuthority({
          descriptor: {
            schema:
              revocationModule.BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA,
            authorityId: "desktop-operator-revocation",
            tenantId: "tenant-1",
            handlerArtifactDigest,
            policyRevision: "operator-policy-1",
            maxGrantTtlMs: 5000,
            approvalMode: "operator-signed",
            auditMode: "authenticated-durable-readback",
            effectMode: "irreversible-byte-revocation",
          },
          custody,
          authorizeRevocation: policy,
          recordOutcome: async (request) => ({
            schema:
              revocationModule.BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_ACK_SCHEMA,
            authorityId: "desktop-operator-revocation",
            tenantId: "tenant-1",
            handlerArtifactDigest,
            revocationReceiptDigest: request.revocationReceiptDigest,
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
      const host = createDesktopBrowserQuarantineOperatorRevocationHost(
        authority,
        revocationModule.captureBrowserQuarantineOperatorRevocationAuthority,
      );
      await expect(
        revokeDesktopBrowserQuarantineArtifact(
          host,
          {
            ...input,
            artifactRef: artifact.artifactRef,
            artifactDigest: artifact.artifactDigest,
          },
          context(operatorIdentity, { now: () => nowMs }),
        ),
      ).resolves.toMatchObject({
        status: "revoked",
        artifactDigest: artifact.artifactDigest,
        auditEventDigest: digest("test", "real-audit"),
      });
      expect(policy).toHaveBeenCalledOnce();
      await expect(
        custodyPort.inspectArtifact(artifact.artifactRef),
      ).rejects.toThrow(/ENOENT/u);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
