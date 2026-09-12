// Local cryptographic authorities only; all evidence, ArtifactStore, Run,
// ledger, witness, Reader and Wiki implementations below are production code.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  ArtifactStoreEncryptedRawStore,
  EvolutionEvidenceArtifactAdapter,
} from "../../src/lib/evolution/evolution-evidence-artifact-adapter.js";
import * as boundary from "../../src/lib/evolution/evolution-evidence-projector.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { EvolutionRunLedgerAdapter } from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import { createEvolutionRunWikiEvidenceResolver } from "../../src/lib/evolution/evolution-run-wiki-evidence-resolver.js";
import { WikiMaintainerLedgerAdapter } from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import { EvidenceBackedWikiMaintainer } from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

export const NOW = "2026-09-12T00:00:00.000Z";
const RETENTION = "2027-09-12T00:00:00.000Z";
export const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
export const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const hashed = (domain, value) => digest(`${domain}\0${canonical(value)}`);
const receipt = (core, domain, key = "receiptDigest") => ({
  ...core,
  [key]: hashed(domain, core),
});
export const TOOL_SCHEMA = digest("test-only-tool-observation-schema-v1");
export const OUTCOME_SCHEMA = digest("test-only-verified-outcome-schema-v1");
export const schemaPolicies = {
  [TOOL_SCHEMA]: {
    sourceKind: "tool-observation",
    metadataKeys: ["summary", "result"],
  },
  [OUTCOME_SCHEMA]: {
    sourceKind: "verified-outcome",
    metadataKeys: ["summary", "result"],
  },
};

