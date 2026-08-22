/**
 * Canonical workspace trust decisions.
 *
 * This module is deliberately narrower than the individual MCP, plugin, and
 * Hooks trust stores.  Those stores remain the authoritative evidence and
 * consent records for their respective products; this module gives them one
 * canonical workspace/repository identity, one strict decision lattice, and a
 * redacted audit projection.  A missing identity, malformed shared record, or
 * unknown evidence is never promoted to an allow.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";

export const WORKSPACE_TRUST_SCHEMA_VERSION = 1;
export const WORKSPACE_TRUST_AUDIT_SCHEMA =
  "chainlesschain.workspace-trust-audit/v1";
export const WORKSPACE_TRUST_STORE_SCHEMA =
  "chainlesschain.workspace-trust-store/v1";

export const WORKSPACE_TRUST_DECISION = Object.freeze({
  ALLOW: "allow",
  ASK: "ask",
  DENY: "deny",
});

const DECISION_RANK = Object.freeze({
  [WORKSPACE_TRUST_DECISION.ALLOW]: 0,
  [WORKSPACE_TRUST_DECISION.ASK]: 1,
  [WORKSPACE_TRUST_DECISION.DENY]: 2,
});
const CONSENT_RE = /^[a-z][a-z0-9_-]{0,63}$/u;
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAX_GIT_METADATA_BYTES = 64 * 1024;

export const _deps = {
  fs,
  now: () => new Date().toISOString(),
  withFileLock,
  storePath: () => path.join(getHomeDir(), "workspace-trust-v1.json"),
};

function trustError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "WorkspaceTrustError";
  error.code = code;
  return error;
}

function sha256(label, value) {
  return crypto
    .createHash("sha256")
    .update(`${label}\0`, "utf8")
    .update(String(value), "utf8")
    .digest("hex");
}

function ownString(value, label, max = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\0")
  ) {
    throw trustError(
      "CC_WORKSPACE_TRUST_INVALID_INPUT",
      `${label} must be a bounded non-empty string`,
    );
  }
  return value;
}

function realpathNative(fsApi, target) {
  const resolver = fsApi.realpathSync?.native || fsApi.realpathSync;
  if (typeof resolver !== "function") {
    throw trustError(
      "CC_WORKSPACE_TRUST_IDENTITY_UNAVAILABLE",
      "workspace realpath capability is unavailable",
    );
  }
  return resolver(target);
}

function lstatOptional(fsApi, target) {
  try {
    return fsApi.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw trustError(
      "CC_WORKSPACE_TRUST_IDENTITY_UNAVAILABLE",
      "workspace metadata is unavailable",
      error,
    );
  }
}

function directoryEvidence(fsApi, canonicalPath, label) {
  let stats;
  try {
    stats = fsApi.statSync(canonicalPath, { bigint: true });
  } catch (error) {
    throw trustError(
      "CC_WORKSPACE_TRUST_IDENTITY_UNAVAILABLE",
      `${label} metadata is unavailable`,
      error,
    );
  }
  if (!stats?.isDirectory?.()) {
    throw trustError(
      "CC_WORKSPACE_TRUST_IDENTITY_UNAVAILABLE",
      `${label} must resolve to a directory`,
    );
  }
  const birthtime = stats.birthtimeNs;
  const ctime = stats.ctimeNs;
  const generation =
    typeof birthtime === "bigint" && birthtime > 0n
      ? `birth:${birthtime.toString()}`
      : `ctime:${String(ctime ?? stats.ctimeMs ?? "unknown")}`;
  const device = String(stats.dev ?? "unknown");
  const inode = String(stats.ino ?? "unknown");
  if (device === "unknown" || inode === "unknown") {
    throw trustError(
      "CC_WORKSPACE_TRUST_IDENTITY_UNAVAILABLE",
      `${label} filesystem identity is unavailable`,
    );
  }
  return Object.freeze({ device, inode, generation });
}

function readBoundedText(fsApi, target, label) {
  let stats;
  try {
    stats = fsApi.lstatSync(target);
  } catch (error) {
    throw trustError(
      "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      `${label} is unavailable`,
      error,
    );
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > MAX_GIT_METADATA_BYTES
  ) {
    throw trustError(
      "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      `${label} must be a bounded regular file`,
    );
  }
  try {
    return fsApi.readFileSync(target, "utf8");
  } catch (error) {
    throw trustError(
      "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      `${label} could not be read`,
      error,
    );
  }
}

function parseGitDirectory(text, baseDirectory, label) {
  const match = /^gitdir:\s*(.+?)\s*$/imu.exec(String(text));
  if (!match || match[1].includes("\0")) {
    throw trustError(
      "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      `${label} is not a valid gitdir record`,
    );
  }
  return path.resolve(baseDirectory, match[1]);
}

function resolveGitCommonDirectory(fsApi, gitDirectory) {
  const commonFile = path.join(gitDirectory, "commondir");
  const commonStat = lstatOptional(fsApi, commonFile);
  if (!commonStat) return gitDirectory;
  const text = readBoundedText(fsApi, commonFile, "Git commondir metadata");
  const relative = String(text).trim();
  if (!relative || relative.includes("\0")) {
    throw trustError(
      "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
      "Git commondir metadata is invalid",
    );
  }
  const resolved = realpathNative(fsApi, path.resolve(gitDirectory, relative));
  directoryEvidence(fsApi, resolved, "Git common directory");
  return resolved;
}

function discoverRepository(fsApi, canonicalStart) {
  let candidate = canonicalStart;
  for (;;) {
    const dotGit = path.join(candidate, ".git");
    const metadata = lstatOptional(fsApi, dotGit);
    if (metadata) {
      if (metadata.isSymbolicLink()) {
        throw trustError(
          "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
          "Git metadata may not be a symbolic link",
        );
      }
      if (metadata.isDirectory()) {
        const gitDirectory = realpathNative(fsApi, dotGit);
        directoryEvidence(fsApi, gitDirectory, "Git directory");
        return {
          repositoryRoot: candidate,
          gitDirectory,
          commonDirectory: resolveGitCommonDirectory(fsApi, gitDirectory),
        };
      }
      if (metadata.isFile()) {
        const target = parseGitDirectory(
          readBoundedText(fsApi, dotGit, "Git worktree metadata"),
          candidate,
          "Git worktree metadata",
        );
        const gitDirectory = realpathNative(fsApi, target);
        directoryEvidence(fsApi, gitDirectory, "Git worktree directory");
        return {
          repositoryRoot: candidate,
          gitDirectory,
          commonDirectory: resolveGitCommonDirectory(fsApi, gitDirectory),
        };
      }
      throw trustError(
        "CC_WORKSPACE_TRUST_GIT_METADATA_INVALID",
        "Git metadata has an unsupported type",
      );
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function freezeIdentity(value) {
  const identity = {
    schemaVersion: WORKSPACE_TRUST_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
    repositoryId: value.repositoryId,
    kind: value.kind,
    linkedWorktree: value.linkedWorktree,
  };
  Object.defineProperties(identity, {
    canonicalWorkspaceRoot: {
      value: value.canonicalWorkspaceRoot,
      enumerable: false,
    },
    canonicalRepositoryRoot: {
      value: value.canonicalRepositoryRoot,
      enumerable: false,
    },
  });
  return Object.freeze(identity);
}

function validateIdentity(identity) {
  if (
    !identity ||
    identity.schemaVersion !== WORKSPACE_TRUST_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/u.test(identity.workspaceId || "") ||
    !/^[a-f0-9]{64}$/u.test(identity.repositoryId || "") ||
    !new Set(["git", "directory"]).has(identity.kind) ||
    typeof identity.linkedWorktree !== "boolean"
  ) {
    throw trustError(
      "CC_WORKSPACE_TRUST_INVALID_IDENTITY",
      "workspace trust identity is invalid",
    );
  }
  return identity;
}

/**
 * Resolve one canonical workspace and repository identity without invoking
 * Git.  Repository IDs bind Git linked worktrees to their common Git
 * directory; workspace IDs remain unique per worktree/root.  IDs intentionally
 * derive from stable filesystem identity rather than the spelling of a path.
 */
