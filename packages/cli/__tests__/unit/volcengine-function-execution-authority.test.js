import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA,
  VOLCENGINE_FUNCTION_AUDIT_MODE,
  VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA,
  VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
  VOLCENGINE_FUNCTION_PURPOSE,
  VOLCENGINE_FUNCTION_RECEIPT_SCHEMA,
  VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_APPROVAL_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_AUTHORIZATION_EVIDENCE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_AUTHORITY_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_CERTIFICATE_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_CERTIFICATE_STATUS_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_EVIDENCE_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_EVIDENCE_RESOLVER_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_PURPOSE,
  VOLCENGINE_FUNCTION_REVOCATION_REQUEST_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_SIGNATURE_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_SIGNER_CERTIFICATE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_SIGNER_REVOCATIONS_SCHEMA,
  captureVolcengineFunctionRevocationAuthority,
  captureVolcengineFunctionExecutionAuthority,
  createVolcengineFunctionExecutionAuthority,
  createVolcengineFunctionRevocationAuthority,
  createVolcengineFunctionRevocationEvidenceResolver,
  digestVolcengineFunctionRevocationEvidenceResolverDescriptor,
  digestVolcengineFunctionResult,
  revokeVolcengineFunctionExecutionAuthority,
} from "../../src/lib/evolution/volcengine-function-execution-authority.js";
import {
  VOLCENGINE_FUNCTION_REPLAY_MODE,
  VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
  VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_MODE,
  createVolcengineFunctionReplayStore,
} from "../../src/lib/evolution/volcengine-function-replay-store.js";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const REPLAY_RETENTION_MS = 65_000;
const temporaryRoots = [];
const {
  privateKey: REVOCATION_ROOT_SIGNING_KEY,
  publicKey: REVOCATION_TRUST_ROOT,
} = generateKeyPairSync("ed25519");
const { privateKey: REVOCATION_SIGNING_KEY, publicKey: REVOCATION_SIGNER_KEY } =
  generateKeyPairSync("ed25519");
const REVOCATION_TRUST_ROOT_BYTES = Buffer.from(
  REVOCATION_TRUST_ROOT.export({
    type: "spki",
    format: "pem",
  }),
);
const REVOCATION_SIGNER_KEY_ID = "revocation-operator-key:test";
const REVOCATION_ROOT_KEY_ID = "revocation-root-key:test";
const REVOCATION_SIGNER_PUBLIC_KEY_BYTES = REVOCATION_SIGNER_KEY.export({
  type: "spki",
  format: "der",
});
const AUDIT_EVENT_BYTES = Buffer.from("revocation-audit-event");
const DURABILITY_RECEIPT_BYTES = Buffer.from("revocation-durability-receipt");

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function authorizationEvidenceBytes(
  requestDigest,
  overrides = {},
  signingKey = REVOCATION_SIGNING_KEY,
) {
  const core = {
    schema: VOLCENGINE_FUNCTION_REVOCATION_AUTHORIZATION_EVIDENCE_SCHEMA,
    trustRootDigest: sha(REVOCATION_TRUST_ROOT_BYTES),
    signerKeyId: REVOCATION_SIGNER_KEY_ID,
    tenantId: "tenant:test",
    revocationAuthorityId: "function-revocation:test",
    authorizationRequestDigest: requestDigest,
    decision: "allow",
    authorizedAt: new Date(NOW).toISOString(),
    validUntil: new Date(NOW + 1000).toISOString(),
    ...overrides,
  };
  const signature = signBytes(
    null,
    Buffer.from(
      `${VOLCENGINE_FUNCTION_REVOCATION_AUTHORIZATION_EVIDENCE_SCHEMA}\0${canonical(core)}`,
      "utf8",
    ),
    signingKey,
  ).toString("base64");
  return Buffer.from(canonical({ ...core, signature }), "utf8");
}

