/**
 * App-Preview auto-validation core — the pure-logic half of P1-3
 * (App Preview 自动验证) of CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md.
 *
 * The gap section asks for a project-level Launch config (start command, cwd,
 * port, health check, env references, shutdown policy), a per-turn RISK-based
 * choice of verification tier ("不要求所有改动都启动浏览器" — not every change
 * needs a browser), an evidence-Artifact contract (screenshot / DOM summary /
 * action sequence / test result), and login-state persistence that is OFF by
 * default and must be explicitly scoped (project / session / user).
 *
 * This module is that decision + descriptor layer, NOT a runner: it never spawns
 * a dev server, opens a browser, or touches fs / clock / RNG / process. A caller
 * feeds observed facts (a package.json, a launch config, a change descriptor) and
 * reads back a normalized, safe descriptor plus fail-closed policy verdicts.
 *
 * Two invariants give it teeth, mirroring [[execution-location.js]]:
 *   1. Launch config carries env *references* only (names), never values — a
 *      leaked value is a violation, so the config can be rendered/logged/shipped.
 *   2. Login-state persistence fails CLOSED: OFF unless explicitly enabled AND
 *      given an explicit {project|session|user} scope. An unknown/unscoped
 *      request never silently persists a session cookie jar.
 *
 * Free-text evidence fields are run through [[secret-scan.js]] `redactSecrets`
 * so a captured console error or DOM summary can't smuggle a token into an
 * Artifact.
 *
 * PURE: no fs / clock / RNG / process.
 */

import { redactSecrets, containsSecret } from "./secret-scan.js";

/** Verification tiers, cheapest → most expensive. Risk selects the floor. */
export const VERIFICATION_TIER = Object.freeze({
  STATIC: "static-check", // lint/type/build — no server, no browser
  API_PROBE: "api-probe", // hit an endpoint / health check
  DOM_ASSERT: "dom-assert", // render + assert DOM state
  VISUAL: "visual-screenshot", // capture a screenshot for human/vision review
});

const TIER_ORDER = [
  VERIFICATION_TIER.STATIC,
  VERIFICATION_TIER.API_PROBE,
  VERIFICATION_TIER.DOM_ASSERT,
  VERIFICATION_TIER.VISUAL,
];

/** Evidence artifact kinds the Session persists for a verification run. */
export const EVIDENCE_KIND = Object.freeze({
  SCREENSHOT: "screenshot",
  DOM_SUMMARY: "dom-summary",
  ACTION_SEQUENCE: "action-sequence",
  TEST_RESULT: "test-result",
});

/** Login-state persistence scopes. Anything else → fail-closed (no persist). */
export const LOGIN_SCOPE = Object.freeze({
  PROJECT: "project",
  SESSION: "session",
  USER: "user",
});

const LOGIN_SCOPES = new Set(Object.values(LOGIN_SCOPE));

/**
 * Known dev-server framework signatures → {framework, defaultPort}. Detection
 * looks at dependencies first (most reliable), then falls back to scripts.
 */
const FRAMEWORK_SIGNATURES = Object.freeze([
  { dep: "next", framework: "next", defaultPort: 3000 },
  { dep: "nuxt", framework: "nuxt", defaultPort: 3000 },
  { dep: "@angular/cli", framework: "angular", defaultPort: 4200 },
  { dep: "@vue/cli-service", framework: "vue-cli", defaultPort: 8080 },
  { dep: "astro", framework: "astro", defaultPort: 4321 },
  { dep: "@sveltejs/kit", framework: "sveltekit", defaultPort: 5173 },
  { dep: "gatsby", framework: "gatsby", defaultPort: 8000 },
  { dep: "remix", framework: "remix", defaultPort: 3000 },
  { dep: "@remix-run/dev", framework: "remix", defaultPort: 3000 },
  { dep: "react-scripts", framework: "create-react-app", defaultPort: 3000 },
  { dep: "vite", framework: "vite", defaultPort: 5173 },
  { dep: "webpack-dev-server", framework: "webpack", defaultPort: 8080 },
]);

/** Script names, in preference order, that typically start a dev server. */
const DEV_SCRIPT_NAMES = ["dev", "start", "serve", "develop"];

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Auto-detect a dev-server launch suggestion from a package.json object. Returns
 * `null` when nothing recognizable is present (caller must not guess a command).
 * Never fabricates a port: only a known framework yields a defaultPort; an
 * unknown-framework match from a script alone leaves `port: null`.
 *
 * @param {object} pkg parsed package.json
 * @returns {null | {framework:string|null, script:string|null, startCommand:string|null, port:number|null, source:"dependency"|"script"}}
 */
