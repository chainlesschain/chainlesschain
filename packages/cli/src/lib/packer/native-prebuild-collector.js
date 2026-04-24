/**
 * Phase 4: native-prebuild-collector
 *
 * Locate prebuilt .node files for the optional native SQLite drivers
 * (better-sqlite3-multiple-ciphers, better-sqlite3) and copy them into a
 * per-target prebuilds/ folder that pkg will embed as assets.
 *
 * None of these are required: the runtime falls back to sql.js (WASM) —
 * see packages/core-db/lib/database-manager.js `loadSQLiteDriver`. That
 * fallback is what makes the pack runnable on platforms where the native
 * module was never built (non-standard macOS/Linux hardware, CI images,
 * ABI skew). We still try hard to include a native copy because it is
 * 10-100x faster for typical workloads.
 *
 * Target identifier format mirrors @yao-pkg/pkg: nodeXX-<os>-<arch>
 *   - nodeXX  -> module ABI (node20=115, node22=127)
 *   - os      -> win, macos, linux, alpine
 *   - arch    -> x64, arm64
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PackError, EXIT } from "./errors.js";

/**
 * Modules we attempt to locate; all optional because sql.js covers the
 * fallback. Missing ones are reported but never abort the build.
 */
const TARGET_MODULES = [
  { name: "better-sqlite3-multiple-ciphers", required: false },
  { name: "better-sqlite3", required: false },
];

/**
 * @param {object} ctx
 * @param {string} ctx.cliRoot
 * @param {string[]} ctx.targets         e.g. ["node20-win-x64"]
 * @param {string} ctx.tempDir           build temp dir
 * @returns {{ prebuildsDir: string|null, collected: Array, missing: Array }}
 */
export function collectPrebuilds(ctx) {
  const { cliRoot, targets, tempDir } = ctx;
  const collected = [];
  const missing = [];

  if (!targets || targets.length === 0) {
    return { prebuildsDir: null, collected, missing };
  }

  const prebuildsDir = path.join(tempDir, "prebuilds");
  fs.mkdirSync(prebuildsDir, { recursive: true });

  for (const target of targets) {
    const platformKey = pkgTargetToPlatformKey(target);
    if (!platformKey) {
      throw new PackError(`Unrecognized pkg target: "${target}"`, EXIT.NATIVE);
    }
    const targetDir = path.join(prebuildsDir, platformKey);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const mod of TARGET_MODULES) {
      const sourceNode = findInstalledNodeFile(cliRoot, mod.name);
      if (!sourceNode) {
        missing.push({ target, module: mod.name, required: mod.required });
        continue;
      }
      const destFile = path.join(targetDir, `${mod.name}.node`);
      fs.copyFileSync(sourceNode, destFile);
      collected.push({
        target,
        module: mod.name,
        from: sourceNode,
        to: destFile,
      });
    }
  }

  // Nothing is hard-required anymore — the runtime falls back to sql.js
  // (WASM) when no native driver loads. Callers should surface `missing`
  // to the user so they understand the performance trade-off.
  const sqlJs = collectSqlJsAssets(cliRoot, prebuildsDir);

  return { prebuildsDir, collected, missing, sqlJs };
}

/**
 * Copy sql.js runtime assets (sql-wasm.js + sql-wasm.wasm) into
 * prebuildsDir/sqljs/ so the packed binary can find them. pkg itself
 * cannot embed .wasm via dynamic require, so we treat it as an asset
 * and load it from a disk path at runtime (database-manager falls back
 * to sql.js automatically when natives are absent).
 *
 * Returns { assetDir, copied:[{from,to}] } or null when sql.js isn't
 * installed — in that case the runtime will hit the "no SQLite driver"
 * error, which the user will have seen flagged during pack.
 */
function collectSqlJsAssets(cliRoot, prebuildsDir) {
  for (const dir of listCandidateModuleDirs(cliRoot, "sql.js")) {
    const dist = path.join(dir, "dist");
    if (!fs.existsSync(dist)) continue;
    const js = path.join(dist, "sql-wasm.js");
    const wasm = path.join(dist, "sql-wasm.wasm");
    if (!fs.existsSync(js) || !fs.existsSync(wasm)) continue;

    const assetDir = path.join(prebuildsDir, "sqljs");
    fs.mkdirSync(assetDir, { recursive: true });
    const copied = [];
    for (const src of [js, wasm]) {
      const to = path.join(assetDir, path.basename(src));
      fs.copyFileSync(src, to);
      copied.push({ from: src, to });
    }
    return { assetDir, copied };
  }
  return null;
}

/**
 * Map "node20-win-x64" -> "win32-x64".
 * Returns null for unrecognized targets.
 */
