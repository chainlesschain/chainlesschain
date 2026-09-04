import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import { EvolvableArtifactLedgerAdapter } from "../../src/lib/evolution/evolvable-artifact-ledger-adapter.js";
import { createGovernedKnowledgeArtifactLifecycle } from "../../src/lib/evolution/governed-knowledge-artifact-lifecycle.js";

const {
  ARTIFACT_TYPE,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactReleaseGate,
} = evolvableArtifactProtocol;

const roots = [];
let sequence = 0;
const NOW = Date.parse("2026-09-04T00:00:00.000Z");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const digest = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = {
    algorithm: "hmac-sha256",
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ??
      digest(
        `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
      ),
    epoch: snapshot?.epoch ?? null,
    generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null,
    identityDigest: snapshot?.identityDigest ?? null,
    keyId: "test:key/knowledge-witness",
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
    trustPolicyDigest: digest("knowledge-witness-policy"),
    witnessId,
  };
  return {
    ...core,
    witnessDigest: digest(
      `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
    ),
    signature: {
      algorithm: core.algorithm,
      keyId: core.keyId,
      trustPolicyDigest: core.trustPolicyDigest,
      value: "A".repeat(43),
    },
  };
}

function witness(witnessId) {
  let current = witnessRecord(witnessId);
  return {
    id: witnessId,
    read: () => current,
    initialize: ({ expected, snapshot }) => {
      if (expected.witnessDigest === current.witnessDigest)
        current = witnessRecord(witnessId, snapshot, current);
      return current;
    },
    compareAndSwap: ({ expected, next }) => {
      if (expected.witnessDigest === current.witnessDigest)
        current = witnessRecord(witnessId, next, current);
      return current;
    },
    proveAncestry: () => {
      throw new Error("unexpected witness ancestry request");
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(fileDescriptor) {
      if (directories.delete(fileDescriptor)) return;
      return fs.closeSync(fileDescriptor);
    },
    fsyncSync(fileDescriptor) {
      if (directories.has(fileDescriptor)) return;
      try {
        return fs.fsyncSync(fileDescriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(fileDescriptor).isDirectory()
        )
          return;
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

function artifactPorts(root, artifactTenantId, audience) {
  const secret = "knowledge-artifact-secret";
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const algorithm = "hmac-sha256";
  const keyId = "test:key/knowledge-artifact";
  return new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({ dir: path.join(root, "artifacts") }),
    audience,
    tenantId: artifactTenantId,
    now: () => NOW,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) => signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(NOW).toISOString(),
          decisionExpiresAt: new Date(NOW + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest: digest("knowledge-artifact-policy"),
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
          receiptDigest: digest(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
}

function openAdapter(root, descriptor, ledger, ports) {
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: descriptor.purpose,
  });
  return new EvolvableArtifactLedgerAdapter({
    descriptor,
    artifactPorts: ports,
    ledger,
    ledgerArtifactResolver: resolver,
    clock: () => new Date(NOW).toISOString(),
  });
}

export function knowledgeArtifactLifecycle({ tenantId = "tenant:a" } = {}) {
  sequence += 1;
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-sync-artifact-lifecycle-"),
  );
  roots.push(root);
  const descriptor = {
    tenantId,
    artifactTenantId: `artifact-${tenantId}-${sequence}`,
    streamId: `knowledge-artifacts-${sequence}`,
    audience: "knowledge-sync-tests",
    purpose: "evolution-ledger",
  };
  const providerPorts = artifactPorts(
    root,
    descriptor.artifactTenantId,
    descriptor.audience,
  );
  const resolver = providerPorts.createEvolutionLedgerArtifactResolver({
    purpose: descriptor.purpose,
  });
  const ledgerTrust = {
    algorithm: "hmac-sha256",
    keyId: "test:key/knowledge-ledger",
    trustPolicyDigest: digest("knowledge-ledger-policy"),
  };
  const witnessTrust = {
    algorithm: "hmac-sha256",
    keyId: "test:key/knowledge-witness",
    trustPolicyDigest: digest("knowledge-witness-policy"),
  };
  const ledger = new EvolutionLedger({
    rootDir: path.join(root, "ledger-events"),
    authorityRootDir: path.join(root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => NOW,
    random: () => randomBytes(16).toString("hex"),
    trust: ledgerTrust,
    witnessTrust,
    witness: witness(`knowledge-witness-${sequence}`),
    artifactResolver: resolver,
    sign: ({ message }) => ({
      ...ledgerTrust,
      value: createHmac("sha256", "knowledge-ledger-secret")
        .update(message)
        .digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
  const provider = openAdapter(root, descriptor, ledger, providerPorts);
  const verifier = openAdapter(
    root,
    descriptor,
    ledger,
    artifactPorts(root, descriptor.artifactTenantId, descriptor.audience),
  );
  const revision = "knowledge-policy/v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const authority = createEvolvableArtifactAuthority({
    tenantId,
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.KNOWLEDGE,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  return createGovernedKnowledgeArtifactLifecycle({
    tenantId,
    artifactCandidateGate: createEvolvableArtifactCandidateGate({
      authority,
      candidateWriter: provider,
    }),
    artifactReleaseGate: createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: provider,
      transitionReader: provider.transitionReader(),
    }),
    artifactReleaseResolver: verifier.releaseResolver(),
    verifierArtifactTransitionReader: verifier.transitionReader(),
  });
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
