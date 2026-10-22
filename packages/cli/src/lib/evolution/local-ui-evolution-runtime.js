import {
  createCipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import fs from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfigDataRoot } from "../paths.js";
import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA } from "./evolution-artifact-ports.js";
import {
  EVOLUTION_KEYED_COMMITMENT_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
  EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
  EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
} from "./evolution-evidence-projector.js";
import { createAgentEvolutionRuntimeComposition } from "./agent-evolution-runtime-composition.js";
import { loadLocalUiEvolutionDeployment } from "./local-ui-evolution-deployment.js";
import { createLocalUiEvolutionFileSystem } from "./evolution-windows-directory-durability.js";
import {
  formatLocalUiTenantReferenceId,
  encodeOpaqueHexId,
} from "./opaque-hex-id.js";

const SOURCE_ENVELOPE_SCHEMA = "chainlesschain.local-ui-source-envelope/v1";
const TRUST_POLICY_REVISION = 1;
const DECISION_TTL_MS = 30_000;

function localUiStateStorageRoot(root) {
  const absoluteRoot = resolve(root);
  if (
    process.platform !== "darwin" ||
    (absoluteRoot !== "/var" && !absoluteRoot.startsWith("/var/"))
  ) {
    return absoluteRoot;
  }

  // macOS exposes the temporary tree through the root-owned /var alias.
  // Translate only that exact system prefix; leave the user-controlled suffix
  // intact so ArtifactStore can still reject links below the deployment root.
  const alias = fs.lstatSync("/var");
  const canonical = fs.realpathSync("/var");
  const target = fs.lstatSync(canonical);
  if (
    !alias.isSymbolicLink() ||
    Number(alias.uid) !== 0 ||
    canonical !== "/private/var" ||
    target.isSymbolicLink() ||
    !target.isDirectory() ||
    Number(target.uid) !== 0 ||
    (Number(target.mode) & 0o022) !== 0
  ) {
    throw new Error("Local Evolution host has an unsafe macOS /var alias");
  }

  return absoluteRoot === "/var"
    ? canonical
    : join(canonical, absoluteRoot.slice("/var/".length));
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`, "utf8")
    .digest("hex")}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sourceRefSegment(value, purpose) {
  return encodeOpaqueHexId(
    createHash("sha256")
      .update(
        `chainlesschain.local-ui-source-ref/v1\0${purpose}\0${value}`,
        "utf8",
      )
      .digest("hex"),
  );
}

function dateAfter(iso, durationMs = DECISION_TTL_MS) {
  return new Date(Date.parse(iso) + durationMs).toISOString();
}

function encodedMessage(message) {
  if (typeof message === "string") return Buffer.from(message, "utf8");
  if (Buffer.isBuffer(message)) return message;
  return Buffer.from(canonical(message), "utf8");
}

function ed25519Authority(label, tenantId, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  const trust = Object.freeze({
    algorithm: "ed25519",
    keyId: `local://${tenantId}/${label}`,
    trustPolicyDigest: sha256(`chainlesschain.local-ui.${label}.policy/v1`),
  });
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign({ message }) {
        return {
          ...trust,
          value: sign(null, encodedMessage(message), privateKey).toString(
            "base64url",
          ),
        };
      },
    }),
    verifier: Object.freeze({
      verify({ message, signature }) {
        return (
          signature?.algorithm === trust.algorithm &&
          signature?.keyId === trust.keyId &&
          signature?.trustPolicyDigest === trust.trustPolicyDigest &&
          verify(
            null,
            encodedMessage(message),
            publicKey,
            Buffer.from(signature.value || "", "base64url"),
          )
        );
      },
    }),
  });
}

function ed25519ArtifactAuthority(tenantId, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  const trust = Object.freeze({
    algorithm: "ed25519",
    keyId: `local://${tenantId}/artifact`,
    trustPolicyDigest: sha256("chainlesschain.local-ui.artifact.policy/v1"),
  });
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign({ message }) {
        return {
          algorithm: trust.algorithm,
          keyId: trust.keyId,
          value: sign(null, encodedMessage(message), privateKey).toString(
            "base64url",
          ),
        };
      },
    }),
    verifier: Object.freeze({
      verify({ message, signature }) {
        return (
          signature?.algorithm === trust.algorithm &&
          signature?.keyId === trust.keyId &&
          verify(
            null,
            encodedMessage(message),
            publicKey,
            Buffer.from(signature.value || "", "base64url"),
          )
        );
      },
    }),
  });
}

