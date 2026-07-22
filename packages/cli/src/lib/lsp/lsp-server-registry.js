/**
 * LSP server registry — maps a language id to the language-server command that
 * serves it, and probes whether that command is actually installed.
 *
 * Design constraint (see optimization plan): the CLI must NOT depend on any
 * language server as an npm dependency (they are heavy and language-specific).
 * Instead we DETECT servers on PATH / `node_modules/.bin`, and when none is
 * available the caller degrades gracefully to text search. Plugins may register
 * extra servers via `.lsp.json`.
 *
 * Pure + injectable: filesystem/exec probing goes through `_deps` so the
 * detection logic is unit-testable without a real toolchain.
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

export const _deps = {
  existsSync: fs.existsSync,
  execFileSync,
};

// Extension → LSP languageId. Kept small and explicit; unknown extensions get
// no LSP (text-search fallback).
const EXTENSION_LANGUAGE = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".vue": "vue",
};

// languageId → server definition. `bin` names are tried in order; the first one
// resolvable wins. `args` is passed verbatim. Several languageIds can share one
// server family (TS server handles JS too).
const BUILTIN_SERVERS = {
  typescript: tsServer(),
  typescriptreact: tsServer(),
  javascript: tsServer(),
  javascriptreact: tsServer(),
  python: {
    id: "pyright",
    bins: ["pyright-langserver", "pylsp"],
    // pyright wants --stdio; pylsp defaults to stdio with no args. Resolved per-bin.
    argsFor: (bin) => (bin.startsWith("pyright") ? ["--stdio"] : []),
  },
  go: { id: "gopls", bins: ["gopls"], argsFor: () => [] },
  rust: { id: "rust-analyzer", bins: ["rust-analyzer"], argsFor: () => [] },
  java: { id: "jdtls", bins: ["jdtls"], argsFor: () => [] },
};

function tsServer() {
  return {
    id: "typescript-language-server",
    bins: ["typescript-language-server"],
    argsFor: () => ["--stdio"],
  };
}

// Registry of plugin-contributed servers, keyed by languageId → ordered list of
// defs (registration order). Multiple plugins may contribute a server for the
// same languageId/extension; they are tried in order and then fall through to
// the builtin, so one plugin's server being uninstalled or failing to resolve
// does NOT knock out code intelligence for that extension — the next candidate
// (another plugin, or the builtin) still serves it.
const pluginServers = new Map();
// Plugin-contributed extension→languageId overrides, kept SEPARATE from the
// builtin EXTENSION_LANGUAGE map so `_resetPluginServers` (used by
// `/reload-plugins`) can fully roll them back. Mutating the builtin map
// directly meant an uninstalled/untrusted plugin's `.py`→"mylang" remap
// survived a reload — languageIdForFile kept returning the dead languageId and
// the builtin server for that extension became unreachable until process exit.
const pluginExtensions = new Map();

/**
 * Register an extra language server (from a plugin `.lsp.json`).
 * @param {object} def { languageId, extensions?, command, args?, id? }
 */
export function registerLanguageServer(def) {
  if (!def || !def.languageId || !def.command) {
    throw new Error("registerLanguageServer requires { languageId, command }");
  }
  const entry = {
    id: def.id || def.command,
    bins: [def.command],
    argsFor: () => (Array.isArray(def.args) ? def.args : []),
    fromPlugin: true,
    pluginId: def.pluginId || null,
    pluginVersion: def.pluginVersion || null,
    pluginSource: def.pluginSource || null,
  };
  const existing = pluginServers.get(def.languageId) || [];
  // De-dupe by server id so re-registering the same server (e.g. a reload)
  // doesn't stack duplicates, but distinct plugins for one language coexist.
  const list = existing.filter((e) => e.id !== entry.id);
  list.push(entry);
  pluginServers.set(def.languageId, list);
  if (Array.isArray(def.extensions)) {
    for (const ext of def.extensions) {
      pluginExtensions.set(
        ext.startsWith(".") ? ext : "." + ext,
        def.languageId,
      );
    }
  }
}

/** Test/reset hook — clears plugin registrations (servers AND extension maps). */
export function _resetPluginServers() {
  pluginServers.clear();
  pluginExtensions.clear();
}

