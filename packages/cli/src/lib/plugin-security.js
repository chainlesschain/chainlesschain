import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  loadManagedSettings,
  managedSettingsPath,
} from "./settings-loader.cjs";
import { canonicalizePluginSource } from "./plugin-source-identity.js";

export { canonicalizePluginSource } from "./plugin-source-identity.js";

const BLOCKED_SOURCE_KEYS = ["blockedPluginSources", "blockedMarketplaces"];
const ALLOWED_SOURCE_KEYS = [
  "allowedPluginSources",
  "strictKnownMarketplaces",
  "allowedMarketplaces",
];
const KNOWN_MARKETPLACE_KEYS = [
  "extraKnownMarketplaces",
  "additionalMarketplaces",
];
const STANDARD_GITHUB_SSH_PRINCIPAL = createHash("sha256")
  .update("git")
  .digest("hex");
let managedPolicyCache = new Map();

function stringSet(value, label) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw invalidPolicy(`${label} must be an array`);
  const normalized = value.map((entry, index) => {
    let candidate = entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const keys = Object.keys(entry);
      if (keys.length !== 1 || !["name", "source", "url"].includes(keys[0])) {
        throw invalidPolicy(`${label}[${index}] is invalid`);
      }
      candidate = entry[keys[0]];
    }
    if (typeof candidate !== "string") {
      throw invalidPolicy(`${label}[${index}] must name a plugin`);
    }
    const result = candidate.trim();
    if (
      !result ||
      result.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(result)
    ) {
      throw invalidPolicy(`${label}[${index}] must be a bounded string`);
    }
    return result;
  });
  return new Set(normalized);
}

function invalidPolicy(message) {
  const error = new Error(
    `managed plugin source policy is invalid: ${message}`,
  );
  error.code = "PLUGIN_SOURCE_POLICY_INVALID";
  return error;
}

function listSetting(managed, key) {
  if (!Object.prototype.hasOwnProperty.call(managed, key)) return null;
  if (!Array.isArray(managed[key])) {
    throw invalidPolicy(`${key} must be an array`);
  }
  return managed[key];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function immutablePolicySnapshot(value) {
  if (value == null) return null;
  const snapshot = canonicalJson(value);
  const freeze = (entry) => {
    if (!entry || typeof entry !== "object" || Object.isFrozen(entry)) {
      return entry;
    }
    for (const child of Object.values(entry)) freeze(child);
    return Object.freeze(entry);
  };
  return freeze(snapshot);
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)))
    .digest("hex");
}

function knownMarketplaces(managed, options) {
  const known = new Map();
  for (const setting of KNOWN_MARKETPLACE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(managed, setting)) continue;
    const declarations = managed[setting];
    // The array form contains anonymous direct sources and therefore has no
    // name to resolve. It remains a valid compatibility form, but every entry
    // must still compile so damaged managed settings cannot become inert.
    if (Array.isArray(declarations)) {
      declarations.forEach((declaration) =>
        canonicalizePluginSource(declaration, {
          policyEntry: true,
          cwd: options.cwd,
        }),
      );
      continue;
    }
    if (!declarations || typeof declarations !== "object") {
      throw invalidPolicy(`${setting} must be an object or array`);
    }
    for (const [rawName, declaration] of Object.entries(declarations)) {
      const name = String(rawName).trim().toLowerCase();
      if (!name)
        throw invalidPolicy(`${setting} has an empty marketplace name`);
      const identity = canonicalizePluginSource(declaration, {
        policyEntry: true,
        cwd: options.cwd,
      });
      const previous = known.get(name);
      if (previous && digest(previous) !== digest(identity)) {
        throw invalidPolicy(
          `${setting} conflicts with its compatibility alias for marketplace ${rawName}`,
        );
      }
      known.set(name, identity);
    }
  }
  return known;
}

