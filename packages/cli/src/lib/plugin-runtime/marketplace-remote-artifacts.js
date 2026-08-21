/**
 * Bounded retrieval for marketplace signature, public-key, and SBOM
 * documents. Registry metadata is still an assertion; this module proves
 * only the exact remote document digests and signing-key SPKI fingerprint.
 * The detached signature is verified against plugin manifest bytes later by
 * the installer, before the plugin becomes active.
 */

import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getElectronUserDataDir } from "../paths.js";
import { createMarketplaceNetworkTransport } from "./marketplace-network.js";

export const PLUGIN_MARKETPLACE_REMOTE_ARTIFACT_EVIDENCE_SCHEMA =
  "cc-plugin-marketplace-remote-artifact-evidence/v1";
export const MAX_MARKETPLACE_ARTIFACT_REDIRECTS = 3;
export const DEFAULT_MARKETPLACE_ARTIFACT_TIMEOUT_MS = 15_000;
export const MAX_MARKETPLACE_ARTIFACT_URL_LENGTH = 4096;
export const MARKETPLACE_REMOTE_ARTIFACT_LIMITS = Object.freeze({
  archive: 64 * 1024 * 1024,
  signature: 16 * 1024,
  publicKey: 64 * 1024,
  sbom: 16 * 1024 * 1024,
});

const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_UNBOUND_CACHE_CANDIDATES = 64;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const marketplaceRemoteArtifactDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  resolveHostname: (hostname) =>
    dns.lookup(hostname, { all: true, verbatim: true }),
};