export function detectDevServer(pkg) {
  const p = asObject(pkg);
  const deps = { ...asObject(p.dependencies), ...asObject(p.devDependencies) };
  const scripts = asObject(p.scripts);

  // Prefer a dependency signature — it tells us both framework and default port.
  for (const sig of FRAMEWORK_SIGNATURES) {
    if (Object.prototype.hasOwnProperty.call(deps, sig.dep)) {
      const script =
        DEV_SCRIPT_NAMES.find((name) => typeof scripts[name] === "string") ||
        null;
      return {
        framework: sig.framework,
        script,
        startCommand: script ? `npm run ${script}` : null,
        port: sig.defaultPort,
        source: "dependency",
      };
    }
  }

  // Fall back to a recognizable dev script with no known framework — we can
  // suggest the command but must not invent a port.
  const script = DEV_SCRIPT_NAMES.find(
    (name) => typeof scripts[name] === "string",
  );
  if (script) {
    return {
      framework: null,
      script,
      startCommand: `npm run ${script}`,
      port: null,
      source: "script",
    };
  }

  return null;
}

function normalizeEnvRefs(env) {
  // Accept an array of names, or an object whose KEYS are the referenced names.
  // Values are intentionally discarded — a launch config references env by name.
  if (Array.isArray(env)) {
    return env.filter((e) => typeof e === "string" && e.trim() !== "");
  }
  if (env && typeof env === "object") {
    return Object.keys(env);
  }
  return [];
}

const SHUTDOWN_POLICIES = new Set(["kill", "graceful", "keep"]);

/**
 * Normalize a raw launch config into a safe descriptor. Env is reduced to
 * reference NAMES only; a port is coerced to a valid TCP port or null; a health
 * check keeps only {path, timeoutMs}. Pure — no validation verdict here (see
 * validateLaunchConfig).
 */
export function normalizeLaunchConfig(input = {}) {
  const cfg = asObject(input);
  const rawPort = Number(cfg.port);
  const port =
    Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
      ? rawPort
      : null;
  const health = asObject(cfg.healthCheck);
  const rawTimeout = Number(health.timeoutMs);
  return {
    startCommand:
      typeof cfg.startCommand === "string" && cfg.startCommand.trim() !== ""
        ? cfg.startCommand.trim()
        : null,
    cwd: cfg.cwd == null ? null : String(cfg.cwd),
    port,
    healthCheck:
      health.path || health.url
        ? {
            path: String(health.path || health.url),
            timeoutMs:
              Number.isFinite(rawTimeout) && rawTimeout > 0
                ? rawTimeout
                : 30000,
          }
        : null,
    envRefs: normalizeEnvRefs(cfg.env),
    shutdown: SHUTDOWN_POLICIES.has(String(cfg.shutdown))
      ? String(cfg.shutdown)
      : "graceful",
  };
}

/** Keys on an env entry that would mean a raw value leaked into the config. */
const ENV_VALUE_LEAK_KEYS = ["value", "secret", "token", "password"];

/**
 * Validate a raw launch config, fail-closed and EXHAUSTIVE (collects every
 * violation). Reads:
 *   - no start command → nothing to launch (`missing-start-command`)
 *   - an env entry object carrying a value/secret/token/password → the config
 *     must reference env by name only (`env-value-present`)
 *   - a health check with no path/url → can't tell when the server is ready
 *     (`health-check-missing-target`) — only flagged when a healthCheck object
 *     was supplied at all
 *   - a startCommand string that itself embeds a secret (`secret-in-command`)
 *
 * @returns {{ok:boolean, violations:string[], config:object}}
 */
export function validateLaunchConfig(input = {}) {
  const violations = [];
  const config = normalizeLaunchConfig(input);

  if (!config.startCommand) {
    violations.push("missing-start-command");
  } else if (containsSecret(config.startCommand)) {
    violations.push("secret-in-command");
  }

  // Env-as-object with a value field is a leak — the config should list names.
  const rawEnv = asObject(input).env;
  if (rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)) {
    for (const v of Object.values(rawEnv)) {
      if (v && typeof v === "object") {
        for (const k of ENV_VALUE_LEAK_KEYS) {
          if (v[k] != null) {
            violations.push("env-value-present");
            break;
          }
        }
      }
    }
  }

  if (asObject(input).healthCheck && !config.healthCheck) {
    violations.push("health-check-missing-target");
  }

  return { ok: violations.length === 0, violations, config };
}

