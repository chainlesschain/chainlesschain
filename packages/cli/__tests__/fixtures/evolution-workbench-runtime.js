import {
  responseFor,
  verifyDecision,
  verifyHuman,
  NOW,
} from "./evolution-workbench-review.js";

// Test-only resource assembly; production must supply its own identity/PKI.
// No default identity is manufactured even by this fixture.
export function workbenchRuntimeOptions(h, overrides = {}) {
  const registry = h.registryOptions;
  const rollback = h.adapterOptions;
  return {
    ...h.shared,
    releaseRegistry: registry.releaseRegistry,
    transactionLedger: registry.transactionLedger,
    verifierLedger: registry.verifierLedger,
    verifierLedgerArtifactResolver: registry.verifierLedgerArtifactResolver,
    verifierReleaseRegistry: registry.verifierReleaseRegistry,
    verifierTransactionLedger: registry.verifierTransactionLedger,
    rollbackProvider: rollback.rollbackProvider,
    authorizationProvider: rollback.authorizationProvider,
    humanRollbackProvider: rollback.humanRollbackProvider,
    humanRollbackVerifier: rollback.humanRollbackVerifier,
    identityProvider: {
      current: () => {
        throw new Error("test did not authorize identity resolution");
      },
    },
    decisionVerifier: { verify: verifyDecision },
    humanDecisionProvider: {
      request: async (request) =>
        responseFor(
          (await h.review.readReview(request.packetDigest)).packet,
          request,
          {},
          Number(h.shared.now?.() ?? NOW),
        ),
    },
    humanDecisionVerifier: { verify: verifyHuman },
    ...overrides,
  };
}

export async function seedWorkbenchPendingCandidate(h) {
  const candidate = h.release.createDerivedCandidate();
  const active = h.release.readActive();
  const packet = packetFor(
    { candidate },
    active.release,
    active.state.revision,
  );
  const sequence = h.run.load().events.length + 1;
  h.run.appendEvent({
    schema: evolutionRun.EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: h.descriptor.tenantId,
    runId: h.descriptor.runId,
    eventId: `startup-pending-${sequence}`,
    sequence,
    type: "skill-candidate-recorded",
    subjectId: candidate.candidateId,
    payloadDigest: candidate.contentDigest,
    artifactRef: `artifact://${candidate.candidateId}`,
    keyRef: null,
    data: {},
  });
  await h.review.submitPacket(packet);
  return packet;
}

// A signed, file-backed TEST identity for exercising real CLI child processes.
// The private key is intentionally public fixture material, never deployment PKI.
const identityKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    createHash("sha256").update("test-only-workbench-cli-identity").digest(),
  ]),
  type: "pkcs8",
  format: "der",
});
export function workbenchTestIdentity(h, root, seed = false) {
  const file = path.join(root, "test-human-identity.json");
  if (seed) {
    const core = {
      schema: "test-only/workbench-human/v1",
      tenantId: h.descriptor.tenantId,
      subjectId: "human:alice",
      automated: false,
      issuedAt: NOW,
      expiresAt: NOW + 600_000,
    };
    const receiptDigest = digest(core.schema, core);
    const value = {
      ...core,
      receiptDigest,
      signature: sign(null, Buffer.from(receiptDigest), identityKey).toString(
        "base64url",
      ),
    };
    const fd = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(fd, canonical(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const directory = h.fsImpl.openSync(root, "r");
    try {
      h.fsImpl.fsyncSync(directory);
    } finally {
      h.fsImpl.closeSync(directory);
    }
  }
  return {
    current: ({ tenantId }) => {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      const { signature, receiptDigest, ...core } = value;
      const now = Number(h.shared.now());
      if (
        core.schema !== "test-only/workbench-human/v1" ||
        core.tenantId !== tenantId ||
        core.tenantId !== h.descriptor.tenantId ||
        core.automated !== false ||
        core.subjectId !== "human:alice" ||
        core.issuedAt > now ||
        core.expiresAt <= now ||
        receiptDigest !== digest(core.schema, core) ||
        !verify(
          null,
          Buffer.from(receiptDigest),
          createPublicKey(identityKey),
          Buffer.from(signature, "base64url"),
        )
      )
        throw new Error("test identity is invalid, expired or revoked");
      return {
        tenantId,
        subjectId: core.subjectId,
        automated: false,
        authenticated: true,
        durable: true,
        receiptDigest,
      };
    },
  };
}
import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { packetFor } from "./evolution-workbench-rollback.js";
import {
  pruningCanonical as canonical,
  pruningDigest as digest,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
