import {
  marketplaceCommandDescriptorIdentity,
  normalizeMarketplaceCommandDescriptor,
} from "./marketplace-command-descriptor.js";

const SHA256_RE = /^[a-f0-9]{64}$/u;
const DISABLED_DYNAMIC_SOURCE_TYPES = new Set(["headers-helper", "headershelper"]);

export const MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE =
  "CC_MARKETPLACE_DYNAMIC_SOURCE_DISABLED";

function sourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function bounded(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 && text.length <= max ? text : null;
}

function safeUrl(value, label) {
  const raw = bounded(value, 4096);
  if (!raw) throw sourceError("INVALID_SOURCE_URL", `${label} URL is missing`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw sourceError("INVALID_SOURCE_URL", `${label} URL is invalid`);
  }
  if (url.username || url.password) {
    throw sourceError(
      "SOURCE_CREDENTIALS_REJECTED",
      `${label} URL must not contain credentials`,
    );
  }
  if (!new Set(["https:", "http:"]).has(url.protocol)) {
    throw sourceError(
      "INVALID_SOURCE_URL",
      `${label} URL must use HTTPS or loopback HTTP`,
    );
  }
  const requestUrl = url.href;
  url.search = "";
  url.hash = "";
  return { url: url.href, requestUrl };
}

function disabledDynamicSource(type) {
  return Object.freeze({
    type: "dynamic-disabled",
    requestedType: type,
    enabled: false,
    code: MARKETPLACE_DYNAMIC_SOURCE_DISABLED_CODE,
    reason:
      "dynamic Marketplace source/auth adapters are disabled by product policy",
  });
}

/**
 * Normalize one registry package source without executing it. Git strings keep
 * the legacy shape. Archive sources require an HTTPS URL and exact compressed
 * byte digest. Legacy shell-string command/helper adapters remain
 * representable for UI diagnostics but can never become executable authority.
 * A typed `source: { type: "command", executable, args, cwd, ... }` is the
 * one deliberate exception: it is parsed as an exact direct-argv descriptor.
 */
export function normalizeMarketplacePackageSource(entry, options = {}) {
  const row = entry && typeof entry === "object" ? entry : {};
  if (row.command != null || row.headersHelper != null) {
    const disabled = disabledDynamicSource(
      row.command != null ? "command" : "headers-helper",
    );
    if (options.forExecution === true) {
      throw sourceError(disabled.code, disabled.reason);
    }
    return disabled;
  }

  const source = row.source;
  if (typeof source === "string") {
    const value = bounded(source, 4096);
    if (!value) {
      throw sourceError("MISSING_PACKAGE_SOURCE", "plugin source is missing");
    }
    return Object.freeze({
      type: "git",
      source: value,
      ref: bounded(row.ref, 256),
    });
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw sourceError("MISSING_PACKAGE_SOURCE", "plugin source is missing");
  }
  if (source.command != null || source.headersHelper != null) {
    const disabled = disabledDynamicSource(
      source.command != null ? "command" : "headers-helper",
    );
    if (options.forExecution === true) {
      throw sourceError(disabled.code, disabled.reason);
    }
    return disabled;
  }

  const type = String(source.type || "")
    .trim()
    .toLowerCase();
  if (DISABLED_DYNAMIC_SOURCE_TYPES.has(type)) {
    const disabled = disabledDynamicSource(type);
    if (options.forExecution === true) {
      throw sourceError(disabled.code, disabled.reason);
    }
    return disabled;
  }
  if (type === "command") {
    const descriptor = normalizeMarketplaceCommandDescriptor(source, {
      kind: "source",
      allowType: true,
      label: "Marketplace command source descriptor",
    });
    const normalized = {
      type: "command",
      mode: descriptor.mode,
      identity: marketplaceCommandDescriptorIdentity(source),
    };
    // Descriptor values are deliberately retained for the immediate local
    // materializer but are not enumerable, so catalog/listing/provenance JSON
    // cannot accidentally disclose a local argv, path, or environment value.
    for (const [key, value] of Object.entries(descriptor)) {
      Object.defineProperty(normalized, key, {
        value,
        enumerable: false,
      });
    }
    return Object.freeze(normalized);
  }
  if (type === "git") {
    const value = bounded(source.url ?? source.source, 4096);
    if (!value) {
      throw sourceError("MISSING_PACKAGE_SOURCE", "git source URL is missing");
    }
    return Object.freeze({
      type: "git",
      source: value,
      ref: bounded(source.ref ?? row.ref, 256),
    });
  }
  if (type !== "archive") {
    throw sourceError(
      "UNSUPPORTED_PACKAGE_SOURCE",
      `unsupported Marketplace source type: ${type || "unknown"}`,
    );
  }

  const archiveUrl = safeUrl(source.url, "archive source");
  const sha256 = String(source.sha256 || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(sha256)) {
    throw sourceError(
      "ARCHIVE_DIGEST_REQUIRED",
      "archive source requires a 64-character lowercase SHA-256 digest",
    );
  }
  const format = String(source.format || "tgz").toLowerCase();
  if (!new Set(["tgz", "tar.gz"]).has(format)) {
    throw sourceError(
      "ARCHIVE_FORMAT_UNSUPPORTED",
      "archive source format must be tgz or tar.gz",
    );
  }
  const normalized = {
    type: "archive",
    url: archiveUrl.url,
    sha256,
    format: "tgz",
  };
  Object.defineProperty(normalized, "requestUrl", {
    value: archiveUrl.requestUrl,
    enumerable: false,
  });
  return Object.freeze(normalized);
}

export function assertMarketplaceSourceExecutable(entry) {
  return normalizeMarketplacePackageSource(entry, { forExecution: true });
}
