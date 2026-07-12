/**
 * Unified plugin manifest — parse + normalize a ChainlessChain plugin into the
 * full set of components it contributes (Phase 3 of the CLI parity plan).
 *
 * Today the CLI only understands `manifest.skills[]` (harness/plugin-manager.js).
 * A real extension unit bundles more than skills, so this module reads the
 * unified layout:
 *
 *   plugin/
 *   ├── .chainlesschain-plugin/plugin.json   (metadata; legacy top-level plugin.json accepted)
 *   ├── skills/<name>/SKILL.md
 *   ├── agents/<name>.md
 *   ├── hooks/hooks.json
 *   ├── .mcp.json
 *   ├── .lsp.json
 *   ├── monitors/monitors.json
 *   ├── bin/<exe>
 *   └── settings.json
 *
 * Each component may be declared EXPLICITLY in plugin.json or discovered BY
 * CONVENTION (explicit wins). Every resolved path is checked to stay inside the
 * plugin root — a manifest that points at `../../etc` is rejected, never
 * followed. Pure + `_deps`-injectable so it is fully unit-testable with no real
 * filesystem.
 */

import fs from "fs";
import path from "path";
import semver from "semver";
import {
  normalizeCapabilities,
  normalizeOptionsSchema,
  auditDeclaredCapabilities,
} from "./capabilities.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
};

/** True when `child` resolves to `parent` or a path strictly inside it. */
export function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Locate the manifest file for a plugin root, preferring the namespaced
 * `.chainlesschain-plugin/plugin.json` over the legacy top-level `plugin.json`.
 * @returns {string|null} absolute manifest path
 */
export function findManifestPath(root) {
  const preferred = path.join(root, ".chainlesschain-plugin", "plugin.json");
  if (_deps.existsSync(preferred)) return preferred;
  const legacy = path.join(root, "plugin.json");
  if (_deps.existsSync(legacy)) return legacy;
  return null;
}

/**
 * Parse and normalize a plugin at `root`. Never throws — problems are collected
 * in `errors`/`warnings` and `ok` reflects whether it is safe to load.
 *
 * @param {string} root  plugin root directory
 * @returns {object} normalized manifest (see module doc)
 */
export function parsePluginManifest(root) {
  const errors = [];
  const warnings = [];
  const abs = path.resolve(root);

  const result = {
    ok: false,
    root: abs,
    manifestPath: null,
    scope: null,
    metadata: {},
    components: emptyComponents(),
    // Declarative security contract (P1): the plugin's declared capabilities
    // (manifest.permissions) + typed config schema (manifest.optionsSchema),
    // normalized by capabilities.js. `capabilitiesDeclared` distinguishes a
    // plugin that declared a permissions block (subject to the declared-vs-
    // actual audit) from a legacy one that declared nothing (unrestricted).
    capabilities: normalizeCapabilities(null),
    capabilitiesDeclared: false,
    optionsSchema: {},
    errors,
    warnings,
  };

  if (!_deps.existsSync(abs)) {
    errors.push(`plugin root does not exist: ${abs}`);
    return result;
  }

  const manifestPath = findManifestPath(abs);
  if (!manifestPath) {
    errors.push(
      "no manifest found (.chainlesschain-plugin/plugin.json or plugin.json)",
    );
    return result;
  }
  result.manifestPath = manifestPath;

  let manifest;
  try {
    manifest = JSON.parse(_deps.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    errors.push(`manifest is not valid JSON: ${err.message}`);
    return result;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("manifest must be a JSON object");
    return result;
  }

  // ── metadata ──
  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  if (!name) errors.push("manifest.name is required");
  else if (!/^[a-zA-Z0-9._@/-]+$/.test(name)) {
    errors.push(`manifest.name has invalid characters: "${name}"`);
  }
  const version =
    typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!version) errors.push("manifest.version is required");
  else if (!semver.valid(version)) {
    errors.push(`manifest.version is not valid semver: "${version}"`);
  }
  result.metadata = {
    name,
    version,
    description: strOr(manifest.description, ""),
    author: strOr(manifest.author, ""),
    homepage: strOr(manifest.homepage, ""),
    license: strOr(manifest.license, ""),
  };

  // A helper that resolves a plugin-relative path safely, recording an error if
  // it escapes the root or is absolute. Returns the absolute path or null.
  const safeResolve = (rel, label) => {
    if (typeof rel !== "string" || rel === "") {
      errors.push(`${label}: path must be a non-empty string`);
      return null;
    }
    if (path.isAbsolute(rel)) {
      errors.push(`${label}: absolute paths are not allowed ("${rel}")`);
      return null;
    }
    const resolved = path.resolve(abs, rel);
    if (!isWithin(abs, resolved)) {
      errors.push(`${label}: path escapes the plugin root ("${rel}")`);
      return null;
    }
    return resolved;
  };

  const c = result.components;
  c.skills = resolveSkills(abs, manifest, safeResolve, warnings);
  c.agents = resolveAgents(abs, manifest, safeResolve, warnings);
  c.hooks = resolveJsonComponent(abs, manifest, safeResolve, {
    field: "hooks",
    conventionPath: ["hooks", "hooks.json"],
    listKey: "hooks",
  });
  c.mcp = resolveJsonComponent(abs, manifest, safeResolve, {
    field: "mcp",
    conventionPath: [".mcp.json"],
    listKey: "mcpServers",
  });
  c.monitors = resolveJsonComponent(abs, manifest, safeResolve, {
    field: "monitors",
    conventionPath: ["monitors", "monitors.json"],
    listKey: "monitors",
  });
  c.lsp = resolveLsp(abs, manifest, safeResolve, errors, warnings);
  c.bin = resolveBin(abs, manifest, safeResolve, warnings);
  c.settings = resolveSettings(abs, manifest, safeResolve);

  // ── declared capabilities + options schema (P1) ──
  const hasPermissions =
    manifest.permissions &&
    typeof manifest.permissions === "object" &&
    !Array.isArray(manifest.permissions);
  result.capabilities = normalizeCapabilities(manifest.permissions);
  result.capabilitiesDeclared = Boolean(hasPermissions);
  result.optionsSchema = normalizeOptionsSchema(manifest.optionsSchema);
  // Declared-vs-actual audit runs ONLY when a permissions block is present — a
  // legacy plugin that declares nothing is unrestricted by design, so it never
  // gets these warnings (keeps existing manifests warning-free).
  if (hasPermissions) {
    for (const f of auditDeclaredCapabilities(result)) {
      warnings.push(`capability: ${f.reason}`);
    }
  }

  result.ok = errors.length === 0;
  return result;
}

