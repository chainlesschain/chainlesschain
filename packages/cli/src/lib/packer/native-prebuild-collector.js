/**
 * Phase 4: native-prebuild-collector
 *
 * Locate prebuilt .node files for native modules required at runtime
 * (better-sqlite3, optionally better-sqlite3-multiple-ciphers) and copy
 * them into a per-target prebuilds/ folder that pkg will embed as assets.
 *
 * This is a "best-effort find what's installed locally" implementation in
 * Phase 1. Phase 2 will add ABI verification and prebuild-install fetching
 * for cross-target builds.
 *
 * Target identifier format mirrors @yao-pkg/pkg: nodeXX-<os>-<arch>
 *   - nodeXX  -> module ABI (node20=115, node22=127)
 *   - os      -> win, macos, linux, alpine
 *   - arch    -> x64, arm64
 */

import fs from "node:fs";
import path from "node:path";
import { PackError, EXIT } from "./errors.js";

/** Modules we attempt to locate; missing ones are reported per-module. */
const TARGET_MODULES = [
  { name: "better-sqlite3", required: true },
  { name: "better-sqlite3-multiple-ciphers", required: false },
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

  // Required-but-missing -> error. Optional -> just reported.
  const requiredMissing = missing.filter((m) => m.required);
  if (requiredMissing.length > 0) {
    const list = requiredMissing
      .map((m) => `    - ${m.module} (target ${m.target})`)
      .join("\n");
    throw new PackError(
      `Required native module(s) not found in node_modules:\n${list}\n` +
        "  Run 'npm install better-sqlite3' inside packages/cli first.",
      EXIT.NATIVE,
    );
  }

  return { prebuildsDir, collected, missing };
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
 * Try common prebuild locations. Returns absolute path or null.
 */
function findInstalledNodeFile(cliRoot, moduleName) {
  const moduleDir = path.join(cliRoot, "node_modules", moduleName);
  if (!fs.existsSync(moduleDir)) return null;

  const candidates = [
    path.join(moduleDir, "build", "Release", `${moduleName}.node`),
    path.join(
      moduleDir,
      "build",
      "Release",
      `${moduleName.replace(/-/g, "_")}.node`,
    ),
    // npm prebuild-install layout
    path.join(moduleDir, "prebuilds"),
  ];

  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const st = fs.statSync(c);
    if (st.isFile()) return c;
    if (st.isDirectory()) {
      // Pick the first .node file inside (any platform — matching done by pkg target)
      const nodeFile = findFirstNodeFile(c);
      if (nodeFile) return nodeFile;
    }
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