export function createLocalUiEvolutionAuthorities(identity, runId) {
  const { tenantId, keys } = identity;
  const commitmentKey = keys.commitment;
  const rawKey = keys["raw-encryption"];
  const sourcePrivateKey = createPrivateKey(keys.source.privateKey);
  const sourcePublicKey = createPublicKey(sourcePrivateKey);
  const attestationPrivateKey = createPrivateKey(keys.attestation.privateKey);
  const attestationPublicKey = createPublicKey(attestationPrivateKey);
  const attestationTrust = Object.freeze({
    algorithm: "ed25519",
    keyId: `local-ui-${tenantId}-attestation`,
    trustPolicyDigest: sha256("chainlesschain.local-ui.attestation.policy/v1"),
  });
  const artifactAuthority = ed25519ArtifactAuthority(
    tenantId,
    keys.artifact.privateKey,
  );

  const sourceEnvelope = Object.freeze({
    issue(request) {
      if (
        request?.tenantId !== tenantId ||
        request.runId !== runId ||
        typeof request.eventId !== "string" ||
        !request.kind
      ) {
        throw new Error("Local UI source envelope request is not authorized");
      }
      const body = {
        schema: SOURCE_ENVELOPE_SCHEMA,
        tenantId,
        runId: request.runId,
        eventId: request.eventId,
        kind: request.kind,
        occurredAt: request.occurredAt,
        evidenceDigest: domainDigest(
          request.evidence,
          "chainlesschain.evolution-raw-plaintext/v2",
        ),
      };
      const payload = Buffer.from(canonical(body), "utf8").toString(
        "base64url",
      );
      const signature = sign(
        null,
        Buffer.from(payload, "utf8"),
        sourcePrivateKey,
      ).toString("base64url");
      return `cc-local-source:v1:${payload}.${signature}`;
    },
  });

  const sourceVerifier = Object.freeze({
    async verify(request) {
      const match =
        typeof request?.sourceEnvelope === "string"
          ? /^cc-local-source:v1:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(
              request.sourceEnvelope,
            )
          : null;
      if (!match) throw new Error("Local UI source envelope is malformed");
      const [encodedPayload, encodedSignature] = match.slice(1);
      if (
        !verify(
          null,
          Buffer.from(encodedPayload, "utf8"),
          sourcePublicKey,
          Buffer.from(encodedSignature, "base64url"),
        )
      ) {
        throw new Error("Local UI source envelope signature rejected");
      }
      const body = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      );
      const expectedInputDigest = domainDigest(
        request.payload,
        "chainlesschain.evolution-raw-plaintext/v2",
      );
      if (
        body.schema !== SOURCE_ENVELOPE_SCHEMA ||
        body.tenantId !== tenantId ||
        body.runId !== runId ||
        body.evidenceDigest !== expectedInputDigest ||
        expectedInputDigest !== request.sourceInputDigest
      ) {
        throw new Error(
          "Local UI source envelope is not bound to this evidence",
        );
      }
      const sourceKind =
        body.kind === "response-completed"
          ? "model-inference"
          : "user-statement";
      const requestedAt = request.requestedAt;
      const core = {
        schema: EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
        verified: true,
        sourceEnvelopeDigest: request.sourceEnvelopeDigest,
        sourceInputDigest: request.sourceInputDigest,
        tenantId,
        principalId: "local-ui-user",
        sourceKind,
        trust: "untrusted",
        authenticated: true,
        sourceRef: `rollout://${formatLocalUiTenantReferenceId(tenantId)}/quick-ask/${sourceRefSegment(body.runId, "run")}/${sourceRefSegment(body.eventId, "event")}`,
        sensitivity: "internal",
        schemaDigest: null,
        compilable: false,
        trustedPayload: null,
        requestNonce: request.requestNonce,
        requestedAt,
        checkedAt: requestedAt,
        decisionExpiresAt: dateAfter(requestedAt),
        verifierPolicyDigest: sha256(
          "chainlesschain.local-ui.source-verifier.policy/v1",
        ),
        verifierPolicyRevision: TRUST_POLICY_REVISION,
        schemaPolicyDigest: sha256(
          "chainlesschain.local-ui.source-schema.policy/v1",
        ),
        schemaPolicyRevision: TRUST_POLICY_REVISION,
      };
      return {
        ...core,
        verificationReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-source-verification/v1",
        ),
      };
    },
  });

  const keyedCommitter = Object.freeze({
    async commit(request) {
      const commitment = (purpose, inputDigest) =>
        `hmac-sha256:${createHmac("sha256", commitmentKey)
          .update(`${tenantId}\0${purpose}\0${inputDigest}`, "utf8")
          .digest("hex")}`;
      const core = {
        schema: EVOLUTION_KEYED_COMMITMENT_SCHEMA,
        committed: true,
        tenantId,
        algorithm: "hmac-sha256",
        keyId: `kms://${tenantId}/local-ui-commitment-v1`,
        keyVersion: 1,
        sourcePurpose: request.sourcePurpose,
        sourceInputDigest: request.sourceInputDigest,
        sourceCommitment: commitment(
          request.sourcePurpose,
          request.sourceInputDigest,
        ),
        trustedPayloadPurpose: request.trustedPayloadPurpose,
        trustedPayloadInputDigest: request.trustedPayloadInputDigest,
        trustedPayloadCommitment:
          request.trustedPayloadInputDigest === null
            ? null
            : commitment(
                request.trustedPayloadPurpose,
                request.trustedPayloadInputDigest,
              ),
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: dateAfter(request.requestedAt),
        policyDigest: sha256("chainlesschain.local-ui.commitment.policy/v1"),
        policyRevision: TRUST_POLICY_REVISION,
      };
      return {
        ...core,
        commitmentReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-keyed-commitment/v1",
        ),
      };
    },
  });

  const storagePolicy = Object.freeze({
    async resolve(request) {
      const allowed =
        request.tenantId === tenantId &&
        request.principalId === "local-ui-user" &&
        ["user-statement", "model-inference"].includes(request.sourceKind) &&
        request.sensitivity !== "restricted";
      if (!allowed) throw new Error("Local UI evidence storage policy denied");
      const core = {
        schema: EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
        allowed: true,
        tenantId,
        principalId: request.principalId,
        sourceKind: request.sourceKind,
        sourceCommitment: request.sourceCommitment,
        commitmentReceiptDigest: request.commitmentReceiptDigest,
        sourceVerificationReceiptDigest:
          request.sourceVerificationReceiptDigest,
        sensitivity: request.sensitivity,
        retention: {
          expiresAt: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          deletionClass: "user-delete",
        },
        acl: [request.principalId, "service-evolution"],
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: dateAfter(request.requestedAt),
        policyDigest: sha256("chainlesschain.local-ui.storage.policy/v1"),
        policyRevision: TRUST_POLICY_REVISION,
      };
      return {
        ...core,
        policyReceiptDigest: domainDigest(
          core,
          "chainlesschain.evolution-raw-storage-policy/v1",
        ),
      };
    },
  });

  const rawEncryptor = Object.freeze({
    async encrypt({ aad, plaintext }) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", rawKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return {
        algorithm: "aes-256-gcm",
        keyRef: `kms://${tenantId}/local-ui-raw-v1`,
        sealedBytes: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      };
    },
  });

  const signedAttestationCore = (input) => ({
    schema: EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
    algorithm: attestationTrust.algorithm,
    keyId: attestationTrust.keyId,
    issuer: `local-ui-${tenantId}-evolution-projector`,
    trustPolicyDigest: attestationTrust.trustPolicyDigest,
    receiptDigest: input.receiptDigest,
    tenantId: input.tenantId,
    evidenceId: input.evidenceId,
  });
  const attestationSigner = Object.freeze({
    async sign(input) {
      const core = signedAttestationCore(input);
      const attested = {
        ...core,
        signature: sign(
          null,
          Buffer.from(canonical(core), "utf8"),
          attestationPrivateKey,
        ).toString("base64url"),
      };
      return {
        ...attested,
        attestationDigest: domainDigest(
          attested,
          "chainlesschain.evolution-projection-attestation/v1",
        ),
      };
    },
  });
  const attestationVerifier = Object.freeze({
    async verify(value, expected) {
      const core = { ...value };
      delete core.signature;
      delete core.attestationDigest;
      if (
        !verify(
          null,
          Buffer.from(canonical(core), "utf8"),
          attestationPublicKey,
          Buffer.from(value.signature || "", "base64url"),
        ) ||
        value.attestationDigest !== expected.attestationDigest
      ) {
        throw new Error("Local UI projection attestation rejected");
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
        trustPolicyRevision: TRUST_POLICY_REVISION,
        requestNonce: expected.requestNonce,
        requestedAt: expected.requestedAt,
        checkedAt: expected.requestedAt,
        decisionExpiresAt: dateAfter(expected.requestedAt),
      };
      return {
        ...decision,
        verificationReceiptDigest: domainDigest(
          decision,
          "chainlesschain.evolution-attestation-verification/v1",
        ),
      };
    },
  });

  return Object.freeze({
    tenantId,
    authorities: Object.freeze({
      artifact: Object.freeze({
        envelopeSigner: artifactAuthority.signer,
        envelopeVerifier: artifactAuthority.verifier,
        currentAuthorityResolver: Object.freeze({
          resolve(request) {
            const now = request.requestedAt;
            const core = {
              action: request.action,
              algorithm: artifactAuthority.trust.algorithm,
              allowed: true,
              audience: request.audience,
              checkedAt: now,
              decisionExpiresAt: dateAfter(now),
              digest: request.digest,
              issuedAt: request.issuedAt,
              issuedPolicyDigest: request.issuedPolicyDigest,
              issuedPolicyRevision: request.issuedPolicyRevision,
              issuedPolicyTrusted: true,
              keyId: request.keyId || artifactAuthority.trust.keyId,
              policyDigest: artifactAuthority.trust.trustPolicyDigest,
              policyRevision: TRUST_POLICY_REVISION,
              purpose: request.purpose,
              requestedAt: now,
              retention: request.retention,
              revocationRevision: TRUST_POLICY_REVISION,
              revoked: false,
              schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
              tenantId: request.tenantId,
              type: request.type,
            };
            return {
              ...core,
              receiptDigest: domainDigest(
                core,
                "chainlesschain.evolution-artifact-authority-decision/v1",
              ),
            };
          },
        }),
      }),
      ledger: ed25519Authority("ledger", tenantId, keys.ledger.privateKey),
      witness: ed25519Authority("witness", tenantId, keys.witness.privateKey),
      rawEncryptor,
      sourceEnvelope,
      sourceVerifier,
      keyedCommitter,
      storagePolicy,
      attestationSigner,
      attestationVerifier,
    }),
  });
}