/** Per-type counts for a parsed manifest (used by validate/list output). */
export function summarizeComponents(manifest) {
  const c = manifest.components || emptyComponents();
  return {
    skills: c.skills.length,
    agents: c.agents.length,
    hooks: c.hooks ? c.hooks.count || (c.hooks.file ? 1 : 0) : 0,
    mcp: c.mcp ? c.mcp.count || 0 : 0,
    lsp: c.lsp.length,
    monitors: c.monitors ? c.monitors.count || 0 : 0,
    bin: c.bin.length,
    settings: c.settings ? 1 : 0,
  };
}

// ── component resolvers ──────────────────────────────────────────────────

function emptyComponents() {
  return {
    skills: [],
    agents: [],
    hooks: null,
    mcp: null,
    lsp: [],
    monitors: null,
    bin: [],
    settings: null,
  };
}

function resolveSkills(root, manifest, safeResolve, warnings) {
  const out = [];
  const seen = new Set();
  const push = (name, rel) => {
    const absPath = safeResolve(rel, `skills["${name}"]`);
    if (!absPath) return;
    if (!_deps.existsSync(absPath)) {
      warnings.push(`skill "${name}" path not found: ${rel}`);
      return;
    }
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, path: rel, absPath });
  };

  if (Array.isArray(manifest.skills)) {
    for (const entry of manifest.skills) {
      if (entry && typeof entry === "object") {
        if (typeof entry.name === "string" && typeof entry.path === "string") {
          push(entry.name, entry.path);
        }
      }
    }
    return out;
  }

  // Convention: skills/<name>/ (each a skill dir, ideally with SKILL.md).
  const dir = path.join(root, "skills");
  if (dirExists(dir)) {
    for (const name of listDirs(dir)) {
      push(name, path.join("skills", name));
    }
  }
  return out;
}

function resolveAgents(root, manifest, safeResolve, warnings) {
  const out = [];
  const seen = new Set();
  const push = (name, rel) => {
    const absPath = safeResolve(rel, `agents["${name}"]`);
    if (!absPath) return;
    if (!_deps.existsSync(absPath)) {
      warnings.push(`agent "${name}" path not found: ${rel}`);
      return;
    }
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, path: rel, absPath });
  };

  if (Array.isArray(manifest.agents)) {
    for (const entry of manifest.agents) {
      if (entry && typeof entry === "object") {
        if (typeof entry.name === "string" && typeof entry.path === "string") {
          push(entry.name, entry.path);
        }
      }
    }
    return out;
  }

  const dir = path.join(root, "agents");
  if (dirExists(dir)) {
    for (const file of listFiles(dir, /\.(md|json)$/i)) {
      push(file.replace(/\.(md|json)$/i, ""), path.join("agents", file));
    }
  }
  return out;
}

