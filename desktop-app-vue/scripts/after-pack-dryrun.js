/**
 * Dry-run probe for scripts/electron-after-pack.js filter.
 *
 * Re-implements the filter inline to walk source node_modules/ and tally
 * what would be copied vs skipped. No files are written.
 *
 *   node scripts/after-pack-dryrun.js [--platform=win32|darwin|linux]
 */

const fs = require("fs");
const path = require("path");

const platformArg = (
  process.argv.find((a) => a.startsWith("--platform=")) || ""
).split("=")[1];
const targetPlatform = platformArg || process.platform;

const SOURCE_PKG = require(path.resolve(__dirname, "..", "package.json"));
const DEV_DEP_SET = new Set(Object.keys(SOURCE_PKG.devDependencies || {}));
const RUNTIME_OVERRIDE_KEEP = new Set([
  "better-sqlite3",
  "electron",
  "jsdom",
  "glob",
]);

const PER_PLATFORM_NATIVES = {
  "@nomicfoundation/edr-linux-x64-gnu": "linux",
  "@nomicfoundation/edr-linux-x64-musl": "linux",
  "@nomicfoundation/edr-linux-arm64-gnu": "linux",
  "@nomicfoundation/edr-linux-arm64-musl": "linux",
  "@nomicfoundation/edr-darwin-x64": "darwin",
  "@nomicfoundation/edr-darwin-arm64": "darwin",
  "@nomicfoundation/edr-win32-x64-msvc": "win32",
  "@nomicfoundation/solidity-analyzer-linux-x64-gnu": "linux",
  "@nomicfoundation/solidity-analyzer-linux-x64-musl": "linux",
  "@nomicfoundation/solidity-analyzer-linux-arm64-gnu": "linux",
  "@nomicfoundation/solidity-analyzer-linux-arm64-musl": "linux",
  "@nomicfoundation/solidity-analyzer-darwin-x64": "darwin",
  "@nomicfoundation/solidity-analyzer-darwin-arm64": "darwin",
  "@nomicfoundation/solidity-analyzer-win32-x64-msvc": "win32",
};

const SANITY_CHECK_PKGS = [
  "call-bind-apply-helpers",
  "dunder-proto",
  "get-proto",
  "math-intrinsics",
  "merge-descriptors",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
  "express",
  "qs",
];

const sourceNm = path.resolve(__dirname, "..", "node_modules");

function topLevelOf(dirent, parentRel) {
  // parentRel is "" for direct children of node_modules,
  // or "@scope" for entries under a scope dir.
  if (parentRel === "") {
    if (dirent.name.startsWith("@")) return null; // it's a scope dir, recurse
    return dirent.name;
  }
  if (parentRel.startsWith("@")) {
    return parentRel + "/" + dirent.name;
  }
  return null;
}

let keptPkgs = 0;
let keptFiles = 0;
let keptBytes = 0;
const skippedDevDeps = new Map(); // pkg -> {files, bytes}
const skippedForeignPlatforms = new Map();

function walkPkg(pkgRoot, fullPath) {
  // Recursively measure the package directory.
  let files = 0;
  let bytes = 0;
  const stack = [fullPath];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        files++;
        try {
          bytes += fs.statSync(p).size;
        } catch (_) {}
      }
    }
  }
  return { files, bytes };
}

function processTopLevel(pkgName, pkgFullPath) {
  const isDev = DEV_DEP_SET.has(pkgName) && !RUNTIME_OVERRIDE_KEEP.has(pkgName);
  const platformOwner = PER_PLATFORM_NATIVES[pkgName];
  const isForeignPlatform = platformOwner && platformOwner !== targetPlatform;

  if (isDev || isForeignPlatform) {
    const { files, bytes } = walkPkg(pkgName, pkgFullPath);
    if (isDev) skippedDevDeps.set(pkgName, { files, bytes });
    else skippedForeignPlatforms.set(pkgName, { files, bytes });
    return;
  }

  const { files, bytes } = walkPkg(pkgName, pkgFullPath);
  keptPkgs++;
  keptFiles += files;
  keptBytes += bytes;
}

