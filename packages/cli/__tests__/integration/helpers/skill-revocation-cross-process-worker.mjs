import { createHash, createHmac } from "node:crypto";
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { ArtifactStore } from "../../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  GovernedSkillMarketplace,
  buildGovernedSkillMarketplaceManifest,
} from "../../../src/lib/evolution/governed-skill-marketplace.js";
import { GovernedSkillMarketplaceLedgerAdapter } from "../../../src/lib/evolution/governed-skill-marketplace-ledger-adapter.js";

import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "../../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
  INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
  createIndependentSkillRevocationSource,
  digestIndependentSkillRevocationRecord,
} from "../../../src/lib/evolution/independent-skill-revocation-source.js";
import {
  SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
  SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
  createSkillRevocationPropagation,
} from "../../../src/lib/evolution/skill-revocation-propagation.js";
import { openSkillRetrievalRevocationAuthority } from "../../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import { SkillRetrievalRevocationLedgerAdapter } from "../../../src/lib/evolution/skill-retrieval-revocation-ledger-adapter.js";
import {
  SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
  SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
  createSkillWikiReconciler,
} from "../../../src/lib/evolution/skill-wiki-reconciliation.js";

const [root, operation, crashPoint = "none"] = process.argv.slice(2);
mkdirSync(root, { recursive: true });

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const D = (value) =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const domainDigest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
const file = (name) => join(root, `${name}.json`);
const load = (name, fallback) =>
  existsSync(file(name))
    ? JSON.parse(readFileSync(file(name), "utf8"))
    : structuredClone(fallback);
function save(name, value) {
  const temporary = `${file(name)}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), "utf8");
  renameSync(temporary, file(name));
}

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/revocation-process-${label}`,
    trustPolicyDigest: D(`${label}-policy`),
  });
  const secret = `test-only-revocation-process-${label}-secret`;
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
  let nextDescriptor = -110_000;
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

function durableDomainLedger(label, artifactTenantId) {
  const now = Date.parse("2026-09-05T10:00:00.000Z");
  const secret = `test-only-revocation-${label}-artifact-secret`;
  const algorithm = "hmac-sha256";
  const keyId = `test:key/revocation-${label}-artifacts`;
  const policyDigest = D(`revocation-${label}-artifact-policy`);
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: join(root, `${label}-artifacts`),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: artifactTenantId,
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
          checkedAt: "2026-09-05T10:00:00.000Z",
          decisionExpiresAt: "2026-09-05T10:01:00.000Z",
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
          receiptDigest: domainDigest(
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
  mkdirSync(join(root, `${label}-witness`), { recursive: true });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: join(root, `${label}-ledger-events`),
    authorityRootDir: join(root, `${label}-ledger-authority`),
    witnessFilePath: join(root, `${label}-witness`, "checkpoint.json"),
    witnessId: `skill-${label}-revocation-process-witness`,
    ledgerAuthority: signingAuthority(`${label}-ledger`),
    witnessAuthority: signingAuthority(`${label}-witness`),
    artifactResolver: resolver,
    fsImpl: durableFilesystem(),
    secure: false,
    clock: () => now,
  });
  return Object.freeze({ artifactPorts, backend, now, resolver });
}

