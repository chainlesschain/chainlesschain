/**
 * Plugin capability CONSENT (Phase 3 gap: capability declaration + re-consent).
 *
 * Complements version trust ([[trust.js]]): trust pins the exact CODE a plugin
 * ships (re-consent on version bump); this pins the CAPABILITY SET the plugin is
 * allowed to request (process / network / filesystem / mcp / monitor /
 * credential). The two are orthogonal — a plugin can be trusted-to-run yet still
 * WIDEN what it wants (add `network:*`, a new credential), which must re-prompt.
 *
 * Consent is keyed by the SET, not the version: once the user consents, later
 * versions that keep the same (or a narrower) capability set stay consented; any
 * WIDENING (a new grant) revokes consent until re-granted. This mirrors
 * `consentRequiredForUpgrade` in [[capabilities.js]] exactly.
 *
 * Recorded in the USER data dir (never in the repo — a checked-in project file
 * must not be able to pre-grant itself capabilities), keyed `<scope>:<name>` →
 * { version, capabilities, consentedAt }. Pure over injected IO so unit tests
 * never touch the real user-data dir.
 */

import fs from "fs";
import path from "path";
import { getElectronUserDataDir } from "../paths.js";
import {
  normalizeCapabilities,
  diffCapabilities,
  describeCapabilities,
} from "./capabilities.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  now: () => new Date().toISOString(),
  // Injectable so unit tests never touch the real user-data dir.
  storePath: () =>
    path.join(getElectronUserDataDir(), "plugin-capability-consent.json"),
};

function consentKey(scope, name) {
  return `${scope}:${name}`;
}

export function loadConsentStore() {
  try {
    const p = _deps.storePath();
    if (!_deps.existsSync(p)) return {};
    const data = JSON.parse(_deps.readFileSync(p, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveConsentStore(store) {
  const p = _deps.storePath();
  _deps.mkdirSync(path.dirname(p), { recursive: true });
  _deps.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

/**
 * Coerce a capability set to the canonical shape diffCapabilities needs.
 * `normalizeCapabilities` is NOT idempotent — it re-parses `filesystem`/
 * `credential` through `toList`, so feeding it an already-normalized set (e.g.
 * one read back from the store) corrupts those lists. Detect an already-
 * canonical set and pass it through unchanged; only normalize raw input.
 */
function canonicalCaps(caps) {
  if (
    caps &&
    typeof caps === "object" &&
    caps.network &&
    typeof caps.network === "object" &&
    "domains" in caps.network &&
    caps.filesystem &&
    "roots" in caps.filesystem &&
    caps.credential &&
    "names" in caps.credential
  ) {
    return caps;
  }
  return normalizeCapabilities(caps);
}

/** True when a capability set grants nothing (all-deny) — nothing to consent. */
export function capabilitiesAreEmpty(caps) {
  return !diffCapabilities(null, canonicalCaps(caps)).widened;
}

/**
 * PURE consent status: given a plugin's DECLARED capabilities and its stored
 * consent entry, decide whether consent covers them. Re-consent is required on
 * a first request or any WIDENING (new grant) — not on a version bump alone
 * (trust handles versions).
 *
 * @param {object} declaredCaps  raw or normalized capabilities
 * @param {object|null} entry    stored `{ version, capabilities }` (or null)
 * @returns {{consented:boolean, reason:string, added:string[]}}
 */
export function capabilityConsentStatus(declaredCaps, entry) {
  const declared = canonicalCaps(declaredCaps);
  if (!diffCapabilities(null, declared).widened) {
    return { consented: true, reason: "no capabilities declared", added: [] };
  }
  if (!entry) {
    return {
      consented: false,
      reason: "capabilities never consented",
      added: diffCapabilities(null, declared).added,
    };
  }
  // Coerce the stored set to canonical too (raw hand-written entry, or an
  // already-normalized one read from the store) before diffing.
  const diff = diffCapabilities(canonicalCaps(entry.capabilities), declared);
  if (diff.widened) {
    return {
      consented: false,
      reason: "capabilities widened since last consent",
      added: diff.added,
    };
  }
  return {
    consented: true,
    reason: "consent covers declared capabilities",
    added: [],
  };
}

/**
 * Decide how an install/upgrade command should handle capability consent at the
 * point of installation (pure — no I/O). `notice` is the shape returned by the
 * command layer's capability resolver: `{ consented, added, ... }` or null when
 * the plugin declares no capabilities.
 *
 * Returns one of:
 *   - "advisory" — nothing to consent (no caps, or already consented), OR the
 *     caller is non-interactive and did not pass an explicit grant flag: print
 *     the notice and require a later `cc plugin consent --grant`.
 *   - "grant"    — an explicit grant flag was given: record consent immediately
 *     (scriptable / CI path).
 *   - "prompt"   — consent is required and the session is interactive: ask the
 *     user, then grant on confirmation.
 *
 * Precedence: an explicit grant flag always wins over an interactive prompt, so
 * `--grant-capabilities` is honored even under a TTY without a second question.
 */
export function resolveConsentAction(
  notice,
  { grant = false, interactive = false } = {},
) {
  if (!notice || notice.consented) return "advisory";
  if (grant) return "grant";
  if (interactive) return "prompt";
  return "advisory";
}

/** Load the store and report whether one plugin's declared caps are consented. */
export function isPluginCapabilityConsented(plugin, declaredCaps) {
  if (!plugin || !plugin.name) return false;
  const entry = loadConsentStore()[consentKey(plugin.scope, plugin.name)];
  return capabilityConsentStatus(declaredCaps, entry).consented;
}

/** Record consent for a plugin's currently-declared capability set. */
export function consentPluginCapabilities(
  name,
  { scope = "project", version, capabilities } = {},
) {
  if (!version) throw new Error("consentPluginCapabilities requires a version");
  const store = loadConsentStore();
  store[consentKey(scope, name)] = {
    version,
    capabilities: canonicalCaps(capabilities),
    consentedAt: _deps.now(),
  };
  saveConsentStore(store);
  return { name, scope, version };
}

/** Revoke capability consent for a plugin at a scope. */
export function revokeCapabilityConsent(name, { scope = "project" } = {}) {
  const store = loadConsentStore();
  const key = consentKey(scope, name);
  const existed = Object.prototype.hasOwnProperty.call(store, key);
  delete store[key];
  saveConsentStore(store);
  return { name, scope, removed: existed };
}

/** All consent entries (for `cc plugin consent --list`). */
export function listCapabilityConsent() {
  return Object.entries(loadConsentStore()).map(([key, v]) => {
    const idx = key.indexOf(":");
    return {
      scope: key.slice(0, idx),
      name: key.slice(idx + 1),
      version: v?.version || null,
      consentedAt: v?.consentedAt || null,
      capabilities: describeCapabilities(v?.capabilities),
    };
  });
}
