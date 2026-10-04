/** Resolve static settings plus CLI-owned workspace-scoped permission rules. */

import settingsLoader from "./settings-loader.cjs";
import persistentSettings from "./settings-permission-authority.cjs";
import path from "node:path";
import {
  ScopedPermissionStore,
  getScopedPermissionRevision,
  subscribeScopedPermissionRevision,
  projectScopedPermissionObservation,
} from "./scoped-permission-store.js";

const {
  applyManagedPermissionPolicy,
  inspectSettingsSources,
  projectSettingsObservation,
  getSettingsPermissionRevision,
  subscribeSettingsPermissionRevision,
} = settingsLoader;
const KINDS = ["allow", "ask", "deny"];
const providers = new WeakMap();
const settingsAuthority = Object.freeze({
  getSnapshot: getSettingsPermissionRevision,
  subscribePolicyRevision: subscribeSettingsPermissionRevision,
});
let combinedSnapshot = null;
function getCombinedSnapshot() {
  const settings = getSettingsPermissionRevision();
  const scoped = getScopedPermissionRevision();
  if (
    combinedSnapshot?.settings !== settings ||
    combinedSnapshot?.scoped !== scoped
  ) {
    combinedSnapshot = Object.freeze({ settings, scoped });
  }
  return combinedSnapshot;
}
const combinedAuthority = Object.freeze({
  getSnapshot: getCombinedSnapshot,
  subscribePolicyRevision(listener) {
    if (typeof listener !== "function")
      throw new TypeError("permission revision listener must be a function");
    const removeSettings = subscribeSettingsPermissionRevision(listener);
    const removeScoped = subscribeScopedPermissionRevision(listener);
    return () => {
      removeSettings();
      removeScoped();
    };
  },
});

function freezeSnapshot(value) {
  const pending = [value];
  const seen = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
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
  settingsAuthority: persistentAuthority = null,
} = {}) {
  const settingsRevision = getSettingsPermissionRevision();
  const scopedRevision = baseRules ? null : getScopedPermissionRevision();
  const persistent = persistentAuthority
    ? persistentSettings.readSettingsPermissionAuthority(persistentAuthority)
    : null;
  if (persistentAuthority) {
    const bound =
      persistentSettings.settingsPermissionAuthorityOptions(
        persistentAuthority,
      );
    if (
      path.resolve(cwd) !== bound.cwd ||
      (settingsFile &&
        path.resolve(cwd, settingsFile) !== bound.settingsFile) ||
      (managedSettingsFile &&
        path.resolve(managedSettingsFile) !== bound.managedSettingsFile)
    )
      throw new TypeError("persistent settings authority options mismatch");
  }
  const settingsObservation =
    persistent?.observation ||
    inspectSettingsSources({
      cwd,
      settingsFile,
      managedSettingsFile,
      env,
    });
  const loaded = projectSettingsObservation(settingsObservation, { env });
  const sources = baseRules ? {} : { ...loaded.sources };
  let rules = baseRules
    ? applyManagedPermissionPolicy(baseRules, loaded.managed, sources)
    : cloneRules(loaded.rules);
  let scoped = null;

  // Explicit caller rules retain their historical replacement semantics.
  // Managed-only policy also suppresses every user-owned scoped grant.
  if (!baseRules) {
    const bound = persistentAuthority
      ? persistentSettings.settingsPermissionAuthorityOptions(
          persistentAuthority,
        )
      : null;
    const store =
      scopedStore ||
      new ScopedPermissionStore({
        cwd,
        ...(bound
          ? {
              filePath: bound.scopedFile,
              settingsAuthority: persistentAuthority,
            }
          : {}),
      });
    scoped = persistent
      ? projectScopedPermissionObservation(
          store,
          persistentAuthority,
          persistent.scopedObservation,
        )
      : store.list();
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
  if (!baseRules && getScopedPermissionRevision() !== scopedRevision) {
    const error = new Error(
      "scoped permissions changed while permission authority was loading",
    );
    error.code = "CC_SCOPED_PERMISSION_AUTHORITY_CHANGED";
    throw error;
  }
  if (
    persistent &&
    persistentSettings.readSettingsPermissionAuthority(persistentAuthority)
      .snapshot !== persistent.snapshot
  ) {
    const error = new Error(
      "persistent settings changed while permission authority was loading",
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
    settingsObservation,
    ...(persistent ? { persistentSettingsRevision: persistent.snapshot } : {}),
    ...(scopedRevision ? { scopedRevision } : {}),
  });
}

export function createPermissionRulesProvider(options = {}) {
  const persistentAuthority = options.settingsAuthority ?? null;
  const bound = persistentAuthority
    ? persistentSettings.settingsPermissionAuthorityOptions(persistentAuthority)
    : null;
  const cwd = path.resolve(options.cwd || bound?.cwd || process.cwd());
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
    settingsAuthority: persistentAuthority,
  });
  if (
    bound &&
    (cwd !== bound.cwd ||
      (captured.settingsFile && captured.settingsFile !== bound.settingsFile) ||
      (captured.managedSettingsFile &&
        captured.managedSettingsFile !== bound.managedSettingsFile))
  )
    throw new TypeError("persistent settings authority options mismatch");
  const provider = () => loadPermissionAuthority(captured);
  const localAuthority = captured.baseRules
    ? settingsAuthority
    : combinedAuthority;
  providers.set(
    provider,
    persistentAuthority
      ? persistentProviderAuthority(persistentAuthority, localAuthority)
      : localAuthority,
  );
  return Object.freeze(provider);
}

function persistentProviderAuthority(binding, localAuthority) {
  let last = null;
  function getSnapshot() {
    const local = localAuthority.getSnapshot();
    const durable =
      persistentSettings.readSettingsPermissionAuthority(binding).snapshot;
    if (last?.local !== local || last?.durable !== durable)
      last = Object.freeze({ local, durable });
    return last;
  }
  return Object.freeze({
    getSnapshot,
    assertWorkspace(cwd) {
      if (
        path.resolve(cwd) !==
        persistentSettings.settingsPermissionAuthorityOptions(binding).cwd
      )
        throw Object.assign(
          new Error("persistent permission authority workspace mismatch"),
          { code: "CC_SETTINGS_AUTHORITY_BINDING_CHANGED" },
        );
    },
    assertWritableRoots(roots) {
      persistentSettings.assertSettingsPermissionWritableRoots(binding, roots);
    },
    subscribePolicyRevision(listener) {
      if (typeof listener !== "function")
        throw new TypeError("permission revision listener must be a function");
      let known = getSnapshot();
      const remove = localAuthority.subscribePolicyRevision(listener);
      // Persistence prevents official ABA loss between polls. Timers provide
      // bounded observation, not a promise that another process has stopped
      // before synchronous addRule returns.
      const timer = setInterval(() => {
        let next;
        try {
          next = getSnapshot();
        } catch {
          next = null;
        }
        if (next === known) return;
        known = next;
        try {
          listener(next);
        } catch {
          /* isolate observers */
        }
      }, 100);
      timer.unref?.();
      return () => {
        clearInterval(timer);
        remove();
      };
    },
  });
}

// A legacy callback cannot advertise a trusted revision subscription simply
// by copying properties onto itself. It still receives sampled revalidation.
export function permissionRulesProviderAuthority(provider) {
  return providers.get(provider) || null;
}
