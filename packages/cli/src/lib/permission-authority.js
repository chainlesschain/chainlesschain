/** Resolve static settings plus CLI-owned workspace-scoped permission rules. */

import settingsLoader from "./settings-loader.cjs";
import path from "node:path";
import { ScopedPermissionStore } from "./scoped-permission-store.js";

const {
  applyManagedPermissionPolicy,
  loadSettings,
  getSettingsPermissionRevision,
  subscribeSettingsPermissionRevision,
} = settingsLoader;
const KINDS = ["allow", "ask", "deny"];
const providers = new WeakMap();
const settingsAuthority = Object.freeze({
  getSnapshot: getSettingsPermissionRevision,
  subscribePolicyRevision: subscribeSettingsPermissionRevision,
});

function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

function cloneRules(rules) {
  return Object.fromEntries(
    KINDS.map((kind) => {
      const entries = rules?.[kind] ?? [];
      if (
        !Array.isArray(entries) ||
        entries.some((entry) => typeof entry !== "string")
      ) {
        throw new TypeError(`permission ${kind} rules must be a string array`);
      }
      return [kind, [...entries]];
    }),
  );
}

function hasRules(rules) {
  return KINDS.some((kind) => rules[kind].length > 0);
}

export function loadPermissionAuthority({
  cwd = process.cwd(),
  settingsFile = null,
  managedSettingsFile = null,
  env = process.env,
  baseRules = null,
  scopedStore = null,
} = {}) {
  const settingsRevision = getSettingsPermissionRevision();
  const loaded = loadSettings({
    cwd,
    settingsFile,
    managedSettingsFile,
    env,
  });
  const sources = baseRules ? {} : { ...loaded.sources };
  let rules = baseRules
    ? applyManagedPermissionPolicy(baseRules, loaded.managed, sources)
    : cloneRules(loaded.rules);
  let scoped = null;

  // Explicit caller rules retain their historical replacement semantics.
  // Managed-only policy also suppresses every user-owned scoped grant.
  if (!baseRules) {
    scoped = (scopedStore || new ScopedPermissionStore({ cwd })).list();
    const managedOnly =
      loaded.managed?.allowManagedPermissionRulesOnly === true;
    scoped = {
      ...scoped,
      rules: scoped.rules.map((record) => ({
        ...record,
        effectiveStatus:
          managedOnly && record.status === "active"
            ? "suppressed-by-managed-policy"
            : record.status,
      })),
    };
    if (!managedOnly) {
      for (const record of scoped.rules) {
        if (record.status !== "active") continue;
        if (!rules[record.decision].includes(record.rule)) {
          rules[record.decision].push(record.rule);
          sources[`${record.decision}:${record.rule}`] = `scoped:${record.id}`;
        }
      }
    }
  }

  if (getSettingsPermissionRevision() !== settingsRevision) {
    const error = new Error(
      "settings changed while permission authority was loading",
    );
    error.code = "CC_SETTINGS_PERMISSION_AUTHORITY_CHANGED";
    throw error;
  }
  return freezeSnapshot({
    ...loaded,
    rules,
    sources,
    scoped,
    hasRules: hasRules(rules),
    settingsRevision,
  });
}

export function createPermissionRulesProvider(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const captured = Object.freeze({
    cwd,
    settingsFile: options.settingsFile
      ? path.resolve(cwd, options.settingsFile)
      : null,
    managedSettingsFile: options.managedSettingsFile
      ? path.resolve(options.managedSettingsFile)
      : null,
    // Environment kill switches retain live sampling semantics. The source
    // object cannot be replaced through later changes to the options object.
    env: options.env || process.env,
    baseRules: options.baseRules
      ? freezeSnapshot(cloneRules(options.baseRules))
      : null,
    scopedStore: options.scopedStore || null,
  });
  const provider = () => loadPermissionAuthority(captured);
  providers.set(provider, settingsAuthority);
  return Object.freeze(provider);
}

// A legacy callback cannot advertise a trusted revision subscription simply
// by copying properties onto itself. It still receives sampled revalidation.
export function permissionRulesProviderAuthority(provider) {
  return providers.get(provider) || null;
}