export function durableFilesystem() {
  const directories = new Set();
  let next = -50_000;
  return {
    ...fs,
    closeSync(fd) {
      if (!directories.delete(fd)) fs.closeSync(fd);
    },
    fsyncSync(fd) {
      if (directories.has(fd)) return;
      try {
        fs.fsyncSync(fd);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error.code) ||
          !fs.fstatSync(fd).isDirectory()
        )
          throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform !== "win32" ||
          flags !== "r" ||
          !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error.code) ||
          !fs.statSync(target).isDirectory()
        )
          throw error;
        directories.add(--next);
        return next;
      }
    },
  };
}
function signingAuthority(label) {
  const key = crypto.randomBytes(32);
  const trust = {
    algorithm: "hmac-sha256",
    keyId: `key://journey/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  };
  const sign = (message) =>
    crypto.createHmac("sha256", key).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: sign(message) }) },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    },
  };
}
function signedEnvelopes() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    issue(value) {
      const bytes = Buffer.from(canonical(value));
      return `${bytes.toString("base64url")}.${crypto.sign(null, bytes, privateKey).toString("base64url")}`;
    },
    verify(envelope) {
      const parts = envelope.split(".");
      if (parts.length !== 2) throw new Error("invalid signed envelope");
      const bytes = Buffer.from(parts[0], "base64url");
      if (
        !crypto.verify(
          null,
          bytes,
          publicKey,
          Buffer.from(parts[1], "base64url"),
        )
      )
        throw new Error("invalid envelope signature");
      return JSON.parse(bytes.toString("utf8"));
    },
  };
}

export function createJourneyAuthorities(tenantId) {
  let clock = Date.parse(NOW);
  let accessAllowed = true;
  const now = () => clock;
  const sourceEnvelopes = signedEnvelopes();
  const principalEnvelopes = signedEnvelopes();
  const commitmentKey = crypto.randomBytes(32);
  const rawKey = crypto.randomBytes(32);
  const attestationKeys = crypto.generateKeyPairSync("ed25519");
  const evidenceStates = new Map();
  const sourcePrincipals = new Set(["tool-a", "tool-b", "model-a", "user-a"]);
  const lease = (request, ttl = 30_000) => ({
    requestNonce: request.requestNonce,
    requestedAt: request.requestedAt,
    checkedAt: new Date(now()).toISOString(),
    decisionExpiresAt: new Date(now() + ttl).toISOString(),
  });
  const artifactKey = crypto.randomBytes(32);
  const artifactKeyId = "key://journey/artifact";
  const artifactSign = (message) =>
    crypto
      .createHmac("sha256", artifactKey)
      .update(message)
      .digest("base64url");
  const artifact = {
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm: "hmac-sha256",
        keyId: artifactKeyId,
        value: artifactSign(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === "hmac-sha256" &&
        signature.keyId === artifactKeyId &&
        signature.value === artifactSign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        if (
          request.tenantId !== tenantId ||
          request.audience !== "evolution-runtime" ||
          !["evidence-projection", "evolution-ledger"].includes(request.purpose)
        )
          throw new Error("artifact authority scope denied");
        return receipt(
          {
            schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
            action: request.action,
            algorithm: "hmac-sha256",
            allowed: true,
            audience: request.audience,
            checkedAt: new Date(now()).toISOString(),
            decisionExpiresAt: new Date(now() + 30_000).toISOString(),
            digest: request.digest,
            issuedAt: request.issuedAt,
            issuedPolicyDigest: request.issuedPolicyDigest,
            issuedPolicyRevision: request.issuedPolicyRevision,
            issuedPolicyTrusted: true,
            keyId: request.keyId || artifactKeyId,
            policyDigest: digest("artifact-policy"),
            policyRevision: 1,
            purpose: request.purpose,
            requestedAt: request.requestedAt,
            retention: request.retention,
            revocationRevision: 1,
            revoked: false,
            tenantId,
            type: request.type,
          },
          "chainlesschain.evolution-artifact-authority-decision/v1",
        );
      },
    },
  };
  const sourceVerifier = {
    async verify(request) {
      const source = sourceEnvelopes.verify(request.sourceEnvelope);
      if (
        source.tenantId !== tenantId ||
        !sourcePrincipals.has(source.principalId) ||
        source.payloadDigest !==
          hashed("chainlesschain.evolution-raw-plaintext/v2", request.payload)
      )
        throw new Error("source identity or payload denied");
      const compilable =
        ["tool-observation", "verified-outcome"].includes(source.sourceKind) &&
        source.principalId.startsWith("tool-");
      return receipt(
        {
          schema: boundary.EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
          verified: true,
          sourceEnvelopeDigest: request.sourceEnvelopeDigest,
          sourceInputDigest: request.sourceInputDigest,
          tenantId,
          principalId: source.principalId,
          sourceKind: source.sourceKind,
          trust: compilable ? "trusted" : "untrusted",
          authenticated: true,
          sourceRef: source.sourceRef,
          sensitivity: "internal",
          schemaDigest: compilable ? source.schemaDigest : null,
          compilable,
          trustedPayload: compilable
            ? (source.trustedPayload ?? request.payload)
            : null,
          ...lease(request),
          verifierPolicyDigest: digest("source-policy"),
          verifierPolicyRevision: 1,
          schemaPolicyDigest: digest("source-schema-policy"),
          schemaPolicyRevision: 1,
        },
        "chainlesschain.evolution-source-verification/v1",
        "verificationReceiptDigest",
      );
    },
  };
  const keyedCommitter = {
    async commit(request) {
      if (request.tenantId !== tenantId)
        throw new Error("cross-tenant commitment");
      const commit = (purpose, input) =>
        `hmac-sha256:${crypto.createHmac("sha256", commitmentKey).update(`${tenantId}\0${purpose}\0${input}`).digest("hex")}`;
      return receipt(
        {
          schema: boundary.EVOLUTION_KEYED_COMMITMENT_SCHEMA,
          committed: true,
          tenantId,
          algorithm: "hmac-sha256",
          keyId: `kms://${tenantId}/commitments`,
          keyVersion: 1,
          sourcePurpose: request.sourcePurpose,
          sourceInputDigest: request.sourceInputDigest,
          sourceCommitment: commit(
            request.sourcePurpose,
            request.sourceInputDigest,
          ),
          trustedPayloadPurpose: request.trustedPayloadPurpose,
          trustedPayloadInputDigest: request.trustedPayloadInputDigest,
          trustedPayloadCommitment:
            request.trustedPayloadInputDigest === null
              ? null
              : commit(
                  request.trustedPayloadPurpose,
                  request.trustedPayloadInputDigest,
                ),
          ...lease(request),
          policyDigest: digest("commitment-policy"),
          policyRevision: 1,
        },
        "chainlesschain.evolution-keyed-commitment/v1",
        "commitmentReceiptDigest",
      );
    },
  };
  const storagePolicy = {
    async resolve(request) {
      if (
        request.tenantId !== tenantId ||
        !sourcePrincipals.has(request.principalId)
      )
        throw new Error("Raw storage scope denied");
      return receipt(
        {
          schema: boundary.EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
          allowed: true,
          tenantId,
          principalId: request.principalId,
          sourceKind: request.sourceKind,
          sourceCommitment: request.sourceCommitment,
          commitmentReceiptDigest: request.commitmentReceiptDigest,
          sourceVerificationReceiptDigest:
            request.sourceVerificationReceiptDigest,
          sensitivity: request.sensitivity,
          retention: { expiresAt: RETENTION, deletionClass: "user-delete" },
          acl: [request.principalId, "service-wiki"],
          ...lease(request),
          policyDigest: digest("storage-policy"),
          policyRevision: 1,
        },
        "chainlesschain.evolution-raw-storage-policy/v1",
        "policyReceiptDigest",
      );
    },
  };
  const rawEncryptor = {
    async encrypt({ tenantId: requestedTenant, aad, plaintext }) {
      if (requestedTenant !== tenantId)
        throw new Error("cross-tenant Raw encryption");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, iv);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return {
        algorithm: "aes-256-gcm",
        keyRef: `kms://${tenantId}/raw`,
        sealedBytes: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
      };
    },
  };
  const attestationSigner = {
    async sign(input) {
      const core = {
        schema: boundary.EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
        algorithm: "ed25519",
        keyId: "journey-attestation",
        issuer: "journey-projector",
        trustPolicyDigest: digest("attestation-policy"),
        receiptDigest: input.receiptDigest,
        tenantId: input.tenantId,
        evidenceId: input.evidenceId,
      };
      return receipt(
        {
          ...core,
          signature: crypto
            .sign(
              null,
              Buffer.from(canonical(core)),
              attestationKeys.privateKey,
            )
            .toString("base64url"),
        },
        "chainlesschain.evolution-projection-attestation/v1",
        "attestationDigest",
      );
    },
  };
  const attestationVerifier = {
    async verify(value, expected) {
      const { signature, attestationDigest, ...core } = value;
      if (
        core.tenantId !== tenantId ||
        attestationDigest !== expected.attestationDigest ||
        !crypto.verify(
          null,
          Buffer.from(canonical(core)),
          attestationKeys.publicKey,
          Buffer.from(signature, "base64url"),
        )
      )
        throw new Error("attestation denied");
      return receipt(
        {
          schema: boundary.EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
          verified: true,
          attestationDigest,
          receiptDigest: value.receiptDigest,
          tenantId,
          evidenceId: value.evidenceId,
          issuer: value.issuer,
          keyId: value.keyId,
          trustPolicyDigest: value.trustPolicyDigest,
          trustPolicyRevision: 1,
          ...lease(expected),
        },
        "chainlesschain.evolution-attestation-verification/v1",
        "verificationReceiptDigest",
      );
    },
  };
  const readAuthorities = {
    evidenceState: {
      async resolve(request) {
        const state = evidenceStates.get(request.evidenceId);
        if (
          !state ||
          state.tenantId !== request.tenantId ||
          state.rawRecordDigest !== request.rawRecordDigest ||
          state.projectionReceiptDigest !== request.projectionReceiptDigest ||
          state.attestationDigest !== request.attestationDigest
        )
          throw new Error("unknown or substituted evidence");
        return receipt(
          {
            schema: boundary.EVOLUTION_EVIDENCE_STATE_DECISION_SCHEMA,
            readable: state.status === "active",
            ...state,
            ...lease(request),
          },
          "chainlesschain.evolution-evidence-state-decision/v1",
        );
      },
    },
    principalResolver: {
      async resolve(request) {
        const principal = principalEnvelopes.verify(request.principalEnvelope);
        if (
          principal.tenantId !== tenantId ||
          !["service-wiki", "service-other"].includes(principal.principalId)
        )
          throw new Error("Wiki principal denied");
        return receipt(
          {
            schema: boundary.EVOLUTION_PROJECTION_PRINCIPAL_SCHEMA,
            authenticated: true,
            ...principal,
            principalEnvelopeDigest: request.principalEnvelopeDigest,
            action: request.action,
            purpose: request.purpose,
            roles: ["wiki-maintainer"],
            ...lease(request),
            policyDigest: digest("principal-policy"),
            policyRevision: 1,
          },
          "chainlesschain.evolution-projection-principal/v1",
        );
      },
    },
    accessPolicy: {
      async authorize(request) {
        const allowed =
          accessAllowed &&
          request.tenantId === tenantId &&
          request.purpose === "wiki-maintenance" &&
          request.action === "read-trusted" &&
          request.principal.principalId === "service-wiki";
        return receipt(
          {
            schema: boundary.EVOLUTION_PROJECTION_ACCESS_DECISION_SCHEMA,
            allowed,
            action: request.action,
            purpose: request.purpose,
            principalId: request.principal.principalId,
            principalReceiptDigest: request.principal.receiptDigest,
            evidenceStateReceiptDigest: request.evidenceStateReceiptDigest,
            evidenceStateRevision: request.evidenceStateRevision,
            evidenceStateDecisionExpiresAt:
              request.evidenceStateDecisionExpiresAt,
            principalExpiresAt: request.principalExpiresAt,
            principalDecisionExpiresAt: request.principalDecisionExpiresAt,
            tenantId: request.tenantId,
            evidenceId: request.evidenceId,
            sensitivity: request.sensitivity,
            projectionReceiptDigest: request.projectionReceiptDigest,
            retentionExpiresAt: request.retentionExpiresAt,
            ...lease(request, 20_000),
            policyDigest: digest("access-policy"),
            policyRevision: 1,
          },
          "chainlesschain.evolution-projection-access-decision/v1",
        );
      },
    },
  };
  return {
    now,
    setAccessAllowed(value) {
      accessAllowed = value === true;
    },
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    artifact,
    rawEncryptor,
    sourceVerifier,
    keyedCommitter,
    storagePolicy,
    attestationSigner,
    attestationVerifier,
    ledger: signingAuthority("ledger"),
    witness: signingAuthority("witness"),
    readAuthorities,
    principalEnvelope: principalEnvelopes.issue({
      tenantId,
      principalId: "service-wiki",
      expiresAt: RETENTION,
    }),
    issuePrincipal: (claims) => principalEnvelopes.issue(claims),
    issueSource(
      payload,
      {
        principalId = "tool-a",
        sourceKind = "tool-observation",
        schemaDigest = TOOL_SCHEMA,
        sourceRef = `rollout://${tenantId}/observations`,
        trustedPayload,
      } = {},
    ) {
      return sourceEnvelopes.issue({
        tenantId,
        principalId,
        sourceKind,
        schemaDigest,
        sourceRef,
        ...(trustedPayload === undefined ? {} : { trustedPayload }),
        payloadDigest: hashed(
          "chainlesschain.evolution-raw-plaintext/v2",
          payload,
        ),
      });
    },
    retain(bundle) {
      const existing = evidenceStates.get(bundle.receipt.evidenceId);
      if (existing) {
        if (
          existing.tenantId !== bundle.receipt.tenantId ||
          existing.rawRecordDigest !== bundle.rawRecord.rawRecordDigest ||
          existing.projectionReceiptDigest !== bundle.receipt.receiptDigest ||
          existing.attestationDigest !== bundle.attestation.attestationDigest
        ) {
          throw new Error("retained evidence identity cannot be replaced");
        }
        // A readback/retry is not permission to resurrect a revoked source.
        return;
      }
      evidenceStates.set(bundle.receipt.evidenceId, {
        tenantId,
        evidenceId: bundle.receipt.evidenceId,
        rawRecordDigest: bundle.rawRecord.rawRecordDigest,
        projectionReceiptDigest: bundle.receipt.receiptDigest,
        attestationDigest: bundle.attestation.attestationDigest,
        revision: 1,
        status: "active",
        tombstoneReceiptDigest: null,
      });
    },
    revoke(evidenceId, status = "revoked") {
      const current = evidenceStates.get(evidenceId);
      if (!current) throw new Error("unknown evidence to revoke");
      evidenceStates.set(evidenceId, {
        ...current,
        status,
        revision: current.revision + 1,
        tombstoneReceiptDigest: hashed("journey-revocation", {
          evidenceId,
          status,
        }),
      });
    },
  };
}

