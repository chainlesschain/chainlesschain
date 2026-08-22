/**
 * Project `.mcp.json` fingerprint trust (gap-analysis 2026-07-11 P1 "MCP 生命
 * 周期" — 配置指纹变化后重新信任).
 *
 * `--project-mcp` opts a run into a checked-in `.mcp.json`, which can spawn
 * arbitrary commands. That consent is for the file AS THE USER SAW IT — a
 * later commit (or a compromised dependency's postinstall) editing the file
 * must not ride the standing opt-in. So the first successful load records a
 * sha256 fingerprint per absolute file path; a later load whose content no
 * longer matches is REFUSED (fail-closed) until the user re-trusts via
 * `CC_PROJECT_MCP_TRUST=1` (one-shot) or `cc mcp trust-project`.
 *
 * Store: ~/.chainlesschain/trusted-project-mcp.json  { [absPath]: {fingerprint, trustedAt} }
 */

import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import {
  checkRecordedWorkspaceTrust,
  evaluateWorkspaceTrustDecision,
  projectWorkspaceTrustAudit,
  recordWorkspaceTrustConsent,
  resolveCanonicalWorkspaceRepoIdentity,
  workspaceTrustPathSubject,
} from "./workspace-trust.js";

export const _deps = {
  withFileLock,
  // Test-only seam. Production uses workspace-trust.js's one shared ledger.
  workspaceTrustStorePath: () => null,
};
const workspaceAuthorities = new WeakMap();

function storePath(opts = {}) {
  return (
    opts.storePath ||
    process.env.CC_PROJECT_MCP_TRUST_STORE ||
    path.join(getHomeDir(), "trusted-project-mcp.json")
  );
}

export function projectMcpFingerprint(content) {
  return createHash("sha256").update(String(content), "utf-8").digest("hex");
}

const PROJECT_MCP_WORKSPACE_TRUST_SOURCE = "project-mcp";

function workspaceTrustStoreOptions(opts = {}) {
  const store =
    opts.workspaceTrustStorePath ||
    process.env.CC_WORKSPACE_TRUST_STORE ||
    _deps.workspaceTrustStorePath() ||
    // Custom source-store callers (notably isolated tests) get an adjacent
    // shared ledger. Normal CLI calls omit storePath and therefore use the
    // single workspace-trust.js default shared by all entry points.
    (opts.storePath
      ? path.join(path.dirname(opts.storePath), "workspace-trust-v1.json")
      : null);
  return store ? { storePath: store } : {};
}

function projectMcpWorkspaceTrustContext(file, content, opts = {}) {
  const identity = resolveCanonicalWorkspaceRepoIdentity(
    opts.workspaceRoot || path.dirname(file),
  );
  const subject = workspaceTrustPathSubject(identity, file);
  const fingerprint = projectMcpFingerprint(content);
  return { identity, subject, fingerprint };
}

function projectMcpWorkspaceRecordKey(context) {
  const subjectDigest = createHash("sha256")
    .update(context.subject, "utf8")
    .digest("hex");
  return `workspace-v1:${context.identity.workspaceId}:${subjectDigest}`;
}

function projectMcpDecision(status, context) {
  const decision = evaluateWorkspaceTrustDecision({
    identity: context.identity,
    evidence: [
      {
        source: PROJECT_MCP_WORKSPACE_TRUST_SOURCE,
        consent: status === "trusted" ? "explicit" : "missing",
        fingerprint: context.fingerprint,
        decision:
          status === "trusted"
            ? "allow"
            : status === "first-use"
              ? "ask"
              : "deny",
      },
    ],
  });
  return {
    status,
    fingerprint: context.fingerprint,
    workspaceTrust: projectWorkspaceTrustAudit(decision),
  };
}

/**
 * Issue an in-process authority only after the caller has verified the exact
 * project file fingerprint. Plain config fields cannot forge this token.
 */
export function issueProjectMcpWorkspaceAuthority({
  file,
  content,
  workspaceRoot,
  serverName,
  config = {},
}) {
  const canonicalFile = fs.realpathSync.native(path.resolve(file));
  const workspaceIdentity =
    resolveCanonicalWorkspaceRepoIdentity(workspaceRoot);
  const canonicalRoot = workspaceIdentity.canonicalWorkspaceRoot;
  const trustDecision = evaluateWorkspaceTrustDecision({
    identity: workspaceIdentity,
    evidence: [
      {
        source: PROJECT_MCP_WORKSPACE_TRUST_SOURCE,
        consent: "host-bound",
        fingerprint: projectMcpFingerprint(content),
        decision: "allow",
      },
    ],
  });
  if (trustDecision.decision !== "allow") {
    throw new Error("project MCP workspace identity is unavailable");
  }
  const token = Object.freeze({});
  workspaceAuthorities.set(
    token,
    Object.freeze({
      file: canonicalFile,
      fingerprint: projectMcpFingerprint(content),
      workspaceRoot: canonicalRoot,
      workspaceId: workspaceIdentity.workspaceId,
      repositoryId: workspaceIdentity.repositoryId,
      workspaceTrust: projectWorkspaceTrustAudit(trustDecision),
      serverName: String(serverName || ""),
      url: typeof config.url === "string" ? config.url : "",
      transport: typeof config.transport === "string" ? config.transport : "",
      headersHelper:
        typeof config.headersHelper === "string" ? config.headersHelper : "",
    }),
  );
  return token;
}

