/**
 * Plugin capability declaration + typed options schema — the manifest's
 * declarative SECURITY CONTRACT (P1 "Plugin 能力声明和配置 Schema").
 *
 * Two concerns, both pure (no I/O), both parsed from `plugin.json`:
 *
 * 1. **Declared capabilities** (`manifest.permissions`) — what a plugin is
 *    allowed to touch: process spawning, network domains, filesystem roots,
 *    MCP, monitors, credentials. On install/upgrade a `diffCapabilities`
 *    surfaces what CHANGED; any WIDENING (a new capability, a new domain/root)
 *    forces a fresh consent (`consentRequiredForUpgrade`). `auditDeclaredCapabilities`
 *    catches the "declares no network but ships an MCP server" mismatch — a
 *    plugin whose COMPONENTS need a capability it did not DECLARE.
 *
 * 2. **Typed options schema** (`manifest.optionsSchema`) — each config key's
 *    type/default/required/enum/scope/sensitivity. `validateOptions` enforces
 *    it AND the invariant that a `sensitive` option can NEVER be supplied from
 *    project config (it must come from the user scope / OS keychain), so a
 *    checked-in project file can't smuggle a secret. `redactSensitiveOptions`
 *    masks secrets for logs/audit.
 *
 * Trust today is exact-version (see [[trust.js]]); this module is what an
 * install/upgrade flow consults to decide whether that trust must be re-taken.
 */

// ─── capabilities ───────────────────────────────────────────────────────────

export const CAPABILITY_KINDS = Object.freeze([
  "process",
  "network",
  "filesystem",
  "mcp",
  "monitor",
  "credential",
]);

