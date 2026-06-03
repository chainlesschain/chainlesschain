#!/usr/bin/env node
// Removes broken bin shims left behind by npm workspaces hoisting.
//
// npm declares `vite`/`electron`/`concurrently`/etc. as deps of this workspace,
// creates a shim at desktop-app-vue/node_modules/.bin/<tool> pointing at
// $basedir/../<pkg>/.../<entry>.js, then hoists the actual package up to the
// monorepo root. The shim's relative target no longer exists, so `npm run dev`
// dies with MODULE_NOT_FOUND. Deleting the broken trio (extensionless / .cmd /
// .ps1) lets npm's PATH walk find the working shim under <root>/node_modules/.bin/.

const fs = require("fs");
const path = require("path");

const binDir = path.join(__dirname, "..", "node_modules", ".bin");
const localNodeModules = path.join(__dirname, "..", "node_modules");

if (!fs.existsSync(binDir)) {
  console.log("[fix-broken-bin-shims] no .bin directory, skipping");
  process.exit(0);
}

let removed = 0;
const removedNames = [];

for (const entry of fs.readdirSync(binDir)) {
  if (entry.endsWith(".cmd") || entry.endsWith(".ps1")) continue;

  const shimPath = path.join(binDir, entry);
  let content;
  try {
    content = fs.readFileSync(shimPath, "utf8");
  } catch {
    continue;
  }

  // npm POSIX shim line: exec "$basedir/node"  "$basedir/../<pkg>/<...>.js" "$@"
  const m = content.match(/\$basedir\/\.\.\/([^\s"]+)"/);
  if (!m) continue;

  const targetRel = m[1];
  const targetAbs = path.join(localNodeModules, targetRel);
  if (fs.existsSync(targetAbs)) continue;

  for (const ext of ["", ".cmd", ".ps1"]) {
    const f = path.join(binDir, entry + ext);
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      removed++;
    }
  }
  removedNames.push(entry);
}

if (removed === 0) {
  console.log("[fix-broken-bin-shims] no broken shims found");
} else {
  console.log(
    `[fix-broken-bin-shims] removed ${removed} files across ${removedNames.length} broken shim(s): ${removedNames.join(", ")}`,
  );
}
