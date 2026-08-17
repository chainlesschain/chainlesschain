import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyInstalledSignature } from "./signature.js";

export const PLUGIN_PUBLISHER_AUTHORITY_SCHEMA =
  "cc-plugin-publisher-authority/v1";

const DIGEST_RE = /^[a-f0-9]{64}$/u;
const MAX_POLICY_ENTRIES = 256;

export function normalizePublisherDeclaration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = bounded(value.id, 256);
  const organizationId = bounded(
    value.organizationId ?? value.organization,
    256,
  );
  if (!id || !organizationId) return null;
  return { id, organizationId };
}

export function normalizePublisherAuthority(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publisher = normalizePublisherDeclaration(value.publisher);
  const subject = value.subject;
  const normalized = {
    schemaVersion: value.schemaVersion,
    status: value.status,
    trustSource: value.trustSource,
    publisher,
    subject: {
      name: bounded(subject?.name, 256),
      registryOrigin: normalizeOrigin(subject?.registryOrigin),
      signingKeySha256: String(subject?.signingKeySha256 || "").toLowerCase(),
    },
    trustRootId: bounded(value.trustRootId, 256),
    policyDigest: String(value.policyDigest || "").toLowerCase(),
    verifiedAt: optionalTime(value.verifiedAt, "publisher verifiedAt"),
    claims: {
      publisherIdentityVerified:
        value.claims?.publisherIdentityVerified === true,
      organizationTrustRootMatched:
        value.claims?.organizationTrustRootMatched === true,
      signingKeyNotRevoked: value.claims?.signingKeyNotRevoked === true,
      manifestSignatureVerified:
        value.claims?.manifestSignatureVerified === true,
    },
  };
  if (
    normalized.schemaVersion !== PLUGIN_PUBLISHER_AUTHORITY_SCHEMA ||
    normalized.status !== "verified" ||
    normalized.trustSource !== "managed-settings" ||
    !normalized.publisher ||
    !normalized.subject.name ||
    !normalized.subject.registryOrigin ||
    !DIGEST_RE.test(normalized.subject.signingKeySha256) ||
    !normalized.trustRootId ||
    !DIGEST_RE.test(normalized.policyDigest) ||
    !normalized.verifiedAt ||
    Object.values(normalized.claims).some((claim) => claim !== true)
  ) {
    return null;
  }
  const authorityDigest = String(value.authorityDigest || "").toLowerCase();
  if (
    !DIGEST_RE.test(authorityDigest) ||
    authorityDigest !== sha256Canonical(normalized)
  ) {
    return null;
  }
  const complete = { ...normalized, authorityDigest };
  return canonicalJson(complete) === canonicalJson(value) ? complete : null;
}

export function buildManagedPublisherAuthority({
  name,
  registryUrl,
  declaration,
  signingKeySha256,
  managed,
  verifiedAt = new Date().toISOString(),
  evaluatedAt = verifiedAt,
} = {}) {
  const required = managed?.requireTrustedPluginPublishers === true;
  const publisher = normalizePublisherDeclaration(declaration);
  if (!publisher) {
    if (required) {
      throw new Error("TRUSTED_PLUGIN_PUBLISHER_REQUIRED: declaration missing");
    }
    return null;
  }
  const key = String(signingKeySha256 || "").toLowerCase();
  if (!DIGEST_RE.test(key)) {
    if (required) {
      throw new Error("TRUSTED_PLUGIN_PUBLISHER_REQUIRED: signed key missing");
    }
    return null;
  }
  const registryOrigin = normalizeOrigin(registryUrl);
  if (!registryOrigin) {
    throw new Error("plugin publisher registry origin is invalid");
  }
  const recordedAt = canonicalTime(verifiedAt, "publisher verification time");
  const now = canonicalTime(evaluatedAt, "publisher policy evaluation time");
  const revocations = normalizeRevocations(managed?.revokedPluginPublisherKeys);
  if (revocations.has(key)) {
    throw new Error(`PLUGIN_PUBLISHER_KEY_REVOKED (${key})`);
  }
  const entries = normalizeTrustEntries(managed?.trustedPluginPublishers);
  const match = entries.find(
    (entry) =>
      entry.publisherId === publisher.id &&
      entry.organizationId === publisher.organizationId &&
      entry.pluginNames.includes(String(name)) &&
      entry.registryOrigins.includes(registryOrigin) &&
      entry.signingKeySha256.includes(key) &&
      (!entry.notBefore || now >= entry.notBefore) &&
      (!entry.notAfter || now <= entry.notAfter),
  );
  if (!match) {
    if (required || entries.length > 0) {
      throw new Error(
        `PLUGIN_PUBLISHER_TRUST_MISMATCH (${publisher.organizationId}/${publisher.id}; ${name}; ${registryOrigin}; ${key})`,
      );
    }
    return null;
  }
  const withoutDigest = {
    schemaVersion: PLUGIN_PUBLISHER_AUTHORITY_SCHEMA,
    status: "verified",
    trustSource: "managed-settings",
    publisher,
    subject: {
      name: String(name),
      registryOrigin,
      signingKeySha256: key,
    },
    trustRootId: match.trustRootId,
    policyDigest: sha256Canonical(match),
    verifiedAt: recordedAt,
    claims: {
      publisherIdentityVerified: true,
      organizationTrustRootMatched: true,
      signingKeyNotRevoked: true,
      manifestSignatureVerified: true,
    },
  };
  return { ...withoutDigest, authorityDigest: sha256Canonical(withoutDigest) };
}