async function retrievalAuthority() {
  const artifactTenantId = "artifact-tenant-a-retrieval";
  const storage = durableDomainLedger("retrieval", artifactTenantId);
  const adapter = new SkillRetrievalRevocationLedgerAdapter({
    descriptor: {
      tenantId: "tenant-a",
      artifactTenantId,
      streamId: "retrieval-revocations:process",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger: storage.backend.ledger,
    ledgerArtifactResolver: storage.resolver,
    now: () => storage.now,
  });
  const authority = await openSkillRetrievalRevocationAuthority({
    tenantId: "tenant-a",
    ports: adapter.persistencePorts(),
  });
  return Object.freeze({ authority, backend: storage.backend });
}

const MARKETPLACE_TARGET = Object.freeze({
  model: "qwen-3.5-9b",
  os: "windows-x64",
  tool: "cli",
  runtime: "node-22.12.0",
});

function marketplaceManifest() {
  return buildGovernedSkillMarketplaceManifest(
    {
      tenantId: "tenant-a",
      skillName: "safe-refactor",
      version: "1.0.0",
      sourceModel: "qwen-3.5-27b",
      packageDigest: D("marketplace-package"),
      sourceCommitDigest: D("marketplace-commit"),
      sbomDigest: D("marketplace-sbom"),
      dependencyLockDigest: D("marketplace-lock"),
      permissionManifestDigest: D("marketplace-permissions"),
      targetMatrixDigest: D("marketplace-target-matrix"),
      evalBadgeDigest: D("marketplace-eval-badge"),
      lineage: [D("marketplace-evidence")],
      compatibilityMatrix: [
        {
          ...MARKETPLACE_TARGET,
          accepted: true,
          safetyPassed: true,
          qualityScore: 0.9,
          sampleCount: 100,
          evalReceiptDigest: D("marketplace-target-eval"),
        },
      ],
    },
    "signed-marketplace-manifest",
  );
}

async function marketplaceAuthority() {
  const artifactTenantId = "artifact-tenant-a-marketplace";
  const storage = durableDomainLedger("marketplace", artifactTenantId);
  const adapter = new GovernedSkillMarketplaceLedgerAdapter({
    descriptor: {
      tenantId: "tenant-a",
      artifactTenantId,
      streamId: "governed-marketplace:process",
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger: storage.backend.ledger,
    ledgerArtifactResolver: storage.resolver,
    now: () => storage.now,
  });
  const authority = new GovernedSkillMarketplace({
    tenantId: "tenant-a",
    ports: {
      ...adapter.persistencePorts(),
      verifySignature: async () => true,
      adapt: async ({ manifest, cell }) => ({
        authenticated: true,
        manifestDigest: manifest.manifestDigest,
        evalReceiptDigest: cell.evalReceiptDigest,
        outputDigest: D("marketplace-adapted-output"),
        adapterDigest: D("marketplace-target-adapter"),
      }),
      transition: async ({ request, requestDigest }) => ({
        authenticated: true,
        durable: true,
        requestDigest,
        nextStage: request.nextStage,
        receiptDigest: D(["marketplace-transition", request.nextStage]),
      }),
      verifyPilot: async ({ state, nextStage }) => ({
        authenticated: true,
        accepted: true,
        stateDigest: state.stateDigest,
        nextStage,
        receiptDigest: D(["marketplace-pilot", nextStage]),
      }),
      verifyRevocation: async ({ state }) => ({
        authenticated: true,
        revoked: true,
        manifestDigest: state.manifestDigest,
        receiptDigest: D("marketplace-revocation"),
      }),
    },
  });
  let state = adapter.load({ skillName: "safe-refactor" });
  if (!state) {
    state = await authority.stage({
      manifest: marketplaceManifest(),
      target: MARKETPLACE_TARGET,
      expectedStateDigest: null,
    });
  }
  return Object.freeze({
    adapter,
    authority,
    backend: storage.backend,
    state,
  });
}

function externalSource() {
  const unsigned = {
    schema: INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
    tenantId: "tenant-a",
    streamId: "security-revocations",
    sequence: 1,
    revocationId: "security-incident-1",
    candidateId: D("candidate"),
    skillName: "safe-refactor",
    reason: "Independent security authority revoked the active Skill.",
    occurredAt: "2026-09-05T10:00:00.000Z",
    activeStateDigest: D("active-state"),
    evidenceReceiptDigests: [D("incident")],
    attestation: {
      algorithm: "ed25519",
      keyId: "security-key-1",
      value: "A".repeat(64),
    },
  };
  const record = {
    ...unsigned,
    recordDigest: digestIndependentSkillRevocationRecord(unsigned),
  };
  return createIndependentSkillRevocationSource({
    tenantId: "tenant-a",
    streamId: "security-revocations",
    ports: {
      readRevocations: async () => [record],
      verifyRevocation: async (request) => ({
        schema: INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: request.tenantId,
        streamId: request.streamId,
        sequence: request.sequence,
        recordDigest: request.recordDigest,
        receiptDigest: D(["verified", request.recordDigest]),
      }),
    },
  });
}

function evidence(ref, trustDomain) {
  const core = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId: "tenant-a",
    ref,
    sourceDigest: D(["source", ref]),
    projectionDigest: D(["projection", ref]),
    artifactRef: `artifact://${ref}`,
    trustedProjection: true,
    trustDomain,
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    data: { result: "verified" },
  };
  return { ...core, envelopeDigest: D(core) };
}

async function wiki() {
  let wikiState = load("wiki", createEmptyWikiState("tenant-a"));
  const retained = load("evidence", {});
  const base = {
    "ev-1": evidence("ev-1", "workspace-a"),
    "ev-2": evidence("ev-2", "workspace-b"),
  };
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor: {
      tenantId: "tenant-a",
      evolutionRunId: "run-cross-process",
      maintainerModel: "provider:maintainer-v1",
      rulesDigest: D("rules"),
      minCorroboratingSources: 2,
    },
    policy: {
      trustedProjectionRead: true,
      rawEvidenceRead: false,
      activeSkillWrite: false,
      shell: false,
      network: false,
      secretRead: false,
    },
    ports: {
      loadWiki: async () => ({
        trusted: true,
        state: wikiState,
        stateDigest: digestWikiState(wikiState),
      }),
      resolveEvidence: async (ref) => retained[ref] ?? base[ref],
      derive: async ({ evidence: items }) => {
        const proposal = items.find(
          (item) => item.kind === "proposal-decision",
        );
        return proposal
          ? {
              operations: [
                {
                  type: "proposal-impact",
                  decision: {
                    ...proposal.data.decision,
                    receiptRef: proposal.ref,
                  },
                },
              ],
            }
          : {
              operations: [
                {
                  type: "upsert",
                  pattern: {
                    patternId: "pat-safe-refactor",
                    kind: "success",
                    summary:
                      "Bounded refactors pass deterministic verification.",
                    rootCause: "Small changes preserve behavior.",
                    procedure: "Apply one bounded change and test.",
                    appliesWhen: ["tests exist"],
                    doesNotApplyWhen: [],
                    positiveEvidence: ["ev-1", "ev-2"],
                    negativeEvidence: [],
                    contradicts: [],
                    supersedes: [],
                    confidence: 0.8,
                    trustDomains: [],
                    lastVerifiedAt: "2026-09-01T00:00:00.000Z",
                    expiresAt: null,
                    skillNames: ["safe-refactor"],
                  },
                },
              ],
            };
      },
      commitRevision: async ({ revision }) => {
        wikiState = revision.state;
        save("wiki", wikiState);
        return {
          committed: true,
          revisionId: revision.revisionId,
          stateDigest: revision.stateDigest,
          evolutionRunId: revision.evolutionRunId,
        };
      },
    },
  });
  if (!wikiState.patterns["pat-safe-refactor"]) {
    await maintainer.maintain({
      evidenceRefs: ["ev-1", "ev-2"],
      effectiveAt: "2026-09-01T00:00:00.000Z",
    });
  }
  const source = externalSource();
  const reconciler = createSkillWikiReconciler({
    source,
    maintainer,
    ports: {
      resolveImpact: async (event) => ({
        schema: SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: "tenant-a",
        transitionDigest: event.transitionDigest,
        candidateId: event.candidateId,
        skillName: event.skillName,
        wikiRevision: event.wikiRevision,
        patternRefs: ["pat-safe-refactor"],
        reason: event.reason,
        receiptDigest: D("impact"),
      }),
      retainEvidence: async (item) => {
        retained[item.ref] = item;
        save("evidence", retained);
        return {
          schema: SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: "tenant-a",
          ref: item.ref,
          envelopeDigest: item.envelopeDigest,
          receiptDigest: D(["retain", item.ref]),
        };
      },
      loadCheckpoint: async () => load("wiki-checkpoint", null),
      commitCheckpoint: async ({ checkpoint }) => {
        save("wiki-checkpoint", checkpoint);
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: checkpoint.checkpointDigest,
        };
      },
    },
    crashHook() {
      if (crashPoint === "after-wiki-commit") process.exit(92);
    },
  });
  await reconciler.reconcile();
}