/** Map a file path to its LSP languageId, or null if unsupported. */
export function languageIdForFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  // Plugin overrides win over builtins (same precedence as pluginServers).
  return pluginExtensions.get(ext) || EXTENSION_LANGUAGE[ext] || null;
}

/**
 * Resolve a runnable server command for a languageId within a project root, or
 * null if none is installed. Checks (in order): project `node_modules/.bin`,
 * then PATH (via `resolveBin`).
 *
 * @returns {{ languageId, id, command, args } | null}
 */
export function resolveServer(languageId, projectRoot) {
  // Try plugin-contributed servers in registration order, then the builtin.
  // The first candidate whose binary actually resolves wins; a plugin server
  // that isn't installed falls through instead of shadowing the builtin.
  const candidates = [...(pluginServers.get(languageId) || [])];
  if (BUILTIN_SERVERS[languageId]) candidates.push(BUILTIN_SERVERS[languageId]);
  for (const def of candidates) {
    for (const bin of def.bins) {
      const command = resolveBin(bin, projectRoot);
      if (command) {
        return {
          languageId,
          id: def.id,
          command,
          args: def.argsFor(bin),
          ...(def.fromPlugin
            ? {
                origin: "plugin:lsp",
                pluginId: def.pluginId,
                pluginVersion: def.pluginVersion,
                pluginSource: def.pluginSource,
              }
            : {}),
        };
      }
    }
  }
  return null;
}

/**
 * Find an executable by name: project-local `node_modules/.bin` first (so a
 * repo-pinned server wins), then the system PATH. Returns an absolute path, or
 * null. On Windows the `.cmd`/`.exe` variants are probed too.
 */
export function resolveBin(bin, projectRoot) {
  const isWin = process.platform === "win32";
  const candidates = isWin ? [bin + ".cmd", bin + ".exe", bin] : [bin];

  // 1) project node_modules/.bin (walk up a couple levels for monorepos)
  if (projectRoot) {
    let dir = projectRoot;
    for (let i = 0; i < 4; i++) {
      const binDir = path.join(dir, "node_modules", ".bin");
      for (const c of candidates) {
        const full = path.join(binDir, c);
        if (_deps.existsSync(full)) return full;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // 2) PATH
  const pathEnv = process.env.PATH || process.env.Path || "";
  const sep = isWin ? ";" : ":";
  for (const entry of pathEnv.split(sep)) {
    if (!entry) continue;
    for (const c of candidates) {
      const full = path.join(entry, c);
      if (_deps.existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * Report which builtin servers are available on this machine — used by
 * `cc doctor` and `cc code-intel status` so the user sees why LSP is or isn't
 * active without guessing.
 * @returns {Array<{ languageId, id, available, command }>}
 */
export function probeServers(projectRoot) {
  const seen = new Set();
  const out = [];
  // One (languageId, def) pair per candidate: every plugin server plus each
  // builtin. Probing each independently means an unavailable plugin server is
  // reported as its own row without hiding the builtin's availability.
  const pairs = [];
  for (const [languageId, defs] of pluginServers) {
    for (const def of defs) pairs.push([languageId, def]);
  }
  for (const [languageId, def] of Object.entries(BUILTIN_SERVERS)) {
    pairs.push([languageId, def]);
  }
  for (const [languageId, def] of pairs) {
    if (seen.has(def.id)) continue; // one row per server family
    seen.add(def.id);
    let command = null;
    for (const bin of def.bins) {
      command = resolveBin(bin, projectRoot);
      if (command) break;
    }
    out.push({
      languageId,
      id: def.id,
      available: Boolean(command),
      command,
    });
  }
  return out;
}

/** All extensions the registry can currently map (for docs/diagnostics). */
export function supportedExtensions() {
  return Object.keys(EXTENSION_LANGUAGE).sort();
}

/**
 * Describe the server that WOULD serve a languageId, whether or not its binary
 * is installed — the first plugin candidate, else the builtin. Unlike
 * `resolveServer` (which returns null when nothing is on PATH), this names the
 * expected server so a doctor / status view can say *what to install*. Returns
 * `{ id, bins }` or null for an unsupported language.
 */
export function describeServer(languageId) {
  const candidates = [...(pluginServers.get(languageId) || [])];
  if (BUILTIN_SERVERS[languageId]) candidates.push(BUILTIN_SERVERS[languageId]);
  const def = candidates[0];
  return def ? { id: def.id, bins: [...def.bins] } : null;
}
