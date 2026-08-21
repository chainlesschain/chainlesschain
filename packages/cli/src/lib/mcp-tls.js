/** Bounded mTLS material loading for HTTP/WebSocket MCP transports. */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { Agent } from "undici";

export const MCP_TLS_MAX_FILE_BYTES = 1024 * 1024;

const TLS_KEYS = new Set([
  "certFile",
  "keyFile",
  "caFile",
  "serverName",
  "rejectUnauthorized",
]);

function tlsError(code, message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function plainTlsObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    return null;
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !TLS_KEYS.has(key) ||
        !Object.prototype.hasOwnProperty.call(descriptors[key], "value") ||
        descriptors[key].enumerable !== true,
    )
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function absoluteFile(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      `MCP TLS ${label} must be an absolute file path`,
    );
  }
  return path.resolve(value);
}

function validServerName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 253) {
    return false;
  }
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
    );
}

export function normalizeMcpTlsConfig(value) {
  if (value == null) return null;
  const snapshot = plainTlsObject(value);
  if (!snapshot) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      "MCP TLS configuration must be a plain allowlisted data object",
    );
  }
  const certFile = absoluteFile(snapshot.certFile, "certFile");
  const keyFile = absoluteFile(snapshot.keyFile, "keyFile");
  if (Boolean(certFile) !== Boolean(keyFile)) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      "MCP TLS certFile and keyFile must be configured together",
    );
  }
  const caFile = absoluteFile(snapshot.caFile, "caFile");
  if (!certFile && !caFile) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      "MCP TLS configuration requires a client certificate or CA file",
    );
  }
  const serverName = snapshot.serverName == null ? null : snapshot.serverName;
  if (serverName != null && !validServerName(serverName)) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      "MCP TLS serverName must be a valid DNS name",
    );
  }
  if (
    snapshot.rejectUnauthorized != null &&
    typeof snapshot.rejectUnauthorized !== "boolean"
  ) {
    throw tlsError(
      "CC_MCP_TLS_CONFIG_INVALID",
      "MCP TLS rejectUnauthorized must be boolean",
    );
  }
  return {
    certFile,
    keyFile,
    caFile,
    serverName,
    rejectUnauthorized: snapshot.rejectUnauthorized !== false,
  };
}

function readTlsFile(filePath, label, fsImpl) {
  if (!filePath) return null;
  let descriptor = null;
  let stat;
  try {
    const link = fsImpl.lstatSync(filePath);
    if (link.isSymbolicLink()) {
      throw tlsError(
        "CC_MCP_TLS_FILE_UNSAFE",
        `MCP TLS ${label} must not be a symbolic link`,
      );
    }
    const constants = fsImpl.constants || fs.constants;
    descriptor = fsImpl.openSync(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    stat = fsImpl.fstatSync(descriptor);
  } catch (cause) {
    if (descriptor != null) fsImpl.closeSync?.(descriptor);
    if (cause?.code?.startsWith?.("CC_MCP_TLS_")) throw cause;
    throw tlsError(
      "CC_MCP_TLS_FILE_UNAVAILABLE",
      `MCP TLS ${label} could not be inspected`,
      cause,
    );
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MCP_TLS_MAX_FILE_BYTES) {
    fsImpl.closeSync?.(descriptor);
    throw tlsError(
      "CC_MCP_TLS_FILE_UNSAFE",
      `MCP TLS ${label} must be a non-empty regular file no larger than ${MCP_TLS_MAX_FILE_BYTES} bytes`,
    );
  }
  if (
    label === "keyFile" &&
    process.platform !== "win32" &&
    (stat.mode & 0o077) !== 0
  ) {
    fsImpl.closeSync?.(descriptor);
    throw tlsError(
      "CC_MCP_TLS_FILE_UNSAFE",
      "MCP TLS keyFile must not be readable or writable by group/other users",
    );
  }
  try {
    return fsImpl.readFileSync(descriptor);
  } catch (cause) {
    throw tlsError(
      "CC_MCP_TLS_FILE_UNAVAILABLE",
      `MCP TLS ${label} could not be read`,
      cause,
    );
  } finally {
    fsImpl.closeSync?.(descriptor);
  }
}

function updateDigestPart(hash, value) {
  const bytes = value || Buffer.alloc(0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length).update(bytes);
}

export function loadMcpTlsMaterial(value, { fsImpl = fs } = {}) {
  const config = normalizeMcpTlsConfig(value);
  if (!config) return null;
  const cert = readTlsFile(config.certFile, "certFile", fsImpl);
  const key = readTlsFile(config.keyFile, "keyFile", fsImpl);
  const ca = readTlsFile(config.caFile, "caFile", fsImpl);
  const connectOptions = {
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
    ...(ca ? { ca } : {}),
    ...(config.serverName ? { servername: config.serverName } : {}),
    rejectUnauthorized: config.rejectUnauthorized,
  };
  const identityHash = createHash("sha256");
  updateDigestPart(identityHash, cert);
  updateDigestPart(identityHash, key);
  updateDigestPart(identityHash, ca);
  const identityDigest = `sha256:${identityHash.digest("hex")}`;
  return { connectOptions, identityDigest };
}

export function createMcpTlsDispatcher(material) {
  if (!material?.connectOptions) return null;
  return new Agent({ connect: material.connectOptions });
}

export async function closeMcpTlsDispatcher(dispatcher) {
  if (!dispatcher) return;
  if (typeof dispatcher.close === "function") {
    await dispatcher.close();
  } else if (typeof dispatcher.destroy === "function") {
    dispatcher.destroy();
  }
}