/** Resolve a collector-issued project authority against the exact config. */
export function resolveProjectMcpWorkspaceAuthority(token, expected = {}) {
  const record = workspaceAuthorities.get(token);
  if (!record) return null;
  let expectedFile;
  try {
    expectedFile = fs.realpathSync.native(
      path.resolve(String(expected.configSource || "")),
    );
  } catch {
    return null;
  }
  let currentFingerprint;
  try {
    currentFingerprint = projectMcpFingerprint(
      fs.readFileSync(expectedFile, "utf8"),
    );
  } catch {
    return null;
  }
  if (
    record.file !== expectedFile ||
    record.fingerprint !== currentFingerprint ||
    record.serverName !== String(expected.serverName || "") ||
    record.url !== (typeof expected.url === "string" ? expected.url : "") ||
    record.transport !==
      (typeof expected.transport === "string" ? expected.transport : "") ||
    record.headersHelper !==
      (typeof expected.headersHelper === "string" ? expected.headersHelper : "")
  ) {
    return null;
  }
  try {
    const currentIdentity = resolveCanonicalWorkspaceRepoIdentity(
      record.workspaceRoot,
    );
    if (
      currentIdentity.workspaceId !== record.workspaceId ||
      currentIdentity.repositoryId !== record.repositoryId
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return record.workspaceRoot;
}

function readStore(opts) {
  return readSecurityStore(storePath(opts), "project MCP trust");
}

/**
 * Check a project .mcp.json against the trust store.
 * @returns {{status:"first-use"|"trusted"|"changed", fingerprint:string}}
 */
export function checkProjectMcpTrust(file, content, opts = {}) {
  const context = projectMcpWorkspaceTrustContext(file, content, opts);
  const store = readStore(opts);
  const record = store[projectMcpWorkspaceRecordKey(context)];
  const legacyRecord = store[path.resolve(file)];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    // A pre-v1 path-keyed grant cannot be shown to bind the current canonical
    // workspace identity.  Treat it as changed rather than silently widening
    // it; the existing explicit re-trust path records the v1 intersection.
    const shared = checkRecordedWorkspaceTrust({
      identity: context.identity,
      source: PROJECT_MCP_WORKSPACE_TRUST_SOURCE,
      subject: context.subject,
      evidenceFingerprint: context.fingerprint,
      ...workspaceTrustStoreOptions(opts),
    });
    return {
      status:
        legacyRecord?.fingerprint || shared.status === "changed"
          ? "changed"
          : "first-use",
      fingerprint: context.fingerprint,
      workspaceTrust: shared.audit,
    };
  }
  const binding = record.workspaceTrust;
  if (
    record.fingerprint !== context.fingerprint ||
    !binding ||
    binding.workspaceId !== context.identity.workspaceId ||
    binding.repositoryId !== context.identity.repositoryId ||
    binding.subject !== context.subject
  ) {
    return projectMcpDecision("changed", context);
  }
  const shared = checkRecordedWorkspaceTrust({
    identity: context.identity,
    source: PROJECT_MCP_WORKSPACE_TRUST_SOURCE,
    subject: context.subject,
    evidenceFingerprint: context.fingerprint,
    ...workspaceTrustStoreOptions(opts),
  });
  return {
    status: shared.status === "trusted" ? "trusted" : "changed",
    fingerprint: context.fingerprint,
    workspaceTrust: shared.audit,
  };
}

/** Record (or re-record) the trusted fingerprint for a file. */
export function recordProjectMcpTrust(file, content, opts = {}) {
  const target = storePath(opts);
  const context = projectMcpWorkspaceTrustContext(file, content, opts);
  // Persist the shared record first.  If the legacy/source-specific store
  // fails afterwards, the checker still requires both records and therefore
  // cannot accidentally authorize from the shared ledger alone.
  recordWorkspaceTrustConsent({
    identity: context.identity,
    source: PROJECT_MCP_WORKSPACE_TRUST_SOURCE,
    subject: context.subject,
    evidenceFingerprint: context.fingerprint,
    consent: "explicit",
    ...workspaceTrustStoreOptions(opts),
  });
  return mutateSecurityStore(
    target,
    "project MCP trust",
    (store) => {
      store[projectMcpWorkspaceRecordKey(context)] = {
        fingerprint: context.fingerprint,
        trustedAt: new Date(
          typeof opts.now === "number" ? opts.now : Date.now(),
        ).toISOString(),
        workspaceTrust: {
          schemaVersion: context.identity.schemaVersion,
          workspaceId: context.identity.workspaceId,
          repositoryId: context.identity.repositoryId,
          subject: context.subject,
        },
      };
      return true;
    },
    { lock: _deps.withFileLock },
  );
}

/** Truthy CC_PROJECT_MCP_TRUST → the user explicitly re-trusts this run. */
export function projectMcpRetrustRequested(env = process.env) {
  const raw = String(env.CC_PROJECT_MCP_TRUST || "").toLowerCase();
  return raw === "1" || raw === "true";
}
