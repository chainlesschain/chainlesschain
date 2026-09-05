import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  GovernedSkillMarketplace,
  buildGovernedSkillMarketplaceManifest,
  digestGovernedSkillMarketplaceState,
} from "../../src/lib/evolution/governed-skill-marketplace.js";
import {
  GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE,
  GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
  GovernedSkillMarketplaceLedgerAdapter,
} from "../../src/lib/evolution/governed-skill-marketplace-ledger-adapter.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";

const NOW = "2026-09-05T15:00:00.000Z";
const TENANT_ID = "tenant:marketplace-ledger";
const ARTIFACT_TENANT_ID = "artifact-tenant-marketplace-ledger";
const TARGET = {
  model: "qwen-3.5-9b",
  os: "linux-x64",
  tool: "cli",
  runtime: "node-22.12.0",
};
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const bytes =
    arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/marketplace-ledger-${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-marketplace-ledger-${label}-secret`;
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign: ({ message }) => Object.freeze({ ...trust, value: sign(message) }),
    }),
    verifier: Object.freeze({
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    }),
  });
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -120_000;
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

function resources() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-marketplace-ledger-"),
  );
  roots.push(root);
  const now = Date.parse(NOW);
  const artifactSecret = "test-only-marketplace-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/marketplace-ledger-artifacts";
  const policyDigest = digest("marketplace-ledger-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", artifactSecret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T15:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
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
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  const witnessRoot = path.join(root, "witness");
  fs.mkdirSync(witnessRoot, { mode: 0o700 });
  return {
    artifactPorts,
    resolver,
    backendOptions: {
      rootDir: path.join(root, "ledger-events"),
      authorityRootDir: path.join(root, "ledger-authority"),
      witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
      witnessId: "governed-marketplace-ledger-witness",
      ledgerAuthority: signingAuthority("ledger"),
      witnessAuthority: signingAuthority("witness"),
      artifactResolver: resolver,
      fsImpl: durableFilesystem(),
      secure: false,
      clock: () => now,
    },
  };
}

function adapter(storage, ledger) {
  return new GovernedSkillMarketplaceLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "governed-marketplace:main",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
    now: () => Date.parse(NOW),
  });
}

function marketplace(ledgerAdapter) {
  return new GovernedSkillMarketplace({
    tenantId: TENANT_ID,
    ports: {
      ...ledgerAdapter.persistencePorts(),
      verifySignature: async () => true,
      adapt: async ({ manifest, cell }) => ({
        authenticated: true,
        manifestDigest: manifest.manifestDigest,
        evalReceiptDigest: cell.evalReceiptDigest,
        outputDigest: digest("adapted-output"),
        adapterDigest: digest("target-adapter"),
      }),
      transition: async ({ request, requestDigest }) => ({
        authenticated: true,
        durable: true,
        requestDigest,
        nextStage: request.nextStage,
        receiptDigest: digest(`transition:${request.nextStage}`),
      }),
      verifyPilot: async ({ state, nextStage }) => ({
        authenticated: true,
        accepted: true,
        stateDigest: state.stateDigest,
        nextStage,
        receiptDigest: digest(`pilot:${nextStage}`),
      }),
      verifyRevocation: async ({ state }) => ({
        authenticated: true,
        revoked: true,
        manifestDigest: state.manifestDigest,
        receiptDigest: digest("marketplace-revocation"),
      }),
    },
  });
}

function manifest(version = "2.0.0") {
  return buildGovernedSkillMarketplaceManifest(
    {
      tenantId: TENANT_ID,
      skillName: "safe-refactor",
      version,
      sourceModel: "qwen-3.6-27b",
      packageDigest: digest(`package:${version}`),
      sourceCommitDigest: digest(`commit:${version}`),
      sbomDigest: digest(`sbom:${version}`),
      dependencyLockDigest: digest(`lock:${version}`),
      permissionManifestDigest: digest(`permissions:${version}`),
      targetMatrixDigest: digest(`matrix:${version}`),
      evalBadgeDigest: digest(`badge:${version}`),
      lineage: [digest(`evidence:${version}`)],
      compatibilityMatrix: [
        {
          ...TARGET,
          accepted: true,
          safetyPassed: true,
          qualityScore: 0.9,
          sampleCount: 100,
          evalReceiptDigest: digest(`target-eval:${version}`),
        },
      ],
    },
    "signed-marketplace-manifest-value",
  );
}

function revocationRequest(state) {
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId: TENANT_ID,
    streamId: "pilot:marketplace-revocations",
    operationId: `skill-revocation:${digest("transition").slice(7)}:${digest("marketplace-dependency").slice(7)}`,
    transitionDigest: digest("transition"),
    candidateId: digest("candidate"),
    skillName: "safe-refactor",
    occurredAt: NOW,
    sourceReceiptDigest: digest("source-receipt"),
    resolutionDigest: digest("resolution"),
    dependency: {
      kind: "marketplace-badge",
      ref: `marketplace-state:${TENANT_ID}:safe-refactor`,
      digest: state.stateDigest,
      disposition: "revoke",
    },
  };
  return Object.freeze({
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  });
}

describe("GovernedSkillMarketplaceLedgerAdapter", () => {
  it("reopens a staged and revoked marketplace state from real Ledger files", async () => {
    const storage = resources();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const firstAdapter = adapter(storage, firstBackend.ledger);
    const first = marketplace(firstAdapter);
    const staged = await first.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    const request = revocationRequest(staged);
    const revoked = await first.revokeMarketplaceBadge(request);
    expect(revoked).toMatchObject({
      authenticated: true,
      durable: true,
      disposition: "revoke",
    });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopenedAdapter = adapter(storage, reopenedBackend.ledger);
    const reopened = marketplace(reopenedAdapter);
    await expect(reopened.revokeMarketplaceBadge(request)).resolves.toEqual(
      revoked,
    );
    expect(reopenedAdapter.load({ skillName: "safe-refactor" })).toMatchObject({
      stage: "rolled-back",
      revoked: true,
      revocationPropagationRequestDigest: request.requestDigest,
    });
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 2 });
    expect(reopenedBackend.ledger.read().map(({ type }) => type)).toEqual([
      GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
      GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
    ]);
  });

  it("recovers a revocation append response loss without duplicating state", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    let loseRevocationAck = false;
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        const receipt = backend.ledger.appendDomainEvent(input, options);
        if (loseRevocationAck) {
          loseRevocationAck = false;
          throw new Error("simulated marketplace ledger response loss");
        }
        return receipt;
      },
    };
    const ledgerAdapter = adapter(storage, ledger);
    const subject = marketplace(ledgerAdapter);
    const staged = await subject.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    loseRevocationAck = true;
    await expect(
      subject.revokeMarketplaceBadge(revocationRequest(staged)),
    ).resolves.toMatchObject({ durable: true, disposition: "revoke" });
    expect(backend.ledger.verify()).toMatchObject({ sequence: 2 });
  });

  it("rejects immutable package replacement across an advance", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const ledgerAdapter = adapter(storage, backend.ledger);
    const subject = marketplace(ledgerAdapter);
    const staged = await subject.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    const core = {
      ...staged,
      packageDigest: digest("substituted-package"),
      stage: "shadow",
      transitionRequestDigest: digest("transition-request"),
      transitionReceiptDigest: digest("transition-receipt"),
    };
    delete core.stateDigest;
    expect(() =>
      ledgerAdapter.commit({
        state: {
          ...core,
          stateDigest: digestGovernedSkillMarketplaceState(core),
        },
        expectedStateDigest: staged.stateDigest,
        event: "marketplace.advanced",
      }),
    ).toThrow(
      expect.objectContaining({
        code: GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE,
      }),
    );
    expect(backend.ledger.verify()).toMatchObject({ sequence: 1 });
  });
});
