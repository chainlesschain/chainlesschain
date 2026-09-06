import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA } from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_KEYED_COMMITMENT_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
  EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
  EVOLUTION_RAW_STORAGE_POLICY_SCHEMA,
  EVOLUTION_SOURCE_VERIFICATION_SCHEMA,
} from "../../src/lib/evolution/evolution-evidence-projector.js";
import { createAgentEvolutionRuntimeComposition } from "../../src/lib/evolution/agent-evolution-runtime-composition.js";
import { waitForAgentEvolutionSession } from "../../src/lib/evolution/agent-evolution-session-lifecycle.js";
import { startAgentRepl } from "../../src/repl/agent-repl.js";

const NOW = "2026-09-06T04:00:00.000Z";
const TENANT_ID = "tenant-tty-test";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function domainDigest(value, domain) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${canonical(value)}`, "utf8")
    .digest("hex")}`;
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
    signer: {
      sign: ({ message }) => ({ ...trust, value: sign(message) }),
    },
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
  let nextDescriptor = -60_000;
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

function evidenceAuthorities(counters) {
  const commitmentKey = Buffer.alloc(32, 0x71);
  const rawKey = Buffer.alloc(32, 0x72);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
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
        tenantId: TENANT_ID,
        principalId: "principal-tty-user",
        sourceKind: "user-statement",
        trust: "untrusted",
        authenticated: true,
        sourceRef: `rollout://${TENANT_ID}/run-tty/user-prompt`,
        sensitivity: "internal",
        schemaDigest: null,
        compilable: false,
        trustedPayload: null,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: "2026-09-06T04:01:00.000Z",
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
          .update(`${TENANT_ID}\0${purpose}\0${inputDigest}`, "utf8")
          .digest("hex")}`;
      const core = {
        schema: EVOLUTION_KEYED_COMMITMENT_SCHEMA,
        committed: true,
        tenantId: TENANT_ID,
        algorithm: "hmac-sha256",
        keyId: `kms://${TENANT_ID}/commitment-v1`,
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
        decisionExpiresAt: "2026-09-06T04:01:00.000Z",
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
        tenantId: TENANT_ID,
        principalId: request.principalId,
        sourceKind: request.sourceKind,
        sourceCommitment: request.sourceCommitment,
        commitmentReceiptDigest: request.commitmentReceiptDigest,
        sourceVerificationReceiptDigest:
          request.sourceVerificationReceiptDigest,
        sensitivity: request.sensitivity,
        retention: {
          expiresAt: "2027-09-06T04:00:00.000Z",
          deletionClass: "user-delete",
        },
        acl: [request.principalId, "service-evolution"],
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        checkedAt: request.requestedAt,
        decisionExpiresAt: "2026-09-06T04:01:00.000Z",
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
      counters.encryptedRaw += 1;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      return {
        algorithm: "aes-256-gcm",
        keyRef: `kms://${TENANT_ID}/raw-v1`,
        sealedBytes: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      };
    },
  };
  const signedCore = (input) => ({
    schema: EVOLUTION_PROJECTION_ATTESTATION_SCHEMA,
    algorithm: "ed25519",
    keyId: "key-evolution-tty-1",
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
        decisionExpiresAt: "2026-09-06T04:01:00.000Z",
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
    sourceEnvelope: {
      issue: async ({ kind }) => `signed-source:${kind}`,
    },
    sourceVerifier,
    keyedCommitter,
    storagePolicy,
    attestationSigner,
    attestationVerifier,
  };
}

function compositionOptions(root, counters) {
  const artifactSecret = "test-only-artifact-secret";
  const artifactAlgorithm = "hmac-sha256";
  const artifactKeyId = "key://tests/artifact";
  const artifactSign = (message) =>
    crypto
      .createHmac("sha256", artifactSecret)
      .update(message)
      .digest("base64url");
  const artifactPolicyDigest = digest("artifact-policy");
  let evidenceId = 0;
  let ingressId = 0;
  return {
    tenantId: TENANT_ID,
    runId: "run-tty",
    stateRootDir: root,
    witnessId: "agent-tty-witness",
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse(NOW),
    evidenceIdGenerator: async () => `evidence-tty-${++evidenceId}`,
    ingressIdGenerator: () => `ingress-tty-${++ingressId}`,
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
            const core = {
              action: request.action,
              algorithm: artifactAlgorithm,
              allowed: true,
              audience: request.audience,
              checkedAt: NOW,
              decisionExpiresAt: "2026-09-06T04:01:00.000Z",
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
      ...evidenceAuthorities(counters),
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const root = path.resolve(process.argv[2]);
const resultPath = path.resolve(process.argv[3]);
fs.mkdirSync(root, { recursive: true });
process.chdir(root);
const counters = { encryptedRaw: 0 };
const received = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        message: { role: "assistant", content: "TTY_DONE" },
        prompt_eval_count: 10,
        eval_count: 2,
      }),
    );
  });
});

try {
  const address = await listen(server);
  const config = compositionOptions(root, counters);
  const composition = createAgentEvolutionRuntimeComposition(config);
  const handle = await startAgentRepl({
    provider: "ollama",
    model: "tty-test-model",
    baseUrl: `http://127.0.0.1:${address.port}`,
    evolutionIngress: composition.evolutionIngress,
    enabledToolNames: [],
    exactToolNames: true,
    noStream: true,
    expandFileRefs: false,
    projectMemory: false,
    disableSlashCommands: false,
    screenReader: true,
    skipDb: true,
  });
  let emitted = false;
  const emitResult = () => {
    if (emitted) return;
    emitted = true;
    try {
      const loaded = composition.loadRun();
      const reopened = createAgentEvolutionRuntimeComposition(config).loadRun();
      const wire = JSON.stringify(received);
      const result = {
        stdinIsTTY: process.stdin.isTTY === true,
        stdoutIsTTY: process.stdout.isTTY === true,
        status: loaded.projection.status,
        reopenedStatus: reopened.projection.status,
        evidenceKinds: loaded.events
          .map((event) => event.data.evidenceKind)
          .filter(Boolean),
        encryptedRaw: counters.encryptedRaw,
        providerCalls: received.length,
        providerSawRedaction:
          wire.includes("[REDACTED:email]") &&
          !wire.includes("alice@example.com"),
      };
      fs.writeFileSync(resultPath, JSON.stringify(result), "utf8");
      process.stdout.write(`\nCC_TTY_RESULT:${JSON.stringify(result)}\n`);
    } catch (error) {
      const result = {
        error: {
          name: error?.name,
          code: error?.code,
          message: error?.message || String(error),
          stack: error?.stack,
        },
      };
      fs.writeFileSync(resultPath, JSON.stringify(result), "utf8");
      process.stdout.write(`\nCC_TTY_ERROR:${JSON.stringify(result.error)}\n`);
    }
  };
  process.once("exit", emitResult);
  process.stdout.write("\nCC_TTY_READY\n");
  await waitForAgentEvolutionSession(handle, composition.evolutionIngress);
  emitResult();
} catch (error) {
  process.stdout.write(
    `\nCC_TTY_ERROR:${JSON.stringify({
      name: error?.name,
      code: error?.code,
      message: error?.message || String(error),
      stack: error?.stack,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await close(server);
}