export class MarketplaceRemoteArtifactError extends Error {
  constructor(code, message, { cacheFallbackAllowed = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "MarketplaceRemoteArtifactError";
    this.code = code;
    this.cacheFallbackAllowed = cacheFallbackAllowed;
  }
}

/**
 * Fetch every complete remote-artifact declaration for one registry entry.
 * Returns null when neither a signature bundle nor an SBOM was requested.
 *
 * The returned authority is safe to persist at
 * `sourceMetadata.catalogAuthority.remoteArtifactEvidence`. Signature files
 * and their temporary path deliberately live outside that authority.
 */
export async function fetchPluginMarketplaceRemoteArtifacts(options = {}) {
  const signatureSpec = objectValue(options.signature);
  const sbomSpec = objectValue(options.sbom);
  const signatureRequested = artifactWasRequested(signatureSpec, [
    "url",
    "publicKeyUrl",
  ]);
  const sbomRequested = artifactWasRequested(sbomSpec, ["url"]);
  if (!signatureRequested && !sbomRequested) return null;

  const registryUrl = assertRegistryUrlSafe(
    options.registryUrl,
    options.allowInsecure === true,
  );
  const registryOrigin = registryUrl.origin;
  const common = {
    token: normalizeBearerToken(options.token),
    authorizationOrigin: registryOrigin,
    registryOrigin,
    allowInsecure: options.allowInsecure === true,
    cacheDir: options.cacheDir,
    timeoutMs: options.timeoutMs,
    allowCache: options.allowCache,
    offline: options.offline,
    fetchImpl: options.fetchImpl,
    resolveHostname: options.resolveHostname,
  };

  let normalizedSignature = null;
  if (signatureRequested) {
    normalizedSignature = normalizeSignatureSpec(signatureSpec);
  }
  let normalizedSbom = null;
  if (sbomRequested) normalizedSbom = normalizeSbomSpec(sbomSpec);

  const networkTransport =
    options.offline !== true &&
    typeof options.fetchImpl !== "function" &&
    (options.proxyUrl || options.pacFile || options.caFile)
      ? createMarketplaceNetworkTransport({
          proxyUrl: options.proxyUrl,
          pacFile: options.pacFile,
          caFile: options.caFile,
        })
      : null;
  common.fetchImpl = options.fetchImpl || networkTransport?.fetch;

  const signaturePromise = normalizedSignature
    ? fetchMarketplaceRemoteArtifact({
        ...common,
        kind: "signature",
        url: normalizedSignature.url,
        expectedSha256: normalizedSignature.sha256,
      })
    : Promise.resolve(null);
  const publicKeyPromise = normalizedSignature
    ? fetchMarketplaceRemoteArtifact({
        ...common,
        kind: "publicKey",
        url: normalizedSignature.publicKeyUrl,
        expectedSha256: normalizedSignature.publicKeyDocumentSha256,
        validateBytes: (bytes) =>
          verifyPublicKeyDocument(
            bytes,
            normalizedSignature.publicKeySha256,
            normalizedSignature.algorithm,
          ),
      })
    : Promise.resolve(null);
  const sbomPromise = normalizedSbom
    ? fetchMarketplaceRemoteArtifact({
        ...common,
        kind: "sbom",
        url: normalizedSbom.url,
        expectedSha256: normalizedSbom.sha256,
      })
    : Promise.resolve(null);

  let signatureArtifact;
  let publicKeyArtifact;
  let sbomArtifact;
  try {
    [signatureArtifact, publicKeyArtifact, sbomArtifact] = await Promise.all([
      signaturePromise,
      publicKeyPromise,
      sbomPromise,
    ]);
  } finally {
    await networkTransport?.close();
  }

  const signatureAuthority = signatureArtifact
    ? {
        status: "fetched",
        url: signatureArtifact.url,
        signatureSha256: signatureArtifact.sha256,
        bytes: signatureArtifact.bytes.length,
        fromCache: signatureArtifact.fromCache,
        publicKey: {
          url: publicKeyArtifact.url,
          documentSha256: publicKeyArtifact.sha256,
          spkiSha256: publicKeyArtifact.validation.spkiSha256,
          bytes: publicKeyArtifact.bytes.length,
          fromCache: publicKeyArtifact.fromCache,
        },
      }
    : null;
  const sbomAuthority = sbomArtifact
    ? {
        status: "digest-verified",
        url: sbomArtifact.url,
        format: normalizedSbom.format,
        expectedDocumentSha256: normalizedSbom.sha256,
        documentSha256: sbomArtifact.sha256,
        bytes: sbomArtifact.bytes.length,
        fromCache: sbomArtifact.fromCache,
      }
    : null;
  const claims = {
    publisherIdentityVerified: false,
    signatureBytesFetched: Boolean(signatureArtifact),
    publicKeyFingerprintVerified: Boolean(publicKeyArtifact),
    manifestSignatureVerified: false,
    sbomDocumentDigestVerified: Boolean(sbomArtifact),
    sbomPayloadCompared: false,
  };
  const authorityWithoutDigest = {
    schemaVersion: PLUGIN_MARKETPLACE_REMOTE_ARTIFACT_EVIDENCE_SCHEMA,
    status: "verified",
    registryOrigin,
    signature: signatureAuthority,
    sbom: sbomAuthority,
    claims,
  };
  const authority = {
    ...authorityWithoutDigest,
    evidenceDigest: sha256Canonical(authorityWithoutDigest),
  };

  let materialized = null;
  try {
    materialized = signatureArtifact
      ? materializeSignatureBundle(
          signatureArtifact.bytes,
          publicKeyArtifact.bytes,
        )
      : null;
    return {
      authority,
      signatureFile: materialized?.signatureFile || null,
      publicKeyFile: materialized?.publicKeyFile || null,
      sbomBytes: sbomArtifact?.bytes || null,
      cleanup: materialized?.cleanup || (() => {}),
    };
  } catch (error) {
    materialized?.cleanup();
    throw artifactError(
      "TEMP_MATERIALIZATION_FAILED",
      "could not materialize verified marketplace signature files",
      { error, token: common.token },
    );
  }
}

/**
 * Fetch one bounded artifact with manual redirects and immutable offline cache
 * fallback. A cache entry is addressed by both the full request URL hash and
 * the fetched content digest; every read recomputes and validates that digest.
 */
export async function fetchMarketplaceRemoteArtifact(options = {}) {
  const kind = normalizeArtifactKind(options.kind);
  const maxBytes = MARKETPLACE_REMOTE_ARTIFACT_LIMITS[kind];
  const registryOrigin = normalizeTrustedRegistryOrigin(
    options.registryOrigin,
    options.allowInsecure === true,
  );
  const url = assertMarketplaceArtifactUrlSafe(options.url, {
    registryOrigin,
    allowLoopbackHttp: options.allowLoopbackHttp !== false,
    label: kind,
  });
  const token = normalizeBearerToken(options.token);
  const authorizationOrigin = normalizeAuthorizationOrigin(
    options.authorizationOrigin,
    url,
    token,
    options.allowInsecure,
  );
  const expectedSha256 = normalizeSha256(
    options.expectedSha256,
    `${kind} expected SHA-256`,
    { optional: true },
  );
  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs,
    DEFAULT_MARKETPLACE_ARTIFACT_TIMEOUT_MS,
    1,
    120_000,
    "artifact timeout",
  );
  const allowCache = options.allowCache !== false;
  const cacheDir = marketplaceArtifactCacheRoot(options.cacheDir);
  const validateBytes =
    typeof options.validateBytes === "function" ? options.validateBytes : null;
  const hasCustomFetch = typeof options.fetchImpl === "function";
  const resolveHostname =
    typeof options.resolveHostname === "function"
      ? options.resolveHostname
      : hasCustomFetch
        ? null
        : marketplaceRemoteArtifactDependencies.resolveHostname;

  if (options.offline === true) {
    const cached = await readCachedArtifact({
      url,
      kind,
      maxBytes,
      expectedSha256,
      cacheDir,
      validateBytes,
    });
    if (cached) return cached;
    throw artifactError(
      "OFFLINE_CACHE_MISS",
      `${kind} artifact is unavailable in the verified immutable cache`,
    );
  }

  let networkError = null;
  try {
    const fetched = await fetchArtifactFromNetwork({
      url,
      kind,
      maxBytes,
      expectedSha256,
      token,
      authorizationOrigin,
      registryOrigin,
      timeoutMs,
      allowLoopbackHttp: options.allowLoopbackHttp !== false,
      fetchImpl:
        options.fetchImpl || marketplaceRemoteArtifactDependencies.fetch,
      resolveHostname,
      validateBytes,
    });
    if (allowCache) {
      writeImmutableCache(
        url,
        fetched.bytes,
        fetched.sha256,
        cacheDir,
        maxBytes,
      );
    }
    return fetched;
  } catch (error) {
    networkError = normalizeFetchError(error, { kind, token });
  }