export function resolveCanonicalWorkspaceRepoIdentity(
  workspaceRoot,
  opts = {},
) {
  const fsApi = opts.fs || _deps.fs;
  const requested = ownString(workspaceRoot, "workspace root");
  const canonicalStart = realpathNative(fsApi, path.resolve(requested));
  directoryEvidence(fsApi, canonicalStart, "workspace root");
  const repository = discoverRepository(fsApi, canonicalStart);
  const canonicalWorkspaceRoot = repository?.repositoryRoot || canonicalStart;
  const workspaceEvidence = directoryEvidence(
    fsApi,
    canonicalWorkspaceRoot,
    "workspace root",
  );

  if (!repository) {
    const workspaceKey = `${workspaceEvidence.device}\0${workspaceEvidence.inode}\0${workspaceEvidence.generation}`;
    return freezeIdentity({
      workspaceId: sha256(
        "chainlesschain.workspace-trust.workspace.v1",
        workspaceKey,
      ),
      repositoryId: sha256(
        "chainlesschain.workspace-trust.directory-repository.v1",
        workspaceKey,
      ),
      kind: "directory",
      linkedWorktree: false,
      canonicalWorkspaceRoot,
      canonicalRepositoryRoot: canonicalWorkspaceRoot,
    });
  }

  const commonEvidence = directoryEvidence(
    fsApi,
    repository.commonDirectory,
    "Git common directory",
  );
  const workspaceKey = `${workspaceEvidence.device}\0${workspaceEvidence.inode}\0${workspaceEvidence.generation}`;
  const repositoryKey = `${commonEvidence.device}\0${commonEvidence.inode}\0${commonEvidence.generation}`;
  return freezeIdentity({
    workspaceId: sha256(
      "chainlesschain.workspace-trust.git-worktree.v1",
      workspaceKey,
    ),
    repositoryId: sha256(
      "chainlesschain.workspace-trust.git-repository.v1",
      repositoryKey,
    ),
    kind: "git",
    linkedWorktree: repository.gitDirectory !== repository.commonDirectory,
    canonicalWorkspaceRoot,
    canonicalRepositoryRoot: canonicalWorkspaceRoot,
  });
}