export async function createLocalUiEvolutionComposition({
  context,
  commandName = "ui",
  handlerArtifactDigest,
  localDirectory,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  if (
    !(
      {
        ui: [
          "ws-llm-chat",
          "ws-stream",
          "ws-chat-session",
          "legacy-websocket",
          "intent-understand",
          "intent-understand-stream",
          "intent-classify",
        ],
        agent: ["interactive", "headless", "headless-stream"],
        ask: ["ask"],
        chat: ["chat", "chat-agent"],
      }[commandName] || []
    ).includes(context?.mode) ||
    typeof context.runId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(context.runId)
  ) {
    throw new Error(
      "Local Evolution host does not admit this command mode or Run",
    );
  }
  const root =
    localDirectory ||
    join(resolveConfigDataRoot().path, "evolution", "local-ui-host");
  const deployment = await loadLocalUiEvolutionDeployment(root, { env, cwd });
  if (!deployment.descriptor.commands.includes(commandName))
    throw new Error("Local Evolution deployment does not admit this command");
  if (deployment.moduleDigest !== handlerArtifactDigest) {
    throw new Error(
      "Local Evolution handler digest does not match its signed deployment",
    );
  }
  const identity = createLocalUiEvolutionAuthorities(deployment, context.runId);
  const ledger = ed25519Authority(
    "ledger",
    deployment.tenantId,
    deployment.keys.ledger.privateKey,
  );
  const witness = ed25519Authority(
    "witness",
    deployment.tenantId,
    deployment.keys.witness.privateKey,
  );
  const fsImpl = createLocalUiEvolutionFileSystem();
  const stateRootDir = join(localUiStateStorageRoot(root), "state");
  return createAgentEvolutionRuntimeComposition({
    tenantId: identity.tenantId,
    runId: context.runId,
    audience:
      commandName === "ui" ? "local-ui-quick-ask" : `local-${commandName}`,
    stateRootDir,
    witnessId: `local-ui-witness-${identity.tenantId}`,
    authorities: {
      ...identity.authorities,
      ledger,
      witness,
    },
    evidenceIdGenerator: async () =>
      `evidence-${encodeOpaqueHexId(randomUUID().replaceAll("-", ""))}`,
    ingressIdGenerator: () =>
      `ingress-${encodeOpaqueHexId(randomUUID().replaceAll("-", ""))}`,
    secure: true,
    fsImpl,
  });
}