/**
 * Pick the verification tier for a change, by risk — the "不要求所有改动都启动
 * 浏览器" rule. Escalation floor:
 *   - touches nothing runnable / docs-only          → static-check
 *   - touches server/API code                       → api-probe
 *   - touches UI/render code                         → dom-assert
 *   - high risk OR explicit visual concern           → visual-screenshot
 * The caller may pass an explicit `minTier` to raise (never lower) the floor.
 * A change with no signal defaults to the cheapest tier (static-check), never a
 * browser launch.
 *
 * @param {object} change {touchesUi?, touchesApi?, touchesServer?, risk?, visual?, filesTouched?}
 * @param {object} [opts] {minTier?}
 * @returns {{tier:string, reasons:string[]}}
 */
export function selectVerificationTier(change = {}, opts = {}) {
  const c = asObject(change);
  const reasons = [];
  let idx = 0; // static-check floor

  const bump = (tier, reason) => {
    const i = TIER_ORDER.indexOf(tier);
    if (i > idx) idx = i;
    reasons.push(reason);
  };

  if (c.touchesApi === true || c.touchesServer === true) {
    bump(VERIFICATION_TIER.API_PROBE, "server-or-api-change");
  }
  if (c.touchesUi === true) {
    bump(VERIFICATION_TIER.DOM_ASSERT, "ui-change");
  }
  const risk = String(c.risk || "").toLowerCase();
  if (c.visual === true || risk === "high" || risk === "critical") {
    bump(
      VERIFICATION_TIER.VISUAL,
      c.visual === true ? "visual-concern" : "high-risk",
    );
  }

  // An explicit minimum tier can only raise the floor.
  const minIdx = TIER_ORDER.indexOf(String(opts.minTier));
  if (minIdx > idx) {
    idx = minIdx;
    reasons.push("explicit-min-tier");
  }

  return { tier: TIER_ORDER[idx], reasons };
}

/**
 * Build a secret-safe evidence artifact record. Unknown kinds are rejected
 * (returns null) rather than stored blindly. Every free-text field (summary,
 * console/network errors, action labels) is passed through `redactSecrets`, so
 * a captured error string can't leak a token into a persisted Artifact.
 *
 * @param {string} kind one of EVIDENCE_KIND
 * @param {object} data kind-specific payload
 * @returns {null | object} `{kind, tier?, ...redacted fields}`
 */
export function buildEvidenceArtifact(kind, data = {}) {
  const d = asObject(data);
  const redact = (s) => (typeof s === "string" ? redactSecrets(s) : null);
  const base = {
    kind,
    tier: TIER_ORDER.includes(d.tier) ? d.tier : null,
    label: redact(d.label),
  };
  switch (kind) {
    case EVIDENCE_KIND.SCREENSHOT:
      return {
        ...base,
        // The image bytes/path are opaque to this layer; only metadata here.
        ref: d.ref == null ? null : String(d.ref),
        width: Number.isFinite(Number(d.width)) ? Number(d.width) : null,
        height: Number.isFinite(Number(d.height)) ? Number(d.height) : null,
      };
    case EVIDENCE_KIND.DOM_SUMMARY:
      return { ...base, summary: redact(d.summary) };
    case EVIDENCE_KIND.ACTION_SEQUENCE:
      return {
        ...base,
        steps: Array.isArray(d.steps)
          ? d.steps.map((s) => redact(String(s)))
          : [],
      };
    case EVIDENCE_KIND.TEST_RESULT:
      return {
        ...base,
        passed: d.passed === true,
        total: Number.isFinite(Number(d.total)) ? Number(d.total) : null,
        failed: Number.isFinite(Number(d.failed)) ? Number(d.failed) : null,
        output: redact(d.output),
      };
    default:
      return null;
  }
}

/**
 * Resolve whether login-state (cookie jar / auth session) may be persisted for a
 * preview run, and at what scope. Fail-closed:
 *   - persistence is OFF unless `enabled === true`
 *   - even when enabled, an unknown/absent scope → NOT persisted
 * Returns the reason when persistence is denied so the UI can prompt for an
 * explicit scope. Mirrors the credential fail-closed posture elsewhere.
 *
 * @param {object} req {enabled?, scope?}
 * @returns {{persist:boolean, scope:string|null, reason:string|null}}
 */
export function resolveLoginStateScope(req = {}) {
  const r = asObject(req);
  if (r.enabled !== true) {
    return { persist: false, scope: null, reason: "not-enabled" };
  }
  const scope = String(r.scope || "").toLowerCase();
  if (!LOGIN_SCOPES.has(scope)) {
    return { persist: false, scope: null, reason: "scope-unspecified" };
  }
  return { persist: true, scope, reason: null };
}
