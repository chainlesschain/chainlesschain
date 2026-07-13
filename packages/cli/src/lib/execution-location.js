/**
 * Execution-location model — the "任务在哪执行是 Session 一等属性" core of P1-7
 * (Local / SSH / Cloud / Remote Control 统一模型) of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md.
 *
 * [[execution-backend.js]] is the runtime EXECUTOR (Local / Docker / SSH backends
 * that actually run a command). It is NOT a session-level, displayable, policy
 * layer: it has no notion of "show the user where this runs, with what
 * permissions, whose credentials (source+scope only) and how results return",
 * and no fail-closed default for an UNKNOWN location.
 *
 * This module is that pure descriptor + policy. The P1-7 table requires every
 * session to surface: Execution Location, Source, Permissions, Credentials
 * (source & scope only — never a value), Lifecycle, Cost and Return Path. This
 * module normalizes those, and enforces the two invariants that give it teeth:
 *
 *   1. Credentials NEVER carry values — only {name, source, scope} survive, so a
 *      descriptor can be rendered/logged/shipped without leaking a secret.
 *   2. An UNKNOWN or unrecognized location fails CLOSED to the most-restrictive
 *      permission profile (read-only, no shell/network/mcp/external), because we
 *      must not grant a remote/unknown environment ambient power by default.
 *
 * PURE: no fs / clock / RNG / process. A caller feeds observed session facts and
 * reads back a safe descriptor plus a list of policy violations.
 */

/** Canonical execution locations. UNKNOWN is the fail-closed sink. */
export const EXECUTION_LOCATION = Object.freeze({
  LOCAL: "local",
  WSL: "wsl",
  SSH: "ssh",
  CONTAINER: "container",
  CLOUD: "cloud",
  UNKNOWN: "unknown",
});

const LOCATION_ALIASES = new Map([
  ["local", EXECUTION_LOCATION.LOCAL],
  ["localhost", EXECUTION_LOCATION.LOCAL],
  ["wsl", EXECUTION_LOCATION.WSL],
  ["wsl2", EXECUTION_LOCATION.WSL],
  ["ssh", EXECUTION_LOCATION.SSH],
  ["remote-ssh", EXECUTION_LOCATION.SSH],
  ["remote_ssh", EXECUTION_LOCATION.SSH],
  ["container", EXECUTION_LOCATION.CONTAINER],
  ["docker", EXECUTION_LOCATION.CONTAINER],
  ["devcontainer", EXECUTION_LOCATION.CONTAINER],
  ["dev-container", EXECUTION_LOCATION.CONTAINER],
  ["cloud", EXECUTION_LOCATION.CLOUD],
  ["codespaces", EXECUTION_LOCATION.CLOUD],
  ["codespace", EXECUTION_LOCATION.CLOUD],
  ["sandbox", EXECUTION_LOCATION.CLOUD],
]);

/** Locations that are NOT the user's own trusted machine. */
const REMOTE_LOCATIONS = new Set([
  EXECUTION_LOCATION.SSH,
  EXECUTION_LOCATION.CONTAINER,
  EXECUTION_LOCATION.CLOUD,
]);

/** Normalize any location label to a canonical value; unrecognized → UNKNOWN. */
export function normalizeExecutionLocation(value) {
  if (typeof value !== "string") return EXECUTION_LOCATION.UNKNOWN;
  return (
    LOCATION_ALIASES.get(value.trim().toLowerCase()) ||
    EXECUTION_LOCATION.UNKNOWN
  );
}

export function isRemoteLocation(location) {
  return REMOTE_LOCATIONS.has(normalizeExecutionLocation(location));
}

/**
 * Detect the ambient execution location from process signals. PURE: the caller
 * supplies `env` (process.env) and `dockerEnvFileExists` (existsSync('/.dockerenv'))
 * so this stays fs/process-free and unit-testable. Ordered most-specific-first,
 * so a Codespace (which is also a container) reports CLOUD, and an SSH login
 * outranks a bare WSL marker.
 *
 * @param {{env?:object, dockerEnvFileExists?:boolean}} [signals]
 * @returns {string} a canonical EXECUTION_LOCATION value
 */
export function detectAmbientLocation({ env = {}, dockerEnvFileExists } = {}) {
  const e = env && typeof env === "object" ? env : {};
  const has = (k) => typeof e[k] === "string" && e[k].trim() !== "";

  // Cloud dev environments (GitHub Codespaces) — most specific.
  if (e.CODESPACES === "true" || has("GITHUB_CODESPACE_TOKEN")) {
    return EXECUTION_LOCATION.CLOUD;
  }
  // An interactive SSH login carries these — a remote shell, not the box's own tty.
  if (has("SSH_CONNECTION") || has("SSH_CLIENT") || has("SSH_TTY")) {
    return EXECUTION_LOCATION.SSH;
  }
  // Containers: the classic /.dockerenv marker, an explicit `container` env, or k8s.
  if (
    dockerEnvFileExists === true ||
    has("container") ||
    has("KUBERNETES_SERVICE_HOST")
  ) {
    return EXECUTION_LOCATION.CONTAINER;
  }
  // WSL exports these into every shell.
  if (has("WSL_DISTRO_NAME") || has("WSL_INTEROP")) {
    return EXECUTION_LOCATION.WSL;
  }
  return EXECUTION_LOCATION.LOCAL;
}

/** The most-restrictive permission profile — the fail-closed floor. */
function lockedDownPermissions() {
  return Object.freeze({
    file: "read", // read-only
    shell: false,
    network: false,
    mcp: false,
    externalSystems: false,
  });
}