/** Return a relocation-stable subject for a file contained by a workspace. */
export function workspaceTrustPathSubject(identity, file, opts = {}) {
  const validIdentity = validateIdentity(identity);
  const fsApi = opts.fs || _deps.fs;
  const canonical = realpathNative(
    fsApi,
    path.resolve(ownString(file, "file")),
  );
  const relative = path.relative(
    validIdentity.canonicalWorkspaceRoot,
    canonical,
  );
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes("\0")
  ) {
    throw trustError(
      "CC_WORKSPACE_TRUST_SUBJECT_OUTSIDE_WORKSPACE",
      "trust subject is outside the canonical workspace",
    );
  }
  return relative.split(path.sep).join("/");
}

function normalizeDecision(value) {
  return Object.prototype.hasOwnProperty.call(DECISION_RANK, value)
    ? value
    : WORKSPACE_TRUST_DECISION.DENY;
}

function normalizeSource(value) {
  const source = String(value || "")
    .trim()
    .toLowerCase();
  return SOURCE_RE.test(source) ? source : "invalid";
}

function normalizeConsent(value) {
  const consent = String(value || "")
    .trim()
    .toLowerCase();
  return CONSENT_RE.test(consent) ? consent : "unknown";
}

function fingerprintDigest(value) {
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    return sha256("chainlesschain.workspace-trust.evidence.v1", value);
  }
  try {
    return sha256(
      "chainlesschain.workspace-trust.evidence.v1",
      JSON.stringify(value),
    );
  } catch {
    return sha256("chainlesschain.workspace-trust.evidence.v1", "invalid");
  }
}

function normalizeEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      source: "invalid",
      decision: WORKSPACE_TRUST_DECISION.DENY,
      consent: "unknown",
      fingerprint: fingerprintDigest("invalid"),
    });
  }
  const source = normalizeSource(value.source);
  return Object.freeze({
    source,
    decision:
      source === "invalid"
        ? WORKSPACE_TRUST_DECISION.DENY
        : normalizeDecision(value.decision),
    consent: normalizeConsent(value.consent),
    fingerprint: fingerprintDigest(value.fingerprint),
  });
}

function finalReason(decision, evidence) {
  if (decision === WORKSPACE_TRUST_DECISION.ALLOW) return "trusted";
  if (decision === WORKSPACE_TRUST_DECISION.ASK) return "consent_required";
  if (evidence.length === 0) return "no_trust_evidence";
  return "trust_denied";
}

function freezeDecision(value) {
  return Object.freeze({
    schemaVersion: WORKSPACE_TRUST_SCHEMA_VERSION,
    decision: value.decision,
    reason: value.reason,
    identity: value.identity,
    evidence: Object.freeze(value.evidence),
  });
}

/**
 * Intersect all supplied evidence.  `deny` wins over `ask`, which wins over
 * `allow`; absent or malformed evidence is denied.  Identity failures are
 * returned as a redaction-safe deny rather than falling back to a path string.
 */
export function evaluateWorkspaceTrustDecision(options = {}) {
  let identity;
  try {
    identity = options.identity
      ? validateIdentity(options.identity)
      : resolveCanonicalWorkspaceRepoIdentity(options.workspaceRoot, options);
  } catch {
    return freezeDecision({
      decision: WORKSPACE_TRUST_DECISION.DENY,
      reason: "workspace_identity_unavailable",
      identity: null,
      evidence: [],
    });
  }
  const evidence = Array.isArray(options.evidence)
    ? options.evidence.map(normalizeEvidence)
    : [normalizeEvidence(null)];
  let decision = evidence.length
    ? WORKSPACE_TRUST_DECISION.ALLOW
    : WORKSPACE_TRUST_DECISION.DENY;
  for (const item of evidence) {
    if (DECISION_RANK[item.decision] > DECISION_RANK[decision]) {
      decision = item.decision;
    }
  }
  return freezeDecision({
    decision,
    reason: finalReason(decision, evidence),
    identity,
    evidence,
  });
}

/**
 * Legacy grants are never silently widened.  A legacy `allow` is converted to
 * `ask` until a source records its canonical v1 consent; any prior ask/deny
 * remains at least as restrictive under the normal decision intersection.
 */
export function migrateLegacyWorkspaceTrustDecision(options = {}) {
  const legacy = Array.isArray(options.legacyEvidence)
    ? options.legacyEvidence
    : [];
  const evidence = legacy.map((item) => ({
    source: item?.source || "legacy",
    consent: item?.consent || "legacy",
    fingerprint: item?.fingerprint || "legacy",
    decision:
      normalizeDecision(item?.decision) === WORKSPACE_TRUST_DECISION.ALLOW
        ? WORKSPACE_TRUST_DECISION.ASK
        : normalizeDecision(item?.decision),
  }));
  return evaluateWorkspaceTrustDecision({
    ...options,
    evidence: [...evidence, ...(options.evidence || [])],
  });
}

/** Project a decision for logs/events without workspace paths, commands, URLs, or secrets. */
export function projectWorkspaceTrustAudit(decision) {
  const value = decision && typeof decision === "object" ? decision : {};
  const identity = value.identity;
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  return Object.freeze({
    schema_version: WORKSPACE_TRUST_AUDIT_SCHEMA,
    decision: normalizeDecision(value.decision),
    reason:
      typeof value.reason === "string" && /^[a-z_]{1,64}$/u.test(value.reason)
        ? value.reason
        : "trust_denied",
    workspace_id:
      identity && /^[a-f0-9]{64}$/u.test(identity.workspaceId || "")
        ? identity.workspaceId
        : null,
    repository_id:
      identity && /^[a-f0-9]{64}$/u.test(identity.repositoryId || "")
        ? identity.repositoryId
        : null,
    workspace_kind: identity?.kind || null,
    linked_worktree: identity?.linkedWorktree === true,
    evidence: Object.freeze(
      evidence.map((item) =>
        Object.freeze({
          source: normalizeSource(item?.source),
          decision: normalizeDecision(item?.decision),
          consent: normalizeConsent(item?.consent),
          fingerprint:
            typeof item?.fingerprint === "string" &&
            /^[a-f0-9]{64}$/u.test(item.fingerprint)
              ? item.fingerprint
              : fingerprintDigest("invalid"),
        }),
      ),
    ),
  });
}

