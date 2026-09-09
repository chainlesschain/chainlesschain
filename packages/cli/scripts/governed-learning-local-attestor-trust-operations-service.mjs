#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { ArtifactStore } from "../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../src/lib/evolution/evolution-ledger-file-backend.js";
import { createGovernedSkillSynthesisAttestorTrustLedger } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-ledger.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorRegistry } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-operator-registry.js";
import { createGovernedSkillSynthesisAttestorTrustOperations } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";

const IPC_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations-ipc/v1";
const SERVICE_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations-service/v4";
const WINDOWS_PIPE =
  /^\\\\\.\\pipe\\cc-evolution-attestor-trust-ops-[a-f0-9]{16,64}$/u;
const SOCKET_NAME = /^cc-evolution-attestor-trust-ops-[a-f0-9]{16,64}\.sock$/u;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_REQUESTS = 64;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function signingAuthority(namespace, label, secret) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://${namespace}/${label}`,
    trustPolicyDigest: sha256(`${label}-policy`),
  });
  const value = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: value(message) }) },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === value(message),
    },
  };
}

function durableFilesystem() {
  if (process.platform !== "win32") return fs;
  const directories = new Set();
  let nextDescriptor = -80_000;
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

function response(socket, value) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

let bootstrapLine = "";
for await (const chunk of process.stdin) {
  bootstrapLine += chunk.toString("utf8");
  if (Buffer.byteLength(bootstrapLine, "utf8") > MAX_FRAME_BYTES) {
    throw new Error("attestor trust operations bootstrap is too large");
  }
  if (bootstrapLine.includes("\n")) break;
}
const bootstrapEnd = bootstrapLine.indexOf("\n");
if (
  bootstrapEnd === -1 ||
  bootstrapLine.slice(bootstrapEnd + 1).trim().length > 0
) {
  throw new Error("attestor trust operations bootstrap is invalid");
}
const bootstrap = JSON.parse(
  bootstrapLine.slice(0, bootstrapEnd).replace(/\r$/u, ""),
);
if (
  !exact(bootstrap, [
    "artifactRoot",
    "authorityNamespace",
    "authorizationStreamId",
    "capabilityToken",
    "endpoint",
    "ledgerAuthorityRoot",
    "ledgerRoot",
    "operatorIdentities",
    "operatorRegistryStreamId",
    "policyId",
    "requiredApprovals",
    "revision",
    "secrets",
    "trustDescriptor",
    "witnessFile",
    "witnessId",
  ]) ||
  typeof bootstrap.endpoint !== "string" ||
  (process.platform === "win32"
    ? !WINDOWS_PIPE.test(bootstrap.endpoint)
    : !path.isAbsolute(bootstrap.endpoint) ||
      !SOCKET_NAME.test(path.basename(bootstrap.endpoint))) ||
  typeof bootstrap.capabilityToken !== "string" ||
  bootstrap.capabilityToken.length < 32 ||
  bootstrap.capabilityToken.length > 4096 ||
  typeof bootstrap.authorityNamespace !== "string" ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(bootstrap.authorityNamespace) ||
  typeof bootstrap.witnessId !== "string" ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(bootstrap.witnessId) ||
  !exact(bootstrap.secrets, ["artifact", "ledger", "witness"]) ||
  Object.values(bootstrap.secrets).some(
    (value) => typeof value !== "string" || value.length < 32,
  ) ||
  !exact(bootstrap.trustDescriptor, [
    "artifactTenantId",
    "audience",
    "purpose",
    "streamId",
    "tenantId",
  ]) ||
  !Array.isArray(bootstrap.operatorIdentities) ||
  bootstrap.operatorIdentities.length < 1 ||
  bootstrap.operatorIdentities.length > 16
) {
  throw new Error("attestor trust operations bootstrap schema is invalid");
}
if (
  typeof bootstrap.operatorRegistryStreamId !== "string" ||
  !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(
    bootstrap.operatorRegistryStreamId,
  )
) {
  throw new Error("attestor trust operator registry stream is invalid");
}
for (const target of [
  bootstrap.artifactRoot,
  bootstrap.ledgerAuthorityRoot,
  bootstrap.ledgerRoot,
  bootstrap.witnessFile,
]) {
  if (typeof target !== "string" || !path.isAbsolute(target)) {
    throw new Error("attestor trust operations storage path is invalid");
  }
}
const operatorIdentities = bootstrap.operatorIdentities.map((identity) => {
  if (
    !exact(identity, ["operatorId", "publicKeyPem", "tenantId"]) ||
    typeof identity.publicKeyPem !== "string" ||
    /PRIVATE KEY/u.test(identity.publicKeyPem)
  ) {
    throw new Error("attestor trust operator identity is invalid");
  }
  return {
    tenantId: identity.tenantId,
    operatorId: identity.operatorId,
    publicKey: identity.publicKeyPem,
  };
});

fs.mkdirSync(path.dirname(bootstrap.witnessFile), { recursive: true });
const artifactAlgorithm = "hmac-sha256";
const artifactKeyId = `key://${bootstrap.authorityNamespace}/artifact`;
const artifactPolicyDigest = sha256("artifact-policy");
const artifactMac = (message) =>
  createHmac("sha256", bootstrap.secrets.artifact)
    .update(message)
    .digest("base64url");
const artifactPorts = new EvolutionArtifactPorts({
  artifactStore: new ArtifactStore({ dir: bootstrap.artifactRoot }),
  tenantId: bootstrap.trustDescriptor.artifactTenantId,
  audience: bootstrap.trustDescriptor.audience,
  envelopeSigner: {
    sign: ({ message }) => ({
      algorithm: artifactAlgorithm,
      keyId: artifactKeyId,
      value: artifactMac(message),
    }),
  },
  envelopeVerifier: {
    verify: ({ message, signature }) =>
      signature.algorithm === artifactAlgorithm &&
      signature.keyId === artifactKeyId &&
      signature.value === artifactMac(message),
  },
  currentAuthorityResolver: {
    resolve: (request) => {
      const checkedAt = new Date().toISOString();
      const core = {
        action: request.action,
        algorithm: artifactAlgorithm,
        allowed: true,
        audience: request.audience,
        checkedAt,
        decisionExpiresAt: new Date(
          Date.parse(checkedAt) + 30_000,
        ).toISOString(),
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
        receiptDigest: sha256(
          `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
        ),
      };
    },
  },
});
const ledgerArtifactResolver =
  artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: bootstrap.trustDescriptor.purpose,
  });
const backend = createEvolutionLedgerFileBackend({
  rootDir: bootstrap.ledgerRoot,
  authorityRootDir: bootstrap.ledgerAuthorityRoot,
  witnessFilePath: bootstrap.witnessFile,
  witnessId: bootstrap.witnessId,
  ledgerAuthority: signingAuthority(
    bootstrap.authorityNamespace,
    "ledger",
    bootstrap.secrets.ledger,
  ),
  witnessAuthority: signingAuthority(
    bootstrap.authorityNamespace,
    "witness",
    bootstrap.secrets.witness,
  ),
  artifactResolver: ledgerArtifactResolver,
  fsImpl: durableFilesystem(),
  secure: false,
});
const trustLedger = createGovernedSkillSynthesisAttestorTrustLedger({
  descriptor: bootstrap.trustDescriptor,
  artifactPorts,
  ledger: backend.ledger,
  ledgerArtifactResolver,
});
const operatorRegistry =
  createGovernedSkillSynthesisAttestorTrustOperatorRegistry({
    descriptor: {
      ...bootstrap.trustDescriptor,
      streamId: bootstrap.operatorRegistryStreamId,
    },
    artifactPorts,
    ledger: backend.ledger,
    ledgerArtifactResolver,
  });
const operatorRegistrySnapshot = await operatorRegistry.initialize({
  operatorIdentities,
  policyId: bootstrap.policyId,
  revision: bootstrap.revision,
  requiredApprovals: bootstrap.requiredApprovals,
});
const operations = createGovernedSkillSynthesisAttestorTrustOperations({
  tenantId: bootstrap.trustDescriptor.tenantId,
  authorizationStreamId: bootstrap.authorizationStreamId,
  policyId: bootstrap.policyId,
  revision: bootstrap.revision,
  requiredApprovals: bootstrap.requiredApprovals,
  operatorIdentities: operatorRegistrySnapshot.operatorIdentities,
  trustLedger,
  artifactPorts,
  ledger: backend.ledger,
  ledgerArtifactResolver,
});
if (
  operations.descriptor.policyDigest !== operatorRegistrySnapshot.policyDigest
) {
  throw new Error(
    "attestor trust operations policy differs from operator registry",
  );
}
const serviceDescriptor = Object.freeze({
  schema: SERVICE_SCHEMA,
  tenantId: operations.descriptor.tenantId,
  authorizationStreamId: operations.descriptor.authorizationStreamId,
  policyId: operations.descriptor.policyId,
  revision: operations.descriptor.revision,
  requiredApprovals: operations.descriptor.requiredApprovals,
  operatorCount: operations.descriptor.operators.length,
  operators: operations.descriptor.operators.map((operator) => ({
    operatorId: operator.operatorId,
    keyId: operator.keyId,
  })),
  approvalMode: operations.descriptor.approvalMode,
  policyDigest: operations.descriptor.policyDigest,
  operatorRegistryStreamId: operatorRegistry.descriptor.streamId,
  operatorRegistryRecordDigest: operatorRegistrySnapshot.recordDigest,
  operatorRegistryRecovered: operatorRegistrySnapshot.recovered,
});

if (process.platform !== "win32" && fs.existsSync(bootstrap.endpoint)) {
  throw new Error("attestor trust operations endpoint already exists");
}

let requestCount = 0;
let queue = Promise.resolve();
let rebindRequired = false;
const server = net.createServer((socket) => {
  let carry = "";
  let handled = false;
  socket.setTimeout(30_000, () => socket.destroy());
  socket.on("data", (chunk) => {
    if (handled) return;
    carry += chunk.toString("utf8");
    if (Buffer.byteLength(carry, "utf8") > MAX_FRAME_BYTES) {
      handled = true;
      response(socket, {
        ok: false,
        requestId: null,
        code: "request_too_large",
      });
      return;
    }
    const frameEnd = carry.indexOf("\n");
    if (frameEnd === -1) return;
    handled = true;
    let request;
    try {
      request = JSON.parse(carry.slice(0, frameEnd).replace(/\r$/u, ""));
    } catch {
      response(socket, { ok: false, requestId: null, code: "invalid_json" });
      return;
    }
    if (
      !exact(request, [
        "action",
        "capabilityToken",
        "payload",
        "requestId",
        "schema",
      ]) ||
      request.schema !== IPC_SCHEMA ||
      carry.slice(frameEnd + 1).trim().length > 0 ||
      !/^[a-f0-9]{32}$/u.test(request.requestId ?? "") ||
      !safeEqual(request.capabilityToken, bootstrap.capabilityToken) ||
      !["prepare", "execute", "operator-prepare", "operator-execute"].includes(
        request.action,
      ) ||
      requestCount >= MAX_REQUESTS
    ) {
      response(socket, {
        ok: false,
        requestId: request?.requestId ?? null,
        code: "request_denied",
      });
      return;
    }
    if (rebindRequired && request.action !== "operator-execute") {
      response(socket, {
        ok: false,
        requestId: request.requestId,
        code: "service_rebind_required",
      });
      return;
    }
    requestCount += 1;
    queue = queue
      .then(async () => {
        if (rebindRequired && request.action !== "operator-execute") {
          response(socket, {
            ok: false,
            requestId: request.requestId,
            code: "service_rebind_required",
          });
          return;
        }
        let result;
        if (request.action === "prepare") {
          result = operations.prepare(request.payload);
        } else if (request.action === "execute") {
          result = await operations.execute(request.payload);
        } else if (request.action === "operator-prepare") {
          result = await operatorRegistry.prepareChange(request.payload);
        } else {
          result = await operatorRegistry.executeChange(request.payload);
          rebindRequired = true;
        }
        response(socket, { ok: true, requestId: request.requestId, result });
      })
      .catch(() => {
        response(socket, {
          ok: false,
          requestId: request.requestId,
          code: "operation_rejected",
        });
      });
  });
  socket.on("error", () => {});
});

const close = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
server.listen(bootstrap.endpoint, () => {
  if (process.platform !== "win32") fs.chmodSync(bootstrap.endpoint, 0o600);
  process.stdout.write(
    `${JSON.stringify({ ok: true, descriptor: serviceDescriptor })}\n`,
  );
});