export function pkgTargetToPlatformKey(target) {
  // node20-win-x64
  const m = /^node\d+-([a-z]+)-([a-z0-9]+)$/.exec(target);
  if (!m) return null;
  const osMap = {
    win: "win32",
    macos: "darwin",
    linux: "linux",
    alpine: "linux",
  };
  const os = osMap[m[1]];
  if (!os) return null;
  return `${os}-${m[2]}`;
}

/**
 * Collect ALL candidate install dirs for a module reachable from cliRoot.
 * In a monorepo a module can exist in several places:
 *   - the hoisted copy at <repoRoot>/node_modules/<mod> (often source-only,
 *     no compiled binary)
 *   - a transitive copy inside a sibling workspace package such as
 *     <repoRoot>/packages/core-db/node_modules/<mod> (this one has the
 *     actual compiled .node)
 *   - the canonical resolved path returned by createRequire
 *
 * We return the union (in priority order) so the caller can pick the
 * first candidate that actually has a usable .node binary, sidestepping
 * the "resolver returns the source-only hoisted copy" trap.
 */
function listCandidateModuleDirs(cliRoot, moduleName) {
  const out = [];
  const seen = new Set();
  const push = (dir) => {
    if (!dir) return;
    const norm = path.resolve(dir);
    if (seen.has(norm)) return;
    if (!fs.existsSync(path.join(norm, "package.json"))) return;
    seen.add(norm);
    out.push(norm);
  };

  // 1. Standard node resolution
  try {
    const req = createRequire(path.join(cliRoot, "package.json"));
    push(path.dirname(req.resolve(`${moduleName}/package.json`)));
  } catch {
    /* skip */
  }

  // 2. Walk up parent chain
  let cur = cliRoot;
  while (true) {
    push(path.join(cur, "node_modules", moduleName));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 3. Sibling workspace packages may carry a nested copy with the
  //    binary (common for monorepos with optional deps that the root
  //    install hoisted but never built).
  const repoRoot = findRepoRoot(cliRoot);
  if (repoRoot) {
    const packagesDir = path.join(repoRoot, "packages");
    if (fs.existsSync(packagesDir)) {
      let workspaces;
      try {
        workspaces = fs.readdirSync(packagesDir, { withFileTypes: true });
      } catch {
        workspaces = [];
      }
      for (const w of workspaces) {
        if (!w.isDirectory()) continue;
        push(path.join(packagesDir, w.name, "node_modules", moduleName));
      }
    }
  }

  // 4. Direct deps' nested node_modules (covers any other layout)
  const directDeps = path.join(cliRoot, "node_modules");
  if (fs.existsSync(directDeps)) {
    let entries;
    try {
      entries = fs.readdirSync(directDeps, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("@")) {
        const scopeDir = path.join(directDeps, e.name);
        let scoped;
        try {
          scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
        } catch {
          scoped = [];
        }
        for (const s of scoped) {
          if (!s.isDirectory()) continue;
          push(path.join(scopeDir, s.name, "node_modules", moduleName));
        }
      } else {
        push(path.join(directDeps, e.name, "node_modules", moduleName));
      }
    }
  }

  return out;
}

/** Crude monorepo root detection: nearest ancestor with a `packages/` dir. */
function findRepoRoot(start) {
  let cur = start;
  while (true) {
    if (fs.existsSync(path.join(cur, "packages"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * Return the path to a usable .node file inside the given module dir,
 * or null if this copy has no compiled binary (e.g. source-only hoist).
 */
function nodeFileInModuleDir(moduleDir, moduleName) {
  const candidates = [
    path.join(moduleDir, "build", "Release", `${moduleName}.node`),
    path.join(
      moduleDir,
      "build",
      "Release",
      `${moduleName.replace(/-/g, "_")}.node`,
    ),
    // Generic fallback — a native fork (e.g. better-sqlite3-multiple-ciphers)
    // often keeps its upstream binary name (better_sqlite3.node). Walk the
    // whole build/Release dir before giving up.
    path.join(moduleDir, "build", "Release"),
    path.join(moduleDir, "prebuilds"),
  ];

  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const st = fs.statSync(c);
    if (st.isFile()) return c;
    if (st.isDirectory()) {
      const nodeFile = findFirstNodeFile(c);
      if (nodeFile) return nodeFile;
    }
  }
  return null;
}

/**
 * Walk the candidate install dirs and return the first .node file found.
 * This is what callers actually want.
 */
function findInstalledNodeFile(cliRoot, moduleName) {
  for (const dir of listCandidateModuleDirs(cliRoot, moduleName)) {
    const nodeFile = nodeFileInModuleDir(dir, moduleName);
    if (nodeFile) return nodeFile;
  }
  return null;
}

function findFirstNodeFile(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith(".node")) return full;
    }
  }
  return null;
}