async function propagate() {
  const source = externalSource();
  const retrieval = await retrievalAuthority();
  const marketplace = await marketplaceAuthority();
  const effectState = load("effects", {});
  const dependencies = [
    ["wiki-pattern", "stale"],
    ["memory", "quarantine"],
    ["retrieval-index", "invalidate"],
    ["marketplace-badge", "revoke"],
  ]
    .map(([kind, disposition]) => ({
      kind,
      disposition,
      ref:
        kind === "retrieval-index"
          ? "skill-content:tenant-a:safe-refactor"
          : kind === "marketplace-badge"
            ? "marketplace-state:tenant-a:safe-refactor"
            : `${kind}://tenant-a/safe-refactor`,
      digest:
        kind === "marketplace-badge"
          ? (marketplace.state.revocationBaselineStateDigest ??
            marketplace.state.stateDigest)
          : D([kind, "dependency"]),
    }))
    .sort((a, b) => `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`));
  const effect = async (request) => {
    const prior = effectState[request.operationId];
    if (!prior) {
      effectState[request.operationId] = {
        applyCount: 1,
        requestDigest: request.requestDigest,
        receiptDigest: D(["effect", request.operationId]),
      };
      save("effects", effectState);
    } else if (prior.requestDigest !== request.requestDigest)
      throw new Error("operation substitution");
    return {
      schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      tenantId: request.tenantId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      dependencyKind: request.dependency.kind,
      dependencyRef: request.dependency.ref,
      dependencyDigest: request.dependency.digest,
      disposition: request.dependency.disposition,
      receiptDigest: effectState[request.operationId].receiptDigest,
    };
  };
  const propagation = createSkillRevocationPropagation({
    source,
    ports: {
      resolveDependencies: async (event) => {
        const core = {
          schema: SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
          tenantId: "tenant-a",
          transitionDigest: event.transitionDigest,
          candidateId: event.candidateId,
          skillName: event.skillName,
          completeKinds: [
            "wiki-pattern",
            "memory",
            "retrieval-index",
            "marketplace-badge",
          ],
          dependencies,
        };
        return {
          ...core,
          authenticated: true,
          durable: true,
          resolutionDigest: D(core),
          receiptDigest: D("resolution"),
        };
      },
      stalePattern: effect,
      quarantineMemory: effect,
      invalidateRetrieval: retrieval.authority.invalidateRetrieval.bind(
        retrieval.authority,
      ),
      revokeMarketplaceBadge: marketplace.authority.revokeMarketplaceBadge.bind(
        marketplace.authority,
      ),
      loadCheckpoint: async () => load("propagation-checkpoint", null),
      commitCheckpoint: async ({ checkpoint }) => {
        save("propagation-checkpoint", checkpoint);
        if (crashPoint === "after-checkpoint-commit") process.exit(94);
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: checkpoint.checkpointDigest,
        };
      },
    },
    crashHook() {
      if (crashPoint === "after-dependencies") process.exit(93);
    },
  });
  await propagation.propagate();
  const retrievalDependency = dependencies.find(
    ({ kind }) => kind === "retrieval-index",
  );
  save("retrieval-inspection", {
    ...retrieval.authority.inspect({
      skillName: "safe-refactor",
      contentDigest: retrievalDependency.digest,
    }),
    ledgerSequence: retrieval.backend.ledger.verify().sequence,
  });
  save("marketplace-inspection", {
    state: marketplace.adapter.load({ skillName: "safe-refactor" }),
    ledgerSequence: marketplace.backend.ledger.verify().sequence,
  });
}

if (operation === "wiki") await wiki();
else if (operation === "propagate") await propagate();
else throw new Error("unknown operation");
