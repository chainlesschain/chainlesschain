/** Resolve static settings plus CLI-owned workspace-scoped permission rules. */

import settingsLoader from "./settings-loader.cjs";
import { ScopedPermissionStore } from "./scoped-permission-store.js";

const { applyManagedPermissionPolicy, loadSettings } = settingsLoader;
const KINDS = ["allow", "ask", "deny"];

function cloneRules(rules) {
  return Object.fromEntries(
    KINDS.map((kind) => [kind, [...(rules?.[kind] || [])]]),
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

  return {
    ...loaded,
    rules,
    sources,
    scoped,
    hasRules: hasRules(rules),
  };
}

export function createPermissionRulesProvider(options = {}) {
  return () => loadPermissionAuthority(options);
}
