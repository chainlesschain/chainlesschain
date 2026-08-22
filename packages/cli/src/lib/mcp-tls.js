/** Bounded mTLS material loading for HTTP/WebSocket MCP transports. */

import fs from "node:fs";
import path from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { isProxy } from "node:util/types";
import { Agent } from "undici";

export const MCP_TLS_MAX_FILE_BYTES = 1024 * 1024;
export const MCP_TLS_MANAGED_SOURCE_REQUIRED_CODE =
  "CC_MCP_TLS_MANAGED_SOURCE_REQUIRED";
export const MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE =
  "MCP TLS configuration is restricted to managed provisioned sources";

// TLS file paths are a privileged configuration capability: merely marking a
// JSON object as `configScope: "managed"` must never let a project, user, or
// headless config read certificate material. Keep the provisioned snapshot in
// a module-private WeakMap so it cannot be recreated by JSON, object spread,
// or a lookalike field supplied by an MCP config source.
const MANAGED_MCP_TLS_PROVENANCE = new WeakMap();
const MANAGED_MCP_TLS_SCOPE = "managed";

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

function managedTlsSourceRequiredError() {
  // Do not include the claimed scope, source file, certificate path, or any
  // TLS configuration field here. This error is surfaced by headless and MCP
  // connection diagnostics, where config values are not safe to disclose.
  return tlsError(
    MCP_TLS_MANAGED_SOURCE_REQUIRED_CODE,
    MCP_TLS_MANAGED_SOURCE_REQUIRED_MESSAGE,
  );
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

/**
 * Convert TLS settings from the organization-managed MCP loader into an
 * immutable, non-forgeable configuration capability.
 *
 * This is deliberately separate from `normalizeMcpTlsConfig`: normalization
 * validates data, while provisioning records the trusted source provenance
 * that is required before a certificate/key/CA file can be opened.
 */
export function provisionManagedMcpTlsConfig(value) {
  const config = normalizeMcpTlsConfig(value);
  if (!config) return null;
  const provisioned = Object.freeze({ ...config });
  MANAGED_MCP_TLS_PROVENANCE.set(
    provisioned,
    Object.freeze({ configScope: MANAGED_MCP_TLS_SCOPE }),
  );
  return provisioned;
}

/**
 * Enforce the managed source boundary before any TLS path is normalized or
 * opened. The private provenance association survives normal config-object
 * spreads because the provisioned `tls` value itself is preserved, but a
 * caller cannot manufacture it from JSON or by setting `configScope`.
 */
export function assertManagedMcpTlsConfig(value, { configScope } = {}) {
  if (value == null) return null;
  const provenance =
    value && typeof value === "object"
      ? MANAGED_MCP_TLS_PROVENANCE.get(value)
      : null;
  if (
    !provenance ||
    configScope !== MANAGED_MCP_TLS_SCOPE ||
    provenance.configScope !== MANAGED_MCP_TLS_SCOPE
  ) {
    throw managedTlsSourceRequiredError();
  }
  return value;
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

function validateCertificateBytes(bytes) {
  if (!bytes) return;
  const text = bytes.toString("utf8");
  const pemCertificates = text.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu,
  );
  if (pemCertificates?.length) {
    for (const certificate of pemCertificates) new X509Certificate(certificate);
    return;
  }
  new X509Certificate(bytes);
}

export function loadMcpTlsMaterial(
  value,
  {
    configScope,
    fsImpl = fs,
    createSecureContextImpl = createSecureContext,
    validateCertificateImpl = validateCertificateBytes,
  } = {},
) {
  const config = assertManagedMcpTlsConfig(value, { configScope });
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
  try {
    // Parse certificates and verify the client cert/key pair before creating a
    // dispatcher or issuing any outbound request. Node/Undici would otherwise
    // discover malformed or mismatched material only during a network dial.
    validateCertificateImpl(cert);
    validateCertificateImpl(ca);
    createSecureContextImpl(connectOptions);
  } catch {
    // TLS parser diagnostics may quote attacker-controlled PEM text or paths.
    // Keep the product error fixed and do not retain the parser error as cause.
    throw tlsError(
      "CC_MCP_TLS_MATERIAL_INVALID",
      "MCP TLS certificate material is invalid or the client key does not match",
    );
  }
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