function toBool(v) {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** Normalize a string list (array | comma-string | null) → deduped string[]. */
function toList(v) {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const s = String(item).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** A `network` declaration → `{ any, domains }`. `true`/`"*"` = any host. */
function normalizeNetwork(v) {
  if (v === true || v === "*") return { any: true, domains: [] };
  if (Array.isArray(v) || typeof v === "string") {
    const domains = toList(v);
    return {
      any: domains.includes("*"),
      domains: domains.filter((d) => d !== "*"),
    };
  }
  if (v && typeof v === "object") {
    const domains = toList(v.domains);
    return {
      any: toBool(v.any) || domains.includes("*"),
      domains: domains.filter((d) => d !== "*"),
    };
  }
  return { any: false, domains: [] };
}

/**
 * Normalize a manifest `permissions` block into the canonical capability set.
 * Everything defaults to DENY (false / empty) — a capability must be declared.
 */
export function normalizeCapabilities(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    process: toBool(r.process),
    network: normalizeNetwork(r.network),
    filesystem: { roots: toList(r.filesystem ?? r.filesystemRoots) },
    mcp: toBool(r.mcp),
    monitor: toBool(r.monitor ?? r.monitors),
    credential: { names: toList(r.credential ?? r.credentials) },
  };
}

const EMPTY_CAPS = normalizeCapabilities(null);

/**
 * What `next` grants that `prev` did not (and vice-versa). Each entry is a
 * stable string token (e.g. "process", "network:*", "network:api.x.com",
 * "filesystem:/tmp", "credential:GH_TOKEN"). `widened` = any new grant.
 */
export function diffCapabilities(prev, next) {
  const a = prev || EMPTY_CAPS;
  const b = next || EMPTY_CAPS;
  const added = [];
  const removed = [];

  const boolCap = (key) => {
    if (b[key] && !a[key]) added.push(key);
    else if (!b[key] && a[key]) removed.push(key);
  };
  boolCap("process");
  boolCap("mcp");
  boolCap("monitor");

  // network
  if (b.network.any && !a.network.any) added.push("network:*");
  if (!b.network.any && a.network.any) removed.push("network:*");
  if (!a.network.any) {
    for (const d of b.network.domains) {
      if (!a.network.domains.includes(d)) added.push(`network:${d}`);
    }
  }
  for (const d of a.network.domains) {
    if (!b.network.any && !b.network.domains.includes(d))
      removed.push(`network:${d}`);
  }

  const listCap = (key, prefix, pick) => {
    const av = pick(a);
    const bv = pick(b);
    for (const x of bv) if (!av.includes(x)) added.push(`${prefix}:${x}`);
    for (const x of av) if (!bv.includes(x)) removed.push(`${prefix}:${x}`);
  };
  listCap("filesystem", "filesystem", (c) => c.filesystem.roots);
  listCap("credential", "credential", (c) => c.credential.names);

  return { added, removed, widened: added.length > 0 };
}

/**
 * Consent must be re-taken on upgrade when the capability set WIDENS (a new
 * grant appears). A pure re-install from empty (first install) therefore always
 * requires consent for whatever it declares.
 */
export function consentRequiredForUpgrade({
  prevCaps = null,
  nextCaps = null,
} = {}) {
  return diffCapabilities(prevCaps, nextCaps).widened;
}

/** Human-readable lines for an install/upgrade capability prompt. */
export function describeCapabilities(caps) {
  const c = caps || EMPTY_CAPS;
  const lines = [];
  if (c.process)
    lines.push("process: may spawn processes / run bundled binaries & hooks");
  if (c.network.any) lines.push("network: ANY host");
  else if (c.network.domains.length)
    lines.push(`network: ${c.network.domains.join(", ")}`);
  if (c.filesystem.roots.length)
    lines.push(`filesystem: ${c.filesystem.roots.join(", ")}`);
  if (c.mcp) lines.push("mcp: may run MCP servers");
  if (c.monitor) lines.push("monitor: may run background monitors");
  if (c.credential.names.length)
    lines.push(`credential: ${c.credential.names.join(", ")}`);
  return lines;
}

/**
 * Catch a manifest whose COMPONENTS need a capability it did not DECLARE — e.g.
 * ships an MCP server but declared no `mcp`/`network`, or ships bin/hooks/lsp
 * (which spawn processes) without `process`. Best-effort static check; returns
 * `[{capability, reason}]`. Callers run it only when a `permissions` block is
 * present (an undeclared legacy plugin is unrestricted by design).
 */
export function auditDeclaredCapabilities(manifest) {
  const caps = manifest?.capabilities || EMPTY_CAPS;
  const comp = manifest?.components || {};
  const findings = [];
  const has = (v) =>
    Array.isArray(v)
      ? v.length > 0
      : Boolean(v && (v.count || v.file || v.inline));

  const spawns =
    has(comp.bin) ||
    has(comp.hooks) ||
    (Array.isArray(comp.lsp) && comp.lsp.length > 0);
  if (spawns && !caps.process) {
    findings.push({
      capability: "process",
      reason:
        "ships bin/hooks/lsp that spawn processes but did not declare the 'process' capability",
    });
  }
  if (has(comp.mcp) && !caps.mcp) {
    findings.push({
      capability: "mcp",
      reason: "ships an MCP server but did not declare the 'mcp' capability",
    });
  }
  if (has(comp.mcp) && !caps.network.any && caps.network.domains.length === 0) {
    findings.push({
      capability: "network",
      reason:
        "ships an MCP server (which typically needs network) but declared no network domains",
    });
  }
  if (has(comp.monitors) && !caps.monitor) {
    findings.push({
      capability: "monitor",
      reason: "ships monitors but did not declare the 'monitor' capability",
    });
  }
  return findings;
}

// ─── options schema ─────────────────────────────────────────────────────────

export const OPTION_TYPES = Object.freeze([
  "string",
  "number",
  "boolean",
  "enum",
  "string[]",
]);
export const OPTION_SCOPES = Object.freeze(["user", "project", "both"]);

/**
 * Normalize a manifest `optionsSchema` (key → descriptor) into a canonical map.
 * Unknown types default to "string"; `scope` defaults to "both"; `sensitive`
 * defaults false. A sensitive option is never allowed at project scope, so its
 * effective scope is narrowed to "user" here (validateOptions also enforces it).
 */
export function normalizeOptionsSchema(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [key, descRaw] of Object.entries(r)) {
    const d = descRaw && typeof descRaw === "object" ? descRaw : {};
    const type = OPTION_TYPES.includes(d.type) ? d.type : "string";
    const sensitive = toBool(d.sensitive);
    let scope = OPTION_SCOPES.includes(d.scope) ? d.scope : "both";
    if (sensitive && scope !== "user") scope = "user"; // secrets: user scope only
    out[key] = {
      type,
      default: d.default === undefined ? null : d.default,
      required: toBool(d.required),
      enum:
        type === "enum" && Array.isArray(d.enum) ? d.enum.map(String) : null,
      scope,
      sensitive,
      description: typeof d.description === "string" ? d.description : "",
    };
  }
  return out;
}