function workspaceTrustStorePath(options = {}) {
  return options.storePath || _deps.storePath();
}

function subjectDigest(value) {
  return sha256(
    "chainlesschain.workspace-trust.subject.v1",
    ownString(value, "trust subject"),
  );
}

function recordKey(identity, source, subject) {
  return sha256(
    "chainlesschain.workspace-trust.record.v1",
    `${identity.workspaceId}\0${identity.repositoryId}\0${source}\0${subjectDigest(subject)}`,
  );
}

function trustedStoreRecords(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw trustError(
      "CC_WORKSPACE_TRUST_STORE_INVALID",
      "workspace trust store is invalid",
    );
  }
  if (Object.keys(store).length === 0) return {};
  if (
    store.schemaVersion !== WORKSPACE_TRUST_SCHEMA_VERSION ||
    store.schema !== WORKSPACE_TRUST_STORE_SCHEMA ||
    !store.records ||
    typeof store.records !== "object" ||
    Array.isArray(store.records)
  ) {
    throw trustError(
      "CC_WORKSPACE_TRUST_STORE_INVALID",
      "workspace trust store has an unsupported schema",
    );
  }
  return store.records;
}

function validRecord(record) {
  return Boolean(
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    record.schemaVersion === WORKSPACE_TRUST_SCHEMA_VERSION &&
    /^[a-f0-9]{64}$/u.test(record.workspaceId || "") &&
    /^[a-f0-9]{64}$/u.test(record.repositoryId || "") &&
    SOURCE_RE.test(record.source || "") &&
    /^[a-f0-9]{64}$/u.test(record.subject || "") &&
    /^[a-f0-9]{64}$/u.test(record.evidenceFingerprint || "") &&
    record.decision === WORKSPACE_TRUST_DECISION.ALLOW &&
    CONSENT_RE.test(record.consent || "") &&
    typeof record.recordedAt === "string",
  );
}

function decisionForRecordState(
  identity,
  source,
  subject,
  fingerprint,
  record,
  records,
) {
  const subjectHash = subjectDigest(subject);
  const exact =
    validRecord(record) &&
    record.workspaceId === identity.workspaceId &&
    record.repositoryId === identity.repositoryId &&
    record.source === source &&
    record.subject === subjectHash &&
    record.evidenceFingerprint === fingerprint;
  if (exact) return "trusted";
  const seenPrior = Object.values(records).some(
    (value) =>
      validRecord(value) &&
      value.source === source &&
      value.subject === subjectHash,
  );
  return seenPrior || record ? "changed" : "first-use";
}

function decisionForStatus(status) {
  if (status === "trusted") return WORKSPACE_TRUST_DECISION.ALLOW;
  if (status === "first-use") return WORKSPACE_TRUST_DECISION.ASK;
  return WORKSPACE_TRUST_DECISION.DENY;
}

function resultForStatus({ identity, source, subject, fingerprint, status }) {
  const decision = evaluateWorkspaceTrustDecision({
    identity,
    evidence: [
      {
        source,
        consent: status === "trusted" ? "explicit" : "missing",
        fingerprint,
        decision: decisionForStatus(status),
      },
    ],
  });
  return Object.freeze({
    status,
    identity,
    decision: decision.decision,
    audit: projectWorkspaceTrustAudit(decision),
    subject: subjectDigest(subject),
  });
}