function sourceIdentity(value, known, options) {
  if (options.policyEntry === true) {
    let aliasName = typeof value === "string" ? value : null;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "name") aliasName = value.name;
      if (keys.length === 1 && keys[0] === "source") {
        aliasName = value.source;
      }
    }
    const alias =
      typeof aliasName === "string"
        ? known.get(aliasName.trim().toLowerCase())
        : null;
    if (alias) return { ...alias };
  }
  return canonicalizePluginSource(value, options);
}

function matchesSource(rule, source) {
  if (rule.kind === "github-owner") {
    return (
      source.kind === "github" &&
      source.authority === "github.com" &&
      ((source.scheme === "https" && !source.principalDigest) ||
        (source.scheme === "ssh" &&
          source.principalDigest === STANDARD_GITHUB_SSH_PRINCIPAL)) &&
      source.owner === rule.owner
    );
  }
  return (
    (rule.identityDigest || rule.key) ===
      (source.identityDigest || source.key) &&
    (rule.ref ?? null) === (source.ref ?? null) &&
    (rule.path ?? null) === (source.path ?? null)
  );
}

function compileSourcePolicy(managed, options) {
  const known = knownMarketplaces(managed, options);
  const blocked = [];
  const allowedGroups = [];
  for (const setting of BLOCKED_SOURCE_KEYS) {
    const entries = listSetting(managed, setting);
    entries?.forEach((entry, index) =>
      blocked.push({
        setting,
        index,
        identity: sourceIdentity(entry, known, {
          policyEntry: true,
          cwd: options.cwd,
        }),
      }),
    );
  }
  for (const setting of ALLOWED_SOURCE_KEYS) {
    const entries = listSetting(managed, setting);
    if (!entries) continue;
    allowedGroups.push({
      setting,
      rules: entries.map((entry, index) => ({
        setting,
        index,
        identity: sourceIdentity(entry, known, {
          policyEntry: true,
          cwd: options.cwd,
        }),
      })),
    });
  }
  const projection = {
    blocked,
    allowedGroups,
  };
  return { known, blocked, allowedGroups, policyDigest: digest(projection) };
}

/** Pure, deterministic projection for audit logs and policy rollback checks. */
export function evaluatePluginSourcePolicy(source, managed, options = {}) {
  if (!managed) {
    return {
      allowed: true,
      status: "unmanaged",
      source: null,
      policyDigest: null,
      matchedRule: null,
      allowedBy: [],
    };
  }
  if (typeof managed !== "object" || Array.isArray(managed)) {
    throw invalidPolicy("settings root must be an object");
  }
  const policy = compileSourcePolicy(managed, options);
  const restricted =
    policy.blocked.length > 0 ||
    (!options.blockedOnly && policy.allowedGroups.length > 0);
  if (!restricted) {
    return {
      allowed: true,
      status: "unrestricted",
      source: null,
      policyDigest: policy.policyDigest,
      matchedRule: null,
      allowedBy: [],
    };
  }
  if (source == null || (typeof source === "string" && !source.trim())) {
    const requiresAllowlist =
      !options.blockedOnly && policy.allowedGroups.length > 0;
    return {
      allowed: !requiresAllowlist,
      status: requiresAllowlist ? "not-allowed" : "unrestricted",
      source: null,
      policyDigest: policy.policyDigest,
      matchedRule: null,
      allowedBy: [],
    };
  }
  const identity = sourceIdentity(source, policy.known, {
    cwd: options.cwd,
    kindHint: options.kindHint,
  });
  const blocked = policy.blocked.find((rule) =>
    matchesSource(rule.identity, identity),
  );
  if (blocked) {
    return {
      allowed: false,
      status: "blocked",
      source: identity,
      policyDigest: policy.policyDigest,
      matchedRule: blocked,
      allowedBy: [],
    };
  }
  if (options.blockedOnly) {
    return {
      allowed: true,
      status: "not-blocked",
      source: identity,
      policyDigest: policy.policyDigest,
      matchedRule: null,
      allowedBy: [],
    };
  }
  const allowedBy = [];
  for (const group of policy.allowedGroups) {
    const match = group.rules.find((rule) =>
      matchesSource(rule.identity, identity),
    );
    if (!match) {
      return {
        allowed: false,
        status: "not-allowed",
        source: identity,
        policyDigest: policy.policyDigest,
        matchedRule: { setting: group.setting, index: null, identity: null },
        allowedBy,
      };
    }
    allowedBy.push(match);
  }
  return {
    allowed: true,
    status: "allowed",
    source: identity,
    policyDigest: policy.policyDigest,
    matchedRule: null,
    allowedBy,
  };
}

