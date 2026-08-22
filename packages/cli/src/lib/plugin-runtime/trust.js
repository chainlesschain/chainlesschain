/**
 * Plugin trust gating (Phase 3.3f) — decide whether a plugin's CODE-BEARING
 * components (hooks that run shell, LSP servers that spawn binaries) are allowed
 * to execute.
 *
 * Threat model: `cc plugin add owner/repo` and, worse, a cloned repo that ships
 * a project-scope plugin under `.chainlesschain/plugins/`, could run arbitrary
 * commands the moment the agent starts. So:
 *
 *   - user / local scope  → TRUSTED. The developer installed it on their own
 *     machine (same consent model as an npm dependency's lifecycle scripts).
 *   - project scope       → UNTRUSTED until the user explicitly trusts it, since
 *     it can arrive with a git clone. Trust is pinned to the exact version, so a
 *     later version bump re-requires consent.
 *
 * Trust is recorded in the USER data dir (never in the repo), keyed by
 * `<scope>:<name>` → { version, trustedAt }.
 *
 * Only code execution is gated here. Declarative components (skills are prompts,
 * mcp/settings are config) load regardless; this is specifically about not
 * running untrusted SHELL/binaries behind the user's back.
 */

import path from "path";
import { createHash } from "node:crypto";
import { getElectronUserDataDir } from "../paths.js";
import { withFileLock } from "../with-file-lock.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "../durable-security-store.js";
import {
  checkRecordedWorkspaceTrust,
  evaluateWorkspaceTrustDecision,
  projectWorkspaceTrustAudit,
  recordWorkspaceTrustConsent,
  resolveCanonicalWorkspaceRepoIdentity,
  revokeRecordedWorkspaceTrust,
} from "../workspace-trust.js";

export const _deps = {
  now: () => new Date().toISOString(),
  withFileLock,
  // Path of the trust store; injectable so unit tests never touch the real
  // user-data dir.
  storePath: () => path.join(getElectronUserDataDir(), "plugin-trust.json"),
  // Test-only seam. Production uses workspace-trust.js's one shared ledger.
  workspaceTrustStorePath: () => null,
};

const AUTO_TRUSTED_SCOPES = new Set(["user", "local"]);

function defaultPluginTrustStorePath() {
  return path.join(getElectronUserDataDir(), "plugin-trust.json");
}

export function loadTrustStore() {
  return readSecurityStore(_deps.storePath(), "plugin trust");
}

function trustKey(scope, name) {
  return `${scope}:${name}`;
}

const PLUGIN_WORKSPACE_TRUST_SOURCE = "plugin";

function workspaceTrustStoreOptions(options = {}) {
  const sourceStore = options.storePath || _deps.storePath();
  let usesDefaultSourceStore = false;
  try {
    usesDefaultSourceStore =
      path.resolve(sourceStore) === path.resolve(defaultPluginTrustStorePath());
  } catch {
    // Let the source-specific mutation/check fail closed later. This helper
    // must not turn an invalid custom path into the production shared ledger.
  }
  const store =
    options.workspaceTrustStorePath ||
    process.env.CC_WORKSPACE_TRUST_STORE ||
    _deps.workspaceTrustStorePath() ||
    (!usesDefaultSourceStore && typeof sourceStore === "string"
      ? path.join(path.dirname(sourceStore), "workspace-trust-v1.json")
      : null);
  return store ? { storePath: store } : {};
}

function pluginWorkspaceRoot(plugin, options = {}) {
  return (
    options.workspaceRoot ||
    plugin?.workspaceRoot ||
    plugin?.projectRoot ||
    plugin?.cwd ||
    process.cwd()
  );
}

function pluginWorkspaceTrustContext(plugin, options = {}) {
  const scope = String(plugin?.scope || "");
  const name = String(plugin?.name || "");
  const version = String(plugin?.version || "");
  if (!scope || !name || !version) {
    throw new Error("plugin trust requires scope, name, and version");
  }
  const identity = resolveCanonicalWorkspaceRepoIdentity(
    pluginWorkspaceRoot(plugin, options),
  );
  const subject = `${scope}:${name}`;
  const fingerprint = createHash("sha256")
    .update(`${scope}\0${name}\0${version}`, "utf8")
    .digest("hex");
  return { identity, subject, fingerprint };
}