/**
 * Resolve a JSON-file component (hooks / mcp / monitors). Accepts an inline
 * object in the manifest, an explicit path string, or a convention path.
 */
function resolveJsonComponent(root, manifest, safeResolve, opts) {
  const { field, conventionPath, listKey } = opts;
  const inline = manifest[field];

  // Inline object literal in the manifest (no separate file).
  if (
    inline &&
    typeof inline === "object" &&
    !Array.isArray(inline) &&
    !inline.path
  ) {
    return { inline: true, file: null, ...extractList(inline, listKey) };
  }

  let rel = null;
  if (typeof inline === "string") rel = inline;
  else if (
    inline &&
    typeof inline === "object" &&
    typeof inline.path === "string"
  ) {
    rel = inline.path;
  } else {
    const conv = path.join(root, ...conventionPath);
    if (_deps.existsSync(conv)) rel = path.join(...conventionPath);
  }
  if (!rel) return null;

  const absPath = safeResolve(rel, field);
  if (!absPath || !_deps.existsSync(absPath)) return null;
  let content = null;
  try {
    content = JSON.parse(_deps.readFileSync(absPath, "utf8"));
  } catch {
    content = null;
  }
  return {
    inline: false,
    file: rel,
    absPath,
    ...extractList(content || {}, listKey),
  };
}

function extractList(obj, listKey) {
  const val = obj && obj[listKey];
  if (Array.isArray(val)) {
    return {
      count: val.length,
      names: val.map((v) => v?.name || v?.id || null).filter(Boolean),
    };
  }
  if (val && typeof val === "object") {
    const names = Object.keys(val);
    return { count: names.length, names };
  }
  return { count: 0, names: [] };
}

function resolveLsp(root, manifest, safeResolve, errors, warnings) {
  let content = manifest.lsp;
  // Convention file `.lsp.json`.
  if (!content) {
    const conv = path.join(root, ".lsp.json");
    if (_deps.existsSync(conv)) {
      try {
        content = JSON.parse(_deps.readFileSync(conv, "utf8"));
      } catch (err) {
        errors.push(`.lsp.json is not valid JSON: ${err.message}`);
        return [];
      }
    }
  }
  if (!content) return [];

  // Accept either { servers: [...] } or a bare array.
  const servers = Array.isArray(content)
    ? content
    : Array.isArray(content.servers)
      ? content.servers
      : [];
  const out = [];
  for (const s of servers) {
    if (!s || typeof s !== "object") continue;
    if (typeof s.languageId !== "string" || typeof s.command !== "string") {
      warnings.push("lsp server entry missing languageId/command — skipped");
      continue;
    }
    out.push({
      languageId: s.languageId,
      command: s.command,
      args: Array.isArray(s.args) ? s.args.map(String) : [],
      extensions: Array.isArray(s.extensions) ? s.extensions.map(String) : [],
      id: typeof s.id === "string" ? s.id : s.command,
    });
  }
  return out;
}

function resolveBin(root, manifest, safeResolve, warnings) {
  const out = [];
  const seen = new Set();
  const push = (name, rel) => {
    const absPath = safeResolve(rel, `bin["${name}"]`);
    if (!absPath) return;
    if (!_deps.existsSync(absPath)) {
      warnings.push(`bin "${name}" path not found: ${rel}`);
      return;
    }
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, path: rel, absPath });
  };

  if (
    manifest.bin &&
    typeof manifest.bin === "object" &&
    !Array.isArray(manifest.bin)
  ) {
    for (const [name, rel] of Object.entries(manifest.bin)) {
      if (typeof rel === "string") push(name, rel);
    }
    return out;
  }

  const dir = path.join(root, "bin");
  if (dirExists(dir)) {
    for (const file of listFiles(dir, null)) {
      push(file, path.join("bin", file));
    }
  }
  return out;
}

function resolveSettings(root, manifest, safeResolve) {
  let rel = null;
  if (typeof manifest.settings === "string") rel = manifest.settings;
  else {
    const conv = path.join(root, "settings.json");
    if (_deps.existsSync(conv)) rel = "settings.json";
  }
  if (!rel) return null;
  const absPath = safeResolve(rel, "settings");
  if (!absPath || !_deps.existsSync(absPath)) return null;
  return { file: rel, absPath };
}

// ── small fs helpers (all through _deps) ─────────────────────────────────

function strOr(v, fallback) {
  return typeof v === "string" ? v : fallback;
}

function dirExists(dir) {
  try {
    return _deps.existsSync(dir) && _deps.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDirs(dir) {
  try {
    return _deps
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function listFiles(dir, pattern) {
  try {
    return _deps
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!pattern || pattern.test(e.name)))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