// Test-owned state authority learns only by rereading signed persisted records.
// In particular this never marks arbitrary caller payloads trusted or active.
export async function retainCompositionEvidence(composition, authorities) {
  const tenantId = composition.tenantId;
  const artifactStore = new ArtifactStore({
    dir: composition.storage.artifactDir,
    now: authorities.now,
  });
  const ports = new EvolutionArtifactPorts({
    artifactStore,
    tenantId,
    audience: "evolution-runtime",
    now: authorities.now,
    ...authorities.artifact,
  });
  const verifier = new boundary.EvolutionEvidenceBundleVerifier({
    attestationVerifier: authorities.attestationVerifier,
    now: () => new Date(authorities.now()),
  });
  const refs = [];
  for (const entry of artifactStore.list()) {
    const envelope = entry.lineage?.envelope;
    if (!envelope || JSON.parse(envelope).core.type !== "evidence") continue;
    const manifest = ports.resolve(envelope, {
      tenantId,
      purpose: "evidence-projection",
      expectedType: "evidence",
      expectedDigest: JSON.parse(envelope).core.digest,
    }).value;
    const bundle = { attestation: manifest.attestation };
    for (const field of [
      "rawRecord",
      "modelProjection",
      "trustedProjection",
      "receipt",
    ]) {
      const component = manifest.components[field];
      bundle[field] = ports.resolve(component.envelope, {
        tenantId,
        purpose: "evidence-projection",
        expectedType: component.type,
        expectedDigest: component.digest,
      }).value;
    }
    await verifier.verify(bundle);
    authorities.retain(bundle);
    refs.push(bundle.receipt.evidenceId);
  }
  return refs;
}