function workspaceTrustKey(plugin, context) {
  const nameDigest = createHash("sha256")
    .update(String(plugin.name), "utf8")
    .digest("hex");
  return `workspace-v1:${context.identity.workspaceId}:${nameDigest}`;
}

function pluginDecision(status, context, consent = "explicit") {
  const decision = evaluateWorkspaceTrustDecision({
    identity: context.identity,
    evidence: [
      {
        source: PLUGIN_WORKSPACE_TRUST_SOURCE,
        consent,
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
  return Object.freeze({
    status,
    decision: decision.decision,
    audit: projectWorkspaceTrustAudit(decision),
  });
}

/**
 * Evaluate one plugin against the shared canonical workspace trust lattice.
 * User/local scope keeps its established local-install consent model; project
 * scope requires both the source-specific record and the shared v1 record.
 */
export function checkPluginWorkspaceTrust(plugin, options = {}) {
  if (!plugin || !plugin.name) {
    return Object.freeze({
      status: "changed",
      decision: "deny",
      audit: projectWorkspaceTrustAudit(null),
    });
  }
  const scope = String(plugin.scope || "");
  try {
    const context = pluginWorkspaceTrustContext(plugin, options);
    if (AUTO_TRUSTED_SCOPES.has(scope)) {
      return pluginDecision("trusted", context, "scope-default");
    }
    if (scope !== "project") return pluginDecision("changed", context);

    const store = loadTrustStore();
    const record = store[workspaceTrustKey(plugin, context)];
    const legacy = store[trustKey(scope, plugin.name)];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      // Old scope:name records have no canonical workspace identity.  They
      // remain visible to listTrust(), but require explicit re-consent.
      const shared = checkRecordedWorkspaceTrust({
        identity: context.identity,
        source: PLUGIN_WORKSPACE_TRUST_SOURCE,
        subject: context.subject,
        evidenceFingerprint: context.fingerprint,
        ...workspaceTrustStoreOptions(options),
      });
      if (shared.status === "changed") {
        return Object.freeze({
          status: "changed",
          decision: shared.decision,
          audit: shared.audit,
        });
      }
      if (legacy?.version) {
        // Match the shared migration contract: a legacy allow is downgraded
        // to `ask`, never silently reused. `isPluginTrusted` still refuses to
        // run it until trustPlugin writes canonical v1 consent.
        return Object.freeze({
          ...pluginDecision("first-use", context, "legacy"),
          status: "changed",
        });
      }
      return Object.freeze({
        status: "first-use",
        decision: shared.decision,
        audit: shared.audit,
      });
    }
    const binding = record.workspaceTrust;
    if (
      record.version !== plugin.version ||
      !binding ||
      binding.workspaceId !== context.identity.workspaceId ||
      binding.repositoryId !== context.identity.repositoryId ||
      binding.subject !== context.subject
    ) {
      return pluginDecision("changed", context);
    }
    const shared = checkRecordedWorkspaceTrust({
      identity: context.identity,
      source: PLUGIN_WORKSPACE_TRUST_SOURCE,
      subject: context.subject,
      evidenceFingerprint: context.fingerprint,
      ...workspaceTrustStoreOptions(options),
    });
    return Object.freeze({
      status: shared.status === "trusted" ? "trusted" : "changed",
      decision: shared.decision,
      audit: shared.audit,
    });
  } catch {
    return Object.freeze({
      status: "changed",
      decision: "deny",
      audit: projectWorkspaceTrustAudit(null),
    });
  }
}

/**
 * May this plugin's code-bearing components run?
 * @param {{ scope, name, version }} plugin
 */
export function isPluginTrusted(plugin) {
  return checkPluginWorkspaceTrust(plugin).decision === "allow";
}

/** Trust a plugin (records the exact version). */
export function trustPlugin(
  name,
  { scope = "project", version, workspaceRoot, workspaceTrustStorePath } = {},
) {
  if (!version) throw new Error("trustPlugin requires a version");
  const file = _deps.storePath();
  const plugin = { scope, name, version, workspaceRoot };
  if (scope === "project") {
    const context = pluginWorkspaceTrustContext(plugin, { workspaceRoot });
    recordWorkspaceTrustConsent({
      identity: context.identity,
      source: PLUGIN_WORKSPACE_TRUST_SOURCE,
      subject: context.subject,
      evidenceFingerprint: context.fingerprint,
      consent: "explicit",
      ...workspaceTrustStoreOptions({
        workspaceTrustStorePath,
        storePath: file,
      }),
    });
    return mutateSecurityStore(
      file,
      "plugin trust",
      (store) => {
        store[workspaceTrustKey(plugin, context)] = {
          name,
          scope,
          version,
          trustedAt: _deps.now(),
          workspaceTrust: {
            schemaVersion: context.identity.schemaVersion,
            workspaceId: context.identity.workspaceId,
            repositoryId: context.identity.repositoryId,
            subject: context.subject,
          },
        };
        return {
          name,
          scope,
          version,
          workspaceId: context.identity.workspaceId,
        };
      },
      { lock: _deps.withFileLock },
    );
  }
  return mutateSecurityStore(
    file,
    "plugin trust",
    (store) => {
      store[trustKey(scope, name)] = { version, trustedAt: _deps.now() };
      return { name, scope, version };
    },
    { lock: _deps.withFileLock },
  );
}

/** Revoke trust for a plugin at a scope. */
export function untrustPlugin(
  name,
  { scope = "project", workspaceRoot, workspaceTrustStorePath } = {},
) {
  const file = _deps.storePath();
  if (scope === "project") {
    const plugin = { scope, name, version: "trust-revocation", workspaceRoot };
    const context = pluginWorkspaceTrustContext(plugin, { workspaceRoot });
    const result = mutateSecurityStore(
      file,
      "plugin trust",
      (store) => {
        const key = workspaceTrustKey(plugin, context);
        const existed = Object.prototype.hasOwnProperty.call(store, key);
        delete store[key];
        return { name, scope, removed: existed };
      },
      { lock: _deps.withFileLock },
    );
    // Local removal happens first, so a shared-ledger write failure cannot
    // leave the code-bearing plugin authorized.
    revokeRecordedWorkspaceTrust({
      identity: context.identity,
      source: PLUGIN_WORKSPACE_TRUST_SOURCE,
      subject: context.subject,
      ...workspaceTrustStoreOptions({
        workspaceTrustStorePath,
        storePath: file,
      }),
    });
    return result;
  }
  return mutateSecurityStore(
    file,
    "plugin trust",
    (store) => {
      const key = trustKey(scope, name);
      const existed = Object.prototype.hasOwnProperty.call(store, key);
      delete store[key];
      return { name, scope, removed: existed };
    },
    { lock: _deps.withFileLock },
  );
}

/** All trust entries (for `cc plugin trust --list`). */
export function listTrust() {
  return Object.entries(loadTrustStore()).map(([key, v]) => {
    if (key.startsWith("workspace-v1:") && v?.workspaceTrust) {
      return {
        scope: "project",
        name: typeof v.name === "string" ? v.name : null,
        version: v?.version || null,
        trustedAt: v?.trustedAt || null,
        workspaceId: v.workspaceTrust.workspaceId || null,
        repositoryId: v.workspaceTrust.repositoryId || null,
      };
    }
    const idx = key.indexOf(":");
    return {
      scope: key.slice(0, idx),
      name: key.slice(idx + 1),
      version: v?.version || null,
      trustedAt: v?.trustedAt || null,
      legacy: key.startsWith("project:"),
    };
  });
}

/**
 * Split discovered plugins into those whose code may run and those gated out.
 * @returns {{ trusted: any[], skipped: any[] }}
 */
export function partitionByTrust(plugins, options = {}) {
  const trusted = [];
  const skipped = [];
  for (const p of plugins || []) {
    (checkPluginWorkspaceTrust(p, options).decision === "allow"
      ? trusted
      : skipped
    ).push(p);
  }
  return { trusted, skipped };
}

// One-time stderr notice so a user isn't mystified when a project plugin's
// hooks/servers silently don't run. Guarded so it prints at most once per
// (component-kind) per process.
const _warned = new Set();
export function warnUntrustedOnce(names, kind) {
  if (!names || names.length === 0) return;
  if (_warned.has(kind)) return;
  _warned.add(kind);
  const list = [...new Set(names)].join(", ");
  try {
    process.stderr.write(
      `[plugins] skipped ${kind} from untrusted project plugin(s): ${list}\n` +
        `          run \`cc plugin trust <name>\` to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time warning guard. */
export function _resetTrustWarnings() {
  _warned.clear();
}