/** Check canonical, source-specific consent stored in the shared trust ledger. */
export function checkRecordedWorkspaceTrust(options = {}) {
  const identity = options.identity
    ? validateIdentity(options.identity)
    : resolveCanonicalWorkspaceRepoIdentity(options.workspaceRoot, options);
  const source = normalizeSource(options.source);
  const subject = ownString(options.subject, "trust subject");
  const fingerprint = fingerprintDigest(options.evidenceFingerprint);
  if (source === "invalid") {
    return resultForStatus({
      identity,
      source,
      subject,
      fingerprint,
      status: "changed",
    });
  }
  const records = trustedStoreRecords(
    readSecurityStore(workspaceTrustStorePath(options), "workspace trust"),
  );
  const key = recordKey(identity, source, subject);
  return resultForStatus({
    identity,
    source,
    subject,
    fingerprint,
    status: decisionForRecordState(
      identity,
      source,
      subject,
      fingerprint,
      records[key],
      records,
    ),
  });
}

/** Record explicit consent only after the caller has retained its own evidence. */
export function recordWorkspaceTrustConsent(options = {}) {
  const identity = options.identity
    ? validateIdentity(options.identity)
    : resolveCanonicalWorkspaceRepoIdentity(options.workspaceRoot, options);
  const source = normalizeSource(options.source);
  const subject = ownString(options.subject, "trust subject");
  const consent = normalizeConsent(options.consent || "explicit");
  const fingerprint = fingerprintDigest(options.evidenceFingerprint);
  if (source === "invalid" || consent === "unknown") {
    throw trustError(
      "CC_WORKSPACE_TRUST_INVALID_INPUT",
      "workspace trust source or consent is invalid",
    );
  }
  const target = workspaceTrustStorePath(options);
  const key = recordKey(identity, source, subject);
  mutateSecurityStore(
    target,
    "workspace trust",
    (store) => {
      const records = trustedStoreRecords(store);
      if (Object.keys(store).length === 0) {
        store.schemaVersion = WORKSPACE_TRUST_SCHEMA_VERSION;
        store.schema = WORKSPACE_TRUST_STORE_SCHEMA;
        store.records = {};
      }
      // Validate the pre-existing shape before replacing one record.  This
      // prevents a malformed/corrupt ledger from being silently repaired into
      // a new authorization grant.
      for (const value of Object.values(records)) {
        if (!validRecord(value)) {
          throw trustError(
            "CC_WORKSPACE_TRUST_STORE_INVALID",
            "workspace trust store contains an invalid record",
          );
        }
      }
      store.records[key] = {
        schemaVersion: WORKSPACE_TRUST_SCHEMA_VERSION,
        workspaceId: identity.workspaceId,
        repositoryId: identity.repositoryId,
        source,
        subject: subjectDigest(subject),
        evidenceFingerprint: fingerprint,
        decision: WORKSPACE_TRUST_DECISION.ALLOW,
        consent,
        recordedAt: String(options.now || _deps.now()),
      };
      return true;
    },
    { lock: _deps.withFileLock },
  );
  return resultForStatus({
    identity,
    source,
    subject,
    fingerprint,
    status: "trusted",
  });
}

/** Revoke one canonical consent record.  A missing record is a safe no-op. */
export function revokeRecordedWorkspaceTrust(options = {}) {
  const identity = options.identity
    ? validateIdentity(options.identity)
    : resolveCanonicalWorkspaceRepoIdentity(options.workspaceRoot, options);
  const source = normalizeSource(options.source);
  const subject = ownString(options.subject, "trust subject");
  if (source === "invalid") {
    throw trustError(
      "CC_WORKSPACE_TRUST_INVALID_INPUT",
      "workspace trust source is invalid",
    );
  }
  const target = workspaceTrustStorePath(options);
  const key = recordKey(identity, source, subject);
  return mutateSecurityStore(
    target,
    "workspace trust",
    (store) => {
      const records = trustedStoreRecords(store);
      if (Object.keys(store).length === 0) return false;
      for (const value of Object.values(records)) {
        if (!validRecord(value)) {
          throw trustError(
            "CC_WORKSPACE_TRUST_STORE_INVALID",
            "workspace trust store contains an invalid record",
          );
        }
      }
      const existed = Object.prototype.hasOwnProperty.call(store.records, key);
      delete store.records[key];
      return existed;
    },
    { lock: _deps.withFileLock },
  );
}
