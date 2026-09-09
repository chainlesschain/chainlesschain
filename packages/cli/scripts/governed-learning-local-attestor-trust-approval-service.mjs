#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import fs from "node:fs";
import net from "node:net";

import { isGovernedSkillSynthesisAttestorIpcEndpoint } from "../src/lib/evolution/governed-skill-synthesis-attestor-ipc-endpoint.js";
import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA,
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA,
} from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-approval-client.js";
import {
  createGovernedSkillSynthesisAttestorTrustIpcCapability,
  verifyGovernedSkillSynthesisAttestorTrustIpcAuthorization,
} from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-ipc-capability.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-operations.js";
import { createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer } from "../src/lib/evolution/governed-skill-synthesis-attestor-trust-operator-registry.js";
import { createGovernedSkillSynthesisWindowsSecurePipeHost } from "../src/lib/evolution/governed-skill-synthesis-windows-secure-pipe-host.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_BOOTSTRAP_BYTES = 128 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_REQUESTS = 256;
const CAPABILITY_SERVICE = "attestor-trust-approval";
const BOOTSTRAP_KEYS = new Set([
  "capabilityExpiresAt",
  "capabilityIssuedAt",
  "capabilityMaxUses",
  "capabilityToken",
  "endpoint",
  "operatorId",
  "policyDigest",
  "policyId",
  "privateKeyPem",
  "revision",
  "signerId",
  "tenantId",
]);

function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.size &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && keys.has(key),
    )
  );
}

function validText(value, maximum = 4096) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes("\0")
  );
}

function validPrivateKey(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32 * 1024 &&
    !value.includes("\0") &&
    /PRIVATE KEY/u.test(value)
  );
}

async function readBootstrap() {
  process.stdin.setEncoding("utf8");
  let body = "";
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > MAX_BOOTSTRAP_BYTES) {
      throw new Error("approval service bootstrap is too large");
    }
  }
  const newline = body.indexOf("\n");
  if (newline < 1 || body.slice(newline + 1).trim().length > 0) {
    throw new Error("approval service bootstrap must be one JSON record");
  }
  return JSON.parse(body.slice(0, newline).replace(/\r$/u, ""));
}

function response(socket, value) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

const bootstrap = await readBootstrap();
if (
  !exact(bootstrap, BOOTSTRAP_KEYS) ||
  !ID.test(bootstrap.tenantId ?? "") ||
  !ID.test(bootstrap.operatorId ?? "") ||
  !ID.test(bootstrap.policyId ?? "") ||
  !ID.test(bootstrap.signerId ?? "") ||
  !DIGEST.test(bootstrap.policyDigest ?? "") ||
  !Number.isSafeInteger(bootstrap.revision) ||
  bootstrap.revision < 1 ||
  !validText(bootstrap.capabilityToken) ||
  bootstrap.capabilityToken.length < 32 ||
  !validPrivateKey(bootstrap.privateKeyPem) ||
  !validText(bootstrap.endpoint, 1024) ||
  !isGovernedSkillSynthesisAttestorIpcEndpoint(bootstrap.endpoint, {
    kind: "trust-approval",
  })
) {
  throw new Error("approval service bootstrap is invalid");
}
const capability = createGovernedSkillSynthesisAttestorTrustIpcCapability({
  token: bootstrap.capabilityToken,
  service: CAPABILITY_SERVICE,
  issuedAt: bootstrap.capabilityIssuedAt,
  expiresAt: bootstrap.capabilityExpiresAt,
  maxUses: bootstrap.capabilityMaxUses,
  maxUsesLimit: MAX_REQUESTS,
});

let privateKey;
try {
  privateKey = createPrivateKey(bootstrap.privateKeyPem);
} catch {
  throw new Error("approval service private key is invalid");
}
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("approval service private key must be Ed25519");
}
const publicKeyBytes = createPublicKey(privateKey).export({
  type: "spki",
  format: "der",
});
const keyId = `key:ed25519:${createHash("sha256")
  .update(publicKeyBytes)
  .digest("hex")}`;
const trustIssuer =
  createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
    tenantId: bootstrap.tenantId,
    operatorId: bootstrap.operatorId,
    privateKey,
  });
const registryIssuer =
  createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
    tenantId: bootstrap.tenantId,
    operatorId: bootstrap.operatorId,
    privateKey,
  });
if (trustIssuer.keyId !== keyId || registryIssuer.keyId !== keyId) {
  throw new Error("approval service issuer key binding failed");
}
const descriptorCore = Object.freeze({
  schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SERVICE_SCHEMA,
  tenantId: bootstrap.tenantId,
  operatorId: bootstrap.operatorId,
  policyId: bootstrap.policyId,
  revision: bootstrap.revision,
  policyDigest: bootstrap.policyDigest,
  signerId: bootstrap.signerId,
  keyId,
  publicKeySpki: publicKeyBytes.toString("base64url"),
  capability,
});

