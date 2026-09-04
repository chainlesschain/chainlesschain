import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  createGovernedKnowledgeEd25519ApprovalIssuer,
  createGovernedKnowledgeRbacApprovalAuthority,
  createPermissionEngineGovernedKnowledgeRbac,
  isGovernedKnowledgeApprovalIssuer,
  isGovernedKnowledgeRbacApprovalAuthority,
  permissionForGovernedKnowledge,
} from "../../src/lib/evolution/governed-knowledge-rbac-approval-authority.js";
import { GovernedKnowledgeSync } from "../../src/lib/evolution/governed-knowledge-sync.js";
import { grantPermission } from "../../src/lib/permission-engine.js";
import { knowledgeArtifactLifecycle } from "../helpers/governed-knowledge-artifact-lifecycle.js";

const NOW = Date.parse("2026-09-04T00:00:00.000Z");
const D = (value) =>
  `sha256:${createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex")}`;

function record(overrides = {}) {
  return {
    tenantId: "tenant:a",
    knowledgeId: "knowledge:1",
    scope: "team",
    scopeId: "team:1",
    action: "upsert",
    contentDigest: D("content:1"),
    vectorClock: { "device:a": 1 },
    approvalReceiptDigest: null,
    revocationReceiptDigest: null,
    dependencies: [],
    ...overrides,
  };
}

function fixture() {
  const db = new MockDatabase();
  const reviewerKeys = generateKeyPairSync("ed25519");
  const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
    tenantId: "tenant:a",
    reviewerId: "did:reviewer:alice",
    privateKey: reviewerKeys.privateKey,
    now: () => NOW,
  });
  const approved = record();
  const receipt = issuer.issue({
    ...approved,
    reviewerId: "did:reviewer:alice",
    automated: false,
    approvedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
  });
  approved.approvalReceiptDigest = receipt.receiptDigest;
  const receipts = new Map([[receipt.receiptDigest, receipt]]);
  const approvalReader = {
    read: vi.fn(
      async ({ receiptDigest }) => receipts.get(receiptDigest) ?? null,
    ),
  };
  const permission = permissionForGovernedKnowledge({
    scope: approved.scope,
    scopeId: approved.scopeId,
    operation: "publish",
    action: approved.action,
  });
  grantPermission(db, "did:user:bob", permission, "did:admin");
  const rbac = createPermissionEngineGovernedKnowledgeRbac({
    db,
    tenantId: "tenant:a",
    now: () => NOW,
  });
  const authority = createGovernedKnowledgeRbacApprovalAuthority({
    tenantId: "tenant:a",
    principalId: "did:user:bob",
    rbac,
    approvalReader,
    reviewerIdentities: [
      {
        tenantId: "tenant:a",
        reviewerId: "did:reviewer:alice",
        publicKey: reviewerKeys.publicKey,
      },
    ],
    now: () => NOW,
  });
  return {
    db,
    reviewerKeys,
    issuer,
    receipt,
    receipts,
    approvalReader,
    approved,
    permission,
    rbac,
    authority,
  };
}

