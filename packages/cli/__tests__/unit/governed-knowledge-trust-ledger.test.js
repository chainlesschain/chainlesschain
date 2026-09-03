import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  createGovernedKnowledgeEd25519ApprovalIssuer,
  createGovernedKnowledgeRbacApprovalAuthority,
  createPermissionEngineGovernedKnowledgeRbac,
  permissionForGovernedKnowledge,
} from "../../src/lib/evolution/governed-knowledge-rbac-approval-authority.js";
import { GovernedKnowledgeTrustLedger } from "../../src/lib/evolution/governed-knowledge-trust-ledger.js";
import { grantPermission } from "../../src/lib/permission-engine.js";

const roots = [];
const NOW = Date.parse("2026-09-04T00:00:00.000Z");
const D = (value) =>
  `sha256:${createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const LEDGER_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/knowledge-trust-ledger",
  trustPolicyDigest: D("knowledge-trust-ledger-policy"),
};
const WITNESS_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/knowledge-trust-witness",
  trustPolicyDigest: D("knowledge-trust-witness-policy"),
};
const EMPTY_DISCARD_DIGEST = D(
  `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
);

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ?? EMPTY_DISCARD_DIGEST,
    epoch: snapshot?.epoch ?? null,
    generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null,
    identityDigest: snapshot?.identityDigest ?? null,
    ledgerId: snapshot?.ledgerId ?? null,
    payloadDigest: snapshot?.payloadDigest ?? null,
    previousWitnessDigest: previous?.witnessDigest ?? null,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest ?? null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null,
    storeMarkerId: snapshot?.storeMarkerId ?? null,
    witnessId,
  };
  return {
    ...core,
    witnessDigest: D(
      `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
    ),
    signature: { ...WITNESS_TRUST, value: "A".repeat(43) },
  };
}

function durableWitness(witnessId) {
  let current = witnessRecord(witnessId);
  return {
    id: witnessId,
    read: () => current,
    initialize: ({ expected, snapshot }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, snapshot, current);
      return current;
    },
    compareAndSwap: ({ expected, next }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, next, current);
      return current;
    },
    proveAncestry: () => {
      throw new Error("unexpected ancestry request in linear trust test");
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -30_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function openRealLedger(root, resolver, witness) {
  const secret = "test-only-real-knowledge-trust-ledger-key";
  return new EvolutionLedger({
    rootDir: path.join(root, "ledger-events"),
    authorityRootDir: path.join(root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => NOW,
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: resolver,
    sign: ({ message }) => ({
      ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function backends() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-trust-"),
  );
  roots.push(root);
  const secret = "test-only-knowledge-trust-artifact-key";
  const signArtifact = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const rawArtifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => NOW,
    }),
    audience: "evolution-runtime",
    tenantId: "artifact-tenant:a",
    now: () => NOW,
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm: "hmac-sha256",
        keyId: "test:key/knowledge-trust",
        value: signArtifact(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.value === signArtifact(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm: "hmac-sha256",
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(NOW).toISOString(),
          decisionExpiresAt: new Date(NOW + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || "test:key/knowledge-trust",
          policyDigest: D("artifact-policy"),
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: D(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [], loseResponse: false };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch:a",
      ledgerId: "ledger:a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent: (input, expected) => {
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !==
          (state.events.at(-1)?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: D(canonical(input)),
      };
      state.events.push(event);
      if (state.loseResponse) {
        state.loseResponse = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        durable: true,
        receiptDigest: D(canonical(event)),
      };
    },
  };
  const descriptor = {
    tenantId: "tenant:a",
    artifactTenantId: "artifact-tenant:a",
    streamId: "knowledge-trust:tenant:a",
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
  };
  const options = {
    descriptor,
    artifactPorts: {
      putCanonical: (...args) => rawArtifactPorts.putCanonical(...args),
    },
    ledger,
    ledgerArtifactResolver:
      rawArtifactPorts.createEvolutionLedgerArtifactResolver({
        purpose: "evolution-ledger",
      }),
    now: () => NOW,
  };
  return {
    root,
    state,
    options,
    trust: new GovernedKnowledgeTrustLedger(options),
  };
}

function approvedRecord(receiptDigest) {
  return {
    tenantId: "tenant:a",
    knowledgeId: "knowledge:1",
    scope: "team",
    scopeId: "team:1",
    action: "upsert",
    contentDigest: D("content:1"),
    vectorClock: { "device:a": 1 },
    approvalReceiptDigest: receiptDigest,
    revocationReceiptDigest: null,
    dependencies: [],
  };
}

function approval(issuer) {
  return issuer.issue({
    ...approvedRecord(null),
    reviewerId: issuer.reviewerId,
    automated: false,
    approvedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
  });
}

function authorization(trust, knowledge) {
  const db = new MockDatabase();
  grantPermission(
    db,
    "did:user:bob",
    permissionForGovernedKnowledge({
      scope: knowledge.scope,
      scopeId: knowledge.scopeId,
      operation: "publish",
      action: knowledge.action,
    }),
    "did:admin",
  );
  return createGovernedKnowledgeRbacApprovalAuthority({
    tenantId: "tenant:a",
    principalId: "did:user:bob",
    rbac: createPermissionEngineGovernedKnowledgeRbac({
      db,
      tenantId: "tenant:a",
      now: () => NOW,
    }),
    approvalReader: trust.approvalReader(),
    reviewerRegistry: trust.reviewerRegistry(),
    now: () => NOW,
  });
}

describe("GovernedKnowledgeTrustLedger", () => {
  it("persists a reviewer and approval for the RBAC authority", async () => {
    const h = backends();
    const keys = generateKeyPairSync("ed25519");
    const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
      tenantId: "tenant:a",
      reviewerId: "did:reviewer:alice",
      privateKey: keys.privateKey,
      now: () => NOW,
    });
    await h.trust.registerReviewer({
      reviewerId: issuer.reviewerId,
      publicKey: keys.publicKey,
    });
    const receipt = approval(issuer);
    await h.trust.commitApproval(receipt);
    const knowledge = approvedRecord(receipt.receiptDigest);
    await expect(
      authorization(h.trust, knowledge).authorize({
        operation: "publish",
        knowledge,
      }),
    ).resolves.toMatchObject({ authenticated: true, allowed: true });
    expect(
      await h.trust.read({
        tenantId: "tenant:a",
        receiptDigest: receipt.receiptDigest,
      }),
    ).toEqual(receipt);
  });

  it("recovers response loss and remains idempotent across a new adapter", async () => {
    const h = backends();
    const keys = generateKeyPairSync("ed25519");
    const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
      tenantId: "tenant:a",
      reviewerId: "did:reviewer:alice",
      privateKey: keys.privateKey,
      now: () => NOW,
    });
    h.state.loseResponse = true;
    await expect(
      h.trust.registerReviewer({
        reviewerId: issuer.reviewerId,
        publicKey: keys.publicKey,
      }),
    ).resolves.toMatchObject({ durable: true, recovered: true });
    const reopened = new GovernedKnowledgeTrustLedger(h.options);
    const receipt = approval(issuer);
    h.state.loseResponse = true;
    await expect(reopened.commitApproval(receipt)).resolves.toMatchObject({
      durable: true,
      recovered: true,
    });
    await expect(reopened.commitApproval(receipt)).resolves.toMatchObject({
      durable: true,
      recovered: true,
    });
    expect(h.state.events).toHaveLength(2);
  });

  it("reopens approvals and reviewer trust from real Ledger and witness files", async () => {
    const h = backends();
    const witness = durableWitness("witness:knowledge-trust");
    const ledger = openRealLedger(
      h.root,
      h.options.ledgerArtifactResolver,
      witness,
    );
    const options = { ...h.options, ledger };
    const trust = new GovernedKnowledgeTrustLedger(options);
    const keys = generateKeyPairSync("ed25519");
    const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
      tenantId: "tenant:a",
      reviewerId: "did:reviewer:alice",
      privateKey: keys.privateKey,
      now: () => NOW,
    });
    await trust.registerReviewer({
      reviewerId: issuer.reviewerId,
      publicKey: keys.publicKey,
    });
    const receipt = approval(issuer);
    await trust.commitApproval(receipt);

    const reopenedLedger = openRealLedger(
      h.root,
      h.options.ledgerArtifactResolver,
      witness,
    );
    const reopened = new GovernedKnowledgeTrustLedger({
      ...h.options,
      ledger: reopenedLedger,
    });
    expect(
      await reopened.read({
        tenantId: "tenant:a",
        receiptDigest: receipt.receiptDigest,
      }),
    ).toEqual(receipt);
    const knowledge = approvedRecord(receipt.receiptDigest);
    await expect(
      authorization(reopened, knowledge).authorize({
        operation: "publish",
        knowledge,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("revalidates current reviewer trust and rejects approvals after revocation", async () => {
    const h = backends();
    const keys = generateKeyPairSync("ed25519");
    const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
      tenantId: "tenant:a",
      reviewerId: "did:reviewer:alice",
      privateKey: keys.privateKey,
      now: () => NOW,
    });
    const registered = await h.trust.registerReviewer({
      reviewerId: issuer.reviewerId,
      publicKey: keys.publicKey,
    });
    const receipt = approval(issuer);
    await h.trust.commitApproval(receipt);
    const knowledge = approvedRecord(receipt.receiptDigest);
    const authority = authorization(h.trust, knowledge);
    await expect(
      authority.authorize({ operation: "publish", knowledge }),
    ).resolves.toMatchObject({ allowed: true });
    await h.trust.revokeReviewer({
      reviewerId: issuer.reviewerId,
      keyId: registered.keyId,
      reason: "Reviewer left the organization.",
    });
    await expect(
      authority.authorize({ operation: "publish", knowledge }),
    ).rejects.toThrow("not exactly bound");
    await expect(h.trust.commitApproval(receipt)).resolves.toMatchObject({
      recovered: true,
    });
  });

  it("requires revoke-before-rotate and never reactivates a revoked key", async () => {
    const h = backends();
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const registered = await h.trust.registerReviewer({
      reviewerId: "did:reviewer:alice",
      publicKey: first.publicKey,
    });
    await expect(
      h.trust.registerReviewer({
        reviewerId: "did:reviewer:alice",
        publicKey: second.publicKey,
      }),
    ).rejects.toThrow("must be revoked");
    await h.trust.revokeReviewer({
      reviewerId: "did:reviewer:alice",
      keyId: registered.keyId,
      reason: "Routine rotation.",
    });
    await expect(
      h.trust.registerReviewer({
        reviewerId: "did:reviewer:alice",
        publicKey: first.publicKey,
      }),
    ).rejects.toThrow("cannot be reactivated");
    await expect(
      h.trust.registerReviewer({
        reviewerId: "did:reviewer:alice",
        publicKey: second.publicKey,
      }),
    ).resolves.toMatchObject({ durable: true });
  });

  it("rejects forged approval before writing the ledger", async () => {
    const h = backends();
    const keys = generateKeyPairSync("ed25519");
    const issuer = createGovernedKnowledgeEd25519ApprovalIssuer({
      tenantId: "tenant:a",
      reviewerId: "did:reviewer:alice",
      privateKey: keys.privateKey,
      now: () => NOW,
    });
    await h.trust.registerReviewer({
      reviewerId: issuer.reviewerId,
      publicKey: keys.publicKey,
    });
    const receipt = approval(issuer);
    await expect(
      h.trust.commitApproval({
        ...receipt,
        attestation: { ...receipt.attestation, value: "A".repeat(86) },
      }),
    ).rejects.toThrow("not currently trusted");
    expect(h.state.events).toHaveLength(1);
  });
});