/** The default value object for a schema (keys with a non-null default). */
export function optionDefaults(schema) {
  const out = {};
  for (const [key, d] of Object.entries(schema || {})) {
    if (d.default !== null && d.default !== undefined) out[key] = d.default;
  }
  return out;
}

function coerce(type, value, enumVals) {
  switch (type) {
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      const s = String(value).trim().toLowerCase();
      if (["true", "1", "yes"].includes(s)) return { ok: true, value: true };
      if (["false", "0", "no"].includes(s)) return { ok: true, value: false };
      return { ok: false };
    }
    case "enum":
      return enumVals && enumVals.includes(String(value))
        ? { ok: true, value: String(value) }
        : { ok: false };
    case "string[]": {
      if (Array.isArray(value)) return { ok: true, value: value.map(String) };
      if (typeof value === "string") return { ok: true, value: toList(value) };
      return { ok: false };
    }
    default:
      return { ok: true, value: String(value) };
  }
}

/**
 * Validate a values object against an options schema at a given scope. Enforces
 * types, `required`, `enum`, per-option `scope`, and the SENSITIVE-not-from-
 * project invariant. Returns the merged/coerced values plus errors/warnings —
 * never throws.
 *
 * @param {object} schema   from normalizeOptionsSchema
 * @param {object} values   the config values to check
 * @param {object} [opts]   { scope: 'user'|'project' }
 * @returns {{ok:boolean, errors:string[], warnings:string[], normalized:object}}
 */
export function validateOptions(schema, values, { scope = "user" } = {}) {
  const s = schema || {};
  const v = values && typeof values === "object" ? values : {};
  const errors = [];
  const warnings = [];
  const normalized = optionDefaults(s);

  for (const [key, d] of Object.entries(s)) {
    const provided = Object.prototype.hasOwnProperty.call(v, key);
    if (!provided) {
      if (d.required && normalized[key] === undefined) {
        errors.push(`missing required option "${key}"`);
      }
      continue;
    }
    // sensitive secrets can never come from a project-scoped config file.
    if (d.sensitive && scope === "project") {
      errors.push(
        `option "${key}" is sensitive and cannot be set from project config — use user scope / OS keychain`,
      );
      continue;
    }
    // a user-only option may not be set at project scope.
    if (d.scope === "user" && scope === "project") {
      errors.push(
        `option "${key}" is user-scoped and cannot be set from project config`,
      );
      continue;
    }
    if (d.scope === "project" && scope === "user") {
      warnings.push(
        `option "${key}" is project-scoped; a user value may be ignored`,
      );
    }
    const c = coerce(d.type, v[key], d.enum);
    if (!c.ok) {
      errors.push(
        `option "${key}" must be ${d.type}${d.enum ? ` (${d.enum.join("|")})` : ""}`,
      );
      continue;
    }
    normalized[key] = c.value;
  }

  for (const key of Object.keys(v)) {
    if (!Object.prototype.hasOwnProperty.call(s, key)) {
      warnings.push(`unknown option "${key}" (not in optionsSchema)`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, normalized };
}

/** Clone `values` with every schema-declared sensitive key masked. */
export function redactSensitiveOptions(schema, values) {
  const s = schema || {};
  const out = {};
  for (const [key, val] of Object.entries(values || {})) {
    out[key] = s[key]?.sensitive ? "***" : val;
  }
  return out;
}