/** Enforce source policy before registry transport or git materialization. */
export function enforcePluginSourcePolicy(source, managed, options = {}) {
  const decision = evaluatePluginSourcePolicy(source, managed, options);
  if (decision.allowed) return decision;
  const error = new Error(
    decision.status === "blocked"
      ? `plugin source "${decision.source?.key || "(missing)"}" is blocked by managed settings`
      : source == null
        ? "managed settings require --source for plugin installation"
        : `plugin source "${decision.source?.key || "(invalid)"}" is not in the managed allowlist`,
  );
  error.code =
    decision.status === "blocked"
      ? "PLUGIN_SOURCE_POLICY_BLOCKED"
      : "PLUGIN_SOURCE_POLICY_NOT_ALLOWED";
  error.sourceIdentity = decision.source?.key || null;
  error.sourceDigest = decision.source
    ? digest({
        identity: decision.source.identityDigest || decision.source.key || null,
        ref: decision.source.ref ?? null,
        path: decision.source.path ?? null,
      })
    : null;
  error.policyDigest = decision.policyDigest;
  error.policySetting = decision.matchedRule?.setting || null;
  throw error;
}

export function enforcePluginPolicy(
  {
    name,
    source = null,
    sourceKind = null,
    sourcePolicyPreflighted = false,
    action = "install",
  },
  managed,
) {
  if (!managed) return { allowed: true };
  const denied = stringSet(managed.deniedPlugins, "deniedPlugins") || new Set();
  const allowed = stringSet(managed.allowedPlugins, "allowedPlugins");
  if (denied.has(name)) {
    throw new Error(`plugin "${name}" is denied by managed settings`);
  }
  if (allowed && !allowed.has(name)) {
    throw new Error(`plugin "${name}" is not in the managed allowlist`);
  }
  const sourceDecision =
    sourcePolicyPreflighted ||
    action === "load" ||
    (source == null && action !== "install")
      ? null
      : enforcePluginSourcePolicy(source, managed, {
          action,
          kindHint: sourceKind,
        });
  return { allowed: true, sourceDecision };
}

