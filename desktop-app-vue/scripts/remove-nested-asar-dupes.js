#!/usr/bin/env node
/**
 * Remove nested duplicate copies of express@5/qs/side-channel split deps.
 *
 * v5.0.3.4-11 history: electron-builder's prod-dep walker dedupes the top-level
 * copy of `call-bind-apply-helpers` from the asar when ANY parent package has
 * a nested copy at `node_modules/<parent>/node_modules/call-bind-apply-helpers/`.
 * Result: ASAR ships with the package only inside `node_modules/call-bind/
 * node_modules/`, but `dunder-proto`'s `require('call-bind-apply-helpers')`
 * follows Node CJS resolution from `node_modules/dunder-proto/` outward and
 * NEVER traverses other packages' nested node_modules. Crash at startup with
 * `Cannot find module 'call-bind-apply-helpers'`.
 *
 * Fix: before electron-builder runs, walk `desktop-app-vue/node_modules/`
 * and remove any nested `<parent>/node_modules/<problematic-pkg>/` directory
 * (excluding the top-level copy). With nothing for the walker to dedupe to,
 * top-level inclusion is forced.
 *
 * Idempotent. Safe to run multiple times.
 */
const fs = require("fs");
const path = require("path");

const PROBLEMATIC_PKGS = [
  "call-bind-apply-helpers",
  "dunder-proto",
  "get-proto",
  "math-intrinsics",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
];

const ROOT = process.argv[2] || path.join(__dirname, "..", "node_modules");

function walk(dir, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" && depth > 0) {
      for (const pkg of PROBLEMATIC_PKGS) {
        const dup = path.join(full, pkg);
        if (fs.existsSync(dup)) {
          console.log(
            `Removing nested duplicate: ${path.relative(process.cwd(), dup)}`,
          );
          fs.rmSync(dup, { recursive: true, force: true });
        }
      }
    } else if (entry.name !== "node_modules") {
      walk(full, depth + 1);
    }
  }
}

if (!fs.existsSync(ROOT)) {
  console.log(`[remove-nested-asar-dupes] ${ROOT} does not exist, skipping`);
  process.exit(0);
}

console.log(`[remove-nested-asar-dupes] Scanning ${ROOT}`);
walk(ROOT, 0);
console.log("[remove-nested-asar-dupes] Done");
