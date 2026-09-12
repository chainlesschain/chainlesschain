/**
 * Test-only signed deployment support for real `cc agent` processes.
 *
 * Production deliberately requires an authenticated deployment to construct an
 * Agent evolution ingress.  Spawned E2E processes cannot use Vitest module
 * mocks, so they receive a descriptor signed with an ephemeral test key and a
 * complete, non-production authority set through the deployment loader.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_KEYED_COMMITMENT_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
  EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
  EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
} from "../../src/lib/evolution/evolution-evidence-projector.js";
import {
  computeEvolutionDeploymentDigest,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function domainDigest(value, domain) {
  return digest(`${domain}\0${canonical(value)}`);
}

function signingAuthority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
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

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
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
          const descriptor = nextDescriptor--;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function evidenceAuthorities(tenantId) {
  const commitmentKey = Buffer.alloc(32, 0x71);
  const rawKey = Buffer.alloc(32, 0x72);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const dated = (requestedAt) =>
    new Date(Date.parse(requestedAt) + 30_000).toISOString();
  const sourceVerifier = {
    async verify(request) {
      if (!request.sourceEnvelope.startsWith("signed-source:")) {
        throw new Error("source envelope denied");
      }
      const core = {
        schema: EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
        verified: true,
        sourceEnvelopeDigest: request.sourceEnvelopeDigest,
        sourceInputDigest: request.sourceInputDigest,
        tenantId,
        principalId: "principal-agent-user",
        sourceKind: "user-statement",
        trust: "untrusted",
        authenticated: true,
        sourceRef: `rollout://${tenantId}/agent/user-prompt`,
        sensitivity: "internal",
        schemaDigest: null,
        compilable: false,
        trustedPayload: null,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: dated(request.requestedAt),
        verifierPolicyDigest: `sha256:${"4".repeat(64)}`,
        verifierPolicyRevision: 1,
        schemaPolicyDigest: `sha256:${"3".repeat(64)}`,
        schemaPolicyRevision: 1,
      };
      return {
        ...core,
        verificationReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-source-verification/v1",
        ),
      };
    },
  };
  const keyedCommitter = {
    async commit(request) {
      const commitment = (purpose, inputDigest) =>
        `hmac-sha256:${crypto
          .createHmac("sha256", commitmentKey)
          .update(`${tenantId}\0${purpose}\0${inputDigest}`, "utf8")
          .digest("hex")}`;
      const core = {
        schema: EVOLUTION_KEYED_COMMITMENT_SCHEMA,
        committed: true,
        tenantId,
        algorithm: "hmac-sha256",
        keyId: `kms://${tenantId}/evolution-commitment-v1`,
        keyVersion: 1,
        sourcePurpose: request.sourcePurpose,
        sourceInputDigest: request.sourceInputDigest,
        sourceCommitment: commitment(
          request.sourcePurpose,
          request.sourceInputDigest,
        ),
        trustedPayloadPurpose: request.trustedPayloadPurpose,
        trustedPayloadInputDigest: request.trustedPayloadInputDigest,
        trustedPayloadCommitment: null,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: dated(request.requestedAt),
        policyDigest: `sha256:${"2".repeat(64)}`,
        policyRevision: 1,
      };
      return {
        ...core,
        commitmentReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-keyed-commitment/v1",
        ),
      };
    },
  };
  const storagePolicy = {
    async resolve(request) {
      const core = {
        schema: EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
        allowed: true,
        tenantId,
        principalId: request.principalId,
        sourceKind: request.sourceKind,
        sourceCommitment: request.sourceCommitment,
        commitmentReceiptDigest: request.commitmentReceiptDigest,
        sourceVerificationReceiptDigest: request.sourceVerificationReceiptDigest,
        sensitivity: request.sensitivity,
        retention: {
          expiresAt: "2030-01-01T00:00:00.000Z",
          deletionClass: "user-delete",
        },
        acl: [request.principalId, "service-evolution"],
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: dated(request.requestedAt),
        policyDigest: `sha256:${"7".repeat(64)}`,
        policyRevision: 1,
      };
      return {
        ...core,
        policyReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-raw-storage-policy/v1",
        ),
      };
    },
  };
  const rawEncryptor = {
    async encrypt({ aad, plaintext }) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        algorithm: "aes-256-gcm",
        keyRef: `kms://${tenantId}/evolution-raw-v1`,
        sealedBytes: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      };
    },
  };
  const signedCore = (input) => ({
    schema: EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
    algorithm: "ed25519",
    keyId: "key-evolution-test-1",
    issuer: "service-evolution-projector",
    trustPolicyDigest: `sha256:${"9".repeat(64)}`,
    receiptDigest: input.receiptDigest,
    tenantId: input.tenantId,
    evidenceId: input.evidenceId,
  });
  const attestationSigner = {
    async sign(input) {
      const core = signedCore(input);
      const attested = {
        ...core,
        signature: crypto
          .sign(null, Buffer.from(canonical(core), "utf8"), privateKey)
          .toString("base64url"),
      };
      return {
        ...attested,
        attestationDigest: domainDigest(
          attested,
          "chainlesschain.evolution-projection-attestation/v1",
        ),
      };
    },
  };
  const attestationVerifier = {
    async verify(value, expected) {
      const core = { ...value };
      delete core.signature;
      delete core.attestationDigest;
      if (
        !crypto.verify(
          null,
          Buffer.from(canonical(core), "utf8"),
          publicKey,
          Buffer.from(value.signature, "base64url"),
        ) ||
        value.attestationDigest !== expected.attestationDigest
      ) {
        throw new Error("projection attestation denied");
      }
      const decision = {
        schema: EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
        verified: true,
        attestationDigest: value.attestationDigest,
        receiptDigest: value.receiptDigest,
        tenantId: value.tenantId,
        evidenceId: value.evidenceId,
        issuer: value.issuer,
        keyId: value.keyId,
        trustPolicyDigest: value.trustPolicyDigest,
        trustPolicyRevision: 1,
        requestNonce: expected.requestNonce,
        requestedAt: expected.requestedAt,
        checkedAt: expected.requestedAt,
        decisionExpiresAt: dated(expected.requestedAt),
      };
      return {
        ...decision,
        verificationReceiptDigest: domainDigest(
          decision,
          "chainlesschain.evolution-attestation-verification/v1",
        ),
      };
    },
  };
  return {
    rawEncryptor,
    sourceEnvelope: { issue: async ({ kind }) => `signed-source:${kind}` },
    sourceVerifier,
    keyedCommitter,
    storagePolicy,
    attestationSigner,
    attestationVerifier,
  };
}

export function createTestAgentEvolutionComposition(
  createComposition,
  { runId },
  stateRootDir,
) {
  // Kept URI-safe because the evidence source reference carries this as a
  // URI host, unlike production tenant identifiers which may be opaque.
  const tenantId = "tenant-e2e-agent";
  const artifactSecret = "test-only-artifact-secret";
  const artifactAlgorithm = "hmac-sha256";
  const artifactKeyId = "key://tests/artifact";
  const artifactPolicyDigest = digest("artifact-policy");
  const artifactSign = (message) =>
    crypto
      .createHmac("sha256", artifactSecret)
      .update(message)
      .digest("base64url");
  const evidence = evidenceAuthorities(tenantId);
  let sequence = 0;
  return createComposition({
    tenantId,
    runId,
    stateRootDir,
    witnessId: "agent-e2e-witness",
    secure: false,
    fsImpl: durableFilesystem(),
    evidenceIdGenerator: async () => `evidence-e2e-${++sequence}`,
    ingressIdGenerator: () => `ingress-e2e-${++sequence}`,
    authorities: {
      artifact: {
        envelopeSigner: {
          sign: ({ message }) => ({
            algorithm: artifactAlgorithm,
            keyId: artifactKeyId,
            value: artifactSign(message),
          }),
        },
        envelopeVerifier: {
          verify: ({ message, signature }) =>
            signature.algorithm === artifactAlgorithm &&
            signature.keyId === artifactKeyId &&
            signature.value === artifactSign(message),
        },
        currentAuthorityResolver: {
          resolve(request) {
            const now = new Date().toISOString();
            const core = {
              action: request.action,
              algorithm: artifactAlgorithm,
              allowed: true,
              audience: request.audience,
              checkedAt: now,
              decisionExpiresAt: new Date(Date.now() + 30_000).toISOString(),
              digest: request.digest,
              issuedAt: request.issuedAt,
              issuedPolicyDigest: request.issuedPolicyDigest,
              issuedPolicyRevision: request.issuedPolicyRevision,
              issuedPolicyTrusted: true,
              keyId: request.keyId || artifactKeyId,
              policyDigest: artifactPolicyDigest,
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
      },
      ledger: signingAuthority("ledger"),
      witness: signingAuthority("witness"),
      ...evidence,
    },
  });
}

/** Create an ephemeral signed deployment and return its two required env vars. */
export function createSignedAgentEvolutionDeployment(root) {
  // ArtifactStore rejects symlinked path components so its evidence paths are
  // physically auditable.  macOS commonly exposes its temp directory through
  // /var (a symlink to /private/var), therefore resolve the test home once
  // before emitting any deployment path.
  const physicalRoot = (fs.realpathSync.native || fs.realpathSync)(
    path.resolve(root),
  );
  const stateRoot = path.join(physicalRoot, "agent-evolution-state");
  const source = `
import { randomUUID } from "node:crypto";
import { join } from "node:path";
const processStateRoot = join(${JSON.stringify(stateRoot)}, randomUUID());
export async function createChainlessChainCommandDependencies({ commandName, factories }) {
  if (commandName !== "agent") return {};
  const { createTestAgentEvolutionComposition } = await import(${JSON.stringify(import.meta.url)});
  return {
    evolutionCompositionFactory: async (context) =>
      createTestAgentEvolutionComposition(
        factories.createAgentEvolutionRuntimeComposition,
        context,
        processStateRoot,
      ),
  };
}
`;
  const modulePath = path.join(
    physicalRoot,
    "agent-evolution-test-deployment.mjs",
  );
  fs.writeFileSync(modulePath, source, { flag: "wx" });
  const moduleDigest = computeEvolutionDeploymentDigest(Buffer.from(source));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const trustRoot = publicKey.export({ type: "spki", format: "pem" });
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest,
    trustRootDigest: computeEvolutionDeploymentDigest(trustRoot),
    commands: ["agent"],
  };
  descriptor.signature = crypto
    .sign(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
      privateKey,
    )
    .toString("base64");
  const descriptorPath = path.join(
    physicalRoot,
    "agent-evolution-descriptor.json",
  );
  const trustRootPath = path.join(physicalRoot, "agent-evolution-public.pem");
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), { flag: "wx" });
  fs.writeFileSync(trustRootPath, trustRoot, { flag: "wx" });
  return Object.freeze({
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
  });
}
