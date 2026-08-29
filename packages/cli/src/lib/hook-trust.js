import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  checkRecordedWorkspaceTrust,
  recordWorkspaceTrustConsent,
  revokeRecordedWorkspaceTrust,
} from "./workspace-trust.js";
import { stableStringify } from "./hook-runtime-contract.js";

export const HOOK_TRUST_SCHEMA = "chainlesschain.hook-trust/v1";

function sha256(label, value) {
  return crypto
    .createHash("sha256")
    .update(`${label}\0`, "utf8")
    .update(String(value), "utf8")
    .digest("hex");
}

function serializableDefinition(hook = {}) {
  return {
    event: hook.event || null,
    type: hook.type || null,
    command: hook.command || null,
    args: Array.isArray(hook.args) ? hook.args.map(String) : [],
    url: hook.url || null,
    method: hook.method || null,
    headers: hook.headers || null,
    server: hook.server || null,
    tool: hook.tool || null,
    template: hook.template || null,
    agentName: hook.agentName || null,
    skillName: hook.skillName || null,
    matcher: hook.matcher || null,
    priority: hook.priority ?? null,
    timeoutMs: hook.timeoutMs ?? null,
    executionMode: hook.executionMode || null,
    sandboxPolicy: hook.sandboxPolicy || null,
    requiredBoundaries: hook.requiredBoundaries || null,
  };
}

export function computeHookDefinitionDigest(hook = {}) {
  return sha256(
    "chainlesschain.hook-definition.v1",
    stableStringify(serializableDefinition(hook)),
  );
}

export function normalizeHookAuthority(hook = {}) {
  const raw = hook.authority || hook.authoritySource || {};
  const kind = String(raw.kind || hook.origin || "programmatic").toLowerCase();
  const sourceFile =
    typeof raw.sourceFile === "string" && raw.sourceFile
      ? path.resolve(raw.sourceFile)
      : null;
  const definitionDigest = computeHookDefinitionDigest(hook);
  const sourceDigest =
    typeof (raw.digest || raw.sourceDigest) === "string" &&
    /^[a-f0-9]{64}$/iu.test(raw.digest || raw.sourceDigest)
      ? String(raw.digest || raw.sourceDigest).toLowerCase()
      : definitionDigest;
  const requiresConsent =
    raw.requiresConsent === true ||
    (raw.requiresConsent !== false &&
      new Set(["settings", "config", "project"]).has(kind));
  const subject = String(
    raw.subject || sourceFile || `${kind}:${hook.id || definitionDigest}`,
  );
  return Object.freeze({
    schema: HOOK_TRUST_SCHEMA,
    kind,
    sourceFile,
    sourceDigest,
    definitionDigest,
    subject,
    requiresConsent,
  });
}

function trustFailure(authority, status, error = null) {
  return Object.freeze({
    schema: HOOK_TRUST_SCHEMA,
    trusted: false,
    status,
    decision: "deny",
    authority,
    audit: null,
    errorCode: error?.code || null,
  });
}

function verifyAuthoritySource(authority) {
  if (!authority.requiresConsent || !authority.sourceFile) {
    return { matches: true, error: null };
  }
  try {
    const currentDigest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(authority.sourceFile))
      .digest("hex");
    return {
      matches: currentDigest === authority.sourceDigest,
      error: null,
    };
  } catch (error) {
    return { matches: false, error };
  }
}

export function assessHookTrust(hook, { workspaceRoot } = {}) {
  const authority = normalizeHookAuthority(hook);
  if (!authority.requiresConsent) {
    return Object.freeze({
      schema: HOOK_TRUST_SCHEMA,
      trusted: true,
      status: "host-trusted",
      decision: "allow",
      authority,
      audit: null,
      errorCode: null,
    });
  }
  const source = verifyAuthoritySource(authority);
  if (!source.matches) {
    return trustFailure(
      authority,
      source.error ? "source-unavailable" : "changed",
      source.error,
    );
  }
  if (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot)) {
    return trustFailure(authority, "workspace-unavailable");
  }
  try {
    const result = checkRecordedWorkspaceTrust({
      workspaceRoot,
      source: "hooks",
      subject: authority.subject,
      evidenceFingerprint: authority.sourceDigest,
    });
    return Object.freeze({
      schema: HOOK_TRUST_SCHEMA,
      trusted: result.decision === "allow" && result.status === "trusted",
      status: result.status,
      decision: result.decision,
      authority,
      audit: result.audit,
      errorCode: null,
    });
  } catch (error) {
    return trustFailure(authority, "trust-store-unavailable", error);
  }
}

export function approveHookAuthority(
  authorityInput,
  { workspaceRoot, now } = {},
) {
  const authority = normalizeHookAuthority({
    id: authorityInput?.id || "approval",
    event: authorityInput?.event || "Setup",
    type: authorityInput?.type || "command",
    command: authorityInput?.command || null,
    authority: authorityInput,
  });
  const source = verifyAuthoritySource(authority);
  if (!source.matches) {
    const error = new Error(
      source.error
        ? `Hook authority source is unavailable: ${authority.sourceFile}`
        : `Hook authority source changed: ${authority.sourceFile}`,
      source.error ? { cause: source.error } : undefined,
    );
    error.code = source.error
      ? "CC_HOOK_SOURCE_UNAVAILABLE"
      : "CC_HOOK_SOURCE_CHANGED";
    throw error;
  }
  if (!authority.requiresConsent) {
    return assessHookTrust(
      { authority, id: "approval", event: "Setup", type: "command" },
      { workspaceRoot },
    );
  }
  return recordWorkspaceTrustConsent({
    workspaceRoot,
    source: "hooks",
    subject: authority.subject,
    evidenceFingerprint: authority.sourceDigest,
    consent: "explicit",
    now,
  });
}

export function revokeHookAuthority(authorityInput, { workspaceRoot } = {}) {
  const authority = normalizeHookAuthority({
    id: authorityInput?.id || "revocation",
    event: authorityInput?.event || "Setup",
    type: authorityInput?.type || "command",
    command: authorityInput?.command || null,
    authority: authorityInput,
  });
  return revokeRecordedWorkspaceTrust({
    workspaceRoot,
    source: "hooks",
    subject: authority.subject,
  });
}
