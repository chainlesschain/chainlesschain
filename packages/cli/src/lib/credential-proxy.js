/**
 * Credential proxy — keep the agent's real, long-lived credentials out of the
 * environment that run_shell / run_code / hook / plugin subprocesses inherit
 * (P0 §"跨平台沙箱与凭据代理").
 *
 * By default a spawned command inherits the WHOLE parent environment — including
 * the agent's ANTHROPIC_API_KEY, cloud keys and tokens. A compromised or
 * careless command can then echo, log, or exfiltrate them. This module replaces
 * credential-named vars with an opaque SENTINEL before the child starts and
 * keeps the real values in a parent-held vault, to be injected only for an
 * approved host (via the egress proxy) — never handed to the child wholesale.
 * The audit log only ever sees redacted values, never a restored secret.
 *
 * Pairs with credential-guard.js: that guard stops the AGENT reading secrets
 * into model context; this stops the SUBPROCESS inheriting them. Both classify
 * secret var names through the same `isSecretEnvName` so they never drift.
 *
 * Opt-in for now (`CC_CREDENTIAL_PROXY=1` or `config.credentialProxy.enabled`)
 * so existing workflows that legitimately read a token from env keep working;
 * default-on is the eventual goal once per-host injection is wired everywhere.
 * Pure + dependency-light so every spawn seam can share it.
 */

import { isSecretEnvName } from "./credential-guard.js";

/** Opaque replacement a masked credential var carries into the child env. */
export const CREDENTIAL_SENTINEL_PREFIX = "cc-cred-redacted:";

/**
 * Well-known credential vars whose NAME does not obviously match the generic
 * KEY/TOKEN/SECRET/PASSWORD pattern. Most real ones already match; this is a
 * small safety net, extendable per-project via `deny`.
 */
const EXTRA_CREDENTIAL_NAMES = new Set([
  "AWS_SESSION_TOKEN", // matches TOKEN, kept explicit
  "GOOGLE_APPLICATION_CREDENTIALS", // path to a key file
  "CLOUDSDK_AUTH_ACCESS_TOKEN",
  "DIGITALOCEAN_ACCESS_TOKEN",
]);

function toSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : value ? [value] : []);
}

/**
 * Classify an env var NAME as credential-bearing. `opts.allow` forces
 * pass-through (never masked); `opts.deny` forces masking; otherwise the shared
 * secret-name classifier + the curated extra set decide.
 */
export function isCredentialEnvName(name, opts = {}) {
  if (typeof name !== "string" || !name) return false;
  if (toSet(opts.allow).has(name)) return false;
  if (toSet(opts.deny).has(name)) return true;
  return isSecretEnvName(name) || EXTRA_CREDENTIAL_NAMES.has(name);
}

/** The sentinel a child sees in place of a credential's real value. */
export function makeSentinel(name) {
  return CREDENTIAL_SENTINEL_PREFIX + String(name ?? "");
}

/** True when a value is a proxy sentinel (carries no secret). */
export function isSentinel(value) {
  return (
    typeof value === "string" && value.startsWith(CREDENTIAL_SENTINEL_PREFIX)
  );
}

/**
 * Mask credential-named vars in `env`. Returns a NEW object (never mutates the
 * input):
 *   - `env`    — credential vars replaced with a sentinel (mode "mask", the
 *                default) or removed entirely (mode "deny"); everything else
 *                copied through verbatim.
 *   - `masked` — sorted list of the var names that were masked/removed.
 *   - `vault`  — Map<name, realValue> the PARENT keeps for approved injection;
 *                the child never receives it.
 * Values that are already sentinels, null, or undefined are left as-is (a
 * sentinel is never double-masked; an absent var is not invented).
 */
export function maskCredentialEnv(env = {}, opts = {}) {
  const mode = opts.mode === "deny" ? "deny" : "mask";
  const out = {};
  const masked = [];
  const vault = new Map();
  for (const [name, value] of Object.entries(env || {})) {
    if (
      value != null &&
      !isSentinel(value) &&
      isCredentialEnvName(name, opts)
    ) {
      masked.push(name);
      vault.set(name, String(value));
      if (mode === "mask") out[name] = makeSentinel(name);
      // mode "deny": drop the var so the child does not even see a sentinel
    } else {
      out[name] = value;
    }
  }
  masked.sort();
  return { env: out, masked, vault };
}

/** Replace a secret value with a fixed marker — never the real value. */
export function redactSecretValue(value) {
  if (value == null) return value;
  return String(value) ? "***" : "";
}

/**
 * A log-safe projection of an env for the audit trail: credential values →
 * "***", sentinels kept verbatim (they hold no secret), everything else
 * untouched. NEVER emits a restored/real credential value.
 */
export function redactEnvForAudit(env = {}, opts = {}) {
  const out = {};
  for (const [name, value] of Object.entries(env || {})) {
    if (isSentinel(value)) out[name] = value;
    else if (isCredentialEnvName(name, opts))
      out[name] = redactSecretValue(value);
    else out[name] = value;
  }
  return out;
}

/**
 * Resolve the real value for a masked credential — but ONLY when the target
 * host is on the approved list. The whole point of the proxy is that the child
 * never gets the raw secret; the parent injects it just-in-time for an approved
 * destination (e.g. the egress proxy adding Authorization for an allowed API
 * host). Returns null (fail closed) for an unknown var, an empty host, or a
 * non-approved host.
 */
export function resolveApprovedInjection(vault, name, opts = {}) {
  if (!(vault instanceof Map) || !vault.has(name)) return null;
  const host = String(opts.host || "").toLowerCase();
  if (!host) return null;
  const approved = (opts.approvedHosts || []).map((h) =>
    String(h || "").toLowerCase(),
  );
  return approved.includes(host) ? vault.get(name) : null;
}

/**
 * Resolve whether the credential proxy is enabled. Env var wins so a spawn
 * seam without config access can still honor it; otherwise the config flag.
 */
export function credentialProxyEnabled(config = {}, env = process.env) {
  const raw = env && env.CC_CREDENTIAL_PROXY;
  if (raw != null) {
    const v = String(raw).toLowerCase();
    return v === "1" || v === "true" || v === "on" || v === "yes";
  }
  return config?.credentialProxy?.enabled === true;
}

/**
 * Apply the credential proxy to a child env when enabled; otherwise return the
 * env UNCHANGED (same reference — the default path stays byte-identical). The
 * returned `vault` lets the caller inject approved creds later.
 *
 * @returns {{env:object, masked:string[], vault:Map, enabled:boolean}}
 */
export function applyCredentialProxy(env, options = {}) {
  const procEnv = options.env || process.env;
  const config = options.config || {};
  if (!credentialProxyEnabled(config, procEnv)) {
    return { env, masked: [], vault: new Map(), enabled: false };
  }
  const allow = new Set([
    ...toSet(options.allow),
    ...(config?.credentialProxy?.allow || []),
  ]);
  const deny = new Set([
    ...toSet(options.deny),
    ...(config?.credentialProxy?.deny || []),
  ]);
  const mode = options.mode || config?.credentialProxy?.mode || "mask";
  const result = maskCredentialEnv(env, { allow, deny, mode });
  return { ...result, enabled: true };
}