if (process.platform !== "win32" && fs.existsSync(bootstrap.endpoint)) {
  throw new Error("approval service endpoint already exists");
}

let requestCount = 0;
const usedRequestIds = new Set();
let transportSecurity;

function handleFrame(frame, peer = null) {
  let request;
  try {
    request = JSON.parse(frame);
  } catch {
    return { ok: false, requestId: null, code: "invalid_json" };
  }
  if (
    !exact(
      request,
      new Set([
        "action",
        "authorization",
        "capabilityId",
        "clientProcessId",
        "payload",
        "requestId",
        "schema",
      ]),
    ) ||
    request.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_IPC_SCHEMA ||
    !Number.isSafeInteger(request.clientProcessId) ||
    request.clientProcessId < 1 ||
    (process.platform === "win32" &&
      (peer?.processId !== request.clientProcessId ||
        peer?.principalDigest !== transportSecurity?.principalDigest)) ||
    !/^[a-f0-9]{32}$/u.test(request.requestId ?? "") ||
    request.capabilityId !== capability.id ||
    !verifyGovernedSkillSynthesisAttestorTrustIpcAuthorization({
      authorization: request.authorization,
      action: request.action,
      capabilityId: request.capabilityId,
      clientProcessId: request.clientProcessId,
      payload: request.payload,
      requestId: request.requestId,
      schema: request.schema,
      token: bootstrap.capabilityToken,
    }) ||
    usedRequestIds.has(request.requestId) ||
    !["approve", "operator-approve"].includes(request.action) ||
    requestCount >= capability.maxUses ||
    Date.now() >= Date.parse(capability.expiresAt)
  ) {
    return {
      ok: false,
      requestId: request?.requestId ?? null,
      code: "request_denied",
    };
  }
  usedRequestIds.add(request.requestId);
  requestCount += 1;
  try {
    if (
      request.payload?.tenantId !== bootstrap.tenantId ||
      request.payload?.policyDigest !== bootstrap.policyDigest ||
      (request.action === "operator-approve" &&
        (request.payload?.policyId !== bootstrap.policyId ||
          request.payload?.revision !== bootstrap.revision))
    ) {
      throw new Error("approval request crossed its pinned policy");
    }
    const result =
      request.action === "approve"
        ? trustIssuer.issue(request.payload)
        : registryIssuer.issue(request.payload);
    return { ok: true, requestId: request.requestId, result };
  } catch {
    return {
      ok: false,
      requestId: request.requestId,
      code: "approval_rejected",
    };
  }
}

function createUnixServer() {
  return net.createServer((socket) => {
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
      if (carry.slice(frameEnd + 1).trim().length > 0) {
        response(socket, { ok: false, requestId: null, code: "invalid_frame" });
        return;
      }
      response(
        socket,
        handleFrame(carry.slice(0, frameEnd).replace(/\r$/u, "")),
      );
    });
    socket.on("error", () => {});
  });
}

let server = null;
let pipeHost = null;
if (process.platform === "win32") {
  pipeHost = await createGovernedSkillSynthesisWindowsSecurePipeHost({
    endpoint: bootstrap.endpoint,
    maxFrameBytes: MAX_FRAME_BYTES,
    onRequest: ({ frame, peer }) => handleFrame(frame, peer),
  });
  transportSecurity = pipeHost.security;
} else {
  server = createUnixServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(bootstrap.endpoint, resolve);
  });
  fs.chmodSync(bootstrap.endpoint, 0o600);
  const uid = process.getuid?.();
  transportSecurity = Object.freeze({
    acl: "unix-owner-mode-0600",
    aclDigest: `sha256:${createHash("sha256")
      .update(
        "chainlesschain.unix-domain-socket-mode/v1\0owner=rw,group=,other=",
      )
      .digest("hex")}`,
    peerIdentity: "capability-authenticated-client",
    principalDigest: `sha256:${createHash("sha256")
      .update(`uid:${String(uid)}`)
      .digest("hex")}`,
    remoteClients: false,
  });
}
const descriptor = Object.freeze({ ...descriptorCore, transportSecurity });

let closing = false;
let capabilityExpiryTimer = null;
const close = () => {
  if (closing) return;
  closing = true;
  if (capabilityExpiryTimer) clearTimeout(capabilityExpiryTimer);
  if (pipeHost) {
    pipeHost.close().finally(() => process.exit(0));
  } else {
    server.close(() => process.exit(0));
  }
  setTimeout(() => process.exit(1), 2_000).unref();
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
process.stdout.write(`${JSON.stringify({ ok: true, descriptor })}\n`);
if (!closing) {
  capabilityExpiryTimer = setTimeout(
    close,
    Math.max(1, Date.parse(capability.expiresAt) - Date.now()),
  );
}