  if (allowCache && networkError.cacheFallbackAllowed) {
    try {
      const cached = await readCachedArtifact({
        url,
        kind,
        maxBytes,
        expectedSha256,
        cacheDir,
        validateBytes,
      });
      if (cached) return cached;
    } catch (cacheError) {
      throw artifactError(
        networkError.code,
        `${networkError.message}; verified immutable cache rejected: ${redactMarketplaceArtifactError(
          cacheError?.message || cacheError,
          { token },
        )}`,
        { error: networkError },
      );
    }
  }
  throw networkError;
}

export function assertMarketplaceArtifactUrlSafe(
  value,
  {
    registryOrigin = null,
    allowLoopbackHttp = true,
    label = "marketplace artifact",
    allowInsecureRegistry = false,
    allowPrivateNetwork = false,
  } = {},
) {
  const raw = String(value || "");
  if (raw.length > MAX_MARKETPLACE_ARTIFACT_URL_LENGTH) {
    throw artifactError(
      "URL_TOO_LONG",
      `${label} URL exceeds ${MAX_MARKETPLACE_ARTIFACT_URL_LENGTH} characters`,
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw artifactError("INVALID_URL", `${label} URL is invalid`);
  }
  if (url.href.length > MAX_MARKETPLACE_ARTIFACT_URL_LENGTH) {
    throw artifactError(
      "URL_TOO_LONG",
      `${label} URL exceeds ${MAX_MARKETPLACE_ARTIFACT_URL_LENGTH} characters`,
    );
  }
  if (url.username || url.password) {
    throw artifactError(
      "URL_CREDENTIALS_REJECTED",
      `${label} URL must not contain credentials`,
    );
  }
  const trustedOrigin = registryOrigin
    ? normalizeOriginString(registryOrigin, "registry origin")
    : null;
  const sameRegistryOrigin = Boolean(
    trustedOrigin && url.origin === trustedOrigin,
  );
  if (url.protocol === "https:") {
    if (
      !sameRegistryOrigin &&
      !allowPrivateNetwork &&
      isRestrictedNetworkHostname(url.hostname)
    ) {
      throw artifactError(
        "UNSAFE_NETWORK_TARGET",
        `${label} URL must not target a private or local network address`,
      );
    }
    if (trustedOrigin && !sameRegistryOrigin) {
      // Registry metadata is untrusted. Keeping artifact requests on the exact
      // user-selected registry origin avoids granting it a second network
      // authority (and removes a DNS-rebinding window on cross-origin fetches).
      throw artifactError(
        "CROSS_ORIGIN_ARTIFACT_REJECTED",
        `${label} URL must use the selected registry origin`,
      );
    }
    return url;
  }
  if (url.protocol !== "http:") {
    throw artifactError(
      "UNSAFE_URL",
      `${label} URL must use HTTPS or loopback HTTP`,
    );
  }
  if (sameRegistryOrigin) return url;
  if (!trustedOrigin && allowLoopbackHttp && isLoopbackHostname(url.hostname)) {
    return url;
  }
  if (!trustedOrigin && allowInsecureRegistry === true) return url;
  throw artifactError(
    "UNSAFE_URL",
    `${label} URL must use HTTPS or loopback HTTP`,
  );
}

export function sanitizeMarketplaceArtifactUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[URL]";
  }
}

export function redactMarketplaceArtifactError(value, { token = null } = {}) {
  let text = String(value == null ? "" : value).replace(/\p{Cc}/gu, " ");
  if (token) text = text.split(String(token)).join("[REDACTED]");
  text = text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|access_token|token|password|secret)=([^\s,;&]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) =>
      sanitizeMarketplaceArtifactUrl(match.replace(/[),.;]+$/g, "")),
    );
  return text.trim().slice(0, 2048) || "unknown error";
}

export function marketplaceRemoteArtifactCachePath(
  url,
  contentSha256,
  cacheDir,
) {
  const parsed = assertMarketplaceArtifactUrlSafe(url, {
    allowInsecureRegistry: true,
    allowPrivateNetwork: true,
  });
  const digest = normalizeSha256(contentSha256, "cache content SHA-256");
  const urlHash = sha256(parsed.href);
  return path.join(
    marketplaceArtifactCacheRoot(cacheDir),
    urlHash,
    `${digest}.bin`,
  );
}

