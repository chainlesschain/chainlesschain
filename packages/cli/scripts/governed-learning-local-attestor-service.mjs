#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const REQUEST_SCHEMA =
  "chainlesschain.skill-synthesis-external-attestor-request/v1";
const ATTESTATION_SCHEMA =
  "chainlesschain.skill-synthesis-evaluation-external-attestation/v1";
const ATTESTOR_SCHEMA =
  "chainlesschain.governed-skill-synthesis-external-attestor/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SERVICE_ID = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){1,7}$/u;
const WINDOWS_PIPE = /^\\\\\.\\pipe\\cc-evolution-attestor-[a-f0-9]{16,64}$/u;
const SOCKET_NAME = /^cc-evolution-attestor-[a-f0-9]{16,64}\.sock$/u;
const MAX_FRAME_BYTES = 32 * 1024;
const MAX_REQUESTS = 32;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
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

function response(socket, value) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

let bootstrapLine = "";
for await (const chunk of process.stdin) {
  bootstrapLine += chunk.toString("utf8");
  if (Buffer.byteLength(bootstrapLine, "utf8") > MAX_FRAME_BYTES) {
    throw new Error("local attestor bootstrap exceeds its byte limit");
  }
  if (bootstrapLine.includes("\n")) break;
}
const newline = bootstrapLine.indexOf("\n");
if (newline === -1 || bootstrapLine.slice(newline + 1).trim().length > 0) {
  throw new Error("local attestor bootstrap is invalid");
}
const bootstrap = JSON.parse(
  bootstrapLine.slice(0, newline).replace(/\r$/u, ""),
);
if (
  !exact(bootstrap, [
    "capabilityToken",
    "endpoint",
    "privateKeyPem",
    "serviceId",
  ]) ||
  typeof bootstrap.endpoint !== "string" ||
  (process.platform === "win32"
    ? !WINDOWS_PIPE.test(bootstrap.endpoint)
    : !path.isAbsolute(bootstrap.endpoint) ||
      !SOCKET_NAME.test(path.basename(bootstrap.endpoint))) ||
  typeof bootstrap.capabilityToken !== "string" ||
  bootstrap.capabilityToken.length < 32 ||
  bootstrap.capabilityToken.length > 4096 ||
  typeof bootstrap.serviceId !== "string" ||
  !SERVICE_ID.test(bootstrap.serviceId) ||
  typeof bootstrap.privateKeyPem !== "string" ||
  bootstrap.privateKeyPem.length > 16 * 1024
) {
  throw new Error("local attestor bootstrap schema is invalid");
}
const privateKey = createPrivateKey(bootstrap.privateKeyPem);
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("local attestor key is not Ed25519");
}
const publicDer = createPublicKey(privateKey).export({
  type: "spki",
  format: "der",
});
const publicKeyDigest = `sha256:${createHash("sha256")
  .update(publicDer)
  .digest("hex")}`;
const keyId = `key:ed25519:${publicKeyDigest.slice(7)}`;
const endpointDigest = `sha256:${createHash("sha256")
  .update(bootstrap.endpoint, "utf8")
  .digest("hex")}`;
let requestCount = 0;

if (process.platform !== "win32" && fs.existsSync(bootstrap.endpoint)) {
  throw new Error("local attestor socket endpoint already exists");
}

const server = net.createServer((socket) => {
  let carry = "";
  let handled = false;
  socket.setTimeout(10_000, () => socket.destroy());
  socket.on("data", (chunk) => {
    if (handled) return;
    carry += chunk.toString("utf8");
    if (Buffer.byteLength(carry, "utf8") > MAX_FRAME_BYTES) {
      handled = true;
      response(socket, { ok: false, code: "request_too_large" });
      return;
    }
    const frameEnd = carry.indexOf("\n");
    if (frameEnd === -1) return;
    handled = true;
    let request;
    try {
      request = JSON.parse(carry.slice(0, frameEnd).replace(/\r$/u, ""));
    } catch {
      response(socket, { ok: false, code: "invalid_json" });
      return;
    }
    if (
      !exact(request, [
        "attestor",
        "candidateDigest",
        "capabilityToken",
        "evaluatorDescriptor",
        "receiptDigest",
        "requestId",
        "schema",
        "serviceId",
      ]) ||
      request.schema !== REQUEST_SCHEMA ||
      carry.slice(frameEnd + 1).trim().length > 0 ||
      request.serviceId !== bootstrap.serviceId ||
      !safeEqual(request.capabilityToken, bootstrap.capabilityToken) ||
      !/^[a-f0-9]{32}$/u.test(request.requestId ?? "") ||
      !DIGEST.test(request.receiptDigest ?? "") ||
      !DIGEST.test(request.candidateDigest ?? "") ||
      !exact(request.evaluatorDescriptor, [
        "authorityId",
        "handlerArtifactDigest",
        "revision",
      ]) ||
      !DIGEST.test(request.evaluatorDescriptor.handlerArtifactDigest ?? "") ||
      typeof request.evaluatorDescriptor.authorityId !== "string" ||
      request.evaluatorDescriptor.authorityId.trim() !==
        request.evaluatorDescriptor.authorityId ||
      request.evaluatorDescriptor.authorityId.length < 1 ||
      request.evaluatorDescriptor.authorityId.length > 256 ||
      !Number.isSafeInteger(request.evaluatorDescriptor.revision) ||
      request.evaluatorDescriptor.revision < 1 ||
      !exact(request.attestor, [
        "algorithm",
        "endpointDigest",
        "isolation",
        "keyId",
        "publicKeyDigest",
        "requestTimeoutMs",
        "schema",
        "serviceId",
        "transport",
      ]) ||
      request.attestor.schema !== ATTESTOR_SCHEMA ||
      request.attestor.algorithm !== "Ed25519" ||
      request.attestor.keyId !== keyId ||
      request.attestor.publicKeyDigest !== publicKeyDigest ||
      request.attestor.isolation !== "external-service" ||
      request.attestor.serviceId !== bootstrap.serviceId ||
      request.attestor.transport !== "local-ipc-v1" ||
      request.attestor.endpointDigest !== endpointDigest ||
      !Number.isSafeInteger(request.attestor.requestTimeoutMs) ||
      request.attestor.requestTimeoutMs < 1_000 ||
      request.attestor.requestTimeoutMs > 30_000 ||
      requestCount >= MAX_REQUESTS
    ) {
      response(socket, { ok: false, code: "request_denied" });
      return;
    }
    requestCount += 1;
    const message = Buffer.from(
      `${ATTESTATION_SCHEMA}\0${canonical({
        receiptDigest: request.receiptDigest,
        candidateDigest: request.candidateDigest,
        evaluatorDescriptor: request.evaluatorDescriptor,
        attestor: request.attestor,
        requestId: request.requestId,
      })}`,
      "utf8",
    );
    response(socket, {
      ok: true,
      requestId: request.requestId,
      signature: sign(null, message, privateKey).toString("base64"),
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
  process.stdout.write(
    `${JSON.stringify({ ok: true, serviceId: bootstrap.serviceId })}\n`,
  );
});