describe("Governed knowledge RBAC and approval authority", () => {
  it("authenticates a scope-specific Permission Engine grant and human receipt", async () => {
    const f = fixture();
    expect(isGovernedKnowledgeApprovalIssuer(f.issuer)).toBe(true);
    expect(isGovernedKnowledgeRbacApprovalAuthority(f.authority)).toBe(true);
    await expect(
      f.authority.authorize({ operation: "publish", knowledge: f.approved }),
    ).resolves.toMatchObject({
      authenticated: true,
      allowed: true,
      tenantId: "tenant:a",
      knowledgeId: "knowledge:1",
      scope: "team",
      scopeId: "team:1",
      receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(f.approvalReader.read).toHaveBeenCalledWith({
      tenantId: "tenant:a",
      receiptDigest: f.receipt.receiptDigest,
    });
  });

  it("integrates with publish without exposing the approval receipt", async () => {
    const f = fixture();
    const ciphertext = Buffer.from("opaque-encrypted-record");
    const sync = new GovernedKnowledgeSync({
      tenantId: "tenant:a",
      deviceId: "device:a",
      artifactLifecycle: knowledgeArtifactLifecycle(),
      clock: () => NOW,
      ports: {
        authorize: f.authority.authorize,
        encrypt: async () => ({
          ciphertext,
          ciphertextDigest: D(ciphertext),
          keyRef: "kms:team:1:v1",
        }),
        decrypt: async () => {
          throw new Error("unused");
        },
        sign: async ({ envelopeDigest }) => ({ envelopeDigest }),
        verify: async () => false,
        load: async () => null,
        loadReception: async () => null,
        commit: async ({ envelopeDigest, knowledge }) => ({
          authenticated: true,
          durable: true,
          envelopeDigest,
          knowledgeId: knowledge.knowledgeId,
        }),
        send: async ({ envelope }) => ({
          durable: true,
          envelopeDigest: envelope.envelopeDigest,
        }),
      },
    });
    const envelope = await sync.publish(f.approved);
    expect(envelope).not.toHaveProperty("approvalReceiptDigest");
    expect(JSON.stringify(envelope)).not.toContain("did:reviewer:alice");
  });

  it("denies missing and over-broadly mismatched permissions", async () => {
    const f = fixture();
    const deniedRbac = createPermissionEngineGovernedKnowledgeRbac({
      db: new MockDatabase(),
      tenantId: "tenant:a",
      now: () => NOW,
    });
    const denied = createGovernedKnowledgeRbacApprovalAuthority({
      tenantId: "tenant:a",
      principalId: "did:user:bob",
      rbac: deniedRbac,
      approvalReader: f.approvalReader,
      reviewerIdentities: [
        {
          tenantId: "tenant:a",
          reviewerId: "did:reviewer:alice",
          publicKey: f.reviewerKeys.publicKey,
        },
      ],
      now: () => NOW,
    });
    await expect(
      denied.authorize({ operation: "publish", knowledge: f.approved }),
    ).rejects.toThrow("Permission Engine denied");
    await expect(
      f.authority.authorize({
        operation: "publish",
        knowledge: { ...f.approved, scopeId: "team:other" },
      }),
    ).rejects.toThrow("Permission Engine denied");
    await expect(
      f.authority.authorize({ operation: "receive", knowledge: f.approved }),
    ).rejects.toThrow("Permission Engine denied");
  });

  it("rejects substituted, expired, automated, and forged approvals", async () => {
    const variants = [
      (receipt) => ({ ...receipt, contentDigest: D("substituted") }),
      (receipt) => ({ ...receipt, automated: true }),
      (receipt) => ({
        ...receipt,
        attestation: { ...receipt.attestation, value: "A".repeat(86) },
      }),
      (receipt) => ({
        ...receipt,
        expiresAt: new Date(NOW - 1).toISOString(),
      }),
    ];
    for (const mutate of variants) {
      const f = fixture();
      f.receipts.set(f.receipt.receiptDigest, mutate(f.receipt));
      await expect(
        f.authority.authorize({ operation: "publish", knowledge: f.approved }),
      ).rejects.toThrow(/approval receipt/u);
    }
  });

  it("allows project knowledge by RBAC without inventing an approval", async () => {
    const f = fixture();
    const project = record({
      scope: "project",
      scopeId: "project:1",
      approvalReceiptDigest: null,
    });
    grantPermission(
      f.db,
      "did:user:bob",
      permissionForGovernedKnowledge({
        scope: project.scope,
        scopeId: project.scopeId,
        operation: "publish",
        action: project.action,
      }),
      "did:admin",
    );
    await expect(
      f.authority.authorize({ operation: "publish", knowledge: project }),
    ).resolves.toMatchObject({ allowed: true, scope: "project" });
    expect(f.approvalReader.read).not.toHaveBeenCalled();
  });

  it("rejects unbranded RBAC, cross-tenant reviewers, and duplicate keys", () => {
    const f = fixture();
    expect(() =>
      createGovernedKnowledgeRbacApprovalAuthority({
        tenantId: "tenant:a",
        principalId: "did:user:bob",
        rbac: { check: f.rbac.check, tenantId: "tenant:a" },
        approvalReader: f.approvalReader,
        reviewerIdentities: [],
      }),
    ).toThrow("Permission Engine RBAC adapter");
    expect(() =>
      createGovernedKnowledgeRbacApprovalAuthority({
        tenantId: "tenant:a",
        principalId: "did:user:bob",
        rbac: f.rbac,
        approvalReader: f.approvalReader,
        reviewerIdentities: [
          {
            tenantId: "tenant:b",
            reviewerId: "did:reviewer:alice",
            publicKey: f.reviewerKeys.publicKey,
          },
        ],
      }),
    ).toThrow("tenant boundary");
    expect(() =>
      createGovernedKnowledgeRbacApprovalAuthority({
        tenantId: "tenant:a",
        principalId: "did:user:bob",
        rbac: f.rbac,
        approvalReader: f.approvalReader,
        reviewerIdentities: [
          {
            tenantId: "tenant:a",
            reviewerId: "did:reviewer:alice",
            publicKey: f.reviewerKeys.publicKey,
          },
          {
            tenantId: "tenant:a",
            reviewerId: "did:reviewer:eve",
            publicKey: f.reviewerKeys.publicKey,
          },
        ],
      }),
    ).toThrow("duplicated");
  });
});
