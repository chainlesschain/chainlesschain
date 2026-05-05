/**
 * Scan src/main + dist/main + src/preload + dist/preload for ALL package
 * references (static require, ES imports, dynamic imports), then diff against
 * package.json `dependencies` to find pure renderer-only deps that Vite bundles
 * into dist/renderer/ at build time and don't need to ship in node_modules.
 *
 *   node scripts/find-renderer-only-deps.js
 */

const fs = require("fs");
const path = require("path");

const ROOTS = [
  path.resolve(__dirname, "..", "src", "main"),
  path.resolve(__dirname, "..", "src", "preload"),
  path.resolve(__dirname, "..", "dist", "main"),
  path.resolve(__dirname, "..", "dist", "preload"),
];

const SOURCE_PKG = require(path.resolve(__dirname, "..", "package.json"));
const DEPS = new Set(Object.keys(SOURCE_PKG.dependencies || {}));

// Match all four idioms: require("x"), require('x'), from "x", import("x").
// Capture only the module specifier; exclude relative paths.
const PATTERNS = [
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function topLevelOf(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2) return null;
    return parts[0] + "/" + parts[1];
  }
  return spec.split("/")[0];
}

const used = new Set();
let scanned = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      walk(full);
    } else if (e.isFile() && /\.(m?js|cjs|ts)$/.test(e.name)) {
      let text;
      try {
        text = fs.readFileSync(full, "utf-8");
      } catch (_) {
        continue;
      }
      scanned++;
      for (const re of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const top = topLevelOf(m[1]);
          if (top && DEPS.has(top)) used.add(top);
        }
      }
    }
  }
}

for (const r of ROOTS) {
  if (fs.existsSync(r)) walk(r);
  else console.log(`(skipped, missing: ${r})`);
}

console.log(`\nScanned ${scanned} source files\n`);
console.log(`Total dependencies: ${DEPS.size}`);
console.log(`Used by main/preload: ${used.size}`);
console.log(`Renderer-only candidates: ${DEPS.size - used.size}\n`);

const candidates = [...DEPS].filter((d) => !used.has(d)).sort();
console.log(
  "--- Renderer-only candidates (Vite-bundled into dist/renderer) ---",
);
candidates.forEach((d) => console.log("  " + d));

// Measure size impact
const NM = path.resolve(__dirname, "..", "node_modules");
function dirStats(p) {
  let bytes = 0,
    files = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        files++;
        try {
          bytes += fs.statSync(full).size;
        } catch (_) {}
      }
    }
  }
  return { bytes, files };
}

console.log("\n--- Top 20 candidates by disk size ---");
const sized = candidates
  .map((c) => {
    const p = path.join(NM, c);
    if (!fs.existsSync(p)) return null;
    return { pkg: c, ...dirStats(p) };
  })
  .filter(Boolean)
  .sort((a, b) => b.bytes - a.bytes);

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
let totalBytes = 0,
  totalFiles = 0;
for (const s of sized) {
  totalBytes += s.bytes;
  totalFiles += s.files;
}
for (const s of sized.slice(0, 20)) {
  console.log(
    `  ${s.pkg.padEnd(48)} ${fmtMB(s.bytes).padStart(10)}  ${s.files} files`,
  );
}
console.log(
  `\nTotal across all ${sized.length} candidates: ${fmtMB(totalBytes)} / ${totalFiles.toLocaleString()} files`,
);