export function verifyInstalledManagedPublisherAuthority(
  { root, name },
  managed,
) {
  const required = managed?.requireTrustedPluginPublishers === true;
  let raw;
  try {
    const file = path.join(root, ".plugin-source.json");
    const stat = fs.lstatSync(file);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      stat.size > 96 * 1024
    ) {
      throw new Error("source metadata authority file is unsafe");
    }
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return required
      ? { verified: false, present: false, reason: error.message }
      : { verified: false, present: false, reason: null };
  }
  const recorded = raw?.catalogAuthority?.publisherAuthority;
  if (!recorded) {
    return required
      ? {
          verified: false,
          present: false,
          reason: "trusted publisher authority is missing",
        }
      : { verified: false, present: false, reason: null };
  }
  try {
    const signature = verifyInstalledSignature({ root });
    if (!signature.signed) {
      throw new Error(
        `installed manifest signature is invalid: ${signature.reason}`,
      );
    }
    const rebuilt = buildManagedPublisherAuthority({
      name,
      registryUrl: raw.registry,
      declaration: raw.catalogAuthority?.publisherDeclaration,
      signingKeySha256: signature.publicKeySha256,
      managed,
      verifiedAt: recorded.verifiedAt,
      evaluatedAt: new Date().toISOString(),
    });
    if (!rebuilt || canonicalJson(rebuilt) !== canonicalJson(recorded)) {
      throw new Error("persisted publisher authority no longer matches policy");
    }
    return {
      verified: true,
      present: true,
      reason: null,
      authority: rebuilt,
    };
  } catch (error) {
    return { verified: false, present: true, reason: error.message };
  }
}

function normalizeTrustEntries(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_POLICY_ENTRIES) {
    throw new Error("trustedPluginPublishers must be a bounded array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`trustedPluginPublishers[${index}] is invalid`);
    }
    const trustRootId = bounded(entry.trustRootId, 256);
    const publisherId = bounded(entry.publisherId, 256);
    const organizationId = bounded(entry.organizationId, 256);
    const pluginNames = stringList(entry.pluginNames, 256, 256);
    const registryOrigins = stringList(entry.registryOrigins, 32, 4096).map(
      (url) => normalizeOrigin(url),
    );
    const signingKeySha256 = stringList(entry.signingKeySha256, 32, 64).map(
      (digest) => digest.toLowerCase(),
    );
    if (
      !trustRootId ||
      !publisherId ||
      !organizationId ||
      pluginNames.length === 0 ||
      registryOrigins.some((origin) => !origin) ||
      signingKeySha256.length === 0 ||
      signingKeySha256.some((digest) => !DIGEST_RE.test(digest))
    ) {
      throw new Error(`trustedPluginPublishers[${index}] is incomplete`);
    }
    const notBefore = optionalTime(entry.notBefore, `entry ${index} notBefore`);
    const notAfter = optionalTime(entry.notAfter, `entry ${index} notAfter`);
    if (notBefore && notAfter && notBefore > notAfter) {
      throw new Error(`trustedPluginPublishers[${index}] validity is inverted`);
    }
    return {
      trustRootId,
      publisherId,
      organizationId,
      pluginNames: [...new Set(pluginNames)].sort(),
      registryOrigins: [...new Set(registryOrigins)].sort(),
      signingKeySha256: [...new Set(signingKeySha256)].sort(),
      notBefore,
      notAfter,
    };
  });
}

function normalizeRevocations(value) {
  if (value == null) return new Set();
  if (!Array.isArray(value) || value.length > MAX_POLICY_ENTRIES * 4) {
    throw new Error("revokedPluginPublisherKeys must be a bounded array");
  }
  const result = new Set();
  for (const [index, raw] of value.entries()) {
    const digest = String(
      typeof raw === "string" ? raw : raw?.sha256 || "",
    ).toLowerCase();
    if (!DIGEST_RE.test(digest)) {
      throw new Error(`revokedPluginPublisherKeys[${index}] is invalid`);
    }
    result.add(digest);
  }
  return result;
}

function stringList(value, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  return value.map((item) => bounded(item, maxLength)).filter(Boolean);
}

function bounded(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  const hasControl = [...text].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
  return text && text.length <= max && !hasControl ? text : null;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value));
    if (!new Set(["https:", "http:"]).has(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function optionalTime(value, label) {
  return value == null ? null : canonicalTime(value, label);
}

function canonicalTime(value, label) {
  const date = new Date(String(value));
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== String(value)
  ) {
    throw new Error(`${label} must be canonical ISO-8601 UTC`);
  }
  return date.toISOString();
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