async function fetchArtifactFromNetwork({
  url,
  kind,
  maxBytes,
  expectedSha256,
  token,
  authorizationOrigin,
  registryOrigin,
  timeoutMs,
  allowLoopbackHttp,
  fetchImpl,
  resolveHostname,
  validateBytes,
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let current = url;
  let redirectCount = 0;
  try {
    while (true) {
      await assertMarketplaceArtifactNetworkTargetSafe(current, {
        kind,
        registryOrigin,
        resolveHostname,
      });
      const headers = { Accept: acceptHeader(kind) };
      if (token && current.origin === authorizationOrigin) {
        headers.Authorization = `Bearer ${token}`;
      }
      let response;
      try {
        response = await fetchImpl(current.href, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw artifactError(
            "TIMEOUT",
            `${kind} artifact fetch timed out after ${timeoutMs}ms`,
            { cacheFallbackAllowed: true, error, token },
          );
        }
        throw artifactError(
          "FETCH_FAILED",
          `${kind} artifact fetch failed: ${redactMarketplaceArtifactError(
            error?.message || error,
            { token },
          )}`,
          { cacheFallbackAllowed: true, error, token },
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount >= MAX_MARKETPLACE_ARTIFACT_REDIRECTS) {
          await cancelResponseBody(response);
          throw artifactError(
            "REDIRECT_LIMIT_EXCEEDED",
            `${kind} artifact exceeded ${MAX_MARKETPLACE_ARTIFACT_REDIRECTS} redirects`,
          );
        }
        const location = response.headers?.get?.("location");
        if (!location) {
          await cancelResponseBody(response);
          throw artifactError(
            "INVALID_REDIRECT",
            `${kind} artifact redirect omitted Location`,
          );
        }
        let next;
        try {
          next = new URL(location, current);
        } catch {
          await cancelResponseBody(response);
          throw artifactError(
            "INVALID_REDIRECT",
            `${kind} artifact redirect Location is invalid`,
          );
        }
        await cancelResponseBody(response);
        current = assertMarketplaceArtifactUrlSafe(next.href, {
          registryOrigin,
          allowLoopbackHttp,
          label: `${kind} redirect`,
        });
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        const status = Number.isInteger(response.status)
          ? response.status
          : "unknown";
        const statusText = redactMarketplaceArtifactError(
          response.statusText || "",
          { token },
        );
        await cancelResponseBody(response);
        throw artifactError(
          "HTTP_ERROR",
          `${kind} artifact fetch failed: HTTP ${status}${
            statusText && statusText !== "unknown error" ? ` ${statusText}` : ""
          }`,
          {
            cacheFallbackAllowed:
              Number.isInteger(response.status) && response.status >= 500,
          },
        );
      }

      let bytes;
      try {
        bytes = await readBoundedResponse(response, {
          kind,
          maxBytes,
        });
      } catch (error) {
        if (timedOut) {
          throw artifactError(
            "TIMEOUT",
            `${kind} artifact fetch timed out after ${timeoutMs}ms`,
            { cacheFallbackAllowed: true, error, token },
          );
        }
        throw error;
      }
      const digest = sha256(bytes);
      if (expectedSha256 && digest !== expectedSha256) {
        throw artifactError(
          "DIGEST_MISMATCH",
          `${kind} artifact SHA-256 mismatch (expected ${expectedSha256}, got ${digest})`,
        );
      }
      const validation = await runByteValidator(validateBytes, bytes, kind);
      return {
        kind,
        url: sanitizeMarketplaceArtifactUrl(url.href),
        finalUrl: sanitizeMarketplaceArtifactUrl(current.href),
        sha256: digest,
        bytes,
        fromCache: false,
        redirectCount,
        validation,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedResponse(response, { kind, maxBytes }) {
  const declared = response.headers?.get?.("content-length");
  if (declared != null && String(declared).trim() !== "") {
    const normalized = String(declared).trim();
    if (!/^\d+$/.test(normalized)) {
      await cancelResponseBody(response);
      throw artifactError(
        "INVALID_CONTENT_LENGTH",
        `${kind} artifact returned an invalid Content-Length`,
      );
    }
    if (BigInt(normalized) > BigInt(maxBytes)) {
      await cancelResponseBody(response);
      throw artifactError(
        "CONTENT_TOO_LARGE",
        `${kind} artifact Content-Length exceeds ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  const append = (value) => {
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      throw artifactError(
        "CONTENT_TOO_LARGE",
        `${kind} artifact body exceeds ${maxBytes} bytes`,
      );
    }
    chunks.push(chunk);
  };

  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // The read or size error remains authoritative.
      }
      throw error;
    } finally {
      reader.releaseLock?.();
    }
  } else if (Symbol.asyncIterator in Object(response.body)) {
    try {
      for await (const chunk of response.body) append(chunk);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
  } else {
    await cancelResponseBody(response);
    throw artifactError(
      "UNREADABLE_BODY",
      `${kind} artifact response body is not readable`,
    );
  }
  return Buffer.concat(chunks, total);
}

async function cancelResponseBody(response) {
  const body = response?.body;
  if (!body) return;
  try {
    if (typeof body.cancel === "function") {
      await body.cancel();
      return;
    }
    if (typeof body.destroy === "function") {
      body.destroy();
      return;
    }
    if (typeof body.getReader === "function") {
      const reader = body.getReader();
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock?.();
      }
    }
  } catch {
    // A protocol/policy error is authoritative even if body cancellation fails.
  }
}

async function readCachedArtifact({
  url,
  kind,
  maxBytes,
  expectedSha256,
  cacheDir,
  validateBytes,
}) {
  const urlHash = sha256(url.href);
  const directory = path.join(cacheDir, urlHash);
  if (expectedSha256) {
    const cachePath = path.join(directory, `${expectedSha256}.bin`);
    if (!fs.existsSync(cachePath)) return null;
    assertCacheReadDirectorySafe(directory, kind);
    const result = await readAndVerifyCacheFile(cachePath, {
      kind,
      maxBytes,
      expectedSha256,
      validateBytes,
    });
    return cachedResult(url, result, kind);
  }
  if (!fs.existsSync(directory)) return null;
  assertCacheReadDirectorySafe(directory, kind);
  let entries;
  try {
    entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && /^[a-f0-9]{64}\.bin$/.test(entry.name),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    throw artifactError(
      "CACHE_READ_FAILED",
      `${kind} artifact immutable cache could not be read`,
      { error },
    );
  }
  if (entries.length > MAX_UNBOUND_CACHE_CANDIDATES) {
    throw artifactError(
      "CACHE_AMBIGUOUS",
      `${kind} artifact immutable cache has too many unbound candidates`,
    );
  }
  const matches = [];
  for (const entry of entries) {
    try {
      const result = await readAndVerifyCacheFile(
        path.join(directory, entry.name),
        {
          kind,
          maxBytes,
          expectedSha256: entry.name.slice(0, 64),
          validateBytes,
        },
      );
      matches.push(result);
    } catch {
      // Invalid, corrupted, or validator-mismatched unbound entries cannot be
      // cache authorities. A unique remaining valid entry is still usable.
    }
  }
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw artifactError(
      "CACHE_AMBIGUOUS",
      `${kind} artifact immutable cache has multiple valid unbound candidates`,
    );
  }
  return cachedResult(url, matches[0], kind);
}

async function readAndVerifyCacheFile(
  cachePath,
  { kind, maxBytes, expectedSha256, validateBytes },
) {
  const bytes = readBoundedRegularFile(cachePath, {
    maxBytes,
    inspectionCode: "CACHE_READ_FAILED",
    invalidCode: "CACHE_INVALID",
    label: `${kind} artifact immutable cache entry`,
  });
  const digest = sha256(bytes);
  if (digest !== expectedSha256) {
    throw artifactError(
      "CACHE_DIGEST_MISMATCH",
      `${kind} artifact immutable cache digest mismatch`,
    );
  }
  const validation = await runByteValidator(validateBytes, bytes, kind);
  return { bytes, sha256: digest, validation };
}

function cachedResult(url, result, kind) {
  return {
    kind,
    url: sanitizeMarketplaceArtifactUrl(url.href),
    finalUrl: sanitizeMarketplaceArtifactUrl(url.href),
    sha256: result.sha256,
    bytes: result.bytes,
    fromCache: true,
    redirectCount: 0,
    validation: result.validation,
  };
}

function writeImmutableCache(url, bytes, digest, cacheDir, maxBytes) {
  const cachePath = marketplaceRemoteArtifactCachePath(
    url.href,
    digest,
    cacheDir,
  );
  const directory = path.dirname(cachePath);
  let tempPath = null;
  let tempFd = null;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertCacheDirectorySafe(directory);
    tempPath = path.join(
      directory,
      `.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`,
    );
    tempFd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(tempFd, bytes);
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.linkSync(tempPath, cachePath);
        fsyncDirectoryBestEffort(directory);
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }

      const existing = inspectExistingCacheForPublish(cachePath, {
        bytes,
        digest,
        maxBytes,
      });
      if (existing === "equal") return;
      if (existing !== "truncated") {
        throw artifactError(
          "CACHE_WRITE_CONFLICT",
          "immutable marketplace artifact cache content conflict",
        );
      }
      removeUnchangedTruncatedCacheEntry(cachePath);
    }
    throw artifactError(
      "CACHE_WRITE_CONFLICT",
      "immutable marketplace artifact cache entry could not be published",
    );
  } catch (error) {
    if (error instanceof MarketplaceRemoteArtifactError) throw error;
    throw artifactError(
      "CACHE_WRITE_FAILED",
      "immutable marketplace artifact cache entry could not be published",
      { error },
    );
  } finally {
    if (tempFd != null) {
      try {
        fs.closeSync(tempFd);
      } catch {
        // The cache publication error remains authoritative.
      }
    }
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          // Best-effort cleanup; the hidden temp is never a cache candidate.
        }
      }
    }
  }
}

function assertCacheDirectorySafe(directory) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    throw artifactError(
      "CACHE_WRITE_FAILED",
      "immutable marketplace artifact cache directory could not be inspected",
      { error },
    );
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw artifactError(
      "CACHE_WRITE_FAILED",
      "immutable marketplace artifact cache directory is not a directory",
    );
  }
}

function assertCacheReadDirectorySafe(directory, kind) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    throw artifactError(
      "CACHE_READ_FAILED",
      `${kind} artifact immutable cache directory could not be inspected`,
      { error },
    );
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw artifactError(
      "CACHE_INVALID",
      `${kind} artifact immutable cache directory is not a directory`,
    );
  }
}

function inspectExistingCacheForPublish(
  cachePath,
  { bytes, digest, maxBytes },
) {
  const existing = readBoundedRegularFile(cachePath, {
    maxBytes,
    inspectionCode: "CACHE_WRITE_CONFLICT",
    invalidCode: "CACHE_WRITE_CONFLICT",
    label: "immutable marketplace artifact cache entry",
  });
  if (existing.length === bytes.length) {
    return sha256(existing) === digest && existing.equals(bytes)
      ? "equal"
      : "conflict";
  }
  return existing.length < bytes.length ? "truncated" : "conflict";
}

function removeUnchangedTruncatedCacheEntry(cachePath) {
  let before;
  let after;
  try {
    before = fs.lstatSync(cachePath, { bigint: true });
    after = fs.lstatSync(cachePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw artifactError(
      "CACHE_WRITE_CONFLICT",
      "immutable marketplace artifact cache entry could not be repaired",
      { error },
    );
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs
  ) {
    throw artifactError(
      "CACHE_WRITE_CONFLICT",
      "immutable marketplace artifact cache entry changed during repair",
    );
  }
  try {
    fs.unlinkSync(cachePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw artifactError(
        "CACHE_WRITE_CONFLICT",
        "immutable marketplace artifact cache entry could not be repaired",
        { error },
      );
    }
  }
}

function readBoundedRegularFile(
  filePath,
  { maxBytes, inspectionCode, invalidCode, label },
) {
  let descriptor = null;
  try {
    const linkStat = fs.lstatSync(filePath);
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
      throw artifactError(invalidCode, `${label} is not a regular file`);
    }
    if (linkStat.size > maxBytes) {
      throw artifactError(invalidCode, `${label} exceeds ${maxBytes} bytes`);
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const fileStat = fs.fstatSync(descriptor);
    if (!fileStat.isFile() || fileStat.size > maxBytes) {
      throw artifactError(
        invalidCode,
        `${label} is not a bounded regular file`,
      );
    }
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, maxBytes + 1 - total),
      );
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    if (total > maxBytes) {
      throw artifactError(invalidCode, `${label} exceeds ${maxBytes} bytes`);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof MarketplaceRemoteArtifactError) throw error;
    throw artifactError(inspectionCode, `${label} could not be read`, {
      error,
    });
  } finally {
    if (descriptor != null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The inspection result remains authoritative.
      }
    }
  }
}

function fsyncDirectoryBestEffort(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Some platforms/filesystems do not support directory fsync.
  } finally {
    if (descriptor != null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Best effort only.
      }
    }
  }
}

function materializeSignatureBundle(signatureBytes, publicKeyBytes) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-marketplace-artifacts-"),
  );
  const signatureFile = path.join(tempDir, "manifest.sig");
  const publicKeyFile = path.join(tempDir, "publisher.pem");
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 25,
    });
    cleaned = true;
  };
  try {
    fs.writeFileSync(signatureFile, signatureBytes, { mode: 0o600 });
    fs.writeFileSync(publicKeyFile, publicKeyBytes, { mode: 0o600 });
    return { signatureFile, publicKeyFile, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function normalizeSignatureSpec(value) {
  const publicKey = objectValue(value.publicKey);
  const algorithm = cleanString(value.algorithm || "ed25519", 64).toLowerCase();
  if (algorithm !== "ed25519") {
    throw artifactError(
      "UNSUPPORTED_SIGNATURE_ALGORITHM",
      "marketplace remote signatures must use ed25519",
    );
  }
  const url = requiredUrl(value.url, "signature");
  const publicKeyUrl = requiredUrl(
    value.publicKeyUrl || publicKey?.url,
    "signature public key",
  );
  const publicKeySha256 = normalizeSha256(
    value.publicKeySha256 || publicKey?.spkiSha256,
    "signature public-key SPKI SHA-256",
  );
  return {
    algorithm,
    url,
    sha256: normalizeSha256(
      value.sha256 || value.digest,
      "signature document SHA-256",
      { optional: true },
    ),
    publicKeyUrl,
    publicKeySha256,
    publicKeyDocumentSha256: normalizeSha256(
      value.publicKeyDocumentSha256 || publicKey?.sha256,
      "public-key document SHA-256",
      { optional: true },
    ),
  };
}

function normalizeSbomSpec(value) {
  return {
    url: requiredUrl(value.url, "SBOM"),
    sha256: normalizeSha256(
      value.digest || value.sha256,
      "SBOM document SHA-256",
    ),
    format: cleanString(value.format, 128) || null,
  };
}

function verifyPublicKeyDocument(bytes, expectedSpkiSha256, algorithm) {
  let key;
  try {
    assertStrictSpkiPublicKeyPem(bytes);
    key = crypto.createPublicKey({ key: bytes, format: "pem", type: "spki" });
  } catch (error) {
    if (error instanceof MarketplaceRemoteArtifactError) throw error;
    throw artifactError(
      "INVALID_PUBLIC_KEY",
      "marketplace public-key document must be a strict SPKI PUBLIC KEY PEM document",
      { error },
    );
  }
  if (algorithm === "ed25519" && key.asymmetricKeyType !== "ed25519") {
    throw artifactError(
      "INVALID_PUBLIC_KEY",
      "marketplace public key is not an ed25519 key",
    );
  }
  const spkiSha256 = sha256(key.export({ type: "spki", format: "der" }));
  if (spkiSha256 !== expectedSpkiSha256) {
    throw artifactError(
      "PUBLIC_KEY_FINGERPRINT_MISMATCH",
      `marketplace public-key SPKI SHA-256 mismatch (expected ${expectedSpkiSha256}, got ${spkiSha256})`,
    );
  }
  return {
    spkiSha256,
    asymmetricKeyType: key.asymmetricKeyType,
  };
}

function assertStrictSpkiPublicKeyPem(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw artifactError(
      "INVALID_PUBLIC_KEY_CONTAINER",
      "marketplace public-key PEM must be valid UTF-8",
    );
  }
  if (
    !/^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----\r?\n?$/.test(
      text,
    )
  ) {
    throw artifactError(
      "INVALID_PUBLIC_KEY_CONTAINER",
      "marketplace public-key PEM must contain exactly one PUBLIC KEY block",
    );
  }
}

async function runByteValidator(validateBytes, bytes, kind) {
  if (!validateBytes) return null;
  try {
    return (await validateBytes(bytes)) ?? null;
  } catch (error) {
    if (error instanceof MarketplaceRemoteArtifactError) throw error;
    throw artifactError(
      "ARTIFACT_VALIDATION_FAILED",
      `${kind} artifact validation failed: ${redactMarketplaceArtifactError(
        error?.message || error,
      )}`,
      { error },
    );
  }
}

function normalizeAuthorizationOrigin(
  value,
  _artifactUrl,
  _token,
  allowInsecure,
) {
  if (!value) return null;
  const url = assertRegistryUrlSafe(value, allowInsecure === true);
  return url.origin;
}

function normalizeTrustedRegistryOrigin(value, allowInsecure) {
  if (!value) return null;
  return assertRegistryUrlSafe(value, allowInsecure).origin;
}

function assertRegistryUrlSafe(value, allowInsecure) {
  return assertMarketplaceArtifactUrlSafe(value, {
    allowLoopbackHttp: true,
    allowInsecureRegistry: allowInsecure,
    allowPrivateNetwork: true,
    label: "registry",
  });
}

function normalizeOriginString(value, label) {
  const raw = String(value || "");
  if (raw.length > MAX_MARKETPLACE_ARTIFACT_URL_LENGTH) {
    throw artifactError(
      "URL_TOO_LONG",
      `${label} exceeds ${MAX_MARKETPLACE_ARTIFACT_URL_LENGTH} characters`,
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw artifactError("INVALID_URL", `${label} is invalid`);
  }
  if (url.username || url.password) {
    throw artifactError(
      "URL_CREDENTIALS_REJECTED",
      `${label} must not contain credentials`,
    );
  }
  return url.origin;
}

function requiredUrl(value, label) {
  const raw = String(value == null ? "" : value);
  if (!raw.trim()) {
    throw artifactError(
      "INCOMPLETE_ARTIFACT_DECLARATION",
      `${label} URL is required for remote artifact verification`,
    );
  }
  if (raw.length > MAX_MARKETPLACE_ARTIFACT_URL_LENGTH) {
    throw artifactError(
      "URL_TOO_LONG",
      `${label} URL exceeds ${MAX_MARKETPLACE_ARTIFACT_URL_LENGTH} characters`,
    );
  }
  return raw;
}

function normalizeArtifactKind(value) {
  const kind = String(value || "");
  if (!(kind in MARKETPLACE_REMOTE_ARTIFACT_LIMITS)) {
    throw artifactError("INVALID_ARTIFACT_KIND", "artifact kind is invalid");
  }
  return kind;
}

function normalizeSha256(value, label, { optional = false } = {}) {
  if (value == null || String(value).trim() === "") {
    if (optional) return null;
    throw artifactError(
      "INCOMPLETE_ARTIFACT_DECLARATION",
      `${label} is required`,
    );
  }
  const digest = String(value).trim().toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw artifactError("INVALID_DIGEST", `${label} is invalid`);
  }
  return digest;
}

function normalizeBearerToken(value) {
  if (value == null || value === "") return null;
  const token = String(value);
  if (token.length > 8192 || !/^[A-Za-z0-9\-._~+/]+=*$/.test(token)) {
    throw artifactError("INVALID_TOKEN", "registry bearer token is invalid");
  }
  return token;
}

function normalizePositiveInteger(value, fallback, min, max, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw artifactError(
      "INVALID_LIMIT",
      `${label} must be an integer from ${min} to ${max}`,
    );
  }
  return number;
}

function marketplaceArtifactCacheRoot(value) {
  return path.resolve(
    value ||
      path.join(getElectronUserDataDir(), "plugin-marketplace-artifact-cache"),
  );
}

function artifactWasRequested(value, fields) {
  if (!value) return false;
  return fields.some((field) => {
    const candidate = value[field];
    return candidate != null && candidate !== "";
  });
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function cleanString(value, max) {
  return String(value == null ? "" : value)
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, max);
}

function isLoopbackHostname(value) {
  const host = String(value || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

async function assertMarketplaceArtifactNetworkTargetSafe(
  url,
  { kind, registryOrigin, resolveHostname },
) {
  if (registryOrigin && url.origin === registryOrigin) return;
  if (url.protocol !== "https:") {
    // Standalone loopback HTTP is allowed only as an explicit local test/dev
    // boundary by the synchronous URL policy above.
    if (!registryOrigin && isLoopbackHostname(url.hostname)) return;
    throw artifactError(
      "UNSAFE_URL",
      `${kind} artifact cross-origin requests must use HTTPS`,
    );
  }
  if (isRestrictedNetworkHostname(url.hostname)) {
    throw artifactError(
      "UNSAFE_NETWORK_TARGET",
      `${kind} artifact must not target a private or local network address`,
    );
  }
  if (net.isIP(stripHostnameBrackets(url.hostname)) || !resolveHostname) {
    // Custom fetch implementations form an explicit test boundary unless a
    // resolver is injected. Production fetches always use the default DNS
    // resolver immediately before each request/redirect hop.
    return;
  }

  let resolved;
  try {
    resolved = await resolveHostname(stripHostnameBrackets(url.hostname));
  } catch (error) {
    throw artifactError(
      "DNS_RESOLUTION_FAILED",
      `${kind} artifact hostname could not be resolved safely`,
      { cacheFallbackAllowed: true, error },
    );
  }
  const addresses = normalizeResolvedAddresses(resolved);
  if (addresses.length === 0) {
    throw artifactError(
      "DNS_RESOLUTION_FAILED",
      `${kind} artifact hostname did not resolve to an address`,
      { cacheFallbackAllowed: true },
    );
  }
  if (addresses.some((address) => isRestrictedNetworkAddress(address))) {
    throw artifactError(
      "UNSAFE_NETWORK_TARGET",
      `${kind} artifact hostname resolved to a private or local network address`,
    );
  }
}

function normalizeResolvedAddresses(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) =>
      typeof entry === "string" ? entry : String(entry?.address || ""),
    )
    .filter((address) => net.isIP(stripHostnameBrackets(address)) !== 0);
}

function isRestrictedNetworkHostname(value) {
  const hostname = stripHostnameBrackets(value).toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "localhost.localdomain" ||
    hostname === "metadata" ||
    hostname === "instance-data" ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata.azure.internal" ||
    hostname.endsWith(".localhost")
  ) {
    return true;
  }
  return net.isIP(hostname) !== 0 && isRestrictedNetworkAddress(hostname);
}

function isRestrictedNetworkAddress(value) {
  const address = stripHostnameBrackets(value).toLowerCase();
  const family = net.isIP(address);
  if (family === 4) return isRestrictedIpv4(address);
  if (family !== 6) return true;
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return true;
  const allZeroPrefix = (length) =>
    bytes.subarray(0, length).every((part) => part === 0);
  if (
    bytes.every((part) => part === 0) ||
    (allZeroPrefix(15) && bytes[15] === 1) ||
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x0d &&
      bytes[3] === 0xb8)
  ) {
    return true;
  }
  const mappedIpv4 =
    (allZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) ||
    allZeroPrefix(12) ||
    (bytes[0] === 0x00 &&
      bytes[1] === 0x64 &&
      bytes[2] === 0xff &&
      bytes[3] === 0x9b &&
      bytes.subarray(4, 12).every((part) => part === 0));
  if (mappedIpv4) return isRestrictedIpv4Bytes(bytes.subarray(12));
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isRestrictedIpv4Bytes(bytes.subarray(2, 6));
  }
  return false;
}

function parseIpv6Bytes(value) {
  let address = String(value).toLowerCase();
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const ipv4 = address.slice(separator + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    address = `${address.slice(0, separator)}:${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    left.concat(right).some((part) => !/^[a-f0-9]{1,4}$/.test(part))
  ) {
    return null;
  }
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) =>
    bytes.writeUInt16BE(parseInt(group, 16), index * 2),
  );
  return bytes;
}

function isRestrictedIpv4Bytes(bytes) {
  return isRestrictedIpv4(Array.from(bytes).join("."));
}

function isRestrictedIpv4(value) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function stripHostnameBrackets(value) {
  return String(value || "").replace(/^\[|\]$/g, "");
}

function acceptHeader(kind) {
  if (kind === "sbom") {
    return "application/json, application/xml;q=0.9, application/octet-stream;q=0.8";
  }
  if (kind === "publicKey") {
    return "application/x-pem-file, application/octet-stream;q=0.8";
  }
  return "application/octet-stream";
}

function normalizeFetchError(error, { kind, token }) {
  if (error instanceof MarketplaceRemoteArtifactError) return error;
  return artifactError(
    "FETCH_FAILED",
    `${kind} artifact fetch failed: ${redactMarketplaceArtifactError(
      error?.message || error,
      { token },
    )}`,
    { cacheFallbackAllowed: true, error, token },
  );
}

function artifactError(
  code,
  message,
  { cacheFallbackAllowed = false, error = null, token = null } = {},
) {
  const safeCause = error
    ? new Error(
        redactMarketplaceArtifactError(error?.message || error, { token }),
      )
    : undefined;
  return new MarketplaceRemoteArtifactError(
    code,
    redactMarketplaceArtifactError(message, { token }),
    { cacheFallbackAllowed, cause: safeCause },
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