console.log(`Dry-run filter probe: target platform = ${targetPlatform}`);
console.log(`Source node_modules: ${sourceNm}\n`);

const top = fs.readdirSync(sourceNm, { withFileTypes: true });
for (const e of top) {
  if (!e.isDirectory()) continue;
  if (e.name.startsWith("@")) {
    const scopeFull = path.join(sourceNm, e.name);
    const inner = fs.readdirSync(scopeFull, { withFileTypes: true });
    for (const sub of inner) {
      if (!sub.isDirectory()) continue;
      processTopLevel(`${e.name}/${sub.name}`, path.join(scopeFull, sub.name));
    }
  } else {
    processTopLevel(e.name, path.join(sourceNm, e.name));
  }
}

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + " MB";

const totalSkipDevBytes = [...skippedDevDeps.values()].reduce(
  (s, x) => s + x.bytes,
  0,
);
const totalSkipDevFiles = [...skippedDevDeps.values()].reduce(
  (s, x) => s + x.files,
  0,
);
const totalSkipForeignBytes = [...skippedForeignPlatforms.values()].reduce(
  (s, x) => s + x.bytes,
  0,
);
const totalSkipForeignFiles = [...skippedForeignPlatforms.values()].reduce(
  (s, x) => s + x.files,
  0,
);

console.log("=== KEPT ===");
console.log(`  ${keptPkgs} top-level packages`);
console.log(`  ${keptFiles.toLocaleString()} files`);
console.log(`  ${fmtMB(keptBytes)}\n`);

console.log("=== SKIPPED: declared devDependencies ===");
console.log(
  `  ${skippedDevDeps.size} packages, ${totalSkipDevFiles.toLocaleString()} files, ${fmtMB(totalSkipDevBytes)}`,
);
const devSorted = [...skippedDevDeps.entries()].sort(
  (a, b) => b[1].bytes - a[1].bytes,
);
for (const [pkg, st] of devSorted.slice(0, 15)) {
  console.log(
    `    ${pkg.padEnd(40)} ${fmtMB(st.bytes).padStart(10)}  ${st.files} files`,
  );
}
if (devSorted.length > 15)
  console.log(`    ...and ${devSorted.length - 15} more`);

console.log("\n=== SKIPPED: foreign-platform natives ===");
console.log(
  `  ${skippedForeignPlatforms.size} packages, ${totalSkipForeignFiles.toLocaleString()} files, ${fmtMB(totalSkipForeignBytes)}`,
);
for (const [pkg, st] of [...skippedForeignPlatforms.entries()].sort(
  (a, b) => b[1].bytes - a[1].bytes,
)) {
  console.log(
    `    ${pkg.padEnd(48)} ${fmtMB(st.bytes).padStart(10)}  ${st.files} files`,
  );
}

console.log("\n=== SAVINGS ===");
console.log(
  `  ${totalSkipDevBytes + totalSkipForeignBytes > 0 ? fmtMB(totalSkipDevBytes + totalSkipForeignBytes) : "(none)"} / ${(totalSkipDevFiles + totalSkipForeignFiles).toLocaleString()} files`,
);

console.log("\n=== SANITY CHECK (must remain at top-level) ===");
let sanityOk = true;
for (const pkg of SANITY_CHECK_PKGS) {
  const exists = fs.existsSync(path.join(sourceNm, pkg, "package.json"));
  if (DEV_DEP_SET.has(pkg)) {
    console.log(
      `  [FAIL] ${pkg} would be filtered out (it's in devDependencies — sanity-check expects it kept)`,
    );
    sanityOk = false;
  } else if (!exists) {
    console.log(`  [WARN] ${pkg} not present in source node_modules`);
  } else {
    console.log(`  [ok]   ${pkg}`);
  }
}
process.exit(sanityOk ? 0 : 1);