export function createJourneyFixture(
  root,
  {
    tenantId = "tenant-journey",
    runId = "run-journey",
    authorities = createJourneyAuthorities(tenantId),
  } = {},
) {
  const audience = "evolution-runtime";
  const artifactStore = new ArtifactStore({
    dir: path.join(root, "artifacts"),
    now: authorities.now,
  });
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore,
    tenantId,
    audience,
    now: authorities.now,
    ...authorities.artifact,
  });
  const ledgerArtifactResolver =
    artifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    });
  fs.mkdirSync(path.join(root, "witness"), { recursive: true });
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "ledger"),
    authorityRootDir: path.join(root, "ledger-authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: `${tenantId}-witness`,
    ledgerAuthority: authorities.ledger,
    witnessAuthority: authorities.witness,
    artifactResolver: ledgerArtifactResolver,
    secure: false,
    clock: authorities.now,
    fsImpl: durableFilesystem(),
  });
  let nextEvidence = 0;
  const projector = new boundary.EvolutionEvidenceProjector({
    sourceVerifier: authorities.sourceVerifier,
    keyedCommitter: authorities.keyedCommitter,
    storagePolicy: authorities.storagePolicy,
    attestationSigner: authorities.attestationSigner,
    attestationVerifier: authorities.attestationVerifier,
    rawStore: new ArtifactStoreEncryptedRawStore({
      tenantId,
      artifactStore: new ArtifactStore({
        dir: path.join(root, "raw"),
        now: authorities.now,
      }),
      encryptor: authorities.rawEncryptor,
    }),
    now: () => new Date(authorities.now()),
    idGenerator: async () => `evidence-${runId}-${++nextEvidence}`,
  });
  const evidenceAdapter = new EvolutionEvidenceArtifactAdapter({
    tenantId,
    audience,
    projector,
    bundleVerifier: new boundary.EvolutionEvidenceBundleVerifier({
      attestationVerifier: authorities.attestationVerifier,
      now: () => new Date(authorities.now()),
    }),
    artifactPorts,
  });
  const evidenceReader = new boundary.EvolutionEvidenceReader({
    attestationVerifier: authorities.attestationVerifier,
    ...authorities.readAuthorities,
    now: () => new Date(authorities.now()),
  });
  const descriptor = {
    tenantId,
    artifactTenantId: tenantId,
    runId,
    audience,
    purpose: "evolution-ledger",
  };
  const runAdapter = new EvolutionRunLedgerAdapter({
    descriptor,
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver,
    now: authorities.now,
  });
  const resolverOptions = {
    runAdapter,
    evidenceAdapter,
    evidenceReader,
    principalEnvelope: authorities.principalEnvelope,
    schemaPolicies,
  };
  const resolver = createEvolutionRunWikiEvidenceResolver(resolverOptions);
  const wikiAdapter = new WikiMaintainerLedgerAdapter({
    descriptor: { ...descriptor, evolutionRunId: runId },
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver,
  });
  let sequence = runAdapter.load().events.length;
  const append = (type, subjectId, input = {}) =>
    runAdapter.appendEvent({
      schema: evolutionRun.EVOLUTION_RUN_EVENT_SCHEMA,
      tenantId,
      runId,
      eventId: `${runId}-event-${++sequence}`,
      sequence,
      type,
      subjectId,
      payloadDigest: digest(`${type}-${sequence}`),
      artifactRef: null,
      keyRef: null,
      data: { occurredAt: NOW },
      ...input,
    });
  if (!sequence) append("run-started", runId);
  return {
    root,
    tenantId,
    runId,
    authorities,
    artifactStore,
    artifactPorts,
    backend,
    runAdapter,
    evidenceAdapter,
    evidenceReader,
    resolver,
    resolverOptions,
    wikiAdapter,
    append,
    async project(payload, source = {}) {
      const result = await evidenceAdapter.projectAndPersist({
        sourceEnvelope: authorities.issueSource(payload, source),
        payload,
      });
      const resolved = await evidenceAdapter.resolve(result);
      authorities.retain(resolved.bundle);
      return { result, ...resolved };
    },
    reference(result) {
      return append("raw-event-referenced", result.evidenceId, {
        payloadDigest: result.manifest.digest,
        artifactRef: result.manifest.ref.ref,
        data: {
          occurredAt: NOW,
          evidenceKind: "tool-observation",
          derivationManifestDigest: result.manifest.digest,
        },
      });
    },
    complete: () => append("run-completed", runId),
    maintainer(derive) {
      return new EvidenceBackedWikiMaintainer({
        descriptor: {
          tenantId,
          evolutionRunId: runId,
          maintainerModel: "deterministic-schema-deriver",
          rulesDigest: digest("journey-wiki-rules"),
        },
        policy: {
          trustedProjectionRead: true,
          rawEvidenceRead: false,
          activeSkillWrite: false,
          shell: false,
          network: false,
          secretRead: false,
        },
        ports: wikiAdapter.maintainerPorts({
          resolveEvidence: resolver.resolveEvidence,
          derive,
        }),
      });
    },
  };
}