function signerCertificateBytes(
  overrides = {},
  signingKey = REVOCATION_ROOT_SIGNING_KEY,
) {
  const core = {
    schema: VOLCENGINE_FUNCTION_REVOCATION_SIGNER_CERTIFICATE_SCHEMA,
    trustRootDigest: sha(REVOCATION_TRUST_ROOT_BYTES),
    issuerKeyId: REVOCATION_ROOT_KEY_ID,
    subjectKeyId: REVOCATION_SIGNER_KEY_ID,
    subjectPublicKey: Buffer.from(REVOCATION_SIGNER_PUBLIC_KEY_BYTES).toString(
      "base64",
    ),
    tenantId: "tenant:test",
    revocationAuthorityId: "function-revocation:test",
    usage: VOLCENGINE_FUNCTION_REVOCATION_PURPOSE,
    notBefore: new Date(NOW - 1000).toISOString(),
    notAfter: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
  const signature = signBytes(
    null,
    Buffer.from(
      `${VOLCENGINE_FUNCTION_REVOCATION_SIGNER_CERTIFICATE_SCHEMA}\0${canonical(core)}`,
      "utf8",
    ),
    signingKey,
  ).toString("base64");
  return Buffer.from(canonical({ ...core, signature }), "utf8");
}

function signerRevocationsBytes(
  revokedCertificateDigests = [],
  overrides = {},
  signingKey = REVOCATION_ROOT_SIGNING_KEY,
) {
  const core = {
    schema: VOLCENGINE_FUNCTION_REVOCATION_SIGNER_REVOCATIONS_SCHEMA,
    trustRootDigest: sha(REVOCATION_TRUST_ROOT_BYTES),
    issuerKeyId: REVOCATION_ROOT_KEY_ID,
    tenantId: "tenant:test",
    revocationAuthorityId: "function-revocation:test",
    revision: 1,
    issuedAt: new Date(NOW - 1000).toISOString(),
    nextUpdate: new Date(NOW + 60_000).toISOString(),
    revokedCertificateDigests,
    ...overrides,
  };
  const signature = signBytes(
    null,
    Buffer.from(
      `${VOLCENGINE_FUNCTION_REVOCATION_SIGNER_REVOCATIONS_SCHEMA}\0${canonical(core)}`,
      "utf8",
    ),
    signingKey,
  ).toString("base64");
  return Buffer.from(canonical({ ...core, signature }), "utf8");
}

function functionPolicies() {
  return [
    {
      functionName: "create_note",
      allowedArgumentKeys: ["content", "title"],
      maxArgumentBytes: 1024,
      maxResultBytes: 1024,
      maxExecutionMs: 1000,
    },
    {
      functionName: "read_file",
      allowedArgumentKeys: ["path"],
      maxArgumentBytes: 512,
      maxResultBytes: 2048,
      maxExecutionMs: 1000,
    },
  ];
}

function functionPolicyDigest(
  functionName = "create_note",
  policies = functionPolicies(),
) {
  const policy = policies.find((entry) => entry.functionName === functionName);
  if (!policy) return sha(`missing-policy:${functionName}`);
  return domainDigest("chainlesschain.volcengine-function-policy/v1", policy);
}

function descriptor(overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA,
    authorityId: "authority:test",
    revocationAuthorityId: "function-revocation:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    policyRevision: "policy-1",
    replayStoreId: "replay:test",
    replayRetentionMs: REPLAY_RETENTION_MS,
    replayMode: VOLCENGINE_FUNCTION_REPLAY_MODE,
    revocationMode: VOLCENGINE_FUNCTION_REVOCATION_MODE,
    purpose: VOLCENGINE_FUNCTION_PURPOSE,
    allowedFunctions: ["create_note", "read_file"],
    functionPolicies: functionPolicies(),
    auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
    ...overrides,
  };
}

function request(overrides = {}, policies = functionPolicies()) {
  const args = overrides.arguments || { title: "bounded title" };
  const selectedPolicy = policies.find(
    (entry) => entry.functionName === (overrides.functionName || "create_note"),
  );
  const core = {
    schema: VOLCENGINE_FUNCTION_REQUEST_SCHEMA,
    authorityId: "authority:test",
    revocationAuthorityId: "function-revocation:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    policyRevision: "policy-1",
    replayStoreId: "replay:test",
    revocationMode: VOLCENGINE_FUNCTION_REVOCATION_MODE,
    actorDid: "did:test:operator",
    purpose: VOLCENGINE_FUNCTION_PURPOSE,
    requestId: "request-1",
    senderId: 7,
    executorType: VOLCENGINE_FUNCTION_EXECUTOR_TYPE,
    functionName: "create_note",
    functionPolicyDigest: functionPolicyDigest(
      overrides.functionName || "create_note",
      policies,
    ),
    arguments: args,
    argumentsDigest: domainDigest(
      "chainlesschain.volcengine-function-arguments/v1",
      args,
    ),
    requestedAt: new Date(NOW).toISOString(),
    deadlineAt: new Date(
      NOW + (selectedPolicy?.maxExecutionMs || 1000),
    ).toISOString(),
    ...overrides,
  };
  return {
    ...core,
    requestDigest: domainDigest(
      "chainlesschain.volcengine-function-request/v6",
      core,
    ),
  };
}