function normalizeFileAccess(v) {
  const s = String(v || "").toLowerCase();
  if (s === "write" || s === "readwrite" || s === "read-write") return "write";
  if (s === "none") return "none";
  return "read";
}

/**
 * Clamp a requested permission set to what a location may grant. Every ambient
 * power (shell / network / mcp / external) requires an EXPLICIT `true` — an
 * unspecified or truthy-but-not-true power stays off. File access defaults to
 * read; only a write-class request ("write" / "readwrite") grants write. An
 * UNKNOWN location ignores the request entirely and returns the locked-down
 * floor — the fail-closed core.
 */
export function clampPermissionsForLocation(location, requested = {}) {
  const loc = normalizeExecutionLocation(location);
  if (loc === EXECUTION_LOCATION.UNKNOWN) return lockedDownPermissions();

  const req = requested && typeof requested === "object" ? requested : {};
  const grant = (key) => req[key] === true;

  return {
    file: normalizeFileAccess(req.file),
    shell: grant("shell"),
    network: grant("network"),
    mcp: grant("mcp"),
    externalSystems: grant("externalSystems"),
  };
}

/**
 * Strip credential references down to what may be displayed: name, source and
 * scope only. Any `value` / `token` / `secret` field is dropped — this is the
 * enforcement point behind "Credentials 只显示来源和作用域，不显示值".
 */
export function redactCredentialRefs(creds) {
  const list = Array.isArray(creds) ? creds : [];
  return list
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      name: c.name == null ? null : String(c.name),
      source: c.source == null ? null : String(c.source),
      scope: c.scope == null ? null : String(c.scope),
    }));
}

const RETURN_PATHS = new Set([
  "commit",
  "pr",
  "patch",
  "artifact",
  "report",
  "none",
]);

function normalizeReturnPath(v) {
  const s = String(v || "").toLowerCase();
  return RETURN_PATHS.has(s) ? s : "none";
}

/**
 * Build the safe, displayable execution-context descriptor for a session.
 *
 * @param {object} input
 * @param {string} input.location            raw location label
 * @param {object} [input.source]            {dir, repo, commit, repos?}
 * @param {object} [input.permissions]       requested permissions (clamped)
 * @param {Array}  [input.credentials]       credential refs (values stripped)
 * @param {object} [input.lifecycle]         {foreground?, onDisconnect?, onSleep?}
 * @param {object} [input.cost]              {model?, tokenBudget?, remote?}
 * @param {string} [input.returnPath]        commit|pr|patch|artifact|report|none
 * @returns {object} normalized descriptor (safe to render/log/ship)
 */
export function describeExecutionContext(input = {}) {
  const location = normalizeExecutionLocation(input.location);
  const permissions = clampPermissionsForLocation(location, input.permissions);
  const src =
    input.source && typeof input.source === "object" ? input.source : {};
  return {
    location,
    remote: REMOTE_LOCATIONS.has(location),
    source: {
      dir: src.dir == null ? null : String(src.dir),
      repo: src.repo == null ? null : String(src.repo),
      commit: src.commit == null ? null : String(src.commit),
      repos: Array.isArray(src.repos) ? src.repos.map((r) => String(r)) : [],
    },
    permissions,
    credentials: redactCredentialRefs(input.credentials),
    lifecycle: {
      foreground: input.lifecycle?.foreground !== false,
      onDisconnect: input.lifecycle?.onDisconnect
        ? String(input.lifecycle.onDisconnect)
        : "pause",
      onSleep: input.lifecycle?.onSleep
        ? String(input.lifecycle.onSleep)
        : "pause",
    },
    cost: {
      model: input.cost?.model ? String(input.cost.model) : null,
      tokenBudget: Number.isFinite(Number(input.cost?.tokenBudget))
        ? Number(input.cost.tokenBudget)
        : null,
      remote: input.cost?.remote === true,
    },
    returnPath: normalizeReturnPath(input.returnPath),
  };
}

/** Keys that must never appear on a credential ref (a value leak). */
const CREDENTIAL_VALUE_KEYS = ["value", "token", "secret", "password", "key"];

/**
 * Validate a raw execution-context input for policy compliance. EXHAUSTIVE:
 * collects every violation. Fail-closed reads:
 *   - a credential ref carrying a value/token/secret/password/key → leak
 *   - location UNKNOWN → the session runs somewhere we cannot vouch for
 *   - a remote location with no return path → results have nowhere safe to go
 *   - a remote session granted network / external egress → surfaced as
 *     `remote-egress-granted` so it must be explicitly acknowledged, not ambient
 *
 * @returns {{ok:boolean, violations:string[], descriptor:object}}
 */
export function validateExecutionContext(input = {}) {
  const violations = [];
  const rawCreds = Array.isArray(input.credentials) ? input.credentials : [];
  for (const c of rawCreds) {
    if (c && typeof c === "object") {
      for (const k of CREDENTIAL_VALUE_KEYS) {
        if (c[k] != null) {
          violations.push("credential-value-present");
          break;
        }
      }
    }
  }

  const location = normalizeExecutionLocation(input.location);
  if (location === EXECUTION_LOCATION.UNKNOWN) {
    violations.push("unknown-location");
  }

  const descriptor = describeExecutionContext(input);

  if (descriptor.remote && descriptor.returnPath === "none") {
    violations.push("remote-without-return-path");
  }

  // Network / external egress FROM a remote box is the highest-risk grant — it
  // must be an explicit, acknowledged decision, never ambient.
  if (
    descriptor.remote &&
    (descriptor.permissions.network || descriptor.permissions.externalSystems)
  ) {
    violations.push("remote-egress-granted");
  }

  return {
    ok: violations.length === 0,
    violations,
    descriptor,
  };
}
