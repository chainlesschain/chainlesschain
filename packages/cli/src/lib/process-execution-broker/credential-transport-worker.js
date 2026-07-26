/**
 * Broker-owned credential transport worker.
 *
 * The worker owns the local named-pipe / Unix-domain-socket server so it can
 * answer a child while the broker's main thread is blocked in spawnSync().
 * Credential values never enter the spawned command's argv or environment.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { parentPort, workerData } from "node:worker_threads";

const MAX_FRAME_BYTES = 1024 * 1024;
const records = new Map();
const endpoint = workerData.endpoint;
const agentId = workerData.agentId;
const platform = workerData.platform;

function normalizeProcessTarget(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function normalizeHostTarget(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  try {
    const parsed = candidate.includes("://")
      ? new URL(candidate)
      : new URL(`https://${candidate}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return candidate.toLowerCase().replace(/\.$/, "");
  }
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 16);
}

function capabilityMatches(expected, supplied) {
  const expectedBuffer = Buffer.from(String(expected ?? ""));
  const suppliedBuffer = Buffer.from(String(supplied ?? ""));
  return (
    expectedBuffer.length > 0 &&
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function send(socket, message) {
  if (!socket.destroyed) {
    socket.end(`${JSON.stringify(message)}\n`);
  }
}

function deny(socket, code, message, record, refId) {
  parentPort.postMessage({
    type: "audit",
    entry: {
      event: "credential_transport_resolve",
      outcome: "denied",
      reason: code,
      key: record?.key,
      target: record?.target,
      refFingerprint: fingerprint(refId),
    },
  });
  send(socket, { ok: false, code, message });
}

function handleResolution(socket, request) {
  const refId = typeof request.refId === "string" ? request.refId : "";
  const record = records.get(refId);
  if (!record) {
    deny(
      socket,
      "CC_CREDENTIAL_REF_NOT_FOUND",
      "Credential reference was not found",
      null,
      refId,
    );
    return;
  }
  if (
    request.agentId !== agentId ||
    !capabilityMatches(record.capabilityToken, request.capabilityToken)
  ) {
    deny(
      socket,
      "CC_CREDENTIAL_TRANSPORT_UNAUTHORIZED",
      "Credential transport authentication failed",
      record,
      refId,
    );
    return;
  }

  const requestTarget = {
    process: normalizeProcessTarget(request.process),
    host: normalizeHostTarget(request.host),
  };
  if (
    !requestTarget.process ||
    requestTarget.process !== record.target.process ||
    requestTarget.host !== record.target.host
  ) {
    deny(
      socket,
      "CC_CREDENTIAL_TARGET_MISMATCH",
      "Credential resolution target does not match",
      record,
      refId,
    );
    return;
  }

  if (record.status !== "active") {
    const code =
      record.status === "expired"
        ? "CC_CREDENTIAL_REF_EXPIRED"
        : record.status === "exhausted"
          ? "CC_CREDENTIAL_REF_EXHAUSTED"
          : "CC_CREDENTIAL_REF_REVOKED";
    deny(socket, code, "Credential reference is not active", record, refId);
    return;
  }
  if (Date.now() >= record.expiresAt) {
    record.status = "expired";
    record.value = null;
    deny(
      socket,
      "CC_CREDENTIAL_REF_EXPIRED",
      "Credential reference has expired",
      record,
      refId,
    );
    return;
  }
  if (record.useCount >= record.maxUses) {
    record.status = "exhausted";
    record.value = null;
    deny(
      socket,
      "CC_CREDENTIAL_REF_EXHAUSTED",
      "Credential reference usage limit has been reached",
      record,
      refId,
    );
    return;
  }

  const value = record.value;
  record.useCount += 1;
  const remainingUses = record.maxUses - record.useCount;
  if (remainingUses <= 0) {
    record.status = "exhausted";
    record.value = null;
  }
  parentPort.postMessage({
    type: "audit",
    entry: {
      event: "credential_transport_resolve",
      outcome: "allowed",
      key: record.key,
      target: record.target,
      refFingerprint: fingerprint(refId),
      useCount: record.useCount,
      remainingUses: Math.max(remainingUses, 0),
    },
  });
  parentPort.postMessage({
    type: "settlement",
    refId,
    useCount: record.useCount,
    status: record.status,
  });
  send(socket, { ok: true, value });
}

if (platform !== "win32") {
  try {
    fs.unlinkSync(endpoint);
  } catch {
    // A socket normally does not exist on first start.
  }
}

const server = net.createServer((socket) => {
  let carry = "";
  let handled = false;
  socket.setTimeout(5000, () => socket.destroy());
  socket.on("data", (chunk) => {
    if (handled) return;
    carry += chunk.toString("utf8");
    if (Buffer.byteLength(carry, "utf8") > MAX_FRAME_BYTES) {
      handled = true;
      deny(
        socket,
        "CC_CREDENTIAL_INVALID_REQUEST",
        "Credential transport request is too large",
        null,
        "",
      );
      return;
    }
    const newline = carry.indexOf("\n");
    if (newline === -1) return;
    handled = true;
    const line = carry.slice(0, newline).replace(/\r$/, "");
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      deny(
        socket,
        "CC_CREDENTIAL_INVALID_REQUEST",
        "Credential transport request is not valid JSON",
        null,
        "",
      );
      return;
    }
    if (!request || request.type !== "resolve") {
      deny(
        socket,
        "CC_CREDENTIAL_INVALID_REQUEST",
        "Credential transport request type is invalid",
        null,
        request?.refId,
      );
      return;
    }
    handleResolution(socket, request);
  });
  socket.on("error", () => {
    // Per-client failures must not take down the credential service.
  });
});

server.on("error", (error) => {
  parentPort.postMessage({
    type: "fatal",
    error: {
      code: error.code || "CC_CREDENTIAL_TRANSPORT_UNAVAILABLE",
      message: error.message,
    },
  });
});

server.listen(endpoint, () => {
  if (platform !== "win32") {
    try {
      fs.chmodSync(endpoint, 0o600);
    } catch {
      // The random per-launch capability remains mandatory if chmod is absent.
    }
  }
  parentPort.postMessage({ type: "ready", endpoint });
});

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "register") {
    records.set(message.record.refId, {
      ...message.record,
      target: {
        process: normalizeProcessTarget(message.record.target?.process),
        host: normalizeHostTarget(message.record.target?.host),
      },
    });
    return;
  }
  if (message.type === "update") {
    const record = records.get(message.refId);
    if (!record) return;
    record.useCount = message.useCount;
    record.status = message.status;
    if (record.status !== "active") record.value = null;
    return;
  }
  if (message.type === "revoke") {
    const record = records.get(message.refId);
    if (!record) return;
    record.status = "revoked";
    record.value = null;
    return;
  }
  if (message.type === "close") {
    for (const record of records.values()) record.value = null;
    records.clear();
    server.close(() => {
      if (platform !== "win32") {
        try {
          fs.unlinkSync(endpoint);
        } catch {
          // The socket may already have been removed.
        }
      }
      parentPort.postMessage({ type: "closed" });
      parentPort.close();
    });
  }
});
