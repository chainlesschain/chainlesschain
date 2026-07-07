/**
 * Managed org policy for plugin LOADING (Phase 3.3j — fail-closed allow/deny at
 * discovery time, not just at `cc plugin install`).
 *
 * The security primitives already exist in ../plugin-security.js
 * (`enforcePluginPolicy` for name/source allow-deny, `verifyPluginManifest` for
 * SHA-256 + Ed25519 signature). But before this, they were consulted only when a
 * user ran `cc plugin validate`/`install` — a plugin that an org later added to
 * `deniedPlugins`, or one dropped into a scope dir out-of-band, still loaded its
 * skills/agents/hooks/MCP/LSP/monitors at runtime.
 *
 * This wires the SAME `enforcePluginPolicy` into `discoverPlugins`, the single
 * chokepoint every component collector funnels through, so an org's
 * allowedPlugins / deniedPlugins is enforced fail-closed across ALL six
 * component types in one place. When there is no managed settings file the
 * policy is null and nothing is filtered (zero impact on the common case).
 *
 * NOTE: source allow/deny (blockedPluginSources / allowedPluginSources) stays an
 * INSTALL-time gate — an installed plugin doesn't carry its origin on disk, so
 * only the name allow/deny applies at load. Signature enforcement
 * (requireSignedPlugins) is a separate follow-up: it needs the installer to
 * persist a verified-signature marker, else every plugin would fail closed.
 */

import { enforcePluginPolicy } from "../plugin-security.js";
import { loadManagedSettings } from "../settings-loader.cjs";
import { verifyInstalledSignature } from "./signature.js";

// Managed settings are org-admin controlled and effectively static for a
// session, and discoverPlugins is called by every collector — memoize the load
// (keyed by resolved file path) so we don't re-read the file on every call.
let _cache = new Map();

export const _deps = { loadManagedSettings };

/**
 * Load the managed plugin policy (memoized). Returns the managed settings object
 * or null when there is no managed settings file.
 * @param {object} [opts] { env, managedSettingsFile }
 */
export function loadManagedPluginPolicy(opts = {}) {
  const env = opts.env || process.env;
  const key = String(
    opts.managedSettingsFile || env.CC_MANAGED_SETTINGS || "<default>",
  );
  if (_cache.has(key)) {
    const cached = _cache.get(key);
    // A cached failure sentinel must re-throw on EVERY call — otherwise the
    // first call fails closed but later callers get the truthy {__invalid}
    // object, treat it as an empty policy, and silently bypass the org's
    // deny/allow/requireSignedPlugins enforcement (fail-open).
    if (cached && cached.__invalid) throw cached.__invalid;
    return cached;
  }
  let settings = null;
  try {
    const loaded = _deps.loadManagedSettings({
      env: opts.env,
      managedSettingsFile: opts.managedSettingsFile,
    });
    settings = loaded.settings;
  } catch (err) {
    // Malformed managed settings → fail closed by propagating: a caller that
    // wants org enforcement must not silently proceed with no policy.
    _cache.set(key, { __invalid: err });
    throw err;
  }
  _cache.set(key, settings);
  return settings;
}

/** Clear the memoized policy (tests / after a managed-settings change). */
export function _resetPolicyCache() {
  _cache = new Map();
}

/**
 * Filter a discovered-plugin list by managed name allow/deny. Non-throwing:
 * a plugin the org denies (or omits from a required allowlist) is DROPPED and
 * collected in `dropped`, rather than throwing — so one denied plugin never
 * breaks loading of the rest.
 *
 * @param {Array<{name}>} plugins
 * @param {object|null} managed  managed settings (null = no policy → keep all)
 * @returns {{ kept: Array, dropped: Array<{name, reason}> }}
 */
export function filterByManagedPolicy(plugins, managed) {
  if (!managed) return { kept: plugins, dropped: [] };
  // requireSignedPlugins (fail-closed): every plugin must carry a valid recorded
  // signature whose locked manifest hash still matches on disk. Optionally the
  // signing key must be among managed.trustedPluginKeySha256.
  const requireSigned =
    managed.requireSignedPlugins === true ||
    managed.requireSignedPlugins === "require";
  const trustedKeys = requireSigned
    ? new Set(
        (Array.isArray(managed.trustedPluginKeySha256)
          ? managed.trustedPluginKeySha256
          : []
        )
          .map((k) => String(k || "").trim())
          .filter(Boolean),
      )
    : null;
  const kept = [];
  const dropped = [];
  for (const p of plugins) {
    try {
      enforcePluginPolicy(
        { name: p.name, source: null, action: "load" },
        managed,
      );
    } catch (err) {
      dropped.push({ name: p.name, reason: err.message });
      continue;
    }
    if (requireSigned) {
      // Fail closed when no signing keys are pinned: a lock's signature can be
      // SELF-signed by whoever authored the plugin (the lock lives in a
      // writable dir), so "signed by anyone" is not a guarantee. Without
      // trustedPluginKeySha256 the gate would accept any self-signed drop-in.
      if (!trustedKeys || trustedKeys.size === 0) {
        dropped.push({
          name: p.name,
          reason:
            "requireSignedPlugins: no trustedPluginKeySha256 fingerprints " +
            "configured (fail-closed — pin the org's signing keys)",
        });
        continue;
      }
      const v = verifyInstalledSignature(p, { trustedKeys });
      if (!v.signed) {
        dropped.push({
          name: p.name,
          reason: `requireSignedPlugins: ${v.reason}`,
        });
        continue;
      }
    }
    kept.push(p);
  }
  return { kept, dropped };
}

let _warnedDropped = new Set();

/** One-time stderr warning naming plugins an org policy blocked from loading. */
export function warnDroppedOnce(dropped) {
  const fresh = dropped.filter((d) => !_warnedDropped.has(d.name));
  if (fresh.length === 0) return;
  for (const d of fresh) _warnedDropped.add(d.name);
  try {
    process.stderr.write(
      `[plugins] blocked by managed policy: ${fresh
        .map((d) => `${d.name} (${d.reason})`)
        .join(", ")}\n`,
    );
  } catch {
    /* best-effort */
  }
}

export function _resetPolicyWarnings() {
  _warnedDropped = new Set();
}