export function verifyPluginManifest({
  manifestFile,
  expectedSha256,
  signatureFile,
  publicKeyFile,
  expectedSignatureSha256 = null,
  expectedPublicKeyDocumentSha256 = null,
  expectedPublicKeySha256 = null,
  requireSignature = false,
  trustedKeySha256 = null,
  requireTrustedKey = false,
}) {
  if (!manifestFile) {
    if (requireSignature) {
      throw new Error("managed settings require a signed plugin manifest");
    }
    return null;
  }
  const bytes = readFileSync(manifestFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    expectedSha256 &&
    sha256.toLowerCase() !== String(expectedSha256).toLowerCase()
  ) {
    throw new Error(
      `plugin manifest SHA-256 mismatch (expected ${expectedSha256}, got ${sha256})`,
    );
  }

  const wantsSignature =
    requireSignature ||
    signatureFile ||
    publicKeyFile ||
    expectedSignatureSha256 ||
    expectedPublicKeyDocumentSha256 ||
    expectedPublicKeySha256;
  let signatureVerified = false;
  let signature = null;
  let publicKeyPem = null;
  let publicKeySha256 = null;
  let signatureSha256 = null;
  let publicKeyDocumentSha256 = null;
  if (wantsSignature) {
    if (!signatureFile || !publicKeyFile) {
      throw new Error(
        "plugin signature verification requires --signature and --public-key",
      );
    }
    signature = readFileSync(signatureFile);
    const publicKeyDocument = readFileSync(publicKeyFile);
    signatureSha256 = createHash("sha256").update(signature).digest("hex");
    publicKeyDocumentSha256 = createHash("sha256")
      .update(publicKeyDocument)
      .digest("hex");
    assertExpectedDigest(
      signatureSha256,
      expectedSignatureSha256,
      "plugin detached signature",
    );
    assertExpectedDigest(
      publicKeyDocumentSha256,
      expectedPublicKeyDocumentSha256,
      "plugin public-key document",
    );
    const publicKeyDocumentText = publicKeyDocument.toString("utf8");
    const publicKeyContainer = publicKeyDocumentText.trim();
    if (
      !/^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----$/.test(
        publicKeyContainer,
      )
    ) {
      throw new Error(
        "plugin public-key document must be a PEM SPKI PUBLIC KEY container",
      );
    }
    const keyObject = createPublicKey(publicKeyContainer);
    publicKeySha256 = createHash("sha256")
      .update(keyObject.export({ type: "spki", format: "der" }))
      .digest("hex");
    assertExpectedDigest(
      publicKeySha256,
      expectedPublicKeySha256,
      "plugin public-key SPKI",
    );
    publicKeyPem = publicKeyDocumentText;
    const trusted = stringSet(trustedKeySha256);
    if (requireTrustedKey && (!trusted || trusted.size === 0)) {
      throw new Error(
        "managed settings require trustedPluginKeySha256 fingerprints",
      );
    }
    if (trusted && !trusted.has(publicKeySha256)) {
      throw new Error(`plugin signing key is not trusted (${publicKeySha256})`);
    }
    signatureVerified = verify(null, bytes, keyObject, signature);
    if (!signatureVerified) {
      throw new Error("plugin manifest signature verification failed");
    }
  }
  return {
    bytes,
    sha256,
    signatureVerified,
    publicKeySha256: signatureVerified ? publicKeySha256 : null,
    signatureSha256: signatureVerified ? signatureSha256 : null,
    publicKeyDocumentSha256: signatureVerified ? publicKeyDocumentSha256 : null,
    // Persist exact verified material so load-time enforcement can re-check it
    // cryptographically instead of trusting a forgeable boolean in a lock file.
    signatureBase64: signatureVerified ? signature.toString("base64") : null,
    publicKeyPem: signatureVerified ? publicKeyPem : null,
  };
}

function assertExpectedDigest(actual, expected, label) {
  if (expected == null || String(expected).trim() === "") return;
  const normalized = String(expected).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} expected SHA-256 is invalid`);
  }
  if (actual !== normalized) {
    throw new Error(
      `${label} SHA-256 mismatch (expected ${normalized}, got ${actual})`,
    );
  }
}

export function loadPluginManagedPolicy(options = {}) {
  const key = managedSettingsPath(options);
  if (managedPolicyCache.has(key)) {
    const cached = managedPolicyCache.get(key);
    if (cached?.error) throw cached.error;
    return cached?.settings ?? null;
  }
  try {
    const settings = immutablePolicySnapshot(
      loadManagedSettings(options).settings,
    );
    managedPolicyCache.set(key, { settings });
    return settings;
  } catch (error) {
    managedPolicyCache.set(key, { error });
    throw error;
  }
}

/**
 * Resolve the non-bypassable process policy. A caller-provided policy is a
 * test/internal fallback only when no organization policy exists on disk; it
 * can never replace (including with null) a loaded managed policy.
 */
export function resolvePluginManagedPolicy(options = {}) {
  const managed = loadPluginManagedPolicy({
    env: options.env,
    managedSettingsFile: options.managedSettingsFile,
    onWarn: options.onWarn,
  });
  if (managed != null) return managed;
  if (!Object.prototype.hasOwnProperty.call(options, "managedPolicy")) {
    return null;
  }
  return immutablePolicySnapshot(options.managedPolicy);
}

/** Test/session hook: managed org policy is otherwise immutable per process. */
export function _resetPluginManagedPolicyCache() {
  managedPolicyCache = new Map();
}