function responseFor(value, toolResult, overrides = {}) {
  const reservationCore = {
    schema: VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
    replayStoreId: value.replayStoreId,
    authorityId: value.authorityId,
    tenantId: value.tenantId,
    handlerArtifactDigest: value.handlerArtifactDigest,
    policyRevision: value.policyRevision,
    requestId: value.requestId,
    requestDigest: value.requestDigest,
    expiresAt: new Date(
      Date.parse(value.deadlineAt) + REPLAY_RETENTION_MS,
    ).toISOString(),
  };
  return {
    toolResult,
    auditEvidence: {
      schema: VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA,
      authorityId: "authority:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("signed-deployment"),
      policyRevision: "policy-1",
      requestId: value.requestId,
      requestDigest: value.requestDigest,
      functionPolicyDigest: value.functionPolicyDigest,
      replayReservationDigest: domainDigest(
        VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
        reservationCore,
      ),
      deadlineAt: value.deadlineAt,
      resultDigest: digestVolcengineFunctionResult(toolResult),
      auditEventDigest: sha("audit-event"),
      durabilityReceiptDigest: sha("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      completedAt: new Date(NOW).toISOString(),
      ...overrides,
    },
  };
}

function createReplayStore(authorityDescriptor, rootDir) {
  const root = rootDir || mkdtempSync(join(tmpdir(), "cc-function-replay-"));
  if (!rootDir) temporaryRoots.push(root);
  return createVolcengineFunctionReplayStore({
    rootDir: root,
    descriptor: {
      schema: VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
      replayStoreId: authorityDescriptor.replayStoreId,
      authorityId: authorityDescriptor.authorityId,
      revocationAuthorityId: authorityDescriptor.revocationAuthorityId,
      tenantId: authorityDescriptor.tenantId,
      handlerArtifactDigest: authorityDescriptor.handlerArtifactDigest,
      policyRevision: authorityDescriptor.policyRevision,
      retentionMs: authorityDescriptor.replayRetentionMs,
      mode: authorityDescriptor.replayMode,
      revocationMode: authorityDescriptor.revocationMode,
    },
    now: () => NOW,
  });
}

function setup(overrides = {}) {
  const execute = vi.fn(
    overrides.execute ||
      (async (value) =>
        responseFor(value, { noteId: "note-1", success: true })),
  );
  const authorityDescriptor = descriptor(overrides.descriptor);
  const authority = createVolcengineFunctionExecutionAuthority({
    descriptor: authorityDescriptor,
    execute,
    replayStore:
      overrides.replayStore || createReplayStore(authorityDescriptor),
    now: () => NOW,
  });
  return {
    authority,
    execute,
    port: captureVolcengineFunctionExecutionAuthority(authority),
  };
}

function revocationRequest(overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_REVOCATION_REQUEST_SCHEMA,
    requestId: "revocation-1",
    actorDid: "did:test:security-operator",
    tenantId: "tenant:test",
    purpose: VOLCENGINE_FUNCTION_REVOCATION_PURPOSE,
    reasonDigest: sha("revocation-reason"),
    authorization: { role: "security-operator", ticket: "INC-100" },
    requestedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function createRevocationPort(
  targetDescriptor = descriptor(),
  authorize = async (value) => ({
    decision: "allow",
    requestDigest: value.requestDigest,
    authorizationEvidenceDigest: sha(
      authorizationEvidenceBytes(value.requestDigest),
    ),
    auditEventDigest: sha(AUDIT_EVENT_BYTES),
    durabilityReceiptDigest: sha(DURABILITY_RECEIPT_BYTES),
    authenticated: true,
    durable: true,
    readbackVerified: true,
    authorizedAt: new Date(NOW).toISOString(),
    validUntil: new Date(NOW + 1000).toISOString(),
  }),
  now = () => NOW,
  evidenceOverrides = {},
) {
  const certificateBytes =
    evidenceOverrides.signerCertificateBytes || signerCertificateBytes();
  const revocationsBytes =
    evidenceOverrides.signerRevocationsBytes || signerRevocationsBytes();
  const evidenceResolverDescriptor = {
    schema: VOLCENGINE_FUNCTION_REVOCATION_EVIDENCE_RESOLVER_SCHEMA,
    resolverId: "revocation-evidence:test",
    tenantId: targetDescriptor.tenantId,
    handlerArtifactDigest: targetDescriptor.handlerArtifactDigest,
    policyRevision: "revocation-evidence-policy-1",
    mode: VOLCENGINE_FUNCTION_REVOCATION_EVIDENCE_MODE,
    signatureMode: VOLCENGINE_FUNCTION_REVOCATION_SIGNATURE_MODE,
    certificateMode: VOLCENGINE_FUNCTION_REVOCATION_CERTIFICATE_MODE,
    certificateStatusMode:
      VOLCENGINE_FUNCTION_REVOCATION_CERTIFICATE_STATUS_MODE,
    trustRootDigest: sha(REVOCATION_TRUST_ROOT_BYTES),
    rootKeyId: REVOCATION_ROOT_KEY_ID,
    signerKeyId: REVOCATION_SIGNER_KEY_ID,
    signerCertificateDigest: sha(certificateBytes),
    signerRevocationsDigest: sha(revocationsBytes),
    signerRevocationsRevision: 1,
    revocationAuthorityId: targetDescriptor.revocationAuthorityId,
    maxEvidenceBytes: 4096,
    ...evidenceOverrides.descriptor,
  };
  const evidenceResolver =
    evidenceOverrides.resolver ||
    createVolcengineFunctionRevocationEvidenceResolver({
      descriptor: evidenceResolverDescriptor,
      resolve:
        evidenceOverrides.resolve ||
        (async (value) => ({
          authorizationEvidenceBytes: authorizationEvidenceBytes(
            value.authorizationRequestDigest,
          ),
          auditEventBytes: AUDIT_EVENT_BYTES,
          durabilityReceiptBytes: DURABILITY_RECEIPT_BYTES,
        })),
      trustRootBytes:
        evidenceOverrides.trustRootBytes || REVOCATION_TRUST_ROOT_BYTES,
      signerCertificateBytes: certificateBytes,
      signerRevocationsBytes: revocationsBytes,
    });
  return captureVolcengineFunctionRevocationAuthority(
    createVolcengineFunctionRevocationAuthority({
      descriptor: {
        schema: VOLCENGINE_FUNCTION_REVOCATION_AUTHORITY_SCHEMA,
        authorityId: targetDescriptor.revocationAuthorityId,
        tenantId: targetDescriptor.tenantId,
        handlerArtifactDigest: targetDescriptor.handlerArtifactDigest,
        policyRevision: "revocation-policy-1",
        targetAuthorityId: targetDescriptor.authorityId,
        targetReplayStoreId: targetDescriptor.replayStoreId,
        targetPolicyRevision: targetDescriptor.policyRevision,
        maxGrantTtlMs: 5000,
        approvalMode: VOLCENGINE_FUNCTION_REVOCATION_APPROVAL_MODE,
        auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
        evidenceResolverDigest:
          evidenceOverrides.descriptorDigest ||
          digestVolcengineFunctionRevocationEvidenceResolverDescriptor(
            evidenceResolverDescriptor,
          ),
        ...evidenceOverrides.authorityDescriptor,
      },
      authorize,
      evidenceResolver,
      now,
    }),
  );
}

describe("Volcengine function execution authority", () => {
  it.each(["v1", "v2", "v3", "v4", "v5"])(
    "rejects legacy %s authority descriptors",
    (version) => {
      expect(() =>
        createVolcengineFunctionExecutionAuthority({
          descriptor: descriptor({
            schema: `chainlesschain.volcengine-function-authority/${version}`,
          }),
          execute: vi.fn(),
        }),
      ).toThrow("Volcengine function authority descriptor is invalid");
    },
  );

  it("issues a result-bound receipt only after authenticated durable readback", async () => {
    const { authority, execute, port } = setup();

    const response = await port.executeFunction(request());

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Reflect.ownKeys(authority)).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    expect(response.toolResult).toEqual({ noteId: "note-1", success: true });
    expect(response.receipt).toMatchObject({
      schema: VOLCENGINE_FUNCTION_RECEIPT_SCHEMA,
      authorityId: "authority:test",
      revocationAuthorityId: "function-revocation:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("signed-deployment"),
      policyRevision: "policy-1",
      replayStoreId: "replay:test",
      revocationMode: VOLCENGINE_FUNCTION_REVOCATION_MODE,
      actorDid: "did:test:operator",
      purpose: VOLCENGINE_FUNCTION_PURPOSE,
      requestId: "request-1",
      senderId: 7,
      functionName: "create_note",
      functionPolicyDigest: functionPolicyDigest(),
      replayReservationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      deadlineAt: new Date(NOW + 1000).toISOString(),
      auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
      auditEventDigest: sha("audit-event"),
      durabilityReceiptDigest: sha("durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
    expect(response.receipt.resultDigest).toBe(
      digestVolcengineFunctionResult(response.toolResult),
    );
  });

  it("rejects forged authorities", () => {
    expect(() =>
      captureVolcengineFunctionExecutionAuthority(Object.freeze({})),
    ).toThrow("branded Volcengine function execution authority");
    expect(() =>
      revokeVolcengineFunctionExecutionAuthority(Object.freeze({})),
    ).toThrow("branded Volcengine function execution authority");
  });

  it("rejects new execution after the authority is revoked", async () => {
    const { authority, execute, port } = setup();

    expect(revokeVolcengineFunctionExecutionAuthority(authority)).toBe(true);
    expect(revokeVolcengineFunctionExecutionAuthority(authority)).toBe(false);
    await expect(port.executeFunction(request())).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
      message: "Volcengine function execution authority was revoked",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("aborts and rejects in-flight execution when the authority is revoked", async () => {
    let executionContext;
    const { authority, execute, port } = setup({
      execute: async (_value, context) => {
        executionContext = context;
        return new Promise(() => {});
      },
    });
    const execution = port.executeFunction(request());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    expect(revokeVolcengineFunctionExecutionAuthority(authority)).toBe(true);

    await expect(execution).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
      message: "Volcengine function execution authority was revoked",
    });
    expect(executionContext.signal.aborted).toBe(true);
    expect(executionContext.signal.reason).toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
      message: "Volcengine function execution authority was revoked",
    });
  });

  it("durably revokes an authority and rejects execution after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-function-revocation-reopen-"));
    temporaryRoots.push(root);
    const authorityDescriptor = descriptor();
    const first = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });

    await expect(
      createRevocationPort(authorityDescriptor).revokeAuthority(
        first.authority,
        revocationRequest(),
      ),
    ).resolves.toMatchObject({
      status: "revoked",
      revocationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });

    const reopened = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });
    await expect(
      reopened.port.executeFunction(request()),
    ).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
      message: "Volcengine function execution authority was revoked",
    });
    expect(reopened.execute).not.toHaveBeenCalled();
  });

  it("propagates durable revocation to an in-flight sibling authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-function-revocation-live-"));
    temporaryRoots.push(root);
    const authorityDescriptor = descriptor();
    const publisher = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });
    let executionContext;
    const sibling = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
      execute: async (_value, context) => {
        executionContext = context;
        return new Promise(() => {});
      },
    });
    const execution = sibling.port.executeFunction(
      request({ requestId: "request-in-flight" }),
    );
    await vi.waitFor(() => expect(sibling.execute).toHaveBeenCalledOnce());

    await createRevocationPort(authorityDescriptor).revokeAuthority(
      publisher.authority,
      revocationRequest(),
    );

    await expect(execution).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
      message: "Volcengine function execution authority was revoked",
    });
    expect(executionContext.signal.aborted).toBe(true);
    expect(executionContext.signal.reason).toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED",
    });
  });

  it("requires an authenticated durable authorization decision before revocation", async () => {
    const denied = setup();
    const deny = vi.fn(async () => ({ decision: "deny" }));

    await expect(
      createRevocationPort(descriptor(), deny).revokeAuthority(
        denied.authority,
        revocationRequest(),
      ),
    ).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_REVOCATION_DENIED",
      message: "Volcengine function revocation was denied",
    });
    expect(deny).toHaveBeenCalledWith(
      expect.objectContaining({
        actorDid: "did:test:security-operator",
        tenantId: "tenant:test",
        purpose: VOLCENGINE_FUNCTION_REVOCATION_PURPOSE,
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        authorizationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        authorization: { role: "security-operator", ticket: "INC-100" },
      }),
    );
    expect(Object.isFrozen(deny.mock.calls[0][0])).toBe(true);
    expect(Object.isFrozen(deny.mock.calls[0][0].authorization)).toBe(true);
    await expect(denied.port.executeFunction(request())).resolves.toBeDefined();

    const unverified = setup();
    const invalidDecision = async (value) => ({
      decision: "allow",
      requestDigest: value.requestDigest,
      authorizationEvidenceDigest: sha("revocation-authorization"),
      auditEventDigest: sha("revocation-audit-event"),
      durabilityReceiptDigest: sha("revocation-durability-receipt"),
      authenticated: true,
      durable: true,
      readbackVerified: false,
      authorizedAt: new Date(NOW).toISOString(),
      validUntil: new Date(NOW + 1000).toISOString(),
    });
    await expect(
      createRevocationPort(descriptor(), invalidDecision).revokeAuthority(
        unverified.authority,
        revocationRequest({ requestId: "revocation-unverified" }),
      ),
    ).rejects.toThrow("Volcengine function revocation decision is invalid");
    expect(unverified.execute).not.toHaveBeenCalled();
    await expect(
      unverified.port.executeFunction(request({ requestId: "still-active" })),
    ).resolves.toBeDefined();

    const expired = setup();
    const times = [NOW, NOW + 1000];
    await expect(
      createRevocationPort(descriptor(), undefined, () =>
        times.shift(),
      ).revokeAuthority(
        expired.authority,
        revocationRequest({ requestId: "revocation-expired" }),
      ),
    ).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_REVOCATION_GRANT_EXPIRED",
      message: "Volcengine function revocation grant expired before execution",
    });
    expect(expired.execute).not.toHaveBeenCalled();
    await expect(
      expired.port.executeFunction(request({ requestId: "after-expiry" })),
    ).resolves.toBeDefined();
  });

  it("resolves and verifies the exact revocation evidence bytes before persisting", async () => {
    const target = setup();
    const resolveEvidence = vi.fn(async (value) => ({
      authorizationEvidenceBytes: authorizationEvidenceBytes(
        value.authorizationRequestDigest,
      ),
      auditEventBytes: AUDIT_EVENT_BYTES,
      durabilityReceiptBytes: DURABILITY_RECEIPT_BYTES,
    }));

    const result = await createRevocationPort(
      descriptor(),
      undefined,
      undefined,
      { resolve: resolveEvidence },
    ).revokeAuthority(target.authority, revocationRequest());

    expect(resolveEvidence).toHaveBeenCalledOnce();
    const resolutionRequest = resolveEvidence.mock.calls[0][0];
    expect(resolutionRequest).toMatchObject({
      resolverId: "revocation-evidence:test",
      tenantId: "tenant:test",
      handlerArtifactDigest: sha("signed-deployment"),
      revocationAuthorityId: "function-revocation:test",
      authorizationEvidenceDigest: sha(
        authorizationEvidenceBytes(
          resolutionRequest.authorizationRequestDigest,
        ),
      ),
      auditEventDigest: sha(AUDIT_EVENT_BYTES),
      durabilityReceiptDigest: sha(DURABILITY_RECEIPT_BYTES),
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(resolutionRequest)).toBe(true);
    expect(result).toMatchObject({
      status: "revoked",
      evidenceResolverDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      evidenceReadbackDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(result).not.toHaveProperty("authorizationEvidenceBytes");
    expect(result).not.toHaveProperty("auditEventBytes");
    expect(result).not.toHaveProperty("durabilityReceiptBytes");
  });

  it("rejects substituted revocation evidence bytes without revoking the target", async () => {
    const target = setup();
    const resolveEvidence = vi.fn(async () => ({
      authorizationEvidenceBytes: Buffer.from("substituted-authorization"),
      auditEventBytes: AUDIT_EVENT_BYTES,
      durabilityReceiptBytes: DURABILITY_RECEIPT_BYTES,
    }));

    await expect(
      createRevocationPort(descriptor(), undefined, undefined, {
        resolve: resolveEvidence,
      }).revokeAuthority(
        target.authority,
        revocationRequest({ requestId: "revocation-substituted-evidence" }),
      ),
    ).rejects.toThrow("revocation evidence readback is invalid");
    expect(resolveEvidence).toHaveBeenCalledOnce();
    await expect(
      target.port.executeFunction(
        request({ requestId: "after-substituted-evidence" }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects authorization evidence signed outside the pinned trust root", async () => {
    const target = setup();
    const { privateKey: foreignSigningKey } = generateKeyPairSync("ed25519");
    const foreignEvidence = (requestDigest) =>
      authorizationEvidenceBytes(requestDigest, {}, foreignSigningKey);
    const authorize = async (value) => ({
      decision: "allow",
      requestDigest: value.requestDigest,
      authorizationEvidenceDigest: sha(foreignEvidence(value.requestDigest)),
      auditEventDigest: sha(AUDIT_EVENT_BYTES),
      durabilityReceiptDigest: sha(DURABILITY_RECEIPT_BYTES),
      authenticated: true,
      durable: true,
      readbackVerified: true,
      authorizedAt: new Date(NOW).toISOString(),
      validUntil: new Date(NOW + 1000).toISOString(),
    });
    const resolveEvidence = async (value) => ({
      authorizationEvidenceBytes: foreignEvidence(
        value.authorizationRequestDigest,
      ),
      auditEventBytes: AUDIT_EVENT_BYTES,
      durabilityReceiptBytes: DURABILITY_RECEIPT_BYTES,
    });

    await expect(
      createRevocationPort(descriptor(), authorize, undefined, {
        resolve: resolveEvidence,
      }).revokeAuthority(
        target.authority,
        revocationRequest({ requestId: "revocation-foreign-signature" }),
      ),
    ).rejects.toThrow("authorization evidence signature rejected");
    await expect(
      target.port.executeFunction(
        request({ requestId: "after-foreign-signature" }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects authorization outside the certified signer validity window", async () => {
    const target = setup();
    const expiredCertificate = signerCertificateBytes({
      notBefore: new Date(NOW - 60_000).toISOString(),
      notAfter: new Date(NOW - 1).toISOString(),
    });

    await expect(
      createRevocationPort(descriptor(), undefined, undefined, {
        signerCertificateBytes: expiredCertificate,
      }).revokeAuthority(
        target.authority,
        revocationRequest({ requestId: "revocation-expired-certificate" }),
      ),
    ).rejects.toThrow("revocation authorization evidence is invalid");
    await expect(
      target.port.executeFunction(
        request({ requestId: "after-expired-certificate" }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects revoked signer certificates and stale status snapshots", async () => {
    const certificateBytes = signerCertificateBytes();
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        signerCertificateBytes: certificateBytes,
        signerRevocationsBytes: signerRevocationsBytes([sha(certificateBytes)]),
      }),
    ).toThrow("signer certificate was revoked");

    const target = setup();
    const staleStatus = signerRevocationsBytes([], {
      issuedAt: new Date(NOW - 60_000).toISOString(),
      nextUpdate: new Date(NOW - 1).toISOString(),
    });
    await expect(
      createRevocationPort(descriptor(), undefined, undefined, {
        signerRevocationsBytes: staleStatus,
      }).revokeAuthority(
        target.authority,
        revocationRequest({ requestId: "revocation-stale-signer-status" }),
      ),
    ).rejects.toThrow("revocation authorization evidence is invalid");
    await expect(
      target.port.executeFunction(
        request({ requestId: "after-stale-signer-status" }),
      ),
    ).resolves.toBeDefined();
  });

  it("binds the revocation authority to one branded evidence resolver", () => {
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        authorityDescriptor: {
          schema: "chainlesschain.volcengine-function-revocation-authority/v1",
        },
      }),
    ).toThrow("revocation authority descriptor is invalid");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        descriptorDigest: sha("substituted-evidence-resolver"),
      }),
    ).toThrow("evidence resolver does not match authority");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        resolver: Object.freeze({}),
      }),
    ).toThrow("branded Volcengine function revocation evidence resolver");
    const foreignTrustRoot = Buffer.from(
      generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      }),
    );
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        trustRootBytes: foreignTrustRoot,
      }),
    ).toThrow("evidence trust root is invalid");
    const privateKeyBytes = Buffer.from(
      REVOCATION_SIGNING_KEY.export({ type: "pkcs8", format: "pem" }),
    );
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        descriptor: { trustRootDigest: sha(privateKeyBytes) },
        trustRootBytes: privateKeyBytes,
      }),
    ).toThrow("evidence trust root is invalid");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        descriptor: { signerCertificateDigest: sha("foreign-certificate") },
      }),
    ).toThrow("signer certificate is invalid");
    const { privateKey: foreignRootSigningKey } =
      generateKeyPairSync("ed25519");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        signerCertificateBytes: signerCertificateBytes(
          {},
          foreignRootSigningKey,
        ),
      }),
    ).toThrow("signer certificate signature rejected");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        descriptor: { signerRevocationsDigest: sha("foreign-status") },
      }),
    ).toThrow("signer status is invalid");
    expect(() =>
      createRevocationPort(descriptor(), undefined, undefined, {
        signerRevocationsBytes: signerRevocationsBytes(
          [],
          {},
          foreignRootSigningKey,
        ),
      }),
    ).toThrow("signer status signature rejected");
  });

  it("binds the revocation authority to one signed execution authority", async () => {
    const target = setup();
    const authorize = vi.fn();
    const foreignDescriptor = descriptor({
      authorityId: "authority:foreign",
      replayStoreId: "replay:foreign",
    });
    const revoker = createRevocationPort(foreignDescriptor, authorize);

    await expect(
      revoker.revokeAuthority(target.authority, revocationRequest()),
    ).rejects.toThrow(
      "Volcengine function revocation target does not match authority",
    );
    expect(authorize).not.toHaveBeenCalled();

    const issuerMismatch = setup({
      descriptor: {
        revocationAuthorityId: "function-revocation:foreign",
      },
    });
    await expect(
      createRevocationPort(descriptor(), authorize).revokeAuthority(
        issuerMismatch.authority,
        revocationRequest({ requestId: "revocation-issuer-mismatch" }),
      ),
    ).rejects.toThrow(
      "Volcengine function revocation target does not match authority",
    );
    expect(() =>
      captureVolcengineFunctionRevocationAuthority(Object.freeze({})),
    ).toThrow("branded Volcengine function revocation authority");
  });

  it("fails closed when durable revocation status cannot be verified", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-function-revocation-corrupt-"));
    temporaryRoots.push(root);
    const authorityDescriptor = descriptor();
    const instance = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });
    fs.writeFileSync(join(root, "authority-revocation.json"), "{", "utf8");

    await expect(
      instance.port.executeFunction(request()),
    ).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_REVOCATION_STATUS_UNAVAILABLE",
      message: "Volcengine function authority revocation status is unavailable",
    });
    expect(instance.execute).not.toHaveBeenCalled();
  });

  it("rejects request digest tampering before execution", async () => {
    const { execute, port } = setup();

    await expect(
      port.executeFunction({ ...request(), requestDigest: sha("tampered") }),
    ).rejects.toThrow("Volcengine function request is invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid authority clock before execution", async () => {
    const execute = vi.fn();
    const authorityDescriptor = descriptor();
    const port = captureVolcengineFunctionExecutionAuthority(
      createVolcengineFunctionExecutionAuthority({
        descriptor: authorityDescriptor,
        execute,
        replayStore: createReplayStore(authorityDescriptor),
        now: () => Number.NaN,
      }),
    );

    await expect(port.executeFunction(request())).rejects.toThrow(
      "Volcengine function authority clock is invalid",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects exact and request-id replays before repeating a side effect", async () => {
    const { execute, port } = setup();
    const first = request();

    await expect(port.executeFunction(first)).resolves.toBeDefined();
    await expect(port.executeFunction(first)).rejects.toThrow(
      "Volcengine function request was replayed",
    );

    const changedArguments = { title: "different title" };
    await expect(
      port.executeFunction(
        request({
          requestId: first.requestId,
          arguments: changedArguments,
          argumentsDigest: domainDigest(
            "chainlesschain.volcengine-function-arguments/v1",
            changedArguments,
          ),
        }),
      ),
    ).rejects.toThrow("Volcengine function request was replayed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects a replay after the authority and replay store are reopened", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-function-replay-reopen-"));
    temporaryRoots.push(root);
    const authorityDescriptor = descriptor();
    const first = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });
    const second = setup({
      replayStore: createReplayStore(authorityDescriptor, root),
    });
    const signedRequest = request();

    await expect(
      first.port.executeFunction(signedRequest),
    ).resolves.toBeDefined();
    await expect(second.port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("does not execute when durable replay reservation is uncertain", async () => {
    const { execute, port } = setup();
    const originalFsync = fs.fsyncSync;
    let syncCalls = 0;
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      syncCalls += 1;
      if (syncCalls === 2) throw new Error("simulated directory sync failure");
      return originalFsync(descriptor);
    });
    let error;
    try {
      await port.executeFunction(request());
    } catch (cause) {
      error = cause;
    } finally {
      sync.mockRestore();
    }

    expect(error).toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_REPLAY_DURABILITY_UNKNOWN",
      message: "Volcengine function replay reservation durability is unknown",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reserves a request before awaiting execution", async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { execute, port } = setup({
      execute: async (value) => {
        await pending;
        return responseFor(value, { success: true });
      },
    });
    const signedRequest = request();
    const first = port.executeFunction(signedRequest);

    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    release();
    await expect(first).resolves.toBeDefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps a failed request reserved because its side-effect status is unknown", async () => {
    const { execute, port } = setup({
      execute: async () => {
        throw new Error("private downstream failure");
      },
    });
    const signedRequest = request();

    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "private downstream failure",
    );
    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects functions outside the signed descriptor allowlist", async () => {
    const { execute, port } = setup();
    const denied = request({ functionName: "delete_note" });

    await expect(port.executeFunction(denied)).rejects.toThrow(
      "Volcengine function request is invalid",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires policies to exactly cover the signed function allowlist", () => {
    expect(() =>
      createVolcengineFunctionExecutionAuthority({
        descriptor: descriptor({
          functionPolicies: [functionPolicies()[0]],
        }),
        execute: vi.fn(),
      }),
    ).toThrow("must exactly cover the allowlist");
  });

  it("requires the replay store to match the complete authority binding", () => {
    const authorityDescriptor = descriptor();
    const foreignDescriptor = descriptor({ tenantId: "tenant:foreign" });

    expect(() =>
      createVolcengineFunctionExecutionAuthority({
        descriptor: authorityDescriptor,
        execute: vi.fn(),
        replayStore: createReplayStore(foreignDescriptor),
        now: () => NOW,
      }),
    ).toThrow("replay store binding does not match authority");
  });

  it("rejects argument fields and byte sizes outside the function policy", async () => {
    const { execute, port } = setup();

    await expect(
      port.executeFunction(
        request({ arguments: { title: "ok", privatePath: "secret" } }),
      ),
    ).rejects.toThrow("arguments violate policy");
    await expect(
      port.executeFunction(
        request({ arguments: { title: "x".repeat(2048) }, requestId: "large" }),
      ),
    ).rejects.toThrow("arguments is too large");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects deadlines outside the signed function policy", async () => {
    const { execute, port } = setup();

    await expect(
      port.executeFunction(
        request({ deadlineAt: new Date(NOW + 1001).toISOString() }),
      ),
    ).rejects.toThrow("Volcengine function request is invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("aborts and rejects execution when the signed function deadline expires", async () => {
    const policies = functionPolicies();
    policies[0] = { ...policies[0], maxExecutionMs: 10 };
    let executionContext;
    const { execute, port } = setup({
      descriptor: { functionPolicies: policies },
      execute: async (_value, context) => {
        executionContext = context;
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal.reason),
            { once: true },
          );
        });
      },
    });

    const signedRequest = request({}, policies);
    await expect(port.executeFunction(signedRequest)).rejects.toMatchObject({
      code: "CC_VOLCENGINE_FUNCTION_DEADLINE_EXCEEDED",
      message: "Volcengine function execution deadline exceeded",
    });
    await expect(port.executeFunction(signedRequest)).rejects.toThrow(
      "Volcengine function request was replayed",
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(executionContext).toMatchObject({
      deadlineAt: new Date(NOW + 10).toISOString(),
      functionPolicyDigest: functionPolicyDigest("create_note", policies),
    });
    expect(Object.isFrozen(executionContext)).toBe(true);
    expect(Object.keys(executionContext).sort()).toEqual([
      "deadlineAt",
      "functionPolicyDigest",
      "replayReservationDigest",
      "signal",
    ]);
    expect(executionContext.signal.aborted).toBe(true);
  });

  it("rejects results outside the function policy byte budget", async () => {
    const { execute, port } = setup({
      execute: async (value) =>
        responseFor(value, { content: "x".repeat(2048) }),
    });

    await expect(port.executeFunction(request())).rejects.toThrow(
      "result is too large",
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects unverified or result-mismatched audit evidence", async () => {
    for (const auditOverride of [
      { readbackVerified: false },
      { resultDigest: sha("other-result") },
      { functionPolicyDigest: sha("other-policy") },
      { replayReservationDigest: sha("other-replay-reservation") },
      { deadlineAt: new Date(NOW + 500).toISOString() },
      { completedAt: new Date(NOW + 1001).toISOString() },
    ]) {
      const { port } = setup({
        execute: async (value) =>
          responseFor(value, { success: true }, auditOverride),
      });
      await expect(port.executeFunction(request())).rejects.toThrow(
        "Volcengine function audit evidence is invalid",
      );
    }
  });

  it("does not invoke accessor arguments", async () => {
    const { execute, port } = setup();
    const accessor = vi.fn(() => "private value");
    const args = {};
    Object.defineProperty(args, "title", {
      enumerable: true,
      get: accessor,
    });
    const malicious = request();
    Object.defineProperty(malicious, "arguments", {
      enumerable: true,
      value: args,
    });

    await expect(port.executeFunction(malicious)).rejects.toThrow(
      "accessor fields",
    );
    expect(accessor).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
