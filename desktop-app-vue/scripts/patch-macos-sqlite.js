const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

function patchMacSqlite(modulePath) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(modulePath, "package.json"), "utf8"),
  );
  if (
    !["better-sqlite3", "better-sqlite3-multiple-ciphers"].includes(pkg.name) ||
    pkg.version !== "11.10.0"
  )
    return 0;
  let changed = 0;
  for (const name of ["better_sqlite3.cpp", "better_sqlite3.lzz"]) {
    const file = path.join(modulePath, "src", name);
    if (!fs.existsSync(file) && name.endsWith(".lzz")) continue;
    const source = fs.readFileSync(file, "utf8");
    const old = /\bcontext\s*->\s*GetIsolate\s*\(\s*\)/g;
    const matches = [...source.matchAll(old)];
    if (matches.length === 0 && source.includes("v8::Isolate::GetCurrent()"))
      continue;
    assert.equal(
      matches.length,
      1,
      `Unexpected ${pkg.name}@11.10.0 V8 initializer: ${file}`,
    );
    fs.writeFileSync(file, source.replace(old, "v8::Isolate::GetCurrent()"));
    changed += 1;
  }
  return changed;
}

module.exports = { patchMacSqlite };
